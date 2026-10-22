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
   * Authoritative estimated attendance. The server's legacy `volunteerCount`
   * column is derived from this in buildEventDataForServer — do not add it back
   * to form state.
   */
  estimatedAttendance: number;
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
  // Corporate priority
  isCorporatePriority: boolean;
  // Date flexibility
  dateFlexible: boolean | null;
  // Kids age range
  kidsAgeRange: string;
  // Volunteer/Driver instructions
  driverInstructions: string;
  volunteerInstructions: string;
  // Standby follow-up
  standbyExpectedDate: string;
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
