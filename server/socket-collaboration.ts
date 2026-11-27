import { Server as SocketServer, Socket, Namespace } from 'socket.io';
import { Server as HttpServer } from 'http';
import { storage } from './storage';
import { logger } from './utils/production-safe-logger';
import { z } from 'zod';
import { AuditLogger } from './audit-logger';
import { extractMentions } from '@shared/mention-utils';
import { checkPermission } from '@shared/unified-auth-utils';
import { canWriteFlags, FLAGS_READ_ONLY_ERROR, loadCommentEvent } from './services/event-flags';

/**
 * Event Collaboration Socket.IO Module
 * Handles real-time multi-user editing of event requests with:
 * - Event-scoped rooms
 * - Presence tracking
 * - Field-level locking with auto-expiration
 * - Optimistic concurrency control
 * - Real-time comments
 * - Authentication and authorization checks
 */

// ==================== Socket Authentication Interface ====================

interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: string;
      email: string;
      firstName?: string;
      lastName?: string;
      displayName?: string;
      role?: string;
      permissions?: Record<string, boolean>;
      isActive: boolean;
    };
  };
}

// ==================== Types ====================

interface PresenceMeta {
  userId: string;
  userName: string;
  joinedAt: Date;
  lastHeartbeat: Date;
  socketId: string;
}

interface FieldLockInfo {
  fieldName: string;
  lockedBy: string;
  lockedByName: string;
  expiresAt: Date;
}

interface FieldUpdatePayload {
  fieldName: string;
  value: any;
  updatedAt: Date;
  updatedBy: string;
  updatedByName: string;
}

interface EventState {
  eventRequestId: number;
  version: Date;
  activeLocks: FieldLockInfo[];
  activeUsers: PresenceMeta[];
}

interface ActivityPayload {
  id: string;
  type: 'status_change' | 'field_update' | 'comment' | 'assignment' | 'join' | 'leave';
  userId: string;
  userName: string;
  description: string;
  details?: string;
  timestamp: Date;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
}

// ==================== Validation Schemas ====================

const JoinEventSchema = z.object({
  eventRequestId: z.number(),
  userId: z.string(),
  userName: z.string(),
});

const AcquireLockSchema = z.object({
  eventRequestId: z.number(),
  fieldName: z.string(),
  userId: z.string(),
  userName: z.string(),
});

const ReleaseLockSchema = z.object({
  eventRequestId: z.number(),
  fieldName: z.string(),
});

const FieldUpdateSchema = z.object({
  eventRequestId: z.number(),
  fieldName: z.string(),
  value: z.any(),
  expectedVersion: z.string(),
  userId: z.string(),
  userName: z.string(),
});

const CreateCommentSchema = z.object({
  eventRequestId: z.number(),
  userId: z.string(),
  userName: z.string(),
  content: z.string(),
  parentCommentId: z.number().optional(),
});

const HeartbeatSchema = z.object({
  eventRequestId: z.number(),
  userId: z.string(),
});

// ==================== In-Memory State ====================

// Map of eventId -> Map of userId -> PresenceMeta
const presenceByEvent = new Map<number, Map<string, PresenceMeta>>();

// Map of socketId -> set of eventIds the socket is subscribed to
const socketEventSubscriptions = new Map<string, Set<number>>();

// Module-level variable to store collaboration namespace
let collaborationNamespace: Namespace | null = null;

/**
 * Get the collaboration namespace instance (for emitting events from routes)
 */
export function getCollaborationNamespace(): Namespace | null {
  return collaborationNamespace;
}

// ==================== Helper Functions ====================

function getRoomName(eventRequestId: number): string {
  return `event:${eventRequestId}`;
}

function getLocksRoomName(eventRequestId: number): string {
  return `locks:${eventRequestId}`;
}

function getCommentsRoomName(eventRequestId: number): string {
  return `comments:${eventRequestId}`;
}

/**
 * Get active presence for an event
 */
