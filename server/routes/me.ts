import { Router, type Response } from 'express';
import type { IStorage } from '../storage';
import { storage } from '../storage-wrapper';
import { logger } from '../utils/production-safe-logger';
import type { AuthenticatedRequest } from '../types/express';
import { getUserMetadata, getEventNotificationPreferences, getCheckInReminderPreferences, normalizeCheckInReminderPreferences, normalizeCheckpointDays, MAX_ALERT_DAYS } from '@shared/types';
import type { EventNotificationPreferences, CheckInReminderPreferences } from '@shared/types';
import { db } from '../db';
import { eventReminderSnoozes, eventCheckInReminders } from '@shared/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

interface DashboardItem {
  id: number;
  title: string;
  status: string;
  linkPath: string;
  count?: number;
  priority?: string;
  dueDate?: string;
  createdAt?: string;
  assignmentType?: string[];
  organizationName?: string;
}

interface DashboardData {
  projects: DashboardItem[];
  tasks: DashboardItem[];
  events: DashboardItem[];
  messages: DashboardItem[];
  counts: {
    projects: number;
    tasks: number;
    events: number;
    messages: number;
  };
}

const normalizeToString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }

  return null;
};

const toStringArray = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeToString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return toStringArray(parsed);
        }
      } catch {
        // Fallback to comma-separated parsing below
      }
    }

    return trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
};

// Create me routes router
const meRouter = Router();

// Helper function to get user from request
const getUser = (req: AuthenticatedRequest) => {
  return req.user || req.session?.user;
};

