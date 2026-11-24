/**
 * People admin API (people/places rebuild, step 6). Super admins and admins
 * only. Mounted at /api/people-admin in server/routes/index.ts (not
 * /api/people, which is the app-wide search in people-search.ts).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth';
import { logger } from '../utils/production-safe-logger';
import { AuditLogger } from '../audit-logger';
import {
  listPeople,
  listChapters,
  getPerson,
  updatePerson,
  createPerson,
  mergePeople,
  resolveFlag,
  searchPeople,
  PeopleAdminError,
} from '../services/people/people-admin';
import {
  getVolunteerSyncStatus,
  runManualVolunteerSheetSync,
  resolveSheetConflict,
  holdSheetConflict,
  VolunteerSyncError,
} from '../services/people/volunteer-sheet-sync';

const PEOPLE_ADMIN_ROLES = ['super_admin', 'admin'] as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const editSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    email: optText(254),
    phone: optText(40),
    address: optText(500),
    notes: optText(4000),
    chapterRegionId: z.number().int().positive().nullable().optional(),
    nameConfirmed: z.boolean().optional(),
    isVolunteer: z.boolean().optional(),
    isDriver: z.boolean().optional(),
    isVanDriver: z.boolean().optional(),
    isHost: z.boolean().optional(),
    isTeamMember: z.boolean().optional(),
    isBoardMember: z.boolean().optional(),
    isAdvisoryBoardMember: z.boolean().optional(),
    isIntakeTeam: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const createSchema = editSchema.extend({ firstName: z.string().trim().min(1).max(100) });
const mergeSchema = z.object({ keepId: z.number().int().positive(), dropId: z.number().int().positive() }).strict();
const resolveSchema = z.object({ resolution: z.string().trim().min(1).max(1000) }).strict();
const syncSchema = z.object({ dryRun: z.boolean().optional(), allowManyMissing: z.boolean().optional() }).strict();
const conflictSchema = z.object({ choice: z.enum(['use_sheet', 'keep_app']) }).strict();
const holdSchema = z.object({ note: optText(1000) }).strict();

function auditContext(req: Request) {
  const user = (req as any).user || (req as any).session?.user;
  return {
    userId: user?.id as string | undefined,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    sessionId: (req as any).sessionID,
  };
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new PeopleAdminError('Invalid id');
  return id;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.flatten() });
      } else if (error instanceof PeopleAdminError) {
        res.status(error.status).json({ error: error.message });
      } else if (error instanceof VolunteerSyncError) {
        res.status(409).json({ error: error.message });
      } else {
        logger.error('People admin error:', error);
        res.status(500).json({ error: 'Something went wrong' });
      }
    }
  };
}

export function createPeopleRouter() {
  const router = Router();
  const guard = requireRole(...PEOPLE_ADMIN_ROLES);

  router.get(
    '/',
    guard,
    handle(async (_req, res) => {
      const [list, chapters] = await Promise.all([listPeople(), listChapters()]);
      res.json({ people: list, chapters });
    })
  );

  router.get(
    '/search',
    guard,
    handle(async (req, res) => {
      const term = String(req.query.q ?? '');
      const except = Number(req.query.except ?? 0);
      res.json(term.trim().length < 2 ? [] : await searchPeople(term, except));
    })
  );

  // Volunteer sheet sync (step 7): status + open sheet-vs-app questions.
  router.get(
    '/volunteer-sync',
    guard,
    handle(async (_req, res) => {
      res.json(await getVolunteerSyncStatus());
    })
  );

  router.post(
    '/volunteer-sync',
    guard,
    handle(async (req, res) => {
      const opts = syncSchema.parse(req.body ?? {});
      const ctx = auditContext(req);
      const result = await runManualVolunteerSheetSync(ctx.userId ?? null, opts);
      if (!result.dryRun) {
        await AuditLogger.logCreate('sheet_sync_runs', String(result.runId), result.summary, ctx);
      }
      res.json({ runId: result.runId, dryRun: result.dryRun, summary: result.summary, problems: result.plan.problems });
    })
  );

  router.post(
    '/sheet-conflicts/:id/resolve',
    guard,
    handle(async (req, res) => {
      const { choice } = conflictSchema.parse(req.body);
      const ctx = auditContext(req);
      const after = await resolveSheetConflict(idParam(req), choice, ctx.userId ?? null);
      await AuditLogger.logUpdate('sheet_field_conflicts', String(after.id), null, after, ctx);
      res.json(after);
    })
  );

  router.post(
    '/sheet-conflicts/:id/hold',
    guard,
    handle(async (req, res) => {
      const { note } = holdSchema.parse(req.body ?? {});
      const ctx = auditContext(req);
      const after = await holdSheetConflict(idParam(req), note ?? null, ctx.userId ?? null);
      await AuditLogger.logUpdate('sheet_field_conflicts', String(after.id), null, after, ctx);
      res.json(after);
    })
  );

  router.get(
    '/:id',
    guard,
    handle(async (req, res) => {
      const detail = await getPerson(idParam(req));
      if (!detail) throw new PeopleAdminError('Person not found', 404);
      res.json(detail);
    })
  );

  router.post(
    '/',
    guard,
    handle(async (req, res) => {
      const input = createSchema.parse(req.body);
      const created = await createPerson(input);
      await AuditLogger.logCreate('people', String(created.id), created, auditContext(req));
      res.status(201).json(created);
    })
  );

  router.patch(
    '/:id',
    guard,
    handle(async (req, res) => {
      const id = idParam(req);
      const edit = editSchema.parse(req.body);
      const { before, after } = await updatePerson(id, edit);
      await AuditLogger.logUpdate('people', String(id), before, after, auditContext(req));
      res.json(after);
    })
  );

  router.post(
    '/merge',
    guard,
    handle(async (req, res) => {
      const { keepId, dropId } = mergeSchema.parse(req.body);
      const ctx = auditContext(req);
      const { kept, dropped } = await mergePeople(keepId, dropId, ctx.userId ?? null);
      await AuditLogger.logUpdate('people', String(keepId), { mergedFrom: dropped }, kept, ctx);
      await AuditLogger.logDelete('people', String(dropId), dropped, ctx);
      res.json(kept);
    })
  );

  router.post(
    '/flags/:id/resolve',
    guard,
    handle(async (req, res) => {
      const { resolution } = resolveSchema.parse(req.body);
      const ctx = auditContext(req);
      const flag = await resolveFlag(idParam(req), ctx.userId ?? null, resolution);
      await AuditLogger.logUpdate('person_review_flags', String(flag.id), null, flag, ctx);
      res.json(flag);
    })
  );

  return router;
}
