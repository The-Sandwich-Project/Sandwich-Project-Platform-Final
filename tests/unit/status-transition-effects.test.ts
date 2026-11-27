import {
  easternDatePlusDays,
  normalizeIncomingStatus,
  rescheduleMoveFields,
  scheduledDateMoveFields,
  statusTransitionEffects,
} from '../../server/utils/status-transition-effects';

const NOW = new Date('2026-11-30T03:00:00Z'); // Nov 29, 10pm Eastern

describe('status transition side effects', () => {
  it('treats the retired "rescheduled" status as "scheduled"', () => {
    expect(normalizeIncomingStatus('rescheduled')).toBe('scheduled');
    expect(normalizeIncomingStatus('standby')).toBe('standby');
    expect(normalizeIncomingStatus(undefined)).toBeUndefined();
  });

  it('uses the Eastern date for the default check-back (a week out)', () => {
    expect(easternDatePlusDays(NOW, 7).toISOString()).toBe('2026-12-06T12:00:00.000Z');
  });

  it('entering standby sets a check-back date a week out when none was chosen', () => {
    const fx = statusTransitionEffects({ fromStatus: 'in_process', toStatus: 'standby', updates: {}, now: NOW });
    expect(fx.standbyMarkedAt).toEqual(NOW);
    expect((fx.standbyExpectedDate as Date).toISOString()).toBe('2026-12-06T12:00:00.000Z');
  });

  it('keeps the check-back date the request chose, including "no reminder"', () => {
    const chosen = statusTransitionEffects({
      fromStatus: 'scheduled',
      toStatus: 'standby',
      updates: { standbyExpectedDate: new Date('2026-12-15T12:00:00Z') },
      now: NOW,
    });
    expect(chosen.standbyExpectedDate).toBeUndefined();
    const none = statusTransitionEffects({ fromStatus: 'new', toStatus: 'standby', updates: { standbyExpectedDate: null }, now: NOW });
    expect(none.standbyExpectedDate).toBeUndefined();
    expect(none.standbyMarkedAt).toEqual(NOW);
  });

  it('marks a scheduled event that goes back to In Process as needing a new date', () => {
    expect(statusTransitionEffects({ fromStatus: 'scheduled', toStatus: 'in_process', updates: {}, now: NOW }).needsNewDateSince).toEqual(NOW);
    expect(statusTransitionEffects({ fromStatus: 'rescheduled', toStatus: 'in_process', updates: {}, now: NOW }).needsNewDateSince).toEqual(NOW);
  });

  it("doesn't mark a new request moving to In Process", () => {
    expect(statusTransitionEffects({ fromStatus: 'new', toStatus: 'in_process', updates: {}, now: NOW })).not.toHaveProperty('needsNewDateSince');
  });

  it('clears the marker once scheduled again or completed', () => {
    expect(statusTransitionEffects({ fromStatus: 'in_process', toStatus: 'scheduled', updates: {}, now: NOW }).needsNewDateSince).toBeNull();
    expect(statusTransitionEffects({ fromStatus: 'scheduled', toStatus: 'completed', updates: {}, now: NOW }).needsNewDateSince).toBeNull();
  });

  it('does nothing when the status is unchanged', () => {
    expect(statusTransitionEffects({ fromStatus: 'standby', toStatus: 'standby', updates: {}, now: NOW })).toEqual({});
  });
});

describe('admin status endpoint check-back date', () => {
  it('a supplied date or null is kept; the default only applies when omitted', () => {
    const chosen = new Date('2026-12-20T12:00:00Z');
    expect(statusTransitionEffects({ fromStatus: 'in_process', toStatus: 'standby', updates: { standbyExpectedDate: chosen }, now: NOW })).not.toHaveProperty('standbyExpectedDate');
    expect(statusTransitionEffects({ fromStatus: 'in_process', toStatus: 'standby', updates: { standbyExpectedDate: null }, now: NOW })).not.toHaveProperty('standbyExpectedDate');
    expect(statusTransitionEffects({ fromStatus: 'in_process', toStatus: 'standby', updates: {}, now: NOW })).toHaveProperty('standbyExpectedDate');
  });
});

describe('rescheduleMoveFields (old clients sending "rescheduled")', () => {
  const first = new Date('2026-12-05T12:00:00Z');
  it('records the move and keeps the first date', () => {
    expect(rescheduleMoveFields('rescheduled', { scheduledEventDate: first }, {})).toEqual({
      wasPostponed: true,
      originalScheduledDate: first,
    });
  });
  it('never overwrites an existing original date', () => {
    const older = new Date('2026-11-01T12:00:00Z');
    expect(rescheduleMoveFields('rescheduled', { scheduledEventDate: first, originalScheduledDate: older }, {})).toEqual({ wasPostponed: true });
    expect(rescheduleMoveFields('rescheduled', { scheduledEventDate: first }, { originalScheduledDate: older })).toEqual({ wasPostponed: true });
  });
  it('does nothing for other statuses', () => {
    expect(rescheduleMoveFields('scheduled', { scheduledEventDate: first }, {})).toEqual({});
  });
});

describe('scheduledDateMoveFields (a Scheduled event moved to another day, e.g. in Edit)', () => {
  const stored = { status: 'scheduled', scheduledEventDate: new Date('2026-12-05T12:00:00Z'), postponementCount: 0 };
  it('records the move and keeps the first date', () => {
    expect(scheduledDateMoveFields(stored, { scheduledEventDate: '2026-12-12' })).toEqual({
      wasPostponed: true,
      postponementCount: 1,
      originalScheduledDate: stored.scheduledEventDate,
    });
  });
  it('counts further moves without replacing the original date', () => {
    const moved = { ...stored, postponementCount: 1, originalScheduledDate: new Date('2026-11-28T12:00:00Z') };
    expect(scheduledDateMoveFields(moved, { scheduledEventDate: '2026-12-19' })).toEqual({ wasPostponed: true, postponementCount: 2 });
  });
  it('does nothing for the same day, a request that records it itself, unscheduled events, or a move off Scheduled', () => {
    expect(scheduledDateMoveFields(stored, { scheduledEventDate: '2026-12-05' })).toEqual({});
    expect(scheduledDateMoveFields(stored, { scheduledEventDate: '2026-12-12', wasPostponed: true, postponementCount: 1 })).toEqual({});
    expect(scheduledDateMoveFields({ ...stored, status: 'in_process' }, { scheduledEventDate: '2026-12-12' })).toEqual({});
    expect(scheduledDateMoveFields({ ...stored, scheduledEventDate: null }, { scheduledEventDate: '2026-12-12' })).toEqual({});
    expect(scheduledDateMoveFields(stored, { scheduledEventDate: '2026-12-12', status: 'in_process' })).toEqual({});
    expect(scheduledDateMoveFields(stored, { notes: 'x' })).toEqual({});
  });
});
