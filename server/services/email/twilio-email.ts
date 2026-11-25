/**
 * The ONE place the app sends email: Twilio Email API (Twilio Email in One
 * Console). Replaces SendGrid.
 *
 *   POST https://comms.twilio.com/v1/Emails
 *   Authorization: Basic base64(TWILIO_EMAIL_API_KEY:TWILIO_EMAIL_API_SECRET)
 *   202 Accepted -> { operationId, operationLocation }
 *
 * Env vars (Replit Secrets). These are email-only; SMS keeps its own
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER and the Replit
 * Twilio connector, which this file never reads.
 *   TWILIO_EMAIL_API_KEY     restricted API key SID (Comms -> Emails: Read + Create)
 *   TWILIO_EMAIL_API_SECRET  that key's secret
 *   EMAIL_FROM_ADDRESS       default From, on the domain verified in Twilio
 *
 * Things Twilio Email doesn't have, and what this helper does instead:
 *   - CC / BCC: each CC, BCC and admin copy is sent as its own request, so
 *     recipients never see each other's addresses.
 *   - Reply-To: when replyTo differs from From, a "To reply, email ..." line is
 *     added to the top of the body.
 *   - Unsubscribe groups: every copy gets its own email-preferences link
 *     (./preferences.ts), and email_suppressions is checked before sending
 *     (./suppressions.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/production-safe-logger';
import { ADMIN_EMAIL, ORG_NAME } from '../../config/organization';
import { getSuppressionScopes, isSuppressedFor, normalizeEmail } from './suppressions';
import { addPreferencesFooter, listUnsubscribeHeaders } from './preferences';
import type {
  Base64Attachment,
  EmailAddressInput,
  EmailAttachmentInput,
  EmailParams,
  EmailRecipients,
  FileAttachment,
  SendEmailResult,
} from './types';

export * from './types';

export const TWILIO_EMAIL_ENDPOINT = 'https://comms.twilio.com/v1/Emails';
/** Twilio rejects requests over 10 MB, attachments included. */
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
    public readonly suppressed = false
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

interface Mailbox {
  address: string;
  name?: string;
}

/** Twilio Email config, read at call time so a Secrets change needs no code change. */
export function getEmailConfig() {
  return {
    apiKey: process.env.TWILIO_EMAIL_API_KEY?.trim() || '',
    apiSecret: process.env.TWILIO_EMAIL_API_SECRET?.trim() || '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS?.trim() || '',
  };
}

/** Names of the required email env vars that aren't set. */
export function missingEmailConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.TWILIO_EMAIL_API_KEY?.trim()) missing.push('TWILIO_EMAIL_API_KEY');
  if (!process.env.TWILIO_EMAIL_API_SECRET?.trim()) missing.push('TWILIO_EMAIL_API_SECRET');
  if (!process.env.EMAIL_FROM_ADDRESS?.trim()) missing.push('EMAIL_FROM_ADDRESS');
  return missing;
}

export function isEmailConfigured(): boolean {
  return missingEmailConfig().length === 0;
}

/** The default From address (EMAIL_FROM_ADDRESS). */
export function defaultFromAddress(): string {
  return getEmailConfig().fromAddress || ADMIN_EMAIL;
}

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

export function parseMailbox(input: EmailAddressInput): Mailbox | null {
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) return null;
    const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (match) {
      const name = match[1].trim();
      return { address: match[2].trim(), ...(name ? { name } : {}) };
    }
    return { address: raw };
  }
  if (!input || typeof input.email !== 'string' || !input.email.trim()) return null;
  const name = input.name?.trim();
  return { address: input.email.trim(), ...(name ? { name } : {}) };
}

function toMailboxes(input: EmailRecipients | undefined): Mailbox[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const out: Mailbox[] = [];
  for (const item of list) {
    // Tolerate comma-separated strings, which SendGrid accepted.
    if (typeof item === 'string' && item.includes(',') && !item.includes('<')) {
      for (const part of item.split(',')) {
        const mb = parseMailbox(part);
        if (mb) out.push(mb);
      }
      continue;
    }
    const mb = parseMailbox(item);
    if (mb) out.push(mb);
  }
  return out;
}

const ASCII_ADDRESS = /^[\x21-\x7e]+@[\x21-\x7e]+$/;

