import { Router, Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage-wrapper';
import {
  insertEventRequestSchema,
  insertOrganizationSchema,
  insertEventVolunteerSchema,
  importFromSheetsSchema,
  auditLogs,
  eventRequests,
  users,
  type EventRequest,
  type User,
} from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { parseDateOnly, getTodayString, toDateOnlyString } from '@shared/date-utils';
import { isValidTransition, getTransitionError, requiresReason, getReasonField, getReasonSatisfyingFields, getScheduledDateDefault, type EventStatus } from '@shared/event-status-workflow';
import {
  parseSandwichCountInput,
  normalizeSandwichTypesForStorage,
} from '@shared/sandwich-count-utils';
import { eventRequestPatchSchema } from '@shared/event-request-patch';
import { requirePermission } from '../middleware/auth';
import { isAuthenticated } from '../auth';
import { getEventRequestsGoogleSheetsService } from '../google-sheets-event-requests-sync';
import { AuditLogger } from '../audit-logger';
import { db } from '../db';
import { eq, desc, and, sql, gte, lte, or, isNull, ne, isNotNull } from 'drizzle-orm';
import { EmailNotificationService } from '../services/email-notification-service';
import { logger } from '../middleware/logger';
import type { AuthenticatedRequest } from '../types/express';
import { emitEventRequestUpdate } from '../socket-chat';

function normalizeVanNeededForField(
  value: unknown
): { ok: true; value: 'transport' | 'refrigeration' | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  if (value === 'transport' || value === 'refrigeration') return { ok: true, value };
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v.startsWith('refrig')) return { ok: true, value: 'refrigeration' };
    if (v.startsWith('transport')) return { ok: true, value: 'transport' };
  }
  return { ok: false };
}

/** Keep van flags + purpose consistent, and reject values outside the enum. */
function applyVanPurposeNormalization(updates: Record<string, any>): { error?: string } {
  if (updates.vanNeededFor !== undefined) {
    const parsed = normalizeVanNeededForField(updates.vanNeededFor);
    if (!parsed.ok) {
      return { error: 'vanNeededFor must be "transport", "refrigeration", or null' };
    }
    updates.vanNeededFor = parsed.value;
  }
  if (updates.selfTransport === true || updates.selfTransport === 'true') {
    updates.vanDriverNeeded = false;
    updates.assignedVanDriverId = null;
    updates.isDhlVan = false;
    updates.vanNeededFor = null;
    updates.vanNeededLikely = false;
  }
  if (updates.vanDriverNeeded === false || updates.vanDriverNeeded === 'false') {
    updates.vanDriverNeeded = false;
    updates.isDhlVan = false;
    updates.vanNeededFor = null;
    updates.vanNeededLikely = false;
  }
  return {};
}
import { safeJsonParse } from '../utils/safe-json';
import { getUndefinedColumn, dropColumnKey, classifyDbError, parsePgError } from '../utils/pg-error-utils';
import { geocodeAddress } from '../utils/geocoding';
import { rateLimiter } from '../utils/rate-limiter';
import { getEffectiveEventDate, getAssignmentUrgentGaps, daysSinceSubmitted, daysUntilEventDate } from '../../shared/event-validation-utils';
import { filterEventsByWeekScope, parseWeekScopeOffset } from '../lib/event-week-filter';

const router = Router();

// Timestamp columns on event_requests that clients may send as date strings.
// Every field here is converted string -> Date (via parseDateOnly) before hitting
// Drizzle, which throws "value.toISOString is not a function" on raw strings.
// Used by BOTH the PATCH and PUT handlers — always add new client-editable
// timestamp fields HERE so the two handlers can never drift apart again.
// NOTE: pickupDateTime is intentionally excluded — it must remain a local
// datetime string (YYYY-MM-DDTHH:MM:SS) to avoid timezone conversion issues.
const EVENT_REQUEST_TIMESTAMP_FIELDS = [
  'toolkitSentDate',
  'contactedAt',
  'desiredEventDate',
  'duplicateCheckDate',
  'markedUnresponsiveAt',
  'lastContactAttempt',
  'nextFollowUpDate',
  'contactCompletedAt',
  'callScheduledAt',
  'callCompletedAt',
  'scheduledCallDate',
  'tspContactAssignedDate',
  'statusChangedAt',
  'standbyExpectedDate',
  'standbyMarkedAt',
  'scheduledEventDate',
  'socialMediaPostRequestedDate',
  'socialMediaPostCompletedDate',
  'addedToOfficialSheetAt',
  'nextActionUpdatedAt',
  'actualSandwichCountRecordedDate',
  'followUpOneDayDate',
  'followUpOneMonthDate',
];

// Helper functions for pickup time data migration
const convertTimeToDateTime = (timeStr: string, baseDate?: Date | string): string | null => {
  if (!timeStr) return null;
  
  try {
    // Parse time string (supports formats like "2:30 PM", "14:30", "2:30")
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (!timeMatch) return null;
    
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const ampm = timeMatch[3]?.toUpperCase();
    
    // Convert to 24-hour format if needed
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    
    // Extract date components safely without timezone conversion
    let year: number, month: string, day: string;
    
    if (baseDate) {
      const dateStr = typeof baseDate === 'string' ? baseDate : baseDate.toISOString();
      // Extract YYYY-MM-DD directly from the string to avoid timezone issues
      const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        year = parseInt(dateMatch[1]);
        month = dateMatch[2];
        day = dateMatch[3];
      } else {
        // Fallback to Date object if string parsing fails
        const d = new Date(dateStr);
        year = d.getUTCFullYear();
        month = String(d.getUTCMonth() + 1).padStart(2, '0');
        day = String(d.getUTCDate()).padStart(2, '0');
      }
    } else {
      // Use today's date in local timezone
      const now = new Date();
      year = now.getFullYear();
      month = String(now.getMonth() + 1).padStart(2, '0');
      day = String(now.getDate()).padStart(2, '0');
    }
    
    const hoursStr = String(hours).padStart(2, '0');
    const minutesStr = String(minutes).padStart(2, '0');
    return `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00`;
  } catch (error) {
    return null;
  }
};

const extractTimeFromDateTime = (dateTimeStr: string): string | null => {
  if (!dateTimeStr) return null;
  
  try {
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) return null;
    
    // Extract time in 12-hour format with AM/PM
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return timeStr;
  } catch (error) {
    return null;
  }
};

// Data migration logic for pickup time fields
const processPickupTimeFields = (updates: Partial<EventRequest>, existingData?: Partial<EventRequest>) => {
  const result = { ...updates };
  
  // Get existing values for reference
  const existingPickupTime = existingData?.pickupTime;
  const existingPickupDateTime = existingData?.pickupDateTime;
  const existingScheduledDate = getEffectiveEventDate(existingData);
  
  // Handle the case where both fields are provided in the update
  if (updates.pickupTime && updates.pickupDateTime) {
    // Prioritize pickupDateTime, but ensure pickupTime is consistent
    const extractedTime = extractTimeFromDateTime(updates.pickupDateTime);
    if (extractedTime) {
      result.pickupTime = extractedTime;
    }
  }
  // Handle the case where only pickupDateTime is provided
  else if (updates.pickupDateTime && !updates.pickupTime) {
    const extractedTime = extractTimeFromDateTime(updates.pickupDateTime);
    if (extractedTime) {
      result.pickupTime = extractedTime;
    }
  }
  // Handle the case where only pickupTime is provided
  else if (updates.pickupTime && !updates.pickupDateTime) {
    // Try to convert using scheduled date or today as base
    const baseDate = existingScheduledDate ? new Date(existingScheduledDate) : new Date();
    const convertedDateTime = convertTimeToDateTime(updates.pickupTime, baseDate);
    if (convertedDateTime) {
      result.pickupDateTime = convertedDateTime;
    }
  }
  // Handle existing data scenarios during reads/updates
  else if (!updates.pickupTime && !updates.pickupDateTime && existingData) {
    // Fill in missing fields from existing data
    if (existingPickupTime && !existingPickupDateTime) {
      const baseDate = existingScheduledDate ? new Date(existingScheduledDate) : new Date();
      const convertedDateTime = convertTimeToDateTime(existingPickupTime, baseDate);
      if (convertedDateTime) {
        result.pickupDateTime = convertedDateTime;
      }
    } else if (existingPickupDateTime && !existingPickupTime) {
      const extractedTime = extractTimeFromDateTime(existingPickupDateTime);
      if (extractedTime) {
        result.pickupTime = extractedTime;
      }
    }
  }
  
  return result;
};

// ============================================================================
// Google Sheets Import Helper Functions
// ============================================================================

// Parse staffing column from Google Sheets
// Format: "D, S, V" (needs) or "D: Katie, S: Kim, V: Christine, VD: Luz" (assigned)
interface StaffingResult {
  driversNeeded: number;
  speakersNeeded: number;
  volunteersNeeded: number;
  vanDriverNeeded: boolean;
  assignedDriverNames: string[];
  assignedSpeakerNames: string[];
  assignedVolunteerNames: string[];
  customVanDriverName: string | null;
}

const parseStaffingColumn = (staffing: string | undefined): StaffingResult => {
  const result: StaffingResult = {
    driversNeeded: 0,
    speakersNeeded: 0,
    volunteersNeeded: 0,
    vanDriverNeeded: false,
    assignedDriverNames: [],
    assignedSpeakerNames: [],
    assignedVolunteerNames: [],
    customVanDriverName: null,
  };

  if (!staffing || staffing.trim() === '') return result;

  // Split by comma and process each part
  const parts = staffing.split(',').map(p => p.trim());

  for (const part of parts) {
    if (!part) continue;

    // Check if it has an assignment (contains ':')
    if (part.includes(':')) {
      const [role, name] = part.split(':').map(s => s.trim());
      const roleUpper = role.toUpperCase();

      if (roleUpper === 'VD') {
        result.vanDriverNeeded = true;
        result.customVanDriverName = name;
      } else if (roleUpper === 'D') {
        result.assignedDriverNames.push(name);
      } else if (roleUpper === 'S') {
        result.assignedSpeakerNames.push(name);
      } else if (roleUpper === 'V') {
        result.assignedVolunteerNames.push(name);
      }
    } else {
      // Just a role letter means it's needed but not filled
      const roleUpper = part.toUpperCase();
      if (roleUpper === 'VD') {
        result.vanDriverNeeded = true;
      } else if (roleUpper === 'D') {
        result.driversNeeded = 1;
      } else if (roleUpper === 'S') {
        result.speakersNeeded = 1;
      } else if (roleUpper === 'V') {
        result.volunteersNeeded = 1;
      }
    }
  }

  return result;
};

/**
 * Coerce the sandwich breakdown columns to real JSONB arrays (or NULL) in place.
 *
 * The client sends these as JSON.stringify()'d strings, and a string written to
 * a jsonb column is stored as a JSON scalar, not an array. The client's parsers
 * accept both shapes so the app never noticed, but SQL does not: any query using
 * jsonb_array_length()/jsonb_array_elements() fails on those rows with "cannot
 * get array length of a scalar". Normalizing on every write keeps one shape in
 * the column. Only touches keys that are actually present in the update.
 */
const normalizeSandwichTypeColumns = (updates: Record<string, any>): void => {
  for (const field of ['sandwichTypes', 'actualSandwichTypes']) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      updates[field] = normalizeSandwichTypesForStorage(updates[field]);
    }
  }
};

// Parse sandwich types from Google Sheets
// Input: "Deli", "PBJ", "Deli & PBJ", "Turkey, Ham", etc.
const parseSandwichTypes = (
  typesStr: string | undefined,
  estimatedCount?: number
): Array<{ type: string; quantity: number }> | null => {
  if (!typesStr || typesStr.trim() === '') return null;

  const normalizedStr = typesStr.toLowerCase().trim();
  const types: string[] = [];

  // Handle common formats
  if (normalizedStr.includes('&')) {
    // "Deli & PBJ" format
    types.push(...normalizedStr.split('&').map(t => t.trim()));
  } else if (normalizedStr.includes(',')) {
    // "Turkey, Ham" format
    types.push(...normalizedStr.split(',').map(t => t.trim()));
  } else if (normalizedStr.includes('/')) {
    // "Deli/PBJ" format
    types.push(...normalizedStr.split('/').map(t => t.trim()));
  } else {
    // Single type
    types.push(normalizedStr);
  }

  // Calculate quantities - split evenly if we have an estimate
  const count = estimatedCount || 0;
  const perType = types.length > 0 ? Math.floor(count / types.length) : 0;

  return types.map((type, index) => ({
    type: type.charAt(0).toUpperCase() + type.slice(1), // Capitalize first letter
    // Last type gets any remainder
    quantity: index === types.length - 1 ? count - (perType * (types.length - 1)) : perType,
  }));
};

// Parse contact name into first/last name
const parseContactName = (name: string | undefined): { firstName: string | null; lastName: string | null } => {
  if (!name || name.trim() === '') {
    return { firstName: null, lastName: null };
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  // First word is first name, rest is last name
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
};

// Cached user data for batch name matching (avoids N+1 queries)
interface UserLookupData {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

// Fetch all active users once for batch matching
const fetchActiveUsersForMatching = async (): Promise<UserLookupData[]> => {
  try {
    return await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.isActive, true));
  } catch (error) {
    logger.error('Error fetching users for matching:', error);
    return [];
  }
};

// Match a single name against pre-fetched user list (O(n) single pass)
const matchNameToUser = (
  searchName: string,
  allUsers: UserLookupData[]
): string | null => {
  if (!searchName || searchName.trim() === '') return null;

  const normalizedName = searchName.trim().toLowerCase();

  for (const user of allUsers) {
    // Check displayName first
    if (user.displayName && user.displayName.toLowerCase() === normalizedName) {
      return user.id;
    }

    // Check firstName + lastName combination
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
    if (fullName === normalizedName) {
      return user.id;
    }

    // Check just firstName (for single name matches like "Katie")
    if (user.firstName && user.firstName.toLowerCase() === normalizedName) {
      return user.id;
    }
  }

  return null;
};

// Batch match multiple staff names to user IDs (single DB query)
// This replaces the N+1 pattern of calling findUserByName in a loop
const batchMatchStaffNames = async (
  tspContactName: string | undefined,
  driverNames: string[],
  speakerNames: string[],
  volunteerNames: string[]
): Promise<{
  tspContactUserId: string | null;
  assignedDriverIds: string[];
  assignedSpeakerIds: string[];
  assignedVolunteerIds: string[];
}> => {
  // Single database query for all users
  const allUsers = await fetchActiveUsersForMatching();

  // Match TSP contact
  const tspContactUserId = tspContactName
    ? matchNameToUser(tspContactName, allUsers)
    : null;

  // Match all staff names against cached user list
  const matchNames = (names: string[]): string[] => {
    return names.map(name => {
      const userId = matchNameToUser(name, allUsers);
      // If no match, store the name as-is (the field accepts text)
      return userId || name;
    });
  };

  return {
    tspContactUserId,
    assignedDriverIds: matchNames(driverNames),
    assignedSpeakerIds: matchNames(speakerNames),
    assignedVolunteerIds: matchNames(volunteerNames),
  };
};

