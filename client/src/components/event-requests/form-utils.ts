/**
 * EventSchedulingForm - Utility Functions
 *
 * Extracted from EventSchedulingForm.tsx to:
 * 1. Eliminate duplication in form data serialization
 * 2. Make payload-building / serialization logic testable
 * 3. Simplify the performSubmit function
 */

import {
  hasActiveSandwichRange,
  hasActiveSandwichTypes,
  parseSandwichTypeEntries,
  sumSandwichTypeQuantities,
} from '@shared/sandwich-count-utils';
import type { EventFormData } from './form-sections/types';

// Re-exported so existing importers keep pulling it from form-utils while the
// implementation lives in shared/ (the server-side heal migration and display
// helpers need the same summing rule).
export { sumSandwichTypeQuantities };
export { findMismatchedSavedFields, getDroppedServerFields } from '@/lib/event-save-verification';

/**
 * Serialize a date string for the backend.
 * Sends bare YYYY-MM-DD so parseDateOnly uses its safe local-noon path.
 * Returns null for empty/falsy strings.
 */
export function serializeDateToISO(dateString: string): string | null {
  if (!dateString || !dateString.trim()) return null;
  // Extract YYYY-MM-DD portion
  const dateOnly = dateString.split('T')[0];
  // Validate it looks like a date before sending
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

/**
 * Build the event data payload for the server from form state.
 *
 * This is the SINGLE place where form fields are mapped to server fields.
 * Used by both create and update mutations.
 */
export function buildEventDataForServer(
  formData: EventFormData,
  options: {
    mode: 'schedule' | 'edit' | 'create';
    hasEventRequest: boolean;
    eventRequestStatus?: string;
    sandwichMode: 'total' | 'range' | 'types';
    actualSandwichMode: 'total' | 'types';
    fieldOverrides?: Record<string, any>;
  }
): Record<string, any> {
  const { mode, hasEventRequest, eventRequestStatus, sandwichMode, actualSandwichMode, fieldOverrides } = options;

  // Resolve the effective status once so the status field and the scheduled-date
  // coupling stay consistent. (Schedule mode defaults to 'scheduled'.)
  const resolvedStatus = !hasEventRequest
    ? (formData.status || 'new')
    : mode === 'schedule'
      ? (formData.status || 'scheduled')
      : (formData.status || eventRequestStatus || 'new');

  const eventData: Record<string, any> = {
    // Status logic: different handling per mode (all resolve via resolvedStatus)
    ...(hasEventRequest && mode === 'schedule' ? { status: resolvedStatus } : {}),
    ...(!hasEventRequest ? { status: resolvedStatus } : {}),
    ...(hasEventRequest && mode === 'edit' ? { status: resolvedStatus } : {}),

    // Date fields - always include desiredEventDate so it can be set or cleared intentionally
    desiredEventDate: serializeDateToISO(formData.eventDate),
    dateFlexible: formData.dateFlexible,
    backupDates: formData.backupDates.filter(d => d).map(d => serializeDateToISO(d)),
    // Attach the confirmed scheduled date only when the resolved status is
    // 'scheduled'. (Previously also attached whenever mode === 'schedule', which
    // over-included it for non-scheduled picks like Standby and required a
    // downstream strip in detectChangedFields — removed with full-form save.)
    ...(resolvedStatus === 'scheduled'
      ? { scheduledEventDate: serializeDateToISO(formData.eventDate) }
      : {}),

    // Time fields
    eventStartTime: formData.eventStartTime || null,
    eventEndTime: formData.eventEndTime || null,
    pickupTime: formData.pickupTime || null,
    pickupDateTime: (() => {
      if (formData.pickupDate && formData.pickupTimeSeparate) {
        return `${formData.pickupDate}T${formData.pickupTimeSeparate}`;
      }
      return formData.pickupDateTime || null;
    })(),

    // Location
    eventAddress: formData.eventAddress || null,
    deliveryDestination: formData.deliveryDestination || null,
    overnightHoldingLocation: formData.overnightHoldingLocation || null,
    overnightPickupTime: formData.overnightPickupTime || null,

    // Refrigeration
    hasRefrigeration: formData.hasRefrigeration === 'true' ? true :
                      formData.hasRefrigeration === 'false' ? false : null,

    // Transport & Resources
    driversNeeded: formData.selfTransport ? 0 : (parseInt(formData.driversNeeded?.toString() || '0') || 0),
    selfTransport: formData.selfTransport || false,
    vanDriverNeeded: formData.selfTransport ? false : ((formData.vanDriverNeeded || false) || formData.isDhlVan),
    vanNeededFor: (() => {
      const vanNeeded = !formData.selfTransport && ((formData.vanDriverNeeded || false) || formData.isDhlVan);
      return vanNeeded && (formData.vanNeededFor === 'transport' || formData.vanNeededFor === 'refrigeration')
        ? formData.vanNeededFor
        : null;
    })(),
    volunteersNeeded: parseInt(formData.volunteersNeeded?.toString() || '0') || 0,
    estimatedAttendance: parseInt(formData.estimatedAttendance?.toString() || '0') || null,

    // Contacts
    tspContact: formData.tspContact || null,
    customTspContact: formData.customTspContact?.trim() || null,

    // Notes
    message: formData.message || null,
    schedulingNotes: formData.schedulingNotes || null,
    planningNotes: formData.planningNotes || null,
    nextAction: formData.nextAction || null,
    driverInstructions: formData.driverInstructions || null,
    volunteerInstructions: formData.volunteerInstructions || null,

    // Structured reason fields — required by the server when status becomes
    // cancelled/declined. The card Cancel/Decline dialogs set these directly;
    // the edit-form status dropdown captures them via StatusReasonDialog and
    // stashes them on formData before save.
    ...(resolvedStatus === 'cancelled'
      ? {
          cancelledReason: formData.cancelledReason || null,
          cancelledNotes: formData.cancelledNotes || null,
        }
      : {}),
    ...(resolvedStatus === 'declined'
      ? {
          declinedReason: formData.declinedReason || null,
          declinedNotes: formData.declinedNotes || null,
        }
      : {}),

    // Manual entry
    manualEntrySource: formData.manualEntrySource || null,

    // Contact information
    firstName: formData.firstName?.trim() || null,
    lastName: formData.lastName?.trim() || null,
    email: formData.email?.trim() || null,
    phone: formData.phone?.trim() || null,
    organizationName: formData.organizationName?.trim() || null,
    department: formData.department || null,
    organizationCategory: formData.organizationCategory || null,
    schoolClassification: formData.schoolClassification || null,

    // Backup contact
    backupContactFirstName: formData.backupContactFirstName?.trim() || null,
    backupContactLastName: formData.backupContactLastName?.trim() || null,
    backupContactEmail: formData.backupContactEmail?.trim() || null,
    backupContactPhone: formData.backupContactPhone?.trim() || null,
    backupContactRole: formData.backupContactRole || null,

    // Misc
    previouslyHosted: formData.previouslyHosted || null,
    deliveryTimeWindow: formData.deliveryTimeWindow || null,
    deliveryParkingAccess: formData.deliveryParkingAccess || null,

    // Van driver
    assignedVanDriverId: formData.isDhlVan
      ? null
      : (formData.assignedVanDriverId && formData.assignedVanDriverId !== 'none')
        ? formData.assignedVanDriverId
        : null,
    isDhlVan: formData.selfTransport ? false : !!formData.isDhlVan,

    // Toolkit
    toolkitSent: formData.toolkitSent || false,
    toolkitStatus: formData.toolkitStatus || null,
    toolkitSentDate: serializeDateToISO(formData.toolkitSentDate),

    // Corporate priority
    isCorporatePriority: formData.isCorporatePriority || false,

    // Standby
    standbyExpectedDate: (() => {
      // Respect an EXPLICIT null/empty override (the "No reminder" choice in
      // the standby dialog must clear the date, not fall back to the stale
      // formData value from the closure) — only fall back when the override
      // key wasn't provided at all.
      const date =
        fieldOverrides && 'standbyExpectedDate' in fieldOverrides
          ? fieldOverrides.standbyExpectedDate
          : formData.standbyExpectedDate;
      return formData.status === 'standby' && date
        ? serializeDateToISO(typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0])
        : null;
    })(),
  };

  // Sandwich data based on mode.
  // Each mode owns exactly one representation of the count; the OTHER two
  // representations must be explicitly nulled so a stale range/breakdown can't
  // survive in the DB alongside an exact count (the "500 shows as 498" bug).
  // See the diff-based save note in EventSchedulingForm.
  if (sandwichMode === 'total') {
    eventData.estimatedSandwichCount = formData.totalSandwichCount;
    eventData.sandwichTypes = null;
    eventData.estimatedSandwichCountMin = null;
    eventData.estimatedSandwichCountMax = null;
    eventData.estimatedSandwichRangeType = null;
  } else if (sandwichMode === 'range') {
    eventData.estimatedSandwichCountMin = formData.estimatedSandwichCountMin || null;
    eventData.estimatedSandwichCountMax = formData.estimatedSandwichCountMax || null;
    eventData.estimatedSandwichRangeType = formData.rangeSandwichType || null;
    eventData.estimatedSandwichCount = null;
    eventData.sandwichTypes = null;
  } else {
    eventData.sandwichTypes = JSON.stringify(formData.sandwichTypes);
    eventData.estimatedSandwichCount = sumSandwichTypeQuantities(formData.sandwichTypes);
    eventData.estimatedSandwichCountMin = null;
    eventData.estimatedSandwichCountMax = null;
    eventData.estimatedSandwichRangeType = null;
  }

  // Attendee counts
  eventData.volunteerCount = formData.volunteerCount || 0;
  eventData.adultCount = formData.adultCount || 0;
  eventData.childrenCount = formData.childrenCount || 0;
  eventData.kidsAgeRange = formData.kidsAgeRange || null;

  // Completed event tracking
  eventData.socialMediaPostRequested = formData.socialMediaPostRequested;
  eventData.socialMediaPostRequestedDate = serializeDateToISO(formData.socialMediaPostRequestedDate);
  eventData.socialMediaPostCompleted = formData.socialMediaPostCompleted;
  eventData.socialMediaPostCompletedDate = serializeDateToISO(formData.socialMediaPostCompletedDate);
  eventData.socialMediaPostNotes = formData.socialMediaPostNotes || null;

  // Actual sandwich data
  if (actualSandwichMode === 'total') {
    eventData.actualSandwichCount = formData.actualSandwichCount;
    eventData.actualSandwichTypes = null;
  } else {
    eventData.actualSandwichTypes = JSON.stringify(formData.actualSandwichTypes);
    eventData.actualSandwichCount = formData.actualSandwichTypes.reduce((sum, item) => sum + item.quantity, 0);
  }
  eventData.actualSandwichCountRecordedDate = serializeDateToISO(formData.actualSandwichCountRecordedDate);
  eventData.actualSandwichCountRecordedBy = formData.actualSandwichCountRecordedBy || null;

  // Follow-up tracking
  eventData.followUpOneDayCompleted = formData.followUpOneDayCompleted;
  eventData.followUpOneDayDate = serializeDateToISO(formData.followUpOneDayDate);
  eventData.followUpOneMonthCompleted = formData.followUpOneMonthCompleted;
  eventData.followUpOneMonthDate = serializeDateToISO(formData.followUpOneMonthDate);
  eventData.followUpNotes = formData.followUpNotes || null;

  // Recipients
  eventData.assignedRecipientIds = formData.assignedRecipientIds || [];

  return eventData;
}

