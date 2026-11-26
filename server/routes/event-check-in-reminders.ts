/**
 * Event alerts (formerly check-in reminders): admin dry run / preview, and
 * snoozes ("remind me again in N days" from the daily email).
 *
 * The old per-event reminder rule endpoints were removed: per-event settings
 * were retired, and their only caller (ReminderRulesManager) was unused.
 * Settings live in Profile → Alerts (/api/me/check-in-reminder-preferences).
 */
import express from 'express';
import { db, executeRawSql } from '../db';
import { eventReminderSnoozes, eventRequests } from '@shared/schema';
import { ACTIVE_ALERT_RULE_TYPES } from '@shared/types';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { processCheckInReminders, previewDigestForUser } from '../services/check-in-reminder-service';
import { maxSnoozeDays, easternDateString } from '../services/event-alerts/rules';

const router = express.Router();

const isAdmin = (user: any) => user && (user.role === 'admin' || user.role === 'super_admin');

/**
 * GET /dry-run (admins only)
 * What the daily digest would send right now, per person: the events, what
 * each alert says, and the email/phone it would use. Sends nothing, writes
 * nothing. Ignores the 9 AM send hour and today's already-sent limit, so it
 * always shows the next digest. Registered before the '/:eventRequestId' routes.
 */
router.get('/dry-run', async (req: any, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admins only' });
  try {
    const result = await processCheckInReminders({ dryRun: true, ignoreSendHour: true });
    const complete = result.errors === 0;
    // Events that predate last_human_update_at and haven't been backfilled yet
    // (scripts/backfill-last-human-update.ts). Their "no updates" alert falls
    // back to updated_at, which the sheet sync keeps bumping.
    const [{ count: notBackfilled }] = await executeRawSql<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM event_requests
       WHERE last_human_update_at IS NULL AND deleted_at IS NULL
         AND status IN ('new', 'in_process', 'scheduled', 'rescheduled')`);
    res.status(complete ? 200 : 500).json({
      dryRun: true,
      complete,
      errors: result.errors,
      note: complete
        ? 'Nothing was sent. This is what the next daily digest would contain. See /api/event-check-in-reminders/dry-run/preview?userId=... for the email itself.'
        : `Nothing was sent, but ${result.errors} part(s) of the dry run failed (see server logs), so this list is INCOMPLETE.`,
      backfill: notBackfilled > 0
        ? `${notBackfilled} active event(s) still need the one-time backfill: run \`npm run alerts:backfill -- --dry-run\`, then \`--apply\`, before turning alerts on.`
        : 'Done: every active event has last_human_update_at.',
      totals: {
        people: result.plan.length,
        events: result.plan.reduce((n, e) => n + e.events.length, 0),
        emails: result.plan.filter(e => e.wouldEmail).length,
        texts: result.plan.filter(e => e.wouldText).length,
      },
      digests: result.plan,
    });
  } catch (error) {
    logger.error('[EventAlerts] Dry run failed:', error);
    res.status(500).json({ message: 'Dry run failed' });
  }
});

/**
 * GET /dry-run/preview?userId=... (admins only)
 * The exact HTML email that person's next digest would be. Sends nothing.
 */
router.get('/dry-run/preview', async (req: any, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admins only' });
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ message: 'userId is required' });
  try {
    const digest = await previewDigestForUser(userId);
    if (!digest) return res.status(200).type('text/plain').send('Nothing due for this person right now: no digest would be sent.');
    res.type('html').send(digest.html);
  } catch (error) {
    logger.error('[EventAlerts] Preview failed:', error);
    res.status(500).json({ message: 'Preview failed' });
  }
});

// ---------------------------------------------------------------------------
// Snoozes
// ---------------------------------------------------------------------------

const LEGACY_SNOOZE_TYPES = ['timed', 'until_date', 'until_contact'];

