/**
 * Notification Tiering System for TSP Event Management
 *
 * This module defines the notification hierarchy to prevent alert fatigue:
 * - URGENT (SMS): Requires immediate action - new assignments, approaching deadlines
 * - IMPORTANT (Rich Email): Actionable but not time-critical - comments, changes, follow-up reminders
 * - DIGEST (Weekly Email): Operational overview - portfolio summary, completed events, next actions
 */

import { logger } from '../utils/production-safe-logger';

// ============================================================================
// NOTIFICATION TIER DEFINITIONS
// ============================================================================

export type NotificationTier = 'urgent' | 'important' | 'digest';
export type NotificationChannel = 'sms' | 'email' | 'both';

export interface NotificationTierConfig {
  tier: NotificationTier;
  channel: NotificationChannel;
  description: string;
  /** Whether this notification can be bundled into digest */
  digestable: boolean;
  /** Priority for ordering in UI/logs (lower = higher priority) */
  priority: number;
}

// ============================================================================
// EVENT REQUEST NOTIFICATION TYPES
// ============================================================================

export type EventNotificationType =
  // URGENT TIER - SMS
  | 'tsp_contact_assigned'           // You've been assigned to a new event
  | 'event_approaching_incomplete'   // Event in X days but not scheduled yet

  // IMPORTANT TIER - Rich Email
  | 'event_comment_added'            // Someone commented on your event
  | 'event_comment_reply'            // Someone replied to a comment thread
  | 'event_details_changed'          // Event details were modified
  | 'standby_followup_due'           // Standby event needs follow-up
  | 'inprocess_no_contact_week'      // In-process event with no contact in 7 days

  // DIGEST TIER - Weekly Summary
  | 'weekly_portfolio_digest';       // Monday morning portfolio overview

// ============================================================================
// TIER CONFIGURATION MAP
// ============================================================================