function describeTo(to: EmailRecipients): string {
  return toMailboxes(to)
    .map((m) => m.address)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Twilio requires html. Turn a plain-text body into simple HTML. */
export function textToHtml(text: string): string {
  return `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</div>`;
}

function insertAfterBodyOpen(html: string, snippet: string): string {
  const match = html.match(/<body[^>]*>/i);
  if (!match || match.index === undefined) return snippet + html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + snippet + html.slice(at);
}

/** "To reply, email Brenda Smith at brenda@gmail.com" (Twilio has no Reply-To). */
export function addReplyToLine(
  content: { html: string; text?: string },
  replyTo: Mailbox
): { html: string; text?: string } {
  const who = replyTo.name ? `${replyTo.name} at ${replyTo.address}` : replyTo.address;
  const htmlLine = `<p style="font-family: Arial, sans-serif; color: #555; font-size: 13px; margin: 0 0 12px 0;">To reply, email ${
    replyTo.name ? `${escapeHtml(replyTo.name)} at ` : ''
  }<a href="mailto:${escapeHtml(replyTo.address)}">${escapeHtml(replyTo.address)}</a>.</p>`;
  return {
    html: insertAfterBodyOpen(content.html, htmlLine),
    text: content.text !== undefined ? `To reply, email ${who}.\n\n${content.text}` : undefined,
  };
}

/**
 * Twilio Email runs Liquid templating over the subject, html and text, and
 * REJECTS the whole email (HTTP 400 "Template validation failed") when it sees
 * `{{ something }}` without a default. We never use Liquid, so any `{{` or `{%`
 * in our content is literal text (a stray merge tag, a code sample) and must
 * not be read as a tag:
 *  - html: the first brace becomes the entity `&#123;`, which displays as `{`.
 *  - subject / text: a zero-width space goes between the two characters, so it
 *    still reads as `{{` but is no longer a Liquid opener.
 */
const ZERO_WIDTH_SPACE = '\u200B';
export function neutralizeLiquidHtml(html: string): string {
  return html.replace(/\{(?=[{%])/g, '&#123;');
}
export function neutralizeLiquidText(text: string): string {
  return text.replace(/\{(?=[{%])/g, `{${ZERO_WIDTH_SPACE}`);
}

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

interface TwilioAttachment {
  filename: string;
  contentType: string;
  content: string;
  cid?: string;
}

function isBase64Attachment(a: EmailAttachmentInput): a is Base64Attachment {
  return !!a && typeof a === 'object' && 'content' in a && 'filename' in a;
}

/** Convert attachments to Twilio's shape. Files that can't be read are skipped with a warning. */
export function toTwilioAttachments(list: EmailAttachmentInput[] | undefined): TwilioAttachment[] {
  if (!list || list.length === 0) return [];
  const out: TwilioAttachment[] = [];
  for (const attachment of list) {
    try {
      if (isBase64Attachment(attachment)) {
        const ext = path.extname(attachment.filename).toLowerCase();
        const cid = attachment.cid || attachment.contentId;
        out.push({
          filename: attachment.filename,
          contentType:
            attachment.contentType || attachment.type || CONTENT_TYPES[ext] || 'application/octet-stream',
          content: attachment.content,
          ...(cid ? { cid } : {}),
        });
        continue;
      }
      const filePath = typeof attachment === 'string' ? attachment : (attachment as FileAttachment).filePath;
      const originalName = typeof attachment === 'string' ? undefined : (attachment as FileAttachment).originalName;
      if (!fs.existsSync(filePath)) {
        logger.warn(`[email] Attachment file not found, skipped: ${filePath}`);
        continue;
      }
      const filename = originalName || path.basename(filePath);
      out.push({
        filename,
        contentType: CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        content: fs.readFileSync(filePath).toString('base64'),
      });
    } catch (error) {
      logger.error('[email] Failed to read attachment, skipped:', error);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface TwilioEmailRequest {
  from: { address: string; name: string };
  to: Array<{ address: string; name?: string }>;
  content: {
    subject: string;
    html: string;
    text?: string;
    attachments?: TwilioAttachment[];
    headers?: Record<string, string>;
  };
  tags?: Record<string, string>;
  schedule?: { sendAt: string[] };
}

async function logEmailFailure(message: string, details: Record<string, unknown>) {
  try {
    // Imported lazily: the error logger itself sends email through this file.
    const { logApplicationError } = await import('../application-error-logger');
    logApplicationError({ source: 'email', severity: 'error', category: 'twilio-email', message, details, notifyAdmin: false });
  } catch {
    /* logging must never break sending */
  }
}

/** POST one request to Twilio. Throws EmailSendError on anything but 2xx. */
async function postToTwilio(body: TwilioEmailRequest): Promise<string | undefined> {
  const { apiKey, apiSecret } = getEmailConfig();
  if (!apiKey || !apiSecret) {
    throw new EmailSendError(`Email is not configured: ${missingEmailConfig().join(', ')} not set`);
  }

  const json = JSON.stringify(body);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_REQUEST_BYTES) {
    throw new EmailSendError(
      `Email is too large to send (${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB including attachments).`
    );
  }

  let response: Response;
  try {
    response = await fetch(TWILIO_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: json,
    });
  } catch (error) {
    throw new EmailSendError(
      `Could not reach Twilio Email: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    // Log status + body only. Never the Authorization header or the key.
    logger.error(`[email] Twilio Email rejected the request: HTTP ${response.status} ${responseText}`);
    let reason = responseText;
    try {
      const parsed = JSON.parse(responseText);
      reason = parsed?.message || parsed?.detail || parsed?.error || parsed?.errors?.[0]?.message || responseText;
      if (typeof reason !== 'string') reason = JSON.stringify(reason);
    } catch {
      /* not JSON */
    }
    throw new EmailSendError(
      `Twilio Email returned ${response.status}${reason ? `: ${reason.slice(0, 500)}` : ''}`,
      response.status,
      responseText
    );
  }

  try {
    const parsed = JSON.parse(responseText);
    return parsed?.operationId;
  } catch {
    return undefined;
  }
}

interface Delivery {
  mailbox: Mailbox;
  /** Main recipient (failure fails the send) vs a CC/BCC/admin copy (logged only). */
  primary: boolean;
  /** Admin monitoring copy: never suppressed. */
  isAdminCopy: boolean;
}

function buildRequest(
  params: EmailParams,
  from: Mailbox,
  delivery: Delivery,
  baseContent: { html: string; text?: string },
  attachments: TwilioAttachment[]
): TwilioEmailRequest {
  const content = addPreferencesFooter(baseContent, delivery.mailbox.address);
  const merged = {
    ...(params.emailStream === 'newsletter' ? listUnsubscribeHeaders(delivery.mailbox.address) : {}),
    ...(params.headers || {}),
  };
  const headers = Object.keys(merged).length > 0 ? merged : undefined;
  const request: TwilioEmailRequest = {
    from: { address: from.address, name: from.name || ORG_NAME },
    to: [{ address: delivery.mailbox.address, ...(delivery.mailbox.name ? { name: delivery.mailbox.name } : {}) }],
    content: {
      subject: neutralizeLiquidText(params.subject),
      html: neutralizeLiquidHtml(content.html),
      ...(content.text ? { text: neutralizeLiquidText(content.text) } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(headers ? { headers } : {}),
    },
  };
  const tags = { stream: params.emailStream, ...(params.tags || {}) };
  request.tags = Object.fromEntries(
    Object.entries(tags)
      .filter(([k, v]) => /^[a-zA-Z0-9._~-]+$/.test(k) && /^[a-zA-Z0-9._~-]+$/.test(String(v)))
      .slice(0, 10)
  );
  if (params.sendAt) {
    const sendAt = params.sendAt instanceof Date ? params.sendAt.toISOString() : params.sendAt;
    request.schedule = { sendAt: [sendAt] };
  }
  return request;
}

/**
 * Send an email and report the outcome. Never throws.
 * Adds the admin monitoring copy unless `adminCopy: false`.
 */
export async function sendEmailWithResult(params: EmailParams): Promise<SendEmailResult> {
  return sendInternal({ ...params, adminCopy: params.adminCopy ?? true });
}

/** Boolean wrapper around sendEmailWithResult() (admin copy on by default). */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  return (await sendEmailWithResult(params)).success;
}

/**
 * Send an email; throws EmailSendError if it fails (like @sendgrid/mail's
 * send()). No admin copy unless `adminCopy: true`. A send skipped because the
 * recipient unsubscribed is logged and does NOT throw.
 */
export async function sendEmailOrThrow(params: EmailParams): Promise<SendEmailResult> {
  const result = await sendInternal({ ...params, adminCopy: params.adminCopy ?? false });
  if (!result.success && !result.suppressed) {
    throw new EmailSendError(result.error || 'Email send failed', result.status);
  }
  return result;
}

async function sendInternal(params: EmailParams): Promise<SendEmailResult> {
  const toLabel = describeTo(params.to);
  try {
    const missing = missingEmailConfig().filter((v) => v !== 'EMAIL_FROM_ADDRESS' || !params.from);
    if (missing.length > 0) {
      logger.warn(`[email] Not sent to ${toLabel}: ${missing.join(', ')} not set`);
      return { success: false, error: `Email is not configured: ${missing.join(', ')} not set` };
    }

    const from = parseMailbox(params.from ?? defaultFromAddress());
    if (!from) return { success: false, error: 'No From address' };
    if (!ASCII_ADDRESS.test(from.address)) {
      return {
        success: false,
        error: `From address "${from.address}" isn't allowed: it must be plain ASCII (Twilio Email doesn't accept Unicode in the From address).`,
      };
    }

    // Who gets a copy. Main recipients first, then CC/BCC, then the admin copy.
    const seen = new Set<string>();
    const deliveries: Delivery[] = [];
    const push = (mailboxes: Mailbox[], primary: boolean, isAdminCopy = false) => {
      for (const mailbox of mailboxes) {
        const key = normalizeEmail(mailbox.address);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deliveries.push({ mailbox, primary, isAdminCopy });
      }
    };
    push(toMailboxes(params.to), true);
    if (deliveries.length === 0) return { success: false, error: 'No recipient address' };
    push(toMailboxes(params.cc), false);
    push(toMailboxes(params.bcc), false);
    if (params.adminCopy) push([{ address: ADMIN_EMAIL }], false, true);

    // Suppressions. If the lookup fails: operational mail still goes out (a
    // password reset matters more), newsletter mail doesn't (honor unsubscribes).
    let suppressions = new Map<string, Set<any>>();
    try {
      suppressions = await getSuppressionScopes(deliveries.map((d) => d.mailbox.address));
    } catch (error) {
      if (params.emailStream === 'newsletter') {
        logger.error('[email] Suppression lookup failed; newsletter email not sent:', error);
        return { success: false, error: 'Could not check the unsubscribe list, so the newsletter email was not sent.' };
      }
      logger.error('[email] Suppression lookup failed; sending operational email anyway:', error);
    }
    const suppressed = deliveries.filter(
      (d) => !d.isAdminCopy && isSuppressedFor(suppressions.get(normalizeEmail(d.mailbox.address)), params.emailStream)
    );
    const toSend = deliveries.filter((d) => !suppressed.includes(d));
    for (const d of suppressed) {
      logger.log(`[email] Skipped ${d.mailbox.address}: unsubscribed from ${params.emailStream} email`);
    }
    if (!toSend.some((d) => d.primary)) {
      return {
        success: false,
        suppressed: true,
        error: `${suppressed.filter((d) => d.primary).map((d) => d.mailbox.address).join(', ')} unsubscribed from ${params.emailStream} emails, so nothing was sent.`,
      };
    }

    // Body. Twilio requires html.
    let content: { html: string; text?: string } = {
      html: params.html || textToHtml(params.text || ''),
      text: params.text && params.text !== params.html ? params.text : undefined,
    };
    const replyTo = params.replyTo ? parseMailbox(params.replyTo) : null;
    if (replyTo && normalizeEmail(replyTo.address) !== normalizeEmail(from.address)) {
      content = addReplyToLine(content, replyTo);
    }

    const attachments = toTwilioAttachments(params.attachments);
    const operationIds: string[] = [];

    for (const delivery of toSend.filter((d) => d.primary)) {
      try {
        const id = await postToTwilio(buildRequest(params, from, delivery, content, attachments));
        if (id) operationIds.push(id);
      } catch (error) {
        const err = error as EmailSendError;
        await logEmailFailure(err.message, {
          to: delivery.mailbox.address,
          subject: params.subject,
          status: err.status,
          responseBody: err.responseBody?.slice(0, 2000),
        });
        return { success: false, error: err.message, status: err.status, operationIds };
      }
    }

    const copies = toSend.filter((d) => !d.primary);
    const results = await Promise.allSettled(
      copies.map((d) => postToTwilio(buildRequest(params, from, d, content, attachments)))
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        if (r.value) operationIds.push(r.value);
      } else {
        logger.warn(`[email] Copy to ${copies[i].mailbox.address} failed: ${(r.reason as Error)?.message}`);
      }
    });

    logger.log(`[email] Sent "${params.subject}" to ${toLabel} (${operationIds.join(', ') || 'no operation id'})`);
    return { success: true, operationIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[email] Unexpected error sending to ${toLabel}:`, error);
    await logEmailFailure(message, { to: toLabel, subject: params.subject });
    return { success: false, error: message };
  }
}