function getEventPresence(eventRequestId: number): PresenceMeta[] {
  const presenceMap = presenceByEvent.get(eventRequestId);
  if (!presenceMap) return [];
  return Array.from(presenceMap.values());
}

/**
 * Add user to presence tracking
 */
function addPresence(
  eventRequestId: number,
  userId: string,
  userName: string,
  socketId: string
): void {
  if (!presenceByEvent.has(eventRequestId)) {
    presenceByEvent.set(eventRequestId, new Map());
  }
  const presenceMap = presenceByEvent.get(eventRequestId)!;
  presenceMap.set(userId, {
    userId,
    userName,
    joinedAt: new Date(),
    lastHeartbeat: new Date(),
    socketId,
  });
}

/**
 * Remove user from presence tracking
 */
function removePresence(eventRequestId: number, userId: string): void {
  const presenceMap = presenceByEvent.get(eventRequestId);
  if (presenceMap) {
    presenceMap.delete(userId);
    if (presenceMap.size === 0) {
      presenceByEvent.delete(eventRequestId);
    }
  }
}

/**
 * Update heartbeat for a user
 */
function updateHeartbeat(eventRequestId: number, userId: string): void {
  const presenceMap = presenceByEvent.get(eventRequestId);
  if (presenceMap) {
    const presence = presenceMap.get(userId);
    if (presence) {
      presence.lastHeartbeat = new Date();
    }
  }
}

/**
 * Remove stale presence entries (no heartbeat in last 60 seconds)
 */
async function cleanupStalePresence(): Promise<void> {
  const now = Date.now();
  const staleThreshold = 60 * 1000; // 60 seconds

  for (const [eventId, presenceMap] of presenceByEvent.entries()) {
    const staleUsers: string[] = [];
    
    for (const [userId, presence] of presenceMap.entries()) {
      const timeSinceHeartbeat = now - presence.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > staleThreshold) {
        logger.log(
          `Removing stale presence for user ${userId} in event ${eventId}`
        );
        staleUsers.push(userId);
      }
    }

    for (const userId of staleUsers) {
      await releaseUserLocks(eventId, userId);
      presenceMap.delete(userId);
    }

    if (staleUsers.length > 0 && collaborationNamespace) {
      collaborationNamespace
        .to(getRoomName(eventId))
        .emit('presence-updated', {
          eventRequestId: eventId,
          activeUsers: Array.from(presenceMap.values()),
        });
    }

    if (presenceMap.size === 0) {
      presenceByEvent.delete(eventId);
    }
  }
}

/**
 * Get initial event state for a newly joined user
 */
async function getInitialEventState(
  eventRequestId: number
): Promise<EventState | null> {
  try {
    // Get event to retrieve current version
    const event = await storage.getEventRequest(eventRequestId);
    if (!event) return null;

    // Get active locks (storage filters by expiration)
    const activeLocks = await storage.getEventFieldLocks(eventRequestId);

    // Get active presence
    const activeUsers = getEventPresence(eventRequestId);

    return {
      eventRequestId,
      version: event.updatedAt,
      activeLocks: activeLocks.map((lock) => ({
        fieldName: lock.fieldName,
        lockedBy: lock.lockedBy,
        lockedByName: lock.lockedByName,
        expiresAt: lock.expiresAt,
      })),
      activeUsers,
    };
  } catch (error) {
    logger.error('Error getting initial event state:', error);
    return null;
  }
}

/**
 * Release all locks held by a user in an event
 */
async function releaseUserLocks(
  eventRequestId: number,
  userId: string
): Promise<void> {
  try {
    const locks = await storage.getEventFieldLocks(eventRequestId);
    const userLocks = locks.filter((lock) => lock.lockedBy === userId);

    for (const lock of userLocks) {
      await storage.deleteEventFieldLock(eventRequestId, lock.fieldName);
      logger.log(
        `Released lock on ${lock.fieldName} for user ${userId} in event ${eventRequestId}`
      );
    }

    // Broadcast lock release
    if (collaborationNamespace && userLocks.length > 0) {
      collaborationNamespace.to(getLocksRoomName(eventRequestId)).emit('locks-updated', {
        eventRequestId,
        activeLocks: await storage.getEventFieldLocks(eventRequestId),
      });
    }
  } catch (error) {
    logger.error('Error releasing user locks:', error);
  }
}

