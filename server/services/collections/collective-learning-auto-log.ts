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
// Stable identity for this rule's auto entries. Lookups and the unique index
// key on this + collection_date (not host_name), so editing the configured
// host name updates the existing row instead of logging a second one.
const AUTO_ROW_CREATED_BY = `${SYSTEM_USER_ID}:${COLLECTIVE_LEARNING_AUTO_LOG_KEY}`;
// How many past weeks the daily run re-checks, so a real log entered late
// (after its week's last run) still knocks out the auto estimate.
export const LOOKBACK_WEEKS = 8;
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

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
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
 * Holiday weeks can straddle a year boundary (Wed Dec 30 – Tue Jan 5), and
 * isInExcludedWeek only looks at its argument's calendar year, so check both
 * ends of the week.
 */
function holidayFor(weekOf: string): { excluded: boolean; reason?: string } {
  const start = isInExcludedWeek(weekOf);
  return start.excluded ? start : isInExcludedWeek(addDays(weekOf, 6));
}

/**
 * WHERE clause for reconcile's writes: the row must still be an auto entry.
 * If someone edited it in the Collections log meanwhile (converting it to a
 * regular entry), the write matches nothing and reconcile re-reads the week
 * instead of overwriting their numbers.
 */
function stillAutoRow(id: number) {
  return and(
    eq(sandwichCollections.id, id),
    eq(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD)
  );
}

function overrideFingerprint(o: RecurringCollectionOverride | undefined): string {
  return o ? `${o.id}:${new Date(o.updatedAt).getTime()}` : 'none';
}

/**
 * Make the DB match the rules for one collection week.
 * @param weekOf any date in the week; normalized to its Wednesday
 */
export async function reconcileWeek(
  weekOfInput: string,
  opts: {
    today?: string;
    // false = only correct an existing auto entry, never create/restore one
    // (used for the daily look-back over past weeks)
    allowCreate?: boolean;
  } = {}
): Promise<ReconcileResult> {
  const first = await reconcileWeekOnce(weekOfInput, opts);
  let result = first;
  // Neon's HTTP driver has no transactions, so an override saved (or a log
  // edit made) while this run was in flight could be overwritten by a write
  // based on stale state. If either happened, run once more on fresh state;
  // the override endpoint also reconciles after saving, so both converge.
  if (
    first.raced ||
    (first.overrideSeen !== undefined &&
      overrideFingerprint(await getOverride(first.weekOf)) !== first.overrideSeen)
  ) {
    result = await reconcileWeekOnce(weekOfInput, opts);
  }
  const { overrideSeen: _ignored, raced: _raced, ...publicResult } = result;

  // Same idea for the on/off switch: if an admin turned the auto-log off
  // while this run was in flight, undo any entry either pass created/restored.
  const touched = [first, result]
    .filter((r) => (r.outcome === 'created' || r.outcome === 'restored') && r.collectionId != null)
    .map((r) => r.collectionId as number);
  if (touched.length > 0 && !(await getAutoLogConfig()).enabled) {
    for (const id of new Set(touched)) {
      const undone = await db
        .update(sandwichCollections)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(stillAutoRow(id))
        .returning({ id: sandwichCollections.id });
      if (undone.length > 0) {
        notifyCollectionsChanged(id, 'delete');
        log.info(`Auto-log was disabled mid-run; removed entry ${id}`);
      }
    }
    return { ...publicResult, outcome: 'skipped_disabled', count: null, collectionId: null };
  }
  return publicResult;
}

/**
 * Total sandwiches on a collection row, same formula as the rest of the app:
 * individual + sum(groupCollections[].count), falling back to the legacy
 * group1Count + group2Count columns.
 */
function collectionTotal(row: {
  individualSandwiches: number | null;
  groupCollections: unknown;
  group1Count: number | null;
  group2Count: number | null;
}): number {
  const groups =
    Array.isArray(row.groupCollections) && row.groupCollections.length > 0
      ? (row.groupCollections as Array<{ count?: number }>).reduce((sum, g) => sum + (g.count || 0), 0)
      : (row.group1Count || 0) + (row.group2Count || 0);
  return (row.individualSandwiches || 0) + groups;
}

/**
 * A real log for this host in the given week: any live, non-auto entry whose
 * host matches the configured name, or that started as one of our auto
 * entries and was converted by a hand edit (matched by its stable createdBy,
 * so renaming either the entry's host or the configured host can't hide it).
 */
