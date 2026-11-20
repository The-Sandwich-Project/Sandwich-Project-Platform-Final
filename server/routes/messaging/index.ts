import { Router } from 'express';
import { messagingService } from '../../services/messaging-service';
import { isAuthenticated } from '../../auth';
import { AuthenticatedRequest } from '../../types';
import { logger } from '../../utils/production-safe-logger';

const router = Router();

// Get all messages for the current user (inbox view)
router.get('/', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { contextType, limit = 50, offset = 0 } = req.query;

    const messages = await messagingService.getUnreadMessages(user.id, {
      contextType: contextType as string,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({ messages });
  } catch (error) {
    logger.error('[Messaging API] Error fetching messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// Get all messages (both read and unread) for inbox view
router.get('/all', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { contextType, limit = 50, offset = 0 } = req.query;

    const messages = await messagingService.getAllMessages(user.id, {
      contextType: contextType as string,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({ messages });
  } catch (error) {
    logger.error('[Messaging API] Error fetching all messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// Get messages by context (for viewing messages related to a specific event, project, etc.)
router.get('/context/:contextType/:contextId', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { contextType, contextId } = req.params;
    logger.log(`[Messaging API] Fetching messages for context: ${contextType}/${contextId}`);

    const messages = await messagingService.getContextMessages(contextType, contextId);

    logger.log(`[Messaging API] Found ${messages.length} messages for context: ${contextType}/${contextId}`);
    res.json({ messages });
  } catch (error) {
    logger.error('[Messaging API] Error fetching context messages:', error);
    logger.error(`[Messaging API] Context details - Type: ${req.params.contextType}, ID: ${req.params.contextId}`);
    res.status(500).json({ message: 'DATABASE_ERROR', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get replies to a message (thread view)
router.get('/:messageId/replies', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }

    const replies = await messagingService.getMessageReplies(messageId, user.id);

    res.json({ replies });
  } catch (error) {
    logger.error('[Messaging API] Error fetching message replies:', error);
    res.status(500).json({ message: 'Failed to fetch replies' });
  }
});

// Get full thread for a message (all ancestors and descendants)
router.get('/:messageId/thread', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }

    logger.log(`[Messaging API] Getting thread for message ${messageId}`);
    const threadMessages = await messagingService.getMessageThread(messageId, user.id);

    logger.log(`[Messaging API] Found ${threadMessages.length} messages in thread`);
    res.json({ thread: threadMessages });
  } catch (error) {
    logger.error('[Messaging API] Error fetching message thread:', error);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
});

export default router;
