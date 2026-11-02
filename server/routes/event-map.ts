import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { eventRequests } from '@shared/schema';
import { isNotNull, isNull, and, ne, eq, or } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { geocodeAddress, getLastGeocodingFailure } from '../utils/geocoding';
import { rateLimiter } from '../utils/rate-limiter';

const router = Router();

/**
 * Clean address for geocoding by removing suite/building/apartment numbers
 * that often cause geocoding failures
 */
function cleanAddressForGeocoding(address: string): string {
  let cleaned = address;

  // Remove suite/building/apartment numbers with various patterns
  const patternsToRemove = [
    /\s+building\s+\d+/gi,
    /\s+bldg\.?\s+\d+/gi,
    /\s+suite\s+[a-z0-9-]+/gi,
    /\s+ste\.?\s+[a-z0-9-]+/gi,
    /\s+apt\.?\s+[a-z0-9-]+/gi,
    /\s+apartment\s+[a-z0-9-]+/gi,
    /\s+unit\s+[a-z0-9-]+/gi,
    /\s+#\s*[a-z0-9-]+/gi,
    /\s+floor\s+\d+/gi,
    /\s+\d+(st|nd|rd|th)\s+floor/gi,
  ];

  for (const pattern of patternsToRemove) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove trailing commas that might be left after removal
  cleaned = cleaned.replace(/,\s*,/g, ',').replace(/,\s*$/, '');

  return cleaned;
}

/**
 * GET /api/event-map
 * Fetch all event requests that have addresses with their coordinates for map display
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    // Build query conditions
    const conditions = [
      isNotNull(eventRequests.eventAddress),
      ne(eventRequests.eventAddress, ''),
      isNull(eventRequests.deletedAt), // Exclude soft-deleted events
    ];

    // Filter by status if provided
    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push(eq(eventRequests.status, status));
    }

    const events = await db
      .select({
        id: eventRequests.id,
        organizationName: eventRequests.organizationName,
        organizationCategory: eventRequests.organizationCategory,
        department: eventRequests.department,
        firstName: eventRequests.firstName,
        lastName: eventRequests.lastName,
        email: eventRequests.email,
        phone: eventRequests.phone,
        eventAddress: eventRequests.eventAddress,
        latitude: eventRequests.latitude,
        longitude: eventRequests.longitude,
        desiredEventDate: eventRequests.desiredEventDate,
        scheduledEventDate: eventRequests.scheduledEventDate,
        status: eventRequests.status,
        estimatedSandwichCount: eventRequests.estimatedSandwichCount,
        // Sandwich type fields: Driver Planning shows the same summary as the
        // Scheduled card, which needs these. Without them every event read
        // "(type not set)" even when the type was filled in.
        estimatedSandwichCountMin: eventRequests.estimatedSandwichCountMin,
        estimatedSandwichCountMax: eventRequests.estimatedSandwichCountMax,
        estimatedSandwichRangeType: eventRequests.estimatedSandwichRangeType,
        sandwichTypes: eventRequests.sandwichTypes,
        tspContactAssigned: eventRequests.tspContactAssigned,
        tspContact: eventRequests.tspContact,
        customTspContact: eventRequests.customTspContact,
        eventStartTime: eventRequests.eventStartTime,
        eventEndTime: eventRequests.eventEndTime,
        googleSheetRowId: eventRequests.googleSheetRowId,
        externalId: eventRequests.externalId,
        driversNeeded: eventRequests.driversNeeded,
        assignedDriverIds: eventRequests.assignedDriverIds,
        tentativeDriverIds: eventRequests.tentativeDriverIds,
        speakersNeeded: eventRequests.speakersNeeded,
        assignedSpeakerIds: eventRequests.assignedSpeakerIds,
        volunteersNeeded: eventRequests.volunteersNeeded,
        assignedVolunteerIds: eventRequests.assignedVolunteerIds,
        pickupTime: eventRequests.pickupTime,
        pickupTimeWindow: eventRequests.pickupTimeWindow,
        selfTransport: eventRequests.selfTransport,
        vanDriverNeeded: eventRequests.vanDriverNeeded,
        assignedVanDriverId: eventRequests.assignedVanDriverId,
        isDhlVan: eventRequests.isDhlVan,
        assignedRecipientIds: eventRequests.assignedRecipientIds,
        recipientAllocations: eventRequests.recipientAllocations,
        driverDetails: eventRequests.driverDetails,
        speakerDetails: eventRequests.speakerDetails,
        volunteerDetails: eventRequests.volunteerDetails,
      })
      .from(eventRequests)
      .where(and(...conditions));

    // Deduplicate by ID (in case of any database-level duplicates)
    const seenIds = new Set<number>();
    const uniqueEvents = events.filter((event) => {
      if (seenIds.has(event.id)) {
        logger.warn(`Duplicate event ID ${event.id} detected in event-map endpoint`);
        return false;
      }
      seenIds.add(event.id);
      return true;
    });

    res.json(uniqueEvents);
  } catch (error) {
    logger.error('Error fetching event map data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch event map data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/event-map/geocode/:id
 * Geocode a specific event request's address
 * RATE LIMITED: 1 request per second to comply with Nominatim usage policy
 */
