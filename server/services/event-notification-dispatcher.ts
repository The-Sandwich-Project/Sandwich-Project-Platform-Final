/**
 * Event Notification Dispatcher
 *
 * Central service for sending tiered notifications related to event management.
 * Routes notifications through the appropriate channel based on urgency tier.
 */

import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { eventRequests, users } from '@shared/schema';
import { eq, and, or, inArray, lt, lte, gte, isNull, sql } from 'drizzle-orm';
import { isNotificationSuppressed } from '../utils/notification-suppression';
import { logger } from '../utils/production-safe-logger';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { getUserMetadata } from '@shared/types';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { getEffectivePrefs } from './notifications/preferences';
import {
  EventNotificationType,
  NOTIFICATION_TIER_CONFIG,
  shouldSendSMS,
  shouldSendEmail,
  needsCorporate24hEscalation,
  isEventApproachingIncomplete,
  needsWeeklyContactReminder,
  shouldEscalateToAdmin,
  ContactAttemptLogEntry,
  CorporateFollowUpProtocol,
} from './notification-tiers';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ============================================================================
// SMS SENDING (URGENT TIER)
// ============================================================================

/**
 * Send SMS via the existing SMS service
 */
async function sendUrgentSMS(
  phoneNumber: string,
  message: string,
  notificationType: EventNotificationType
): Promise<boolean> {
  try {
    // Dynamic import to avoid circular dependencies
    const { sendTSPFollowupReminderSMS } = await import('../sms-service');

    const result = await sendTSPFollowupReminderSMS(phoneNumber, message);
    if (result.success) {
      logger.log(`📱 Urgent SMS sent (${notificationType}): ${phoneNumber.slice(-4)}`);
      return true;
    } else {
      logger.error(`Failed to send urgent SMS (${notificationType}):`, result.message);
      return false;
    }
  } catch (error) {
    logger.error(`Error sending urgent SMS (${notificationType}):`, error);
    return false;
  }
}

/**
 * Get user's phone number if they have SMS opted in for 'events' campaign
 */
async function getUserSMSNumber(userId: string): Promise<string | null> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;

    const metadata = getUserMetadata(user);
    const smsConsent = metadata.smsConsent;

    if (
      !smsConsent ||
      smsConsent.status !== 'confirmed' ||
      !smsConsent.enabled ||
      !smsConsent.phoneNumber
    ) {
      return null;
    }

    // User must be opted into the 'events' campaign. The UI writes the
    // plural `campaignTypes` array when users pick multiple; the legacy
    // singular `campaignType` is kept in sync only with the first item, so
    // check both. Absent campaign info = legacy single-campaign setup, allow.
    const campaignTypes: string[] = Array.isArray(smsConsent.campaignTypes)
      ? smsConsent.campaignTypes
      : smsConsent.campaignType
        ? [smsConsent.campaignType]
        : [];

    const optedIntoEvents =
      campaignTypes.length === 0 || campaignTypes.includes('events');

    return optedIntoEvents ? smsConsent.phoneNumber : null;
  } catch (error) {
    logger.error(`Error getting SMS number for user ${userId}:`, error);
    return null;
  }
}

// ============================================================================
// URGENT TIER NOTIFICATIONS (SMS)
// ============================================================================

/**
 * Send TSP Contact Assignment notification (URGENT - SMS only)
 */
