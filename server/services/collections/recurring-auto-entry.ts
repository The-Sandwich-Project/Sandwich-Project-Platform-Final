/**
 * Recurring automatic collection entries (e.g. Collective Learning's standing
 * 250 PBJ every Wednesday). The rules live in ./recurring-auto-entry-plan.ts;
 * this file reads the current state from the DB and applies the plan.
 */

import { and, asc, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  collectionAutoEntryOverrides,
  hosts,
  sandwichCollections,
} from '@shared/schema';
import { getTodayString } from '@shared/date-utils';
import { QueryOptimizer } from '../../performance/query-optimizer';
import { getSocketInstance } from '../../socket-chat';
import { logger } from '../../utils/production-safe-logger';
import {
  AUTO_ENTRY_SYSTEM_ACTOR,
  AUTO_SUBMISSION_METHOD,
  RECURRING_AUTO_ENTRY_SCHEDULES,
  addDays,
  collectionWeekRange,
  planWeek,
  wednesdayOnOrBefore,
  weeksToReconcile,
  type ExistingAutoEntry,
  type OverrideAction,
  type RecurringAutoEntrySchedule,
  type WeekOverride,
  type WeekPlan,
} from './recurring-auto-entry-plan';

export function getSchedule(key: string): RecurringAutoEntrySchedule | undefined {
  return RECURRING_AUTO_ENTRY_SCHEDULES.find((s) => s.key === key);
}

/** Use the host record's exact name so analytics group it with manual entries. */
async function resolveHostName(schedule: RecurringAutoEntrySchedule): Promise<string> {
  const [host] = await db
    .select({ name: hosts.name })
    .from(hosts)
    .where(ilike(hosts.name, `%${schedule.hostMatch}%`))
    .orderBy(desc(sql`${hosts.status} = 'active'`), asc(hosts.id))
    .limit(1);
  return host?.name ?? schedule.hostName;
}

async function getOverride(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string
): Promise<WeekOverride | null> {
  const [row] = await db
    .select()
    .from(collectionAutoEntryOverrides)
    .where(
      and(
        eq(collectionAutoEntryOverrides.scheduleKey, schedule.key),
        eq(collectionAutoEntryOverrides.weekDate, weekDate)
      )
    )
    .limit(1);
  if (!row) return null;
  return { action: row.action as OverrideAction, count: row.count };
}

function hostMatches(schedule: RecurringAutoEntrySchedule) {
  const pattern = `%${schedule.hostMatch}%`;
  return or(
    ilike(sandwichCollections.hostName, pattern),
    ilike(sandwichCollections.group1Name, pattern),
    ilike(sandwichCollections.group2Name, pattern),
    sql`${sandwichCollections.groupCollections}::text ILIKE ${pattern}`
  );
}

/** Live, manually entered collections for the host in that Wed→Tue week. */
async function countManualEntries(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string
): Promise<number> {
  const { start, end } = collectionWeekRange(weekDate);
  const rows = await db
    .select({ id: sandwichCollections.id })
    .from(sandwichCollections)
    .where(
      and(
        gte(sandwichCollections.collectionDate, start),
        lte(sandwichCollections.collectionDate, end),
        isNull(sandwichCollections.deletedAt),
        or(
          isNull(sandwichCollections.submissionMethod),
          ne(sandwichCollections.submissionMethod, AUTO_SUBMISSION_METHOD)
        ),
        hostMatches(schedule)
      )
    );
  return rows.length;
}

/** The auto entry for that week, including soft-deleted ones. */
async function getAutoEntry(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string
): Promise<ExistingAutoEntry | null> {
  const [row] = await db
    .select({
      id: sandwichCollections.id,
      count: sandwichCollections.individualSandwiches,
      deletedAt: sandwichCollections.deletedAt,
      deletedBy: sandwichCollections.deletedBy,
    })
    .from(sandwichCollections)
    .where(
      and(
        eq(sandwichCollections.collectionDate, weekDate),
        eq(sandwichCollections.submissionMethod, AUTO_SUBMISSION_METHOD),
        ilike(sandwichCollections.hostName, `%${schedule.hostMatch}%`)
      )
    )
    // Prefer a live entry if somehow there are several
    .orderBy(sql`${sandwichCollections.deletedAt} IS NOT NULL`, asc(sandwichCollections.id))
    .limit(1);
  return row ?? null;
}

