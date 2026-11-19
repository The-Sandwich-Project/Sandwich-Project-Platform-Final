import { Router } from 'express';
import { eq, desc, and, sql, or, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { notifications, users } from '../../../shared/schema';
import { getLinkedUserIds } from '../../lib/linked-accounts';
import { insertNotificationSchema } from '../../../shared/schema';
import { createStandardMiddleware } from '../../middleware';
import { smartNotificationsRouter } from './smart';
import { analyticsRouter } from './analytics';
import { actionsRouter } from './actions';
import { alertPreferencesRouter } from './alert-preferences';
import { z } from 'zod';
import { logger } from '../../utils/production-safe-logger';
import { withMobileRoute } from '../../../shared/mobile/deep-links';

const notificationsRouter = Router();

// Apply standard middleware (authentication, logging, etc.)
notificationsRouter.use(createStandardMiddleware());

// Mount smart notification routes
notificationsRouter.use('/smart', smartNotificationsRouter);

// Mount alert preferences (user-facing Alert Preferences screen)
notificationsRouter.use('/alert-preferences', alertPreferencesRouter);

// Mount analytics routes
notificationsRouter.use('/analytics', analyticsRouter);

// Mount actions routes - for executing notification actions
notificationsRouter.use('/', actionsRouter);

// Mount test routes (remove in production) - moved to async initialization
if (process.env.NODE_ENV === 'development') {
  import('./test-endpoints').then(({ testRouter }) => {
    notificationsRouter.use('/test', testRouter);
  }).catch(err => logger.error('Failed to load test endpoints:', err));
}

// Get notifications for current user
notificationsRouter.get('/', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { 
      limit = 50, 
      offset = 0, 
      category,
      unread_only = false,
      include_archived = false 
    } = req.query;

    const linkedIds = await getLinkedUserIds(req.user.id);

    let query = db
      .select()
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          include_archived === 'true' ? undefined : eq(notifications.isArchived, false),
          unread_only === 'true' ? eq(notifications.isRead, false) : undefined,
          category ? eq(notifications.category, category as string) : undefined
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    const userNotifications = await query;

    // Get unread count
    const unreadCount = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false)
        )
      );

    res.json({
      notifications: userNotifications.map(withMobileRoute),
      unreadCount: parseInt(unreadCount[0]?.count as string) || 0,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: userNotifications.length === parseInt(limit as string)
      }
    });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get notification counts by category
notificationsRouter.get('/counts', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);

    const counts = await db
      .select({
        category: notifications.category,
        priority: notifications.priority,
        count: sql`count(*)`
      })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false)
        )
      )
      .groupBy(notifications.category, notifications.priority);

    // Calculate total unread count
    const totalUnread = counts.reduce((sum, item) => sum + parseInt(item.count as string), 0);

    res.json({
      total: totalUnread,
      byCategory: counts.reduce((acc, item) => {
        const category = item.category || 'general';
        if (!acc[category]) acc[category] = 0;
        acc[category] += parseInt(item.count as string);
        return acc;
      }, {} as Record<string, number>),
      byPriority: counts.reduce((acc, item) => {
        const priority = item.priority || 'medium';
        if (!acc[priority]) acc[priority] = 0;
        acc[priority] += parseInt(item.count as string);
        return acc;
      }, {} as Record<string, number>)
    });
  } catch (error) {
    logger.error('Error fetching notification counts:', error);
    res.status(500).json({ error: 'Failed to fetch notification counts' });
  }
});

// Mobile/native-friendly badge count alias.
notificationsRouter.get('/badge-count', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);
    const unreadCount = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          eq(notifications.isRead, false),
          eq(notifications.isArchived, false)
        )
      );

    res.json({ success: true, unreadCount: parseInt(unreadCount[0]?.count as string) || 0 });
  } catch (error) {
    logger.error('Error fetching notification badge count:', error);
    res.status(500).json({ success: false, code: 'BADGE_COUNT_FAILED', message: 'Failed to fetch badge count' });
  }
});

// Mark notification as read
notificationsRouter.patch('/:id/read', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          inArray(notifications.userId, linkedIds)
        )
      )
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, notification: result[0] });
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mobile contract alias for marking a single notification read.
notificationsRouter.post('/:id/read', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
    }

    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) {
      return res.status(400).json({ success: false, code: 'INVALID_NOTIFICATION_ID', message: 'Invalid notification ID' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);
    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          inArray(notifications.userId, linkedIds)
        )
      )
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ success: false, code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' });
    }

    res.json({ success: true, notification: withMobileRoute(result[0]) });
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, code: 'MARK_READ_FAILED', message: 'Failed to mark notification as read' });
  }
});

// Mark multiple notifications as read
notificationsRouter.patch('/bulk/read', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { notificationIds } = req.body;
    const linkedIds = await getLinkedUserIds(req.user.id);

    // If no specific IDs provided, mark all unread as read
    if (!notificationIds || notificationIds.length === 0) {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            inArray(notifications.userId, linkedIds),
            eq(notifications.isRead, false)
          )
        );
      return res.json({ success: true, message: 'All notifications marked as read' });
    }

    // Mark specific notifications as read
    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: 'notificationIds must be an array' });
    }

    const result = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          sql`${notifications.id} = ANY(${notificationIds})`
        )
      )
      .returning();

    res.json({ 
      success: true, 
      updatedCount: result.length,
      notifications: result 
    });
  } catch (error) {
    logger.error('Error bulk marking notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// Mobile contract alias for marking all notifications read.
notificationsRouter.post('/mark-all-read', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          inArray(notifications.userId, linkedIds),
          eq(notifications.isRead, false)
        )
      );

    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, code: 'MARK_ALL_READ_FAILED', message: 'Failed to mark notifications as read' });
  }
});

