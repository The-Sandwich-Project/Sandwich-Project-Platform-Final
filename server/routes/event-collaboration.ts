import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../utils/production-safe-logger';
import type { RouterDependencies } from '../types';
import { EmailNotificationService } from '../services/email-notification-service';
import { canAddFlag } from '../services/event-flags';

/**
 * Event Collaboration API Routes
 * 
 * Provides REST endpoints for:
 * - Comments on event requests
 * - Field locking for concurrent editing
 * - Edit revision history
 * 
 * These work in conjunction with Socket.IO real-time collaboration
 * 
 * Permission Requirements:
 * - All endpoints require authentication (isAuthenticated middleware)
 * - All endpoints require EVENT_REQUESTS_VIEW permission
 */

// Validation schemas
const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(5000),
  parentCommentId: z.number().optional(),
});

const updateCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(5000),
});

const acquireLockSchema = z.object({
  fieldName: z.string().min(1, 'Field name is required'),
  expiresInMinutes: z.number().min(1).max(30).optional().default(5),
});

const bulkCollaborationSchema = z.object({
  eventRequestIds: z.array(z.number()).min(1).max(100),
});

export function createEventCollaborationRouter(deps: RouterDependencies) {
  const router = Router();
  const { storage, requirePermission } = deps;

  // Note: Authentication is applied at mount time in server/routes/index.ts
  // Permissions are applied per-endpoint: VIEW for reads, EDIT for mutations

  // ============================================================================
  // BULK COLLABORATION ENDPOINT
  // ============================================================================

  /**
   * POST /api/event-requests/collaboration/bulk
   * Fetch collaboration data (comments and locks) for multiple event requests at once.
   * This reduces N+1 API calls when displaying lists of events.
   * Permission: EVENT_REQUESTS_VIEW
   */
  router.post('/collaboration/bulk', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    try {
      const validatedData = bulkCollaborationSchema.parse(req.body);
      const { eventRequestIds } = validatedData;

      // Check if bulk methods are available on storage (DatabaseStorage has them, MemStorage may not)
      const hasBulkMethods = typeof storage.getBulkEventCollaborationComments === 'function'
        && typeof storage.getBulkEventFieldLocks === 'function';

      let commentsMap: Map<number, any[]>;
      let locksMap: Map<number, any[]>;

      if (hasBulkMethods) {
        // Fetch comments and locks in parallel for all requested events
        [commentsMap, locksMap] = await Promise.all([
          storage.getBulkEventCollaborationComments(eventRequestIds),
          storage.getBulkEventFieldLocks(eventRequestIds),
        ]);
      } else {
        // Fallback: return empty maps if bulk methods aren't available
        commentsMap = new Map();
        locksMap = new Map();
        eventRequestIds.forEach(id => {
          commentsMap.set(id, []);
          locksMap.set(id, []);
        });
      }

      // Build response object with event ID as key
      const result: Record<number, { comments: any[]; locks: any[] }> = {};

      for (const eventId of eventRequestIds) {
        result[eventId] = {
          comments: commentsMap.get(eventId) || [],
          locks: locksMap.get(eventId) || [],
        };
      }

      res.json({ data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      logger.error('[Event Collaboration] Error fetching bulk collaboration data:', error);
      // Return empty result instead of 500 to prevent UI from breaking
      const result: Record<number, { comments: any[]; locks: any[] }> = {};
      try {
        const ids = req.body?.eventRequestIds || [];
        for (const eventId of ids) {
          result[eventId] = { comments: [], locks: [] };
        }
      } catch {}
      res.json({ data: result });
    }
  });

  // ============================================================================
  // COMMENTS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/event-requests/:id/collaboration/comments
   * Get all comments for an event request
   * Permission: EVENT_REQUESTS_VIEW
   */
  router.get('/:id/collaboration/comments', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const comments = await storage.getEventCollaborationComments(eventId);

      res.json({ comments });
    } catch (error) {
      // Return empty array if collaboration tables don't exist yet
      if (error instanceof Error && (error.message.includes('does not exist') || error.message.includes('relation'))) {
        return res.json({ comments: [] });
      }
      logger.error('[Event Collaboration] Error fetching comments:', error);
      res.status(500).json({
        error: 'Failed to fetch comments',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/event-requests/:id/collaboration/comments
   * Create a new comment on an event request
   * Permission: EVENT_REQUESTS_EDIT
   */
  router.post('/:id/collaboration/comments', requirePermission('EVENT_REQUESTS_EDIT'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check if event request exists before trying to create comment
      const eventExists = await storage.getEventRequestById(eventId);
      if (!eventExists) {
        return res.status(404).json({ 
          error: 'Event request not found',
          details: `Event request with ID ${eventId} does not exist`
        });
      }

      // "Team Comments" was retired: the thread is New Event Flags, which can
      // only be added while the event is New. Earlier comments on other events
      // stay visible, read-only.
      if (!canAddFlag(eventExists.status)) {
        return res.status(409).json({
          error: 'Flags can only be added while an event is New',
          details: 'Team comments were retired. Use the event notes or Log Contact instead.',
        });
      }

      const validatedData = createCommentSchema.parse(req.body);

      const comment = await storage.createEventCollaborationComment({
        eventRequestId: eventId,
        userId: req.user.id,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Unknown User',
        content: validatedData.content,
        parentCommentId: validatedData.parentCommentId,
      });

      // Send email notification to TSP contacts (async, don't block response)
      const commenterFirstName = req.user.firstName || req.user.email?.split('@')[0] || 'Someone';
      EmailNotificationService.sendEventCommentNotification(
        eventId,
        commenterFirstName,
        req.user.id,
        validatedData.content,
        new Date(),
        validatedData.parentCommentId
      ).catch(err => {
        logger.error('[Event Collaboration] Error sending comment notification:', err);
      });

      res.status(201).json({ comment });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: error.errors 
        });
      }
      
      // Check for database constraint violations
      if (error instanceof Error) {
        if (error.message.includes('foreign key') || error.message.includes('violates')) {
          logger.error('[Event Collaboration] Foreign key constraint violation:', error);
          return res.status(400).json({ 
            error: 'Invalid reference',
            details: 'The event request or user referenced does not exist'
          });
        }
      }
      
      logger.error('[Event Collaboration] Error creating comment:', error);
      res.status(500).json({ 
        error: 'Failed to create comment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PATCH /api/event-requests/:id/collaboration/comments/:commentId
   * Edit an existing comment
   * Permission: EVENT_REQUESTS_EDIT
   */
  router.patch('/:id/collaboration/comments/:commentId', requirePermission('EVENT_REQUESTS_EDIT'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      const commentId = parseInt(req.params.commentId, 10);
      
      if (isNaN(eventId) || isNaN(commentId)) {
        return res.status(400).json({ error: 'Invalid event or comment ID' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const validatedData = updateCommentSchema.parse(req.body);

      const comment = await storage.updateEventCollaborationComment(
        commentId,
        validatedData.content,
        req.user.id
      );

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found or unauthorized' });
      }

      res.json({ comment });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: error.errors 
        });
      }
      
      logger.error('[Event Collaboration] Error updating comment:', error);
      res.status(500).json({ 
        error: 'Failed to update comment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/event-requests/:id/collaboration/comments/:commentId
   * Delete a comment (user can only delete their own)
   * Permission: EVENT_REQUESTS_EDIT
   */
  router.delete('/:id/collaboration/comments/:commentId', requirePermission('EVENT_REQUESTS_EDIT'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      const commentId = parseInt(req.params.commentId, 10);

      if (isNaN(eventId) || isNaN(commentId)) {
        return res.status(400).json({ error: 'Invalid event or comment ID' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const success = await storage.deleteEventCollaborationComment(commentId, req.user.id);

      if (!success) {
        return res.status(404).json({ error: 'Comment not found or unauthorized' });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('[Event Collaboration] Error deleting comment:', error);
      res.status(500).json({
        error: 'Failed to delete comment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================================================
  // COMMENT LIKES ENDPOINTS
  // ============================================================================

  /**
   * GET /api/event-requests/:id/collaboration/comments/:commentId/likes
   * Get all likes for a comment
   * Permission: EVENT_REQUESTS_VIEW
   * Note: Likes feature not fully implemented - returns empty array
   */
  router.get('/:id/collaboration/comments/:commentId/likes', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    // Likes feature not implemented - return empty array to prevent 500 errors
    res.json({ likes: [] });
  });

  /**
   * POST /api/event-requests/:id/collaboration/comments/:commentId/likes
   * Like a comment (toggle: if already liked, unlike it)
   * Permission: EVENT_REQUESTS_VIEW
   * Note: Likes feature not fully implemented - returns success with no-op
   */
  router.post('/:id/collaboration/comments/:commentId/likes', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    // Likes feature not implemented - return success with liked: true as no-op
    res.json({ liked: true, likes: [] });
  });

  // ============================================================================
  // FIELD LOCKS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/event-requests/:id/collaboration/locks
   * Get all active field locks for an event request
   * Permission: EVENT_REQUESTS_VIEW
   */
  router.get('/:id/collaboration/locks', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const locks = await storage.getEventFieldLocks(eventId);

      res.json({ locks });
    } catch (error) {
      // Return empty array if collaboration tables don't exist yet
      if (error instanceof Error && (error.message.includes('does not exist') || error.message.includes('relation'))) {
        return res.json({ locks: [] });
      }
      logger.error('[Event Collaboration] Error fetching locks:', error);
      res.status(500).json({
        error: 'Failed to fetch locks',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/event-requests/:id/collaboration/locks
   * Acquire or extend a field lock
   * Permission: EVENT_REQUESTS_EDIT
   */
  router.post('/:id/collaboration/locks', requirePermission('EVENT_REQUESTS_EDIT'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const validatedData = acquireLockSchema.parse(req.body);
      
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + validatedData.expiresInMinutes);

      const lock = await storage.acquireEventFieldLock({
        eventRequestId: eventId,
        fieldName: validatedData.fieldName,
        lockedBy: req.user.id,
        lockedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Unknown User',
        expiresAt,
      });

      res.json({ lock });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Validation failed',
          details: error.errors 
        });
      }
      
      logger.error('[Event Collaboration] Error acquiring lock:', error);
      res.status(500).json({ 
        error: 'Failed to acquire lock',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/event-requests/:id/collaboration/locks/:fieldName
   * Release a field lock
   * Permission: EVENT_REQUESTS_EDIT
   */
  router.delete('/:id/collaboration/locks/:fieldName', requirePermission('EVENT_REQUESTS_EDIT'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      const fieldName = req.params.fieldName;

      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const success = await storage.releaseEventFieldLock(eventId, fieldName, req.user.id);

      if (!success) {
        return res.status(404).json({ error: 'Lock not found or unauthorized' });
      }

      res.json({ success: true });
    } catch (error) {
      // Return success if collaboration tables don't exist yet (lock can't exist anyway)
      if (error instanceof Error && (error.message.includes('does not exist') || error.message.includes('relation'))) {
        return res.json({ success: true });
      }
      logger.error('[Event Collaboration] Error releasing lock:', error);
      res.status(500).json({
        error: 'Failed to release lock',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================================================
  // EDIT REVISIONS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/event-requests/:id/collaboration/revisions
   * Get all edit revisions for an event request
   * Permission: EVENT_REQUESTS_VIEW
   */
  router.get('/:id/collaboration/revisions', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const revisions = await storage.getEventEditRevisions(eventId, limit, offset);
      
      res.json({ revisions });
    } catch (error) {
      logger.error('[Event Collaboration] Error fetching revisions:', error);
      res.status(500).json({ 
        error: 'Failed to fetch revisions',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/event-requests/:id/collaboration/revisions/:fieldName
   * Get edit revision history for a specific field
   * Permission: EVENT_REQUESTS_VIEW
   */
  router.get('/:id/collaboration/revisions/:fieldName', requirePermission('EVENT_REQUESTS_VIEW'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id, 10);
      const fieldName = req.params.fieldName;
      
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const revisions = await storage.getEventFieldRevisions(
        eventId,
        fieldName,
        limit,
        offset
      );
      
      res.json({ revisions });
    } catch (error) {
      logger.error('[Event Collaboration] Error fetching field revisions:', error);
      res.status(500).json({ 
        error: 'Failed to fetch field revisions',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}
