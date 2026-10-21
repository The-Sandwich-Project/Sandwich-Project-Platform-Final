/**
 * EventSchedulingForm - Utility Functions
 *
 * Extracted from EventSchedulingForm.tsx to:
 * 1. Eliminate duplication in form data serialization
 * 2. Make payload-building / serialization logic testable
 * 3. Simplify the performSubmit function
 */

import { hasActiveSandwichRange } from '@shared/sandwich-count-utils';
import type { EventFormData } from './form-sections/types';
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
 * Resolve the authoritative estimated attendance for an existing event record.
 *
 * `estimatedAttendance` is the authoritative column. `volunteerCount` is the
 * legacy column the attendance input used to write in parallel, so records
 * saved before that duplication was removed can carry the count there with
 * `estimatedAttendance` still empty. Fall back to it on READ only — nothing
 * writes `volunteerCount` on its own any more (see buildEventDataForServer).
 *
 * When the two columns disagree, `estimatedAttendance` wins.
 */
export function resolveEstimatedAttendance(
  event: { estimatedAttendance?: number | null; volunteerCount?: number | null } | null | undefined,
): number {
  const estimated = Number(event?.estimatedAttendance) || 0;
  if (estimated > 0) return estimated;
  return Number(event?.volunteerCount) || 0;
}

/**
 * Build the attendance columns for a PATCH body.
 *
 * EVERY write of estimatedAttendance must go through this. The legacy
 * `volunteerCount` mirror has to move with it — especially on a CLEAR, because
 * `{ estimatedAttendance: null, volunteerCount: 30 }` is indistinguishable from
 * a genuine legacy-only record, so a stale mirror makes the next read resurrect
 * the value the user just cleared. 0 and blank both clear.
 */
export function buildAttendancePatch(value: unknown): {
  estimatedAttendance: number | null;
  volunteerCount: number | null;
} {
  const total = parseInt(String(value ?? '').trim() || '0', 10) || null;
  return { estimatedAttendance: total, volunteerCount: total };
}

/**
 * Bring a persisted auto-save draft snapshot into the current attendance shape.
 *
 * Drafts written before estimatedAttendance became the single attendance value
 * carry a parallel `volunteerCount`, and their `estimatedAttendance` was
 * initialized to 0 instead of falling back to the legacy column. Merging such a
 * snapshot as-is makes that fallback look like a concurrent SERVER edit, so the
 * merge resolves it as a conflict and discards the user's unsaved estimate.
 *
 * Must be applied to BOTH halves of a draft — the user's copy and its original
 * server snapshot — so "what the user actually changed" is still computed from
 * two values in the same representation. Normalizing only one half would turn
 * an untouched draft value into an apparent edit (or vice versa).
 *
 * A no-op for drafts saved after the change: they have no `volunteerCount`.
 */
export function normalizeDraftAttendance(snapshot: any): any {
  if (!snapshot || typeof snapshot !== 'object' || !('volunteerCount' in snapshot)) {
    return snapshot;
  }
  const { volunteerCount, ...rest } = snapshot;
  return { ...rest, estimatedAttendance: resolveEstimatedAttendance(snapshot) };
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

  // Attendee counts.
  // estimatedAttendance has exactly one home in form state, and both columns it
  // maps to come from the one writer. volunteerCount is a read-compatibility
  // mirror for older consumers of the legacy column (impact reports,
  // large-event logistics modal) and must never be written from an input —
  // that is what let the two columns drift apart.
  Object.assign(eventData, buildAttendancePatch(formData.estimatedAttendance));
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
 * Sum quantities from a sandwichTypes value (array or JSON string).
 */
export function sumSandwichTypeQuantities(sandwichTypes: unknown): number {
  if (!sandwichTypes) return 0;
  try {
    const parsed =
      typeof sandwichTypes === 'string' ? JSON.parse(sandwichTypes) : sandwichTypes;
    if (!Array.isArray(parsed)) return 0;
    return parsed.reduce(
      (sum, item) => sum + (Number((item as { quantity?: number })?.quantity) || 0),
      0,
    );
  } catch {
    return 0;
  }
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

  let parsed: unknown[] = [];
  try {
    parsed = sandwichTypes
      ? typeof sandwichTypes === 'string'
        ? JSON.parse(sandwichTypes)
        : sandwichTypes
      : [];
  } catch {
    parsed = [];
  }
  const hasTypesData = Array.isArray(parsed) && parsed.length > 0;
  if (!hasTypesData) return 'total';

  const typesTotal = sumSandwichTypeQuantities(parsed);
  const storedTotal =
    typeof estimatedSandwichCount === 'number' && estimatedSandwichCount > 0
      ? estimatedSandwichCount
      : null;

  if (storedTotal !== null && typesTotal !== storedTotal) {
    return 'total';
  }

  return 'types';
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
  return determineSandwichMode(
    sandwichTypes,
    estimatedSandwichCountMin,
    estimatedSandwichCountMax,
    estimatedSandwichCount,
  );
}

/**
 * Determine actual sandwich mode from existing event data.
 */
export function determineActualSandwichMode(actualSandwichTypes: any): 'total' | 'types' {
  const parsed = actualSandwichTypes ?
    (typeof actualSandwichTypes === 'string' ? JSON.parse(actualSandwichTypes) : actualSandwichTypes) : [];
  return Array.isArray(parsed) && parsed.length > 0 ? 'types' : 'total';
}
