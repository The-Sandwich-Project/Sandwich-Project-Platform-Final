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