/** The event if the current user may snooze its alerts (its TSP contact, or an admin). */
async function authorizeSnoozeAccess(req: any, res: any, eventRequestId: number) {
  const [event] = await db.select().from(eventRequests).where(eq(eventRequests.id, eventRequestId)).limit(1);
  if (!event) {
    res.status(404).json({ error: 'Event request not found' });
    return null;
  }
  const userId = req.user.id;
  const isAssigned = event.tspContact === userId || (!event.tspContact && event.tspContactAssigned === userId);
  if (!isAssigned && !isAdmin(req.user)) {
    res.status(403).json({ error: 'Only the TSP contact for this event can snooze its alerts' });
    return null;
  }
  return event;
}

/** Accepts ruleTypes: string[] or a comma list ("no_contact,stale_event"). Invalid -> null. */
function parseRuleTypes(input: unknown): string[] | null {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const clean = [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
  if (clean.length === 0) return [];
  return clean.every(r => (ACTIVE_ALERT_RULE_TYPES as readonly string[]).includes(r)) ? clean : null;
}

/** Midnight Eastern, `days` calendar days from now: the alert returns in that day's digest. */
function startOfEasternDayIn(days: number, now = new Date()): Date {
  const [y, m, d] = easternDateString(now).split('-').map(Number);
  // 05:00 UTC = midnight EST / 1 AM EDT: always before the 9 AM digest.
  return new Date(Date.UTC(y, m - 1, d + days, 5, 0, 0));
}

/**
 * GET /:eventRequestId/snooze
 * { snooze: the legacy whole-event pause or null, alertSnoozes: active per-alert snoozes,
 *   maxDays: longest snooze allowed for this event (null = no limit) }
 */
router.get('/:eventRequestId/snooze', async (req: any, res) => {
  try {
    const eventRequestId = parseInt(req.params.eventRequestId);
    if (isNaN(eventRequestId)) return res.status(400).json({ error: 'Invalid event request ID' });
    const event = await authorizeSnoozeAccess(req, res, eventRequestId);
    if (!event) return;

    const active = await db
      .select()
      .from(eventReminderSnoozes)
      .where(and(
        eq(eventReminderSnoozes.eventRequestId, eventRequestId),
        eq(eventReminderSnoozes.userId, req.user.id),
        eq(eventReminderSnoozes.active, true),
      ));
    res.json({
      snooze: active.find(s => s.ruleType === null) ?? null,
      alertSnoozes: active.filter(s => s.ruleType !== null),
      maxDays: maxSnoozeDays(event as any, new Date()),
    });
  } catch (error) {
    logger.error('Error getting snooze:', error);
    res.status(500).json({ error: 'Failed to get snooze status' });
  }
});

/**
 * POST /:eventRequestId/snooze
 * Per-alert ("remind me again in N days"): { ruleTypes: [...], days: N }.
 * N is capped so the snooze ends by the day before the event, so it can't hide
 * the last alert; the response says if it was shortened.
 * Legacy whole-event pause: { snoozeType, snoozedUntil, reason } with no ruleTypes.
 */
router.post('/:eventRequestId/snooze', async (req: any, res) => {
  try {
    const eventRequestId = parseInt(req.params.eventRequestId);
    if (isNaN(eventRequestId)) return res.status(400).json({ error: 'Invalid event request ID' });
    const event = await authorizeSnoozeAccess(req, res, eventRequestId);
    if (!event) return;

    const ruleTypes = parseRuleTypes(req.body?.ruleTypes);
    if (ruleTypes === null) return res.status(400).json({ error: 'Unknown alert type' });

    if (ruleTypes.length > 0) {
      const requested = Number(req.body?.days);
      if (!Number.isInteger(requested) || requested < 1 || requested > 90) {
        return res.status(400).json({ error: 'Pick a number of days from 1 to 90' });
      }
      const max = maxSnoozeDays(event as any, new Date());
      if (max === 0) {
        return res.status(400).json({ error: "This event is today or tomorrow, so its alerts can't be snoozed." });
      }
      const days = max === null ? requested : Math.min(requested, max);
      const until = startOfEasternDayIn(days);

      // One active snooze per alert: replace any existing one for these alerts.
      await db
        .update(eventReminderSnoozes)
        .set({ active: false, cancelledAt: new Date() })
        .where(and(
          eq(eventReminderSnoozes.eventRequestId, eventRequestId),
          eq(eventReminderSnoozes.userId, req.user.id),
          eq(eventReminderSnoozes.active, true),
          inArray(eventReminderSnoozes.ruleType, ruleTypes),
        ));
      const created = await db
        .insert(eventReminderSnoozes)
        .values(ruleTypes.map(ruleType => ({
          eventRequestId,
          userId: req.user.id,
          ruleType,
          snoozeType: 'timed',
          snoozedUntil: until,
          reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
          active: true,
        })))
        .returning();
      logger.info(`Alert snooze for event ${eventRequestId} by ${req.user.id}: ${ruleTypes.join(',')} for ${days} day(s)`);
      return res.json({ snoozes: created, days, shortened: days < requested, until });
    }

    // Legacy whole-event pause
    const { snoozeType, snoozedUntil, reason } = req.body ?? {};
    if (!LEGACY_SNOOZE_TYPES.includes(snoozeType)) return res.status(400).json({ error: 'Invalid snooze type' });
    let computedUntil: Date | null = null;
    if (snoozeType === 'timed') {
      const days = parseInt(snoozedUntil);
      if (!days || days < 1) return res.status(400).json({ error: 'Timed snooze requires a positive number of days' });
      computedUntil = startOfEasternDayIn(days);
    } else if (snoozeType === 'until_date') {
      const raw = new Date(snoozedUntil);
      if (isNaN(raw.getTime())) return res.status(400).json({ error: 'Invalid date' });
      computedUntil = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 5, 0, 0));
    }
    await db
      .update(eventReminderSnoozes)
      .set({ active: false, cancelledAt: new Date() })
      .where(and(
        eq(eventReminderSnoozes.eventRequestId, eventRequestId),
        eq(eventReminderSnoozes.userId, req.user.id),
        eq(eventReminderSnoozes.active, true),
        isNull(eventReminderSnoozes.ruleType),
      ));
    const [snooze] = await db
      .insert(eventReminderSnoozes)
      .values({ eventRequestId, userId: req.user.id, snoozeType, snoozedUntil: computedUntil, reason: reason || null, active: true })
      .returning();
    res.json({ snooze });
  } catch (error) {
    logger.error('Error creating snooze:', error);
    res.status(500).json({ error: 'Failed to create snooze' });
  }
});

