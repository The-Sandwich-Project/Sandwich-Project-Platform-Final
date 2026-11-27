/**
 * Event Conflict Detection Service
 *
 * Automatically detects scheduling conflicts for events:
 * - Van booking conflicts (overlapping times when van is needed)
 * - High volume days (multiple events on same day)
 * - Van driver conflicts (same van driver assigned to overlapping events)
 * - Speaker conflicts (same speaker assigned to overlapping events)
 * - Recipient conflicts (same recipient has another event)
 * - Pickup time conflicts (multiple events with similar pickup times)
 *
 * Conflicts are flagged but don't prevent event creation.
 */

import { db } from '../db';
import { eventRequests, drivers } from '@shared/schema';
import { eq, and, ne, gte, lte, or, sql, inArray } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { isScheduledOrRescheduled } from '../../shared/event-status-workflow';

export interface ConflictWarning {
  type: 'van_conflict' | 'high_volume_day' | 'driver_conflict' | 'recipient_conflict' | 'time_overlap' | 'pickup_conflict' | 'high_volume_week';
  severity: 'warning' | 'critical' | 'suggestion';
  message: string;
  conflictingEventId?: number;
  conflictingEventName?: string;
  conflictingEventTime?: string;
  details?: Record<string, any>;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  warnings: ConflictWarning[];
  summary: string;
}

/**
 * Parse time string (e.g., "2:30 PM", "14:30") to minutes since midnight
 */
