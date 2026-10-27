import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth';
import { logger } from '../utils/production-safe-logger';
import {
  getAutoLogStatus,
  saveAutoLogConfig,
  getAutoLogConfig,
  upsertOverride,
  deleteOverride,
  reconcileWeek,
  backfillWeeks,
  MAX_BACKFILL_WEEKS,
  wednesdayOf,
  isValidDateStr,
  todayInEastern,
} from '../services/collections/collective-learning-auto-log';

const ADMIN_ROLES = ['admin', 'super_admin', 'admin_coordinator'] as const;

const dateStr = z.string().refine(isValidDateStr, 'Expected YYYY-MM-DD');

const configSchema = z.object({
  enabled: z.boolean().optional(),
  hostName: z.string().trim().min(1).max(200).optional(),
  defaultCount: z.number().int().min(0).max(100000).optional(),
});

const overrideSchema = z
  .object({
    weekOf: dateStr,
    skipped: z.boolean(),
    count: z.number().int().min(0).max(100000).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.skipped || v.count != null, {
    message: 'Provide a count, or mark the week as skipped',
  });

function currentUser(req: Request) {
  const user = (req as any).user || (req as any).session?.user;
  const name =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email ?? null;
  return { id: (user?.id as string) ?? null, name };
}

export function createCollectiveLearningAutoLogRouter() {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.json(await getAutoLogStatus());
    } catch (error) {
      logger.error('Error fetching auto-log status:', error);
      res.status(500).json({ error: 'Failed to fetch auto-log status' });
    }
  });

  router.patch('/config', requireRole(...ADMIN_ROLES), async (req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const current = await getAutoLogConfig();
      const next = { ...current, ...parsed.data };
      await saveAutoLogConfig(next, currentUser(req).id);
      // Turning it on (or changing the count) should take effect this week.
      const reconcile = await reconcileWeek(todayInEastern());
      res.json({ config: next, reconcile });
    } catch (error) {
      logger.error('Error saving auto-log config:', error);
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  router.put('/overrides', requireRole(...ADMIN_ROLES), async (req, res) => {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const user = currentUser(req);
      const weekOf = wednesdayOf(parsed.data.weekOf);
      const override = await upsertOverride({
        weekOf,
        skipped: parsed.data.skipped,
        count: parsed.data.count ?? null,
        note: parsed.data.note?.trim() || null,
        userId: user.id,
        userName: user.name,
      });
      const reconcile = await reconcileWeek(weekOf);
      res.json({ override, reconcile });
    } catch (error) {
      logger.error('Error saving auto-log override:', error);
      res.status(500).json({ error: 'Failed to save override' });
    }
  });

  router.delete('/overrides/:weekOf', requireRole(...ADMIN_ROLES), async (req, res) => {
    if (!isValidDateStr(req.params.weekOf)) {
      return res.status(400).json({ error: 'Expected YYYY-MM-DD' });
    }
    try {
      const weekOf = wednesdayOf(req.params.weekOf);
      const deleted = await deleteOverride(weekOf);
      // Back to the default for that week
      const reconcile = await reconcileWeek(weekOf);
      res.json({ deleted, reconcile });
    } catch (error) {
      logger.error('Error deleting auto-log override:', error);
      res.status(500).json({ error: 'Failed to delete override' });
    }
  });

  // Manually run the weekly job (for testing, or after an outage)
  router.post('/run', requireRole(...ADMIN_ROLES), async (req, res) => {
    const weekOf = req.body?.weekOf ?? todayInEastern();
    if (!isValidDateStr(weekOf)) {
      return res.status(400).json({ error: 'Expected YYYY-MM-DD' });
    }
    try {
      res.json(await reconcileWeek(weekOf));
    } catch (error) {
      logger.error('Error running auto-log:', error);
      res.status(500).json({ error: 'Failed to run auto-log' });
    }
  });

  // Fill in past weeks (e.g. weeks missed before the auto-log existed)
  router.post('/backfill', requireRole(...ADMIN_ROLES), async (req, res) => {
    const parsed = z
      .object({ from: dateStr, through: dateStr.optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { from, through } = parsed.data;
    if (through && through < from) {
      return res.status(400).json({ error: '"through" must be on or after "from"' });
    }
    const weeks = Math.floor(
      (Date.parse(through ?? todayInEastern()) - Date.parse(wednesdayOf(from))) / (7 * 864e5)
    ) + 1;
    if (weeks > MAX_BACKFILL_WEEKS) {
      return res
        .status(400)
        .json({ error: `That's ${weeks} weeks; fill in at most ${MAX_BACKFILL_WEEKS} at a time` });
    }
    try {
      const results = await backfillWeeks(from, through);
      const summary: Record<string, number> = {};
      for (const r of results) summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
      res.json({ results, summary });
    } catch (error) {
      logger.error('Error backfilling auto-log:', error);
      res.status(500).json({ error: 'Failed to fill in past weeks' });
    }
  });

  return router;
}
