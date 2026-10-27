/**
 * Cron Jobs Service
 *
 * Manages scheduled background tasks for the application.
 */

import cron from 'node-cron';
import { scrapeHostAvailability } from './host-availability-scraper';
import { createServiceLogger, logError } from '../utils/logger';
import { db } from '../db';
import { eventVolunteers, eventRequests, users, drivers } from '@shared/schema';
import { and, eq, isNull, sql, or, inArray, lte, isNotNull } from 'drizzle-orm';
import { EmailNotificationService } from './email-notification-service';
import { sendEventReminderSMS } from '../sms-service';
import { getEventNotificationPreferences, getUserMetadata, getUserPhoneNumber } from '@shared/types';
import type { EventNotificationPreferences } from '@shared/types';
import { generateImpactReport, saveImpactReport } from './ai-impact-reports';
import { processWeeklyDigests } from './weekly-digest-service';
import { isNotificationSuppressed } from '../utils/notification-suppression';
import { processAdminWeeklyDigest, processAdminWeeklySms } from './admin-weekly-digest-service';
import { processPredictionAlerts } from './prediction-alert-service';
import { processCheckInReminders } from './check-in-reminder-service';
import { processStandbyFollowups } from './tsp-contact-followup-service';
import { sendDailyErrorDigest } from './application-error-logger';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { getEffectivePrefs } from './notifications/preferences';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';
import { runCollectiveLearningAutoLog } from './collections/collective-learning-auto-log';

const cronLogger = createServiceLogger('cron');

/**
 * Send customizable reminder notifications to volunteers and TSP contacts for upcoming events
 * Supports primary/secondary reminders via email/SMS based on user preferences
 */
