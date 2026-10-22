import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { eventRequests } from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import { parseSandwichCountInput } from '@shared/sandwich-count-utils';
import {
  getPlanningSheetService,
  parseVanNeededForCell,
  type PlanningSheetRow,
} from '../planning-sheet-sync-service';
import { logger } from '../utils/production-safe-logger';
import { geocodeEventInBackground } from '../utils/geocode-event';
import type { AuthenticatedRequest } from '../types/express';

/**
 * Planning Sheet Import — safe, review-first PULL from the team's planning
 * spreadsheet into the app.
 *
 * Safety model (mirrors the push direction's proposal/approval pattern):
 * - GET /preview only READS the sheet and compares. It never writes anywhere.
 * - POST /import only creates events for the exact rows a human selected in
 *   the review dialog. It never updates or deletes existing app events, and
 *   it never writes to the spreadsheet.
 * - Every imported event stores a fingerprint externalId
 *   (`planning-sheet:<date>:<normalized group name>`), so re-running the
 *   import can never create a duplicate of something already imported —
 *   the unique constraint on external_id makes this a hard guarantee.
 * - googleSheetRowId is deliberately left NULL: planning-sheet row numbers
 *   shift when rows are inserted, and storing them could collide with the
 *   intake sync's row-id dedup for a DIFFERENT sheet.
 * - Imported events are stored with addedToOfficialSheet = true: they came
 *   directly FROM the official planning sheet, so by definition they are
 *   already on it. Without this flag they'd show the amber "Not on Calendar"
 *   badge, misleading coordinators into duplicate manual handling.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, collapse whitespace — for name matching. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a planning-sheet date cell (M/D/YY or M/D/YYYY) into a stable
 * calendar day. The Date is constructed at UTC noon so the calendar day
 * survives any timezone conversion (matches the app's timezone-safe rule).
 */
function parsePlanningDate(
  dateStr: string
): { iso: string; date: Date } | null {
  if (!dateStr || !dateStr.trim()) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, date: new Date(Date.UTC(year, month - 1, day, 12, 0, 0)) };
}

/** Fingerprint used as external_id — stable across sheet row reordering. */
function planningFingerprint(iso: string, groupName: string): string {
  return `planning-sheet:${iso}:${normalizeName(groupName)}`;
}

/** Today's calendar date in Eastern Time (the org's timezone), as YYYY-MM-DD. */
function todayIsoEastern(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
}

/**
 * Calendar-day keys for a stored event timestamp. Stored dates in this app
 * come from several eras with different time-of-day conventions, so we match
 * on BOTH the UTC and Eastern date-parts to avoid off-by-one mismatches.
 */
function eventDateKeys(value: Date | null): string[] {
  if (!value) return [];
  const keys = new Set<string>();
  keys.add(value.toISOString().slice(0, 10));
  keys.add(value.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  return Array.from(keys);
}

/** Token-overlap similarity for "possible match" detection (0..1). */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter((t) => t.length > 1));
  const tb = new Set(normalizeName(b).split(' ').filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Containment (min 4 chars so "the" etc. can't false-match)
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na)))
    return true;
  return false;
}

interface PreviewRow {
  rowIndex: number;
  /**
   * Fingerprint of this row's date + group name. The client echoes it back on
   * import so the server can detect when sheet rows shifted (someone inserted
   * or deleted a row) between preview and import — a bare rowIndex would then
   * point at a row the human never reviewed.
   */
  fingerprint: string;
  date: string; // YYYY-MM-DD
  dateDisplay: string; // as written on the sheet
  groupName: string;
  estimateSandwiches: string;
  finalSandwiches: string;
  contactName: string;
  address: string;
  suggestedStatus: 'scheduled' | 'completed' | 'cancelled';
  matchedEvent?: { id: number; organizationName: string | null; status: string };
}

function suggestStatus(
  row: PlanningSheetRow,
  iso: string
): 'scheduled' | 'completed' | 'cancelled' {
  if (row.cancelled && row.cancelled.trim()) return 'cancelled';
  return iso < todayIsoEastern() ? 'completed' : 'scheduled';
}