// Combine notes fields into planning notes
const combineNotesFields = (
  allDetails?: string,
  notes?: string,
  addlNotes?: string,
  waitingOn?: string
): string | null => {
  const parts: string[] = [];

  if (allDetails && allDetails.trim()) {
    parts.push(allDetails.trim());
  }
  if (notes && notes.trim()) {
    parts.push(`Notes: ${notes.trim()}`);
  }
  if (addlNotes && addlNotes.trim()) {
    parts.push(`Additional Notes: ${addlNotes.trim()}`);
  }
  if (waitingOn && waitingOn.trim()) {
    parts.push(`Waiting On: ${waitingOn.trim()}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
};

// API key validation middleware for Google Sheets import
const validateSheetsApiKey = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.GOOGLE_SHEETS_API_KEY;

  if (!expectedKey) {
    logger.error('❌ GOOGLE_SHEETS_API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!apiKey || apiKey !== expectedKey) {
    logger.warn('⚠️ Google Sheets import API key validation failed', {
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 4)}...` : 'missing',
      expectedKeyPrefix: expectedKey ? `${expectedKey.substring(0, 4)}...` : 'missing',
      matches: apiKey === expectedKey,
      timestamp: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  logger.info('✅ Google Sheets import API key validated successfully');
  next();
};

// ============================================================================
// Google Sheets Import Endpoint
// ============================================================================

router.post('/import-from-sheets', validateSheetsApiKey, async (req, res) => {
  try {
    // Log incoming request for debugging
    logger.info('📥 Google Sheets import request received', {
      timestamp: new Date().toISOString(),
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      groupName: req.body?.['Group Name'],
      date: req.body?.date,
    });

    // Validate incoming data
    const validationResult = importFromSheetsSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.error('❌ Google Sheets import validation failed', {
        errors: validationResult.error.errors,
        receivedData: req.body,
      });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationResult.error.errors,
      });
    }

    const data = validationResult.data;
    logger.info('✅ Google Sheets import validation passed', {
      groupName: data['Group Name'],
      date: data.date,
    });

    // Parse the date
    const eventDate = new Date(data.date);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Please use YYYY-MM-DD format.',
      });
    }

    // Check for duplicates (same org + same date)
    // Exclude soft-deleted events and cancelled/declined events
    // Check both scheduledEventDate and desiredEventDate to catch events that might not be fully scheduled yet
    const eventDateStr = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    const existingEvents = await db
      .select({ 
        id: eventRequests.id, 
        organizationName: eventRequests.organizationName,
        status: eventRequests.status,
        deletedAt: eventRequests.deletedAt,
        scheduledEventDate: eventRequests.scheduledEventDate,
        desiredEventDate: eventRequests.desiredEventDate
      })
      .from(eventRequests)
      .where(
        and(
          sql`LOWER(${eventRequests.organizationName}) = LOWER(${data['Group Name']})`,
          // Check if either scheduledEventDate or desiredEventDate matches the target date
          or(
            sql`DATE(${eventRequests.scheduledEventDate}) = DATE(${eventDate.toISOString()})`,
            sql`DATE(${eventRequests.desiredEventDate}) = DATE(${eventDate.toISOString()})`
          ),
          isNull(eventRequests.deletedAt), // Exclude soft-deleted events
          // Only check against active statuses - allow duplicates if the existing event is cancelled/declined
          sql`${eventRequests.status} NOT IN ('cancelled', 'declined')`
        )
      );

    if (existingEvents.length > 0) {
      const existing = existingEvents[0];
      logger.warn(`⚠️ Duplicate event detected: "${data['Group Name']}" on ${data.date}`, {
        existingEventId: existing.id,
        existingStatus: existing.status,
        existingScheduledDate: existing.scheduledEventDate,
        existingDesiredDate: existing.desiredEventDate,
        existingDeletedAt: existing.deletedAt,
        targetDate: data.date,
        isDeleted: !!existing.deletedAt,
        isInactiveStatus: ['cancelled', 'declined'].includes(existing.status),
      });
      return res.status(409).json({
        success: false,
        error: `Event already exists for "${data['Group Name']}" on ${data.date}`,
        existingEventId: existing.id,
        existingStatus: existing.status,
        existingScheduledDate: existing.scheduledEventDate,
        existingDesiredDate: existing.desiredEventDate,
        existingDeletedAt: existing.deletedAt,
        link: `/event-requests/${existing.id}`,
        debug: {
          message: 'This event was found by duplicate check. If it should not block creation, check:',
          checks: {
            isDeleted: !!existing.deletedAt,
            isInactiveStatus: ['cancelled', 'declined'].includes(existing.status),
            shouldExclude: !!existing.deletedAt || ['cancelled', 'declined'].includes(existing.status)
          }
        }
      });
    }
    
    logger.info('✅ No duplicate events found, proceeding with creation', {
      groupName: data['Group Name'],
      date: data.date,
    });

    // Parse staffing column
    const staffing = parseStaffingColumn(data['Staffing']);

    // Parse sandwich count
    const sandwichCountRaw = data['Estimate # sandwiches'];
    const parsedSandwichCount = parseSandwichCountInput(sandwichCountRaw);
    const estimatedSandwichCount = parsedSandwichCount.count;

    // Parse sandwich types
    const sandwichTypes = parseSandwichTypes(data['Deli or PBJ?'], estimatedSandwichCount || undefined);

    // Parse contact name
    const contactNameParts = parseContactName(data['Contact Name']);

    // Batch match all staff names to user IDs (single DB query instead of N+1)
    const {
      tspContactUserId,
      assignedDriverIds,
      assignedSpeakerIds,
      assignedVolunteerIds,
    } = await batchMatchStaffNames(
      data['TSP Contact'],
      staffing.assignedDriverNames,
      staffing.assignedSpeakerNames,
      staffing.assignedVolunteerNames
    );

    // Combine notes
    const planningNotes = combineNotesFields(
      data['ALL DETAILS'],
      data['Notes'],
      data["Add'l Notes"],
      data['Waiting On']
    );

    const vanNeededForCell = (data['Van needed for?'] || '').trim().toLowerCase();
    const vanNeededFor =
      vanNeededForCell.startsWith('refrig')
        ? 'refrigeration' as const
        : vanNeededForCell.startsWith('transport')
          ? 'transport' as const
          : null;

    // Determine status
    const isCancelled = data['Cancelled']?.toLowerCase() === 'yes' ||
                        data['Cancelled']?.toLowerCase() === 'cancelled' ||
                        data['Cancelled']?.toLowerCase() === 'true';
    const status = isCancelled ? 'cancelled' : 'scheduled';

    // Parse toolkit sent
    const toolkitSent = data['Sent toolkit']?.toLowerCase() === 'yes' ||
                        data['Sent toolkit']?.toLowerCase() === 'true';

    // Generate external ID for duplicate prevention
    const externalId = `sheets-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build the event request data
    const eventRequestData = {
      // Required fields
      organizationName: data['Group Name'],
      scheduledEventDate: eventDate,
      status,
      externalId,

      // Contact info
      firstName: contactNameParts.firstName,
      lastName: contactNameParts.lastName,
      email: data['Email Address'] || null,
      phone: data['Contact Cell Number'] || null,

      // Event timing
      eventStartTime: data['Event Start time (MUST when volunteer needed)'] || null,
      eventEndTime: data['Event end time (MUST when volunteer needed)'] || null,
      pickupTime: data['Pick up time'] || null,

      // Location
      eventAddress: data['Address'] || null,
      deliveryDestination: data['Planned Recipient/Host Home'] || null,

      // Sandwich info
      estimatedSandwichCount,
      estimatedSandwichCountMin: parsedSandwichCount.min,
      estimatedSandwichCountMax: parsedSandwichCount.max,
      sandwichTypes: sandwichTypes ? JSON.stringify(sandwichTypes) : null,

      // Staffing needs
      driversNeeded: staffing.driversNeeded,
      speakersNeeded: staffing.speakersNeeded,
      volunteersNeeded: staffing.volunteersNeeded,
      vanDriverNeeded: staffing.vanDriverNeeded || !!vanNeededFor,
      vanNeededFor,

      // Staffing assignments
      assignedDriverIds: assignedDriverIds.length > 0 ? assignedDriverIds : null,
      assignedSpeakerIds: assignedSpeakerIds.length > 0 ? assignedSpeakerIds : null,
      assignedVolunteerIds: assignedVolunteerIds.length > 0 ? assignedVolunteerIds : null,
      customVanDriverName: staffing.customVanDriverName,

      // Initialize JSONB fields for assignments (source of truth)
      driverDetails: assignedDriverIds.length > 0 
        ? Object.fromEntries(assignedDriverIds.map(id => [id, {}])) 
        : null,
      speakerDetails: assignedSpeakerIds.length > 0 
        ? Object.fromEntries(assignedSpeakerIds.map(id => [id, {}])) 
        : null,
      volunteerDetails: assignedVolunteerIds.length > 0 
        ? Object.fromEntries(assignedVolunteerIds.map(id => [id, {}])) 
        : null,

      // TSP Contact
      tspContact: tspContactUserId || data['TSP Contact'] || null,

      // Toolkit
      toolkitSent,
      toolkitStatus: toolkitSent ? 'sent' : 'not_sent',

      // Notes
      planningNotes,

      // Event is confirmed and on calendar since it's coming from the official sheet
      isConfirmed: true,
      addedToOfficialSheet: true,

      // Audit
      createdBy: 'google-sheets-import',
    };

    // Create the event request
    logger.info('📝 Creating event request from Google Sheets import', {
      groupName: data['Group Name'],
      date: data.date,
      status,
      externalId,
    });
    
    const createdEvent = await storage.createEventRequest(eventRequestData as any);

    // Log the import with full details
    logger.info(`✅ Google Sheets import: Created event request ${createdEvent.id} for "${data['Group Name']}" on ${data.date}`, {
      eventId: createdEvent.id,
      organizationName: createdEvent.organizationName,
      status: createdEvent.status,
      scheduledEventDate: createdEvent.scheduledEventDate,
      desiredEventDate: createdEvent.desiredEventDate,
      externalId: createdEvent.externalId,
      createdAt: createdEvent.createdAt,
    });

    // Emit real-time update to all connected clients
    emitEventRequestUpdate('event_request_created', createdEvent);

    return res.status(201).json({
      success: true,
      eventId: createdEvent.id,
      message: `Event created successfully for "${data['Group Name']}"`,
      link: `/event-requests/${createdEvent.id}`,
      event: {
        id: createdEvent.id,
        organizationName: createdEvent.organizationName,
        status: createdEvent.status,
        scheduledEventDate: createdEvent.scheduledEventDate,
        desiredEventDate: createdEvent.desiredEventDate,
      },
    });
  } catch (error) {
    logger.error('Google Sheets import error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to import event',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get available drivers for event assignments
router.get('/drivers/available', isAuthenticated, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSIONS.DRIVERS_VIEW)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const drivers = await storage.getAllDrivers();

    // Only return active drivers who are not busy or off-duty
    const availableDrivers = drivers
      .filter((driver) => driver.isActive && driver.availability !== 'busy' && driver.availability !== 'off-duty')
      .map((driver) => ({
        id: driver.id,
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        availability: driver.availability,
        availabilityNotes: driver.availabilityNotes,
        hostLocation: driver.hostLocation,
        routeDescription: driver.routeDescription,
        vanApproved: driver.vanApproved,
        vehicleType: driver.vehicleType,
      }));

    res.json(availableDrivers);
  } catch (error) {
    logger.error('Failed to fetch available drivers', error);
    res.status(500).json({ error: 'Failed to fetch available drivers' });
  }
});

// Get complete event details by organization and contact
router.get(
  '/details/:organizationName/:contactName',
  isAuthenticated,
  async (req, res) => {
    try {
      const { organizationName, contactName } = req.params;

      // Get event request matching the organization and contact
      const allEventRequests = await storage.getAllEventRequests();
      const eventRequest = allEventRequests.find(
        (request) =>
          request.organizationName === organizationName &&
          request.firstName + ' ' + request.lastName === contactName
      );

      if (!eventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Return complete event details
      res.json(eventRequest);
    } catch (error) {
      logger.error('Failed to fetch event details', error);
      res.status(500).json({ error: 'Failed to fetch event details' });
    }
  }
);


// Enhanced logging function for activity tracking with audit details
const logActivity = async (
  req: AuthenticatedRequest,
  res: Response,
  permission: string,
  message: string,
  metadata?: Record<string, unknown>
) => {
  // Store audit details in res.locals for the activity logger middleware to capture
  if (metadata) {
    res.locals.eventRequestAuditDetails = metadata;
  }
  // Activity logging will be handled by the global middleware
};

// Valid status values for event requests
const VALID_EVENT_REQUEST_STATUSES = [
  'new',
  'in_process',
  'scheduled',
  'rescheduled',
  'completed',
  'declined',
  'cancelled',
  'non_event',
  'standby',
  'stalled'
] as const;

// Helper function to validate and sanitize status values
const validateEventRequestStatus = (status: string): string | null => {
  if (!status) return null;
  
  // Convert common invalid statuses to valid ones
  const statusMap: Record<string, string> = {
    'approved': 'scheduled', // Map 'approved' to 'scheduled'
    'pending': 'new',        // Map 'pending' to 'new'
    'in_progress': 'in_process', // Map 'in_progress' to 'in_process'
  };
  
  const normalizedStatus = status.toLowerCase();
  const mappedStatus = statusMap[normalizedStatus] || normalizedStatus;
  
  if (VALID_EVENT_REQUEST_STATUSES.includes(mappedStatus as typeof VALID_EVENT_REQUEST_STATUSES[number])) {
    return mappedStatus;
  }
  
  logger.warn(`Invalid event request status "${status}" - will not be logged in audit`);
  return null;
};

// Enhanced audit logging for event request actions
const logEventRequestAudit = async (
  action: string,
  eventId: string,
  oldData: Partial<EventRequest> | null,
  newData: Partial<EventRequest>,
  req: AuthenticatedRequest,
  additionalContext?: Record<string, unknown>
) => {
  try {
    // PROBLEM 1 FIX: Ensure we have complete event request data
    // If newData is partial (like req.body), get the complete updated event request
    let completeNewData = newData;
    
    // Check if newData has essential fields for audit logging
    if (!newData?.organizationName || !newData?.firstName || !newData?.lastName) {
      try {
        const completeEventData = await storage.getEventRequestById(parseInt(eventId));
        if (completeEventData) {
          completeNewData = completeEventData;
        }
      } catch (error) {
        // Continue with partial data rather than failing
      }
    }
    
    // PROBLEM 2 FIX: Validate status values before logging
    if (completeNewData?.status) {
      const validatedStatus = validateEventRequestStatus(completeNewData.status);
      if (validatedStatus && validatedStatus !== completeNewData.status) {
        completeNewData = {
          ...completeNewData,
          status: validatedStatus
        };
      } else if (!validatedStatus) {
        // Remove invalid status to prevent logging invalid data
        const { status, ...dataWithoutStatus } = completeNewData;
        completeNewData = dataWithoutStatus;
      }
    }
    
    const context = {
      userId: req.user?.id,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
      sessionId: req.session?.id || req.sessionID,
    };

    // Call the audit logger with complete, validated data
    await AuditLogger.logEventRequestChange(
      eventId,
      oldData,
      completeNewData,
      context,
      additionalContext
    );
  } catch (error) {
    logger.error('Failed to log audit entry', error);
  }
};

// Get event requests assigned to the current user
router.get('/assigned', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Parallel fetch: get events and current user simultaneously
    const [allEventRequests, currentUser] = await Promise.all([
      storage.getAllEventRequests(),
      storage.getUserById(userId),
    ]);

    // Filter event requests assigned to this user via multiple assignment methods
    const assignedEvents = allEventRequests.filter((event) => {
      // Method 1: Direct assignment via assignedTo field
      if (event.assignedTo === userId) return true;

      // Method 2: TSP contact assignment
      if (event.tspContact === userId || event.tspContactAssigned === userId)
        return true;

      // Method 2b: Additional TSP contacts (check if user email or name appears in additional contacts)
      if (event.additionalTspContacts && currentUser && currentUser.email) {
        const additionalContacts = event.additionalTspContacts.toLowerCase();
        const userEmail = currentUser.email.toLowerCase();
        const userName = currentUser.displayName?.toLowerCase() || '';
        const userFirstName = currentUser.firstName?.toLowerCase() || '';
        const userLastName = currentUser.lastName?.toLowerCase() || '';

        if (
          additionalContacts.includes(userEmail) ||
          (userName && additionalContacts.includes(userName)) ||
          (userFirstName &&
            userLastName &&
            (additionalContacts.includes(userFirstName) ||
              additionalContacts.includes(userLastName)))
        ) {
          return true;
        }
      }

      // Method 3: Listed in driver details (check if user's name or email appears in driver details)
      if (event.driverDetails && currentUser) {
        // driverDetails is now JSONB - convert to string for text search
        const driverText = (
          typeof event.driverDetails === 'string'
            ? event.driverDetails
            : JSON.stringify(event.driverDetails)
        ).toLowerCase();
        const userEmail = currentUser.email?.toLowerCase() || '';
        const userName = currentUser.displayName?.toLowerCase() || '';
        const userFirstName = currentUser.firstName?.toLowerCase() || '';
        const userLastName = currentUser.lastName?.toLowerCase() || '';

        if (
          driverText.includes(userEmail) ||
          (userName && driverText.includes(userName)) ||
          (userFirstName &&
            userLastName &&
            (driverText.includes(userFirstName) ||
              driverText.includes(userLastName)))
        ) {
          return true;
        }
      }

      // Method 4: Listed in speaker details (check if user's name or email appears in speaker details)
      if (event.speakerDetails && currentUser && currentUser.email) {
        // speakerDetails is now JSONB - convert to string for text search
        const speakerText = (
          typeof event.speakerDetails === 'string'
            ? event.speakerDetails
            : JSON.stringify(event.speakerDetails)
        ).toLowerCase();
        const userEmail = currentUser.email.toLowerCase();
        const userName = currentUser.displayName?.toLowerCase() || '';
        const userFirstName = currentUser.firstName?.toLowerCase() || '';
        const userLastName = currentUser.lastName?.toLowerCase() || '';

        if (
          speakerText.includes(userEmail) ||
          (userName && speakerText.includes(userName)) ||
          (userFirstName &&
            userLastName &&
            (speakerText.includes(userFirstName) ||
              speakerText.includes(userLastName)))
        ) {
          return true;
        }
      }

      return false;
    });

    // Add follow-up tracking for past events
    const now = new Date();
    const eventsWithFollowUp = assignedEvents.map((event) => {
      let followUpNeeded = false;
      let followUpReason = '';

      // For completed events, the actual scheduled date is what we want — the
      // desired date is the original request and may differ if the event was
      // rescheduled. Fall back to desired only when nothing was scheduled.
      const completedEventDate = getEffectiveEventDate(event);
      if (event.status === 'completed' && completedEventDate) {
        try {
          const eventDate = new Date(completedEventDate);
          const daysSinceEvent = Math.floor(
            (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Follow-up needed 1 day after event (if not already done)
          if (daysSinceEvent === 1 && !event.followUpOneDayCompleted) {
            followUpNeeded = true;
            followUpReason = '1-day follow-up needed';
          }

          // Follow-up needed 1 month after event (if not already done)
          if (
            daysSinceEvent >= 30 &&
            daysSinceEvent <= 32 &&
            !event.followUpOneMonthCompleted
          ) {
            followUpNeeded = true;
            followUpReason = '1-month follow-up needed';
          }
        } catch (error) {
          // Silently handle date parsing errors
        }
      }

      return {
        ...event,
        followUpNeeded,
        followUpReason,
        assignmentType: getAssignmentType(event, userId, currentUser),
      };
    });

    await logActivity(
      req,
      res,
      'EVENT_REQUESTS_VIEW',
      `Retrieved ${eventsWithFollowUp.length} assigned event requests`
    );

    res.json(eventsWithFollowUp);
  } catch (error) {
    logger.error('Failed to fetch assigned event requests', error);
    res.status(500).json({ error: 'Failed to fetch assigned event requests' });
  }
});

// Helper function to determine assignment type
function getAssignmentType(
  event: EventRequest,
  userId: string,
  currentUser: User | undefined
): string[] {
  const types: string[] = [];

  if (event.assignedTo === userId) types.push('Direct Assignment');
  if (event.tspContact === userId || event.tspContactAssigned === userId)
    types.push('TSP Contact');

  // Check additional TSP contacts
  if (event.additionalTspContacts && currentUser && currentUser.email) {
    const additionalContacts = event.additionalTspContacts.toLowerCase();
    const userEmail = currentUser.email.toLowerCase();
    const userName = currentUser.displayName?.toLowerCase() || '';
    const userFirstName = currentUser.firstName?.toLowerCase() || '';
    const userLastName = currentUser.lastName?.toLowerCase() || '';

    if (
      additionalContacts.includes(userEmail) ||
      (userName && additionalContacts.includes(userName)) ||
      (userFirstName &&
        userLastName &&
        (additionalContacts.includes(userFirstName) ||
          additionalContacts.includes(userLastName)))
    ) {
      types.push('TSP Contact');
    }
  }

  if (event.driverDetails && currentUser && currentUser.email) {
    // driverDetails is now JSONB - convert to string for text search
    const driverText = (
      typeof event.driverDetails === 'string'
        ? event.driverDetails
        : JSON.stringify(event.driverDetails)
    ).toLowerCase();
    const userEmail = currentUser.email.toLowerCase();
    const userName = currentUser.displayName?.toLowerCase() || '';
    const userFirstName = currentUser.firstName?.toLowerCase() || '';
    const userLastName = currentUser.lastName?.toLowerCase() || '';

    if (
      driverText.includes(userEmail) ||
      (userName && driverText.includes(userName)) ||
      (userFirstName &&
        userLastName &&
        (driverText.includes(userFirstName) ||
          driverText.includes(userLastName)))
    ) {
      types.push('Driver');
    }
  }

  if (event.speakerDetails && currentUser && currentUser.email) {
    // speakerDetails is now JSONB - convert to string for text search
    const speakerText = (
      typeof event.speakerDetails === 'string'
        ? event.speakerDetails
        : JSON.stringify(event.speakerDetails)
    ).toLowerCase();
    const userEmail = currentUser.email.toLowerCase();
    const userName = currentUser.displayName?.toLowerCase() || '';
    const userFirstName = currentUser.firstName?.toLowerCase() || '';
    const userLastName = currentUser.lastName?.toLowerCase() || '';

    if (
      speakerText.includes(userEmail) ||
      (userName && speakerText.includes(userName)) ||
      (userFirstName &&
        userLastName &&
        (speakerText.includes(userFirstName) ||
          speakerText.includes(userLastName)))
    ) {
      types.push('Speaker');
    }
  }

  return types;
}

// Get all event requests (with optional filtering)
router.get(
  '/',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_VIEW',
        'Retrieved event requests'
      );

      // Parse query parameters for filtering
      const daysParam = req.query.days as string | undefined;
      const statusParam = req.query.status as string | undefined;
      const needsActionParam = req.query.needsAction as string | undefined;
      // The client (EventRequestContext) falls back to this endpoint when
      // /api/event-requests/list fails, reusing the SAME query string. These
      // advanced filters therefore mirror the /list handler below exactly so a
      // fallback returns the same set instead of silently broadening the data
      // (e.g. dropping the week scope). Keep the two handlers in sync.
      const needsDriverParam = req.query.needsDriver as string | undefined;
      const weekParam = req.query.week as string | undefined;
      const needsVanParam = req.query.needsVan as string | undefined;
      const corporatePriorityParam = req.query.corporatePriority as string | undefined;

      // Use database-level filtering when status is specified (much faster than loading all rows)
      let eventRequests: Awaited<ReturnType<typeof storage.getAllEventRequests>>;
      if (statusParam && statusParam !== 'all') {
        const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          eventRequests = await storage.getEventRequestsByStatuses(statuses);
        } else {
          eventRequests = await storage.getAllEventRequests();
        }
      } else {
        eventRequests = await storage.getAllEventRequests();
      }

      // Filter to a Monday–Sunday calendar week (current, next, +2, +3).
      if (weekParam && parseWeekScopeOffset(weekParam) !== null) {
        eventRequests = filterEventsByWeekScope(eventRequests, weekParam);
      }

      // Filter by days (next N days from today) - done in memory since date logic is complex
      if (daysParam) {
        const days = parseInt(daysParam, 10);
        if (!isNaN(days) && days > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const futureDate = new Date(today);
          futureDate.setDate(futureDate.getDate() + days);

          eventRequests = eventRequests.filter(event => {
            // Check both scheduledEventDate and desiredEventDate
            const eventDate = getEffectiveEventDate(event);
            if (!eventDate) return false;

            const eventDateObj = new Date(eventDate);
            eventDateObj.setHours(0, 0, 0, 0);

            return eventDateObj >= today && eventDateObj <= futureDate;
          });
        }
      }

      // Note: Status filtering is now done at database level above
      
      // Filter by "needs action" - events that need attention
      if (needsActionParam === 'true') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
        
        eventRequests = eventRequests.filter(event => {
          // Include events in the next 14 days that need action
          const eventDate = getEffectiveEventDate(event);
          if (!eventDate) return true; // Events without dates need action
          
          const eventDateObj = new Date(eventDate);
          eventDateObj.setHours(0, 0, 0, 0);
          
          // Only include events in the next 14 days
          if (eventDateObj > twoWeeksFromNow) return false;
          
          // Events needing drivers
          const driversNeeded = event.driversNeeded || 0;
          const assignedDrivers = event.assignedDriverIds 
            ? (Array.isArray(event.assignedDriverIds) ? event.assignedDriverIds.length : 1)
            : 0;
          const needsDriver = driversNeeded > assignedDrivers;

          // (Speaker role retired — speaker needs no longer counted.)

          // Events needing volunteers
          const volunteersNeeded = event.volunteersNeeded || 0;
          const assignedVolunteers = event.volunteerDetails
            ? (typeof event.volunteerDetails === 'string'
                ? Object.keys(JSON.parse(event.volunteerDetails || '{}')).length
                : Object.keys(event.volunteerDetails || {}).length)
            : 0;
          const needsVolunteer = volunteersNeeded > assignedVolunteers;

          // Events needing van driver
          const needsVanDriver = event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan;

          // Events without confirmed dates (new/in_process)
          const needsDateConfirmation = (event.status === 'new' || event.status === 'in_process') && !event.isConfirmed;

          return needsDriver || needsVolunteer || needsVanDriver || needsDateConfirmation;
        });
      }

      // Advanced staffing/priority filters. These mirror the /list handler
      // exactly so a client fallback (list -> this endpoint) returns the same
      // set instead of silently broadening it.
      if (needsDriverParam === 'true') {
        eventRequests = eventRequests.filter(event => {
          const driversNeeded = event.driversNeeded || 0;
          const assignedDrivers = Array.isArray(event.assignedDriverIds)
            ? event.assignedDriverIds.filter(Boolean).length
            : 0;
          return (driversNeeded - assignedDrivers) > 0 && !event.selfTransport;
        });
      }

      if (needsVanParam === 'true') {
        eventRequests = eventRequests.filter(event => event.vanDriverNeeded === true);
      }

      if (corporatePriorityParam === 'true') {
        eventRequests = eventRequests.filter(event => event.isCorporatePriority === true);
      }

      // DEBUG: Log details about what we're returning
      const completedCount = eventRequests.filter(e => e.status === 'completed').length;
      logger.info(`📊 API returning ${eventRequests.length} filtered events (${completedCount} completed)`);
      
      // Check for duplicate IDs
      const ids = eventRequests.map(e => e.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        logger.error(`⚠️ DUPLICATE EVENT IDS DETECTED! Total: ${ids.length}, Unique: ${uniqueIds.size}`);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        logger.error(`Duplicate IDs: ${[...new Set(duplicates)].join(', ')}`);
      }
      
      res.json(eventRequests);
    } catch (error) {
      logger.error('Failed to fetch event requests', error);
      res.status(500).json({ message: 'Failed to fetch event requests' });
    }
  }
);

router.get(
  '/list',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      // Parse query parameters for filtering (same as main endpoint)
      const daysParam = req.query.days as string | undefined;
      const statusParam = req.query.status as string | undefined;
      const needsActionParam = req.query.needsAction as string | undefined;
      const needsDriverParam = req.query.needsDriver as string | undefined;
      const weekParam = req.query.week as string | undefined;

      // Use database-level filtering when status is specified (much faster than loading all rows)
      let eventRequests: Awaited<ReturnType<typeof storage.getAllEventRequests>>;
      if (statusParam && statusParam !== 'all') {
        const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          eventRequests = await storage.getEventRequestsByStatuses(statuses);
        } else {
          eventRequests = await storage.getAllEventRequests();
        }
      } else {
        eventRequests = await storage.getAllEventRequests();
      }

      // Filter to a Monday–Sunday calendar week (current, next, +2, +3).
      if (weekParam && parseWeekScopeOffset(weekParam) !== null) {
        eventRequests = filterEventsByWeekScope(eventRequests, weekParam);
      }

      // Apply date filter in memory (complex date logic is harder to do in SQL)
      if (daysParam) {
        const days = parseInt(daysParam, 10);
        if (!isNaN(days) && days > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const futureDate = new Date(today);
          futureDate.setDate(futureDate.getDate() + days);

          eventRequests = eventRequests.filter(event => {
            const eventDate = getEffectiveEventDate(event);
            if (!eventDate) return false;
            const eventDateObj = new Date(eventDate);
            eventDateObj.setHours(0, 0, 0, 0);
            return eventDateObj >= today && eventDateObj <= futureDate;
          });
        }
      }

      // Note: Status filtering is now done at database level above

      if (needsActionParam === 'true') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

        eventRequests = eventRequests.filter(event => {
          const eventDate = getEffectiveEventDate(event);
          if (!eventDate) return true;
          const eventDateObj = new Date(eventDate);
          eventDateObj.setHours(0, 0, 0, 0);
          if (eventDateObj > twoWeeksFromNow) return false;

          const driversNeeded = event.driversNeeded || 0;
          const assignedDrivers = event.assignedDriverIds
            ? (Array.isArray(event.assignedDriverIds) ? event.assignedDriverIds.length : 1)
            : 0;
          const needsDriver = driversNeeded > assignedDrivers;

          // (Speaker role retired — speaker needs no longer counted.)

          const volunteersNeeded = event.volunteersNeeded || 0;
          const assignedVolunteers = event.volunteerDetails
            ? (typeof event.volunteerDetails === 'string'
                ? Object.keys(JSON.parse(event.volunteerDetails || '{}')).length
                : Object.keys(event.volunteerDetails || {}).length)
            : 0;
          const needsVolunteer = volunteersNeeded > assignedVolunteers;

          const needsVanDriver = event.vanDriverNeeded && !event.assignedVanDriverId && !event.isDhlVan;
          const needsDateConfirmation = (event.status === 'new' || event.status === 'in_process') && !event.isConfirmed;

          return needsDriver || needsVolunteer || needsVanDriver || needsDateConfirmation;
        });
      }

      // Filter for events that still need regular drivers. This intentionally
      // mirrors eventsNeedingDrivers in /operational-stats exactly (regular
      // drivers only, self-transport excluded, same assigned-count semantics)
      // so the dashboard "Need Drivers" tile and the list it opens agree.
      // Van-only needs are surfaced by the separate "Needs Van" filter.
      if (needsDriverParam === 'true') {
        eventRequests = eventRequests.filter(event => {
          const driversNeeded = event.driversNeeded || 0;
          const assignedDrivers = Array.isArray(event.assignedDriverIds)
            ? event.assignedDriverIds.filter(Boolean).length
            : 0;
          return (driversNeeded - assignedDrivers) > 0 && !event.selfTransport;
        });
      }

      // Filter for events that need a van (vanDriverNeeded is true)
      const needsVanParam = req.query.needsVan as string | undefined;
      if (needsVanParam === 'true') {
        eventRequests = eventRequests.filter(event => event.vanDriverNeeded === true);
      }

      // Filter for corporate priority events
      const corporatePriorityParam = req.query.corporatePriority as string | undefined;
      if (corporatePriorityParam === 'true') {
        eventRequests = eventRequests.filter(event => event.isCorporatePriority === true);
      }

      // Return the full event records so cards, dialogs, and the scheduling
      // form all share one event shape. This intentionally removes the old
      // lightweight-list/full-record split that let fields drift between views.
      logger.info(`📋 List endpoint returning ${eventRequests.length} full event records`);
      res.json(eventRequests);
    } catch (error) {
      logger.error('Failed to fetch event request list', error);
      res.status(500).json({ message: 'Failed to fetch event requests' });
    }
  }
);

// Status counts endpoint - lightweight endpoint for tab counts
router.get(
  '/status-counts',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      const eventRequests = await storage.getAllEventRequests();
      const userId = (req.user as any)?.id;
      const userVolunteers = userId ? await storage.getEventVolunteersByUserId(userId) : [];
      const userVolunteerEventIds = new Set<number>(userVolunteers.map(v => v.eventRequestId));

      const counts: Record<string, number> = {
        all: eventRequests.length,
        new: 0,
        in_process: 0,
        scheduled: 0,
        rescheduled: 0,
        completed: 0,
        declined: 0,
        cancelled: 0,
        non_event: 0,
        standby: 0,
        stalled: 0,
        my_assignments: 0,
      };

      const terminalStatuses = new Set(['completed', 'declined', 'cancelled', 'non_event', 'stalled']);

      // Helper to check if user is assigned to an event
      const isUserAssigned = (event: any): boolean => {
        if (!userId) return false;

        // Check volunteer signup in eventVolunteers table
        if (userVolunteerEventIds.has(event.id)) {
          return true;
        }

        // Check TSP Contact assignment
        if (event.tspContactAssigned === userId || event.tspContact === userId) {
          return true;
        }

        // Check additional contacts
        if (event.additionalContact1 === userId || event.additionalContact2 === userId) {
          return true;
        }

        // Check driver assignment in driverDetails JSONB
        if (event.driverDetails) {
          try {
            const driverDetails = typeof event.driverDetails === 'string'
              ? JSON.parse(event.driverDetails)
              : event.driverDetails;
            if (driverDetails && typeof driverDetails === 'object' && !Array.isArray(driverDetails)) {
              const driverKeys = Object.keys(driverDetails);
              if (driverKeys.some(key => key === userId || key === userId.toString())) {
                return true;
              }
            }
          } catch (e) {
            // Continue if parsing fails
          }
        }

        // Check speaker assignment in speakerDetails JSONB
        if (event.speakerDetails) {
          try {
            const speakerDetails = typeof event.speakerDetails === 'string'
              ? JSON.parse(event.speakerDetails)
              : event.speakerDetails;
            if (speakerDetails && typeof speakerDetails === 'object' && !Array.isArray(speakerDetails)) {
              const speakerKeys = Object.keys(speakerDetails);
              if (speakerKeys.some(key => key === userId || key === userId.toString())) {
                return true;
              }
            }
          } catch (e) {
            // Continue if parsing fails
          }
        }

        return false;
      };

      for (const event of eventRequests) {
        const status = event.status as keyof typeof counts;
        if (status && status in counts && status !== 'all' && status !== 'my_assignments') {
          counts[status]++;
        }

        // Count my_assignments for non-terminal events.
        // Keep behavior aligned with the previous frontend implementation:
        // include everything except completed/declined/cancelled/non_event.
        if (event.status && !terminalStatuses.has(event.status) && isUserAssigned(event)) {
          counts.my_assignments++;
        }
      }

      res.json(counts);
    } catch (error) {
      logger.error('Failed to fetch status counts', error);
      res.status(500).json({ message: 'Failed to fetch status counts' });
    }
  }
);

// Search endpoint - server-side search across multiple fields
router.get(
  '/search',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      const searchQuery = (req.query.q as string || '').trim().toLowerCase();
      const statusParam = req.query.status as string | undefined;
      const includeDeleted = req.query.includeDeleted === 'true';

      if (!searchQuery || searchQuery.length < 2) {
        return res.json([]);
      }

      // Get events - include deleted ones if requested
      let eventRequests: Awaited<ReturnType<typeof storage.getAllEventRequests>>;
      if (includeDeleted) {
        // Query directly from database to include deleted events
        const allEvents = await db
          .select()
          .from(eventRequests)
          .orderBy(desc(eventRequests.createdAt));
        eventRequests = allEvents as any;
      } else {
        eventRequests = await storage.getAllEventRequests();
      }

      // Filter by status first if provided
      if (statusParam && statusParam !== 'all') {
        const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          eventRequests = eventRequests.filter(event => statuses.includes(event.status));
        }
      }

      // Search across multiple fields
      const searchResults = eventRequests.filter(event => {
        const searchableFields = [
          event.organizationName,
          event.firstName,
          event.lastName,
          event.email,
          event.phone,
          event.eventAddress,
          event.department,
          event.message,
          event.nextAction,
          String(event.id),
        ].filter(Boolean);

        return searchableFields.some(field =>
          field!.toLowerCase().includes(searchQuery)
        );
      });

      // Return lightweight format for search results
      const lightweightResults = searchResults.map(event => ({
        id: event.id,
        organizationName: event.organizationName,
        organizationCategory: event.organizationCategory,
        department: event.department,
        firstName: event.firstName,
        lastName: event.lastName,
        email: event.email,
        phone: event.phone,
        desiredEventDate: event.desiredEventDate,
        scheduledEventDate: event.scheduledEventDate,
        isConfirmed: event.isConfirmed,
        status: event.status,
        statusChangedAt: event.statusChangedAt,
        assignedTo: event.assignedTo,
        nextAction: event.nextAction,
        eventAddress: event.eventAddress,
        latitude: event.latitude,
        longitude: event.longitude,
        estimatedSandwichCount: event.estimatedSandwichCount,
        actualSandwichCount: event.actualSandwichCount,
        volunteerCount: event.volunteerCount,
        estimatedAttendance: event.estimatedAttendance,
        adultCount: event.adultCount,
        childrenCount: event.childrenCount,
        kidsAgeRange: event.kidsAgeRange,
        actualAttendance: event.actualAttendance,
        driversNeeded: event.driversNeeded,
        assignedDriverIds: event.assignedDriverIds,
        selfTransport: event.selfTransport,
        speakersNeeded: event.speakersNeeded,
        assignedSpeakerIds: event.assignedSpeakerIds,
        volunteersNeeded: event.volunteersNeeded,
        assignedVolunteerIds: event.assignedVolunteerIds,
        vanDriverNeeded: event.vanDriverNeeded,
        vanNeededFor: event.vanNeededFor,
        assignedVanDriverId: event.assignedVanDriverId,
        isDhlVan: event.isDhlVan,
        tentativeDriverIds: event.tentativeDriverIds,
        tspContactAssigned: event.tspContactAssigned,
        toolkitSent: event.toolkitSent,
        toolkitStatus: event.toolkitStatus,
        eventStartTime: event.eventStartTime,
        eventEndTime: event.eventEndTime,
        pickupTime: event.pickupTime,
        pickupDateTime: event.pickupDateTime,
        addedToOfficialSheet: event.addedToOfficialSheet,
        addedToOfficialSheetAt: event.addedToOfficialSheetAt,
        isUnresponsive: event.isUnresponsive,
        contactAttempts: event.contactAttempts,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        deletedAt: (event as any).deletedAt, // Include deletedAt when searching deleted events
        deletedBy: (event as any).deletedBy, // Include deletedBy when searching deleted events
      }));

      logger.info(`🔍 Search for "${searchQuery}" ${includeDeleted ? '(including deleted)' : ''} returned ${lightweightResults.length} results`);
      res.json(lightweightResults);
    } catch (error) {
      logger.error('Failed to search event requests', error);
      res.status(500).json({ message: 'Failed to search event requests' });
    }
  }
);

// Get event requests by status
router.get(
  '/status/:status',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      const { status } = req.params;
      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_VIEW',
        `Retrieved event requests with status: ${status}`
      );
      const eventRequests = await storage.getEventRequestsByStatus(status);
      res.json(eventRequests);
    } catch (error) {
      logger.error('Failed to fetch event requests by status', error);
      res.status(500).json({ message: 'Failed to fetch event requests' });
    }
  }
);

// Get organization event counts (completed events only) - MUST BE BEFORE /:id route
router.get('/organization-counts', isAuthenticated, async (req, res) => {
  try {
    const allEventRequests = await storage.getAllEventRequests();

    // Count completed events by organization
    const organizationCounts = new Map();

    allEventRequests.forEach((event) => {
      // Only count completed events
      if (event.status === 'completed' && event.organizationName) {
        const orgName = event.organizationName.trim();
        if (orgName) {
          organizationCounts.set(
            orgName,
            (organizationCounts.get(orgName) || 0) + 1
          );
        }
      }
    });

    // Convert to array and sort by count (descending)
    const sortedCounts = Array.from(organizationCounts.entries())
      .map(([name, count]) => ({ organizationName: name, eventCount: count }))
      .sort((a, b) => b.eventCount - a.eventCount);

    res.json(sortedCounts);
  } catch (error) {
    logger.error('Failed to fetch organization counts', error);
    res.status(500).json({ error: 'Failed to fetch organization counts' });
  }
});

// Diagnostic endpoint to check if event exists in database
// This bypasses the storage wrapper to directly query the database
router.get(
  '/:id(\\d+)/diagnose',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      logger.info(`[DIAGNOSE] Checking event ${id}`);

      // Method 1: Storage wrapper (normal method)
      const storageResult = await storage.getEventRequest(id);

      // Method 2: Direct database query
      const { db } = await import('../db');
      const { eventRequests } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const [directResult] = await db.select().from(eventRequests).where(eq(eventRequests.id, id));

      const diagnosis = {
        requestedId: id,
        storageFound: !!storageResult,
        directDbFound: !!directResult,
        storageSummary: storageResult ? {
          id: storageResult.id,
          organizationName: storageResult.organizationName,
          status: storageResult.status,
          deletedAt: storageResult.deletedAt,
        } : null,
        directDbSummary: directResult ? {
          id: directResult.id,
          organizationName: directResult.organizationName,
          status: directResult.status,
          deletedAt: directResult.deletedAt,
        } : null,
        mismatch: !!storageResult !== !!directResult,
      };

      logger.info(`[DIAGNOSE] Results:`, JSON.stringify(diagnosis, null, 2));
      res.json(diagnosis);
    } catch (error) {
      logger.error('[DIAGNOSE] Error:', error);
      res.status(500).json({ error: String(error) });
    }
  }
);

// Get single event request
router.get(
  '/:id(\\d+)',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid event request ID' });
      }
      const eventRequest = await storage.getEventRequest(id);

      if (!eventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_VIEW',
        `Retrieved event request: ${id}`
      );
      res.json(eventRequest);
    } catch (error) {
      logger.error('Failed to fetch event request', error);
      res.status(500).json({ message: 'Failed to fetch event request' });
    }
  }
);

// Create new event request
router.post(
  '/',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_ADD'),
  async (req, res) => {
    try {
      const user = req.user;

      // Generate externalId for manual entries if not provided
      let requestData = { ...req.body };
      if (!requestData.externalId) {
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        requestData.externalId = `manual-${timestamp}-${randomSuffix}`;
      }

      let validatedData;
      try {
        validatedData = insertEventRequestSchema.parse(requestData);
      } catch (validationError: unknown) {
        const zodError = validationError instanceof z.ZodError ? validationError : null;
        const errorDetails = zodError
          ? zodError.errors
          : (validationError as Error).message;
        // Surface the ACTUAL field-level problem (e.g. an invalid email) instead
        // of the generic org-name message — that message made real validation
        // failures look unexplained, since the user had already entered an org name.
        const firstIssue = zodError?.errors?.[0];
        const specificMessage = firstIssue
          ? (firstIssue.path?.length
              ? `${firstIssue.message} (field: ${firstIssue.path.join('.')})`
              : firstIssue.message)
          : null;
        return res.status(400).json({
          error: 'Validation failed',
          details: errorDetails,
          message: specificMessage || 'Please check your input and try again.',
        });
      }

      // Check for organization duplicates
      const duplicateCheck = { exists: false, matches: [] as Array<{ name: string }> };

      const newEventRequest = await storage.createEventRequest({
        ...validatedData,
        organizationExists: duplicateCheck.exists,
        duplicateNotes: duplicateCheck.exists
          ? `Potential matches found: ${duplicateCheck.matches
              .map((m) => m.name)
              .join(', ')}`
          : null,
        duplicateCheckDate: new Date(),
        createdBy: user?.id || 1,
      });

      // Enhanced audit logging for create operation
      await AuditLogger.logEventRequestChange(
        newEventRequest.id?.toString() || 'unknown',
        null,
        newEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        },
        { actionType: 'CREATE' }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_ADD',
        `Created event request: ${newEventRequest.id} for ${validatedData.organizationName}`
      );

      // Geocode asynchronously — don't block the create response on Google/OSM.
      // Coordinates appear shortly after; map views can pick them up on refresh.
      if (validatedData.eventAddress) {
        const eventId = newEventRequest.id!;
        const address = validatedData.eventAddress;
        geocodeAddress(address)
          .then(async (coords) => {
            if (coords) {
              await storage.updateEventRequest(eventId, {
                latitude: coords.latitude,
                longitude: coords.longitude,
              });
              logger.log(`✅ Geocoded event ${eventId}: ${address}`);
            } else {
              logger.warn(`⚠️ Geocoding returned no results for event ${eventId}: ${address}`);
            }
          })
          .catch((error) => {
            logger.error(`Failed to geocode event ${eventId}:`, error);
          });
      }

      res.status(201).json(newEventRequest);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: 'Invalid input', errors: error.errors });
      }
      logger.error('Failed to create event request', error);
      res.status(500).json({ message: 'Failed to create event request' });
    }
  }
);

// Complete primary contact - comprehensive data collection
router.patch(
  '/:id/details',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const completionDataSchema = z.object({
        communicationMethod: z.string().min(1, 'Communication method required'),
        eventAddress: z.string().optional(),
        estimatedSandwichCount: z.number().min(1).optional(),
        hasRefrigeration: z.boolean().optional(),
        notes: z.string().optional(),
      });

      const validatedData = completionDataSchema.parse(req.body);

      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Build the contact log entry template (attempt number will be calculated in SQL)
      const timestamp = new Date().toISOString();
      const userName = req.user?.firstName && req.user?.lastName
        ? `${req.user.firstName} ${req.user.lastName}`
        : req.user?.email || 'System';

      // Build dynamic SET clauses - only update fields that are actually provided
      const setFields = [
        sql`contact_attempts_log = COALESCE(er.contact_attempts_log, '[]'::jsonb) || 
            jsonb_build_array(
              jsonb_build_object(
                'attemptNumber', locked.next_attempt_number,
                'timestamp', ${timestamp},
                'method', ${validatedData.communicationMethod},
                'outcome', 'Got response',
                'notes', ${validatedData.notes || 'Contact completed'},
                'createdBy', ${req.user?.id || 'system'},
                'createdByName', ${userName}
              )
            )`,
        sql`contacted_at = ${new Date()}`,
        sql`completed_by_user_id = ${req.user?.id}`,
        sql`communication_method = ${validatedData.communicationMethod}`,
        sql`status = 'contact_completed'`,
        sql`last_contact_attempt = ${new Date()}`,
        sql`updated_at = NOW()`,
      ];

      // Only add optional field updates if they're provided
      if (validatedData.eventAddress !== undefined) {
        setFields.push(sql`event_address = ${validatedData.eventAddress}`);
      }
      if (validatedData.estimatedSandwichCount !== undefined) {
        setFields.push(sql`estimated_sandwich_count = ${validatedData.estimatedSandwichCount}`);
      }
      if (validatedData.hasRefrigeration !== undefined) {
        setFields.push(sql`has_refrigeration = ${validatedData.hasRefrigeration}`);
      }
      if (validatedData.notes !== undefined) {
        setFields.push(sql`contact_completion_notes = ${validatedData.notes}`);
      }

      // Atomically update with row-level locking using CTE to prevent race conditions
      await db.execute(
        sql`WITH locked AS (
              SELECT 
                id,
                COALESCE(
                  (SELECT MAX((entry->>'attemptNumber')::int) 
                   FROM jsonb_array_elements(COALESCE(contact_attempts_log, '[]'::jsonb)) AS entry),
                  0
                ) + 1 AS next_attempt_number
              FROM event_requests
              WHERE id = ${id}
              FOR UPDATE
            )
            UPDATE event_requests er
            SET ${sql.join(setFields, sql`, `)}
            FROM locked
            WHERE er.id = locked.id`
      );

      // Fetch the updated event request for response and audit logging
      let updatedEventRequest = await storage.getEventRequestById(id);

      // REMOVED: No longer updating Google Sheets - one-way sync only

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Re-geocode if address was provided and either changed or coordinates are missing
      const addressChanged1 = validatedData.eventAddress && validatedData.eventAddress !== originalEvent.eventAddress;
      const missingCoords1 = validatedData.eventAddress && (!updatedEventRequest.latitude || !updatedEventRequest.longitude);
      if (addressChanged1 || missingCoords1) {
        try {
          const coords = await geocodeAddress(validatedData.eventAddress);
          if (coords) {
            await storage.updateEventRequest(id, {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            updatedEventRequest = { ...updatedEventRequest, latitude: coords.latitude, longitude: coords.longitude } as any;
            logger.log(`✅ Geocoded event ${id}: ${validatedData.eventAddress}`);
          } else {
            logger.warn(`⚠️ Geocoding returned no results for event ${id}: ${validatedData.eventAddress}`);
          }
        } catch (error) {
          logger.error(`Failed to geocode event ${id}:`, error);
        }
      }

      // Enhanced audit logging for contact completion
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_COMPLETE_CONTACT',
        `Completed contact for event request: ${id}`
      );
      res.json(updatedEventRequest);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: 'Invalid completion data', errors: error.errors });
      }
      logger.error('Error completing contact:', error);
      res.status(500).json({ message: 'Failed to complete contact' });
    }
  }
);

// Complete contact with comprehensive event details - single step workflow
router.post(
  '/complete-contact',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const { id, ...updates } = req.body;


      const updatedEventRequest = await storage.updateEventRequest(id, {
        ...updates,
        // NOTE: contactedAt, completedByUserId, contactCompletedAt were removed in migration 0024
        updatedAt: new Date(),
      });

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Update Google Sheets with the new status if status was provided
      if (updates.status) {
        try {
          const googleSheetsService =
            getEventRequestsGoogleSheetsService(storage as any);
          if (googleSheetsService) {
            const contactName =
              `${updatedEventRequest.firstName} ${updatedEventRequest.lastName}`.trim();
            await googleSheetsService.updateEventRequestStatus(
              updatedEventRequest.organizationName,
              contactName,
              updates.status
            );
          }
        } catch (error) {
        }
      }

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_COMPLETE_CONTACT',
        `Completed contact with comprehensive details for event request: ${id}`
      );
      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error completing contact:', error);
      res.status(500).json({ message: 'Failed to complete contact' });
    }
  }
);

// Complete event details - specific endpoint for comprehensive event planning updates
router.post(
  '/complete-event-details',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      // Skip validation entirely and just process the raw data
      const { id, ...updates } = req.body;


      // Handle date conversion properly on server side
      if (
        updates.desiredEventDate &&
        typeof updates.desiredEventDate === 'string'
      ) {
        // Convert string date to proper Date object using timezone-safe utility
        // IMPORTANT: Do NOT use 'Z' suffix - it causes dates to shift by one day!
        updates.desiredEventDate = parseDateOnly(updates.desiredEventDate);
      }

      // CRITICAL FIX: Explicitly set status to 'scheduled' when completing event details
      updates.status = 'scheduled';
      updates.scheduledAt = new Date(); // Add audit trail timestamp

      const updatedEventRequest = await storage.updateEventRequest(id, {
        ...updates,
        updatedAt: new Date(),
      });

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Completed event details for: ${id}`
      );
      res.json(updatedEventRequest);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Validation error:', error.errors);
        return res.status(400).json({
          message: 'Invalid event details data',
          errors: error.errors,
        });
      }
      logger.error('Error completing event details:', error);
      res.status(500).json({ message: 'Failed to complete event details' });
    }
  }
);

