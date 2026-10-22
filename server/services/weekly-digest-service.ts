/**
 * Weekly Digest Email Service
 *
 * Sends Monday morning portfolio summaries to TSP contacts showing:
 * - All active events they're managing with next actions
 * - Events completed this week
 * - Last 5 completed events for historical context
 */

import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { eventRequests, users } from '@shared/schema';
import { eq, and, or, inArray, desc, gte, lte, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { ADMIN_EMAIL } from '../config/organization';
import {
  WeeklyDigestData,
  DigestEventSummary,
  getNextActionForEvent,
  getEventUrgency,
  getLastContactAttemptTime,
  ContactAttemptLogEntry,
} from './notification-tiers';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';

// Initialize SendGrid if available
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ============================================================================
// DIGEST DATA GATHERING
// ============================================================================

/**
 * Get all active events for a TSP contact
 */
async function getActiveEventsForContact(tspContactId: string): Promise<DigestEventSummary[]> {
  const activeStatuses = ['new', 'in_process', 'scheduled', 'rescheduled', 'standby'];

  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        or(
          eq(eventRequests.tspContact, tspContactId),
          eq(eventRequests.tspContactAssigned, tspContactId),
          eq(eventRequests.additionalContact1, tspContactId),
          eq(eventRequests.additionalContact2, tspContactId)
        ),
        inArray(eventRequests.status, activeStatuses)
      )
    )
    .orderBy(desc(eventRequests.scheduledEventDate));

  return events.map((event) => {
    const eventDate = getEffectiveEventDate(event);
    const contactLog = event.contactAttemptsLog as ContactAttemptLogEntry[] | null;
    const lastContactTime = getLastContactAttemptTime(event.lastContactAttempt, contactLog);

    const daysSinceLastContact = lastContactTime
      ? Math.floor((Date.now() - lastContactTime.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      eventId: event.id,
      organizationName: event.organizationName || 'Unknown Organization',
      status: event.status || 'new',
      eventDate: eventDate ? new Date(eventDate).toISOString() : null,
      nextAction: getNextActionForEvent(
        event.status || 'new',
        event.lastContactAttempt,
        eventDate,
        event.toolkitStatus,
        event.isCorporatePriority || false
      ),
      urgency: getEventUrgency(
        event.status || 'new',
        eventDate,
        event.lastContactAttempt,
        event.isCorporatePriority || false
      ),
      daysSinceLastContact,
      contactName: event.contactName || null,
      contactPhone: event.contactPhone || null,
      contactEmail: event.email || event.contactEmail || null,
    };
  });
}

/**
 * Get events completed in the last 7 days for a TSP contact
 */
async function getRecentlyCompletedEvents(tspContactId: string): Promise<DigestEventSummary[]> {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        or(
          eq(eventRequests.tspContact, tspContactId),
          eq(eventRequests.tspContactAssigned, tspContactId),
          eq(eventRequests.additionalContact1, tspContactId),
          eq(eventRequests.additionalContact2, tspContactId)
        ),
        eq(eventRequests.status, 'completed'),
        gte(eventRequests.statusChangedAt, oneWeekAgo)
      )
    )
    .orderBy(desc(eventRequests.statusChangedAt));

  return events.map((event) => ({
    eventId: event.id,
    organizationName: event.organizationName || 'Unknown Organization',
    status: 'completed',
    eventDate: event.scheduledEventDate ? new Date(event.scheduledEventDate).toISOString() : null,
    nextAction: 'Completed! Great work! 🎉',
    urgency: 'low' as const,
    daysSinceLastContact: null,
    contactName: event.contactName || null,
    contactPhone: event.contactPhone || null,
    contactEmail: event.email || event.contactEmail || null,
  }));
}

/**
 * Get last 5 completed events for historical context
 */
