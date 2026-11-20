import { Router } from 'express';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import { storage } from '../../storage-wrapper';
import {
  requirePermission,
  requireOwnershipPermission,
} from '../../middleware/auth';
import { upload } from '../../middleware/uploads';
import { QueryOptimizer } from '../../performance/query-optimizer';
import { insertSandwichCollectionSchema } from '@shared/schema';
import historicalImportRouter from './historical-import';
import { logger } from '../../utils/production-safe-logger';
import { onboardingService } from '../../services/onboarding-service';
import { getSocketInstance } from '../../socket-chat';
import { AuditLogger, type AuditContext } from '../../audit-logger';

// Who made a change, for the audit log (same fields hosts.ts records).
function auditContext(req: any): AuditContext {
  return {
    userId: req.user?.id || req.session?.user?.id,
    ipAddress: req.ip,
    userAgent: req.get?.('user-agent'),
    sessionId: req.sessionID,
  };
}

const collectionsRouter = Router();

// Mount historical import routes
collectionsRouter.use('/historical-import', historicalImportRouter);

// Clear all caches - use after direct database changes
collectionsRouter.post('/clear-cache', async (req, res) => {
  try {
    QueryOptimizer.invalidateCache('sandwich-collections');
    QueryOptimizer.invalidateCache('sandwich-collections-stats');
    res.json({ message: 'All sandwich collection caches cleared successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to clear cache' });
  }
});

// Hybrid Stats - Authoritative data + Collection Log
// Delegates to server/services/collections/hybrid-stats.ts so the AI chat
// historical context and this route compute annual totals the same way.
collectionsRouter.get('/hybrid-stats', async (req, res) => {
  try {
    const stats = await QueryOptimizer.getCachedQuery(
      'hybrid-collection-stats',
      async () => {
        const { getHybridYearlyStats } = await import('../../services/collections/hybrid-stats');
        return getHybridYearlyStats();
      },
      60000 // Cache for 1 minute
    );

    res.json(stats);
  } catch (error) {
    logger.error('Failed to fetch hybrid collection stats:', error);
    res.status(500).json({ message: 'Failed to fetch hybrid collection stats' });
  }
});

// Sandwich Collections Stats - Complete totals including individual + group collections (Optimized)
collectionsRouter.get('/stats', async (req, res) => {
  try {
    const stats = await QueryOptimizer.getCachedQuery(
      'sandwich-collections-stats',
      async () => {
        const collections = await storage.getAllSandwichCollections();

        let individualTotal = 0;
        let groupTotal = 0;
        let ytdTotal = 0;
        let currentMonthTotal = 0;
        let lastMonthTotal = 0;
        // YoY comparisons: total sandwiches for the SAME month last year
        // (full month) and the running total through TODAY'S day-of-month
        // last year. The to-date number is what the client compares against
        // so the trend signal stays apples-to-apples: "June 1–16 this year
        // vs June 1–16 last year" instead of partial-vs-complete.
        let lastYearSameMonthTotal = 0;
        let lastYearSameMonthToDateTotal = 0;

        // Use Eastern Time to determine current month/year/day
        // (server may be in UTC where it could already be the next month)
        const now = new Date();
        const easternDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const currentYear = easternDate.getFullYear();
        const currentMonth = easternDate.getMonth(); // 0-indexed
        const currentDayOfMonth = easternDate.getDate(); // 1..31

        // Calculate last month (handles January -> December of prior year)
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1; // 0-indexed
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        // YoY same-month bookkeeping. Always the previous calendar year for
        // the SAME month we're currently in (no special-case wraparound
        // needed because we're not crossing a year boundary here).
        const yoyYear = currentYear - 1;
        const yoyMonth = currentMonth;

        function getCollectionTotal(collection: any): number {
          let total = collection.individualSandwiches || 0;
          if (
            collection.groupCollections &&
            Array.isArray(collection.groupCollections) &&
            collection.groupCollections.length > 0
          ) {
            total += collection.groupCollections.reduce(
              (sum: number, group: any) => sum + (group.count || 0),
              0
            );
          } else {
            total += (collection.group1Count || 0) + (collection.group2Count || 0);
          }
          return total;
        }

        collections.forEach((collection) => {
          individualTotal += collection.individualSandwiches || 0;

          // Calculate group total using standardized method: groupCollections JSONB with fallback to legacy columns
          let collectionGroupTotal = 0;

          // Primary: Use groupCollections JSONB array if available and non-empty
          if (
            collection.groupCollections &&
            Array.isArray(collection.groupCollections) &&
            collection.groupCollections.length > 0
          ) {
            collectionGroupTotal = collection.groupCollections.reduce(
              (sum: number, group: any) => {
                return sum + (group.count || 0);
              },
              0
            );
          }
          // Fallback: Use legacy group1Count + group2Count for older records
          else {
            collectionGroupTotal =
              (collection.group1Count || 0) + (collection.group2Count || 0);
          }

          groupTotal += collectionGroupTotal;

          // Year-to-date and current month calculations
          if (collection.collectionDate) {
            const dateParts = String(collection.collectionDate).split('-');
            const year = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10) - 1; // 0-indexed
            const day = parseInt(dateParts[2], 10); // 1..31
            if (year === currentYear) {
              const collTotal = getCollectionTotal(collection);
              ytdTotal += collTotal;
              if (month === currentMonth) {
                currentMonthTotal += collTotal;
              }
            }
            // Last month total (handles year boundary: Jan -> Dec of prior year)
            if (year === lastMonthYear && month === lastMonth) {
              lastMonthTotal += getCollectionTotal(collection);
            }
            // Same month, last year (for YoY comparisons). The "to date"
            // running total uses the SAME day-of-month as today so the
            // comparison stays apples-to-apples: June 1–16 vs June 1–16.
            if (year === yoyYear && month === yoyMonth) {
              const collTotal = getCollectionTotal(collection);
              lastYearSameMonthTotal += collTotal;
              if (day <= currentDayOfMonth) {
                lastYearSameMonthToDateTotal += collTotal;
              }
            }
          }
        });

        // Data recovery completed: 148,907 sandwiches recovered, exceeding the 50K adjustment
        // Removing temporary adjustment since actual missing data was recovered

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];

        return {
          totalEntries: collections.length,
          individualSandwiches: individualTotal,
          groupSandwiches: groupTotal,
          completeTotalSandwiches: individualTotal + groupTotal,
          ytdSandwiches: ytdTotal,
          ytdYear: currentYear,
          currentMonthSandwiches: currentMonthTotal,
          currentMonthName: monthNames[currentMonth],
          currentMonthYear: currentYear,
          currentDayOfMonth, // The day-of-month the YoY-to-date number is keyed to
          lastMonthSandwiches: lastMonthTotal,
          lastMonthName: monthNames[lastMonth],
          lastMonthYear: lastMonthYear,
          // Year-over-year (same month). The "to date" total is for the
          // same calendar window (day 1 → today's day-of-month) of last
          // year so it lines up apples-to-apples with currentMonthSandwiches.
          lastYearSameMonthSandwiches: lastYearSameMonthTotal,
          lastYearSameMonthToDateSandwiches: lastYearSameMonthToDateTotal,
          lastYearSameMonthName: monthNames[yoyMonth],
          lastYearSameMonthYear: yoyYear,
        };
      },
      60000 // Cache for 1 minute since this data doesn't change frequently
    );

    res.json(stats);
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Failed to fetch sandwich collection stats' });
  }
});

