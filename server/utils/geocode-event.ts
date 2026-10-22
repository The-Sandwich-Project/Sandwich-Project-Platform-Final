import { eq } from 'drizzle-orm';
import { eventRequests } from '@shared/schema';
import { db } from '../db';
import { geocodeAddress } from './geocoding';
import { logger } from './production-safe-logger';

/**
 * Look up map coordinates for a newly created event without blocking the
 * request that created it. Mirrors what manual entry and the Sheets sync
 * already do, so events from every entry point get a pin on the map.
 * Only latitude/longitude are written (updatedAt is left alone) so the
 * background write doesn't look like a user edit.
 */
export function geocodeEventInBackground(
  eventId: number,
  address: string | null | undefined
): void {
  const trimmed = address?.trim();
  if (!trimmed) return;

  geocodeAddress(trimmed)
    .then(async (coords) => {
      if (!coords) {
        logger.warn(`⚠️ Geocoding returned no results for event ${eventId}: ${trimmed}`);
        return;
      }
      await db
        .update(eventRequests)
        .set({ latitude: coords.latitude, longitude: coords.longitude })
        .where(eq(eventRequests.id, eventId));
      logger.log(`✅ Geocoded event ${eventId}: ${trimmed}`);
    })
    .catch((error) => {
      logger.error(`Failed to geocode event ${eventId}:`, error);
    });
}
