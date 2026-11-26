import {
  evaluateEventAlerts,
  toAlertLines,
  maxSnoozeDays,
  urgencyCompare,
  easternDaysBetween,
  type AlertEvent,
  type AlertSnooze,
  type AlertState,
  type AlertRuleType,
} from '../services/event-alerts/rules';
import { SYSTEM_DEFAULT_CHECK_IN_REMINDER_PREFERENCES, normalizeCheckInReminderPreferences } from '@shared/types';
import type { DefaultReminderRule } from '@shared/types';

// 9:02 AM Eastern (EST, UTC-5) on Tue Dec 1 2026
const NOW = new Date('2026-12-01T14:02:00Z');
const daysAgo = (n: number, hourUtc = 14) => new Date(Date.UTC(2026, 11, 1 - n, hourUtc, 5));
/** Date-only event date stored as UTC midnight, n days from Dec 1 */
const inDays = (n: number) => new Date(Date.UTC(2026, 11, 1 + n));

const DEFAULTS = SYSTEM_DEFAULT_CHECK_IN_REMINDER_PREFERENCES.rules;
const only = (ruleType: AlertRuleType, patch: Partial<DefaultReminderRule> = {}): DefaultReminderRule[] =>
  DEFAULTS.map(r => (r.ruleType === ruleType ? { ...r, ...patch } : { ...r, enabled: false }));

const complete = {
  eventStartTime: '10:00',
  eventAddress: '1 Peachtree St',
  estimatedSandwichCount: 200,
  sandwichTypes: [{ type: 'pbj', quantity: 200 }],
  addedToOfficialSheet: true,
};

function event(patch: Partial<AlertEvent> = {}): AlertEvent {
  return { id: 1, status: 'in_process', organizationName: 'Test Org', createdAt: daysAgo(30), ...patch };
}

function run(
  ev: AlertEvent,
  rules: DefaultReminderRule[],
  state: Partial<Record<AlertRuleType, AlertState>> = {},
  snoozes: AlertSnooze[] = [],
  now = NOW,
) {
  return evaluateEventAlerts(ev, rules, state, snoozes, now);
}

const sent = (at: Date | null, key: string | null = null): AlertState => ({ lastSentAt: at, lastSentKey: key });

describe('Eastern day counting', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // Sent 9:05 AM ET, checked 9:02 AM ET five days later: still 5 days
    expect(easternDaysBetween(daysAgo(5), NOW)).toBe(5);
  });
  it('uses the Eastern date, not UTC (8 PM ET is the same day)', () => {
    const lateEvening = new Date('2026-12-01T01:00:00Z'); // 8 PM ET Nov 30
    expect(easternDaysBetween(lateEvening, NOW)).toBe(1);
  });
});

describe('no contact', () => {
  const rules = only('no_contact', { thresholdDays: 5 });

  it('fires once the threshold is reached', () => {
    expect(run(event({ lastContactAttempt: daysAgo(5) }), rules).due).toHaveLength(1);
    expect(run(event({ lastContactAttempt: daysAgo(4) }), rules).due).toHaveLength(0);
  });

  it('applies to New events too, not just In Process', () => {
    expect(run(event({ status: 'new', lastContactAttempt: daysAgo(6) }), rules).due).toHaveLength(1);
  });

  it('does not apply once scheduled', () => {
    expect(run(event({ status: 'scheduled', lastContactAttempt: daysAgo(20) }), rules).due).toHaveLength(0);
  });

  it('counts from when the request came in if never contacted', () => {
    const r = run(event({ createdAt: daysAgo(8) }), rules);
    expect(r.due[0].line).toBe('No contact logged yet (came in 8 days ago)');
  });

  it('repeats every X days: day 5, then day 10', () => {
    const ev = event({ lastContactAttempt: daysAgo(8) });
    expect(run(ev, rules, { no_contact: sent(daysAgo(3)) }).due).toHaveLength(0); // sent day 5, now day 8
    const ev10 = event({ lastContactAttempt: daysAgo(10) });
    expect(run(ev10, rules, { no_contact: sent(daysAgo(5)) }).due).toHaveLength(1); // sent day 5, now day 10
  });

  it('resets when a contact is logged after the last alert', () => {
    // Alert went out 8 days ago; contact logged 6 days ago; 6 >= 5 -> new cycle fires now
    const ev = event({ lastContactAttempt: daysAgo(6) });
    expect(run(ev, rules, { no_contact: sent(daysAgo(8)) }).due).toHaveLength(1);
    // Contact 2 days ago: condition not met at all
    expect(run(event({ lastContactAttempt: daysAgo(2) }), rules, { no_contact: sent(daysAgo(8)) }).due).toHaveLength(0);
  });

  it('reads the structured contact log over the legacy field', () => {
    const ev = event({
      lastContactAttempt: daysAgo(20),
      contactAttemptsLog: [{ timestamp: daysAgo(1).toISOString() }],
    });
    expect(run(ev, rules).due).toHaveLength(0);
  });
});