export async function sendTspAssignmentNotification(
  userId: string,
  eventId: number,
  organizationName: string,
  eventDate: Date | string | null,
  isCorporatePriority: boolean = false
): Promise<boolean> {
  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

  // Format date
  const dateStr = eventDate
    ? new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'TBD';

  // Get user info
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    logger.warn(`Cannot send TSP assignment notification: user ${userId} not found`);
    return false;
  }

  const userName = user.displayName || user.firstName || 'there';

  // Respect the user's saved preferences for this alert. If they've never
  // saved anything, the catalog defaults (both channels on) apply.
  const prefs = await getEffectivePrefs(userId, ALERT_TYPES.TSP_CONTACT_ASSIGNED);
  if (!prefs.emailEnabled && !prefs.smsEnabled) {
    logger.log(`User ${userId} disabled TSP assignment notifications — skipping`);
    return false;
  }

  // Build SMS/email message body
  const smsMessage = isCorporatePriority
    ? `🏢 CORPORATE PRIORITY: You've been assigned to ${organizationName} (${dateStr}). Call today! ${eventUrl}`
    : `🎯 New event: You're assigned to ${organizationName} (${dateStr}). ${eventUrl}`;

  const phoneNumber = prefs.smsEnabled ? await getUserSMSNumber(userId) : null;

  // Send over all channels the user has enabled AND is eligible for.
  const results: boolean[] = [];
  if (phoneNumber) {
    results.push(await sendUrgentSMS(phoneNumber, smsMessage, 'tsp_contact_assigned'));
  }
  if (prefs.emailEnabled) {
    const toEmail = user.preferredEmail || user.email;
    if (toEmail) {
      results.push(
        await sendTspAssignmentEmail(
          toEmail,
          userName,
          organizationName,
          dateStr,
          eventUrl,
          isCorporatePriority
        )
      );
    }
  } else if (prefs.smsEnabled && !phoneNumber) {
    // User wanted SMS but hasn't opted in yet — fall back to email so the
    // notification isn't silently dropped.
    logger.log(`User ${userId} opted into SMS for TSP assignment but no phone on file — falling back to email`);
    const toEmail = user.preferredEmail || user.email;
    if (toEmail) {
      results.push(
        await sendTspAssignmentEmail(
          toEmail,
          userName,
          organizationName,
          dateStr,
          eventUrl,
          isCorporatePriority
        )
      );
    }
  }

  return results.some((ok) => ok);
}

/**
 * Fallback email for TSP assignment when user doesn't have SMS
 */
async function sendTspAssignmentEmail(
  email: string,
  userName: string,
  organizationName: string,
  dateStr: string,
  eventUrl: string,
  isCorporatePriority: boolean
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  try {
    const subject = isCorporatePriority
      ? `🏢 CORPORATE PRIORITY: You've been assigned to ${organizationName}`
      : `🎯 New Event Assignment: ${organizationName}`;

    const msg = {
      to: email,
      from: 'katie@thesandwichproject.org',
      subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${isCorporatePriority ? '#B8860B' : '#236383'}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .event-box { background: white; padding: 15px; border-left: 4px solid ${isCorporatePriority ? '#B8860B' : '#236383'}; margin: 15px 0; }
            .btn { display: inline-block; background: ${isCorporatePriority ? '#B8860B' : '#236383'}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; }
            ${isCorporatePriority ? '.urgent { background: #FEF3C7; border: 1px solid #F59E0B; padding: 12px; border-radius: 6px; margin: 15px 0; }' : ''}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${isCorporatePriority ? '🏢 Corporate Priority Assignment' : '🎯 New Event Assignment'}</h1>
            </div>
            <div class="content">
              <p>Hi ${userName}!</p>

              ${isCorporatePriority ? '<div class="urgent"><strong>⚡ This is a CORPORATE PRIORITY event.</strong> Please make initial contact TODAY.</div>' : ''}

              <p>You've been assigned as TSP contact for:</p>

              <div class="event-box">
                <strong>Organization:</strong> ${organizationName}<br>
                <strong>Event Date:</strong> ${dateStr}
              </div>

              <p>Click below to view the event details and get started:</p>
              <a href="${eventUrl}" class="btn">View Event Details →</a>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Hi ${userName}!\n\n${isCorporatePriority ? '⚡ CORPORATE PRIORITY - Contact today!\n\n' : ''}You've been assigned to ${organizationName} (${dateStr}).\n\nView details: ${eventUrl}`,
    };

    await sgMail.send(msg);
    return true;
  } catch (error) {
    logger.error('Error sending TSP assignment email:', error);
    return false;
  }
}

/**
 * Send Corporate 24-hour escalation SMS
 */
export async function sendCorporate24hEscalationSMS(
  userId: string,
  eventId: number,
  organizationName: string
): Promise<boolean> {
  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

  const phoneNumber = await getUserSMSNumber(userId);
  if (!phoneNumber) {
    logger.warn(`Cannot send corporate escalation SMS: user ${userId} not opted into SMS`);
    return false;
  }

  const message = `⚠️ URGENT: ${organizationName} (corporate) needs contact TODAY. No successful response logged yet. ${eventUrl}`;

  return await sendUrgentSMS(phoneNumber, message, 'corporate_no_contact_24h');
}

