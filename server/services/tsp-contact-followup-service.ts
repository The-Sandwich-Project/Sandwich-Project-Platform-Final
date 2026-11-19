/**
 * TSP Contact Follow-up Notification Service
 * 
 * Sends automated reminders to TSP contacts when:
 * 1. Approaching events (within 7 days) still have 'in_progress' status
 * 2. Events with only toolkit sent and 2+ BUSINESS DAYS have passed without progress
 * 
 * Weekend handling:
 * - Toolkit follow-up reminders are NOT sent on Saturday or Sunday
 * - The "2 days" window counts only business days (Mon-Fri)
 * - Example: Friday toolkit → reminder comes Tuesday (2 business days later)
 */

import { db } from '../db';
import { eventRequests, users, tspContactFollowups } from '@shared/schema';
import { and, eq, sql, gte, lte, isNull, notExists, or } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { getUserMetadata, getUserPhoneNumber } from '@shared/types';
import { sendTSPFollowupReminderSMS } from '../sms-service';
import { EmailNotificationService } from './email-notification-service';
import { isNotificationSuppressed } from '../utils/notification-suppression';

const serviceLogger = {
  info: (msg: string, ...args: any[]) => logger.info(`[TSP-Followup] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => logger.warn(`[TSP-Followup] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => logger.error(`[TSP-Followup] ${msg}`, ...args),
};

/**
 * Check if today is a weekend (Saturday = 6, Sunday = 0)
 */
function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Calculate business days elapsed between two dates (excludes Sat/Sun)
 */
function getBusinessDaysElapsed(startDate: Date, endDate: Date = new Date()): number {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  
  while (current < end) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }
  
  return count;
}

interface FollowupResult {
  notificationsSent: number;
  eventsProcessed: number;
  errors: number;
  timestamp: Date;
  details: Array<{
    eventId: number;
    organization: string;
    reminderType: string;
    channel: string;
    success: boolean;
  }>;
}

/**
 * Check if a notification was already sent for this event/contact/type combination
 */
async function wasNotificationSent(
  eventRequestId: number,
  tspContactUserId: string,
  reminderType: string
): Promise<boolean> {
  const existing = await db
    .select({ id: tspContactFollowups.id })
    .from(tspContactFollowups)
    .where(
      and(
        eq(tspContactFollowups.eventRequestId, eventRequestId),
        eq(tspContactFollowups.tspContactUserId, tspContactUserId),
        eq(tspContactFollowups.reminderType, reminderType)
      )
    )
    .limit(1);
  
  return existing.length > 0;
}

/**
 * Standby-specific dedup: only block a reminder if one was already sent for the
 * CURRENT follow-up date — i.e. a 'standby_followup' record sent on/after that
 * date (date-level comparison, so a same-day morning send blocks an afternoon
 * repeat). This lets a fresh reminder go out when the follow-up date is later
 * pushed forward, or when the event re-enters standby with a new date, while
 * the plain event+contact+type check would have blocked reminders forever.
 */
async function wasStandbyNotificationSentForDate(
  eventRequestId: number,
  tspContactUserId: string,
  standbyExpectedDate: Date | string
): Promise<boolean> {
  const expectedDateStr = new Date(standbyExpectedDate).toISOString().split('T')[0];
  const existing = await db
    .select({ id: tspContactFollowups.id })
    .from(tspContactFollowups)
    .where(
      and(
        eq(tspContactFollowups.eventRequestId, eventRequestId),
        eq(tspContactFollowups.tspContactUserId, tspContactUserId),
        eq(tspContactFollowups.reminderType, 'standby_followup'),
        sql`${tspContactFollowups.sentAt}::date >= ${expectedDateStr}::date`
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Record that a notification was sent
 */
async function recordNotification(
  eventRequestId: number,
  tspContactUserId: string,
  reminderType: string,
  deliveryChannel: string,
  organization: string,
  eventDate: Date | null,
  messagePreview: string
): Promise<void> {
  try {
    await db.insert(tspContactFollowups).values({
      eventRequestId,
      tspContactUserId,
      reminderType,
      deliveryChannel,
      eventOrganization: organization,
      eventDate,
      messagePreview: messagePreview.substring(0, 500),
    });
  } catch (error: any) {
    if (error?.code === '23505') {
      serviceLogger.warn(`Duplicate notification record for event ${eventRequestId}, type ${reminderType}`);
    } else {
      throw error;
    }
  }
}

/**
 * Get events approaching (within 7 days) that are still in_progress status
 */
async function getApproachingInProgressEvents() {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  return db
    .select()
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.status, 'in_progress'),
        isNull(eventRequests.deletedAt),
        gte(eventRequests.scheduledEventDate, now),
        lte(eventRequests.scheduledEventDate, sevenDaysFromNow),
        or(
          sql`${eventRequests.tspContact} IS NOT NULL`,
          sql`${eventRequests.tspContactAssigned} IS NOT NULL`
        )
      )
    );
}

