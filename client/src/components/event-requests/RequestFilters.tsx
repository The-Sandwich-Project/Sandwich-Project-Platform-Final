import { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  Calendar,
  XCircle,
  UserCheck,
  Star,
  Pause,
  BarChart3,
  LayoutList,
  Hourglass,
  AlertCircle,
  Ban,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { Info } from 'lucide-react';

/**
 * Per-tab guidance tip — shown as an inline banner under the active status tab
 * so new team members can see at a glance what action is expected at that stage.
 * Wording mirrors STATUS_DEFINITIONS.guidance in shared/event-status-workflow.ts
 * but condensed for an at-a-glance read.
 */
const STATUS_TAB_TIPS: Record<string, string> = {
  new: 'Review the details and make first contact. Move to In Process once you’ve sent the toolkit, or Non-Event if it isn’t a real event request.',
  in_process: 'Work with the contact to finalize event details. Move to Scheduled once a date is locked in, or Standby/Stalled if you’re waiting on them.',
  scheduled: 'Assign drivers and volunteers. Confirm logistics. Move to Completed after the event date, or Cancelled/Rescheduled if plans change.',
  rescheduled: 'Treat like a Scheduled event. Re-confirm assignments for the new date.',
  completed: 'Finish 1-day and 1-month follow-ups, and request a social media post if applicable.',
  declined: 'Record the reason. Can be reactivated if they come back later.',
  cancelled: 'Make sure the cancellation reason is documented in the notes.',
  non_event: 'Terminal status — applies to requests that turned out not to be real events.',
  standby: 'Follow up closely. Move back to In Process or Scheduled once they’re ready, or to Stalled/Declined if they don’t respond.',
  stalled: 'Continue periodic outreach. Move back to In Process if they respond, or Declined if they confirm they’re no longer interested.',
  all: 'All events across every status — useful for searching or auditing.',
};

/**
 * Per-status brand color for the filter tabs. Mirrors the colors used by
 * the card-level badges (statusBorderColors in constants.ts) so the tab
 * row and the card content read as one consistent visual system.
 *
 * Tab values that aren't workflow statuses (e.g. 'all', 'my_assignments')
 * get a neutral teal so they read as "view filters" rather than statuses.
 */
const STATUS_TAB_COLOR: Record<string, string> = {
  all: '#236383',
  new: '#007E8C',
  in_process: '#FBAD3F',
  scheduled: '#236383',
  rescheduled: '#236383',
  completed: '#47B3CB',
  declined: '#A31C41',
  non_event: '#78716C',
  standby: '#114154',
  stalled: '#6B7280',
  my_assignments: '#236383',
};

/**
 * Gold and light teal fail WCAG as text on white (≈1.9:1 / 2.4:1) and white
 * fails as text on them. Those tabs use navy text and a full-strength border
 * instead of tinted text.
 */
const LOW_CONTRAST_TAB_COLORS = new Set(['#FBAD3F', '#47B3CB']);
const TSP_NAVY = '#114154';

interface RequestFiltersProps {
  // Search and filter states
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (filter: string) => void;
  confirmationFilter: 'all' | 'confirmed' | 'requested';
  onConfirmationFilterChange: (filter: 'all' | 'confirmed' | 'requested') => void;
  sortBy: 'event_date_desc' | 'event_date_asc' | 'organization_asc' | 'organization_desc' | 'created_date_desc' | 'created_date_asc';
  onSortByChange: (sort: 'event_date_desc' | 'event_date_asc' | 'organization_asc' | 'organization_desc' | 'created_date_desc' | 'created_date_asc') => void;

  // Tab state
  activeTab: string;
  onActiveTabChange: (tab: string) => void;

  // Pagination state
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (itemsPerPage: number) => void;

  // Status counts for tab badges
  statusCounts: {
    all: number;
    new: number;
    in_process: number;
    scheduled: number;
    completed: number;
    declined: number;
    cancelled: number;
    standby: number;
    stalled: number;
    my_assignments: number;
  };
  statusCountsLoading?: boolean;
  /** Unopened new requests for this user (tab dot only). */
  unviewedNewCount?: number;

  // Content for each tab
  children: {
    all: ReactNode;
    new: ReactNode;
    in_process: ReactNode;
    scheduled: ReactNode;
    completed: ReactNode;
    declined: ReactNode;
    standby: ReactNode;
    stalled: ReactNode;
    my_assignments: ReactNode;
    admin_overview?: ReactNode;
    sandwich_overview?: ReactNode;
  };

  // Pagination info
  totalItems: number;
  totalPages: number;
}

export default function RequestFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  confirmationFilter,
  onConfirmationFilterChange,
  sortBy,
  onSortByChange,
  activeTab,
  onActiveTabChange,
  currentPage,
  onCurrentPageChange,
  itemsPerPage,
  onItemsPerPageChange,
  statusCounts,
  statusCountsLoading,
  unviewedNewCount = 0,
  children,
  totalItems,
  totalPages,
}: RequestFiltersProps) {
  const { user } = useAuth();

  // Helper to format count display - shows loading indicator when counts are loading
  const formatCount = (count: number | undefined): string => {
    if (statusCountsLoading) return '...';
    return count !== undefined ? String(count) : '';
  };

  // Support both old and new permission strings for backward compatibility
  const hasAdminOverviewPermission = user?.permissions?.includes(PERMISSIONS.EVENT_REQUESTS_VIEW_ADMIN_OVERVIEW) ||
    user?.permissions?.includes('view_admin_overview') ||
    user?.role === 'super_admin';

  // Navigation tabs (non-status pages)
  const navTabs: Array<{ value: string; label: string; shortLabel: string; icon: any; count?: number; hasNotification?: boolean }> = [];

  if (hasAdminOverviewPermission && children.admin_overview) {
    navTabs.push({
      value: 'admin_overview',
      label: 'Admin Overview',
      shortLabel: 'Admin',
      icon: BarChart3,
    });
  }

  if (hasAdminOverviewPermission && children.sandwich_overview) {
    navTabs.push({
      value: 'sandwich_overview',
      label: 'Sandwich Destinations',
      shortLabel: 'Destinations',
      icon: Truck,
    });
  }

  navTabs.push({
    value: 'my_assignments',
    label: 'My Assignments',
    shortLabel: 'Mine',
    icon: UserCheck,
    count: statusCounts.my_assignments,
  });

  // Status filter tabs
  const tabConfig: Array<{ value: string; label: string; shortLabel: string; icon: any; count?: number; hasNotification?: boolean }> = [
    ...navTabs,
    {
      value: 'all',
      label: 'All',
      shortLabel: 'All',
      icon: LayoutList,
      count: statusCounts.all,
    },
    {
      value: 'new',
      label: 'New',
      shortLabel: 'New',
      icon: Star,
      count: statusCounts.new,
      hasNotification: unviewedNewCount > 0,
    },
    {
      value: 'in_process',
      label: 'In Process',
      shortLabel: 'Process',
      icon: Clock,
      count: statusCounts.in_process,
    },
    {
      value: 'scheduled',
      label: 'Scheduled',
      shortLabel: 'Scheduled',
      icon: Calendar,
      count: statusCounts.scheduled + statusCounts.rescheduled,
    },
    {
      value: 'rescheduled',
      label: 'Rescheduled',
      shortLabel: 'Resched',
      icon: RefreshCw,
      count: statusCounts.rescheduled,
    },
    {
      value: 'completed',
      label: 'Completed',
      shortLabel: 'Done',
      icon: CheckCircle,
      count: statusCounts.completed,
    },
    {
      value: 'declined',
      label: 'Declined/Cancelled',
      shortLabel: 'D/C',
      icon: XCircle,
      count: statusCounts.declined + statusCounts.cancelled,
    },
    {
      value: 'standby',
      label: 'Standby',
      shortLabel: 'Standby',
      icon: Hourglass,
      count: statusCounts.standby,
    },
    {
      value: 'stalled',
      label: 'Stalled',
      shortLabel: 'Stalled',
      icon: AlertCircle,
      count: statusCounts.stalled,
    },
    {
      value: 'non_event',
      label: 'Non-Event',
      shortLabel: 'N/E',
      icon: Ban,
      count: statusCounts.non_event,
    }
  ];

  // Get current tab info for mobile selector
  const currentTab = tabConfig.find(tab => tab.value === activeTab);

  return (
    <div className="space-y-4">
      {/* Search + filter dropdowns — single row */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#007E8C] w-4 h-4" />
          <Input
            id="event-requests-search"
            placeholder="Search events…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 w-full"
            data-testid="input-search-requests"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#007E8C] hover:text-[#004f57] font-semibold"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
        <Select
          value={confirmationFilter}
          onValueChange={(value: any) => onConfirmationFilterChange(value)}
        >
          <SelectTrigger className="w-full md:w-40">
            <SelectValue placeholder="Filter by..." />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value: any) => onSortByChange(value)}
        >
          <SelectTrigger className="w-full md:w-52" data-testid="sort-select-trigger-desktop">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent className="z-[100]" position="popper" sideOffset={5}>
            <SelectItem value="created_date_desc">Newest First</SelectItem>
            <SelectItem value="created_date_asc">Oldest First</SelectItem>
            <SelectItem value="event_date_desc">Event Date (Recent)</SelectItem>
            <SelectItem value="event_date_asc">Event Date (Oldest)</SelectItem>
            <SelectItem value="organization_asc">Organization A-Z</SelectItem>
            <SelectItem value="organization_desc">Organization Z-A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mobile: Tab selector dropdown */}
      <div className="md:hidden">
        <Select value={activeTab} onValueChange={onActiveTabChange}>
          <SelectTrigger className="h-9 text-sm">
            <div className="flex items-center space-x-1.5 truncate">
              {currentTab && (
                <>
                  <currentTab.icon className="w-3.5 h-3.5 text-[#007E8C] flex-shrink-0" />
                  <span className="truncate">{currentTab.shortLabel}</span>
                  {currentTab.count !== undefined && <span className="text-gray-500 text-xs">({formatCount(currentTab.count)})</span>}
                </>
              )}
            </div>
          </SelectTrigger>
          <SelectContent className="mobile-select-content">
            {tabConfig.map((tab) => (
              <SelectItem key={tab.value} value={tab.value} className="mobile-select-item">
                <div className="flex items-center space-x-2">
                  <tab.icon className="w-4 h-4 text-[#007E8C]" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && <span className="text-gray-500">({formatCount(tab.count)})</span>}
                  {tab.hasNotification && !statusCountsLoading && (
                    <div className="w-2 h-2 bg-tsp-red rounded-full" />
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {STATUS_TAB_TIPS[activeTab] && (
          <div className="flex items-start gap-2 px-3 py-2 mt-2 rounded-md bg-[#007E8C]/8 border border-[#007E8C]/20 text-[13px] text-[#236383] leading-snug">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#007E8C]" aria-hidden="true" />
            <p>{STATUS_TAB_TIPS[activeTab]}</p>
          </div>
        )}
      </div>

      {/* Desktop: Tab Bar - Hidden on mobile */}
      <div className="hidden md:block space-y-3">
        {/* Secondary navigation (pages/views) — visually distinct from status filters */}
        {navTabs.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold mr-1">Views:</span>
            {navTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => onActiveTabChange(tab.value)}
                className={`text-xs lg:text-sm whitespace-nowrap px-3 py-1.5 rounded-md font-medium transition-colors border ${
                  activeTab === tab.value
                    ? 'bg-[#236383] text-white border-[#236383] shadow-sm'
                    : 'text-[#236383] border-[#236383]/20 bg-[#236383]/5 hover:bg-[#236383]/10 hover:border-[#236383]/40'
                }`}
                data-testid={tab.value === 'my_assignments' ? 'tab-my-assignments' : undefined}
                data-tour={tab.value === 'my_assignments' ? 'my-assignments-tab' : undefined}
              >
                <div className="flex items-center justify-center space-x-1.5">
                  <tab.icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="hidden lg:inline">{tab.label}</span>
                  <span className="lg:hidden">{tab.shortLabel}</span>
                  {tab.count !== undefined && <span className="text-xs opacity-70">({formatCount(tab.count)})</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Status filter tabs — the primary filter mechanism.
            Each tab is color-coded by workflow stage so the eye can
            distinguish "Scheduled" from "In Process" at a glance even
            in the inactive state, and the active state strongly fills
            with the matching brand color. Inactive: tinted icon + tinted
            border, transparent bg. Active: filled bg, white text, hard
            border. Card-level badges already use these same colors so
            the tab strip and the card content now read as one system. */}
        <Tabs value={activeTab} onValueChange={onActiveTabChange} className="space-y-4">
          <div className="w-full overflow-x-auto pb-1">
            <TabsList className="inline-flex w-auto min-w-full gap-1 bg-transparent">
              {tabConfig.filter(tab => !navTabs.some(nt => nt.value === tab.value)).map((tab) => {
                const color = STATUS_TAB_COLOR[tab.value] || STATUS_TAB_COLOR.all;
                const isActive = activeTab === tab.value;
                const lowContrast = LOW_CONTRAST_TAB_COLORS.has(color);
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    data-state={isActive ? 'active' : 'inactive'}
                    className="relative text-xs lg:text-sm whitespace-nowrap px-2 lg:px-4 border-2 transition-colors data-[state=active]:shadow-sm"
                    style={
                      isActive
                        ? {
                            // Active: filled brand color, white text +
                            // icon, matching darker border.
                            backgroundColor: color,
                            borderColor: color,
                            color: lowContrast ? TSP_NAVY : '#ffffff',
                          }
                        : {
                            // Inactive: transparent fill, brand-tinted
                            // text + border so the workflow stage is
                            // still recognizable without selection.
                            backgroundColor: 'transparent',
                            borderColor: lowContrast ? color : `${color}55`,
                            color: lowContrast ? TSP_NAVY : color,
                          }
                    }
                  >
                    <div className="flex items-center justify-center space-x-1">
                      <tab.icon className="w-3 h-3 flex-shrink-0" />
                      <span className="hidden lg:inline">{tab.label}</span>
                      <span className="lg:hidden">{tab.shortLabel}</span>
                      {tab.count !== undefined && (
                        <span
                          className="text-xs"
                          style={{ opacity: isActive ? 0.85 : 0.7 }}
                        >
                          ({formatCount(tab.count)})
                        </span>
                      )}
                    </div>
                    {tab.hasNotification && !statusCountsLoading && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-tsp-red rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </Tabs>

        {/* Per-tab guidance banner — actionable tip for what to do at each
            stage. Hidden when the user is on a non-status filter (e.g.,
            navTabs like Planning) since those don't map to a workflow stage. */}
        {STATUS_TAB_TIPS[activeTab] && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-[#007E8C]/8 border border-[#007E8C]/20 text-[13px] text-[#236383] leading-snug">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#007E8C]" aria-hidden="true" />
            <p>
              <span className="font-semibold">
                {tabConfig.find((t) => t.value === activeTab)?.label}:
              </span>{' '}
              {STATUS_TAB_TIPS[activeTab]}
            </p>
          </div>
        )}
      </div>

      {/* Top Pagination - Shown on all screen sizes when there are multiple pages */}
      {totalPages > 1 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-4 border-b">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Items per page:</span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => onItemsPerPageChange(parseInt(value))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} ({totalItems} total)
            </span>
            <div className="flex space-x-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCurrentPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                data-testid="button-previous-page-top"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCurrentPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                data-testid="button-next-page-top"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content - Shown on all screen sizes */}
      <div className="space-y-4">
        {children[activeTab as keyof typeof children] || (
          <div className="text-center py-8 text-gray-500">
            Tab content not found. Please select a valid tab.
          </div>
        )}
      </div>

      {/* Bottom Pagination - Shown on all screen sizes when there are multiple pages */}
      {totalPages > 1 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4 border-t">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Items per page:</span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => onItemsPerPageChange(parseInt(value))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} ({totalItems} total)
            </span>
            <div className="flex space-x-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCurrentPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                data-testid="button-previous-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCurrentPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
