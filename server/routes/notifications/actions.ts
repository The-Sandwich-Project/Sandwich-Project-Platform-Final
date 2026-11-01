import { storage } from '../../storage-wrapper';
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import {
  notifications,
  notificationActionHistory,
  eventRequests,
  projectTasks,
  projects,
  messages,
  emailMessages,
} from '../../../shared/schema';
import { createStandardMiddleware } from '../../middleware';
import { logger } from '../../utils/production-safe-logger';
import { getSocketInstance } from '../../socket-chat';
import { getLinkedUserIds } from '../../lib/linked-accounts';

const actionsRouter = Router();

// Apply standard middleware (authentication, logging, etc.)
actionsRouter.use(createStandardMiddleware());

// Action handler for event requests
async function handleEventRequestAction(
  eventId: number,
  actionType: string,
  userId: string,
  actionData?: any
) {
  logger.info(`Handling event request action: ${actionType} for event ${eventId}`);

  const [event] = await db
    .select()
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId));

  if (!event) {
    throw new Error('Event request not found');
  }

  let newStatus: string;
  let result: any = {};

  switch (actionType) {
    case 'approve':
    case 'accept':
      newStatus = 'scheduled';
      result = await db
        .update(eventRequests)
        .set({
          status: newStatus,
          updatedAt: new Date()
        })
        .where(eq(eventRequests.id, eventId))
        .returning();
      break;

    case 'decline':
    case 'reject':
      newStatus = 'declined';
      result = await db
        .update(eventRequests)
        .set({
          status: newStatus,
          updatedAt: new Date()
        })
        .where(eq(eventRequests.id, eventId))
        .returning();
      break;

    case 'assign_tsp_contact':
      if (!actionData?.tspContactId) {
        throw new Error('TSP contact ID required');
      }
      result = [await storage.updateEventRequest(eventId, {
        tspContact: actionData.tspContactId,
        tspContactAssignedDate: new Date(),
      })];
      break;

    case 'mark_toolkit_sent':
      result = await db
        .update(eventRequests)
        .set({
          toolkitSent: true,
          toolkitStatus: 'sent',
          toolkitSentDate: new Date(),
          toolkitSentBy: userId,
          updatedAt: new Date()
        })
        .where(eq(eventRequests.id, eventId))
        .returning();
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  return {
    success: true,
    event: result[0],
    message: `Event request ${actionType} successful`
  };
}

// Action handler for tasks
async function handleTaskAction(
  taskId: number,
  actionType: string,
  userId: string,
  actionData?: any
) {
  logger.info(`Handling task action: ${actionType} for task ${taskId}`);

  const [task] = await db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId));

  if (!task) {
    throw new Error('Task not found');
  }

  let result: any = {};

  switch (actionType) {
    case 'mark_complete':
    case 'complete':
      result = await db
        .update(projectTasks)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(projectTasks.id, taskId))
        .returning();
      break;

    case 'assign':
      if (!actionData?.assigneeId) {
        throw new Error('Assignee ID required');
      }
      // projectTasks uses assigneeIds (text array) for multiple assignees
      const currentAssigneeIds = task.assigneeIds || [];
      const newAssigneeIds = Array.isArray(currentAssigneeIds)
        ? [...currentAssigneeIds, actionData.assigneeId]
        : [actionData.assigneeId];

      // Also update assigneeNames if provided
      const updateData: any = {
        assigneeIds: newAssigneeIds,
        updatedAt: new Date()
      };

      if (actionData.assigneeName) {
        const currentNames = task.assigneeNames || [];
        updateData.assigneeNames = Array.isArray(currentNames)
          ? [...currentNames, actionData.assigneeName]
          : [actionData.assigneeName];
      }

      result = await db
        .update(projectTasks)
        .set(updateData)
        .where(eq(projectTasks.id, taskId))
        .returning();
      break;

    case 'start':
      result = await db
        .update(projectTasks)
        .set({
          status: 'in_progress',
          updatedAt: new Date()
        })
        .where(eq(projectTasks.id, taskId))
        .returning();
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  return {
    success: true,
    task: result[0],
    message: `Task ${actionType} successful`
  };
}