// GET /dashboard - Get user's dashboard data
meRouter.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) {
      return res.status(400).json({ message: 'Invalid user identifier' });
    }
    const userId = normalizedUserId;

    logger.info(`Fetching dashboard data for user: ${userId}`);

    // Fetch assigned projects (excluding completed, order by priority)
    const allProjects = await storage.getAllProjects();
    const allUsers = await storage.getAllUsers();
    
    // Find current user details
    const currentUser = allUsers.find(
      (u) => normalizeToString(u.id) === userId
    );
    const userFullName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : '';
    const userDisplayName = currentUser?.displayName || '';
    
    logger.info(
      `Looking for projects assigned to user: ${userId}, name: "${userFullName}", display: "${userDisplayName}"`
    );
    logger.info(`Total projects to check: ${allProjects.length}`);
    
    const assignedProjects = allProjects
      .filter((project) => {
        // Check if user is assigned via ID fields (new way)
        const idAssigned = (
          normalizeToString(project.assigneeId) === userId ||
          normalizeToString(project.assignee_id) === userId ||
          toStringArray(project.assigneeIds).includes(userId) ||
          toStringArray(project.assignee_ids).includes(userId) ||
          toStringArray(project.supportPeopleIds).includes(userId) ||
          toStringArray(project.support_people_ids).includes(userId)
        );
        
        // Check if user is assigned via name fields (current way)
        const nameAssigned = currentUser && (
          (project.assigneeName && (project.assigneeName.includes(userFullName) || project.assigneeName.includes(userDisplayName))) ||
          (project.assigneeNames && (project.assigneeNames.includes(userFullName) || project.assigneeNames.includes(userDisplayName))) ||
          (project.supportPeople && (project.supportPeople.includes(userFullName) || project.supportPeople.includes(userDisplayName)))
        );
        
        // Debug logging for each project
        if (project.assigneeName || project.assigneeNames || project.supportPeople) {
          logger.info(`Project ${project.id}: assigneeName="${project.assigneeName}", assigneeNames="${project.assigneeNames}", supportPeople="${project.supportPeople}"`);
          logger.info(`  nameAssigned: ${nameAssigned}, idAssigned: ${idAssigned}`);
        }
        
        const isAssigned = idAssigned || nameAssigned;
        if (isAssigned) {
          logger.info(`Found assigned project: ${project.id} - ${project.title}`);
        }
        
        return isAssigned;
      })
      .filter((project) => project.status !== 'completed')
      .sort((a, b) => {
        // Priority order: urgent > high > medium > low
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      })
      .slice(0, 3)
      .map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        linkPath: `/dashboard?section=projects&view=detail&id=${project.id}`,
        priority: project.priority,
        dueDate: project.dueDate,
      }));

    // Fetch assigned tasks using storage interface
    const allTasks = await storage.getAssignedTasks(userId);
    const assignedTasks = allTasks
      .filter((task) => {
        return ['pending', 'in_progress'].includes(task.status);
      })
      .sort((a, b) => {
        // Priority order: urgent > high > medium > low
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      })
      .slice(0, 3)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        linkPath: `/dashboard?section=projects&view=detail&id=${task.projectId}`,
        priority: task.priority,
        dueDate: task.dueDate,
      }));

    // Fetch assigned events (using same logic as existing /assigned endpoint)
    const allEventRequests = await storage.getAllEventRequests();
    // Note: currentUser already defined above

    const assignedEvents = allEventRequests
      .filter((event) => {
        // Exclude completed and declined events - only show active/upcoming events
        if (event.status === 'completed' || event.status === 'declined') return false;

        // Method 1: Direct assignment via assignedTo field
        if (event.assignedTo === userId) return true;

        // Method 2: TSP contact assignment
        if (event.tspContact === userId || event.tspContactAssigned === userId) return true;

        // Method 2b: Additional TSP contacts
        if (event.additionalTspContacts && currentUser) {
          const additionalContacts = (typeof event.additionalTspContacts === 'string' ? event.additionalTspContacts : JSON.stringify(event.additionalTspContacts || '')).toLowerCase();
          const userEmail = currentUser.email.toLowerCase();
          const userName = currentUser.displayName?.toLowerCase() || '';
          const userFirstName = currentUser.firstName?.toLowerCase() || '';
          const userLastName = currentUser.lastName?.toLowerCase() || '';

          if (
            additionalContacts.includes(userEmail) ||
            (userName && additionalContacts.includes(userName)) ||
            (userFirstName &&
              userLastName &&
              (additionalContacts.includes(userFirstName) ||
                additionalContacts.includes(userLastName)))
          ) {
            return true;
          }
        }

        // Method 3: Driver details
        if (event.driverDetails && currentUser) {
          const driverText = (
            typeof event.driverDetails === 'string'
              ? event.driverDetails
              : JSON.stringify(event.driverDetails)
          ).toLowerCase();
          const userEmail = currentUser.email.toLowerCase();
          const userName = currentUser.displayName?.toLowerCase() || '';

          if (driverText.includes(userEmail) || (userName && driverText.includes(userName))) {
            return true;
          }
        }

        // Method 4: Speaker details
        if (event.speakerDetails && currentUser) {
          const speakerText = (
            typeof event.speakerDetails === 'string'
              ? event.speakerDetails
              : JSON.stringify(event.speakerDetails)
          ).toLowerCase();
          const userEmail = currentUser.email.toLowerCase();
          const userName = currentUser.displayName?.toLowerCase() || '';

          if (speakerText.includes(userEmail) || (userName && speakerText.includes(userName))) {
            return true;
          }
        }

        return false;
      })
      .sort((a, b) => {
        // Sort by event date, upcoming first
        if (a.desiredEventDate && b.desiredEventDate) {
          return new Date(a.desiredEventDate).getTime() - new Date(b.desiredEventDate).getTime();
        }
        return 0;
      })
      .slice(0, 3)
      .map((event) => ({
        id: event.id,
        title: `${event.firstName} ${event.lastName}`,
        status: event.status,
        linkPath: `/dashboard?section=event-requests&tab=new&eventId=${event.id}`,
        organizationName: event.organizationName,
        dueDate: event.desiredEventDate,
      }));

    // Fetch unread messages - try to get from message_recipients table
    let unreadMessages: DashboardItem[] = [];
    try {
      // Try to get unread messages from messaging system
      const allMessages = await storage.getAllMessages?.() || [];
      const messageRecipients = await storage.getMessageRecipients?.(userId) || [];
      
      unreadMessages = messageRecipients
        .filter((recipient) => !recipient.read)
        .slice(0, 3)
        .map((recipient) => {
          const message = allMessages.find((m) => m.id === recipient.messageId);
          return {
            id: recipient.messageId,
            title: message?.subject || message?.content?.substring(0, 50) || 'New Message',
            status: 'unread',
            linkPath: '/dashboard?section=messages',
            createdAt: message?.createdAt || recipient.createdAt,
          };
        });
    } catch (error) {
      logger.warn('Could not fetch messages, using fallback', error);
      // Fallback - use empty array
      unreadMessages = [];
    }

    // Get total counts - use the already filtered assignedProjects array
    const totalProjectsCount = assignedProjects.length;

    const totalTasksCount = allTasks.filter((task) => {
      return ['pending', 'in_progress'].includes(task.status);
    }).length;

    const totalEventsCount = allEventRequests.filter((event) => {
      if (event.status === 'completed' || event.status === 'declined') return false;
      return (
        event.assignedTo === userId ||
        event.tspContact === userId ||
        event.tspContactAssigned === userId ||
        (event.additionalTspContacts && currentUser && (typeof event.additionalTspContacts === 'string' ? event.additionalTspContacts : JSON.stringify(event.additionalTspContacts || '')).toLowerCase().includes(currentUser.email.toLowerCase())) ||
        (event.driverDetails && currentUser && JSON.stringify(event.driverDetails).toLowerCase().includes(currentUser.email.toLowerCase())) ||
        (event.speakerDetails && currentUser && JSON.stringify(event.speakerDetails).toLowerCase().includes(currentUser.email.toLowerCase()))
      );
    }).length;

    // For messages count, try to get unread count
    let totalMessagesCount = 0;
    try {
      const allUnreadRecipients = await storage.getMessageRecipients?.(userId) || [];
      totalMessagesCount = allUnreadRecipients.filter((r) => !r.read).length;
    } catch (error) {
      totalMessagesCount = 0;
    }

    const dashboardData: DashboardData = {
      projects: assignedProjects,
      tasks: assignedTasks,
      events: assignedEvents,
      messages: unreadMessages,
      counts: {
        projects: totalProjectsCount,
        tasks: totalTasksCount,
        events: totalEventsCount,
        messages: totalMessagesCount,
      },
    };

    logger.info(`Dashboard data prepared for user ${userId}: ${totalProjectsCount} projects, ${totalTasksCount} tasks, ${totalEventsCount} events, ${totalMessagesCount} messages`);
    res.json(dashboardData);
  } catch (error) {
    logger.error('Failed to fetch dashboard data', error);
    logger.error('Dashboard endpoint error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
});

