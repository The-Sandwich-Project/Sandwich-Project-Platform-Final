/**
 * Collective Learning weekly auto-log.
 *
 * Collective Learning makes a standing batch of PB&J sandwiches every week
 * but doesn't submit a log, so we record it for them: one collection entry
 * per Wed–Tue collection week (dated the Wednesday), all PBJ.
 *
 * Per-week overrides (recurring_collection_overrides) handle the exceptions:
 *   - skipped = true  → they didn't collect; no entry (an existing auto entry
 *                        is soft-deleted)
 *   - count = N       → they collected N instead of the default
 *
 * The auto entry also stands down when:
 *   - someone logged a real Collective Learning entry that week
 *   - it's a holiday week we never collect on (see utils/excluded-weeks),
 *     unless an override gives an explicit count
 *
 * reconcileWeek() is the single place that makes the DB match those rules.
 * The daily cron calls it for the current week, and the override endpoints
 * call it for whichever week was changed, so overrides entered after the
 * fact fix the existing entry instead of leaving a stale 250 behind.
 */
import { and, desc, eq, gte, ilike, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from '../../db';
import {
  appSettings,
  sandwichCollections,
  recurringCollectionOverrides,
  COLLECTIVE_LEARNING_AUTO_LOG_KEY,
  AUTO_RECURRING_SUBMISSION_METHOD,
  type RecurringCollectionOverride,
} from '@shared/schema';
import { isInExcludedWeek } from '../../utils/excluded-weeks';
import { QueryOptimizer } from '../../performance/query-optimizer';
import { getSocketInstance } from '../../socket-chat';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('collective-learning-auto-log');

const SYSTEM_USER_ID = 'system:auto-log';
const SYSTEM_USER_NAME = 'Auto-log (weekly standing count)';

export interface AutoLogConfig {
  enabled: boolean;
  hostName: string;
  defaultCount: number;
}

export const DEFAULT_AUTO_LOG_CONFIG: AutoLogConfig = {
  enabled: true,
  hostName: 'Collective Learning',
  defaultCount: 250,
};

export type ReconcileOutcome =
  | 'created'
  | 'updated'
  | 'restored'
  | 'removed'
  | 'unchanged'
  | 'skipped_disabled'
  | 'skipped_future'
  | 'skipped_override'
  | 'skipped_holiday'
  | 'skipped_manual_entry';

export interface ReconcileResult {
  weekOf: string;
  outcome: ReconcileOutcome;
  count: number | null;
  collectionId: number | null;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Date helpers — all in Eastern time, all as YYYY-MM-DD strings
// ---------------------------------------------------------------------------

export function todayInEastern(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** The Wednesday that starts the Wed–Tue collection week containing dateStr. */
export function wednesdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 3 = Wednesday
  return addDays(dateStr, -((dow + 4) % 7));
}

export function isValidDateStr(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getAutoLogConfig(): Promise<AutoLogConfig> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, COLLECTIVE_LEARNING_AUTO_LOG_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_AUTO_LOG_CONFIG };
  try {
    const parsed = JSON.parse(row.value);
    return {
      enabled:
        typeof parsed.enabled === 'boolean'
          ? parsed.enabled
          : DEFAULT_AUTO_LOG_CONFIG.enabled,
      hostName:
        typeof parsed.hostName === 'string' && parsed.hostName.trim()
          ? parsed.hostName.trim()
          : DEFAULT_AUTO_LOG_CONFIG.hostName,
      defaultCount:
        Number.isInteger(parsed.defaultCount) && parsed.defaultCount >= 0
          ? parsed.defaultCount
          : DEFAULT_AUTO_LOG_CONFIG.defaultCount,
    };
  } catch {
    log.warn('Invalid auto-log config JSON; using defaults');
    return { ...DEFAULT_AUTO_LOG_CONFIG };
  }
}

export async function saveAutoLogConfig(
  config: AutoLogConfig,
  userId: string | null
): Promise<AutoLogConfig> {
  const value = JSON.stringify(config);
  await db
    .insert(appSettings)
    .values({
      key: COLLECTIVE_LEARNING_AUTO_LOG_KEY,
      value,
      description:
        'Weekly auto-logged Collective Learning PBJ collection (enabled, hostName, defaultCount)',
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date(), updatedBy: userId },
    });
  return config;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export async function getOverride(
  weekOf: string
): Promise<RecurringCollectionOverride | undefined> {
  const [row] = await db
    .select()
    .from(recurringCollectionOverrides)
    .where(
      and(
        eq(recurringCollectionOverrides.ruleKey, COLLECTIVE_LEARNING_AUTO_LOG_KEY),
        eq(recurringCollectionOverrides.weekOf, weekOf)
      )
    )
    .limit(1);
  return row;
}

export async function listOverrides(): Promise<RecurringCollectionOverride[]> {
  return db
    .select()
    .from(recurringCollectionOverrides)
    .where(eq(recurringCollectionOverrides.ruleKey, COLLECTIVE_LEARNING_AUTO_LOG_KEY))
    .orderBy(recurringCollectionOverrides.weekOf);
}

export async function upsertOverride(input: {
  weekOf: string;
  skipped: boolean;
  count: number | null;
  note: string | null;
  userId: string | null;
  userName: string | null;
}): Promise<RecurringCollectionOverride> {
  const values = {
    skipped: input.skipped,
    count: input.skipped ? null : input.count,
    note: input.note,
    createdBy: input.userId,
    createdByName: input.userName,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(recurringCollectionOverrides)
    .values({
      ruleKey: COLLECTIVE_LEARNING_AUTO_LOG_KEY,
      weekOf: input.weekOf,
      ...values,
    })
    .onConflictDoUpdate({
      target: [recurringCollectionOverrides.ruleKey, recurringCollectionOverrides.weekOf],
      set: values,
    })
    .returning();
  return row;
}

export async function deleteOverride(weekOf: string): Promise<boolean> {
  const rows = await db
    .delete(recurringCollectionOverrides)
    .where(
      and(
        eq(recurringCollectionOverrides.ruleKey, COLLECTIVE_LEARNING_AUTO_LOG_KEY),
        eq(recurringCollectionOverrides.weekOf, weekOf)
      )
    )
    .returning({ id: recurringCollectionOverrides.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

function notifyCollectionsChanged(collectionId: number, trigger: string) {
  QueryOptimizer.invalidateCache('sandwich-collections');
  QueryOptimizer.invalidateCache('sandwich-collections-stats');
  try {
    getSocketInstance()?.emit('collections:updated', {
      collectionId,
      trigger,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.warn('Failed to emit collections:updated', { error });
  }
}

/**
 * Make the DB match the rules for one collection week.
 * @param weekOf any date in the week; normalized to its Wednesday
 */
export async function reconcileWeek(
  weekOfInput: string,
  opts: { today?: string } = {}
): Promise<ReconcileResult> {
  const weekOf = wednesdayOf(weekOfInput);
  const weekEnd = addDays(weekOf, 6);
  const today = opts.today ?? todayInEastern();
  const config = await getAutoLogConfig();

  const base = { weekOf, count: null, collectionId: null } as const;

  // Disabled: leave existing entries alone, create nothing new.
  if (!config.enabled) return { ...base, outcome: 'skipped_disabled' };

  // Never pre-record a week that hasn't started yet.
  if (weekOf > today) return { ...base, outcome: 'skipped_future' };

  const override = await getOverride(weekOf);
  const holiday = isInExcludedWeek(weekOf);

  const [autoRow] = await db
    .select()
    .from(sandwichCollections)
    .where(
      and(
        eq(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD),
        eq(sandwichCollections.hostName, config.hostName),
        eq(sandwichCollections.collectionDate, weekOf)
      )
    )
    .limit(1);

  // A real (non-auto) log for this host this week means someone entered the
  // actual number — that beats our standing estimate.
  const [manualRow] = await db
    .select({ id: sandwichCollections.id })
    .from(sandwichCollections)
    .where(
      and(
        ilike(sandwichCollections.hostName, `%${config.hostName}%`),
        gte(sandwichCollections.collectionDate, weekOf),
        lte(sandwichCollections.collectionDate, weekEnd),
        isNull(sandwichCollections.deletedAt),
        or(
          isNull(sandwichCollections.submissionMethod),
          ne(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD)
        )
      )
    )
    .limit(1);

  let standDown: ReconcileOutcome | null = null;
  let desiredCount = config.defaultCount;
  if (manualRow) {
    standDown = 'skipped_manual_entry';
  } else if (override?.skipped) {
    standDown = 'skipped_override';
  } else if (override?.count != null) {
    desiredCount = override.count;
  } else if (holiday.excluded) {
    standDown = 'skipped_holiday';
  }

  if (standDown) {
    if (autoRow && !autoRow.deletedAt) {
      await db
        .update(sandwichCollections)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(eq(sandwichCollections.id, autoRow.id));
      notifyCollectionsChanged(autoRow.id, 'delete');
      log.info(`Removed auto entry ${autoRow.id} for week of ${weekOf} (${standDown})`);
      return {
        ...base,
        outcome: 'removed',
        collectionId: autoRow.id,
        detail: standDown,
      };
    }
    return {
      ...base,
      outcome: standDown,
      detail: holiday.excluded ? holiday.reason : undefined,
    };
  }

  const countFields = {
    individualSandwiches: desiredCount,
    individualPbj: desiredCount,
  };

  if (autoRow) {
    const wasDeleted = !!autoRow.deletedAt;
    const countChanged =
      autoRow.individualSandwiches !== desiredCount ||
      autoRow.individualPbj !== desiredCount;
    if (!wasDeleted && !countChanged) {
      return { ...base, outcome: 'unchanged', count: desiredCount, collectionId: autoRow.id };
    }
    await db
      .update(sandwichCollections)
      .set({ ...countFields, deletedAt: null, deletedBy: null })
      .where(eq(sandwichCollections.id, autoRow.id));
    notifyCollectionsChanged(autoRow.id, wasDeleted ? 'restore' : 'update');
    log.info(
      `${wasDeleted ? 'Restored' : 'Updated'} auto entry ${autoRow.id} for week of ${weekOf} → ${desiredCount}`
    );
    return {
      ...base,
      outcome: wasDeleted ? 'restored' : 'updated',
      count: desiredCount,
      collectionId: autoRow.id,
    };
  }

  // onConflictDoNothing backs up the unique partial index: if another server
  // instance inserted the same week a moment ago, this quietly does nothing.
  const [created] = await db
    .insert(sandwichCollections)
    .values({
      collectionDate: weekOf,
      hostName: config.hostName,
      ...countFields,
      groupCollections: [],
      createdBy: SYSTEM_USER_ID,
      createdByName: SYSTEM_USER_NAME,
      submissionMethod: AUTO_RECURRING_SUBMISSION_METHOD,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    return { ...base, outcome: 'unchanged', count: desiredCount, detail: 'inserted concurrently' };
  }
  notifyCollectionsChanged(created.id, 'create');
  log.info(`Created auto entry ${created.id} for week of ${weekOf} → ${desiredCount}`);
  return { ...base, outcome: 'created', count: desiredCount, collectionId: created.id };
}

/** Cron entry point: reconcile the current collection week. */
export async function runCollectiveLearningAutoLog(): Promise<ReconcileResult> {
  return reconcileWeek(todayInEastern());
}

/** Status for the UI: config, current week's outcome preview, recent auto entries, overrides. */
export async function getAutoLogStatus() {
  const config = await getAutoLogConfig();
  const today = todayInEastern();
  const currentWeekOf = wednesdayOf(today);
  const [overrides, recentAutoEntries] = await Promise.all([
    listOverrides(),
    db
      .select({
        id: sandwichCollections.id,
        collectionDate: sandwichCollections.collectionDate,
        individualSandwiches: sandwichCollections.individualSandwiches,
        deletedAt: sandwichCollections.deletedAt,
      })
      .from(sandwichCollections)
      .where(eq(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD))
      .orderBy(desc(sandwichCollections.collectionDate))
      .limit(8),
  ]);
  return {
    config,
    today,
    currentWeekOf,
    currentWeekHoliday: isInExcludedWeek(currentWeekOf),
    overrides,
    recentAutoEntries,
  };
}
