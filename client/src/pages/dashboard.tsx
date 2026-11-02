import {
  Sandwich,
  LogOut,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  MessageSquare,
  Hash,
  Inbox,
  ClipboardList,
  FolderOpen,
  BarChart3,
  TrendingUp,
  Users,
  Car,
  Building2,
  FileText,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  UserCog,
  Lightbulb,
  AlertCircle,
  Trophy,
  Calculator,
  Calendar,
  Clock,
  Truck,
  FileImage,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { useLocation, useRoute } from 'wouter';
// Using optimized SVG for faster loading
const sandwichLogo = '/sandwich-icon-optimized.svg';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState, useEffect, useMemo, Suspense } from 'react';
import * as React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePageSession } from '@/hooks/usePageSession';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { getEventRequestDefaults } from '@shared/role-view-defaults';
import { queryClient } from '@/lib/queryClient';
import { buildEventRequestsListQuery } from '@/components/event-requests/lib/eventRequestsListQuery';
import SimpleNav from '@/components/simple-nav';
import { NAV_ITEMS } from '@/nav.config';
import { getDashboardSectionUrl } from '@shared/nav-catalog';
import AnnouncementBanner from '@/components/announcement-banner';
import { useAnalytics } from '@/hooks/useAnalytics';
import EnhancedNotifications from '@/components/enhanced-notifications';
import { useIssueReport } from '@/contexts/issue-report-context';
import { OnlineUsers } from '@/components/online-users';
import { useOnlinePresenceNotifications } from '@/hooks/useOnlinePresenceNotifications';
import { RealTimeKudosNotifier } from '@/components/real-time-kudos-notifier';
import { LoginMessageNotifier } from '@/components/login-message-notifier';
import { FirstLoginTourPrompt } from '@/components/FirstLoginTourPrompt';
import { GuidedTour } from '@/components/GuidedTour';
import { ErrorBoundary } from '@/components/error-boundary';
import { DashboardNavigationProvider } from '@/contexts/dashboard-navigation-context';
import { TextIdeaAnnouncementModal } from '@/components/text-idea-announcement-modal';
import { MultiViewProvider, useMultiView } from '@/contexts/multi-view-context';
import { MultiViewContainer, MultiViewToolbar, FloatingViewsContainer } from '@/components/multi-view';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { DashboardBreadcrumbs } from '@/components/dashboard-breadcrumbs';
import { WhatsNewModal } from '@/components/whats-new-modal';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { ReviewerBanner } from '@/components/reviewer-banner';
import { CommandPalette, useCommandPalette } from '@/components/command-palette';
import { QuickCalculator } from '@/components/QuickCalculator';
import { UnifiedTopSearch } from '@/components/UnifiedTopSearch';
import { NavViewModeProvider } from '@/contexts/nav-view-mode-context';
import { NavViewModeToggle } from '@/components/nav-view-mode-toggle';
import { PermissionDenied } from '@/components/permission-denied';
import { Button } from '@/components/ui/button';
import { useEventRequestSocket } from '@/hooks/useEventRequestSocket';

function EventRequestLiveUpdates() {
  useEventRequestSocket();
  return null;
}

