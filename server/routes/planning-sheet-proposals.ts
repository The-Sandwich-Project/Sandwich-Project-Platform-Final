import { Router, Request, Response } from 'express';
import { db } from '../db';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { proposedSheetChanges, eventRequests, users } from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import {
  getPlanningSheetService,
  PLANNING_SHEET_COLUMNS,
  migrateProposedPlanningRow,
  type SheetPlacement,
} from '../planning-sheet-sync-service';
import { logger } from '../utils/production-safe-logger';
import type { AuthenticatedRequest } from '../types/express';

export function createPlanningSheetProposalsRouter(
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
  requirePermission: (permission: string) => (req: Request, res: Response, next: () => void) => void
) {
  const router = Router();

  // ============================================================================
  // IMPORTANT: Route ordering matters in Express!
  // Specific routes (like /preview/:eventId, /batch/approve) MUST come BEFORE
  // parameterized routes (like /:id) to avoid the param catching everything.
  // ============================================================================

  /**
   * GET /api/planning-sheet-proposals
   * Get all proposals with optional status filter
   */
  router.get('/', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status } = req.query;

      let query = db
        .select({
          id: proposedSheetChanges.id,
          eventRequestId: proposedSheetChanges.eventRequestId,
          targetSheetId: proposedSheetChanges.targetSheetId,
          targetSheetName: proposedSheetChanges.targetSheetName,
          targetRowIndex: proposedSheetChanges.targetRowIndex,
          changeType: proposedSheetChanges.changeType,
          fieldName: proposedSheetChanges.fieldName,
          currentValue: proposedSheetChanges.currentValue,
          proposedValue: proposedSheetChanges.proposedValue,
          proposedRowData: proposedSheetChanges.proposedRowData,
          proposedBy: proposedSheetChanges.proposedBy,
          proposedAt: proposedSheetChanges.proposedAt,
          proposalReason: proposedSheetChanges.proposalReason,
          status: proposedSheetChanges.status,
          reviewedBy: proposedSheetChanges.reviewedBy,
          reviewedAt: proposedSheetChanges.reviewedAt,
          reviewNotes: proposedSheetChanges.reviewNotes,
          appliedAt: proposedSheetChanges.appliedAt,
          applyError: proposedSheetChanges.applyError,
          // Join event info
          eventOrganization: eventRequests.organizationName,
          eventDate: eventRequests.scheduledEventDate,
        })
        .from(proposedSheetChanges)
        .leftJoin(eventRequests, eq(proposedSheetChanges.eventRequestId, eventRequests.id))
        .orderBy(desc(proposedSheetChanges.proposedAt));

      // Apply status filter if provided
      const proposals = status
        ? await query.where(eq(proposedSheetChanges.status, status as string))
        : await query;

      // Get proposer and reviewer names
      const userIds = new Set<string>();
      proposals.forEach(p => {
        if (p.proposedBy) userIds.add(p.proposedBy);
        if (p.reviewedBy) userIds.add(p.reviewedBy);
      });

      const userNames: Record<string, string> = {};
      if (userIds.size > 0) {
        const usersData = await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, Array.from(userIds)));

        usersData.forEach(u => {
          userNames[u.id] = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
        });
      }

      const enrichedProposals = proposals.map(p => ({
        ...p,
        proposedRowData: Array.isArray(p.proposedRowData)
          ? migrateProposedPlanningRow(p.proposedRowData as string[])
          : p.proposedRowData,
        proposedByName: p.proposedBy ? userNames[p.proposedBy] : null,
        reviewedByName: p.reviewedBy ? userNames[p.reviewedBy] : null,
      }));

      res.json(enrichedProposals);
    } catch (error) {
      logger.error('Error fetching proposals:', error);
      res.status(500).json({ error: 'Failed to fetch proposals' });
    }
  });

  /**
   * GET /api/planning-sheet-proposals/pending/count
   * Get count of pending proposals (for badge display)
   */
  router.get('/pending/count', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await db
        .select({ id: proposedSheetChanges.id })
        .from(proposedSheetChanges)
        .where(eq(proposedSheetChanges.status, 'pending'));

      res.json({ count: result.length });
    } catch (error) {
      logger.error('Error fetching pending count:', error);
      res.status(500).json({ error: 'Failed to fetch count' });
    }
  });

  /**
   * GET /api/planning-sheet-proposals/preview/:eventId
   * Preview what data would be sent to the sheet for an event
   * Also returns any matching rows currently in the sheet for comparison
   *
   * NOTE: This route MUST come before /:id to avoid "preview" being caught as an id
   */
  router.get('/preview/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { eventId } = req.params;

      const parsedEventId = Number.parseInt(eventId, 10);
      if (Number.isNaN(parsedEventId) || parsedEventId <= 0) {
        return res.status(400).json({ error: 'Invalid event id' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      let rowData = await service.eventToSheetRow(parsedEventId);

      if (!rowData) {
        return res.status(404).json({ error: 'Event not found' });
      }


      // Find matching row in the current sheet for side-by-side comparison
      let existingSheetRow = null;
      let potentialMatches: any[] = [];
      let placement: SheetPlacement | null = null;
      try {
        // One read feeds matching, placement, and duplicate detection. Reading
        // per step would triple the API calls and let the three answers be
        // based on different versions of the sheet.
        const allSheetRows = await service.readPlanningSheet();

        // Try exact match first
        existingSheetRow = await service.findMatchingRow(parsedEventId, allSheetRows);

        // If no exact match, look for potential matches (same org name or same date)
        if (!existingSheetRow) {
          // Where a new row would land, so the team can catch a bad placement
          // before pushing instead of discovering it in the sheet afterwards.
          placement = await service.previewPlacement(parsedEventId, allSheetRows);

          const proposedDate = rowData[0]; // Date column
          const proposedOrg = rowData[2]?.toLowerCase().trim(); // Group Name column

          potentialMatches = allSheetRows
            .filter(row => {
              const rowOrg = row.groupName?.toLowerCase().trim();
              const rowDate = row.date;
              // Match if same org OR same date (potential conflicts)
              return (proposedOrg && rowOrg && rowOrg.includes(proposedOrg.substring(0, 10))) ||
                     (proposedDate && rowDate === proposedDate);
            })
            .slice(0, 5) // Limit to 5 potential matches
            .map(row => ({
              rowIndex: row.rowIndex,
              date: row.date,
              groupName: row.groupName,
              staffing: row.staffing,
              estimateSandwiches: row.estimateSandwiches,
              contactName: row.contactName,
            }));
        }
      } catch (sheetError) {
        logger.warn('Could not fetch sheet data for comparison:', sheetError);
        // Continue without comparison data - non-fatal
      }

      // Build existingRawData array for per-column comparison in the UI
      let existingRawData: string[] | null = null;
      if (existingSheetRow) {
        existingRawData = service.planningSheetRowToRawArray(existingSheetRow);
        // Details is the planner's column: what the push would write keeps
        // their text and only updates the app's attendee line.
        rowData = (await service.eventToSheetRow(parsedEventId, existingRawData)) ?? rowData;
      }

      // Return both raw array and labeled data for UI display
      const labeledData: Record<string, string> = {};
      Object.entries(PLANNING_SHEET_COLUMNS).forEach(([key, index]) => {
        labeledData[key] = rowData![index] || '';
      });

      res.json({
        rawData: rowData,
        labeledData,
        columns: PLANNING_SHEET_COLUMNS,
        existingSheetRow: existingSheetRow ? {
          rowIndex: existingSheetRow.rowIndex,
          date: existingSheetRow.date,
          groupName: existingSheetRow.groupName,
          eventStartTime: existingSheetRow.eventStartTime,
          eventEndTime: existingSheetRow.eventEndTime,
          pickUpTime: existingSheetRow.pickUpTime,
          staffing: existingSheetRow.staffing,
          estimateSandwiches: existingSheetRow.estimateSandwiches,
          deliOrPbj: existingSheetRow.deliOrPbj,
          contactName: existingSheetRow.contactName,
          email: existingSheetRow.email,
          phone: existingSheetRow.phone,
          tspContact: existingSheetRow.tspContact,
          address: existingSheetRow.address,
        } : null,
        existingRawData,
        potentialMatches,
        placement,
      });
    } catch (error) {
      logger.error('Error previewing event data:', error);
      res.status(500).json({ error: 'Failed to preview event data' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/push-event/:eventId
   * Push an event directly to the Planning Sheet (no proposal workflow)
   * User sees preview first, then pushes immediately
   *
   * NOTE: This route MUST come before /:id to avoid "push-event" being caught as an id
   */
  router.post('/push-event/:eventId', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const parsedEventId = Number.parseInt(eventId, 10);
      if (Number.isNaN(parsedEventId) || parsedEventId <= 0) {
        return res.status(400).json({ error: 'Invalid event id' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      // Extract optional merge decisions for per-column conflict resolution
      const { mergeDecisions } = req.body || {};

      // Push directly to sheet
      const result = await service.pushEventDirectly(parsedEventId, userId, mergeDecisions);

      if (result.success) {
        // The event is now on the official planning sheet, so mark it "On Calendar".
        // Key the "first time" check off the timestamp itself (not the boolean): older
        // rows, manual toggles, or partial migrations can have addedToOfficialSheet=true
        // with a null timestamp, and we want to backfill the timestamp in that case so
        // the UI doesn't show "On Calendar" without a date.
        try {
          const [existing] = await db
            .select({ addedToOfficialSheetAt: eventRequests.addedToOfficialSheetAt })
            .from(eventRequests)
            .where(eq(eventRequests.id, parsedEventId));
          const setTimestamp = !existing?.addedToOfficialSheetAt;
          try {
            await db
              .update(eventRequests)
              .set({
                addedToOfficialSheet: true,
                ...(setTimestamp ? { addedToOfficialSheetAt: new Date() } : {}),
                updatedAt: new Date(),
              })
              .where(eq(eventRequests.id, parsedEventId));
          } catch (updateError) {
            // The addedToOfficialSheetAt column may not exist on this branch yet
            // (migration pending). Mirror the main PATCH path: retry with just the
            // boolean so "On Calendar" still flips true even if the timestamp can't persist.
            if (setTimestamp) {
              logger.warn(`Push mark On Calendar failed with timestamp for event ${parsedEventId}, retrying without it:`, updateError);
              await db
                .update(eventRequests)
                .set({ addedToOfficialSheet: true, updatedAt: new Date() })
                .where(eq(eventRequests.id, parsedEventId));
            } else {
              throw updateError;
            }
          }
        } catch (markError) {
          // Don't fail the push if the flag update hiccups — the sheet write already succeeded.
          logger.error(`Pushed event ${parsedEventId} to sheet but failed to mark On Calendar:`, markError);
        }

        res.json({
          success: true,
          message: result.message,
          rowIndex: result.rowIndex,
          isUpdate: result.isUpdate,
          placementNote: result.placementNote
        });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      logger.error('Error pushing event to sheet:', error);
      res.status(500).json({ error: 'Failed to push to Planning Sheet' });
    }
  });

  /**
   * GET /api/planning-sheet-proposals/sheet/read
   * Read current data from the Planning Sheet (for comparison/debugging)
   *
   * NOTE: This route MUST come before /:id to avoid "sheet" being caught as an id
   */
  router.get('/sheet/read', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      const rows = await service.readPlanningSheet();
      res.json({ rows, count: rows.length });
    } catch (error) {
      logger.error('Error reading Planning Sheet:', error);
      res.status(500).json({ error: 'Failed to read Planning Sheet' });
    }
  });

  /**
   * GET /api/planning-sheet-proposals/:id
   * Get a single proposal with full details
   *
   * NOTE: This parameterized route MUST come after specific routes like /preview/:eventId
   */
  router.get('/:id', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const [proposal] = await db
        .select()
        .from(proposedSheetChanges)
        .where(eq(proposedSheetChanges.id, parseInt(id)))
        .limit(1);

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
      }

      // Get event details if linked
      let eventDetails = null;
      if (proposal.eventRequestId) {
        const [event] = await db
          .select()
          .from(eventRequests)
          .where(eq(eventRequests.id, proposal.eventRequestId))
          .limit(1);
        eventDetails = event;
      }

      res.json({
        proposal: {
          ...proposal,
          proposedRowData: Array.isArray(proposal.proposedRowData)
            ? migrateProposedPlanningRow(proposal.proposedRowData as string[])
            : proposal.proposedRowData,
        },
        eventDetails,
      });
    } catch (error) {
      logger.error('Error fetching proposal:', error);
      res.status(500).json({ error: 'Failed to fetch proposal' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/batch/approve
   * Approve multiple proposals at once
   *
   * NOTE: This route MUST come before /:id/approve to avoid "batch" being caught as an id
   * Requires PERMISSIONS.MANAGE_EVENTS to write to Google Sheet
   */
  router.post('/batch/approve', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { proposalIds } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
        return res.status(400).json({ error: 'No proposal IDs provided' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      const results = [];
      for (const id of proposalIds) {
        const result = await service.applyApprovedProposal(id, userId);
        results.push({ id, ...result });
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        success: true,
        message: `Applied ${successCount} proposals, ${failCount} failed`,
        results
      });
    } catch (error) {
      logger.error('Error batch approving proposals:', error);
      res.status(500).json({ error: 'Failed to batch approve proposals' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/batch/reject
   * Reject multiple proposals at once
   *
   * NOTE: This route MUST come before /:id/reject to avoid "batch" being caught as an id
   * Requires PERMISSIONS.MANAGE_EVENTS
   */
  router.post('/batch/reject', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { proposalIds, notes } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
        return res.status(400).json({ error: 'No proposal IDs provided' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      const results: Array<{ id: string; success: boolean; error?: string; message?: string }> = [];
      for (const id of proposalIds) {
        try {
          const result = await service.rejectProposal(id, userId, notes);
          results.push({ id, success: result.success, message: result.message });
        } catch (err: any) {
          logger.error('Error rejecting proposal in batch operation:', { id, error: err });
          results.push({
            id,
            success: false,
            error: err?.message ?? 'Failed to reject proposal'
          });
        }
      }

      const successCount = results.filter(r => r.success).length;

      res.json({
        success: successCount === proposalIds.length,
        message: `Rejected ${successCount} of ${proposalIds.length} proposals`,
        results
      });
    } catch (error) {
      logger.error('Error batch rejecting proposals:', error);
      res.status(500).json({ error: 'Failed to batch reject proposals' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/propose-event/:eventId
   * Create a proposal to add an event to the Planning Sheet
   */
  router.post('/propose-event/:eventId', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      // Check if event already has a pending proposal
      const existing = await db
        .select()
        .from(proposedSheetChanges)
        .where(
          and(
            eq(proposedSheetChanges.eventRequestId, parseInt(eventId)),
            eq(proposedSheetChanges.status, 'pending'),
            eq(proposedSheetChanges.changeType, 'create_row')
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return res.status(400).json({
          error: 'A pending proposal already exists for this event',
          existingProposalId: existing[0].id
        });
      }

      const result = await service.proposeNewRow(
        parseInt(eventId),
        userId,
        reason || 'Event ready for scheduling'
      );

      if (result.success) {
        res.json({
          success: true,
          proposalId: result.proposalId,
          message: result.message
        });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      logger.error('Error creating event proposal:', error);
      res.status(500).json({ error: 'Failed to create proposal' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/:id/approve
   * Approve and apply a proposal
   *
   * NOTE: This parameterized route MUST come after specific routes like /batch/approve
   * Requires PERMISSIONS.MANAGE_EVENTS to write to Google Sheet
   */
  router.post('/:id/approve', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      const result = await service.applyApprovedProposal(parseInt(id), userId);

      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      logger.error('Error approving proposal:', error);
      res.status(500).json({ error: 'Failed to approve proposal' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/:id/reject
   * Reject a proposal
   * Requires PERMISSIONS.MANAGE_EVENTS
   */
  router.post('/:id/reject', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const service = getPlanningSheetService();
      if (!service) {
        return res.status(500).json({ error: 'Planning Sheet service not configured' });
      }

      const result = await service.rejectProposal(parseInt(id), userId, notes);

      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      logger.error('Error rejecting proposal:', error);
      res.status(500).json({ error: 'Failed to reject proposal' });
    }
  });

  /**
   * POST /api/planning-sheet-proposals/:id/edit
   * Edit a proposal's proposed value before approving
   * Requires PERMISSIONS.MANAGE_EVENTS
   */
  router.post('/:id/edit', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EVENTS), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { proposedValue, proposedRowData } = req.body;
      const proposalId = parseInt(id, 10);

      if (isNaN(proposalId)) {
        return res.status(400).json({ error: 'Invalid proposal ID' });
      }

      // Check if proposal exists first
      const [existing] = await db
        .select({ id: proposedSheetChanges.id, status: proposedSheetChanges.status })
        .from(proposedSheetChanges)
        .where(eq(proposedSheetChanges.id, proposalId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'Proposal not found' });
      }

      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'Can only edit pending proposals' });
      }

      await db
        .update(proposedSheetChanges)
        .set({
          proposedValue: proposedValue !== undefined ? proposedValue : undefined,
          proposedRowData: proposedRowData !== undefined ? proposedRowData : undefined,
          updatedAt: new Date(),
        })
        .where(eq(proposedSheetChanges.id, proposalId));

      res.json({ success: true, message: 'Proposal updated' });
    } catch (error) {
      logger.error('Error editing proposal:', error);
      res.status(500).json({ error: 'Failed to edit proposal' });
    }
  });

  return router;
}