/**
 * DELETE /:eventRequestId/snooze[?ruleType=no_contact]
 * Ends the snooze for that alert, or the legacy whole-event pause if none given.
 */
router.delete('/:eventRequestId/snooze', async (req: any, res) => {
  try {
    const eventRequestId = parseInt(req.params.eventRequestId);
    if (isNaN(eventRequestId)) return res.status(400).json({ error: 'Invalid event request ID' });
    if (!(await authorizeSnoozeAccess(req, res, eventRequestId))) return;
    const ruleTypes = parseRuleTypes(req.query.ruleType);
    if (ruleTypes === null) return res.status(400).json({ error: 'Unknown alert type' });

    await db
      .update(eventReminderSnoozes)
      .set({ active: false, cancelledAt: new Date() })
      .where(and(
        eq(eventReminderSnoozes.eventRequestId, eventRequestId),
        eq(eventReminderSnoozes.userId, req.user.id),
        eq(eventReminderSnoozes.active, true),
        ruleTypes.length ? inArray(eventReminderSnoozes.ruleType, ruleTypes) : isNull(eventReminderSnoozes.ruleType),
      ));
    res.json({ success: true });
  } catch (error) {
    logger.error('Error cancelling snooze:', error);
    res.status(500).json({ error: 'Failed to cancel snooze' });
  }
});

export default router;
