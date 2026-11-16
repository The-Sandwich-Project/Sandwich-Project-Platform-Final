/**
 * Shared Type Definitions
 *
 * Centralized type definitions to eliminate TypeScript `any` types
 * and provide type safety across the application.
 */

import type { User as DrizzleUser, ReminderRuleType } from './schema';

/**
 * SMS campaign a user can be opted into.
 * - 'hosts': Collection reminders for host locations
 * - 'events': Event coordination notifications (assignments, escalations, reminders)
 */
export type SmsCampaignType = 'hosts' | 'events';

/**
 * SMS Consent structure stored in user metadata
 */
export interface SmsConsent {
  enabled: boolean;
  phoneNumber: string;
  /** Masked phone for display (e.g. in the UI dialog) */
  displayPhone?: string;
  /** Confirmed opt-in state — must be 'confirmed' to actually send SMS */
  status?: 'pending_confirmation' | 'confirmed' | 'unsubscribed';
  confirmedAt?: string;
  confirmationMethod?: 'verification_code' | 'reply_yes' | 'manual';
  consentedAt?: string;
  consentTimestamp?: string;
  consentVersion?: string;
  welcomeSmsSentAt?: string;
  unsubscribedAt?: string | null;
  optOutTimestamp?: string;
  verificationCode?: string;
  verificationCodeExpiry?: string;
  campaignsUpdatedAt?: string;
  /** Legacy single-campaign field — kept in sync with campaignTypes[0] */
  campaignType?: SmsCampaignType;
  /** Canonical multi-campaign field — a user can be on both 'hosts' and 'events' */
  campaignTypes?: SmsCampaignType[];
}

/**
 * Event Notification Preferences
 * Configures when and how users receive reminders for events they're assigned to
 */
export interface EventNotificationPreferences {
  // Primary reminder settings
  primaryReminderEnabled: boolean; // Whether to send first reminder
  primaryReminderHours: number; // Hours before event (1-72, default 24)
  primaryReminderType: 'email' | 'sms' | 'both'; // Notification method

  // Secondary reminder settings (optional)
  secondaryReminderEnabled: boolean; // Whether to send second reminder
  secondaryReminderHours: number; // Hours before event (1-72)
  secondaryReminderType: 'email' | 'sms' | 'both'; // Notification method
}

/**
 * A single default reminder rule in the user's global preferences.
 * When a user has no per-event overrides, these rules apply automatically.
 */
export interface DefaultReminderRule {
  ruleType: ReminderRuleType;
  enabled: boolean;
  thresholdDays: number;
  /** Frequency for general_checkin; condition-based rules ignore this field */
  frequency: 'daily' | 'every_3_days' | 'weekly' | 'biweekly';
}

/**
 * Global Check-In Reminder Preferences
 * Stored in user metadata. Sets default reminder rules that apply to all
 * events unless overridden per-event. Eliminates the need to configure
 * reminders individually on every event card.
 *
 * Supports two tiers: standard (default) and corporate priority.
 * Corporate events use `corporateRules` if present, otherwise fall back
 * to `rules`.
 */
export interface CheckInReminderPreferences {
  /** Whether the user has configured their defaults (false = never set up) */
  configured: boolean;
  /** Default notification channel for all rules */
  defaultChannel: 'email' | 'sms' | 'both';
  /** Default rules and their thresholds (standard events) */
  rules: DefaultReminderRule[];
  /** Optional tighter rules for corporate priority events */
  corporateRules?: DefaultReminderRule[];
}

/**
 * User Metadata structure
 * Defines all properties that can be stored in the users.metadata JSONB field
 */
export interface UserMetadata {
  // Legacy password storage (deprecated - passwords now in users.password column)
  password?: string;

  // SMS consent and phone number
  smsConsent?: SmsConsent;

  // Event notification preferences
  eventNotificationPreferences?: EventNotificationPreferences;

  // Global check-in reminder defaults (applied to all events unless overridden)
  checkInReminderPreferences?: CheckInReminderPreferences;
  /**
   * When this user's existing backlog was rolled into one summary reminder.
   * Unset = next reminder run sends a summary instead of one reminder per
   * already-overdue event. Cleared when they save new reminder settings.
   */
  checkInRemindersBaselinedAt?: string;

  // Additional contact information
  phoneNumber?: string;
  address?: string;

  // Availability and preferences
  availability?: {
    [day: string]: string[]; // e.g., { "Monday": ["9AM-12PM", "2PM-5PM"] }
  };

  // Skills and interests
  skills?: string[];
  interests?: string[];

