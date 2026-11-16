/**
 * Weekly database backup → Google Drive.
 *
 * Exports every table in the `public` schema as gzipped CSV using
 * `COPY ... TO STDOUT` (no pg_dump binary — production is Postgres 17), bundles
 * the files into one dated .tar.gz, uploads it to the Shared Drive folder in
 * BACKUP_DRIVE_FOLDER_ID, then prunes backups older than RETENTION_WEEKS.
 *
 * The app's main `db` (neon-http) can't speak the COPY protocol, so this job
 * opens its OWN short-lived `pg` connection and closes it when done. Nothing
 * else in the app uses this connection.
 *
 * Every run (success or failure) is written to the error-log Google Sheet.
 */
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import pg from 'pg';
import { to as copyTo } from 'pg-copy-streams';
import { google } from 'googleapis';
import { getDatabaseUrl, getDatabaseBranch } from '../db-url';
import { repairPrivateKey } from '../google-sheets-key-repair';
import { appendErrorLogToSheet } from './error-log-sheet-sync';
import { logger } from '../utils/production-safe-logger';

const RETENTION_WEEKS = 10;
/**
 * Hard ceiling on one run. A hung COPY or Drive upload otherwise holds the
 * in-memory lock until the process restarts, silently blocking every later run.
 */
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000;
/** pg's client.end() can wait forever on a socket we already destroyed. */
const PG_CLOSE_TIMEOUT_MS = 5_000;
const FILE_PREFIX = 'tsp-db-backup-';

function backupBaseName(branch: 'dev' | 'production', dateStr: string): string {
  return `${FILE_PREFIX}${branch === 'dev' ? 'dev-' : ''}${dateStr}`;
}

/**
 * Matches only the files this job creates FOR THIS BRANCH:
 * production → tsp-db-backup-YYYY-MM-DD.tar.gz, dev → tsp-db-backup-dev-YYYY-MM-DD.tar.gz.
 * Keeps a dev test run from ever pruning production backups (and vice versa).
 */
function backupNameRegex(branch: 'dev' | 'production'): RegExp {
  return branch === 'dev'
    ? /^tsp-db-backup-dev-(\d{4}-\d{2}-\d{2})\.tar\.gz$/
    : /^tsp-db-backup-(\d{4}-\d{2}-\d{2})\.tar\.gz$/;
}

export interface TableExport {
  table: string;
  rows: number;
  bytes: number;
}

export interface SequenceState {
  sequence: string;
  /** null when the sequence has never been used (nextval never called). */
  lastValue: string | null;
}

export interface DbBackupResult {
  success: boolean;
  trigger: 'cron' | 'manual';
  branch: 'dev' | 'production';
  fileName?: string;
  driveFileId?: string;
  sizeBytes?: number;
  tableCount?: number;
  totalRows?: number;
  durationMs: number;
  deletedOldBackups?: string[];
  retentionError?: string;
  error?: string;
}

let running = false;

export function isDbBackupRunning(): boolean {
  return running;
}

/** YYYY-MM-DD in Eastern time. */
function easternDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL that puts every public sequence back where it was at backup time. Run it
 * AFTER loading the CSVs, or new inserts will collide with restored ids.
 */
function buildRestoreSequencesSql(sequences: SequenceState[]): string {
  const lines = [
    '-- Run AFTER recreating the schema and loading every CSV.',
    '-- Restores each public sequence to its value at backup time so new inserts',
    '-- do not collide with restored primary keys.',
    ...sequences.map(({ sequence, lastValue }) => {
      const reg = quoteLiteral(`public.${quoteIdent(sequence)}`);
      return lastValue === null
        ? `SELECT setval(${reg}, 1, false);`
        : `SELECT setval(${reg}, ${lastValue}, true);`;
    }),
  ];
  return lines.join('\n') + '\n';
}