/**
 * Get events where only toolkit was sent with no progress
 * Note: We fetch all toolkit-only events here and filter by business days in code
 * This allows for more accurate business day calculation
 */
async function getToolkitOnlyEvents() {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.status, 'in_progress'),
        isNull(eventRequests.deletedAt),
        eq(eventRequests.toolkitSent, true),
        gte(eventRequests.toolkitSentAt, oneWeekAgo),
        eq(eventRequests.followUpEmailSent, false),
        or(
          sql`${eventRequests.tspContact} IS NOT NULL`,
          sql`${eventRequests.tspContactAssigned} IS NOT NULL`
        )
      )
    );
  
  return events.filter(event => {
    if (!event.toolkitSentAt) return false;
    const businessDays = getBusinessDaysElapsed(event.toolkitSentAt);
    return businessDays >= 2;
  });
}

/**
 * Get user details for TSP contact
 */
async function getTspContactUser(userId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  return user;
}

/**
 * Determine the preferred notification channel for a user
 */
function getPreferredChannel(user: any): 'sms' | 'email' {
  const metadata = getUserMetadata(user);
  const smsConsent = metadata.smsConsent;
  
  if (smsConsent?.status === 'confirmed' && smsConsent.enabled && smsConsent.phoneNumber) {
    return 'sms';
  }
  
  return 'email';
}

/**
 * Get standby events where the follow-up date has arrived or passed
 */
async function getStandbyEventsNeedingFollowup(): Promise<any[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const results = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.status, 'standby'),
        isNull(eventRequests.deletedAt),
        sql`${eventRequests.standbyExpectedDate} IS NOT NULL`,
        sql`${eventRequests.standbyExpectedDate}::date <= ${today.toISOString().split('T')[0]}::date`
      )
    );
  
  return results;
}

/**
 * Send a follow-up reminder notification to a TSP contact
 */