router.post('/geocode/:id', async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);

    // Fetch event
    const event = await db
      .select({
        id: eventRequests.id,
        eventAddress: eventRequests.eventAddress,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event || event.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event[0].eventAddress) {
      return res.status(400).json({ error: 'Event has no address to geocode' });
    }

    // Rate limit: Wait if needed to comply with Nominatim 1 req/sec policy
    await rateLimiter.checkAndWait('geocode', 1000);
    
    // Clean address for geocoding (remove suite/building numbers)
    const originalAddress = event[0].eventAddress;
    const cleanedAddress = cleanAddressForGeocoding(originalAddress);

    logger.log(`Geocoding event ${eventId}:`);
    logger.log(`  Original: ${originalAddress}`);
    logger.log(`  Cleaned:  ${cleanedAddress}`);

    // Try cleaned address first, then fall back to original if cleaning removed too much
    let coordinates = await geocodeAddress(cleanedAddress);

    if (!coordinates && cleanedAddress !== originalAddress) {
      logger.log(`  Cleaned address failed, trying original: ${originalAddress}`);
      coordinates = await geocodeAddress(originalAddress);
    }

    if (!coordinates) {
      const failure = getLastGeocodingFailure();
      logger.warn(`Geocoding failed for event ${eventId}: "${cleanedAddress}" (original: "${originalAddress}") — reason: ${failure.reason}: ${failure.detail}`);
      return res.status(400).json({
        error: 'Failed to geocode address',
        details: `Could not find coordinates for address: "${originalAddress}". Tried cleaning to: "${cleanedAddress}"`,
        geocodingError: failure.reason,
        geocodingDetail: failure.detail,
      });
    }

    // Update event with coordinates
    await db
      .update(eventRequests)
      .set({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        updatedAt: new Date(),
      })
      .where(eq(eventRequests.id, eventId));

    res.json({
      success: true,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });
  } catch (error) {
    logger.error('Error geocoding event address:', error);
    res.status(500).json({
      error: 'Failed to geocode address',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/event-map/geocode-address
 * Geocode an arbitrary address without saving to database
 * Used for quick location lookup in driver planning tool
 */
router.post('/geocode-address', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // Rate limit: Wait if needed
    await rateLimiter.checkAndWait('geocode', 200);

    // Clean address for geocoding (remove suite/building numbers)
    const trimmedAddress = address.trim();
    const cleanedAddress = cleanAddressForGeocoding(trimmedAddress);

    logger.log(`Quick geocode lookup:`);
    logger.log(`  Original: ${trimmedAddress}`);
    logger.log(`  Cleaned:  ${cleanedAddress}`);

    // Try cleaned address first, then fall back to original
    let coordinates = await geocodeAddress(cleanedAddress);

    if (!coordinates && cleanedAddress !== trimmedAddress) {
      logger.log(`  Cleaned address failed, trying original: ${trimmedAddress}`);
      coordinates = await geocodeAddress(trimmedAddress);
    }

    if (!coordinates) {
      const failure = getLastGeocodingFailure();
      logger.warn(`Quick geocode failed for: "${cleanedAddress}" (original: "${trimmedAddress}") — reason: ${failure.reason}: ${failure.detail}`);
      return res.status(400).json({
        error: 'Failed to geocode address',
        details: `Could not find coordinates for: "${trimmedAddress}"`,
        geocodingError: failure.reason,
        geocodingDetail: failure.detail,
      });
    }

    res.json({
      success: true,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      address: cleanedAddress, // Return cleaned address for display
      source: coordinates.source,
    });
  } catch (error) {
    logger.error('Error in quick geocode lookup:', error);
    res.status(500).json({
      error: 'Failed to geocode address',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/event-map/geocode-all
 * Batch geocode all events that have addresses but no coordinates
 * RATE LIMITED: Processes with ~1 second delay between each to comply with Nominatim usage policy
 */
async function startBatchGeocoding(req: Request, res: Response) {
  try {
    const eventsToGeocode = await db
      .select({
        id: eventRequests.id,
        eventAddress: eventRequests.eventAddress,
        organizationName: eventRequests.organizationName,
      })
      .from(eventRequests)
      .where(
        and(
          isNotNull(eventRequests.eventAddress),
          ne(eventRequests.eventAddress, ''),
          or(
            // Treat empty-string coordinates as missing (common in imported rows)
            isNull(eventRequests.latitude),
            eq(eventRequests.latitude, ''),
            eq(eventRequests.latitude, 'null'),
            isNull(eventRequests.longitude),
            eq(eventRequests.longitude, ''),
            eq(eventRequests.longitude, 'null')
          )
        )
      );

    if (eventsToGeocode.length === 0) {
      return res.json({
        success: true,
        message: 'All events with addresses already have coordinates',
        total: 0,
        started: false,
        geocoded: 0,
        failed: 0,
      });
    }

    // Start background geocoding process
    res.json({
      success: true,
      message: `Started geocoding ${eventsToGeocode.length} events in background. This may take a few minutes.`,
      total: eventsToGeocode.length,
      started: true,
    });

    // Process geocoding in background (don't block response)
    setTimeout(() => {
      void (async () => {
        let geocodedCount = 0;
        let failedCount = 0;

        for (const event of eventsToGeocode) {
          try {
            // Rate limit: Nominatim policy is 1 request/sec
            await rateLimiter.checkAndWait('geocode', 1100);

            const originalAddress = event.eventAddress!;
            const cleanedAddress = cleanAddressForGeocoding(originalAddress);
            let coordinates = await geocodeAddress(cleanedAddress);

            // Fallback to original if cleaning removed too much
            if (!coordinates && cleanedAddress !== originalAddress) {
              await rateLimiter.checkAndWait('geocode', 1100);
              coordinates = await geocodeAddress(originalAddress);
            }

            if (coordinates) {
              await db
                .update(eventRequests)
                .set({
                  latitude: coordinates.latitude,
                  longitude: coordinates.longitude,
                  updatedAt: new Date(),
                })
                .where(eq(eventRequests.id, event.id));

              geocodedCount++;
              logger.info(
                `✅ Batch geocoded event ${event.id}: ${event.organizationName || 'Unknown'} - ${cleanedAddress}`
              );
            } else {
              failedCount++;
              logger.warn(
                `❌ Failed to geocode event ${event.id}: ${event.organizationName || 'Unknown'} - ${cleanedAddress}`
              );
            }
          } catch (err) {
            failedCount++;
            logger.error(`Error geocoding event ${event.id}:`, err);
          }
        }

        logger.info(
          `Batch geocoding complete: ${geocodedCount} geocoded, ${failedCount} failed (total ${eventsToGeocode.length})`
        );
      })();
    }, 0);
  } catch (error) {
    logger.error('Error starting batch geocoding:', error);
    res.status(500).json({ 
      error: 'Failed to start batch geocoding',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Preferred route name
router.post('/geocode-all', startBatchGeocoding);
// Backwards-compatible alias (in case older tooling/UI calls this)
router.post('/batch-geocode', startBatchGeocoding);

export default router;
