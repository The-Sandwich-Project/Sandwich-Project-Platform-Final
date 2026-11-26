/**
 * Event alerts: the daily digest's content (email, text message, bell entry).
 *
 * One card per event, most urgent first. Each card has everything needed to
 * act from the email itself: what triggered the alert, the event's status and
 * date, the group contact with tap-to-call / tap-to-email, and links that open
 * the app straight into the right step (log a contact attempt, mark the
 * toolkit sent, update details). Each alert line has "remind me again in N
 * days" links, which open a confirm step in the app (email scanners open
 * every link in a message, so a link alone must never change anything).
 *
 * Pure: no database or network. Rendering is unit-tested.
 */
import { EMAIL_FOOTER_HTML } from '../../utils/email-footer';
import {
  formatEventDate,
  statusLabel,
  type AlertEvent,
  type AlertLine,
} from './rules';

/** Snooze lengths offered in the email; "other" opens the app to pick any number. */
export const SNOOZE_CHOICES: { days: number; label: string }[] = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
];

export type DigestEvent = AlertEvent & {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  toolkitSent?: boolean | null;
  toolkitStatus?: string | null;
};

export type DigestItem = {
  event: DigestEvent;
  lines: AlertLine[];
  /** Longest snooze allowed (null = no limit, 0 = none); see maxSnoozeDays */
  maxSnoozeDays: number | null;
};

export type RenderedDigest = {
  subject: string;
  html: string;
  /** Plain list for the bell notification */
  bellMessage: string;
  sms: string;
};

const TEAL = '#007E8C';
const NAVY = '#236383';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function digestSubject(count: number): string {
  return count === 1 ? '1 of your events could use a look' : `${count} of your events could use a look`;
}

/** Deep link into the event in the app; `action` opens a specific step. */
export function eventLink(
  baseUrl: string,
  eventId: number,
  action?: 'log-contact' | 'toolkit' | 'edit' | 'snooze',
  extra: Record<string, string> = {},
): string {
  const p = new URLSearchParams({ section: 'event-requests', tab: 'all', eventId: String(eventId) });
  if (action) p.set('action', action);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `${baseUrl}/dashboard?${p.toString()}`;
}

/** "14:30" -> "2:30 PM"; passes anything else through. */
function formatTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function dateLine(e: DigestEvent): string {
  const scheduled = e.status === 'scheduled' || e.status === 'rescheduled';
  if (scheduled && e.scheduledEventDate) {
    const t = formatTime(e.eventStartTime);
    return `Scheduled ${formatEventDate(e.scheduledEventDate)}${t ? ` at ${t}` : ''}`;
  }
  return e.desiredEventDate ? `Requested ${formatEventDate(e.desiredEventDate)}` : 'No requested date yet';
}

