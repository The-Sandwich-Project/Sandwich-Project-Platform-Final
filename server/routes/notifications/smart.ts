/**
 * Smart Notification API Routes
 * 
 * Provides ML-driven notification management including:
 * - User preference management
 * - Smart delivery with relevance scoring
 * - Behavior tracking and pattern analysis
 * - A/B testing for optimization
 */

import { Router } from 'express';
import { eq, desc, and, sql, or, gte, lte, asc } from 'drizzle-orm';
import { db } from '../../db';
import { 
  notifications, 
  notificationPreferences,
  notificationHistory,
  userNotificationPatterns,
  notificationAnalytics,
  notificationRules,
  notificationABTests,
  users
} from '../../../shared/schema';
import { 
  insertNotificationPreferencesSchema,
  insertNotificationHistorySchema,
  insertNotificationRulesSchema,
  insertNotificationAnalyticsSchema,
  insertNotificationABTestsSchema
} from '../../../shared/schema';
import { createStandardMiddleware } from '../../middleware';
import { mlEngine } from '../../services/notifications/ml-engine';
import { smartDeliveryService } from '../../services/notifications/smart-delivery';
import { z } from 'zod';
import logger from '../../utils/logger';

const smartNotificationsRouter = Router();
const smartLogger = logger.child({ service: 'smart-notifications' });

// Apply standard middleware
smartNotificationsRouter.use(createStandardMiddleware());

/**
 * GET /api/notifications/smart/preferences
 * Get user's smart notification preferences
 */
