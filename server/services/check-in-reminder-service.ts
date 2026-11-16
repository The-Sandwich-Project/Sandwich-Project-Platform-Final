/**
 * Check-In Reminder Processing Service
 *
 * Processes user-configured recurring reminders for event requests.
 * Supports multiple rule types per event:
 *   - no_contact: No contact attempt logged in X days
 *   - stale_event: No updates on event for X days
 *   - date_approaching_inprocess: Desired date nearing while still in-process
 *   - date_approaching_scheduled: Scheduled event date approaching
 *   - staffing_unmet: Unmet staffing needs X days before scheduled event
 *   - general_checkin: General periodic check-in (legacy)
 */

import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { eventCheckInReminders, eventReminderSnoozes, eventRequests, users, notifications, REMINDER_RULE_TYPES } from '@shared/schema';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { getUserMetadata, getCheckInReminderPreferences } from '@shared/types';
import { isScheduledOrRescheduled, STATUS_DEFINITIONS, type EventStatus } from '../../shared/event-status-workflow';
import { sendTSPFollowupReminderSMS } from '../sms-service';
import {
  calculateNextDue,
  ReminderFrequency,
  CONDITION_COOLDOWN_FREQUENCY,
  CONDITION_CHECK_FREQUENCY,
} from '../utils/reminder-scheduling';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Rule type display labels and descriptions for emails
/**
 * Reminder copy. Tone: friendly heads-up. The team are the experts on their
 * events, so messages state what we noticed + give contact info; they never
 * tell people how to run the process. Never say "overdue" or "needs attention".
 */
type ReminderEvent = typeof eventRequests.$inferSelect;

