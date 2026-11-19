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
import { withUnsubscribeSettings } from '../utils/sendgrid-unsubscribe';
import { db } from '../db';
import { eventCheckInReminders, eventReminderSnoozes, eventRequests, users, notifications, REMINDER_RULE_TYPES } from '@shared/schema';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { getUserMetadata, getCheckInReminderPreferences } from '@shared/types';
import type { CheckInReminderPreferences, DefaultReminderRule } from '@shared/types';
import { getLastContactTimestamp } from '@shared/contact-age';
import { estimateStateFromFields } from '@shared/sandwich-estimate';
import { isScheduledOrRescheduled, STATUS_DEFINITIONS, type EventStatus } from '../../shared/event-status-workflow';
import { sendTSPFollowupReminderSMS } from '../sms-service';
import {
  calculateNextDue,
  ReminderFrequency,
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

/**
 * Rules that no longer send: staffing (Volunteer Hub later), missing details
 * (folded into the date reminders), and the general timed check-in (removed
 * at the planning team's request). Existing rows switch off automatically.
 */
const RETIRED_RULE_TYPES = new Set<string>([
  REMINDER_RULE_TYPES.STAFFING_UNMET,
  REMINDER_RULE_TYPES.MISSING_DETAILS,
  REMINDER_RULE_TYPES.GENERAL_CHECKIN,
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

/** Last contact: structured log first, then the legacy lastContactAttempt field. */
function lastContactDate(event: ReminderEvent): Date | null {
  return getLastContactTimestamp(event as any);
}

/** Today's calendar date in Eastern, as a UTC-midnight timestamp. */
function easternTodayUtcMs(now: Date = new Date()): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // YYYY-MM-DD
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days from today (Eastern) until an event date. Event dates
 * are date-only values stored as UTC midnight, so use their UTC date parts.
 * 0 = today, 1 = tomorrow, negative = past.
 */
function calendarDaysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const eventDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((eventDay - easternTodayUtcMs()) / MS_PER_DAY);
}

/** "today" / "tomorrow" / "in 5 days" */
function whenPhrase(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
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
  // Normalize with the shared helper: handles JSON-string sandwichTypes,
  // ranges, and the legacy estimatedSandwichRangeType field.
  const estimate = estimateStateFromFields(event as any);
  // A count is known if there's a total, or every type line has an amount
  // (150 deli + PBJ amount TBD doesn't tell us the count).
  const hasCount = !!estimate.total || (estimate.lines.length > 0 && estimate.lines.every(l => l.amount));
  if (!hasCount) missing.push('the sandwich count');
  // No types at all, or some sandwiches still marked "unknown" type
  if (estimate.lines.length === 0 || estimate.lines.some(l => l.type === 'unknown')) {
    missing.push('the sandwich types');
  }
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
      const days = Math.max(0, calendarDaysUntil(event.desiredEventDate) ?? 0);
      const missing = missingEventInfo(event);
      const missingLine = missing.length
        ? ` For reference, ${joinList(missing)} ${missing.length === 1 ? "hasn't" : "haven't"} been recorded yet.`
        : '';
      return {
        subject: `${org}'s event is coming up ${whenPhrase(days)}`,
        intro: `${org}'s requested date is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${plural(days, 'day')} from now`} (${formatEventDate(event.desiredEventDate)}), and it's still set to In Process in the app. Has anything new come in that would let you schedule it, or should it move to Stalled, Declined, or Cancelled?${missingLine} Here's their contact info in case it's useful:`,
        short: `requested date ${whenPhrase(days)}, still In Process`,
      };
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_SCHEDULED: {
      const days = Math.max(0, calendarDaysUntil(event.scheduledEventDate) ?? 0);
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
        subject: `${org}'s event is coming up ${whenPhrase(days)} and is missing some information`,
        intro: `${sentences.join(' ')} Here's the contact's info in case you need to reach out for anything:`,
        short: `coming up ${whenPhrase(days)}, missing ${joinList(shortBits)}`,
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
      // Last contact (log or legacy field); never contacted counts from creation
      const since = lastContactDate(event) ?? (event.createdAt ? new Date(event.createdAt) : null);
      if (!since) return true;
      return (now.getTime() - since.getTime()) / msPerDay >= thresholdDays;
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
      // Calendar days (Eastern), inclusive: today counts as 0
      const daysUntilDate = calendarDaysUntil(event.desiredEventDate);
      if (daysUntilDate === null) return false;
      return daysUntilDate >= 0 && daysUntilDate <= thresholdDays;
    }

    case REMINDER_RULE_TYPES.DATE_APPROACHING_SCHEDULED: {
      // Scheduled events coming up that are still missing critical info
      // (time, address, sandwich count/types) or aren't on the planning sheet.
      if (!isScheduledOrRescheduled(event.status)) return false;
      const daysUntilDate = calendarDaysUntil(event.scheduledEventDate);
      if (daysUntilDate === null || daysUntilDate < 0 || daysUntilDate > thresholdDays) return false;
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
    await sgMail.send(withUnsubscribeSettings({
      to: email,
      from: 'katie@thesandwichproject.org',
      subject: msg.subject,
      headers: reminderUnsubscribeHeaders(baseUrl),
      html: renderReminderEmailHtml(userName, event, msg, baseUrl),
    }, 'operational'));
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

/** Statuses where an assigned TSP contact gets reminders. */
const REMINDER_STATUSES = ['new', 'in_process', 'scheduled', 'rescheduled', 'stalled'];

/**
 * The event's current TSP contact: tspContact is authoritative; the legacy
 * tspContactAssigned only counts when tspContact is empty. (After a
 * reassignment the legacy field can still hold the former contact.)
 */
function isAssignedTo(event: { tspContact?: string | null; tspContactAssigned?: string | null }, userId: string): boolean {
  const current = event.tspContact || event.tspContactAssigned || null;
  return current === userId;
}

/** The rules that apply to the user's events (same for every event). */
function activeRules(prefs: CheckInReminderPreferences): DefaultReminderRule[] {
  return prefs.rules.filter(r => r.enabled && !RETIRED_RULE_TYPES.has(r.ruleType));
}

/**
 * Dry run: work out exactly who would get what, log it, and send NOTHING.
 * Turned on with CHECK_IN_REMINDERS_DRY_RUN=true (the hourly job then runs in
 * any environment, including dev), or on demand via the admin dry-run endpoint.
 * A dry run never writes anything that would change the real first run: no
 * notifications, no summary marker, no grace periods, no sent timestamps.
 * (Row sync still runs; it's bookkeeping and idempotent.)
 */
export function isCheckInReminderDryRun(): boolean {
  return process.env.CHECK_IN_REMINDERS_DRY_RUN === 'true';
}

export type DryRunEntry = {
  kind: 'summary' | 'reminder';
  userId: string;
  userName: string;
  /** Where it would go: email and/or SMS (bell is always included) */
  wouldEmail: string | null;
  wouldText: string | null;
  subject: string;
  /** Reminder: one event. Summary: every event in it. */
  events: { id: number; organization: string; detail: string }[];
};

type RunContext = {
  dryRun: boolean;
  plan: DryRunEntry[];
  /** Rows the (dry-run) summary covered, so the send loop doesn't list them twice */
  summarizedRowIds: Set<number>;
  /** When this run started; rows due at or before it are processed this run */
  runStartedAt: Date;
  /** Failures in sync/summary (the per-reminder loop counts its own) */
  errors: number;
};

function plannedChannels(user: typeof users.$inferSelect, channel: string): { wouldEmail: string | null; wouldText: string | null } {
  const email = user.preferredEmail || user.email || null;
  const consent = getUserMetadata(user).smsConsent;
  const phone = consent?.enabled && consent.phoneNumber ? consent.phoneNumber : null;
  return {
    wouldEmail: channel === 'email' || channel === 'both' ? email : null,
    wouldText: channel === 'sms' || channel === 'both' ? phone : null,
  };
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
async function baselineUserBacklog(staleUser: typeof users.$inferSelect, ctx: RunContext): Promise<void> {
  // Re-read the account: the sync for this user may have taken a while, and a
  // summary must not go to an account deactivated in the meantime.
  const [user] = await db.select().from(users).where(eq(users.id, staleUser.id)).limit(1);
  if (!user || user.isActive === false) return;
  const metadata = getUserMetadata(user);
  if (metadata.checkInRemindersBaselinedAt) return;

  const rows = await db
    .select()
    .from(eventCheckInReminders)
    .where(and(eq(eventCheckInReminders.userId, user.id), eq(eventCheckInReminders.enabled, true)));

  // Condition rules, plus general check-ins that are already due (otherwise
  // they'd still go out individually in this same run).
  const nowForDue = new Date();
  const condRows = rows.filter(r =>
    !RETIRED_RULE_TYPES.has(r.ruleType) &&
    (isConditionBasedRule(r.ruleType) || (!!r.nextDueAt && r.nextDueAt <= nowForDue)));
  const eventIds = [...new Set(condRows.map(r => r.eventRequestId))];
  const events = eventIds.length
    ? await db.select().from(eventRequests).where(inArray(eventRequests.id, eventIds))
    : [];
  const eventById = new Map(events.map(e => [e.id, e]));

  // event id -> labels of rules already triggered
  const backlog = new Map<number, string[]>();
  // Rows to pause for the grace period. Applied only after the summary's bell
  // entry is saved, so a failure there can't silence reminders for a week.
  const graceRowIds: number[] = [];
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
    if (!isAssignedTo(event, user.id)) continue;
    if (isSnoozed(event)) continue;
    if (!evaluateRuleCondition(row.ruleType, row.thresholdDays || 7, event)) continue;
    const label = buildReminderMessage(row.ruleType, row.thresholdDays || 7, event).short;
    backlog.set(event.id, [...(backlog.get(event.id) || []), label]);
    if (ctx.dryRun) {
      ctx.summarizedRowIds.add(row.id);
      continue;
    }
    graceRowIds.push(row.id);
  }

  if (ctx.dryRun) {
    // Record what the summary would be; write nothing, so the real first run
    // still sends it.
    if (backlog.size > 0) {
      const entry: DryRunEntry = {
        kind: 'summary',
        userId: user.id,
        userName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id,
        ...plannedChannels(user, getCheckInReminderPreferences(user).defaultChannel),
        subject: 'A quick look at your events',
        events: [...backlog.entries()].map(([id, labels]) => ({
          id,
          organization: eventById.get(id)?.organizationName || 'Unknown Organization',
          detail: labels.join(', '),
        })),
      };
      ctx.plan.push(entry);
      logger.info(`[CheckInReminders][DRY RUN] would send summary to ${entry.userName}: ${entry.events.length} events`);
    }
    return;
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
      actionUrl: '/dashboard?section=event-requests&tab=all',
      actionText: 'Open events',
      metadata: { eventIds: items.map(i => i.id), source: 'check_in_reminder_summary' },
    });

    // The summary is saved in the bell; now pause the summarized reminders.
    if (graceRowIds.length) {
      await db
        .update(eventCheckInReminders)
        // Push out to the grace date, but never pull an already-later date in
        .set({
          nextDueAt: sql`GREATEST(COALESCE(${eventCheckInReminders.nextDueAt}, ${graceUntil.toISOString()}::timestamp), ${graceUntil.toISOString()}::timestamp)`,
          updatedAt: new Date(),
        })
        .where(inArray(eventCheckInReminders.id, graceRowIds));
    }

    const prefs = getCheckInReminderPreferences(user);
    const email = user.preferredEmail || user.email;
    if (process.env.SENDGRID_API_KEY && email && (prefs.defaultChannel === 'email' || prefs.defaultChannel === 'both')) {
      const userName = user.displayName || user.firstName || 'there';
      const list = items
        .map(i => `<li style="margin-bottom:8px;"><a href="${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${i.id}" style="color:#007E8C;font-weight:600;">${escapeHtml(i.orgName)}</a><br/><span style="font-size:13px;color:#6b7280;">${i.labels.join(', ')}</span></li>`)
        .join('');
      try {
        await sgMail.send(withUnsubscribeSettings({
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
        }, 'operational'));
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
            `TSP: ${count === 1 ? '1 of your events' : `${count} of your events`} could use a look when you have time. ${baseUrl}/dashboard?section=event-requests&tab=all`,
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
 * Hourly sync of every user's per-event reminder rows with their CURRENT
 * settings and assignments (settings are global; rows are just the
 * per-event bookkeeping the scheduler needs):
 *  - inactive users: all rows switched off
 *  - events they're no longer assigned to, or that left an active status: off
 *  - rules not in their settings (or retired): off
 *  - rules in their settings: on, with current threshold/frequency/channel
 *  - missing rows: created
 * Because this runs every hour against fresh settings, rows written from a
 * stale read, older thresholds, or pre-existing per-event customizations
 * converge to the user's settings on the next run.
 */
async function syncReminderRows(ctx: RunContext): Promise<number> {
  let changed = 0;
  try {
    const allUsers = await db.select({ id: users.id }).from(users);

    for (const { id: userId } of allUsers) {
      // Re-read each user right before syncing them, to keep the window for
      // a concurrent settings save as small as possible.
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) continue;

      const existing = await db
        .select()
        .from(eventCheckInReminders)
        .where(eq(eventCheckInReminders.userId, user.id));

      // Deactivated accounts keep old assignments; switch everything off.
      if (user.isActive === false) {
        const enabledIds = existing.filter(r => r.enabled).map(r => r.id);
        if (enabledIds.length) {
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(inArray(eventCheckInReminders.id, enabledIds));
          changed += enabledIds.length;
        }
        continue;
      }

      const prefs = getCheckInReminderPreferences(user);

      const assignedEvents = await db
        .select({ id: eventRequests.id })
        .from(eventRequests)
        .where(
          and(
            // Same rule as isAssignedTo: tspContact wins; legacy field only if empty
            or(
              eq(eventRequests.tspContact, user.id),
              and(
                sql`(${eventRequests.tspContact} IS NULL OR ${eventRequests.tspContact} = '')`,
                eq(eventRequests.tspContactAssigned, user.id),
              ),
            ),
            sql`${eventRequests.status} IN (${sql.join(REMINDER_STATUSES.map(st => sql`${st}`), sql`, `)})`,
            sql`${eventRequests.deletedAt} IS NULL`,
          ),
        );

      // Desired (event, ruleType) -> rule
      const desired = new Map<string, { eventId: number; rule: DefaultReminderRule }>();
      for (const ev of assignedEvents) {
        for (const rule of activeRules(prefs)) {
          desired.set(`${ev.id}:${rule.ruleType}`, { eventId: ev.id, rule });
        }
      }

      // Reconcile existing rows
      const seen = new Set<string>();
      for (const row of existing) {
        const key = `${row.eventRequestId}:${row.ruleType}`;
        const want = desired.get(key);
        if (!want) {
          if (row.enabled) {
            await db
              .update(eventCheckInReminders)
              .set({ enabled: false, updatedAt: new Date() })
              .where(eq(eventCheckInReminders.id, row.id));
            changed++;
          }
          continue;
        }
        seen.add(key);
        const patch: Partial<typeof eventCheckInReminders.$inferInsert> = {};
        if (!row.enabled) {
          patch.enabled = true;
          // Conditions are checked right away (this run); general rules wait
          // for their frequency.
          patch.nextDueAt = isConditionBasedRule(want.rule.ruleType)
            ? ctx.runStartedAt
            : calculateNextDue(want.rule.frequency as ReminderFrequency);
        }
        if (row.thresholdDays !== want.rule.thresholdDays) patch.thresholdDays = want.rule.thresholdDays;
        if (row.frequency !== want.rule.frequency) patch.frequency = want.rule.frequency;
        if (row.channel !== prefs.defaultChannel) patch.channel = prefs.defaultChannel;
        if (Object.keys(patch).length) {
          await db
            .update(eventCheckInReminders)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, row.id));
          changed++;
        }
      }

      // Create missing rows
      for (const [key, { eventId, rule }] of desired) {
        if (seen.has(key)) continue;
        const isCondBased = isConditionBasedRule(rule.ruleType);
        await db.insert(eventCheckInReminders).values({
          eventRequestId: eventId,
          userId: user.id,
          ruleType: rule.ruleType,
          enabled: true,
          thresholdDays: rule.thresholdDays,
          // Configured frequency = how often to repeat after a reminder goes
          // out. Conditions are still checked daily (see processor).
          frequency: rule.frequency,
          channel: prefs.defaultChannel,
          // Check conditions this run; general rules wait for their frequency
          nextDueAt: isCondBased ? ctx.runStartedAt : calculateNextDue(rule.frequency as ReminderFrequency),
        }).onConflictDoNothing(); // unique index prevents duplicates
        changed++;
      }

      // First run for this user: roll anything already triggering into one summary.
      try {
        await baselineUserBacklog(user, ctx);
      } catch (error) {
        ctx.errors++;
        logger.error(`[CheckInReminders] Backlog summary failed for user ${user.id}:`, error);
      }
    }
  } catch (error) {
    ctx.errors++;
    logger.error('[CheckInReminders] Error syncing reminder rows:', error);
  }
  return changed;
}

/**
 * Dry run of the send loop: the same checks as the real loop (event still
 * active, current contact, account active, rule not retired, not paused,
 * condition met), recorded in ctx.plan. Strictly read-only: no schedule,
 * pause, row, bell or delivery writes. Returns how many reminders errored.
 */
async function previewDueReminders(
  dueReminders: (typeof eventCheckInReminders.$inferSelect)[],
  ctx: RunContext,
): Promise<number> {
  let errors = 0;
  const now = new Date();
  for (const reminder of dueReminders) {
    try {
      if (ctx.summarizedRowIds.has(reminder.id)) continue; // in this run's summary
      if (RETIRED_RULE_TYPES.has(reminder.ruleType)) continue;
      const [event] = await db.select().from(eventRequests).where(eq(eventRequests.id, reminder.eventRequestId)).limit(1);
      if (!event || event.deletedAt) continue;
      if (['completed', 'declined', 'cancelled'].includes(event.status || '')) continue;
      if (!isAssignedTo(event, reminder.userId)) continue;
      const [user] = await db.select().from(users).where(eq(users.id, reminder.userId)).limit(1);
      if (!user || user.isActive === false) continue;
      const [snooze] = await db
        .select()
        .from(eventReminderSnoozes)
        .where(and(
          eq(eventReminderSnoozes.eventRequestId, event.id),
          eq(eventReminderSnoozes.userId, reminder.userId),
          eq(eventReminderSnoozes.active, true),
        ))
        .limit(1);
      if (snooze) {
        const last = lastContactDate(event);
        const paused = snooze.snoozeType === 'until_contact'
          ? !(last && last > snooze.createdAt)
          : !!snooze.snoozedUntil && now <= snooze.snoozedUntil;
        if (paused) continue;
      }
      if (!evaluateRuleCondition(reminder.ruleType, reminder.thresholdDays || 7, event)) continue;

      const msg = buildReminderMessage(reminder.ruleType, reminder.thresholdDays || 7, event);
      const entry: DryRunEntry = {
        kind: 'reminder',
        userId: user.id,
        userName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id,
        ...plannedChannels(user, reminder.channel),
        subject: msg.subject,
        events: [{ id: event.id, organization: event.organizationName || 'Unknown Organization', detail: msg.short }],
      };
      ctx.plan.push(entry);
      logger.info(`[CheckInReminders][DRY RUN] would send to ${entry.userName}: ${msg.subject}`);
    } catch (error) {
      errors++;
      logger.error(`[CheckInReminders][DRY RUN] Error previewing reminder ${reminder.id}:`, error);
    }
  }
  return errors;
}

export async function processCheckInReminders(options: { dryRun?: boolean } = {}): Promise<{
  processed: number;
  sent: number;
  errors: number;
  dryRun: boolean;
  /** Only filled in a dry run: everything that would have gone out */
  plan: DryRunEntry[];
}> {
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let errors = 0;
  const ctx: RunContext = {
    dryRun: options.dryRun ?? isCheckInReminderDryRun(),
    plan: [],
    summarizedRowIds: new Set(),
    runStartedAt: now,
    errors: 0,
  };
  if (ctx.dryRun) {
    logger.info('[CheckInReminders][DRY RUN] Starting: nothing will be sent or marked as sent');
  }

  try {
    // Bring per-event rows in line with each user's settings and assignments
    const synced = await syncReminderRows(ctx);
    if (synced > 0) {
      logger.info(`[CheckInReminders] Synced ${synced} reminder rows with user settings`);
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
      return { processed: 0, sent: 0, errors: ctx.errors, dryRun: ctx.dryRun, plan: ctx.plan };
    }

    logger.info(`[CheckInReminders] Processing ${dueReminders.length} due reminders`);

    if (ctx.dryRun) {
      // Read-only: evaluate the same checks as the real loop, write nothing.
      const previewErrors = await previewDueReminders(dueReminders, ctx);
      return { processed: dueReminders.length, sent: 0, errors: ctx.errors + previewErrors, dryRun: true, plan: ctx.plan };
    }

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

        // No longer this user's event (reassigned)? Switch off; never send a
        // group's contact details to a former contact.
        if (!isAssignedTo(event, reminder.userId)) {
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
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

        // Deactivated account: switch off instead of sending.
        if (user.isActive === false) {
          await db
            .update(eventCheckInReminders)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(eventCheckInReminders.id, reminder.id));
          continue;
        }

        const userName = user.displayName || user.firstName || 'there';
        const msg = buildReminderMessage(reminder.ruleType, reminder.thresholdDays || 7, event);


        // Always record the reminder in the in-app notification bell first,
        // so it exists even if email/SMS isn't configured or fails to send.
        // If this insert fails, the error goes to the per-reminder catch and
        // the row stays due for a retry next run (nothing sent, nothing marked).
        {
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

        // Update lastSentAt; repeat at the user's chosen frequency (the sync
        // has already copied their current setting onto this row).
        const nextDue = calculateNextDue(reminder.frequency as ReminderFrequency);
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

  return { processed, sent, errors, dryRun: ctx.dryRun, plan: ctx.plan };
}