/**
 * Send Event Approaching Incomplete SMS
 */
export async function sendEventApproachingSMS(
  userId: string,
  eventId: number,
  organizationName: string,
  eventDate: Date | string,
  daysUntil: number
): Promise<boolean> {
  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

  const phoneNumber = await getUserSMSNumber(userId);
  if (!phoneNumber) {
    // Fall back to email
    return await sendEventApproachingEmail(userId, eventId, organizationName, eventDate, daysUntil);
  }

  const message = `🚨 ${organizationName} event in ${daysUntil} days but NOT scheduled yet! Finalize ASAP: ${eventUrl}`;

  return await sendUrgentSMS(phoneNumber, message, 'event_approaching_incomplete');
}

/**
 * Fallback email for event approaching when no SMS
 */
async function sendEventApproachingEmail(
  userId: string,
  eventId: number,
  organizationName: string,
  eventDate: Date | string,
  daysUntil: number
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email) return false;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  const dateStr = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  try {
    const msg = {
      to: user.preferredEmail || user.email,
      from: 'katie@thesandwichproject.org',
      subject: `🚨 URGENT: ${organizationName} event in ${daysUntil} days - Not Yet Scheduled`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #FEF2F2; padding: 20px; border-radius: 0 0 8px 8px; }
            .alert { background: white; padding: 15px; border-left: 4px solid #DC2626; margin: 15px 0; }
            .btn { display: inline-block; background: #DC2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 Event Approaching - Action Required</h1>
            </div>
            <div class="content">
              <div class="alert">
                <strong>${organizationName}</strong> is scheduled for <strong>${dateStr}</strong> (${daysUntil} days away) but the event is NOT yet in "Scheduled" status.
              </div>

              <p>Please contact the organization immediately to confirm event details and update the status.</p>

              <a href="${eventUrl}" class="btn">Review Event Now →</a>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `URGENT: ${organizationName} event in ${daysUntil} days (${dateStr}) but NOT scheduled yet!\n\nPlease finalize immediately: ${eventUrl}`,
    };

    await sgMail.send(msg);
    return true;
  } catch (error) {
    logger.error('Error sending event approaching email:', error);
    return false;
  }
}

// ============================================================================
// IMPORTANT TIER NOTIFICATIONS (RICH EMAIL)
// ============================================================================

/**
 * Send notification when event details are changed
 */
export async function sendEventChangedNotification(
  tspContactIds: string[],
  eventId: number,
  organizationName: string,
  changedBy: string,
  changes: { field: string; oldValue: string; newValue: string }[]
): Promise<number> {
  if (!process.env.SENDGRID_API_KEY || changes.length === 0) return 0;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

  let sentCount = 0;

  for (const contactId of tspContactIds) {
    // Skip users with suppressed event notifications (only get assignments + comments)
    if (isNotificationSuppressed(contactId)) continue;

    const [user] = await db.select().from(users).where(eq(users.id, contactId)).limit(1);
    if (!user?.email) continue;

    const userName = user.displayName || user.firstName || 'there';

    // Build changes list
    const changesHtml = changes
      .map(
        (c) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 500;">${c.field}</td>
          <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; color: #DC2626; text-decoration: line-through;">${c.oldValue || '(empty)'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; color: #059669; font-weight: 500;">${c.newValue || '(empty)'}</td>
        </tr>
      `
      )
      .join('');

    try {
      const msg = {
        to: user.preferredEmail || user.email,
        from: 'katie@thesandwichproject.org',
        subject: `📝 Event Updated: ${organizationName} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #8B5CF6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .changes-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; margin: 15px 0; }
              .changes-table th { background: #F3F4F6; padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6B7280; }
              .btn { display: inline-block; background: #8B5CF6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📝 Event Details Updated</h1>
              </div>
              <div class="content">
                <p>Hi ${userName},</p>
                <p><strong>${changedBy}</strong> made changes to <strong>${organizationName}</strong>:</p>

                <table class="changes-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Was</th>
                      <th>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${changesHtml}
                  </tbody>
                </table>

                <a href="${eventUrl}" class="btn">View Event Details →</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Hi ${userName},\n\n${changedBy} made changes to ${organizationName}:\n\n${changes.map((c) => `${c.field}: "${c.oldValue}" → "${c.newValue}"`).join('\n')}\n\nView details: ${eventUrl}`,
      };

      await sgMail.send(msg);
      sentCount++;
    } catch (error) {
      logger.error(`Error sending event changed notification to ${user.email}:`, error);
    }
  }

  return sentCount;
}

/**
 * Send in-process event weekly reminder (no contact in 7 days)
 */
export async function sendWeeklyContactReminderEmail(
  userId: string,
  eventId: number,
  organizationName: string,
  daysSinceContact: number,
  eventDate: Date | string | null
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email) return false;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  const userName = user.displayName || user.firstName || 'there';
  const dateStr = eventDate ? new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD';

  try {
    const msg = {
      to: user.preferredEmail || user.email,
      from: 'katie@thesandwichproject.org',
      subject: `📞 Follow-up needed: ${organizationName} (${daysSinceContact} days since contact)`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #F59E0B; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #FFFBEB; padding: 20px; border-radius: 0 0 8px 8px; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #F59E0B; margin: 15px 0; }
            .btn { display: inline-block; background: #F59E0B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📞 Time for a Follow-up</h1>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <p>It's been <strong>${daysSinceContact} days</strong> since the last contact with <strong>${organizationName}</strong>.</p>

              <div class="info-box">
                <strong>Organization:</strong> ${organizationName}<br>
                <strong>Event Date:</strong> ${dateStr}<br>
                <strong>Status:</strong> In Process<br>
                <strong>Last Contact:</strong> ${daysSinceContact} days ago
              </div>

              <p>Consider reaching out to keep the momentum going and finalize the event details.</p>

              <a href="${eventUrl}" class="btn">View Event & Log Contact →</a>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Hi ${userName},\n\nIt's been ${daysSinceContact} days since the last contact with ${organizationName} (${dateStr}).\n\nConsider following up to keep momentum.\n\nView event: ${eventUrl}`,
    };

    await sgMail.send(msg);
    logger.log(`Weekly contact reminder sent to ${user.email} for ${organizationName}`);
    return true;
  } catch (error) {
    logger.error(`Error sending weekly contact reminder:`, error);
    return false;
  }
}

/**
 * Send standby event follow-up reminder
 */
export async function sendStandbyFollowupEmail(
  userId: string,
  eventId: number,
  organizationName: string,
  daysSinceLastContact: number | null
): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) return false;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email) return false;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  const userName = user.displayName || user.firstName || 'there';

  try {
    const msg = {
      to: user.preferredEmail || user.email,
      from: 'katie@thesandwichproject.org',
      subject: `⏸️ Standby check-in: ${organizationName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #6B7280; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #F9FAFB; padding: 20px; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; background: #6B7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏸️ Standby Event Check-in</h1>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <p><strong>${organizationName}</strong> is on standby${daysSinceLastContact ? ` (last contact ${daysSinceLastContact} days ago)` : ''}.</p>

              <p>This is a good time to check in with them about their timeline. Are they ready to move forward?</p>

              <a href="${eventUrl}" class="btn">Review Event →</a>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Hi ${userName},\n\n${organizationName} is on standby${daysSinceLastContact ? ` (last contact ${daysSinceLastContact} days ago)` : ''}.\n\nCheck in about their timeline: ${eventUrl}`,
    };

    await sgMail.send(msg);
    return true;
  } catch (error) {
    logger.error(`Error sending standby followup email:`, error);
    return false;
  }
}