async function sendFollowupNotification(
  event: any,
  user: any,
  reminderType: 'approaching_event' | 'toolkit_followup' | 'standby_followup'
): Promise<{ success: boolean; channel: string; message: string }> {
  // Per notification tier system: standby_followup is IMPORTANT tier = email only
  // approaching_event and toolkit_followup can use user's preferred channel
  const channel = reminderType === 'standby_followup' ? 'email' : getPreferredChannel(user);
  const userName = user.displayName || user.firstName || 'there';
  const organization = event.organizationName || 'an organization';
  const eventDate = event.scheduledEventDate;
  
  let message: string;
  
  if (reminderType === 'approaching_event') {
    const daysUntil = eventDate
      ? Math.ceil((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 'a few';
    
    message = `Hi ${userName}! Quick reminder: The event with ${organization} is coming up in ${daysUntil} days and is still marked as in-progress. Let us know if you need any help getting it scheduled!`;
  } else if (reminderType === 'standby_followup') {
    message = `Hi ${userName}! This is a reminder to follow up with ${organization} - they're on standby and requested to be contacted around now. Time to reach out and see if they're ready to schedule!`;
  } else {
    message = `Hi ${userName}! Just checking in on the ${organization} event - you sent the toolkit a couple days ago but haven't heard back. Want to send a follow-up email, or do you need any help?`;
  }
  
  if (channel === 'sms') {
    const phoneNumber = getUserPhoneNumber(user);
    if (!phoneNumber) {
      return { success: false, channel: 'sms', message: 'No phone number available' };
    }
    
    const result = await sendTSPFollowupReminderSMS(phoneNumber, message);
    return { success: result.success, channel: 'sms', message: result.success ? 'SMS sent' : result.message };
  } else {
    const email = user.preferredEmail || user.email;
    if (!email) {
      return { success: false, channel: 'email', message: 'No email available' };
    }
    
    const result = await EmailNotificationService.sendTSPFollowupReminderEmail(
      email,
      userName,
      organization,
      reminderType,
      eventDate,
      event.id
    );
    
    return { success: result, channel: 'email', message: result ? 'Email sent' : 'Failed to send email' };
  }
}

/**
 * Main function to process and send TSP contact follow-up notifications
 */
export async function processTspContactFollowups(): Promise<FollowupResult> {
  const result: FollowupResult = {
    notificationsSent: 0,
    eventsProcessed: 0,
    errors: 0,
    timestamp: new Date(),
    details: [],
  };
  
  try {
    serviceLogger.info('Starting TSP contact follow-up check...');
    
    const approachingEvents = await getApproachingInProgressEvents();
    // DISABLED: Toolkit follow-up reminders are not yet part of the operational process
    // When ready to enable, uncomment: const toolkitEvents = await getToolkitOnlyEvents();
    const toolkitEvents: typeof approachingEvents = [];
    
    serviceLogger.info(`Found ${approachingEvents.length} approaching in-progress events (toolkit reminders disabled)`);
    
    for (const event of approachingEvents) {
      result.eventsProcessed++;
      const tspContactId = event.tspContactAssigned || event.tspContact;

      if (!tspContactId) continue;
      // Skip users with suppressed event notifications (only get assignments + comments)
      if (isNotificationSuppressed(tspContactId)) continue;

      try {
        const alreadySent = await wasNotificationSent(event.id, tspContactId, 'approaching_event');
        if (alreadySent) {
          serviceLogger.info(`Skipping event ${event.id} - notification already sent`);
          continue;
        }
        
        const user = await getTspContactUser(tspContactId);
        if (!user) {
          serviceLogger.warn(`TSP contact user ${tspContactId} not found for event ${event.id}`);
          continue;
        }
        
        const notificationResult = await sendFollowupNotification(event, user, 'approaching_event');
        
        if (notificationResult.success) {
          await recordNotification(
            event.id,
            tspContactId,
            'approaching_event',
            notificationResult.channel,
            event.organizationName || 'Unknown',
            event.scheduledEventDate,
            'Approaching event reminder'
          );
          result.notificationsSent++;
        }
        
        result.details.push({
          eventId: event.id,
          organization: event.organizationName || 'Unknown',
          reminderType: 'approaching_event',
          channel: notificationResult.channel,
          success: notificationResult.success,
        });
      } catch (error) {
        result.errors++;
        serviceLogger.error(`Error processing approaching event ${event.id}:`, error);
      }
    }
    
    for (const event of toolkitEvents) {
      result.eventsProcessed++;
      const tspContactId = event.tspContactAssigned || event.tspContact;

      if (!tspContactId) continue;
      if (isNotificationSuppressed(tspContactId)) continue;

      try {
        const alreadySent = await wasNotificationSent(event.id, tspContactId, 'toolkit_followup');
        if (alreadySent) {
          serviceLogger.info(`Skipping event ${event.id} - toolkit notification already sent`);
          continue;
        }
        
        const user = await getTspContactUser(tspContactId);
        if (!user) {
          serviceLogger.warn(`TSP contact user ${tspContactId} not found for event ${event.id}`);
          continue;
        }
        
        const notificationResult = await sendFollowupNotification(event, user, 'toolkit_followup');
        
        if (notificationResult.success) {
          await recordNotification(
            event.id,
            tspContactId,
            'toolkit_followup',
            notificationResult.channel,
            event.organizationName || 'Unknown',
            event.scheduledEventDate,
            'Toolkit follow-up reminder'
          );
          result.notificationsSent++;
        }
        
        result.details.push({
          eventId: event.id,
          organization: event.organizationName || 'Unknown',
          reminderType: 'toolkit_followup',
          channel: notificationResult.channel,
          success: notificationResult.success,
        });
      } catch (error) {
        result.errors++;
        serviceLogger.error(`Error processing toolkit event ${event.id}:`, error);
      }
    }
    
    // Process standby events that need follow-up
    await runStandbyFollowups(result);
    
    serviceLogger.info(`Follow-up check complete: ${result.notificationsSent} notifications sent, ${result.errors} errors`);
    
  } catch (error) {
    serviceLogger.error('Fatal error in TSP contact follow-up processing:', error);
    result.errors++;
  }
  
  return result;
}

/**
 * Standby follow-up processing shared by processTspContactFollowups and the
 * standby-only cron entry point (processStandbyFollowups). For each standby
 * event whose user-chosen follow-up date has arrived, emails the assigned TSP
 * contact (IMPORTANT tier = email only). Dedup is per follow-up date via
 * wasStandbyNotificationSentForDate, so changing the date or re-entering
 * standby later produces a fresh reminder.
 */
async function runStandbyFollowups(result: FollowupResult): Promise<void> {
  const standbyEvents = await getStandbyEventsNeedingFollowup();
  serviceLogger.info(`Found ${standbyEvents.length} standby events at/past their follow-up date`);

  for (const event of standbyEvents) {
    result.eventsProcessed++;
    const tspContactId = event.tspContactAssigned || event.tspContact;

    if (!tspContactId) continue;
    if (isNotificationSuppressed(tspContactId)) continue;

    try {
      const alreadySent = await wasStandbyNotificationSentForDate(
        event.id,
        tspContactId,
        event.standbyExpectedDate
      );
      if (alreadySent) {
        serviceLogger.info(`Skipping standby event ${event.id} - reminder already sent for current follow-up date`);
        continue;
      }

      const user = await getTspContactUser(tspContactId);
      if (!user) {
        serviceLogger.warn(`TSP contact user ${tspContactId} not found for standby event ${event.id}`);
        continue;
      }
      if (user.isActive === false) {
        serviceLogger.info(`Skipping standby event ${event.id} - TSP contact ${tspContactId} is deactivated`);
        continue;
      }

      const notificationResult = await sendFollowupNotification(event, user, 'standby_followup');

      if (notificationResult.success) {
        await recordNotification(
          event.id,
          tspContactId,
          'standby_followup',
          notificationResult.channel,
          event.organizationName || 'Unknown',
          event.standbyExpectedDate,
          'Standby follow-up reminder'
        );
        result.notificationsSent++;
      }

      result.details.push({
        eventId: event.id,
        organization: event.organizationName || 'Unknown',
        reminderType: 'standby_followup',
        channel: notificationResult.channel,
        success: notificationResult.success,
      });
    } catch (error) {
      result.errors++;
      serviceLogger.error(`Error processing standby event ${event.id}:`, error);
    }
  }
}

/**
 * Standby-only entry point for the daily cron job. The broader
 * processTspContactFollowups (approaching-event / toolkit reminders) remains
 * intentionally un-scheduled — those flows were replaced by user-controlled
 * check-in reminders. Standby follow-ups are different: the user explicitly
 * asks for this reminder by picking a check-back date in the standby dialog.
 */
export async function processStandbyFollowups(): Promise<FollowupResult> {
  const result: FollowupResult = {
    notificationsSent: 0,
    eventsProcessed: 0,
    errors: 0,
    timestamp: new Date(),
    details: [],
  };

  try {
    serviceLogger.info('Starting standby follow-up check...');
    await runStandbyFollowups(result);
    serviceLogger.info(`Standby follow-up check complete: ${result.notificationsSent} notifications sent, ${result.errors} errors`);
  } catch (error) {
    serviceLogger.error('Fatal error in standby follow-up processing:', error);
    result.errors++;
  }

  return result;
}
