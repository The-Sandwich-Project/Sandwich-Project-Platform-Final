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
import { JWT } from 'google-auth-library';
import { getDatabaseUrl, getDatabaseBranch } from '../db-url';
import { repairPrivateKey } from '../google-sheets-key-repair';
import { appendErrorLogToSheet } from './error-log-sheet-sync';
import { logger } from '../utils/production-safe-logger';

const RETENTION_WEEKS = 10;
const FILE_PREFIX = 'tsp-db-backup-';
// Matches only files this job creates: tsp-db-backup-YYYY-MM-DD.tar.gz
// (and tsp-db-backup-dev-YYYY-MM-DD.tar.gz for manual runs against the dev branch).
const BACKUP_NAME_RE = /^tsp-db-backup-(?:dev-)?(\d{4}-\d{2}-\d{2})\.tar\.gz$/;

export interface TableExport {
  table: string;
  rows: number;
  bytes: number;
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

async function exportTables(workDir: string): Promise<TableExport[]> {
  const connectionString = getDatabaseUrl();
  if (!connectionString) throw new Error('Database URL not configured');

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 30_000,
    application_name: 'tsp-weekly-backup',
  });
  // An idle-connection error on this client must not crash the process.
  client.on('error', (err) => logger.error('[DbBackup] pg client error:', err));

  await client.connect();
  try {
    // One read-only snapshot so all tables are consistent with each other.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname = 'public' ORDER BY tablename`,
    );
    if (rows.length === 0) throw new Error('No tables found in public schema');

    const exports: TableExport[] = [];
    for (const { tablename } of rows) {
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

    await client.query('COMMIT');
    return exports;
  } finally {
    await client.end().catch((err) => logger.error('[DbBackup] Error closing pg client:', err));
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
  const auth = new JWT({
    email,
    key: repairPrivateKey(privateKey, true),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function deleteOldBackups(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  keepFileId: string,
): Promise<string[]> {
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
    });
    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name || file.id === keepFileId) continue;
      const match = BACKUP_NAME_RE.exec(file.name);
      if (!match || match[1] >= cutoffStr) continue;
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
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

export async function runDatabaseBackup(
  trigger: 'cron' | 'manual' = 'cron',
): Promise<DbBackupResult> {
  const branch = getDatabaseBranch();
  const started = Date.now();

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

  let workDir: string | undefined;
  try {
    const folderId = process.env.BACKUP_DRIVE_FOLDER_ID?.trim();
    if (!folderId) throw new Error('BACKUP_DRIVE_FOLDER_ID not configured');

    const dateStr = easternDateString();
    const baseName = `${FILE_PREFIX}${branch === 'dev' ? 'dev-' : ''}${dateStr}`;
    const fileName = `${baseName}.tar.gz`;

    workDir = await mkdtemp(path.join(tmpdir(), 'tsp-db-backup-'));
    const tablesDir = path.join(workDir, 'tables');
    await mkdir(tablesDir);

    logger.log(`[DbBackup] Starting ${trigger} backup of ${branch} database`);
    const tables = await exportTables(tablesDir);
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
        },
        null,
        2,
      ),
    );

    const archivePath = path.join(workDir, fileName);
    await writeTarGz(archivePath, [
      { name: `${baseName}/manifest.json`, filePath: manifestPath },
      ...tables.map((t) => ({
        name: `${baseName}/${t.table}.csv.gz`,
        filePath: path.join(tablesDir, `${t.table}.csv.gz`),
      })),
    ]);
    const { size: sizeBytes } = await stat(archivePath);

    const drive = getDriveClient();
    const upload = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId], mimeType: 'application/gzip' },
      media: { mimeType: 'application/gzip', body: createReadStream(archivePath) },
      fields: 'id, name',
      supportsAllDrives: true,
    });
    const driveFileId = upload.data.id;
    if (!driveFileId) throw new Error('Drive upload returned no file id');

    // Retention failures shouldn't mark a successful backup as failed,
    // but they are reported in the sheet row.
    let deletedOldBackups: string[] = [];
    let retentionError: string | undefined;
    try {
      deletedOldBackups = await deleteOldBackups(drive, folderId, driveFileId);
    } catch (err) {
      retentionError = err instanceof Error ? err.message : String(err);
      logger.error('[DbBackup] Failed to prune old backups:', err);
    }

    const result: DbBackupResult = {
      success: true,
      trigger,
      branch,
      fileName,
      driveFileId,
      sizeBytes,
      tableCount: tables.length,
      totalRows,
      durationMs: Date.now() - started,
      deletedOldBackups,
      retentionError,
    };

    logger.log('[DbBackup] Backup completed', result);
    appendErrorLogToSheet({
      type: 'db_backup',
      page: `db-backup (${trigger})`,
      summary: `✅ Database backup succeeded: ${fileName} (${formatBytes(sizeBytes)}, ${tables.length} tables, ${totalRows.toLocaleString()} rows)`,
      details: [
        `Branch: ${branch}`,
        `Duration: ${Math.round(result.durationMs / 1000)}s`,
        `Deleted old backups: ${deletedOldBackups.length ? deletedOldBackups.join(', ') : 'none'}`,
        retentionError ? `⚠️ Retention cleanup failed: ${retentionError}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      record: fileName,
      sourceId: driveFileId,
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
    running = false;
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
