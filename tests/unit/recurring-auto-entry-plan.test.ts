/**
 * Tests for the recurring automatic collection entry rules (Collective
 * Learning's standing 250 PBJ every Wednesday). The planner is pure, so the
 * create / skip / override / no-double-count behavior is covered without a DB.
 */

import { describe, it, expect } from '@jest/globals';
import {
  AUTO_ENTRY_SYSTEM_ACTOR,
  COLLECTIVE_LEARNING_SCHEDULE,
  addDays,
  collectionWeekRange,
  isWednesday,
  planWeek,
  targetCount,
  wednesdayOnOrBefore,
  weeksToReconcile,
  type PlanInput,
} from '../../server/services/collections/recurring-auto-entry-plan';

const schedule = { ...COLLECTIVE_LEARNING_SCHEDULE, startWeek: '2026-10-28' };
const WED = '2026-11-04';

function plan(overrides: Partial<PlanInput> = {}) {
  return planWeek({
    weekDate: WED,
    today: '2026-11-04',
    schedule,
    override: null,
    manualEntryExists: false,
    autoEntry: null,
    ...overrides,
  });
}

describe('date helpers', () => {
  it('finds the Wednesday on or before any day of the Wed→Tue week', () => {
    expect(wednesdayOnOrBefore('2026-11-04')).toBe('2026-11-04'); // Wed
    expect(wednesdayOnOrBefore('2026-11-05')).toBe('2026-11-04'); // Thu
    expect(wednesdayOnOrBefore('2026-11-08')).toBe('2026-11-04'); // Sun
    expect(wednesdayOnOrBefore('2026-11-10')).toBe('2026-11-04'); // Tue
    expect(wednesdayOnOrBefore('2026-11-03')).toBe('2026-10-28'); // Tue before
  });

  it('handles month and year boundaries', () => {
    expect(addDays('2026-12-30', 6)).toBe('2027-01-05');
    expect(wednesdayOnOrBefore('2027-01-01')).toBe('2026-12-30');
  });

  it('validates Wednesdays', () => {
    expect(isWednesday('2026-11-04')).toBe(true);
    expect(isWednesday('2026-11-05')).toBe(false);
    expect(isWednesday('11/04/2026')).toBe(false);
  });

  it('covers Wednesday through the following Tuesday', () => {
    expect(collectionWeekRange(WED)).toEqual({ start: '2026-11-04', end: '2026-11-10' });
  });

  it('reconciles this week and last week, but not before the start week', () => {
    expect(weeksToReconcile('2026-11-06', schedule)).toEqual(['2026-10-28', '2026-11-04']);
    expect(weeksToReconcile('2026-10-29', schedule)).toEqual(['2026-10-28']);
    expect(weeksToReconcile('2026-10-26', schedule)).toEqual([]);
  });
});

describe('targetCount', () => {
  it('defaults to 250 PBJ', () => {
    expect(targetCount(schedule, null)).toBe(250);
  });
  it('is 0 when skipped and the override count otherwise', () => {
    expect(targetCount(schedule, { action: 'skip', count: null })).toBe(0);
    expect(targetCount(schedule, { action: 'count', count: 180 })).toBe(180);
  });
});

describe('planWeek', () => {
  it('creates the default 250 entry when nothing is recorded', () => {
    expect(plan()).toEqual({ kind: 'create', count: 250 });
  });

  it('records the override count instead of 250', () => {
    expect(plan({ override: { action: 'count', count: 300 } })).toEqual({
      kind: 'create',
      count: 300,
    });
  });

  it('records nothing when they did not collect', () => {
    expect(plan({ override: { action: 'skip', count: null } }).kind).toBe('noop');
  });

  it('treats a count override of 0 like a skip', () => {
    expect(plan({ override: { action: 'count', count: 0 } }).kind).toBe('noop');
  });

  it('does not double-count when a manual entry exists that week', () => {
    expect(plan({ manualEntryExists: true })).toEqual({
      kind: 'noop',
      reason: 'manual entry exists',
    });
  });

  it('removes its own entry if a manual entry shows up later', () => {
    expect(
      plan({
        manualEntryExists: true,
        autoEntry: { id: 7, count: 250, deletedAt: null, deletedBy: null },
      })
    ).toEqual({ kind: 'remove', id: 7 });
  });

  it('does not create a second auto entry', () => {
    expect(
      plan({ autoEntry: { id: 7, count: 250, deletedAt: null, deletedBy: null } })
    ).toEqual({ kind: 'noop', reason: 'already recorded' });
  });

  it('updates an existing auto entry when an override is set afterwards', () => {
    expect(
      plan({
        override: { action: 'count', count: 200 },
        autoEntry: { id: 7, count: 250, deletedAt: null, deletedBy: null },
      })
    ).toEqual({ kind: 'update', id: 7, count: 200 });
  });

  it('removes an existing auto entry when "didn\'t collect" is set afterwards', () => {
    expect(
      plan({
        override: { action: 'skip', count: null },
        autoEntry: { id: 7, count: 250, deletedAt: null, deletedBy: null },
      })
    ).toEqual({ kind: 'remove', id: 7 });
  });

  it('restores an entry it removed when the skip is cleared', () => {
    expect(
      plan({
        autoEntry: {
          id: 7,
          count: 250,
          deletedAt: new Date(),
          deletedBy: AUTO_ENTRY_SYSTEM_ACTOR,
        },
      })
    ).toEqual({ kind: 'restore', id: 7, count: 250 });
  });

  it('leaves an entry deleted by a person alone', () => {
    expect(
      plan({
        autoEntry: { id: 7, count: 250, deletedAt: new Date(), deletedBy: 'user-1' },
      }).kind
    ).toBe('noop');
  });

  it('restores a person-deleted entry only for an explicit count override', () => {
    expect(
      plan({
        override: { action: 'count', count: 120 },
        autoEntry: { id: 7, count: 250, deletedAt: new Date(), deletedBy: 'user-1' },
      })
    ).toEqual({ kind: 'restore', id: 7, count: 120 });
  });

  it('never records ahead of the collection day', () => {
    expect(plan({ today: '2026-11-03' })).toEqual({
      kind: 'noop',
      reason: 'collection day has not happened yet',
    });
  });

  it('never records before the schedule start', () => {
    expect(plan({ weekDate: '2026-10-21', today: '2026-11-04' }).kind).toBe('noop');
  });
});
