/**
 * Event Requests - Collection Log Linking Routes
 *
 * Connects event requests to their entries in the collections log, which is the
 * single source of truth for sandwich counts. Suggests likely matches (event day
 * or the day after, similar group/host name) and lets admins confirm them by
 * setting sandwich_collections.eventRequestId.
 *
 * Matching rules live in services/event-collection-matching.ts.
 */

import { Router } from 'express';
import type { NextFunction, Response } from 'express';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db';
import { storage } from '../../storage-wrapper';
import { sandwichCollections, eventRequests } from '@shared/schema';
import { isAuthenticated } from '../../auth';
import { hasPermission } from '@shared/unified-auth-utils';
import { AuditLogger } from '../../audit-logger';
import { QueryOptimizer } from '../../performance/query-optimizer';
import { logger } from '../../middleware/logger';
import type { AuthenticatedRequest } from '../../types/express';
import {
  getCollectionDateWindow,
  matchCollection,
  rankSuggestions,
} from '../../services/event-collection-matching';

const router = Router();

const MAX_TOTALS_IDS = 500;

/**
 * Who may link/unlink: admins, per the unified permission check. The same check
 * drives `canLink` in the matches response, so the UI and the server agree
 * (requirePermission passes every role='admin' user regardless of their
 * explicit permissions, which could disagree with what the UI shows).
 */
function canLinkCollections(req: AuthenticatedRequest): boolean {
  return hasPermission(req.user, 'ADMIN_ACCESS');
}

function requireLinkPermission(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!canLinkCollections(req)) {
    return res.status(403).json({ message: 'Only admins can link collection entries' });
  }
  next();
}

function auditContext(req: AuthenticatedRequest) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('User-Agent'),
    sessionId: req.session?.id || req.sessionID,
  };
}

/**
 * Sandwich counts from linked collection entries, for many events at once.
 * GET /api/event-requests/linked-collection-totals?ids=1,2,3
 *
 * Returns { [eventId]: { count, entries } } for events that have at least one
 * linked entry. Used by completed cards to show the logged count.
 */
router.get('/linked-collection-totals', isAuthenticated, async (req, res) => {
  try {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = Array.from(
      new Set(
        raw
          .split(',')
          .filter((s) => /^\d+$/.test(s.trim()))
          .map((s) => Number(s.trim()))
      )
    ).slice(0, MAX_TOTALS_IDS);

    if (ids.length === 0) return res.json({});

    const [linked, events] = await Promise.all([
      db
        .select()
        .from(sandwichCollections)
        .where(
          and(
            inArray(sandwichCollections.eventRequestId, ids),
            isNull(sandwichCollections.deletedAt)
          )
        ),
      db
        .select({ id: eventRequests.id, organizationName: eventRequests.organizationName })
        .from(eventRequests)
        .where(inArray(eventRequests.id, ids)),
    ]);

    const orgById = new Map(events.map((e) => [e.id, e.organizationName || '']));
    const totals: Record<number, { count: number; entries: number }> = {};
    for (const c of linked) {
      const eventId = c.eventRequestId!;
      const match = matchCollection(c, orgById.get(eventId) || '');
      const current = totals[eventId] || { count: 0, entries: 0 };
      totals[eventId] = { count: current.count + match.eventCount, entries: current.entries + 1 };
    }

    res.json(totals);
  } catch (error) {
    logger.error('Error fetching linked collection totals:', error);
    res.status(500).json({ message: 'Failed to fetch linked collection totals' });
  }
});

/**
 * Linked entries for one event, plus suggested matches for admins.
 * GET /api/event-requests/:id/collection-matches
 */