// Record follow-up action (email sent or callback completed)
router.post(
  '/follow-up',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const { id, method, updatedEmail, notes } = req.body;


      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      const updates: Partial<EventRequest> = {
        followUpMethod: method,
        followUpDate: new Date(),
        updatedAt: new Date(),
      };

      // Both email and call follow-ups should move event to in_process
      updates.status = 'in_process';

      // Explicitly preserve critical fields that must not be lost during status transitions
      if (originalEvent.desiredEventDate) {
        updates.desiredEventDate = originalEvent.desiredEventDate;
      }

      if (method === 'call' && updatedEmail) {
        // Update the main email field if a corrected email is provided during call follow-up
        updates.email = updatedEmail;
        updates.updatedEmail = updatedEmail; // Keep for audit trail
      }

      // Add notes to existing followUpNotes if provided
      if (notes) {
        const existingNotes = originalEvent?.followUpNotes || '';
        updates.followUpNotes = existingNotes
          ? `${existingNotes}\n\n${notes}`
          : notes;
      }

      // Build the follow-up log entry template (attempt number will be calculated in SQL)
      const timestamp = new Date().toISOString();
      const userName = req.user?.firstName && req.user?.lastName
        ? `${req.user.firstName} ${req.user.lastName}`
        : req.user?.email || 'System';
      const outcome = method === 'call' ? 'Completed call' : 'Sent email';

      // Build dynamic SET clauses - only update fields that are actually provided
      const setFields = [
        sql`contact_attempts_log = COALESCE(er.contact_attempts_log, '[]'::jsonb) || 
            jsonb_build_array(
              jsonb_build_object(
                'attemptNumber', locked.next_attempt_number,
                'timestamp', ${timestamp},
                'method', ${method},
                'outcome', ${outcome},
                'notes', ${notes || `Follow-up ${method} completed`},
                'createdBy', ${req.user?.id || 'system'},
                'createdByName', ${userName}
              )
            )`,
        sql`follow_up_method = ${method}`,
        sql`follow_up_date = NOW()`,
        sql`status = 'in_process'`,
        sql`last_contact_attempt = ${new Date()}`,
        sql`updated_at = NOW()`,
      ];

      // Only add optional field updates if they're provided
      if (updates.desiredEventDate !== undefined && updates.desiredEventDate !== null) {
        setFields.push(sql`desired_event_date = ${updates.desiredEventDate}`);
      }
      if (method === 'call' && updatedEmail) {
        setFields.push(sql`email = ${updatedEmail}`);
        setFields.push(sql`updated_email = ${updatedEmail}`);
      }
      if (updates.followUpNotes !== undefined && updates.followUpNotes !== null) {
        setFields.push(sql`follow_up_notes = ${updates.followUpNotes}`);
      }

      // Atomically update with row-level locking using CTE to prevent race conditions
      await db.execute(
        sql`WITH locked AS (
              SELECT 
                id,
                COALESCE(
                  (SELECT MAX((entry->>'attemptNumber')::int) 
                   FROM jsonb_array_elements(COALESCE(contact_attempts_log, '[]'::jsonb)) AS entry),
                  0
                ) + 1 AS next_attempt_number
              FROM event_requests
              WHERE id = ${id}
              FOR UPDATE
            )
            UPDATE event_requests er
            SET ${sql.join(setFields, sql`, `)}
            FROM locked
            WHERE er.id = locked.id`
      );

      // Fetch the updated event request for response and audit logging
      let updatedEventRequest = await storage.getEventRequestById(id);

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Enhanced audit logging with detailed field changes AND follow-up context
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        },
        {
          followUpMethod: method,
          followUpAction: method === 'call' ? 'phone_call_completed' : 'email_sent',
          notes: notes || `Follow-up ${method} completed`,
          actionType: 'FOLLOW_UP_COMPLETED',
          updatedEmail: method === 'call' ? updatedEmail : undefined,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_FOLLOW_UP',
        `Recorded follow-up (${method}) for event request: ${id}`
      );
      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error recording follow-up:', error);
      res.status(500).json({ message: 'Failed to record follow-up' });
    }
  }
);