/**
 * Determine sandwich mode from existing event data.
 *
 * When estimatedSandwichCount disagrees with a stale sandwichTypes breakdown,
 * prefer Exact Count so a full-form save does not silently revert the total
 * (e.g. user enters 200 but old types still sum to 198).
 *
 * Same rule for a leftover range whose midpoint disagrees with the exact count
 * (e.g. exact 500 + stale 490-506 → midpoint 498): open Exact Count, not Range.
 */
export function determineSandwichMode(
  sandwichTypes: any,
  estimatedSandwichCountMin: any,
  estimatedSandwichCountMax: any,
  estimatedSandwichCount?: number | null,
): 'total' | 'range' | 'types' {
  if (
    hasActiveSandwichRange(
      estimatedSandwichCountMin,
      estimatedSandwichCountMax,
      estimatedSandwichCount,
    )
  ) {
    return 'range';
  }

  return hasActiveSandwichTypes(sandwichTypes, estimatedSandwichCount) ? 'types' : 'total';
}

/**
 * Mode for diff-baseline serialization of what is PHYSICALLY stored.
 *
 * Unlike determineSandwichMode (UI), any persisted min/max counts as 'range'
 * even when a disagreeing exact count means the range is stale. That way a
 * subsequent Exact Count save still detects min/max → null as a real change
 * and clears the leftover range instead of dropping the clears (null === null).
 */