async function getCompletedHistory(tspContactId: string): Promise<DigestEventSummary[]> {
  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        or(
          eq(eventRequests.tspContact, tspContactId),
          eq(eventRequests.tspContactAssigned, tspContactId),
          eq(eventRequests.additionalContact1, tspContactId),
          eq(eventRequests.additionalContact2, tspContactId)
        ),
        eq(eventRequests.status, 'completed')
      )
    )
    .orderBy(desc(eventRequests.statusChangedAt))
    .limit(5);

  return events.map((event) => ({
    eventId: event.id,
    organizationName: event.organizationName || 'Unknown Organization',
    status: 'completed',
    eventDate: event.scheduledEventDate ? new Date(event.scheduledEventDate).toISOString() : null,
    nextAction: 'Completed',
    urgency: 'low' as const,
    daysSinceLastContact: null,
    contactName: event.contactName || null,
    contactPhone: event.contactPhone || null,
    contactEmail: event.email || event.contactEmail || null,
  }));
}

/**
 * Count total completed events for a TSP contact
 */
async function getTotalCompletedCount(tspContactId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventRequests)
    .where(
      and(
        or(
          eq(eventRequests.tspContact, tspContactId),
          eq(eventRequests.tspContactAssigned, tspContactId),
          eq(eventRequests.additionalContact1, tspContactId),
          eq(eventRequests.additionalContact2, tspContactId)
        ),
        eq(eventRequests.status, 'completed')
      )
    );

  return result[0]?.count || 0;
}

/**
 * Get scheduled events happening within the next 7 days that were placed on
 * the calendar more than 14 days before their event date.
 *
 * These are events planned well in advance that now need a pre-event contact
 * check-in. The 7-day window means Monday's digest catches events from Monday
 * through the following Sunday — so any event day of the week is covered.
 */