async function sendVolunteerReminders(): Promise<{
  remindersSent: number;
  volunteersProcessed: number;
  errors: number;
  timestamp: Date;
}> {
  const now = new Date();
  let remindersSent = 0;
  let volunteersProcessed = 0;
  let errors = 0;

  try {
    // Get events happening in the next 48 hours (broad window)
    const fortyEightHoursFromNow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const upcomingEvents = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          sql`${eventRequests.scheduledEventDate} >= ${now}`,
          sql`${eventRequests.scheduledEventDate} <= ${fortyEightHoursFromNow}`,
          // Include 'rescheduled' — rescheduled events still need reminders.
          inArray(eventRequests.status, ['scheduled', 'rescheduled']),
          isNull(eventRequests.deletedAt)
        )
      );

    cronLogger.info(`Found ${upcomingEvents.length} scheduled events in the next 48 hours`);

    if (upcomingEvents.length === 0) {
      return { remindersSent: 0, volunteersProcessed: 0, errors: 0, timestamp: now };
    }

    // PERFORMANCE: Batch fetch all volunteers for all events in ONE query (instead of N queries)
    const eventIds = upcomingEvents.map(e => e.id);
    const allVolunteers = await db
      .select()
      .from(eventVolunteers)
      .where(inArray(eventVolunteers.eventRequestId, eventIds));

    // Create a map for O(1) lookup: eventId -> volunteers[]
    const volunteersByEventId = new Map<number, Array<(typeof allVolunteers)[number]>>();
    for (const volunteer of allVolunteers) {
      const eventId = volunteer.eventRequestId;
      if (!volunteersByEventId.has(eventId)) {
        volunteersByEventId.set(eventId, []);
      }
      volunteersByEventId.get(eventId)!.push(volunteer);
    }

    // PERFORMANCE: Collect all user IDs we need to fetch, then batch fetch them
    const userIdsToFetch = new Set<string>();

    // Add volunteer user IDs
    for (const volunteer of allVolunteers) {
      if (volunteer.volunteerUserId) {
        userIdsToFetch.add(volunteer.volunteerUserId);
      }
    }

    // Add legacy assignment IDs and TSP contact IDs from events
    for (const event of upcomingEvents) {
      if (event.assignedSpeakerIds && Array.isArray(event.assignedSpeakerIds)) {
        for (const id of event.assignedSpeakerIds) {
          if (id) userIdsToFetch.add(id);
        }
      }
      if (event.assignedDriverIds && Array.isArray(event.assignedDriverIds)) {
        for (const id of event.assignedDriverIds) {
          if (id) userIdsToFetch.add(id);
        }
      }
      if (event.assignedVolunteerIds && Array.isArray(event.assignedVolunteerIds)) {
        for (const id of event.assignedVolunteerIds) {
          if (id) userIdsToFetch.add(id);
        }
      }
      if (event.tspContact) userIdsToFetch.add(event.tspContact);
      if (event.tspContactAssigned) userIdsToFetch.add(event.tspContactAssigned);
    }

    // Batch fetch all users in ONE query (instead of N*M queries)
    const userIdsArray = Array.from(userIdsToFetch);
    const allUsers = userIdsArray.length > 0
      ? await db.select().from(users).where(inArray(users.id, userIdsArray))
      : [];

    // Create a map for O(1) lookup: userId -> user
    const usersById = new Map(allUsers.map(u => [u.id, u]));

    cronLogger.info(`Batch fetched ${allVolunteers.length} volunteers and ${allUsers.length} users for ${upcomingEvents.length} events`);

    for (const event of upcomingEvents) {
      if (!event.scheduledEventDate) continue;

      const hoursUntilEvent = (event.scheduledEventDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Get volunteers for this event from pre-fetched data (O(1) lookup instead of DB query)
      const volunteers = volunteersByEventId.get(event.id) || [];

      // Helper to get role-specific instructions (case-insensitive comparison)
      const getRoleInstructions = (role: string): string | null => {
        const normalizedRole = role?.toLowerCase() || '';
        if (normalizedRole === 'driver') return event.driverInstructions || null;
        if (normalizedRole === 'speaker') return event.speakerInstructions || null;
        return event.volunteerInstructions || null;
      };

      // Process volunteer reminders
      for (const volunteer of volunteers) {
        volunteersProcessed++;
        
        try {
          let user = null;
          let volunteerEmail = volunteer.volunteerEmail;
          let volunteerName = volunteer.volunteerName || 'Volunteer';
          let volunteerPhone: string | null = volunteer.volunteerPhone;
          let preferences: EventNotificationPreferences | null = null;

          // Get user info and preferences for registered users (O(1) lookup from pre-fetched map)
          if (volunteer.volunteerUserId) {
            const foundUser = usersById.get(volunteer.volunteerUserId);

            if (foundUser) {
              user = foundUser;
              volunteerEmail = foundUser.preferredEmail || foundUser.email || volunteerEmail;
              volunteerName = foundUser.displayName || foundUser.firstName || volunteerName;
              volunteerPhone = getUserPhoneNumber(foundUser);
              preferences = getEventNotificationPreferences(foundUser);
            }
          }

          // Use default preferences if user doesn't have custom settings
          if (!preferences) {
            preferences = {
              primaryReminderEnabled: true,
              primaryReminderHours: 24,
              primaryReminderType: 'email',
              secondaryReminderEnabled: false,
              secondaryReminderHours: 1,
              secondaryReminderType: 'email',
            };
          }

          // Master toggle from Alert Preferences: if the user has turned
          // Volunteer Event Reminders off (or disabled a channel), override
          // the legacy per-user reminder prefs. Only registered users have
          // alert prefs; unregistered volunteer signups fall back to defaults.
          const alertPrefs = volunteer.volunteerUserId
            ? await getEffectivePrefs(volunteer.volunteerUserId, ALERT_TYPES.VOLUNTEER_EVENT_REMINDER)
            : { emailEnabled: true, smsEnabled: true, inAppEnabled: true, hasSavedPreference: false };
          if (!alertPrefs.emailEnabled && !alertPrefs.smsEnabled) {
            continue;
          }

          // Check primary reminder (2-hour window for safety)
          if (
            preferences.primaryReminderEnabled &&
            hoursUntilEvent >= (preferences.primaryReminderHours - 1) &&
            hoursUntilEvent <= (preferences.primaryReminderHours + 1)
          ) {
            // Send email reminder if needed
            if (
              alertPrefs.emailEnabled &&
              (preferences.primaryReminderType === 'email' || preferences.primaryReminderType === 'both') &&
              !volunteer.emailReminder1SentAt &&
              volunteerEmail
            ) {
              const emailSent = await EmailNotificationService.sendVolunteerReminderNotification(
                volunteerEmail,
                volunteerName,
                event.id,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                volunteer.role,
                getRoleInstructions(volunteer.role)
              );

              if (emailSent) {
                await db
                  .update(eventVolunteers)
                  .set({ emailReminder1SentAt: new Date() })
                  .where(eq(eventVolunteers.id, volunteer.id));
                
                remindersSent++;
                cronLogger.info(`Sent primary email reminder to ${volunteerEmail} for event ${event.id}`);
              }
            }

            // Send SMS reminder if needed
            if (
              alertPrefs.smsEnabled &&
              (preferences.primaryReminderType === 'sms' || preferences.primaryReminderType === 'both') &&
              !volunteer.smsReminder1SentAt &&
              volunteerPhone
            ) {
              const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
              // Build event contact details for the reminder
              const eventContactDetails = {
                contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                contactPhone: event.phone || null,
                contactEmail: event.email || null,
              };
              const smsSent = await sendEventReminderSMS(
                volunteerPhone,
                volunteerName,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                volunteer.role,
                `${appUrl}/dashboard?section=event-requests`,
                getRoleInstructions(volunteer.role),
                eventContactDetails
              );

              if (smsSent.success) {
                await db
                  .update(eventVolunteers)
                  .set({ smsReminder1SentAt: new Date() })
                  .where(eq(eventVolunteers.id, volunteer.id));

                remindersSent++;
                cronLogger.info(`Sent primary SMS reminder to ${volunteerPhone} for event ${event.id}`);
              }
            }
          }

          // Check secondary reminder (2-hour window for safety)
          if (
            preferences.secondaryReminderEnabled &&
            hoursUntilEvent >= (preferences.secondaryReminderHours - 1) &&
            hoursUntilEvent <= (preferences.secondaryReminderHours + 1)
          ) {
            // Send email reminder if needed
            if (
              alertPrefs.emailEnabled &&
              (preferences.secondaryReminderType === 'email' || preferences.secondaryReminderType === 'both') &&
              !volunteer.emailReminder2SentAt &&
              volunteerEmail
            ) {
              const emailSent = await EmailNotificationService.sendVolunteerReminderNotification(
                volunteerEmail,
                volunteerName,
                event.id,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                volunteer.role,
                getRoleInstructions(volunteer.role)
              );

              if (emailSent) {
                await db
                  .update(eventVolunteers)
                  .set({ emailReminder2SentAt: new Date() })
                  .where(eq(eventVolunteers.id, volunteer.id));
                
                remindersSent++;
                cronLogger.info(`Sent secondary email reminder to ${volunteerEmail} for event ${event.id}`);
              }
            }

            // Send SMS reminder if needed
            if (
              alertPrefs.smsEnabled &&
              (preferences.secondaryReminderType === 'sms' || preferences.secondaryReminderType === 'both') &&
              !volunteer.smsReminder2SentAt &&
              volunteerPhone
            ) {
              const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
              // Build event contact details for the reminder
              const eventContactDetails = {
                contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                contactPhone: event.phone || null,
                contactEmail: event.email || null,
              };
              const smsSent = await sendEventReminderSMS(
                volunteerPhone,
                volunteerName,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                volunteer.role,
                `${appUrl}/dashboard?section=event-requests`,
                getRoleInstructions(volunteer.role),
                eventContactDetails
              );

              if (smsSent.success) {
                await db
                  .update(eventVolunteers)
                  .set({ smsReminder2SentAt: new Date() })
                  .where(eq(eventVolunteers.id, volunteer.id));

                remindersSent++;
                cronLogger.info(`Sent secondary SMS reminder to ${volunteerPhone} for event ${event.id}`);
              }
            }
          }
        } catch (error) {
          errors++;
          cronLogger.error(`Error sending reminder for volunteer ${volunteer.id}:`, error);
        }
      }

      // Process legacy speaker/driver/volunteer assignments
      const legacyAssignments: Array<{ userId: string; role: string }> = [];

      // Collect speakers from assignedSpeakerIds
      if (event.assignedSpeakerIds && Array.isArray(event.assignedSpeakerIds)) {
        for (const speakerId of event.assignedSpeakerIds) {
          if (speakerId) legacyAssignments.push({ userId: speakerId, role: 'speaker' });
        }
      }

      // Collect drivers from assignedDriverIds
      if (event.assignedDriverIds && Array.isArray(event.assignedDriverIds)) {
        for (const driverId of event.assignedDriverIds) {
          if (driverId) legacyAssignments.push({ userId: driverId, role: 'driver' });
        }
      }

      // Collect volunteers from assignedVolunteerIds
      if (event.assignedVolunteerIds && Array.isArray(event.assignedVolunteerIds)) {
        for (const volunteerId of event.assignedVolunteerIds) {
          if (volunteerId) legacyAssignments.push({ userId: volunteerId, role: 'volunteer' });
        }
      }

      // Process legacy assignments
      for (const assignment of legacyAssignments) {
        volunteersProcessed++;

        try {
          // Use pre-fetched user map (O(1) lookup instead of DB query)
          const user = usersById.get(assignment.userId);

          if (!user) continue;

          const volunteerEmail = user.preferredEmail || user.email;
          const volunteerName = user.displayName || user.firstName || 'Volunteer';
          const volunteerPhone = getUserPhoneNumber(user);
          const preferences = getEventNotificationPreferences(user) || {
            primaryReminderEnabled: true,
            primaryReminderHours: 24,
            primaryReminderType: 'email',
            secondaryReminderEnabled: false,
            secondaryReminderHours: 1,
            secondaryReminderType: 'email',
          };

          // Master toggle from Alert Preferences
          const alertPrefs = await getEffectivePrefs(
            assignment.userId,
            ALERT_TYPES.VOLUNTEER_EVENT_REMINDER
          );
          if (!alertPrefs.emailEnabled && !alertPrefs.smsEnabled) {
            continue;
          }

          // Check primary reminder
          if (
            preferences.primaryReminderEnabled &&
            hoursUntilEvent >= (preferences.primaryReminderHours - 1) &&
            hoursUntilEvent <= (preferences.primaryReminderHours + 1)
          ) {
            // Send email reminder
            if (
              alertPrefs.emailEnabled &&
              (preferences.primaryReminderType === 'email' || preferences.primaryReminderType === 'both') &&
              volunteerEmail
            ) {
              const emailSent = await EmailNotificationService.sendVolunteerReminderNotification(
                volunteerEmail,
                volunteerName,
                event.id,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate!,
                assignment.role,
                getRoleInstructions(assignment.role)
              );

              if (emailSent) {
                remindersSent++;
                cronLogger.info(`Sent primary email reminder to legacy ${assignment.role} ${volunteerEmail} for event ${event.id}`);
              }
            }

            // Send SMS reminder
            if (
              alertPrefs.smsEnabled &&
              (preferences.primaryReminderType === 'sms' || preferences.primaryReminderType === 'both') &&
              volunteerPhone
            ) {
              const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
              // Build event contact details for the reminder
              const eventContactDetails = {
                contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                contactPhone: event.phone || null,
                contactEmail: event.email || null,
              };
              const smsSent = await sendEventReminderSMS(
                volunteerPhone,
                volunteerName,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                assignment.role,
                `${appUrl}/dashboard?section=event-requests`,
                getRoleInstructions(assignment.role),
                eventContactDetails
              );

              if (smsSent.success) {
                remindersSent++;
                cronLogger.info(`Sent primary SMS reminder to legacy ${assignment.role} ${volunteerPhone} for event ${event.id}`);
              }
            }
          }

          // Check secondary reminder
          if (
            preferences.secondaryReminderEnabled &&
            hoursUntilEvent >= (preferences.secondaryReminderHours - 1) &&
            hoursUntilEvent <= (preferences.secondaryReminderHours + 1)
          ) {
            // Send email reminder
            if (
              alertPrefs.emailEnabled &&
              (preferences.secondaryReminderType === 'email' || preferences.secondaryReminderType === 'both') &&
              volunteerEmail
            ) {
              const emailSent = await EmailNotificationService.sendVolunteerReminderNotification(
                volunteerEmail,
                volunteerName,
                event.id,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate!,
                assignment.role,
                getRoleInstructions(assignment.role)
              );

              if (emailSent) {
                remindersSent++;
                cronLogger.info(`Sent secondary email reminder to legacy ${assignment.role} ${volunteerEmail} for event ${event.id}`);
              }
            }

            // Send SMS reminder
            if (
              alertPrefs.smsEnabled &&
              (preferences.secondaryReminderType === 'sms' || preferences.secondaryReminderType === 'both') &&
              volunteerPhone
            ) {
              const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
              // Build event contact details for the reminder
              const eventContactDetails = {
                contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                contactPhone: event.phone || null,
                contactEmail: event.email || null,
              };
              const smsSent = await sendEventReminderSMS(
                volunteerPhone,
                volunteerName,
                event.organizationName || 'Unknown Organization',
                event.scheduledEventDate,
                assignment.role,
                `${appUrl}/dashboard?section=event-requests`,
                getRoleInstructions(assignment.role),
                eventContactDetails
              );

              if (smsSent.success) {
                remindersSent++;
                cronLogger.info(`Sent secondary SMS reminder to legacy ${assignment.role} ${volunteerPhone} for event ${event.id}`);
              }
            }
          }
        } catch (error) {
          errors++;
          cronLogger.error(`Error sending reminder for legacy ${assignment.role} ${assignment.userId}:`, error);
        }
      }

      // Process TSP contact reminders
      try {
        const tspContactIds: string[] = [];
        
        if (event.tspContact) tspContactIds.push(event.tspContact);
        if (event.tspContactAssigned) tspContactIds.push(event.tspContactAssigned);
        
        // Parse additional TSP contacts
        if (event.additionalTspContacts) {
          try {
            const additional = typeof event.additionalTspContacts === 'string' 
              ? JSON.parse(event.additionalTspContacts) 
              : event.additionalTspContacts;
            
            if (Array.isArray(additional)) {
              tspContactIds.push(...additional);
            }
          } catch (e) {
            // If parsing fails, skip additional contacts
          }
        }

        // Send reminders to unique TSP contacts
        const uniqueContactIds = [...new Set(tspContactIds)];
        for (const contactId of uniqueContactIds) {
          try {
            // Use pre-fetched user map (O(1) lookup instead of DB query)
            const contact = usersById.get(contactId);

            if (!contact) continue;

            const preferences = getEventNotificationPreferences(contact);
            const contactEmail = contact.preferredEmail || contact.email;
            const contactName = contact.displayName || contact.firstName || 'TSP Contact';
            const contactPhone = getUserPhoneNumber(contact);

            // Master toggle — these are pre-event reminders for TSP contacts,
            // not initial assignment alerts, so use VOLUNTEER_EVENT_REMINDER.
            const alertPrefs = await getEffectivePrefs(
              contactId,
              ALERT_TYPES.VOLUNTEER_EVENT_REMINDER
            );
            if (!alertPrefs.emailEnabled && !alertPrefs.smsEnabled) {
              continue;
            }

            // Check primary reminder
            if (
              preferences.primaryReminderEnabled &&
              hoursUntilEvent >= (preferences.primaryReminderHours - 1) &&
              hoursUntilEvent <= (preferences.primaryReminderHours + 1)
            ) {
              // Send email
              if (
                alertPrefs.emailEnabled &&
                (preferences.primaryReminderType === 'email' || preferences.primaryReminderType === 'both') &&
                contactEmail
              ) {
                await EmailNotificationService.sendVolunteerReminderNotification(
                  contactEmail,
                  contactName,
                  event.id,
                  event.organizationName || 'Unknown Organization',
                  event.scheduledEventDate!,
                  'TSP Contact'
                );
                remindersSent++;
                cronLogger.info(`Sent primary email reminder to TSP contact ${contactEmail} for event ${event.id}`);
              }

              // Send SMS
              if (
                alertPrefs.smsEnabled &&
                (preferences.primaryReminderType === 'sms' || preferences.primaryReminderType === 'both') &&
                contactPhone
              ) {
                const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
                // Build event contact details for the reminder
                const eventContactDetails = {
                  contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                  contactPhone: event.phone || null,
                  contactEmail: event.email || null,
                };
                await sendEventReminderSMS(
                  contactPhone,
                  contactName,
                  event.organizationName || 'Unknown Organization',
                  event.scheduledEventDate!,
                  'TSP Contact',
                  `${appUrl}/dashboard?section=event-requests`,
                  null, // instructions
                  eventContactDetails
                );
                remindersSent++;
                cronLogger.info(`Sent primary SMS reminder to TSP contact ${contactPhone} for event ${event.id}`);
              }
            }

            // Check secondary reminder
            if (
              preferences.secondaryReminderEnabled &&
              hoursUntilEvent >= (preferences.secondaryReminderHours - 1) &&
              hoursUntilEvent <= (preferences.secondaryReminderHours + 1)
            ) {
              // Send email
              if (
                alertPrefs.emailEnabled &&
                (preferences.secondaryReminderType === 'email' || preferences.secondaryReminderType === 'both') &&
                contactEmail
              ) {
                await EmailNotificationService.sendVolunteerReminderNotification(
                  contactEmail,
                  contactName,
                  event.id,
                  event.organizationName || 'Unknown Organization',
                  event.scheduledEventDate!,
                  'TSP Contact'
                );
                remindersSent++;
                cronLogger.info(`Sent secondary email reminder to TSP contact ${contactEmail} for event ${event.id}`);
              }

              // Send SMS
              if (
                alertPrefs.smsEnabled &&
                (preferences.secondaryReminderType === 'sms' || preferences.secondaryReminderType === 'both') &&
                contactPhone
              ) {
                const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
                // Build event contact details for the reminder
                const eventContactDetails = {
                  contactName: [event.firstName, event.lastName].filter(Boolean).join(' ') || null,
                  contactPhone: event.phone || null,
                  contactEmail: event.email || null,
                };
                await sendEventReminderSMS(
                  contactPhone,
                  contactName,
                  event.organizationName || 'Unknown Organization',
                  event.scheduledEventDate!,
                  'TSP Contact',
                  `${appUrl}/dashboard?section=event-requests`,
                  null, // instructions
                  eventContactDetails
                );
                remindersSent++;
                cronLogger.info(`Sent secondary SMS reminder to TSP contact ${contactPhone} for event ${event.id}`);
              }
            }
          } catch (error) {
            errors++;
            cronLogger.error(`Error sending reminder to TSP contact ${contactId}:`, error);
          }
        }
      } catch (error) {
        errors++;
        cronLogger.error(`Error processing TSP contacts for event ${event.id}:`, error);
      }
    }
  } catch (error) {
    cronLogger.error('Error in sendVolunteerReminders:', error);
    throw error;
  }

  return {
    remindersSent,
    volunteersProcessed,
    errors,
    timestamp: now,
  };
}