describe('no updates', () => {
  const rules = only('stale_event', { thresholdDays: 7 });

  it('measures the last change by a person, not updated_at', () => {
    const ev = event({ lastHumanUpdateAt: daysAgo(9), updatedAt: daysAgo(0) });
    expect(run(ev, rules).due[0].line).toBe('No updates in 9 days');
  });

  it('not yet backfilled: falls back to updated_at (old behavior), then the created date', () => {
    expect(run(event({ lastHumanUpdateAt: null, updatedAt: daysAgo(2), createdAt: daysAgo(90) }), rules).due).toHaveLength(0);
    expect(run(event({ lastHumanUpdateAt: null, updatedAt: daysAgo(8) }), rules).due).toHaveLength(1);
    expect(run(event({ lastHumanUpdateAt: null, updatedAt: null, createdAt: daysAgo(7) }), rules).due).toHaveLength(1);
    expect(run(event({ lastHumanUpdateAt: null, updatedAt: null, createdAt: daysAgo(6) }), rules).due).toHaveLength(0);
  });
});

describe('requested date coming up (checkpoints)', () => {
  const rules = only('date_approaching_inprocess', { checkpointDays: [14, 7, 2] });
  const key = (d: number, c: number) => `${inDays(d).toISOString().slice(0, 10)}:${c}`;

  it('fires once at each checkpoint', () => {
    const at14 = run(event({ desiredEventDate: inDays(14) }), rules);
    expect(at14.due[0].stateKey).toBe(key(14, 14));
    // Day 10: already sent the 14-day one -> quiet
    expect(run(event({ desiredEventDate: inDays(10) }), rules, { date_approaching_inprocess: sent(daysAgo(4), key(10, 14)) }).due).toHaveLength(0);
    // Day 7: next checkpoint
    const at7 = run(event({ desiredEventDate: inDays(7) }), rules, { date_approaching_inprocess: sent(daysAgo(7), key(7, 14)) });
    expect(at7.due[0].stateKey).toBe(key(7, 7));
  });

  it('arriving past checkpoints sends ONE alert for the current point, not a backlog', () => {
    const r = run(event({ desiredEventDate: inDays(5) }), rules);
    expect(r.due).toHaveLength(1);
    expect(r.due[0].stateKey).toBe(key(5, 7));
    expect(r.due[0].line).toBe("Requested date is in 5 days (Sun, Dec 6) and it's still In Process");
  });

  it('a single checkpoint works (just 7)', () => {
    const r7 = only('date_approaching_inprocess', { checkpointDays: [7] });
    expect(run(event({ desiredEventDate: inDays(10) }), r7).due).toHaveLength(0);
    expect(run(event({ desiredEventDate: inDays(7) }), r7).due).toHaveLength(1);
  });

  it('a changed date fires again for the new date', () => {
    const r = run(event({ desiredEventDate: inDays(6) }), rules, { date_approaching_inprocess: sent(daysAgo(1), key(9, 7)) });
    expect(r.due).toHaveLength(1);
  });

  it('stops once the date has passed or the event is scheduled', () => {
    expect(run(event({ desiredEventDate: inDays(-1) }), rules).due).toHaveLength(0);
    expect(run(event({ status: 'scheduled', desiredEventDate: inDays(3) }), rules).due).toHaveLength(0);
  });

  it('says "today" and "tomorrow"', () => {
    expect(run(event({ desiredEventDate: inDays(0) }), rules).due[0].line).toContain('is today');
    expect(run(event({ desiredEventDate: inDays(1) }), rules).due[0].line).toContain('is tomorrow');
  });
});

