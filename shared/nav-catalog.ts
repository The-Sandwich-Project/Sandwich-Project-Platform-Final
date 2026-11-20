import { PERMISSIONS } from './auth-utils';

/**
 * Single source of truth for sidebar (and top-nav) destinations.
 *
 * The client attaches icons and renders from this catalog. The Permissions UI
 * "Navigation Tabs" list is generated from it. Every item MUST have a
 * permissionKey that exists on PERMISSIONS — enforced by tests/unit/nav-catalog.test.ts.
 *
 * defaultGrant: 'all_users' preserves current visibility for items that were
 * previously ungated. CAM uncheck will not hide those until this flag is
 * removed after grants are seeded onto existing users.
 */
export type NavDefaultGrant = 'all_users' | 'allow_list';

export type NavGroupId =
  | 'home'
  | 'events'
  | 'calendars'
  | 'volunteer-resources'
  | 'directory'
  | 'communication'
  | 'operations'
  | 'resources'
  | 'data'
  | 'admin'
  | 'help';

export interface NavCatalogItem {
  id: string;
  label: string;
  href: string;
  permissionKey: string;
  group: NavGroupId;
  /** Opens this URL in a new tab instead of an in-app section. */
  externalUrl?: string;
  /** In-app href that should still be treated as leaving the dashboard. */
  external?: boolean;
  /** Hide from the sidebar; render in the header support menu instead. */
  topNav?: boolean;
  /**
   * Label for the Permissions UI when several items share one permissionKey.
   * Defaults to `label`.
   */
  permissionLabel?: string;
  defaultGrant?: NavDefaultGrant;
  /**
   * In-app live view of an external document (e.g. Google Sheet).
   * The renderer applies distinct styling; do not put colors here.
   */
  liveSheet?: boolean;
}

export const NAV_SECTION_ORDER: readonly NavGroupId[] = [
  'home',
  'events',
  'communication',
  'calendars',
  'volunteer-resources',
  'directory',
  'operations',
  'resources',
  'data',
  'admin',
];

export const NAV_GROUP_LABELS: Record<string, string> = {
  home: 'Home',
  events: 'Events',
  calendars: 'Calendars',
  'volunteer-resources': 'Volunteer Resources',
  directory: 'Directory',
  communication: 'Communication',
  operations: 'Operations',
  resources: 'Resources',
  data: 'Data & Reports',
  admin: 'Admin',
  help: 'Help',
};

/**
 * Pages that have a permission / CAM toggle but no sidebar entry.
 * These stay in getNavigationTabEntries() so Component Access Manager can
 * still assign them; they are not rendered in the sidebar.
 */
export const NAV_GHOST_FEATURES = [
  {
    permissionKey: PERMISSIONS.NAV_AUTO_FORM_FILLER,
    label: 'Auto Form Filler',
    href: '/dashboard?section=auto-form-filler',
    note: 'Real page, no sidebar item. Reached from Toolkit & Apps / resources.',
  },
  {
    permissionKey: PERMISSIONS.NAV_MY_ACTIONS,
    label: 'My Actions',
    href: null,
    note: 'Permission exists (Help references it); no current page or nav item.',
  },
] as const;

const SIGNUP_GENIUS_URL =
  'https://www.signupgenius.com/go/5080A4BA5AA22A7F94-50444894-thesandwich#/';
const VOLUNTEER_HANDBOOK_URL = 'https://tsp-host-handbook-ylfb92u.gamma.site/';
const INVENTORY_CALCULATOR_URL =
  'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html';