async function getUpcomingContactNeededEvents(tspContactId: string): Promise<DigestEventSummary[]> {
  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(now.getDate() + 7);

  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        or(
          eq(eventRequests.tspContact, tspContactId),
          eq(eventRequests.tspContactAssigned, tspContactId),
          eq(eventRequests.additionalContact1, tspContactId),
          eq(eventRequests.additionalContact2, tspContactId)
        ),
        // Include 'rescheduled' — rescheduled events still appear in the digest.
        inArray(eventRequests.status, ['scheduled', 'rescheduled']),
        // Event is happening within the next 7 days
        gte(eventRequests.scheduledEventDate, now),
        lte(eventRequests.scheduledEventDate, sevenDaysFromNow),
        // Event was put on the calendar at least 14 days before the event date
        // i.e. scheduledEventDate - statusChangedAt > 14 days
        sql`${eventRequests.scheduledEventDate} - ${eventRequests.statusChangedAt} > interval '14 days'`
      )
    )
    .orderBy(eventRequests.scheduledEventDate);

  return events.map((event) => {
    const eventDate = event.scheduledEventDate;
    const daysUntil = eventDate
      ? Math.ceil((new Date(eventDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      eventId: event.id,
      organizationName: event.organizationName || 'Unknown Organization',
      status: 'scheduled',
      eventDate: eventDate ? new Date(eventDate).toISOString() : null,
      nextAction: daysUntil !== null
        ? `Coming up in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`
        : 'Coming up soon',
      urgency: 'high' as const,
      daysSinceLastContact: null,
      contactName: event.contactName || null,
      contactPhone: event.contactPhone || null,
      contactEmail: event.email || event.contactEmail || null,
    };
  });
}

/**
 * Build complete digest data for a TSP contact
 */
export async function buildDigestDataForContact(tspContactId: string): Promise<WeeklyDigestData | null> {
  try {
    // Get user info
    const [user] = await db.select().from(users).where(eq(users.id, tspContactId)).limit(1);

    if (!user || !user.email) {
      logger.warn(`Cannot build digest for user ${tspContactId}: user not found or no email`);
      return null;
    }

    const [activeEvents, recentlyCompleted, completedHistory, totalCompleted, upcomingContactNeeded] = await Promise.all([
      getActiveEventsForContact(tspContactId),
      getRecentlyCompletedEvents(tspContactId),
      getCompletedHistory(tspContactId),
      getTotalCompletedCount(tspContactId),
      getUpcomingContactNeededEvents(tspContactId),
    ]);

    // Skip digest if user has no events at all
    if (activeEvents.length === 0 && totalCompleted === 0 && upcomingContactNeeded.length === 0) {
      logger.log(`Skipping digest for ${user.email}: no events assigned`);
      return null;
    }

    const needsUrgentAttention = activeEvents.filter((e) => e.urgency === 'high').length;

    return {
      tspContactId,
      tspContactName: user.displayName || user.firstName || user.email.split('@')[0],
      tspContactEmail: user.preferredEmail || user.email,
      activeEvents,
      upcomingContactNeeded,
      recentlyCompleted,
      completedHistory,
      stats: {
        totalActive: activeEvents.length,
        needsUrgentAttention,
        completedThisWeek: recentlyCompleted.length,
        totalCompletedAllTime: totalCompleted,
      },
      generatedAt: new Date(),
    };
  } catch (error) {
    logger.error(`Error building digest for contact ${tspContactId}:`, error);
    return null;
  }
}

// ============================================================================
// EMAIL RENDERING
// ============================================================================

/**
 * Format date for display
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get status badge color
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'new':
      return '#3B82F6'; // blue
    case 'rescheduled':
      return '#236383'; // teal (same as scheduled)
    case 'in_process':
      return '#F59E0B'; // amber
    case 'scheduled':
      return '#10B981'; // green
    case 'standby':
      return '#6B7280'; // gray
    case 'completed':
      return '#059669'; // emerald
    default:
      return '#6B7280';
  }
}

/**
 * Get urgency indicator
 */
function getUrgencyIndicator(urgency: 'high' | 'medium' | 'low'): string {
  switch (urgency) {
    case 'high':
      return '🔴';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
  }
}

/**
 * Render a single event row for the email
 */
function renderEventRow(event: DigestEventSummary, baseUrl: string): string {
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.eventId}`;
  const urgencyIcon = getUrgencyIndicator(event.urgency);
  const statusColor = getStatusColor(event.status);

  return `
    <tr style="border-bottom: 1px solid #E5E7EB;">
      <td style="padding: 12px 8px; vertical-align: top;">
        <div style="font-weight: 600; color: #1F2937;">
          ${urgencyIcon} <a href="${eventUrl}" style="color: #236383; text-decoration: none;">${event.organizationName}</a>
        </div>
        ${event.contactName ? `<div style="font-size: 12px; color: #6B7280; margin-top: 2px;">Contact: ${event.contactName}</div>` : ''}
      </td>
      <td style="padding: 12px 8px; text-align: center; vertical-align: top;">
        <span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; background-color: ${statusColor}20; color: ${statusColor};">
          ${event.status.replace('_', ' ').toUpperCase()}
        </span>
      </td>
      <td style="padding: 12px 8px; text-align: center; vertical-align: top; font-size: 13px; color: #4B5563;">
        ${formatDate(event.eventDate)}
      </td>
      <td style="padding: 12px 8px; vertical-align: top; font-size: 13px; color: #374151; max-width: 200px;">
        ${event.nextAction}
      </td>
    </tr>
  `;
}

/**
 * Render completed event row (simpler)
 */
function renderCompletedRow(event: DigestEventSummary, baseUrl: string): string {
  const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.eventId}`;

  return `
    <tr style="border-bottom: 1px solid #E5E7EB;">
      <td style="padding: 8px; vertical-align: top;">
        <a href="${eventUrl}" style="color: #059669; text-decoration: none; font-weight: 500;">${event.organizationName}</a>
      </td>
      <td style="padding: 8px; text-align: center; color: #6B7280; font-size: 13px;">
        ${formatDate(event.eventDate)}
      </td>
    </tr>
  `;
}

/**
 * Build the HTML email for the weekly digest
 */