router.get('/:id(\\d+)/collection-matches', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const event = await storage.getEventRequestById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    const organizationName = event.organizationName || '';
    const linkedRows = await storage.getSandwichCollectionsByEventRequestId(id);
    const linked = linkedRows.map((c) => matchCollection(c, organizationName));

    const canLink = canLinkCollections(req);
    const eventDate = event.scheduledEventDate || event.desiredEventDate;
    const window = getCollectionDateWindow(eventDate);

    let suggestions: ReturnType<typeof rankSuggestions> = [];
    if (canLink && window && organizationName) {
      // Only unlinked entries are suggested — an entry already linked to another
      // event has to be unlinked there first.
      const candidates = await db
        .select()
        .from(sandwichCollections)
        .where(
          and(
            gte(sandwichCollections.collectionDate, window.start),
            lte(sandwichCollections.collectionDate, window.end),
            isNull(sandwichCollections.eventRequestId),
            isNull(sandwichCollections.deletedAt)
          )
        );
      suggestions = rankSuggestions(candidates, organizationName);
    }

    res.json({
      linked,
      suggestions,
      canLink,
      searchWindow: window,
    });
  } catch (error) {
    logger.error('Error fetching collection matches:', error);
    res.status(500).json({ message: 'Failed to fetch collection matches' });
  }
});

/**
 * Link a collection entry to an event (admins only).
 * POST /api/event-requests/:id/collections/:collectionId/link
 */
router.post(
  '/:id(\\d+)/collections/:collectionId(\\d+)/link',
  isAuthenticated,
  requireLinkPermission,
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      const collectionId = Number(req.params.collectionId);

      const event = await storage.getEventRequestById(id);
      if (!event) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      const collection = await storage.getSandwichCollectionById(collectionId);
      if (!collection || collection.deletedAt) {
        return res.status(404).json({ message: 'Collection entry not found' });
      }
      if (collection.eventRequestId && collection.eventRequestId !== id) {
        return res.status(409).json({
          message: `This collection entry is already linked to event #${collection.eventRequestId}. Unlink it there first.`,
        });
      }

      // Only write if the entry is still in the state we just checked, so two
      // admins linking at once can't silently overwrite each other.
      const [updated] = await db
        .update(sandwichCollections)
        .set({ eventRequestId: id })
        .where(
          and(
            eq(sandwichCollections.id, collectionId),
            isNull(sandwichCollections.deletedAt),
            collection.eventRequestId
              ? eq(sandwichCollections.eventRequestId, collection.eventRequestId)
              : isNull(sandwichCollections.eventRequestId)
          )
        )
        .returning();
      if (!updated) {
        return res.status(409).json({
          message: 'This collection entry changed while you were linking it. Refresh and try again.',
        });
      }

      QueryOptimizer.invalidateCache('sandwich-collections');
      await AuditLogger.logUpdate(
        'sandwich_collections',
        String(collectionId),
        { eventRequestId: collection.eventRequestId ?? null },
        { eventRequestId: id },
        auditContext(req)
      );

      res.json(matchCollection(updated, event.organizationName || ''));
    } catch (error) {
      logger.error('Error linking collection to event:', error);
      res.status(500).json({ message: 'Failed to link collection entry' });
    }
  }
);

/**
 * Unlink a collection entry from an event (admins only).
 * DELETE /api/event-requests/:id/collections/:collectionId/link
 */
router.delete(
  '/:id(\\d+)/collections/:collectionId(\\d+)/link',
  isAuthenticated,
  requireLinkPermission,
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      const collectionId = Number(req.params.collectionId);

      const collection = await storage.getSandwichCollectionById(collectionId);
      if (!collection || collection.eventRequestId !== id) {
        return res.status(404).json({ message: 'That collection entry is not linked to this event' });
      }

      // Conditional on the link still pointing at this event, so a delayed
      // request can't clear a newer link to a different event.
      const cleared = await db
        .update(sandwichCollections)
        .set({ eventRequestId: null })
        .where(
          and(
            eq(sandwichCollections.id, collectionId),
            eq(sandwichCollections.eventRequestId, id)
          )
        )
        .returning({ id: sandwichCollections.id });
      if (cleared.length === 0) {
        return res.status(409).json({
          message: 'This collection entry changed while you were unlinking it. Refresh and try again.',
        });
      }

      QueryOptimizer.invalidateCache('sandwich-collections');
      await AuditLogger.logUpdate(
        'sandwich_collections',
        String(collectionId),
        { eventRequestId: id },
        { eventRequestId: null },
        auditContext(req)
      );

      res.json({ success: true });
    } catch (error) {
      logger.error('Error unlinking collection from event:', error);
      res.status(500).json({ message: 'Failed to unlink collection entry' });
    }
  }
);

export default router;