export const NAV_CATALOG: NavCatalogItem[] = [
  // HOME
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: 'dashboard',
    permissionKey: PERMISSIONS.NAV_DASHBOARD,
    group: 'home',
    defaultGrant: 'all_users',
  },
  {
    id: 'collections',
    label: 'Collections Log',
    href: 'collections',
    permissionKey: PERMISSIONS.NAV_COLLECTIONS_LOG,
    group: 'home',
  },

  // EVENTS
  {
    id: 'event-requests',
    label: 'Event Requests',
    href: 'event-requests',
    permissionKey: PERMISSIONS.NAV_EVENT_PLANNING,
    group: 'events',
    permissionLabel: 'Event Planning',
  },
  {
    id: 'event-ops-dashboard',
    label: 'Events Operations Dashboard',
    href: 'event-ops-dashboard',
    permissionKey: PERMISSIONS.NAV_EVENT_PLANNING,
    group: 'events',
    permissionLabel: 'Event Planning',
  },
  {
    id: 'driver-planning',
    label: 'Driver Planning',
    href: 'driver-planning',
    permissionKey: PERMISSIONS.NAV_DRIVER_PLANNING,
    group: 'events',
  },
  {
    id: 'events',
    label: 'Events Google Sheet',
    href: 'events',
    permissionKey: PERMISSIONS.NAV_EVENTS_GOOGLE_SHEET,
    group: 'events',
    liveSheet: true,
  },

  // CALENDARS (was a flyout under Events)
  {
    id: 'yearly-calendar',
    label: 'Yearly Calendar',
    href: 'yearly-calendar',
    permissionKey: PERMISSIONS.NAV_YEARLY_CALENDAR,
    group: 'calendars',
  },
  {
    id: 'my-availability',
    label: 'My Availability',
    href: 'my-availability',
    permissionKey: PERMISSIONS.NAV_MY_AVAILABILITY,
    group: 'calendars',
  },
  {
    id: 'team-availability',
    label: 'Team Availability',
    href: 'team-availability',
    permissionKey: PERMISSIONS.NAV_TEAM_AVAILABILITY,
    group: 'calendars',
  },
  {
    id: 'google-calendar-availability',
    label: 'Volunteer Calendar',
    href: 'google-calendar-availability',
    permissionKey: PERMISSIONS.NAV_VOLUNTEER_CALENDAR,
    group: 'calendars',
  },

  // VOLUNTEER RESOURCES (content, not people records)
  {
    id: 'volunteer-hub',
    label: 'Volunteer Hub',
    href: 'volunteer-hub',
    permissionKey: PERMISSIONS.NAV_VOLUNTEER_HUB,
    group: 'volunteer-resources',
  },
  {
    id: 'host-resources',
    label: 'Host Resources',
    href: 'host-resources',
    permissionKey: PERMISSIONS.NAV_HOST_RESOURCES,
    group: 'volunteer-resources',
  },
  {
    id: 'volunteer-handbook',
    label: 'Volunteer Handbook',
    href: 'volunteer-handbook',
    permissionKey: PERMISSIONS.NAV_VOLUNTEER_HANDBOOK,
    group: 'volunteer-resources',
    externalUrl: VOLUNTEER_HANDBOOK_URL,
    defaultGrant: 'all_users',
  },

  // DIRECTORY (people / org records)
  {
    id: 'volunteers',
    label: 'Volunteers Directory',
    href: 'volunteers',
    permissionKey: PERMISSIONS.NAV_VOLUNTEERS,
    group: 'directory',
  },
  {
    id: 'drivers',
    label: 'Drivers Directory',
    href: 'drivers',
    permissionKey: PERMISSIONS.NAV_DRIVERS,
    group: 'directory',
  },
  {
    id: 'hosts',
    label: 'Hosts Directory',
    href: 'hosts',
    permissionKey: PERMISSIONS.NAV_HOSTS,
    group: 'directory',
  },
  {
    id: 'event-contacts-directory',
    label: 'Event Contacts',
    href: 'event-contacts-directory',
    permissionKey: PERMISSIONS.NAV_HOSTS,
    group: 'directory',
    permissionLabel: 'Hosts Directory',
  },
  {
    id: 'recipients',
    label: 'Recipients Directory',
    href: 'recipients',
    permissionKey: PERMISSIONS.NAV_RECIPIENTS,
    group: 'directory',
  },
  {
    id: 'groups-catalog',
    label: 'Groups Catalog',
    href: 'groups-catalog',
    permissionKey: PERMISSIONS.NAV_GROUPS_CATALOG,
    group: 'directory',
  },
  {
    id: 'groups-insights',
    label: 'Groups Engagement Insights',
    href: 'groups-insights',
    permissionKey: PERMISSIONS.NAV_GROUPS_CATALOG,
    group: 'directory',
  },
  {
    id: 'maps',
    label: 'Event Map',
    href: 'event-map',
    permissionKey: PERMISSIONS.NAV_MAPS,
    group: 'directory',
  },
  {
    id: 'route-map',
    label: 'Locations Map',
    href: 'route-map',
    permissionKey: PERMISSIONS.NAV_HOSTS,
    group: 'directory',
    permissionLabel: 'Hosts Directory',
  },

  // COMMUNICATION
  {
    id: 'chat',
    label: 'Team Chat',
    href: 'chat',
    permissionKey: PERMISSIONS.NAV_TEAM_CHAT,
    group: 'communication',
  },
  {
    id: 'chat-dms',
    label: 'Direct Messages',
    href: 'chat?tab=dms',
    permissionKey: PERMISSIONS.NAV_TEAM_CHAT,
    group: 'communication',
    permissionLabel: 'Team Chat',
  },
  {
    id: 'chat-groups',
    label: 'Group Messages',
    href: 'chat?tab=groups',
    permissionKey: PERMISSIONS.NAV_TEAM_CHAT,
    group: 'communication',
    permissionLabel: 'Team Chat',
  },
  {
    id: 'inbox-consolidated',
    label: 'Project Threads',
    href: 'gmail-inbox',
    permissionKey: PERMISSIONS.NAV_INBOX,
    group: 'communication',
  },
  {
    id: 'kudos',
    label: 'Kudos',
    href: 'kudos',
    permissionKey: PERMISSIONS.KUDOS_VIEW,
    group: 'communication',
  },
  {
    id: 'team-board',
    label: 'Holding Zone',
    href: 'team-board',
    permissionKey: PERMISSIONS.VIEW_HOLDING_ZONE,
    group: 'communication',
  },

  // OPERATIONS (was miscategorized under Settings)
  {
    id: 'work-log',
    label: 'Work Log',
    href: 'work-log',
    permissionKey: PERMISSIONS.NAV_WORK_LOG,
    group: 'operations',
  },
  {
    id: 'expenses',
    label: 'Expenses & Receipts',
    href: 'expenses',
    permissionKey: PERMISSIONS.NAV_EXPENSES,
    group: 'operations',
  },
  {
    id: 'projects',
    label: 'Projects',
    href: 'projects',
    permissionKey: PERMISSIONS.NAV_PROJECTS,
    group: 'operations',
  },
  {
    id: 'meetings',
    label: 'Meetings',
    href: 'meetings',
    permissionKey: PERMISSIONS.NAV_MEETINGS,
    group: 'operations',
  },
  {
    id: 'promotion',
    label: 'Social Media Graphics',
    href: 'promotion',
    permissionKey: PERMISSIONS.NAV_PROMOTION,
    group: 'operations',
  },
  {
    id: 'donation-tracking',
    label: 'Distribution Tracking',
    href: 'donation-tracking',
    permissionKey: PERMISSIONS.NAV_DISTRIBUTION_TRACKING,
    group: 'operations',
  },
  {
    id: 'generate-service-hours',
    label: 'Service Hours Form',
    href: 'generate-service-hours',
    permissionKey: PERMISSIONS.NAV_SERVICE_HOURS_FORM,
    group: 'operations',
  },

  // RESOURCES
  {
    id: 'resources',
    label: 'Reference Materials',
    href: 'resources',
    permissionKey: PERMISSIONS.NAV_RESOURCES,
    group: 'resources',
  },
  {
    id: 'quick-tools',
    label: 'Toolkit & Apps',
    href: 'important-links',
    permissionKey: PERMISSIONS.NAV_IMPORTANT_LINKS,
    group: 'resources',
    defaultGrant: 'all_users',
  },
  {
    id: 'flyers',
    label: 'Flyers',
    href: 'flyers',
    permissionKey: PERMISSIONS.NAV_FLYERS,
    group: 'resources',
    defaultGrant: 'all_users',
  },
  {
    id: 'signup-genius',
    label: 'SignUpGenius',
    href: 'signup-genius',
    permissionKey: PERMISSIONS.NAV_SIGNUP_GENIUS,
    group: 'resources',
    externalUrl: SIGNUP_GENIUS_URL,
  },
  {
    id: 'inventory-calculator',
    label: 'Inventory Calculator',
    href: 'inventory-calculator',
    permissionKey: PERMISSIONS.NAV_INVENTORY_CALCULATOR,
    group: 'resources',
    externalUrl: INVENTORY_CALCULATOR_URL,
    external: true,
  },
  {
    id: 'wishlist',
    label: 'Wishlist Manager',
    href: 'wishlist',
    permissionKey: PERMISSIONS.NAV_WISHLIST,
    group: 'resources',
  },
  {
    id: 'quick-sms-links',
    label: 'Quick SMS Links',
    href: 'quick-sms-links',
    permissionKey: PERMISSIONS.NAV_QUICK_SMS_LINKS,
    group: 'resources',
  },

  // DATA & REPORTS
  {
    id: 'analytics',
    label: 'Analytics',
    href: 'analytics',
    permissionKey: PERMISSIONS.NAV_ANALYTICS,
    group: 'data',
  },
  {
    id: 'event-impact-reports',
    label: 'Event Impact Reports',
    href: 'event-impact-reports',
    permissionKey: PERMISSIONS.NAV_EVENT_IMPACT_REPORTS,
    group: 'data',
  },
  {
    id: 'grant-metrics',
    label: 'Grant Metrics',
    href: 'grant-metrics',
    permissionKey: PERMISSIONS.NAV_GRANT_METRICS,
    group: 'data',
  },
  {
    id: 'weekly-collections-report',
    label: 'Weekly Collections Report',
    href: 'weekly-collections-report',
    permissionKey: PERMISSIONS.NAV_WEEKLY_COLLECTIONS_REPORT,
    group: 'data',
  },
  {
    id: 'group-collections',
    label: 'Group Collections Viewer',
    href: 'group-collections',
    permissionKey: PERMISSIONS.NAV_GROUP_COLLECTIONS,
    group: 'data',
  },
  {
    id: 'weekly-monitoring',
    label: 'Weekly Monitoring',
    href: 'weekly-monitoring',
    permissionKey: PERMISSIONS.NAV_WEEKLY_MONITORING,
    group: 'data',
  },
  {
    id: 'cooler-tracking',
    label: 'Cooler Tracking',
    href: 'cooler-tracking',
    permissionKey: PERMISSIONS.NAV_COOLER_TRACKING,
    group: 'data',
  },

  // ADMIN
  {
    id: 'admin',
    label: 'Admin Panel',
    href: 'admin',
    permissionKey: PERMISSIONS.ADMIN_PANEL_ACCESS,
    group: 'admin',
  },
  {
    id: 'user-management',
    label: 'User Management',
    href: 'user-management',
    permissionKey: PERMISSIONS.NAV_USER_MANAGEMENT,
    group: 'admin',
  },
  {
    id: 'historical-import',
    label: 'Historical Import',
    href: 'historical-import',
    permissionKey: PERMISSIONS.NAV_HISTORICAL_IMPORT,
    group: 'admin',
  },
  {
    // Super admins and admins (the page and its API check the role).
    id: 'people-admin',
    label: 'People',
    href: 'people-admin',
    permissionKey: PERMISSIONS.ADMIN_PANEL_ACCESS,
    group: 'admin',
    permissionLabel: 'Admin Panel',
  },
  {
    id: 'organizations-merge',
    label: 'Merge Organizations',
    href: 'organizations-merge',
    permissionKey: PERMISSIONS.ADMIN_PANEL_ACCESS,
    group: 'admin',
    permissionLabel: 'Admin Panel',
  },
  {
    id: 'document-management',
    label: 'Document Management',
    href: 'document-management',
    permissionKey: PERMISSIONS.NAV_DOCUMENT_MANAGEMENT,
    group: 'admin',
  },
  {
    id: 'smart-search-admin',
    label: 'SmartSearch AI',
    href: 'smart-search-admin',
    permissionKey: PERMISSIONS.NAV_SMART_SEARCH_ADMIN,
    group: 'admin',
  },

  // Header support menu (not sidebar)
  {
    id: 'help',
    label: 'Help',
    href: 'help',
    permissionKey: PERMISSIONS.NAV_HELP,
    group: 'help',
    topNav: true,
  },
  {
    id: 'suggestions',
    label: 'Suggestions',
    href: 'suggestions',
    permissionKey: PERMISSIONS.NAV_SUGGESTIONS,
    group: 'communication',
    topNav: true,
  },
];