// ============================================================================
// ESCALATION NOTIFICATIONS
// ============================================================================

/**
 * Send escalation notification to admin when event is stale for 2+ weeks
 * @deprecated Use sendBatchedStaleEventEscalation instead
 */
export async function sendStaleEventEscalation(
  adminUserIds: string[],
  tspContactName: string,
  tspContactEmail: string,
  eventId: number,
  organizationName: string,
  daysSinceContact: number
): Promise<number> {
  if (!process.env.SENDGRID_API_KEY) return 0;

  const baseUrl = getAppBaseUrl();
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;

  let sentCount = 0;

  for (const adminId of adminUserIds) {
    const [admin] = await db.select().from(users).where(eq(users.id, adminId)).limit(1);
    if (!admin?.email) continue;

    try {
      const msg = {
        to: admin.preferredEmail || admin.email,
        from: 'katie@thesandwichproject.org',
        subject: `⚠️ ESCALATION: ${organizationName} - No contact in ${daysSinceContact} days`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #FEF2F2; padding: 20px; border-radius: 0 0 8px 8px; }
              .alert-box { background: white; padding: 15px; border-left: 4px solid #DC2626; margin: 15px 0; }
              .btn { display: inline-block; background: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Event Escalation Required</h1>
              </div>
              <div class="content">
                <div class="alert-box">
                  <strong>Event:</strong> ${organizationName}<br>
                  <strong>Assigned To:</strong> ${tspContactName} (${tspContactEmail})<br>
                  <strong>Days Since Contact:</strong> ${daysSinceContact}<br>
                  <strong>Status:</strong> In Process (stalled)
                </div>

                <p>This event has had no contact logged for <strong>${daysSinceContact} days</strong> despite automated reminders.</p>

                <p><strong>Recommended actions:</strong></p>
                <ul>
                  <li>Reach out to ${tspContactName} to check on progress</li>
                  <li>Consider reassigning the event</li>
                  <li>Review if organization is still responsive</li>
                </ul>

                <a href="${eventUrl}" class="btn">Review Event →</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `ESCALATION: ${organizationName}\n\nAssigned to: ${tspContactName} (${tspContactEmail})\nNo contact in ${daysSinceContact} days.\n\nPlease review: ${eventUrl}`,
      };

      await sgMail.send(msg);
      sentCount++;
      logger.log(`Escalation sent to admin ${admin.email} for ${organizationName}`);
    } catch (error) {
      logger.error(`Error sending escalation to admin ${admin.email}:`, error);
    }
  }

  return sentCount;
}

/**
 * Event info for batched escalation
 */
interface StaleEventInfo {
  eventId: number;
  organizationName: string;
  tspContactName: string;
  tspContactEmail: string;
  daysSinceContact: number;
}

/**
 * Send ONE batched escalation email to admins summarizing all stale events
 * grouped by TSP contact. Prevents email spam by consolidating all escalations
 * into a single weekly summary.
 */
export async function sendBatchedStaleEventEscalation(
  adminUserIds: string[],
  staleEvents: StaleEventInfo[]
): Promise<number> {
  if (!process.env.SENDGRID_API_KEY || staleEvents.length === 0) return 0;

  const baseUrl = getAppBaseUrl();

  // Group events by TSP contact
  const eventsByContact = new Map<string, { name: string; email: string; events: StaleEventInfo[] }>();
  for (const event of staleEvents) {
    const key = event.tspContactEmail;
    if (!eventsByContact.has(key)) {
      eventsByContact.set(key, {
        name: event.tspContactName,
        email: event.tspContactEmail,
        events: [],
      });
    }
    eventsByContact.get(key)!.events.push(event);
  }

  // Build HTML for all events grouped by contact
  let eventsHtml = '';
  let eventsText = '';
  
  for (const [, contact] of eventsByContact) {
    eventsHtml += `
      <div style="margin-bottom: 20px;">
        <h3 style="color: #DC2626; margin-bottom: 10px;">${contact.name} (${contact.email}) - ${contact.events.length} stalled event${contact.events.length > 1 ? 's' : ''}</h3>
        <ul style="margin: 0; padding-left: 20px;">
    `;
    eventsText += `\n${contact.name} (${contact.email}) - ${contact.events.length} stalled event(s):\n`;
    
    for (const event of contact.events) {
      const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.eventId}`;
      eventsHtml += `<li><a href="${eventUrl}">${event.organizationName}</a> - ${event.daysSinceContact} days since contact</li>`;
      eventsText += `  - ${event.organizationName} (${event.daysSinceContact} days): ${eventUrl}\n`;
    }
    
    eventsHtml += `</ul></div>`;
  }

  let sentCount = 0;

  for (const adminId of adminUserIds) {
    const [admin] = await db.select().from(users).where(eq(users.id, adminId)).limit(1);
    if (!admin?.email) continue;

    const adminName = admin.displayName || admin.firstName || 'there';

    try {
      const msg = {
        to: admin.preferredEmail || admin.email,
        from: 'katie@thesandwichproject.org',
        subject: `⚠️ Weekly Escalation Summary: ${staleEvents.length} Stalled Event${staleEvents.length > 1 ? 's' : ''} Need Attention`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #FEF2F2; padding: 20px; border-radius: 0 0 8px 8px; }
              .summary-box { background: white; padding: 15px; border-left: 4px solid #DC2626; margin: 15px 0; }
              .btn { display: inline-block; background: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; }
              h3 { margin-top: 0; }
              a { color: #236383; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Weekly Stalled Events Summary</h1>
              </div>
              <div class="content">
                <p>Hi ${adminName}!</p>
                
                <div class="summary-box">
                  <strong>${staleEvents.length} event${staleEvents.length > 1 ? 's have' : ' has'}</strong> had no contact logged for 2+ weeks despite automated reminders.
                  These are grouped by the TSP contact they're assigned to.
                </div>

                ${eventsHtml}

                <p><strong>Recommended actions:</strong></p>
                <ul>
                  <li>Check in with the assigned contacts about progress</li>
                  <li>Consider reassigning stalled events</li>
                  <li>Review if organizations are still responsive</li>
                </ul>

                <a href="${baseUrl}/dashboard?section=event-requests&tab=in_process" class="btn">View All In-Process Events →</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Weekly Stalled Events Summary\n\nHi ${adminName}!\n\n${staleEvents.length} event(s) have had no contact logged for 2+ weeks:\n${eventsText}\n\nPlease review and follow up with the assigned contacts.\n\n---\nThe Sandwich Project`,
      };

      await sgMail.send(msg);
      sentCount++;
      logger.log(`Batched escalation summary sent to admin ${admin.email} for ${staleEvents.length} events`);
    } catch (error) {
      logger.error(`Error sending batched escalation to admin ${admin.email}:`, error);
    }
  }

  return sentCount;
}