/**
 * Notify TSP contacts about in-process events whose date has passed
 * Runs daily to alert TSP contacts that they need to follow up
 */
export async function notifyPastDateInProcessEvents(): Promise<{
  notificationsSent: number;
  eventsProcessed: number;
  errors: number;
  timestamp: Date;
}> {
  const now = new Date();
  let notificationsSent = 0;
  let eventsProcessed = 0;
  let errors = 0;

  try {
    // Get the start of today (midnight) to compare against event dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all in-process events where the date has passed and notification hasn't been sent
    const pastDateEvents = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          eq(eventRequests.status, 'in_process'),
          isNull(eventRequests.pastDateNotificationSentAt),
          isNull(eventRequests.deletedAt),
          or(
            // Check scheduled date if set, otherwise check desired date
            sql`${eventRequests.scheduledEventDate} IS NOT NULL AND ${eventRequests.scheduledEventDate} < ${today}`,
            sql`${eventRequests.scheduledEventDate} IS NULL AND ${eventRequests.desiredEventDate} IS NOT NULL AND ${eventRequests.desiredEventDate} < ${today}`
          )
        )
      );

    cronLogger.info(`Found ${pastDateEvents.length} in-process events with passed dates to notify`);

    for (const event of pastDateEvents) {
      eventsProcessed++;

      try {
        // Re-fetch the event to ensure we have the latest status
        // This prevents sending notifications for events that were completed
        // between when we queried and when we process each event
        const [currentEvent] = await db
          .select()
          .from(eventRequests)
          .where(eq(eventRequests.id, event.id))
          .limit(1);

        if (!currentEvent) {
          cronLogger.warn(`Event ${event.id} no longer exists, skipping`);
          continue;
        }

        // Skip if status has changed from in_process (e.g., already completed)
        if (currentEvent.status !== 'in_process') {
          cronLogger.info(`Event ${event.id} (${event.organizationName}) status changed to '${currentEvent.status}', skipping notification`);
          // Still mark as notified so we don't keep checking this event
          await db
            .update(eventRequests)
            .set({ pastDateNotificationSentAt: new Date() })
            .where(eq(eventRequests.id, event.id));
          continue;
        }

        // Skip if notification was already sent (race condition protection)
        if (currentEvent.pastDateNotificationSentAt) {
          cronLogger.info(`Event ${event.id} already has notification sent, skipping`);
          continue;
        }

        // Get the TSP contact(s) to notify
        const tspContactIds: string[] = [];

        if (event.tspContact) tspContactIds.push(event.tspContact);
        if (event.tspContactAssigned) tspContactIds.push(event.tspContactAssigned);

        // Parse additional TSP contacts
        if (event.additionalTspContacts) {
          try {
            const additional = typeof event.additionalTspContacts === 'string'
              ? JSON.parse(event.additionalTspContacts)
              : event.additionalTspContacts;

            if (Array.isArray(additional)) {
              tspContactIds.push(...additional);
            }
          } catch (e) {
            // If parsing fails, skip additional contacts
          }
        }

        // Add additionalContact1 and additionalContact2 if set
        if (event.additionalContact1) tspContactIds.push(event.additionalContact1);
        if (event.additionalContact2) tspContactIds.push(event.additionalContact2);

        // Get unique contact IDs
        const uniqueContactIds = [...new Set(tspContactIds)];

        if (uniqueContactIds.length === 0) {
          cronLogger.warn(`No TSP contacts found for event ${event.id} (${event.organizationName})`);
          continue;
        }

        // Determine which date to use
        const eventDate = getEffectiveEventDate(event);

        // Send notification to each TSP contact
        for (const contactId of uniqueContactIds) {
          // Skip users with suppressed event notifications (only get assignments + comments)
          if (isNotificationSuppressed(contactId)) continue;

          try {
            const [contact] = await db
              .select()
              .from(users)
              .where(eq(users.id, contactId))
              .limit(1);

            if (!contact || !contact.email) continue;

            const contactName = contact.displayName || contact.firstName || 'TSP Contact';
            const contactEmail = contact.preferredEmail || contact.email;

            const sent = await EmailNotificationService.sendPastDateNotification(
              contactEmail,
              contactName,
              event.id,
              event.organizationName || 'Unknown Organization',
              eventDate!
            );

            if (sent) {
              notificationsSent++;
              cronLogger.info(`Past date notification sent to ${contactEmail} for event ${event.id}`);
            }
          } catch (error) {
            errors++;
            cronLogger.error(`Error sending past date notification to contact ${contactId}:`, error);
          }
        }

        // Mark the notification as sent for this event
        await db
          .update(eventRequests)
          .set({ pastDateNotificationSentAt: new Date() })
          .where(eq(eventRequests.id, event.id));

      } catch (error) {
        errors++;
        cronLogger.error(`Error processing past date notification for event ${event.id}:`, error);
      }
    }
  } catch (error) {
    cronLogger.error('Error in notifyPastDateInProcessEvents:', error);
    throw error;
  }

  return {
    notificationsSent,
    eventsProcessed,
    errors,
    timestamp: now,
  };
}