describe('scheduled event missing info', () => {
  const rules = only('date_approaching_scheduled', { thresholdDays: 7 });
  const sched = (patch: Partial<AlertEvent>) => event({ status: 'scheduled', scheduledEventDate: inDays(5), ...patch });

  it('fires daily while info is missing, starting X days out', () => {
    expect(run(sched({}), rules).due).toHaveLength(1);
    expect(run(sched({}), rules, { date_approaching_scheduled: sent(daysAgo(0, 15)) }).due).toHaveLength(0); // already today
    expect(run(sched({}), rules, { date_approaching_scheduled: sent(daysAgo(1)) }).due).toHaveLength(1); // yesterday -> again
    expect(run(sched({ scheduledEventDate: inDays(8) }), rules).due).toHaveLength(0); // too early
  });

  it('lists what is missing, including the planning sheet', () => {
    const r = run(sched({ ...complete, eventAddress: null, addedToOfficialSheet: false }), rules);
    expect(r.due[0].line).toBe('Event is in 5 days (Sun, Dec 6): still missing address; not marked as added to the planning sheet');
  });

  it('stops once everything is filled in and it is on the sheet', () => {
    expect(run(sched(complete), rules).due).toHaveLength(0);
  });

  it('applies to rescheduled events', () => {
    expect(run(sched({ status: 'rescheduled' }), rules).due).toHaveLength(1);
  });
});

describe('snoozes ("remind me again in N days")', () => {
  const rules = DEFAULTS; // all on
  const quiet = event({ lastContactAttempt: daysAgo(8), lastHumanUpdateAt: daysAgo(8) });
  const snooze = (patch: Partial<AlertSnooze>): AlertSnooze => ({
    id: 99, ruleType: 'no_contact', snoozeType: 'timed', snoozedUntil: inDays(2), createdAt: daysAgo(1), ...patch,
  });

  it('silences only the snoozed alert', () => {
    const r = run(quiet, rules, {}, [snooze({})]);
    expect(r.due.map(a => a.ruleType)).toEqual(['stale_event']);
  });

  it('a legacy whole-event snooze silences every alert', () => {
    expect(run(quiet, rules, {}, [snooze({ ruleType: null })]).due).toHaveLength(0);
  });

  it('when a snooze ends, the alert comes back right away (whatever its cadence)', () => {
    // Sent 3 days ago (cadence says wait until day 5), snoozed until this morning
    const r = run(quiet, only('no_contact'), { no_contact: sent(daysAgo(3)) }, [snooze({ snoozedUntil: new Date('2026-12-01T13:00:00Z') })]);
    expect(r.due).toHaveLength(1);
    expect(r.endedSnoozeIds).toEqual([99]);
  });

  it('fixing the problem ends the snooze', () => {
    const fixed = event({ lastContactAttempt: daysAgo(1) });
    const r = run(fixed, only('no_contact'), {}, [snooze({})]);
    expect(r.due).toHaveLength(0);
    expect(r.endedSnoozeIds).toEqual([99]);
  });

  it('no snooze silences anything the day before or day of the event, even one made before the date moved up', () => {
    // Snoozed for a week when the date was weeks away; the date is now tomorrow
    const moved = event({ desiredEventDate: inDays(1), lastContactAttempt: daysAgo(8) });
    const long = snooze({ ruleType: 'date_approaching_inprocess', snoozedUntil: inDays(7) });
    const r = run(moved, only('date_approaching_inprocess', { checkpointDays: [14, 7, 2] }), {}, [long]);
    expect(r.due.map(a => a.ruleType)).toEqual(['date_approaching_inprocess']);
    expect(r.endedSnoozeIds).toEqual([99]);
    // Two days out: the snooze still holds (it can't run past tomorrow, but today it's fine)
    const twoOut = event({ desiredEventDate: inDays(2), lastContactAttempt: daysAgo(8) });
    expect(run(twoOut, only('date_approaching_inprocess', { checkpointDays: [14, 7, 2] }), {}, [long]).due).toHaveLength(0);
  });

  it('until_contact snoozes end when a contact is logged after them', () => {
    const s = snooze({ ruleType: null, snoozeType: 'until_contact', snoozedUntil: null, createdAt: daysAgo(9) });
    // contact 8 days ago is after the snooze (9 days ago) -> over -> alerts resume
    expect(run(quiet, only('no_contact'), {}, [s]).due).toHaveLength(1);
  });
});

