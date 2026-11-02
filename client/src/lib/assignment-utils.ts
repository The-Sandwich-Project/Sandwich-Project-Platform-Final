import { extractNameFromAssignmentId } from '@shared/assignment-ids';

/**
 * Centralized utilities for reading assignment data.
 *
 * These functions use the JSONB fields (driverDetails, speakerDetails, volunteerDetails)
 * as the source of truth, rather than the legacy array columns.
 *
 * This consolidates the dual-storage pattern where both arrays and JSONB exist.
 */

type EventWithAssignments = {
  driverDetails?: Record<string, any> | string | null;
  speakerDetails?: Record<string, any> | string | null;
  volunteerDetails?: Record<string, any> | string | null;
  assignedVanDriverId?: string | null;
  isDhlVan?: boolean | null;
  // Legacy arrays (still populated but no longer source of truth)
  assignedDriverIds?: string[] | null;
  assignedSpeakerIds?: string[] | null;
  assignedVolunteerIds?: string[] | null;
};

function parseDetails(details?: Record<string, any> | string | null): Record<string, any> | null {
  if (!details) return null;
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof details === 'object' && !Array.isArray(details)) {
    return details;
  }
  return null;
}

export { extractNameFromAssignmentId };

function isUsableStoredAssignmentName(
  name: string | undefined | null,
  personId: string
): name is string {
  if (!name?.trim()) return false;
  if (name === personId) return false;
  if (/^\d+$/.test(name)) return false;
  if (name.startsWith('host-contact-') || name.startsWith('custom-')) return false;
  return true;
}

/**
 * Resolve the label to show for an assigned person (driver/speaker/volunteer).
 */
export function resolveAssignmentDisplayName(
  personId: string,
  options?: {
    storedName?: string | null;
    resolvedName?: string;
    fallback?: string;
  }
): string {
  const fallback = options?.fallback ?? 'Unknown';
  const storedName = options?.storedName;
  const resolvedName = options?.resolvedName;

  if (isUsableStoredAssignmentName(storedName, personId)) {
    return extractNameFromAssignmentId(storedName) || storedName.trim();
  }

  const fromId = extractNameFromAssignmentId(personId);
  if (fromId) return fromId;

  if (resolvedName && resolvedName !== personId && !/^\d+$/.test(resolvedName)) {
    return resolvedName;
  }

  return fallback;
}

/**
 * Get all driver IDs from the event (excluding van driver)
 */
export function getDriverIds(event: EventWithAssignments): string[] {
  const parsed = parseDetails(event.driverDetails);
  if (parsed) return Object.keys(parsed);
  if (event.assignedDriverIds && event.assignedDriverIds.length > 0) {
    return event.assignedDriverIds;
  }
  return [];
}

/**
 * Get count of regular drivers assigned (excluding van driver and DHL)
 */
export function getDriverCount(event: EventWithAssignments): number {
  return getDriverIds(event).length;
}

/**
 * Get total driver count including van driver and DHL
 */
export function getTotalDriverCount(event: EventWithAssignments): number {
  let count = getDriverCount(event);
  if (event.assignedVanDriverId) count++;
  if (event.isDhlVan) count++;
  return count;
}

/**
 * Check if a specific person is assigned as a driver
 */
export function hasDriver(event: EventWithAssignments, personId: string): boolean {
  return !!(event.driverDetails?.[personId]);
}

/**
 * Get driver details for a specific person
 */
export function getDriverDetail(event: EventWithAssignments, personId: string): any | null {
  return event.driverDetails?.[personId] ?? null;
}

/**
 * Get all speaker IDs from the event
 */
export function getSpeakerIds(event: EventWithAssignments): string[] {
  const parsed = parseDetails(event.speakerDetails);
  if (parsed) return Object.keys(parsed);
  if (event.assignedSpeakerIds && event.assignedSpeakerIds.length > 0) {
    return event.assignedSpeakerIds;
  }
  return [];
}

/**
 * Get count of speakers assigned
 */
export function getSpeakerCount(event: EventWithAssignments): number {
  return getSpeakerIds(event).length;
}

/**
 * Check if a specific person is assigned as a speaker
 */
export function hasSpeaker(event: EventWithAssignments, personId: string): boolean {
  return !!(event.speakerDetails?.[personId]);
}

/**
 * Get speaker details for a specific person
 */
export function getSpeakerDetail(event: EventWithAssignments, personId: string): any | null {
  return event.speakerDetails?.[personId] ?? null;
}

/**
 * Get all volunteer IDs from the event
 */
export function getVolunteerIds(event: EventWithAssignments): string[] {
  const parsed = parseDetails(event.volunteerDetails);
  if (parsed) return Object.keys(parsed);
  if (event.assignedVolunteerIds && event.assignedVolunteerIds.length > 0) {
    return event.assignedVolunteerIds;
  }
  return [];
}

/**
 * Get count of volunteers assigned
 */
export function getVolunteerCount(event: EventWithAssignments): number {
  return getVolunteerIds(event).length;
}

/**
 * Check if a specific person is assigned as a volunteer
 */
export function hasVolunteer(event: EventWithAssignments, personId: string): boolean {
  return !!(event.volunteerDetails?.[personId]);
}

/**
 * Get volunteer details for a specific person
 */
export function getVolunteerDetail(event: EventWithAssignments, personId: string): any | null {
  return event.volunteerDetails?.[personId] ?? null;
}

/**
 * Check if a person is assigned in any role
 */
export function isPersonAssigned(event: EventWithAssignments, personId: string): boolean {
  return hasDriver(event, personId) ||
         hasSpeaker(event, personId) ||
         hasVolunteer(event, personId) ||
         event.assignedVanDriverId === personId;
}

/**
 * Get unfilled counts for an event - calculates needed vs assigned for all roles
 */
export function getUnfilledCounts(event: EventWithAssignments & {
  driversNeeded?: number | null;
  speakersNeeded?: number | null;
  volunteersNeeded?: number | null;
}): {
  driversNeeded: number;
  driversAssigned: number;
  driversUnfilled: number;
  speakersNeeded: number;
  speakersAssigned: number;
  speakersUnfilled: number;
  volunteersNeeded: number;
  volunteersAssigned: number;
  volunteersUnfilled: number;
  hasUnfilledNeeds: boolean;
} {
  const driversNeeded = event.driversNeeded || 0;
  const driversAssigned = getTotalDriverCount(event);
  const driversUnfilled = Math.max(0, driversNeeded - driversAssigned);

  // Speaker role retired: still surface the historical needed/assigned counts
  // (kept in the return shape so callers that destructure them don't break),
  // but speakers no longer contribute to unfilled needs — force unfilled to 0
  // so no "needs a speaker" state can leak through anywhere downstream.
  const speakersNeeded = event.speakersNeeded || 0;
  const speakersAssigned = getSpeakerCount(event);
  const speakersUnfilled = 0;

  const volunteersNeeded = event.volunteersNeeded || 0;
  const volunteersAssigned = getVolunteerCount(event);
  const volunteersUnfilled = Math.max(0, volunteersNeeded - volunteersAssigned);

  return {
    driversNeeded,
    driversAssigned,
    driversUnfilled,
    speakersNeeded,
    speakersAssigned,
    speakersUnfilled,
    volunteersNeeded,
    volunteersAssigned,
    volunteersUnfilled,
    hasUnfilledNeeds: driversUnfilled > 0 || volunteersUnfilled > 0,
  };
}
