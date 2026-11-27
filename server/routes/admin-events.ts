/**
 * Admin Event Management Routes
 *
 * Provides endpoints for debugging and fixing event-related issues,
 * especially for tracking down notification problems.
 */

import { Router } from 'express';
import { normalizeIncomingStatus, statusTransitionEffects } from '../utils/status-transition-effects';
import { db } from '../db';
import { eventRequests, users, tspContactFollowups } from '@shared/schema';
import { eq, ilike, or, and, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';

export function createAdminEventsRouter(deps: { isAuthenticated: any }) {
  const router = Router();
  const { isAuthenticated } = deps;

  /**
   * GET /api/admin/events/search
   * Search for events by organization name (case-insensitive)
   * Useful for debugging notification issues
   */
  router.get('/search', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Check if user is admin
      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: 'Search query (q) is required' });
      }

      const events = await db
        .select({
          id: eventRequests.id,
          organizationName: eventRequests.organizationName,
          status: eventRequests.status,
          desiredEventDate: eventRequests.desiredEventDate,
          scheduledEventDate: eventRequests.scheduledEventDate,
          tspContact: eventRequests.tspContact,
          tspContactAssigned: eventRequests.tspContactAssigned,
          tspContactAssignedDate: eventRequests.tspContactAssignedDate,
          lastContactAttempt: eventRequests.lastContactAttempt,
          pastDateNotificationSentAt: eventRequests.pastDateNotificationSentAt,
          adminEscalationSentAt: eventRequests.adminEscalationSentAt,
          createdAt: eventRequests.createdAt,
          updatedAt: eventRequests.updatedAt,
        })
        .from(eventRequests)
        .where(ilike(eventRequests.organizationName, `%${q}%`))
        .orderBy(desc(eventRequests.createdAt))
        .limit(20);

      // Get TSP contact names
      const eventsWithContacts = await Promise.all(
        events.map(async (event) => {
          const contactId = event.tspContactAssigned || event.tspContact;
          let contactName = null;
          let contactEmail = null;

          if (contactId) {
            const [contact] = await db
              .select({ displayName: users.displayName, firstName: users.firstName, email: users.email })
              .from(users)
              .where(eq(users.id, contactId))
              .limit(1);

            if (contact) {
              contactName = contact.displayName || contact.firstName || 'Unknown';
              contactEmail = contact.email;
            }
          }

          // Get notification history for this event
          const notifications = await db
            .select()
            .from(tspContactFollowups)
            .where(eq(tspContactFollowups.eventRequestId, event.id))
            .orderBy(desc(tspContactFollowups.sentAt))
            .limit(10);

          return {
            ...event,
            tspContactName: contactName,
            tspContactEmail: contactEmail,
            notificationHistory: notifications,
          };
        })
      );

      logger.log(`[Admin] Event search for "${q}" returned ${events.length} results`);
      res.json({ events: eventsWithContacts });
    } catch (error: any) {
      logger.error('[Admin] Event search error:', error);
      res.status(500).json({ message: 'Search failed', error: error.message });
    }
  });

  /**
   * GET /api/admin/events/:id
   * Get detailed event info including all notification-related fields
   */
  router.get('/:id', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: 'Invalid event ID' });
      }

      const [event] = await db
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, eventId))
        .limit(1);

      if (!event) {
        return res.status(404).json({ message: 'Event not found' });
      }

      // Get TSP contact info
      const contactId = event.tspContactAssigned || event.tspContact;
      let contactInfo = null;

      if (contactId) {
        const [contact] = await db
          .select()
          .from(users)
          .where(eq(users.id, contactId))
          .limit(1);

        if (contact) {
          contactInfo = {
            id: contact.id,
            name: contact.displayName || contact.firstName || 'Unknown',
            email: contact.email,
          };
        }
      }

      // Get ALL notification history
      const notifications = await db
        .select()
        .from(tspContactFollowups)
        .where(eq(tspContactFollowups.eventRequestId, eventId))
        .orderBy(desc(tspContactFollowups.sentAt));

      res.json({
        event,
        tspContact: contactInfo,
        notificationHistory: notifications,
      });
    } catch (error: any) {
      logger.error('[Admin] Event detail error:', error);
      res.status(500).json({ message: 'Failed to get event', error: error.message });
    }
  });

  /**
   * PATCH /api/admin/events/:id/status
   * Update event status (for fixing stuck events)
   */
  router.patch('/:id/status', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: 'Invalid event ID' });
      }

      const { reason } = req.body;
      // "Rescheduled" was retired; treat it as "scheduled".
      const status = normalizeIncomingStatus(req.body.status);
      const validStatuses = ['new', 'in_process', 'scheduled', 'completed', 'declined', 'cancelled', 'stalled', 'standby', 'non_event'];

      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          message: 'Invalid status',
          validStatuses
        });
      }

      // Get current event
      const [currentEvent] = await db
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, eventId))
        .limit(1);

      if (!currentEvent) {
        return res.status(404).json({ message: 'Event not found' });
      }

      const oldStatus = currentEvent.status;

      // Update the event, with the same status side effects as the edit form
      // (standby stamp + default check-back date, "needs new date" marker).
      const now = new Date();
      await db
        .update(eventRequests)
        .set({
          status,
          ...(status !== oldStatus ? { statusChangedAt: now } : {}),
          ...statusTransitionEffects({ fromStatus: oldStatus, toStatus: status, updates: {}, now }),
          updatedAt: now,
        })
        .where(eq(eventRequests.id, eventId));

      logger.log(`[Admin] Event ${eventId} (${currentEvent.organizationName}) status changed: ${oldStatus} -> ${status} by ${user.email}. Reason: ${reason || 'Not specified'}`);

      res.json({
        success: true,
        message: `Event status updated from "${oldStatus}" to "${status}"`,
        eventId,
        organizationName: currentEvent.organizationName,
        oldStatus,
        newStatus: status,
        updatedBy: user.email,
      });
    } catch (error: any) {
      logger.error('[Admin] Event status update error:', error);
      res.status(500).json({ message: 'Status update failed', error: error.message });
    }
  });

  /**
   * POST /api/admin/events/:id/clear-notifications
   * Clear notification tracking flags to stop future notifications for an event
   */
  router.post('/:id/clear-notifications', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const eventId = parseInt(req.params.id);
      if (isNaN(eventId)) {
        return res.status(400).json({ message: 'Invalid event ID' });
      }

      // Mark the event as having already received all notifications
      // This prevents future notification jobs from sending more emails
      await db
        .update(eventRequests)
        .set({
          pastDateNotificationSentAt: new Date(),
          adminEscalationSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(eventRequests.id, eventId));

      logger.log(`[Admin] Cleared notification flags for event ${eventId} by ${user.email}`);

      res.json({
        success: true,
        message: 'Notification flags cleared - no more automated notifications will be sent for this event',
        eventId,
      });
    } catch (error: any) {
      logger.error('[Admin] Clear notifications error:', error);
      res.status(500).json({ message: 'Failed to clear notifications', error: error.message });
    }
  });

  /**
   * GET /api/admin/events/in-process/all
   * List all in_process events (useful for debugging)
   */
  router.get('/in-process/all', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const events = await db
        .select({
          id: eventRequests.id,
          organizationName: eventRequests.organizationName,
          status: eventRequests.status,
          desiredEventDate: eventRequests.desiredEventDate,
          scheduledEventDate: eventRequests.scheduledEventDate,
          tspContactAssigned: eventRequests.tspContactAssigned,
          lastContactAttempt: eventRequests.lastContactAttempt,
          createdAt: eventRequests.createdAt,
        })
        .from(eventRequests)
        .where(eq(eventRequests.status, 'in_process'))
        .orderBy(desc(eventRequests.createdAt));

      logger.log(`[Admin] Listed ${events.length} in_process events`);
      res.json({ count: events.length, events });
    } catch (error: any) {
      logger.error('[Admin] List in_process events error:', error);
      res.status(500).json({ message: 'Failed to list events', error: error.message });
    }
  });

  return router;
}
