/**
 * Corporate Event Follow-up Service
 *
 * Strict follow-up protocol for corporate priority events:
 *
 * DAY 1 (When TSP Contact is assigned):
 * - Immediate notification to TSP contact: CALL NOW
 * - If no answer, leave voicemail + send toolkit email
 *
 * DAY 2+:
 * - Daily reminder to call again + send text
 * - Continue until successful contact is logged
 *
 * RESOLUTION:
 * - Protocol completes when contact logs successful outcome (yes/no/standby)
 * - Or when event is marked as stalled/cancelled
 */

import { db } from '../db';
import { eventRequests, users } from '@shared/schema';
import { and, eq, sql, isNull, isNotNull, or, inArray } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { getUserMetadata, getUserPhoneNumber } from '@shared/types';
import { EmailNotificationService } from './email-notification-service';
import sgMail from '@sendgrid/mail';
import { getAppBaseUrl } from '../config/constants';
import { isNotificationSuppressed } from '../utils/notification-suppression';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';

const serviceLogger = {
  info: (msg: string, ...args: any[]) => logger.info(`[CorporateFollowup] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => logger.warn(`[CorporateFollowup] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => logger.error(`[CorporateFollowup] ${msg}`, ...args),
};

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

interface CorporateFollowupProtocol {
  status: 'not_started' | 'active' | 'completed' | 'stalled';
  protocolStartedAt: string | null;
  protocolStartedBy: string | null;
  initialCallMade: boolean;
  initialCallAt: string | null;
  initialCallBy: string | null;
  initialCallOutcome: 'answered' | 'voicemail' | 'no_answer' | null;
  voicemailLeft: boolean;
  voicemailLeftAt: string | null;
  toolkitEmailSent: boolean;
  toolkitEmailSentAt: string | null;
  toolkitEmailSentBy: string | null;
  day2CallMade: boolean;
  day2CallAt: string | null;
  day2CallBy: string | null;
  day2CallOutcome: 'answered' | 'voicemail' | 'no_answer' | null;
  day2TextSent: boolean;
  day2TextSentAt: string | null;
  day2TextSentBy: string | null;
  lastReminderSentAt: string | null;
  reminderCount: number;
  successfulContactAt: string | null;
  successfulContactBy: string | null;
  finalOutcome: 'yes' | 'no' | 'standby' | null;
  finalOutcomeNotes: string | null;
}

const DEFAULT_PROTOCOL: CorporateFollowupProtocol = {
  status: 'not_started',
  protocolStartedAt: null,
  protocolStartedBy: null,
  initialCallMade: false,
  initialCallAt: null,
  initialCallBy: null,
  initialCallOutcome: null,
  voicemailLeft: false,
  voicemailLeftAt: null,
  toolkitEmailSent: false,
  toolkitEmailSentAt: null,
  toolkitEmailSentBy: null,
  day2CallMade: false,
  day2CallAt: null,
  day2CallBy: null,
  day2CallOutcome: null,
  day2TextSent: false,
  day2TextSentAt: null,
  day2TextSentBy: null,
  lastReminderSentAt: null,
  reminderCount: 0,
  successfulContactAt: null,
  successfulContactBy: null,
  finalOutcome: null,
  finalOutcomeNotes: null,
};

interface FollowupResult {
  remindersGenerated: number;
  eventsProcessed: number;
  errors: number;
  timestamp: Date;
  details: Array<{
    eventId: number;
    organization: string;
    reminderType: 'day1_call' | 'day2_followup' | 'daily_reminder';
    channel: string;
    success: boolean;
  }>;
}

/**
 * Get hours elapsed since a timestamp
 */
function getHoursElapsed(startDate: Date): number {
  const now = new Date();
  return (now.getTime() - startDate.getTime()) / (1000 * 60 * 60);
}

/**
 * Get calendar days elapsed since a date
 */
function getDaysElapsed(startDate: Date): number {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Send immediate call notification to TSP contact when assigned to corporate event
 * This is called when TSP contact is assigned to a corporate priority event
 */
export async function sendCorporateImmediateCallNotification(
  eventId: number,
  tspContactId: string,
  organizationName: string,
  eventDate: Date | string | null,
  contactPhone: string | null,
  contactName: string | null
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    serviceLogger.warn('SendGrid not configured - skipping corporate immediate call notification');
    return false;
  }

  try {
    // Get TSP contact details
    const [tspUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, tspContactId))
      .limit(1);

    if (!tspUser || !tspUser.email) {
      serviceLogger.warn(`TSP contact ${tspContactId} not found or has no email`);
      return false;
    }

    const tspEmail = tspUser.preferredEmail || tspUser.email;
    const tspName = tspUser.displayName || tspUser.firstName || tspEmail.split('@')[0];
    const eventUrl = `${getAppBaseUrl()}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

    const formattedEventDate = eventDate
      ? new Date(eventDate).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'Date TBD';

    const msg = {
      to: tspEmail,
      from: 'katie@thesandwichproject.org',
      subject: `🏢 URGENT: Call ${organizationName} NOW - Corporate Priority`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #B8860B 0%, #DAA520 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .urgent-banner { background: #A31C41; color: white; padding: 15px; text-align: center; font-weight: bold; font-size: 18px; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .event-details { background: white; padding: 15px; border-left: 4px solid #B8860B; margin: 15px 0; }
            .action-box { background: #FFF8DC; padding: 15px; border: 2px solid #B8860B; border-radius: 8px; margin: 15px 0; }
            .phone-number { font-size: 24px; font-weight: bold; color: #B8860B; }
            .btn { display: inline-block; background: #B8860B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 5px; }
            .btn-call { background: #007E8C; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🏢 Corporate Priority Event</h1>
            </div>
            <div class="urgent-banner">
              ⚡ IMMEDIATE ACTION REQUIRED - CALL NOW ⚡
            </div>
            <div class="content">
              <p>Hello ${tspName}!</p>
              <p>You've been assigned as TSP Contact for a <strong>Corporate Priority</strong> event. Corporate events require immediate attention.</p>

              <div class="action-box">
                <h3 style="margin-top: 0; color: #B8860B;">📞 Call the organizer RIGHT NOW:</h3>
                ${contactPhone ? `
                <p class="phone-number">${contactPhone}</p>
                <a href="tel:${contactPhone.replace(/[^0-9+]/g, '')}" class="btn btn-call">📞 Tap to Call</a>
                ` : '<p>No phone number available - check event details</p>'}
                ${contactName ? `<p><strong>Contact:</strong> ${contactName}</p>` : ''}
              </div>

              <div class="event-details">
                <strong>Organization:</strong> ${organizationName}<br>
                <strong>Event Date:</strong> ${formattedEventDate}
              </div>

              <h3 style="color: #B8860B;">If they don't answer:</h3>
              <ol>
                <li><strong>Leave a voicemail</strong></li>
                <li><strong>Send the toolkit email</strong></li>
                <li><strong>Log your contact attempt</strong> in the system</li>
                <li>Plan to call again tomorrow + send a text</li>
              </ol>

              <p>
                <a href="${eventUrl}" class="btn">View Event Details</a>
              </p>

              <p style="font-size: 0.85em; color: #666;">
                Corporate events may use platforms like Deed or Benevity - note any donation matching opportunities!
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
🏢 CORPORATE PRIORITY - CALL NOW

Hello ${tspName}!

You've been assigned to a Corporate Priority event. CALL THE ORGANIZER IMMEDIATELY.

${contactPhone ? `📞 PHONE: ${contactPhone}` : ''}
${contactName ? `Contact: ${contactName}` : ''}

Organization: ${organizationName}
Event Date: ${formattedEventDate}

IF THEY DON'T ANSWER:
1. Leave a voicemail
2. Send the toolkit email
3. Log your contact attempt
4. Plan to call again tomorrow + send text

View event: ${eventUrl}
      `.trim(),
    };

    await sgMail.send(msg);
    serviceLogger.info(`Corporate immediate call notification sent to ${tspEmail} for event ${eventId}`);

    return true;
  } catch (error) {
    serviceLogger.error(`Error sending corporate immediate call notification: ${error}`);
    return false;
  }
}

