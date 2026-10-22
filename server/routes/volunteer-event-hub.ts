/**
 * Volunteer Event Hub Routes
 *
 * API routes for volunteers and speakers to browse and sign up for events.
 * Includes notification system for coordinators when signups occur.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { eq, and, or, gte, inArray, sql, desc, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  eventRequests,
  eventVolunteerDeclines,
  eventVolunteers,
  users,
  insertEventVolunteerSchema
} from '@shared/schema';
import { isAuthenticated } from '../auth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { logger } from '../utils/production-safe-logger';
import type { AuthenticatedRequest } from '../types/express';
import { EmailNotificationService } from '../services/email-notification-service';
import { getAppBaseUrl } from '../config/constants';
import sgMail from '@sendgrid/mail';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getUnfilledCounts, getVolunteerCount, getTotalDriverCount } from '../utils/assignment-utils';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';
import { isEligibleForRole, getIneligibilityReason, type EventRole } from '../../shared/event-role-eligibility';

const router = Router();

// Coordinator emails for notifications
const COORDINATOR_EMAILS = [
  'katie@thesandwichproject.org'
];

const ACTIVE_SIGNUP_STATUSES = ['pending', 'confirmed', 'assigned'];

type VolunteerHubEventRow = typeof eventRequests.$inferSelect;

/** Prefer active scheduled records when sheet sync created duplicate rows. */
function pickVolunteerHubDuplicate(a: VolunteerHubEventRow, b: VolunteerHubEventRow): VolunteerHubEventRow {
  const activeStatuses = new Set(['scheduled', 'rescheduled']);
  const aActive = activeStatuses.has(a.status);
  const bActive = activeStatuses.has(b.status);
  if (aActive !== bActive) return aActive ? a : b;
  const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return a.id > b.id ? a : b;
}

/** Collapse duplicate hub rows (same googleSheetRowId) so calendar days don't list one event twice. */
function dedupeVolunteerHubEvents(events: VolunteerHubEventRow[]): VolunteerHubEventRow[] {
  const byId = new Map<number, VolunteerHubEventRow>();
  const bySheetRow = new Map<string, VolunteerHubEventRow>();

  for (const event of events) {
    const sheetKey = event.googleSheetRowId?.trim();
    if (sheetKey) {
      const existing = bySheetRow.get(sheetKey);
      if (existing) {
        const keep = pickVolunteerHubDuplicate(existing, event);
        byId.delete(existing.id);
        byId.set(keep.id, keep);
        bySheetRow.set(sheetKey, keep);
        continue;
      }
      bySheetRow.set(sheetKey, event);
    }
    if (!byId.has(event.id)) {
      byId.set(event.id, event);
    }
  }

  return Array.from(byId.values());
}

/**
 * Whether an event is a genuine volunteer opportunity that belongs on the hub.
 *
 * Two kinds of events are auto-excluded even when a coordinator left
 * `showOnVolunteerHub` on:
 *   1. Self-transport events — the group handles its own logistics and isn't
 *      looking for sign-ups at all.
 *   2. Events with no role explicitly designated as needed — surfacing these
 *      shows a misleading "extra help welcome" sign-up on events that never
 *      asked for volunteers.
 *
 * Note this gates on the *designated* need (count > 0), not unfilled slots, so
 * a fully-staffed event that did request help still appears (the existing
 * "fully staffed, extra help welcome" behavior is preserved for those). The van
 * driver role only counts when it isn't a DHL-provided van — DHL handling the
 * van/driver means there was never a volunteer van-driver role to begin with.
 */
function eventOffersVolunteerOpportunity(event: VolunteerHubEventRow): boolean {
  if (event.selfTransport) return false;
  return (
    (event.driversNeeded ?? 0) > 0 ||
    (event.volunteersNeeded ?? 0) > 0 ||
    (!!event.vanDriverNeeded && !event.isDhlVan)
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Send notification to coordinators when a volunteer signs up
 */
async function sendVolunteerSignupNotification(
  volunteerName: string,
  volunteerEmail: string,
  eventId: number,
  organizationName: string,
  eventDate: string | null,
  roles: string[],
  notes: string | null
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('SendGrid not configured - skipping volunteer signup notification');
    return;
  }

  try {
    const baseUrl = getAppBaseUrl();
    const eventUrl = `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
    const volunteerHubUrl = `${baseUrl}/volunteer-hub`;

    // Format event date
    const formattedDate = formatEventDateLong(eventDate);

    // Format roles for display
    const roleDisplay = roles
      .map((role) => (
        role === 'driver' ? 'Driver'
        : role === 'speaker' ? 'Speaker'
        : role === 'general' ? 'General Volunteer'
        : role
      ))
      .join(', ');

    const msg = {
      to: COORDINATOR_EMAILS,
      from: 'katie@thesandwichproject.org',
      subject: `New Volunteer Signup: ${volunteerName} for ${organizationName} - The Sandwich Project`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #22c55e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .signup-details { background: white; padding: 15px; border-left: 4px solid #22c55e; margin: 15px 0; }
            .event-details { background: #e6f7f9; padding: 12px; border-left: 4px solid #236383; margin: 15px 0; }
            .action-required { background: #FEF3CD; border: 1px solid #FFEEBA; padding: 15px; border-radius: 6px; margin: 15px 0; }
            .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 5px 10px 0; }
            .btn-secondary { background: #6c757d; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Volunteer Signup!</h1>
            </div>
            <div class="content">
              <p>A volunteer has requested to help at an upcoming event:</p>

              <div class="signup-details">
                <strong>Volunteer:</strong> ${volunteerName}<br>
                <strong>Email:</strong> ${volunteerEmail}<br>
                <strong>Roles Requested:</strong> ${roleDisplay}
                ${notes ? `<br><strong>Notes:</strong> ${notes}` : ''}
              </div>

              <div class="event-details">
                <strong>Event:</strong> ${organizationName}<br>
                <strong>Date:</strong> ${formattedDate}
              </div>

              <div class="action-required">
                <strong>Action Required:</strong><br>
                Please review this signup request and confirm or decline the volunteer's participation.
                Check that the event details haven't changed and that the role is still needed.
              </div>

              <p>
                <a href="${eventUrl}" class="btn">Review Event</a>
                <a href="${volunteerHubUrl}" class="btn btn-secondary">View All Signups</a>
              </p>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
New Volunteer Signup!

A volunteer has requested to help at an upcoming event:

Volunteer: ${volunteerName}
Email: ${volunteerEmail}
Roles Requested: ${roleDisplay}
${notes ? `Notes: ${notes}` : ''}

Event: ${organizationName}
Date: ${formattedDate}

ACTION REQUIRED:
Please review this signup request and confirm or decline the volunteer's participation.
Check that the event details haven't changed and that the role is still needed.

Review Event: ${eventUrl}
View All Signups: ${volunteerHubUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time
      `.trim(),
    };

    await sgMail.send(msg);
    logger.info(`Volunteer signup notification sent to coordinators for event ${eventId}`);
  } catch (error) {
    logger.error('Error sending volunteer signup notification:', error);
  }
}

/**
 * Send confirmation email to volunteer after they sign up (pending approval)
 */
async function sendVolunteerSignupConfirmationEmail(
  volunteerName: string,
  volunteerEmail: string,
  organizationName: string,
  eventDate: string | Date | null,
  eventStartTime: string | null,
  eventEndTime: string | null,
  eventAddress: string | null,
  roles: string[]
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY || !volunteerEmail) {
    return;
  }

  try {
    const formattedDate = formatEventDateLong(eventDate);

    const timeDisplay = eventStartTime
      ? `${eventStartTime}${eventEndTime ? ` – ${eventEndTime}` : ''}`
      : null;

    const roleDisplay = roles
      .map((role) => (
        role === 'driver' ? 'Driver'
        : role === 'speaker' ? 'Speaker'
        : role === 'general' ? 'General Volunteer'
        : role
      ))
      .join(', ');

    const msg = {
      to: volunteerEmail,
      from: 'katie@thesandwichproject.org',
      subject: `Signup Received — ${organizationName} on ${formattedDate}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .event-details { background: #e6f7f9; padding: 15px; border-left: 4px solid #236383; margin: 15px 0; }
            .status-note { background: #FEF3CD; border: 1px solid #FFEEBA; padding: 15px; border-radius: 6px; margin: 15px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Thanks for Signing Up, ${volunteerName}!</h1>
            </div>
            <div class="content">
              <p>We've received your volunteer signup request for the following event:</p>

              <div class="event-details">
                <strong>Event:</strong> ${organizationName}<br>
                <strong>Date:</strong> ${formattedDate}<br>
                ${timeDisplay ? `<strong>Time:</strong> ${timeDisplay}<br>` : ''}
                ${eventAddress ? `<strong>Location:</strong> ${eventAddress}<br>` : ''}
                <strong>Role${roles.length > 1 ? 's' : ''}:</strong> ${roleDisplay}
              </div>

              <div class="status-note">
                <strong>What happens next?</strong><br>
                A coordinator will review your signup and confirm your participation. You'll receive another email once you're confirmed.
              </div>

              <p>Thank you for volunteering with The Sandwich Project! Your help makes a real difference in fighting food insecurity in our community.</p>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Thanks for Signing Up, ${volunteerName}!

We've received your volunteer signup request:

Event: ${organizationName}
Date: ${formattedDate}
${timeDisplay ? `Time: ${timeDisplay}` : ''}
${eventAddress ? `Location: ${eventAddress}` : ''}
Role${roles.length > 1 ? 's' : ''}: ${roleDisplay}

WHAT HAPPENS NEXT:
A coordinator will review your signup and confirm your participation. You'll receive another email once you're confirmed.

Thank you for volunteering with The Sandwich Project!

---
The Sandwich Project - Fighting food insecurity one sandwich at a time
      `.trim(),
    };

    await sgMail.send(msg);
    logger.info(`Volunteer signup confirmation email sent to ${volunteerEmail}`);
  } catch (error) {
    logger.error('Error sending volunteer signup confirmation email:', error);
  }
}