async function applyPlan(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string,
  plan: WeekPlan
): Promise<number | null> {
  switch (plan.kind) {
    case 'noop':
      return null;
    case 'create': {
      const [created] = await db
        .insert(sandwichCollections)
        .values({
          collectionDate: weekDate,
          hostName: await resolveHostName(schedule),
          individualSandwiches: plan.count,
          individualPbj: plan.count,
          groupCollections: [],
          createdBy: AUTO_ENTRY_SYSTEM_ACTOR,
          createdByName: 'Automatic weekly entry',
          submissionMethod: AUTO_SUBMISSION_METHOD,
        })
        .returning({ id: sandwichCollections.id });
      return created.id;
    }
    case 'update':
    case 'restore':
      await db
        .update(sandwichCollections)
        .set({
          individualSandwiches: plan.count,
          individualPbj: plan.count,
          deletedAt: null,
          deletedBy: null,
        })
        .where(eq(sandwichCollections.id, plan.id));
      return plan.id;
    case 'remove':
      await db
        .update(sandwichCollections)
        .set({ deletedAt: new Date(), deletedBy: AUTO_ENTRY_SYSTEM_ACTOR })
        .where(eq(sandwichCollections.id, plan.id));
      return plan.id;
  }
}

function broadcastChange(collectionId: number, plan: WeekPlan) {
  QueryOptimizer.invalidateCache('sandwich-collections');
  QueryOptimizer.invalidateCache('sandwich-collections-stats');
  try {
    getSocketInstance()?.emit('collections:updated', {
      collectionId,
      trigger: plan.kind === 'create' ? 'create' : 'update',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[AutoEntry] Failed to emit socket event:', error);
  }
}

export async function reconcileWeek(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string,
  today: string = getTodayString()
): Promise<WeekPlan> {
  const [override, manualCount, autoEntry] = await Promise.all([
    getOverride(schedule, weekDate),
    countManualEntries(schedule, weekDate),
    getAutoEntry(schedule, weekDate),
  ]);
  const plan = planWeek({
    weekDate,
    today,
    schedule,
    override,
    manualEntryExists: manualCount > 0,
    autoEntry,
  });
  const changedId = await applyPlan(schedule, weekDate, plan);
  if (changedId !== null) {
    logger.log(`[AutoEntry] ${schedule.key} ${weekDate}: ${plan.kind}`, plan);
    broadcastChange(changedId, plan);
  }
  return plan;
}

/** Nightly job entry point: reconcile this week and last week for every schedule. */
export async function reconcileRecurringAutoEntries(
  today: string = getTodayString()
): Promise<Array<{ schedule: string; weekDate: string; plan: WeekPlan }>> {
  const results = [];
  for (const schedule of RECURRING_AUTO_ENTRY_SCHEDULES) {
    for (const weekDate of weeksToReconcile(today, schedule)) {
      const plan = await reconcileWeek(schedule, weekDate, today);
      results.push({ schedule: schedule.key, weekDate, plan });
    }
  }
  return results;
}

export interface AutoEntryWeekStatus {
  weekDate: string;
  override: WeekOverride | null;
  autoEntry: { id: number; count: number; deleted: boolean } | null;
  manualEntryCount: number;
  isFuture: boolean;
  beforeStart: boolean;
}

export async function getWeekStatus(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string,
  today: string = getTodayString()
): Promise<AutoEntryWeekStatus> {
  const [override, manualEntryCount, autoEntry] = await Promise.all([
    getOverride(schedule, weekDate),
    countManualEntries(schedule, weekDate),
    getAutoEntry(schedule, weekDate),
  ]);
  return {
    weekDate,
    override,
    autoEntry: autoEntry
      ? { id: autoEntry.id, count: autoEntry.count, deleted: !!autoEntry.deletedAt }
      : null,
    manualEntryCount,
    isFuture: weekDate > today,
    beforeStart: weekDate < schedule.startWeek,
  };
}

/** Recent and upcoming weeks for the override UI, newest first. */
export async function listWeekStatuses(
  schedule: RecurringAutoEntrySchedule,
  { weeksBack = 4, weeksAhead = 4 } = {},
  today: string = getTodayString()
): Promise<AutoEntryWeekStatus[]> {
  const current = wednesdayOnOrBefore(today);
  const weeks: string[] = [];
  for (let i = weeksAhead; i >= -weeksBack; i--) {
    weeks.push(addDays(current, i * 7));
  }
  return Promise.all(weeks.map((week) => getWeekStatus(schedule, week, today)));
}

export async function setWeekOverride(
  schedule: RecurringAutoEntrySchedule,
  weekDate: string,
  override: WeekOverride | null,
  user: { id?: string; name?: string }
): Promise<void> {
  if (!override) {
    await db
      .delete(collectionAutoEntryOverrides)
      .where(
        and(
          eq(collectionAutoEntryOverrides.scheduleKey, schedule.key),
          eq(collectionAutoEntryOverrides.weekDate, weekDate)
        )
      );
    return;
  }
  const values = {
    action: override.action,
    count: override.action === 'count' ? override.count : null,
    updatedBy: user.id ?? null,
    updatedByName: user.name ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(collectionAutoEntryOverrides)
    .values({ scheduleKey: schedule.key, weekDate, ...values })
    .onConflictDoUpdate({
      target: [
        collectionAutoEntryOverrides.scheduleKey,
        collectionAutoEntryOverrides.weekDate,
      ],
      set: values,
    });
}