// Update event request details - specific endpoint for event details updates
router.patch(
  '/:id/event-details',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

      // Strip optimistic locking field if accidentally included by client
      delete updates._expectedVersion;

      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Process pickup time fields for data migration
      const processedUpdates = processPickupTimeFields(updates, originalEvent);

      // Automatically assign the current user as TSP contact if toolkit is being marked as sent
      // This auto-assignment happens silently (no email) since toolkit sending happens later in workflow
      if ((processedUpdates.toolkitSent === true || processedUpdates.toolkitStatus === 'sent') &&
          !originalEvent.tspContact &&
          req.user?.id) {
        processedUpdates.tspContact = req.user.id;
        processedUpdates.tspContactAssignedDate = new Date();
      }

      // Automatically increment contactAttempts when toolkit is marked as sent (if not already sent)
      if ((processedUpdates.toolkitSent === true || processedUpdates.toolkitStatus === 'sent') &&
          !originalEvent.toolkitSent) {
        const existingLog = Array.isArray(originalEvent.contactAttemptsLog)
          ? (originalEvent.contactAttemptsLog as any[])
          : [];
        const currentAttempts = originalEvent.contactAttempts || 0;
        const nextAttemptNumber = Math.max(currentAttempts, existingLog.length) + 1;

        const toolkitLogEntry = {
          attemptNumber: nextAttemptNumber,
          timestamp: new Date().toISOString(),
          method: 'email',
          outcome: 'toolkit_sent',
          notes: 'Toolkit sent',
          createdBy: req.user?.id || 'system',
          createdByName: req.user?.firstName && req.user?.lastName
            ? `${req.user.firstName} ${req.user.lastName}`
            : req.user?.email || 'System',
        };

        processedUpdates.contactAttemptsLog = [...existingLog, toolkitLogEntry];
        processedUpdates.contactAttempts = nextAttemptNumber;
        processedUpdates.lastContactAttempt = new Date();
      }

      // Same jsonb normalization as the main PATCH path.
      normalizeSandwichTypeColumns(processedUpdates);

      // Always update the updatedAt timestamp
      let updatedEventRequest = await storage.updateEventRequest(id, {
        ...processedUpdates,
        updatedAt: new Date(),
      });

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Re-geocode if address was provided and either changed or coordinates are missing
      const addressChanged2 = processedUpdates.eventAddress && processedUpdates.eventAddress !== originalEvent.eventAddress;
      const missingCoords2 = processedUpdates.eventAddress && (!updatedEventRequest.latitude || !updatedEventRequest.longitude);
      if (addressChanged2 || missingCoords2) {
        try {
          const coords = await geocodeAddress(processedUpdates.eventAddress);
          if (coords) {
            await storage.updateEventRequest(id, {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            updatedEventRequest = { ...updatedEventRequest, latitude: coords.latitude, longitude: coords.longitude } as any;
            logger.log(`✅ Geocoded event ${id}: ${processedUpdates.eventAddress}`);
          } else {
            logger.warn(`⚠️ Geocoding returned no results for event ${id}: ${processedUpdates.eventAddress}`);
          }
        } catch (error) {
          logger.error(`Failed to geocode event ${id}:`, error);
        }
      }

      // REMOVED: No longer updating Google Sheets - one-way sync only

      // Enhanced audit logging for event details update
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      // Create meaningful activity log with event details and what changed
      const organizationName = updatedEventRequest.organizationName || `Event #${id}`;
      const contactName = updatedEventRequest.firstName && updatedEventRequest.lastName 
        ? `${updatedEventRequest.firstName} ${updatedEventRequest.lastName}` 
        : 'contact';
      
      // Prepare audit details for activity logging
      const auditDetails: Record<string, { from: unknown; to: unknown }> = {};
      const changeDescriptions: string[] = [];

      for (const [key, newValue] of Object.entries(updates)) {
        if (key !== 'updatedAt') {
          // Skip timestamp field
          const oldValue = originalEvent[key as keyof EventRequest];
          if (oldValue !== newValue && newValue !== undefined) {
            auditDetails[key] = {
              from: oldValue,
              to: newValue,
            };
            
            // Create human-readable descriptions for key fields
            if (key === 'status') {
              changeDescriptions.push(`status: ${oldValue} → ${newValue}`);
            } else if (key === 'scheduledEventDate' || key === 'desiredEventDate') {
              const dateStr = newValue ? new Date(newValue).toLocaleDateString('en-US') : 'none';
              changeDescriptions.push(`event date: ${dateStr}`);
            } else if (key === 'estimatedSandwichCount') {
              changeDescriptions.push(`estimated sandwiches: ${newValue}`);
            } else if (key === 'pickupTime') {
              changeDescriptions.push(`pickup time: ${newValue}`);
            } else if (key === 'eventAddress') {
              changeDescriptions.push(`address updated`);
            } else {
              changeDescriptions.push(key.replace(/([A-Z])/g, ' $1').toLowerCase());
            }
          }
        }
      }

      const changesSummary = changeDescriptions.length > 0 
        ? changeDescriptions.slice(0, 3).join(', ') + (changeDescriptions.length > 3 ? '...' : '')
        : 'details updated';

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Updated ${organizationName} (${contactName}): ${changesSummary}`,
        { auditDetails: auditDetails }
      );
      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error updating event request details:', error);
      res
        .status(500)
        .json({ message: 'Failed to update event request details' });
    }
  }
);

// Update event request (PATCH) - handles basic updates like toolkit sent
router.patch(
  '/:id',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

      if (isNaN(id)) {
        logger.error(`[PATCH /:id] Invalid ID: ${req.params.id}`);
        return res.status(400).json({ message: 'Invalid event request ID', id: req.params.id });
      }

      logger.info(`[PATCH /:id] Request received for event ${id}, path: ${req.path}, originalUrl: ${req.originalUrl}`);
      logger.info(`[PATCH /:id] Updates:`, JSON.stringify(updates, null, 2));

      // Track fields the server silently dropped during processing so the client can warn the user.
      // Each entry: { field: 'fieldName', reason: 'human-readable explanation' }
      const droppedFields: Array<{ field: string; reason: string }> = [];

      // SHADOW VALIDATION (save-path consolidation PR-A — log-only, never rejects).
      // Parse the incoming body against the shared eventRequestPatchSchema and log
      // any violations so we can see what real payloads would fail BEFORE enforcement
      // is turned on (see docs/event-request-save-path-consolidation.md). safeParse
      // never throws and the result is intentionally discarded — this cannot affect
      // the save. Set EVENT_PATCH_SHADOW_VALIDATION=off to silence.
      if (process.env.EVENT_PATCH_SHADOW_VALIDATION !== 'off') {
        try {
          const shadow = eventRequestPatchSchema.safeParse(updates);
          if (!shadow.success) {
            const issues = shadow.error.issues.map((issue) => ({
              path: issue.path.join('.') || '(root)',
              code: issue.code,
              message: issue.message,
            }));
            logger.warn(
              `[PATCH /:id] SHADOW VALIDATION: event ${id} body would fail eventRequestPatchSchema (${issues.length} issue(s)): ${JSON.stringify(issues)}`
            );
          }
        } catch (shadowError) {
          // Defensive: a bug in shadow validation must never break a real save.
          // Serialize the error into the message string — passing an Error as a
          // second arg to the production logger loses the stack and can render as
          // "{}" (Error's own props are non-enumerable).
          const detail =
            shadowError instanceof Error
              ? `${shadowError.message}${shadowError.stack ? `\n${shadowError.stack}` : ''}`
              : String(shadowError);
          logger.warn(`[PATCH /:id] SHADOW VALIDATION threw (ignored): ${detail}`);
        }
      }

      // DEBUG: Log department field specifically
      logger.info(`[PATCH /:id] DEPARTMENT DEBUG: department in updates = "${updates.department}", type = ${typeof updates.department}`);
      // DEBUG: Log van driver fields
      logger.info(`[PATCH /:id] VAN DRIVER DEBUG: vanDriverNeeded=${updates.vanDriverNeeded}, assignedVanDriverId=${updates.assignedVanDriverId}`);

      // DEBUG: Log speaker fields specifically
      logger.info(`[PATCH /:id] SPEAKER DEBUG - Raw request body keys: ${Object.keys(updates).join(', ')}`);
      logger.info(`[PATCH /:id] SPEAKER DEBUG - speakerDetails in updates: ${JSON.stringify(updates.speakerDetails)}`);
      logger.info(`[PATCH /:id] SPEAKER DEBUG - assignedSpeakerIds in updates: ${JSON.stringify(updates.assignedSpeakerIds)}`);
      logger.info(`[PATCH /:id] SPEAKER DEBUG - speakerAssignments in updates: ${JSON.stringify(updates.speakerAssignments)}`);

      // Validate scheduledCallDate if present using z.coerce.date()
      if (updates.scheduledCallDate !== undefined) {
        const scheduleCallSchema = z.object({
          scheduledCallDate: z
            .union([z.coerce.date(), z.literal('').transform(() => null)])
            .nullable(),
        });

        try {
          const validated = scheduleCallSchema.parse({
            scheduledCallDate: updates.scheduledCallDate,
          });
          updates.scheduledCallDate = validated.scheduledCallDate;
        } catch (error) {
          // Invalid date format — skip this field rather than blocking the entire save
          logger.warn('⚠️ Invalid scheduledCallDate format, ignoring field:', updates.scheduledCallDate);
          droppedFields.push({ field: 'scheduledCallDate', reason: 'Invalid date format' });
          delete updates.scheduledCallDate;
        }
      }

      // Row-level optimistic locking REMOVED for the normal edit path.
      // The old _expectedVersion check returned 409 whenever updatedAt changed
      // AT ALL since the client loaded the event — which fired far more false
      // "someone else edited this" errors than it ever prevented real conflicts.
      // The common triggers were the SAME operator (their scratchpad auto-save
      // bumping updatedAt, the Google Sheets message-backfill, or two quick
      // edits in a row), not a second person. For this mostly single-editor
      // intake workflow, blocking the whole save in those cases was net-harmful.
      // We still strip the field so it's never written as a column. If genuine
      // concurrent co-editing ever becomes a real problem, add a FIELD-LEVEL
      // check here (conflict only when the same field changed) rather than
      // reinstating the row-level gate.
      delete updates._expectedVersion;

      // Get original data for audit logging
      logger.info(`[PATCH /:id] About to fetch event ${id} from storage`);
      const originalEvent = await storage.getEventRequestById(id);
      logger.info(`[PATCH /:id] Storage returned:`, originalEvent ? `Event found (${originalEvent.organizationName})` : 'null/undefined');

      if (!originalEvent) {
        logger.error(`[PATCH /:id] Event request ${id} not found in database`);
        logger.error(`[PATCH /:id] Attempted update fields:`, Object.keys(updates).join(', '));
        logger.error(`[PATCH /:id] User: ${req.user?.id} (${req.user?.email})`);
        logger.error(`[PATCH /:id] Request body preview:`, JSON.stringify(updates).substring(0, 200));

        // Try direct database check to see if event exists but is soft-deleted
        try {
          const { db } = await import('../db');
          const { eventRequests } = await import('@shared/schema');
          const { eq } = await import('drizzle-orm');
          const [directCheck] = await db.select().from(eventRequests).where(eq(eventRequests.id, id));
          if (directCheck) {
            logger.error(`[PATCH /:id] DIAGNOSTIC: Event ${id} EXISTS in DB but storage returned null!`);
            logger.error(`[PATCH /:id] DIAGNOSTIC: deletedAt = ${directCheck.deletedAt}, status = ${directCheck.status}`);
          } else {
            logger.error(`[PATCH /:id] DIAGNOSTIC: Event ${id} truly does NOT exist in database`);
          }
        } catch (diagError) {
          logger.error(`[PATCH /:id] DIAGNOSTIC check failed:`, diagError);
        }

        return res.status(404).json({
          message: 'Event request not found',
          eventId: id,
          error: 'EVENT_NOT_FOUND',
          details: 'The event request may have been deleted or the ID is incorrect. Please refresh the page and try again.'
        });
      }

      // Process pickup time fields for data migration
      const pickupProcessedUpdates = processPickupTimeFields(updates, originalEvent);

      // Process timestamp fields to ensure they're proper Date objects
      const processedUpdates = { ...pickupProcessedUpdates };

      // Convert timestamp fields that might come as strings to Date objects
      // (shared list — see EVENT_REQUEST_TIMESTAMP_FIELDS at the top of this file)
      const timestampFields = EVENT_REQUEST_TIMESTAMP_FIELDS;

      timestampFields.forEach((field) => {
        if (
          processedUpdates[field] &&
          typeof processedUpdates[field] === 'string'
        ) {
          try {
            const dateString = processedUpdates[field] as string;
            // Use timezone-safe date parsing utility
            // IMPORTANT: Do NOT use 'Z' suffix - it causes dates to shift by one day!
            const dateValue = parseDateOnly(dateString);

            // Check if the date is valid
            if (!dateValue) {
              logger.error(`[PATCH] Invalid date value for field ${field}:`, dateString);
              droppedFields.push({ field, reason: 'Invalid date format' });
              delete processedUpdates[field]; // Remove invalid date fields
            } else {
              processedUpdates[field] = dateValue;
              logger.info(`[PATCH] Converted ${field} from "${dateString}" to ${dateValue.toISOString()}`);
            }
          } catch (error) {
            logger.error(`[PATCH] Error parsing date for field ${field}:`, error);
            droppedFields.push({ field, reason: 'Could not parse date' });
            delete processedUpdates[field]; // Remove invalid date fields
          }
        } else if (processedUpdates[field] === null || processedUpdates[field] === '') {
          // Allow null or empty string to clear date fields
          processedUpdates[field] = null;
        }
      });

      // Check if status is changing and set statusChangedAt accordingly
      if (
        processedUpdates.status &&
        processedUpdates.status !== originalEvent.status
      ) {
        // Validate the status transition
        const fromStatus = originalEvent.status as EventStatus;
        const toStatus = processedUpdates.status as EventStatus;
        if (!isValidTransition(fromStatus, toStatus)) {
          const errorMsg = getTransitionError(fromStatus, toStatus);
          logger.warn(`[PATCH /:id] Invalid status transition for event ${id}: ${fromStatus} → ${toStatus}`);
          return res.status(400).json({
            message: errorMsg,
            error: 'INVALID_STATUS_TRANSITION',
            currentStatus: fromStatus,
            requestedStatus: toStatus,
          });
        }

        // Enforce that reason-required transitions actually record a reason.
        // Single source of truth: the shared workflow lists every field that can
        // satisfy the requirement — the structured reason column (filled by the
        // card-action dialogs) OR the matching/general notes (the full-form
        // scheduling path documents the reason there). The requirement is met if
        // ANY of those is non-empty after this PATCH (incoming value if provided,
        // otherwise what's already on the record).
        if (requiresReason(toStatus)) {
          const satisfied = getReasonSatisfyingFields(toStatus).some((field) => {
            const incoming = (processedUpdates as any)[field];
            const effective = incoming !== undefined ? incoming : (originalEvent as any)[field];
            return typeof effective === 'string' && effective.trim() !== '';
          });
          if (!satisfied) {
            logger.warn(`[PATCH /:id] Missing required reason for event ${id}: ${fromStatus} → ${toStatus}`);
            return res.status(400).json({
              message: `A reason or note is required to mark this event as "${toStatus}".`,
              error: 'MISSING_REASON',
              requestedStatus: toStatus,
              reasonField: getReasonField(toStatus),
            });
          }
        }

        // Guard: an event can't land on the calendar without a date. With
        // transition restrictions disabled (July 2026), 'scheduled' and
        // 'rescheduled' are reachable from ANY status via the form dropdown,
        // so enforce the one invariant that still matters — a scheduled/
        // rescheduled event must have an event date (scheduled or desired).
        // Resolve with `!== undefined` so an explicit null clear in this same
        // PATCH is respected instead of falling back to the stored value.
        if (toStatus === 'scheduled' || toStatus === 'rescheduled') {
          const dateForCalendar =
            (processedUpdates.scheduledEventDate !== undefined
              ? processedUpdates.scheduledEventDate
              : originalEvent.scheduledEventDate) ??
            (processedUpdates.desiredEventDate !== undefined
              ? processedUpdates.desiredEventDate
              : originalEvent.desiredEventDate);
          if (!dateForCalendar) {
            logger.warn(`[PATCH /:id] Missing event date for event ${id}: ${fromStatus} → ${toStatus}`);
            return res.status(400).json({
              message: `An event date is required to mark this event as "${toStatus}". Please add an event date first.`,
              error: 'MISSING_EVENT_DATE',
              requestedStatus: toStatus,
            });
          }
        }

        processedUpdates.statusChangedAt = new Date();

        // Pure transition side-effect from the shared workflow: when scheduling
        // an event with no date yet, fall back to its desired date. Applied here
        // so every scheduling path is consistent (the client no longer does it).
        //
        // Resolve effective values with `!== undefined` (not `??`) so an explicit
        // null in this PATCH (intentionally clearing a date) is respected, and a
        // desired date updated in the same request is preferred over the stored one.
        const effectiveScheduledDate =
          processedUpdates.scheduledEventDate !== undefined
            ? processedUpdates.scheduledEventDate
            : originalEvent.scheduledEventDate;
        const effectiveDesiredDate =
          processedUpdates.desiredEventDate !== undefined
            ? processedUpdates.desiredEventDate
            : originalEvent.desiredEventDate;
        const scheduledDateDefault = getScheduledDateDefault(
          toStatus,
          effectiveScheduledDate,
          effectiveDesiredDate,
        );
        if (scheduledDateDefault !== undefined) {
          processedUpdates.scheduledEventDate = scheduledDateDefault;
        }

        // If status is changing to 'completed', auto-confirm the event
        if (processedUpdates.status === 'completed') {
          processedUpdates.isConfirmed = true;
        }

        // When an event becomes scheduled (or rescheduled to a new confirmed date),
        // auto-confirm the date ("Date Pending" → "Date Confirmed") and surface it on
        // the Volunteer Hub so volunteers can sign up. Both remain manually toggleable
        // afterward; we only set them on the transition, and we never force
        // showOnVolunteerHub back off. Respect an explicit value sent in the same request.
        if (toStatus === 'scheduled' || toStatus === 'rescheduled') {
          if (processedUpdates.isConfirmed === undefined) {
            processedUpdates.isConfirmed = true;
          }
          if (processedUpdates.showOnVolunteerHub === undefined && !originalEvent.showOnVolunteerHub) {
            processedUpdates.showOnVolunteerHub = true;
          }
        }

        // Track reason metadata for declined status
        if (processedUpdates.status === 'declined') {
          processedUpdates.declinedAt = new Date();
          processedUpdates.declinedBy = req.user?.id || null;
          // declinedReason and declinedNotes come from the request body if provided
        }

        // Track reason metadata for cancelled status
        if (processedUpdates.status === 'cancelled') {
          processedUpdates.cancelledAt = new Date();
          processedUpdates.cancelledBy = req.user?.id || null;
          // cancelledReason and cancelledNotes come from the request body if provided
        }

        // Track metadata for non_event status
        if (processedUpdates.status === 'non_event') {
          processedUpdates.nonEventAt = new Date();
          processedUpdates.nonEventBy = req.user?.id || null;
        }

        // Track when the event entered standby. Drives the "since ..." badge on
        // the standby card and lets the standby follow-up reminder treat each
        // standby episode independently. Only set on the transition INTO
        // standby, so re-saving an already-standby event keeps the original date.
        if (processedUpdates.status === 'standby') {
          processedUpdates.standbyMarkedAt = new Date();
        }

        // Track metadata for rescheduled status
        if (processedUpdates.status === 'rescheduled') {
          // Preserve the original scheduled date if not already set
          if (originalEvent.scheduledEventDate && !processedUpdates.originalScheduledDate) {
            processedUpdates.originalScheduledDate = originalEvent.scheduledEventDate;
          }
          processedUpdates.wasPostponed = true;
        }

      }

      // Automatically set isConfirmed = true when scheduledEventDate is first set,
      // UNLESS the client explicitly provided isConfirmed in the same request — an
      // explicit isConfirmed: false alongside a new date should be respected, not
      // silently overridden back to true.
      if (
        processedUpdates.isConfirmed === undefined &&
        processedUpdates.scheduledEventDate &&
        !originalEvent.scheduledEventDate
      ) {
        processedUpdates.isConfirmed = true;
      }

      // Allow manual override: if isConfirmed is explicitly provided, respect it
      // Exception: completed events are always confirmed
      if (processedUpdates.status === 'completed' || originalEvent.status === 'completed') {
        processedUpdates.isConfirmed = true;
      }

      // Automatically assign the current user as TSP contact if toolkit is being marked as sent
      // This auto-assignment happens silently (no email) since toolkit sending happens later in workflow
      if ((processedUpdates.toolkitSent === true || processedUpdates.toolkitStatus === 'sent') &&
          !originalEvent.tspContact &&
          req.user?.id) {
        processedUpdates.tspContact = req.user.id;
        processedUpdates.tspContactAssignedDate = new Date();
      }

      // Automatically increment contactAttempts when toolkit is marked as sent (if not already sent)
      // This ensures toolkit sending counts as a contact attempt
      if ((processedUpdates.toolkitSent === true || processedUpdates.toolkitStatus === 'sent') &&
          !originalEvent.toolkitSent) {
        const existingLog = Array.isArray(originalEvent.contactAttemptsLog)
          ? (originalEvent.contactAttemptsLog as any[])
          : [];
        const currentAttempts = originalEvent.contactAttempts || 0;
        const nextAttemptNumber = Math.max(currentAttempts, existingLog.length) + 1;

        // Add toolkit sent entry to contact attempts log
        const toolkitLogEntry = {
          attemptNumber: nextAttemptNumber,
          timestamp: new Date().toISOString(),
          method: 'email',
          outcome: 'toolkit_sent',
          notes: 'Toolkit sent',
          createdBy: req.user?.id || 'system',
          createdByName: req.user?.firstName && req.user?.lastName
            ? `${req.user.firstName} ${req.user.lastName}`
            : req.user?.email || 'System',
        };

        processedUpdates.contactAttemptsLog = [...existingLog, toolkitLogEntry];
        processedUpdates.contactAttempts = nextAttemptNumber;
        processedUpdates.lastContactAttempt = new Date();
      }

      // Validate and auto-adjust "needed" fields to prevent impossible states
      // driversNeeded tracks REGULAR drivers only — van driver is a separate concept
      const assignedRegularDrivers = processedUpdates.assignedDriverIds !== undefined
        ? (Array.isArray(processedUpdates.assignedDriverIds) ? processedUpdates.assignedDriverIds.length : 0)
        : (Array.isArray(originalEvent.assignedDriverIds) ? originalEvent.assignedDriverIds.length : 0);

      // If driversNeeded is being manually updated, ensure it's not less than assigned regular drivers
      if (processedUpdates.driversNeeded !== undefined) {
        if (processedUpdates.driversNeeded < assignedRegularDrivers) {
          processedUpdates.driversNeeded = assignedRegularDrivers;
        }
      }

      // Auto-adjust driversNeeded when regular driver assignments change
      if (processedUpdates.assignedDriverIds !== undefined) {
        const currentDriversNeeded = processedUpdates.driversNeeded !== undefined ? processedUpdates.driversNeeded : (originalEvent.driversNeeded || 0);

        if (assignedRegularDrivers > currentDriversNeeded) {
          processedUpdates.driversNeeded = assignedRegularDrivers;
        }
      }

      // If speakersNeeded is being manually updated, ensure it's not less than assigned speakers
      if (processedUpdates.speakersNeeded !== undefined && processedUpdates.speakerDetails === undefined) {
        const assignedSpeakerCount = (typeof originalEvent.speakerDetails === 'object' && originalEvent.speakerDetails !== null)
          ? Object.keys(originalEvent.speakerDetails).length
          : 0;
        if (processedUpdates.speakersNeeded < assignedSpeakerCount) {
          processedUpdates.speakersNeeded = assignedSpeakerCount;
        }
      }

      // Auto-adjust speakersNeeded when speaker assignments change
      if (processedUpdates.speakerDetails !== undefined) {
        const assignedSpeakerCount = (typeof processedUpdates.speakerDetails === 'object' && processedUpdates.speakerDetails !== null)
          ? Object.keys(processedUpdates.speakerDetails).length
          : 0;
        const currentSpeakersNeeded = originalEvent.speakersNeeded || 0;

        if (assignedSpeakerCount > currentSpeakersNeeded) {
          processedUpdates.speakersNeeded = assignedSpeakerCount;
        }
      }

      // If volunteersNeeded is being manually updated, ensure it's not less than assigned volunteers
      if (processedUpdates.volunteersNeeded !== undefined && processedUpdates.assignedVolunteerIds === undefined) {
        const assignedVolunteerCount = Array.isArray(originalEvent.assignedVolunteerIds)
          ? originalEvent.assignedVolunteerIds.length
          : 0;
        if (processedUpdates.volunteersNeeded < assignedVolunteerCount) {
          processedUpdates.volunteersNeeded = assignedVolunteerCount;
        }
      }

      // Auto-adjust volunteersNeeded when volunteer assignments change
      if (processedUpdates.assignedVolunteerIds !== undefined) {
        const assignedVolunteerCount = Array.isArray(processedUpdates.assignedVolunteerIds)
          ? processedUpdates.assignedVolunteerIds.length
          : 0;
        const currentVolunteersNeeded = originalEvent.volunteersNeeded || 0;

        if (assignedVolunteerCount > currentVolunteersNeeded) {
          processedUpdates.volunteersNeeded = assignedVolunteerCount;
        }
      }

      const vanNorm = applyVanPurposeNormalization(processedUpdates);
      if (vanNorm.error) {
        return res.status(400).json({ message: vanNorm.error, field: 'vanNeededFor' });
      }

      // Always update the updatedAt timestamp
      logger.info(`[PATCH /:id] Saving to database. Processed updates:`, JSON.stringify(processedUpdates, null, 2));

      // DEBUG: Log speaker fields specifically before save
      logger.info(`[PATCH /:id] SPEAKER DEBUG - Before save, processedUpdates.speakerDetails: ${JSON.stringify(processedUpdates.speakerDetails)}`);
      logger.info(`[PATCH /:id] SPEAKER DEBUG - Before save, processedUpdates keys: ${Object.keys(processedUpdates).join(', ')}`);

      // DEBUG: Log department field specifically before save
      logger.info(`[PATCH /:id] DEPARTMENT DEBUG: Before save, processedUpdates.department = "${processedUpdates.department}", type = ${typeof processedUpdates.department}`);

      // Track corporate priority changes with audit info
      if (processedUpdates.isCorporatePriority !== undefined) {
        // Check if corporate priority is being changed
        if (processedUpdates.isCorporatePriority && !originalEvent.isCorporatePriority) {
          // Being set to true
          processedUpdates.corporatePriorityMarkedAt = new Date();
          processedUpdates.corporatePriorityMarkedBy = req.user?.id || null;
          logger.info(`[PATCH /:id] Corporate priority ENABLED by ${req.user?.email || 'unknown'} for event ${id}`);
        } else if (!processedUpdates.isCorporatePriority && originalEvent.isCorporatePriority) {
          // Being set to false - verify permissions
          const userEmail = req.user?.email;
          const allowedEmails = [
            'admin@sandwich.project',
            'katielong2316@gmail.com',
            'katie@thesandwichproject.org',
            'christine@thesandwichproject.org'
          ];

          if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
            // Silently ignore the change rather than blocking the entire save
            // The corporate priority flag stays as-is; other edits proceed normally
            logger.warn(`[PATCH /:id] User ${userEmail} attempted to remove corporate priority without permission - ignoring field, not blocking save`);
            droppedFields.push({ field: 'isCorporatePriority', reason: 'Only specific admins can remove corporate priority flag' });
            delete processedUpdates.isCorporatePriority;
          } else {
            processedUpdates.corporatePriorityMarkedAt = null;
            processedUpdates.corporatePriorityMarkedBy = null;
            logger.info(`[PATCH /:id] Corporate priority DISABLED by ${req.user?.email || 'unknown'} for event ${id}`);
          }
        }
      }

      // The client stringifies sandwich breakdowns before sending them, so
      // these arrive as JSON strings. Writing a string into a jsonb column
      // stores a scalar, not an array — normalize so the column holds one
      // shape and SQL can read it.
      normalizeSandwichTypeColumns(processedUpdates);

      let updatedEventRequest;
      {
        // Some columns exist in the Drizzle schema but not on the current
        // database branch — migrations are applied manually per Neon branch, so
        // dev and production drift. Writing such a column throws Postgres 42703
        // (undefined_column) and used to fail the ENTIRE save with an opaque
        // 500 (the old code only special-cased addedToOfficialSheetAt). Instead,
        // detect the missing column, drop it, record it for the client's
        // partial-save warning, and retry. The loop handles several missing
        // columns in a row; the bound prevents an infinite loop if a drop never
        // resolves the error.
        const attemptUpdates: Record<string, any> = { ...processedUpdates };
        const MAX_COLUMN_DROP_RETRIES = 12;
        for (let attempt = 0; ; attempt++) {
          try {
            updatedEventRequest = await storage.updateEventRequest(id, {
              ...attemptUpdates,
              updatedAt: new Date(),
            });
            break;
          } catch (updateError: any) {
            const missingColumn = getUndefinedColumn(updateError);
            const droppedKey = missingColumn
              ? dropColumnKey(attemptUpdates, missingColumn)
              : null;
            if (droppedKey && attempt < MAX_COLUMN_DROP_RETRIES) {
              // Keep processedUpdates in sync with what we actually persist.
              // Downstream logic (the activity-log change summary, side effects)
              // keys off processedUpdates, so a dropped-but-still-present field
              // would be reported as saved when it wasn't.
              delete (processedUpdates as any)[droppedKey];
              logger.warn(
                `[PATCH /:id] Column "${missingColumn}" is not on this DB branch; dropping "${droppedKey}" and retrying: ${updateError?.message}`
              );
              droppedFields.push({
                field: droppedKey,
                reason: 'Database column not available on this branch (migration pending)',
              });
              continue;
            }
            throw updateError;
          }
        }
      }

      logger.info(`[PATCH /:id] Database update result:`, updatedEventRequest ? 'Success' : 'Not found');
      if (updatedEventRequest) {
        logger.info(`[PATCH /:id] Updated desiredEventDate: ${updatedEventRequest.desiredEventDate}`);
        // DEBUG: Log speakerDetails specifically after save
        logger.info(`[PATCH /:id] SPEAKER DEBUG: After save, speakerDetails = ${JSON.stringify(updatedEventRequest.speakerDetails)}`);
        logger.info(`[PATCH /:id] VAN DRIVER DEBUG: After save, vanDriverNeeded=${updatedEventRequest.vanDriverNeeded}, assignedVanDriverId=${updatedEventRequest.assignedVanDriverId}`);
      }

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Re-geocode if address was provided and either changed or coordinates are missing
      const addressChanged4 = processedUpdates.eventAddress && processedUpdates.eventAddress !== originalEvent.eventAddress;
      const missingCoords4 = processedUpdates.eventAddress && (!updatedEventRequest.latitude || !updatedEventRequest.longitude);
      if (addressChanged4 || missingCoords4) {
        try {
          const coords = await geocodeAddress(processedUpdates.eventAddress);
          if (coords) {
            await storage.updateEventRequest(id, {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            // Update the response object so client gets new coordinates
            updatedEventRequest = { ...updatedEventRequest, latitude: coords.latitude, longitude: coords.longitude } as any;
            logger.info(`✅ Re-geocoded event ${id} via PATCH /:id: ${processedUpdates.eventAddress}`);
          }
        } catch (geocodeError) {
          logger.error(`Failed to geocode event ${id}:`, geocodeError);
        }
      }

      // REMOVED: No longer updating Google Sheets - one-way sync only

      // Enhanced audit logging with detailed field changes
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      // Create meaningful activity log with event details and what changed
      const organizationName = updatedEventRequest.organizationName || `Event #${id}`;
      const contactName = updatedEventRequest.firstName && updatedEventRequest.lastName 
        ? `${updatedEventRequest.firstName} ${updatedEventRequest.lastName}` 
        : 'contact';
      
      // Build human-readable change summary
      const changedFields = Object.keys(processedUpdates).filter(key => 
        key !== 'updatedAt' && processedUpdates[key] !== undefined
      );
      
      const changeDescriptions: string[] = [];
      changedFields.forEach(field => {
        const oldValue = (originalEvent as any)[field];
        const newValue = processedUpdates[field];
        
        // Skip if values are the same
        if (oldValue === newValue) return;
        
        // Create human-readable descriptions for key fields
        if (field === 'status') {
          changeDescriptions.push(`status: ${oldValue} → ${newValue}`);
        } else if (field === 'scheduledEventDate' || field === 'desiredEventDate') {
          const dateStr = newValue ? new Date(newValue).toLocaleDateString('en-US') : 'none';
          changeDescriptions.push(`event date: ${dateStr}`);
        } else if (field === 'estimatedSandwichCount') {
          changeDescriptions.push(`estimated sandwiches: ${newValue}`);
        } else if (field === 'assignedDriverIds' && Array.isArray(newValue)) {
          changeDescriptions.push(`drivers assigned: ${newValue.length}`);
        } else if (field === 'recipientIds' && Array.isArray(newValue)) {
          changeDescriptions.push(`destinations: ${newValue.length}`);
        } else if (field === 'toolkitSent' || field === 'toolkitStatus') {
          changeDescriptions.push('toolkit sent');
        } else {
          // For other fields, just include the field name
          changeDescriptions.push(field.replace(/([A-Z])/g, ' $1').toLowerCase());
        }
      });
      
      const changesSummary = changeDescriptions.length > 0 
        ? changeDescriptions.slice(0, 3).join(', ') + (changeDescriptions.length > 3 ? '...' : '')
        : 'details updated';
      
      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Updated ${organizationName} (${contactName}): ${changesSummary}`
      );

      // CRITICAL: Verify status update before sending response
      logger.info(`[PATCH /:id] Response status: ${updatedEventRequest.status} (original: ${originalEvent.status})`);
      if (processedUpdates.status && updatedEventRequest.status !== processedUpdates.status) {
        logger.error(`[PATCH /:id] ⚠️ STATUS MISMATCH! Expected "${processedUpdates.status}" but response has "${updatedEventRequest.status}"`);
      } else if (processedUpdates.status) {
        logger.info(`[PATCH /:id] ✅ Status update confirmed in response: ${updatedEventRequest.status}`);
      }

      // Attach _droppedFields metadata so the client can warn the user about silent drops.
      // Falsy when empty so it doesn't appear in successful saves.
      const responsePayload: any = { ...updatedEventRequest };
      if (droppedFields.length > 0) {
        responsePayload._droppedFields = droppedFields;
        logger.warn(`[PATCH /:id] Event ${id} saved with ${droppedFields.length} field(s) dropped: ${droppedFields.map((d) => d.field).join(', ')}`);
      }
      res.json(responsePayload);
    } catch (error: unknown) {
      const err = error as Error;
      const pg = parsePgError(error);
      logger.error('Error updating event request:', error);
      logger.error('Error stack:', err?.stack);
      // Log the structured DB detail so the real cause (column/constraint/code)
      // is recoverable from server logs even when the client only sees a
      // friendly message.
      logger.error(
        `[PATCH /:id] DB error detail — code=${pg.code ?? 'n/a'}, column=${pg.column ?? 'n/a'}, constraint=${pg.constraint ?? 'n/a'}`
      );

      // Translate recognized constraint/type errors into specific, actionable
      // 4xx responses instead of a bare "Failed to update event request" 500.
      const classified = classifyDbError(error);
      if (classified) {
        return res.status(classified.status).json({
          message: classified.message,
          error: classified.error,
          column: classified.column,
          // Stable, non-sensitive diagnostics on both the 4xx and 500 paths so
          // the client's error report can identify the field/error class. The
          // raw DB message can name internal schema/constraints, so it's gated
          // to development (same convention as `details` below); the full
          // message is always written to the server logs regardless of env.
          dbCode: pg.code,
          dbColumn: pg.column,
          dbError: process.env.NODE_ENV === 'development' ? pg.message : undefined,
        });
      }

      res.status(500).json({
        message: 'Failed to update event request',
        error: err?.message || 'Unknown error',
        dbCode: pg.code,
        dbColumn: pg.column,
        dbError: process.env.NODE_ENV === 'development' ? pg.message : undefined,
        details: process.env.NODE_ENV === 'development' ? err?.stack : undefined
      });
    }
  }
);

// Update event request (PUT)
router.put(
  '/:id',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;


      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Check permission for removing corporate priority - only Katie and Christine can do this
      if (
        originalEvent.isCorporatePriority === true &&
        updates.isCorporatePriority === false
      ) {
        const userEmail = req.user?.email;
        const allowedEmails = [
          'admin@sandwich.project',
          'katielong2316@gmail.com',
          'katie@thesandwichproject.org',
          'christine@thesandwichproject.org'
        ];
        
        if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
          return res.status(403).json({
            message: 'Only Christine and Katie can remove the corporate priority flag from an event.',
            error: 'Insufficient permissions',
          });
        }
      }

      // Process pickup time fields for data migration
      const pickupProcessedUpdates = processPickupTimeFields(updates, originalEvent);

      // Process ALL date/timestamp fields to ensure they're proper Date objects
      const processedUpdates = { ...pickupProcessedUpdates };

      // Convert timestamp fields that might come as strings to Date objects
      // (shared list — see EVENT_REQUEST_TIMESTAMP_FIELDS at the top of this file)
      const timestampFields = EVENT_REQUEST_TIMESTAMP_FIELDS;

      timestampFields.forEach((field) => {
        if (
          processedUpdates[field] &&
          typeof processedUpdates[field] === 'string'
        ) {
          try {
            const dateString = processedUpdates[field] as string;
            // Use timezone-safe date parsing utility
            // IMPORTANT: Do NOT use 'Z' suffix - it causes dates to shift by one day!
            const dateValue = parseDateOnly(dateString);

            // Check if the date is valid
            if (!dateValue) {
              logger.error(`Invalid date value for field ${field}:`, dateString);
              delete processedUpdates[field]; // Remove invalid date fields
            } else {
              processedUpdates[field] = dateValue;
              logger.info(`Converted ${field} from "${dateString}" to ${dateValue.toISOString()}`);
            }
          } catch (error) {
            logger.error(`Error parsing date for field ${field}:`, error);
            delete processedUpdates[field]; // Remove invalid fields
          }
        } else if (processedUpdates[field] === null || processedUpdates[field] === '') {
          // Allow null or empty string to clear date fields
          processedUpdates[field] = null;
        }
      });

      // Clean up phone field if it contains invalid data
      if (processedUpdates.phone) {
        const phoneStr = String(processedUpdates.phone).trim();

        // Check if phone field contains an Excel serial number (5-6 digits)
        if (/^\d{5,6}$/.test(phoneStr)) {
          processedUpdates.phone = ''; // Clear invalid phone number
        } else if (phoneStr.length > 30) {
          // If phone field is too long, it might contain message text
          processedUpdates.phone = '';
        } else {
          // Clean the phone number - keep only digits and common separators
          processedUpdates.phone = phoneStr.replace(/[^\d\s\-\(\)\+\.]/g, '').trim();
        }
      }

      // Validate message field doesn't contain a phone number
      if (processedUpdates.message) {
        const messageStr = String(processedUpdates.message).trim();

        // Check if message looks like a phone number
        if (/^[\d\s\-\(\)\+\.]{7,20}$/.test(messageStr)) {
          // You might want to swap with phone field if phone is empty
          if (!processedUpdates.phone || processedUpdates.phone === '') {
            processedUpdates.phone = messageStr;
            processedUpdates.message = '';
          }
        }
      }

      // Validate that in_process status is not set for past/current date events
      if (processedUpdates.status === 'in_process') {
        let eventDate = processedUpdates.desiredEventDate;

        // If date wasn't updated, check the existing event's date
        if (!eventDate && originalEvent.desiredEventDate) {
          eventDate = new Date(originalEvent.desiredEventDate);
        }

        if (eventDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          eventDate.setHours(0, 0, 0, 0);

          if (eventDate <= today) {
            return res.status(400).json({
              message:
                'Cannot set in_process status for events with past or current dates',
              error: 'Invalid status for event date',
            });
          }
        }
      }

      // Validate scheduled status transition and required fields
      // Only enforce strict validation when TRANSITIONING TO scheduled status (not when editing existing scheduled events)
      if (
        processedUpdates.status === 'scheduled' &&
        originalEvent.status !== 'scheduled'
      ) {
        // Check required fields for NEW scheduled events
        const requiredFields = {
          // Accept either desiredEventDate or scheduledEventDate as the event date
          eventDate:
            processedUpdates.desiredEventDate || 
            processedUpdates.scheduledEventDate ||
            originalEvent.desiredEventDate ||
            originalEvent.scheduledEventDate,
          eventAddress:
            processedUpdates.eventAddress || originalEvent.eventAddress,
          estimatedSandwichCount:
            processedUpdates.estimatedSandwichCount ||
            originalEvent.estimatedSandwichCount,
        };

        const missingFields = [];
        if (!requiredFields.eventDate) {
          missingFields.push('Event Date (desiredEventDate or scheduledEventDate)');
        }
        // Make Event Address and Estimated Sandwich Count optional for basic scheduled status
        // They can be filled in later during the workflow

        if (missingFields.length > 0) {
          return res.status(400).json({
            message: `Cannot mark event as scheduled. Missing required field: ${missingFields.join(
              ', '
            )}. Please set an event date (desiredEventDate or scheduledEventDate) before scheduling.`,
            error: 'Missing required scheduling data',
            missingFields,
            hint: 'Events must have a date (desiredEventDate or scheduledEventDate) to be scheduled. The Eagle Project event is missing this field.',
          });
        }
      } else if (processedUpdates.status === 'scheduled') {
      }

      // Ensure boolean fields are properly typed (for ALL updates)
      // NOTE: volunteersNeeded, driversNeeded, speakersNeeded are NUMBER fields, not booleans
      const booleanFields = [
        'hasRefrigeration',
        'vanDriverNeeded',
        'isDhlVan',
        'isConfirmed',
        'addedToOfficialSheet',
        'selfTransport',
        'toolkitSent',
      ];
      booleanFields.forEach((field) => {
        if (processedUpdates[field] !== undefined) {
          const originalValue = processedUpdates[field];
          const convertedValue =
            processedUpdates[field] === true ||
            processedUpdates[field] === 'true';
          processedUpdates[field] = convertedValue;
          logger.info(`[PUT] Boolean field ${field}: ${JSON.stringify(originalValue)} (${typeof originalValue}) → ${convertedValue}`);
        }
      });

      // Ensure numeric fields are properly typed
      const numericFields = ['volunteersNeeded', 'driversNeeded', 'speakersNeeded', 'estimatedSandwichCount'];
      numericFields.forEach((field) => {
        if (processedUpdates[field] !== undefined && processedUpdates[field] !== null) {
          const originalValue = processedUpdates[field];
          const parsedValue = parseInt(String(originalValue), 10);
          processedUpdates[field] = isNaN(parsedValue) ? null : parsedValue;
          logger.info(`[PUT] Numeric field ${field}: ${JSON.stringify(originalValue)} (${typeof originalValue}) → ${processedUpdates[field]}`);
        }
      });

      const vanNorm = applyVanPurposeNormalization(processedUpdates);
      if (vanNorm.error) {
        return res.status(400).json({ message: vanNorm.error, field: 'vanNeededFor' });
      }

      // Process comprehensive scheduling data if status is scheduled
      if (processedUpdates.status === 'scheduled') {

        // Process sandwich types if provided
        if (processedUpdates.sandwichTypes) {
          if (typeof processedUpdates.sandwichTypes === 'string') {
            const parseResult = safeJsonParse(
              processedUpdates.sandwichTypes,
              [],  // Default to empty array
              'sandwichTypes field'
            );

            if (!parseResult.success) {
              logger.error('Failed to parse sandwichTypes', {
                error: parseResult.error,
                value: processedUpdates.sandwichTypes.substring(0, 100)
              });
              return res.status(400).json({
                error: 'Invalid sandwichTypes: must be valid JSON array.'
              });
            }

            processedUpdates.sandwichTypes = parseResult.data;
          }
        }

        // Log sandwich count for debugging

        // Ensure numeric fields are properly typed
        const numericFields = [
          'driversNeeded',
          'speakersNeeded',
          'estimatedSandwichCount',
          'estimatedSandwichCountMin',
          'estimatedSandwichCountMax',
        ];
        numericFields.forEach((field) => {
          if (processedUpdates[field] !== undefined && processedUpdates[field] !== null) {
            processedUpdates[field] = parseInt(processedUpdates[field]) || 0;
          }
        });

      }

      // Check if status is changing and set statusChangedAt accordingly
      if (
        processedUpdates.status &&
        processedUpdates.status !== originalEvent.status
      ) {
        processedUpdates.statusChangedAt = new Date();

        const toStatus = processedUpdates.status as EventStatus;

        // Keep PUT behavior aligned with PATCH: when an event becomes scheduled
        // or rescheduled, the date is considered confirmed unless explicitly
        // overridden in the same request.
        if (toStatus === 'scheduled' || toStatus === 'rescheduled') {
          if (processedUpdates.isConfirmed === undefined) {
            processedUpdates.isConfirmed = true;
          }
          if (processedUpdates.showOnVolunteerHub === undefined && !originalEvent.showOnVolunteerHub) {
            processedUpdates.showOnVolunteerHub = true;
          }
        }

        // Keep PUT behavior aligned with PATCH: stamp when the event entered
        // standby (drives the "since ..." badge and per-episode reminder dedup).
        if (toStatus === 'standby') {
          processedUpdates.standbyMarkedAt = new Date();
        }
      }

      // Track who marked the event as unresponsive
      if (processedUpdates.isUnresponsive && !originalEvent.isUnresponsive) {
        processedUpdates.markedUnresponsiveAt = new Date();
        processedUpdates.markedUnresponsiveBy = req.user?.id || null;
      }

      // Validate and auto-adjust "needed" fields to prevent impossible states (PUT endpoint)
      // driversNeeded tracks REGULAR drivers only — van driver is a separate concept
      const putAssignedRegularDrivers = processedUpdates.assignedDriverIds !== undefined
        ? (Array.isArray(processedUpdates.assignedDriverIds) ? processedUpdates.assignedDriverIds.length : 0)
        : (Array.isArray(originalEvent.assignedDriverIds) ? originalEvent.assignedDriverIds.length : 0);

      // If driversNeeded is being manually updated, ensure it's not less than assigned regular drivers
      if (processedUpdates.driversNeeded !== undefined) {
        if (processedUpdates.driversNeeded < putAssignedRegularDrivers) {
          processedUpdates.driversNeeded = putAssignedRegularDrivers;
        }
      }

      // Auto-adjust driversNeeded when regular driver assignments change
      if (processedUpdates.assignedDriverIds !== undefined) {
        const currentDriversNeeded = processedUpdates.driversNeeded !== undefined ? processedUpdates.driversNeeded : (originalEvent.driversNeeded || 0);

        if (putAssignedRegularDrivers > currentDriversNeeded) {
          processedUpdates.driversNeeded = putAssignedRegularDrivers;
        }
      }

      // If speakersNeeded is being manually updated, ensure it's not less than assigned speakers
      if (processedUpdates.speakersNeeded !== undefined && processedUpdates.speakerDetails === undefined) {
        const assignedSpeakerCount = (typeof originalEvent.speakerDetails === 'object' && originalEvent.speakerDetails !== null)
          ? Object.keys(originalEvent.speakerDetails).length
          : 0;
        if (processedUpdates.speakersNeeded < assignedSpeakerCount) {
          processedUpdates.speakersNeeded = assignedSpeakerCount;
        }
      }

      if (processedUpdates.speakerDetails !== undefined) {
        const assignedSpeakerCount = (typeof processedUpdates.speakerDetails === 'object' && processedUpdates.speakerDetails !== null)
          ? Object.keys(processedUpdates.speakerDetails).length
          : 0;
        const currentSpeakersNeeded = originalEvent.speakersNeeded || 0;

        if (assignedSpeakerCount > currentSpeakersNeeded) {
          processedUpdates.speakersNeeded = assignedSpeakerCount;
        }
      }

      // If volunteersNeeded is being manually updated, ensure it's not less than assigned volunteers
      if (processedUpdates.volunteersNeeded !== undefined && processedUpdates.assignedVolunteerIds === undefined) {
        const assignedVolunteerCount = Array.isArray(originalEvent.assignedVolunteerIds)
          ? originalEvent.assignedVolunteerIds.length
          : 0;
        if (processedUpdates.volunteersNeeded < assignedVolunteerCount) {
          processedUpdates.volunteersNeeded = assignedVolunteerCount;
        }
      }

      if (processedUpdates.assignedVolunteerIds !== undefined) {
        const assignedVolunteerCount = Array.isArray(processedUpdates.assignedVolunteerIds)
          ? processedUpdates.assignedVolunteerIds.length
          : 0;
        const currentVolunteersNeeded = originalEvent.volunteersNeeded || 0;

        if (assignedVolunteerCount > currentVolunteersNeeded) {
          processedUpdates.volunteersNeeded = assignedVolunteerCount;
        }
      }

      // Same jsonb normalization as the main PATCH path.
      normalizeSandwichTypeColumns(processedUpdates);

      // Always update the updatedAt timestamp
      let updatedEventRequest = await storage.updateEventRequest(id, {
        ...processedUpdates,
        updatedAt: new Date(),
      });

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Re-geocode if address was provided and either changed or coordinates are missing
      const addressChanged3 = processedUpdates.eventAddress && processedUpdates.eventAddress !== originalEvent.eventAddress;
      const missingCoords3 = processedUpdates.eventAddress && (!updatedEventRequest.latitude || !updatedEventRequest.longitude);
      if (addressChanged3 || missingCoords3) {
        try {
          const coords = await geocodeAddress(processedUpdates.eventAddress);
          if (coords) {
            await storage.updateEventRequest(id, {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            updatedEventRequest = { ...updatedEventRequest, latitude: coords.latitude, longitude: coords.longitude } as any;
            logger.log(`✅ Geocoded event ${id}: ${processedUpdates.eventAddress}`);
          } else {
            logger.warn(`⚠️ Geocoding returned no results for event ${id}: ${processedUpdates.eventAddress}`);
          }
        } catch (error) {
          logger.error(`Failed to geocode event ${id}:`, error);
        }
      }

      // Determine action type based on changes
      let actionType = 'EVENT_REQUEST_UPDATED';
      let actionContext: Record<string, unknown> = {
        organizationName: originalEvent.organizationName,
        contactName: `${originalEvent.firstName} ${originalEvent.lastName}`,
        fieldsUpdated: Object.keys(processedUpdates),
      };

      // Check for specific status changes with enhanced context
      if (originalEvent.status !== updatedEventRequest.status) {
        actionType = 'STATUS_CHANGED';
        actionContext.statusChange = `${originalEvent.status} → ${updatedEventRequest.status}`;

        // Add comprehensive context for scheduled status
        if (updatedEventRequest.status === 'scheduled') {
          actionType = 'EVENT_SCHEDULED';
          actionContext = {
            ...actionContext,
            eventDate: updatedEventRequest.desiredEventDate,
            eventAddress: updatedEventRequest.eventAddress,
            estimatedSandwichCount: updatedEventRequest.estimatedSandwichCount,
            eventStartTime: updatedEventRequest.eventStartTime,
            eventEndTime: updatedEventRequest.eventEndTime,
            pickupTime: updatedEventRequest.pickupTime,
            driversNeeded: updatedEventRequest.driversNeeded || 0,
            speakersNeeded: updatedEventRequest.speakersNeeded || 0,
            volunteersNeeded: updatedEventRequest.volunteersNeeded || false,
            hasRefrigeration: updatedEventRequest.hasRefrigeration,
            deliveryDestination: updatedEventRequest.deliveryDestination,
            tspContact: updatedEventRequest.tspContact,
            additionalTspContacts: updatedEventRequest.additionalTspContacts,
            sandwichTypes: updatedEventRequest.sandwichTypes,
            toolkitStatus: updatedEventRequest.toolkitStatus,
            communicationMethod: updatedEventRequest.communicationMethod,
            scheduledBy:
              req.user?.email || 'Unknown User',
            scheduledAt: new Date().toISOString(),
            comprehensiveDataProcessed: true,
          };
        }

        // Add contact log entry when moved to in_process (toolkit sent)
        if (updatedEventRequest.status === 'in_process' && originalEvent.status !== 'in_process') {
          const existingLog = Array.isArray(updatedEventRequest.contactAttemptsLog)
            ? updatedEventRequest.contactAttemptsLog
            : [];
          const nextAttemptNumber = existingLog.length > 0
            ? Math.max(...existingLog.map((a: any) => a.attemptNumber || 0)) + 1
            : 1;

          const toolkitDate = updatedEventRequest.toolkitSentDate || new Date();
          const toolkitLogEntry = {
            attemptNumber: nextAttemptNumber,
            timestamp: toolkitDate.toISOString(),
            method: 'email',
            outcome: 'Toolkit Sent',
            notes: `Event moved to In Process${updatedEventRequest.toolkitSent ? ' - Toolkit sent' : ''}`,
            createdBy: req.user?.id || 'system',
            createdByName: req.user?.firstName && req.user?.lastName
              ? `${req.user.firstName} ${req.user.lastName}`
              : req.user?.email || 'System',
          };

          await storage.updateEventRequest(id, {
            contactAttemptsLog: [...existingLog, toolkitLogEntry],
            lastContactAttempt: new Date(),
          });
        }
      }

      // Check for unresponsive marking
      if (updates.isUnresponsive && !originalEvent.isUnresponsive) {
        actionType = 'MARKED_UNRESPONSIVE';
        actionContext.unresponsiveReason = updates.unresponsiveReason;
        actionContext.contactMethod = updates.contactMethod;
      }

      // Enhanced audit logging with detailed field changes
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      // Create in-app notifications for status changes (for admins)
      if (originalEvent.status !== updatedEventRequest.status) {
        const userName = req.user?.firstName && req.user?.lastName
          ? `${req.user.firstName} ${req.user.lastName}`
          : req.user?.email || 'Someone';
        
        // Get admin users to notify (users with EVENT_REQUESTS_VIEW permission)
        try {
          const adminUsers = await db.select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.isActive, true),
                or(
                  eq(users.role, 'admin'),
                  eq(users.role, 'superadmin'),
                  sql`${users.permissions}::text LIKE '%EVENT_REQUESTS_VIEW%'`
                )
              )
            );
          
          // Don't notify the user who made the change
          const usersToNotify = adminUsers.filter(u => u.id.toString() !== req.user?.id?.toString());
          
          for (const adminUser of usersToNotify) {
            await storage.createNotification({
              userId: adminUser.id.toString(),
              type: 'event_status_change',
              priority: 'medium',
              title: `Event Status Changed`,
              message: `${userName} moved "${updatedEventRequest.organizationName}" from ${originalEvent.status} to ${updatedEventRequest.status}`,
              category: 'events',
              isRead: false,
              isArchived: false,
              metadata: {
                eventId: updatedEventRequest.id,
                organizationName: updatedEventRequest.organizationName,
                oldStatus: originalEvent.status,
                newStatus: updatedEventRequest.status,
                changedBy: req.user?.id,
                changedByName: userName,
              },
            });
          }
        } catch (notifyError) {
          logger.error('Failed to create status change notifications:', notifyError);
        }
      }

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Updated event request: ${id}`
      );
      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error updating event request', error);
      res.status(500).json({
        message: 'Failed to update event request',
        error: error instanceof Error ? error.message : String(error),
        details: 'Check server logs for full error details',
      });
    }
  }
);