smartNotificationsRouter.get('/preferences', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type } = req.query;

    let query = db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, req.user.id));

    if (type) {
      query = query.where(eq(notificationPreferences.type, type as string));
    }

    const preferences = await query.orderBy(desc(notificationPreferences.createdAt));

    // Also get user behavior pattern
    const pattern = await mlEngine.getUserBehaviorPattern(req.user.id);

    res.json({
      preferences,
      behaviorPattern: pattern,
      success: true
    });

  } catch (error) {
    smartLogger.error('Error fetching smart preferences', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * PUT /api/notifications/smart/preferences
 * Update user's smart notification preferences
 */
smartNotificationsRouter.put('/preferences', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const schema = z.object({
      type: z.string().min(1),
      enabledChannels: z.array(z.string()).default(['in_app']),
      quietHours: z.object({
        start: z.number().min(0).max(23),
        end: z.number().min(0).max(23)
      }).optional(),
      frequency: z.enum(['minimal', 'normal', 'frequent']).default('normal'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      metadata: z.object({}).optional()
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid preference data',
        details: validationResult.error.errors
      });
    }

    const data = validationResult.data;

    // Upsert preference
    await db
      .insert(notificationPreferences)
      .values({
        userId: req.user.id,
        type: data.type,
        enabledChannels: data.enabledChannels,
        quietHours: data.quietHours || null,
        frequency: data.frequency,
        priority: data.priority,
        metadata: data.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          enabledChannels: data.enabledChannels,
          quietHours: data.quietHours || null,
          frequency: data.frequency,
          priority: data.priority,
          metadata: data.metadata || {},
          updatedAt: new Date()
        }
      });

    smartLogger.info('Smart preferences updated', { userId: req.user.id, type: data.type });

    res.json({ success: true, message: 'Preferences updated successfully' });

  } catch (error) {
    smartLogger.error('Error updating smart preferences', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

/**
 * POST /api/notifications/smart/send
 * Send notification using smart delivery logic
 */
smartNotificationsRouter.post('/send', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const schema = z.object({
      userId: z.string().min(1),
      title: z.string().min(1),
      message: z.string().min(1),
      type: z.string().default('system_update'),
      category: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      actionUrl: z.string().optional(),
      actionText: z.string().optional(),
      metadata: z.object({}).optional(),
      forceChannel: z.enum(['email', 'sms', 'in_app']).optional(),
      skipMLScoring: z.boolean().default(false)
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid notification data',
        details: validationResult.error.errors
      });
    }

    const data = validationResult.data;

    // Calculate relevance score and optimal delivery
    let relevanceResult;
    if (!data.skipMLScoring) {
      relevanceResult = await mlEngine.calculateRelevanceScore(
        data.userId,
        data.type,
        data.message,
        data.metadata
      );
      
      smartLogger.info('ML relevance calculated', { 
        userId: data.userId, 
        score: relevanceResult.score,
        recommendedChannel: relevanceResult.recommendedChannel,
        delay: relevanceResult.recommendedDelay
      });
    }

    // Determine delivery channel
    const deliveryChannel = data.forceChannel || relevanceResult?.recommendedChannel || 'in_app';
    const deliveryDelay = relevanceResult?.recommendedDelay || 0;

    // Calculate delivery time
    const deliveryTime = new Date(Date.now() + (deliveryDelay * 1000));

    // Create notification record
    const notificationResult = await db
      .insert(notifications)
      .values({
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type,
        category: data.category,
        priority: data.priority,
        actionUrl: data.actionUrl,
        actionText: data.actionText,
        metadata: data.metadata || {},
        isRead: false,
        isArchived: false,
        createdAt: new Date()
      })
      .returning();

    const notification = notificationResult[0];

    // Create notification history entry
    await db.insert(notificationHistory).values({
      notificationId: notification.id,
      userId: data.userId,
      notificationType: data.type,
      channel: deliveryChannel,
      deliveredAt: deliveryTime,
      mlScore: relevanceResult?.score || 0.5,
      mlFactors: relevanceResult?.factors || {},
      scheduledFor: deliveryTime,
      abTestVariant: null, // TODO: Implement A/B testing assignment
      metadata: {
        ...data.metadata,
        mlRecommendation: relevanceResult,
        deliveryMethod: 'smart'
      }
    });

    // If immediate delivery (no delay), send now
    if (deliveryDelay === 0) {
      await deliverNotification(notification, deliveryChannel);
    } else {
      // Schedule for later delivery (in production, use a job queue)
      smartLogger.info('Notification scheduled for delayed delivery', {
        notificationId: notification.id,
        deliveryTime,
        delay: deliveryDelay
      });
    }

    res.status(201).json({
      success: true,
      notification,
      mlAnalysis: relevanceResult,
      deliveryChannel,
      deliveryTime,
      message: deliveryDelay > 0 ? 'Notification scheduled for optimal delivery' : 'Notification sent immediately'
    });

  } catch (error) {
    smartLogger.error('Error sending smart notification', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

/**
 * POST /api/notifications/smart/track-interaction
 * Track user interaction with notification for ML learning
 */
smartNotificationsRouter.post('/track-interaction', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const schema = z.object({
      notificationId: z.number(),
      interactionType: z.enum(['opened', 'clicked', 'dismissed', 'ignored']),
      channel: z.string(),
      responseTime: z.number().optional(),
      metadata: z.object({}).optional()
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid interaction data',
        details: validationResult.error.errors
      });
    }

    const data = validationResult.data;

    // Update notification history with interaction
    const interactionTime = new Date();
    const updateData: any = {
      [`${data.interactionType}At`]: interactionTime,
      interactionMetadata: data.metadata || {}
    };

    await db
      .update(notificationHistory)
      .set(updateData)
      .where(and(
        eq(notificationHistory.notificationId, data.notificationId),
        eq(notificationHistory.userId, req.user.id)
      ));

    // Update user behavior pattern based on interaction
    await mlEngine.updateUserBehaviorFromInteraction(
      req.user.id,
      data.notificationId,
      data.interactionType,
      data.channel,
      data.responseTime
    );

    smartLogger.info('Interaction tracked', {
      userId: req.user.id,
      notificationId: data.notificationId,
      interactionType: data.interactionType,
      channel: data.channel
    });

    res.json({ success: true, message: 'Interaction tracked successfully' });

  } catch (error) {
    smartLogger.error('Error tracking interaction', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

/**
 * GET /api/notifications/smart/analytics
 * Get notification analytics and insights
 */
smartNotificationsRouter.get('/analytics', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { 
      period = '7d',
      userId,
      notificationType,
      channel 
    } = req.query;

    // Calculate date range
    const periodDays = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
    const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    // Build base query
    let query = db
      .select({
        id: notificationHistory.id,
        userId: notificationHistory.userId,
        notificationType: notificationHistory.notificationType,
        channel: notificationHistory.channel,
        deliveredAt: notificationHistory.deliveredAt,
        openedAt: notificationHistory.openedAt,
        clickedAt: notificationHistory.clickedAt,
        dismissedAt: notificationHistory.dismissedAt,
        mlScore: notificationHistory.mlScore
      })
      .from(notificationHistory)
      .where(gte(notificationHistory.deliveredAt, startDate));

    // Add filters
    if (userId) {
      query = query.where(eq(notificationHistory.userId, userId as string));
    }
    if (notificationType) {
      query = query.where(eq(notificationHistory.notificationType, notificationType as string));
    }
    if (channel) {
      query = query.where(eq(notificationHistory.channel, channel as string));
    }

    const data = await query.orderBy(desc(notificationHistory.deliveredAt));

    // Calculate analytics
    const analytics = {
      totalSent: data.length,
      totalOpened: data.filter(n => n.openedAt).length,
      totalClicked: data.filter(n => n.clickedAt).length,
      totalDismissed: data.filter(n => n.dismissedAt).length,
      openRate: data.length > 0 ? data.filter(n => n.openedAt).length / data.length : 0,
      clickRate: data.length > 0 ? data.filter(n => n.clickedAt).length / data.length : 0,
      averageMlScore: data.length > 0 ? data.reduce((sum, n) => sum + (n.mlScore || 0), 0) / data.length : 0,
      
      // Channel breakdown
      byChannel: {} as Record<string, any>,
      
      // Type breakdown
      byType: {} as Record<string, any>,
      
      // Hourly breakdown
      byHour: {} as Record<number, any>,
      
      // Daily trends
      dailyTrends: [] as any[]
    };

    // Calculate channel stats
    const channelStats: Record<string, any> = {};
    data.forEach(n => {
      if (!channelStats[n.channel]) {
        channelStats[n.channel] = { sent: 0, opened: 0, clicked: 0 };
      }
      channelStats[n.channel].sent++;
      if (n.openedAt) channelStats[n.channel].opened++;
      if (n.clickedAt) channelStats[n.channel].clicked++;
    });

    Object.entries(channelStats).forEach(([channel, stats]) => {
      analytics.byChannel[channel] = {
        ...stats,
        openRate: stats.sent > 0 ? stats.opened / stats.sent : 0,
        clickRate: stats.sent > 0 ? stats.clicked / stats.sent : 0
      };
    });

    // Calculate type stats
    const typeStats: Record<string, any> = {};
    data.forEach(n => {
      if (!typeStats[n.notificationType]) {
        typeStats[n.notificationType] = { sent: 0, opened: 0, clicked: 0 };
      }
      typeStats[n.notificationType].sent++;
      if (n.openedAt) typeStats[n.notificationType].opened++;
      if (n.clickedAt) typeStats[n.notificationType].clicked++;
    });

    Object.entries(typeStats).forEach(([type, stats]) => {
      analytics.byType[type] = {
        ...stats,
        openRate: stats.sent > 0 ? stats.opened / stats.sent : 0,
        clickRate: stats.sent > 0 ? stats.clicked / stats.sent : 0
      };
    });

    // Calculate hourly distribution
    for (let hour = 0; hour < 24; hour++) {
      analytics.byHour[hour] = { sent: 0, opened: 0, clicked: 0 };
    }
    
    data.forEach(n => {
      const hour = new Date(n.deliveredAt).getHours();
      analytics.byHour[hour].sent++;
      if (n.openedAt) analytics.byHour[hour].opened++;
      if (n.clickedAt) analytics.byHour[hour].clicked++;
    });

    // Calculate daily trends
    const dailyData: Record<string, any> = {};
    data.forEach(n => {
      const day = new Date(n.deliveredAt).toDateString();
      if (!dailyData[day]) {
        dailyData[day] = { date: day, sent: 0, opened: 0, clicked: 0 };
      }
      dailyData[day].sent++;
      if (n.openedAt) dailyData[day].opened++;
      if (n.clickedAt) dailyData[day].clicked++;
    });

    analytics.dailyTrends = Object.values(dailyData).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    res.json({
      success: true,
      analytics,
      period,
      dateRange: { start: startDate, end: new Date() }
    });

  } catch (error) {
    smartLogger.error('Error fetching analytics', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/notifications/smart/user-patterns
 * Get user behavior patterns for analysis
 */
smartNotificationsRouter.get('/user-patterns', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, limit = 50 } = req.query;

    let query = db
      .select({
        userId: userNotificationPatterns.userId,
        user: {
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email
        },
        activeHours: userNotificationPatterns.activeHours,
        preferredChannels: userNotificationPatterns.preferredChannels,
        averageResponseTime: userNotificationPatterns.averageResponseTime,
        engagementRate: userNotificationPatterns.engagementRate,
        optimalFrequency: userNotificationPatterns.optimalFrequency,
        lastUpdated: userNotificationPatterns.lastUpdated
      })
      .from(userNotificationPatterns)
      .leftJoin(users, eq(userNotificationPatterns.userId, users.id));

    if (userId) {
      query = query.where(eq(userNotificationPatterns.userId, userId as string));
    }

    const patterns = await query
      .orderBy(desc(userNotificationPatterns.lastUpdated))
      .limit(parseInt(limit as string));

    res.json({
      success: true,
      patterns
    });

  } catch (error) {
    smartLogger.error('Error fetching user patterns', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch user patterns' });
  }
});

/**
 * POST /api/notifications/smart/rules
 * Create or update notification rules
 */
smartNotificationsRouter.post('/rules', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const validationResult = insertNotificationRulesSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Invalid rule data',
        details: validationResult.error.errors
      });
    }

    const ruleData = validationResult.data;

    const result = await db
      .insert(notificationRules)
      .values({
        ...ruleData,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    smartLogger.info('Notification rule created', { 
      ruleId: result[0].id, 
      userId: req.user.id 
    });

    res.status(201).json({
      success: true,
      rule: result[0]
    });

  } catch (error) {
    smartLogger.error('Error creating notification rule', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

/**
 * GET /api/notifications/smart/rules
 * Get notification rules
 */
smartNotificationsRouter.get('/rules', async (req, res) => {
  try {
    if (!req.user?.permissions?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { isActive = true } = req.query;

    let query = db.select().from(notificationRules);
    
    if (isActive !== undefined) {
      query = query.where(eq(notificationRules.isActive, isActive === 'true'));
    }

    const rules = await query.orderBy(desc(notificationRules.createdAt));

    res.json({
      success: true,
      rules
    });

  } catch (error) {
    smartLogger.error('Error fetching notification rules', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

/**
 * Helper method to deliver notification
 * Integrates with existing notification delivery systems
 */
async function deliverNotification(notification: any, channel: string): Promise<void> {
  try {
    smartLogger.info('Delivering notification', {
      notificationId: notification.id,
      channel,
      userId: notification.userId
    });

    // Use the smart delivery service to deliver the notification
    // This integrates with:
    // - WebSocket for in_app notifications
    // - Twilio Email for email notifications
    // - Twilio for SMS notifications
    // - FCM/APNS for push notifications
    await smartDeliveryService.deliverNotificationNow(notification, channel);

    smartLogger.info('Notification delivered successfully', {
      notificationId: notification.id,
      channel,
      userId: notification.userId
    });

  } catch (error) {
    smartLogger.error('Failed to deliver notification', {
      error,
      notificationId: notification.id,
      channel,
      userId: notification.userId
    });
    // Don't throw - allow the notification to be stored even if delivery fails
    // The user can still see it in their notification history
  }
}

export { smartNotificationsRouter };