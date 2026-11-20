/**
 * Volunteer sheet sync, reading and saving half (people/places rebuild,
 * step 7). The decisions are made in volunteer-sheet-plan.ts; this file reads
 * the sheet, loads the current state, and writes the plan.
 *
 * Used by:
 *   - the daily job and the "Sync now" button (server), via runVolunteerSheetSync
 *   - scripts/sync-volunteer-sheet.ts (`--dry-run` / `--apply`)
 *
 * The app only reads the sheet (Viewer access is enough). Writes go through a
 * plain `(text, params) => rows` runner so the same code works on the Neon
 * HTTP driver (production) and node-postgres (dev, scripts). Neon's HTTP
 * driver has no transactions, so each person's writes are independent and the
 * whole sync is safe to re-run: it recomputes from what's in the database.
 */
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { normalizePrivateKey } from '../../utils/google-private-key';
import {
  planVolunteerSync,
  summarizePlan,
  REQUIRED_COLUMNS,
  type SheetRow,
  type CurrentState,
  type SyncPlan,
} from './volunteer-sheet-plan';

export type Query = (text: string, params?: unknown[]) => Promise<any[]>;

const DEFAULT_SHEET_ID = '1zvBXjx8elrhpNTrhkp-yh9gV5yE9oPTZoEjzfNDP2_g';
const DEFAULT_TAB = 'All Volunteers';
const SHEET = 'volunteer';

export class VolunteerSyncError extends Error {}

// ---------------------------------------------------------------------------
// Reading the sheet
// ---------------------------------------------------------------------------

