import {
  Clock,
  Phone,
  Calendar,
  CheckCircle,
  XCircle,
  Hourglass,
  AlertCircle,
  Ban,
  RefreshCw,
} from 'lucide-react';

// Re-export shared status workflow definitions for client use
export {
  STATUS_DEFINITIONS,
  VALID_STATUS_TRANSITIONS,
  isValidTransition,
  getTransitionError,
  requiresReason,
  getReasonField,
} from '@shared/event-status-workflow';
export type { EventStatus } from '@shared/event-status-workflow';

// Sandwich types: the choices are PB&J and Deli only. Older events may still
// hold turkey/ham (shown as Deli) or unknown, so those stay here for lookups.
export const SANDWICH_TYPES = [
  { value: 'pbj', label: 'PB&J' },
  { value: 'deli', label: 'Deli' },
  { value: 'deli_turkey', label: 'Deli' },
  { value: 'deli_ham', label: 'Deli' },
  { value: 'unknown', label: 'Unknown' },
] as const;

/** What people can pick for a sandwich type. */
export const SANDWICH_TYPE_CHOICES = [
  { value: 'pbj', label: 'PB&J' },
  { value: 'deli', label: 'Deli' },
] as const;

const LEGACY_DELI_TYPES = new Set(['deli_turkey', 'deli_ham', 'turkey', 'ham', 'chicken']);

/**
 * The picker value to SHOW for a stored type: older meat-specific types
 * select "Deli", anything else not offered shows as nothing picked. Display
 * only; the stored value changes only if someone picks a type.
 */
export function sandwichTypeChoiceValue(stored: string | null | undefined): string | undefined {
  const v = (stored || '').toLowerCase();
  if (LEGACY_DELI_TYPES.has(v)) return 'deli';
  return SANDWICH_TYPE_CHOICES.some((c) => c.value === v) ? v : undefined;
}

// Status color scheme - VIBRANT BRAND COLORS: Using TSP brand palette with high saturation
export const statusColors: Record<string, string> = {
  new: 'bg-gradient-to-br from-[#007E8C] to-[#47B3CB] text-white border-2 border-[#007E8C] shadow-md',
  in_process:
    'bg-gradient-to-br from-[#FBAD3F] to-[#ffc966] text-white border-2 border-[#FBAD3F] shadow-md',
  scheduled:
    'bg-gradient-to-br from-[#236383] to-[#2d7da5] text-white border-2 border-[#236383] shadow-md',
  rescheduled:
    'bg-gradient-to-br from-[#236383] to-[#2d7da5] text-white border-2 border-[#236383] shadow-md',
  completed:
    'bg-gradient-to-br from-[#47B3CB] to-[#6bc4d4] text-white border-2 border-[#47B3CB] shadow-md',
  declined:
    'bg-gradient-to-br from-[#A31C41] to-[#c5245a] text-white border-2 border-[#A31C41] font-bold shadow-lg',
  cancelled:
    'bg-gradient-to-br from-[#A31C41] to-[#c5245a] text-white border-2 border-[#A31C41] font-bold shadow-lg',
  non_event:
    'bg-gradient-to-br from-[#78716C] to-[#A8A29E] text-white border-2 border-[#78716C] shadow-md',
  standby:
    'bg-gradient-to-br from-[#9333EA] to-[#A855F7] text-white border-2 border-[#9333EA] shadow-md',
  stalled:
    'bg-gradient-to-br from-[#6B7280] to-[#9CA3AF] text-white border-2 border-[#6B7280] shadow-md',
};

// Card border colors for left border accent - VIBRANT BRAND COLORS
export const statusBorderColors: Record<string, string> = {
  new: '#007E8C', // Vibrant teal
  in_process: '#FBAD3F', // Vibrant orange
  scheduled: '#236383', // Vibrant dark blue
  rescheduled: '#236383', // Same as scheduled
  completed: '#47B3CB', // Vibrant light blue
  declined: '#A31C41', // Vibrant red
  cancelled: '#A31C41', // Vibrant red
  non_event: '#78716C', // Warm gray (stone)
  standby: '#9333EA', // Purple
  stalled: '#6B7280', // Gray
};