// Lazy load all page/section components with automatic retry on failure
const ProjectList = lazyWithRetry(() => import('@/components/project-list'));
// CommitteeChat removed - consolidated into StreamChatRooms (Team Chat)
const GoogleDriveLinks = lazyWithRetry(() => import('@/components/google-drive-links'));
const DashboardOverview = lazyWithRetry(() => import('@/components/dashboard-overview'));
const SandwichCollectionLog = lazyWithRetry(() => import('@/components/sandwich-collection-log'));
const RecipientsManagement = lazyWithRetry(() => import('@/components/recipients-management'));
const DriversManagement = lazyWithRetry(() => import('@/components/drivers-management-simple'));
const VolunteerManagement = lazyWithRetry(() => import('@/components/volunteer-management'));
const HostsManagement = lazyWithRetry(() => import('@/components/hosts-management-consolidated'));
const DocumentManagement = lazyWithRetry(() => import('@/components/document-management'));
const ImportantDocuments = lazyWithRetry(() => import('@/pages/important-documents'));
const BulkDataManager = lazyWithRetry(() => import('@/components/bulk-data-manager'));
const HostAnalytics = lazyWithRetry(() => import('@/components/host-analytics'));
const EnhancedMeetingDashboard = lazyWithRetry(() => import('@/components/enhanced-meeting-dashboard'));
const RoleDemo = lazyWithRetry(() => import('@/pages/role-demo'));
const ProjectsManagement = lazyWithRetry(() => import('@/components/projects'));
const ProjectDetailClean = lazyWithRetry(() => import('@/pages/project-detail-clean'));
const Analytics = lazyWithRetry(() => import('@/pages/analytics'));
const ImpactDashboard = lazyWithRetry(() => import('@/pages/impact-dashboard'));
const AiAnalyst = lazyWithRetry(() => import('@/components/ai-analyst'));
const PaceComparisonAnalytics = lazyWithRetry(() => import('@/components/pace-comparison-analytics'));
const LowHighWeeksTab = lazyWithRetry(() => import('@/components/low-high-weeks-tab'));
const DataManagement = lazyWithRetry(() => import('@/pages/data-management'));
const PerformanceDashboard = lazyWithRetry(() => import('@/pages/performance-dashboard'));
const GrantMetrics = lazyWithRetry(() => import('@/pages/grant-metrics'));
const WeeklyCollectionsReport = lazyWithRetry(() => import('@/pages/weekly-collections-report'));
const GroupCollectionsViewer = lazyWithRetry(() => import('@/pages/group-collections-viewer'));
const UserManagementRedesigned = lazyWithRetry(() => import('@/components/user-management-redesigned'));
const UserProfile = lazyWithRetry(() => import('@/components/user-profile'));
const OnboardingAdmin = lazyWithRetry(() => import('@/pages/onboarding-admin'));
const WorkLogPage = lazyWithRetry(() => import('@/pages/work-log'));
const SuggestionsPortal = lazyWithRetry(() => import('@/pages/suggestions'));
const GoogleSheetsPage = lazyWithRetry(() => import('@/pages/google-sheets'));
const PlanningSheetProposalsPage = lazyWithRetry(() => import('@/pages/planning-sheet-proposals'));
const GmailStyleInbox = lazyWithRetry(() => import('@/components/gmail-style-inbox'));
const MessagingInbox = lazyWithRetry(() => import('@/pages/messaging-inbox'));
const ToolkitTabs = lazyWithRetry(() => import('@/components/toolkit-tabs').then(m => ({ default: m.ToolkitTabs })));
const KudosInbox = lazyWithRetry(() => import('@/components/kudos-inbox').then(m => ({ default: m.KudosInbox })));
const KudosTeamFeed = lazyWithRetry(() => import('@/components/kudos-team-feed').then(m => ({ default: m.KudosTeamFeed })));
const StreamChatRooms = lazyWithRetry(() => import('@/components/stream-chat-rooms'));
const EventsViewer = lazyWithRetry(() => import('@/components/events-viewer'));
const SignUpGeniusViewer = lazyWithRetry(() => import('@/components/signup-genius-viewer'));
const DonationTracking = lazyWithRetry(() => import('@/components/donation-tracking'));
const WeeklyMonitoringDashboard = lazyWithRetry(() => import('@/components/weekly-monitoring-dashboard'));
const WishlistPage = lazyWithRetry(() => import('@/pages/wishlist'));
const HoldingZone = lazyWithRetry(() => import('@/pages/HoldingZone'));
const PromotionGraphics = lazyWithRetry(() => import('@/pages/promotion-graphics'));
const QuickSMSLinks = lazyWithRetry(() => import('@/pages/quick-sms-links'));
const CoolerTrackingPage = lazyWithRetry(() => import('@/pages/cooler-tracking'));
const EventRequestsManagement = lazyWithRetry(() => import('@/components/event-requests'));
const EventOperationalDashboard = lazyWithRetry(() => import('@/components/event-operational-dashboard'));
const EventRemindersManagement = lazyWithRetry(() => import('@/components/event-reminders-management'));
const GroupCatalog = lazyWithRetry(() => import('@/components/organizations-catalog'));
const GroupsInsightsDashboard = lazyWithRetry(() => import('@/components/groups-insights-dashboard'));
const EventContactsDirectory = lazyWithRetry(() => import('@/components/event-contacts-directory'));
const EventContactDetail = lazyWithRetry(() => import('@/pages/event-contact-detail'));
const LogosPage = lazyWithRetry(() => import('@/pages/logos'));
const Flyers = lazyWithRetry(() => import('@/pages/flyers'));
const Governance = lazyWithRetry(() => import('@/pages/governance'));
const CleanupAudit = lazyWithRetry(() => import('@/pages/cleanup-audit'));
const ImportantLinks = lazyWithRetry(() => import('@/pages/important-links'));
const Resources = lazyWithRetry(() => import('@/pages/resources').then(m => ({ default: m.Resources })));
const AutoFormFiller = lazyWithRetry(() => import('@/pages/auto-form-filler').then(m => ({ default: m.AutoFormFiller })));
const EventRequestAuditLog = lazyWithRetry(() => import('@/components/event-request-audit-log').then(m => ({ default: m.EventRequestAuditLog })));
const HistoricalImport = lazyWithRetry(() => import('@/pages/historical-import'));
const MyAvailability = lazyWithRetry(() => import('@/pages/my-availability'));
const TeamAvailability = lazyWithRetry(() => import('@/pages/team-availability'));
const GoogleCalendarAvailability = lazyWithRetry(() => import('@/pages/google-calendar-availability'));
const RouteMapView = lazyWithRetry(() => import('@/pages/route-map'));
const EventMapView = lazyWithRetry(() => import('@/pages/event-map'));
const Help = lazyWithRetry(() => import('@/pages/Help'));
const ExpensesPage = lazyWithRetry(() => import('@/pages/ExpensesPage'));
const AdminSettings = lazyWithRetry(() => import('@/pages/admin-settings'));
const DesignSystemShowcase = lazyWithRetry(() => import('@/pages/design-system-showcase'));
const SmartSearchAdmin = lazyWithRetry(() => import('@/pages/smart-search-admin'));
const OrganizationsMerge = lazyWithRetry(() => import('@/pages/admin/organizations-merge'));
const GenerateServiceHours = lazyWithRetry(() => import('@/pages/generate-service-hours'));
const TSPNetwork = lazyWithRetry(() => import('@/pages/tsp-network'));
const EventImpactReports = lazyWithRetry(() => import('@/pages/event-impact-reports'));
const DriverPlanningDashboard = lazyWithRetry(() => import('@/pages/driver-planning'));
const VolunteerEventHub = lazyWithRetry(() => import('@/pages/volunteer-event-hub'));
const HostResources = lazyWithRetry(() => import('@/pages/host-resources'));
const YearlyCalendar = lazyWithRetry(() => import('@/pages/yearly-calendar'));
const Directory = lazyWithRetry(() => import('@/pages/directory'));

import sandwich_logo from '@assets/CMYK_PRINT_TSP-01_1749585167435.png';

import sandwich_20logo from '@assets/LOGOS/sandwich logo.png';
import { logger } from '@/lib/logger';

// Loading fallback component for lazy-loaded sections
const SectionLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
      <p className="text-muted-foreground">Loading section...</p>
      <p className="text-xs text-muted-foreground/60 mt-2">This may take a moment on first load</p>
    </div>
  </div>
);

// Bridge component that sits inside MultiViewProvider and routes sidebar clicks
// to the currently focused panel instead of always the primary panel
function MultiViewSidebar({
  navigationItems,
  isCollapsed,
  onMobileClose,
  onTrackNavigation,
  dashboardSetActiveSection,
}: {
  navigationItems: typeof NAV_ITEMS;
  isCollapsed: boolean;
  onMobileClose: () => void;
  onTrackNavigation: (section: string, from: string) => void;
  dashboardSetActiveSection: (section: string) => void;
}) {
  const [location, setLocation] = useLocation();
  const { isMultiViewEnabled, activePanel, panels, navigateActivePanel } = useMultiView();

  // In multi-view mode, show the focused panel's section as the active highlight
  const effectiveActiveSection = React.useMemo(() => {
    if (isMultiViewEnabled && activePanel) {
      const focusedPanel = panels.find(p => p.id === activePanel);
      if (focusedPanel) return focusedPanel.section;
    }
    // Fall back to primary panel's section
    const primary = panels.find(p => p.id === 'primary');
    return primary?.section || 'dashboard';
  }, [isMultiViewEnabled, activePanel, panels]);

  const handleSectionChange = React.useCallback((section: string) => {
    logger.log('MultiViewSidebar navigation:', section, 'multiView:', isMultiViewEnabled, 'activePanel:', activePanel);

    // Track navigation
    onTrackNavigation(section, effectiveActiveSection);

    // Handle standalone routes (navigate away from dashboard)
    if (section === 'help') {
      setLocation('/help');
      onMobileClose();
      return;
    }

    if (isMultiViewEnabled) {
      // Keep panel destinations local. Writing the URL here feeds back through
      // dashboard URL→activeSection→MultiView sync and can strip query-backed
      // tabs, and it would also light up a second sidebar item from the URL.
      navigateActivePanel(section);
      onMobileClose();
      return;
    }

    dashboardSetActiveSection(section.split('?')[0]);
    onMobileClose();
    window.history.pushState({}, '', getDashboardSectionUrl(section));
  }, [isMultiViewEnabled, activePanel, navigateActivePanel, dashboardSetActiveSection, effectiveActiveSection, onTrackNavigation, onMobileClose, setLocation]);

  return (
    <SimpleNav
      navigationItems={navigationItems}
      activeSection={effectiveActiveSection}
      onSectionChange={handleSectionChange}
      isCollapsed={isCollapsed}
    />
  );
}