/**
 * Broadcast activity update to all users in an event room
 * Used to track team activity like status changes, assignments, etc.
 */
function broadcastActivity(
  eventRequestId: number,
  activity: Omit<ActivityPayload, 'id' | 'timestamp'>
): void {
  if (!collaborationNamespace) return;

  const activityPayload: ActivityPayload = {
    ...activity,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
  };

  collaborationNamespace.to(getRoomName(eventRequestId)).emit('activity-update', {
    eventRequestId,
    resourceId: eventRequestId,
    activity: activityPayload,
  });

  logger.log(`[Activity] ${activity.type}: ${activity.description} (Event ${eventRequestId})`);
}

/**
 * Format field name for display in activity feed
 */
function formatFieldName(fieldName: string): string {
  const fieldLabels: Record<string, string> = {
    status: 'status',
    assignedToId: 'assignment',
    assignedToIds: 'team assignments',
    scheduledDate: 'event date',
    scheduledTime: 'event time',
    scheduledEventDate: 'event date',
    eventStartTime: 'event time',
    organizationName: 'organization name',
    contactName: 'contact name',
    contactEmail: 'email',
    contactPhone: 'phone',
    eventType: 'event type',
    estimatedAttendees: 'estimated attendees',
    expectedSandwiches: 'expected sandwiches',
    isConfirmed: 'confirmation status',
    notes: 'notes',
    location: 'location',
    eventLocation: 'event location',
    eventAddress: 'event address',
    vanDriverIds: 'van drivers',
    eventNotes: 'event notes',
    kitchenNotes: 'kitchen notes',
    adminNotes: 'admin notes',
    deliveryNotes: 'delivery notes',
    desiredEventDate: 'requested date',
    desiredEventTime: 'requested time',
    sandwichTypesRequested: 'sandwich types',
    toolkitSentDate: 'toolkit sent date',
    toolkitSentBy: 'toolkit sent by',
    recipientIds: 'recipients',
    tspContactId: 'TSP contact',
    intakeCompletedBy: 'intake completed by',
    intakeCompletedDate: 'intake completed date',
  };
  return fieldLabels[fieldName] || fieldName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
}

// ==================== Setup Function ====================