export async function readVolunteerSheet(): Promise<SheetRow[]> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new VolunteerSyncError('Google service account credentials are not set.');
  const auth = new JWT({
    email,
    key: normalizePrivateKey(key),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  // googleapis bundles its own google-auth-library, so the JWT type differs
  // from ours in name only (the same mismatch as error-log-sheet-sync.ts).
  const sheets = google.sheets({ version: 'v4', auth: auth as any });
  const spreadsheetId = process.env.VOLUNTEER_SHEET_ID || DEFAULT_SHEET_ID;
  const tab = process.env.VOLUNTEER_SHEET_TAB || DEFAULT_TAB;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab.replace(/'/g, "''")}'` });
  const values = (res.data.values || []) as string[][];
  if (values.length === 0) throw new VolunteerSyncError(`The "${tab}" tab is empty.`);

  const head = values[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => col(c) < 0);
  if (missing.length) {
    throw new VolunteerSyncError(`The "${tab}" tab is missing column(s): ${missing.join(', ')}. Nothing was synced.`);
  }
  const cell = (r: string[], name: string) => {
    const i = col(name);
    return i < 0 ? '' : String(r[i] ?? '');
  };
  return values.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    name: cell(r, 'Name'),
    email: cell(r, 'Email'),
    phone: cell(r, 'Phone'),
    status: cell(r, 'Status'),
    emailList: cell(r, 'Event Volunteer Email List'),
    location: cell(r, 'Location'),
    notes: cell(r, 'Notes'),
  }));
}

// ---------------------------------------------------------------------------
// Loading the current state
// ---------------------------------------------------------------------------

export async function loadVolunteerSyncState(q: Query): Promise<CurrentState> {
  // One query at a time: a single pg client can't run them in parallel.
  const people = await q(`SELECT id, first_name, last_name, name_source, email, phone, is_volunteer FROM people`);
  const aliases = await q(`SELECT person_id, alias FROM person_name_aliases`);
  const profiles = await q(
    `SELECT person_id, availability_status, on_recruitment_list, location, sheet_notes, on_sheet FROM volunteer_profiles`
  );
  const syncValues = await q(`SELECT person_id, field, last_synced_value FROM sheet_sync_values WHERE sheet = $1`, [SHEET]);
  const openConflicts = await q(
    // Open questions, plus malformed sheet values someone already dismissed
    // (so the same bad cell isn't raised again every day).
    `SELECT person_id, field, sheet_value FROM sheet_field_conflicts
      WHERE sheet = $1 AND (resolved_at IS NULL OR kind = 'invalid_sheet_value')`,
    [SHEET]
  );
  const openFlags = await q(
    `SELECT id, person_id, kind FROM person_review_flags
      WHERE resolved_at IS NULL AND kind IN ('not_on_sheet', 'new_from_sheet')`
  );
  return {
    people: people.map((p) => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      nameSource: p.name_source,
      email: p.email,
      phone: p.phone,
      isVolunteer: p.is_volunteer,
    })),
    aliases: aliases.map((a) => ({ personId: a.person_id, alias: a.alias })),
    profiles: profiles.map((p) => ({
      personId: p.person_id,
      availabilityStatus: p.availability_status,
      onRecruitmentList: p.on_recruitment_list,
      location: p.location,
      sheetNotes: p.sheet_notes,
      onSheet: p.on_sheet,
    })),
    syncValues: syncValues.map((v) => ({ personId: v.person_id, field: v.field, value: v.last_synced_value })),
    openConflicts: openConflicts.map((c) => ({ personId: c.person_id, field: c.field, sheetValue: c.sheet_value })),
    openFlags: openFlags.map((f) => ({ id: f.id, personId: f.person_id, kind: f.kind })),
  };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

const PROFILE_UPSERT = `
  INSERT INTO volunteer_profiles
    (person_id, availability_status, on_recruitment_list, location, sheet_notes, on_sheet, last_seen_on_sheet_at)
  VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
  ON CONFLICT (person_id) DO UPDATE SET
    availability_status = EXCLUDED.availability_status,
    on_recruitment_list = EXCLUDED.on_recruitment_list,
    location = EXCLUDED.location,
    sheet_notes = EXCLUDED.sheet_notes,
    on_sheet = TRUE,
    last_seen_on_sheet_at = NOW(),
    updated_at = NOW()`;

const SYNC_VALUE_UPSERT = `
  INSERT INTO sheet_sync_values (person_id, sheet, field, last_synced_value, synced_at)
  VALUES ($1, '${SHEET}', $2, $3, NOW())
  ON CONFLICT (person_id, sheet, field) DO UPDATE SET
    last_synced_value = EXCLUDED.last_synced_value, synced_at = NOW()`;

const CONFLICT_INSERT = `
  INSERT INTO sheet_field_conflicts (person_id, sheet, field, kind, sheet_value, app_value, sync_run_id)
  VALUES ($1, '${SHEET}', $2, $3, $4, $5, $6)`;

async function applyPlan(q: Query, plan: SyncPlan, runId: number | null) {
  for (const u of plan.updates) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (column: string, v: unknown) => {
      vals.push(v);
      sets.push(`${column} = $${vals.length}`);
    };
    if (u.set.firstName !== undefined) add('first_name', u.set.firstName);
    if (u.set.lastName !== undefined) add('last_name', u.set.lastName);
    if (u.set.nameSource !== undefined) add('name_source', u.set.nameSource);
    if (u.set.email !== undefined) add('email', u.set.email);
    if (u.set.phone !== undefined) add('phone', u.set.phone);
    if (u.set.isVolunteer !== undefined) add('is_volunteer', u.set.isVolunteer);
    if (sets.length) {
      vals.push(u.personId);
      await q(`UPDATE people SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    }
    if (u.addAlias) {
      await q(
        `INSERT INTO person_name_aliases (person_id, alias, source) VALUES ($1, $2, 'volunteer_sheet') ON CONFLICT DO NOTHING`,
        [u.personId, u.addAlias]
      );
    }
    const p = u.profile;
    await q(PROFILE_UPSERT, [u.personId, p.availabilityStatus, p.onRecruitmentList, p.location, p.sheetNotes]);
    for (const v of u.syncValues) await q(SYNC_VALUE_UPSERT, [u.personId, v.field, v.value]);
    for (const c of u.conflicts) await q(CONFLICT_INSERT, [u.personId, c.field, c.kind, c.sheetValue, c.appValue, runId]);
    for (const id of u.resolveNotOnSheetFlagIds) {
      await q(
        `UPDATE person_review_flags SET resolved_at = NOW(), resolution = 'Back on the volunteer sheet' WHERE id = $1 AND resolved_at IS NULL`,
        [id]
      );
    }
  }

  for (const n of plan.newPeople) {
    const [{ id }] = await q(
      `INSERT INTO people (first_name, last_name, name_source, email, phone, is_volunteer, is_active)
       VALUES ($1, $2, 'sheet', $3, $4, $5, TRUE) RETURNING id`,
      [n.firstName, n.lastName, n.email, n.phone, n.isVolunteer]
    );
    const p = n.profile;
    await q(PROFILE_UPSERT, [id, p.availabilityStatus, p.onRecruitmentList, p.location, p.sheetNotes]);
    const name = [n.firstName, n.lastName].filter(Boolean).join(' ');
    await q(SYNC_VALUE_UPSERT, [id, 'name', name]);
    if (n.email) await q(SYNC_VALUE_UPSERT, [id, 'email', n.email]);
    if (n.phone) await q(SYNC_VALUE_UPSERT, [id, 'phone', n.phone]);
    for (const c of n.conflicts) await q(CONFLICT_INSERT, [id, c.field, c.kind, c.sheetValue, null, runId]);
    await q(`INSERT INTO person_review_flags (person_id, kind, detail) VALUES ($1, 'new_from_sheet', $2)`, [
      id,
      `Added from row ${n.rowNumber} of the volunteer sheet. Check they aren't already in the app under another name; merge if they are.`,
    ]);
  }

  for (const m of plan.missing) {
    await q(`UPDATE volunteer_profiles SET on_sheet = FALSE, updated_at = NOW() WHERE person_id = $1`, [m.personId]);
    if (!m.alreadyFlagged) {
      await q(`INSERT INTO person_review_flags (person_id, kind, detail) VALUES ($1, 'not_on_sheet', $2)`, [
        m.personId,
        'No longer on the volunteer sheet. Nothing was changed: turn the volunteer role off here if they have stopped volunteering, or add them back to the sheet.',
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

export interface RunOptions {
  q: Query;
  trigger: 'scheduled' | 'manual' | 'script';
  userId?: string | null;
  dryRun?: boolean;
  /** Allow more than the usual number of people to go missing in one run. */
  allowManyMissing?: boolean;
  /** For tests: rows instead of reading Google. */
  rows?: SheetRow[];
}

export interface RunResult {
  runId: number | null;
  dryRun: boolean;
  plan: SyncPlan;
  summary: ReturnType<typeof summarizePlan>;
}

/**
 * Guard against a half-loaded or emptied sheet flagging everyone as gone:
 * more than 5 people, and more than a third of those on the sheet, missing at
 * once stops the run unless allowManyMissing is set.
 */
function checkMissing(plan: SyncPlan, onSheetBefore: number, allow: boolean) {
  if (allow) return;
  const n = plan.missing.length;
  if (n > 5 && n > onSheetBefore / 3) {
    throw new VolunteerSyncError(
      `${n} of ${onSheetBefore} volunteers would be marked as missing from the sheet at once. ` +
        'Stopped in case the sheet was cleared or filtered by mistake. If this is right, run it again with "allow many missing".'
    );
  }
}

export async function runVolunteerSheetSync(opts: RunOptions): Promise<RunResult> {
  const { q } = opts;
  const rows = opts.rows ?? (await readVolunteerSheet());
  if (!rows.some((r) => r.name.trim())) throw new VolunteerSyncError('The volunteer sheet has no rows with a name. Nothing was synced.');

  const state = await loadVolunteerSyncState(q);
  const plan = planVolunteerSync(rows, state);
  const summary = summarizePlan(plan);
  checkMissing(plan, state.profiles.filter((p) => p.onSheet).length, !!opts.allowManyMissing);
  if (opts.dryRun) return { runId: null, dryRun: true, plan, summary };

  // One run at a time. A run stuck as "running" for over 10 minutes is ignored.
  const [busy] = await q(
    `SELECT id FROM sheet_sync_runs WHERE sheet = $1 AND status = 'running' AND started_at > NOW() - INTERVAL '10 minutes' LIMIT 1`,
    [SHEET]
  );
  if (busy) throw new VolunteerSyncError('A volunteer sheet sync is already running. Try again in a few minutes.');

  const [{ id: runId }] = await q(
    `INSERT INTO sheet_sync_runs (sheet, trigger, triggered_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [SHEET, opts.trigger, opts.userId ?? null]
  );
  try {
    await applyPlan(q, plan, runId);
    const report = {
      ...summary,
      changes: plan.updates.filter((u) => u.changes.length).map((u) => ({ personId: u.personId, name: u.display, changes: u.changes })),
      addedNames: plan.newPeople.map((n) => [n.firstName, n.lastName].filter(Boolean).join(' ')),
      missingNames: plan.missing.map((m) => m.display),
      problems: plan.problems,
    };
    await q(`UPDATE sheet_sync_runs SET status = 'succeeded', finished_at = NOW(), summary = $2 WHERE id = $1`, [
      runId,
      JSON.stringify(report),
    ]);
  } catch (err) {
    await q(`UPDATE sheet_sync_runs SET status = 'failed', finished_at = NOW(), error = $2 WHERE id = $1`, [
      runId,
      (err as Error).message,
    ]).catch(() => {});
    throw err;
  }
  return { runId, dryRun: false, plan, summary };
}

// ---------------------------------------------------------------------------
// Inside the app (daily job, "Sync now", deciding conflicts)
// ---------------------------------------------------------------------------

async function appQuery(): Promise<Query> {
  const { sqlClient } = await import('../../db');
  return (text, params = []) => sqlClient(text, params);
}

/**
 * The daily job. Skips until a first sync has succeeded, so the first run
 * (which can raise many decisions) always happens by hand.
 */
export async function runScheduledVolunteerSheetSync() {
  const q = await appQuery();
  const [done] = await q(`SELECT id FROM sheet_sync_runs WHERE sheet = $1 AND status = 'succeeded' LIMIT 1`, [SHEET]);
  if (!done) return { skipped: 'no successful sync yet; run the first one by hand' };
  const { summary, runId } = await runVolunteerSheetSync({ q, trigger: 'scheduled' });
  return { runId, ...summary };
}

export async function runManualVolunteerSheetSync(userId: string | null, opts: { dryRun?: boolean; allowManyMissing?: boolean }) {
  const q = await appQuery();
  return runVolunteerSheetSync({ q, trigger: 'manual', userId, ...opts });
}

export async function getVolunteerSyncStatus() {
  const q = await appQuery();
  const [lastRun] = await q(
    `SELECT id, trigger, status, started_at, finished_at, summary, error
       FROM sheet_sync_runs WHERE sheet = $1 ORDER BY started_at DESC LIMIT 1`,
    [SHEET]
  );
  const conflicts = await q(
    `SELECT c.id, c.person_id, c.field, c.kind, c.sheet_value, c.app_value, c.created_at,
            p.first_name, p.last_name
       FROM sheet_field_conflicts c JOIN people p ON p.id = c.person_id
      WHERE c.sheet = $1 AND c.resolved_at IS NULL
      ORDER BY p.last_name, p.first_name, c.field`,
    [SHEET]
  );
  return {
    lastRun: lastRun
      ? {
          id: lastRun.id,
          trigger: lastRun.trigger,
          status: lastRun.status,
          startedAt: lastRun.started_at,
          finishedAt: lastRun.finished_at,
          summary: lastRun.summary,
          error: lastRun.error,
        }
      : null,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      personId: c.person_id,
      personName: [c.first_name, c.last_name].filter(Boolean).join(' '),
      field: c.field,
      kind: c.kind,
      sheetValue: c.sheet_value,
      appValue: c.app_value,
      createdAt: c.created_at,
    })),
  };
}

/**
 * Decide a sheet-vs-app question.
 *   use_sheet: copy the sheet's value into the app (not allowed for a
 *              malformed sheet value).
 *   keep_app:  keep the app's value.
 * Either way the sheet's value is recorded as the last synced value, so the
 * next sync only reacts if the sheet changes again.
 */
export async function resolveSheetConflict(id: number, choice: 'use_sheet' | 'keep_app', userId: string | null) {
  const q = await appQuery();
  const [c] = await q(`SELECT * FROM sheet_field_conflicts WHERE id = $1`, [id]);
  if (!c) throw new VolunteerSyncError('That question no longer exists.');
  if (c.resolved_at) throw new VolunteerSyncError('That question has already been decided.');
  if (choice === 'use_sheet' && c.kind === 'invalid_sheet_value') {
    throw new VolunteerSyncError("The sheet's value looks wrong, so it can't be used. Fix it on the sheet, or keep the app's value.");
  }
  if (choice === 'use_sheet') {
    if (c.field === 'name') {
      const [p] = await q(`SELECT first_name, last_name FROM people WHERE id = $1`, [c.person_id]);
      const { splitName } = await import('./volunteer-sheet-plan');
      const { firstName, lastName } = splitName(c.sheet_value);
      await q(
        `INSERT INTO person_name_aliases (person_id, alias, source) VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING`,
        [c.person_id, [p.first_name, p.last_name].filter(Boolean).join(' ')]
      );
      // Someone chose this spelling on purpose, so it ranks as admin-entered.
      await q(`UPDATE people SET first_name = $2, last_name = $3, name_source = 'admin_entered', updated_at = NOW() WHERE id = $1`, [
        c.person_id,
        firstName,
        lastName,
      ]);
    } else {
      await q(`UPDATE people SET ${c.field === 'email' ? 'email' : 'phone'} = $2, updated_at = NOW() WHERE id = $1`, [
        c.person_id,
        c.sheet_value,
      ]);
    }
  }
  if (c.kind !== 'invalid_sheet_value') await q(SYNC_VALUE_UPSERT, [c.person_id, c.field, c.sheet_value]);
  await q(
    `UPDATE sheet_field_conflicts SET resolved_at = NOW(), resolved_by_user_id = $2, resolution = $3 WHERE id = $1`,
    [id, userId, choice === 'use_sheet' ? 'used_sheet' : c.kind === 'invalid_sheet_value' ? 'dismissed' : 'kept_app']
  );
  const [after] = await q(`SELECT * FROM sheet_field_conflicts WHERE id = $1`, [id]);
  return after;
}