const PERMISSION_VALUE_SET = new Set<string>(Object.values(PERMISSIONS));

export function isKnownPermissionKey(key: string): boolean {
  return PERMISSION_VALUE_SET.has(key);
}

export function getSidebarNavCatalog(): NavCatalogItem[] {
  return NAV_CATALOG.filter((item) => !item.topNav);
}

/** Unique permission keys for the Permissions UI Navigation Tabs list. */
export function getNavigationTabEntries(): Array<{
  permissionKey: string;
  label: string;
}> {
  const seen = new Set<string>();
  const entries: Array<{ permissionKey: string; label: string }> = [];
  for (const item of NAV_CATALOG) {
    if (seen.has(item.permissionKey)) continue;
    seen.add(item.permissionKey);
    entries.push({
      permissionKey: item.permissionKey,
      label: item.permissionLabel || item.label,
    });
  }
  for (const ghost of NAV_GHOST_FEATURES) {
    if (seen.has(ghost.permissionKey)) continue;
    seen.add(ghost.permissionKey);
    entries.push({
      permissionKey: ghost.permissionKey,
      label: ghost.label,
    });
  }
  return entries;
}

export function getNavigationTabPermissionKeys(): string[] {
  return getNavigationTabEntries().map((entry) => entry.permissionKey);
}