const RESTORE_README = `TSP database backup

Contents
  manifest.json             tables (with row counts) and sequence values at backup time
  <table>.csv.gz            one gzipped CSV per public-schema table (header row included)
  restore-sequences.sql     resets every sequence to its backed-up value

This archive holds DATA ONLY. To restore into an empty database:
  1. Recreate the schema (run the files in /migrations, or drizzle-kit push from shared/schema.ts).
  2. Load each table, e.g.
       gunzip -c users.csv.gz | psql "$URL" -c "\\copy public.users FROM STDIN WITH (FORMAT csv, HEADER true)"
     (if foreign keys get in the way, load inside a session with
      SET session_replication_role = replica;)
  3. psql "$URL" -f restore-sequences.sql
     Without this step, serial/identity ids restart at 1 and new inserts fail
     with duplicate-key errors.
`;

// ---------------------------------------------------------------------------
// Minimal ustar writer (avoids a new dependency for a ~30-line format)
// ---------------------------------------------------------------------------

function tarHeader(name: string, size: number, mtime: Date): Buffer {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`Tar entry name too long: ${name}`);
  }
  const header = Buffer.alloc(512, 0);
  const writeStr = (value: string, offset: number, length: number) =>
    header.write(value, offset, length, 'utf8');
  const octal = (value: number, length: number) =>
    value.toString(8).padStart(length - 1, '0') + '\0';

  writeStr(name, 0, 100);
  writeStr(octal(0o644, 8), 100, 8); // mode
  writeStr(octal(0, 8), 108, 8); // uid
  writeStr(octal(0, 8), 116, 8); // gid
  writeStr(octal(size, 12), 124, 12); // size
  writeStr(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12); // mtime
  writeStr('        ', 148, 8); // checksum placeholder (spaces)
  writeStr('0', 156, 1); // typeflag: regular file
  writeStr('ustar\0', 257, 6);
  writeStr('00', 263, 2);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeStr(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return header;
}

async function writeTarGz(
  outPath: string,
  entries: { name: string; filePath: string }[],
): Promise<void> {
  const mtime = new Date();
  async function* tarStream() {
    for (const entry of entries) {
      const { size } = await stat(entry.filePath);
      yield tarHeader(entry.name, size, mtime);
      for await (const chunk of createReadStream(entry.filePath)) {
        yield chunk as Buffer;
      }
      const pad = (512 - (size % 512)) % 512;
      if (pad) yield Buffer.alloc(pad, 0);
    }
    yield Buffer.alloc(1024, 0); // end-of-archive marker
  }
  await pipeline(Readable.from(tarStream()), createGzip(), createWriteStream(outPath));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function exportTables(
  workDir: string,
  signal: AbortSignal,
): Promise<{ tables: TableExport[]; sequences: SequenceState[] }> {
  signal.throwIfAborted();
  const connectionString = getDatabaseUrl();
  if (!connectionString) throw new Error('Database URL not configured');

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 30_000,
    application_name: 'tsp-weekly-backup',
  });
  // An idle-connection error on this client must not crash the process.
  client.on('error', (err) => logger.error('[DbBackup] pg client error:', err));

  // On timeout, cut the socket: any in-flight query/COPY rejects immediately and
  // Postgres cancels the backend when it sees the disconnect.
  const onAbort = () => {
    (client as any).connection?.stream?.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await client.connect();
    // One read-only snapshot so all tables are consistent with each other.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Server-side limits, so Postgres gives up on its own even if our socket is
    // gone (a backend waiting on a lock doesn't notice the client left):
    // - lock_timeout: a table locked by a migration fails fast instead of hanging
    // - statement_timeout: no single COPY runs away
    // - idle_in_transaction_session_timeout: a stalled client can't pin the snapshot
    // SET LOCAL lasts only for this transaction, so it's safe through Neon's pooler.
    await client.query(`SET LOCAL lock_timeout = '60s'`);
    await client.query(`SET LOCAL statement_timeout = '20min'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '5min'`);

    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname = 'public' ORDER BY tablename`,
    );
    if (rows.length === 0) throw new Error('No tables found in public schema');

    const exports: TableExport[] = [];
    for (const { tablename } of rows) {
      signal.throwIfAborted();
      const filePath = path.join(workDir, `${tablename}.csv.gz`);
      const copyStream = client.query(
        copyTo(
          `COPY public.${quoteIdent(tablename)} TO STDOUT WITH (FORMAT csv, HEADER true)`,
        ),
      );
      await pipeline(copyStream, createGzip(), createWriteStream(filePath));
      const { size } = await stat(filePath);
      exports.push({ table: tablename, rows: copyStream.rowCount ?? 0, bytes: size });
    }

    // Sequence positions from the same snapshot, so a restore can reseed ids.
    const seqResult = await client.query<{ sequencename: string; last_value: string | null }>(
      `SELECT sequencename, last_value::text AS last_value FROM pg_catalog.pg_sequences
       WHERE schemaname = 'public' ORDER BY sequencename`,
    );
    const sequences = seqResult.rows.map((r) => ({
      sequence: r.sequencename,
      lastValue: r.last_value,
    }));

    await client.query('COMMIT');
    return { tables: exports, sequences };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await Promise.race([
      client.end().catch((err) => logger.error('[DbBackup] Error closing pg client:', err)),
      new Promise((resolve) => setTimeout(resolve, PG_CLOSE_TIMEOUT_MS).unref()),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY not configured');
  }
  const auth = new google.auth.JWT({
    email,
    key: repairPrivateKey(privateKey, true),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Moves this branch's backups older than RETENTION_WEEKS to the Shared Drive
 * trash. Trashing (not files.delete) because permanent deletion in a Shared
 * Drive needs the Manager role; Content Manager can trash, and Drive empties
 * Shared Drive trash on its own after 30 days.
 */
async function trashOldBackups(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  keepFileId: string,
  branch: 'dev' | 'production',
  signal: AbortSignal,
): Promise<string[]> {
  const nameRe = backupNameRegex(branch);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_WEEKS * 7);
  const cutoffStr = easternDateString(cutoff);

  const deleted: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and name contains '${FILE_PREFIX}'`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    }, { signal });
    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name || file.id === keepFileId) continue;
      const match = nameRe.exec(file.name);
      if (!match || match[1] >= cutoffStr) continue;
      signal.throwIfAborted();
      await drive.files.update({
        fileId: file.id,
        supportsAllDrives: true,
        requestBody: { trashed: true },
      }, { signal });
      deleted.push(file.name);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return deleted;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface BackupSuccess {
  fileName: string;
  driveFileId: string;
  sizeBytes: number;
  tableCount: number;
  totalRows: number;
  deletedOldBackups: string[];
  retentionError?: string;
}