export function setupSocketCollaboration(httpServer: HttpServer, io: SocketServer) {
  // Create collaboration namespace
  const collaboration = io.of('/collaboration');
  collaborationNamespace = collaboration;

  logger.log('✓ Socket.IO collaboration namespace initialized on /collaboration');

  // ==================== Authentication Middleware ====================

  /**
   * SECURITY: Authenticate socket connections
   * Verifies user session and loads user data before allowing any operations
   */
  collaboration.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Extract user info from handshake (sent by client during connection)
      const userId = socket.handshake.auth?.userId;
      const userEmail = socket.handshake.auth?.userEmail;

      if (!userId || !userEmail) {
        logger.error('[Collaboration] Socket authentication failed: Missing credentials');
        return next(new Error('Authentication required'));
      }

      // Fetch user from database to verify existence and get current permissions
      const user = await storage.getUserByEmail(userEmail);

      if (!user) {
        logger.error(`[Collaboration] Socket authentication failed: User not found - ${userEmail}`);
        return next(new Error('User not found'));
      }

      // Verify user ID matches
      if (user.id !== userId) {
        logger.error(`[Collaboration] Socket authentication failed: User ID mismatch - ${userEmail}`);
        return next(new Error('User ID mismatch'));
      }

      // Check if user account is active
      if (!user.isActive) {
        logger.error(`[Collaboration] Socket authentication failed: Inactive user - ${userEmail}`);
        return next(new Error('Account is not active'));
      }

      // Store authenticated user in socket data
      // IMPORTANT: permissions must be an array, not an object, for checkPermission to work
      socket.data.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        displayName: user.displayName || undefined,
        role: user.role || 'volunteer',
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
        isActive: user.isActive,
      };

      logger.log(`[Collaboration] Socket authenticated: ${user.email} (${socket.id})`);
      next();
    } catch (error) {
      logger.error('[Collaboration] Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Heartbeat cleanup interval (every 30 seconds)
  setInterval(() => {
    cleanupStalePresence();
  }, 30 * 1000);

  // Expired locks cleanup interval (every minute)
  setInterval(async () => {
    try {
      const deletedCount = await storage.cleanupExpiredLocks();
      if (deletedCount > 0) {
        logger.log(`Cleaned up ${deletedCount} expired field locks`);
      }
    } catch (error) {
      logger.error('Error cleaning up expired locks:', error);
    }
  }, 60 * 1000);

  // ==================== Connection Handler ====================

  collaboration.on('connection', (socket: AuthenticatedSocket) => {
    logger.log(`✅ Collaboration socket connected: ${socket.id}`);

    // ==================== Join Event ====================

    socket.on('join-event', async (data) => {
      try {
        const validated = JoinEventSchema.parse(data);
        const { eventRequestId, userId, userName } = validated;

        // SECURITY: Verify authenticated user matches the userId in request
        const authenticatedUser = socket.data.user;
        if (!authenticatedUser) {
          socket.emit('error', { message: 'Not authenticated' });
          logger.error(`[Collaboration] Unauthenticated join-event attempt`);
          return;
        }

        if (authenticatedUser.id !== userId) {
          socket.emit('error', { message: 'User ID mismatch' });
          logger.error(`[Collaboration] User ID mismatch: ${authenticatedUser.id} vs ${userId}`);
          return;
        }

        // SECURITY: Check if user has permission to view events
        const viewPermission = checkPermission(authenticatedUser, 'EVENT_REQUESTS_VIEW');
        if (!viewPermission.granted) {
          socket.emit('error', { message: 'Insufficient permissions to view events' });
          logger.error(`[Collaboration] Permission denied for user ${authenticatedUser.email}: EVENT_REQUESTS_VIEW`);
          return;
        }

        // Verify event exists and user has access
        const event = await storage.getEventRequest(eventRequestId);
        if (!event) {
          socket.emit('error', { message: 'Event not found' });
          return;
        }

        // Join rooms
        const roomName = getRoomName(eventRequestId);
        const locksRoom = getLocksRoomName(eventRequestId);
        const commentsRoom = getCommentsRoomName(eventRequestId);
        const userRoom = `user:${userId}`;

        socket.join(roomName);
        socket.join(locksRoom);
        socket.join(commentsRoom);
        socket.join(userRoom); // Join user-specific room for mention notifications

        // Track subscription
        if (!socketEventSubscriptions.has(socket.id)) {
          socketEventSubscriptions.set(socket.id, new Set());
        }
        socketEventSubscriptions.get(socket.id)!.add(eventRequestId);

        // Add to presence
        addPresence(eventRequestId, userId, userName, socket.id);

        // Get initial state
        const initialState = await getInitialEventState(eventRequestId);

        // Send initial state to joining user
        socket.emit('event-state', initialState);

        // Broadcast presence update to all users in room
        collaboration.to(roomName).emit('presence-updated', {
          eventRequestId,
          activeUsers: getEventPresence(eventRequestId),
        });

        // Load and send recent comments
        const comments = await storage.getEventCollaborationComments(eventRequestId);
        socket.emit('comments-loaded', {
          eventRequestId,
          comments,
        });

        // Broadcast join activity to other team members
        broadcastActivity(eventRequestId, {
          type: 'join',
          userId,
          userName,
          description: 'started viewing this event',
        });

        logger.log(
          `User ${userName} (${userId}) joined event collaboration: ${eventRequestId}`
        );
      } catch (error) {
        logger.error('Error joining event:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to join event',
        });
      }
    });

    // ==================== Leave Event ====================

    socket.on('leave-event', async (data: { eventRequestId: number; userId: string; userName?: string }) => {
      try {
        const { eventRequestId, userId, userName } = data;

        // Get presence info before removing
        const presence = presenceByEvent.get(eventRequestId)?.get(userId);
        const leavingUserName = userName || presence?.userName || 'User';

        // Broadcast leave activity before removing presence
        broadcastActivity(eventRequestId, {
          type: 'leave',
          userId,
          userName: leavingUserName,
          description: 'stopped viewing this event',
        });

        // Leave rooms
        socket.leave(getRoomName(eventRequestId));
        socket.leave(getLocksRoomName(eventRequestId));
        socket.leave(getCommentsRoomName(eventRequestId));

        // Remove from subscriptions
        socketEventSubscriptions.get(socket.id)?.delete(eventRequestId);

        // Remove from presence
        removePresence(eventRequestId, userId);

        // Release all locks held by this user
        await releaseUserLocks(eventRequestId, userId);

        // Broadcast presence update
        collaboration.to(getRoomName(eventRequestId)).emit('presence-updated', {
          eventRequestId,
          activeUsers: getEventPresence(eventRequestId),
        });

        logger.log(`User ${userId} left event collaboration: ${eventRequestId}`);
      } catch (error) {
        logger.error('Error leaving event:', error);
      }
    });

    // ==================== Heartbeat ====================

    socket.on('heartbeat', async (data) => {
      try {
        // Skip invalid/empty heartbeats silently - this can happen when client
        // sends heartbeat while not viewing an event details page
        if (!data || typeof data !== 'object' || !data.eventRequestId || !data.userId) {
          return; // Silently ignore invalid heartbeats
        }

        const validated = HeartbeatSchema.parse(data);
        const { eventRequestId, userId } = validated;

        updateHeartbeat(eventRequestId, userId);
      } catch (error) {
        // Don't log Zod validation errors for heartbeats - they're expected when
        // client navigates away from event pages but still has socket connected
        if (error instanceof z.ZodError) {
          return; // Silently ignore validation errors for heartbeats
        }
        logger.error('Error processing heartbeat:', error);
      }
    });

    // ==================== Acquire Field Lock ====================

    socket.on('acquire-lock', async (data, callback) => {
      try {
        const validated = AcquireLockSchema.parse(data);
        const { eventRequestId, fieldName, userId, userName } = validated;

        // SECURITY: Verify authenticated user
        const authenticatedUser = socket.data.user;
        if (!authenticatedUser) {
          const errorMsg = 'Not authenticated';
          socket.emit('error', { message: errorMsg });
          if (callback) callback({ success: false, error: errorMsg });
          return;
        }

        if (authenticatedUser.id !== userId) {
          const errorMsg = 'User ID mismatch';
          socket.emit('error', { message: errorMsg });
          logger.error(`[Collaboration] User ID mismatch on acquire-lock: ${authenticatedUser.id} vs ${userId}`);
          if (callback) callback({ success: false, error: errorMsg });
          return;
        }

        // SECURITY: Check if user has permission to edit events
        const editPermission = checkPermission(authenticatedUser, 'EVENT_REQUESTS_EDIT');
        if (!editPermission.granted) {
          const errorMsg = 'Insufficient permissions to edit events';
          socket.emit('error', { message: errorMsg });
          logger.error(`[Collaboration] Permission denied for user ${authenticatedUser.email}: EVENT_REQUESTS_EDIT`);
          if (callback) callback({ success: false, error: errorMsg });
          return;
        }

        // Check if field is already locked
        const existingLocks = await storage.getEventFieldLocks(eventRequestId);
        const existingLock = existingLocks.find((lock) => lock.fieldName === fieldName);

        if (existingLock && existingLock.lockedBy !== userId) {
          // Lock is held by another user
          socket.emit('lock-denied', {
            eventRequestId,
            fieldName,
            lockedBy: existingLock.lockedByName,
            expiresAt: existingLock.expiresAt,
          });

          // Send callback response
          if (callback) {
            callback({
              success: false,
              error: `Field is locked by ${existingLock.lockedByName}`,
            });
          }
          return;
        }

        // Create or renew lock
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        await storage.createEventFieldLock({
          eventRequestId,
          fieldName,
          lockedBy: userId,
          lockedByName: userName,
          expiresAt,
        });

        const lock = {
          eventRequestId,
          fieldName,
          lockedBy: userId,
          lockedByName: userName,
          expiresAt,
        };

        // Broadcast lock acquisition
        collaboration.to(getLocksRoomName(eventRequestId)).emit('lock-acquired', {
          eventRequestId,
          lock,
        });

        // Send callback response
        if (callback) {
          callback({
            success: true,
            lock,
          });
        }

        logger.log(
          `Lock acquired: ${fieldName} by ${userName} in event ${eventRequestId}`
        );
      } catch (error) {
        logger.error('Error acquiring lock:', error);

        const errorMessage = error instanceof Error ? error.message : 'Failed to acquire lock';

        socket.emit('error', {
          message: errorMessage,
        });

        // Send callback response
        if (callback) {
          callback({
            success: false,
            error: errorMessage,
          });
        }
      }
    });

    // ==================== Release Field Lock ====================

    socket.on('release-lock', async (data, callback) => {
      try {
        const validated = ReleaseLockSchema.parse(data);
        const { eventRequestId, fieldName } = validated;

        await storage.deleteEventFieldLock(eventRequestId, fieldName);

        // Broadcast lock release
        collaboration.to(getLocksRoomName(eventRequestId)).emit('lock-released', {
          eventRequestId,
          fieldName,
        });

        // Send callback response
        if (callback) {
          callback({
            success: true,
          });
        }

        logger.log(`Lock released: ${fieldName} in event ${eventRequestId}`);
      } catch (error) {
        logger.error('Error releasing lock:', error);

        const errorMessage = error instanceof Error ? error.message : 'Failed to release lock';

        // Send callback response
        if (callback) {
          callback({
            success: false,
            error: errorMessage,
          });
        }
      }
    });

    // ==================== Field Update ====================

    socket.on('field-update', async (data) => {
      try {
        const validated = FieldUpdateSchema.parse(data);
        const { eventRequestId, fieldName, value, expectedVersion, userId, userName } =
          validated;

        // SECURITY: Verify authenticated user
        const authenticatedUser = socket.data.user;
        if (!authenticatedUser) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        if (authenticatedUser.id !== userId) {
          socket.emit('error', { message: 'User ID mismatch' });
          logger.error(`[Collaboration] User ID mismatch on field-update: ${authenticatedUser.id} vs ${userId}`);
          return;
        }

        // SECURITY: Check if user has permission to edit events
        const editPermission = checkPermission(authenticatedUser, 'EVENT_REQUESTS_EDIT');
        if (!editPermission.granted) {
          socket.emit('error', { message: 'Insufficient permissions to edit events' });
          logger.error(`[Collaboration] Permission denied for user ${authenticatedUser.email}: EVENT_REQUESTS_EDIT`);
          return;
        }

        const expectedVersionDate = new Date(expectedVersion);

        if (isNaN(expectedVersionDate.getTime())) {
          socket.emit('error', {
            message: 'Invalid version format',
          });
          logger.error(`Invalid version string: ${expectedVersion}`);
          return;
        }

        const updateData = { [fieldName]: value };

        try {
          // Get original event data before update for audit logging
          const originalEvent = await storage.getEventRequest(eventRequestId);
          if (!originalEvent) {
            socket.emit('error', { message: 'Event not found' });
            return;
          }

          await storage.updateEventRequest(eventRequestId, updateData, expectedVersionDate);

          // Get updated event to retrieve new version
          const updatedEvent = await storage.getEventRequest(eventRequestId);
          if (!updatedEvent) {
            throw new Error('Event not found after update');
          }

          // Create revision entry in eventEditRevisions table
          await storage.createEventEditRevision({
            eventRequestId,
            fieldName,
            oldValue: originalEvent[fieldName as keyof typeof originalEvent] !== undefined
              ? JSON.stringify(originalEvent[fieldName as keyof typeof originalEvent])
              : null,
            newValue: JSON.stringify(value),
            changedBy: userId,
            changedByName: userName,
            changeType: 'update',
          });

          // Create audit log entry in auditLogs table for activity history
          await AuditLogger.logEventRequestChange(
            eventRequestId.toString(),
            originalEvent,
            updatedEvent,
            {
              userId: userId,
              ipAddress: socket.handshake.address,
              userAgent: socket.handshake.headers['user-agent'],
              sessionId: socket.id,
            },
            {
              actionType: 'REAL_TIME_UPDATE',
              operation: 'field_update',
              fieldName: fieldName,
            }
          );

          // Broadcast field update to all users
          const updatePayload: FieldUpdatePayload = {
            fieldName,
            value,
            updatedAt: updatedEvent.updatedAt,
            updatedBy: userId,
            updatedByName: userName,
          };

          collaboration.to(getRoomName(eventRequestId)).emit('field-updated', {
            eventRequestId,
            ...updatePayload,
            version: updatedEvent.updatedAt,
          });

          // Broadcast activity for key field changes
          const keyFields = [
            'status', 'assignedToId', 'assignedToIds', 'scheduledDate', 'scheduledEventDate', 
            'isConfirmed', 'vanDriverIds', 'recipientIds', 'tspContactId'
          ];
          if (keyFields.includes(fieldName)) {
            let activityType: 'status_change' | 'field_update' | 'assignment' = 'field_update';
            let description = `updated ${formatFieldName(fieldName)}`;
            
            if (fieldName === 'status') {
              activityType = 'status_change';
              description = `changed status to "${value}"`;
            } else if (['assignedToId', 'assignedToIds', 'vanDriverIds', 'recipientIds', 'tspContactId'].includes(fieldName)) {
              activityType = 'assignment';
              description = `updated ${formatFieldName(fieldName)}`;
            } else if (fieldName === 'isConfirmed') {
              description = value ? 'confirmed this event' : 'marked event as unconfirmed';
            } else if (fieldName === 'scheduledDate' || fieldName === 'scheduledEventDate') {
              description = `scheduled event for ${value}`;
            }

            broadcastActivity(eventRequestId, {
              type: activityType,
              userId,
              userName,
              description,
              fieldName,
              oldValue: originalEvent[fieldName as keyof typeof originalEvent] !== undefined
                ? String(originalEvent[fieldName as keyof typeof originalEvent])
                : undefined,
              newValue: String(value),
            });
          }

          logger.log(
            `Field updated: ${fieldName} by ${userName} in event ${eventRequestId} (with audit log)`
          );
        } catch (updateError: any) {
          // Version conflict detected
          if (updateError.message?.includes('version conflict')) {
            const currentEvent = await storage.getEventRequest(eventRequestId);
            socket.emit('update-rejected', {
              eventRequestId,
              fieldName,
              reason: 'version_conflict',
              currentVersion: currentEvent?.updatedAt,
              currentValue: currentEvent ? currentEvent[fieldName as keyof typeof currentEvent] : null,
            });
            logger.log(
              `Version conflict on ${fieldName} in event ${eventRequestId}`
            );
          } else {
            throw updateError;
          }
        }
      } catch (error) {
        logger.error('Error updating field:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to update field',
        });
      }
    });

    // ==================== Create Comment ====================

    socket.on('create-comment', async (data) => {
      try {
        const validated = CreateCommentSchema.parse(data);
        const { eventRequestId, userId, userName, content, parentCommentId } = validated;

        // SECURITY: Verify authenticated user
        const authenticatedUser = socket.data.user;
        if (!authenticatedUser) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        if (authenticatedUser.id !== userId) {
          socket.emit('error', { message: 'User ID mismatch' });
          logger.error(`[Collaboration] User ID mismatch on create-comment: ${authenticatedUser.id} vs ${userId}`);
          return;
        }

        // SECURITY: Check if user has permission to comment on events
        const commentPermission = checkPermission(authenticatedUser, 'EVENT_REQUESTS_VIEW');
        if (!commentPermission.granted) {
          socket.emit('error', { message: 'Insufficient permissions to comment on events' });
          logger.error(`[Collaboration] Permission denied for user ${authenticatedUser.email}: EVENT_REQUESTS_VIEW (comment)`);
          return;
        }

        // Same rule as the HTTP routes: flags can only be written while the
        // event is New; comments on later events are read-only.
        const event = await storage.getEventRequest(eventRequestId);
        if (!event) {
          socket.emit('error', { message: 'Event request not found' });
          return;
        }
        if (!canWriteFlags(event.status)) {
          socket.emit('error', { message: FLAGS_READ_ONLY_ERROR.error });
          return;
        }
        // A reply must be to a comment on THIS event.
        if (parentCommentId) {
          const parent = await loadCommentEvent(parentCommentId);
          if (!parent || parent.eventRequestId !== eventRequestId) {
            socket.emit('error', { message: 'Reply is to a comment on a different event' });
            return;
          }
        }

        const comment = await storage.createEventCollaborationComment({
          eventRequestId,
          userId,
          userName,
          content,
          parentCommentId: parentCommentId || null,
        });

        // Broadcast new comment to all users
        collaboration.to(getCommentsRoomName(eventRequestId)).emit('comment-created', {
          eventRequestId,
          comment,
        });

        // Broadcast comment activity
        broadcastActivity(eventRequestId, {
          type: 'comment',
          userId,
          userName,
          description: parentCommentId ? 'replied to a comment' : 'added a comment',
          details: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        });

        logger.log(`Comment created by ${userName} in event ${eventRequestId}`);

        // ==================== Detect and Notify Mentions ====================
        
        // Extract @mentions from comment content
        const mentions = extractMentions(content);
        
        if (mentions.length > 0) {
          logger.log(`Detected ${mentions.length} mentions in comment:`, mentions);
          
          // Find users by name or email
          const mentionedUsers = await storage.getUsersByNameOrEmail(mentions);
          
          if (mentionedUsers.length > 0) {
            logger.log(`Found ${mentionedUsers.length} mentioned users`);
            
            // Send notification to each mentioned user (excluding the comment author)
            for (const mentionedUser of mentionedUsers) {
              if (mentionedUser.id !== userId) {
                // Emit to user-specific room
                collaboration.to(`user:${mentionedUser.id}`).emit('user-mentioned', {
                  resourceType: 'event',
                  resourceId: eventRequestId,
                  mentionedBy: userName,
                  mentionedById: userId,
                  comment: content,
                  commentId: comment.id,
                  timestamp: new Date().toISOString(),
                });
                
                logger.log(`Sent mention notification to user ${mentionedUser.id} (${mentionedUser.email})`);
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error creating comment:', error);
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Failed to create comment',
        });
      }
    });

    // ==================== Disconnect Handler ====================

    socket.on('disconnect', async () => {
      logger.log(`Collaboration socket disconnected: ${socket.id}`);

      // Get all events this socket was subscribed to
      const subscribedEvents = socketEventSubscriptions.get(socket.id);
      if (subscribedEvents) {
        for (const eventId of subscribedEvents) {
          // Find user in presence
          const presenceMap = presenceByEvent.get(eventId);
          if (presenceMap) {
            for (const [userId, presence] of presenceMap.entries()) {
              if (presence.socketId === socket.id) {
                // Remove presence
                removePresence(eventId, userId);

                // Release locks
                await releaseUserLocks(eventId, userId);

                // Broadcast presence update
                collaboration.to(getRoomName(eventId)).emit('presence-updated', {
                  eventRequestId: eventId,
                  activeUsers: getEventPresence(eventId),
                });
              }
            }
          }
        }

        socketEventSubscriptions.delete(socket.id);
      }
    });
  });

  return collaboration;
}