// Delete event request
router.delete(
  '/:id',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_DELETE_CARD'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Get original data for audit logging before deletion
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      const deleted = await storage.deleteEventRequest(id, req.user?.id);

      if (!deleted) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Enhanced audit logging for deletion
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        null,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        },
        { actionType: 'DELETE' }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_DELETE_CARD',
        `Deleted event request: ${id}`
      );
      res.json({ message: 'Event request deleted successfully' });
    } catch (error) {
      logger.error('Error deleting event request:', error);
      res.status(500).json({ message: 'Failed to delete event request' });
    }
  }
);

// Restore (undo delete) event request
router.post(
  '/:id/restore',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_DELETE_CARD'), // Same permission as delete
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const restored = await storage.restoreEventRequest(id);

      if (!restored) {
        return res.status(404).json({ message: 'Event request not found or not deleted' });
      }

      // Get the restored event for audit logging
      const restoredEvent = await storage.getEventRequestById(id);

      // Log the restoration
      if (restoredEvent) {
        await AuditLogger.logEventRequestChange(
          id.toString(),
          null,
          restoredEvent,
          {
            userId: req.user?.id,
            ipAddress: req.ip || req.connection?.remoteAddress,
            userAgent: req.get('User-Agent'),
            sessionId: req.session?.id || req.sessionID,
          },
          { actionType: 'RESTORE' }
        );
      }

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_RESTORE',
        `Restored event request: ${id}`
      );

      res.json({ message: 'Event request restored successfully', eventRequest: restoredEvent });
    } catch (error) {
      logger.error('Error restoring event request:', error);
      res.status(500).json({ message: 'Failed to restore event request' });
    }
  }
);

