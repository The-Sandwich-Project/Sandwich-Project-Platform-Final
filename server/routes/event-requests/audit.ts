/**
 * Event Requests - Audit Log Routes
 *
 * Handles fetching and filtering audit log entries for event requests.
 * Split from event-requests-legacy.ts for better organization.
 */

import { Router } from 'express';
import { db } from '../../db';
import { auditLogs, eventRequests, users, type EventRequest } from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { isAuthenticated } from '../../auth';
import { and, or, eq, desc, sql, inArray, isNull } from 'drizzle-orm';
import { logger } from '../../middleware/logger';
import { safeJsonParse } from '../../utils/safe-json';

const router = Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert camelCase/snake_case field names to human-readable format
 */
const formatFieldName = (fieldName: string): string => {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

// ============================================================================
// Audit Log Routes
// ============================================================================

// GET /api/event-requests/audit-logs - Fetch audit log entries for event requests
router.get('/audit-logs', isAuthenticated, async (req, res) => {
  try {
    // Disable caching for audit logs - they should always be fresh
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    // Check permissions
    if (!hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_VIEW)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Parse query parameters
    const hours = parseInt(req.query.hours as string) || 24;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500); // Cap at 500
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;
    const userId = req.query.userId as string;
    const eventId = req.query.eventId as string;

    // Calculate time cutoff
    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - hours);

    // Build query conditions using Drizzle ORM
    const conditions = [];

    // Filter for event_requests table by default, but allow users table entries for user management
    const tableFilter = req.query.tableName as string;
    if (tableFilter === 'users' || tableFilter === 'user_management') {
      // Allow both users and user_management for backward compatibility
      conditions.push(
        or(
          eq(auditLogs.tableName, 'users'),
          eq(auditLogs.tableName, 'user_management')
        )
      );
    } else {
      // Default to event_requests table
      conditions.push(eq(auditLogs.tableName, 'event_requests'));
    }

    // Add time filter if specified - using SQL comparison as a workaround
    if (hours > 0) {
      // Use SQL template for date comparison instead of gte
      conditions.push(sql`${auditLogs.timestamp} >= ${hoursAgo.toISOString()}`);
    }

    // Add action filter if specified
    if (action && action !== 'all') {
      conditions.push(eq(auditLogs.action, action));
    }

    // Add user filter if specified
    if (userId && userId !== 'all') {
      conditions.push(eq(auditLogs.userId, userId));
    }

    // Add event ID filter if specified
    if (eventId) {
      conditions.push(eq(auditLogs.recordId, eventId));
    }


    // Execute query using Drizzle ORM
    const rawLogs = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset);


    // Helper to pull from camelCase or snake_case
    const getField = (row: Record<string, unknown>, camel: string, snake: string) =>
      row[camel] !== undefined ? row[camel] : row[snake];

    // Enrich only records referenced by this page of audit history.
    const referencedUserIds = new Set<string>();
    const referencedEventIds = new Set<number>();
    for (const log of rawLogs) {
      const actorId = getField(log, 'userId', 'user_id');
      if (actorId !== null && actorId !== undefined && String(actorId) !== '') {
        referencedUserIds.add(String(actorId));
      }

      const tableName = String(getField(log, 'tableName', 'table_name'));
      const recordId = String(getField(log, 'recordId', 'record_id'));
      if (tableName === 'users' || tableName === 'user_management') {
        // User-management entries need both the actor and the affected user.
        referencedUserIds.add(recordId);
      } else if (tableName === 'event_requests' && /^[1-9]\d*$/.test(recordId)) {
        const eventId = Number(recordId);
        if (Number.isSafeInteger(eventId) && eventId <= 2147483647) {
          referencedEventIds.add(eventId);
        }
      }
    }

    const [referencedUsers, referencedEvents] = await Promise.all([
      referencedUserIds.size > 0
        ? db.select({
            id: users.id,
            email: users.email,
            preferredEmail: users.preferredEmail,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
          }).from(users).where(inArray(users.id, [...referencedUserIds]))
        : Promise.resolve([]),
      referencedEventIds.size > 0
        ? db.select({
            id: eventRequests.id,
            organizationName: eventRequests.organizationName,
            firstName: eventRequests.firstName,
            lastName: eventRequests.lastName,
          }).from(eventRequests).where(and(
            inArray(eventRequests.id, [...referencedEventIds]),
            isNull(eventRequests.deletedAt)
          ))
        : Promise.resolve([]),
    ]);
    const userMap = new Map(referencedUsers.map((u) => [String(u.id), u]));
    const eventMap = new Map(referencedEvents.map((e) => [String(e.id), e]));

    // Transform raw logs to the expected format
    // Filter out internal tracking entries that aren't useful for end users
    const enrichedLogs = rawLogs
      .filter((log) => {
        const action = String(getField(log, 'action', 'action'));
        // Skip internal tracking entries that are redundant or not user-facing
        return action !== 'EVENT_REQUEST_SIGNIFICANT_CHANGE';
      })
      .map((log) => {
      const recordId = String(getField(log, 'recordId', 'record_id'));
      const logUserId = String(getField(log, 'userId', 'user_id'));

      let newData: Partial<EventRequest> | null = null;
      let oldData: Partial<EventRequest> | null = null;

      // Safely parse newData with error handling
      const newDataField = getField(log, 'newData', 'new_data');
      if (newDataField) {
        const parseResult = safeJsonParse(String(newDataField), {}, 'event audit log newData');
        newData = parseResult.data;
      }

      // Safely parse oldData with error handling
      const oldDataField = getField(log, 'oldData', 'old_data');
      if (oldDataField) {
        const parseResult = safeJsonParse(String(oldDataField), {}, 'event audit log oldData');
        oldData = parseResult.data;
      }

      const user = userMap.get(logUserId); // User who made the change
      const event = eventMap.get(recordId);
      const tableName = String(getField(log, 'tableName', 'table_name'));

      // For user management logs, get the user being updated
      let updatedUser = null;
      if (tableName === 'users' || tableName === 'user_management') {
        updatedUser = userMap.get(recordId) || newData || oldData;
      }

      // Extract follow-up context and audit metadata from newData or oldData
      let followUpMethod = null;
      let followUpAction = null;
      let notes = null;
      let actionDescription = '';
      let changeDescription = '';
      let statusChange = null;

      // Extract change metadata from _auditMetadata if available
      const metadata = (newData as any)?._auditMetadata || (oldData as any)?._auditMetadata;
      if (metadata) {
        // Always prefer the summary - it's human-readable
        if (metadata.summary) {
          changeDescription = metadata.summary;
        } else if (metadata.changes && Array.isArray(metadata.changes)) {
          // Fallback: Build a user-friendly summary from the metadata changes
          // Only show friendly names, not raw field data
          const changeDescriptions = metadata.changes
            .slice(0, 3)
            .map((change: any) => {
              const fieldName = change.friendlyName || change.fieldDisplayName || change.fieldName || change.field;
              // Apply transformation as final fallback if field name looks raw (camelCase or snake_case)
              return fieldName && (fieldName.includes('_') || /[a-z][A-Z]/.test(fieldName))
                ? formatFieldName(fieldName)
                : fieldName;
            });
          if (changeDescriptions.length > 0) {
            const count = metadata.changes.length;
            if (count === 1) {
              changeDescription = `Updated ${changeDescriptions[0]}`;
            } else if (count === 2) {
              changeDescription = `Updated ${changeDescriptions[0]} and ${changeDescriptions[1]}`;
            } else if (count === 3) {
              changeDescription = `Updated ${changeDescriptions[0]}, ${changeDescriptions[1]}, and ${changeDescriptions[2]}`;
            } else {
              changeDescription = `Updated ${changeDescriptions[0]}, ${changeDescriptions[1]}, ${changeDescriptions[2]}, and ${count - 3} more field${count - 3 === 1 ? '' : 's'}`;
            }
          }
        }
      }

      // Try to extract follow-up context from newData first, then oldData
      const dataWithContext = newData || oldData;
      if (dataWithContext) {
        // Extract follow-up context fields
        followUpMethod = (dataWithContext as any).followUpMethod || (dataWithContext as any)._auditMetadata?.followUpMethod || null;
        followUpAction = (dataWithContext as any).followUpAction || (dataWithContext as any)._auditMetadata?.followUpAction || null;
        notes = (dataWithContext as any).notes || (dataWithContext as any)._auditMetadata?.notes || null;

        // Extract action descriptions
        actionDescription = (dataWithContext as any)._auditMetadata?.actionDescription ||
                           (dataWithContext as any).actionDescription ||
                           getField(log, 'action', 'action') || '';

        // Only override changeDescription if we don't already have one from metadata
        if (!changeDescription) {
          changeDescription = (dataWithContext as any)._auditMetadata?.changeDescription ||
                             (dataWithContext as any).changeDescription || '';
        }

        // Extract status change information
        statusChange = (dataWithContext as any)._auditMetadata?.statusChange ||
                      (dataWithContext as any).statusChange || null;

        // If we have both old and new data, try to determine status change
        if (newData && oldData && newData.status !== oldData.status) {
          statusChange = `${oldData.status || 'unknown'} → ${newData.status || 'unknown'}`;
        }
      }

      // For user management entries, show the updated user's name instead of organization/contact
      let organizationName = 'Unknown Organization';
      let contactName = 'Unknown Contact';

      if (tableName === 'users' || tableName === 'user_management') {
        // This is a user profile update - show the updated user's info
        const displayName = (updatedUser as any)?.displayName ||
                          ((updatedUser as any)?.firstName && (updatedUser as any)?.lastName
                            ? `${(updatedUser as any).firstName} ${(updatedUser as any).lastName}`.trim()
                            : (updatedUser as any)?.email?.split('@')[0] ||
                              (updatedUser as any)?.email ||
                              'Unknown User');
        organizationName = displayName;
        contactName = (updatedUser as any)?.email || (updatedUser as any)?.preferredEmail || '';
      } else {
        // Event request entry - use existing logic
        organizationName =
          event?.organizationName ||
          oldData?.organizationName ||
          newData?.organizationName ||
          'Unknown Organization';
        contactName = event
          ? `${event.firstName || ''} ${event.lastName || ''}`.trim()
          : oldData
            ? `${oldData.firstName || ''} ${oldData.lastName || ''}`.trim()
            : newData
              ? `${newData.firstName || ''} ${newData.lastName || ''}`.trim()
              : 'Unknown Contact';
      }

      // Improve user display for system actions
      let displayUserEmail = user?.email || user?.preferredEmail || '';
      if (!displayUserEmail && logUserId) {
        // Check if this is a system/automated action
        if (logUserId === 'google_sheets_sync' || logUserId === 'system' || logUserId.toLowerCase().includes('sync')) {
          displayUserEmail = 'Automated Import';
        } else {
          displayUserEmail = logUserId;
        }
      }
      if (!displayUserEmail) {
        displayUserEmail = 'System';
      }

      return {
        id: getField(log, 'id', 'id'),
        action: getField(log, 'action', 'action'),
        eventId: recordId,
        timestamp: getField(log, 'timestamp', 'timestamp'),
        userId: logUserId,
        userEmail: displayUserEmail,
        organizationName,
        contactName,
        // CRITICAL FIX: Expose oldData/newData at top level (not buried in details)
        oldData,
        newData,
        // CRITICAL FIX: Expose follow-up context fields that frontend expects
        followUpMethod,
        followUpAction,
        notes,
        actionDescription,
        changeDescription,
        statusChange,
        // Keep details for backward compatibility but make it secondary
        details: { oldData, newData },
        // Include table name for filtering
        tableName,
      };
    });


    // Debug: Log unique users in the returned logs
    const uniqueUserIds = new Set(enrichedLogs.map(log => log.userId));
    const uniqueUserEmails = new Set(enrichedLogs.map(log => log.userEmail));

    res.json({
      logs: enrichedLogs,
      total: enrichedLogs.length,
      offset,
      limit,
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('Failed to fetch audit logs', error);

    res.status(500).json({
      error: 'Failed to fetch audit logs',
      message: err?.message || 'Unknown error occurred'
    });
  }
});

export default router;