/** The actual work. Every slow step honours `signal`, so a timeout really stops it. */
async function performBackup(
  trigger: 'cron' | 'manual',
  branch: 'dev' | 'production',
  signal: AbortSignal,
  ctx: { workDir?: string },
): Promise<BackupSuccess> {
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID?.trim();
  if (!folderId) throw new Error('BACKUP_DRIVE_FOLDER_ID not configured');

  const dateStr = easternDateString();
  const baseName = backupBaseName(branch, dateStr);
  const fileName = `${baseName}.tar.gz`;

  const workDir = await mkdtemp(path.join(tmpdir(), 'tsp-db-backup-'));
  ctx.workDir = workDir;
  const tablesDir = path.join(workDir, 'tables');
  await mkdir(tablesDir);

  logger.log(`[DbBackup] Starting ${trigger} backup of ${branch} database`);
  const { tables, sequences } = await exportTables(tablesDir, signal);
  const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);

  const manifestPath = path.join(workDir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        branch,
        format: 'One gzipped CSV (with header row) per public-schema table, via COPY TO STDOUT',
        tables,
        sequences,
      },
      null,
      2,
    ),
  );
  const sequencesSqlPath = path.join(workDir, 'restore-sequences.sql');
  await writeFile(sequencesSqlPath, buildRestoreSequencesSql(sequences));
  const readmePath = path.join(workDir, 'README.txt');
  await writeFile(readmePath, RESTORE_README);

  signal.throwIfAborted();
  const archivePath = path.join(workDir, fileName);
  await writeTarGz(archivePath, [
    { name: `${baseName}/README.txt`, filePath: readmePath },
    { name: `${baseName}/manifest.json`, filePath: manifestPath },
    { name: `${baseName}/restore-sequences.sql`, filePath: sequencesSqlPath },
    ...tables.map((t) => ({
      name: `${baseName}/${t.table}.csv.gz`,
      filePath: path.join(tablesDir, `${t.table}.csv.gz`),
    })),
  ]);
  const { size: sizeBytes } = await stat(archivePath);

  signal.throwIfAborted();
  const drive = getDriveClient();
  const upload = await drive.files.create(
    {
      requestBody: { name: fileName, parents: [folderId], mimeType: 'application/gzip' },
      media: { mimeType: 'application/gzip', body: createReadStream(archivePath) },
      fields: 'id, name',
      supportsAllDrives: true,
    },
    { signal },
  );
  const driveFileId = upload.data.id;
  if (!driveFileId) throw new Error('Drive upload returned no file id');

  // Retention failures shouldn't mark a successful backup as failed,
  // but they are reported in the sheet row.
  let deletedOldBackups: string[] = [];
  let retentionError: string | undefined;
  try {
    deletedOldBackups = await trashOldBackups(drive, folderId, driveFileId, branch, signal);
  } catch (err) {
    retentionError = err instanceof Error ? err.message : String(err);
    logger.error('[DbBackup] Failed to trash old backups:', err);
  }

  return {
    fileName,
    driveFileId,
    sizeBytes,
    tableCount: tables.length,
    totalRows,
    deletedOldBackups,
    retentionError,
  };
}