// Organization Routes - MOVED to ./event-requests/organizations.ts
// Routes moved: POST /check-duplicates, GET /organizations/all, POST /organizations

// Google Sheets Sync Routes - MOVED to ./event-requests/sync.ts
// Routes moved: GET /debug/auth, POST /sync/to-sheets, POST /sync/from-sheets,
//               GET /sync/status, GET /sync/analyze, GET /sync/find-missing
// NOTE: The import endpoint (/import-from-sheets) STAYS in this file - it's critical!

// Get organizations catalog - aggregated data from event requests
router.get('/orgs-catalog-test', async (req, res) => {
  try {
    const user = req.user;

    // TEMP: Completely bypass auth for testing

    // Get all event requests and aggregate by organization and contact
    const allEventRequests = await storage.getAllEventRequests();

    // Create a map to aggregate organizations and contacts
    const organizationMap = new Map<string, any>();

    allEventRequests.forEach((request) => {
      const key = `${request.organizationName}-${request.email}`;

      if (organizationMap.has(key)) {
        const existing = organizationMap.get(key);
        existing.totalRequests += 1;

        // Update to latest request date if this one is newer
        if (
          new Date(request.createdAt) > new Date(existing.latestRequestDate)
        ) {
          existing.latestRequestDate = request.createdAt;
          existing.status = request.status;
        }

        // If any request has been contacted, update status
        if (request.contactedAt && existing.status === 'new') {
          existing.status = 'contacted';
        }
      } else {
        organizationMap.set(key, {
          organizationName: request.organizationName,
          firstName: request.firstName,
          lastName: request.lastName,
          email: request.email,
          phone: request.phone,
          department: request.department,
          latestRequestDate: request.createdAt,
          totalRequests: 1,
          status: request.contactedAt ? 'contacted' : request.status,
        });
      }
    });

    // Convert map to array
    const organizations = Array.from(organizationMap.values());

    logActivity(
      req,
      res,
      PERMISSIONS.ORGANIZATIONS_VIEW,
      `Retrieved organizations catalog: ${organizations.length} organizations`
    );
    res.json(organizations);
  } catch (error) {
    logger.error('Error fetching organizations catalog:', error);
    res.status(500).json({ message: 'Failed to fetch organizations catalog' });
  }
});