function contactName(e: DigestEvent): string {
  return [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
}

/** Toolkit step only makes sense before scheduling, and only if not already sent. */
function showToolkitAction(e: DigestEvent): boolean {
  const preSchedule = e.status === 'new' || e.status === 'in_process';
  const done = !!e.toolkitSent || (e.toolkitStatus && e.toolkitStatus !== 'not_sent');
  return preSchedule && !done;
}

function button(href: string, label: string, primary = false): string {
  const style = primary
    ? `background:${TEAL};color:#ffffff;border:1px solid ${TEAL};`
    : `background:#ffffff;color:${TEAL};border:1px solid ${TEAL};`;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;${style}padding:8px 12px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin:4px 6px 0 0;">${escapeHtml(label)}</a>`;
}

function snoozeLinks(baseUrl: string, item: DigestItem, line: AlertLine): string {
  const max = item.maxSnoozeDays;
  if (max === 0) return '';
  const choices = SNOOZE_CHOICES.filter(c => max === null || c.days <= max);
  const rule = line.ruleTypes.join(',');
  const links = [
    ...choices.map(c => ({ href: eventLink(baseUrl, item.event.id, 'snooze', { rule, days: String(c.days) }), label: c.label })),
    { href: eventLink(baseUrl, item.event.id, 'snooze', { rule }), label: 'other' },
  ]
    .map(l => `<a href="${escapeHtml(l.href)}" style="color:${NAVY};">${escapeHtml(l.label)}</a>`)
    .join(' &middot; ');
  return `<div style="font-size:12px;color:#6b7280;margin:2px 0 0 0;">Remind me again in: ${links}</div>`;
}

function contactBlock(baseUrl: string, e: DigestEvent): string {
  const name = contactName(e);
  const editHref = eventLink(baseUrl, e.id, 'edit');
  const missing = () =>
    `<span style="color:#9ca3af;">not on file</span> &middot; <a href="${escapeHtml(editHref)}" style="color:${NAVY};">add it</a>`;
  const phone = e.phone?.trim();
  const email = e.email?.trim();
  const tel = phone ? phone.replace(/[^\d+]/g, '') : '';
  return `
    <div style="background:#f9fafb;border-radius:6px;padding:10px 12px;margin:10px 0 4px 0;font-size:14px;color:#374151;">
      <div style="font-weight:600;margin-bottom:4px;">${name ? escapeHtml(name) : '<span style="color:#9ca3af;">No contact name on file</span>'}</div>
      <div>Phone: ${phone ? `<a href="tel:${escapeHtml(tel)}" style="color:${NAVY};">${escapeHtml(phone)}</a>` : missing()}</div>
      <div>Email: ${email ? `<a href="mailto:${escapeHtml(email)}" style="color:${NAVY};">${escapeHtml(email)}</a>` : missing()}</div>
    </div>`;
}

function card(baseUrl: string, item: DigestItem): string {
  const e = item.event;
  const org = e.organizationName || 'Unnamed group';
  const lines = item.lines
    .map(l => `
      <li style="margin:0 0 8px 0;">
        <div style="font-size:14px;color:#1f2937;">${escapeHtml(l.line)}</div>
        ${snoozeLinks(baseUrl, item, l)}
      </li>`)
    .join('');
  const actions = [
    button(eventLink(baseUrl, e.id, 'log-contact'), 'Log a contact attempt', true),
    showToolkitAction(e) ? button(eventLink(baseUrl, e.id, 'toolkit'), 'Mark toolkit sent') : '',
    button(eventLink(baseUrl, e.id, 'edit'), 'Update details'),
    button(eventLink(baseUrl, e.id), 'Open event'),
  ].join('');
  return `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-left:4px solid #FBAD3F;border-radius:8px;padding:14px 16px;margin:0 0 14px 0;">
      <a href="${escapeHtml(eventLink(baseUrl, e.id))}" style="font-size:17px;font-weight:700;color:${NAVY};text-decoration:none;">${escapeHtml(org)}</a>
      <div style="font-size:13px;color:#6b7280;margin:2px 0 10px 0;">${escapeHtml(statusLabel(e.status))} &middot; ${escapeHtml(dateLine(e))}</div>
      <ul style="padding-left:18px;margin:0;">${lines}</ul>
      ${contactBlock(baseUrl, e)}
      <div style="margin-top:6px;">${actions}</div>
    </div>`;
}

export function renderDigest(userName: string, items: DigestItem[], baseUrl: string): RenderedDigest {
  const n = items.length;
  const subject = digestSubject(n);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, ${NAVY}, ${TEAL}); padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0;">${escapeHtml(subject)}</h2>
      </div>
      <div style="padding: 20px; background: #f3f4f6; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; color: #374151; margin-top: 0;">Hi ${escapeHtml(userName)},</p>
        <p style="font-size: 15px; color: #4b5563;">
          Here's today's look at your events, most time-sensitive first. You can call or email
          each group from here, or jump into the app to log what happened.
        </p>
        ${items.map(i => card(baseUrl, i)).join('')}
        <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
          You get at most one of these a day, and only on days something comes up.
          Change which alerts you get, or turn them off, in
          <a href="${escapeHtml(`${baseUrl}/profile?tab=notifications`)}" style="color: ${NAVY};">Profile &rarr; Alerts</a>.
        </p>
      </div>
      ${EMAIL_FOOTER_HTML}
    </div>`;
  const bellMessage = items
    .map(i => `• ${i.event.organizationName || 'Unnamed group'}: ${i.lines.map(l => l.line).join('; ')}`)
    .join('\n');
  const sms = `TSP: ${subject} today. Details and links in your email, or open your events: ${baseUrl}/dashboard?section=event-requests&tab=my_assignments`;
  return { subject, html, bellMessage, sms };
}