// Action handler for projects
async function handleProjectAction(
  projectId: number,
  actionType: string,
  userId: string,
  actionData?: any
) {
  logger.info(`Handling project action: ${actionType} for project ${projectId}`);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) {
    throw new Error('Project not found');
  }

  let result: any = {};

  switch (actionType) {
    case 'mark_complete':
    case 'complete':
      result = await db
        .update(projects)
        .set({
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))
        .returning();
      break;

    case 'assign':
      if (!actionData?.assigneeId) {
        throw new Error('Assignee ID required');
      }
      // projects uses assigneeIds (jsonb) for multiple assignees
      const currentProjectAssignees = project.assigneeIds || [];
      const newProjectAssignees = Array.isArray(currentProjectAssignees)
        ? [...currentProjectAssignees, actionData.assigneeId]
        : [actionData.assigneeId];

      // Also update assigneeNames if provided (comma-separated string)
      const projectUpdateData: any = {
        assigneeIds: newProjectAssignees,
        updatedAt: new Date()
      };

      if (actionData.assigneeName) {
        const currentNamesStr = project.assigneeNames || '';
        const namesList = currentNamesStr ? currentNamesStr.split(',').map(n => n.trim()) : [];
        namesList.push(actionData.assigneeName);
        projectUpdateData.assigneeNames = namesList.join(', ');
      }

      result = await db
        .update(projects)
        .set(projectUpdateData)
        .where(eq(projects.id, projectId))
        .returning();
      break;

    case 'start':
      result = await db
        .update(projects)
        .set({
          status: 'in_progress',
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))
        .returning();
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  return {
    success: true,
    project: result[0],
    message: `Project ${actionType} successful`
  };
}

// Action handler for messages (in-app chat messages)
async function handleMessageAction(
  messageId: number,
  actionType: string,
  userId: string,
  actionData?: any
) {
  logger.info(`Handling message action: ${actionType} for message ${messageId}`);

  const [message] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId));

  if (!message) {
    throw new Error('Message not found');
  }

  let result: any = {};

  switch (actionType) {
    case 'mark_read':
    case 'read':
      result = await db
        .update(messages)
        .set({
          read: true,
          updatedAt: new Date()
        })
        .where(eq(messages.id, messageId))
        .returning();
      break;

    case 'reply':
      // For reply action, just return message details
      // The actual reply will be handled by the messaging system
      result = { message, redirectTo: `/messages?reply=${messageId}` };
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  return {
    success: true,
    result: result,
    redirectTo: result.redirectTo,
    message: `Message ${actionType} successful`
  };
}