export function getNavLabelForPermission(permission: string): string | undefined {
  const match = NAV_CATALOG.find((item) => item.permissionKey === permission);
  if (match) return match.permissionLabel || match.label;
  const ghost = NAV_GHOST_FEATURES.find((item) => item.permissionKey === permission);
  return ghost?.label;
}

export function isNavCatalogItemVisible(
  item: NavCatalogItem,
  opts: { isAuthenticated: boolean; hasPermission: boolean },
): boolean {
  if (opts.hasPermission) return true;
  if (item.defaultGrant === 'all_users' && opts.isAuthenticated) return true;
  return false;
}

export function getDashboardSectionUrl(section: string): string {
  if (!section || section === 'dashboard') return '/dashboard';
  if (section.startsWith('/')) return section;
  const queryIndex = section.indexOf('?');
  if (queryIndex === -1) return `/dashboard?section=${section}`;
  return `/dashboard?section=${section.slice(0, queryIndex)}&${section.slice(queryIndex + 1)}`;
}

function splitNavHref(href: string): [string, string] {
  const queryIndex = href.indexOf('?');
  if (queryIndex === -1) return [href, ''];
  return [href.slice(0, queryIndex), href.slice(queryIndex + 1)];
}

function urlOwnsQuery(candidateHref: string, urlParams: URLSearchParams): boolean {
  const queryIndex = candidateHref.indexOf('?');
  if (queryIndex === -1) return false;
  const candidateParams = new URLSearchParams(candidateHref.slice(queryIndex + 1));
  return [...candidateParams.entries()].every(([key, value]) => urlParams.get(key) === value);
}

