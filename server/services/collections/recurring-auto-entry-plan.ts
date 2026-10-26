/**
 * Pure planning logic for recurring automatic collection entries.
 *
 * A recurring entry (e.g. Collective Learning's standing 250 PBJ) is recorded
 * once per collection week, dated that week's Wednesday. Each run compares
 * what *should* be in the log for a week against what *is* there and returns
 * one action. Keeping this free of DB access lets it be unit tested and lets
 * the cron job and the override API share the exact same rules.
 *
 * Rules, in order:
 *  - Weeks before the schedule's start date, or whose Wednesday hasn't
 *    arrived yet, are left alone.
 *  - A manually entered collection for the host that week wins: the auto
 *    entry is not created (and is removed if it already exists).
 *  - Otherwise the override decides: 'skip' → no entry, 'count' → that
 *    number, no override → the schedule's default count.
 *  - If a person deleted the auto entry, it stays deleted unless they later
 *    set an explicit count override for that week.
 */

export const AUTO_SUBMISSION_METHOD = 'automatic';
// deletedBy marker for auto entries removed by reconciliation (vs. by a person)
export const AUTO_ENTRY_SYSTEM_ACTOR = 'system:auto-entry';

export interface RecurringAutoEntrySchedule {
  key: string;
  /** Fallback host name if no matching host record is found */
  hostName: string;
  /** Case-insensitive fragment used to match host records and existing entries */
  hostMatch: string;
  defaultPbjCount: number;
  /** First Wednesday (YYYY-MM-DD) this schedule records */
  startWeek: string;
}

export const COLLECTIVE_LEARNING_SCHEDULE: RecurringAutoEntrySchedule = {
  key: 'collective-learning',
  hostName: 'Collective Learning',
  hostMatch: 'collective learning',
  defaultPbjCount: 250,
  startWeek: '2026-10-28',
};

export const RECURRING_AUTO_ENTRY_SCHEDULES = [COLLECTIVE_LEARNING_SCHEDULE];

export type OverrideAction = 'skip' | 'count';

export interface WeekOverride {
  action: OverrideAction;
  count: number | null;
}

export interface ExistingAutoEntry {
  id: number;
  count: number;
  deletedAt: Date | string | null;
  deletedBy: string | null;
}

export interface PlanInput {
  weekDate: string;
  today: string;
  schedule: RecurringAutoEntrySchedule;
  override: WeekOverride | null;
  manualEntryExists: boolean;
  autoEntry: ExistingAutoEntry | null;
}

export type WeekPlan =
  | { kind: 'create'; count: number }
  | { kind: 'update'; id: number; count: number }
  | { kind: 'restore'; id: number; count: number }
  | { kind: 'remove'; id: number }
  | { kind: 'noop'; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(dateString: string): Date {
  if (!DATE_RE.test(dateString)) {
    throw new Error(`Expected YYYY-MM-DD date, got "${dateString}"`);
  }
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateString: string, days: number): string {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export function isWednesday(dateString: string): boolean {
  return DATE_RE.test(dateString) && toUtcDate(dateString).getUTCDay() === 3;
}

/** The Wednesday on or before a YYYY-MM-DD date (collection weeks run Wed→Tue). */
export function wednesdayOnOrBefore(dateString: string): string {
  const day = toUtcDate(dateString).getUTCDay();
  return addDays(dateString, -((day - 3 + 7) % 7));
}

/** Inclusive Wed→Tue date range for the collection week starting on weekDate. */
export function collectionWeekRange(weekDate: string): {
  start: string;
  end: string;
} {
  return { start: weekDate, end: addDays(weekDate, 6) };
}

/**
 * Weeks the nightly job reconciles: this week and last week (so a missed run
 * or a late manual entry still gets picked up), never before the start week.
 */
export function weeksToReconcile(
  today: string,
  schedule: RecurringAutoEntrySchedule
): string[] {
  const current = wednesdayOnOrBefore(today);
  return [addDays(current, -7), current].filter(
    (week) => week >= schedule.startWeek
  );
}

export function targetCount(
  schedule: RecurringAutoEntrySchedule,
  override: WeekOverride | null
): number {
  if (!override) return schedule.defaultPbjCount;
  if (override.action === 'skip') return 0;
  return Math.max(0, override.count ?? 0);
}

export function planWeek(input: PlanInput): WeekPlan {
  const { weekDate, today, schedule, override, manualEntryExists, autoEntry } =
    input;

  if (weekDate < schedule.startWeek) {
    return { kind: 'noop', reason: 'before schedule start' };
  }
  if (weekDate > today) {
    return { kind: 'noop', reason: 'collection day has not happened yet' };
  }

  const target = manualEntryExists ? 0 : targetCount(schedule, override);

  if (!autoEntry) {
    if (target > 0) return { kind: 'create', count: target };
    return {
      kind: 'noop',
      reason: manualEntryExists ? 'manual entry exists' : 'skipped this week',
    };
  }

  if (!autoEntry.deletedAt) {
    if (target === 0) return { kind: 'remove', id: autoEntry.id };
    if (autoEntry.count !== target) {
      return { kind: 'update', id: autoEntry.id, count: target };
    }
    return { kind: 'noop', reason: 'already recorded' };
  }

  // Auto entry exists but was soft-deleted
  if (target === 0) return { kind: 'noop', reason: 'already removed' };
  const removedByPerson = autoEntry.deletedBy !== AUTO_ENTRY_SYSTEM_ACTOR;
  if (removedByPerson && override?.action !== 'count') {
    return { kind: 'noop', reason: 'auto entry was deleted by a person' };
  }
  return { kind: 'restore', id: autoEntry.id, count: target };
}