// Mark follow-up as completed for an event
router.patch(
  '/:id/follow-up',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { followUpType, notes } = req.body;

      if (!followUpType || !['one_day', 'one_month'].includes(followUpType)) {
        return res.status(400).json({
          error: "Invalid follow-up type. Must be 'one_day' or 'one_month'",
        });
      }

      const userId = req.user?.id;
      if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
      }

      const eventRequest = await storage.getEventRequest(id);
      if (!eventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Prepare update data based on follow-up type
      const updateData: Partial<EventRequest> = {
        followUpNotes: notes || eventRequest.followUpNotes,
      };

      if (followUpType === 'one_day') {
        updateData.followUpOneDayCompleted = true;
        updateData.followUpOneDayDate = new Date();
      } else if (followUpType === 'one_month') {
        updateData.followUpOneMonthCompleted = true;
        updateData.followUpOneMonthDate = new Date();
      }

      const updatedEventRequest = await storage.updateEventRequest(
        id,
        updateData
      );

      // Enhanced audit logging for follow-up completion with specific context
      await AuditLogger.logEventRequestChange(
        id.toString(),
        eventRequest,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        },
        {
          followUpMethod: followUpType === 'one_day' ? 'one_day_follow_up' : 'one_month_follow_up',
          followUpAction: `${followUpType}_follow_up_completed`,
          notes: notes || `${followUpType} follow-up marked as completed`,
          actionType: 'FOLLOW_UP_COMPLETED',
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Marked ${followUpType} follow-up as completed for event: ${eventRequest.organizationName}`
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error marking follow-up as completed:', error);
      res.status(500).json({ error: 'Failed to mark follow-up as completed' });
    }
  }
);

// Duplicate route removed - organization-counts already exists at line 376

// Update driver assignments for an event
router.patch('/:id/drivers', isAuthenticated, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const {
      assignedDriverIds,
      tentativeDriverIds,
      driverPickupTime,
      driverNotes,
      driversArranged,
      // Van driver fields
      vanDriverNeeded,
      assignedVanDriverId,
      customVanDriverName,
      vanDriverNotes,
      isDhlVan,
    } = req.body;

    // Validate that the event exists first
    const existingEvent = await storage.getEventRequestById(eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event request not found' });
    }

    // Update the event with driver assignments
    const updateData: Partial<EventRequest> = {
      assignedDriverIds: assignedDriverIds || [],
      tentativeDriverIds: tentativeDriverIds !== undefined ? (tentativeDriverIds || []) : undefined,
      driverPickupTime: driverPickupTime || null,
      driverNotes: driverNotes || null,
      driversArranged:
        driversArranged !== undefined
          ? driversArranged
          : assignedDriverIds && assignedDriverIds.length > 0,
    };

    // Sync driverDetails JSONB with assignedDriverIds array (driverDetails is source of truth)
    if (assignedDriverIds !== undefined) {
      const existingDriverDetails = (existingEvent.driverDetails || {}) as Record<string, any>;
      const newDriverDetails: Record<string, any> = {};
      (assignedDriverIds || []).forEach((driverId: string) => {
        // Preserve existing details for this driver, or create empty object
        newDriverDetails[driverId] = existingDriverDetails[driverId] || {};
      });
      updateData.driverDetails = newDriverDetails;
    }

    // Only include tentativeDriverIds if it was actually provided in the request
    if (tentativeDriverIds === undefined) {
      delete updateData.tentativeDriverIds;
    }

    // Add van driver fields if provided
    if (vanDriverNeeded !== undefined)
      updateData.vanDriverNeeded = vanDriverNeeded;
    if (assignedVanDriverId !== undefined)
      updateData.assignedVanDriverId = assignedVanDriverId;
    if (customVanDriverName !== undefined)
      updateData.customVanDriverName = customVanDriverName;
    if (vanDriverNotes !== undefined)
      updateData.vanDriverNotes = vanDriverNotes;
    if (isDhlVan !== undefined)
      updateData.isDhlVan = !!isDhlVan;
    if (vanDriverNeeded === false) {
      updateData.isDhlVan = false;
      updateData.vanNeededFor = null;
      if (assignedVanDriverId === undefined) {
        updateData.assignedVanDriverId = null;
      }
    }

    // Validate and auto-adjust driversNeeded based on assignments
    const regularDriverCount = Array.isArray(assignedDriverIds) ? assignedDriverIds.length : 0;
    
    // Check if van driver is assigned (either being set now or already exists)
    const dhlVan =
      isDhlVan !== undefined ? !!isDhlVan : (existingEvent as any).isDhlVan === true;
    const hasVanDriver = dhlVan ||
      (assignedVanDriverId !== undefined && assignedVanDriverId !== null && assignedVanDriverId !== '')
      || (assignedVanDriverId === undefined && existingEvent.assignedVanDriverId !== null && existingEvent.assignedVanDriverId !== '');
    
    const totalDriverCount = regularDriverCount + (hasVanDriver ? 1 : 0);
    const currentDriversNeeded = existingEvent.driversNeeded || 0;
    
    // Ensure driversNeeded is at least equal to total assigned drivers (prevent impossible states)
    if (totalDriverCount > currentDriversNeeded) {
      updateData.driversNeeded = totalDriverCount;
    }

    const updatedEvent = await storage.updateEventRequest(eventId, updateData);


    // Enhanced audit logging for driver assignment updates
    await AuditLogger.logEventRequestChange(
      eventId.toString(),
      existingEvent,
      updatedEvent,
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.session?.id || req.sessionID,
      }
    );

    // Log activity
    await logActivity(
      req,
      res,
      'update_event_drivers',
      `Updated driver assignments for event: ${existingEvent.organizationName}`
    );

    res.json(updatedEvent);
  } catch (error) {
    logger.error('Error updating driver assignments:', error);
    res.status(500).json({ error: 'Failed to update driver assignments' });
  }
});

// Pre-event Flags Routes - MOVED to ./event-requests/flags.ts
// Routes moved: POST /:id/flags, PATCH /:id/flags/:flagId/resolve, DELETE /:id/flags/:flagId

// Event Volunteers Routes - MOVED to ./event-requests/volunteers.ts
// Routes moved: GET /:eventId/volunteers, POST /:eventId/volunteers,
//               PATCH /volunteers/:volunteerId, DELETE /volunteers/:volunteerId,
//               GET /all-volunteers, GET /my-volunteers

// Mark toolkit as sent for an event request
router.patch(
  '/:id/toolkit-sent',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { toolkitSentDate, contactAttempt } = req.body;


      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Parse the toolkit sent date
      const sentDate = toolkitSentDate ? new Date(toolkitSentDate) : new Date();

      const updates: Partial<EventRequest> = {
        toolkitSent: true,
        toolkitSentDate: sentDate,
        toolkitStatus: 'sent',
        toolkitSentBy: req.user?.id, // Record who sent the toolkit
        status: 'in_process', // Move to in_process when toolkit is sent
        updatedAt: new Date(),
      };

      // Automatically assign the current user as TSP contact if not already assigned
      // This auto-assignment happens silently (no email) since toolkit sending happens later in workflow
      if (!originalEvent.tspContact && req.user?.id) {
        updates.tspContact = req.user.id;
        updates.tspContactAssignedDate = new Date();
      }

      const updatedEventRequest = await storage.updateEventRequest(id, updates);

      if (!updatedEventRequest) {
        return res.status(404).json({ message: 'Event request not found' });
      }

      // Add contact attempt log entry for toolkit sent
      const existingLog = Array.isArray(updatedEventRequest.contactAttemptsLog)
        ? updatedEventRequest.contactAttemptsLog
        : [];
      const nextAttemptNumber = existingLog.length > 0
        ? Math.max(...existingLog.map((a: any) => a.attemptNumber || 0)) + 1
        : 1;

      // Use custom contact attempt data if provided (for phone + toolkit combo)
      // Otherwise default to email-only toolkit sent entry
      const toolkitLogEntry = {
        attemptNumber: nextAttemptNumber,
        timestamp: sentDate.toISOString(),
        method: contactAttempt?.method || 'email',
        outcome: contactAttempt?.outcome || 'toolkit_sent',
        notes: contactAttempt?.notes || `Toolkit sent and event moved to In Process`,
        createdBy: req.user?.id || 'system',
        createdByName: req.user?.firstName && req.user?.lastName
          ? `${req.user.firstName} ${req.user.lastName}`
          : req.user?.email || 'System',
      };

      await storage.updateEventRequest(id, {
        contactAttemptsLog: [...existingLog, toolkitLogEntry],
        lastContactAttempt: sentDate,
        contactAttempts: nextAttemptNumber, // Update contact attempts count
      });

      // REMOVED: No longer updating Google Sheets - one-way sync only

      // Enhanced audit logging for toolkit sent action
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_TOOLKIT_SENT',
        `Marked toolkit as sent for event request: ${id}`
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error marking toolkit as sent:', error);
      res.status(500).json({ message: 'Failed to mark toolkit as sent' });
    }
  }
);

// Update social media post tracking for an event
router.patch(
  '/:id/social-media',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { 
        socialMediaPostRequested, 
        socialMediaPostCompleted, 
        socialMediaPostNotes,
        socialMediaPostLink,
        socialMediaPostRequestedDate,
        socialMediaPostCompletedDate,
        notes  // Legacy field name
      } = req.body;

      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid event ID required' });
      }

      const updates: Partial<EventRequest> = {};

      if (socialMediaPostRequested !== undefined) {
        updates.socialMediaPostRequested = socialMediaPostRequested;
        // Auto-set date if setting to true and no explicit date provided
        if (socialMediaPostRequested && !socialMediaPostRequestedDate) {
          updates.socialMediaPostRequestedDate = new Date();
        } else if (!socialMediaPostRequested) {
          updates.socialMediaPostRequestedDate = null;
        }
      }

      // Allow explicit date override
      if (socialMediaPostRequestedDate !== undefined) {
        updates.socialMediaPostRequestedDate = socialMediaPostRequestedDate 
          ? new Date(socialMediaPostRequestedDate) 
          : null;
      }

      if (socialMediaPostCompleted !== undefined) {
        updates.socialMediaPostCompleted = socialMediaPostCompleted;
        // Auto-set date if setting to true and no explicit date provided
        if (socialMediaPostCompleted && !socialMediaPostCompletedDate) {
          updates.socialMediaPostCompletedDate = new Date();
        } else if (!socialMediaPostCompleted) {
          updates.socialMediaPostCompletedDate = null;
        }
      }

      // Allow explicit date override
      if (socialMediaPostCompletedDate !== undefined) {
        updates.socialMediaPostCompletedDate = socialMediaPostCompletedDate 
          ? new Date(socialMediaPostCompletedDate) 
          : null;
      }

      // Handle notes (support both field names)
      if (socialMediaPostNotes !== undefined) {
        updates.socialMediaPostNotes = socialMediaPostNotes;
      } else if (notes !== undefined) {
        updates.socialMediaPostNotes = notes;
      }

      // Handle post link
      if (socialMediaPostLink !== undefined) {
        updates.socialMediaPostLink = socialMediaPostLink;
      }

      logger.info(`[PATCH /:id/social-media] Updating event ${id} with:`, updates);

      const updatedEventRequest = await storage.updateEventRequest(id, updates);

      if (!updatedEventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Enhanced audit logging for social media tracking
      const originalEvent = await storage.getEventRequestById(id);
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Updated social media tracking for event: ${id}`
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error updating social media tracking:', error);
      res.status(500).json({ error: 'Failed to update social media tracking' });
    }
  }
);

// Record actual sandwich count for a completed event
router.patch(
  '/:id/actual-sandwich-count',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { actualSandwichCount, actualSandwichTypes } = req.body;

      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid event ID required' });
      }

      if (!actualSandwichCount || actualSandwichCount <= 0) {
        return res.status(400).json({ error: 'Valid sandwich count required' });
      }

      const updates = {
        actualSandwichCount,
        actualSandwichTypes: actualSandwichTypes || null,
        actualSandwichCountRecordedDate: new Date(),
        actualSandwichCountRecordedBy: req.user?.id,
      };

      const updatedEventRequest = await storage.updateEventRequest(id, updates);

      if (!updatedEventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Enhanced audit logging for actual sandwich count
      const originalEvent = await storage.getEventRequestById(id);
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Recorded actual sandwich count (${actualSandwichCount}) for event: ${id}`
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error recording actual sandwich count:', error);
      res.status(500).json({ error: 'Failed to record actual sandwich count' });
    }
  }
);

// Record sandwich distribution for a completed event
router.patch(
  '/:id/distribution',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_EDIT'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { sandwichDistributions, distributionNotes } = req.body;

      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid event ID required' });
      }

      if (
        !sandwichDistributions ||
        !Array.isArray(sandwichDistributions) ||
        sandwichDistributions.length === 0
      ) {
        return res
          .status(400)
          .json({ error: 'Valid distribution data required' });
      }

      // Validate distribution format
      for (const dist of sandwichDistributions) {
        if (!dist.destination || !dist.totalCount || dist.totalCount <= 0) {
          return res.status(400).json({
            error: 'Each distribution must have a destination and valid count',
          });
        }
      }

      const updates = {
        sandwichDistributions,
        distributionNotes: distributionNotes || null,
        distributionRecordedDate: new Date(),
        distributionRecordedBy: req.user?.id,
      };

      const updatedEventRequest = await storage.updateEventRequest(id, updates);

      if (!updatedEventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      const totalDistributed = sandwichDistributions.reduce(
        (sum, dist) => sum + dist.totalCount,
        0
      );

      // Enhanced audit logging for sandwich distribution
      const originalEvent = await storage.getEventRequestById(id);
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Recorded sandwich distribution (${totalDistributed} sandwiches to ${sandwichDistributions.length} locations) for event: ${id}`
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error recording sandwich distribution:', error);
      res.status(500).json({ error: 'Failed to record sandwich distribution' });
    }
  }
);

// Record actual sandwich counts for scheduled events
router.patch(
  '/:id/actual-sandwiches',
  isAuthenticated,
  requirePermission(PERMISSIONS.EVENT_REQUESTS_EDIT),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const {
        actualSandwichCount,
        actualSandwichCountRecordedDate,
        actualSandwichCountRecordedBy,
        distributionNotes,
      } = req.body;

      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Valid event ID required' });
      }

      // Create validation schema for the payload
      const actualSandwichDataSchema = z.object({
        actualSandwichCount: z.coerce
          .number()
          .min(1, 'Actual sandwich count must be greater than 0'),
        actualSandwichCountRecordedDate: z.string().optional(),
        actualSandwichCountRecordedBy: z.string().optional(),
        distributionNotes: z.string().optional(),
      });

      const validatedData = actualSandwichDataSchema.parse(req.body);

      // Get original data for audit logging
      const originalEvent = await storage.getEventRequestById(id);
      if (!originalEvent) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Prepare updates object
      const updates = {
        actualSandwichCount: validatedData.actualSandwichCount,
        distributionNotes: validatedData.distributionNotes || null,
        // Handle recorded date - use provided date or current timestamp
        actualSandwichCountRecordedDate:
          validatedData.actualSandwichCountRecordedDate
            ? new Date(validatedData.actualSandwichCountRecordedDate)
            : new Date(),
        // Handle recorded by - use provided user or current user
        actualSandwichCountRecordedBy:
          validatedData.actualSandwichCountRecordedBy || req.user?.id,
        updatedAt: new Date(),
      };

      const updatedEventRequest = await storage.updateEventRequest(id, updates);

      if (!updatedEventRequest) {
        return res.status(404).json({ error: 'Event request not found' });
      }

      // Enhanced audit logging for this operation
      await AuditLogger.logEventRequestChange(
        id.toString(),
        originalEvent,
        updatedEventRequest,
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('User-Agent'),
          sessionId: req.session?.id || req.sessionID,
        }
      );

      await logActivity(
        req,
        res,
        'EVENT_REQUESTS_EDIT',
        `Recorded actual sandwich count (${validatedData.actualSandwichCount}) and distribution notes for event: ${id}`,
        {
          eventId: id,
          actualSandwichCount: validatedData.actualSandwichCount,
          hasDistributionNotes: !!validatedData.distributionNotes,
          recordedBy: updates.actualSandwichCountRecordedBy,
        }
      );

      res.json(updatedEventRequest);
    } catch (error) {
      logger.error('Error recording actual sandwich data:', error);

      // Handle validation errors specifically
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      res.status(500).json({ error: 'Failed to record actual sandwich data' });
    }
  }
);

// Update TSP contact assignment for event requests
router.patch('/:id/tsp-contact', isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { tspContact } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    // Check permissions - only admin@sandwich.project, katielong2316@gmail.com, and christine@thesandwichproject.org
    const userEmail = req.user?.email;
    const allowedEmails = [
      'admin@sandwich.project',
      'katielong2316@gmail.com',
      'christine@thesandwichproject.org'
    ];

    if (!userEmail || !allowedEmails.includes(userEmail)) {
      return res.status(403).json({
        error:
          'Insufficient permissions. Only Christine and Katie can assign TSP contacts.',
      });
    }

    // Create validation schema for the payload
    const tspContactSchema = z.object({
      tspContact: z.string().optional().nullable(),
      customTspContact: z.string().optional().nullable(),
    });

    const validatedData = tspContactSchema.parse(req.body);

    // Get original data for audit logging
    const originalEvent = await storage.getEventRequestById(id);
    if (!originalEvent) {
      return res.status(404).json({ error: 'Event request not found' });
    }

    // Prepare updates object
    const updates: Partial<EventRequest> = {
      tspContact: validatedData.tspContact || null,
      customTspContact: validatedData.customTspContact || null,
      updatedAt: new Date(),
    };

    // If assigning a TSP contact (user or custom text, not removing), set the assignment date
    if (validatedData.tspContact || validatedData.customTspContact) {
      updates.tspContactAssignedDate = new Date();
    } else {
      // If removing TSP contact, clear the assignment date
      updates.tspContactAssignedDate = null;
    }

    await storage.updateEventRequest(id, updates);

    // Fetch the updated record to ensure we get the latest data from the database
    // This avoids issues with .returning() on Neon serverless sometimes returning undefined
    const updatedEventRequest = await storage.getEventRequestById(id);

    if (!updatedEventRequest) {
      return res.status(404).json({ error: 'Event request not found after update' });
    }

    // Send tiered notification for TSP contact assignment:
    // URGENT tier: SMS-first, email fallback if no SMS opt-in
    // This reduces notification fatigue by not sending both email AND SMS
    if (
      validatedData.tspContact &&
      originalEvent.tspContact !== validatedData.tspContact &&
      originalEvent.status !== 'completed' &&
      originalEvent.status !== 'declined'
    ) {
      try {
        // Use the new tiered notification dispatcher (SMS-first, email fallback)
        const { sendTspAssignmentNotification } = await import('../services/event-notification-dispatcher');
        await sendTspAssignmentNotification(
          validatedData.tspContact!,
          id,
          originalEvent.organizationName || 'Unknown Organization',
          getEffectiveEventDate(originalEvent),
          originalEvent.isCorporatePriority || false
        );
        logger.log(`✅ TSP contact assignment notification sent (tiered) for event ${id}`);
      } catch (error) {
        // Log error but don't fail the request if notification fails
        logger.error('Failed to send TSP contact assignment notification:', error);
      }

      // Initialize corporate follow-up protocol if this is a corporate priority event
      // BUT only for events that are not yet scheduled (new/in_progress) - scheduled/completed events don't need "call now" alerts
      const statusesNeedingCallNotification = ['new', 'in_progress'];
      if (originalEvent.isCorporatePriority && statusesNeedingCallNotification.includes(originalEvent.status || '')) {
        try {
          const { initializeCorporateProtocol } = await import('../services/corporate-followup-service');
          await initializeCorporateProtocol(
            id,
            validatedData.tspContact!,
            req.user?.id || 'system'
          );
          logger.log(`✅ Corporate follow-up protocol initialized for event ${id}`);
        } catch (error) {
          logger.error('Failed to initialize corporate follow-up protocol:', error);
          // Don't fail the request if protocol initialization fails
        }
      } else if (originalEvent.isCorporatePriority) {
        logger.log(`ℹ️ Skipping corporate protocol for event ${id} - already ${originalEvent.status}`);
      }
    }

    // Enhanced audit logging for this operation
    await AuditLogger.logEventRequestChange(
      id.toString(),
      originalEvent,
      updatedEventRequest,
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.session?.id || req.sessionID,
      }
    );

    await logActivity(
      req,
      res,
      'EVENT_REQUESTS_EDIT',
      `${validatedData.tspContact ? 'Assigned' : 'Removed'} TSP contact for event: ${id}`,
      {
        eventId: id,
        tspContact: validatedData.tspContact,
        assignedBy: req.user?.email,
        organizationName: originalEvent.organizationName,
      }
    );

    res.json(updatedEventRequest);
  } catch (error) {
    logger.error('Error updating TSP contact:', error);

    // Handle validation errors specifically
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    res.status(500).json({ error: 'Failed to update TSP contact' });
  }
});

// Audit Log Routes - MOVED to ./event-requests/audit.ts
// Routes moved: GET /audit-logs

