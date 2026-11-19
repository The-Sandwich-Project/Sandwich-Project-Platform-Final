/**
 * SendGrid unsubscribe handling, applied to EVERY outgoing SendGrid message.
 *
 * Why this exists: corporate email security scanners (Defender, Mimecast,
 * Proofpoint) "click" every link in an email. SendGrid's Subscription Tracking
 * link unsubscribes on a plain GET, so a scanner opening it silently put
 * volunteers on the Global Unsubscribes list and their assignment emails were
 * then dropped as "Unsubscribed Address".
 *
 * What withUnsubscribeSettings() does to a message:
 *  1. tracking_settings.subscription_tracking.enable = false, so SendGrid never
 *     appends its own one-click unsubscribe link (this overrides the account-level
 *     Subscription Tracking setting for the message).
 *  2. asm.group_id = the configured unsubscribe group for the stream, with both
 *     groups in asm.groups_to_display, so recipients can opt out of one stream
 *     without losing the other.
 *  3. Appends a visible "Manage email preferences / unsubscribe" link pointing at
 *     <%asm_preferences_raw_url%>. That page only changes anything when the
 *     recipient submits it, so a scanner opening it unsubscribes nobody.
 *  4. Operational emails only: mail_settings.bypass_unsubscribe_management, so
 *     they still reach people on the GLOBAL unsubscribe list. Per the SendGrid v3
 *     Mail Send docs this bypasses only global unsubscribes, NOT group
 *     unsubscribes, and bounce and spam-report lists are still checked. So someone
 *     who deliberately unsubscribes from the operational group on the preferences
 *     page stops getting these. bypass_list_management (which bypasses
 *     everything) is never used and is stripped if present.
 *
 * Group IDs come from env vars and are never hardcoded:
 *   SENDGRID_ASM_GROUP_ID_OPERATIONAL  e.g. "Event assignments & updates"
 *   SENDGRID_ASM_GROUP_ID_NEWSLETTER   e.g. "Newsletters & announcements"
 * If a stream's group is not configured, the message is sent without asm, and
 * the footer falls back to a mailto link because <%asm_preferences_raw_url%> is
 * only substituted when asm.group_id is set.
 */

import { logger } from './production-safe-logger';

/**
 * operational: event assignments, volunteer signups/confirmations, reminders,
 *   schedule changes, follow-ups, password resets, direct messages, admin alerts.
 * newsletter: bulk announcements, shout-outs, promotional/newsletter-style mail.
 */
export type EmailStream = 'operational' | 'newsletter';

export const ASM_GROUP_ENV_VARS: Record<EmailStream, string> = {
  operational: 'SENDGRID_ASM_GROUP_ID_OPERATIONAL',
  newsletter: 'SENDGRID_ASM_GROUP_ID_NEWSLETTER',
};

export const PREFERENCES_LINK_TEXT = 'Manage email preferences / unsubscribe';
export const ASM_PREFERENCES_TAG = '<%asm_preferences_raw_url%>';
const FALLBACK_PREFERENCES_URL =
  'mailto:katie@thesandwichproject.org?subject=Email%20preferences';
const FOOTER_MARKER = '<!-- tsp-email-preferences -->';

const warnedMissing = new Set<string>();

function readGroupId(stream: EmailStream): number | undefined {
  const envVar = ASM_GROUP_ENV_VARS[stream];
  const raw = process.env[envVar]?.trim();
  if (raw) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return id;
  }
  if (!warnedMissing.has(envVar)) {
    warnedMissing.add(envVar);
    logger.warn(
      `${envVar} is ${raw ? `invalid ("${raw}")` : 'not set'}. ${stream} emails will be sent without a SendGrid unsubscribe group, and their preferences link will fall back to email.`
    );
  }
  return undefined;
}

export function getAsmGroupIds(): Partial<Record<EmailStream, number>> {
  return {
    operational: readGroupId('operational'),
    newsletter: readGroupId('newsletter'),
  };
}

function footerHtml(url: string): string {
  return `${FOOTER_MARKER}<div style="margin-top: 16px; text-align: center; font-family: Arial, sans-serif;"><p style="color: #888; font-size: 11px; margin: 0;"><a href="${url}" style="color: #236383;">${PREFERENCES_LINK_TEXT}</a></p></div>`;
}

function footerText(url: string): string {
  return `\n\n${PREFERENCES_LINK_TEXT}: ${url}`;
}

function appendHtmlFooter(html: string, footer: string): string {
  if (html.includes(FOOTER_MARKER)) return html;
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose === -1) return html + footer;
  return html.slice(0, bodyClose) + footer + html.slice(bodyClose);
}

function appendTextFooter(text: string, url: string): string {
  if (text.includes(`${PREFERENCES_LINK_TEXT}:`)) return text;
  return text + footerText(url);
}

/**
 * Return a copy of a SendGrid message with the unsubscribe group, preferences
 * link, subscription-tracking override and (for operational mail) the global
 * unsubscribe bypass applied. Safe to call more than once on the same message.
 */
export function withUnsubscribeSettings<T extends object>(msg: T, stream: EmailStream): T {
  const out: any = { ...msg };
  const groups = getAsmGroupIds();
  const groupId = groups[stream];

  // 1. Never let SendGrid add its own (instant, GET-based) unsubscribe link.
  delete out.tracking_settings;
  out.trackingSettings = {
    ...((msg as any).trackingSettings || (msg as any).tracking_settings || {}),
    subscriptionTracking: { enable: false },
  };
  delete out.trackingSettings.subscription_tracking;

  // 2. Unsubscribe group, so <%asm_preferences_raw_url%> resolves.
  if (groupId) {
    const groupsToDisplay = Array.from(
      new Set([groups.operational, groups.newsletter].filter((g): g is number => !!g))
    );
    out.asm = { groupId, groupsToDisplay };
  } else {
    delete out.asm;
  }

  // 4. Mail settings: only operational mail bypasses the global unsubscribe list.
  //    Never bypass list management, bounces or spam reports.
  const mailSettings: any = {
    ...((msg as any).mailSettings || (msg as any).mail_settings || {}),
  };
  delete out.mail_settings;
  for (const key of [
    'bypassListManagement',
    'bypass_list_management',
    'bypassBounceManagement',
    'bypass_bounce_management',
    'bypassSpamManagement',
    'bypass_spam_management',
    'bypassUnsubscribeManagement',
    'bypass_unsubscribe_management',
  ]) {
    delete mailSettings[key];
  }
  if (stream === 'operational') {
    mailSettings.bypassUnsubscribeManagement = { enable: true };
  }
  if (Object.keys(mailSettings).length > 0) {
    out.mailSettings = mailSettings;
  } else {
    delete out.mailSettings;
  }

  // 3. Visible preferences link in every body we send.
  const url = groupId ? ASM_PREFERENCES_TAG : FALLBACK_PREFERENCES_URL;
  if (typeof out.html === 'string' && out.html.length > 0) {
    out.html = appendHtmlFooter(out.html, footerHtml(url));
  }
  if (typeof out.text === 'string' && out.text.length > 0) {
    out.text = appendTextFooter(out.text, url);
  }

  return out as T;
}

/** For tests: forget which missing env vars have already been warned about. */
export function resetUnsubscribeWarningsForTests(): void {
  warnedMissing.clear();
}