export function buildDigestEmailHtml(data: WeeklyDigestData): string {
  const baseUrl = getAppBaseUrl();
  const dashboardUrl = `${baseUrl}/dashboard?section=event-requests`;

  // Sort active events by urgency
  const sortedActive = [...data.activeEvents].sort((a, b) => {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  });

  const highPriorityEvents = sortedActive.filter((e) => e.urgency === 'high');
  const otherActiveEvents = sortedActive.filter((e) => e.urgency !== 'high');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Weekly Event Portfolio - The Sandwich Project</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #F3F4F6;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 20px;">
            <table role="presentation" style="max-width: 700px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">

              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #236383 0%, #1a4d63 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 600;">
                    🥪 Your Weekly Event Portfolio
                  </h1>
                  <p style="margin: 8px 0 0 0; color: #B8D4E3; font-size: 14px;">
                    Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                </td>
              </tr>

              <!-- Greeting -->
              <tr>
                <td style="padding: 24px 30px 16px 30px;">
                  <p style="margin: 0; color: #374151; font-size: 16px;">
                    Good morning, ${data.tspContactName}! 👋
                  </p>
                  <p style="margin: 8px 0 0 0; color: #6B7280; font-size: 14px;">
                    Here's your event portfolio summary for this week.
                  </p>
                </td>
              </tr>

              <!-- Stats Cards -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <table role="presentation" style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="width: 25%; padding: 8px;">
                        <div style="background: #EFF6FF; border-radius: 8px; padding: 16px; text-align: center;">
                          <div style="font-size: 28px; font-weight: 700; color: #236383;">${data.stats.totalActive}</div>
                          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">Active</div>
                        </div>
                      </td>
                      <td style="width: 25%; padding: 8px;">
                        <div style="background: ${data.stats.needsUrgentAttention > 0 ? '#FEF2F2' : '#F0FDF4'}; border-radius: 8px; padding: 16px; text-align: center;">
                          <div style="font-size: 28px; font-weight: 700; color: ${data.stats.needsUrgentAttention > 0 ? '#DC2626' : '#059669'};">${data.stats.needsUrgentAttention}</div>
                          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">Urgent</div>
                        </div>
                      </td>
                      <td style="width: 25%; padding: 8px;">
                        <div style="background: #ECFDF5; border-radius: 8px; padding: 16px; text-align: center;">
                          <div style="font-size: 28px; font-weight: 700; color: #059669;">${data.stats.completedThisWeek}</div>
                          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">This Week</div>
                        </div>
                      </td>
                      <td style="width: 25%; padding: 8px;">
                        <div style="background: #F5F3FF; border-radius: 8px; padding: 16px; text-align: center;">
                          <div style="font-size: 28px; font-weight: 700; color: #7C3AED;">${data.stats.totalCompletedAllTime}</div>
                          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;">All Time</div>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              ${
                data.upcomingContactNeeded.length > 0
                  ? `
              <!-- Upcoming Events This Week - Friendly Reminder -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px;">
                    <h3 style="margin: 0 0 4px 0; color: #1E40AF; font-size: 14px; font-weight: 600;">
                      🗓️ Coming Up This Week (${data.upcomingContactNeeded.length})
                    </h3>
                    <p style="margin: 0 0 12px 0; color: #3B82F6; font-size: 13px;">
                      These events are just around the corner — worth a quick touch base if you haven't connected with them recently!
                    </p>
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <thead>
                        <tr style="border-bottom: 1px solid #BFDBFE;">
                          <th style="text-align: left; padding: 8px; font-size: 11px; color: #1E40AF; text-transform: uppercase;">Organization</th>
                          <th style="text-align: center; padding: 8px; font-size: 11px; color: #1E40AF; text-transform: uppercase;">Event Date</th>
                          <th style="text-align: left; padding: 8px; font-size: 11px; color: #1E40AF; text-transform: uppercase;">Contact Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${data.upcomingContactNeeded.map((e) => {
                          const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${e.eventId}`;
                          return `
                            <tr style="border-bottom: 1px solid #DBEAFE;">
                              <td style="padding: 10px 8px; vertical-align: top;">
                                <a href="${eventUrl}" style="color: #1D4ED8; font-weight: 600; text-decoration: none;">${e.organizationName}</a>
                                <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">${e.nextAction}</div>
                              </td>
                              <td style="padding: 10px 8px; text-align: center; vertical-align: top;">
                                <strong style="color: #1E40AF; font-size: 14px;">${formatDate(e.eventDate)}</strong>
                              </td>
                              <td style="padding: 10px 8px; vertical-align: top; font-size: 12px; color: #374151;">
                                ${e.contactName ? `<div>${e.contactName}</div>` : ''}
                                ${e.contactPhone ? `<div>${e.contactPhone}</div>` : ''}
                                ${e.contactEmail ? `<div>${e.contactEmail}</div>` : ''}
                                ${!e.contactName && !e.contactPhone && !e.contactEmail ? '<span style="color:#9CA3AF;">No contact info on file</span>' : ''}
                              </td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
              `
                  : ''
              }

              ${
                highPriorityEvents.length > 0
                  ? `
              <!-- Urgent Attention Section -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px;">
                    <h3 style="margin: 0 0 12px 0; color: #991B1B; font-size: 14px; font-weight: 600;">
                      🔴 NEEDS URGENT ATTENTION (${highPriorityEvents.length})
                    </h3>
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <thead>
                        <tr style="border-bottom: 2px solid #FECACA;">
                          <th style="text-align: left; padding: 8px; font-size: 11px; color: #991B1B; text-transform: uppercase;">Organization</th>
                          <th style="text-align: center; padding: 8px; font-size: 11px; color: #991B1B; text-transform: uppercase;">Status</th>
                          <th style="text-align: center; padding: 8px; font-size: 11px; color: #991B1B; text-transform: uppercase;">Date</th>
                          <th style="text-align: left; padding: 8px; font-size: 11px; color: #991B1B; text-transform: uppercase;">Action Needed</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${highPriorityEvents.map((e) => renderEventRow(e, baseUrl)).join('')}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
              `
                  : ''
              }

              ${
                otherActiveEvents.length > 0
                  ? `
              <!-- Other Active Events -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 600;">
                    📋 Active Events (${otherActiveEvents.length})
                  </h3>
                  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #E5E7EB; border-radius: 8px;">
                    <thead>
                      <tr style="background: #F9FAFB; border-bottom: 1px solid #E5E7EB;">
                        <th style="text-align: left; padding: 10px 8px; font-size: 11px; color: #6B7280; text-transform: uppercase;">Organization</th>
                        <th style="text-align: center; padding: 10px 8px; font-size: 11px; color: #6B7280; text-transform: uppercase;">Status</th>
                        <th style="text-align: center; padding: 10px 8px; font-size: 11px; color: #6B7280; text-transform: uppercase;">Date</th>
                        <th style="text-align: left; padding: 10px 8px; font-size: 11px; color: #6B7280; text-transform: uppercase;">Next Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${otherActiveEvents.map((e) => renderEventRow(e, baseUrl)).join('')}
                    </tbody>
                  </table>
                </td>
              </tr>
              `
                  : ''
              }

              ${
                data.activeEvents.length === 0
                  ? `
              <!-- No Active Events -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <div style="background: #F0FDF4; border-radius: 8px; padding: 24px; text-align: center;">
                    <div style="font-size: 32px; margin-bottom: 8px;">🎉</div>
                    <p style="margin: 0; color: #059669; font-weight: 600;">All caught up!</p>
                    <p style="margin: 4px 0 0 0; color: #6B7280; font-size: 14px;">No active events needing attention right now.</p>
                  </div>
                </td>
              </tr>
              `
                  : ''
              }

              ${
                data.recentlyCompleted.length > 0
                  ? `
              <!-- Recently Completed -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <h3 style="margin: 0 0 12px 0; color: #059669; font-size: 14px; font-weight: 600;">
                    ✅ Completed This Week (${data.recentlyCompleted.length})
                  </h3>
                  <table role="presentation" style="width: 100%; border-collapse: collapse; background: #F0FDF4; border-radius: 8px;">
                    <tbody>
                      ${data.recentlyCompleted.map((e) => renderCompletedRow(e, baseUrl)).join('')}
                    </tbody>
                  </table>
                </td>
              </tr>
              `
                  : ''
              }

              ${
                data.completedHistory.length > 0
                  ? `
              <!-- Your Impact -->
              <tr>
                <td style="padding: 0 30px 24px 30px;">
                  <h3 style="margin: 0 0 12px 0; color: #6B7280; font-size: 14px; font-weight: 600;">
                    📊 Your Recent Wins
                  </h3>
                  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #E5E7EB; border-radius: 8px;">
                    <tbody>
                      ${data.completedHistory.map((e) => renderCompletedRow(e, baseUrl)).join('')}
                    </tbody>
                  </table>
                  <p style="margin: 8px 0 0 0; font-size: 12px; color: #9CA3AF; text-align: center;">
                    You've helped coordinate <strong>${data.stats.totalCompletedAllTime}</strong> successful events! 🎉
                  </p>
                </td>
              </tr>
              `
                  : ''
              }

              <!-- CTA Button -->
              <tr>
                <td style="padding: 0 30px 30px 30px; text-align: center;">
                  <a href="${dashboardUrl}" style="display: inline-block; background: #236383; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    View Full Dashboard →
                  </a>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background: #F9FAFB; padding: 20px 30px; border-top: 1px solid #E5E7EB;">
                  ${EMAIL_FOOTER_HTML}
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * Build plain text version of the digest
 */