// Toggle corporate priority status for an event request
// When marked as corporate, notifies Christine and Katie that event needs core team attention
router.patch('/:id/corporate-priority', isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { isCorporatePriority, coreTeamMemberNotes } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    // Check permissions - admin or TSP contact assignment permissions
    if (!hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_EDIT)) {
      return res.status(403).json({
        error: 'Insufficient permissions to update corporate priority status.',
      });
    }

    // Get original data for comparison
    const originalEvent = await storage.getEventRequestById(id);
    if (!originalEvent) {
      return res.status(404).json({ error: 'Event request not found' });
    }

    // Check permission for REMOVING corporate priority - only Katie and Christine can do this
    if (originalEvent.isCorporatePriority === true && isCorporatePriority === false) {
      const userEmail = req.user?.email;
      const allowedEmails = [
        'admin@sandwich.project',
        'katielong2316@gmail.com',
        'katie@thesandwichproject.org',
        'christine@thesandwichproject.org'
      ];
      
      if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
        return res.status(403).json({
          error: 'Only Christine and Katie can remove the corporate priority flag from an event.',
        });
      }
    }

    // Prepare updates
    const updates: Partial<EventRequest> = {
      isCorporatePriority: isCorporatePriority ?? false,
      requiresCoreTeamMember: isCorporatePriority ?? false,
      updatedAt: new Date(),
    };

    // Track when it was marked/unmarked
    if (isCorporatePriority && !originalEvent.isCorporatePriority) {
      updates.corporatePriorityMarkedAt = new Date();
      updates.corporatePriorityMarkedBy = req.user?.id || null;
    } else if (!isCorporatePriority && originalEvent.isCorporatePriority) {
      updates.corporatePriorityMarkedAt = null;
      updates.corporatePriorityMarkedBy = null;
    }

    // Update core team member notes if provided
    if (coreTeamMemberNotes !== undefined) {
      updates.coreTeamMemberNotes = coreTeamMemberNotes;
    }

    await storage.updateEventRequest(id, updates);

    // Fetch updated record
    const updatedEventRequest = await storage.getEventRequestById(id);

    if (!updatedEventRequest) {
      return res.status(404).json({ error: 'Event request not found after update' });
    }

    // Send notification to Christine and Katie when marked as corporate
    if (isCorporatePriority && !originalEvent.isCorporatePriority) {
      try {
        await EmailNotificationService.sendCorporatePriorityNotification(
          id,
          originalEvent.organizationName || 'Unknown Organization',
          getEffectiveEventDate(originalEvent),
          req.user?.email || 'Unknown user'
        );
      } catch (error) {
        logger.error('Failed to send corporate priority notification:', error);
        // Don't fail the request if notification fails
      }

      // If event already has a TSP contact assigned, initialize the corporate protocol
      // and send immediate call notification to that contact
      // BUT only for events that are not yet scheduled (new/in_progress) - scheduled/completed events don't need "call now" alerts
      const statusesNeedingCallNotification = ['new', 'in_progress'];
      if (originalEvent.tspContact && statusesNeedingCallNotification.includes(originalEvent.status || '')) {
        try {
          const { initializeCorporateProtocol } = await import('../services/corporate-followup-service');
          await initializeCorporateProtocol(id, originalEvent.tspContact, req.user?.id || 'system');
        } catch (error) {
          logger.error('Failed to initialize corporate follow-up protocol:', error);
          // Don't fail the request if protocol initialization fails
        }
      } else if (originalEvent.tspContact) {
        logger.log(`Skipping corporate call notification for event ${id} - already ${originalEvent.status}`);
      }
    }

    // Audit log
    await AuditLogger.logEventRequestChange(
      id.toString(),
      originalEvent,
      updatedEventRequest,
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.session?.id || req.sessionID,
      }
    );

    await logActivity(
      req,
      res,
      'EVENT_REQUESTS_EDIT',
      `${isCorporatePriority ? 'Marked' : 'Unmarked'} event as corporate priority: ${id}`,
      {
        eventId: id,
        isCorporatePriority,
        organizationName: originalEvent.organizationName,
        markedBy: req.user?.email,
      }
    );

    res.json(updatedEventRequest);
  } catch (error) {
    logger.error('Error updating corporate priority status:', error);
    res.status(500).json({ error: 'Failed to update corporate priority status' });
  }
});

// Update recipient assignment for event requests
router.patch('/:id/recipients', isAuthenticated, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { assignedRecipientIds, recipientAllocations } = req.body;

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }


    // Check permissions
    if (!hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_EDIT)) {
      return res.status(403).json({ error: 'Insufficient permissions to assign recipients' });
    }

    // Validate that the event exists
    const existingEvent = await storage.getEventRequestById(eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event request not found' });
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Update assignedRecipientIds if provided
    if (assignedRecipientIds !== undefined) {
      updateData.assignedRecipientIds = assignedRecipientIds || [];
    }

    // Update recipientAllocations if provided
    if (recipientAllocations !== undefined) {
      updateData.recipientAllocations = recipientAllocations || [];
    }

    // Update the event with recipient assignment
    const updatedEventRequest = await storage.updateEventRequest(eventId, updateData);

    if (!updatedEventRequest) {
      return res.status(404).json({ error: 'Failed to update event request' });
    }

    await logActivity(
      req,
      res,
      'EVENT_REQUESTS_EDIT',
      `Updated recipient assignments for event request: ${eventId}`,
      { recipientIds: assignedRecipientIds, recipientAllocations }
    );

    res.json(updatedEventRequest);
  } catch (error) {
    logger.error('Error updating recipient assignment:', error);
    res.status(500).json({ error: 'Failed to update recipient assignment' });
  }
});

// Send email to event organizer with toolkit documents
router.post('/:id/send-email', isAuthenticated, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { recipientEmail, subject, content, attachments = [] } = req.body;

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    // Check permissions
    if (!hasPermission(req.user, PERMISSIONS.EVENT_REQUESTS_SEND_TOOLKIT)) {
      return res.status(403).json({ error: 'Insufficient permissions to send emails' });
    }

    // Validate required fields
    if (!recipientEmail || !subject || !content) {
      return res.status(400).json({ error: 'Recipient email, subject, and content are required' });
    }

    // Get event details
    const eventRequest = await storage.getEventRequestById(eventId);
    if (!eventRequest) {
      return res.status(404).json({ error: 'Event request not found' });
    }

    // Import SendGrid service and email footer
    const { sendEmail } = await import('../sendgrid');
    const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');
    const path = await import('path');

    // Use the HTML content as-is (already styled from EventEmailComposer)
    // Only add footer to the existing content
    const emailBodyText = content + EMAIL_FOOTER_TEXT;
    const emailBodyHtml = content + EMAIL_FOOTER_HTML;

    // Determine from and reply-to addresses
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'katielong2316@gmail.com';
    const replyToEmail = req.user?.preferredEmail || req.user?.email || fromEmail;

    // Convert attachment paths to absolute file system paths
    const attachmentPaths = attachments.map((filePath: string) => {
      // If path starts with /, it's already an absolute path from /uploads
      // Convert to filesystem path
      if (filePath.startsWith('/uploads/')) {
        return path.join(process.cwd(), filePath);
      }
      return filePath;
    });

    // Send email via SendGrid with actual file attachments
    const emailSent = await sendEmail({
      to: recipientEmail,
      from: fromEmail,
      replyTo: replyToEmail,
      subject,
      text: emailBodyText,
      html: emailBodyHtml, // Use the styled HTML as-is, no wrapping
      attachments: attachmentPaths, // Pass actual file paths for attachment
    });

    if (!emailSent) {
      return res.status(500).json({ error: 'Failed to send email via SendGrid' });
    }

    // Log activity
    await logActivity(
      req,
      res,
      'EVENT_REQUESTS_SEND_TOOLKIT',
      `Sent email to event organizer for event request: ${eventId}`,
      { 
        recipientEmail, 
        subject, 
        attachmentsCount: attachments.length 
      }
    );

    res.json({ 
      success: true, 
      message: 'Email sent successfully' 
    });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('❌ Error sending email:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: err?.message || 'Unknown error occurred'
    });
  }
});

// AI Routes - MOVED to ./event-requests/ai.ts
// Routes moved: POST /:id/ai-suggest-dates, POST /:id/ai-intake-assist, POST /:id/ai-categorize

// Lifecycle Routes - MOVED to ./event-requests/lifecycle.ts
// Routes moved: PATCH /:id/schedule-call, PATCH /:id/mlk-day, POST /admin/auto-complete-passed

// SMS Routes - MOVED to ./event-requests/sms.ts
// Routes moved: POST /:id/send-details-sms, POST /:id/send-correction-sms

// Conflict Detection Routes - MOVED to ./event-requests/conflicts.ts
// Routes moved: POST /check-conflicts, GET /conflicts-for-date, GET /check-returning-org

// Operational stats endpoint for dashboard overview
router.get(
  '/operational-stats',
  isAuthenticated,
  requirePermission('EVENT_REQUESTS_VIEW'),
  async (req, res) => {
    try {
      // Active statuses only — never load the full event_requests table (completed
      // history alone is large enough to leave the dashboard Today widget spinning).
      const activeStatuses = ['new', 'in_process', 'scheduled', 'rescheduled'];
      const activeEvents = await storage.getEventRequestsByStatuses(activeStatuses);

      // Use timezone-safe date handling (Eastern Time)
      const todayString = getTodayString(); // "YYYY-MM-DD" in Eastern Time
      const today = parseDateOnly(todayString)!;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

      // Calculate start of this week (Monday)
      const startOfWeek = new Date(today);
      const dayOfWeek = startOfWeek.getDay();
      const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0 days back
      startOfWeek.setDate(startOfWeek.getDate() - daysToSubtract);

      // Calculate end of this week (Sunday)
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Calculate last week's range
      const startOfLastWeek = new Date(startOfWeek);
      startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
      const endOfLastWeek = new Date(startOfWeek);
      endOfLastWeek.setMilliseconds(-1);

      // This week's events (active events happening this week)
      const thisWeekEvents = activeEvents.filter(event => {
        const eventDate = getEffectiveEventDate(event);
        if (!eventDate) return false;
        const date = parseDateOnly(eventDate);
        if (!date) return false;
        return date >= startOfWeek && date <= endOfWeek;
      });

      // Helper to get array length safely
      const getAssignedCount = (arr: unknown): number => {
        if (Array.isArray(arr)) return arr.filter(Boolean).length;
        return 0;
      };

      // Events happening today or tomorrow (upcoming deadlines)
      const upcomingDeadlines = activeEvents.filter(event => {
        const eventDate = getEffectiveEventDate(event);
        if (!eventDate) return false;
        const date = parseDateOnly(eventDate);
        if (!date) return false;
        return date >= today && date < dayAfterTomorrow;
      }).map(event => {
        const driversNeeded = event.driversNeeded || 0;
        const assignedDrivers = getAssignedCount(event.assignedDriverIds);
        const volunteersNeeded = event.volunteersNeeded || 0;
        const assignedVolunteers = getAssignedCount(event.assignedVolunteerIds);

        return {
          id: event.id,
          organizationName: event.organizationName,
          eventDate: getEffectiveEventDate(event),
          status: event.status,
          needsDriver: (driversNeeded - assignedDrivers) > 0 && !event.selfTransport,
          needsSpeaker: false, // Speaker role retired — never a speaker need.
          needsVolunteer: (volunteersNeeded - assignedVolunteers) > 0,
          isToday: toDateOnlyString(getEffectiveEventDate(event)) === todayString,
        };
      }).sort((a, b) => {
        const dateA = parseDateOnly(a.eventDate)?.getTime() || 0;
        const dateB = parseDateOnly(b.eventDate)?.getTime() || 0;
        return dateA - dateB;
      });

      // Events needing drivers (active events that still need more drivers assigned)
      const eventsNeedingDrivers = activeEvents.filter(event => {
        const driversNeeded = event.driversNeeded || 0;
        const assignedDrivers = getAssignedCount(event.assignedDriverIds);
        const selfTransport = event.selfTransport || false;
        return (driversNeeded - assignedDrivers) > 0 && !selfTransport;
      });

      // Events needing speakers — speaker role retired, always empty.
      const eventsNeedingSpeakers: typeof activeEvents = [];

      // Events needing volunteers
      const eventsNeedingVolunteers = activeEvents.filter(event => {
        const volunteersNeeded = event.volunteersNeeded || 0;
        const assignedVolunteers = getAssignedCount(event.assignedVolunteerIds);
        return (volunteersNeeded - assignedVolunteers) > 0;
      });

      // Calculate total staffing needs (remaining unfilled positions)
      const totalDriversNeeded = activeEvents.reduce((sum, event) => {
        if (event.selfTransport) return sum;
        const needed = event.driversNeeded || 0;
        const assigned = getAssignedCount(event.assignedDriverIds);
        return sum + Math.max(0, needed - assigned);
      }, 0);

      const totalSpeakersNeeded = 0; // Speaker role retired.

      const totalVolunteersNeeded = activeEvents.reduce((sum, event) => {
        const needed = event.volunteersNeeded || 0;
        const assigned = getAssignedCount(event.assignedVolunteerIds);
        return sum + Math.max(0, needed - assigned);
      }, 0);

      // Last week's completion rate — lightweight projection only (id + status +
      // dates), scoped to last week's effective date range so we don't pull the
      // entire completed-event history into memory. Effective date prefers
      // scheduledEventDate over desiredEventDate (same as getEffectiveEventDate).
      const lastWeekRows = await db
        .select({
          id: eventRequests.id,
          status: eventRequests.status,
          scheduledEventDate: eventRequests.scheduledEventDate,
          desiredEventDate: eventRequests.desiredEventDate,
        })
        .from(eventRequests)
        .where(
          and(
            isNull(eventRequests.deletedAt),
            sql`${eventRequests.status} NOT IN ('cancelled', 'declined')`,
            or(
              and(
                isNotNull(eventRequests.scheduledEventDate),
                gte(eventRequests.scheduledEventDate, startOfLastWeek),
                lte(eventRequests.scheduledEventDate, endOfLastWeek),
              ),
              and(
                isNull(eventRequests.scheduledEventDate),
                isNotNull(eventRequests.desiredEventDate),
                gte(eventRequests.desiredEventDate, startOfLastWeek),
                lte(eventRequests.desiredEventDate, endOfLastWeek),
              ),
            ),
          ),
        );

      const lastWeekCompleted = lastWeekRows.filter(
        (event) => event.status === 'completed',
      ).length;

      const lastWeekTotal = lastWeekRows.length;
      const completionRate = lastWeekTotal > 0
        ? Math.round((lastWeekCompleted / lastWeekTotal) * 100)
        : null;

      // Events by status for active events
      const statusCounts = {
        new: activeEvents.filter(e => e.status === 'new').length,
        in_process: activeEvents.filter(e => e.status === 'in_process').length,
        scheduled: activeEvents.filter(e => e.status === 'scheduled').length,
        rescheduled: activeEvents.filter(e => e.status === 'rescheduled').length,
      };

      // ── My TSP-contact assignments ───────────────────────────────────
      // When the logged-in user is assigned as the TSP contact on one or
      // more events, surface a personalized snapshot. The fields below let
      // the client decide whether to render the generic Operational Overview
      // (no assignments) or the personalized snapshot (any assignments).
      //
      // Matching strategy: an event "belongs to" the current user when
      // their user id appears in EITHER the canonical tspContactUserId
      // field OR the tspContactAssigned column (which can hold either a
      // user id or a free-text name depending on how it was assigned). We
      // match against `req.user.id` and also their email-derived id form to
      // catch both shapes.
      const currentUserId = (req.user as any)?.id;
      let myAssignments: any = null;
      if (currentUserId) {
        const userIdStr = String(currentUserId);
        const isAssignedToMe = (event: any): boolean => {
          if (!event) return false;
          if (event.tspContactUserId && String(event.tspContactUserId) === userIdStr) return true;
          if (event.tspContactAssigned && String(event.tspContactAssigned) === userIdStr) return true;
          if (event.tspContact && String(event.tspContact) === userIdStr) return true;
          return false;
        };

        // Only consider ACTIVE statuses for the personalized snapshot —
        // completed/declined/cancelled aren't "things that need attention."
        const myEvents = activeEvents.filter(isAssignedToMe);

        // Stale in-process: no lastContactAttempt in the past 7 days. Treats
        // missing lastContactAttempt as stale too, since the user has never
        // logged contact on an in-process event they own.
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const LARGE_SANDWICH_THRESHOLD = 500;

        const mapMyAssignmentEvent = (event: any) => {
          const eventDate = toDateOnlyString(getEffectiveEventDate(event));
          const lastContact = event.lastContactAttempt || null;
          let needsFollowUp = false;
          if (event.status === 'in_process') {
            if (!lastContact) {
              needsFollowUp = true;
            } else {
              const last = new Date(lastContact);
              needsFollowUp = Number.isNaN(last.getTime()) || last < sevenDaysAgo;
            }
          }

          const count = event.estimatedSandwichCount ?? null;
          const countMax = event.estimatedSandwichCountMax ?? null;
          const isLargeEvent =
            (typeof count === 'number' && count >= LARGE_SANDWICH_THRESHOLD) ||
            (typeof countMax === 'number' && countMax >= LARGE_SANDWICH_THRESHOLD);

          const submittedDays = daysSinceSubmitted(event.createdAt, today);
          const untilEvent = daysUntilEventDate(eventDate, today);
          const urgentGaps = getAssignmentUrgentGaps(event, 7, today);

          return {
            id: event.id,
            organizationName: event.organizationName,
            status: event.status,
            eventDate,
            createdAt: event.createdAt ?? null,
            daysSinceSubmitted: submittedDays,
            daysUntilEvent: untilEvent,
            urgentGaps,
            needsUrgentDetails: urgentGaps.length > 0,
            lastContactAttempt: lastContact,
            estimatedSandwichCount: count,
            estimatedSandwichCountMin: event.estimatedSandwichCountMin ?? null,
            estimatedSandwichCountMax: countMax,
            sandwichTypes: event.sandwichTypes ?? null,
            needsFollowUp,
            vanNeeded: !!(event.vanDriverNeeded || event.vanNeededLikely),
            vanDriverNeeded: !!event.vanDriverNeeded,
            vanNeededLikely: !!event.vanNeededLikely,
            isLargeEvent,
            isCorporatePriority: !!event.isCorporatePriority,
          };
        };

        const isStaleInProcess = (event: any): boolean => {
          if (event.status !== 'in_process') return false;
          if (!event.lastContactAttempt) return true;
          const last = new Date(event.lastContactAttempt);
          if (Number.isNaN(last.getTime())) return true;
          return last < sevenDaysAgo;
        };

        const sortByDateAsc = (a: { eventDate: string | null }, b: { eventDate: string | null }) => {
          const dA = parseDateOnly(a.eventDate)?.getTime() || 0;
          const dB = parseDateOnly(b.eventDate)?.getTime() || 0;
          return dA - dB;
        };

        const sortRawEventsByDateAsc = (a: any, b: any) => {
          const dA =
            parseDateOnly(toDateOnlyString(getEffectiveEventDate(a)))?.getTime() || 0;
          const dB =
            parseDateOnly(toDateOnlyString(getEffectiveEventDate(b)))?.getTime() || 0;
          return dA - dB;
        };

        // New requests assigned to me — highest priority, surfaced first.
        const myNewRequests = myEvents
          .filter((e) => e.status === 'new')
          .sort((a, b) => {
            const daysA = daysSinceSubmitted(a.createdAt, today) ?? 0;
            const daysB = daysSinceSubmitted(b.createdAt, today) ?? 0;
            if (daysB !== daysA) return daysB - daysA;
            return sortRawEventsByDateAsc(a, b);
          })
          .map(mapMyAssignmentEvent);

        const myInProcessStale = myEvents
          .filter(isStaleInProcess)
          .map(mapMyAssignmentEvent);

        // Full breakdown by status for the snapshot summary.
        const byStatus = {
          new: myEvents.filter((e) => e.status === 'new').length,
          in_process: myEvents.filter((e) => e.status === 'in_process').length,
          scheduled: myEvents.filter((e) => e.status === 'scheduled').length,
          rescheduled: myEvents.filter((e) => e.status === 'rescheduled').length,
        };

        const byStatusEvents = {
          new: myEvents.filter((e) => e.status === 'new').sort(sortRawEventsByDateAsc).map(mapMyAssignmentEvent),
          in_process: myEvents.filter((e) => e.status === 'in_process').sort(sortRawEventsByDateAsc).map(mapMyAssignmentEvent),
          scheduled: myEvents.filter((e) => e.status === 'scheduled').sort(sortRawEventsByDateAsc).map(mapMyAssignmentEvent),
          rescheduled: myEvents.filter((e) => e.status === 'rescheduled').sort(sortRawEventsByDateAsc).map(mapMyAssignmentEvent),
        };

        // Top-line list of every event this user owns, lightweight payload.
        const allMyEvents = myEvents
          .map(mapMyAssignmentEvent)
          .sort((a, b) => {
            const statusRank: Record<string, number> = { new: 0, in_process: 1, scheduled: 2, rescheduled: 2 };
            const rA = statusRank[a.status || ''] ?? 9;
            const rB = statusRank[b.status || ''] ?? 9;
            if (rA !== rB) return rA - rB;
            return sortByDateAsc(a, b);
          });

        const urgentDetailEvents = myEvents
          .map(mapMyAssignmentEvent)
          .filter((e) => e.needsUrgentDetails)
          .sort((a, b) => {
            const daysA = a.daysUntilEvent ?? 999;
            const daysB = b.daysUntilEvent ?? 999;
            if (daysA !== daysB) return daysA - daysB;
            return (b.urgentGaps?.length ?? 0) - (a.urgentGaps?.length ?? 0);
          });

        myAssignments = {
          total: myEvents.length,
          newRequestsCount: myNewRequests.length,
          inProcessStaleCount: myInProcessStale.length,
          urgentDetailGapsCount: urgentDetailEvents.length,
          byStatus,
          byStatusEvents,
          newRequests: myNewRequests,
          inProcessStale: myInProcessStale,
          urgentDetailEvents,
          allMyEvents,
        };
      }

      res.json({
        thisWeekEventsCount: thisWeekEvents.length,
        eventsNeedingDrivers: eventsNeedingDrivers.length,
        eventsNeedingSpeakers: eventsNeedingSpeakers.length,
        eventsNeedingVolunteers: eventsNeedingVolunteers.length,
        totalDriversNeeded,
        totalSpeakersNeeded,
        totalVolunteersNeeded,
        lastWeekCompletionRate: completionRate,
        lastWeekCompleted,
        lastWeekTotal,
        upcomingDeadlines,
        todayEventsCount: upcomingDeadlines.filter(e => e.isToday).length,
        tomorrowEventsCount: upcomingDeadlines.filter(e => !e.isToday).length,
        activeEventsCount: activeEvents.length,
        statusCounts,
        myAssignments,
      });
    } catch (error) {
      logger.error('Failed to fetch operational stats', error);
      res.status(500).json({ message: 'Failed to fetch operational stats' });
    }
  }
);

export default router;
