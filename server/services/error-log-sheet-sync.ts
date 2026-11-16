import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { logger } from '../utils/production-safe-logger';
import { assertSheetWriteAllowed } from '../sheets-write-guard';

export type ErrorLogSheetType =
  | 'user_report'
  | 'client_crash'
  | 'dynamic_error'
  | 'app_error'
  | 'db_backup';

export interface ErrorLogSheetEntry {
  type: ErrorLogSheetType;
  timestamp?: Date;
  userName?: string | null;
  userEmail?: string | null;
  page?: string | null;
  summary: string;
  details?: string | null;
  stack?: string | null;
  record?: string | null;
  sourceId?: string | number | null;
}

const HEADERS = [
  'Timestamp (ET)',
  'Type',
  'User',
  'Email',
  'Page',
  'Summary',
  'Details',
  'Stack',
  'Record',
  'Source ID',
];

let sheetsClient: ReturnType<typeof google.sheets> | null = null;
let initPromise: Promise<boolean> | null = null;

function getSheetConfig(): { spreadsheetId: string; worksheetName: string } | null {
  const spreadsheetId = process.env.ERROR_LOG_SHEET_ID?.trim();
  if (!spreadsheetId) return null;
  return {
    spreadsheetId,
    worksheetName: process.env.ERROR_LOG_WORKSHEET_NAME?.trim() || 'Error Log',
  };
}

function sheetRange(worksheetName: string, a1: string): string {
  const safeName = worksheetName.replace(/'/g, "''");
  return `'${safeName}'!${a1}`;
}

function formatTimestampEt(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function truncate(value: string | null | undefined, max = 4000): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizePrivateKey(raw: string): string {
  let key = raw;
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }
  key = key
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  if (!key.includes('\n') && key.includes('-----BEGIN PRIVATE KEY-----')) {
    const begin = '-----BEGIN PRIVATE KEY-----';
    const end = '-----END PRIVATE KEY-----';
    const beginIdx = key.indexOf(begin);
    const endIdx = key.indexOf(end);
    if (beginIdx !== -1 && endIdx !== -1) {
      const body = key.slice(beginIdx + begin.length, endIdx).replace(/\s+/g, '');
      key = `${begin}\n${body.match(/.{1,64}/g)?.join('\n') || body}\n${end}\n`;
    }
  }
  return key;
}

async function ensureSheetsClient(): Promise<boolean> {
  if (sheetsClient) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const config = getSheetConfig();
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!config || !email || !privateKey) {
      logger.warn(
        '[ErrorLogSheet] Skipping sheet sync — set ERROR_LOG_SHEET_ID and Google service account credentials',
      );
      return false;
    }

    try {
      const auth = new JWT({
        email,
        key: normalizePrivateKey(privateKey),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      sheetsClient = google.sheets({ version: 'v4', auth });
      return true;
    } catch (err) {
      logger.error('[ErrorLogSheet] Failed to initialize Google Sheets client:', err);
      sheetsClient = null;
      return false;
    }
  })();

  return initPromise;
}

async function ensureHeaderRow(
  spreadsheetId: string,
  worksheetName: string,
): Promise<void> {
  if (!sheetsClient) return;

  const headerRange = sheetRange(worksheetName, 'A1:J1');
  const existing = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const firstCell = existing.data.values?.[0]?.[0];
  if (firstCell === HEADERS[0]) return;

  assertSheetWriteAllowed({
    spreadsheetId,
    service: 'error-log-sync',
    operation: 'values.update ensureHeaderRow',
  });
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: headerRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });
}

function entryToRow(entry: ErrorLogSheetEntry): string[] {
  const when = entry.timestamp ?? new Date();
  return [
    formatTimestampEt(when),
    entry.type,
    entry.userName || '',
    entry.userEmail || '',
    truncate(entry.page, 500),
    truncate(entry.summary, 500),
    truncate(entry.details, 4000),
    truncate(entry.stack, 4000),
    truncate(entry.record, 500),
    entry.sourceId != null ? String(entry.sourceId) : '',
  ];
}

/**
 * Append one error/report row to the configured Google Sheet. Fire-and-forget — never throws.
 */
export function appendErrorLogToSheet(entry: ErrorLogSheetEntry): void {
  void (async () => {
    try {
      const config = getSheetConfig();
      if (!config) return;

      const ready = await ensureSheetsClient();
      if (!ready || !sheetsClient) return;

      await ensureHeaderRow(config.spreadsheetId, config.worksheetName);

      assertSheetWriteAllowed({
        spreadsheetId: config.spreadsheetId,
        service: 'error-log-sync',
        operation: 'values.append appendErrorLogToSheet',
      });
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range: sheetRange(config.worksheetName, 'A:J'),
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [entryToRow(entry)] },
      });

      logger.log('[ErrorLogSheet] Appended row', {
        type: entry.type,
        sourceId: entry.sourceId,
        summary: entry.summary.slice(0, 80),
      });
    } catch (err) {
      logger.error('[ErrorLogSheet] Failed to append row:', err);
    }
  })();
}

export function isErrorLogSheetConfigured(): boolean {
  return !!getSheetConfig();
}
