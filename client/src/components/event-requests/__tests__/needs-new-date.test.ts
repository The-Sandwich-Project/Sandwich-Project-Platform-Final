import {
  applyInProcessFilters,
  EMPTY_IN_PROCESS_FILTERS,
  hasActiveInProcessFilters,
  needsNewDate,
} from '../lib/inProcessFilters';
import {
  isStandbyReasonComplete,
  standbyCheckBackValue,
} from '../form-sections/StandbyDetailsSection';

describe('"Needs new date" (replaces the Rescheduled status)', () => {
  const lost = { id: 1, status: 'in_process', needsNewDateSince: '2026-11-30T12:00:00Z' };
  const fresh = { id: 2, status: 'in_process', needsNewDateSince: null };
  const scheduled = { id: 3, status: 'scheduled', needsNewDateSince: '2026-11-30T12:00:00Z' };

  it('applies only to In Process events that lost their date', () => {
    expect(needsNewDate(lost)).toBe(true);
    expect(needsNewDate(fresh)).toBe(false);
    expect(needsNewDate(scheduled)).toBe(false);
  });

  it('the filter keeps only those events and counts as active', () => {
    const f = { ...EMPTY_IN_PROCESS_FILTERS, needsNewDate: true };
    expect(hasActiveInProcessFilters(f)).toBe(true);
    expect(applyInProcessFilters([lost, fresh], f).map((r) => r.id)).toEqual([1]);
    expect(hasActiveInProcessFilters(EMPTY_IN_PROCESS_FILTERS)).toBe(false);
  });
});

describe('Standby details in the edit form', () => {
  it('requires a reason, and a note for "Other"', () => {
    expect(isStandbyReasonComplete('', '')).toBe(false);
    expect(isStandbyReasonComplete('Budget', '')).toBe(true);
    expect(isStandbyReasonComplete('Other', '  ')).toBe(false);
    expect(isStandbyReasonComplete('Other', 'principal approval')).toBe(true);
  });

  it('turns the check-back choice into the date to save', () => {
    expect(standbyCheckBackValue('none', '2026-12-20')).toBe('');
    expect(standbyCheckBackValue('specific', '2026-12-20')).toBe('2026-12-20');
    expect(standbyCheckBackValue('one_week', '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Standby check-back date', () => {
  it('"On a specific date" needs a date; only "No reminder" turns it off', () => {
    const { isStandbyCheckBackComplete } = require('../form-sections/StandbyDetailsSection');
    expect(isStandbyCheckBackComplete('specific', '')).toBe(false);
    expect(isStandbyCheckBackComplete('specific', '2026-12-20')).toBe(true);
    expect(isStandbyCheckBackComplete('none', '')).toBe(true);
    expect(isStandbyCheckBackComplete('one_week', '')).toBe(true);
  });
});

describe('when a save sends the Standby check-back date', () => {
  const { shouldSendStandbyCheckBack } = require('../form-sections/StandbyDetailsSection');
  const original = { standbyCheckBackMode: 'specific', standbyCheckBackDate: '2026-12-10' };

  it('always when entering Standby', () => {
    expect(shouldSendStandbyCheckBack({ enteringStandby: true, original, mode: 'specific', date: '2026-12-10' })).toBe(true);
  });

  it('not on an unrelated save of an event already on Standby', () => {
    expect(shouldSendStandbyCheckBack({ enteringStandby: false, original, mode: 'specific', date: '2026-12-10' })).toBe(false);
    expect(
      shouldSendStandbyCheckBack({ enteringStandby: false, original: { standbyCheckBackMode: 'none', standbyCheckBackDate: '' }, mode: 'none', date: '' })
    ).toBe(false);
  });

  it('when the user changed the date or the choice', () => {
    expect(shouldSendStandbyCheckBack({ enteringStandby: false, original, mode: 'specific', date: '2026-12-20' })).toBe(true);
    expect(shouldSendStandbyCheckBack({ enteringStandby: false, original, mode: 'none', date: '' })).toBe(true);
    expect(shouldSendStandbyCheckBack({ enteringStandby: false, original, mode: 'one_week', date: '' })).toBe(true);
  });
});
