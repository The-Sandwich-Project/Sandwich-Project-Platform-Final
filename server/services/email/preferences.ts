/**
 * Email preferences / unsubscribe links, made by the app itself.
 *
 * Twilio Email has no unsubscribe groups or unsubscribe link, so every email
 * the helper sends gets a footer link to /api/email-preferences?t=<token>.
 *
 * Scanner-safe: corporate email scanners (Defender, Mimecast, Proofpoint) open
 * every link in an email. Opening the link (GET) only SHOWS a page; nothing
 * changes until the person submits its form (POST). This is why SendGrid's own
 * one-click link was turned off before.
 *
 * Newsletter mail also gets RFC 8058 List-Unsubscribe + List-Unsubscribe-Post
 * headers so Gmail/Yahoo can show their own unsubscribe button. Those mail
 * providers POST to the one-click URL; scanners only GET, so that's safe too.
 *
 * The token is <base64url(address)>.<HMAC>, keyed from SESSION_SECRET. It
 * doesn't expire, so links in old emails keep working. If SESSION_SECRET is
 * not set (local dev), the footer falls back to a mailto link.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getAppBaseUrl } from '../../config/constants';
import { logger } from '../../utils/production-safe-logger';
import {
  addSuppression,
  getSuppressionScopes,
  normalizeEmail,
  removeUnsubscribes,
} from './suppressions';
import type { EmailStream } from './types';

export const PREFERENCES_LINK_TEXT = 'Manage email preferences / unsubscribe';
export const PREFERENCES_PATH = '/api/email-preferences';
export const ONE_CLICK_PATH = '/api/email-preferences/one-click';
const FOOTER_MARKER = '<!-- tsp-email-preferences -->';
const CONTACT_ADDRESS = 'katie@thesandwichproject.org';
const FALLBACK_PREFERENCES_URL = `mailto:${CONTACT_ADDRESS}?subject=Email%20preferences`;

function signingKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  // Derived key, so this signature can never be confused with a session cookie.
  return crypto.createHmac('sha256', secret).update('tsp-email-preferences:v1').digest();
}

function sign(payload: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

export function createPreferencesToken(email: string): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(normalizeEmail(email), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

/** Returns the address the token was made for, or null if it's not valid. */
export function verifyPreferencesToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const key = signingKey();
  if (!key) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return email.includes('@') ? email : null;
}

export function preferencesUrl(email: string): string | null {
  const token = createPreferencesToken(email);
  if (!token) return null;
  return `${getAppBaseUrl()}${PREFERENCES_PATH}?t=${encodeURIComponent(token)}`;
}