// Sandwich Collections
collectionsRouter.get('/', async (req, res) => {
  try {
    // Event-scoped view: return the (unpaginated) collections linked to a single
    // event request as a bare array. Used by the event Collection Log dialog.
    const rawEventRequestId = req.query.eventRequestId;
    if (rawEventRequestId !== undefined) {
      // Strict parse: only accept a positive-integer string. parseInt would
      // accept '123abc' as 123 and arrays would slip through `as string`.
      if (
        typeof rawEventRequestId !== 'string' ||
        !/^\d+$/.test(rawEventRequestId)
      ) {
        return res.status(400).json({ message: 'Invalid eventRequestId' });
      }
      const eventRequestId = Number(rawEventRequestId);
      const eventCollections =
        await storage.getSandwichCollectionsByEventRequestId(eventRequestId);
      return res.json(eventCollections);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const sortField = (req.query.sort as string) || 'collectionDate';
    const sortOrder = (req.query.order as string) || 'desc';

    logger.log(`[Collections API] GET request - page: ${page}, limit: ${limit}, sort: ${sortField}, order: ${sortOrder}`);

    const result = await storage.getSandwichCollections(
      limit,
      offset,
      sortField,
      sortOrder
    );
    const totalCount = await storage.getSandwichCollectionsCount();

    logger.log(`[Collections API] Found ${result.length} collections, total count: ${totalCount}`);

    res.json({
      collections: result,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page < Math.ceil(totalCount / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    logger.error('[Collections API] Error fetching collections:', error);
    res.status(500).json({ message: 'Failed to fetch sandwich collections' });
  }
});

collectionsRouter.post(
  '/',
  requirePermission('COLLECTIONS_ADD'),
  async (req, res) => {
    try {
      // CRITICAL BUG FIX: Handle unlimited groups using new JSONB column
      let processedBody = { ...req.body };

      // If groupCollections array is provided, store all groups in JSONB column
      if (
        req.body.groupCollections &&
        Array.isArray(req.body.groupCollections)
      ) {
        const groups = req.body.groupCollections;

        // Store ALL groups in the new JSONB column
        processedBody.groupCollections = groups;

        // Also set first two groups in legacy format for backward compatibility
        if (groups.length > 0) {
          processedBody.group1Name = groups[0].name || '';
          processedBody.group1Count = groups[0].count || 0;
        }
        if (groups.length > 1) {
          processedBody.group2Name = groups[1].name || '';
          processedBody.group2Count = groups[1].count || 0;
        }
      }

      const collectionData =
        insertSandwichCollectionSchema.parse(processedBody);

      // Add user attribution to the collection
      const user = req.user || req.session?.user;
      const enrichedCollectionData = {
        ...collectionData,
        createdBy: user?.id || 'unknown',
        createdByName:
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.email || 'Unknown User',
      };

      const collection = await storage.createSandwichCollection(
        enrichedCollectionData
      );

      // Invalidate cache when new collection is created
      QueryOptimizer.invalidateCache('sandwich-collections');
      QueryOptimizer.invalidateCache('sandwich-collections-stats');

      // Broadcast real-time update to all connected clients
      try {
        const io = getSocketInstance();
        if (io) {
          io.emit('collections:updated', {
            collectionId: collection.id,
            trigger: 'create',
            timestamp: new Date().toISOString(),
          });
          logger.log('[Collections] Real-time update broadcast sent');
        }
      } catch (socketError) {
        logger.error('[Collections] Failed to emit socket event:', socketError);
        // Don't fail collection creation if socket broadcast fails
      }

      // Track onboarding challenge completion for submitting a collection log
      if (user?.id) {
        try {
          await onboardingService.trackChallengeCompletion(
            user.id,
            'submit_collection_log'
          );
        } catch (onboardingError) {
          logger.error('Error tracking onboarding challenge:', onboardingError);
          // Don't fail collection creation if onboarding tracking fails
        }
      }

      // Check for sandwich collection milestones
      try {
        const allCollections = await storage.getAllSandwichCollections();

        // Helper to calculate collection total (use EITHER groupCollections OR group1/group2)
        const getCollectionTotal = (c: any) => {
          const individual = c.individualSandwiches || 0;
          let groupTotal = 0;
          if (c.groupCollections && Array.isArray(c.groupCollections) && c.groupCollections.length > 0) {
            groupTotal = c.groupCollections.reduce((sum: number, g: any) => sum + (g.count || 0), 0);
          } else {
            groupTotal = (c.group1Count || 0) + (c.group2Count || 0);
          }
          return individual + groupTotal;
        };

        const totalSandwiches = allCollections.reduce((sum, c) => sum + getCollectionTotal(c), 0);

        // Define milestones
        const milestones = [1000, 5000, 10000, 25000, 50000, 75000, 100000];
        const previousTotal = totalSandwiches - getCollectionTotal(collection);

        // Check if we just crossed a milestone
        const crossedMilestone = milestones.find(m => previousTotal < m && totalSandwiches >= m);

        if (crossedMilestone) {
          // Get all admin users to notify
          const allUsers = await storage.getAllUsers();
          const adminUsers = allUsers.filter((u: any) =>
            u.isActive && (u.role === 'admin' || u.role === 'super_admin')
          );

          for (const admin of adminUsers) {
            try {
              await storage.createNotification({
                userId: admin.id,
                type: 'milestone',
                priority: 'high',
                title: `🎉 Milestone Reached: ${crossedMilestone.toLocaleString()} Sandwiches!`,
                message: `Congratulations! The organization has now distributed ${totalSandwiches.toLocaleString()} sandwiches this year!`,
                category: 'updates',
                relatedType: 'collection',
                actionUrl: '/dashboard?section=analytics',
                actionText: 'View Analytics',
                metadata: {
                  milestone: crossedMilestone,
                  totalSandwiches,
                  shareText: `🎉 The Sandwich Project just hit ${crossedMilestone.toLocaleString()} sandwiches! We've now distributed ${totalSandwiches.toLocaleString()} sandwiches this year.`,
                },
              });
            } catch (notifError) {
              logger.error(`Failed to create milestone notification for ${admin.id}:`, notifError);
            }
          }
        }
      } catch (milestoneError) {
        logger.error('Error checking sandwich milestones:', milestoneError);
        // Don't fail collection creation if milestone check fails
      }

      res.status(201).json(collection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Invalid sandwich collection input', {
          error: error.errors,
          ip: req.ip,
        });
        res
          .status(400)
          .json({ message: 'Invalid collection data', errors: error.errors });
      } else {
        logger.error('Failed to create sandwich collection', error);
        res.status(500).json({ message: 'Failed to create collection' });
      }
    }
  }
);

// =============================================================================
// IMPORTANT: All named routes (e.g., /analyze-duplicates, /batch-delete) MUST
// be defined BEFORE the /:id route, otherwise Express will match them as IDs
// =============================================================================

// Audit cleanup impact - identify what was changed by data cleanup
collectionsRouter.get('/audit-cleanup-impact', async (req, res) => {
  try {
    const collections = await storage.getAllSandwichCollections();

    // Helper to calculate total sandwiches
    // CRITICAL: Use EITHER groupCollections OR group1/group2, never both to prevent double counting
    const calculateTotal = (c: any) => {
      const individual = c.individualSandwiches || 0;

      let groupTotal = 0;
      if (c.groupCollections && Array.isArray(c.groupCollections) && c.groupCollections.length > 0) {
        // NEW FORMAT: Use groupCollections JSON array
        groupTotal = c.groupCollections.reduce((sum: number, g: any) => sum + (g.count || 0), 0);
      } else {
        // LEGACY FORMAT: Use old group1Count and group2Count fields
        groupTotal = (c.group1Count || 0) + (c.group2Count || 0);
      }

      return individual + groupTotal;
    };

    // Find records with individual=0 but have group totals (potential Fix #1 victims)
    const zeroIndividualWithGroups = collections.filter((c) => {
      const individual = Number(c.individualSandwiches) || 0;
      const groupTotal = (c.group1Count || 0) + (c.group2Count || 0);
      return individual === 0 && groupTotal > 0 && c.hostName !== 'Groups';
    });

    // Find current records where individual == groupTotal (would trigger Fix #1 if enabled)
    const equalIndividualAndGroup = collections.filter((c) => {
      const individual = Number(c.individualSandwiches) || 0;
      const groupTotal = (c.group1Count || 0) + (c.group2Count || 0);
      return individual > 0 && groupTotal > 0 && individual === groupTotal;
    });

    // Check "Groups" entries status
    const groupsEntries = collections.filter((c) =>
      c.hostName === 'Groups' || c.hostName === 'groups'
    );

    const groupsWithIndividual = groupsEntries.filter((c) =>
      (c.individualSandwiches || 0) > 0
    );

    res.json({
      totalCollections: collections.length,
      potentialFix1Victims: {
        count: zeroIndividualWithGroups.length,
        description: 'Records with individual=0 and group totals (may have been modified by cleanup)',
        records: zeroIndividualWithGroups.slice(0, 100).map((c) => ({
          id: c.id,
          hostName: c.hostName,
          collectionDate: c.collectionDate,
          individual: c.individualSandwiches || 0,
          groupTotal: (c.group1Count || 0) + (c.group2Count || 0),
          total: calculateTotal(c),
          submittedAt: c.submittedAt,
          createdBy: c.createdBy,
          note: 'Individual count may have been removed by cleanup if it matched group total',
        })),
      },
      currentEqualCounts: {
        count: equalIndividualAndGroup.length,
        description: 'Current records where individual equals group total',
        records: equalIndividualAndGroup.map((c) => ({
          id: c.id,
          hostName: c.hostName,
          collectionDate: c.collectionDate,
          individual: c.individualSandwiches,
          groupTotal: (c.group1Count || 0) + (c.group2Count || 0),
          submittedAt: c.submittedAt,
          note: 'SAFE NOW - Fix #1 is disabled so these will not be modified',
        })),
      },
      groupsEntriesStatus: {
        total: groupsEntries.length,
        clean: groupsEntries.length - groupsWithIndividual.length,
        needsFix: groupsWithIndividual.length,
        problematicRecords: groupsWithIndividual.map((c) => ({
          id: c.id,
          individual: c.individualSandwiches,
          groupTotal: (c.group1Count || 0) + (c.group2Count || 0),
          submittedAt: c.submittedAt,
          note: 'Groups entry with individual count - should be moved to group data',
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to audit cleanup impact:', error);
    res.status(500).json({ message: 'Failed to audit cleanup impact' });
  }
});

// Analyze duplicates in sandwich collections
collectionsRouter.get('/analyze-duplicates', async (req, res) => {
  try {
    const collections = await storage.getAllSandwichCollections();

    // Helper function to calculate total sandwiches
    const calculateTotal = (c: any) => {
      const individual = c.individualSandwiches || 0;
      const group1 = c.group1Count || 0;
      const group2 = c.group2Count || 0;
      const groupCollections = Array.isArray(c.groupCollections)
        ? c.groupCollections.reduce((sum: number, g: any) => sum + (g.count || 0), 0)
        : 0;
      return individual + group1 + group2 + groupCollections;
    };

    // Group by date, host, and sandwich counts to find exact duplicates
    const duplicateGroups = new Map();
    const nearDuplicates = new Map(); // For entries that are VERY similar but not exact
    const suspiciousPatterns = [];
    const ogDuplicates = [];

    collections.forEach((collection) => {
      // Extract group names for duplicate detection
      let groupNames = '';
      if (Array.isArray(collection.groupCollections) && collection.groupCollections.length > 0) {
        // Use new groupCollections array - extract and sort group names
        const names = collection.groupCollections
          .map((g: any) => g.name || '')
          .filter((name: string) => name.trim() !== '')
          .sort()
          .join(',');
        groupNames = names;
      } else {
        // Fall back to legacy group1Name and group2Name
        const names = [collection.group1Name, collection.group2Name]
          .filter((name: any) => name && name.trim() !== '')
          .sort()
          .join(',');
        groupNames = names;
      }

      // Calculate total sandwiches (individual + all group counts)
      const totalSandwiches = calculateTotal(collection);

      // Create duplicate key: same date + same group names + same individual count + same total count
      // This ensures we only flag TRUE duplicates (same everything)
      const key = `${collection.collectionDate}-${groupNames}-${collection.individualSandwiches || 0}-${totalSandwiches}`;

      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key).push(collection);

      // Near-duplicate detection: same date, host, and total sandwiches (within 5%)
      const total = calculateTotal(collection);
      const nearKey = `${collection.collectionDate}-${collection.hostName}`;

      if (!nearDuplicates.has(nearKey)) {
        nearDuplicates.set(nearKey, []);
      }
      nearDuplicates.get(nearKey).push({ collection, total });

      // Check for suspicious patterns - ONLY truly problematic entries
      const hostName = (collection.hostName || '').toLowerCase().trim();
      if (
        hostName.startsWith('loc ') ||
        hostName.match(/^group \d+(-\d+)?$/) ||
        hostName.match(/^loc\d+$/) ||
        hostName === 'test' ||
        hostName.includes('test') ||
        hostName.includes('duplicate') ||
        hostName.includes('unknown') ||
        hostName.includes('no location') ||
        hostName === '' ||
        hostName === 'null' ||
        // Check for obviously incorrect host names
        hostName.length < 3 ||
        hostName.match(/^\d+$/) || // Pure numbers
        hostName.match(/^[a-z]{1,2}$/) // Single/double letters
      ) {
        suspiciousPatterns.push(collection);
      }
    });

    // Find OG Sandwich Project duplicates with early collections
    const ogCollections = collections.filter(
      (c) => c.hostName === 'OG Sandwich Project'
    );
    const earlyCollections = collections.filter(
      (c) =>
        c.hostName !== 'OG Sandwich Project' &&
        (c.hostName === '' ||
          c.hostName === null ||
          c.hostName.trim() === '' ||
          c.hostName.toLowerCase().includes('unknown') ||
          c.hostName.toLowerCase().includes('no location'))
    );

    const ogMap = new Map();
    ogCollections.forEach((og) => {
      const key = `${og.collectionDate}-${og.individualSandwiches}`;
      if (!ogMap.has(key)) {
        ogMap.set(key, []);
      }
      ogMap.get(key).push(og);
    });

    earlyCollections.forEach((early) => {
      const key = `${early.collectionDate}-${early.individualSandwiches}`;
      if (ogMap.has(key)) {
        const ogEntries = ogMap.get(key);
        ogDuplicates.push({
          ogEntry: ogEntries[0],
          earlyEntry: early,
          reason: 'Same date and sandwich count as OG Project entry',
        });
      }
    });

    // Also find duplicate OG entries
    ogMap.forEach((ogGroup) => {
      if (ogGroup.length > 1) {
        const sorted = ogGroup.sort(
          (a, b) =>
            new Date(b.submittedAt).getTime() -
            new Date(a.submittedAt).getTime()
        );
        sorted.slice(1).forEach((duplicate) => {
          ogDuplicates.push({
            ogEntry: sorted[0],
            duplicateOgEntry: duplicate,
            reason: 'Duplicate OG Project entry',
          });
        });
      }
    });

    // Find actual duplicates (groups with more than 1 entry)
    const duplicates = Array.from(duplicateGroups.values())
      .filter((group) => group.length > 1)
      .map((group) => {
        // Sort by submission date to keep the newest
        const sorted = group.sort(
          (a, b) =>
            new Date(b.submittedAt).getTime() -
            new Date(a.submittedAt).getTime()
        );
        
        const keepEntry = sorted[0];
        const deleteEntries = sorted.slice(1);
        
        // Extract group names for display
        const extractGroupNames = (c: any) => {
          if (Array.isArray(c.groupCollections) && c.groupCollections.length > 0) {
            return c.groupCollections.map((g: any) => g.name).filter((n: string) => n).join(', ');
          } else {
            return [c.group1Name, c.group2Name].filter((n: any) => n && n.trim()).join(', ');
          }
        };
        
        return {
          entries: group,
          count: group.length,
          duplicateInfo: {
            collectionDate: keepEntry.collectionDate,
            groupNames: extractGroupNames(keepEntry),
            individualSandwiches: keepEntry.individualSandwiches || 0,
            totalSandwiches: calculateTotal(keepEntry),
          },
          keepNewest: {
            id: keepEntry.id,
            submittedAt: keepEntry.submittedAt,
            createdBy: keepEntry.createdByName || keepEntry.createdBy || 'Unknown',
            individualSandwiches: keepEntry.individualSandwiches || 0,
            groupNames: extractGroupNames(keepEntry),
            totalSandwiches: calculateTotal(keepEntry),
          },
          toDelete: deleteEntries.map((c: any) => ({
            id: c.id,
            submittedAt: c.submittedAt,
            createdBy: c.createdByName || c.createdBy || 'Unknown',
            individualSandwiches: c.individualSandwiches || 0,
            groupNames: extractGroupNames(c),
            totalSandwiches: calculateTotal(c),
          })),
        };
      });

    // Find near-duplicates: same date & host but slightly different totals
    const potentialNearDuplicates: any[] = [];
    nearDuplicates.forEach((group) => {
      if (group.length > 1) {
        // Check if any entries are within 10% of each other or exact same total
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const entry1 = group[i];
            const entry2 = group[j];

            // Check if totals are the same or within 10%
            const diff = Math.abs(entry1.total - entry2.total);
            const avg = (entry1.total + entry2.total) / 2;
            const percentDiff = avg > 0 ? (diff / avg) * 100 : 0;

            if (entry1.total === entry2.total || percentDiff <= 10) {
              // Check if they're not already in exact duplicates
              const isDuplicate = duplicates.some((dup) =>
                dup.entries.some(
                  (e: any) =>
                    e.id === entry1.collection.id || e.id === entry2.collection.id
                )
              );

              if (!isDuplicate) {
                potentialNearDuplicates.push({
                  entry1: entry1.collection,
                  entry2: entry2.collection,
                  total1: entry1.total,
                  total2: entry2.total,
                  difference: diff,
                  percentDifference: percentDiff.toFixed(1),
                  reason:
                    entry1.total === entry2.total
                      ? 'Exact same total sandwiches'
                      : `${percentDiff.toFixed(1)}% difference`,
                });
              }
            }
          }
        }
      }
    });

    res.json({
      totalCollections: collections.length,
      duplicateGroups: duplicates.length,
      totalDuplicateEntries: duplicates.reduce(
        (sum, group) => sum + group.toDelete.length,
        0
      ),
      suspiciousPatterns: suspiciousPatterns.length,
      ogDuplicates: ogDuplicates.length,
      nearDuplicates: potentialNearDuplicates.length,
      duplicates,
      suspiciousEntries: suspiciousPatterns,
      ogDuplicateEntries: ogDuplicates,
      nearDuplicateEntries: potentialNearDuplicates,
    });
  } catch (error) {
    logger.error('Failed to analyze duplicates', error);
    res.status(500).json({ message: 'Failed to analyze duplicates' });
  }
});

// Bulk delete sandwich collections (must be before :id route)
collectionsRouter.delete('/bulk', async (req, res) => {
  try {
    const collections = await storage.getAllSandwichCollections();
    const collectionsToDelete = collections.filter((collection) => {
      const hostName = collection.hostName;
      return hostName.startsWith('Loc ') || /^Group [1-8]/.test(hostName);
    });

    let deletedCount = 0;
    // Delete in reverse order by ID to maintain consistency
    const sortedCollections = collectionsToDelete.sort((a, b) => b.id - a.id);

    for (const collection of sortedCollections) {
      try {
        const deleted = await storage.deleteSandwichCollection(collection.id);
        if (deleted) {
          deletedCount++;
        }
      } catch (error) {
        logger.error(`Failed to delete collection ${collection.id}:`, error);
      }
    }

    res.json({
      message: `Successfully deleted ${deletedCount} duplicate entries`,
      deletedCount,
      patterns: ['Loc *', 'Group 1-8'],
    });
  } catch (error) {
    logger.error('Failed to bulk delete sandwich collections', error);
    res.status(500).json({ message: 'Failed to delete duplicate entries' });
  }
});

// Clean selected suspicious entries from sandwich collections
collectionsRouter.delete(
  '/clean-selected',
  requirePermission('DATA_EXPORT'),
  async (req, res) => {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Invalid or empty IDs array' });
      }

      let deletedCount = 0;
      for (const id of ids) {
        try {
          await storage.deleteSandwichCollection(id);
          deletedCount++;
        } catch (error) {
          logger.warn(`Failed to delete collection ${id}:`, error);
        }
      }

      res.json({
        message: `Successfully deleted ${deletedCount} selected entries`,
        deletedCount,
      });
    } catch (error) {
      logger.error('Failed to delete selected suspicious entries:', error);
      res.status(500).json({ message: 'Failed to delete selected entries' });
    }
  }
);

// Clean duplicates from sandwich collections
collectionsRouter.delete(
  '/clean-duplicates',
  requirePermission('DATA_EXPORT'),
  async (req, res) => {
    try {
      const { mode = 'exact' } = req.body; // 'exact', 'suspicious', or 'og-duplicates'
      const collections = await storage.getAllSandwichCollections();

      let collectionsToDelete = [];

      if (mode === 'exact') {
        // Find exact duplicates based on date, host, and counts
        const duplicateGroups = new Map();

        collections.forEach((collection) => {
          const key = `${collection.collectionDate}-${collection.hostName}-${collection.individualSandwiches}-${collection.groupCollections}`;

          if (!duplicateGroups.has(key)) {
            duplicateGroups.set(key, []);
          }
          duplicateGroups.get(key).push(collection);
        });

        // Keep only the newest entry from each duplicate group
        duplicateGroups.forEach((group) => {
          if (group.length > 1) {
            const sorted = group.sort(
              (a, b) =>
                new Date(b.submittedAt).getTime() -
                new Date(a.submittedAt).getTime()
            );
            collectionsToDelete.push(...sorted.slice(1)); // Keep first (newest), delete rest
          }
        });
      } else if (mode === 'suspicious') {
        // Remove entries with suspicious patterns (improved detection)
        collectionsToDelete = collections.filter((collection) => {
          const hostName = (collection.hostName || '').toLowerCase().trim();
          return (
            hostName.startsWith('loc ') ||
            hostName.startsWith('group ') ||
            hostName.match(/^group \d+(-\d+)?$/) ||
            hostName.match(/^loc\d+$/) ||
            hostName === 'groups' ||
            hostName === 'test' ||
            hostName.includes('test') ||
            hostName.includes('duplicate') ||
            hostName.includes('unknown') ||
            hostName.includes('no location') ||
            hostName === '' ||
            hostName === 'null' ||
            // Check for obviously incorrect host names
            hostName.length < 3 ||
            hostName.match(/^\d+$/) || // Pure numbers
            hostName.match(/^[a-z]{1,2}$/) // Single/double letters
          );
        });
      }

      let deletedCount = 0;
      const errors = [];

      // Delete in reverse order by ID to maintain consistency
      const sortedCollections = collectionsToDelete.sort((a, b) => b.id - a.id);

      for (const collection of sortedCollections) {
        try {
          // Ensure ID is a valid number
          const id = Number(collection.id);
          if (isNaN(id)) {
            errors.push(`Invalid collection ID: ${collection.id}`);
            continue;
          }

          const deleted = await storage.deleteSandwichCollection(id);
          if (deleted) {
            deletedCount++;
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          errors.push(
            `Failed to delete collection ${collection.id}: ${errorMessage}`
          );
          logger.error(`Failed to delete collection ${collection.id}:`, error);
        }
      }

      res.json({
        message: `Successfully cleaned ${deletedCount} duplicate entries using ${mode} mode`,
        deletedCount,
        totalFound: collectionsToDelete.length,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
        mode,
      });
    } catch (error) {
      logger.error('Failed to clean duplicates', error);
      res.status(500).json({ message: 'Failed to clean duplicate entries' });
    }
  }
);

// Batch delete sandwich collections
collectionsRouter.delete('/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Invalid or empty IDs array' });
    }

    let deletedCount = 0;
    const errors = [];

    // Delete in reverse order to maintain consistency
    const sortedIds = ids.sort((a, b) => b - a);

    for (const id of sortedIds) {
      try {
        const deleted = await storage.deleteSandwichCollection(id);
        if (deleted) {
          deletedCount++;
        } else {
          errors.push(`Collection with ID ${id} not found`);
        }
      } catch (error) {
        errors.push(
          `Failed to delete collection ${id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    res.json({
      message: `Successfully deleted ${deletedCount} of ${ids.length} collections`,
      deletedCount,
      totalRequested: ids.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    });
  } catch (error) {
    logger.error('Failed to batch delete collections', error);
    res.status(500).json({ message: 'Failed to batch delete collections' });
  }
});

// Batch edit sandwich collections
collectionsRouter.patch(
  '/batch-edit',
  requirePermission('DATA_EXPORT'),
  async (req, res) => {
    try {
      const { ids, updates } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Invalid or empty IDs array' });
      }

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'No updates provided' });
      }

      let updatedCount = 0;
      const errors = [];

      for (const id of ids) {
        try {
          const updated = await storage.updateSandwichCollection(id, updates);
          if (updated) {
            updatedCount++;
          } else {
            errors.push(`Collection with ID ${id} not found`);
          }
        } catch (error) {
          errors.push(
            `Failed to update collection ${id}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }

      res.json({
        message: `Successfully updated ${updatedCount} of ${ids.length} collections`,
        updatedCount,
        totalRequested: ids.length,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      });
    } catch (error) {
      logger.error('Failed to batch edit collections', error);
      res.status(500).json({ message: 'Failed to batch edit collections' });
    }
  }
);

// Group collections for Event Impact Reports
// Returns group collections - both linked and unlinked to event requests
// This ensures we capture all group sandwich data for reporting
collectionsRouter.get('/unlinked-groups', async (req, res) => {
  try {
    const collections = await storage.getAllSandwichCollections();

    // Filter for collections with group data (regardless of event linkage)
    const groupCollections = collections.filter((collection) => {
      // Skip soft-deleted records
      if (collection.deletedAt) return false;

      // Check for group data in JSONB column
      const hasJsonbGroups = collection.groupCollections &&
        Array.isArray(collection.groupCollections) &&
        collection.groupCollections.length > 0 &&
        collection.groupCollections.some((g: any) => (g.count || 0) > 0);

      // Check for legacy group columns
      const hasLegacyGroups = (collection.group1Count || 0) > 0 ||
                              (collection.group2Count || 0) > 0;

      return hasJsonbGroups || hasLegacyGroups;
    });

    logger.info(`Group collections found: ${groupCollections.length} total`);

    // Transform to match event request shape for the report
    const transformedCollections = groupCollections.map((collection) => {
      // Calculate total group sandwiches
      let groupSandwichCount = 0;
      let groupNames: string[] = [];

      if (collection.groupCollections && Array.isArray(collection.groupCollections) && collection.groupCollections.length > 0) {
        groupSandwichCount = collection.groupCollections.reduce(
          (sum: number, group: any) => sum + (group.count || 0), 0
        );
        groupNames = collection.groupCollections
          .map((g: any) => g.name)
          .filter((n: string) => n && n.trim());
      } else {
        // Legacy columns
        groupSandwichCount = (collection.group1Count || 0) + (collection.group2Count || 0);
        if (collection.group1Name) groupNames.push(collection.group1Name);
        if (collection.group2Name) groupNames.push(collection.group2Name);
      }

      return {
        id: `collection-${collection.id}`, // Prefix to avoid ID collision with events
        collectionId: collection.id,
        eventRequestId: collection.eventRequestId, // Include for deduplication
        collectionDate: collection.collectionDate,
        scheduledEventDate: collection.collectionDate, // Map to expected field
        organizationName: groupNames.length > 0 ? groupNames[0] : collection.hostName,
        groupNames: groupNames,
        actualSandwichCount: groupSandwichCount,
        estimatedSandwichCount: groupSandwichCount,
        status: 'completed', // Collections are always completed
        source: 'collection', // Flag to identify source
        hostName: collection.hostName,
        submittedAt: collection.submittedAt,
        createdBy: collection.createdBy,
        createdByName: collection.createdByName,
      };
    });

    res.json(transformedCollections);
  } catch (error) {
    logger.error('Failed to fetch group collections:', error);
    res.status(500).json({ message: 'Failed to fetch group collections' });
  }
});

// =============================================================================
// PARAMETERIZED ROUTES - These MUST come AFTER all named routes above
// =============================================================================

// GET individual sandwich collection by ID
collectionsRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid collection ID' });
    }

    const collection = await storage.getSandwichCollectionById(id);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    res.json(collection);
  } catch (error) {
    logger.error('Failed to fetch sandwich collection', error);
    res.status(500).json({ message: 'Failed to fetch collection' });
  }
});