// Archive notification
notificationsRouter.patch('/:id/archive', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    const linkedIds = await getLinkedUserIds(req.user.id);
    const result = await db
      .update(notifications)
      .set({ isArchived: true, isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          inArray(notifications.userId, linkedIds)
        )
      )
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, notification: result[0] });
  } catch (error) {
    logger.error('Error archiving notification:', error);
    res.status(500).json({ error: 'Failed to archive notification' });
  }
});

// Create new notification (admin only)
notificationsRouter.post('/', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const validationResult = insertNotificationSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid notification data',
        details: validationResult.error.errors
      });
    }

    const notificationData = validationResult.data;
    
    // If no userId specified, this is a broadcast notification
    if (!notificationData.userId) {
      return res.status(400).json({ error: 'userId is required for individual notifications. Use /broadcast for system-wide notifications.' });
    }

    const result = await db
      .insert(notifications)
      .values(notificationData)
      .returning();

    res.status(201).json({ 
      success: true, 
      notification: result[0] 
    });
  } catch (error) {
    logger.error('Error creating notification:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Broadcast notification to all users or specific user groups (admin only)
notificationsRouter.post('/broadcast', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const schema = z.object({
      title: z.string().min(1),
      message: z.string().min(1),
      type: z.string().default('system_update'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      category: z.string().optional(),
      actionUrl: z.string().optional(),
      actionText: z.string().optional(),
      expiresAt: z.string().optional(),
      metadata: z.object({}).optional(),
      targetUsers: z.array(z.string()).optional(), // Specific user IDs
      targetRoles: z.array(z.string()).optional(), // User roles to target
      targetCommittees: z.array(z.string()).optional(), // Committee members to target
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid broadcast data',
        details: validationResult.error.errors
      });
    }

    const { targetUsers, targetRoles, targetCommittees, ...notificationData } = validationResult.data;

    let targetUserIds: string[] = [];

    // If specific users are targeted
    if (targetUsers && targetUsers.length > 0) {
      targetUserIds = targetUsers;
    } else {
      // Get all active users if no specific targeting
      let userQuery = db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
      
      // Filter by roles if specified
      if (targetRoles && targetRoles.length > 0) {
        userQuery = userQuery.where(sql`${users.role} = ANY(${targetRoles})`);
      }

      const targetUsersResult = await userQuery;
      targetUserIds = targetUsersResult.map(u => u.id);
    }

    if (targetUserIds.length === 0) {
      return res.status(400).json({ error: 'No target users found' });
    }

    // Create notifications for all target users
    const notificationsToCreate = targetUserIds.map(userId => ({
      ...notificationData,
      userId,
      expiresAt: notificationData.expiresAt ? new Date(notificationData.expiresAt) : null,
      metadata: notificationData.metadata || {}
    }));

    const result = await db
      .insert(notifications)
      .values(notificationsToCreate)
      .returning();

    res.status(201).json({ 
      success: true, 
      message: `Broadcast sent to ${result.length} users`,
      notificationCount: result.length
    });
  } catch (error) {
    logger.error('Error broadcasting notification:', error);
    res.status(500).json({ error: 'Failed to broadcast notification' });
  }
});

// Delete notification (admin only or own notifications)
notificationsRouter.delete('/:id', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const notificationId = parseInt(req.params.id);
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    // Users can only delete their own (or linked accounts') notifications, admins can delete any
    const linkedIds = await getLinkedUserIds(req.user.id);
    const whereCondition = req.user.permissions?.includes('admin')
      ? eq(notifications.id, notificationId)
      : and(
          eq(notifications.id, notificationId),
          inArray(notifications.userId, linkedIds)
        );

    const result = await db
      .delete(notifications)
      .where(whereCondition)
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Admin endpoint to clean up old/stale notifications
notificationsRouter.post('/admin/cleanup', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      olderThanDays = 30,
      types = [],
      deleteArchived = true,
      deleteRead = false
    } = req.body;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let conditions = [sql`${notifications.createdAt} < ${cutoffDate}`];

    if (deleteArchived) {
      conditions.push(eq(notifications.isArchived, true));
    }

    if (deleteRead) {
      conditions.push(eq(notifications.isRead, true));
    }

    if (types.length > 0) {
      conditions.push(sql`${notifications.type} = ANY(${types})`);
    }

    const result = await db
      .delete(notifications)
      .where(and(...conditions))
      .returning();

    res.json({
      success: true,
      message: `Cleaned up ${result.length} notifications`,
      deletedCount: result.length,
      criteria: {
        olderThanDays,
        types: types.length > 0 ? types : 'all',
        archivedOnly: deleteArchived,
        readOnly: deleteRead,
      },
    });
  } catch (error) {
    logger.error('Error cleaning up notifications:', error);
    res.status(500).json({ error: 'Failed to clean up notifications' });
  }
});

export default notificationsRouter;
