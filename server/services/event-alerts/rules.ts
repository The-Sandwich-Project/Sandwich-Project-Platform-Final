/**
 * Event alerts: which alerts are due today for one event.
 *
 * Pure functions (no database, no clock reads except the `now` passed in),
 * so the timing rules are unit-testable. The runner that loads data, enforces
 * the one-email-a-day limit and sends lives in
 * server/services/check-in-reminder-service.ts.
 *
 * The four alerts and when they fire (X / checkpoints come from the person's
 * settings in Profile → Alerts):
 *
 *   no_contact                  New / In Process. X days after the last logged
 *                               contact (or after the request came in), then
 *                               every X days until a contact is logged.
 *   stale_event                 New / In Process. X days after a PERSON last
 *                               changed the event (last_human_update_at; the
 *                               sheet sync and cron jobs don't count), then
 *                               every X days.
 *   date_approaching_inprocess  New / In Process. Once at each checkpoint before
 *                               the requested date (e.g. 14, 7, 2 days out).
 *                               Arriving already past a checkpoint sends ONE
 *                               alert for the current point, not a backlog.
 *   date_approaching_scheduled  Scheduled / Rescheduled. Every day from X days
 *                               before the event while details are missing or
 *                               it isn't on the planning sheet.
 *
 * Snoozes ("remind me again in N days" in the email) silence one alert on one
 * event; legacy snoozes with no rule silence every alert on the event. When a
 * snooze ends and the problem is still there, the alert comes back right away,
 * whatever its normal cadence. Fixing the problem ends that alert's snooze.
 *
 * Days are counted in Eastern calendar days, never raw hours: a send at 9:05
 * and a check at 9:02 five days later is still five days.
 */
import { getLastContactTimestamp } from '@shared/contact-age';
import { estimateStateFromFields } from '@shared/sandwich-estimate';
import { STATUS_DEFINITIONS, type EventStatus } from '@shared/event-status-workflow';
import type { DefaultReminderRule } from '@shared/types';

export type AlertRuleType =
  | 'no_contact'
  | 'stale_event'
  | 'date_approaching_inprocess'
  | 'date_approaching_scheduled';

/** Event statuses that get alerts at all. */
export const ALERT_STATUSES = ['new', 'in_process', 'scheduled', 'rescheduled'] as const;
const PRE_SCHEDULE = new Set(['new', 'in_process']);
const SCHEDULED = new Set(['scheduled', 'rescheduled']);

/** The event fields the rules read. */
export type AlertEvent = {
  id: number;
  status: string | null;
  organizationName?: string | null;
  createdAt: Date | string;
  desiredEventDate?: Date | string | null;
  scheduledEventDate?: Date | string | null;
  eventStartTime?: string | null;
  eventAddress?: string | null;
  addedToOfficialSheet?: boolean | null;
  contactAttemptsLog?: unknown;
  lastContactAttempt?: Date | string | null;
  lastHumanUpdateAt?: Date | string | null;
  [key: string]: unknown;
};

/** What was last sent for one alert on one event to one person. */
export type AlertState = { lastSentAt: Date | null; lastSentKey: string | null };

export type AlertSnooze = {
  id: number;
  /** null = legacy whole-event pause */
  ruleType: string | null;
  snoozeType: string; // 'timed' | 'until_date' | 'until_contact'
  snoozedUntil: Date | null;
  createdAt: Date;
};

export type DueAlert = {
  ruleType: AlertRuleType;
  /** One sentence for the email card */
  line: string;
  /** Stored in last_sent_key when sent (checkpoint alerts) */
  stateKey: string | null;
  /** Days until the relevant date (date alerts), for ordering */
  daysUntil: number | null;
  /** Days since the anchor (no contact / no updates), for ordering */
  daysSince: number | null;
};

export type EventEvaluation = {
  due: DueAlert[];
  /** Snoozes that are over (expired, or their problem was fixed): deactivate after sending */
  endedSnoozeIds: number[];
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Eastern calendar date as YYYY-MM-DD. */
export function easternDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Day number (days since epoch) of the Eastern calendar date of an instant. */
function easternDayNumber(d: Date): number {
  const [y, m, day] = easternDateString(d).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / MS_PER_DAY);
}

/** Whole Eastern calendar days from a to b (b later = positive). */
export function easternDaysBetween(a: Date, b: Date): number {
  return easternDayNumber(b) - easternDayNumber(a);
}

/** Current hour (0-23) in Eastern. */
export function easternHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
  }).format(d));
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Event dates are date-only values stored as UTC midnight: read their UTC
 * calendar date. 0 = today (Eastern), 1 = tomorrow, negative = past.
 */
export function daysUntilEventDate(date: Date | string | null | undefined, now: Date): number | null {
  const d = toDate(date);
  if (!d) return null;
  const eventDay = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
  return eventDay - easternDayNumber(now);
}