// Card background colors - SOLID LIGHTER TINTS (no opacity mixing)
export const statusBgColors: Record<string, string> = {
  new: 'bg-[#E2F5F6]', // Solid light teal
  in_process: 'bg-[#FFF4E5]', // Solid light gold
  scheduled: 'bg-[#E4EFF6]', // Solid light navy
  rescheduled: 'bg-[#E4EFF6]', // Same as scheduled
  completed: 'bg-[#E8F7FB]', // Solid light sky blue
  declined: 'bg-[#FAE7ED]', // Solid light crimson
  cancelled: 'bg-[#FAE7ED]', // Solid light crimson
  non_event: 'bg-[#F5F5F4]', // Light stone
  standby: 'bg-[#F3E8FF]', // Light purple
  stalled: 'bg-[#F3F4F6]', // Light gray
};

// My Assignment highlight color
export const myAssignmentColor = '#47B3CB'; // Light blue/cyan

export const SANDWICH_DESTINATIONS = [
  'Atlanta Community Food Bank',
  'Atlanta Mission',
  'Covenant House Georgia',
  'Gateway Center',
  'Hosea Helps',
  'Mercy Care',
  'Open Hand Atlanta',
  'Salvation Army',
  'St. Vincent de Paul',
  'The Atlanta Day Center',
  'The Extension',
  "The Shepherd's Inn",
  'Zaban Paradies Center',
];

export const statusIcons: Record<string, any> = {
  new: Clock,
  in_process: Phone,
  scheduled: Calendar,
  rescheduled: RefreshCw,
  completed: CheckCircle,
  declined: XCircle,
  cancelled: XCircle,
  non_event: Ban,
  standby: Hourglass,
  stalled: AlertCircle,
};

export const previouslyHostedOptions = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'i_dont_know', label: 'Unknown' },
];

export const statusOptions = [
  { value: 'new', label: 'New Request' },
  { value: 'in_process', label: 'In Process' },
  { value: 'standby', label: 'Standby' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'non_event', label: 'Non-Event' },
  { value: 'stalled', label: 'Stalled' },
];

// Status tooltips for accessibility - explains what each status means to non-technical users
export const statusTooltips: Record<string, string> = {
  new: 'New request awaiting initial review and contact',
  in_process: 'Has received the toolkit and at least one contact attempt has been made',
  scheduled: 'Event is on our calendar with the majority of details nailed down',
  rescheduled: 'Previously scheduled event now confirmed for a new date',
  completed: 'Event date has passed and the event was not cancelled',
  declined: 'Organization was in process but decided not to proceed',
  cancelled: 'Previously scheduled event cancelled without intention to reschedule',
  non_event: 'Not a real event request — e.g., sandwich drop-off, general inquiry',
  standby: 'Contact is waiting on something specific before planning can continue',
  stalled: 'All contact attempts have failed — event sidelined for now',
};

// Additional indicator tooltips for special badges
export const indicatorTooltips = {
  dateConfirmed: 'The event date has been confirmed with the organizer',
  datePending: 'Waiting for date confirmation from the organizer',
  needsFollowUp: 'This request requires follow-up action',
  datePassed: 'The scheduled date has passed - needs rescheduling or status update',
  openDate: 'No other events scheduled on this date',
  scheduledConflict: 'Other events are already scheduled on this date',
  inProcessConflict: 'Other events are being coordinated for this date',
  fullyStaffed: 'All required drivers and volunteers are assigned',
  partiallyStaffed: 'Some positions still need to be filled',
  notStaffed: 'Drivers or volunteers still needed',
  manualEntry: 'This event was manually entered (not from the request form)',
  selfTransport: 'The group will pick up and transport their own sandwiches',
  holdingOvernight: 'Sandwiches will be held overnight before delivery',
  onOfficialSheet: 'Event has been added to the official planning spreadsheet',
  notOnOfficialSheet: 'Event needs to be added to the official planning spreadsheet',
  overdue: 'This item is past its due date',
  toolkitFollowUp: 'Over 1 week since toolkit was sent - follow up needed',
  contactFollowUp: 'Over 1 week since last contact - follow up needed',
};