export function determineBaselineSandwichMode(
  sandwichTypes: any,
  estimatedSandwichCountMin: any,
  estimatedSandwichCountMax: any,
  estimatedSandwichCount?: number | null,
): 'total' | 'range' | 'types' {
  if (estimatedSandwichCountMin && estimatedSandwichCountMax) {
    return 'range';
  }
  // Same rule for a stale breakdown: any persisted sandwichTypes counts as
  // 'types' here even when a disagreeing exact count means the UI opens in
  // Exact Count. Otherwise the baseline serializes sandwichTypes as null, the
  // diff sees null === null, and the clear that would remove the stale
  // breakdown is dropped — leaving 250 turkey + 248 PBJ sitting next to the
  // exact 500 for the next reader to sum back to 498.
  if (parseSandwichTypeEntries(sandwichTypes).length > 0) {
    return 'types';
  }
  return determineSandwichMode(
    sandwichTypes,
    estimatedSandwichCountMin,
    estimatedSandwichCountMax,
    estimatedSandwichCount,
  );
}

/**
 * Determine actual sandwich mode from existing event data.
 *
 * Mirrors determineSandwichMode: a breakdown that disagrees with an explicit
 * actualSandwichCount is stale, so the editor opens on the exact count instead
 * of re-summing the leftover types over it.
 */
