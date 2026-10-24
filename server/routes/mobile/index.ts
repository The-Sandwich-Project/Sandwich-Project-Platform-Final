import { Router } from 'express';
import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import collectionsRouter from '../collections';
import { db } from '../../db';
import { eventRequests, mobileDevices } from '../../../shared/schema';
import { resolveMobileRoute } from '../../../shared/mobile/deep-links';
import { logger } from '../../utils/production-safe-logger';

const mobileRouter = Router();

const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  deviceToken: z.string().min(1),
  pushProvider: z.enum(['expo', 'apns', 'fcm']).default('expo'),
  appVersion: z.string().optional(),
  deviceName: z.string().optional(),
});

function mobileError(res: any, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({
    success: false,
    error: { code, message, details },
    code,
    message,
  });
}

function summarizeEvent(event: typeof eventRequests.$inferSelect) {
  return {
    id: event.id,
    organizationName: event.organizationName,
    status: event.status,
    scheduledEventDate: event.scheduledEventDate,
    desiredEventDate: event.desiredEventDate,
    eventStartTime: event.eventStartTime,
    eventEndTime: event.eventEndTime,
    eventAddress: event.eventAddress,
    phone: event.phone,
    email: event.email,
    firstName: event.firstName,
    lastName: event.lastName,
    driversNeeded: event.driversNeeded,
    driversArranged: event.driversArranged,
    assignedDriverIds: event.assignedDriverIds,
    toolkitSent: event.toolkitSent,
    toolkitStatus: event.toolkitStatus,
    nextAction: event.nextAction,
    tspContact: event.tspContact,
    tspContactAssigned: event.tspContactAssigned,
    mobileRoute: 'eventDetail',
    mobileParams: { eventId: event.id },
  };
}

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function currentUserId(req: { user?: unknown }): string | null {
  const user = req.user as { id?: unknown; claims?: { sub?: unknown } } | undefined;
  const id = user?.id ?? user?.claims?.sub;
  return typeof id === 'string' ? id : id != null ? String(id) : null;
}

mobileRouter.get('/auth/me', (req, res) => {
  if (!req.user) {
    return mobileError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
  }

  return res.json({ success: true, user: req.user, authMode: 'session-cookie' });
});

mobileRouter.post('/auth/logout', async (req, res) => {
  const userId = currentUserId(req);
  if (userId) {
    await db.update(mobileDevices).set({ isActive: false, updatedAt: new Date() }).where(eq(mobileDevices.userId, userId));
  }

  req.session.destroy((error) => {
    if (error) {
      logger.error('[Mobile Auth] Logout failed:', error);
      return mobileError(res, 500, 'LOGOUT_FAILED', 'Unable to log out');
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
});

mobileRouter.post('/devices/register', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) {
    return mobileError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
  }

  const parsed = registerDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return mobileError(res, 400, 'INVALID_DEVICE_REGISTRATION', 'Invalid device registration payload', parsed.error.flatten());
  }

  const { platform, deviceToken, pushProvider, appVersion, deviceName } = parsed.data;
  const now = new Date();

  const existing = await db.select().from(mobileDevices).where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.deviceToken, deviceToken))).limit(1);

  const [device] = existing.length > 0
    ? await db.update(mobileDevices).set({ platform, pushProvider, appVersion, deviceName, isActive: true, lastSeenAt: now, updatedAt: now }).where(eq(mobileDevices.id, existing[0].id)).returning()
    : await db.insert(mobileDevices).values({ userId, platform, pushProvider, deviceToken, appVersion, deviceName, isActive: true, lastSeenAt: now }).returning();

  return res.status(existing.length > 0 ? 200 : 201).json({ success: true, device });
});

mobileRouter.delete('/devices/:id', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return mobileError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return mobileError(res, 400, 'INVALID_DEVICE_ID', 'Invalid device id');

  const [device] = await db.update(mobileDevices).set({ isActive: false, updatedAt: new Date() }).where(and(eq(mobileDevices.id, id), eq(mobileDevices.userId, userId))).returning();
  if (!device) return mobileError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
  return res.json({ success: true });
});

mobileRouter.post('/devices/unregister-current', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return mobileError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
  const deviceToken = typeof req.body?.deviceToken === 'string' ? req.body.deviceToken : undefined;
  if (!deviceToken) return mobileError(res, 400, 'DEVICE_TOKEN_REQUIRED', 'deviceToken is required');

  await db.update(mobileDevices).set({ isActive: false, updatedAt: new Date() }).where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.deviceToken, deviceToken)));
  return res.json({ success: true });
});

mobileRouter.post('/notifications/resolve-route', (req, res) => {
  return res.json({ success: true, ...resolveMobileRoute(req.body || {}) });
});

mobileRouter.get('/events/today', async (_req, res) => {
  const { start, end } = dayBounds();
  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        inArray(eventRequests.status, ['scheduled', 'rescheduled']),
        gte(eventRequests.scheduledEventDate, start),
        lte(eventRequests.scheduledEventDate, end)
      )
    )
    .orderBy(asc(eventRequests.scheduledEventDate), asc(eventRequests.eventStartTime));

  return res.json({ success: true, events: events.map(summarizeEvent) });
});

mobileRouter.get('/events/needs-action', async (_req, res) => {
  const events = await db
    .select()
    .from(eventRequests)
    .where(
      and(
        inArray(eventRequests.status, ['scheduled', 'rescheduled', 'in_process', 'standby']),
        or(
          eq(eventRequests.driversArranged, false),
          eq(eventRequests.toolkitSent, false)
        )
      )
    )
    .orderBy(asc(eventRequests.scheduledEventDate), asc(eventRequests.desiredEventDate))
    .limit(50);

  return res.json({ success: true, events: events.map(summarizeEvent) });
});

mobileRouter.get('/events/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return mobileError(res, 400, 'INVALID_EVENT_ID', 'Invalid event id');

  const [event] = await db.select().from(eventRequests).where(eq(eventRequests.id, id)).limit(1);
  if (!event) return mobileError(res, 404, 'EVENT_NOT_FOUND', 'Event not found');

  return res.json({ success: true, event: summarizeEvent(event) });
});

// Stable mobile collection contract wraps the existing implementation while native clients migrate.
mobileRouter.use('/collections', collectionsRouter);

export default mobileRouter;
