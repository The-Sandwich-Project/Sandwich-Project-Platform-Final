/**
 * Unified Field Configuration for Event Request Forms
 *
 * This file serves as the SINGLE SOURCE OF TRUTH for field mappings between:
 * - Client form data (formData state)
 * - Server data (EventRequest from database)
 * - Field name mappings where they differ
 *
 * IMPORTANT: When adding a new field, add it to this configuration to ensure
 * consistency across the form, submission, and loading logic.
 */

/**
 * Field mapping configuration.
 *
 * Key differences between client and server field names:
 * - eventDate (client) → desiredEventDate (server)
 * - totalSandwichCount (client) → estimatedSandwichCount (server)
 * - rangeSandwichType (client) → estimatedSandwichRangeType (server)
 */
export const FIELD_MAPPINGS = {
  // Client field → Server field
  clientToServer: {
    eventDate: 'desiredEventDate',
    totalSandwichCount: 'estimatedSandwichCount',
    rangeSandwichType: 'estimatedSandwichRangeType',
  } as const,

  // Server field → Client field (reverse mapping)
  serverToClient: {
    desiredEventDate: 'eventDate',
    estimatedSandwichCount: 'totalSandwichCount',
    estimatedSandwichRangeType: 'rangeSandwichType',
  } as const,
} as const;

/**
 * UI-only fields that exist in formData but are not sent to the server.
 * These are computed/derived fields used for UI logic.
 */
export const UI_ONLY_FIELDS = [
  'holdingOvernight',      // Derived from presence of overnightHoldingLocation
  'pickupDate',            // Derived from pickupDateTime (date part)
  'pickupTimeSeparate',    // Derived from pickupDateTime (time part)
] as const;

/**
 * Fields that require special serialization before sending to server.
 */
export const DATE_FIELDS = [
  'eventDate',
  'backupDates',
  'toolkitSentDate',
  'socialMediaPostRequestedDate',
  'socialMediaPostCompletedDate',
  'actualSandwichCountRecordedDate',
  'followUpOneDayDate',
  'followUpOneMonthDate',
] as const;

/**
 * Default values for all form fields.
 * This ensures consistent initialization across the form.
 */
export const DEFAULT_FORM_DATA = {
  // Date/time fields
  eventDate: '',
  backupDates: [] as string[],
  eventStartTime: '',
  eventEndTime: '',
  pickupTime: '',
  pickupDateTime: '',
  pickupDate: '',
  pickupTimeSeparate: '',

  // Location fields
  eventAddress: '',
  deliveryDestination: '',
  holdingOvernight: false,
  overnightHoldingLocation: '',
  overnightPickupTime: '',

  // Sandwich planning
  sandwichTypes: [] as Array<{ type: string; quantity: number }>,
  hasRefrigeration: '',
  totalSandwichCount: 0,
  estimatedSandwichCountMin: 0,
  estimatedSandwichCountMax: 0,
  rangeSandwichType: '',

  // Resource requirements
  driversNeeded: 0,
  selfTransport: false,
  vanDriverNeeded: false,
  vanNeededFor: '',
  assignedVanDriverId: '',
  isDhlVan: false,
  volunteersNeeded: 0,

  // Attendee counts
  // No volunteerCount here: the server column is derived from
  // estimatedAttendance by buildEventDataForServer, not held in form state.
  estimatedAttendance: 0,
  adultCount: 0,
  childrenCount: 0,

  // Contact information
  tspContact: '',
  customTspContact: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  organizationName: '',
  department: '',
  organizationCategory: '',
  schoolClassification: '',

  // Backup contact
  backupContactFirstName: '',
  backupContactLastName: '',
  backupContactEmail: '',
  backupContactPhone: '',
  backupContactRole: '',

  // Notes fields
  message: '',
  schedulingNotes: '',
  planningNotes: '',
  nextAction: '',

  // Status and tracking
  status: 'new',
  previouslyHosted: 'i_dont_know',

  // Toolkit fields
  toolkitSent: false,
  toolkitSentDate: '',
  toolkitStatus: 'not_sent',

  // Delivery details
  deliveryTimeWindow: '',
  deliveryParkingAccess: '',

  // Completed event tracking
  socialMediaPostRequested: false,
  socialMediaPostRequestedDate: '',
  socialMediaPostCompleted: false,
  socialMediaPostCompletedDate: '',
  socialMediaPostNotes: '',
  actualSandwichCount: 0,
  actualSandwichTypes: [] as Array<{ type: string; quantity: number }>,
  actualSandwichCountRecordedDate: '',
  actualSandwichCountRecordedBy: '',

  // Follow-up tracking
  followUpOneDayCompleted: false,
  followUpOneDayDate: '',
  followUpOneMonthCompleted: false,
  followUpOneMonthDate: '',
  followUpNotes: '',

  // Assignments
  assignedRecipientIds: [] as string[],
} as const;

export type FormDataType = typeof DEFAULT_FORM_DATA;

/**
 * Get the server field name for a client field name.
 */
export function getServerFieldName(clientFieldName: string): string {
  return (FIELD_MAPPINGS.clientToServer as Record<string, string>)[clientFieldName] || clientFieldName;
}

/**
 * Get the client field name for a server field name.
 */
export function getClientFieldName(serverFieldName: string): string {
  return (FIELD_MAPPINGS.serverToClient as Record<string, string>)[serverFieldName] || serverFieldName;
}

/**
 * Check if a field is UI-only (not sent to server).
 */
export function isUiOnlyField(fieldName: string): boolean {
  return (UI_ONLY_FIELDS as readonly string[]).includes(fieldName);
}