/**
 * Auto-complete scheduled events whose event date has passed
 * Runs nightly to move events from "scheduled" or "rescheduled" to "completed" status
 * Exported so it can be called manually if needed
 */
export async function autoCompletePassedEvents(): Promise<{
  eventsCompleted: number;
  errors: number;
  timestamp: Date;
}> {
  const now = new Date();
  let eventsCompleted = 0;
  let errors = 0;

  try {
    // Get the start of today (midnight) to compare against event dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all scheduled and rescheduled events where the scheduled date is before today
    const passedEvents = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          sql`${eventRequests.status} IN ('scheduled', 'rescheduled')`,
          sql`${eventRequests.scheduledEventDate} < ${today}`,
          isNull(eventRequests.deletedAt)
        )
      );

    cronLogger.info(`Found ${passedEvents.length} scheduled/rescheduled events with passed dates to auto-complete`);

    for (const event of passedEvents) {
      try {
        // Update the event status to completed
        await db
          .update(eventRequests)
          .set({
            status: 'completed',
            updatedAt: new Date(),
          })
          .where(eq(eventRequests.id, event.id));

        eventsCompleted++;
        cronLogger.info(`Auto-completed event ${event.id} (${event.organizationName}) - event date was ${event.scheduledEventDate}`);
      } catch (error) {
        errors++;
        cronLogger.error(`Error auto-completing event ${event.id}:`, error);
      }
    }
  } catch (error) {
    cronLogger.error('Error in autoCompletePassedEvents:', error);
    throw error;
  }

  return {
    eventsCompleted,
    errors,
    timestamp: now,
  };
}

