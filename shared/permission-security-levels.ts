import { PERMISSIONS } from './auth-utils';

/**
 * Permission Risk Levels
 * Helps admins understand the impact of granting each permission
 */
export type PermissionRiskLevel = 'safe' | 'moderate' | 'elevated' | 'critical';

export interface PermissionRiskInfo {
  level: PermissionRiskLevel;
  description: string;
  color: string;
  badgeColor: string;
  icon: string;
}

export const RISK_LEVEL_INFO: Record<PermissionRiskLevel, PermissionRiskInfo> =
  {
    safe: {
      level: 'safe',
      description: 'View-only or personal data. Low risk.',
      color: 'text-green-700',
      badgeColor: 'bg-green-100 text-green-800 border-green-300',
      icon: '👁️',
    },
    moderate: {
      level: 'moderate',
      description: 'Can create/edit own content. Medium risk.',
      color: 'text-blue-700',
      badgeColor: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: '✏️',
    },
    elevated: {
      level: 'elevated',
      description: "Can edit others' data or manage resources. Higher risk.",
      color: 'text-orange-700',
      badgeColor: 'bg-orange-100 text-orange-800 border-orange-300',
      icon: '⚠️',
    },
    critical: {
      level: 'critical',
      description:
        'Can delete data, manage users, or access sensitive info. Highest risk.',
      color: 'text-red-700',
      badgeColor: 'bg-red-100 text-red-800 border-red-300',
      icon: '🔥',
    },
  };

