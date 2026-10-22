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
import { eventCheckInReminders, eventReminderSnoozes, eventRequests, users, REMINDER_RULE_TYPES } from '@shared/schema';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { getUserMetadata, getCheckInReminderPreferences } from '@shared/types';
import { isScheduledOrRescheduled } from '../../shared/event-status-workflow';
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
const RULE_TYPE_LABELS: Record<string, { label: string; getDescription: (thresholdDays: number) => string }> = {
  [REMINDER_RULE_TYPES.NO_CONTACT]: {
    label: 'No Contact Attempt',
    getDescription: (days) => `No contact attempt has been logged in the last ${days} days.`,
  },
  [REMINDER_RULE_TYPES.STALE_EVENT]: {
    label: 'Stale Event',
    getDescription: (days) => `This event has had no updates in the last ${days} days.`,
  },
  [REMINDER_RULE_TYPES.DATE_APPROACHING_INPROCESS]: {
    label: 'Date Approaching (In Process)',
    getDescription: (days) => `The desired event date is within ${days} days and the event is still in process.`,
  },
  [REMINDER_RULE_TYPES.DATE_APPROACHING_SCHEDULED]: {
    label: 'Scheduled Date Approaching',
    getDescription: (days) => `The scheduled event date is within ${days} days.`,
  },
  [REMINDER_RULE_TYPES.STAFFING_UNMET]: {
    label: 'Staffing Needs Unmet',
    getDescription: (days) => `The event is within ${days} days and still has unmet staffing needs.`,
  },
  [REMINDER_RULE_TYPES.MISSING_DETAILS]: {
    label: 'Missing Key Details',
    getDescription: (days) => `The event is within ${days} days and is still missing key details (sandwich count, type, location, or pickup time).`,
  },
  [REMINDER_RULE_TYPES.GENERAL_CHECKIN]: {
    label: 'General Check-In',
    getDescription: () => `Time for a scheduled check-in on this event.`,
  },
};


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
        // No contact attempts ever — condition met
        return true;
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
      // Only applies to scheduled events
      if (!isScheduledOrRescheduled(event.status)) return false;
      const scheduledDate = event.scheduledEventDate ? new Date(event.scheduledEventDate) : null;
      if (!scheduledDate) return false;
      const daysUntilDate = (scheduledDate.getTime() - now.getTime()) / msPerDay;
      return daysUntilDate <= thresholdDays && daysUntilDate >= 0;
    }

    case REMINDER_RULE_TYPES.STAFFING_UNMET: {
      // Only applies to scheduled events with staffing needs
      if (!isScheduledOrRescheduled(event.status)) return false;
      const scheduledDate = event.scheduledEventDate ? new Date(event.scheduledEventDate) : null;
      if (!scheduledDate) return false;
      const daysUntilDate = (scheduledDate.getTime() - now.getTime()) / msPerDay;
      if (daysUntilDate > thresholdDays || daysUntilDate < 0) return false;

      // Check if staffing needs are unmet (speaker role retired — no longer counted)
      const driversNeeded = event.driversNeeded || 0;
      const assignedDrivers = event.assignedDriverIds?.length || 0;
      const volunteersNeeded = event.volunteersNeeded || 0;
      const assignedVolunteers = event.assignedVolunteerIds?.length || 0;
      const vanNeeded = event.vanDriverNeeded && !event.assignedVanDriverId && !event.customVanDriverName;

      const hasUnmetNeeds =
        assignedDrivers < driversNeeded ||
        assignedVolunteers < volunteersNeeded ||
        vanNeeded;

      return hasUnmetNeeds;
    }

    case REMINDER_RULE_TYPES.MISSING_DETAILS: {
      // Only applies to scheduled events
      if (!isScheduledOrRescheduled(event.status)) return false;
      const scheduledDate = event.scheduledEventDate ? new Date(event.scheduledEventDate) : null;
      if (!scheduledDate) return false;
      const daysUntilDate = (scheduledDate.getTime() - now.getTime()) / msPerDay;
      if (daysUntilDate > thresholdDays || daysUntilDate < 0) return false;

      // Check if key details are missing
      const missingSandwichCount = !event.estimatedSandwichCount && event.estimatedSandwichCount !== 0;
      const sandwichTypes = event.sandwichTypes as any[] | null;
      const missingSandwichType = !sandwichTypes || sandwichTypes.length === 0;
      const missingLocation = !event.eventAddress;
      const missingPickupTime = !event.pickupTime;

      return missingSandwichCount || missingSandwichType || missingLocation || missingPickupTime;
    }

    case REMINDER_RULE_TYPES.GENERAL_CHECKIN:
    default:
      // General check-in always fires when due (frequency-based only)
      return true;
  }
}