describe('maxSnoozeDays', () => {
  it('cannot run past the day before the event', () => {
    expect(maxSnoozeDays(event({ desiredEventDate: inDays(4) }), NOW)).toBe(3);
    expect(maxSnoozeDays(event({ desiredEventDate: inDays(1) }), NOW)).toBe(0);
    expect(maxSnoozeDays(event({ status: 'scheduled', scheduledEventDate: inDays(6), desiredEventDate: inDays(30) }), NOW)).toBe(5);
  });
  it('has no limit without an upcoming date', () => {
    expect(maxSnoozeDays(event({}), NOW)).toBeNull();
    expect(maxSnoozeDays(event({ desiredEventDate: inDays(-3) }), NOW)).toBeNull();
  });
});

describe('display', () => {
  it('merges no contact + no updates into one line covering both', () => {
    const r = run(event({ lastContactAttempt: daysAgo(8), lastHumanUpdateAt: daysAgo(8) }), DEFAULTS);
    expect(r.due).toHaveLength(2); // both still recorded as sent
    expect(toAlertLines(r.due)).toEqual([{ line: 'No contact or updates in 8 days', ruleTypes: ['no_contact', 'stale_event'] }]);
  });

  it('keeps both numbers when they differ', () => {
    const r = run(event({ lastContactAttempt: daysAgo(71), lastHumanUpdateAt: daysAgo(51) }), DEFAULTS);
    expect(toAlertLines(r.due)[0].line).toBe('No contact logged in 71 days; no updates in 51 days');
  });

  it('orders soonest dates first, then longest quiet', () => {
    const soon = run(event({ desiredEventDate: inDays(3) }), DEFAULTS).due;
    const later = run(event({ desiredEventDate: inDays(10) }), DEFAULTS).due;
    const veryQuiet = run(event({ lastContactAttempt: daysAgo(90) }), only('no_contact')).due;
    const quiet = run(event({ lastContactAttempt: daysAgo(10) }), only('no_contact')).due;
    const sorted = [quiet, later, veryQuiet, soon].sort(urgencyCompare);
    expect(sorted).toEqual([soon, later, veryQuiet, quiet]);
  });
});

describe('settings normalization', () => {
  it('turns the old 14-day setting into the new default checkpoints', () => {
    const p = normalizeCheckInReminderPreferences({
      configured: true,
      defaultChannel: 'email',
      rules: [{ ruleType: 'date_approaching_inprocess', enabled: true, thresholdDays: 14, frequency: 'weekly' } as any],
    });
    expect(p.rules.find(r => r.ruleType === 'date_approaching_inprocess')!.checkpointDays).toEqual([14, 7, 2]);
  });
  it('keeps a custom old value as a single checkpoint', () => {
    const p = normalizeCheckInReminderPreferences({
      configured: true,
      defaultChannel: 'email',
      rules: [{ ruleType: 'date_approaching_inprocess', enabled: true, thresholdDays: 10 } as any],
    });
    expect(p.rules.find(r => r.ruleType === 'date_approaching_inprocess')!.checkpointDays).toEqual([10]);
  });
  it('drops retired alerts, sorts and dedupes checkpoints, and turns off alerts a configured person omitted', () => {
    const p = normalizeCheckInReminderPreferences({
      configured: true,
      defaultChannel: 'sms',
      rules: [
        { ruleType: 'general_checkin', enabled: true, thresholdDays: 7 } as any,
        { ruleType: 'date_approaching_inprocess', enabled: true, thresholdDays: 3, checkpointDays: [2, 14, 7, 7] },
      ],
    });
    expect(p.rules.map(r => r.ruleType)).toEqual(['no_contact', 'stale_event', 'date_approaching_inprocess', 'date_approaching_scheduled']);
    expect(p.rules[2].checkpointDays).toEqual([14, 7, 2]);
    expect(p.rules[0].enabled).toBe(false);
  });
});