export function buildDigestEmailText(data: WeeklyDigestData): string {
  const baseUrl = getAppBaseUrl();

  let text = `🥪 YOUR WEEKLY EVENT PORTFOLIO\n`;
  text += `Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n`;

  text += `Good morning, ${data.tspContactName}!\n\n`;

  text += `SUMMARY\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Active Events: ${data.stats.totalActive}\n`;
  text += `Needs Urgent Attention: ${data.stats.needsUrgentAttention}\n`;
  text += `Completed This Week: ${data.stats.completedThisWeek}\n`;
  text += `Total Completed All Time: ${data.stats.totalCompletedAllTime}\n\n`;

  if (data.upcomingContactNeeded.length > 0) {
    text += `🗓️ COMING UP THIS WEEK\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Just a heads up — these events are just around the corner!\n\n`;
    for (const event of data.upcomingContactNeeded) {
      text += `• ${event.organizationName} — ${formatDate(event.eventDate)}\n`;
      if (event.contactName) text += `  Contact: ${event.contactName}\n`;
      if (event.contactPhone) text += `  Phone: ${event.contactPhone}\n`;
      if (event.contactEmail) text += `  Email: ${event.contactEmail}\n`;
      text += `  View: ${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.eventId}\n\n`;
    }
  }

  if (data.activeEvents.length > 0) {
    const highPriority = data.activeEvents.filter((e) => e.urgency === 'high');
    const otherActive = data.activeEvents.filter((e) => e.urgency !== 'high');

    if (highPriority.length > 0) {
      text += `🔴 URGENT ATTENTION NEEDED\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const event of highPriority) {
        text += `• ${event.organizationName} (${event.status})\n`;
        text += `  Date: ${formatDate(event.eventDate)}\n`;
        text += `  Action: ${event.nextAction}\n`;
        text += `  View: ${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${event.eventId}\n\n`;
      }
    }

    if (otherActive.length > 0) {
      text += `📋 OTHER ACTIVE EVENTS\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const event of otherActive) {
        text += `• ${event.organizationName} (${event.status})\n`;
        text += `  Date: ${formatDate(event.eventDate)}\n`;
        text += `  Action: ${event.nextAction}\n\n`;
      }
    }
  } else {
    text += `🎉 All caught up! No active events needing attention.\n\n`;
  }

  if (data.recentlyCompleted.length > 0) {
    text += `✅ COMPLETED THIS WEEK\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const event of data.recentlyCompleted) {
      text += `• ${event.organizationName} - ${formatDate(event.eventDate)}\n`;
    }
    text += `\n`;
  }

  text += `\nView your full dashboard: ${baseUrl}/dashboard?section=event-requests\n\n`;
  text += `---\nThe Sandwich Project - Fighting food insecurity one sandwich at a time\n`;

  return text;
}

// ============================================================================
// EMAIL SENDING
// ============================================================================

/**
 * Send weekly digest email to a single TSP contact
 */
export async function sendWeeklyDigestEmail(data: WeeklyDigestData): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('SendGrid not configured - skipping weekly digest email');
    return false;
  }

  try {
    const msg = {
      to: data.tspContactEmail,
      from: 'katie@thesandwichproject.org',
      subject: `📋 Your Weekly Event Portfolio - ${data.stats.totalActive} Active Events`,
      html: buildDigestEmailHtml(data),
      text: buildDigestEmailText(data),
    };

    await sgMail.send(msg);
    logger.log(`Weekly digest sent to ${data.tspContactEmail} (${data.stats.totalActive} active, ${data.stats.needsUrgentAttention} urgent)`);
    return true;
  } catch (error) {
    logger.error(`Error sending weekly digest to ${data.tspContactEmail}:`, error);
    return false;
  }
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Get all TSP contacts who should receive weekly digests.
 * Always includes the admin user (Katie) so she gets her own personalized digest
 * regardless of whether she is explicitly assigned to active events.
 */
async function getAllActiveTspContacts(): Promise<string[]> {
  // Find all unique TSP contact IDs from active events
  const activeStatuses = ['new', 'in_process', 'scheduled', 'rescheduled', 'standby'];

  const result = await db
    .selectDistinct({
      tspContact: eventRequests.tspContact,
      tspContactAssigned: eventRequests.tspContactAssigned,
      additionalContact1: eventRequests.additionalContact1,
      additionalContact2: eventRequests.additionalContact2,
    })
    .from(eventRequests)
    .where(inArray(eventRequests.status, activeStatuses));

  // Collect all unique contact IDs
  const contactIds = new Set<string>();
  for (const row of result) {
    if (row.tspContact) contactIds.add(row.tspContact);
    if (row.tspContactAssigned) contactIds.add(row.tspContactAssigned);
    if (row.additionalContact1) contactIds.add(row.additionalContact1);
    if (row.additionalContact2) contactIds.add(row.additionalContact2);
  }

  // Always include the admin user so they receive a weekly digest.
  // Match case-insensitively to survive any stray-case config values.
  const adminUser = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(${users.email}) = ${ADMIN_EMAIL.trim().toLowerCase()}`)
    .limit(1);

  if (adminUser.length > 0) {
    contactIds.add(adminUser[0].id);
  }

  if (contactIds.size === 0) return [];

  // Filter out users who have opted out of the weekly portfolio digest.
  // This applies to everyone, including the auto-included admin — if the
  // admin opts out, they stop receiving it.
  const ids = Array.from(contactIds);
  const optedOut = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.weeklyDigestOptOut, true)));

  if (optedOut.length === 0) return ids;

  const optedOutSet = new Set(optedOut.map((u) => u.id));
  return ids.filter((id) => !optedOutSet.has(id));
}

/**
 * Process and send weekly digests to all active TSP contacts
 */
export async function processWeeklyDigests(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  logger.log('🗓️ Starting weekly digest processing...');

  const contactIds = await getAllActiveTspContacts();
  logger.log(`Found ${contactIds.length} TSP contacts with active events`);

  const results = {
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const contactId of contactIds) {
    try {
      const digestData = await buildDigestDataForContact(contactId);

      if (!digestData) {
        results.skipped++;
        continue;
      }

      const success = await sendWeeklyDigestEmail(digestData);

      if (success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push(`Failed to send to ${digestData.tspContactEmail}`);
      }

      // Small delay between sends to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      results.failed++;
      results.errors.push(`Error processing contact ${contactId}: ${(error as Error).message}`);
      logger.error(`Error processing digest for contact ${contactId}:`, error);
    }
  }

  logger.log(`📧 Weekly digest complete: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`);
  return results;
}

export default {
  buildDigestDataForContact,
  buildDigestEmailHtml,
  buildDigestEmailText,
  sendWeeklyDigestEmail,
  processWeeklyDigests,
};
