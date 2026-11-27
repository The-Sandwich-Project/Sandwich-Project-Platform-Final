import { normalizeToolkitPatch } from '@shared/toolkit-state';
/**
 * EventSchedulingForm - Utility Functions
 *
 * Extracted from EventSchedulingForm.tsx to:
 * 1. Eliminate duplication in form data serialization
 * 2. Make payload-building / serialization logic testable
 * 3. Simplify the performSubmit function
 */

import { hasActiveSandwichRange } from '@shared/sandwich-count-utils';
import { estimateStateFromFields, normalizeEstimate } from '@shared/sandwich-estimate';
import type { EventFormData } from './form-sections/types';
import { effectiveNextDayPickup } from '@shared/next-day-pickup';
import { hasAttendanceRange } from '@shared/attendance-estimate';
import { usesTspVan } from '@shared/van-rules';
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
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  let out = snapshot;
  if ('volunteerCount' in out) {
    const { volunteerCount, ...rest } = out;
    out = { ...rest, estimatedAttendance: resolveEstimatedAttendance(snapshot) };
  }
  return normalizeDraftNewFields(out);
}

/**
 * Bring a draft snapshot saved before batch 6a's fields existed into the
 * current shape, the same way the form opens an event. Applied to both halves
 * of a draft (see normalizeDraftAttendance): a field missing from an old
 * draft would otherwise look like a server edit next to the current form's
 * default (0, false, 'no') and win the merge, discarding the user's changes.
 *   - no attendance range: estimatedAttendanceMin/Max = 0
 *   - no next-day choice: derived from the overnight location, like older events
 *   - no TSP shopping: false
 */
export function normalizeDraftNewFields(snapshot: any): any {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const out = { ...snapshot };
  if (!('estimatedAttendanceMin' in out)) out.estimatedAttendanceMin = 0;
  if (!('estimatedAttendanceMax' in out)) out.estimatedAttendanceMax = 0;
  if (!('nextDayPickup' in out)) {
    out.nextDayPickup = effectiveNextDayPickup(out);
    out.holdingOvernight = out.nextDayPickup === 'planned';
  }
  if (!('isTspShopped' in out)) out.isTspShopped = false;
  if (!('vanReason' in out)) out.vanReason = '';
  if (!('vanTeamOk' in out)) out.vanTeamOk = false;
  return out;
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
    /** No longer used: the estimate is always sent from the form's estimate fields. */
    sandwichMode?: 'total' | 'range' | 'types';
    actualSandwichMode: 'total' | 'types';
    fieldOverrides?: Record<string, any>;
  }
): Record<string, any> {
  const { mode, hasEventRequest, eventRequestStatus, actualSandwichMode, fieldOverrides } = options;

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
    // Next-day pickup: only a planned one keeps the overnight details. Form
    // state from before the choice existed (a recovered draft) derives it the
    // same way older events do, so its overnight location isn't dropped.
    nextDayPickup: effectiveNextDayPickup(formData as any),
    overnightHoldingLocation: effectiveNextDayPickup(formData as any) === 'planned' ? formData.overnightHoldingLocation || null : null,
    overnightPickupTime: effectiveNextDayPickup(formData as any) === 'planned' ? formData.overnightPickupTime || null : null,

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

    // Van rules: the reason and the "team OK'd" only apply while TSP's van is needed.
    vanReason: usesTspVan(formData as any) ? String((formData as any).vanReason ?? '').trim() || null : null,
    vanTeamOk: usesTspVan(formData as any) ? (formData as any).vanTeamOk === true : false,

    // TSP shopping: strictly true/false (the column is NOT NULL)
    isTspShopped: formData.isTspShopped === true,

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
    ...normalizeToolkitPatch({
      toolkitSent: formData.toolkitSent || false,
      toolkitStatus: formData.toolkitStatus || null,
    }),
    toolkitSentDate: serializeDateToISO(formData.toolkitSentDate),

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
    // What a Standby event is waiting on (only while it's on Standby)
    ...(formData.status === 'standby'
      ? {
          standbyReason: (formData.standbyReason || '').trim() || null,
          standbyNotes: (formData.standbyNotes || '').trim() || null,
        }
      : {}),
  };

  // Sandwich estimate. The shared editor (SandwichEstimateEditor) keeps the
  // form's estimate fields consistent; here they're normalized by the same
  // shared rule the server uses and sent as one complete estimate. The
  // diff-based save in EventSchedulingForm serializes the original form the
  // same way, so an untouched estimate sends nothing, and a changed one sends
  // only the fields that changed (the server rule reads partial estimates).
  // sandwichTypes goes as JSON text so per-type ranges (min/max) survive the
  // request schema, which strips unknown keys from array entries.
  {
    const est = normalizeEstimate(
      estimateStateFromFields({
        estimatedSandwichCount: formData.totalSandwichCount || null,
        estimatedSandwichCountMin: formData.estimatedSandwichCountMin || null,
        estimatedSandwichCountMax: formData.estimatedSandwichCountMax || null,
        estimatedSandwichRangeType: formData.rangeSandwichType || null,
        sandwichTypes: formData.sandwichTypes,
      })
    );
    eventData.estimatedSandwichCount = est.estimatedSandwichCount;
    eventData.estimatedSandwichCountMin = est.estimatedSandwichCountMin;
    eventData.estimatedSandwichCountMax = est.estimatedSandwichCountMax;
    eventData.estimatedSandwichRangeType = est.estimatedSandwichRangeType;
    eventData.sandwichTypes = est.sandwichTypes ? JSON.stringify(est.sandwichTypes) : null;
  }

  // Attendee counts.
  // estimatedAttendance has exactly one home in form state, and both columns it
  // maps to come from the one writer. volunteerCount is a read-compatibility
  // mirror for older consumers of the legacy column (impact reports,
  // large-event logistics modal) and must never be written from an input —
  // that is what let the two columns drift apart.
  Object.assign(eventData, buildAttendancePatch(formData.estimatedAttendance));
  // A range ("40-60") keeps its ends; a single number clears them.
  {
    const min = Number((formData as any).estimatedAttendanceMin) || 0;
    const max = Number((formData as any).estimatedAttendanceMax) || 0;
    // 0 is a valid low end ("0-10"); no range is 0/0 in form state.
    const isRange = eventData.estimatedAttendance != null && hasAttendanceRange(min, max);
    eventData.estimatedAttendanceMin = isRange ? min : null;
    eventData.estimatedAttendanceMax = isRange ? max : null;
  }
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