function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;

  // Try parsing "HH:MM AM/PM" format
  const amPmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (amPmMatch) {
    let hours = parseInt(amPmMatch[1], 10);
    const minutes = parseInt(amPmMatch[2], 10);
    const period = amPmMatch[3]?.toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  // Try parsing "HH:MM" 24-hour format
  const h24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    const hours = parseInt(h24Match[1], 10);
    const minutes = parseInt(h24Match[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Check if two time ranges overlap
 */
function timesOverlap(
  start1: number | null,
  end1: number | null,
  start2: number | null,
  end2: number | null
): boolean {
  // If we don't have complete time info, assume potential overlap
  if (start1 === null || end1 === null || start2 === null || end2 === null) {
    return true; // Conservative: assume overlap if we can't determine
  }

  // Check for overlap: one range starts before the other ends
  return start1 < end2 && start2 < end1;
}

/**
 * Get the date portion of a Date object as YYYY-MM-DD string
 */
function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Check for all conflicts for an event
 */
export async function checkEventConflicts(
  eventData: {
    id?: number; // If editing existing event
    scheduledEventDate?: Date | string | null;
    eventStartTime?: string | null;
    eventEndTime?: string | null;
    pickupTime?: string | null; // Pickup time for drivers
    vanDriverNeeded?: boolean | null; // Whether a van driver is required
    isDhlVan?: boolean | null; // External DHL van covers transportation
    selfTransport?: boolean | null; // Organization transporting sandwiches themselves
    assignedVanDriverId?: string | null; // Van driver ID from database
    assignedSpeakerIds?: string[] | null; // Array of speaker IDs
    assignedRecipientIds?: string[] | null; // Array of recipient IDs
    organizationName?: string | null;
    // Legacy fields for backwards compatibility
    vanBooked?: string | null;
    driverName?: string | null;
    recipientId?: number | null;
  }
): Promise<ConflictCheckResult> {
  const warnings: ConflictWarning[] = [];

  // Parse the scheduled date
  let scheduledDate: Date | null = null;
  if (eventData.scheduledEventDate) {
    scheduledDate = typeof eventData.scheduledEventDate === 'string'
      ? new Date(eventData.scheduledEventDate)
      : eventData.scheduledEventDate;
  }

  if (!scheduledDate || isNaN(scheduledDate.getTime())) {
    return {
      hasConflicts: false,
      warnings: [],
      summary: 'No scheduled date provided - cannot check conflicts',
    };
  }

  const dateStr = getDateString(scheduledDate);
  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

  try {
    // Find all other events on the same day (excluding current event if editing)
    // Include new, in_process, scheduled, and rescheduled for high volume detection
    const allRelevantConditions = [
      gte(eventRequests.scheduledEventDate, startOfDay),
      lte(eventRequests.scheduledEventDate, endOfDay),
      // Include new, in_process, scheduled, and rescheduled events (not cancelled/completed/declined)
      or(
        eq(eventRequests.status, 'new'),
        eq(eventRequests.status, 'in_process'),
        eq(eventRequests.status, 'scheduled'),
        eq(eventRequests.status, 'rescheduled')
      ),
    ];

    if (eventData.id) {
      allRelevantConditions.push(ne(eventRequests.id, eventData.id));
    }

    const allEventsOnSameDay = await db
      .select()
      .from(eventRequests)
      .where(and(...allRelevantConditions));

    // Only check against scheduled (or rescheduled) events for resource conflicts.
    // Scheduled events take precedence - new/in_process events need to work around them.
    // Rescheduled events also have locked-in dates and should count as scheduled.
    const eventsOnSameDay = allEventsOnSameDay.filter(
      e => isScheduledOrRescheduled(e.status)
    );

    // Check 1: High volume day warning (count all relevant events including new/in_process)
    // This still shows all events for awareness, even if they're not scheduled yet
    if (allEventsOnSameDay.length >= 2) {
      const scheduledCount = eventsOnSameDay.length;
      const pendingCount = allEventsOnSameDay.length - scheduledCount;

      let message: string;
      if (pendingCount > 0 && scheduledCount > 0) {
        message = `${scheduledCount} scheduled + ${pendingCount} pending event(s) for ${scheduledDate.toLocaleDateString()}`;
      } else if (pendingCount > 0) {
        message = `${pendingCount} pending event(s) already being planned for ${scheduledDate.toLocaleDateString()}`;
      } else {
        message = `${scheduledCount} event(s) already scheduled for ${scheduledDate.toLocaleDateString()}`;
      }

      warnings.push({
        type: 'high_volume_day',
        severity: allEventsOnSameDay.length >= 4 ? 'critical' : 'warning',
        message,
        details: {
          eventCount: allEventsOnSameDay.length + 1, // Include the new event
          scheduledCount,
          pendingCount,
          events: allEventsOnSameDay.map(e => ({
            id: e.id,
            name: e.organizationName,
            time: e.eventStartTime,
            status: e.status,
          })),
        },
      });
    }

    // Parse current event times
    const currentStart = parseTimeToMinutes(eventData.eventStartTime);
    const currentEnd = parseTimeToMinutes(eventData.eventEndTime);
    const currentPickup = parseTimeToMinutes(eventData.pickupTime);

    // Determine if current event needs van (using proper schema fields)
    // Support both new schema fields and legacy vanBooked field for backwards compatibility
    const currentNeedsVan = eventData.isDhlVan === true ? false : (
      (eventData.vanDriverNeeded === true && eventData.selfTransport !== true) ||
      (eventData.vanBooked && eventData.vanBooked.toLowerCase() !== 'no' && eventData.vanBooked.toLowerCase() !== 'false')
    );

    // Get van driver ID (new field or legacy driverName)
    const currentVanDriverId = eventData.assignedVanDriverId || eventData.driverName || null;

    // Helper to normalize PostgreSQL array format to JS array of strings
    // This ensures consistent string comparison for IDs
    const normalizeArrayField = (field: any): string[] => {
      if (!field) return [];
      if (Array.isArray(field)) return field.filter(Boolean).map(String);
      if (typeof field === 'string' && field.startsWith('{') && field.endsWith('}')) {
        // PostgreSQL array format: {val1,val2,val3}
        const content = field.slice(1, -1);
        if (!content) return [];
        return content.split(',').map(v => v.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      return [String(field)];
    };

    // (Speaker role retired: speaker double-booking is no longer checked.)

    // Get recipient IDs (array) - support both new array format and legacy single recipientId
    // Normalize to strings for consistent comparison with database values
    const currentRecipientIds = eventData.assignedRecipientIds && eventData.assignedRecipientIds.length > 0
      ? normalizeArrayField(eventData.assignedRecipientIds)
      : (eventData.recipientId ? [String(eventData.recipientId)] : []);

    // Fetch driver names for better messaging
    const driverNamesMap = new Map<string, string>();
    const allDriverIds = new Set<string>();

    if (currentVanDriverId) allDriverIds.add(currentVanDriverId);
    for (const event of eventsOnSameDay) {
      if (event.assignedVanDriverId) allDriverIds.add(event.assignedVanDriverId);
    }

    if (allDriverIds.size > 0) {
      try {
        const driverRecords = await db
          .select({ id: drivers.id, name: drivers.name })
          .from(drivers)
          .where(inArray(drivers.id, Array.from(allDriverIds).map(Number).filter(n => !isNaN(n))));

        for (const driver of driverRecords) {
          driverNamesMap.set(String(driver.id), driver.name);
        }
      } catch (err) {
        // If driver lookup fails, continue without names
        logger.warn('Could not fetch driver names for conflict messages');
      }
    }

    // Track already reported conflicts to avoid duplicates
    const reportedVanConflicts = new Set<number>();
    const reportedDriverConflicts = new Set<string>();
    const reportedRecipientConflicts = new Set<string>();

    // Check each event for specific conflicts
    for (const existingEvent of eventsOnSameDay) {
      const existingStart = parseTimeToMinutes(existingEvent.eventStartTime);
      const existingEnd = parseTimeToMinutes(existingEvent.eventEndTime);
      const existingPickup = parseTimeToMinutes(existingEvent.pickupTime || existingEvent.driverPickupTime);
      const hasTimeOverlap = timesOverlap(currentStart, currentEnd, existingStart, existingEnd);

      // Check 2: Van booking conflict
      // An event needs the van if vanDriverNeeded is true AND selfTransport is false
      const existingNeedsVan = existingEvent.vanDriverNeeded === true && existingEvent.selfTransport !== true && existingEvent.isDhlVan !== true;

      if (currentNeedsVan && existingNeedsVan && hasTimeOverlap && !reportedVanConflicts.has(existingEvent.id)) {
        reportedVanConflicts.add(existingEvent.id);
        warnings.push({
          type: 'van_conflict',
          severity: 'critical',
          message: `Van already needed for "${existingEvent.organizationName}" at ${existingEvent.eventStartTime || 'TBD'}. Only one van is available.`,
          conflictingEventId: existingEvent.id,
          conflictingEventName: existingEvent.organizationName || 'Unknown',
          conflictingEventTime: existingEvent.eventStartTime || undefined,
          details: {
            existingEventAddress: existingEvent.eventAddress,
            existingPickupTime: existingEvent.pickupTime || existingEvent.driverPickupTime,
          },
        });
      }

      // Check 3: Van Driver conflict (same driver assigned to overlapping events)
      const existingVanDriverId = existingEvent.assignedVanDriverId;
      if (currentVanDriverId && existingVanDriverId && hasTimeOverlap) {
        const conflictKey = `${currentVanDriverId}-${existingEvent.id}`;
        if (currentVanDriverId === existingVanDriverId && !reportedDriverConflicts.has(conflictKey)) {
          reportedDriverConflicts.add(conflictKey);
          const driverDisplayName = driverNamesMap.get(currentVanDriverId) || `Driver #${currentVanDriverId}`;
          warnings.push({
            type: 'driver_conflict',
            severity: 'critical',
            message: `${driverDisplayName} is already assigned to drive for "${existingEvent.organizationName}" at ${existingEvent.eventStartTime || 'TBD'}`,
            conflictingEventId: existingEvent.id,
            conflictingEventName: existingEvent.organizationName || 'Unknown',
            conflictingEventTime: existingEvent.eventStartTime || undefined,
            details: { driverName: driverDisplayName, driverId: currentVanDriverId },
          });
        }
      }

      // Check 4 (Speaker conflict) removed — the speaker role has been retired.

      // Check 5: Recipient conflict (same recipient has multiple events on same day)
      const existingRecipientIds = normalizeArrayField(existingEvent.assignedRecipientIds);
      if (currentRecipientIds.length > 0 && existingRecipientIds.length > 0) {
        for (const recipientId of currentRecipientIds) {
          const conflictKey = `${recipientId}-${existingEvent.id}`;
          if (existingRecipientIds.includes(recipientId) && !reportedRecipientConflicts.has(conflictKey)) {
            reportedRecipientConflicts.add(conflictKey);
            warnings.push({
              type: 'recipient_conflict',
              severity: 'warning',
              message: `Same recipient already receiving sandwiches from "${existingEvent.organizationName}" on this day`,
              conflictingEventId: existingEvent.id,
              conflictingEventName: existingEvent.organizationName || 'Unknown',
              conflictingEventTime: existingEvent.eventStartTime || undefined,
              details: { recipientId },
            });
          }
        }
      }

      // Check 6: Pickup time conflict (same driver has pickups within 30 minutes of each other)
      // Only matters if the same driver is assigned to both events
      if (currentVanDriverId && existingVanDriverId && currentVanDriverId === existingVanDriverId) {
        if (currentPickup !== null && existingPickup !== null) {
          const pickupDifference = Math.abs(currentPickup - existingPickup);
          const PICKUP_CONFLICT_THRESHOLD = 30; // 30 minutes

          if (pickupDifference <= PICKUP_CONFLICT_THRESHOLD && pickupDifference > 0) {
            const driverDisplayName = driverNamesMap.get(currentVanDriverId) || `Driver #${currentVanDriverId}`;
            warnings.push({
              type: 'pickup_conflict',
              severity: 'warning',
              message: `${driverDisplayName} has another pickup within ${pickupDifference} minutes for "${existingEvent.organizationName}" (${existingEvent.pickupTime || existingEvent.driverPickupTime || 'TBD'})`,
              conflictingEventId: existingEvent.id,
              conflictingEventName: existingEvent.organizationName || 'Unknown',
              conflictingEventTime: existingEvent.pickupTime || existingEvent.driverPickupTime || undefined,
              details: {
                driverName: driverDisplayName,
                driverId: currentVanDriverId,
                currentPickupTime: eventData.pickupTime,
                existingPickupTime: existingEvent.pickupTime || existingEvent.driverPickupTime,
                timeDifferenceMinutes: pickupDifference,
              },
            });
          }
        }
      }
    }

    // Check 7: Weekly capacity check (sandwich volume for the week)
    // This is a suggestion, not a warning - helps groups choose lighter weeks
    try {
      const WEEKLY_SANDWICH_THRESHOLD = 4000;
      // Get Monday and Sunday of the event's week
      const dayOfWeek = scheduledDate.getUTCDay(); // 0=Sun, 1=Mon, ...
      const monday = new Date(scheduledDate);
      monday.setUTCDate(scheduledDate.getUTCDate() - ((dayOfWeek + 6) % 7)); // Go back to Monday
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const weekEvents = await db
        .select()
        .from(eventRequests)
        .where(
          and(
            gte(eventRequests.scheduledEventDate, monday),
            lte(eventRequests.scheduledEventDate, sunday),
            or(
              eq(eventRequests.status, 'scheduled'),
              eq(eventRequests.status, 'rescheduled')
            ),
            ...(eventData.id ? [ne(eventRequests.id, eventData.id)] : [])
          )
        );

      const weekSandwichTotal = weekEvents.reduce((sum, e) => {
        return sum + (e.estimatedSandwichCount || 0);
      }, 0);
      const weekEventCount = weekEvents.length;

      if (weekSandwichTotal >= WEEKLY_SANDWICH_THRESHOLD) {
        const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        warnings.push({
          type: 'high_volume_week',
          severity: 'suggestion',
          message: `This week (${weekLabel}) already has ${weekEventCount} scheduled event${weekEventCount !== 1 ? 's' : ''} totaling ~${weekSandwichTotal.toLocaleString()} sandwiches. Consider suggesting a lighter week.`,
          details: {
            weekStart: monday.toISOString(),
            weekEnd: sunday.toISOString(),
            weekSandwichTotal,
            weekEventCount,
            threshold: WEEKLY_SANDWICH_THRESHOLD,
            events: weekEvents.map(e => ({
              id: e.id,
              name: e.organizationName,
              date: e.scheduledEventDate,
              sandwiches: e.estimatedSandwichCount || 0,
            })),
          },
        });
      }
    } catch (err) {
      logger.warn('Could not check weekly capacity:', err);
    }

    // Generate summary
    const criticalCount = warnings.filter(w => w.severity === 'critical').length;
    const warningCount = warnings.filter(w => w.severity === 'warning').length;

    const suggestionCount = warnings.filter(w => w.severity === 'suggestion').length;

    let summary = 'No conflicts detected';
    if (warnings.length > 0) {
      const parts = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
      if (suggestionCount > 0) parts.push(`${suggestionCount} suggestion${suggestionCount > 1 ? 's' : ''}`);
      summary = `${parts.join(', ')} found`;
    }

    return {
      hasConflicts: warnings.length > 0,
      warnings,
      summary,
    };
  } catch (error) {
    logger.error('Error checking event conflicts:', error);
    return {
      hasConflicts: false,
      warnings: [],
      summary: 'Error checking conflicts - please review manually',
    };
  }
}

/**
 * Get conflicts for a specific date (useful for calendar views)
 */
export async function getConflictsForDate(date: Date): Promise<{
  vanConflicts: Array<{ event1: any; event2: any }>;
  driverConflicts: Array<{ driver: string; events: any[] }>;
  highVolume: boolean;
  eventCount: number;
}> {
  const dateStr = getDateString(date);
  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

  try {
    // Get all relevant events (new, in_process, scheduled, rescheduled) for high volume
    const allEvents = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          gte(eventRequests.scheduledEventDate, startOfDay),
          lte(eventRequests.scheduledEventDate, endOfDay),
          or(
            eq(eventRequests.status, 'new'),
            eq(eventRequests.status, 'in_process'),
            eq(eventRequests.status, 'scheduled'),
            eq(eventRequests.status, 'rescheduled')
          )
        )
      );

    // For van/driver conflicts, only check scheduled/rescheduled events (with locked-in dates)
    const scheduledEvents = allEvents.filter(
      e => e.status === 'scheduled' || e.status === 'rescheduled'
    );

    const vanConflicts: Array<{ event1: any; event2: any }> = [];
    const driverGroups: Map<string, any[]> = new Map();

    // Check each pair of scheduled events
    for (let i = 0; i < scheduledEvents.length; i++) {
      const event1 = scheduledEvents[i];

      // Track van drivers by ID
      if (event1.assignedVanDriverId) {
        const driverKey = event1.assignedVanDriverId;
        if (!driverGroups.has(driverKey)) {
          driverGroups.set(driverKey, []);
        }
        driverGroups.get(driverKey)!.push(event1);
      }

      for (let j = i + 1; j < scheduledEvents.length; j++) {
        const event2 = scheduledEvents[j];

        // Check van conflict (using proper schema fields)
        const van1 = event1.vanDriverNeeded === true && event1.selfTransport !== true;
        const van2 = event2.vanDriverNeeded === true && event2.selfTransport !== true;

        if (van1 && van2) {
          const start1 = parseTimeToMinutes(event1.eventStartTime);
          const end1 = parseTimeToMinutes(event1.eventEndTime);
          const start2 = parseTimeToMinutes(event2.eventStartTime);
          const end2 = parseTimeToMinutes(event2.eventEndTime);

          if (timesOverlap(start1, end1, start2, end2)) {
            vanConflicts.push({ event1, event2 });
          }
        }
      }
    }

    // Find driver conflicts (drivers with multiple events that overlap in time)
    const driverConflicts = Array.from(driverGroups.entries())
      .filter(([_, events]) => {
        if (events.length < 2) return false;
        // Check if any pair of events overlaps in time
        for (let i = 0; i < events.length; i++) {
          for (let j = i + 1; j < events.length; j++) {
            const start1 = parseTimeToMinutes(events[i].eventStartTime);
            const end1 = parseTimeToMinutes(events[i].eventEndTime);
            const start2 = parseTimeToMinutes(events[j].eventStartTime);
            const end2 = parseTimeToMinutes(events[j].eventEndTime);
            if (timesOverlap(start1, end1, start2, end2)) {
              return true;
            }
          }
        }
        return false;
      })
      .map(([driver, events]) => ({ driver, events }));

    return {
      vanConflicts,
      driverConflicts,
      highVolume: allEvents.length >= 3, // Count all relevant events for high volume
      eventCount: allEvents.length,
    };
  } catch (error) {
    logger.error('Error getting conflicts for date:', error);
    return {
      vanConflicts: [],
      driverConflicts: [],
      highVolume: false,
      eventCount: 0,
    };
  }
}

export interface SameDayVanRequest {
  id: number;
  organizationName: string | null;
  status: string;
  vanDriverNeeded: boolean;
  vanNeededLikely: boolean;
  eventStartTime: string | null;
  eventEndTime: string | null;
  vanNeededFor: string | null;
  /** "Events team OK'd sharing the van" (shared/van-rules.ts). */
  vanTeamOk: boolean;
  vanTimeOverride: string | null;
}

/**
 * Other in-process or scheduled events on the same effective date that also
 * need (or may need) the org van. Uses COALESCE(scheduledEventDate, desiredEventDate)
 * so in-process cards with only a desired date still match correctly.
 */
export async function getOtherVanRequestsOnDate(
  date: Date,
  excludeEventId?: number
): Promise<{ otherEvents: SameDayVanRequest[] }> {
  const dateStr = getDateString(date);
  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');
  const effectiveDate = sql`COALESCE(${eventRequests.scheduledEventDate}, ${eventRequests.desiredEventDate})`;

  try {
    const conditions = [
      gte(effectiveDate, startOfDay),
      lte(effectiveDate, endOfDay),
      or(
        eq(eventRequests.status, 'in_process'),
        eq(eventRequests.status, 'scheduled'),
        eq(eventRequests.status, 'rescheduled')
      ),
      or(
        eq(eventRequests.vanDriverNeeded, true),
        eq(eventRequests.vanNeededLikely, true)
      ),
    ];

    if (excludeEventId) {
      conditions.push(ne(eventRequests.id, excludeEventId));
    }

    const rows = await db
      .select({
        id: eventRequests.id,
        organizationName: eventRequests.organizationName,
        status: eventRequests.status,
        vanDriverNeeded: eventRequests.vanDriverNeeded,
        vanNeededLikely: eventRequests.vanNeededLikely,
        eventStartTime: eventRequests.eventStartTime,
        eventEndTime: eventRequests.eventEndTime,
        vanNeededFor: eventRequests.vanNeededFor,
        vanTeamOk: eventRequests.vanTeamOk,
        vanTimeOverride: eventRequests.vanTimeOverride,
        selfTransport: eventRequests.selfTransport,
        isDhlVan: eventRequests.isDhlVan,
      })
      .from(eventRequests)
      .where(and(...conditions));

    const otherEvents: SameDayVanRequest[] = rows
      .filter((row) => row.selfTransport !== true && row.isDhlVan !== true)
      .map(({ selfTransport: _st, isDhlVan: _dhl, ...event }) => ({
        ...event,
        vanDriverNeeded: event.vanDriverNeeded === true,
      }));

    return { otherEvents };
  } catch (error) {
    logger.error('Error getting other van requests for date:', error);
    return { otherEvents: [] };
  }
}

// ============================================================================
// Whole-calendar van conflict scan
// ============================================================================

export interface VanConflictEvent {
  id: number;
  organizationName: string | null;
  status: string;
  vanDriverNeeded: boolean;
  vanNeededLikely: boolean;
  eventDate: string; // ISO date string YYYY-MM-DD
  eventStartTime: string | null;
}

export interface VanConflictDate {
  date: string; // YYYY-MM-DD
  events: VanConflictEvent[];
  confirmedCount: number;
  possiblyCount: number;
}

export interface VanConflictsResult {
  /** Dates with 2+ events where ALL are vanDriverNeeded=true. Must-resolve. */
  confirmed: VanConflictDate[];
  /** Dates with 2+ van events including at least one vanNeededLikely. Worth watching. */
  potential: VanConflictDate[];
  /** Total events scanned (across all active statuses, excluding DHL + self-transport). */
  totalEventsScanned: number;
  /** When the scan ran (server time, ISO). */
  scannedAt: string;
}

/**
 * Scan every in-process / scheduled / rescheduled event request that has the
 * org van promised (confirmed or possibly), group by effective event date,
 * and return any dates with 2+ events on them.
 *
 * - "confirmed" bucket: every event on the date has vanDriverNeeded=true.
 *   These are double-bookings that must be resolved.
 * - "potential" bucket: at least one event is vanNeededLikely. Worth flagging
 *   while still soft — possibly resolved before scheduling.
 *
 * Excludes self-transport orgs (they bring their own) and DHL-van events
 * (DHL provides the vehicle, not TSP's van).
 */
export async function getAllVanConflictDates(): Promise<VanConflictsResult> {
  const effectiveDate = sql<string>`to_char(COALESCE(${eventRequests.scheduledEventDate}, ${eventRequests.desiredEventDate}), 'YYYY-MM-DD')`;

  try {
    const rows = await db
      .select({
        id: eventRequests.id,
        organizationName: eventRequests.organizationName,
        status: eventRequests.status,
        vanDriverNeeded: eventRequests.vanDriverNeeded,
        vanNeededLikely: eventRequests.vanNeededLikely,
        eventDate: effectiveDate,
        eventStartTime: eventRequests.eventStartTime,
        selfTransport: eventRequests.selfTransport,
        isDhlVan: eventRequests.isDhlVan,
      })
      .from(eventRequests)
      .where(
        and(
          or(
            eq(eventRequests.status, 'in_process'),
            eq(eventRequests.status, 'scheduled'),
            eq(eventRequests.status, 'rescheduled')
          ),
          or(
            eq(eventRequests.vanDriverNeeded, true),
            eq(eventRequests.vanNeededLikely, true)
          )
        )
      );

    // Drop self-transport and DHL van events — they don't compete for the org van.
    const eligible = rows.filter(
      (row) => row.selfTransport !== true && row.isDhlVan !== true && !!row.eventDate
    );

    // Group by date.
    const byDate = new Map<string, VanConflictEvent[]>();
    for (const row of eligible) {
      const dateKey = row.eventDate as string;
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push({
        id: row.id,
        organizationName: row.organizationName,
        status: row.status,
        vanDriverNeeded: row.vanDriverNeeded === true,
        vanNeededLikely: row.vanNeededLikely === true,
        eventDate: dateKey,
        eventStartTime: row.eventStartTime,
      });
    }

    const confirmed: VanConflictDate[] = [];
    const potential: VanConflictDate[] = [];

    for (const [date, events] of byDate.entries()) {
      if (events.length < 2) continue;

      const confirmedCount = events.filter((e) => e.vanDriverNeeded).length;
      const possiblyCount = events.filter(
        (e) => !e.vanDriverNeeded && e.vanNeededLikely
      ).length;

      // Sort events on the date by time (nulls last), then by id for stable order.
      events.sort((a, b) => {
        const ta = a.eventStartTime ?? '99:99';
        const tb = b.eventStartTime ?? '99:99';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.id - b.id;
      });

      const entry: VanConflictDate = {
        date,
        events,
        confirmedCount,
        possiblyCount,
      };

      // Confirmed bucket: ALL events on this date are confirmed van-needed.
      // (Two confirmed + any possibly is still a confirmed double-booking, so
      // we count it as confirmed any time confirmedCount >= 2.)
      if (confirmedCount >= 2) {
        confirmed.push(entry);
      } else if (confirmedCount + possiblyCount >= 2) {
        // At least one is still "possibly" — not yet a hard conflict.
        potential.push(entry);
      }
    }

    // Sort buckets chronologically (soonest first).
    confirmed.sort((a, b) => (a.date < b.date ? -1 : 1));
    potential.sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      confirmed,
      potential,
      totalEventsScanned: eligible.length,
      scannedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Error scanning van conflicts:', error);
    return {
      confirmed: [],
      potential: [],
      totalEventsScanned: 0,
      scannedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get weekly capacity summary for a date range.
 * Returns sandwich totals and event counts per week (Mon–Sun).
 */
export async function getWeeklyCapacity(
  rangeStart: Date,
  rangeEnd: Date
): Promise<Array<{
  weekStart: string;
  weekEnd: string;
  sandwichTotal: number;
  eventCount: number;
  events: Array<{ id: number; name: string | null; date: string | null; sandwiches: number }>;
}>> {
  try {
    const events = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          gte(eventRequests.scheduledEventDate, rangeStart),
          lte(eventRequests.scheduledEventDate, rangeEnd),
          or(
            eq(eventRequests.status, 'scheduled'),
            eq(eventRequests.status, 'rescheduled')
          )
        )
      );

    // Group events by week (Monday start)
    const weekMap = new Map<string, {
      weekStart: Date;
      weekEnd: Date;
      sandwichTotal: number;
      eventCount: number;
      events: Array<{ id: number; name: string | null; date: string | null; sandwiches: number }>;
    }>();

    for (const event of events) {
      if (!event.scheduledEventDate) continue;
      const eventDate = new Date(event.scheduledEventDate);
      const dayOfWeek = eventDate.getUTCDay();
      const monday = new Date(eventDate);
      monday.setUTCDate(eventDate.getUTCDate() - ((dayOfWeek + 6) % 7));
      monday.setUTCHours(0, 0, 0, 0);
      const weekKey = monday.toISOString().split('T')[0];

      if (!weekMap.has(weekKey)) {
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);
        weekMap.set(weekKey, {
          weekStart: monday,
          weekEnd: sunday,
          sandwichTotal: 0,
          eventCount: 0,
          events: [],
        });
      }

      const week = weekMap.get(weekKey)!;
      week.sandwichTotal += event.estimatedSandwichCount || 0;
      week.eventCount += 1;
      week.events.push({
        id: event.id,
        name: event.organizationName,
        date: event.scheduledEventDate ? getDateString(new Date(event.scheduledEventDate)) : null,
        sandwiches: event.estimatedSandwichCount || 0,
      });
    }

    return Array.from(weekMap.values())
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .map(w => ({
        weekStart: getDateString(w.weekStart),
        weekEnd: getDateString(w.weekEnd),
        sandwichTotal: w.sandwichTotal,
        eventCount: w.eventCount,
        events: w.events,
      }));
  } catch (error) {
    logger.error('Error getting weekly capacity:', error);
    return [];
  }
}