// Action handler for email messages
async function handleEmailMessageAction(
  emailId: number,
  actionType: string,
  userId: string,
  actionData?: any
) {
  logger.info(`Handling email message action: ${actionType} for email ${emailId}`);

  const [email] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, emailId));

  if (!email) {
    throw new Error('Email message not found');
  }

  // Verify user (or a linked account) is sender or recipient
  const linkedIds = await getLinkedUserIds(userId);
  if (!linkedIds.includes(email.senderId) && !linkedIds.includes(email.recipientId)) {
    throw new Error('Not authorized to perform this action');
  }

  let result: any = {};

  switch (actionType) {
    case 'mark_read':
    case 'read':
      result = await db
        .update(emailMessages)
        .set({
          isRead: true,
          readAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(emailMessages.id, emailId))
        .returning();
      break;

    case 'archive':
      result = await db
        .update(emailMessages)
        .set({
          isArchived: true,
          updatedAt: new Date()
        })
        .where(eq(emailMessages.id, emailId))
        .returning();
      break;

    case 'mark_spam':
    case 'spam':
      result = await db
        .update(emailMessages)
        .set({
          isTrashed: true,
          updatedAt: new Date()
        })
        .where(eq(emailMessages.id, emailId))
        .returning();
      break;

    case 'star':
      result = await db
        .update(emailMessages)
        .set({
          isStarred: true,
          updatedAt: new Date()
        })
        .where(eq(emailMessages.id, emailId))
        .returning();
      break;

    case 'unstar':
      result = await db
        .update(emailMessages)
        .set({
          isStarred: false,
          updatedAt: new Date()
        })
        .where(eq(emailMessages.id, emailId))
        .returning();
      break;

    case 'reply':
      // For reply action, return email details and redirect URL
      result = { email, redirectTo: `/email?reply=${emailId}` };
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  return {
    success: true,
    email: result,
    redirectTo: result.redirectTo,
    message: `Email ${actionType} successful`
  };
}

// Execute action from notification
actionsRouter.post('/:id/actions/:actionType', async (req, res) => {
  try {
    const { id, actionType } = req.params;
    const { actionData } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.info(`Action request: notification ${id}, action ${actionType}, user ${userId}`);

    // Fetch notification
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, parseInt(id)));

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Verify notification belongs to user (or a linked account)
    const linkedIds = await getLinkedUserIds(userId);
    if (!linkedIds.includes(notification.userId)) {
      return res.status(403).json({ error: 'Forbidden: Not your notification' });
    }

    // Create action history record
    const [actionHistory] = await db
      .insert(notificationActionHistory)
      .values({
        notificationId: notification.id,
        userId,
        actionType,
        actionStatus: 'pending',
        relatedType: notification.relatedType || null,
        relatedId: notification.relatedId || null,
        metadata: actionData || {},
      })
      .returning();

    let actionResult: any;

    try {
      // Execute action based on related entity type
      switch (notification.relatedType) {
        case 'event_request':
          if (!notification.relatedId) {
            throw new Error('No related event request ID');
          }
          actionResult = await handleEventRequestAction(
            notification.relatedId,
            actionType,
            userId,
            actionData
          );
          break;

        case 'task':
          if (!notification.relatedId) {
            throw new Error('No related task ID');
          }
          actionResult = await handleTaskAction(
            notification.relatedId,
            actionType,
            userId,
            actionData
          );
          break;

        case 'project':
          if (!notification.relatedId) {
            throw new Error('No related project ID');
          }
          actionResult = await handleProjectAction(
            notification.relatedId,
            actionType,
            userId,
            actionData
          );
          break;

        case 'message':
          if (!notification.relatedId) {
            throw new Error('No related message ID');
          }
          actionResult = await handleMessageAction(
            notification.relatedId,
            actionType,
            userId,
            actionData
          );
          break;

        case 'email_message':
          if (!notification.relatedId) {
            throw new Error('No related email message ID');
          }
          actionResult = await handleEmailMessageAction(
            notification.relatedId,
            actionType,
            userId,
            actionData
          );
          break;

        default:
          throw new Error(`Unsupported relatedType: ${notification.relatedType}`);
      }

      // Update action history to success
      await db
        .update(notificationActionHistory)
        .set({
          actionStatus: 'success',
          completedAt: new Date(),
          metadata: { ...actionData, result: actionResult },
        })
        .where(eq(notificationActionHistory.id, actionHistory.id));

      // Mark notification as read
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notification.id));

      // No need to track a separate 'clicked' event - we already have the action history above

      logger.info(`Action successful: ${actionType} on notification ${id}`);

      // Emit Socket.IO event for real-time updates
      const io = getSocketInstance();
      if (io) {
        // Broadcast to the user's notification channel
        io.to(`notifications:${userId}`).emit('notification-action-completed', {
          notificationId: notification.id,
          actionType,
          actionStatus: 'success',
          userId,
          result: actionResult,
        });

        logger.info(`Socket.IO event emitted to notifications:${userId}`);
      }

      res.json({
        success: true,
        result: actionResult,
        notification: { ...notification, isRead: true },
        actionHistory,
      });
    } catch (error: any) {
      // Update action history to failed
      await db
        .update(notificationActionHistory)
        .set({
          actionStatus: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
        })
        .where(eq(notificationActionHistory.id, actionHistory.id));

      logger.error(`Action failed: ${actionType} on notification ${id}`, error);
      throw error;
    }
  } catch (error: any) {
    logger.error('Error executing notification action:', error);
    res.status(500).json({
      error: 'Failed to execute action',
      message: error.message
    });
  }
});

// Get action history for a notification
actionsRouter.get('/:id/action-history', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify notification belongs to user (or a linked account)
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, parseInt(id)));

    const linkedIds = await getLinkedUserIds(userId);
    if (!notification || !linkedIds.includes(notification.userId)) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Get action history
    const history = await db
      .select()
      .from(notificationActionHistory)
      .where(eq(notificationActionHistory.notificationId, parseInt(id)))
      .orderBy(notificationActionHistory.startedAt);

    res.json({ history });
  } catch (error) {
    logger.error('Error fetching action history:', error);
    res.status(500).json({ error: 'Failed to fetch action history' });
  }
});