// ============================================================================
// BATCH PROCESSING FUNCTIONS
// ============================================================================

/**
 * Process corporate events that need 24-hour escalation SMS
 */
export async function processCorporate24hEscalations(): Promise<{ sent: number; skipped: number }> {
  logger.log('🏢 Processing corporate 24-hour escalations...');

  const results = { sent: 0, skipped: 0 };

  // Find corporate priority events in active statuses only
  // Explicitly exclude: completed, declined, cancelled, stalled, standby, scheduled
  const corporateEvents = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.isCorporatePriority, true),
        inArray(eventRequests.status, ['new', 'in_process']),
        isNull(eventRequests.deletedAt)
      )
    );

  for (const event of corporateEvents) {
    const contactLog = event.contactAttemptsLog as ContactAttemptLogEntry[] | null;
    const protocol = event.corporateFollowUpProtocol as CorporateFollowUpProtocol | null;

    const needsEscalation = needsCorporate24hEscalation(
      true,
      event.status || 'new',
      event.tspContactAssignedDate,
      event.lastContactAttempt,
      contactLog,
      protocol
    );

    if (!needsEscalation) {
      results.skipped++;
      continue;
    }

    // Rate limit: Only send corporate escalation SMS once per day per event
    // Use the corporateFollowUpProtocol to track last notification
    const lastNotificationTime = protocol?.lastEscalationSentAt 
      ? new Date(protocol.lastEscalationSentAt).getTime() 
      : 0;
    const hoursSinceLastNotification = (Date.now() - lastNotificationTime) / (1000 * 60 * 60);
    
    if (lastNotificationTime > 0 && hoursSinceLastNotification < 24) {
      logger.log(`Skipping corporate escalation for ${event.organizationName} - last sent ${hoursSinceLastNotification.toFixed(1)} hours ago`);
      results.skipped++;
      continue;
    }

    // Determine which TSP contact to notify
    const tspContactId = event.tspContactAssigned || event.tspContact;
    if (!tspContactId) {
      logger.warn(`Corporate event ${event.id} has no TSP contact assigned`);
      results.skipped++;
      continue;
    }

    // Skip users with suppressed event notifications (only get assignments + comments)
    if (isNotificationSuppressed(tspContactId)) {
      results.skipped++;
      continue;
    }

    const success = await sendCorporate24hEscalationSMS(
      tspContactId,
      event.id,
      event.organizationName || 'Unknown Organization'
    );

    if (success) {
      // Update the protocol to track when we sent this notification
      const updatedProtocol: CorporateFollowUpProtocol = {
        ...(protocol || {}),
        lastEscalationSentAt: new Date().toISOString(),
      };
      await db.update(eventRequests)
        .set({ corporateFollowUpProtocol: updatedProtocol })
        .where(eq(eventRequests.id, event.id));
      
      results.sent++;
    } else {
      results.skipped++;
    }
  }

  logger.log(`🏢 Corporate escalations complete: ${results.sent} sent, ${results.skipped} skipped`);
  return results;
}