async function sendReminderEmail(
  email: string,
  userName: string,
  orgName: string,
  eventDate: string,
  eventStatus: string,
  eventId: number,
  ruleType: string,
  thresholdDays: number
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  const ruleInfo = RULE_TYPE_LABELS[ruleType] || RULE_TYPE_LABELS[REMINDER_RULE_TYPES.GENERAL_CHECKIN];

  try {
    const msg = {
      to: email,
      from: 'katie@thesandwichproject.org',
      subject: `Reminder: ${ruleInfo.label} - ${orgName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #236383, #007E8C); padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">${ruleInfo.label}</h2>
          </div>
          <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; color: #374151;">Hi ${userName},</p>
            <p style="font-size: 15px; color: #4b5563;">
              ${ruleInfo.getDescription(thresholdDays)}
            </p>
            <div style="background: white; border-left: 4px solid #FBAD3F; padding: 16px; margin: 16px 0; border-radius: 4px;">
              <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1f2937;">${orgName}</p>
              <p style="margin: 0 0 4px 0; font-size: 14px; color: #6b7280;">Event Date: ${eventDate}</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">Status: ${eventStatus}</p>
            </div>
            <p style="font-size: 14px; color: #6b7280;">
              Take a moment to review the event and follow up if needed.
            </p>
            <a href="${eventUrl}" style="display: inline-block; background: #007E8C; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 12px 0;">
              View Event Details
            </a>
            <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
              You can adjust or turn off these reminders from the alarm icon on the event card.
            </p>
          </div>
          ${EMAIL_FOOTER_HTML}
        </div>
      `,
    };

    await sgMail.send(msg);
    return true;
  } catch (error) {
    logger.error(`Failed to send reminder email to ${email}:`, error);
    return false;
  }
}

async function sendReminderSMS(
  phoneNumber: string,
  orgName: string,
  eventId: number,
  ruleType: string
): Promise<boolean> {
  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  const ruleInfo = RULE_TYPE_LABELS[ruleType] || RULE_TYPE_LABELS[REMINDER_RULE_TYPES.GENERAL_CHECKIN];
  const message = `TSP Reminder (${ruleInfo.label}): ${orgName} needs attention. View: ${eventUrl}`;

  try {
    const result = await sendTSPFollowupReminderSMS(phoneNumber, message);
    return result.success;
  } catch (error) {
    logger.error('Failed to send reminder SMS:', error);
    return false;
  }
}

/**
 * For users who have configured global defaults, auto-provision per-event
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
      const prefs = getCheckInReminderPreferences(user);
      if (!prefs?.configured) continue;

      const enabledRules = prefs.rules.filter(r => r.enabled);
      const enabledCorpRules = prefs.corporateRules?.filter(r => r.enabled) ?? [];
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
        const orgName = event.organizationName || 'Unknown Organization';
        const eventDate = event.scheduledEventDate
          ? new Date(event.scheduledEventDate).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : event.desiredEventDate
            ? new Date(event.desiredEventDate).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : 'TBD';
        const eventStatus = event.status || 'unknown';

        let emailSent = false;
        let smsSent = false;

        // Send email if channel includes email
        if (reminder.channel === 'email' || reminder.channel === 'both') {
          const email = user.preferredEmail || user.email;
          if (email) {
            emailSent = await sendReminderEmail(
              email,
              userName,
              orgName,
              eventDate,
              eventStatus,
              event.id,
              reminder.ruleType,
              reminder.thresholdDays || 7
            );
          }
        }

        // Send SMS if channel includes SMS
        if (reminder.channel === 'sms' || reminder.channel === 'both') {
          const metadata = getUserMetadata(user);
          const smsConsent = metadata.smsConsent;
          if (smsConsent?.enabled && smsConsent.phoneNumber) {
            smsSent = await sendReminderSMS(
              smsConsent.phoneNumber,
              orgName,
              event.id,
              reminder.ruleType
            );
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