/** The fields that together make up an event's sandwich estimate. */
export const ESTIMATE_SAVE_KEYS = [
  'estimatedSandwichCount',
  'estimatedSandwichCountMin',
  'estimatedSandwichCountMax',
  'estimatedSandwichRangeType',
  'sandwichTypes',
] as const;

/**
 * The edit form's changed-fields save: delete every key of `eventData` whose
 * value equals the baseline (the form as it was loaded), so untouched fields
 * can't overwrite changes made elsewhere. Returns the dropped keys.
 * - A key in `overrides` is always kept (a deliberate write).
 * - The estimate is one value spread over several fields: if any of them
 *   changed, all are kept, so the server's estimate rule reads the same split
 *   the editor previewed (sending only a cleared total would make it drop the
 *   per-type amounts that are still shown).
 */
/** The expected-attendees number and its range travel together. */
export const ATTENDANCE_SAVE_KEYS = [
  'estimatedAttendance',
  'volunteerCount',
  'estimatedAttendanceMin',
  'estimatedAttendanceMax',
] as const;

const SAVE_TOGETHER: readonly (readonly string[])[] = [ESTIMATE_SAVE_KEYS, ATTENDANCE_SAVE_KEYS];

export function dropUnchangedFields(
  eventData: Record<string, any>,
  baselineData: Record<string, any>,
  overrides?: Record<string, any>
): string[] {
  const has = (o: Record<string, any>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const same = (k: string) => has(baselineData, k) && JSON.stringify(eventData[k]) === JSON.stringify(baselineData[k]);
  // A group whose parts only make sense together is sent whole when any part changed.
  const changedGroups = SAVE_TOGETHER.filter((group) => group.some((k) => has(eventData, k) && !same(k)));
  const omitted: string[] = [];
  for (const key of Object.keys(eventData)) {
    if (overrides && has(overrides, key)) continue;
    if (changedGroups.some((group) => group.includes(key))) continue;
    if (same(key)) {
      delete eventData[key];
      omitted.push(key);
    }
  }
  return omitted;
}

/**
 * Fields that only make sense together and must merge as one unit, so a
 * recovered draft can't pair one person's choice with another person's
 * value (e.g. a drafted "No reminder" with someone else's newer date).
 */
const MERGE_TOGETHER: string[][] = [
  ['standbyCheckBackMode', 'standbyCheckBackDate', 'standbyExpectedDate'],
  ['estimatedAttendance', 'estimatedAttendanceMin', 'estimatedAttendanceMax'],
  // The next-day choice and the overnight details it keeps or drops (choosing
  // No / It's an option clears the delivery window and parking too).
  ['nextDayPickup', 'holdingOvernight', 'overnightHoldingLocation', 'overnightPickupTime', 'deliveryTimeWindow', 'deliveryParkingAccess'],
  // Whether the van is needed, and the reason / "team OK'd" that only apply then.
  ['vanDriverNeeded', 'vanNeededFor', 'isDhlVan', 'vanReason', 'vanTeamOk'],
];

/**
 * Intelligent merge of cached form data (a recovered draft) with current
 * server data. Preserves the user's intentional changes while accepting
 * server updates. When both the user and the server changed the same field
 * (or the same MERGE_TOGETHER group), the server wins.
 */
export function intelligentMergeFormData(
  cachedFormData: Record<string, any>,
  originalServerData: Record<string, any> | null | undefined,
  currentServerData: Record<string, any>
): {
  mergedData: Record<string, any>;
  conflicts: string[];
  serverUpdates: string[];
  userChangesPreserved: string[];
} {
  const mergedData: Record<string, any> = { ...currentServerData };
  const conflicts: string[] = [];
  const serverUpdates: string[] = [];
  const userChangesPreserved: string[] = [];

  if (!originalServerData) {
    return { mergedData: currentServerData, conflicts: [], serverUpdates: [], userChangesPreserved: [] };
  }

  const valuesEqual = (a: any, b: any): boolean => {
    const normalize = (v: any) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    };
    return normalize(a) === normalize(b);
  };

  const grouped = new Set(MERGE_TOGETHER.flat());
  for (const group of MERGE_TOGETHER) {
    const keys = group.filter((k) => k in cachedFormData || k in currentServerData);
    if (keys.length === 0) continue;
    const userChanged = keys.some((k) => !valuesEqual(cachedFormData[k], originalServerData[k]));
    const serverChanged = keys.some((k) => !valuesEqual(currentServerData[k], originalServerData[k]));
    // Same rule as single fields: both changed -> the server wins.
    const source = userChanged && !serverChanged ? cachedFormData : currentServerData;
    for (const k of keys) mergedData[k] = source[k];
    if (userChanged && serverChanged) conflicts.push(...keys);
    else if (userChanged) userChangesPreserved.push(...keys);
    else if (serverChanged) serverUpdates.push(...keys);
  }

  for (const key of Object.keys(cachedFormData)) {
    if (grouped.has(key)) continue;
    const cachedValue = cachedFormData[key];
    const originalValue = originalServerData[key];
    const currentValue = currentServerData[key];
    const userChangedField = !valuesEqual(cachedValue, originalValue);
    const serverChangedField = !valuesEqual(currentValue, originalValue);

    if (userChangedField && serverChangedField) {
      conflicts.push(key);
      mergedData[key] = currentValue;
    } else if (userChangedField) {
      userChangesPreserved.push(key);
      mergedData[key] = cachedValue;
    } else if (serverChangedField) {
      serverUpdates.push(key);
      mergedData[key] = currentValue;
    }
  }

  if (!mergedData.status) {
    mergedData.status = currentServerData.status || 'new';
  }

  return { mergedData, conflicts, serverUpdates, userChangesPreserved };
}