export function determineActualSandwichMode(
  actualSandwichTypes: any,
  actualSandwichCount?: number | null,
): 'total' | 'types' {
  return hasActiveSandwichTypes(actualSandwichTypes, actualSandwichCount) ? 'types' : 'total';
}

/**
 * The five columns that together encode ONE sandwich count. Every save writes
 * all five (one representation set, the other two nulled) so the DB can never
 * hold two competing answers.
 */
export const SANDWICH_COMPANION_FIELDS = [
  'estimatedSandwichCount',
  'sandwichTypes',
  'estimatedSandwichCountMin',
  'estimatedSandwichCountMax',
  'estimatedSandwichRangeType',
] as const;

/** Normalize a sandwich field to a comparable form across payload/DB shapes. */
function normalizeSandwichFieldValue(field: string, value: unknown): string {
  if (field === 'sandwichTypes') {
    const entries = parseSandwichTypeEntries(value);
    return entries.length === 0 ? 'null' : JSON.stringify(entries);
  }
  if (field === 'estimatedSandwichRangeType') {
    return value ? String(value) : 'null';
  }
  // Numeric columns: absent, null and 0 all mean "no value here".
  const numeric = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(numeric) || numeric === 0
    ? 'null'
    : String(numeric);
}

/**
 * Re-add sandwich fields the diff-based save dropped when the STORED record
 * still holds a value the payload intends to clear.
 *
 * The diff compares the payload against a re-serialization of the form's
 * opening snapshot, which means it can only ever be as right as the baseline's
 * inferred sandwich mode. That inference has been the recurring source of the
 * "500 saves as 498" bug: whenever the baseline resolves to the SAME mode the
 * user is saving in, the companion clears serialize to null on both sides,
 * compare equal, and get dropped — so the stale range/breakdown survives in the
 * DB and later gets summed or averaged back over the exact count.
 *
 * This check doesn't infer anything. It compares the intended write against
 * what the server actually has for these five columns and keeps any field that
 * genuinely differs, so a clear can never be silently dropped no matter which
 * mode the baseline picked.
 */
export function restoreDroppedSandwichClears(
  diffedEventData: Record<string, any>,
  fullEventData: Record<string, any>,
  storedEvent: Record<string, any> | null | undefined,
): string[] {
  const restored: string[] = [];
  if (!storedEvent) return restored;

  for (const field of SANDWICH_COMPANION_FIELDS) {
    // Still in the payload — nothing was dropped for this field.
    if (Object.prototype.hasOwnProperty.call(diffedEventData, field)) continue;
    if (!Object.prototype.hasOwnProperty.call(fullEventData, field)) continue;

    const intended = normalizeSandwichFieldValue(field, fullEventData[field]);
    const stored = normalizeSandwichFieldValue(field, storedEvent[field]);
    if (intended !== stored) {
      diffedEventData[field] = fullEventData[field];
      restored.push(field);
    }
  }

  return restored;
}
