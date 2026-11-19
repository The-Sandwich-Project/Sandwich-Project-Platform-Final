import { db } from '../db';
import { applicationErrorLogs } from '@shared/schema';
import { and, eq, gte, inArray, desc } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { appendErrorLogToSheet } from '../services/error-log-sheet-sync';
import { FROM_EMAIL } from '../config/organization';

export type ApplicationErrorSource =
  | 'sms_parser'
  | 'sms_webhook'
  | 'health_check'
  | 'cron'
  | 'api'
  | 'email'
  | 'database'
  | 'integration'
  | 'sync'
  | 'process'
  | 'client';

export type ApplicationErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ApplicationErrorInput {
  source: ApplicationErrorSource;
  severity?: ApplicationErrorSeverity;
  category?: string;
  message: string;
  details?: Record<string, unknown>;
  userId?: string;
  phoneNumber?: string;
  requestPath?: string;
  /** Email admin for error/critical (deduped within 6 hours for same fingerprint) */
  notifyAdmin?: boolean;
}

const ADMIN_EMAIL = 'katie@thesandwichproject.org';
const DEDUP_HOURS = 6;

async function shouldSendAdminEmail(input: ApplicationErrorInput): Promise<boolean> {
  const since = new Date();
  since.setHours(since.getHours() - DEDUP_HOURS);

  const conditions = [
    eq(applicationErrorLogs.source, input.source),
    eq(applicationErrorLogs.message, input.message),
    gte(applicationErrorLogs.createdAt, since),
    eq(applicationErrorLogs.emailSent, true),
  ];

  if (input.category) {
    conditions.push(eq(applicationErrorLogs.category, input.category));
  }

  const recent = await db
    .select({ id: applicationErrorLogs.id })
    .from(applicationErrorLogs)
    .where(and(...conditions))
    .limit(1);

  return recent.length === 0;
}