collectionsRouter.put(
  '/:id',
  requireOwnershipPermission(
    'COLLECTIONS_EDIT_OWN',
    'COLLECTIONS_EDIT_ALL',
    async (req) => {
      const id = parseInt(req.params.id);
      const collection = await storage.getSandwichCollectionById(id);
      return collection?.createdBy || null;
    }
  ),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const collection = await storage.updateSandwichCollection(id, updates);
      if (!collection) {
        return res.status(404).json({ message: 'Collection not found' });
      }

      // Invalidate cache when collection is updated
      QueryOptimizer.invalidateCache('sandwich-collections');

      res.json(collection);
    } catch (error) {
      logger.error('Failed to update sandwich collection', error);
      res.status(400).json({ message: 'Invalid update data' });
    }
  }
);

// Fix data corruption in sandwich collections - MUST be before /:id route
collectionsRouter.patch(
  '/fix-data-corruption',
  requirePermission('COLLECTIONS_EDIT_ALL'),
  async (req, res) => {
    try {
      const collections = await storage.getAllSandwichCollections();
      let fixedCount = 0;
      const fixes = [];

      for (const collection of collections) {
        let needsUpdate = false;
        const updates: any = {};
        const fixType = [];

        // PHASE 5: Check group collections using new column structure
        const individual = Number(collection.individualSandwiches) || 0;
        const groupTotal =
          (collection.group1Count || 0) + (collection.group2Count || 0);

        // Fix 1: DISABLED - This fix was too aggressive
        // In the current workflow, locations can have BOTH individual sandwiches AND group sandwiches
        // It's possible (though rare) for the totals to coincidentally match
        // Example: 300 individual + a group that also made 300 is legitimate, not a duplicate
        // if (individual > 0 && groupTotal > 0 && individual === groupTotal) {
        //   updates.individualSandwiches = 0;
        //   needsUpdate = true;
        //   fixType.push('removed duplicate individual count');
        // }

        // Fix 2: Check if host name is "Groups" with individual count but no group data
        if (
          (collection.hostName === 'Groups' ||
            collection.hostName === 'groups') &&
          individual > 0 &&
          groupTotal === 0
        ) {
          // Move individual count to group data
          const newGroupData = [
            {
              name: 'Group',
              count: individual,
              groupName: 'Group',
              sandwichCount: individual,
            },
          ];
          updates.individualSandwiches = 0;
          updates.groupCollections = JSON.stringify(newGroupData);
          needsUpdate = true;
          fixType.push('moved individual count to group data for Groups entry');
        }

        if (needsUpdate) {
          try {
            await storage.updateSandwichCollection(collection.id, updates);
            fixedCount++;
            fixes.push({
              id: collection.id,
              hostName: collection.hostName,
              originalIndividual: individual,
              originalGroup: groupTotal,
              newIndividual:
                updates.individualSandwiches !== undefined
                  ? updates.individualSandwiches
                  : individual,
              newGroupData:
                updates.groupCollections || collection.groupCollections,
              fixType: fixType.join(', '),
            });
          } catch (updateError) {
            logger.warn(
              `Failed to fix collection ${collection.id}:`,
              updateError
            );
          }
        }
      }

      res.json({
        message: `Successfully fixed ${fixedCount} data corruption issues`,
        fixedCount,
        totalChecked: collections.length,
        fixes: fixes.slice(0, 10), // Return first 10 fixes for review
      });
    } catch (error) {
      logger.error('Failed to fix data corruption:', error);
      res.status(500).json({ message: 'Failed to fix data corruption' });
    }
  }
);

