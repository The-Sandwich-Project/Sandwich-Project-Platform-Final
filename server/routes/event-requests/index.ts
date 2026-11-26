/**
 * Event Requests - Combined Router
 *
 * This file combines all event request route modules into a single router.
 * Routes have been extracted from the legacy file for better organization.
 *
 * IMPORTANT: This is the main entry point for all event request routes.
 * The legacy router is imported and mounted FIRST to preserve critical
 * functionality (Google Sheets import, CRUD operations, etc.).
 *
 * Route organization:
 * - ../event-requests-legacy.ts - Core routes (Google Sheets import, CRUD, etc.)
 * - volunteers.ts - Volunteer signup and management
 * - flags.ts - Pre-event flag management
 * - ai.ts - AI-powered features (date suggestions, categorization)
 * - sms.ts - SMS notification routes
 * - organizations.ts - Organization management and duplicate checking
 * - sync.ts - Google Sheets sync routes (not import)
 * - audit.ts - Audit log retrieval
 * - conflicts.ts - Conflict detection and returning org checks
 * - lifecycle.ts - Lifecycle status updates (schedule calls, MLK Day, auto-complete)
 *
 * The legacy file (../event-requests-legacy.ts) still contains:
 * - Google Sheets IMPORT endpoint (CRITICAL)
 * - Core CRUD operations (create, read, update, delete events)
 * - Driver assignments
 * - TSP contact assignments
 * - Toolkit management
 * - Status changes (MLK Day, postpone, etc.)
 * - Recipient management
 * - Email sending
 */

import { Router } from 'express';
import { emitEventRequestUpdate } from '../../socket-chat';
import { logger } from '../../middleware/logger';
import { db } from '../../db';
import { eventRequests } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Import the main legacy router - contains core functionality
import legacyRouter from '../event-requests-legacy';

// Import extracted sub-route modules
import volunteersRouter from './volunteers';
import flagsRouter from './flags';
import aiRouter from './ai';
import smsRouter from './sms';
import organizationsRouter from './organizations';
import syncRouter from './sync';
import auditRouter from './audit';
import conflictsRouter from './conflicts';
import lifecycleRouter from './lifecycle';

const router = Router();

// Middleware: broadcast real-time updates to all connected clients on successful PATCH/PUT.
// This covers ALL sub-routers (legacy, volunteers, flags, etc.) so any event request
// mutation is automatically pushed to other users' browsers via Socket.IO.
router.use('/:id', (req, res, next) => {
  if (req.method !== 'PATCH' && req.method !== 'PUT') return next();

  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    // Only emit for successful responses (2xx) that return an event request object
    if (res.statusCode >= 200 && res.statusCode < 300 && body && body.id) {
      try {
        // Pass through the originating tab's socket id (sent by apiRequest as
        // X-Socket-Id) so that tab can ignore its own echo. Other users/tabs
        // and background processes won't match and still refresh as before.
        const originSocketId = req.headers['x-socket-id'];
        emitEventRequestUpdate('event_request_updated', {
          id: body.id,
          originSocketId: typeof originSocketId === 'string' ? originSocketId : undefined,
        });
      } catch (e) {
        // Don't let socket errors break the response
        logger.warn('Failed to emit event request update via socket:', e);
      }
    }
    return originalJson(body);
  } as any;
  next();
});

// Middleware: record that a PERSON changed this event (event_requests.last_human_update_at).
// Every write a signed-in user makes to /api/event-requests/:id/... passes
// through here, across all sub-routers. The Google Sheet sync and cron jobs
// write to the database directly, never through these routes, so they can't
// make an untouched event look recently worked on. The "no updates" event
// alert measures this column instead of updated_at.
// Not stamped: read-only AI helpers (POST, but they only return suggestions).
const NOT_AN_UPDATE = /^\/\d+\/ai-/;
router.use('/:id', (req: any, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || NOT_AN_UPDATE.test(req.originalUrl.replace(/^\/api\/event-requests/, '').split('?')[0])) {
    return next();
  }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.user?.id) return;
    db.update(eventRequests)
      .set({ lastHumanUpdateAt: new Date() })
      .where(eq(eventRequests.id, id))
      .catch((e: any) => logger.warn('Failed to stamp last_human_update_at:', e));
  });
  next();
});

// Mount the legacy router FIRST - this ensures all existing routes work
// The legacy router contains the critical Google Sheets import endpoint
router.use('/', legacyRouter);

// Mount extracted sub-routers (routes have been removed from legacy file)
router.use('/', volunteersRouter);
router.use('/', flagsRouter);
router.use('/', aiRouter);
router.use('/', smsRouter);
router.use('/', organizationsRouter);
router.use('/', syncRouter);
router.use('/', auditRouter);
router.use('/', conflictsRouter);
router.use('/', lifecycleRouter);

export default router;

// Re-export individual routers for testing or selective usage
export {
  volunteersRouter,
  flagsRouter,
  aiRouter,
  smsRouter,
  organizationsRouter,
  syncRouter,
  auditRouter,
  conflictsRouter,
  lifecycleRouter,
};