// ============================================================================
// Calendar link helpers
// ============================================================================

const ROLE_DISPLAY: Record<string, string> = {
  driver: 'Driver',
  speaker: 'Speaker',
  general: 'General Volunteer',
};

function displayRole(role: string | null | undefined): string {
  if (!role) return 'Volunteer';
  return ROLE_DISPLAY[role] || role;
}

const CALENDAR_TIMEZONE = 'America/New_York';

/**
 * Offset (in ms) of the app timezone from UTC at a given instant.
 * For Eastern this is negative (-4h EDT, -5h EST).
 */
function calendarTimezoneOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: CALENDAR_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines render midnight as 24
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/**
 * Convert an Eastern wall-clock time (calendar day + h:mm) into the true UTC
 * instant, handling daylight saving automatically.
 */
function easternWallClockToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  const guess = Date.UTC(year, monthIndex, day, hours, minutes, 0);
  return new Date(guess - calendarTimezoneOffsetMs(new Date(guess)));
}

/**
 * Parse "HH:MM" or "H:MM AM/PM" into the true UTC Date for that Eastern
 * wall-clock time on the given calendar day. Event times are stored as Eastern
 * (America/New_York) wall-clock, so e.g. "10:00 AM" must land on a calendar as
 * 10am Eastern — not 10:00 UTC, which would show as 6am. If parsing fails,
 * returns null so caller can fall back to all-day.
 */
function combineDateAndTime(dateOnly: Date, time: string | null | undefined): Date | null {
  if (!time) return null;
  const t = time.trim();
  // Match "H:MM", "HH:MM", optionally followed by AM/PM
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  // dateOnly holds the intended calendar day in its UTC parts.
  return easternWallClockToUtc(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth(),
    dateOnly.getUTCDate(),
    hours,
    minutes,
  );
}

function formatICalDate(d: Date, allDay: boolean): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  if (allDay) return `${yyyy}${mm}${dd}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function googleCalendarLink(
  title: string,
  start: Date,
  end: Date,
  allDay: boolean,
  location: string | null,
  details: string | null
): string {
  const dates = allDay
    ? `${formatICalDate(start, true)}/${formatICalDate(end, true)}`
    : `${formatICalDate(start, false)}/${formatICalDate(end, false)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
  });
  if (location) params.set('location', location);
  if (details) params.set('details', details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsDataUri(
  uid: string,
  title: string,
  start: Date,
  end: Date,
  allDay: boolean,
  location: string | null,
  details: string | null
): string {
  const dtstart = allDay ? `DTSTART;VALUE=DATE:${formatICalDate(start, true)}` : `DTSTART:${formatICalDate(start, false)}`;
  const dtend = allDay ? `DTEND;VALUE=DATE:${formatICalDate(end, true)}` : `DTEND:${formatICalDate(end, false)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Sandwich Project//Volunteer Hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatICalDate(new Date(), false)}`,
    dtstart,
    dtend,
    `SUMMARY:${escapeICS(title)}`,
    location ? `LOCATION:${escapeICS(location)}` : '',
    details ? `DESCRIPTION:${escapeICS(details)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const ics = lines.join('\r\n');
  return `data:text/calendar;charset=utf-8;base64,${Buffer.from(ics, 'utf-8').toString('base64')}`;
}

/**
 * Build start/end Dates from an event's date + start/end times.
 * If a time is missing, the event is treated as all-day.
 */
function buildEventTimes(
  eventDate: string | Date | null | undefined,
  startTime: string | null | undefined,
  endTime: string | null | undefined
): { start: Date; end: Date; allDay: boolean } | null {
  if (!eventDate) return null;
  const dayDate = new Date(eventDate);
  if (isNaN(dayDate.getTime())) return null;
  // Normalize to UTC midnight for that calendar day
  const day = new Date(Date.UTC(dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate()));
  const start = combineDateAndTime(day, startTime);
  const end = combineDateAndTime(day, endTime);
  if (start && end) return { start, end, allDay: false };
  if (start && !end) {
    const fallbackEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2hr default
    return { start, end: fallbackEnd, allDay: false };
  }
  // All-day fallback (start = day, end = next day in DATE form)
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  return { start: day, end: nextDay, allDay: true };
}

// ============================================================================
// Approval / change / removal emails (brand-colored)
// ============================================================================

interface EventForEmail {
  id: number;
  organizationName: string | null;
  scheduledEventDate: string | Date | null;
  desiredEventDate: string | Date | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  eventAddress: string | null;
  notes?: string | null;
  message?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  tspContact?: string | null;
}

/**
 * Format an event date for display, e.g. "Tuesday, July 22, 2025".
 *
 * Event dates live in `timestamp` columns that serialize as UTC midnight
 * (e.g. "2025-07-22T00:00:00.000Z"). The intended calendar day is therefore in
 * the value's UTC parts — we read those directly and format without timezone
 * conversion. Converting to Eastern would shift UTC-midnight back to the
 * previous day. This matches the calendar-link logic (buildEventTimes) and the
 * client's parseEventDate, so the displayed date always matches the .ics entry.
 */
function formatEventDateLong(value: string | Date | null | undefined): string {
  if (!value) return 'Date TBD';
  let year: number;
  let monthIndex: number;
  let day: number;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return 'Date TBD';
    year = value.getUTCFullYear();
    monthIndex = value.getUTCMonth();
    day = value.getUTCDate();
  } else {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      year = Number(m[1]);
      monthIndex = Number(m[2]) - 1;
      day = Number(m[3]);
    } else {
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) return 'Date TBD';
      year = parsed.getUTCFullYear();
      monthIndex = parsed.getUTCMonth();
      day = parsed.getUTCDate();
    }
  }
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0)).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function eventDisplayDate(event: EventForEmail): { iso: string | null; formatted: string } {
  const date = getEffectiveEventDate(event);
  if (!date) return { iso: null, formatted: 'Date TBD' };
  const iso = typeof date === 'string' ? date : new Date(date).toISOString();
  return { iso, formatted: formatEventDateLong(date) };
}

/**
 * Send confirmation email to volunteer when their signup is approved.
 * Uses TSP brand colors and includes calendar links + contact info.
 */
async function sendVolunteerApprovalEmail(
  volunteerName: string,
  volunteerEmail: string,
  event: EventForEmail,
  role: string | null
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY || !volunteerEmail) {
    return;
  }

  try {
    const { formatted: formattedDate } = eventDisplayDate(event);
    const orgName = event.organizationName || 'The Sandwich Project Event';
    const timeDisplay = event.eventStartTime
      ? `${event.eventStartTime}${event.eventEndTime ? ` – ${event.eventEndTime}` : ''}`
      : null;
    const roleDisplay = displayRole(role);
    const mapsLink = event.eventAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.eventAddress)}`
      : null;

    // Calendar
    const eventDate = getEffectiveEventDate(event);
    const times = buildEventTimes(eventDate, event.eventStartTime, event.eventEndTime);
    const calTitle = `TSP: ${orgName} — ${roleDisplay}`;
    const calDetails = [
      `Role: ${roleDisplay}`,
      event.notes ? `Event notes: ${event.notes}` : null,
      event.tspContact ? `TSP contact: ${event.tspContact}` : null,
    ].filter(Boolean).join('\n');
    const googleLink = times ? googleCalendarLink(calTitle, times.start, times.end, times.allDay, event.eventAddress, calDetails) : null;
    const icsLink = times ? icsDataUri(`tsp-volunteer-${event.id}@thesandwichproject.org`, calTitle, times.start, times.end, times.allDay, event.eventAddress, calDetails) : null;

    // Contact section
    const eventContactName = [event.firstName, event.lastName].filter(Boolean).join(' ').trim();
    const contactBlock = (eventContactName || event.email || event.phone) ? `
      <div class="section">
        <h3 style="color: #236383; margin: 0 0 8px;">Event Contact</h3>
        ${eventContactName ? `<div><strong>${eventContactName}</strong></div>` : ''}
        ${event.email ? `<div><a href="mailto:${event.email}" style="color: #007E8C;">${event.email}</a></div>` : ''}
        ${event.phone ? `<div><a href="tel:${event.phone}" style="color: #007E8C;">${event.phone}</a></div>` : ''}
        ${event.tspContact ? `<div style="margin-top: 6px; color: #555;"><em>TSP contact:</em> ${event.tspContact}</div>` : ''}
      </div>` : '';

    const notesText = event.notes || event.message || null;
    const notesBlock = notesText ? `
      <div class="section">
        <h3 style="color: #236383; margin: 0 0 8px;">Event Notes</h3>
        <div style="white-space: pre-wrap; color: #444;">${notesText.replace(/</g, '&lt;')}</div>
      </div>` : '';

    const calendarButtons = (googleLink || icsLink) ? `
      <div style="text-align: center; margin: 24px 0 8px;">
        <p style="margin: 0 0 12px; color: #236383; font-weight: 600;">Add this to your calendar</p>
        ${googleLink ? `<a href="${googleLink}" style="display: inline-block; background: #007E8C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 4px 6px; font-weight: 600;">Google Calendar</a>` : ''}
        ${icsLink ? `<a href="${icsLink}" style="display: inline-block; background: #FBAD3F; color: #1a1a1a; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 4px 6px; font-weight: 600;">Apple / Outlook (.ics)</a>` : ''}
      </div>` : '';

    const msg = {
      to: volunteerEmail,
      from: 'katie@thesandwichproject.org',
      subject: `You're Confirmed — ${orgName} on ${formattedDate}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f4f6f8; }
            .container { max-width: 620px; margin: 0 auto; padding: 0; background: white; }
            .header { background: #236383; color: white; padding: 28px 24px; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .header .sub { margin-top: 6px; color: #cfe3eb; font-size: 14px; }
            .content { padding: 24px; }
            .event-card { background: #f1f8fb; border-left: 4px solid #47B3CB; padding: 16px 18px; border-radius: 6px; margin: 16px 0; }
            .event-card strong { color: #236383; }
            .role-pill { display: inline-block; background: #FBAD3F; color: #1a1a1a; padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 13px; }
            .section { margin: 18px 0; padding: 14px 16px; background: #fafafa; border-radius: 6px; border: 1px solid #eee; }
            .section h3 { font-size: 15px; }
            .footer { text-align: center; color: #666; font-size: 12px; padding: 16px; }
            a { color: #007E8C; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>You're Confirmed!</h1>
              <div class="sub">Thanks for stepping up, ${volunteerName}.</div>
            </div>
            <div class="content">
              <p style="font-size: 16px;">Your volunteer signup has been approved. Here's what you need to know:</p>

              <div class="event-card">
                <div style="font-size: 17px;"><strong>${orgName}</strong></div>
                <div style="margin: 6px 0;">
                  <strong>Date:</strong> ${formattedDate}<br>
                  ${timeDisplay ? `<strong>Time:</strong> ${timeDisplay}<br>` : ''}
                  ${event.eventAddress ? `<strong>Location:</strong> ${event.eventAddress}${mapsLink ? ` &nbsp;<a href="${mapsLink}" style="color: #007E8C; font-weight: 600;">View on Google Maps →</a>` : ''}<br>` : ''}
                </div>
                <div style="margin-top: 10px;">
                  <strong>Your role:</strong> <span class="role-pill">${roleDisplay}</span>
                </div>
              </div>

              ${calendarButtons}

              ${contactBlock}

              ${notesBlock}

              <p>If your plans change and you can no longer make it, please let us know as soon as possible so we can find a replacement.</p>
              <p style="color: #236383; font-weight: 600;">Thank you for making a difference with The Sandwich Project!</p>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
You're Confirmed!

Great news, ${volunteerName}! Your volunteer signup has been approved.

Event: ${orgName}
Date: ${formattedDate}
${timeDisplay ? `Time: ${timeDisplay}` : ''}
${event.eventAddress ? `Location: ${event.eventAddress}` : ''}
${mapsLink ? `Map: ${mapsLink}` : ''}
Your Role: ${roleDisplay}

${googleLink ? `Add to Google Calendar: ${googleLink}` : ''}

${eventContactName ? `Event contact: ${eventContactName}` : ''}
${event.email ? `Email: ${event.email}` : ''}
${event.phone ? `Phone: ${event.phone}` : ''}
${event.tspContact ? `TSP contact: ${event.tspContact}` : ''}

${notesText ? `Notes: ${notesText}` : ''}

If your plans change, please let us know so we can find a replacement.

Thank you for making a difference with The Sandwich Project!
      `.trim(),
    };

    await sgMail.send(msg);
    logger.info(`Volunteer approval email sent to ${volunteerEmail}`);
  } catch (error) {
    logger.error('Error sending volunteer approval email:', error);
  }
}