async function findManualEntry(config: AutoLogConfig, weekOf: string) {
  const [row] = await db
    .select({
      id: sandwichCollections.id,
      individualSandwiches: sandwichCollections.individualSandwiches,
      groupCollections: sandwichCollections.groupCollections,
      group1Count: sandwichCollections.group1Count,
      group2Count: sandwichCollections.group2Count,
    })
    .from(sandwichCollections)
    .where(
      and(
        or(
          ilike(sandwichCollections.hostName, `%${config.hostName}%`),
          eq(sandwichCollections.createdBy, AUTO_ROW_CREATED_BY)
        ),
        gte(sandwichCollections.collectionDate, weekOf),
        lte(sandwichCollections.collectionDate, addDays(weekOf, 6)),
        isNull(sandwichCollections.deletedAt),
        or(
          isNull(sandwichCollections.submissionMethod),
          ne(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD)
        )
      )
    )
    .limit(1);
  return row;
}

function isAutoLogRow(row: { createdBy: string | null } | undefined): boolean {
  return !!row && row.createdBy === AUTO_ROW_CREATED_BY;
}

/**
 * Called by the storage layer *before* any hand edit to a collection (the
 * Collections log editor, bulk tools, version-control restore, ...). Once a
 * person edits one of our auto entries, it stops being an estimate: it's
 * converted to a regular log entry, which reconcile already treats as the
 * real count for its week (so the edited numbers, sandwich-type breakdown
 * and date are kept as-is). If the edit moves it to a different week, the
 * week it left is marked "didn't collect" so the estimate doesn't come back.
 * Reconcile itself writes through `db` directly, so it never hits this.
 */
export async function prepareAutoEntryEdit<T extends Record<string, unknown>>(
  collectionId: number,
  updates: T,
  userId?: string | null
): Promise<{ updates: T; afterSave?: () => Promise<void> }> {
  const [row] = await db
    .select()
    .from(sandwichCollections)
    .where(eq(sandwichCollections.id, collectionId))
    .limit(1);
  if (!isAutoLogRow(row)) return { updates };
  // The "didn't collect" for the week it left is saved only once the edit
  // itself has succeeded (afterSave), so a failed edit leaves nothing behind.
  const newDate = updates.collectionDate;
  const afterSave =
    isValidDateStr(newDate) && wednesdayOf(newDate) !== wednesdayOf(row.collectionDate)
      ? async () => {
          await upsertOverride({
            weekOf: wednesdayOf(row.collectionDate),
            skipped: true,
            count: null,
            note: `Moved to week of ${wednesdayOf(newDate)} in Collections log`,
            userId: userId ?? null,
            userName: null,
          });
        }
      : undefined;
  // Already converted by an earlier edit: just the move handling above. A
  // full-row payload (e.g. restoring an older version from version control)
  // can still carry submissionMethod 'auto_recurring'; never let a hand edit
  // turn a converted entry back into an estimate.
  if (row.submissionMethod !== AUTO_RECURRING_SUBMISSION_METHOD) {
    return updates.submissionMethod === AUTO_RECURRING_SUBMISSION_METHOD
      ? { updates: { ...updates, submissionMethod: 'standard' }, afterSave }
      : { updates, afterSave };
  }
  log.info(`Auto entry ${collectionId} edited in Collections log; converting to a regular log entry`);
  return {
    updates: {
      ...updates,
      submissionMethod: 'standard',
      createdByName: `${SYSTEM_USER_NAME}, edited`,
    },
    afterSave,
  };
}

/**
 * For deletes that bypass the storage layer (bulk hard-delete in Data
 * Management): mark the week of every auto-origin row about to be removed
 * "didn't collect", so the daily run doesn't recreate the estimate.
 */
export async function markAutoEntriesDeleted(
  rows: Array<{ createdBy: string | null; collectionDate: string; deletedAt?: Date | null }>,
  userId?: string | null
): Promise<void> {
  const weeks = new Set(
    rows.filter((r) => isAutoLogRow(r) && !r.deletedAt).map((r) => wednesdayOf(r.collectionDate))
  );
  for (const weekOf of weeks) {
    await upsertOverride({
      weekOf,
      skipped: true,
      count: null,
      note: 'Deleted in bulk (Data Management)',
      userId: userId ?? null,
      userName: null,
    });
  }
}

