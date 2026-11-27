import {
  describeVanEvent,
  effectiveVanTime,
  normalizeVanPatch,
  timeToMinutes,
  vanIsPending,
  vanReasonRequired,
  vanTimeOfDay,
} from '../../shared/van-rules';
import { strictBooleanFieldError } from '../../server/utils/strict-boolean-fields';

describe('van time of day (planning sheet column I), the locked table', () => {
  it.each([
    ['09:00', '10:30', 'AM'],
    ['10:00', '12:00', 'AM'], // starts before 11, ends by 2pm
    ['09:00', '16:00', 'All day'],
    ['11:30', '13:00', 'Mid-day'],
    ['13:00', '15:30', 'PM'], // starts 11-2, ends after 2pm
    ['15:00', '17:00', 'PM'],
    ['14:00', '14:00', 'Mid-day'],
    ['10:00', '', 'AM'], // no end: the start decides
  ])('%s–%s -> %s', (start, end, expected) => {
    expect(vanTimeOfDay(start, end)).toBe(expected);
  });

  it('is blank without a start time', () => {
    expect(vanTimeOfDay('', '12:00')).toBe('');
    expect(vanTimeOfDay(null, null)).toBe('');
  });

  it('reads sheet-style times too', () => {
    expect(timeToMinutes('1:30 PM')).toBe(13 * 60 + 30);
    expect(timeToMinutes('9am')).toBe(9 * 60);
    expect(timeToMinutes('12:00 AM')).toBe(0);
    expect(timeToMinutes('13:30:00')).toBe(13 * 60 + 30);
    expect(timeToMinutes('noonish')).toBeNull();
    expect(vanTimeOfDay('9:00 AM', '4:00 PM')).toBe('All day');
  });

  it('a preset picked on the sheet wins over the times', () => {
    expect(effectiveVanTime({ vanTimeOverride: 'PM', eventStartTime: '09:00', eventEndTime: '10:00' })).toEqual({ value: 'PM', fromSheet: true });
    expect(effectiveVanTime({ vanTimeOverride: 'whenever', eventStartTime: '09:00' })).toEqual({ value: 'AM', fromSheet: false });
  });
});

describe('under-800 reason', () => {
  const van = { vanDriverNeeded: true };
  it('is needed under 800 or with no estimate', () => {
    expect(vanReasonRequired(van, 799)).toBe(true);
    expect(vanReasonRequired(van, null)).toBe(true);
    expect(vanReasonRequired(van, 800)).toBe(false);
  });
  it("doesn't apply without TSP's van (not needed, DHL, self-transport)", () => {
    expect(vanReasonRequired({ vanDriverNeeded: false }, 100)).toBe(false);
    expect(vanReasonRequired({ vanDriverNeeded: true, isDhlVan: true }, 100)).toBe(false);
    expect(vanReasonRequired({ vanDriverNeeded: true, selfTransport: true }, 100)).toBe(false);
  });
});

describe('van pending – discuss with team', () => {
  const me = { vanDriverNeeded: true, vanTeamOk: false };
  const other = (o: object) => ({ id: 2, organizationName: 'Lincoln Elementary', vanDriverNeeded: true, vanTeamOk: false, ...o });

  it('is pending while another same-day van event exists and nobody OK\'d sharing', () => {
    expect(vanIsPending(me, [other({})])).toBe(true);
  });
  it('one OK settles the pair, on either event', () => {
    expect(vanIsPending({ ...me, vanTeamOk: true }, [other({})])).toBe(false);
    expect(vanIsPending(me, [other({ vanTeamOk: true })])).toBe(false);
  });
  it('a "possibly" event or no other event is not a conflict; no van, no pending', () => {
    expect(vanIsPending(me, [other({ vanDriverNeeded: false })])).toBe(false);
    expect(vanIsPending(me, [])).toBe(false);
    expect(vanIsPending({ vanDriverNeeded: false }, [other({})])).toBe(false);
  });
  it('describes the other event with its van time and reason', () => {
    expect(describeVanEvent(other({ eventStartTime: '10:00', eventEndTime: '13:00', vanNeededFor: 'refrigeration' }))).toBe(
      'Lincoln Elementary (AM, refrigeration)',
    );
  });
});