collectionsRouter.patch(
  '/:id',
  requireOwnershipPermission(
    'COLLECTIONS_EDIT_OWN',
    'COLLECTIONS_EDIT_ALL',
    async (req) => {
      const id = parseInt(req.params.id);
      const collection = await storage.getSandwichCollectionById(id);
      return collection?.createdBy || null;
    }
  ),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid collection ID' });
      }

      const updates = req.body;
      const collection = await storage.updateSandwichCollection(id, updates);
      if (!collection) {
        return res.status(404).json({ message: 'Collection not found' });
      }

      // Invalidate cache when collection is updated
      QueryOptimizer.invalidateCache('sandwich-collections');

      res.json(collection);
    } catch (error) {
      logger.error('Failed to patch sandwich collection', error);
      res.status(500).json({ message: 'Failed to update collection' });
    }
  }
);

// DELETE individual collection
collectionsRouter.delete(
  '/:id',
  requireOwnershipPermission(
    'COLLECTIONS_DELETE_OWN',
    'COLLECTIONS_DELETE_ALL',
    async (req) => {
      const id = parseInt(req.params.id);
      const collection = await storage.getSandwichCollectionById(id);
      return collection?.createdBy || collection?.userId || null;
    }
  ),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid collection ID' });
      }

      const deleted = await storage.deleteSandwichCollection(id, req.user?.id);
      if (!deleted) {
        return res.status(404).json({ message: 'Collection not found' });
      }

      // Invalidate cache when collection is deleted
      QueryOptimizer.invalidateCache('sandwich-collections');

      await AuditLogger.logDelete(
        'sandwich_collections',
        String(id),
        { id, deleted: false },
        auditContext(req)
      );

      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete sandwich collection', error);
      res.status(500).json({ message: 'Failed to delete collection' });
    }
  }
);

// Restore (undo delete) sandwich collection
collectionsRouter.post(
  '/:id/restore',
  requireOwnershipPermission(
    'COLLECTIONS_DELETE_OWN',
    'COLLECTIONS_DELETE_ALL',
    async (req) => {
      const id = parseInt(req.params.id);
      const collection = await storage.getSandwichCollectionById(id);
      return collection?.createdBy || collection?.userId || null;
    }
  ),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid collection ID' });
      }

      const restored = await storage.restoreSandwichCollection(id);
      if (!restored) {
        return res.status(404).json({ message: 'Collection not found or not deleted' });
      }

      // Invalidate cache when collection is restored
      QueryOptimizer.invalidateCache('sandwich-collections');

      await AuditLogger.logUpdate(
        'sandwich_collections',
        String(id),
        { id, deleted: true },
        { id, deleted: false },
        auditContext(req)
      );

      // Get the restored collection
      const collection = await storage.getSandwichCollectionById(id);

      res.json({ message: 'Collection restored successfully', collection });
    } catch (error) {
      logger.error('Failed to restore sandwich collection', error);
      res.status(500).json({ message: 'Failed to restore collection' });
    }
  }
);

export default collectionsRouter;