/**
 * Called by the storage layer after a collection is deleted or restored
 * outside this module. For rows that started as auto entries (including ones
 * since converted by an edit):
 *   - deleted  → "didn't collect" override, so the estimate doesn't return
 *   - restored → undo that: drop the "didn't collect" override, or for a
 *                still-auto row save its count as an explicit override (so a
 *                card-set count, holiday weeks included, survives delete +
 *                restore)
 */
export async function syncOverrideFromAutoEntryChange(
  collectionId: number,
  change: 'delete' | 'restore',
  userId?: string | null
): Promise<void> {
  const [row] = await db
    .select()
    .from(sandwichCollections)
    .where(eq(sandwichCollections.id, collectionId))
    .limit(1);
  if (!isAutoLogRow(row)) return;
  const weekOf = wednesdayOf(row.collectionDate);

  if (change === 'delete') {
    await upsertOverride({
      weekOf,
      skipped: true,
      count: null,
      note: 'Deleted in Collections log',
      userId: userId ?? null,
      userName: null,
    });
  } else {
    // A still-auto row comes back with the count it had, as an explicit
    // override, even if that's the default: in a holiday week only an explicit
    // count keeps the entry (the default alone would be skipped).
    if (row.submissionMethod === AUTO_RECURRING_SUBMISSION_METHOD) {
      await upsertOverride({
        weekOf,
        skipped: false,
        count: row.individualSandwiches,
        note: 'Restored in Collections log',
        userId: userId ?? null,
        userName: null,
      });
    } else if ((await getOverride(weekOf))?.skipped) {
      await deleteOverride(weekOf);
    }
  }
  log.info(`Auto entry ${collectionId} ${change}d in Collections log; override updated for week of ${weekOf}`);
}

async function reconcileWeekOnce(
  weekOfInput: string,
  opts: { today?: string; allowCreate?: boolean }
): Promise<ReconcileResult & { overrideSeen?: string; raced?: boolean }> {
  const weekOf = wednesdayOf(weekOfInput);
  const today = opts.today ?? todayInEastern();
  const config = await getAutoLogConfig();

  const base = { weekOf, count: null, collectionId: null } as const;

  // Disabled: leave existing entries alone, create nothing new.
  if (!config.enabled) return { ...base, outcome: 'skipped_disabled' };

  // Never pre-record a week that hasn't started yet.
  if (weekOf > today) return { ...base, outcome: 'skipped_future' };

  const override = await getOverride(weekOf);
  const overrideSeen = overrideFingerprint(override);
  const holiday = holidayFor(weekOf);
  const allowCreate = opts.allowCreate ?? true;
  const seen = { ...base, overrideSeen };

  const [autoRow] = await db
    .select()
    .from(sandwichCollections)
    .where(
      and(
        eq(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD),
        eq(sandwichCollections.createdBy, AUTO_ROW_CREATED_BY),
        eq(sandwichCollections.collectionDate, weekOf)
      )
    )
    .limit(1);

  // A real (non-auto) log for this host this week means someone entered the
  // actual number — that beats our standing estimate.
  const manualRow = await findManualEntry(config, weekOf);

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
      const removed = await db
        .update(sandwichCollections)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(stillAutoRow(autoRow.id))
        .returning({ id: sandwichCollections.id });
      if (removed.length === 0) return { ...seen, outcome: 'unchanged', raced: true };
      notifyCollectionsChanged(autoRow.id, 'delete');
      log.info(`Removed auto entry ${autoRow.id} for week of ${weekOf} (${standDown})`);
      return {
        ...seen,
        outcome: 'removed',
        collectionId: autoRow.id,
        detail: standDown,
      };
    }
    return {
      ...seen,
      outcome: standDown,
      detail: holiday.excluded ? holiday.reason : undefined,
    };
  }

  const countFields = {
    individualSandwiches: desiredCount,
    individualPbj: desiredCount,
  };

  // Look-back mode only corrects entries that are already live.
  if (!allowCreate && (!autoRow || autoRow.deletedAt)) {
    return { ...seen, outcome: 'unchanged', detail: 'no auto entry (look-back does not create)' };
  }

  if (autoRow) {
    const wasDeleted = !!autoRow.deletedAt;
    const countChanged =
      autoRow.individualSandwiches !== desiredCount ||
      autoRow.individualPbj !== desiredCount ||
      autoRow.hostName !== config.hostName;
    if (!wasDeleted && !countChanged) {
      return { ...seen, outcome: 'unchanged', count: desiredCount, collectionId: autoRow.id };
    }
    const written = await db
      .update(sandwichCollections)
      .set({ ...countFields, hostName: config.hostName, deletedAt: null, deletedBy: null })
      .where(stillAutoRow(autoRow.id))
      .returning({ id: sandwichCollections.id });
    if (written.length === 0) return { ...seen, outcome: 'unchanged', raced: true };
    notifyCollectionsChanged(autoRow.id, wasDeleted ? 'restore' : 'update');
    log.info(
      `${wasDeleted ? 'Restored' : 'Updated'} auto entry ${autoRow.id} for week of ${weekOf} → ${desiredCount}`
    );
    return {
      ...seen,
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
      createdBy: AUTO_ROW_CREATED_BY,
      createdByName: SYSTEM_USER_NAME,
      submissionMethod: AUTO_RECURRING_SUBMISSION_METHOD,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    return { ...seen, outcome: 'unchanged', count: desiredCount, detail: 'inserted concurrently' };
  }
  notifyCollectionsChanged(created.id, 'create');
  log.info(`Created auto entry ${created.id} for week of ${weekOf} → ${desiredCount}`);
  return { ...seen, outcome: 'created', count: desiredCount, collectionId: created.id };
}