function toPreviewRow(
  row: PlanningSheetRow,
  iso: string,
  fingerprint: string,
  matchedEvent?: PreviewRow['matchedEvent']
): PreviewRow {
  return {
    rowIndex: row.rowIndex,
    fingerprint,
    date: iso,
    dateDisplay: row.date,
    groupName: row.groupName.trim(),
    estimateSandwiches: row.estimateSandwiches,
    finalSandwiches: row.finalSandwiches,
    contactName: row.contactName,
    address: row.address,
    suggestedStatus: suggestStatus(row, iso),
    matchedEvent,
  };
}

/** Build the human-readable provenance note for an imported event. */
function buildPlanningNotes(row: PlanningSheetRow): string {
  const lines: string[] = [
    `Imported from the Planning Sheet (row ${row.rowIndex}) on ${todayIsoEastern()}.`,
  ];
  const add = (label: string, value: string) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  add('Event time', [row.eventStartTime, row.eventEndTime].filter(Boolean).join(' - '));
  add('Pick-up time', row.pickUpTime);
  add('Pick-up next day', row.pickUpNextDay);
  add('Van booked', row.vanBooked);
  add('Van needed for', row.vanNeededFor);
  add('Staffing (from sheet)', row.staffing);
  add('Deli or PBJ', row.deliOrPbj);
  add('Recipient/Host', row.recipientHost);
  add('TSP contact (from sheet)', row.tspContact);
  add('Sent toolkit', row.sentToolkit);
  add('Details', row.allDetails);
  add('Notes', row.notes);
  add('Additional notes', row.addlNotes);
  add('Waiting on', row.waitingOn);
  add('After-event notes', row.afterEventNotes);
  return lines.join('\n');
}

/** A selected sheet row resolved and validated for import. */
export interface ImportCandidate {
  row: PlanningSheetRow;
  iso: string;
  date: Date;
  fingerprint: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'in_process';
}

/**
 * Build the event record inserted for one imported planning-sheet row.
 * Exported for regression tests — notably the guarantee that imported events
 * are stored with addedToOfficialSheet = true (they came FROM the sheet).
 */
export function buildImportedEventRecord(
  c: ImportCandidate,
  createdBy: string | null = null
): typeof eventRequests.$inferInsert {
  const est = parseSandwichCountInput(c.row.estimateSandwiches);
  const final = parseSandwichCountInput(c.row.finalSandwiches);
  const contactParts = (c.row.contactName || '').trim().split(/\s+/);
  const firstName = contactParts[0] || null;
  const lastName =
    contactParts.length > 1 ? contactParts.slice(1).join(' ') : null;
  const vanNeededFor = parseVanNeededForCell(c.row.vanNeededFor);

  return {
    organizationName: c.row.groupName.trim(),
    firstName,
    lastName,
    email: c.row.email?.trim() || null,
    phone: c.row.phone?.trim() || null,
    desiredEventDate: c.date,
    scheduledEventDate:
      c.status === 'scheduled' || c.status === 'completed' ? c.date : null,
    status: c.status,
    statusChangedAt: new Date(),
    isConfirmed: c.status === 'scheduled' || c.status === 'completed',
    eventAddress: c.row.address?.trim() || null,
    estimatedSandwichCount: est.count,
    estimatedSandwichCountMin: est.min,
    estimatedSandwichCountMax: est.max,
    actualSandwichCount: c.status === 'completed' ? final.count : null,
    cancelledReason:
      c.status === 'cancelled'
        ? c.row.cancelled?.trim() || 'Marked cancelled on the planning sheet'
        : null,
    planningNotes: buildPlanningNotes(c.row),
    vanNeededFor,
    ...(vanNeededFor ? { vanDriverNeeded: true } : {}),
    externalId: c.fingerprint,
    googleSheetRowId: null,
    // This event came directly FROM the official planning sheet, so it
    // is already on it — mark it so the UI shows "On Calendar" instead
    // of the amber "Not on Calendar" action badge.
    addedToOfficialSheet: true,
    addedToOfficialSheetAt: new Date(),
    // Record who ran the import, like manual entry does.
    createdBy,
  };
}