export const PERMISSION_RISK_LEVELS: Record<string, PermissionRiskLevel> = {
  // SAFE - View-only permissions
  [PERMISSIONS.HOSTS_VIEW]: 'safe',
  [PERMISSIONS.RECIPIENTS_VIEW]: 'safe',
  [PERMISSIONS.DRIVERS_VIEW]: 'safe',
  [PERMISSIONS.VOLUNTEERS_VIEW]: 'safe',
  [PERMISSIONS.USERS_VIEW]: 'safe',
  [PERMISSIONS.COLLECTIONS_VIEW]: 'safe',
  [PERMISSIONS.PROJECTS_VIEW]: 'safe',
  [PERMISSIONS.DISTRIBUTIONS_VIEW]: 'safe',
  [PERMISSIONS.EVENT_REQUESTS_VIEW]: 'safe',
  [PERMISSIONS.MESSAGES_VIEW]: 'safe',
  [PERMISSIONS.WORK_LOGS_VIEW]: 'safe',
  [PERMISSIONS.SUGGESTIONS_VIEW]: 'safe',
  [PERMISSIONS.AVAILABILITY_VIEW]: 'safe',
  [PERMISSIONS.GRANT_METRICS_VIEW]: 'safe',
  [PERMISSIONS.COOLERS_VIEW]: 'safe',
  [PERMISSIONS.VOLUNTEER_CALENDAR_VIEW]: 'safe',
  [PERMISSIONS.YEARLY_CALENDAR_VIEW]: 'safe',
  [PERMISSIONS.DOCUMENTS_VIEW]: 'safe',
  [PERMISSIONS.ANALYTICS_VIEW]: 'safe',
  [PERMISSIONS.AI_ANALYST_VIEW]: 'safe',
  [PERMISSIONS.MEETINGS_VIEW]: 'safe',
  [PERMISSIONS.TOOLKIT_ACCESS]: 'safe',
  [PERMISSIONS.ORGANIZATIONS_VIEW]: 'safe',
  [PERMISSIONS.KUDOS_VIEW]: 'safe',
  [PERMISSIONS.KUDOS_RECEIVE]: 'safe',

  // SAFE - Navigation (just UI visibility)
  [PERMISSIONS.NAV_DASHBOARD]: 'safe',
  [PERMISSIONS.NAV_MY_ACTIONS]: 'safe',
  [PERMISSIONS.NAV_MY_AVAILABILITY]: 'safe',
  [PERMISSIONS.NAV_TEAM_AVAILABILITY]: 'safe',
  [PERMISSIONS.NAV_VOLUNTEER_CALENDAR]: 'safe',
  [PERMISSIONS.NAV_YEARLY_CALENDAR]: 'safe',
  [PERMISSIONS.NAV_COLLECTIONS_LOG]: 'safe',
  [PERMISSIONS.NAV_TEAM_CHAT]: 'safe',
  [PERMISSIONS.NAV_INBOX]: 'safe',
  [PERMISSIONS.NAV_SUGGESTIONS]: 'safe',
  [PERMISSIONS.NAV_TEAM_BOARD]: 'safe',
  [PERMISSIONS.NAV_HOSTS]: 'safe',
  [PERMISSIONS.NAV_ROUTE_MAP]: 'safe',
  [PERMISSIONS.NAV_DRIVERS]: 'safe',
  [PERMISSIONS.NAV_VOLUNTEERS]: 'safe',
  [PERMISSIONS.NAV_RECIPIENTS]: 'safe',
  [PERMISSIONS.NAV_GROUPS_CATALOG]: 'safe',
  [PERMISSIONS.NAV_DISTRIBUTION_TRACKING]: 'safe',
  [PERMISSIONS.NAV_INVENTORY_CALCULATOR]: 'safe',
  [PERMISSIONS.NAV_WORK_LOG]: 'safe',
  [PERMISSIONS.NAV_EVENT_PLANNING]: 'safe',
  [PERMISSIONS.NAV_HISTORICAL_IMPORT]: 'safe',
  [PERMISSIONS.NAV_EVENTS_GOOGLE_SHEET]: 'safe',
  [PERMISSIONS.NAV_SIGNUP_GENIUS]: 'safe',
  [PERMISSIONS.NAV_PROJECTS]: 'safe',
  [PERMISSIONS.NAV_MEETINGS]: 'safe',
  [PERMISSIONS.NAV_ANALYTICS]: 'safe',
  [PERMISSIONS.NAV_GRANT_METRICS]: 'safe',
  [PERMISSIONS.NAV_WEEKLY_MONITORING]: 'safe',
  [PERMISSIONS.NAV_IMPORTANT_DOCUMENTS]: 'safe',
  [PERMISSIONS.NAV_IMPORTANT_LINKS]: 'safe',
  [PERMISSIONS.NAV_HELP]: 'safe',
  [PERMISSIONS.NAV_WISHLIST]: 'safe',
  [PERMISSIONS.NAV_COOLER_TRACKING]: 'safe',
  [PERMISSIONS.NAV_DOCUMENT_MANAGEMENT]: 'safe',
  [PERMISSIONS.NAV_USER_MANAGEMENT]: 'safe',
  [PERMISSIONS.NAV_TOOLKIT]: 'safe',
  [PERMISSIONS.NAV_FLYERS]: 'safe',
  [PERMISSIONS.NAV_VOLUNTEER_HANDBOOK]: 'safe',

  // SAFE - Chat access (read-only communication)
  [PERMISSIONS.CHAT_GENERAL]: 'safe',
  [PERMISSIONS.CHAT_DIRECT]: 'safe',
  [PERMISSIONS.CHAT_GROUP]: 'safe',
  [PERMISSIONS.CHAT_HOST]: 'safe',
  [PERMISSIONS.CHAT_DRIVER]: 'safe',
  [PERMISSIONS.CHAT_RECIPIENT]: 'safe',
  [PERMISSIONS.CHAT_GRANTS_COMMITTEE]: 'safe',
  [PERMISSIONS.CHAT_EVENTS_COMMITTEE]: 'safe',
  [PERMISSIONS.CHAT_WEB_COMMITTEE]: 'safe',
  [PERMISSIONS.CHAT_VOLUNTEER_MANAGEMENT]: 'safe',
  [PERMISSIONS.CHAT_CORE_TEAM]: 'safe',
  [PERMISSIONS.CHAT_BOARD]: 'safe',

  // MODERATE - Can add/edit own content
  [PERMISSIONS.COLLECTIONS_ADD]: 'moderate',
  [PERMISSIONS.COLLECTIONS_EDIT_OWN]: 'moderate',
  [PERMISSIONS.COLLECTIONS_DELETE_OWN]: 'moderate',
  [PERMISSIONS.COLLECTIONS_WALKTHROUGH]: 'moderate',
  [PERMISSIONS.PROJECTS_ADD]: 'moderate',
  [PERMISSIONS.PROJECTS_EDIT_OWN]: 'moderate',
  [PERMISSIONS.PROJECTS_DELETE_OWN]: 'moderate',
  [PERMISSIONS.EVENT_REQUESTS_ADD]: 'moderate',
  [PERMISSIONS.EVENT_REQUESTS_SELF_SIGNUP]: 'moderate',
  [PERMISSIONS.MESSAGES_SEND]: 'moderate',
  [PERMISSIONS.MESSAGES_EDIT]: 'moderate',
  [PERMISSIONS.WORK_LOGS_ADD]: 'moderate',
  [PERMISSIONS.WORK_LOGS_EDIT_OWN]: 'moderate',
  [PERMISSIONS.WORK_LOGS_DELETE_OWN]: 'moderate',
  [PERMISSIONS.SUGGESTIONS_ADD]: 'moderate',
  [PERMISSIONS.SUGGESTIONS_EDIT_OWN]: 'moderate',
  [PERMISSIONS.SUGGESTIONS_DELETE_OWN]: 'moderate',
  [PERMISSIONS.AVAILABILITY_ADD]: 'moderate',
  [PERMISSIONS.AVAILABILITY_EDIT_OWN]: 'moderate',
  [PERMISSIONS.AVAILABILITY_DELETE_OWN]: 'moderate',
  [PERMISSIONS.KUDOS_SEND]: 'moderate',
  [PERMISSIONS.COOLERS_REPORT]: 'moderate',
  [PERMISSIONS.YEARLY_CALENDAR_EDIT]: 'moderate',
  [PERMISSIONS.YEARLY_CALENDAR_ADD]: 'moderate',
  [PERMISSIONS.YEARLY_CALENDAR_EDIT_OWN]: 'moderate',
  [PERMISSIONS.YEARLY_CALENDAR_DELETE_OWN]: 'moderate',
  [PERMISSIONS.HOSTS_EDIT_OWN]: 'moderate', // Edit own host contact details (matched by email)

  // ELEVATED - Can edit others' data or manage resources
  [PERMISSIONS.HOSTS_ADD]: 'elevated',
  [PERMISSIONS.HOSTS_EDIT]: 'elevated',
  [PERMISSIONS.RECIPIENTS_ADD]: 'elevated',
  [PERMISSIONS.RECIPIENTS_EDIT]: 'elevated',
  [PERMISSIONS.DRIVERS_ADD]: 'elevated',
  [PERMISSIONS.DRIVERS_EDIT]: 'elevated',
  [PERMISSIONS.VOLUNTEERS_ADD]: 'elevated',
  [PERMISSIONS.VOLUNTEERS_EDIT]: 'elevated',
  [PERMISSIONS.COLLECTIONS_EDIT_ALL]: 'elevated',
  [PERMISSIONS.PROJECTS_EDIT_ALL]: 'elevated',
  [PERMISSIONS.DISTRIBUTIONS_ADD]: 'elevated',
  [PERMISSIONS.DISTRIBUTIONS_EDIT]: 'elevated',
  [PERMISSIONS.EVENT_REQUESTS_EDIT]: 'elevated',
  [PERMISSIONS.MANAGE_EVENTS]: 'elevated',
  [PERMISSIONS.EVENT_REQUESTS_ASSIGN_OTHERS]: 'elevated',
  [PERMISSIONS.EVENT_REQUESTS_SEND_TOOLKIT]: 'elevated',
  [PERMISSIONS.EVENT_REQUESTS_FOLLOW_UP]: 'elevated',
  [PERMISSIONS.EVENT_REQUESTS_COMPLETE_CONTACT]: 'elevated',
  [PERMISSIONS.WORK_LOGS_VIEW_ALL]: 'elevated',
  [PERMISSIONS.WORK_LOGS_EDIT_ALL]: 'elevated',
  [PERMISSIONS.SUGGESTIONS_EDIT_ALL]: 'elevated',
  [PERMISSIONS.SUGGESTIONS_MANAGE]: 'elevated',
  [PERMISSIONS.AVAILABILITY_EDIT_ALL]: 'elevated',
  [PERMISSIONS.GRANT_METRICS_EDIT]: 'elevated',
  [PERMISSIONS.COOLERS_MANAGE]: 'elevated',
  [PERMISSIONS.VOLUNTEER_CALENDAR_MANAGE]: 'elevated',
  [PERMISSIONS.DOCUMENTS_MANAGE]: 'elevated',
  [PERMISSIONS.DOCUMENTS_UPLOAD]: 'elevated',
  [PERMISSIONS.MEETINGS_MANAGE]: 'elevated',
  [PERMISSIONS.KUDOS_MANAGE]: 'elevated',
  [PERMISSIONS.DATA_EXPORT]: 'elevated',
  [PERMISSIONS.MESSAGES_MODERATE]: 'elevated',
  [PERMISSIONS.MANAGE_ANNOUNCEMENTS]: 'elevated',
  [PERMISSIONS.YEARLY_CALENDAR_EDIT_ALL]: 'elevated',

  // CRITICAL - Can delete data, manage users, or access sensitive information
  [PERMISSIONS.ADMIN_ACCESS]: 'critical',
  [PERMISSIONS.USERS_ADD]: 'critical',
  [PERMISSIONS.USERS_EDIT]: 'critical',
  [PERMISSIONS.USERS_DELETE]: 'critical',
  [PERMISSIONS.HOSTS_DELETE]: 'critical',
  [PERMISSIONS.RECIPIENTS_DELETE]: 'critical',
  [PERMISSIONS.DRIVERS_DELETE]: 'critical',
  [PERMISSIONS.VOLUNTEERS_DELETE]: 'critical',
  [PERMISSIONS.COLLECTIONS_DELETE_ALL]: 'critical',
  [PERMISSIONS.PROJECTS_DELETE_ALL]: 'critical',
  [PERMISSIONS.YEARLY_CALENDAR_DELETE_ALL]: 'critical',
  [PERMISSIONS.DISTRIBUTIONS_DELETE]: 'critical',
  [PERMISSIONS.EVENT_REQUESTS_DELETE]: 'critical',
  [PERMISSIONS.MESSAGES_DELETE]: 'critical',
  [PERMISSIONS.WORK_LOGS_DELETE_ALL]: 'critical',
  [PERMISSIONS.SUGGESTIONS_DELETE_ALL]: 'critical',
  [PERMISSIONS.AVAILABILITY_DELETE_ALL]: 'critical',
  [PERMISSIONS.DOCUMENTS_CONFIDENTIAL]: 'critical',
  [PERMISSIONS.DOCUMENTS_DELETE_ALL]: 'critical',
};

/**
 * Get the risk level for a permission
 */
export function getPermissionRiskLevel(
  permission: string
): PermissionRiskLevel {
  return PERMISSION_RISK_LEVELS[permission] || 'moderate';
}

/**
 * Get risk info for a permission
 */
export function getPermissionRiskInfo(permission: string): PermissionRiskInfo {
  const level = getPermissionRiskLevel(permission);
  return RISK_LEVEL_INFO[level];
}

/**
 * Count permissions by risk level
 */
export function countPermissionsByRisk(
  permissions: string[]
): Record<PermissionRiskLevel, number> {
  const counts: Record<PermissionRiskLevel, number> = {
    safe: 0,
    moderate: 0,
    elevated: 0,
    critical: 0,
  };

  permissions.forEach((perm) => {
    const level = getPermissionRiskLevel(perm);
    counts[level]++;
  });

  return counts;
}
