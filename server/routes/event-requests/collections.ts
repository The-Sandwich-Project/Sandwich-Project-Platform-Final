/**
 * Event Requests - Collection Log Linking Routes
 *
 * Connects event requests to the collection-log groups that came from them. The
 * collections log is the single source of truth for sandwich counts. One entry
 * can list several groups that each had their own event, so admins pick which
 * groups belong to an event (event_collection_links), or the whole entry when
 * the host is the organization. Older whole-entry links in
 * sandwich_collections.eventRequestId are still honored.
 *
 * Matching and counting rules live in services/event-collection-matching.ts.
 */

import { Router } from 'express';
import type { NextFunction, Response } from 'express';
import { z } from 'zod';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db';
import { storage } from '../../storage-wrapper';
import { eventCollectionLinks, eventRequests, sandwichCollections } from '@shared/schema';
import type { SandwichCollection, EventCollectionLink } from '@shared/schema';
import { isAuthenticated } from '../../auth';
import { hasPermission } from '@shared/unified-auth-utils';
import { AuditLogger } from '../../audit-logger';
import { QueryOptimizer } from '../../performance/query-optimizer';
import { logger } from '../../middleware/logger';
import type { AuthenticatedRequest } from '../../types/express';
import {
  WHOLE_ENTRY,
  countForLinks,
  describeEntry,
  effectiveLinks,
  getCollectionDateWindow,
  getCollectionGroups,
  groupLabel,
  rankSuggestions,
  resolveLinks,
  type CollectionGroup,
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

/** Non-deleted collection entries by id. */
async function loadCollections(ids: number[]): Promise<SandwichCollection[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(sandwichCollections)
    .where(and(inArray(sandwichCollections.id, ids), isNull(sandwichCollections.deletedAt)));
}

/** Every table link on the given entries, grouped by entry. */
async function loadLinksByCollection(collectionIds: number[]): Promise<Map<number, EventCollectionLink[]>> {
  const byCollection = new Map<number, EventCollectionLink[]>();
  if (collectionIds.length === 0) return byCollection;
  const rows = await db
    .select()
    .from(eventCollectionLinks)
    .where(inArray(eventCollectionLinks.collectionId, collectionIds));
  for (const row of rows) {
    const list = byCollection.get(row.collectionId) ?? [];
    list.push(row);
    byCollection.set(row.collectionId, list);
  }
  return byCollection;
}

/** Index a link is parked at when its group is gone: unique, never a real group. */
const parkedIndex = (linkId: number) => -1_000_000 - linkId;

/**
 * Re-point an entry's stored links at the groups they resolve to now.
 *
 * If an entry is edited and its groups reordered, stored indexes drift from the
 * real groups, and checks (which resolve by label) would disagree with writes
 * (which use stored indexes). Re-pointing first keeps both on the same indexes.
 * Links whose group is gone are parked at a unique negative index, where they
 * still show as missing but don't block anyone from linking that position. Two
 * passes avoid tripping the unique (collection, group) index mid-update.
 */
async function syncStoredIndexes(
  collectionId: number,
  groups: CollectionGroup[]
): Promise<EventCollectionLink[]> {
  const links = (await loadLinksByCollection([collectionId])).get(collectionId) ?? [];
  const moves = resolveLinks(groups, links)
    .map(({ link, group }) => ({
      link,
      target: group ? group.index : parkedIndex(link.id),
      label: group ? groupLabel(group) : link.groupName,
    }))
    .filter((m) => m.target !== m.link.groupIndex);
  if (moves.length === 0) return links;

  for (const m of moves) {
    await db
      .update(eventCollectionLinks)
      .set({ groupIndex: -1_000_000_000 - m.link.id })
      .where(eq(eventCollectionLinks.id, m.link.id));
  }
  for (const m of moves) {
    await db
      .update(eventCollectionLinks)
      .set({ groupIndex: m.target, groupName: m.label })
      .where(eq(eventCollectionLinks.id, m.link.id));
  }
  return (await loadLinksByCollection([collectionId])).get(collectionId) ?? [];
}

/**
 * Entries linked to any of the given events, by table link or by the older
 * sandwich_collections.eventRequestId column, with all their table links.
 */
async function loadLinkedEntries(eventIds: number[]) {
  const [tableLinks, legacy] = await Promise.all([
    db
      .select({ collectionId: eventCollectionLinks.collectionId })
      .from(eventCollectionLinks)
      .where(inArray(eventCollectionLinks.eventRequestId, eventIds)),
    db
      .select({ id: sandwichCollections.id })
      .from(sandwichCollections)
      .where(
        and(
          inArray(sandwichCollections.eventRequestId, eventIds),
          isNull(sandwichCollections.deletedAt)
        )
      ),
  ]);
  const collectionIds = Array.from(
    new Set([...tableLinks.map((l) => l.collectionId), ...legacy.map((c) => c.id)])
  );
  const [collections, linksByCollection] = await Promise.all([
    loadCollections(collectionIds),
    loadLinksByCollection(collectionIds),
  ]);
  return { collections, linksByCollection };
}

/**
 * Sandwich counts from linked collection groups, for many events at once.
 * GET /api/event-requests/linked-collection-totals?ids=1,2,3
 *
 * Returns { [eventId]: { count, entries } } for events with at least one
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

    const wanted = new Set(ids);
    const { collections, linksByCollection } = await loadLinkedEntries(ids);

    const totals: Record<number, { count: number; entries: number }> = {};
    for (const collection of collections) {
      const links = effectiveLinks(collection, linksByCollection.get(collection.id) ?? []);
      const eventIds = new Set(links.map((l) => l.eventRequestId).filter((id) => wanted.has(id)));
      for (const eventId of eventIds) {
        const { count } = countForLinks(collection, links, eventId);
        const current = totals[eventId] || { count: 0, entries: 0 };
        totals[eventId] = { count: current.count + count, entries: current.entries + 1 };
      }
    }

    res.json(totals);
  } catch (error) {
    logger.error('Error fetching linked collection totals:', error);
    res.status(500).json({ message: 'Failed to fetch linked collection totals' });
  }
});

/**
 * Linked entries for one event, plus suggested entries for admins.
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
    const { collections, linksByCollection } = await loadLinkedEntries([id]);
    const linked = collections
      .map((c) => describeEntry(c, organizationName, linksByCollection.get(c.id) ?? [], id))
      .sort((a, b) => a.collectionDate.localeCompare(b.collectionDate));

    const canLink = canLinkCollections(req);
    const eventDate = event.scheduledEventDate || event.desiredEventDate;
    const window = getCollectionDateWindow(eventDate);

    let suggestions: ReturnType<typeof rankSuggestions> = [];
    if (canLink && window && organizationName) {
      const candidates = await db
        .select()
        .from(sandwichCollections)
        .where(
          and(
            gte(sandwichCollections.collectionDate, window.start),
            lte(sandwichCollections.collectionDate, window.end),
            isNull(sandwichCollections.deletedAt)
          )
        );
      const candidateLinks = await loadLinksByCollection(candidates.map((c) => c.id));
      suggestions = rankSuggestions(candidates, candidateLinks, organizationName, id);
    }

    res.json({ linked, suggestions, canLink, searchWindow: window });
  } catch (error) {
    logger.error('Error fetching collection matches:', error);
    res.status(500).json({ message: 'Failed to fetch collection matches' });
  }
});

const linkBodySchema = z.object({
  groupIndexes: z.array(z.number().int().min(0)).default([]),
  wholeEntry: z.boolean().default(false),
});

/**
 * Set which groups of a collection entry belong to an event (admins only).
 * Replaces the event's previous picks on that entry.
 * PUT /api/event-requests/:id/collections/:collectionId/link
 * Body: { groupIndexes: number[], wholeEntry: boolean }
 */
router.put(
  '/:id(\\d+)/collections/:collectionId(\\d+)/link',
  isAuthenticated,
  requireLinkPermission,
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      const collectionId = Number(req.params.collectionId);

      const parsed = linkBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid link selection' });
      }
      const wholeEntry = parsed.data.wholeEntry;
      const groupIndexes = Array.from(new Set(parsed.data.groupIndexes));
      if (!wholeEntry && groupIndexes.length === 0) {
        return res.status(400).json({ message: 'Pick at least one group, or unlink the entry instead' });
      }

      const event = await storage.getEventRequestById(id);
      if (!event) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      const [collection] = await loadCollections([collectionId]);
      if (!collection) {
        return res.status(404).json({ message: 'Collection entry not found' });
      }

      const groups = getCollectionGroups(collection);
      if (!wholeEntry && groupIndexes.some((i) => !groups.some((g) => g.index === i))) {
        return res.status(400).json({ message: 'That group is not in this collection entry' });
      }

      const tableLinks = await syncStoredIndexes(collectionId, groups);
      const before = describeEntry(collection, event.organizationName || '', tableLinks, id);
      const others = effectiveLinks(collection, tableLinks).filter((l) => l.eventRequestId !== id);

      if (others.some((l) => l.groupIndex === WHOLE_ENTRY)) {
        return res.status(409).json({ message: 'This whole entry is already linked to another event.' });
      }
      if (wholeEntry && others.length > 0) {
        return res.status(409).json({
          message: 'Some groups in this entry are linked to other events, so it can\'t be linked as a whole.',
        });
      }
      const takenIndexes = new Set(
        before.groups.filter((g) => g.linkedEventId !== null && g.linkedEventId !== id).map((g) => g.index)
      );
      if (!wholeEntry && groupIndexes.some((i) => takenIndexes.has(i))) {
        return res.status(409).json({ message: 'One of those groups is already linked to another event.' });
      }

      const desired = wholeEntry
        ? [{ groupIndex: WHOLE_ENTRY, groupName: null as string | null }]
        : groupIndexes.map((i) => ({ groupIndex: i, groupName: groupLabel(groups.find((g) => g.index === i)!) }));
      const desiredIndexes = desired.map((d) => d.groupIndex);
      const mineBefore = tableLinks.filter((l) => l.eventRequestId === id);

      // Add new picks first. If any lands on a row another event holds, undo
      // what this request added and stop, so a rejected save leaves the
      // previous links exactly as they were.
      const toAdd = desired.filter((d) => !mineBefore.some((l) => l.groupIndex === d.groupIndex));
      const added = toAdd.length
        ? await db
            .insert(eventCollectionLinks)
            .values(
              toAdd.map((d) => ({
                eventRequestId: id,
                collectionId,
                groupIndex: d.groupIndex,
                groupName: d.groupName,
                createdBy: req.user?.id ?? null,
              }))
            )
            .onConflictDoNothing()
            .returning({ id: eventCollectionLinks.id })
        : [];
      if (added.length < toAdd.length) {
        if (added.length > 0) {
          await db.delete(eventCollectionLinks).where(inArray(eventCollectionLinks.id, added.map((a) => a.id)));
        }
        return res.status(409).json({
          message: 'One of those groups was just linked to another event. Refresh and try again.',
        });
      }

      // Then drop this event's picks that are no longer wanted (including any
      // parked ones whose group is gone — the admin has re-picked).
      const dropIds = mineBefore.filter((l) => !desiredIndexes.includes(l.groupIndex)).map((l) => l.id);
      if (dropIds.length > 0) {
        await db.delete(eventCollectionLinks).where(inArray(eventCollectionLinks.id, dropIds));
      }

      // An older whole-entry link to this event moves into the table now that
      // the new picks are saved.
      if (collection.eventRequestId === id) {
        await db
          .update(sandwichCollections)
          .set({ eventRequestId: null })
          .where(and(eq(sandwichCollections.id, collectionId), eq(sandwichCollections.eventRequestId, id)));
      }

      const after = (await loadLinksByCollection([collectionId])).get(collectionId) ?? [];

      QueryOptimizer.invalidateCache('sandwich-collections');
      await AuditLogger.logUpdate(
        'event_collection_links',
        `${id}:${collectionId}`,
        { linkedGroupIndexes: before.linkedGroupIndexes, wholeEntry: before.wholeEntry },
        { linkedGroupIndexes: wholeEntry ? [] : groupIndexes, wholeEntry },
        auditContext(req)
      );

      const [fresh] = await loadCollections([collectionId]);
      res.json(describeEntry(fresh ?? collection, event.organizationName || '', after, id));
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

      const removed = await db
        .delete(eventCollectionLinks)
        .where(
          and(eq(eventCollectionLinks.collectionId, collectionId), eq(eventCollectionLinks.eventRequestId, id))
        )
        .returning({ groupIndex: eventCollectionLinks.groupIndex });
      // Conditional on the old column still pointing at this event, so it can't
      // clear a link that has since moved to another event.
      const clearedLegacy = await db
        .update(sandwichCollections)
        .set({ eventRequestId: null })
        .where(and(eq(sandwichCollections.id, collectionId), eq(sandwichCollections.eventRequestId, id)))
        .returning({ id: sandwichCollections.id });

      if (removed.length === 0 && clearedLegacy.length === 0) {
        return res.status(404).json({ message: 'That collection entry is not linked to this event' });
      }

      QueryOptimizer.invalidateCache('sandwich-collections');
      await AuditLogger.logUpdate(
        'event_collection_links',
        `${id}:${collectionId}`,
        { linkedGroupIndexes: removed.map((r) => r.groupIndex), legacyLink: clearedLegacy.length > 0 },
        { linkedGroupIndexes: [] },
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