  // Emergency contact
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };

  // Onboarding status
  onboarding?: {
    completed: boolean;
    completedAt?: string;
    steps?: {
      [stepName: string]: boolean;
    };
  };

  // Notification preferences
  notificationPreferences?: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
    channels?: string[];
  };

  // Additional flexible metadata
  [key: string]: unknown;
}

/**
 * Full User type with properly typed metadata
 * Extends the Drizzle-inferred User type
 */
export interface User extends Omit<DrizzleUser, 'metadata' | 'permissions'> {
  metadata: UserMetadata | null;
  permissions: string[] | null;
}

/**
 * Minimal user interface for permission checking
 * Used in auth-utils and permission checking functions
 *
 * IMPORTANT - Permission Format Security:
 * - string[] (modern format, REQUIRED for unified-auth-utils.ts)
 * - number (legacy bitmask format, UNSAFE - only for TypeScript compatibility)
 * - null/undefined (no permissions assigned)
 *
 * SECURITY WARNING:
 * - unified-auth-utils.ts REJECTS numeric permissions (secure)
 * - auth-utils.ts accepts numeric permissions but unsafely grants all access (insecure)
 * - Numeric and unknown formats are included in type only to prevent TypeScript errors
 * - All users with numeric permissions MUST be migrated to string[] format
 */
export interface UserForPermissions {
  id: string;
  email?: string | null;
  role: string;
  permissions: unknown;
  isActive?: boolean | null;
}

/**
 * Session user data structure
 * Stored in express-session and used for authentication
 */
export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  profileImageUrl: string | null;
  role: string;
  permissions: string[];
  isActive: boolean;
}

/**
 * Type guard to check if user has properly typed metadata
 */
export function hasTypedMetadata(user: DrizzleUser | User): user is User {
  return user.metadata !== null && typeof user.metadata === 'object';
}

/**
 * Helper to safely access user metadata
 */
export function getUserMetadata(user: DrizzleUser | User | null | undefined): UserMetadata {
  if (!user || !user.metadata) {
    return {};
  }

  if (typeof user.metadata !== 'object') {
    return {};
  }

  return user.metadata as UserMetadata;
}

/**
 * Helper to get SMS consent from user metadata
 */
export function getSmsConsent(user: DrizzleUser | User | null | undefined): SmsConsent | null {
  const metadata = getUserMetadata(user);
  return metadata.smsConsent || null;
}

/**
 * Helper to get user phone number (from metadata or direct field)
 */
export function getUserPhoneNumber(user: DrizzleUser | User | null | undefined): string | null {
  if (!user) return null;

  // Check direct phone number field first
  if (user.phoneNumber) {
    return user.phoneNumber;
  }

  // Check SMS consent in metadata
  const smsConsent = getSmsConsent(user);
  if (smsConsent?.phoneNumber) {
    return smsConsent.phoneNumber;
  }

  // Check metadata phone number
  const metadata = getUserMetadata(user);
  if (metadata.phoneNumber) {
    return metadata.phoneNumber;
  }

  return null;
}

/**
 * Helper to get event notification preferences from user metadata
 * Returns default preferences if none are set
 */
export function getEventNotificationPreferences(
  user: DrizzleUser | User | null | undefined
): EventNotificationPreferences {
  const metadata = getUserMetadata(user);

  // Return user's preferences if they exist
  if (metadata.eventNotificationPreferences) {
    return metadata.eventNotificationPreferences;
  }

  // Return default preferences
  return {
    primaryReminderEnabled: true,
    primaryReminderHours: 24,
    primaryReminderType: 'email',
    secondaryReminderEnabled: false,
    secondaryReminderHours: 1,
    secondaryReminderType: 'email',
  };
}

/**
 * Organization-wide reminder defaults. Used for anyone who hasn't saved their
 * own settings in Profile → Alerts, so reminders work without setup.
 * Kept deliberately small to avoid flooding inboxes; users can turn on more.
 */