/**
 * Process events approaching their date but not yet scheduled
 */
export async function processApproachingIncompleteEvents(): Promise<{ sent: number; skipped: number }> {
  logger.log('📅 Processing approaching incomplete events...');

  const results = { sent: 0, skipped: 0 };
  const daysThreshold = 5;

  // Find events with dates in the next X days that aren't scheduled yet
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysThreshold);

  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        inArray(eventRequests.status, ['new', 'in_process']),
        isNull(eventRequests.deletedAt),
        or(
          and(
            gte(eventRequests.desiredEventDate, now.toISOString().split('T')[0]),
            lte(eventRequests.desiredEventDate, futureDate.toISOString().split('T')[0])
          ),
          and(
            gte(eventRequests.scheduledEventDate, now),
            lte(eventRequests.scheduledEventDate, futureDate)
          )
        )
      )
    );

  for (const event of events) {
    const eventDate = getEffectiveEventDate(event);
    if (!eventDate) {
      results.skipped++;
      continue;
    }

    const daysUntil = Math.ceil((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 0 || daysUntil > daysThreshold) {
      results.skipped++;
      continue;
    }

    const tspContactId = event.tspContactAssigned || event.tspContact;
    if (!tspContactId) {
      results.skipped++;
      continue;
    }

    // Skip users with suppressed event notifications (only get assignments + comments)
    if (isNotificationSuppressed(tspContactId)) {
      results.skipped++;
      continue;
    }

    const success = await sendEventApproachingSMS(
      tspContactId,
      event.id,
      event.organizationName || 'Unknown Organization',
      eventDate,
      daysUntil
    );

    if (success) {
      results.sent++;
    } else {
      results.skipped++;
    }
  }

  logger.log(`📅 Approaching events processed: ${results.sent} sent, ${results.skipped} skipped`);
  return results;
}