// Sections whose layout has a bottom-anchored send/reply button (e.g. Team
// Chat's Stream Chat message/DM composer) that the floating help button would
// otherwise overlap. The help button is hidden on these sections.
const HELP_BUTTON_HIDDEN_SECTIONS = [
  'chat',
  'messages',
  'inbox',
  'gmail-inbox',
];

function EventPlanningDenied({
  canViewVolunteerHub,
  onOpenVolunteerHub,
}: {
  canViewVolunteerHub: boolean;
  onOpenVolunteerHub: () => void;
}) {
  return (
    <div className="p-6 max-w-xl mx-auto space-y-4">
      <PermissionDenied
        action="view Event Requests"
        requiredPermission={PERMISSIONS.NAV_EVENT_PLANNING}
        message="Event Requests is for the event management team. Volunteer sign-ups live in Volunteer Hub."
      />
      {canViewVolunteerHub && (
        <Button
          onClick={onOpenVolunteerHub}
          className="w-full bg-[#007E8C] hover:bg-[#236383] text-white"
        >
          Open Volunteer Hub
        </Button>
      )}
    </div>
  );
}

function GuidedTourGate({ activeSection }: { activeSection: string }) {
  const { panels, activePanel, isMultiViewEnabled } = useMultiView();

  const visibleSections = isMultiViewEnabled
    ? panels.map((p) => p.section)
    : [
        (panels.find((p) => p.id === activePanel) ||
          panels.find((p) => p.id === 'primary') ||
          panels[0])?.section,
      ];

  // Also consider the dashboard's actual active section. During single-view
  // navigation the multi-view panel state can lag behind activeSection, so
  // relying on panels alone left the help button visible over Team Chat.
  const sectionsToCheck = [...visibleSections, activeSection];

  if (sectionsToCheck.some((s) => s && HELP_BUTTON_HIDDEN_SECTIONS.includes(s)))
    return null;
  return <GuidedTour />;
}