export const SYSTEM_DEFAULT_CHECK_IN_REMINDER_PREFERENCES: CheckInReminderPreferences = {
  configured: false,
  defaultChannel: 'email',
  rules: [
    { ruleType: 'no_contact', enabled: true, thresholdDays: 5, frequency: 'weekly' },
    { ruleType: 'stale_event', enabled: false, thresholdDays: 7, frequency: 'weekly' },
    { ruleType: 'date_approaching_inprocess', enabled: true, thresholdDays: 14, frequency: 'weekly' },
    { ruleType: 'date_approaching_scheduled', enabled: false, thresholdDays: 7, frequency: 'weekly' },
    { ruleType: 'staffing_unmet', enabled: true, thresholdDays: 7, frequency: 'weekly' },
    { ruleType: 'missing_details', enabled: true, thresholdDays: 7, frequency: 'weekly' },
    { ruleType: 'general_checkin', enabled: false, thresholdDays: 7, frequency: 'weekly' },
  ],
  corporateRules: [
    { ruleType: 'no_contact', enabled: true, thresholdDays: 3, frequency: 'every_3_days' },
    { ruleType: 'stale_event', enabled: false, thresholdDays: 3, frequency: 'every_3_days' },
    { ruleType: 'date_approaching_inprocess', enabled: true, thresholdDays: 21, frequency: 'every_3_days' },
    { ruleType: 'date_approaching_scheduled', enabled: false, thresholdDays: 14, frequency: 'every_3_days' },
    { ruleType: 'staffing_unmet', enabled: true, thresholdDays: 14, frequency: 'every_3_days' },
    { ruleType: 'missing_details', enabled: true, thresholdDays: 14, frequency: 'every_3_days' },
    { ruleType: 'general_checkin', enabled: false, thresholdDays: 7, frequency: 'every_3_days' },
  ],
};

/**
 * Helper to get check-in reminder preferences from user metadata.
 * Falls back to the organization defaults (configured: false) if the user
 * has never saved their own.
 */
export function getCheckInReminderPreferences(
  user: DrizzleUser | User | null | undefined
): CheckInReminderPreferences {
  const metadata = getUserMetadata(user);
  return metadata.checkInReminderPreferences ?? SYSTEM_DEFAULT_CHECK_IN_REMINDER_PREFERENCES;
}

// ============================================================================
// STANDARDIZED API RESPONSE TYPES
// ============================================================================

/**
 * Standard error codes for API responses
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

/**
 * Standardized API response envelope
 * All API endpoints should return this format for consistency
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: ApiErrorCode;
  /** Optional metadata (pagination, timing, etc.) */
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
    timestamp?: string;
  };
}

/**
 * Success response helper type
 */
export interface ApiSuccessResponse<T> extends ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Error response helper type
 */
export interface ApiErrorResponse extends ApiResponse<never> {
  success: false;
  error: string;
  code: ApiErrorCode;
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string,
  meta?: ApiResponse['meta']
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
    ...(meta && { meta }),
  };
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  error: string,
  code: ApiErrorCode = 'INTERNAL_ERROR',
  message?: string
): ApiErrorResponse {
  return {
    success: false,
    error,
    code,
    ...(message && { message }),
  };
}

// ============================================================================
// FIELD MAPPING UTILITIES
// Handles consistency between legacy and canonical field names
// ============================================================================

/**
 * Canonical field names - these are the AUTHORITATIVE field names
 * that should be used throughout the application
 */
export const CANONICAL_FIELDS = {
  // read status: canonical name is 'isRead'
  READ_STATUS: 'isRead',
  // focus areas: canonical name is 'focusAreas' (array)
  FOCUS_AREAS: 'focusAreas',
  // speaker status: canonical name is 'isSpeaker'
  SPEAKER_STATUS: 'isSpeaker',
} as const;

/**
 * Legacy field mappings - maps old field names to canonical names
 */
export const LEGACY_FIELD_MAPPINGS = {
  // Database field -> API field
  read: 'isRead',
  focusArea: 'focusAreas',
  willingToSpeak: 'isSpeaker',
} as const;

/**
 * Message with standardized field names for API responses
 */