/** YYYY-MM-DD of a date-only event date. */
function eventDateKey(date: Date | string | null | undefined): string {
  const d = toDate(date);
  return d ? d.toISOString().slice(0, 10) : 'none';
}

export function formatEventDate(date: Date | string | null | undefined): string {
  const d = toDate(date);
  if (!d) return 'no date yet';
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function inDays(n: number): string {
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return STATUS_DEFINITIONS[status as EventStatus]?.label || status.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Event facts
// ---------------------------------------------------------------------------

/** Details still blank on an event (the "missing info" alert). */
export function missingEventInfo(event: AlertEvent): string[] {
  const missing: string[] = [];
  if (!event.eventStartTime) missing.push('the event time');
  if (!event.eventAddress) missing.push('the address');
  const estimate = estimateStateFromFields(event as any);
  // A count is known if there's a total, or every type line has an amount.
  const hasCount = !!estimate.total || (estimate.lines.length > 0 && estimate.lines.every(l => l.amount));
  if (!hasCount) missing.push('the sandwich count');
  if (estimate.lines.length === 0 || estimate.lines.some(l => l.type === 'unknown')) {
    missing.push('the sandwich types');
  }
  return missing;
}

/** The date that matters for this event right now: scheduled date once scheduled, else requested. */
export function relevantEventDate(event: AlertEvent): Date | string | null | undefined {
  return SCHEDULED.has(event.status || '') ? event.scheduledEventDate ?? event.desiredEventDate : event.desiredEventDate;
}

/**
 * Longest "remind me again in N days" allowed for an event: a snooze may not
 * run past the day before its date, so it can't hide the last alert. null =
 * no limit (no upcoming date). 0 = no snooze possible (event is today or tomorrow).
 */
export function maxSnoozeDays(event: AlertEvent, now: Date): number | null {
  const d = daysUntilEventDate(relevantEventDate(event), now);
  if (d === null || d < 0) return null;
  return Math.max(0, d - 1);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function snoozeIsOver(s: AlertSnooze, lastContact: Date | null, now: Date): boolean {
  if (s.snoozeType === 'until_contact') return !!lastContact && lastContact > s.createdAt;
  return !s.snoozedUntil || s.snoozedUntil <= now;
}

type RuleCheck =
  | { met: false }
  | { met: true; dueByCadence: boolean; line: string; stateKey: string | null; daysUntil: number | null; daysSince: number | null };

/**
 * Evaluate every enabled alert for one event, for the person it's assigned to.
 * `rules` must be that person's settings (normalized); `state` and `snoozes`
 * are theirs for this event.
 */
export function evaluateEventAlerts(
  event: AlertEvent,
  rules: DefaultReminderRule[],
  state: Partial<Record<AlertRuleType, AlertState>>,
  snoozes: AlertSnooze[],
  now: Date,
): EventEvaluation {
  const status = event.status || '';
  const lastContact = getLastContactTimestamp(event as any);
  const createdAt = toDate(event.createdAt) ?? now;
  const due: DueAlert[] = [];
  const endedSnoozeIds = new Set<number>();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const ruleType = rule.ruleType as AlertRuleType;
    const s = state[ruleType] ?? { lastSentAt: null, lastSentKey: null };
    const check = checkRule(ruleType, rule, event, status, lastContact, createdAt, s, now);

    const mine = snoozes.filter(sn => sn.ruleType === ruleType);
    const wholeEvent = snoozes.filter(sn => sn.ruleType === null);

    if (!check.met) {
      // Problem fixed: this alert's snoozes are done (it starts fresh if it returns).
      mine.forEach(sn => endedSnoozeIds.add(sn.id));
      continue;
    }

    let silenced = false;
    let snoozeJustEnded = false;
    for (const sn of [...mine, ...wholeEvent]) {
      if (snoozeIsOver(sn, lastContact, now)) {
        endedSnoozeIds.add(sn.id);
        // Ended since the last send: the person asked to be reminded, so remind them.
        const endedAt = sn.snoozedUntil ?? now;
        if (!s.lastSentAt || endedAt > s.lastSentAt) snoozeJustEnded = true;
      } else {
        silenced = true;
      }
    }
    if (silenced) continue;
    if (!check.dueByCadence && !snoozeJustEnded) continue;

    due.push({
      ruleType,
      line: check.line,
      stateKey: check.stateKey,
      daysUntil: check.daysUntil,
      daysSince: check.daysSince,
    });
  }

  return { due, endedSnoozeIds: [...endedSnoozeIds] };
}

function checkRule(
  ruleType: AlertRuleType,
  rule: DefaultReminderRule,
  event: AlertEvent,
  status: string,
  lastContact: Date | null,
  createdAt: Date,
  s: AlertState,
  now: Date,
): RuleCheck {
  const everyX = (anchor: Date, x: number) =>
    !s.lastSentAt || s.lastSentAt < anchor || easternDaysBetween(s.lastSentAt, now) >= x;

  switch (ruleType) {
    case 'no_contact': {
      if (!PRE_SCHEDULE.has(status)) return { met: false };
      const anchor = lastContact ?? createdAt;
      const since = easternDaysBetween(anchor, now);
      if (since < rule.thresholdDays) return { met: false };
      return {
        met: true,
        dueByCadence: everyX(anchor, rule.thresholdDays),
        line: lastContact
          ? `No contact logged in ${plural(since, 'day')}`
          : `No contact logged yet (came in ${plural(since, 'day')} ago)`,
        stateKey: null,
        daysUntil: null,
        daysSince: since,
      };
    }
    case 'stale_event': {
      if (!PRE_SCHEDULE.has(status)) return { met: false };
      const anchor = toDate(event.lastHumanUpdateAt) ?? createdAt;
      const since = easternDaysBetween(anchor, now);
      if (since < rule.thresholdDays) return { met: false };
      return {
        met: true,
        dueByCadence: everyX(anchor, rule.thresholdDays),
        line: `No updates in ${plural(since, 'day')}`,
        stateKey: null,
        daysUntil: null,
        daysSince: since,
      };
    }
    case 'date_approaching_inprocess': {
      if (!PRE_SCHEDULE.has(status)) return { met: false };
      const d = daysUntilEventDate(event.desiredEventDate, now);
      if (d === null || d < 0) return { met: false };
      const checkpoints = rule.checkpointDays?.length ? rule.checkpointDays : [rule.thresholdDays];
      const passed = checkpoints.filter(c => d <= c);
      if (passed.length === 0) return { met: false };
      // The tightest checkpoint already reached. Arriving at 10 days out with
      // checkpoints 14/7/2 -> 14: one alert now, then 7 and 2 as usual.
      const current = Math.min(...passed);
      const stateKey = `${eventDateKey(event.desiredEventDate)}:${current}`;
      return {
        met: true,
        dueByCadence: s.lastSentKey !== stateKey,
        line: `Requested date is ${inDays(d)} (${formatEventDate(event.desiredEventDate)}) and it's still ${statusLabel(status)}`,
        stateKey,
        daysUntil: d,
        daysSince: null,
      };
    }
    case 'date_approaching_scheduled': {
      if (!SCHEDULED.has(status)) return { met: false };
      const date = event.scheduledEventDate ?? event.desiredEventDate;
      const d = daysUntilEventDate(date, now);
      if (d === null || d < 0 || d > rule.thresholdDays) return { met: false };
      const gaps = missingEventInfo(event).map(m => m.replace(/^the /, ''));
      const offSheet = !event.addedToOfficialSheet;
      if (gaps.length === 0 && !offSheet) return { met: false };
      const parts: string[] = [];
      if (gaps.length) parts.push(`still missing ${joinList(gaps)}`);
      if (offSheet) parts.push('not marked as added to the planning sheet');
      return {
        met: true,
        // Daily until fixed; the one-email-a-day limit keeps it to once a day.
        dueByCadence: !s.lastSentAt || easternDaysBetween(s.lastSentAt, now) >= 1,
        line: `Event is ${inDays(d)} (${formatEventDate(date)}): ${parts.join('; ')}`,
        stateKey: null,
        daysUntil: d,
        daysSince: null,
      };
    }
  }
}

/** One line on an email card, and the alert(s) it stands for (its snooze links silence all of them). */
export type AlertLine = { line: string; ruleTypes: AlertRuleType[] };

/**
 * Display only: "no contact" and "no updates" usually fire together on the
 * same quiet event, so show them as one line. (Both are still recorded as
 * sent; see the runner.)
 */
export function toAlertLines(due: DueAlert[]): AlertLine[] {
  const nc = due.find(a => a.ruleType === 'no_contact');
  const st = due.find(a => a.ruleType === 'stale_event');
  const rest = due.filter(a => a !== nc && a !== st).map(a => ({ line: a.line, ruleTypes: [a.ruleType] }));
  if (!nc || !st) {
    return [...[nc, st].filter((a): a is DueAlert => !!a).map(a => ({ line: a.line, ruleTypes: [a.ruleType] })), ...rest];
  }
  const line =
    nc.daysSince === st.daysSince && !nc.line.includes('yet')
      ? `No contact or updates in ${plural(nc.daysSince!, 'day')}`
      : `${nc.line}; ${st.line.charAt(0).toLowerCase()}${st.line.slice(1)}`;
  return [{ line, ruleTypes: ['no_contact', 'stale_event'] }, ...rest];
}

/**
 * Most urgent first: events with a date alert, soonest date first; then the
 * rest, longest without contact/updates first.
 */
export function urgencyCompare(a: DueAlert[], b: DueAlert[]): number {
  const soonest = (xs: DueAlert[]) => Math.min(...xs.map(x => x.daysUntil ?? Infinity));
  const longest = (xs: DueAlert[]) => Math.max(...xs.map(x => x.daysSince ?? -1));
  const sa = soonest(a), sb = soonest(b);
  if (sa !== sb) return sa - sb;
  return longest(b) - longest(a);
}