/**
 * Whether a catalog href is the single current destination.
 * When `activeSection` is provided (dashboard sidebar, analytics), it is
 * authoritative so split-view cannot highlight two items at once. The URL is
 * only a fallback for callers that omit `activeSection`.
 */
export function isNavHrefActive(
  href: string | undefined,
  opts: {
    activeSection?: string;
    urlSearch?: string;
    siblingHrefs?: string[];
  },
): boolean {
  if (!href) return false;
  const { activeSection, urlSearch = '', siblingHrefs = [] } = opts;
  const [baseHref, hrefQuery] = splitNavHref(href);

  if (activeSection) {
    if (activeSection === href) return true;
    const [activeBase] = splitNavHref(activeSection);
    if (baseHref === 'dashboard') {
      return activeBase === 'dashboard' || activeBase === '';
    }
    if (activeBase !== baseHref) return false;
    if (hrefQuery) return false;
    return !siblingHrefs.some(
      (other) => other !== href && other.startsWith(`${baseHref}?`) && other === activeSection,
    );
  }

  const search = urlSearch.startsWith('?') ? urlSearch.slice(1) : urlSearch;
  const urlParams = new URLSearchParams(search);
  const urlSection = urlParams.get('section') || '';

  if (baseHref === 'dashboard') {
    return !urlSection || urlSection === 'dashboard';
  }
  if (urlSection !== baseHref) return false;
  if (hrefQuery) return urlOwnsQuery(href, urlParams);
  return !siblingHrefs.some(
    (other) => other !== href && other.startsWith(`${baseHref}?`) && urlOwnsQuery(other, urlParams),
  );
}

export function getNavHref(item: Pick<NavCatalogItem, 'href' | 'externalUrl' | 'topNav'>): string {
  if (item.externalUrl) return item.externalUrl;
  if (item.topNav && item.href === 'help') return '/help';
  return getDashboardSectionUrl(item.href);
}

export function isExternalNavItem(item: Pick<NavCatalogItem, 'externalUrl' | 'external'>): boolean {
  return Boolean(item.externalUrl || item.external);
}