// GET /notification-preferences - Get current user's event notification preferences
meRouter.get('/notification-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) {
      return res.status(400).json({ message: 'Invalid user identifier' });
    }

    // Get full user data from storage
    const allUsers = await storage.getAllUsers();
    const fullUser = allUsers.find((u) => normalizeToString(u.id) === normalizedUserId);

    if (!fullUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get notification preferences with defaults
    const preferences = getEventNotificationPreferences(fullUser);
    
    res.json(preferences);
  } catch (error) {
    logger.error('Failed to fetch notification preferences', error);
    res.status(500).json({ message: 'Failed to fetch notification preferences' });
  }
});

// PUT /notification-preferences - Update current user's event notification preferences
meRouter.put('/notification-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) {
      return res.status(400).json({ message: 'Invalid user identifier' });
    }

    // Validate request body
    const {
      primaryReminderEnabled,
      primaryReminderHours,
      primaryReminderType,
      secondaryReminderEnabled,
      secondaryReminderHours,
      secondaryReminderType,
    } = req.body as EventNotificationPreferences;

    // Validate hours range (1-72)
    if (primaryReminderHours < 1 || primaryReminderHours > 72) {
      return res.status(400).json({ message: 'Primary reminder hours must be between 1 and 72' });
    }
    
    if (secondaryReminderEnabled && (secondaryReminderHours < 1 || secondaryReminderHours > 72)) {
      return res.status(400).json({ message: 'Secondary reminder hours must be between 1 and 72' });
    }

    // Validate reminder types
    const validTypes = ['email', 'sms', 'both'];
    if (!validTypes.includes(primaryReminderType)) {
      return res.status(400).json({ message: 'Invalid primary reminder type' });
    }
    
    if (secondaryReminderEnabled && !validTypes.includes(secondaryReminderType)) {
      return res.status(400).json({ message: 'Invalid secondary reminder type' });
    }

    // Get current user data
    const allUsers = await storage.getAllUsers();
    const fullUser = allUsers.find((u) => normalizeToString(u.id) === normalizedUserId);

    if (!fullUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get current metadata
    const metadata = getUserMetadata(fullUser);

    // Update notification preferences
    const updatedMetadata = {
      ...metadata,
      eventNotificationPreferences: {
        primaryReminderEnabled,
        primaryReminderHours,
        primaryReminderType,
        secondaryReminderEnabled,
        secondaryReminderHours,
        secondaryReminderType,
      } as EventNotificationPreferences,
    };

    // Save updated metadata
    await storage.updateUser(normalizedUserId, {
      metadata: updatedMetadata,
    });

    logger.info(`Updated notification preferences for user ${normalizedUserId}`);
    res.json({ success: true, preferences: updatedMetadata.eventNotificationPreferences });
  } catch (error) {
    logger.error('Failed to update notification preferences', error);
    res.status(500).json({ message: 'Failed to update notification preferences' });
  }
});