async function sendAdminNotification(
  input: ApplicationErrorInput,
  logId: number
): Promise<boolean> {
  try {
    const { sendEmail } = await import('./sendgrid');
    const severity = input.severity || 'error';
    const detailsJson = input.details
      ? JSON.stringify(input.details, null, 2)
      : '';

    await sendEmail({
      emailStream: 'operational',
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject: `[TSP App ${severity.toUpperCase()}] ${input.source}: ${input.message.slice(0, 80)}`,
      text: [
        `Source: ${input.source}`,
        `Category: ${input.category || 'n/a'}`,
        `Severity: ${severity}`,
        `Time: ${new Date().toISOString()}`,
        input.phoneNumber ? `Phone: ${input.phoneNumber}` : '',
        input.requestPath ? `Path: ${input.requestPath}` : '',
        input.userId ? `User: ${input.userId}` : '',
        `Log ID: #${logId}`,
        '',
        detailsJson ? `Details:\n${detailsJson}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #c0392b;">Application Error — ${severity.toUpperCase()}</h2>
          <p><strong>Source:</strong> ${input.source}</p>
          <p><strong>Category:</strong> ${input.category || 'n/a'}</p>
          <p><strong>Message:</strong> ${input.message}</p>
          ${input.phoneNumber ? `<p><strong>Phone:</strong> ${input.phoneNumber}</p>` : ''}
          ${input.requestPath ? `<p><strong>Path:</strong> ${input.requestPath}</p>` : ''}
          <p><strong>Log ID:</strong> #${logId}</p>
          ${detailsJson ? `<pre style="background:#f4f4f4;padding:12px;border-radius:4px;overflow:auto;">${detailsJson}</pre>` : ''}
        </div>
      `,
    });

    await db
      .update(applicationErrorLogs)
      .set({ emailSent: true })
      .where(eq(applicationErrorLogs.id, logId));

    return true;
  } catch (err) {
    logger.error('[ApplicationErrorLogger] Failed to email admin:', err);
    return false;
  }
}

/**
 * Collapse a message into a stable fingerprint by stripping the parts that
 * vary between otherwise-identical errors (ids, uuids, timestamps, quoted
 * values), so repeats of the same failure group together in the digest.
 */
function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d[\d.,:-]*\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Escape user-influenced text before interpolating into the digest email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ErrorDigestGroup {
  source: string;
  category: string | null;
  severity: string;
  sample: string;
  count: number;
  last: Date;
}

/**
 * Roll up the last 24h of error/critical logs into ONE grouped summary email
 * to the admin. Runs from a daily cron. Sends nothing when there were no errors
 * (no "all clear" noise). All errors remain in the DB table + Google Sheet
 * regardless — this is purely the notification channel.
 */
export async function sendDailyErrorDigest(): Promise<{
  sent: boolean;
  total: number;
  groups: number;
}> {
  // Millisecond offset keeps the window exactly 24h regardless of DST shifts
  // (setHours(getHours()-24) would be 23h/25h across a transition).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      source: applicationErrorLogs.source,
      severity: applicationErrorLogs.severity,
      category: applicationErrorLogs.category,
      message: applicationErrorLogs.message,
      createdAt: applicationErrorLogs.createdAt,
    })
    .from(applicationErrorLogs)
    .where(
      and(
        gte(applicationErrorLogs.createdAt, since),
        inArray(applicationErrorLogs.severity, ['error', 'critical'])
      )
    )
    .orderBy(desc(applicationErrorLogs.createdAt));

  if (rows.length === 0) {
    logger.log('[ApplicationErrorLogger] Daily digest: no errors in the last 24h, skipping email');
    return { sent: false, total: 0, groups: 0 };
  }

  const groups = new Map<string, ErrorDigestGroup>();
  for (const r of rows) {
    const key = `${r.source}|${r.category || ''}|${normalizeMessage(r.message)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (r.createdAt > existing.last) existing.last = r.createdAt;
      if (r.severity === 'critical') existing.severity = 'critical';
    } else {
      groups.set(key, {
        source: r.source,
        category: r.category ?? null,
        severity: r.severity,
        sample: r.message,
        count: 1,
        last: r.createdAt,
      });
    }
  }

  // Most frequent first (best for triage), ties broken by most recent.
  const sorted = [...groups.values()].sort(
    (a, b) => b.count - a.count || b.last.getTime() - a.last.getTime()
  );
  const criticalCount = rows.filter((r) => r.severity === 'critical').length;

  const textLines = sorted.map(
    (g) =>
      `• [${g.severity}] ${g.source}/${g.category || 'general'} ×${g.count} — ${g.sample.slice(0, 140)} (last: ${g.last.toISOString()})`
  );
  const htmlRows = sorted
    .map((g) => {
      // Error messages are user-influenced — escape every interpolated field.
      const severity = escapeHtml(g.severity);
      const sourceLabel = escapeHtml(`${g.source}/${g.category || 'general'}`);
      const sample = escapeHtml(g.sample.slice(0, 160));
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${g.severity === 'critical' ? '🔴' : '🟠'} ${severity}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${sourceLabel}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${g.count}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${sample}</td>
        </tr>`;
    })
    .join('');

  try {
    const { sendEmailWithResult } = await import('../sendgrid');
    const sendResult = await sendEmailWithResult({
      emailStream: 'operational',
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject: `[TSP App] Daily error digest — ${rows.length} errors, ${sorted.length} types${criticalCount ? `, ${criticalCount} critical` : ''}`,
      text: [
        `Errors in the last 24 hours: ${rows.length} (${sorted.length} distinct types${criticalCount ? `, ${criticalCount} critical` : ''}).`,
        `Critical errors were also emailed individually when they occurred.`,
        `Full detail lives in the admin error log and the error-log Google Sheet.`,
        '',
        ...textLines,
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 720px;">
          <h2 style="color:#236383;">Daily Error Digest</h2>
          <p><strong>${rows.length}</strong> errors in the last 24 hours across <strong>${sorted.length}</strong> distinct types${criticalCount ? `, including <strong>${criticalCount}</strong> critical` : ''}.</p>
          <p style="color:#666;font-size:13px;">Critical errors were also emailed individually as they happened. Full detail is in the admin error log and the error-log Google Sheet.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <thead>
              <tr style="background:#f4f4f4;text-align:left;">
                <th style="padding:6px 10px;">Severity</th>
                <th style="padding:6px 10px;">Source</th>
                <th style="padding:6px 10px;text-align:right;">Count</th>
                <th style="padding:6px 10px;">Example message</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>
      `,
    });
    // sendEmail resolves false (not throws) on a missing key or SendGrid
    // rejection, so check the result explicitly — otherwise a failed delivery
    // would be recorded as a successful digest and that 24h window lost.
    if (!sendResult.success) {
      logger.error(
        `[ApplicationErrorLogger] Daily digest email failed: ${sendResult.error || 'unknown'}`
      );
      return { sent: false, total: rows.length, groups: sorted.length };
    }
    logger.log(`[ApplicationErrorLogger] Daily digest sent: ${rows.length} errors, ${sorted.length} groups`);
    return { sent: true, total: rows.length, groups: sorted.length };
  } catch (err) {
    logger.error('[ApplicationErrorLogger] Failed to send daily error digest:', err);
    return { sent: false, total: rows.length, groups: sorted.length };
  }
}

/**
 * Persist a server-side error for the admin error log. Fire-and-forget — never throws.
 */
export function logApplicationError(input: ApplicationErrorInput): void {
  const severity = input.severity || 'error';

  logger.warn(`[ApplicationError] ${input.source}/${input.category || 'general'}: ${input.message}`, {
    severity,
    details: input.details,
  });

  void (async () => {
    try {
      const [row] = await db
        .insert(applicationErrorLogs)
        .values({
          source: input.source,
          severity,
          category: input.category,
          message: input.message,
          details: input.details || {},
          userId: input.userId,
          phoneNumber: input.phoneNumber,
          requestPath: input.requestPath,
        })
        .returning({ id: applicationErrorLogs.id });

      // Only CRITICAL errors page the admin immediately. Everything at 'error'
      // severity is captured in the DB (+ Google Sheet) and rolled up into the
      // once-daily digest email (see sendDailyErrorDigest) so a high-traffic day
      // produces one summary instead of a flood of per-error messages.
      const shouldNotify =
        input.notifyAdmin !== false && severity === 'critical';

      if (shouldNotify && row?.id) {
        const canEmail = await shouldSendAdminEmail(input);
        if (canEmail) {
          await sendAdminNotification(input, row.id);
        }
      }

      if (
        row?.id &&
        input.source !== 'client' &&
        (severity === 'error' || severity === 'critical')
      ) {
        appendErrorLogToSheet({
          type: 'app_error',
          timestamp: new Date(),
          userName: null,
          userEmail: null,
          page: input.requestPath || null,
          summary: input.message,
          details: input.details ? JSON.stringify(input.details).slice(0, 4000) : null,
          sourceId: row.id,
        });
      }
    } catch (err) {
      logger.error('[ApplicationErrorLogger] Failed to persist error log:', err);
    }
  })();
}

/** Log from a caught Error/unknown with optional context prefix */
export function logFromException(
  error: unknown,
  input: Omit<ApplicationErrorInput, 'message'> & {
    message?: string;
    context?: string;
  }
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = input.message || (input.context ? `${input.context}: ${err.message}` : err.message);

  logApplicationError({
    ...input,
    message,
    details: {
      ...input.details,
      stack: err.stack,
    },
  });
}

/** Log an HTTP/API error with request context (skips 4xx by default) */
export function logHttpError(
  error: unknown,
  req: { method?: string; originalUrl?: string; url?: string; user?: { id?: string } },
  options?: {
    moduleId?: string;
    severity?: ApplicationErrorSeverity;
    notifyAdmin?: boolean;
    minStatus?: number;
  }
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const status = (error as any)?.status || (error as any)?.statusCode || 500;
  const minStatus = options?.minStatus ?? 500;

  if (status < minStatus) return;

  const path = req.originalUrl || req.url || 'unknown';
  const moduleId = options?.moduleId;

  logApplicationError({
    source: 'api',
    severity: options?.severity || (status >= 500 ? 'error' : 'warning'),
    category: moduleId || 'http',
    message: err.message,
    details: {
      method: req.method,
      status,
      stack: err.stack,
    },
    userId: req.user?.id,
    requestPath: path,
    notifyAdmin: options?.notifyAdmin ?? status >= 500,
  });
}