const importSelectionSchema = z.object({
  selections: z
    .array(
      z.object({
        rowIndex: z.number().int().min(2),
        fingerprint: z.string().min(1),
        status: z.enum(['scheduled', 'completed', 'cancelled', 'in_process']),
      })
    )
    .min(1)
    .max(500),
});

// ---------------------------------------------------------------------------
// Shared read-only comparison
// ---------------------------------------------------------------------------

interface SheetComparison {
  sheetRowCount: number;
  skippedRows: number;
  missing: PreviewRow[];
  possible: PreviewRow[];
  inApp: PreviewRow[];
}

/**
 * READ-ONLY comparison of the planning sheet against every app event, under
 * ANY status. It reads the sheet (values.get) and SELECTs event requests — it
 * never writes to the spreadsheet or the database. Returns null when the
 * planning-sheet connection is not configured.
 *
 * Buckets each sheet row into:
 *  - inApp:    represented by an app event (prior import, or same-day exact/
 *              contained name match)
 *  - possible: a same-day event with a similar (token-overlap >= 0.5) name —
 *              a likely-but-not-certain match a human should eyeball
 *  - missing:  no match at all — i.e. a group event on the sheet that does not
 *              appear to exist in the app
 */
async function compareSheetToApp(): Promise<SheetComparison | null> {
  const service = getPlanningSheetService();
  if (!service) return null;

  const sheetRows = await service.readPlanningSheet();
  const events = await db
    .select({
      id: eventRequests.id,
      organizationName: eventRequests.organizationName,
      desiredEventDate: eventRequests.desiredEventDate,
      scheduledEventDate: eventRequests.scheduledEventDate,
      status: eventRequests.status,
      externalId: eventRequests.externalId,
    })
    .from(eventRequests)
    // Exclude soft-deleted requests — a deleted event doesn't "represent" a
    // sheet row, so it shouldn't hide a gap (or count as already-in-app for
    // the importer). Matches how the rest of the app filters event requests.
    .where(isNull(eventRequests.deletedAt));

  // Index by external_id once for O(1) prior-import lookups (instead of a
  // find() per sheet row).
  const eventsByExternalId = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (e.externalId) eventsByExternalId.set(e.externalId, e);
  }
  const eventsByDate = new Map<string, typeof events>();
  for (const ev of events) {
    const keys = new Set([
      ...eventDateKeys(ev.desiredEventDate),
      ...eventDateKeys(ev.scheduledEventDate),
    ]);
    for (const key of keys) {
      const bucket = eventsByDate.get(key);
      if (bucket) bucket.push(ev);
      else eventsByDate.set(key, [ev]);
    }
  }

  const missing: PreviewRow[] = [];
  const possible: PreviewRow[] = [];
  const inApp: PreviewRow[] = [];
  let skippedRows = 0;

  for (const row of sheetRows) {
    const groupName = (row.groupName || '').trim();
    const parsed = parsePlanningDate(row.date);
    // Skip blank rows and separator rows like "----------" whose name
    // normalizes to nothing (they'd produce a meaningless fingerprint).
    if (!groupName || !normalizeName(groupName) || !parsed) {
      skippedRows++;
      continue;
    }

    const fingerprint = planningFingerprint(parsed.iso, groupName);
    const sameDay = eventsByDate.get(parsed.iso) || [];

    // 1) Previously imported by this tool — hard match.
    const importedMatch = eventsByExternalId.get(fingerprint);
    if (importedMatch) {
      inApp.push(
        toPreviewRow(row, parsed.iso, fingerprint, {
          id: importedMatch.id,
          organizationName: importedMatch.organizationName,
          status: importedMatch.status,
        })
      );
      continue;
    }

    // 2) Same day + same/contained name — already in the app.
    const exact = sameDay.find((e) =>
      namesMatch(groupName, e.organizationName || '')
    );
    if (exact) {
      inApp.push(
        toPreviewRow(row, parsed.iso, fingerprint, {
          id: exact.id,
          organizationName: exact.organizationName,
          status: exact.status,
        })
      );
      continue;
    }

    // 3) Same day + similar name — a likely match to eyeball.
    const similar = sameDay.find(
      (e) => tokenOverlap(groupName, e.organizationName || '') >= 0.5
    );
    if (similar) {
      possible.push(
        toPreviewRow(row, parsed.iso, fingerprint, {
          id: similar.id,
          organizationName: similar.organizationName,
          status: similar.status,
        })
      );
      continue;
    }

    // 4) Not in the app.
    missing.push(toPreviewRow(row, parsed.iso, fingerprint));
  }

  const byDate = (a: PreviewRow, b: PreviewRow) => a.date.localeCompare(b.date);
  missing.sort(byDate);
  possible.sort(byDate);
  inApp.sort(byDate);

  return {
    sheetRowCount: sheetRows.length,
    skippedRows,
    missing,
    possible,
    inApp,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createPlanningSheetImportRouter(
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
  requirePermission: (
    permission: string
  ) => (req: Request, res: Response, next: () => void) => void
) {
  const router = Router();

  /**
   * GET /api/planning-sheet-import/preview
   * READ-ONLY comparison of the planning sheet against app events.
   */
  router.get(
    '/preview',
    isAuthenticated,
    // Same gate as the toolbar button: EVENT_REQUESTS_SYNC permission, with
    // admin/super_admin passing via requirePermission's role checks.
    requirePermission(PERMISSIONS.EVENT_REQUESTS_SYNC),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await compareSheetToApp();
        if (!result) {
          return res.status(503).json({
            message:
              'The planning sheet connection is not configured on this server.',
          });
        }
        res.json(result);
      } catch (error) {
        logger.error('[PlanningSheetImport] Preview failed:', error);
        res.status(500).json({
          message: 'Could not read the planning sheet. Please try again.',
        });
      }
    }
  );

  /**
   * GET /api/planning-sheet-import/gaps
   * READ-ONLY report. Surfaces planning-sheet group events (group + date) that
   * do not appear to be represented by an event request in the app under ANY
   * status — i.e. the "missing" bucket of the comparison, on its own.
   *
   * This endpoint ONLY reads (the sheet via values.get, and event requests via
   * SELECT). It has no write path of any kind: it cannot modify the sheet, the
   * database, or any event. It exists purely to show a list.
   */
  router.get(
    '/gaps',
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENT_REQUESTS_SYNC),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await compareSheetToApp();
        if (!result) {
          return res.status(503).json({
            message:
              'The planning sheet connection is not configured on this server.',
          });
        }
        res.json({
          sheetRowCount: result.sheetRowCount,
          skippedRows: result.skippedRows,
          inAppCount: result.inApp.length,
          possibleMatchCount: result.possible.length,
          // Group events on the sheet with no matching app event (any status).
          gaps: result.missing,
          // Near-misses (same-day event with a similar name) included so a
          // reviewer can confirm a listed "gap" isn't really an in-app event
          // under a slightly different name before acting on it manually.
          possibleMatches: result.possible,
        });
      } catch (error) {
        logger.error('[PlanningSheetImport] Gaps report failed:', error);
        res.status(500).json({
          message: 'Could not read the planning sheet. Please try again.',
        });
      }
    }
  );

  /**
   * POST /api/planning-sheet-import/import
   * Creates events ONLY for the explicitly selected sheet rows.
   * Never updates existing events; duplicate-proof via unique external_id.
   */
  router.post(
    '/import',
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENT_REQUESTS_SYNC),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsedBody = importSelectionSchema.safeParse(req.body);
        if (!parsedBody.success) {
          return res.status(400).json({
            message: 'Invalid import selection.',
            errors: parsedBody.error.flatten(),
          });
        }

        const service = getPlanningSheetService();
        if (!service) {
          return res.status(503).json({
            message:
              'The planning sheet connection is not configured on this server.',
          });
        }

        // Re-read the sheet at import time so we act on current data.
        const sheetRows = await service.readPlanningSheet();
        const rowsByIndex = new Map(sheetRows.map((r) => [r.rowIndex, r]));

        const skipped: { rowIndex: number; groupName: string; reason: string }[] = [];
        type InsertRow = typeof eventRequests.$inferInsert;
        const toInsert: InsertRow[] = [];

        // Resolve fingerprints and pre-check which already exist.
        const candidates: {
          row: PlanningSheetRow;
          iso: string;
          date: Date;
          fingerprint: string;
          status: 'scheduled' | 'completed' | 'cancelled' | 'in_process';
        }[] = [];
        for (const sel of parsedBody.data.selections) {
          const row = rowsByIndex.get(sel.rowIndex);
          if (!row) {
            skipped.push({
              rowIndex: sel.rowIndex,
              groupName: '',
              reason: 'Row no longer exists on the sheet',
            });
            continue;
          }
          const groupName = (row.groupName || '').trim();
          const parsed = parsePlanningDate(row.date);
          if (!groupName || !normalizeName(groupName) || !parsed) {
            skipped.push({
              rowIndex: sel.rowIndex,
              groupName,
              reason: 'Row is missing a group name or a readable date',
            });
            continue;
          }
          const fingerprint = planningFingerprint(parsed.iso, groupName);
          // Guard against the sheet changing between preview and import:
          // if rows were inserted/deleted, this rowIndex now points at a
          // DIFFERENT row than the one the human reviewed. Never import it.
          if (fingerprint !== sel.fingerprint) {
            skipped.push({
              rowIndex: sel.rowIndex,
              groupName,
              reason:
                'The sheet changed since the preview — please close and reopen to re-check',
            });
            continue;
          }
          candidates.push({
            row,
            iso: parsed.iso,
            date: parsed.date,
            fingerprint,
            status: sel.status,
          });
        }

        const existing =
          candidates.length > 0
            ? await db
                .select({ externalId: eventRequests.externalId })
                .from(eventRequests)
                .where(
                  inArray(
                    eventRequests.externalId,
                    candidates.map((c) => c.fingerprint)
                  )
                )
            : [];
        const existingIds = new Set(existing.map((e) => e.externalId));

        for (const c of candidates) {
          if (existingIds.has(c.fingerprint)) {
            skipped.push({
              rowIndex: c.row.rowIndex,
              groupName: c.row.groupName.trim(),
              reason: 'Already imported',
            });
            continue;
          }

          toInsert.push(
            buildImportedEventRecord(c, (req as any).user?.id?.toString() ?? null)
          );
        }

        let created: {
          id: number;
          organizationName: string | null;
          eventAddress: string | null;
        }[] = [];
        if (toInsert.length > 0) {
          created = await db
            .insert(eventRequests)
            .values(toInsert)
            .onConflictDoNothing({ target: eventRequests.externalId })
            .returning({
              id: eventRequests.id,
              organizationName: eventRequests.organizationName,
              eventAddress: eventRequests.eventAddress,
            });
          // Give imported events a map pin, like every other entry point.
          for (const ev of created) geocodeEventInBackground(ev.id, ev.eventAddress);
        }

        logger.log(
          `[PlanningSheetImport] Imported ${created.length} event(s) from planning sheet (${skipped.length} skipped) by user ${(req as any).user?.id ?? 'unknown'}`
        );

        res.json({
          created: created.length,
          createdEvents: created,
          skipped,
          message:
            created.length > 0
              ? `Imported ${created.length} event${created.length === 1 ? '' : 's'} from the planning sheet.`
              : 'No new events were imported.',
        });
      } catch (error) {
        logger.error('[PlanningSheetImport] Import failed:', error);
        res.status(500).json({
          message: 'The import ran into a problem. No partial data was left behind — please try again.',
        });
      }
    }
  );

  return router;
}