// ---------------------------------------------------------------------------
// Check-In Reminder Preferences (global defaults for event reminders)
// ---------------------------------------------------------------------------

const VALID_REMINDER_RULE_TYPES = [
  'no_contact', 'stale_event', 'date_approaching_inprocess',
  'date_approaching_scheduled', 'staffing_unmet', 'missing_details', 'general_checkin',
];
const VALID_CHANNELS = ['email', 'sms', 'both'];

// GET /check-in-reminder-preferences
meRouter.get('/check-in-reminder-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: 'Authentication required' });

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) return res.status(400).json({ message: 'Invalid user identifier' });

    const allUsers = await storage.getAllUsers();
    const fullUser = allUsers.find((u) => normalizeToString(u.id) === normalizedUserId);
    if (!fullUser) return res.status(404).json({ message: 'User not found' });

    const preferences = getCheckInReminderPreferences(fullUser);
    res.json(preferences);
  } catch (error) {
    logger.error('Failed to fetch check-in reminder preferences', error);
    res.status(500).json({ message: 'Failed to fetch check-in reminder preferences' });
  }
});

// PUT /check-in-reminder-preferences
meRouter.put('/check-in-reminder-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: 'Authentication required' });

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) return res.status(400).json({ message: 'Invalid user identifier' });

    const { defaultChannel, rules } = req.body as CheckInReminderPreferences;

    if (!VALID_CHANNELS.includes(defaultChannel)) {
      return res.status(400).json({ message: 'Invalid channel' });
    }
    if (!Array.isArray(rules)) {
      return res.status(400).json({ message: 'rules must be an array' });
    }

    // Reject malformed input outright; normalizeCheckInReminderPreferences
    // then fills defaults and clamps values into range.
    for (const r of rules) {
      if (r === null || typeof r !== 'object' || !VALID_REMINDER_RULE_TYPES.includes(r.ruleType)) {
        return res.status(400).json({ message: 'rules contains invalid entries' });
      }
      if (r.thresholdDays !== undefined && (typeof r.thresholdDays !== 'number' || r.thresholdDays < 1 || r.thresholdDays > MAX_ALERT_DAYS)) {
        return res.status(400).json({ message: `Days must be between 1 and ${MAX_ALERT_DAYS}` });
      }
      if (r.ruleType === 'date_approaching_inprocess' && r.enabled === true) {
        if (normalizeCheckpointDays(r.checkpointDays).length === 0) {
          return res.status(400).json({ message: 'Pick at least one day for "Requested date coming up", or turn it off' });
        }
      }
    }

    const allUsers = await storage.getAllUsers();
    const fullUser = allUsers.find((u) => normalizeToString(u.id) === normalizedUserId);
    if (!fullUser) return res.status(404).json({ message: 'User not found' });

    const metadata = getUserMetadata(fullUser);
    const updatedPreferences: CheckInReminderPreferences = normalizeCheckInReminderPreferences({
      configured: true,
      defaultChannel,
      rules,
    });

    await storage.updateUser(normalizedUserId, {
      metadata: { ...metadata, checkInReminderPreferences: updatedPreferences },
    });

    // Old whole-event pauses (rule_type NULL) came from the retired per-event
    // reminder controls; clear them so the new settings take effect. Keep
    // per-alert snoozes: those are "remind me again in N days" clicks from
    // the daily email and should run their course.
    await db
      .update(eventReminderSnoozes)
      .set({ active: false, cancelledAt: new Date() })
      .where(and(
        eq(eventReminderSnoozes.userId, fullUser.id),
        eq(eventReminderSnoozes.active, true),
        isNull(eventReminderSnoozes.ruleType),
      ));

    // An alert turned off forgets what it sent, right now (not at the next
    // send, which may be tomorrow): turning it back on later starts fresh,
    // with a catch-up alert instead of resuming an old schedule.
    const disabledRules = updatedPreferences.rules.filter(r => !r.enabled).map(r => r.ruleType);
    if (disabledRules.length) {
      await db
        .delete(eventCheckInReminders)
        .where(and(eq(eventCheckInReminders.userId, fullUser.id), inArray(eventCheckInReminders.ruleType, disabledRules)));
    }

    logger.info(`Updated check-in reminder preferences for user ${normalizedUserId}`);
    res.json({ success: true, preferences: updatedPreferences });
  } catch (error) {
    logger.error('Failed to update check-in reminder preferences', error);
    res.status(500).json({ message: 'Failed to update check-in reminder preferences' });
  }
});

