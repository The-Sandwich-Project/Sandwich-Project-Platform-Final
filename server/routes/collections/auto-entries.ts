/**
 * Weekly overrides for recurring automatic collection entries.
 *
 *   GET /api/collection-auto-entries/:scheduleKey/weeks
 *     → recent and upcoming weeks with their override and entry status
 *   PUT /api/collection-auto-entries/:scheduleKey/weeks/:weekDate
 *     body: { action: 'default' | 'skip' | 'count', count?: number }
 *     → saves the override, then immediately reconciles that week so an
 *       already-created auto entry is updated or removed to match.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth';
import { logger } from '../../utils/production-safe-logger';
import { isWednesday } from '../../services/collections/recurring-auto-entry-plan';
import {
  getSchedule,
  getWeekStatus,
  listWeekStatuses,
  reconcileWeek,
  setWeekOverride,
} from '../../services/collections/recurring-auto-entry';

const autoEntriesRouter = Router();

const overrideBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('default') }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('count'), count: z.number().int().min(0).max(100000) }),
]);

autoEntriesRouter.get(
  '/:scheduleKey/weeks',
  requirePermission('COLLECTIONS_EDIT_ALL'),
  async (req, res) => {
    const schedule = getSchedule(req.params.scheduleKey);
    if (!schedule) return res.status(404).json({ message: 'Unknown schedule' });
    try {
      const weeks = await listWeekStatuses(schedule);
      res.json({
        schedule: {
          key: schedule.key,
          hostName: schedule.hostName,
          defaultPbjCount: schedule.defaultPbjCount,
          startWeek: schedule.startWeek,
        },
        weeks,
      });
    } catch (error) {
      logger.error('[AutoEntry] Failed to list weeks:', error);
      res.status(500).json({ message: 'Failed to load automatic entry weeks' });
    }
  }
);

autoEntriesRouter.put(
  '/:scheduleKey/weeks/:weekDate',
  requirePermission('COLLECTIONS_EDIT_ALL'),
  async (req: any, res) => {
    const schedule = getSchedule(req.params.scheduleKey);
    if (!schedule) return res.status(404).json({ message: 'Unknown schedule' });
    const { weekDate } = req.params;
    if (!isWednesday(weekDate)) {
      return res
        .status(400)
        .json({ message: 'weekDate must be a Wednesday in YYYY-MM-DD format' });
    }
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid override', errors: parsed.error.issues });
    }

    const body = parsed.data;
    const user = req.user || req.session?.user;
    const userName =
      user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.email;

    try {
      await setWeekOverride(
        schedule,
        weekDate,
        body.action === 'default'
          ? null
          : { action: body.action, count: body.action === 'count' ? body.count : null },
        { id: user?.id, name: userName }
      );
      const plan = await reconcileWeek(schedule, weekDate);
      const week = await getWeekStatus(schedule, weekDate);
      res.json({ week, applied: plan });
    } catch (error) {
      logger.error('[AutoEntry] Failed to save override:', error);
      res.status(500).json({ message: 'Failed to save override' });
    }
  }
);

export default autoEntriesRouter;