/** Rules that no longer send (staffing → Volunteer Hub later; missing details folded into date reminders). */
const RETIRED_RULE_TYPES = new Set<string>([
  REMINDER_RULE_TYPES.STAFFING_UNMET,
  REMINDER_RULE_TYPES.MISSING_DETAILS,
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function wholeDays(ms: number): number {
  return Math.max(0, Math.round(ms / MS_PER_DAY));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function lastContactDate(event: ReminderEvent): Date | null {
  const log = event.contactAttemptsLog as Array<{ timestamp: string }> | null;
  if (!log || log.length === 0) return null;
  const latest = log.reduce((max, e) => (e.timestamp > max ? e.timestamp : max), log[0].timestamp);
  return new Date(latest);
}

function formatEventDate(d: Date | string | null | undefined): string {
  if (!d) return 'TBD';
  return new Date(d).toLocaleDateString('en-US', {
    // Event dates are date-only values stored as UTC midnight: format in UTC
    // so the calendar day isn't shifted back by the Eastern offset.
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** Critical info still blank on an event (used for the date-approaching reminders). */
function missingEventInfo(event: ReminderEvent): string[] {
  const missing: string[] = [];
  if (!event.eventStartTime) missing.push('the event time');
  if (!event.eventAddress) missing.push('the address');
  const hasCount =
    (event.estimatedSandwichCount ?? 0) > 0 ||
    (event.estimatedSandwichCountMin ?? 0) > 0;
  if (!hasCount) missing.push('the sandwich count');
  const types = event.sandwichTypes as any[] | null;
  if (!types || types.length === 0) missing.push('the sandwich types');
  return missing;
}

export type ReminderMessage = {
  /** Subject line, bell title */
  subject: string;
  /** Body sentences shown before the contact info */
  intro: string;
  /** Optional sentence shown after the contact info */
  outro?: string;
  /** Short phrase for the one-time summary list */
  short: string;
};

export function buildReminderMessage(ruleType: string, thresholdDays: number, event: ReminderEvent): ReminderMessage {
  const org = event.organizationName || 'this group';
  const now = Date.now();

  switch (ruleType) {
    case REMINDER_RULE_TYPES.NO_CONTACT: {
      const last = lastContactDate(event);
      const days = last
        ? wholeDays(now - last.getTime())
        : wholeDays(now - new Date(event.createdAt).getTime());
      const badgeLine = days >= 7
        ? `If now isn't a good time, no worries. Next time you're in the app, this event's card will show a "follow-up needed" badge as a reminder.`
        : `If now isn't a good time, no worries. Once it's been a week, this event's card will show a "follow-up needed" badge as a reminder.`;
      return {
        subject: `No contact reminder for ${org}`,
        intro: last
          ? `It's been ${plural(days, 'day')} since the last contact attempt was logged for ${org}. Here's their contact info if you'd like to reach out now.`
          : `No contact attempt has been logged yet for ${org}, which came in ${plural(days, 'day')} ago. Here's their contact info if you'd like to reach out now.`,
        outro: badgeLine,
        short: last ? `no contact logged in ${plural(days, 'day')}` : 'no contact logged yet',
      };
    }

    case REMINDER_RULE_TYPES.STALE_EVENT: {
      const days = wholeDays(now - new Date(event.updatedAt ?? event.createdAt).getTime());
      return {
        subject: `${org}'s event hasn't been updated in ${plural(days, 'day')}`,
        intro: `Just a heads-up that ${org}'s event hasn't been updated in ${plural(days, 'day')}. Have you heard anything new from them, or would it help to check in again? Here's their contact info:`,
        short: `not updated in ${plural(days, 'day')}`,
      };
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_INPROCESS: {
      const days = wholeDays(new Date(event.desiredEventDate!).getTime() - now);
      const missing = missingEventInfo(event);
      const missingLine = missing.length
        ? ` For reference, ${joinList(missing)} ${missing.length === 1 ? "hasn't" : "haven't"} been recorded yet.`
        : '';
      return {
        subject: `${org}'s event is coming up in ${plural(days, 'day')}`,
        intro: `${org}'s requested date is ${plural(days, 'day')} from now (${formatEventDate(event.desiredEventDate)}), and it's still set to In Process in the app. Has anything new come in that would let you schedule it, or should it move to Stalled, Declined, or Cancelled?${missingLine} Here's their contact info in case it's useful:`,
        short: `requested date in ${plural(days, 'day')}, still In Process`,
      };
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_SCHEDULED: {
      const days = wholeDays(new Date(event.scheduledEventDate!).getTime() - now);
      const missing = missingEventInfo(event);
      const sentences: string[] = [];
      if (missing.length) {
        sentences.push(`${org}'s event is set for ${formatEventDate(event.scheduledEventDate)}, and ${joinList(missing)} ${missing.length === 1 ? "hasn't" : "haven't"} been recorded yet.`);
      } else {
        sentences.push(`${org}'s event is set for ${formatEventDate(event.scheduledEventDate)}.`);
      }
      if (!event.addedToOfficialSheet) {
        sentences.push(`It also hasn't been marked as added to the planning sheet yet.`);
      }
      const shortBits = [...missing.map(m => m.replace(/^the /, ''))];
      if (!event.addedToOfficialSheet) shortBits.push('planning sheet');
      return {
        subject: `${org}'s event is coming up in ${plural(days, 'day')} and is missing some information`,
        intro: `${sentences.join(' ')} Here's the contact's info in case you need to reach out for anything:`,
        short: `coming up in ${plural(days, 'day')}, missing ${joinList(shortBits)}`,
      };
    }

    case REMINDER_RULE_TYPES.GENERAL_CHECKIN:
    default:
      return {
        subject: `Your regular check-in on ${org}`,
        intro: `Here's your regular check-in on ${org}'s event. Nothing needed unless something has changed. Their contact info, in case it's handy:`,
        short: 'regular check-in',
      };
  }
}

function contactDetails(event: ReminderEvent): { name: string; phone: string | null; email: string | null } {
  const name = [event.firstName, event.lastName].filter(Boolean).join(' ').trim() || 'No contact name on file';
  return { name, phone: event.phone || null, email: event.email || null };
}

function contactHtml(event: ReminderEvent): string {
  const c = contactDetails(event);
  return `
    <div style="background: white; border-left: 4px solid #FBAD3F; padding: 16px; margin: 16px 0; border-radius: 4px;">
      <p style="margin: 0 0 6px 0; font-size: 16px; font-weight: 600; color: #1f2937;">${escapeHtml(c.name)}</p>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563;">Phone: ${c.phone ? `<a href="tel:${escapeHtml(c.phone)}" style="color:#236383;">${escapeHtml(c.phone)}</a>` : 'not on file'}</p>
      <p style="margin: 0; font-size: 14px; color: #4b5563;">Email: ${c.email ? `<a href="mailto:${escapeHtml(c.email)}" style="color:#236383;">${escapeHtml(c.email)}</a>` : 'not on file'}</p>
    </div>`;
}

function contactText(event: ReminderEvent): string {
  const c = contactDetails(event);
  return [c.name, c.phone, c.email].filter(Boolean).join(' · ');
}

/**
 * Standard List-Unsubscribe header: gives Gmail/Outlook their built-in
 * "Unsubscribe" link and helps keep reminders out of spam.
 */
function reminderUnsubscribeHeaders(baseUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<mailto:katie@thesandwichproject.org?subject=Unsubscribe%20from%20reminders>, <${baseUrl}/profile?tab=notifications>`,
  };
}

function friendlyStatus(status: string): string {
  return STATUS_DEFINITIONS[status as EventStatus]?.label || status.replace(/_/g, ' ');
}


function isConditionBasedRule(ruleType: string): boolean {
  return ruleType !== REMINDER_RULE_TYPES.GENERAL_CHECKIN;
}

/**
 * Evaluate whether a reminder rule's condition is currently met.
 * Returns true if the condition IS met (i.e., the reminder SHOULD fire).
 */
function evaluateRuleCondition(
  ruleType: string,
  thresholdDays: number,
  event: any
): boolean {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;

  switch (ruleType) {
    case REMINDER_RULE_TYPES.NO_CONTACT: {
      // Only applies to in_process events
      if (event.status !== 'in_process') return false;
      const contactLog = event.contactAttemptsLog as Array<{ timestamp: string }> | null;
      if (!contactLog || contactLog.length === 0) {
        // Never contacted: count from when the request came in
        const created = event.createdAt ? new Date(event.createdAt) : null;
        if (!created) return true;
        return (now.getTime() - created.getTime()) / msPerDay >= thresholdDays;
      }
      // Find the most recent contact attempt
      const lastAttempt = contactLog.reduce((latest: string, entry: { timestamp: string }) => {
        return entry.timestamp > latest ? entry.timestamp : latest;
      }, contactLog[0].timestamp);
      const daysSinceContact = (now.getTime() - new Date(lastAttempt).getTime()) / msPerDay;
      return daysSinceContact >= thresholdDays;
    }

    case REMINDER_RULE_TYPES.STALE_EVENT: {
      // Only applies to in_process events
      if (event.status !== 'in_process') return false;
      const lastUpdated = event.updatedAt ? new Date(event.updatedAt) : null;
      if (!lastUpdated) return true;
      const daysSinceUpdate = (now.getTime() - lastUpdated.getTime()) / msPerDay;
      return daysSinceUpdate >= thresholdDays;
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_INPROCESS: {
      // Only applies to in_process events with a desired date
      if (event.status !== 'in_process') return false;
      const desiredDate = event.desiredEventDate ? new Date(event.desiredEventDate) : null;
      if (!desiredDate) return false;
      const daysUntilDate = (desiredDate.getTime() - now.getTime()) / msPerDay;
      return daysUntilDate <= thresholdDays && daysUntilDate >= 0;
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_SCHEDULED: {
      // Scheduled events coming up that are still missing critical info
      // (time, address, sandwich count/types) or aren't on the planning sheet.
      if (!isScheduledOrRescheduled(event.status)) return false;
      const scheduledDate = event.scheduledEventDate ? new Date(event.scheduledEventDate) : null;
      if (!scheduledDate) return false;
      const daysUntilDate = (scheduledDate.getTime() - now.getTime()) / msPerDay;
      if (daysUntilDate > thresholdDays || daysUntilDate < 0) return false;
      return missingEventInfo(event).length > 0 || !event.addedToOfficialSheet;
    }

    case REMINDER_RULE_TYPES.STAFFING_UNMET:
    case REMINDER_RULE_TYPES.MISSING_DETAILS:
      // Retired: staffing alerts will live in the Volunteer Hub; missing
      // details are now part of the two date-approaching reminders.
      return false;

    case REMINDER_RULE_TYPES.GENERAL_CHECKIN:
    default:
      // General check-in always fires when due (frequency-based only)
      return true;
  }
}

/** HTML for a single-event reminder email (exported for previews/tests). */
export function renderReminderEmailHtml(
  userName: string,
  event: ReminderEvent,
  msg: ReminderMessage,
  baseUrl: string,
): string {
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.id}`;
  return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #236383, #007E8C); padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">${escapeHtml(msg.subject)}</h2>
          </div>
          <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; color: #374151;">Hi ${escapeHtml(userName)},</p>
            <p style="font-size: 15px; color: #4b5563;">${escapeHtml(msg.intro)}</p>
            ${contactHtml(event)}
            ${msg.outro ? `<p style="font-size: 15px; color: #4b5563;">${escapeHtml(msg.outro)}</p>` : ''}
            <a href="${eventUrl}" style="display: inline-block; background: #007E8C; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 12px 0;">
              Open the event
            </a>
            <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
              You can change how often you get these, or turn them off, anytime in
              <a href="${baseUrl}/profile?tab=notifications" style="color: #236383;">Profile → Alerts</a>.
            </p>
          </div>
          ${EMAIL_FOOTER_HTML}
        </div>
      `;
}

async function sendReminderEmail(
  email: string,
  userName: string,
  event: ReminderEvent,
  msg: ReminderMessage,
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  const baseUrl = getAppBaseUrl();

  try {
    await sgMail.send({
      to: email,
      from: 'katie@thesandwichproject.org',
      subject: msg.subject,
      headers: reminderUnsubscribeHeaders(baseUrl),
      html: renderReminderEmailHtml(userName, event, msg, baseUrl),
    });
    return true;
  } catch (error) {
    logger.error(`Failed to send reminder email to ${email}:`, error);
    return false;
  }
}

async function sendReminderSMS(
  phoneNumber: string,
  event: ReminderEvent,
  msg: ReminderMessage,
): Promise<boolean> {
  const eventUrl = `${getAppBaseUrl()}/dashboard?section=event-requests&tab=all&eventId=${event.id}`;
  const message = `TSP reminder: ${msg.subject}. Contact: ${contactText(event)}. ${eventUrl}`;

  try {
    const result = await sendTSPFollowupReminderSMS(phoneNumber, message);
    return result.success;
  } catch (error) {
    logger.error('Failed to send reminder SMS:', error);
    return false;
  }
}

/** Days an event in the first-run summary waits before it can send its own reminder. */
const BACKLOG_GRACE_DAYS = 7;

/**
 * First run for a user (no baseline yet): instead of one reminder per event
 * that is ALREADY overdue, send a single summary listing them, and give those
 * reminders a grace period. After that, reminders behave normally — only
 * problems that arise later fire individually. Runs again after the user
 * saves new settings (the baseline is cleared then).
 */
async function baselineUserBacklog(user: typeof users.$inferSelect): Promise<void> {
  const metadata = getUserMetadata(user);
  if (metadata.checkInRemindersBaselinedAt) return;

  const rows = await db
    .select()
    .from(eventCheckInReminders)
    .where(and(eq(eventCheckInReminders.userId, user.id), eq(eventCheckInReminders.enabled, true)));

  const condRows = rows.filter(r => isConditionBasedRule(r.ruleType) && !RETIRED_RULE_TYPES.has(r.ruleType));
  const eventIds = [...new Set(condRows.map(r => r.eventRequestId))];
  const events = eventIds.length
    ? await db.select().from(eventRequests).where(inArray(eventRequests.id, eventIds))
    : [];
  const eventById = new Map(events.map(e => [e.id, e]));

  // event id -> labels of rules already triggered
  const backlog = new Map<number, string[]>();
  const graceUntil = new Date();
  graceUntil.setDate(graceUntil.getDate() + BACKLOG_GRACE_DAYS);
  graceUntil.setHours(9, 0, 0, 0);

  // Respect any pauses the user set before per-event controls were retired,
  // the same way the regular reminder loop does.
  const activeSnoozes = eventIds.length
    ? await db
        .select()
        .from(eventReminderSnoozes)
        .where(
          and(
            eq(eventReminderSnoozes.userId, user.id),
            eq(eventReminderSnoozes.active, true),
            inArray(eventReminderSnoozes.eventRequestId, eventIds),
          ),
        )
    : [];
  const isSnoozed = (event: ReminderEvent): boolean => {
    const snooze = activeSnoozes.find(sn => sn.eventRequestId === event.id);
    if (!snooze) return false;
    if (snooze.snoozeType === 'until_contact') {
      const last = lastContactDate(event);
      return !(last && last > snooze.createdAt);
    }
    return !!snooze.snoozedUntil && new Date() <= snooze.snoozedUntil;
  };

  for (const row of condRows) {
    const event = eventById.get(row.eventRequestId);
    if (!event || event.deletedAt) continue;
    if (isSnoozed(event)) continue;
    if (!evaluateRuleCondition(row.ruleType, row.thresholdDays || 7, event)) continue;
    const label = buildReminderMessage(row.ruleType, row.thresholdDays || 7, event).short;
    backlog.set(event.id, [...(backlog.get(event.id) || []), label]);
    await db
      .update(eventCheckInReminders)
      .set({ nextDueAt: graceUntil, updatedAt: new Date() })
      .where(eq(eventCheckInReminders.id, row.id));
  }

  if (backlog.size > 0) {
    const baseUrl = getAppBaseUrl();
    const items = [...backlog.entries()].map(([id, labels]) => ({
      id,
      orgName: eventById.get(id)?.organizationName || 'Unknown Organization',
      labels,
    }));
    const count = items.length;
    const title = 'A quick look at your events';
    const message = `${count} event${count === 1 ? '' : 's'} could use a look when you have time:\n` +
      items.map(i => `• ${i.orgName}: ${i.labels.join(', ')}`).join('\n');

    await db.insert(notifications).values({
      userId: user.id,
      type: 'reminder',
      priority: 'high',
      title,
      message,
      category: 'events',
      relatedType: 'event_request_summary',
      actionUrl: '/dashboard?section=event-requests&tab=my_assignments',
      actionText: 'Open my events',
      metadata: { eventIds: items.map(i => i.id), source: 'check_in_reminder_summary' },
    });

    const prefs = getCheckInReminderPreferences(user);
    const email = user.preferredEmail || user.email;
    if (process.env.SENDGRID_API_KEY && email && (prefs.defaultChannel === 'email' || prefs.defaultChannel === 'both')) {
      const userName = user.displayName || user.firstName || 'there';
      const list = items
        .map(i => `<li style="margin-bottom:8px;"><a href="${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${i.id}" style="color:#007E8C;font-weight:600;">${escapeHtml(i.orgName)}</a><br/><span style="font-size:13px;color:#6b7280;">${i.labels.join(', ')}</span></li>`)
        .join('');
      try {
        await sgMail.send({
          to: email,
          from: 'katie@thesandwichproject.org',
          subject: title,
          headers: reminderUnsubscribeHeaders(baseUrl),
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #236383, #007E8C); padding: 20px; border-radius: 8px 8px 0 0;">
                <h2 style="color: white; margin: 0;">${title}</h2>
              </div>
              <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="font-size: 16px; color: #374151;">Hi ${escapeHtml(userName)},</p>
                <p style="font-size: 15px; color: #4b5563;">
                  Here's a quick snapshot of ${count === 1 ? 'an event' : 'a few events'} that could use a look when you have time.
                  We put ${count === 1 ? 'it' : 'them'} together in one email so they don't arrive one at a time.
                </p>
                <ul style="padding-left: 18px; color: #1f2937;">${list}</ul>
                <p style="font-size: 14px; color: #6b7280;">
                  No rush. We'll hold off on separate reminders for these for the next week.
                  If anything's still open after that, you'll get a gentle nudge for just that one.
                </p>
                <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
                  You can change how often you get these, or turn them off, anytime in
              <a href="${baseUrl}/profile?tab=notifications" style="color: #236383;">Profile → Alerts</a>.
                </p>
              </div>
              ${EMAIL_FOOTER_HTML}
            </div>
          `,
        });
      } catch (error) {
        logger.error(`[CheckInReminders] Failed to send backlog summary email to user ${user.id}:`, error);
      }
    }
    if (prefs.defaultChannel === 'sms' || prefs.defaultChannel === 'both') {
      const smsConsent = metadata.smsConsent;
      if (smsConsent?.enabled && smsConsent.phoneNumber) {
        try {
          await sendTSPFollowupReminderSMS(
            smsConsent.phoneNumber,
            `TSP: ${count === 1 ? '1 of your events' : `${count} of your events`} could use a look when you have time. ${baseUrl}/dashboard?section=event-requests&tab=my_assignments`,
          );
        } catch (error) {
          logger.error(`[CheckInReminders] Failed to send backlog summary SMS to user ${user.id}:`, error);
        }
      }
    }
    logger.info(`[CheckInReminders] Sent backlog summary to user ${user.id} (${count} events)`);
  }

  // Set only the baseline key (don't overwrite the rest of metadata, which the
  // user may have changed meanwhile), and only if their reminder settings are
  // still the ones this summary was built from. If they saved new settings
  // mid-run, leave it unset so the next run summarizes under the new ones.
  const prefsAtRead = metadata.checkInReminderPreferences;
  const prefsUnchanged = prefsAtRead
    ? sql`(${users.metadata} -> 'checkInReminderPreferences') = ${JSON.stringify(prefsAtRead)}::jsonb`
    : sql`(${users.metadata} -> 'checkInReminderPreferences') IS NULL`;
  await db
    .update(users)
    .set({
      metadata: sql`jsonb_set(coalesce(${users.metadata}, '{}'::jsonb), '{checkInRemindersBaselinedAt}', to_jsonb(${new Date().toISOString()}::text))`,
    })
    .where(and(eq(users.id, user.id), prefsUnchanged));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * For every user (own settings, or org defaults if unset), auto-provision per-event
 * rows on any assigned events that don't have rows yet.  This runs once
 * per cron cycle and is idempotent — if rows already exist, it skips.
 */
async function applyGlobalDefaultsToNewEvents(): Promise<number> {
  let provisioned = 0;
  try {
    // Find users who have global defaults configured
    const allUsers = await db.select().from(users);
    const activeStatuses = ['new', 'in_process', 'scheduled', 'stalled'];

    for (const user of allUsers) {
      // Deactivated accounts keep old assignments; don't send them reminders.
      if (user.isActive === false) continue;
      // Users who never saved their own settings get the org defaults.
      const prefs = getCheckInReminderPreferences(user);

      const enabledRules = prefs.rules.filter(r => r.enabled && !RETIRED_RULE_TYPES.has(r.ruleType));
      const enabledCorpRules = prefs.corporateRules?.filter(r => r.enabled && !RETIRED_RULE_TYPES.has(r.ruleType)) ?? [];
      if (enabledRules.length === 0 && enabledCorpRules.length === 0) continue;

      // Find events this user is TSP contact for (either tspContactAssigned or tspContact)
      const assignedEvents = await db
        .select({ id: eventRequests.id, status: eventRequests.status, isCorporatePriority: eventRequests.isCorporatePriority })
        .from(eventRequests)
        .where(
          and(
            or(
              eq(eventRequests.tspContactAssigned, user.id),
              eq(eventRequests.tspContact, user.id),
            ),
            sql`${eventRequests.status} IN (${sql.join(activeStatuses.map(s => sql`${s}`), sql`, `)})`,
            sql`${eventRequests.deletedAt} IS NULL`,
          ),
        );

      for (const event of assignedEvents) {
        // Check if this event already has any rules for this user
        const [existingRule] = await db
          .select({ id: eventCheckInReminders.id })
          .from(eventCheckInReminders)
          .where(
            and(
              eq(eventCheckInReminders.eventRequestId, event.id),
              eq(eventCheckInReminders.userId, user.id),
            ),
          )
          .limit(1);

        if (existingRule) continue; // Already has per-event rules

        // Determine which rule set to use
        const isCorp = event.isCorporatePriority === true;
        const rulesToApply = isCorp && enabledCorpRules.length > 0
          ? enabledCorpRules
          : enabledRules;

        // Create per-event rows from defaults
        for (const rule of rulesToApply) {
          const isCondBased = rule.ruleType !== 'general_checkin';
          await db.insert(eventCheckInReminders).values({
            eventRequestId: event.id,
            userId: user.id,
            ruleType: rule.ruleType,
            enabled: true,
            thresholdDays: rule.thresholdDays,
            frequency: isCondBased ? 'daily' : rule.frequency,
            channel: prefs.defaultChannel,
            nextDueAt: calculateNextDue(isCondBased ? 'daily' : rule.frequency as ReminderFrequency),
          }).onConflictDoNothing(); // unique index prevents duplicates
          provisioned++;
        }
      }

      // First run for this user: roll anything already overdue into one summary.
      try {
        await baselineUserBacklog(user);
      } catch (error) {
        logger.error(`[CheckInReminders] Backlog summary failed for user ${user.id}:`, error);
      }
    }
  } catch (error) {
    logger.error('[CheckInReminders] Error applying global defaults:', error);
  }
  return provisioned;
}

export async function processCheckInReminders(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  try {
    // Auto-provision per-event rules from global defaults for new events
    const provisioned = await applyGlobalDefaultsToNewEvents();
    if (provisioned > 0) {
      logger.info(`[CheckInReminders] Provisioned ${provisioned} rules from global defaults`);
    }

    // Get all enabled reminders that are due
    const dueReminders = await db
      .select()
      .from(eventCheckInReminders)
      .where(
        and(
          eq(eventCheckInReminders.enabled, true),
          lte(eventCheckInReminders.nextDueAt, now)
        )
      );

    if (dueReminders.length === 0) {
      return { processed: 0, sent: 0, errors: 0 };
    }

    logger.info(`[CheckInReminders] Processing ${dueReminders.length} due reminders`);

    // Prefetch all active snoozes for the affected event+user pairs to avoid per-reminder N+1 queries.
    const affectedEventIds = [...new Set(dueReminders.map(r => r.eventRequestId))];
    const allActiveSnoozes = affectedEventIds.length > 0
      ? await db
          .select()
          .from(eventReminderSnoozes)
          .where(
            and(
              inArray(eventReminderSnoozes.eventRequestId, affectedEventIds),
              eq(eventReminderSnoozes.active, true),
            ),
          )
      : [];
    // Build a lookup map keyed by "eventRequestId:userId" for O(1) access in the loop
    const snoozeMap = new Map<string, typeof allActiveSnoozes[0]>();
    for (const snooze of allActiveSnoozes) {
      snoozeMap.set(`${snooze.eventRequestId}:${snooze.userId}`, snooze);
    }

    for (const reminder of dueReminders) {
      processed++;

      try {
        // Get the event request with all fields needed for condition evaluation
        const [event] = await db
          .select()
          .from(eventRequests)
          .where(eq(eventRequests.id, reminder.eventRequestId))
          .limit(1);

        if (!event || event.deletedAt) {
          // Event deleted or doesn't exist - disable reminder
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
        }

        // Skip completed/declined events - auto-disable
        if (['completed', 'declined', 'cancelled'].includes(event.status || '')) {
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
        }

        // Check for active snooze on this event+user (using prefetched map)
        const activeSnooze = snoozeMap.get(`${reminder.eventRequestId}:${reminder.userId}`) ?? null;

        if (activeSnooze) {
          let snoozeSuppressed = false;

          if (activeSnooze.snoozeType === 'until_contact') {
            // Auto-cancel if a new contact was logged after the snooze was created
            const contactLog = event.contactAttemptsLog as Array<{ timestamp: string }> | null;
            const latestContact = contactLog?.reduce(
              (latest: string | null, entry: { timestamp: string }) =>
                !latest || entry.timestamp > latest ? entry.timestamp : latest,
              null,
            );
            if (latestContact && new Date(latestContact) > activeSnooze.createdAt) {
              // Contact logged since snooze — auto-cancel
              await db
                .update(eventReminderSnoozes)
                .set({ active: false, cancelledAt: new Date() })
                .where(eq(eventReminderSnoozes.id, activeSnooze.id));
              snoozeMap.delete(`${reminder.eventRequestId}:${reminder.userId}`);
              logger.info(`[CheckInReminders] Auto-cancelled until_contact snooze for event ${reminder.eventRequestId} (new contact logged)`);
            } else {
              snoozeSuppressed = true;
            }
          } else if (activeSnooze.snoozedUntil) {
            // Timed or until_date: check if snooze has expired
            if (now <= activeSnooze.snoozedUntil) {
              snoozeSuppressed = true;
            } else {
              // Snooze expired — auto-cancel
              await db
                .update(eventReminderSnoozes)
                .set({ active: false, cancelledAt: new Date() })
                .where(eq(eventReminderSnoozes.id, activeSnooze.id));
              snoozeMap.delete(`${reminder.eventRequestId}:${reminder.userId}`);
            }
          }

          if (snoozeSuppressed) {
            // For timed/until_date snoozes, reschedule to just after snooze end to avoid daily writes.
            // For until_contact (open-ended), fall back to daily check.
            let nextDue: Date;
            if (activeSnooze.snoozedUntil) {
              // Re-check the day after the snooze expires (9 AM)
              nextDue = new Date(activeSnooze.snoozedUntil);
              nextDue.setDate(nextDue.getDate() + 1);
              nextDue.setHours(9, 0, 0, 0);
            } else {
              nextDue = calculateNextDue('daily');
            }
            await db
              .update(eventCheckInReminders)
              .set({ nextDueAt: nextDue, updatedAt: new Date() })
              .where(eq(eventCheckInReminders.id, reminder.id));
            continue;
          }
        }

        // Retired reminder types: switch the row off instead of sending.
        if (RETIRED_RULE_TYPES.has(reminder.ruleType)) {
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
        }

        // Evaluate whether the rule's condition is met
        const conditionMet = evaluateRuleCondition(
          reminder.ruleType,
          reminder.thresholdDays || 7,
          event
        );

        if (!conditionMet) {
          // Condition not met — reschedule for next check but don't send
          // Condition-based rules recheck daily; frequency-based use their frequency
          const nextDue = isConditionBasedRule(reminder.ruleType)
            ? calculateNextDue(CONDITION_CHECK_FREQUENCY)
            : calculateNextDue(reminder.frequency as ReminderFrequency);
          await db
            .update(eventCheckInReminders)
            .set({ nextDueAt: nextDue, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
        }

        // Get the user
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, reminder.userId))
          .limit(1);

        if (!user) {
          errors++;
          continue;
        }

        const userName = user.displayName || user.firstName || 'there';
        const msg = buildReminderMessage(reminder.ruleType, reminder.thresholdDays || 7, event);

        // Always record the reminder in the in-app notification bell first,
        // so it exists even if email/SMS isn't configured or fails to send.
        try {
          await db.insert(notifications).values({
            userId: reminder.userId,
            type: 'reminder',
            priority: 'medium',
            title: msg.subject,
            message: `${msg.intro}\nContact: ${contactText(event)}${msg.outro ? `\n${msg.outro}` : ''}`,
            category: 'events',
            relatedType: 'event_request',
            relatedId: event.id,
            actionUrl: `/dashboard?section=event-requests&tab=all&eventId=${event.id}`,
            actionText: 'Open the event',
            metadata: { eventId: event.id, ruleType: reminder.ruleType, source: 'check_in_reminder' },
          });
        } catch (notifError) {
          logger.error(`[CheckInReminders] Failed to create in-app notification for reminder ${reminder.id}:`, notifError);
        }

        let emailSent = false;
        let smsSent = false;

        if (reminder.channel === 'email' || reminder.channel === 'both') {
          const email = user.preferredEmail || user.email;
          if (email) {
            emailSent = await sendReminderEmail(email, userName, event, msg);
          }
        }

        if (reminder.channel === 'sms' || reminder.channel === 'both') {
          const metadata = getUserMetadata(user);
          const smsConsent = metadata.smsConsent;
          if (smsConsent?.enabled && smsConsent.phoneNumber) {
            smsSent = await sendReminderSMS(smsConsent.phoneNumber, event, msg);
          }
        }

        if (emailSent || smsSent) {
          sent++;
        }

        // Update lastSentAt and calculate next due date
        // Condition-based rules use a cooldown after sending to avoid spam;
        // frequency-based rules (general_checkin) use their configured frequency
        const nextDue = isConditionBasedRule(reminder.ruleType)
          ? calculateNextDue(CONDITION_COOLDOWN_FREQUENCY)
          : calculateNextDue(reminder.frequency as ReminderFrequency);
        await db
          .update(eventCheckInReminders)
          .set({
            lastSentAt: new Date(),
            nextDueAt: nextDue,
            updatedAt: new Date(),
          })
          .where(eq(eventCheckInReminders.id, reminder.id));
      } catch (error) {
        errors++;
        logger.error(`Error processing reminder ${reminder.id} (type: ${reminder.ruleType}):`, error);
      }
    }

    logger.info(
      `[CheckInReminders] Complete: ${processed} processed, ${sent} sent, ${errors} errors`
    );
  } catch (error) {
    logger.error('[CheckInReminders] Failed to process reminders:', error);
  }

  return { processed, sent, errors };
}