/**
 * Generate monthly impact report
 */
async function generateMonthlyImpactReport(): Promise<{
  reportGenerated: boolean;
  reportId?: number;
  error?: string;
  timestamp: Date;
}> {
  const now = new Date();

  try {
    // Generate report for the previous month
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    // Use UTC to avoid timezone edge cases
    // startDate: First moment of the month (00:00:00.000 on day 1)
    const startDate = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1, 0, 0, 0, 0));
    // endDate: First moment of the next month (exclusive upper bound)
    const endDate = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    cronLogger.info('Generating monthly impact report', {
      month: lastMonth.getUTCMonth() + 1,
      year: lastMonth.getUTCFullYear(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    const report = await generateImpactReport(startDate, endDate, 'monthly');
    const reportId = await saveImpactReport(report, startDate, endDate, 'monthly', 'ai-cron');

    cronLogger.info('Monthly impact report generated successfully', {
      reportId,
      period: `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`,
    });

    return {
      reportGenerated: true,
      reportId,
      timestamp: now,
    };
  } catch (error) {
    cronLogger.error('Failed to generate monthly impact report', error);
    return {
      reportGenerated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: now,
    };
  }
}

/**
 * Transition driver availability statuses based on dates
 * - Moves drivers to 'unavailable' when unavailableStartDate arrives
 * - Moves drivers to 'pending_checkin' when checkInDate arrives
 * Runs daily to automatically update driver statuses
 */
export async function transitionDriverAvailabilityStatuses(): Promise<{
  driversTransitioned: number;
  driversNeedingCheckin: number;
  errors: number;
  timestamp: Date;
}> {
  const now = new Date();
  let driversTransitioned = 0;
  let driversNeedingCheckin = 0;
  let errors = 0;

  try {
    // Get the start of today for date comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Transition drivers from 'available' to 'unavailable' where unavailableStartDate has arrived
    // IMPORTANT: Only process drivers with explicit 'available' status, not NULL
    // NULL statuses should be cleaned up by migration, not auto-transitioned
    const driversToMakeUnavailable = await db
      .select()
      .from(drivers)
      .where(
        and(
          eq(drivers.availabilityStatus, 'available'),
          isNotNull(drivers.unavailableStartDate),
          lte(drivers.unavailableStartDate, today)
        )
      );

    for (const driver of driversToMakeUnavailable) {
      try {
        await db
          .update(drivers)
          .set({
            availabilityStatus: 'unavailable',
            temporarilyUnavailable: true,
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driver.id));

        driversTransitioned++;
        cronLogger.info(`Transitioned driver ${driver.id} (${driver.name}) to 'unavailable' - start date was ${driver.unavailableStartDate}`);
      } catch (error) {
        errors++;
        cronLogger.error(`Error transitioning driver ${driver.id} to unavailable:`, error);
      }
    }

    // 2. Transition drivers from 'unavailable' to 'pending_checkin' where checkInDate has arrived
    const driversNeedingCheckinList = await db
      .select()
      .from(drivers)
      .where(
        and(
          eq(sql`${drivers.availabilityStatus}`, 'unavailable'),
          isNotNull(drivers.checkInDate),
          lte(drivers.checkInDate, today)
        )
      );

    for (const driver of driversNeedingCheckinList) {
      try {
        await db
          .update(drivers)
          .set({
            availabilityStatus: 'pending_checkin',
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driver.id));

        driversNeedingCheckin++;
        cronLogger.info(`Transitioned driver ${driver.id} (${driver.name}) to 'pending_checkin' - check-in date was ${driver.checkInDate}`);
      } catch (error) {
        errors++;
        cronLogger.error(`Error transitioning driver ${driver.id} to pending_checkin:`, error);
      }
    }

    cronLogger.info('Driver availability status transition completed', {
      driversToUnavailable: driversTransitioned,
      driversToPendingCheckin: driversNeedingCheckin,
      totalErrors: errors,
    });

  } catch (error) {
    cronLogger.error('Error in transitionDriverAvailabilityStatuses:', error);
    throw error;
  }

  return {
    driversTransitioned,
    driversNeedingCheckin,
    errors,
    timestamp: now,
  };
}

/**
 * Initialize all cron jobs
 */
export function initializeCronJobs() {
  cronLogger.info('Initializing scheduled jobs...');

  // Host availability scraper - runs every Monday at 1:00 PM
  // Cron format: minute hour day-of-month month day-of-week
  // '0 13 * * 1' = At 13:00 (1 PM) on Monday
  const hostScraperJob = cron.schedule('0 13 * * 1', async () => {
    cronLogger.info('Running weekly host availability scraper...');
    try {
      const result = await scrapeHostAvailability();
      if (result.success) {
        cronLogger.info('Host availability scrape completed successfully', {
          matchedContacts: result.matchedContacts,
          unmatchedContacts: result.unmatchedContacts,
          scrapedHostsCount: result.scrapedHosts.length,
          timestamp: result.timestamp,
        });
      } else {
        cronLogger.error('Host availability scrape failed', {
          error: result.error,
          timestamp: result.timestamp,
        });
      }
    } catch (error) {
      logError(
        error as Error,
        'Error running host availability scraper in cron job',
        undefined,
        { jobType: 'host-availability-scraper' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York' // Adjust timezone as needed
  });

  cronLogger.info('Host availability scraper scheduled successfully', {
    schedule: 'Mondays at 1:00 PM',
    timezone: 'America/New_York',
  });

  // Volunteer reminder job - runs twice daily at 9 AM and 3 PM
  // Cron format: minute hour day-of-month month day-of-week
  // '0 9,15 * * *' = At 9:00 AM and 3:00 PM every day
  // DISABLED: Automatic volunteer reminders replaced by user-controlled per-event
  // check-in reminder rules (ReminderRulesManager component).
  // TSP contacts can now enable/disable reminders individually per event.
  const volunteerReminderJob = cron.schedule('0 9,15 * * *', async () => {
    cronLogger.info('Volunteer reminder job DISABLED - using per-event check-in toggles instead');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('Volunteer reminder job DISABLED (replaced by per-event check-in toggles)');

  // Monthly impact report generation - runs on the 1st of each month at 9:00 AM
  // Cron format: minute hour day-of-month month day-of-week
  // '0 9 1 * *' = At 9:00 AM on the 1st day of every month
  const impactReportJob = cron.schedule('0 9 1 * *', async () => {
    cronLogger.info('Running monthly impact report generation...');
    try {
      const result = await generateMonthlyImpactReport();
      if (result.reportGenerated) {
        cronLogger.info('Monthly impact report generated successfully', {
          reportId: result.reportId,
          timestamp: result.timestamp,
        });
      } else {
        cronLogger.error('Monthly impact report generation failed', {
          error: result.error,
          timestamp: result.timestamp,
        });
      }
    } catch (error) {
      logError(
        error as Error,
        'Error running impact report generation cron job',
        undefined,
        { jobType: 'impact-report-generation' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Monthly impact report job scheduled successfully', {
    schedule: '1st of each month at 9:00 AM',
    timezone: 'America/New_York',
  });

  // Auto-complete passed events - runs daily at 12:05 AM (just after midnight)
  // Cron format: minute hour day-of-month month day-of-week
  // '5 0 * * *' = At 12:05 AM every day
  const autoCompleteJob = cron.schedule('5 0 * * *', async () => {
    cronLogger.info('Running auto-complete for passed events...');
    try {
      const result = await autoCompletePassedEvents();
      cronLogger.info('Auto-complete job completed', {
        eventsCompleted: result.eventsCompleted,
        errors: result.errors,
        timestamp: result.timestamp,
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running auto-complete cron job',
        undefined,
        { jobType: 'auto-complete-events' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Auto-complete events job scheduled successfully', {
    schedule: 'Daily at 12:05 AM',
    timezone: 'America/New_York',
  });

  // Past date in-process notification job - DISABLED per user request
  // Was: Notifies TSP contacts about in-process events whose date has passed
  // Cron format: minute hour day-of-month month day-of-week
  // '30 9 * * *' = At 9:30 AM every day
  const pastDateNotificationJob = cron.schedule('30 9 * * *', async () => {
    cronLogger.info('Past date notification job is DISABLED - skipping');
    // DISABLED: User requested to stop sending these emails
    // try {
    //   const result = await notifyPastDateInProcessEvents();
    //   cronLogger.info('Past date notification job completed', {
    //     notificationsSent: result.notificationsSent,
    //     eventsProcessed: result.eventsProcessed,
    //     errors: result.errors,
    //     timestamp: result.timestamp,
    //   });
    // } catch (error) {
    //   logError(
    //     error as Error,
    //     'Error running past date notification cron job',
    //     undefined,
    //     { jobType: 'past-date-notification' }
    //   );
    // }
  }, {
    scheduled: false, // DISABLED per user request
    timezone: 'America/New_York'
  });

  cronLogger.info('Past date notification job is DISABLED', {
    schedule: 'DISABLED',
    timezone: 'America/New_York',
  });

  // TSP Contact smart follow-up reminders - runs twice daily at 8 AM and 4 PM
  // Sends ONE-TIME reminders for:
  // - New requests without toolkit sent (24 business hours)
  // - In-process events without activity (7 days)
  // - Escalations (3 days after first reminder with no activity)
  // Cron format: minute hour day-of-month month day-of-week
  // '0 8,16 * * *' = At 8:00 AM and 4:00 PM every day
  // DISABLED: Replaced by user-controlled per-event check-in reminders
  const tspFollowupJob = cron.schedule('0 8,16 * * *', async () => {
    cronLogger.info('TSP follow-up job is DISABLED - replaced by user-controlled check-in reminders');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('TSP contact follow-up job DISABLED (replaced by check-in reminders)');

  // Corporate priority event follow-up - runs daily at 9:00 AM and 2:00 PM
  // Sends strict follow-up reminders to TSP contacts for corporate priority events
  // that don't have successful contact logged
  // Cron format: minute hour day-of-month month day-of-week
  // '0 9,14 * * *' = At 9:00 AM and 2:00 PM every day
  const corporateFollowupJob = cron.schedule('0 9,14 * * *', async () => {
    // DISABLED: Replaced by user-controlled per-event check-in reminders
    cronLogger.info('Corporate follow-up job is DISABLED - replaced by user-controlled check-in reminders');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('Corporate follow-up job DISABLED (replaced by check-in reminders)');

  // Driver availability status transition - runs daily at 12:10 AM
  // Transitions drivers to unavailable when unavailableStartDate arrives
  // Transitions drivers to pending_checkin when checkInDate arrives
  // Cron format: minute hour day-of-month month day-of-week
  // '10 0 * * *' = At 12:10 AM every day
  const driverAvailabilityJob = cron.schedule('10 0 * * *', async () => {
    cronLogger.info('Running driver availability status transition...');
    try {
      const result = await transitionDriverAvailabilityStatuses();
      cronLogger.info('Driver availability transition completed', {
        driversTransitioned: result.driversTransitioned,
        driversNeedingCheckin: result.driversNeedingCheckin,
        errors: result.errors,
        timestamp: result.timestamp,
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running driver availability transition cron job',
        undefined,
        { jobType: 'driver-availability-transition' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Driver availability transition job scheduled successfully', {
    schedule: 'Daily at 12:10 AM',
    timezone: 'America/New_York',
  });

  // ============================================================================
  // TIERED NOTIFICATION SYSTEM JOBS
  // ============================================================================

  // Weekly digest email - runs Monday mornings at 8:00 AM
  // Sends portfolio summary to all TSP contacts with active events
  // Cron format: minute hour day-of-month month day-of-week
  // '0 8 * * 1' = At 8:00 AM on Monday
  // PRODUCTION ONLY: Prevents duplicate digests from dev/staging instances
  const isProduction = process.env.NODE_ENV === 'production';

  const weeklyDigestJob = cron.schedule('0 8 * * 1', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping weekly digest - not production environment');
      return;
    }
    cronLogger.info('Running weekly digest email job...');
    try {
      const result = await processWeeklyDigests();
      cronLogger.info('Weekly digest job completed', {
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        errors: result.errors.length > 0 ? result.errors : undefined,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running weekly digest cron job',
        undefined,
        { jobType: 'weekly-digest' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Weekly digest job scheduled successfully', {
    schedule: 'Mondays at 8:00 AM',
    timezone: 'America/New_York',
  });

  // Corporate 24-hour escalation SMS - runs 3x daily at 9 AM, 1 PM, and 5 PM
  // Sends urgent SMS to TSP contacts for corporate events without successful contact after 24 hours
  // Cron format: minute hour day-of-month month day-of-week
  // '0 9,13,17 * * *' = At 9:00 AM, 1:00 PM, and 5:00 PM every day
  // DISABLED: Replaced by user-controlled per-event check-in reminders
  const corporate24hEscalationJob = cron.schedule('0 9,13,17 * * *', async () => {
    cronLogger.info('Corporate 24h escalation job is DISABLED - replaced by user-controlled check-in reminders');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('Corporate 24h escalation job DISABLED (replaced by check-in reminders)');

  // DISABLED: Replaced by user-controlled per-event check-in reminders
  const eventApproachingJob = cron.schedule('0 9 * * *', async () => {
    cronLogger.info('Event approaching job is DISABLED - replaced by user-controlled check-in reminders');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('Event approaching incomplete job DISABLED (replaced by check-in reminders)');

  // DISABLED: Replaced by user-controlled per-event check-in reminders
  const weeklyContactReminderJob = cron.schedule('0 10 * * 1-5', async () => {
    cronLogger.info('Weekly contact reminder job is DISABLED - replaced by user-controlled check-in reminders');
  }, {
    scheduled: false,
    timezone: 'America/New_York'
  });

  cronLogger.info('Weekly contact reminder job scheduled successfully', {
    schedule: 'Weekdays at 10:00 AM',
    timezone: 'America/New_York',
  });

  // ============================================================
  // ADMIN PROACTIVE NOTIFICATIONS
  // Weekly digest email + Monday morning SMS pulse
  // ============================================================

  // Admin weekly digest email - Sundays at 6:00 PM ET
  // Comprehensive email with pipeline snapshot, calendar, stalled events, and action items
  // Cron format: '0 18 * * 0' = At 6:00 PM every Sunday
  const adminDigestJob = cron.schedule('0 18 * * 0', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping admin weekly digest - not production environment');
      return;
    }
    cronLogger.info('Running admin weekly digest email...');
    try {
      const result = await processAdminWeeklyDigest();
      cronLogger.info('Admin weekly digest email completed', {
        success: result.success,
        message: result.message,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running admin weekly digest cron job',
        undefined,
        { jobType: 'admin-weekly-digest' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Admin weekly digest job scheduled successfully', {
    schedule: 'Sundays at 6:00 PM',
    timezone: 'America/New_York',
  });

  // Admin Monday morning SMS pulse - Mondays at 8:00 AM ET
  // Concise text with pipeline numbers, stalled count, and top priority
  // Cron format: '0 8 * * 1' = At 8:00 AM every Monday
  const adminSmsPulseJob = cron.schedule('0 8 * * 1', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping admin SMS pulse - not production environment');
      return;
    }
    cronLogger.info('Running admin Monday SMS pulse...');
    try {
      const result = await processAdminWeeklySms();
      cronLogger.info('Admin Monday SMS pulse completed', {
        success: result.success,
        message: result.message,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running admin SMS pulse cron job',
        undefined,
        { jobType: 'admin-sms-pulse' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Admin SMS pulse job scheduled successfully', {
    schedule: 'Mondays at 8:00 AM',
    timezone: 'America/New_York',
  });

  // ============================================================
  // AI PREDICTION DEMAND ALERTS
  // Monthly forecast with email to Katie when alert level is high/low
  // ============================================================

  // Prediction demand alert - 1st of each month at 10:00 AM ET
  // Runs AI prediction for next month, emails Katie if demand is projected
  // 30%+ above or below the 12-month average (includes AI recommendations)
  // Cron format: '0 10 1 * *' = At 10:00 AM on the 1st day of every month
  const predictionAlertJob = cron.schedule('0 10 1 * *', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping prediction alerts - not production environment');
      return;
    }
    cronLogger.info('Running monthly prediction demand alert...');
    try {
      const result = await processPredictionAlerts();
      cronLogger.info('Prediction alert job completed', {
        monthChecked: result.monthChecked,
        alertLevel: result.alertLevel,
        emailSent: result.emailSent,
        error: result.error,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running prediction alert cron job',
        undefined,
        { jobType: 'prediction-alert' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Prediction demand alert job scheduled successfully', {
    schedule: '1st of each month at 10:00 AM',
    timezone: 'America/New_York',
  });

  // User-controlled check-in reminders - runs every hour at :15
  // Processes per-event reminder toggles set by TSP contacts
  const checkInReminderJob = cron.schedule('15 * * * *', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping check-in reminders - not production environment');
      return;
    }
    cronLogger.info('Running check-in reminder processing...');
    try {
      const result = await processCheckInReminders();
      cronLogger.info('Check-in reminder processing completed', {
        processed: result.processed,
        sent: result.sent,
        errors: result.errors,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running check-in reminder cron job',
        undefined,
        { jobType: 'check-in-reminders' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Check-in reminder job scheduled successfully', {
    schedule: 'Every hour at :15',
    timezone: 'America/New_York',
  });

  // Standby follow-up reminders — daily at 9:30 AM ET.
  // When a standby event's user-chosen check-back date arrives (set in the
  // standby dialog when moving an event to standby), email the assigned TSP
  // contact so they remember to reach back out to the organization. The date
  // is OPTIONAL — events without one are simply never picked up. Unlike the
  // old blanket tspFollowupJob (disabled, replaced by user-controlled
  // check-in reminders), this only fires for a date the user explicitly set.
  const standbyFollowupJob = cron.schedule('30 9 * * *', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping standby follow-up reminders - not production environment');
      return;
    }
    cronLogger.info('Running standby follow-up reminder processing...');
    try {
      const result = await processStandbyFollowups();
      cronLogger.info('Standby follow-up processing completed', {
        eventsProcessed: result.eventsProcessed,
        notificationsSent: result.notificationsSent,
        errors: result.errors,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running standby follow-up cron job',
        undefined,
        { jobType: 'standby-followup' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });

  cronLogger.info('Standby follow-up reminder job scheduled successfully', {
    schedule: 'Daily at 9:30 AM',
    timezone: 'America/New_York',
  });

  // Integration health check — daily at 6 AM ET, logs/email on failures
  const integrationHealthJob = cron.schedule('0 6 * * *', async () => {
    cronLogger.info('Running daily integration health check...');
    try {
      const { runIntegrationHealthCheck } = await import('./integration-health');
      const report = await runIntegrationHealthCheck({ liveCheck: true, logFailures: true });
      cronLogger.info('Integration health check completed', {
        status: report.overallStatus,
        checkedAt: report.checkedAt,
        unhealthy: report.integrations.filter((i) => i.healthy === false).map((i) => i.name),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running integration health check cron job',
        undefined,
        { jobType: 'integration-health' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York',
  });

  cronLogger.info('Integration health check scheduled successfully', {
    schedule: 'Daily at 6:00 AM',
    timezone: 'America/New_York',
  });

  // Daily error digest — one grouped summary of the last 24h of error/critical
  // logs at 7:05 AM ET. Critical errors are still paged immediately when they
  // occur; this rolls up the rest so a busy day is one email, not a flood.
  const errorDigestJob = cron.schedule('5 7 * * *', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping daily error digest - not production environment');
      return;
    }
    cronLogger.info('Running daily error digest...');
    try {
      const result = await sendDailyErrorDigest();
      cronLogger.info('Daily error digest completed', {
        sent: result.sent,
        total: result.total,
        groups: result.groups,
        timestamp: new Date(),
      });
    } catch (error) {
      logError(
        error as Error,
        'Error running daily error digest cron job',
        undefined,
        { jobType: 'error-digest' }
      );
    }
  }, {
    scheduled: true,
    timezone: 'America/New_York',
  });

  cronLogger.info('Daily error digest job scheduled successfully', {
    schedule: 'Daily at 7:05 AM',
    timezone: 'America/New_York',
  });

  // Collective Learning weekly auto-log - runs daily at 6:20 PM
  // Records the standing weekly PBJ count for the current Wed–Tue collection
  // week (dated the Wednesday) unless that week has a "didn't collect" /
  // different-count override, a real log, or is a holiday week. Running daily
  // instead of once on Wednesday means a missed run (restart, outage) catches
  // up the next evening; reconcileWeek is idempotent.
  // PRODUCTION ONLY: dev instances can use the "Run now" button instead
  const collectiveLearningAutoLogJob = cron.schedule('20 18 * * *', async () => {
    if (!isProduction) {
      cronLogger.info('Skipping Collective Learning auto-log - not production environment');
      return;
    }
    try {
      const result = await runCollectiveLearningAutoLog();
      cronLogger.info('Collective Learning auto-log completed', result);
    } catch (error) {
      logError(
        error as Error,
        'Error running Collective Learning auto-log cron job',
        undefined,
        { jobType: 'collective-learning-auto-log' }
      );
    }
  }, {
    timezone: 'America/New_York',
  });

  cronLogger.info('Collective Learning auto-log job scheduled successfully', {
    schedule: 'Daily at 6:20 PM',
    timezone: 'America/New_York',
  });

  // Return job references in case we need to manage them later
  return {
    hostScraperJob,
    volunteerReminderJob,
    impactReportJob,
    autoCompleteJob,
    pastDateNotificationJob,
    tspFollowupJob,
    corporateFollowupJob,
    driverAvailabilityJob,
    weeklyDigestJob,
    corporate24hEscalationJob,
    eventApproachingJob,
    weeklyContactReminderJob,
    adminDigestJob,
    adminSmsPulseJob,
    predictionAlertJob,
    checkInReminderJob,
    standbyFollowupJob,
    integrationHealthJob,
    errorDigestJob,
    collectiveLearningAutoLogJob,
  };
}

/**
 * Stop all cron jobs (useful for graceful shutdown)
 */
export function stopAllCronJobs(jobs: ReturnType<typeof initializeCronJobs>) {
  cronLogger.info('Stopping all scheduled jobs...');
  jobs.hostScraperJob.stop();
  jobs.volunteerReminderJob.stop();
  jobs.impactReportJob.stop();
  jobs.autoCompleteJob.stop();
  jobs.pastDateNotificationJob.stop();
  jobs.tspFollowupJob.stop();
  jobs.corporateFollowupJob.stop();
  jobs.driverAvailabilityJob.stop();
  jobs.weeklyDigestJob.stop();
  jobs.corporate24hEscalationJob.stop();
  jobs.eventApproachingJob.stop();
  jobs.weeklyContactReminderJob.stop();
  jobs.adminDigestJob.stop();
  jobs.adminSmsPulseJob.stop();
  jobs.predictionAlertJob.stop();
  jobs.checkInReminderJob.stop();
  jobs.standbyFollowupJob.stop();
  jobs.integrationHealthJob.stop();
  jobs.errorDigestJob.stop();
  jobs.collectiveLearningAutoLogJob.stop();
  cronLogger.info('All cron jobs stopped successfully');
}