export interface StandardMessage {
  id: number;
  conversationId?: number | null;
  userId: string;
  senderId: string;
  content: string;
  sender?: string | null;
  contextType?: string | null;
  contextId?: string | null;
  contextTitle?: string | null;
  /** Standardized read status (replaces legacy 'read' field) */
  isRead: boolean;
  editedAt?: Date | null;
  editedContent?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  replyToMessageId?: number | null;
  replyToContent?: string | null;
  replyToSender?: string | null;
  attachments?: MessageAttachment[] | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * Standardized attachment type
 * Use this instead of text or text[] for attachments
 */
export interface MessageAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

/**
 * Recipient with standardized field names for API responses
 */
export interface StandardRecipient {
  id: number;
  name: string;
  contactName?: string | null;
  phone: string;
  email?: string | null;
  website?: string | null;
  instagramHandle?: string | null;
  address?: string | null;
  region?: string | null;
  preferences?: string | null;
  weeklyEstimate?: number | null;
  /** Standardized focus areas (replaces legacy 'focusArea' field) */
  focusAreas: string[];
  status: string;
  contactPersonName?: string | null;
  contactPersonPhone?: string | null;
  contactPersonEmail?: string | null;
  contactPersonRole?: string | null;
  // ... other fields as needed
}

/**
 * Driver with standardized field names for API responses
 */
export interface StandardDriver {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** Standardized speaker status (replaces legacy 'willingToSpeak' field) */
  isSpeaker: boolean;
  // ... other fields as needed
}

/**
 * Volunteer with standardized field names for API responses
 */
export interface StandardVolunteer {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** Standardized speaker status */
  isSpeaker: boolean;
  isDriver: boolean;
  // ... other fields as needed
}

// ============================================================================
// FIELD TRANSFORMATION FUNCTIONS
// Use these when reading from/writing to database to ensure consistency
// ============================================================================

/**
 * Transform a database message to standardized API format
 * Converts 'read' to 'isRead' and parses attachments
 */
export function transformMessageForApi<T extends { read?: boolean; attachments?: string | null }>(
  dbMessage: T
): Omit<T, 'read' | 'attachments'> & { isRead: boolean; attachments: MessageAttachment[] | null } {
  const { read, attachments, ...rest } = dbMessage;

  // Parse attachments if stored as JSON string
  let parsedAttachments: MessageAttachment[] | null = null;
  if (attachments) {
    try {
      parsedAttachments = typeof attachments === 'string'
        ? JSON.parse(attachments)
        : attachments;
    } catch {
      parsedAttachments = null;
    }
  }

  return {
    ...rest,
    isRead: read ?? false,
    attachments: parsedAttachments,
  } as Omit<T, 'read' | 'attachments'> & { isRead: boolean; attachments: MessageAttachment[] | null };
}

/**
 * Transform a standardized message back to database format
 * Converts 'isRead' to 'read' and stringifies attachments
 */
export function transformMessageForDb<T extends { isRead?: boolean; attachments?: MessageAttachment[] | null }>(
  apiMessage: T
): Omit<T, 'isRead' | 'attachments'> & { read: boolean; attachments: string | null } {
  const { isRead, attachments, ...rest } = apiMessage;

  return {
    ...rest,
    read: isRead ?? false,
    attachments: attachments ? JSON.stringify(attachments) : null,
  } as Omit<T, 'isRead' | 'attachments'> & { read: boolean; attachments: string | null };
}

/**
 * Transform a database recipient to standardized API format
 * Converts 'focusArea' to 'focusAreas' array
 */
export function transformRecipientForApi<T extends { focusArea?: string | null; focusAreas?: string[] | null }>(
  dbRecipient: T
): Omit<T, 'focusArea'> & { focusAreas: string[] } {
  const { focusArea, focusAreas, ...rest } = dbRecipient;

  // Prefer focusAreas array, fall back to single focusArea
  let standardizedFocusAreas: string[] = [];
  if (Array.isArray(focusAreas) && focusAreas.length > 0) {
    standardizedFocusAreas = focusAreas;
  } else if (focusArea && typeof focusArea === 'string' && focusArea.trim()) {
    standardizedFocusAreas = [focusArea];
  }

  return {
    ...rest,
    focusAreas: standardizedFocusAreas,
  } as Omit<T, 'focusArea'> & { focusAreas: string[] };
}

/**
 * Transform a database driver to standardized API format
 * Converts 'willingToSpeak' to 'isSpeaker'
 */
export function transformDriverForApi<T extends { willingToSpeak?: boolean }>(
  dbDriver: T
): Omit<T, 'willingToSpeak'> & { isSpeaker: boolean } {
  const { willingToSpeak, ...rest } = dbDriver;

  return {
    ...rest,
    isSpeaker: willingToSpeak ?? false,
  } as Omit<T, 'willingToSpeak'> & { isSpeaker: boolean };
}

/**
 * Transform a standardized driver back to database format
 * Converts 'isSpeaker' to 'willingToSpeak'
 */
export function transformDriverForDb<T extends { isSpeaker?: boolean }>(
  apiDriver: T
): Omit<T, 'isSpeaker'> & { willingToSpeak: boolean } {
  const { isSpeaker, ...rest } = apiDriver;

  return {
    ...rest,
    willingToSpeak: isSpeaker ?? false,
  } as Omit<T, 'isSpeaker'> & { willingToSpeak: boolean };
}

/**
 * Generic field transformer for bulk operations
 * Maps legacy field names to canonical names in an object
 */
export function normalizeFieldNames<T extends Record<string, unknown>>(
  obj: T,
  mappings: Record<string, string> = LEGACY_FIELD_MAPPINGS
): T {
  const result = { ...obj };

  for (const [legacyName, canonicalName] of Object.entries(mappings)) {
    if (legacyName in result && !(canonicalName in result)) {
      (result as Record<string, unknown>)[canonicalName] = result[legacyName];
      delete (result as Record<string, unknown>)[legacyName];
    }
  }

  return result;
}