export async function runDatabaseBackup(
  trigger: 'cron' | 'manual' = 'cron',
  options: { timeoutMs?: number } = {},
): Promise<DbBackupResult> {
  const branch = getDatabaseBranch();
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? BACKUP_TIMEOUT_MS;

  if (running) {
    return {
      success: false,
      trigger,
      branch,
      durationMs: 0,
      error: 'A backup is already running',
    };
  }
  running = true;

  const controller = new AbortController();
  const ctx: { workDir?: string } = {};
  let timer: NodeJS.Timeout | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const limit =
          timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} minutes` : `${timeoutMs / 1000}s`;
        const err = new Error(`Backup timed out after ${limit} and was stopped`);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    const work = performBackup(trigger, branch, controller.signal, ctx);
    // If the timeout wins, the aborted work rejects later; don't let that go unhandled.
    work.catch(() => undefined);

    const done = await Promise.race([work, timedOut]);
    const result: DbBackupResult = {
      success: true,
      trigger,
      branch,
      ...done,
      durationMs: Date.now() - started,
    };

    logger.log('[DbBackup] Backup completed', result);
    appendErrorLogToSheet({
      type: 'db_backup',
      page: `db-backup (${trigger})`,
      summary: `✅ Database backup succeeded: ${done.fileName} (${formatBytes(done.sizeBytes)}, ${done.tableCount} tables, ${done.totalRows.toLocaleString()} rows)`,
      details: [
        `Branch: ${branch}`,
        `Duration: ${Math.round(result.durationMs / 1000)}s`,
        `Trashed old backups: ${done.deletedOldBackups.length ? done.deletedOldBackups.join(', ') : 'none'}`,
        done.retentionError ? `⚠️ Retention cleanup failed: ${done.retentionError}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      record: done.fileName,
      sourceId: done.driveFileId,
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const result: DbBackupResult = {
      success: false,
      trigger,
      branch,
      durationMs: Date.now() - started,
      error: error.message,
    };
    logger.error('[DbBackup] Backup FAILED:', error);
    appendErrorLogToSheet({
      type: 'db_backup',
      page: `db-backup (${trigger})`,
      summary: `❌ Database backup FAILED: ${error.message}`,
      details: `Branch: ${branch}\nDuration: ${Math.round(result.durationMs / 1000)}s`,
      stack: error.stack ?? null,
    });
    return result;
  } finally {
    clearTimeout(timer);
    // Stop anything still in flight (no-op after a normal finish).
    if (!controller.signal.aborted) controller.abort(new Error('Backup finished'));
    running = false;
    if (ctx.workDir) {
      await rm(ctx.workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