/** Headers for newsletter mail so mail apps can offer one-click unsubscribe. */
export function listUnsubscribeHeaders(email: string): Record<string, string> {
  const token = createPreferencesToken(email);
  const mailto = `<mailto:${CONTACT_ADDRESS}?subject=Unsubscribe>`;
  if (!token) return { 'List-Unsubscribe': mailto };
  const oneClick = `${getAppBaseUrl()}${ONE_CLICK_PATH}?t=${encodeURIComponent(token)}&scope=newsletter`;
  return {
    'List-Unsubscribe': `<${oneClick}>, ${mailto}`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Insert html just before </body>, or append it if there's no body tag. */
function insertBeforeBodyClose(html: string, snippet: string): string {
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose === -1) return html + snippet;
  return html.slice(0, bodyClose) + snippet + html.slice(bodyClose);
}

/** Add the preferences link for this recipient. Safe to call twice. */
export function addPreferencesFooter(
  content: { html: string; text?: string },
  recipientEmail: string
): { html: string; text?: string } {
  const url = preferencesUrl(recipientEmail) ?? FALLBACK_PREFERENCES_URL;
  let { html, text } = content;
  if (!html.includes(FOOTER_MARKER)) {
    html = insertBeforeBodyClose(
      html,
      `${FOOTER_MARKER}<div style="margin-top: 16px; text-align: center; font-family: Arial, sans-serif;"><p style="color: #888; font-size: 11px; margin: 0;"><a href="${escapeHtml(url)}" style="color: #236383;">${PREFERENCES_LINK_TEXT}</a></p></div>`
    );
  }
  if (text && !text.includes(`${PREFERENCES_LINK_TEXT}:`)) {
    text = `${text}\n\n${PREFERENCES_LINK_TEXT}: ${url}`;
  }
  return { html, text };
}

// ---------------------------------------------------------------------------
// Public pages (no login): GET shows, POST changes.
// ---------------------------------------------------------------------------

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7f7;color:#222;margin:0;padding:16px}
main{max-width:520px;margin:40px auto;background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{color:#236383;font-size:22px;margin-top:0}
button{display:block;width:100%;margin:10px 0;padding:12px;border-radius:6px;border:1px solid #236383;background:#fff;color:#236383;font-size:15px;cursor:pointer}
button.primary{background:#236383;color:#fff}
.muted{color:#666;font-size:13px}
</style></head><body><main>${body}</main></body></html>`;
}

function invalidLinkPage(): string {
  return page(
    'Link not valid',
    `<h1>This link isn't valid</h1><p>Please use the link from a recent email, or email <a href="mailto:${CONTACT_ADDRESS}">${CONTACT_ADDRESS}</a> and we'll update your preferences.</p>`
  );
}

function describeStatus(scopes: Set<string> | undefined): string {
  if (!scopes || scopes.size === 0) return 'You currently receive all emails from The Sandwich Project.';
  if (scopes.has('all')) return 'You are currently unsubscribed from all emails.';
  const parts: string[] = [];
  if (scopes.has('newsletter')) parts.push('newsletters and announcements');
  if (scopes.has('operational')) parts.push('event and volunteer updates');
  return `You are currently unsubscribed from ${parts.join(' and ')}.`;
}

export function createEmailPreferencesRouter(): Router {
  const router = Router();

  router.get('/email-preferences', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const email = verifyPreferencesToken(req.query.t);
    if (!email) return res.status(400).type('html').send(invalidLinkPage());
    try {
      const scopes = (await getSuppressionScopes([email])).get(normalizeEmail(email));
      const token = escapeHtml(String(req.query.t));
      res.type('html').send(
        page(
          'Email preferences',
          `<h1>Email preferences</h1>
<p>For <strong>${escapeHtml(email)}</strong></p>
<p>${escapeHtml(describeStatus(scopes))}</p>
<form method="post" action="${PREFERENCES_PATH}">
  <input type="hidden" name="t" value="${token}">
  <button class="primary" name="action" value="newsletter">Unsubscribe from newsletters and announcements</button>
  <button name="action" value="all">Unsubscribe from all emails, including event and volunteer updates</button>
  <button name="action" value="resubscribe">Resubscribe to everything</button>
</form>
<p class="muted">Nothing changes until you press a button.</p>`
        )
      );
    } catch (error) {
      logger.error('[email-preferences] Failed to load preferences:', error);
      res.status(500).type('html').send(page('Something went wrong', '<h1>Something went wrong</h1><p>Please try again later.</p>'));
    }
  });

  router.post('/email-preferences', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const email = verifyPreferencesToken(req.body?.t);
    if (!email) return res.status(400).type('html').send(invalidLinkPage());
    const action = req.body?.action;
    try {
      let message: string;
      if (action === 'newsletter') {
        await addSuppression({ email, scope: 'newsletter', reason: 'unsubscribe', source: 'unsubscribe_link' });
        message = "You won't get newsletters or announcements any more. You'll still get emails about events and volunteering you're part of.";
      } else if (action === 'all') {
        await addSuppression({ email, scope: 'all', reason: 'unsubscribe', source: 'unsubscribe_link' });
        message = "You won't get any more emails from The Sandwich Project, including event and volunteer updates.";
      } else if (action === 'resubscribe') {
        await removeUnsubscribes(email);
        message = "You're subscribed again.";
      } else {
        return res.status(400).type('html').send(invalidLinkPage());
      }
      logger.log(`[email-preferences] ${action} recorded`);
      res.type('html').send(
        page(
          'Preferences saved',
          `<h1>Preferences saved</h1><p>${escapeHtml(message)}</p><p class="muted"><a href="${PREFERENCES_PATH}?t=${encodeURIComponent(String(req.body.t))}">Back to email preferences</a></p>`
        )
      );
    } catch (error) {
      logger.error('[email-preferences] Failed to save preferences:', error);
      res.status(500).type('html').send(page('Something went wrong', '<h1>Something went wrong</h1><p>Please try again later.</p>'));
    }
  });

  // RFC 8058 one-click unsubscribe (POSTed by Gmail, Yahoo, etc.).
  router.post('/email-preferences/one-click', async (req: Request, res: Response) => {
    const email = verifyPreferencesToken(req.query.t);
    if (!email) return res.status(400).send('Invalid link');
    const scope: EmailStream | 'all' =
      req.query.scope === 'operational' || req.query.scope === 'all'
        ? (req.query.scope as EmailStream | 'all')
        : 'newsletter';
    try {
      await addSuppression({ email, scope, reason: 'unsubscribe', source: 'one_click' });
      logger.log(`[email-preferences] one-click ${scope} unsubscribe recorded`);
      res.status(200).send('Unsubscribed');
    } catch (error) {
      logger.error('[email-preferences] One-click unsubscribe failed:', error);
      res.status(500).send('Error');
    }
  });

  return router;
}
