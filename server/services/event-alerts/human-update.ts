/**
 * "A person just changed this event": stamps event_requests.last_human_update_at,
 * which the "no updates" event alert measures (see ./rules.ts).
 *
 * Called for successful writes made by a signed-in user:
 *  - every write to /api/event-requests/:id/... (middleware in
 *    server/routes/event-requests/index.ts)
 *  - the event-request routes that take the id from the body
 *    (/complete-contact, /complete-event-details, /follow-up)
 *  - notification action buttons on an event (approve, decline, assign
 *    contact, mark toolkit sent)
 * Never call it from the Google Sheet sync, cron jobs, geocoding or other
 * automation: that's the whole point of the column.
 *
 * Fire-and-forget: a failure is logged and never fails the user's request.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { eventRequests } from '@shared/schema';
import { logger } from '../../utils/production-safe-logger';

export function markEventHumanUpdated(eventId: unknown): void {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) return;
  db.update(eventRequests)
    .set({ lastHumanUpdateAt: new Date() })
    .where(eq(eventRequests.id, id))
    .catch((e: unknown) => logger.warn('Failed to stamp last_human_update_at', { eventId: id, error: String(e) } as any));
}
