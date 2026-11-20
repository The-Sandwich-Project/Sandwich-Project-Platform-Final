/**
 * Notification Suppression Utility
 *
 * Centralized list of users who should only receive specific notification types.
 * This replaces scattered per-user checks across multiple services.
 *
 * Users in SUPPRESSED_USERS receive ONLY:
 *   - New TSP contact assignment notifications
 *   - Comments on their events
 *
 * All other event alerts (follow-up reminders, escalations, weekly digests,
 * approaching-event warnings, etc.) are suppressed.
 */

/**
 * User IDs with suppressed event notifications.
 * These users only get TSP contact assignments and event comment notifications.
 */
const SUPPRESSED_USERS = new Set([
  'christine-cooper',
  'brigith-gonzalez',
  'brenda-bonilla',
]);

/**
 * Notification types that are ALLOWED even for suppressed users.
 */
type AllowedNotificationType =
  | 'tsp_contact_assignment'
  | 'event_comment';

/**
 * Check if a user's event notifications are suppressed.
 *
 * @param userId - The user ID to check
 * @returns true if the user should NOT receive general event alerts
 */
export function isNotificationSuppressed(userId: string): boolean {
  return SUPPRESSED_USERS.has(userId);
}

/**
 * Check if a specific notification should be sent to a user.
 * Returns true if the notification is allowed (should be sent).
 *
 * @param userId - The user ID to check
 * @param notificationType - The type of notification being sent
 * @returns true if notification should proceed, false if suppressed
 */
export function shouldSendNotificationToUser(
  userId: string,
  notificationType: AllowedNotificationType | string
): boolean {
  if (!SUPPRESSED_USERS.has(userId)) return true;

  // Only these notification types pass through for suppressed users
  return notificationType === 'tsp_contact_assignment' ||
         notificationType === 'event_comment';
}