// ---------------------------------------------------------------------------
// SMS Campaign Preferences (user updating their own SMS notification types)
// ---------------------------------------------------------------------------

import { z } from 'zod';

const smsCampaignsSchema = z.object({
  campaignTypes: z.array(z.enum(['hosts', 'events'])).min(1, 'At least one campaign type is required'),
});

meRouter.patch('/sms-campaigns', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: 'Authentication required' });

    const normalizedUserId = normalizeToString(user.id);
    if (!normalizedUserId) return res.status(400).json({ message: 'Invalid user identifier' });

    const { campaignTypes } = smsCampaignsSchema.parse(req.body);

    const allUsers = await storage.getAllUsers();
    const fullUser = allUsers.find((u) => normalizeToString(u.id) === normalizedUserId);
    if (!fullUser) return res.status(404).json({ message: 'User not found' });

    const metadata = (fullUser.metadata as any) || {};
    const smsConsent = metadata.smsConsent || {};

    // Verify user has confirmed SMS opt-in
    // Accept various legacy data shapes: status='confirmed', enabled=true, or phoneNumber present with confirmed status
    const hasConfirmedStatus = smsConsent.status === 'confirmed';
    const hasEnabledFlag = smsConsent.enabled === true || smsConsent.enabled === 'true';
    const hasPhone = !!smsConsent.phoneNumber;
    const isConfirmed = hasConfirmedStatus || hasEnabledFlag || (hasPhone && smsConsent.status !== 'pending_confirmation');
    logger.info(`SMS campaigns update - user ${normalizedUserId}: status=${smsConsent.status}, enabled=${smsConsent.enabled}, phone=${hasPhone}, isConfirmed=${isConfirmed}`);
    if (!isConfirmed) {
      return res.status(400).json({
        error: 'You must first confirm SMS opt-in before updating campaign preferences',
      });
    }

    const updatedMetadata = {
      ...metadata,
      smsConsent: {
        ...smsConsent,
        campaignTypes: campaignTypes,
        campaignType: campaignTypes[0], // Keep legacy field in sync
        campaignsUpdatedAt: new Date().toISOString(),
      },
    };

    await storage.updateUser(normalizedUserId, { metadata: updatedMetadata });

    logger.info(`SMS campaign types updated for user ${normalizedUserId}: ${campaignTypes.join(', ')}`);

    res.json({
      success: true,
      message: 'SMS campaign preferences updated',
      campaignTypes: campaignTypes,
      hostsOptedIn: campaignTypes.includes('hosts'),
      eventsOptedIn: campaignTypes.includes('events'),
    });
  } catch (error) {
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request',
        details: (error as any).errors,
      });
    }
    logger.error('Failed to update SMS campaign preferences', error);
    res.status(500).json({ message: 'Failed to update SMS campaign preferences' });
  }
});

export default meRouter;