/**
 * Process in-process events that need weekly contact reminders
 * 
 * BATCHING: Escalation emails are now batched into ONE summary email per admin
 * instead of individual emails per stale event. This prevents email spam when
 * multiple events need escalation (e.g., 17+ emails per day → 1 weekly summary).
 */
export async function processWeeklyContactReminders(): Promise<{ sent: number; skipped: number; escalated: number }> {
  logger.log('📞 Processing weekly contact reminders...');

  const results = { sent: 0, skipped: 0, escalated: 0 };

  // Find in-process events
  const events = await db
    .select()
    .from(eventRequests)
    .where(and(eq(eventRequests.status, 'in_process'), isNull(eventRequests.deletedAt)));

  // Log ALL in-process events for debugging
  logger.log(`📋 Found ${events.length} in_process events total`);
  if (events.length > 0) {
    logger.log(`📋 In-process events: ${events.map(e => `ID:${e.id} "${e.organizationName}"`).join(', ')}`);
  }

  // Get escalation recipients - Katie only.
  // Match case-insensitively against LOWER(email) so we don't miss a stored
  // row whose casing drifted.
  const escalationEmails = ['katie@thesandwichproject.org'].map((e) =>
    e.trim().toLowerCase()
  );
  const admins = await db
    .select()
    .from(users)
    .where(sql`LOWER(${users.email}) = ANY(${escalationEmails})`);
  const adminIds = admins.map((a) => a.id);

  // Collect stale events for batched escalation email
  const staleEventsForEscalation: StaleEventInfo[] = [];
  const eventIdsToMarkEscalated: number[] = [];

  for (const event of events) {
    const contactLog = event.contactAttemptsLog as ContactAttemptLogEntry[] | null;

    // Check if needs escalation (2+ weeks no contact)
    if (shouldEscalateToAdmin(event.status || 'new', event.lastContactAttempt, contactLog)) {
      // Rate limit escalations: only include events not escalated in the past 7 days
      const lastEscalation = event.adminEscalationSentAt 
        ? new Date(event.adminEscalationSentAt).getTime()
        : 0;
      const daysSinceLastEscalation = (Date.now() - lastEscalation) / (1000 * 60 * 60 * 24);
      
      // Skip if we already sent an escalation within the past 7 days
      if (lastEscalation > 0 && daysSinceLastEscalation < 7) {
        logger.log(`Skipping escalation for ${event.organizationName} - last escalation ${daysSinceLastEscalation.toFixed(1)} days ago`);
        results.skipped++;
        continue;
      }

      const tspContactId = event.tspContactAssigned || event.tspContact;
      if (tspContactId) {
        const [tspUser] = await db.select().from(users).where(eq(users.id, tspContactId)).limit(1);
        if (tspUser) {
          const daysSinceContact = event.lastContactAttempt
            ? Math.floor((Date.now() - new Date(event.lastContactAttempt).getTime()) / (1000 * 60 * 60 * 24))
            : 99;

          // Collect for batched email instead of sending individually
          staleEventsForEscalation.push({
            eventId: event.id,
            organizationName: event.organizationName || 'Unknown',
            tspContactName: tspUser.displayName || tspUser.firstName || tspUser.email || 'Unknown',
            tspContactEmail: tspUser.email || 'unknown',
            daysSinceContact,
          });
          eventIdsToMarkEscalated.push(event.id);
        }
      }
      continue;
    }

    // Check if needs weekly reminder (7+ days)
    if (needsWeeklyContactReminder(event.status || 'new', event.lastContactAttempt, contactLog)) {
      const tspContactId = event.tspContactAssigned || event.tspContact;
      if (!tspContactId) {
        results.skipped++;
        continue;
      }

      // Skip users with suppressed event notifications (only get assignments + comments)
      if (isNotificationSuppressed(tspContactId)) {
        results.skipped++;
        continue;
      }

      const daysSinceContact = event.lastContactAttempt
        ? Math.floor((Date.now() - new Date(event.lastContactAttempt).getTime()) / (1000 * 60 * 60 * 24))
        : 99;

      const success = await sendWeeklyContactReminderEmail(
        tspContactId,
        event.id,
        event.organizationName || 'Unknown Organization',
        daysSinceContact,
        getEffectiveEventDate(event)
      );

      if (success) {
        results.sent++;
      } else {
        results.skipped++;
      }
    } else {
      results.skipped++;
    }
  }

  // Send ONE batched escalation email with all stale events
  if (staleEventsForEscalation.length > 0) {
    logger.log(`📧 Sending batched escalation for ${staleEventsForEscalation.length} stale events to ${adminIds.length} admins`);
    
    const sentCount = await sendBatchedStaleEventEscalation(adminIds, staleEventsForEscalation);
    
    if (sentCount > 0) {
      // Mark all escalated events with timestamp to prevent repeated emails
      for (const eventId of eventIdsToMarkEscalated) {
        await db.update(eventRequests)
          .set({ adminEscalationSentAt: new Date() })
          .where(eq(eventRequests.id, eventId));
      }
      results.escalated = staleEventsForEscalation.length;
      logger.log(`✅ Batched escalation sent to ${sentCount} admin(s) covering ${staleEventsForEscalation.length} events`);
    } else {
      logger.error('Failed to send batched escalation email');
    }
  }

  logger.log(`📞 Weekly reminders processed: ${results.sent} sent, ${results.escalated} events in batched escalation, ${results.skipped} skipped`);
  return results;
}

export default {
  sendTspAssignmentNotification,
  sendCorporate24hEscalationSMS,
  sendEventApproachingSMS,
  sendEventChangedNotification,
  sendWeeklyContactReminderEmail,
  sendStandbyFollowupEmail,
  sendStaleEventEscalation,
  sendBatchedStaleEventEscalation,
  processCorporate24hEscalations,
  processApproachingIncompleteEvents,
  processWeeklyContactReminders,
};
