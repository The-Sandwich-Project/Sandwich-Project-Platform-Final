/**
 * EventSchedulingForm - Shared Types
 *
 * Types shared between the main form and extracted section components.
 */

import type { EventRequest } from '@shared/schema';

/**
 * Form data state structure used throughout EventSchedulingForm
 */
export interface EventFormData {
  eventDate: string;
  backupDates: string[];
  eventStartTime: string;
  eventEndTime: string;
  pickupTime: string;
  pickupDateTime: string;
  pickupDate: string;
  pickupTimeSeparate: string;
  eventAddress: string;
  deliveryDestination: string;
  holdingOvernight: boolean;
  /** 'no' | 'option' | 'planned' (shared/next-day-pickup.ts). */
  nextDayPickup?: 'no' | 'option' | 'planned';
  /** true = TSP is buying the food; false = the group shops. */
  isTspShopped?: boolean;
  /** Why the van is needed when the estimate is under 800. */
  vanReason?: string;
  /** "Events team OK'd sharing the van" with another same-day van event. */
  vanTeamOk?: boolean;
  /**
   * The day the van is booked for (YYYY-MM-DD): the scheduled date, else the
   * requested one, until the date box is changed (then the new date). The
   * date box starts from the requested date, so after a reschedule the two
   * differ. Form-only; never sent.
   */
  vanDay?: string;
  overnightHoldingLocation: string;
  overnightPickupTime: string;
  sandwichTypes: Array<{ type: string; quantity: number }>;
  hasRefrigeration: string;
  driversNeeded: number;
  selfTransport: boolean;
  vanDriverNeeded: boolean;
  vanNeededFor: '' | 'transport' | 'refrigeration';
  assignedVanDriverId: string;
  isDhlVan: boolean;
  volunteersNeeded: number;
  tspContact: string;
  customTspContact: string;
  message: string;
  schedulingNotes: string;
  planningNotes: string;
  nextAction: string;
  totalSandwichCount: number;
  estimatedSandwichCountMin: number;
  estimatedSandwichCountMax: number;
  rangeSandwichType: string;
  /**
   * Set by the sandwich estimate editor while its text can't be read
   * ("lots", "2oo"); the form won't save until it's fixed. Never sent.
   */
  sandwichEstimateError?: string;
  /**
   * Authoritative estimated attendance. The server's legacy `volunteerCount`
   * column is derived from this in buildEventDataForServer — do not add it back
   * to form state.
   */
  estimatedAttendance: number;
  /** Expected attendees range ends; 0 for a single number. */
  estimatedAttendanceMin?: number;
  estimatedAttendanceMax?: number;
  /** Text the attendees box can't read; blocks saving. */
  attendanceError?: string;
  adultCount: number;
  childrenCount: number;
  status: string;
  toolkitSent: boolean;
  toolkitSentDate: string;
  toolkitStatus: string;
  // Completed event tracking fields
  socialMediaPostRequested: boolean;
  socialMediaPostRequestedDate: string;
  socialMediaPostCompleted: boolean;
  socialMediaPostCompletedDate: string;
  socialMediaPostNotes: string;
  actualSandwichCount: number;
  actualSandwichTypes: Array<{ type: string; quantity: number }>;
  actualSandwichCountRecordedDate: string;
  actualSandwichCountRecordedBy: string;
  followUpOneDayCompleted: boolean;
  followUpOneDayDate: string;
  followUpOneMonthCompleted: boolean;
  followUpOneMonthDate: string;
  followUpNotes: string;
  assignedRecipientIds: string[];
  // Manual entry source tracking
  manualEntrySource: string;
  // Contact information fields
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  organizationName: string;
  department: string;
  organizationCategory: string;
  schoolClassification: string;
  // Backup contact fields
  backupContactFirstName: string;
  backupContactLastName: string;
  backupContactEmail: string;
  backupContactPhone: string;
  backupContactRole: string;
  // Previously hosted flag
  previouslyHosted: string;
  // Delivery details for overnight holding
  deliveryTimeWindow: string;
  deliveryParkingAccess: string;
  // Date flexibility
  dateFlexible: boolean | null;
  // Kids age range
  kidsAgeRange: string;
  // Volunteer/Driver instructions
  driverInstructions: string;
  volunteerInstructions: string;
  // Standby follow-up
  standbyExpectedDate: string;
  // What the group is waiting on (Budget, Date/time, ...), plus details
  standbyReason: string;
  standbyNotes: string;
  // The check-back choice shown in the Standby details. Kept with the form
  // data (not separate state) so draft recovery and Discard include it. Not
  // sent to the server directly: on save it becomes standbyExpectedDate.
  standbyCheckBackMode: 'one_week' | 'specific' | 'none';
  standbyCheckBackDate: string;
  // Reason fields for cancelled / declined (filled by StatusReasonDialog
  // when the status dropdown is used in the edit form)
  cancelledReason: string;
  cancelledNotes: string;
  declinedReason: string;
  declinedNotes: string;
}

/**
 * Common props for form section components
 */
export interface FormSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<EventFormData>>;
}

/**
 * Section status tracking (used for completion indicators)
 */
export interface SectionStatus {
  contact: boolean;
  schedule: boolean;
  sandwiches: boolean;
  resources: boolean;
  notes: boolean;
}