/**
 * Cron entry point: log the current collection week, then re-check the past
 * LOOKBACK_WEEKS weeks so a real log entered late (or an override saved for an
 * old week) removes/corrects the auto entry. Look-back never creates entries;
 * filling old gaps is the explicit backfill's job.
 */
export async function runCollectiveLearningAutoLog(): Promise<{
  current: ReconcileResult;
  lookback: ReconcileResult[];
}> {
  const today = todayInEastern();
  const current = await reconcileWeek(today, { today });
  const lookback: ReconcileResult[] = [];
  for (let i = 1; i <= LOOKBACK_WEEKS; i++) {
    const week = addDays(wednesdayOf(today), -7 * i);
    const r = await reconcileWeek(week, { today, allowCreate: false });
    if (['removed', 'updated', 'restored'].includes(r.outcome)) lookback.push(r);
  }
  return { current, lookback };
}

export const MAX_BACKFILL_WEEKS = 60;

/**
 * Fill in past weeks: reconcile every collection week from `from` through
 * `through` (default: the current week). Same rules as the weekly run, so
 * weeks with a real log, a "didn't collect" override, or a holiday are left
 * alone, and weeks already auto-logged aren't duplicated.
 */
export async function backfillWeeks(
  from: string,
  through: string = todayInEastern()
): Promise<ReconcileResult[]> {
  const today = todayInEastern();
  const last = wednesdayOf(through < today ? through : today);
  const results: ReconcileResult[] = [];
  for (let week = wednesdayOf(from); week <= last; week = addDays(week, 7)) {
    if (results.length >= MAX_BACKFILL_WEEKS) break;
    results.push(await reconcileWeek(week, { today }));
  }
  return results;
}

/** Status for the UI: config, current week's outcome preview, recent auto entries, overrides. */
export async function getAutoLogStatus() {
  const config = await getAutoLogConfig();
  const today = todayInEastern();
  const currentWeekOf = wednesdayOf(today);
  const [overrides, recentAutoEntries, currentWeekManual, [currentWeekAuto]] = await Promise.all([
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
    findManualEntry(config, currentWeekOf),
    db
      .select({ id: sandwichCollections.id, count: sandwichCollections.individualSandwiches })
      .from(sandwichCollections)
      .where(
        and(
          eq(sandwichCollections.submissionMethod, AUTO_RECURRING_SUBMISSION_METHOD),
          eq(sandwichCollections.createdBy, AUTO_ROW_CREATED_BY),
          eq(sandwichCollections.collectionDate, currentWeekOf),
          isNull(sandwichCollections.deletedAt)
        )
      )
      .limit(1),
  ]);
  return {
    config,
    today,
    currentWeekOf,
    currentWeekHoliday: holidayFor(currentWeekOf),
    // What's actually in the log this week, so the card doesn't have to guess
    currentWeekManual: currentWeekManual
      ? { id: currentWeekManual.id, count: collectionTotal(currentWeekManual) }
      : null,
    currentWeekAuto: currentWeekAuto ?? null,
    overrides,
    recentAutoEntries,
  };
}