export const NOTIFICATION_TIER_CONFIG: Record<EventNotificationType, NotificationTierConfig> = {
  // URGENT - SMS Only
  tsp_contact_assigned: {
    tier: 'urgent',
    channel: 'sms',
    description: 'New event assignment notification',
    digestable: false,
    priority: 1,
  },
  event_approaching_incomplete: {
    tier: 'urgent',
    channel: 'sms',
    description: 'Event approaching but not yet scheduled',
    digestable: false,
    priority: 2,
  },

  // IMPORTANT - Rich Email
  event_comment_added: {
    tier: 'important',
    channel: 'email',
    description: 'New comment on event',
    digestable: true,
    priority: 10,
  },
  event_comment_reply: {
    tier: 'important',
    channel: 'email',
    description: 'Reply to comment thread',
    digestable: true,
    priority: 11,
  },
  event_details_changed: {
    tier: 'important',
    channel: 'email',
    description: 'Event details were modified',
    digestable: true,
    priority: 12,
  },
  standby_followup_due: {
    tier: 'important',
    channel: 'email',
    description: 'Standby event follow-up reminder',
    digestable: true,
    priority: 15,
  },
  inprocess_no_contact_week: {
    tier: 'important',
    channel: 'email',
    description: 'In-process event needs contact',
    digestable: true,
    priority: 14,
  },

  // DIGEST - Weekly Summary
  weekly_portfolio_digest: {
    tier: 'digest',
    channel: 'email',
    description: 'Weekly portfolio summary',
    digestable: false, // This IS the digest
    priority: 100,
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the notification channel for a given notification type
 */
export function getNotificationChannel(type: EventNotificationType): NotificationChannel {
  return NOTIFICATION_TIER_CONFIG[type].channel;
}

/**
 * Get the tier for a notification type
 */
export function getNotificationTier(type: EventNotificationType): NotificationTier {
  return NOTIFICATION_TIER_CONFIG[type].tier;
}

/**
 * Check if a notification should be sent via SMS
 */
export function shouldSendSMS(type: EventNotificationType): boolean {
  const channel = NOTIFICATION_TIER_CONFIG[type].channel;
  return channel === 'sms' || channel === 'both';
}

/**
 * Check if a notification should be sent via Email
 */
export function shouldSendEmail(type: EventNotificationType): boolean {
  const channel = NOTIFICATION_TIER_CONFIG[type].channel;
  return channel === 'email' || channel === 'both';
}

/**
 * Check if a notification can be bundled into weekly digest
 */
export function isDigestable(type: EventNotificationType): boolean {
  return NOTIFICATION_TIER_CONFIG[type].digestable;
}

// ============================================================================
// CONTACT SUCCESS CRITERIA
// ============================================================================

/**
 * Determines if an event has had "successful contact" based on your criteria:
 * - Status changed to 'scheduled'
 * - Contact log with successful response received
 * - Scheduling note indicating contact was made
 */
export interface ContactAttemptLogEntry {
  attemptNumber: number;
  timestamp: string;
  method: string;
  outcome: string;
  notes: string;
  createdBy: string;
  createdByName: string;
}

export interface CorporateFollowUpProtocol {
  status: 'not_started' | 'active' | 'completed' | 'stalled';
  protocolStartedAt?: string;
  initialCallMade?: boolean;
  initialCallOutcome?: 'answered' | 'voicemail' | 'no_answer' | null;
  successfulContactAt?: string;
  successfulContactBy?: string;
  finalOutcome?: 'yes' | 'no' | 'standby' | null;
  [key: string]: any;
}

/** Keywords that indicate successful contact in notes/outcomes */
const SUCCESS_INDICATORS = [
  'scheduled',
  'confirmed',
  'spoke with',
  'talked to',
  'connected with',
  'got in touch',
  'reached',
  'responded',
  'replied',
  'called back',
  'email response',
  'yes',
  'agreed',
  'booked',
];

/** Keywords that indicate unsuccessful attempts */
const UNSUCCESSFUL_INDICATORS = [
  'no answer',
  'voicemail',
  'left message',
  'no response',
  'unreachable',
  'wrong number',
  'bounced',
  'declined',
];

/**
 * Check if an event has had successful contact
 */
export function hasSuccessfulContact(
  status: string,
  contactAttemptsLog: ContactAttemptLogEntry[] | null,
  corporateFollowUpProtocol: CorporateFollowUpProtocol | null
): boolean {
  // Check 1: Status is terminal/inactive - no escalation needed
  // Include ALL non-active statuses to prevent false escalations
  if (['scheduled', 'completed', 'declined', 'cancelled', 'stalled', 'standby', 'non_event'].includes(status)) {
    return true;
  }

  // Check 2: Corporate protocol shows successful contact
  if (corporateFollowUpProtocol?.successfulContactAt) {
    return true;
  }
  if (corporateFollowUpProtocol?.finalOutcome === 'yes') {
    return true;
  }

  // Check 3: Contact log has entry indicating successful response
  if (contactAttemptsLog && Array.isArray(contactAttemptsLog)) {
    for (const entry of contactAttemptsLog) {
      const outcomeAndNotes = `${entry.outcome || ''} ${entry.notes || ''}`.toLowerCase();

      // Check for success indicators
      const hasSuccessIndicator = SUCCESS_INDICATORS.some(indicator =>
        outcomeAndNotes.includes(indicator.toLowerCase())
      );

      // Make sure it's not actually an unsuccessful attempt
      const hasUnsuccessfulIndicator = UNSUCCESSFUL_INDICATORS.some(indicator =>
        outcomeAndNotes.includes(indicator.toLowerCase())
      );

      if (hasSuccessIndicator && !hasUnsuccessfulIndicator) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the timestamp of the last contact attempt
 */
export function getLastContactAttemptTime(
  lastContactAttempt: Date | string | null,
  contactAttemptsLog: ContactAttemptLogEntry[] | null
): Date | null {
  // First check the dedicated field
  if (lastContactAttempt) {
    return new Date(lastContactAttempt);
  }

  // Fall back to the log
  if (contactAttemptsLog && Array.isArray(contactAttemptsLog) && contactAttemptsLog.length > 0) {
    // Sort by timestamp descending and get the most recent
    const sorted = [...contactAttemptsLog].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return new Date(sorted[0].timestamp);
  }

  return null;
}


// ============================================================================
// EVENT APPROACHING CRITERIA
// ============================================================================

/**
 * Check if an event is approaching and needs urgent attention
 * Criteria: Event date within X days + status still 'in_process' or 'new'
 */
export function isEventApproachingIncomplete(
  status: string,
  eventDate: Date | string | null,
  daysThreshold: number = 5
): boolean {
  // Only applies to events not yet scheduled
  if (!['new', 'in_process'].includes(status)) {
    return false;
  }

  if (!eventDate) {
    return false;
  }

  const eventDateTime = new Date(eventDate);
  const now = new Date();
  const daysUntilEvent = (eventDateTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  // Event is within threshold days and in the future
  return daysUntilEvent > 0 && daysUntilEvent <= daysThreshold;
}

// ============================================================================
// STALE EVENT CRITERIA
// ============================================================================

/**
 * Check if an in-process event needs weekly reminder (no contact in 7 days)
 */
export function needsWeeklyContactReminder(
  status: string,
  lastContactAttempt: Date | string | null,
  contactAttemptsLog: ContactAttemptLogEntry[] | null
): boolean {
  // Only applies to in-process events
  if (status !== 'in_process') {
    return false;
  }

  const lastAttemptTime = getLastContactAttemptTime(lastContactAttempt, contactAttemptsLog);

  if (!lastAttemptTime) {
    // No contact attempts = definitely needs reminder
    return true;
  }

  const daysSinceLastContact = (Date.now() - lastAttemptTime.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceLastContact >= 7;
}

/**
 * Check if an event should escalate to admin (2+ weeks no contact)
 */
export function shouldEscalateToAdmin(
  status: string,
  lastContactAttempt: Date | string | null,
  contactAttemptsLog: ContactAttemptLogEntry[] | null
): boolean {
  // Only applies to in-process events
  if (status !== 'in_process') {
    return false;
  }

  const lastAttemptTime = getLastContactAttemptTime(lastContactAttempt, contactAttemptsLog);

  if (!lastAttemptTime) {
    // No contact attempts at all - should definitely escalate if event has been around long enough
    // But we need more context (creation date) to make this call
    return false;
  }

  const daysSinceLastContact = (Date.now() - lastAttemptTime.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceLastContact >= 14; // 2 weeks
}

// ============================================================================
// DIGEST DATA STRUCTURES
// ============================================================================

export interface DigestEventSummary {
  eventId: number;
  organizationName: string;
  status: string;
  eventDate: string | null;
  nextAction: string;
  urgency: 'high' | 'medium' | 'low';
  daysSinceLastContact: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface WeeklyDigestData {
  tspContactId: string;
  tspContactName: string;
  tspContactEmail: string;

  /** Active events requiring attention */
  activeEvents: DigestEventSummary[];

  /**
   * Scheduled events happening within the next 7 days that were
   * put on the calendar more than 14 days before the event date.
   * These need a pre-event contact check-in.
   */
  upcomingContactNeeded: DigestEventSummary[];

  /** Events completed in the last week */
  recentlyCompleted: DigestEventSummary[];

  /** Historical completed events (last 5) */
  completedHistory: DigestEventSummary[];

  /** Summary stats */
  stats: {
    totalActive: number;
    needsUrgentAttention: number;
    completedThisWeek: number;
    totalCompletedAllTime: number;
  };

  generatedAt: Date;
}

/**
 * Determine the next action needed for an event
 */
export function getNextActionForEvent(
  status: string,
  lastContactAttempt: Date | string | null,
  eventDate: Date | string | null,
  toolkitStatus: string | null,
): string {
  switch (status) {
    case 'new':
      return 'Make initial contact with organization';

    case 'in_process':
      const daysSinceContact = lastContactAttempt
        ? Math.floor((Date.now() - new Date(lastContactAttempt).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (daysSinceContact && daysSinceContact >= 7) {
        return `Contact overdue (${daysSinceContact} days) - follow up to schedule`;
      }

      if (eventDate) {
        const daysUntil = Math.floor((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 5 && daysUntil > 0) {
          return `EVENT IN ${daysUntil} DAYS - Confirm scheduling immediately`;
        }
      }

      return 'Continue coordination to finalize event date';

    case 'scheduled':
      if (eventDate) {
        const daysUntil = Math.floor((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 3 && daysUntil > 0) {
          return `Event in ${daysUntil} days - confirm final details`;
        }
      }
      return 'Scheduled - monitor for any changes needed';

    case 'standby':
      return 'Check in with organization about timeline';

    case 'stalled':
      return 'Review - consider final outreach or closing';

    default:
      return 'Review event status';
  }
}

/**
 * Determine urgency level for digest display
 */
export function getEventUrgency(
  status: string,
  eventDate: Date | string | null,
  lastContactAttempt: Date | string | null,
): 'high' | 'medium' | 'low' {

  // Event approaching but not scheduled
  if (eventDate && ['new', 'in_process'].includes(status)) {
    const daysUntil = (new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntil <= 5 && daysUntil > 0) {
      return 'high';
    }
  }

  // No contact in a while
  if (status === 'in_process' && lastContactAttempt) {
    const daysSinceContact = (Date.now() - new Date(lastContactAttempt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceContact >= 14) {
      return 'high';
    }
    if (daysSinceContact >= 7) {
      return 'medium';
    }
  }

  // Standby events need periodic attention
  if (status === 'standby') {
    return 'medium';
  }

  return 'low';
}

export default {
  NOTIFICATION_TIER_CONFIG,
  getNotificationChannel,
  getNotificationTier,
  shouldSendSMS,
  shouldSendEmail,
  isDigestable,
  hasSuccessfulContact,
  getLastContactAttemptTime,
  isEventApproachingIncomplete,
  needsWeeklyContactReminder,
  shouldEscalateToAdmin,
  getNextActionForEvent,
  getEventUrgency,
};