/**
 * Notify volunteer that their role on an event has been changed.
 */
async function sendVolunteerRoleChangeEmail(
  volunteerName: string,
  volunteerEmail: string,
  event: EventForEmail,
  oldRole: string | null,
  newRole: string | null,
  reason: string | null
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY || !volunteerEmail) return;
  try {
    const { formatted: formattedDate } = eventDisplayDate(event);
    const orgName = event.organizationName || 'The Sandwich Project Event';
    const oldDisplay = displayRole(oldRole);
    const newDisplay = displayRole(newRole);
    const timeDisplay = event.eventStartTime
      ? `${event.eventStartTime}${event.eventEndTime ? ` – ${event.eventEndTime}` : ''}`
      : null;
    const mapsLink = event.eventAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.eventAddress)}`
      : null;

    const msg = {
      to: volunteerEmail,
      from: 'katie@thesandwichproject.org',
      subject: `Your role has changed — ${orgName} on ${formattedDate}`,
      html: `
        <!DOCTYPE html>
        <html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f4f6f8; }
          .container { max-width: 620px; margin: 0 auto; background: white; }
          .header { background: #FBAD3F; color: #1a1a1a; padding: 24px; text-align: center; }
          .content { padding: 24px; }
          .event-card { background: #f1f8fb; border-left: 4px solid #47B3CB; padding: 16px 18px; border-radius: 6px; margin: 16px 0; }
          .change-card { background: #FFF7EC; border: 1px solid #FBAD3F; padding: 14px 16px; border-radius: 6px; margin: 16px 0; }
          .reason-card { background: #fafafa; border: 1px solid #eee; padding: 12px 16px; border-radius: 6px; margin: 12px 0; color: #444; }
        </style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin:0;">Your Volunteer Role Has Changed</h1>
            </div>
            <div class="content">
              <p>Hi ${volunteerName},</p>
              <p>A coordinator has updated your role for the following event:</p>

              <div class="event-card">
                <div style="font-size: 17px;"><strong>${orgName}</strong></div>
                <strong>Date:</strong> ${formattedDate}<br>
                ${timeDisplay ? `<strong>Time:</strong> ${timeDisplay}<br>` : ''}
                ${event.eventAddress ? `<strong>Location:</strong> ${event.eventAddress}${mapsLink ? ` &nbsp;<a href="${mapsLink}" style="color: #007E8C; font-weight:600;">View on Google Maps →</a>` : ''}` : ''}
              </div>

              <div class="change-card">
                <strong>Role change:</strong> ${oldDisplay} → <span style="background:#FBAD3F;color:#1a1a1a;padding:2px 10px;border-radius:999px;font-weight:600;">${newDisplay}</span>
              </div>

              ${reason ? `<div class="reason-card"><strong style="color:#236383;">A note from your coordinator:</strong><div style="margin-top:6px;white-space:pre-wrap;">${reason.replace(/</g, '&lt;')}</div></div>` : ''}

              <p>If you have questions or this change doesn't work for you, please reply to this email.</p>
              <p style="color:#236383; font-weight:600;">Thank you for your flexibility!</p>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body></html>
      `,
      text: `
Your volunteer role has changed.

Event: ${orgName}
Date: ${formattedDate}
${timeDisplay ? `Time: ${timeDisplay}` : ''}
${event.eventAddress ? `Location: ${event.eventAddress}` : ''}

Role change: ${oldDisplay} → ${newDisplay}

${reason ? `Coordinator note: ${reason}` : ''}

If this change doesn't work for you, please reply to this email.
Thank you!
      `.trim(),
    };
    await sgMail.send(msg);
    logger.info(`Role-change email sent to ${volunteerEmail}`);
  } catch (error) {
    logger.error('Error sending role change email:', error);
  }
}

/**
 * Notify volunteer their signup has been cancelled / removed by coordinator.
 */
async function sendVolunteerRemovalEmail(
  volunteerName: string,
  volunteerEmail: string,
  event: EventForEmail,
  role: string | null,
  reason: string | null
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY || !volunteerEmail) return;
  try {
    const { formatted: formattedDate } = eventDisplayDate(event);
    const orgName = event.organizationName || 'The Sandwich Project Event';
    const roleDisplay = displayRole(role);

    const msg = {
      to: volunteerEmail,
      from: 'katie@thesandwichproject.org',
      subject: `Your signup has been cancelled — ${orgName} on ${formattedDate}`,
      html: `
        <!DOCTYPE html>
        <html><head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f4f6f8; }
          .container { max-width: 620px; margin: 0 auto; background: white; }
          .header { background: #A31C41; color: white; padding: 24px; text-align: center; }
          .content { padding: 24px; }
          .event-card { background: #f1f8fb; border-left: 4px solid #47B3CB; padding: 16px 18px; border-radius: 6px; margin: 16px 0; }
          .reason-card { background: #fafafa; border: 1px solid #eee; padding: 12px 16px; border-radius: 6px; margin: 12px 0; color: #444; }
        </style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin:0;">Your Volunteer Signup Has Been Cancelled</h1>
            </div>
            <div class="content">
              <p>Hi ${volunteerName},</p>
              <p>Your ${roleDisplay} signup for the following event has been cancelled:</p>

              <div class="event-card">
                <div style="font-size:17px;"><strong>${orgName}</strong></div>
                <strong>Date:</strong> ${formattedDate}
              </div>

              ${reason ? `<div class="reason-card"><strong style="color:#236383;">A note from your coordinator:</strong><div style="margin-top:6px;white-space:pre-wrap;">${reason.replace(/</g, '&lt;')}</div></div>` : ''}

              <p>You're welcome to sign up again any time — visit the Volunteer Hub to browse upcoming opportunities.</p>
              <p>If you have questions, please reply to this email.</p>
              <p style="color:#236383; font-weight:600;">Thanks for everything you do for The Sandwich Project.</p>

              ${EMAIL_FOOTER_HTML}
            </div>
          </div>
        </body></html>
      `,
      text: `
Your volunteer signup has been cancelled.

Event: ${orgName}
Date: ${formattedDate}
Role: ${roleDisplay}

${reason ? `Coordinator note: ${reason}` : ''}

You're welcome to sign up again any time. If you have questions, please reply to this email.
Thanks!
      `.trim(),
    };
    await sgMail.send(msg);
    logger.info(`Removal email sent to ${volunteerEmail}`);
  } catch (error) {
    logger.error('Error sending removal email:', error);
  }
}

// ============================================================================
// Public Event Browsing Routes (for volunteers)
// ============================================================================

/**
 * Get all events available for volunteer signup
 * Returns scheduled and completed events (not new requests or in-process ones)
 */
router.get('/available-events', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Returns:
    //   - All upcoming events (status scheduled/rescheduled, date ≥ today)
    //     for list, map, and forward-looking calendar views.
    //   - Optionally, completed events for a SINGLE past month — when the
    //     calendar is showing a month with past dates, the client passes
    //     `?pastMonth=YYYY-MM` and we add only that month's completed
    //     events so the calendar can render them as faded "Completed"
    //     context. We do NOT load all completed events at once because
    //     the calendar only shows one month at a time anyway.
    //
    // Use Eastern Time to determine "today" since server may be in UTC
    // (at 7pm+ EST, UTC has already rolled to the next day)
    const now = new Date();
    const easternNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = new Date(easternNow.getFullYear(), easternNow.getMonth(), easternNow.getDate());

    // Parse optional pastMonth=YYYY-MM (e.g. "2026-05"). Strict format —
    // any malformed value is ignored rather than rejected, so a stale
    // client doesn't fail the whole request.
    const pastMonthRaw = typeof req.query.pastMonth === 'string' ? req.query.pastMonth : '';
    const pastMonthMatch = /^(\d{4})-(\d{1,2})$/.exec(pastMonthRaw);
    let pastWindowStart: Date | null = null;
    let pastWindowEnd: Date | null = null;
    if (pastMonthMatch) {
      const year = parseInt(pastMonthMatch[1], 10);
      const monthIdx = parseInt(pastMonthMatch[2], 10) - 1;
      if (monthIdx >= 0 && monthIdx <= 11) {
        const candidateStart = new Date(year, monthIdx, 1);
        const candidateEnd = new Date(year, monthIdx + 1, 1);
        // Only honor pastMonth if it's actually in the past — no point
        // doing the extra completed-event query for the current or
        // future month (those events are already covered by the
        // upcoming branch below).
        if (candidateEnd <= today) {
          pastWindowStart = candidateStart;
          pastWindowEnd = candidateEnd;
        }
      }
    }

    logger.log(
      `[VolunteerHub] Fetching events` +
        (pastWindowStart ? ` + completed events for ${pastMonthRaw}` : ''),
    );

    const rawEvents = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          isNull(eventRequests.deletedAt),
          eq(eventRequests.showOnVolunteerHub, true),
          or(
            eq(eventRequests.status, 'scheduled'),
            eq(eventRequests.status, 'rescheduled'),
            eq(eventRequests.status, 'completed')
          )
        )
      )
      .orderBy(eventRequests.scheduledEventDate);

    const events = dedupeVolunteerHubEvents(rawEvents);

    logger.log(
      `[VolunteerHub] Found ${rawEvents.length} hub events` +
        (events.length !== rawEvents.length ? ` (${events.length} after dedupe)` : ''),
    );

    // Build the visible set:
    //   - Future or undated events: always include.
    //   - Past events: include ONLY if status=completed AND they fall
    //     within the requested past-month window. A scheduled event
    //     whose date slipped into the past without being marked complete
    //     is stale data — don't surface it.
    const visibleEvents = events.filter(event => {
      // Auto-exclude self-transport events and events with no designated
      // volunteer need, regardless of the showOnVolunteerHub flag — these
      // have nothing for a volunteer to sign up for.
      if (!eventOffersVolunteerOpportunity(event)) return false;

      const eventDate = getEffectiveEventDate(event);
      if (!eventDate) return true;
      const eventDateObj = new Date(eventDate);
      const isPast = eventDateObj < today;
      if (!isPast) return true;
      // Past events: only completed AND within the requested window
      if (event.status !== 'completed') return false;
      if (!pastWindowStart || !pastWindowEnd) return false;
      return eventDateObj >= pastWindowStart && eventDateObj < pastWindowEnd;
    });

    logger.log(
      `[VolunteerHub] ${visibleEvents.length} events visible after filtering` +
        (pastWindowStart ? ` (incl. completed events for ${pastMonthRaw})` : ''),
    );

    // Calculate unfilled needs for each event using centralized utils
    const eventsWithNeeds = visibleEvents.map(event => {
      const counts = getUnfilledCounts(event);
      const vanDriverNeeded = !!(event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan);

      return {
        id: event.id,
        organizationName: event.organizationName,
        organizationCategory: event.organizationCategory,
        department: event.department,
        eventAddress: event.eventAddress,
        city: event.city,
        state: event.state,
        zipCode: event.zipCode,
        latitude: event.latitude,
        longitude: event.longitude,
        scheduledEventDate: event.scheduledEventDate,
        desiredEventDate: event.desiredEventDate,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        estimatedSandwichCount: event.estimatedSandwichCount,
        status: event.status,
        // Unfilled needs from centralized utils
        ...counts,
        hasUnfilledNeeds: counts.hasUnfilledNeeds || vanDriverNeeded,
        // Additional info for volunteers
        vanDriverNeeded,
        selfTransport: event.selfTransport,
        pickupTime: event.pickupTime,
        eventNotes: event.notes, // Public notes about the event
        // Role-specific instructions surfaced to volunteers on the signup slot
        // and the my-signups view. Same source the SMS reminder uses.
        driverInstructions: event.driverInstructions,
        volunteerInstructions: event.volunteerInstructions,
        speakerInstructions: event.speakerInstructions,
      };
    });

    // Optionally filter to only events with unfilled needs
    const filterByNeeds = req.query.needsOnly === 'true';
    const filteredEvents = filterByNeeds
      ? eventsWithNeeds.filter(e => e.hasUnfilledNeeds)
      : eventsWithNeeds;

    res.json(filteredEvents);
  } catch (error) {
    logger.error('Error fetching available events:', error);
    res.status(500).json({ error: 'Failed to fetch available events' });
  }
});

/**
 * Get details for a specific event (volunteer view)
 */
router.get('/event/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    const [event] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get existing signups for this event
    const existingSignups = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.eventRequestId, eventId));

    // Get confirmed volunteer names
    const confirmedVolunteers = existingSignups
      .filter(v => v.status === 'confirmed' || v.status === 'assigned')
      .map(v => ({
        name: v.volunteerName || 'Anonymous',
        role: v.role,
      }));

    // Calculate needs using centralized utils
    const counts = getUnfilledCounts(event);
    const vanDriverNeeded = !!(event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan);

    res.json({
      id: event.id,
      organizationName: event.organizationName,
      organizationCategory: event.organizationCategory,
      department: event.department,
      eventAddress: event.eventAddress,
      city: event.city,
      state: event.state,
      zipCode: event.zipCode,
      latitude: event.latitude,
      longitude: event.longitude,
      scheduledEventDate: event.scheduledEventDate,
      desiredEventDate: event.desiredEventDate,
      eventStartTime: event.eventStartTime,
      eventEndTime: event.eventEndTime,
      estimatedSandwichCount: event.estimatedSandwichCount,
      speakersNeeded: counts.speakersNeeded,
      speakersUnfilled: counts.speakersUnfilled,
      volunteersNeeded: counts.volunteersNeeded,
      volunteersUnfilled: counts.volunteersUnfilled,
      driversNeeded: counts.driversNeeded,
      driversUnfilled: counts.driversUnfilled,
      vanDriverNeeded,
      selfTransport: event.selfTransport,
      pickupTime: event.pickupTime,
      eventNotes: event.notes,
      driverInstructions: event.driverInstructions,
      volunteerInstructions: event.volunteerInstructions,
      speakerInstructions: event.speakerInstructions,
      confirmedVolunteers,
      pendingSignups: existingSignups.filter(v => v.status === 'pending').length,
    });
  } catch (error) {
    logger.error('Error fetching event details:', error);
    res.status(500).json({ error: 'Failed to fetch event details' });
  }
});

// ============================================================================
// Volunteer Signup Routes
// ============================================================================

/**
 * Get current user's signup(s) for a specific event
 */
router.get('/signup/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = req.user?.id;

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const signups = await db
      .select()
      .from(eventVolunteers)
      .where(
        and(
          eq(eventVolunteers.eventRequestId, eventId),
          eq(eventVolunteers.volunteerUserId, userId)
        )
      );

    res.json(signups);
  } catch (error) {
    logger.error('Error fetching signup for event:', error);
    res.status(500).json({ error: 'Failed to fetch signup status' });
  }
});

/**
 * Get current user's events they have marked not available.
 */
router.get('/my-unavailable', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const unavailable = await db
      .select({
        unavailable: eventVolunteerDeclines,
        event: eventRequests,
      })
      .from(eventVolunteerDeclines)
      .innerJoin(eventRequests, eq(eventVolunteerDeclines.eventRequestId, eventRequests.id))
      .where(eq(eventVolunteerDeclines.volunteerUserId, userId))
      .orderBy(desc(eventVolunteerDeclines.updatedAt));

    res.json(unavailable.map(({ unavailable: unavailableRecord, event }) => ({
      ...unavailableRecord,
      event: {
        id: event.id,
        organizationName: event.organizationName,
        scheduledEventDate: event.scheduledEventDate,
        desiredEventDate: event.desiredEventDate,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        eventAddress: event.eventAddress,
        city: event.city,
        state: event.state,
        status: event.status,
      },
    })));
  } catch (error) {
    logger.error('Error fetching user unavailable events:', error);
    res.status(500).json({ error: 'Failed to fetch your unavailable events' });
  }
});

/**
 * Mark or clear current user's availability decline for an event.
 * Body: { isUnavailable: boolean, notes?: string }
 */
router.post('/availability/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = req.user?.id;
    const { isUnavailable = true, notes } = req.body || {};

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const [event] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (isUnavailable === false) {
      await db
        .delete(eventVolunteerDeclines)
        .where(
          and(
            eq(eventVolunteerDeclines.eventRequestId, eventId),
            eq(eventVolunteerDeclines.volunteerUserId, userId)
          )
        );

      return res.json({ success: true, message: 'Availability mark cleared.' });
    }

    const activeSignups = await db
      .select()
      .from(eventVolunteers)
      .where(
        and(
          eq(eventVolunteers.eventRequestId, eventId),
          eq(eventVolunteers.volunteerUserId, userId),
          inArray(eventVolunteers.status, ACTIVE_SIGNUP_STATUSES)
        )
      )
      .limit(1);

    if (activeSignups.length > 0) {
      return res.status(400).json({
        error: 'You are already signed up for this event. Please cancel or ask a coordinator to remove that signup before marking yourself not available.',
      });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trimmedNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
    const volunteerName = user.displayName ||
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.email?.split('@')[0] ||
      'Unknown';

    const existingUnavailable = await db
      .select()
      .from(eventVolunteerDeclines)
      .where(
        and(
          eq(eventVolunteerDeclines.eventRequestId, eventId),
          eq(eventVolunteerDeclines.volunteerUserId, userId)
        )
      )
      .limit(1);

    const values = {
      eventRequestId: eventId,
      volunteerUserId: userId,
      volunteerName,
      volunteerEmail: user.preferredEmail || user.email,
      volunteerPhone: user.phoneNumber,
      notes: trimmedNotes,
      updatedAt: new Date(),
    };

    const [unavailableRecord] = existingUnavailable.length > 0
      ? await db
          .update(eventVolunteerDeclines)
          .set(values)
          .where(eq(eventVolunteerDeclines.id, existingUnavailable[0].id))
          .returning()
      : await db
          .insert(eventVolunteerDeclines)
          .values(values)
          .returning();

    logger.info(`Volunteer marked unavailable: ${userId} for event ${eventId}`);

    res.json({
      success: true,
      message: 'Marked not available for this event.',
      unavailable: unavailableRecord,
    });
  } catch (error) {
    logger.error('Error saving volunteer availability decline:', error);
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

/**
 * Request to volunteer for an event
 * Creates a pending signup that coordinators must confirm
 */
router.post('/signup/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const callerId = req.user?.id;

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    if (!callerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Determine who this signup is FOR. Defaults to the caller (self-signup).
    // If targetUserId is supplied and differs from the caller, require the
    // assign-others permission — this is how coordinators staff events from
    // the Volunteer Hub.
    const { role, roles, notes, targetUserId: rawTargetUserId } = req.body;
    const targetUserId =
      typeof rawTargetUserId === 'string' && rawTargetUserId.trim() !== ''
        ? rawTargetUserId.trim()
        : callerId;
    const isAssigningOther = targetUserId !== callerId;

    if (isAssigningOther) {
      const canAssignOthers = hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_ASSIGN_OTHERS);
      if (!canAssignOthers) {
        return res.status(403).json({
          error: 'You do not have permission to assign other users to events.',
        });
      }
    } else {
      const canSelfSignup = hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_SELF_SIGNUP);
      if (!canSelfSignup) {
        return res.status(403).json({
          error: 'You do not have permission to sign yourself up for Volunteer Hub events.',
        });
      }
    }

    // Get target user details (the person being assigned / signing up)
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get event details
    const [event] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const existingUnavailable = await db
      .select()
      .from(eventVolunteerDeclines)
      .where(
        and(
          eq(eventVolunteerDeclines.eventRequestId, eventId),
          eq(eventVolunteerDeclines.volunteerUserId, targetUserId)
        )
      )
      .limit(1);

    if (existingUnavailable.length > 0) {
      return res.status(400).json({
        error: isAssigningOther
          ? `${user.firstName || 'That user'} has marked themselves not available for this event. Clear that mark before assigning them.`
          : 'You marked yourself not available for this event. Clear that mark before signing up.',
      });
    }

    const requestedRoles = Array.isArray(roles) ? roles : (role ? [role] : []);
    const normalizedRoles = Array.from(new Set(requestedRoles.filter(Boolean)));

    if (normalizedRoles.length === 0) {
      return res.status(400).json({ error: 'At least one role is required (driver or general)' });
    }

    // Speaker role retired — only driver and general self-signups are accepted.
    const invalidRoles = normalizedRoles.filter(r => !['driver', 'general'].includes(r));
    if (invalidRoles.length > 0) {
      return res.status(400).json({ error: 'Valid roles are driver or general' });
    }

    // Eligibility gate (self-signup only). A volunteer can only sign THEMSELVES
    // up for roles they're willing AND (where required) approved for. Coordinators
    // assigning others deliberately bypass this — assigning is itself the
    // coordinator vouching for the person, and driver assignment is already
    // gated by DRIVER_SIGNUP_APPROVE below. The hub UI hides ineligible roles;
    // this is the server-side backstop against a hand-crafted request.
    if (!isAssigningOther) {
      const ineligible = normalizedRoles.filter(
        (r) => !isEligibleForRole(user, r as EventRole)
      );
      if (ineligible.length > 0) {
        // Tailor the message to WHY it's blocked: not opted-in (willingness) vs
        // opted-in but awaiting coordinator approval. Keying off the role name
        // alone would tell a not-willing user they need "approval", which is wrong.
        const reasons = ineligible.map((r) => getIneligibilityReason(user, r as EventRole));
        const needsApproval = reasons.includes('not_approved');
        const needsWillingness = reasons.includes('not_willing');
        let error: string;
        if (needsApproval && !needsWillingness) {
          error =
            "That role needs coordinator approval. You've said you're willing — a coordinator just needs to approve you before you can sign up.";
        } else if (needsWillingness && !needsApproval) {
          error =
            "You haven't opted into that role yet. Update the roles you're willing to do in your profile.";
        } else {
          error =
            "You're not set up for that role yet. Update the roles you're willing to do in your profile — driver also needs coordinator approval.";
        }
        return res.status(403).json({ error, ineligibleRoles: ineligible });
      }
    }

    // Check if target user already signed up for this event with any requested role
    const existingSignups = await db
      .select()
      .from(eventVolunteers)
      .where(
        and(
          eq(eventVolunteers.eventRequestId, eventId),
          eq(eventVolunteers.volunteerUserId, targetUserId),
          inArray(eventVolunteers.role, normalizedRoles)
        )
      )
      .limit(10);

    if (existingSignups.length > 0) {
      const existingRoles = existingSignups.map((signup) => signup.role).join(', ');
      return res.status(400).json({
        error: isAssigningOther
          ? `${user.firstName || 'That user'} is already signed up for this event as: ${existingRoles}`
          : `You have already signed up for this event as: ${existingRoles}`,
        existingSignup: existingSignups[0]
      });
    }

    const volunteerName = user.displayName ||
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.email?.split('@')[0] ||
      'Unknown';

    // Coordinator assignments are pre-approved with status='assigned' (matches
    // the existing vocabulary used by the PATCH /signup/:id/status route).
    // Self-signups go to 'pending' for later coordinator review.
    const status = isAssigningOther ? 'assigned' : 'pending';

    // Driver assignments require DRIVER_SIGNUP_APPROVE (same rule the approval
    // route enforces). A coordinator without driver-approval can't assign
    // someone as a driver.
    if (isAssigningOther && normalizedRoles.includes('driver')) {
      const canApproveDrivers = hasPermission(req.user, PERMISSIONS.DRIVER_SIGNUP_APPROVE);
      if (!canApproveDrivers) {
        return res.status(403).json({
          error: 'You need driver approval permission to assign someone as a driver.',
        });
      }
    }

    const signedUpAt = new Date();

    // Insert volunteer signups (one row per role).
    // NOTE: db.transaction() is NOT used here because the Neon HTTP driver
    // (used in production) does not support transactions. The two operations
    // below are intentionally sequential without a transaction wrapper.
    const newSignups = await db
      .insert(eventVolunteers)
      .values(
        normalizedRoles.map((requestedRole) => ({
          eventRequestId: eventId,
          volunteerUserId: targetUserId,
          volunteerName: volunteerName,
          volunteerEmail: user.preferredEmail || user.email,
          volunteerPhone: user.phoneNumber,
          role: requestedRole,
          status,
          notes: notes || null,
          signedUpAt,
          assignedBy: isAssigningOther ? callerId : null,
          confirmedAt: isAssigningOther ? signedUpAt : null,
        }))
      )
      .returning();

    // Mirror assignment into eventRequests.assigned*Ids so the Event Request
    // Management tab (and the rest of the app) reflects it immediately.
    // This matches the PATCH /signup/:id/status mirror logic so the data
    // shape stays consistent whether a coordinator assigns via the Hub or
    // approves a self-signup.
    if (isAssigningOther) {
      const [eventRow] = await db
        .select({
          assignedDriverIds: eventRequests.assignedDriverIds,
          assignedSpeakerIds: eventRequests.assignedSpeakerIds,
          assignedVolunteerIds: eventRequests.assignedVolunteerIds,
        })
        .from(eventRequests)
        .where(eq(eventRequests.id, eventId))
        .limit(1);

      if (eventRow) {
        const addUnique = (ids?: string[] | null) =>
          Array.from(new Set([...(ids || []), targetUserId]));
        const updates: {
          assignedDriverIds?: string[];
          assignedSpeakerIds?: string[];
          assignedVolunteerIds?: string[];
        } = {};
        if (normalizedRoles.includes('driver')) {
          updates.assignedDriverIds = addUnique(eventRow.assignedDriverIds);
        }
        // (Speaker role retired — no speaker branch here.)
        if (normalizedRoles.includes('general')) {
          updates.assignedVolunteerIds = addUnique(eventRow.assignedVolunteerIds);
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(eventRequests)
            .set(updates)
            .where(eq(eventRequests.id, eventId));
        }
      }
    }

    if (isAssigningOther) {
      // Assignment flow: notify the assignee, skip the coordinator
      // pending-review blast (there's nothing to review — it's already approved).
      await sendVolunteerSignupConfirmationEmail(
        volunteerName,
        user.preferredEmail || user.email || '',
        event.organizationName || 'Unknown Organization',
        getEffectiveEventDate(event),
        event.eventStartTime,
        event.eventEndTime,
        event.eventAddress,
        normalizedRoles
      );
      logger.info(
        `Volunteer assignment created by ${callerId}: ${volunteerName} -> event ${eventId} as ${normalizedRoles.join(', ')}`
      );
    } else {
      // Self-signup flow: notify coordinators (approval needed) and confirm to the volunteer
      await sendVolunteerSignupNotification(
        volunteerName,
        user.preferredEmail || user.email || '',
        eventId,
        event.organizationName || 'Unknown Organization',
        getEffectiveEventDate(event),
        normalizedRoles,
        notes
      );
      await sendVolunteerSignupConfirmationEmail(
        volunteerName,
        user.preferredEmail || user.email || '',
        event.organizationName || 'Unknown Organization',
        getEffectiveEventDate(event),
        event.eventStartTime,
        event.eventEndTime,
        event.eventAddress,
        normalizedRoles
      );
      logger.info(`Volunteer signup created: ${volunteerName} for event ${eventId} as ${normalizedRoles.join(', ')}`);
    }

    res.status(201).json({
      success: true,
      message: isAssigningOther
        ? `${volunteerName} has been assigned to this event.`
        : 'Your signup request has been submitted. A coordinator will confirm your participation.',
      signups: newSignups,
    });
  } catch (error) {
    logger.error('Error creating volunteer signup:', error);
    res.status(500).json({ error: 'Failed to submit signup request' });
  }
});

/**
 * Cancel a volunteer signup
 */
router.delete('/signup/:signupId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const signupId = parseInt(req.params.signupId);
    const userId = req.user?.id;

    if (!signupId || isNaN(signupId)) {
      return res.status(400).json({ error: 'Valid signup ID required' });
    }

    // Get the signup
    const [signup] = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.id, signupId))
      .limit(1);

    if (!signup) {
      return res.status(404).json({ error: 'Signup not found' });
    }

    // Only allow user to cancel their own signup (or coordinators)
    if (signup.volunteerUserId !== userId) {
      // Check if user is a coordinator (has admin or coordinator role)
      // For now, allow only the volunteer themselves
      return res.status(403).json({ error: 'You can only cancel your own signups' });
    }

    await db
      .delete(eventVolunteers)
      .where(eq(eventVolunteers.id, signupId));

    logger.info(`Volunteer signup cancelled: ${signupId} by user ${userId}`);

    res.json({ success: true, message: 'Signup cancelled successfully' });
  } catch (error) {
    logger.error('Error cancelling volunteer signup:', error);
    res.status(500).json({ error: 'Failed to cancel signup' });
  }
});

/**
 * Get current user's volunteer signups
 */
router.get('/my-signups', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const signups = await db
      .select({
        signup: eventVolunteers,
        event: eventRequests,
      })
      .from(eventVolunteers)
      .innerJoin(eventRequests, eq(eventVolunteers.eventRequestId, eventRequests.id))
      .where(eq(eventVolunteers.volunteerUserId, userId))
      .orderBy(desc(eventVolunteers.signedUpAt));

    const enrichedSignups = signups.map(({ signup, event }) => ({
      ...signup,
      event: {
        id: event.id,
        organizationName: event.organizationName,
        scheduledEventDate: event.scheduledEventDate,
        desiredEventDate: event.desiredEventDate,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        eventAddress: event.eventAddress,
        city: event.city,
        state: event.state,
        status: event.status,
        driverInstructions: event.driverInstructions,
        volunteerInstructions: event.volunteerInstructions,
        speakerInstructions: event.speakerInstructions,
      },
    }));

    res.json(enrichedSignups);
  } catch (error) {
    logger.error('Error fetching user signups:', error);
    res.status(500).json({ error: 'Failed to fetch your signups' });
  }
});

// ============================================================================
// Coordinator Management Routes
// ============================================================================

/**
 * Get volunteer signups (for coordinators)
 * By default returns only pending signups. Pass ?all=true for all signups.
 */
router.get('/pending-signups', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Only users with VOLUNTEER_SIGNUP_APPROVE can view pending signups
    if (!hasPermission(req.user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE)) {
      return res.status(403).json({ error: 'VOLUNTEER_SIGNUP_APPROVE permission required' });
    }

    const showAll = req.query.all === 'true';

    const query = db
      .select({
        signup: eventVolunteers,
        event: eventRequests,
      })
      .from(eventVolunteers)
      .innerJoin(eventRequests, eq(eventVolunteers.eventRequestId, eventRequests.id));

    const signups = showAll
      ? await query.orderBy(desc(eventVolunteers.signedUpAt))
      : await query.where(eq(eventVolunteers.status, 'pending')).orderBy(desc(eventVolunteers.signedUpAt));

    const enrichedSignups = signups.map(({ signup, event }) => ({
      ...signup,
      event: {
        id: event.id,
        organizationName: event.organizationName,
        scheduledEventDate: event.scheduledEventDate,
        desiredEventDate: event.desiredEventDate,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        eventAddress: event.eventAddress,
        status: event.status,
        vanDriverNeeded: event.vanDriverNeeded,
      },
    }));

    res.json(enrichedSignups);
  } catch (error) {
    logger.error('Error fetching pending signups:', error);
    res.status(500).json({ error: 'Failed to fetch pending signups' });
  }
});

/**
 * Coordinator coverage view: upcoming Volunteer Hub events with role coverage,
 * active/declined signups, and volunteers who marked themselves not available.
 */
router.get('/coverage-summary', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!hasPermission(req.user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE)) {
      return res.status(403).json({ error: 'VOLUNTEER_SIGNUP_APPROVE permission required' });
    }

    const now = new Date();
    const easternNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = new Date(easternNow.getFullYear(), easternNow.getMonth(), easternNow.getDate());

    const events = dedupeVolunteerHubEvents(
      await db
        .select()
        .from(eventRequests)
        .where(
          and(
            isNull(eventRequests.deletedAt),
            eq(eventRequests.showOnVolunteerHub, true),
            or(
              eq(eventRequests.status, 'scheduled'),
              eq(eventRequests.status, 'rescheduled')
            )
          )
        )
        .orderBy(eventRequests.scheduledEventDate),
    );

    const upcomingEvents = events.filter((event) => {
      const eventDate = getEffectiveEventDate(event);
      if (!eventDate) return true;
      return new Date(eventDate) >= today;
    });

    const eventIds = upcomingEvents.map((event) => event.id);
    const signups = eventIds.length > 0
      ? await db
          .select()
          .from(eventVolunteers)
          .where(inArray(eventVolunteers.eventRequestId, eventIds))
          .orderBy(desc(eventVolunteers.signedUpAt))
      : [];
    const unavailable = eventIds.length > 0
      ? await db
          .select()
          .from(eventVolunteerDeclines)
          .where(inArray(eventVolunteerDeclines.eventRequestId, eventIds))
          .orderBy(desc(eventVolunteerDeclines.updatedAt))
      : [];

    const signupsByEvent = new Map<number, typeof signups>();
    signups.forEach((signup) => {
      const existing = signupsByEvent.get(signup.eventRequestId) || [];
      existing.push(signup);
      signupsByEvent.set(signup.eventRequestId, existing);
    });

    const unavailableByEvent = new Map<number, typeof unavailable>();
    unavailable.forEach((unavailableRecord) => {
      const existing = unavailableByEvent.get(unavailableRecord.eventRequestId) || [];
      existing.push(unavailableRecord);
      unavailableByEvent.set(unavailableRecord.eventRequestId, existing);
    });

    res.json(upcomingEvents.map((event) => {
      const counts = getUnfilledCounts(event);
      const vanDriverNeeded = !!(event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan);
      const eventSignups = signupsByEvent.get(event.id) || [];
      const eventUnavailable = unavailableByEvent.get(event.id) || [];

      return {
        id: event.id,
        organizationName: event.organizationName,
        department: event.department,
        scheduledEventDate: event.scheduledEventDate,
        desiredEventDate: event.desiredEventDate,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        eventAddress: event.eventAddress,
        city: event.city,
        state: event.state,
        status: event.status,
        vanDriverNeeded,
        roles: [
          // (Speaker role retired — no speaker entry in the needs breakdown.)
          {
            role: 'general',
            label: 'Volunteers',
            needed: counts.volunteersNeeded,
            assigned: counts.volunteersAssigned,
            unfilled: counts.volunteersUnfilled,
          },
          {
            role: 'driver',
            label: 'Drivers',
            needed: counts.driversNeeded,
            assigned: counts.driversAssigned,
            unfilled: counts.driversUnfilled,
          },
          {
            role: 'van_driver',
            label: 'Van Driver',
            needed: event.vanDriverNeeded ? 1 : 0,
            assigned: event.vanDriverNeeded && !vanDriverNeeded ? 1 : 0,
            unfilled: vanDriverNeeded ? 1 : 0,
          },
        ],
        signups: eventSignups.map((signup) => ({
          id: signup.id,
          volunteerUserId: signup.volunteerUserId,
          volunteerName: signup.volunteerName,
          volunteerEmail: signup.volunteerEmail,
          volunteerPhone: signup.volunteerPhone,
          role: signup.role,
          status: signup.status,
          notes: signup.notes,
          signedUpAt: signup.signedUpAt,
        })),
        unavailable: eventUnavailable.map((unavailableRecord) => ({
          id: unavailableRecord.id,
          volunteerUserId: unavailableRecord.volunteerUserId,
          volunteerName: unavailableRecord.volunteerName,
          volunteerEmail: unavailableRecord.volunteerEmail,
          volunteerPhone: unavailableRecord.volunteerPhone,
          notes: unavailableRecord.notes,
          updatedAt: unavailableRecord.updatedAt,
        })),
      };
    }));
  } catch (error) {
    logger.error('Error fetching volunteer hub coverage summary:', error);
    res.status(500).json({ error: 'Failed to fetch coverage summary' });
  }
});

/**
 * Confirm or decline a volunteer signup (for coordinators)
 */
router.patch('/signup/:signupId/status', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const signupId = parseInt(req.params.signupId);
    const { status, notes } = req.body;
    const coordinatorId = req.user?.id;

    if (!signupId || isNaN(signupId)) {
      return res.status(400).json({ error: 'Valid signup ID required' });
    }

    if (!status || !['confirmed', 'declined', 'assigned'].includes(status)) {
      return res.status(400).json({ error: 'Valid status required (confirmed, declined, or assigned)' });
    }

    const [signup] = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.id, signupId))
      .limit(1);

    if (!signup) {
      return res.status(404).json({ error: 'Signup not found' });
    }

    // Approving/declining any signup requires VOLUNTEER_SIGNUP_APPROVE permission
    if (status === 'confirmed' || status === 'assigned' || status === 'declined') {
      if (!hasPermission(req.user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE)) {
        return res.status(403).json({ error: 'VOLUNTEER_SIGNUP_APPROVE permission required to approve or decline signups' });
      }
    }

    // Driver signups additionally require DRIVER_SIGNUP_APPROVE permission
    if (signup.role === 'driver' && (status === 'confirmed' || status === 'assigned')) {
      if (!hasPermission(req.user, PERMISSIONS.DRIVER_SIGNUP_APPROVE)) {
        return res.status(403).json({ error: 'DRIVER_SIGNUP_APPROVE permission required to approve driver signups' });
      }
    }

    const shouldAssignVolunteer = (status === 'confirmed' || status === 'assigned') && !!signup.volunteerUserId;

    // NOTE: db.transaction() is NOT used here because the Neon HTTP driver
    // (used in production) does not support transactions. Operations run sequentially.
    const effectiveStatus = shouldAssignVolunteer ? 'assigned' : status;
    const isConfirmedOrAssigned = effectiveStatus === 'confirmed' || effectiveStatus === 'assigned';

    let updatedSignup: typeof signup | undefined;

    // If approved, mirror manual assignment behavior by adding the volunteer to the event assignment arrays.
    if (shouldAssignVolunteer) {
      const [event] = await db
        .select({
          id: eventRequests.id,
          assignedDriverIds: eventRequests.assignedDriverIds,
          assignedSpeakerIds: eventRequests.assignedSpeakerIds,
          assignedVolunteerIds: eventRequests.assignedVolunteerIds,
        })
        .from(eventRequests)
        .where(eq(eventRequests.id, signup.eventRequestId))
        .limit(1);

      if (!event) {
        return res.status(404).json({ error: 'Event not found for this signup' });
      }

      const assignedUserId = signup.volunteerUserId as string;
      const addUnique = (ids?: string[] | null) =>
        Array.from(new Set([...(ids || []), assignedUserId]));

      const assignmentUpdates: {
        assignedDriverIds?: string[];
        assignedSpeakerIds?: string[];
        assignedVolunteerIds?: string[];
      } = {};

      if (signup.role === 'driver') {
        assignmentUpdates.assignedDriverIds = addUnique(event.assignedDriverIds);
      } else if (signup.role === 'speaker') {
        assignmentUpdates.assignedSpeakerIds = addUnique(event.assignedSpeakerIds);
      } else {
        assignmentUpdates.assignedVolunteerIds = addUnique(event.assignedVolunteerIds);
      }

      await db
        .update(eventRequests)
        .set(assignmentUpdates)
        .where(eq(eventRequests.id, signup.eventRequestId));
    }

    // Update the signup status
    const [signupRow] = await db
      .update(eventVolunteers)
      .set({
        status: effectiveStatus,
        confirmedAt: isConfirmedOrAssigned ? new Date() : null,
        assignedBy: coordinatorId,
        notes: notes || signup.notes,
        updatedAt: new Date(),
      })
      .where(eq(eventVolunteers.id, signupId))
      .returning();

    updatedSignup = signupRow;

    // Send confirmation email to volunteer when approved (or send removal email when declined)
    if (signup.volunteerEmail) {
      try {
        const [event] = await db
          .select()
          .from(eventRequests)
          .where(eq(eventRequests.id, signup.eventRequestId))
          .limit(1);

        if (event) {
          const emailEvent: EventForEmail = {
            id: event.id,
            organizationName: event.organizationName,
            scheduledEventDate: event.scheduledEventDate,
            desiredEventDate: event.desiredEventDate,
            eventStartTime: event.eventStartTime,
            eventEndTime: event.eventEndTime,
            eventAddress: event.eventAddress,
            notes: event.message ?? null,
            message: event.message ?? null,
            firstName: event.firstName,
            lastName: event.lastName,
            email: event.email,
            phone: event.phone,
            tspContact: event.tspContact,
          };

          if (isConfirmedOrAssigned) {
            await sendVolunteerApprovalEmail(
              signup.volunteerName || 'Volunteer',
              signup.volunteerEmail,
              emailEvent,
              signup.role
            );
          } else if (effectiveStatus === 'declined') {
            await sendVolunteerRemovalEmail(
              signup.volunteerName || 'Volunteer',
              signup.volunteerEmail,
              emailEvent,
              signup.role,
              typeof notes === 'string' ? notes : null
            );
          }
        }
      } catch (emailError) {
        logger.error('Failed to send volunteer status email, but signup was still updated:', emailError);
      }
    }

    logger.info(`Volunteer signup ${signupId} status updated to ${effectiveStatus} by ${coordinatorId}`);

    res.json({
      success: true,
      message: `Signup ${effectiveStatus} successfully`,
      signup: updatedSignup,
    });
  } catch (error) {
    if (error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error updating signup status:', error);
    res.status(500).json({ error: 'Failed to update signup status' });
  }
});

/**
 * Get all signups for a specific event (for coordinators)
 */
router.get('/event/:eventId/signups', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    const signups = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.eventRequestId, eventId))
      .orderBy(desc(eventVolunteers.signedUpAt));

    res.json(signups);
  } catch (error) {
    logger.error('Error fetching event signups:', error);
    res.status(500).json({ error: 'Failed to fetch event signups' });
  }
});

// ============================================================================
// Coordinator management of approved signups
// ============================================================================

/**
 * Coordinator: change a volunteer's role on an event.
 * Body: { role: 'driver' | 'speaker' | 'general', reason?: string }
 * - Updates the role on the signup
 * - Moves the volunteer between assignedDriverIds / assignedSpeakerIds / assignedVolunteerIds
 *   on the event request (if they were already approved/assigned).
 * - Emails the volunteer with the change (and optional reason).
 */
router.patch('/signup/:signupId/role', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const signupId = parseInt(req.params.signupId);
    const { role: newRole, reason } = req.body || {};
    const coordinatorId = req.user?.id;

    if (!signupId || isNaN(signupId)) {
      return res.status(400).json({ error: 'Valid signup ID required' });
    }
    // Speaker role retired — a coordinator can no longer move a signup to speaker.
    if (!newRole || !['driver', 'general'].includes(newRole)) {
      return res.status(400).json({ error: 'Valid role required (driver or general)' });
    }
    if (!hasPermission(req.user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE)) {
      return res.status(403).json({ error: 'VOLUNTEER_SIGNUP_APPROVE permission required' });
    }

    const [signup] = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.id, signupId))
      .limit(1);

    if (!signup) {
      return res.status(404).json({ error: 'Signup not found' });
    }

    if (newRole === signup.role) {
      return res.json({ success: true, message: 'Role unchanged', signup });
    }

    // Moving INTO driver requires DRIVER_SIGNUP_APPROVE
    if (newRole === 'driver' && !hasPermission(req.user, PERMISSIONS.DRIVER_SIGNUP_APPROVE)) {
      return res.status(403).json({ error: 'DRIVER_SIGNUP_APPROVE permission required to assign drivers' });
    }

    // If the signup is approved/assigned and we have a user id, move them between event arrays
    const wasApproved = signup.status === 'confirmed' || signup.status === 'assigned';
    if (wasApproved && signup.volunteerUserId) {
      const [event] = await db
        .select({
          id: eventRequests.id,
          assignedDriverIds: eventRequests.assignedDriverIds,
          assignedSpeakerIds: eventRequests.assignedSpeakerIds,
          assignedVolunteerIds: eventRequests.assignedVolunteerIds,
        })
        .from(eventRequests)
        .where(eq(eventRequests.id, signup.eventRequestId))
        .limit(1);

      if (event) {
        const uid = signup.volunteerUserId as string;
        const without = (ids?: string[] | null) => (ids || []).filter((id) => id !== uid);
        const withUid = (ids?: string[] | null) => Array.from(new Set([...(ids || []), uid]));

        const updates: {
          assignedDriverIds: string[];
          assignedSpeakerIds: string[];
          assignedVolunteerIds: string[];
        } = {
          assignedDriverIds: without(event.assignedDriverIds),
          assignedSpeakerIds: without(event.assignedSpeakerIds),
          assignedVolunteerIds: without(event.assignedVolunteerIds),
        };
        if (newRole === 'driver') updates.assignedDriverIds = withUid(updates.assignedDriverIds);
        else if (newRole === 'speaker') updates.assignedSpeakerIds = withUid(updates.assignedSpeakerIds);
        else updates.assignedVolunteerIds = withUid(updates.assignedVolunteerIds);

        await db.update(eventRequests).set(updates).where(eq(eventRequests.id, signup.eventRequestId));
      }
    }

    const [updated] = await db
      .update(eventVolunteers)
      .set({
        role: newRole,
        assignedBy: coordinatorId,
        updatedAt: new Date(),
      })
      .where(eq(eventVolunteers.id, signupId))
      .returning();

    // Send role-change email
    if (signup.volunteerEmail) {
      try {
        const [event] = await db.select().from(eventRequests).where(eq(eventRequests.id, signup.eventRequestId)).limit(1);
        if (event) {
          await sendVolunteerRoleChangeEmail(
            signup.volunteerName || 'Volunteer',
            signup.volunteerEmail,
            {
              id: event.id,
              organizationName: event.organizationName,
              scheduledEventDate: event.scheduledEventDate,
              desiredEventDate: event.desiredEventDate,
              eventStartTime: event.eventStartTime,
              eventEndTime: event.eventEndTime,
              eventAddress: event.eventAddress,
              notes: event.message ?? null,
              message: event.message ?? null,
              firstName: event.firstName,
              lastName: event.lastName,
              email: event.email,
              phone: event.phone,
              tspContact: event.tspContact,
            },
            signup.role,
            newRole,
            typeof reason === 'string' && reason.trim() ? reason.trim() : null
          );
        }
      } catch (emailError) {
        logger.error('Failed to send role-change email:', emailError);
      }
    }

    logger.info(`Volunteer signup ${signupId} role changed from ${signup.role} to ${newRole} by ${coordinatorId}`);

    res.json({ success: true, signup: updated });
  } catch (error) {
    logger.error('Error changing signup role:', error);
    res.status(500).json({ error: 'Failed to change role' });
  }
});

/**
 * Coordinator: remove a volunteer from an event.
 * Body (optional): { reason?: string }
 * - Sets signup status to 'declined' (preserves history; coordinators can re-approve later)
 * - Removes them from assigned*Ids arrays on the event request
 * - Emails the volunteer with the optional reason
 */
router.post('/signup/:signupId/remove', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const signupId = parseInt(req.params.signupId);
    const { reason } = req.body || {};
    const coordinatorId = req.user?.id;

    if (!signupId || isNaN(signupId)) {
      return res.status(400).json({ error: 'Valid signup ID required' });
    }
    if (!hasPermission(req.user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE)) {
      return res.status(403).json({ error: 'VOLUNTEER_SIGNUP_APPROVE permission required' });
    }

    const [signup] = await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.id, signupId))
      .limit(1);

    if (!signup) {
      return res.status(404).json({ error: 'Signup not found' });
    }

    // De-mirror from event assignment arrays if they were approved
    if ((signup.status === 'confirmed' || signup.status === 'assigned') && signup.volunteerUserId) {
      const [event] = await db
        .select({
          id: eventRequests.id,
          assignedDriverIds: eventRequests.assignedDriverIds,
          assignedSpeakerIds: eventRequests.assignedSpeakerIds,
          assignedVolunteerIds: eventRequests.assignedVolunteerIds,
        })
        .from(eventRequests)
        .where(eq(eventRequests.id, signup.eventRequestId))
        .limit(1);

      if (event) {
        const uid = signup.volunteerUserId as string;
        const without = (ids?: string[] | null) => (ids || []).filter((id) => id !== uid);
        await db.update(eventRequests).set({
          assignedDriverIds: without(event.assignedDriverIds),
          assignedSpeakerIds: without(event.assignedSpeakerIds),
          assignedVolunteerIds: without(event.assignedVolunteerIds),
        }).where(eq(eventRequests.id, signup.eventRequestId));
      }
    }

    const trimmedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
    const noteSuffix = trimmedReason ? `\n[Removed by coordinator: ${trimmedReason}]` : `\n[Removed by coordinator]`;
    const newNotes = (signup.notes ? signup.notes : '') + noteSuffix;

    const [updated] = await db
      .update(eventVolunteers)
      .set({
        status: 'declined',
        notes: newNotes.trim(),
        assignedBy: coordinatorId,
        updatedAt: new Date(),
      })
      .where(eq(eventVolunteers.id, signupId))
      .returning();

    // Email volunteer with reason
    if (signup.volunteerEmail) {
      try {
        const [event] = await db.select().from(eventRequests).where(eq(eventRequests.id, signup.eventRequestId)).limit(1);
        if (event) {
          await sendVolunteerRemovalEmail(
            signup.volunteerName || 'Volunteer',
            signup.volunteerEmail,
            {
              id: event.id,
              organizationName: event.organizationName,
              scheduledEventDate: event.scheduledEventDate,
              desiredEventDate: event.desiredEventDate,
              eventStartTime: event.eventStartTime,
              eventEndTime: event.eventEndTime,
              eventAddress: event.eventAddress,
              notes: event.message ?? null,
              message: event.message ?? null,
            },
            signup.role,
            trimmedReason
          );
        }
      } catch (emailError) {
        logger.error('Failed to send removal email:', emailError);
      }
    }

    logger.info(`Volunteer signup ${signupId} removed by ${coordinatorId}${trimmedReason ? ` (reason: ${trimmedReason})` : ''}`);

    res.json({ success: true, signup: updated });
  } catch (error) {
    logger.error('Error removing signup:', error);
    res.status(500).json({ error: 'Failed to remove signup' });
  }
});

export default router;