export default function Dashboard({
  initialSection = 'dashboard',
}: {
  initialSection?: string;
}) {
  const [location, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState(initialSection);
  const [selectedHost, setSelectedHost] = useState<string>('');
  // Active analytics tab — controlled so we can show a per-tab description
  // line beneath the tab row that updates when the user switches tabs.
  const [analyticsTab, setAnalyticsTab] = useState<string>('pace');

  // Helper function to get readable section/page names for activity tracking
  const getActivityContext = (section: string) => {
    const sectionMap: Record<string, { section: string; page: string }> = {
      'dashboard': { section: 'Dashboard', page: 'Main Dashboard' },
      'collections': { section: 'Collections', page: 'Collections Log' },
      'event-requests': { section: 'Events', page: 'Event Requests' },
      'event-ops-dashboard': { section: 'Events', page: 'Events Operations Dashboard' },
      'admin-overview': { section: 'Event Requests', page: 'Admin Overview' },
      'event-calendar': { section: 'Events', page: 'Event Calendar' },
      'event-conflict-detection': { section: 'Events', page: 'Conflict Detection' },
      'driver-planning': { section: 'Events', page: 'Driver Planning' },
      'contacts-directory': { section: 'Contacts', page: 'Contacts Directory' },
      'organizations-directory': { section: 'Organizations', page: 'Organizations Directory' },
      'hosts-directory': { section: 'Hosts', page: 'Hosts Directory' },
      'host-stats': { section: 'Hosts', page: 'Host Statistics' },
      'all-locations': { section: 'Locations', page: 'All Locations' },
      'impact': { section: 'Analytics', page: 'Impact Dashboard' },
      'analytics': { section: 'Analytics', page: 'Analytics' },
      'reports': { section: 'Reports', page: 'Reports' },
      'expense-management': { section: 'Finance', page: 'Expense Management' },
      'chat': { section: 'Communication', page: 'Team Chat' },
      'gmail-inbox': { section: 'Communication', page: 'Gmail Inbox' },
      'announcements': { section: 'Communication', page: 'Announcements' },
      'project-list': { section: 'Projects', page: 'Project List' },
      'holding-zone': { section: 'Collections', page: 'Holding Zone' },
      'weekly-summary': { section: 'Collections', page: 'Weekly Summary' },
      'user-management': { section: 'Administration', page: 'User Management' },
      'role-management': { section: 'Administration', page: 'Role Management' },
      'settings': { section: 'Administration', page: 'Settings' },
      'kudos': { section: 'Recognition', page: 'Kudos' },
      'profile': { section: 'Profile', page: 'My Profile' },
      'help': { section: 'Help', page: 'Help Center' },
    };

    return sectionMap[section] || { section: 'Dashboard', page: section };
  };

  const activityContext = getActivityContext(activeSection);

  // Track page session for activity logging
  usePageSession({
    section: activityContext.section,
    page: activityContext.page,
    context: { currentSection: activeSection },
  });

  // Show toast notifications when other users come online
  useOnlinePresenceNotifications();

  // Command palette for quick navigation (Cmd+Shift+K; plain Cmd+K is the sidebar SmartSearch)
  const { open: commandPaletteOpen, setOpen: setCommandPaletteOpen } = useCommandPalette();

  // Parse URL query parameters - track search string changes independently
  // since wouter's location only reflects pathname, not query params
  const [searchString, setSearchString] = useState(window.location.search);

  useEffect(() => {
    const onUrlChange = () => setSearchString(window.location.search);
    window.addEventListener('popstate', onUrlChange);
    // Also observe pushState/replaceState calls
    const origPush = window.history.pushState.bind(window.history);
    const origReplace = window.history.replaceState.bind(window.history);
    window.history.pushState = (...args: Parameters<typeof origPush>) => {
      origPush(...args);
      onUrlChange();
    };
    window.history.replaceState = (...args: Parameters<typeof origReplace>) => {
      origReplace(...args);
      onUrlChange();
    };
    return () => {
      window.removeEventListener('popstate', onUrlChange);
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, []);

  const urlParams = useMemo(() => {
    const searchParams = new URLSearchParams(searchString);
    return {
      section: searchParams.get('section'),
      tab: searchParams.get('tab'),
      eventId: searchParams.get('eventId'),
      view: searchParams.get('view'),
      id: searchParams.get('id'),
      highlight: searchParams.get('highlight'),
    };
  }, [searchString]);

  // Listen to URL changes to update activeSection
  React.useEffect(() => {
    logger.log('Current URL location:', location);

    // Check for section in query parameters first
    if (urlParams.section) {
      logger.log('Setting activeSection from query parameter:', urlParams.section);

      // Driver Hub was decommissioned — fold its URL into the Volunteer Hub.
      if (urlParams.section === 'driver-hub') {
        const newSearch = window.location.search.replace(/section=driver-hub/, 'section=volunteer-hub');
        window.history.replaceState({}, '', `${window.location.pathname}${newSearch}`);
        setActiveSection('volunteer-hub');
        return;
      }

      // Handle special case for project detail view via query parameters
      if (urlParams.section === 'projects' && urlParams.view === 'detail' && urlParams.id) {
        const projectSection = `project-${urlParams.id}`;
        logger.log('Setting activeSection to project detail:', projectSection);
        setActiveSection(projectSection);
        return;
      }

      setActiveSection(urlParams.section);
      return;
    }

    // Extract section from URL path (strip query parameters)
    const pathWithoutQuery = location.split('?')[0];
    
    if (pathWithoutQuery.startsWith('/projects/')) {
      const parts = pathWithoutQuery.split('/projects/');
      const projectId = parts.length > 1 ? parts[1] : null;
      if (projectId) {
        const newSection = `project-${projectId}`;
        logger.log('Setting activeSection to project ID:', newSection);
        setActiveSection(newSection);
      }
    } else if (pathWithoutQuery.startsWith('/event-contact/')) {
      // Handle event contact detail route - keep section as 'event-contact-detail'
      // The EventContactDetail component will extract the ID from the URL
      logger.log('Setting activeSection to event-contact-detail');
      setActiveSection('event-contact-detail');
    } else {
      // Handle other sections - strip query parameters and leading slash
      const pathSection = pathWithoutQuery.substring(1) || 'dashboard';
      logger.log('Setting activeSection to:', pathSection);
      setActiveSection(pathSection);
    }
  }, [location, urlParams.section]);

  // Debug logging
  React.useEffect(() => {
    logger.log('Dashboard activeSection changed to:', activeSection);
  }, [activeSection]);

  // Enhanced setActiveSection with debugging and query param support
  const enhancedSetActiveSection = (section: string) => {
    logger.log('📍 Dashboard setActiveSection called with:', section);

    // Check if section includes query parameters
    if (section.includes('?')) {
      const [basePath, queryString] = section.split('?');
      setActiveSection(basePath);
      // Update URL with query parameters using window.history
      const newUrl = `${window.location.pathname}?section=${basePath}&${queryString}`;
      window.history.pushState({}, '', newUrl);
      // Force a location update to trigger effects
      setLocation(window.location.pathname + window.location.search);
    } else {
      setActiveSection(section);
    }
  };
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { user, isLoading } = useAuth();
  const canViewEventRequests = !!user && hasPermission(user, PERMISSIONS.NAV_EVENT_PLANNING);
  const canViewVolunteerHub = !!user && hasPermission(user, PERMISSIONS.NAV_VOLUNTEER_HUB);
  const openVolunteerHub = () => {
    window.history.pushState({}, '', getDashboardSectionUrl('volunteer-hub'));
    setActiveSection('volunteer-hub');
  };
  const { trackNavigation, trackButtonClick } = useAnalytics();
  const { openReportDialog } = useIssueReport();

  // Prefetch event requests data only for people who can open Event Requests.
  React.useEffect(() => {
    if (!canViewEventRequests) return;

    queryClient.prefetchQuery({
      queryKey: ['/api/event-requests/status-counts'],
      queryFn: async () => {
        const response = await fetch('/api/event-requests/status-counts', {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to fetch status counts');
        return response.json();
      },
      staleTime: 2 * 60 * 1000, // 2 minutes
    });

    if (user?.role) {
      const defaults = getEventRequestDefaults(user.role, user.id);
      const { queryKey, listUrl } = buildEventRequestsListQuery(defaults.defaultTab, null);

      queryClient.prefetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await fetch(listUrl, { credentials: 'include' });
          if (!response.ok) throw new Error('Failed to fetch event requests');
          return response.json();
        },
        staleTime: 5 * 60 * 1000, // 5 minutes
      });
    }
  }, [canViewEventRequests, user?.role, user?.id]);

  // Preload commonly used component chunks after initial render
  // This helps prevent "reload" errors by ensuring chunks are ready before navigation
  React.useEffect(() => {
    // Wait a bit for initial render to complete, then preload common sections
    const preloadTimeout = setTimeout(() => {
      // Preload the most commonly accessed sections in background
      // Using dynamic import directly (not the lazy wrapper) to just fetch the chunk
      const preloadImports = [
        () => import('@/components/dashboard-overview'),
        () => import('@/components/sandwich-collection-log'),
        ...(canViewEventRequests ? [() => import('@/components/event-requests')] : []),
        ...(canViewVolunteerHub ? [() => import('@/pages/volunteer-event-hub')] : []),
        () => import('@/components/stream-chat-rooms'),
        () => import('@/pages/my-availability'),
      ];

      // Load one at a time with small delays to avoid network congestion
      preloadImports.forEach((importFn, index) => {
        setTimeout(() => {
          importFn().catch(() => {
            // Silently ignore preload failures - the retry mechanism will handle it later
          });
        }, index * 200); // Stagger loads by 200ms each
      });
    }, 1000); // Wait 1 second after mount before preloading

    return () => clearTimeout(preloadTimeout);
  }, [canViewEventRequests, canViewVolunteerHub]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
    );
  };


  const renderContent = (sectionOverride?: string) => {
    const rawSection = sectionOverride || activeSection;
    // Use base path for switch (strip query string) so panels with e.g. event-requests?tab=admin_overview render correctly
    const [section, sectionQuery = ''] = rawSection.split('?');
    const sectionParams = new URLSearchParams(sectionQuery);
    const sectionTab = sectionParams.get('tab') || urlParams.tab;
    // Extract project ID from section if it's a project detail page
    const projectIdMatch = section.match(/^project-(\d+)$/);
    const projectId =
      projectIdMatch && projectIdMatch[1] ? parseInt(projectIdMatch[1]) : null;

    // Handle project detail pages
    if (projectId) {
      return <ProjectDetailClean projectId={projectId} />;
    }

    switch (section) {
      case 'dashboard':
        return <DashboardOverview onSectionChange={setActiveSection} />;
      case 'collections':
        return <SandwichCollectionLog />;
      case 'events':
        return <EventsViewer />;
      case 'signup-genius':
        return <SignUpGeniusViewer />;
      case 'donation-tracking':
        return <DonationTracking />;
      case 'weekly-monitoring':
        return (
          <div className="space-y-6 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-teal-100">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 break-words">
                  Weekly Monitoring
                </h1>
                <p className="text-sm sm:text-base text-gray-600 break-words">
                  Track weekly submission status and send email notifications
                  for missing data
                </p>
              </div>
            </div>
            <WeeklyMonitoringDashboard />
          </div>
        );
      case 'inventory-calculator':
        // Open the inventory calculator in a new tab and return to dashboard
        window.open(
          'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html',
          '_blank'
        );
        setActiveSection('dashboard');
        return <DashboardOverview onSectionChange={setActiveSection} />;
      case 'important-documents':
        return <ImportantDocuments />;
      case 'resources':
        return <Resources />;
      case 'auto-form-filler':
        return <AutoFormFiller />;
      case 'projects':
        logger.log('Rendering ProjectsManagement component');
        return <ProjectsManagement />;
      case 'messages':
        return <GmailStyleInbox />;
      case 'gmail-inbox':
        return <GmailStyleInbox />;
      case 'inbox':
        return <GmailStyleInbox />;
      case 'messaging-inbox':
        return <MessagingInbox />;
      case 'chat':
        // Outer "Team Chat" page header was removed — it was duplicating
        // what the channel header already tells the user (which room
        // they're in) and pushing the actual chat surface down the page.
        // The chat now reads top-to-bottom like a native app, with the
        // channel list and active room stretching to the top.
        return (
          <div className="h-full min-h-0">
            <StreamChatRooms defaultTab={sectionTab} />
          </div>
        );
      case 'kudos':
        return (
          <div className="space-y-6 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-yellow-100">
                <Trophy className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 break-words">Kudos</h1>
                <p className="text-sm sm:text-base text-gray-600 break-words">
                  See recognition you've received — and celebrate the rest of the team.
                </p>
              </div>
            </div>
            {/* Tabs split the page into two views:
                  - Your Kudos: existing per-user inbox of kudos received
                  - Team Feed: shared recognition feed of recent kudos
                    sent across the org. Builds community morale because
                    seeing teammates being celebrated is contagious.
                The default tab stays "Your Kudos" so existing users land
                where they always have. */}
            <Tabs defaultValue="received" className="w-full">
              <TabsList>
                <TabsTrigger value="received">Your Kudos</TabsTrigger>
                <TabsTrigger value="team-feed">Team Feed</TabsTrigger>
              </TabsList>
              <TabsContent value="received" className="mt-4">
                <KudosInbox />
              </TabsContent>
              <TabsContent value="team-feed" className="mt-4">
                <KudosTeamFeed />
              </TabsContent>
            </Tabs>
          </div>
        );
      case 'profile':
        return <UserProfile />;
      case 'meetings':
        return <EnhancedMeetingDashboard />;

      case 'toolkit':
        return <ToolkitTabs />;

      case 'documents':
      case 'document-management':
        return <DocumentManagement />;

      case 'tsp-network':
        return <TSPNetwork />;
      case 'hosts':
        return <HostsManagement />;
      case 'route-map':
      case 'recipient-map':
        // Both route-map and recipient-map now use the combined Locations Map
        return <RouteMapView />;
      case 'event-map':
        return <EventMapView />;
      case 'driver-planning':
        return <DriverPlanningDashboard />;
      case 'volunteer-hub':
        if (!canViewVolunteerHub) {
          return (
            <div className="p-6 max-w-xl mx-auto">
              <PermissionDenied
                action="open the Volunteer Hub"
                requiredPermission={PERMISSIONS.NAV_VOLUNTEER_HUB}
              />
            </div>
          );
        }
        return (
          <VolunteerEventHub
            initialView={sectionParams.get('view') || urlParams.view}
          />
        );
      case 'host-resources':
        return <HostResources />;
      case 'recipients':
        return <RecipientsManagement highlightRecipientId={urlParams.highlight ? Number(urlParams.highlight) : undefined} />;
      case 'drivers':
        return <DriversManagement />;
      case 'volunteers':
        return <VolunteerManagement />;
      case 'directory':
        return <Directory />;
      case 'event-requests':
        if (!canViewEventRequests) {
          return (
            <EventPlanningDenied
              canViewVolunteerHub={canViewVolunteerHub}
              onOpenVolunteerHub={openVolunteerHub}
            />
          );
        }
        return (
          <ErrorBoundary
            fallback={
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="max-w-md p-6 text-center">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Event Requests Unavailable
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    There was an issue loading Event Requests. Other features are still available.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600"
                  >
                    Refresh Page
                  </button>
                </div>
              </div>
            }
          >
            <EventRequestsManagement
              initialTab={sectionTab}
              initialEventId={urlParams.eventId ? parseInt(urlParams.eventId) : undefined}
            />
          </ErrorBoundary>
        );
      case 'event-ops-dashboard':
        if (!canViewEventRequests) {
          return (
            <EventPlanningDenied
              canViewVolunteerHub={canViewVolunteerHub}
              onOpenVolunteerHub={openVolunteerHub}
            />
          );
        }
        return <EventOperationalDashboard />;
      case 'event-reminders':
        return <EventRemindersManagement />;
      case 'historical-import':
        return <HistoricalImport />;
      case 'groups-catalog':
        return (
          <GroupCatalog
            onNavigateToEventPlanning={
              canViewEventRequests ? () => setActiveSection('event-requests') : undefined
            }
          />
        );
      case 'groups-insights':
        return <GroupsInsightsDashboard />;
      case 'event-contacts-directory':
        return <EventContactsDirectory />;
      case 'event-contact-detail':
        return <EventContactDetail />;
      case 'wishlist':
        return <WishlistPage />;
      case 'team-board':
        return <HoldingZone />;
      case 'calendars':
        return <YearlyCalendar />;
      case 'yearly-calendar':
        return <YearlyCalendar />;
      case 'promotion':
        return <PromotionGraphics />;
      case 'quick-sms-links':
        return <QuickSMSLinks />;
      case 'cooler-tracking':
        return <CoolerTrackingPage />;
      case 'important-links':
        return <ImportantLinks />;
      case 'flyers':
        return <Flyers />;
      case 'logos':
        return <LogosPage />;
      case 'performance-dashboard':
        return <PerformanceDashboard />;
      case 'data-management':
        return <DataManagement />;
      case 'governance':
        return <Governance />;
      case 'cleanup-audit':
        return <CleanupAudit />;
      case 'analytics':
        const canUseAiAnalyst =
          hasPermission(user, PERMISSIONS.AI_ANALYST_VIEW) &&
          hasPermission(user, PERMISSIONS.ANALYTICS_VIEW);
        return (
          <div className="p-6">
            <div className="mb-6">
              <h1 className="text-lg sm:text-xl md:text-2xl font-main-heading text-primary break-words">
                Impact & Analytics Dashboard
              </h1>
              <p className="text-base font-body text-muted-foreground break-words">
                Track community impact, collection trends, and host performance
              </p>
            </div>
            <Tabs value={analyticsTab} onValueChange={setAnalyticsTab} className="w-full">
              <TabsList className={`grid w-full min-h-11 sm:min-h-12 bg-brand-primary/10 border-brand-primary/20 ${
                canUseAiAnalyst ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'
              }`}>
                <TabsTrigger
                  value="pace"
                  className="text-sm sm:text-base data-[state=active]:bg-brand-primary data-[state=active]:text-white text-brand-primary"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Pace &amp; Comparison
                </TabsTrigger>
                <TabsTrigger
                  value="impact"
                  className="text-sm sm:text-base data-[state=active]:bg-brand-primary data-[state=active]:text-white text-brand-primary"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Impact Dashboard
                </TabsTrigger>
                <TabsTrigger
                  value="low-high-weeks"
                  className="text-sm sm:text-base data-[state=active]:bg-brand-primary data-[state=active]:text-white text-[#646464]"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Low / High Weeks
                </TabsTrigger>
                <TabsTrigger
                  value="hosts"
                  className="text-sm sm:text-base data-[state=active]:bg-brand-primary data-[state=active]:text-white text-[#646464]"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Host Analytics
                </TabsTrigger>
                {canUseAiAnalyst && (
                  <TabsTrigger
                    value="ai-analyst"
                    className="text-sm sm:text-base data-[state=active]:bg-brand-primary data-[state=active]:text-white text-[#646464]"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    AI Analyst
                  </TabsTrigger>
                )}
              </TabsList>
              {/* Plain-language description of the active tab. Sits between
                  the tab row and content so a new user understands what
                  they're looking at without having to interpret jargon
                  ("Low / High Weeks" being the worst offender). Greyed
                  and small so it guides without dominating. */}
              <p
                className="mt-2 text-[13px] text-gray-500 leading-snug"
                aria-live="polite"
                data-testid="analytics-tab-description"
              >
                {analyticsTab === 'pace' &&
                  "How this year's totals compare to last year and to your annual goal."}
                {analyticsTab === 'impact' &&
                  'Totals by sandwich type, collection category, and all-time records.'}
                {analyticsTab === 'low-high-weeks' &&
                  'Which weeks had the lowest and highest collection volume — useful for spotting seasonal patterns.'}
                {analyticsTab === 'hosts' &&
                  'Breakdown of collection performance by individual host location.'}
                {analyticsTab === 'ai-analyst' &&
                  'Ask questions about approved aggregate data without exposing personal or operational detail.'}
              </p>
              <TabsContent value="pace" className="mt-6">
                <PaceComparisonAnalytics />
              </TabsContent>
              <TabsContent value="impact" className="mt-6">
                <ImpactDashboard />
              </TabsContent>
              <TabsContent value="low-high-weeks" className="mt-6">
                <LowHighWeeksTab />
              </TabsContent>
              <TabsContent value="hosts" className="mt-6">
                <HostAnalytics
                  selectedHost={selectedHost}
                  onHostChange={setSelectedHost}
                />
              </TabsContent>
              {canUseAiAnalyst && (
                <TabsContent value="ai-analyst" className="mt-6">
                  <AiAnalyst />
                </TabsContent>
              )}
            </Tabs>
          </div>
        );
      case 'grant-metrics':
        return <GrantMetrics />;
      case 'event-impact-reports':
        return <EventImpactReports />;
      case 'weekly-collections-report':
        return <WeeklyCollectionsReport />;
      case 'group-collections':
        return <GroupCollectionsViewer />;
      case 'role-demo':
        return <RoleDemo />;
      case 'work-log':
        return <WorkLogPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'suggestions':
        return <SuggestionsPortal />;
      case 'google-sheets':
        return <GoogleSheetsPage />;
      case 'planning-sheet-proposals':
        return <PlanningSheetProposalsPage />;
      // Legacy 'committee' and 'committee-chat' routes redirect to Stream Chat
      case 'committee':
      case 'committee-chat':
        // Redirect to main Team Chat
        return (
          <div className="h-full min-h-0">
            <StreamChatRooms defaultTab={sectionTab} />
          </div>
        );
      case 'my-availability':
        return <MyAvailability />;
      case 'team-availability':
        return <TeamAvailability />;
      case 'google-calendar-availability':
        return <GoogleCalendarAvailability />;
      case 'user-management':
        return <UserManagementRedesigned />;
      case 'onboarding-admin':
        return <OnboardingAdmin />;
      case 'admin':
        return <AdminSettings />;
      case 'help':
        return <Help />;
      case 'design-system':
        return <DesignSystemShowcase />;
      case 'smart-search-admin':
        return <SmartSearchAdmin />;
      case 'organizations-merge':
        return <OrganizationsMerge />;
      case 'generate-service-hours':
        return <GenerateServiceHours />;
      default:
        // Handle project detail pages
        if (projectId) {
          return <ProjectDetailClean projectId={projectId} />;
        }
        // Handle legacy project routes
        if (section.startsWith('project-')) {
          const legacyProjectId = parseInt(
            section.replace('project-', '')
          );
          if (!isNaN(legacyProjectId)) {
            return <ProjectDetailClean projectId={legacyProjectId} />;
          }
        }
        return <DashboardOverview onSectionChange={setActiveSection} />;
    }
  };

  // Show loading state while authentication is being checked
  if (isLoading) {
    return (
      <div className="bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // If not authenticated after loading, redirect or show error
  if (!user) {
    window.location.href = '/';
    return null;
  }

  return (
    <NavViewModeProvider>
    <>
      {/* Real-Time Kudos Notifier */}
      <RealTimeKudosNotifier />
      <LoginMessageNotifier />
      {canViewEventRequests && <EventRequestLiveUpdates />}
      <FirstLoginTourPrompt />
      <TextIdeaAnnouncementModal />
      <WhatsNewModal />

      {/* Command Palette for quick navigation (Cmd+Shift+K) */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      <DashboardNavigationProvider setActiveSection={enhancedSetActiveSection}>
        <MultiViewProvider initialSection={activeSection}>
        <div className="bg-gray-50 h-[calc(100vh-var(--chat-dock-height,0px))] flex flex-col overflow-hidden safe-area-inset">
        {/* Reviewer Banner - shows for read-only reviewer accounts */}
        <ReviewerBanner />
        {/* Announcement Banner */}
        <AnnouncementBanner />
        
        {/* Top Header */}
        <div className="bg-brand-primary border-b border-brand-primary-dark shadow-md px-2 sm:px-4 md:px-6 py-2 sm:py-3 flex items-center mobile-header-fix min-h-[60px] sm:min-h-[70px] overflow-x-hidden max-w-full flex-shrink-0">
          <div className="flex items-center space-x-2 min-w-0 flex-shrink-0">
            {/* Mobile menu button - positioned first for easy access */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors touch-manipulation relative z-60"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
            <img
              src={sandwich_20logo}
              alt="Sandwich Logo"
              className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0"
              width="24"
              height="24"
            />
            <h1 className="text-base sm:text-lg font-semibold text-white hidden lg:block truncate">
              The Sandwich Project
            </h1>
            <h1 className="text-sm font-semibold text-white lg:hidden truncate">
              TSP
            </h1>
          </div>

          {/* Center: universal search — icon on phones, full bar from sm up */}
          <div className="flex flex-1 justify-end sm:justify-center px-1 sm:px-4 min-w-0 sm:max-w-xl mx-auto">
            <UnifiedTopSearch />
          </div>

          {/* Right side container - optimized for tablets/mobile */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* The standalone "K Katie Long" gray badge that used to live here
                was removed — it duplicated identity already conveyed by the
                circular user-avatar dropdown on the far right. The avatar
                menu now shows the user's full name + email at the top of its
                dropdown, plus Account Settings + Logout. One identity slot,
                less header noise. */}

            {/* Header actions - organized into logical groups */}
            <TooltipProvider delayDuration={300}>
            <div className="flex items-center gap-1 sm:gap-2 relative z-50 flex-shrink-0">

              {/* Communications cluster — all "is something happening?" tools
                  share a single translucent tray so they read as one group:
                  Chat, Threads, Who's Online, Notifications. Operational
                  tools (Calculator) live outside the tray with a visible
                  separator to mark the function-type switch. */}
              <div className="flex items-center gap-0.5 bg-white/10 rounded-lg p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href="/dashboard?section=chat"
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                          return;
                        }
                        event.preventDefault();
                        logger.log('Team Chat button clicked');
                        trackButtonClick('chat', 'dashboard_header');
                        setActiveSection('chat');
                        window.history.pushState({}, '', '/dashboard?section=chat');
                        setIsMobileMenuOpen(false);
                      }}
                      className={`hidden sm:flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-2 rounded-md transition-colors text-sm font-medium ${
                        activeSection === 'chat'
                          ? 'bg-white text-brand-primary shadow-sm'
                          : 'text-white/80 hover:bg-white/15 hover:text-white'
                      }`}
                      aria-label="Team Chat"
                      aria-current={activeSection === 'chat' ? 'page' : undefined}
                    >
                      <Hash className="w-4 h-4" />
                      <span className="hidden lg:inline">Chat</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>Team Chat</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href="/dashboard?section=gmail-inbox"
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                          return;
                        }
                        event.preventDefault();
                        logger.log('Project Threads button clicked');
                        trackButtonClick('project-threads', 'dashboard_header');
                        setActiveSection('gmail-inbox');
                        window.history.pushState({}, '', '/dashboard?section=gmail-inbox');
                        setIsMobileMenuOpen(false);
                      }}
                      className={`hidden sm:flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-2 rounded-md transition-colors text-sm font-medium ${
                        activeSection === 'gmail-inbox'
                          ? 'bg-white text-brand-primary shadow-sm'
                          : 'text-white/80 hover:bg-white/15 hover:text-white'
                      }`}
                      aria-label="Project Threads"
                      aria-current={activeSection === 'gmail-inbox' ? 'page' : undefined}
                    >
                      <Inbox className="w-4 h-4" />
                      <span className="hidden lg:inline">Threads</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>Project Threads</TooltipContent>
                </Tooltip>

                {/* Online users - hide on mobile */}
                <div className="hidden sm:block">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <OnlineUsers />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>Who's Online</TooltipContent>
                  </Tooltip>
                </div>

                {/* Notifications — pulled into the comms tray so all
                    "is something happening?" tools cluster as one group
                    instead of sitting in their own separate slot. */}
                {typeof window !== 'undefined' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <EnhancedNotifications user={user} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>Notifications</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Thin vertical separator — marks the function-type switch
                  from communications (left) to operational tools (right).
                  Hidden on mobile where space is tight and the gap between
                  groups is already implied by smaller padding. */}
              <div
                aria-hidden="true"
                className="hidden sm:block w-px h-6 bg-white/20 mx-0.5"
              />

              {/* Quick Calculator — operational tool, sits outside the comms
                  tray. The vertical separator above visually distinguishes
                  its role from chat/threads/notifications. */}
              <div className="flex items-center">
                <QuickCalculator />
              </div>

              <NavViewModeToggle />

              {/* Group 3: Support dropdown — consolidates Help, Suggestions,
                  and Report Issue under a single ? icon. These actions are
                  used occasionally (not every session) so they don't deserve
                  their own header real estate — but they need to stay
                  discoverable. Standard SaaS "help menu" pattern. */}
              {(() => {
                // Resolve which topNav items the user actually has access to so
                // we don't render menu items that route to permission-denied pages.
                const supportNavItems = NAV_ITEMS.filter(
                  (item) => item.topNav && (!item.permission || hasPermission(user, item.permission))
                );
                const hasAnySupport = supportNavItems.length > 0 || true; // Report Issue is always shown
                if (!hasAnySupport) return null;
                return (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex items-center justify-center w-9 h-9 rounded-md transition-colors text-white/80 hover:bg-white/15 hover:text-white"
                            aria-label="Help and support"
                            data-testid="header-support-menu"
                          >
                            <HelpCircle className="w-5 h-5" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8}>Help & Support</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" sideOffset={8} className="w-52 z-[10000]">
                      <DropdownMenuLabel className="text-xs text-slate-500">
                        Help & Support
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {supportNavItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <DropdownMenuItem
                            key={item.id}
                            onSelect={() => {
                              logger.log(`${item.label} button clicked`);
                              trackButtonClick(item.id, 'dashboard_header');
                              localStorage.setItem('navigation_update_2024_v2_seen', 'true');
                              if (item.href === 'help') {
                                setLocation('/help');
                              } else {
                                setActiveSection(item.href);
                                window.history.pushState({}, '', `/dashboard?section=${item.href}`);
                              }
                              setIsMobileMenuOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            {Icon && <Icon className="w-4 h-4 mr-2 text-slate-500" />}
                            <span>{item.label}</span>
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuItem
                        onSelect={() => {
                          trackButtonClick('report_issue', 'dashboard_header');
                          openReportDialog();
                        }}
                        className="cursor-pointer"
                      >
                        <AlertCircle className="w-4 h-4 mr-2 text-slate-500" />
                        <span>Report an issue</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}

              {/* Group 4: Account avatar dropdown — replaces the standalone
                  Account button + Logout button. Avatar shows the user's
                  initials (or profile picture). Menu has Account Settings
                  + Logout, with logout styled destructively. Standard SaaS
                  pattern — every other app's user menu lives here. */}
              <div className="flex items-center pl-1 border-l border-white/20">
                {(() => {
                  // Compute initials + display name once.
                  const u = user as any;
                  const firstName = u?.firstName || '';
                  const lastName = u?.lastName || '';
                  const displayName = u?.displayName || `${firstName} ${lastName}`.trim() || u?.email?.split('@')[0] || 'User';
                  const initials = (() => {
                    if (firstName && lastName) {
                      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
                    }
                    if (firstName) return firstName.substring(0, 2).toUpperCase();
                    if (u?.displayName) {
                      const parts = u.displayName.trim().split(/\s+/);
                      if (parts.length >= 2) {
                        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
                      }
                      return u.displayName.substring(0, 2).toUpperCase();
                    }
                    if (u?.email) return u.email.substring(0, 2).toUpperCase();
                    return 'U';
                  })();

                  return (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="flex items-center gap-2 p-0.5 rounded-full transition-colors hover:bg-white/15"
                              aria-label="User menu"
                              data-testid="header-user-menu"
                            >
                              <Avatar className="h-8 w-8 ring-2 ring-white/30">
                                <AvatarImage src={u?.profileImageUrl || undefined} />
                                <AvatarFallback className="bg-white text-brand-primary font-semibold text-sm">
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                            </button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={8}>Account menu</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end" sideOffset={8} className="w-56 z-[10000]">
                        <DropdownMenuLabel className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-800 truncate">{displayName}</span>
                          {u?.email && (
                            <span className="text-xs font-normal text-slate-500 truncate">{u.email}</span>
                          )}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            trackButtonClick('profile', 'dashboard_header');
                            setActiveSection('profile');
                            window.history.pushState({}, '', '/dashboard?section=profile');
                            setIsMobileMenuOpen(false);
                          }}
                          className="cursor-pointer"
                        >
                          <UserCog className="w-4 h-4 mr-2 text-slate-500" />
                          <span>Account Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={async () => {
                            try {
                              trackButtonClick('logout', 'dashboard_header');
                              await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                              queryClient.clear();
                              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
                              queryClient.removeQueries({ queryKey: ['/api/auth/user'] });
                              window.location.href = '/login';
                            } catch (error) {
                              logger.error('Logout error:', error);
                              queryClient.clear();
                              window.location.href = '/login';
                            }
                          }}
                          className="cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50"
                        >
                          <LogOut className="w-4 h-4 mr-2" />
                          <span>Logout</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })()}
              </div>
            </div>
            </TooltipProvider>
          </div>
        </div>
        <div className="flex flex-1 min-h-0 relative pt-[60px] md:pt-0">
          {/* Mobile overlay */}
          {isMobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Sidebar */}
          <div
            className={`${
              isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
            } md:translate-x-0 fixed md:relative z-50 ${
              isSidebarCollapsed ? 'w-16' : 'w-56 xs:w-64 sm:w-72'
            } bg-gradient-to-b from-white to-orange-50/30 border-r-2 border-amber-200 shadow-lg flex flex-col transition-all duration-300 ease-in-out h-full`}
          >
            {/* Collapse Toggle Button */}
            <div className="hidden md:flex justify-end p-2 border-b border-amber-200">
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1.5 rounded-lg hover:bg-amber-100 transition-colors"
                aria-label={
                  isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
                }
                title={isSidebarCollapsed ? 'Click to expand navigation menu' : 'Click to collapse navigation menu'}
              >
                {isSidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-amber-700" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-amber-700 rotate-90" />
                )}
              </button>
            </div>

            {/* Simple Navigation with enhanced mobile scrolling */}
            <div className="flex-1 overflow-y-auto pb-6 touch-pan-y overscroll-auto sidebar-nav-scroll">
              <MultiViewSidebar
                navigationItems={NAV_ITEMS}
                isCollapsed={isSidebarCollapsed}
                onMobileClose={() => setIsMobileMenuOpen(false)}
                onTrackNavigation={trackNavigation}
                dashboardSetActiveSection={setActiveSection}
              />
            </div>

            {!isSidebarCollapsed && (
              <div className="px-4 py-3 border-t border-amber-200">
                <div className="bg-gradient-to-r from-teal-50 to-teal-100 border border-teal-200 rounded-lg px-3 py-2">
                  <div className="text-xs text-teal-700 font-medium uppercase tracking-wide">
                    Organization EIN
                  </div>
                  <div className="text-sm font-bold text-teal-900 font-mono">
                    87-0939484
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-hidden w-full md:w-auto relative z-10 bg-[#F6F9FA] min-w-0 min-h-0 flex flex-col">
            {/* Multi-View Toolbar */}
            <MultiViewToolbar currentSection={activeSection} />

            {/* Content Area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <MultiViewContainer
                renderContent={(section) => {
                  // Determine the content wrapper based on section type
                  const isFullHeightSection = ['gmail-inbox', 'inbox', 'messages', 'chat', 'route-map', 'recipient-map'].includes(section);
                  const isDriverPlanning = section === 'driver-planning';

                  if (isFullHeightSection) {
                    return <div className="h-full overflow-hidden">{renderContent(section)}</div>;
                  }

                  if (isDriverPlanning) {
                    return (
                      <div className="h-full min-h-0 overflow-hidden w-full max-w-full">
                        {renderContent(section)}
                      </div>
                    );
                  }

                  // Normal layout for other content
                  return (
                    <div className="h-full overflow-y-auto overflow-x-hidden w-full max-w-full">
                      <div className="w-full pb-[calc(5rem+var(--chat-window-space,0px))] min-h-full px-4 sm:px-6 pt-6">
                        <DashboardBreadcrumbs activeSection={section} />
                        {renderContent(section)}
                      </div>
                    </div>
                  );
                }}
                onSectionChange={(section, panelId) => {
                  // Update panel section when navigation happens within a panel
                  enhancedSetActiveSection(section);
                }}
              />
            </div>
          </div>
        </div>
        </div>

        {/* Guided Tour System - hidden on Team Chat (incl. multi-view panels) so the
            floating help button doesn't overlap the message/DM reply send button */}
        <GuidedTourGate activeSection={activeSection} />

        {/* AI Assistant - Only show on sections that don't have their own AI chat */}
        {!['event-requests', 'event-ops-dashboard', 'collections', 'analytics', 'grant-metrics', 'weekly-monitoring', 'event-impact-reports', 'team-board', 'tsp-network', 'projects', 'resources', 'important-links', 'meetings', 'groups-catalog'].includes(activeSection) && (
          <FloatingAIChat
            contextType="dashboard"
            title="TSP Assistant"
            subtitle="Ask anything about the platform"
            suggestedQuestions={[
              "What can I do on this platform?",
              "How do I add a new collection?",
              "What reports are available?",
              "How do I manage volunteers?",
              "Show me recent activity",
              "What's the status of our projects?",
            ]}
          />
        )}

        {/* Floating Views Container for pop-out windows */}
        <FloatingViewsContainer renderContent={renderContent} />
        </MultiViewProvider>
      </DashboardNavigationProvider>
    </>
    </NavViewModeProvider>
  );
}