/**
 * Send daily reminder to TSP contact for corporate events without successful contact
 */
async function sendCorporateDailyReminder(
  eventId: number,
  tspContactId: string,
  organizationName: string,
  eventDate: Date | string | null,
  contactPhone: string | null,
  daysSinceAssigned: number,
  protocol: CorporateFollowupProtocol
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    serviceLogger.warn('SendGrid not configured - skipping corporate daily reminder');
    return false;
  }

  try {
    // Get TSP contact details
    const [tspUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, tspContactId))
      .limit(1);

    if (!tspUser || !tspUser.email) {
      serviceLogger.warn(`TSP contact ${tspContactId} not found or has no email`);
      return false;
    }

    const tspEmail = tspUser.preferredEmail || tspUser.email;
    const tspName = tspUser.displayName || tspUser.firstName || tspEmail.split('@')[0];
    const eventUrl = `${getAppBaseUrl()}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

    const formattedEventDate = eventDate
      ? new Date(eventDate).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'Date TBD';

    // Determine what actions are still needed
    const actionsNeeded: string[] = [];
    if (!protocol.initialCallMade) {
      actionsNeeded.push('Make initial phone call');
    }
    if (daysSinceAssigned >= 1 && !protocol.day2CallMade) {
      actionsNeeded.push('Make follow-up call');
    }
    if (daysSinceAssigned >= 1 && !protocol.day2TextSent) {
      actionsNeeded.push('Send a text message');
    }
    actionsNeeded.push('Log your contact attempt with the outcome');

    const msg = {
      to: tspEmail,
      from: 'katie@thesandwichproject.org',
      subject: `⏰ Reminder: Follow up with ${organizationName} - Day ${daysSinceAssigned + 1}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FBAD3F; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .event-details { background: white; padding: 15px; border-left: 4px solid #B8860B; margin: 15px 0; }
            .action-box { background: #FFF8DC; padding: 15px; border: 2px solid #FBAD3F; border-radius: 8px; margin: 15px 0; }
            .btn { display: inline-block; background: #B8860B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏰ Corporate Follow-up Reminder</h1>
              <p>Day ${daysSinceAssigned + 1} of outreach</p>
            </div>
            <div class="content">
              <p>Hello ${tspName}!</p>
              <p>We haven't received a successful contact log for this corporate priority event. Please continue reaching out today.</p>

              <div class="event-details">
                <strong>Organization:</strong> ${organizationName}<br>
                <strong>Event Date:</strong> ${formattedEventDate}<br>
                ${contactPhone ? `<strong>Phone:</strong> ${contactPhone}` : ''}
              </div>

              <div class="action-box">
                <h3 style="margin-top: 0; color: #FBAD3F;">📋 Actions needed today:</h3>
                <ul>
                  ${actionsNeeded.map(action => `<li>${action}</li>`).join('')}
                </ul>
              </div>

              <p>
                <a href="${eventUrl}" class="btn">View Event & Log Contact</a>
              </p>

              <p style="font-size: 0.85em; color: #666;">
                This reminder will continue daily until you log a successful contact outcome (yes, no, or standby).
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
⏰ CORPORATE FOLLOW-UP REMINDER - Day ${daysSinceAssigned + 1}

Hello ${tspName}!

We haven't received a successful contact log for this corporate priority event.

Organization: ${organizationName}
Event Date: ${formattedEventDate}
${contactPhone ? `Phone: ${contactPhone}` : ''}

ACTIONS NEEDED TODAY:
${actionsNeeded.map(action => `• ${action}`).join('\n')}

View event: ${eventUrl}

This reminder will continue daily until you log a successful contact outcome.
      `.trim(),
    };

    await sgMail.send(msg);
    serviceLogger.info(`Corporate daily reminder sent to ${tspEmail} for event ${eventId} (day ${daysSinceAssigned + 1})`);

    return true;
  } catch (error) {
    serviceLogger.error(`Error sending corporate daily reminder: ${error}`);
    return false;
  }
}

/**
 * Process all corporate priority events and send appropriate reminders
 * Called by cron job daily
 */
export async function processCorporateFollowups(): Promise<FollowupResult> {
  const result: FollowupResult = {
    remindersGenerated: 0,
    eventsProcessed: 0,
    errors: 0,
    timestamp: new Date(),
    details: [],
  };

  serviceLogger.info('Starting corporate follow-up processing...');

  try {
    // Find all corporate priority events that:
    // 1. Are corporate priority (isCorporatePriority = true)
    // 2. Have a TSP contact assigned
    // 3. Are in new/in_process status (not completed, declined, cancelled)
    // 4. Protocol status is 'active' (not 'completed' or 'stalled')
    const corporateEvents = await db
      .select({
        id: eventRequests.id,
        organizationName: eventRequests.organizationName,
        tspContact: eventRequests.tspContact,
        tspContactAssignedDate: eventRequests.tspContactAssignedDate,
        scheduledEventDate: eventRequests.scheduledEventDate,
        desiredEventDate: eventRequests.desiredEventDate,
        phone: eventRequests.phone,
        firstName: eventRequests.firstName,
        lastName: eventRequests.lastName,
        status: eventRequests.status,
        corporateFollowUpProtocol: eventRequests.corporateFollowUpProtocol,
        isCorporatePriority: eventRequests.isCorporatePriority,
      })
      .from(eventRequests)
      .where(
        and(
          // Explicitly check for true (not null, not false)
          sql`${eventRequests.isCorporatePriority} IS TRUE`,
          isNotNull(eventRequests.tspContact),
          inArray(eventRequests.status, ['new', 'in_process']),
          isNull(eventRequests.deletedAt)
        )
      );

    serviceLogger.info(`Found ${corporateEvents.length} corporate priority events to process`);
    if (corporateEvents.length > 0) {
      serviceLogger.info(`Corporate events being processed: ${corporateEvents.map(e => `${e.id}:${e.organizationName} (isCorporatePriority=${e.isCorporatePriority})`).join(', ')}`);
    }

    for (const event of corporateEvents) {
      result.eventsProcessed++;

      // Skip users with suppressed event notifications (only get assignments + comments)
      if (event.tspContact && isNotificationSuppressed(event.tspContact)) continue;

      try {
        // Parse protocol - handle both string and object
        let protocol: CorporateFollowupProtocol;
        if (typeof event.corporateFollowUpProtocol === 'string') {
          try {
            protocol = JSON.parse(event.corporateFollowUpProtocol);
          } catch {
            protocol = { ...DEFAULT_PROTOCOL };
          }
        } else if (event.corporateFollowUpProtocol && typeof event.corporateFollowUpProtocol === 'object') {
          protocol = event.corporateFollowUpProtocol as CorporateFollowupProtocol;
        } else {
          protocol = { ...DEFAULT_PROTOCOL };
        }

        // Skip if protocol is completed or stalled
        if (protocol.status === 'completed' || protocol.status === 'stalled') {
          continue;
        }

        // Skip if successful contact already logged
        if (protocol.successfulContactAt) {
          continue;
        }

        // Calculate days since TSP contact was assigned
        if (!event.tspContactAssignedDate) {
          continue;
        }

        const daysSinceAssigned = getDaysElapsed(new Date(event.tspContactAssignedDate));
        const hoursSinceLastReminder = protocol.lastReminderSentAt
          ? getHoursElapsed(new Date(protocol.lastReminderSentAt))
          : 999;

        // Only send one reminder per day (at least 20 hours between reminders)
        if (hoursSinceLastReminder < 20) {
          continue;
        }

        // Send appropriate reminder based on timeline
        const contactName = [event.firstName, event.lastName].filter(Boolean).join(' ') || null;
        let reminderSent = false;

        if (daysSinceAssigned === 0) {
          // Day 1 - if no initial call made, send urgent reminder
          if (!protocol.initialCallMade) {
            reminderSent = await sendCorporateImmediateCallNotification(
              event.id,
              event.tspContact!,
              event.organizationName || 'Unknown Organization',
              getEffectiveEventDate(event),
              event.phone,
              contactName
            );

            result.details.push({
              eventId: event.id,
              organization: event.organizationName || 'Unknown',
              reminderType: 'day1_call',
              channel: 'email',
              success: reminderSent,
            });
          }
        } else {
          // Day 2+ - send daily reminder
          reminderSent = await sendCorporateDailyReminder(
            event.id,
            event.tspContact!,
            event.organizationName || 'Unknown Organization',
            getEffectiveEventDate(event),
            event.phone,
            daysSinceAssigned,
            protocol
          );

          result.details.push({
            eventId: event.id,
            organization: event.organizationName || 'Unknown',
            reminderType: 'daily_reminder',
            channel: 'email',
            success: reminderSent,
          });
        }

        if (reminderSent) {
          result.remindersGenerated++;

          // Update protocol with reminder tracking
          const updatedProtocol = {
            ...protocol,
            status: 'active' as const,
            lastReminderSentAt: new Date().toISOString(),
            reminderCount: (protocol.reminderCount || 0) + 1,
          };

          await db
            .update(eventRequests)
            .set({
              corporateFollowUpProtocol: updatedProtocol,
              updatedAt: new Date()
            })
            .where(eq(eventRequests.id, event.id));
        }
      } catch (eventError) {
        serviceLogger.error(`Error processing event ${event.id}: ${eventError}`);
        result.errors++;
      }
    }

    serviceLogger.info(`Corporate follow-up processing complete: ${result.remindersGenerated} reminders sent, ${result.errors} errors`);
    return result;
  } catch (error) {
    serviceLogger.error(`Error in corporate follow-up processing: ${error}`);
    result.errors++;
    return result;
  }
}

/**
 * Initialize corporate protocol when TSP contact is assigned
 * This should be called from the TSP contact assignment endpoint
 */
export async function initializeCorporateProtocol(
  eventId: number,
  tspContactId: string,
  initiatedBy: string
): Promise<boolean> {
  try {
    // Get event details
    const [event] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event || !event.isCorporatePriority) {
      return false;
    }

    // Initialize protocol with lastReminderSentAt set to prevent duplicate notifications from cron
    const protocol: CorporateFollowupProtocol = {
      ...DEFAULT_PROTOCOL,
      status: 'active',
      protocolStartedAt: new Date().toISOString(),
      protocolStartedBy: initiatedBy,
      lastReminderSentAt: new Date().toISOString(), // Prevents cron from sending duplicate Day 1 notification
      reminderCount: 1, // Count the initial notification
    };

    // Update event with protocol
    await db
      .update(eventRequests)
      .set({
        corporateFollowUpProtocol: protocol,
        updatedAt: new Date(),
      })
      .where(eq(eventRequests.id, eventId));

    // Send immediate call notification
    const contactName = [event.firstName, event.lastName].filter(Boolean).join(' ') || null;
    await sendCorporateImmediateCallNotification(
      eventId,
      tspContactId,
      event.organizationName || 'Unknown Organization',
      getEffectiveEventDate(event),
      event.phone,
      contactName
    );

    serviceLogger.info(`Corporate protocol initialized for event ${eventId}`);
    return true;
  } catch (error) {
    serviceLogger.error(`Error initializing corporate protocol for event ${eventId}: ${error}`);
    return false;
  }
}
