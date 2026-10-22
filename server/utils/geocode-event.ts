import { and, eq } from 'drizzle-orm';
import { eventRequests } from '@shared/schema';
import { db } from '../db';
import { RATE_LIMITS } from '../config/constants';
import { geocodeAddress } from './geocoding';
import { logger } from './production-safe-logger';

export interface EventToGeocode {
  id: number;
  /** The event's stored address, exactly as saved. */
  eventAddress: string | null | undefined;
}

/**
 * Look up map coordinates for newly created events without blocking the
 * request that created them, so events from every entry point get a pin.
 *
 * - Lookups run one at a time, paced like geocodeAddresses(): a large import
 *   must not fire hundreds of requests at once, and the OpenStreetMap fallback
 *   allows at most one request per second.
 * - Coordinates are written only if the event still has the address that was
 *   looked up, so a slow lookup can't overwrite pins for an address a user
 *   corrected in the meantime.
 * - Only latitude/longitude are written (updatedAt is left alone) so the
 *   background write doesn't look like a user edit.
 */
export function geocodeEventsInBackground(events: EventToGeocode[]): void {
  const pending = events.filter((e) => e.eventAddress?.trim());
  if (pending.length === 0) return;

  void (async () => {
    for (let i = 0; i < pending.length; i++) {
      const { id, eventAddress } = pending[i];
      const address = eventAddress as string;
      let usedOpenStreetMap = true;
      try {
        const coords = await geocodeAddress(address.trim());
        if (coords) {
          usedOpenStreetMap = coords.source === 'openstreetmap';
          await db
            .update(eventRequests)
            .set({ latitude: coords.latitude, longitude: coords.longitude })
            .where(and(eq(eventRequests.id, id), eq(eventRequests.eventAddress, address)));
          logger.log(`✅ Geocoded event ${id}: ${address.trim()}`);
        } else {
          logger.warn(`⚠️ Geocoding returned no results for event ${id}: ${address.trim()}`);
        }
      } catch (error) {
        logger.error(`Failed to geocode event ${id}:`, error);
      }

      if (i < pending.length - 1) {
        const delayMs = usedOpenStreetMap
          ? RATE_LIMITS.OPENSTREETMAP
          : RATE_LIMITS.GOOGLE_GEOCODING;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  })();
}

/** Single-event convenience wrapper around geocodeEventsInBackground(). */
export function geocodeEventInBackground(
  eventId: number,
  address: string | null | undefined
): void {
  geocodeEventsInBackground([{ id: eventId, eventAddress: address }]);
}