describe('save-time cleanup (normalizeVanPatch)', () => {
  const stored = { eventStartTime: '09:00', eventEndTime: '11:00', scheduledEventDate: new Date('2026-12-05T12:00:00Z'), vanTimeOverride: 'PM' };
  it('new times clear the sheet override; the same times or an explicit override keep it', () => {
    expect(normalizeVanPatch({ eventStartTime: '13:00' }, stored)).toMatchObject({ vanTimeOverride: null });
    expect(normalizeVanPatch({ eventStartTime: '09:00' }, stored)).not.toHaveProperty('vanTimeOverride');
    expect(normalizeVanPatch({ eventStartTime: '13:00', vanTimeOverride: 'AM' }, stored)).toMatchObject({ vanTimeOverride: 'AM' });
  });
  it('turning the van off clears the OK and the reason', () => {
    expect(normalizeVanPatch({ vanDriverNeeded: false }, stored)).toMatchObject({ vanTeamOk: false, vanReason: null });
  });

  // The route's van-purpose cleanup (selfTransport -> van off) runs AFTER this
  // helper, so it must judge the event as it will be saved.
  const tspVan = { ...stored, vanDriverNeeded: true, vanTeamOk: true, vanReason: 'no fridge' };
  it('self-transport or the DHL van clears the OK and the reason (even before the van is turned off)', () => {
    expect(normalizeVanPatch({ selfTransport: true }, tspVan)).toMatchObject({ vanTeamOk: false, vanReason: null });
    expect(normalizeVanPatch({ selfTransport: 'true' } as any, tspVan)).toMatchObject({ vanTeamOk: false, vanReason: null });
    expect(normalizeVanPatch({ isDhlVan: true }, tspVan)).toMatchObject({ vanTeamOk: false, vanReason: null });
  });
  it('an OK sent along with leaving TSP\'s van is still cleared', () => {
    expect(normalizeVanPatch({ selfTransport: true, vanTeamOk: true, vanReason: 'x' }, tspVan)).toMatchObject({ vanTeamOk: false, vanReason: null });
  });
  it('switching back to TSP\'s van later finds no old OK to reuse', () => {
    const leftVan = { ...tspVan, ...normalizeVanPatch({ isDhlVan: true }, tspVan), isDhlVan: true };
    expect(leftVan.vanTeamOk).toBe(false);
    expect(normalizeVanPatch({ isDhlVan: false }, leftVan)).not.toHaveProperty('vanTeamOk', true);
  });
  it("leaves the OK and reason alone while the event keeps TSP's van", () => {
    expect(normalizeVanPatch({ selfTransport: false }, tspVan)).not.toHaveProperty('vanTeamOk');
    expect(normalizeVanPatch({ isDhlVan: false, vanDriverNeeded: true }, tspVan)).not.toHaveProperty('vanReason');
    expect(normalizeVanPatch({ vanTeamOk: true }, tspVan)).toMatchObject({ vanTeamOk: true });
  });
  it('a new date clears the OK; the same day in another format does not', () => {
    expect(normalizeVanPatch({ scheduledEventDate: '2026-12-06' }, stored)).toMatchObject({ vanTeamOk: false });
    expect(normalizeVanPatch({ scheduledEventDate: '2026-12-05' }, stored)).not.toHaveProperty('vanTeamOk');
  });
});

describe('van fields are refused with a clear message when malformed', () => {
  it('team OK is strictly true/false; the time override is a preset or null', () => {
    expect(strictBooleanFieldError({ vanTeamOk: 'yes' })).toBe('vanTeamOk must be true or false');
    expect(strictBooleanFieldError({ vanTimeOverride: 'Mid-day' })).toBeNull();
    expect(strictBooleanFieldError({ vanTimeOverride: null })).toBeNull();
    expect(strictBooleanFieldError({ vanTimeOverride: 'noon' })).toMatch(/must be one of: AM, Mid-day, PM, All day/);
  });
});