// Undo a notification action
actionsRouter.post('/:id/actions/:actionHistoryId/undo', async (req, res) => {
  try {
    const { id, actionHistoryId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.info(`Undo request: notification ${id}, actionHistory ${actionHistoryId}, user ${userId}`);

    // Fetch the action history record
    const [actionHistory] = await db
      .select()
      .from(notificationActionHistory)
      .where(eq(notificationActionHistory.id, parseInt(actionHistoryId)));

    if (!actionHistory) {
      return res.status(404).json({ error: 'Action history not found' });
    }

    // Verify action belongs to user (or a linked account)
    const linkedIds = await getLinkedUserIds(userId);
    if (!linkedIds.includes(actionHistory.userId)) {
      return res.status(403).json({ error: 'Forbidden: Not your action' });
    }

    // Check if already undone
    if (actionHistory.undoneAt) {
      return res.status(400).json({ error: 'Action already undone' });
    }

    // Check if action was successful
    if (actionHistory.actionStatus !== 'success') {
      return res.status(400).json({ error: 'Can only undo successful actions' });
    }

    // Perform undo based on related type and action
    let undoResult: any;
    const { relatedType, relatedId, actionType } = actionHistory;

    try {
      switch (relatedType) {
        case 'event_request':
          if (!relatedId) throw new Error('No related event request ID');

          // Reverse the action
          if (actionType === 'approve' || actionType === 'accept') {
            // Revert to previous status (would need to store in metadata)
            undoResult = await db
              .update(eventRequests)
              .set({ status: 'new', updatedAt: new Date() })
              .where(eq(eventRequests.id, relatedId))
              .returning();
          } else if (actionType === 'decline' || actionType === 'reject') {
            undoResult = await db
              .update(eventRequests)
              .set({ status: 'new', updatedAt: new Date() })
              .where(eq(eventRequests.id, relatedId))
              .returning();
          } else if (actionType === 'mark_toolkit_sent') {
            undoResult = await db
              .update(eventRequests)
              .set({
                toolkitSent: false,
                toolkitStatus: 'not_sent',
                updatedAt: new Date()
              })
              .where(eq(eventRequests.id, relatedId))
              .returning();
          }
          break;

        case 'task':
          if (!relatedId) throw new Error('No related task ID');

          if (actionType === 'mark_complete' || actionType === 'complete') {
            undoResult = await db
              .update(projectTasks)
              .set({
                status: 'pending',
                completedAt: null,
                updatedAt: new Date()
              })
              .where(eq(projectTasks.id, relatedId))
              .returning();
          } else if (actionType === 'start') {
            undoResult = await db
              .update(projectTasks)
              .set({
                status: 'pending',
                updatedAt: new Date()
              })
              .where(eq(projectTasks.id, relatedId))
              .returning();
          }
          break;

        case 'project':
          if (!relatedId) throw new Error('No related project ID');

          if (actionType === 'mark_complete' || actionType === 'complete') {
            undoResult = await db
              .update(projects)
              .set({
                status: 'in_progress',
                updatedAt: new Date()
              })
              .where(eq(projects.id, relatedId))
              .returning();
          } else if (actionType === 'start') {
            undoResult = await db
              .update(projects)
              .set({
                status: 'waiting',
                updatedAt: new Date()
              })
              .where(eq(projects.id, relatedId))
              .returning();
          }
          break;

        case 'message':
          if (!relatedId) throw new Error('No related message ID');

          if (actionType === 'mark_read' || actionType === 'read') {
            undoResult = await db
              .update(messages)
              .set({
                read: false,
                updatedAt: new Date()
              })
              .where(eq(messages.id, relatedId))
              .returning();
          }
          break;

        case 'email_message':
          if (!relatedId) throw new Error('No related email message ID');

          if (actionType === 'mark_read' || actionType === 'read') {
            undoResult = await db
              .update(emailMessages)
              .set({
                isRead: false,
                readAt: null,
                updatedAt: new Date()
              })
              .where(eq(emailMessages.id, relatedId))
              .returning();
          } else if (actionType === 'archive') {
            undoResult = await db
              .update(emailMessages)
              .set({
                isArchived: false,
                updatedAt: new Date()
              })
              .where(eq(emailMessages.id, relatedId))
              .returning();
          } else if (actionType === 'star') {
            undoResult = await db
              .update(emailMessages)
              .set({
                isStarred: false,
                updatedAt: new Date()
              })
              .where(eq(emailMessages.id, relatedId))
              .returning();
          }
          break;

        default:
          throw new Error(`Undo not supported for relatedType: ${relatedType}`);
      }

      // Mark action as undone
      await db
        .update(notificationActionHistory)
        .set({
          undoneAt: new Date(),
          undoneBy: userId,
        })
        .where(eq(notificationActionHistory.id, actionHistory.id));

      logger.info(`Action undone successfully: ${actionType} on ${relatedType} ${relatedId}`);

      // Emit Socket.IO event
      const io = getSocketInstance();
      if (io) {
        io.to(`notifications:${userId}`).emit('notification-action-undone', {
          notificationId: parseInt(id),
          actionHistoryId: actionHistory.id,
          actionType,
          userId,
          result: undoResult,
        });
      }

      res.json({
        success: true,
        message: 'Action undone successfully',
        result: undoResult,
      });
    } catch (error: any) {
      logger.error(`Undo failed for action ${actionHistoryId}:`, error);
      res.status(500).json({
        error: 'Failed to undo action',
        message: error.message,
      });
    }
  } catch (error: any) {
    logger.error('Error undoing action:', error);
    res.status(500).json({
      error: 'Failed to process undo request',
      message: error.message,
    });
  }
});

export { actionsRouter };
