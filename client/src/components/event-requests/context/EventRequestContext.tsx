import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventRequest, EventVolunteer } from '@shared/schema';
import { useAuth } from '@/hooks/useAuth';
import { getEventRequestDefaults } from '@shared/role-view-defaults';
import { logger } from '@/lib/logger';
import { useLocation } from 'wouter';
import { buildEventRequestsListQuery, EVENT_REQUEST_LIST_FRESHNESS, type EventRequestsWeekScope } from '../lib/eventRequestsListQuery';
import { EventDialogProvider, useEventDialogState } from './EventDialogContext';
import { useIssueReport } from '@/contexts/issue-report-context';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';
import { EMPTY_IN_PROCESS_FILTERS, type InProcessFilters } from '../lib/inProcessFilters';
import {
  computeUnviewedNewCount,
  markEventRequestsViewed,
  pruneViewedEventIds,
  subscribeEventRequestViewedChanges,
} from '@/lib/event-request-viewed';

interface EventRequestContextType {
  // Event requests data
  eventRequests: EventRequest[];
  isLoading: boolean;
  isPlaceholderData?: boolean;
  quickFilter: 'week' | 'today' | 'needsDriver' | 'needsVan' | null;
  setQuickFilter: (filter: 'week' | 'today' | 'needsDriver' | 'needsVan' | null) => void;
  weekScope: EventRequestsWeekScope;
  setWeekScope: (scope: EventRequestsWeekScope) => void;

  // View state
  viewMode: 'list' | 'calendar' | 'map';
  setViewMode: (mode: 'list' | 'calendar' | 'map') => void;
  scheduledViewMode: 'card' | 'spreadsheet';
  setScheduledViewMode: (mode: 'card' | 'spreadsheet') => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  debouncedSearchQuery: string;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  myAssignmentsStatusFilter: string[];
  setMyAssignmentsStatusFilter: (statuses: string[]) => void;
  confirmationFilter: 'all' | 'confirmed' | 'requested';
  setConfirmationFilter: (filter: 'all' | 'confirmed' | 'requested') => void;
  sortBy: 'event_date_desc' | 'event_date_asc' | 'organization_asc' | 'organization_desc' | 'created_date_desc' | 'created_date_asc';
  setSortBy: (sort: any) => void;
  /** In Process tab filters/sort (shared so Export can match the visible rows) */
  inProcessFilters: InProcessFilters;
  setInProcessFilters: (filters: InProcessFilters) => void;

  // Pagination
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
  setItemsPerPage: (items: number) => void;

  // NOTE: dialog / inline-editing / assignment / sandwich-edit state lives
  // ONLY on EventDialogContext now. Consume it via useEventDialogState().
  // The Strangler pass-through that re-exported those fields here was removed
  // so consumers subscribe to just the context they need (fewer re-renders).

  // Computed data
  requestsByStatus: Record<string, EventRequest[]>;
  statusCounts: {
    all: number;
    new: number;
    in_process: number;
    scheduled: number;
    rescheduled: number;
    completed: number;
    declined: number;
    cancelled: number;
    non_event: number;
    standby: number;
    stalled: number;
    my_assignments: number;
  };
  statusCountsLoading: boolean;
  /** New requests this user hasn't opened yet (workflow status may still be `new`). */
  unviewedNewCount: number;
}

const EventRequestContext = createContext<EventRequestContextType | null>(null);

export const useEventRequestContext = () => {
  const context = useContext(EventRequestContext);
  if (!context) {
    throw new Error('useEventRequestContext must be used within EventRequestProvider');
  }
  return context;
};

interface EventRequestProviderProps {
  children: ReactNode;
  initialTab?: string | null;
  initialEventId?: number;
}

/**
 * Public provider. Wraps the tree in EventDialogProvider so components can call
 * useEventDialogState() for dialog/inline-edit state, while this provider serves
 * data/view/pagination via useEventRequestContext(). (The two were previously
 * merged; the dialog state was split out and the pass-through removed.)
 */
export const EventRequestProvider: React.FC<EventRequestProviderProps> = (props) => (
  <EventDialogProvider>
    <EventRequestProviderInner {...props} />
  </EventDialogProvider>
);

const EventRequestProviderInner: React.FC<EventRequestProviderProps> = ({
  children,
  initialTab,
  initialEventId
}) => {
  // Get current user for assignment checking
  const { user } = useAuth();
  const [location] = useLocation();

  // Pull all dialog/active-event/assignment/inline-editing state from the
  // newly-extracted EventDialogContext. We re-export each field through this
  // context's value below so existing consumers don't need to change their
  // imports yet (the destination of PR 2 is to switch them over).
  const dialog = useEventDialogState();
  const { setWorkingRecord } = useIssueReport();

  // Get role-based defaults for this user
  const roleDefaults = useMemo(() => {
    if (!user?.role) {
      return getEventRequestDefaults('viewer'); // Default fallback
    }
    return getEventRequestDefaults(user.role, user.id);
  }, [user?.role, user?.id]);

  // Quick filter state for special date ranges (This Week, Today, etc.)
  const [quickFilter, setQuickFilter] = useState<'week' | 'today' | 'needsDriver' | 'needsVan' | null>(null);
  const [weekScope, setWeekScope] = useState<EventRequestsWeekScope>(null);

  // View state - use role-based defaults if no initialTab provided
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'map'>('list');
  const [scheduledViewMode, setScheduledViewMode] = useState<'card' | 'spreadsheet'>(() => {
    const saved = localStorage.getItem('scheduledTabViewMode');
    return saved === 'spreadsheet' ? 'spreadsheet' : 'card';
  });
  // Default to 'new' tab if no initialTab is provided, otherwise use initialTab or role default
  const getDefaultTab = () => {
    if (initialTab && ['new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments', 'admin_overview'].includes(initialTab)) {
      return initialTab;
    }
    // Default to 'new' for event requests when no tab is specified
    return 'new';
  };
  const [activeTab, setActiveTab] = useState(getDefaultTab());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [myAssignmentsStatusFilter, setMyAssignmentsStatusFilter] = useState<string[]>(['new', 'in_process', 'scheduled']);

  // Build list query key + URL in one place (also used by Dashboard prefetch)
  const { queryKey: listQueryKey, listUrl: listQueryUrl, fullUrl: fullQueryUrl } = useMemo(
    () => buildEventRequestsListQuery(activeTab, quickFilter, weekScope),
    [activeTab, quickFilter, weekScope]
  );

  // Reset quickFilter when activeTab changes to something incompatible
  useEffect(() => {
    if (quickFilter && !['scheduled', 'new', 'in_process', 'all'].includes(activeTab)) {
      setQuickFilter(null);
    }
  }, [activeTab, quickFilter]);

  // Week scope from dashboard pipeline cards only applies on the All tab.
  useEffect(() => {
    if (weekScope && activeTab !== 'all') {
      setWeekScope(null);
    }
  }, [activeTab, weekScope]);

  // Fetch event requests with filtering and stale-while-revalidate
  // Uses lightweight /list endpoint for better performance
  const { data: eventRequests = [], isLoading, isPlaceholderData } = useQuery<EventRequest[]>({
    queryKey: listQueryKey,
    queryFn: async () => {
      const response = await fetch(listQueryUrl, {
        credentials: 'include',
      });
      if (!response.ok) {
        // Fallback to full endpoint if list endpoint fails
        logger.warn('List endpoint failed, falling back to full endpoint');
        const fallbackResponse = await fetch(fullQueryUrl, {
          credentials: 'include',
        });
        if (!fallbackResponse.ok) throw new Error('Failed to fetch event requests');
        return fallbackResponse.json();
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    ...EVENT_REQUEST_LIST_FRESHNESS,
  });

  // Fetch status counts separately (for tab badges)
  const { data: serverStatusCounts, isLoading: statusCountsLoading } = useQuery<{
    all: number;
    new: number;
    in_process: number;
    scheduled: number;
    rescheduled: number;
    completed: number;
    declined: number;
    cancelled: number;
    non_event: number;
    standby: number;
    stalled: number;
    my_assignments: number;
  }>({
    queryKey: ['/api/event-requests/status-counts'],
    queryFn: async () => {
      const response = await fetch('/api/event-requests/status-counts', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch status counts');
      return response.json();
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    ...EVENT_REQUEST_LIST_FRESHNESS,
  });

  // Fetch event volunteers data for assignment checking
  const { data: eventVolunteers = [] } = useQuery<EventVolunteer[]>({
    queryKey: ['/api/event-requests/my-volunteers'],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  // Update activeTab when initialTab prop changes (for navigation)
  useEffect(() => {
    const validTabs = ['all', 'new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments', 'admin_overview', 'sandwich_overview'];
    if (initialTab && validTabs.includes(initialTab)) {
      logger.log('[EventRequestContext] Setting activeTab from initialTab:', initialTab);
      setActiveTab(initialTab);
    } else if (!initialTab) {
      // Reset to 'new' when initialTab is cleared/null (but only if we're not already on a valid tab)
      if (!validTabs.includes(activeTab)) {
        logger.log('[EventRequestContext] Resetting activeTab to new (initialTab is null)');
        setActiveTab('new');
      }
    }
  }, [initialTab]);

  // Also listen to URL changes directly in case the component doesn't remount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabFromUrl = urlParams.get('tab');
    const sectionFromUrl = urlParams.get('section');
    const validTabs = ['all', 'new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments', 'admin_overview', 'sandwich_overview'];

    // Only update if we're on the event-requests section and there's a valid tab in the URL
    if (sectionFromUrl === 'event-requests' && tabFromUrl && validTabs.includes(tabFromUrl)) {
      logger.log('[EventRequestContext] URL changed, updating activeTab from URL:', tabFromUrl, 'current activeTab:', activeTab);
      if (activeTab !== tabFromUrl) {
        setActiveTab(tabFromUrl);
      }
    } else if (sectionFromUrl === 'event-requests' && !tabFromUrl && !validTabs.includes(activeTab)) {
      // If we're on event-requests but no tab in URL and current tab is invalid, default to 'new'
      logger.log('[EventRequestContext] No tab in URL, defaulting to new');
      setActiveTab('new');
    }
  }, [location, activeTab]);

  // Pre-fill issue report context when working on event requests
  useEffect(() => {
    const sectionFromUrl = new URLSearchParams(window.location.search).get('section');
    if (sectionFromUrl !== 'event-requests') return;

    const tabLabel = activeTab.replace(/_/g, ' ');
    const event = dialog.selectedEventRequest;
    if (event?.id) {
      setWorkingRecord({
        recordType: 'event_request',
        recordId: String(event.id),
        recordLabel: event.organizationName || undefined,
        pageLabel: `Event Management — ${tabLabel}`,
      });
    } else {
      setWorkingRecord({
        pageLabel: `Event Management — ${tabLabel}`,
      });
    }
  }, [
    activeTab,
    dialog.selectedEventRequest?.id,
    dialog.selectedEventRequest?.organizationName,
    setWorkingRecord,
  ]);

  const [confirmationFilter, setConfirmationFilter] = useState<'all' | 'confirmed' | 'requested'>(roleDefaults.defaultConfirmationFilter);
  const [sortBy, setSortBy] = useState<'event_date_desc' | 'event_date_asc' | 'organization_asc' | 'organization_desc' | 'created_date_desc' | 'created_date_asc'>(roleDefaults.defaultSort);
  const [inProcessFilters, setInProcessFilters] = useState<InProcessFilters>(EMPTY_IN_PROCESS_FILTERS);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(roleDefaults.itemsPerPage);

  // NOTE: Dialog/active-event/assignment/inline-editing state is no longer
  // declared here — it lives in EventDialogContext. We read it via the
  // `dialog` ref above and re-export it on this context's value for
  // backwards compatibility (see PR plan).

  // Group requests by status
  const requestsByStatus = useMemo(() => {
    const groups = eventRequests.reduce((acc: any, request: EventRequest) => {
      if (!acc[request.status]) {
        acc[request.status] = [];
      }
      acc[request.status].push(request);
      return acc;
    }, {});

    // Sort each group by newest first
    Object.keys(groups).forEach((status) => {
      groups[status].sort(
        (a: EventRequest, b: EventRequest) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    return groups;
  }, [eventRequests]);

  // Helper function to check if current user is assigned to an event
  const isUserAssignedToEvent = useCallback((request: EventRequest): boolean => {
    if (!user?.id) return false;

    // Check TSP Contact assignment (check both tspContactAssigned and tspContact columns)
    if (request.tspContactAssigned === user.id || request.tspContact === user.id) {
      return true;
    }

    // Check additional TSP contacts (parity with server + useEventFilters)
    if (request.additionalContact1 === user.id || request.additionalContact2 === user.id) {
      return true;
    }

    // Check driver assignment in driverDetails JSONB field
    if (request.driverDetails) {
      try {
        const driverDetails = typeof request.driverDetails === 'string' 
          ? JSON.parse(request.driverDetails) 
          : request.driverDetails;
        
        // Driver assignments are stored as keys in the driverDetails object
        // Example: {"351": {"name": "Gary Munder", "assignedBy": "admin_..."}}
        // The user.id should match one of the keys (351, not the assignedBy)
        if (driverDetails && typeof driverDetails === 'object' && !Array.isArray(driverDetails)) {
          const driverKeys = Object.keys(driverDetails);
          if (driverKeys.some(key => key === user.id || key === user.id.toString())) {
            return true;
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check speaker assignment in speakerDetails JSONB field
    if (request.speakerDetails) {
      try {
        const speakerDetails = typeof request.speakerDetails === 'string' 
          ? JSON.parse(request.speakerDetails) 
          : request.speakerDetails;
        
        // Speaker assignments are stored as keys in the speakerDetails object
        if (speakerDetails && typeof speakerDetails === 'object' && !Array.isArray(speakerDetails)) {
          const speakerKeys = Object.keys(speakerDetails);
          if (speakerKeys.some(key => key === user.id || key === user.id.toString())) {
            return true;
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check event volunteers assignment (driver, speaker, general)
    const userVolunteerAssignment = eventVolunteers.find(volunteer => 
      volunteer.eventRequestId === request.id && 
      volunteer.volunteerUserId === user.id
    );
    
    if (userVolunteerAssignment) {
      return true;
    }

    return false;
  }, [user?.id, eventVolunteers]);

  // Use server-side status counts for accurate tab badges
  // IMPORTANT: Always prefer serverStatusCounts over fallback since eventRequests is filtered by active tab
  // The statusCountsLoading flag is passed to RequestFilters so formatCount can show '...' while loading
  const statusCounts = {
    all: serverStatusCounts?.all ?? 0,
    new: serverStatusCounts?.new ?? 0,
    in_process: serverStatusCounts?.in_process ?? 0,
    scheduled: serverStatusCounts?.scheduled ?? 0,
    rescheduled: serverStatusCounts?.rescheduled ?? 0,
    completed: serverStatusCounts?.completed ?? 0,
    declined: serverStatusCounts?.declined ?? 0,
    cancelled: serverStatusCounts?.cancelled ?? 0,
    non_event: serverStatusCounts?.non_event ?? 0,
    standby: serverStatusCounts?.standby ?? 0,
    stalled: serverStatusCounts?.stalled ?? 0,
    // my_assignments count is calculated server-side to include TSP contacts, drivers, speakers
    my_assignments: serverStatusCounts?.my_assignments ?? 0,
  };

  const queryClient = useQueryClient();
  const [viewedRevision, setViewedRevision] = useState(0);
  useEffect(() => subscribeEventRequestViewedChanges(() => setViewedRevision((v) => v + 1)), []);

  const newTabListQuery = useMemo(() => buildEventRequestsListQuery('new', null), []);
  const {
    data: newEventsForBadge,
    isFetched: newEventsListFetched,
  } = useQuery<EventRequest[]>({
    queryKey: newTabListQuery.queryKey,
    queryFn: async () => {
      const response = await fetch(newTabListQuery.listUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch new event requests');
      return response.json();
    },
    enabled: !!user?.id && statusCounts.new > 0,
    staleTime: 2 * 60 * 1000,
  });

  const newEventsForUnviewedCount = useMemo(() => {
    if (newEventsForBadge && newEventsForBadge.length > 0) {
      return newEventsForBadge;
    }
    if (activeTab === 'new' && eventRequests.length > 0) {
      return eventRequests;
    }
    const cached = queryClient.getQueryData<EventRequest[]>(newTabListQuery.queryKey);
    return cached ?? [];
  }, [
    newEventsForBadge,
    activeTab,
    eventRequests,
    queryClient,
    newTabListQuery.queryKey,
  ]);

  useEffect(() => {
    if (!user?.id || newEventsForUnviewedCount.length === 0) return;
    pruneViewedEventIds(
      user.id,
      newEventsForUnviewedCount
        .filter((event) => event.status === 'new')
        .map((event) => event.id)
    );
  }, [user?.id, newEventsForUnviewedCount]);

  // Visiting the New tab means the user has seen what's there — clear the
  // tab dot without changing workflow status. New arrivals while they're on
  // another tab will bump unviewedNewCount again.
  useEffect(() => {
    if (activeTab !== 'new' || !user?.id || statusCounts.new === 0) return;

    const newEventIds = newEventsForUnviewedCount
      .filter((event) => event.status === 'new')
      .map((event) => event.id);

    if (newEventIds.length === 0) return;

    markEventRequestsViewed(user.id, newEventIds);
  }, [
    activeTab,
    user?.id,
    statusCounts.new,
    newEventsForUnviewedCount,
  ]);

  const unviewedNewCount = useMemo(() => {
    void viewedRevision;
    if (!user?.id || statusCounts.new === 0) return 0;

    const listResolved =
      newEventsForUnviewedCount.some((event) => event.status === 'new') ||
      newEventsListFetched;

    return computeUnviewedNewCount(
      user.id,
      newEventsForUnviewedCount,
      statusCounts.new,
      listResolved
    );
  }, [
    user?.id,
    statusCounts.new,
    newEventsForUnviewedCount,
    newEventsListFetched,
    viewedRevision,
  ]);

  // Sync state with role defaults when user loads (handles async user fetch)
  // Only applies defaults if no explicit initialTab was provided (respects URL navigation)
  // and no dashboard drill-down filter is pending (Operational Overview / My Assignments).
  useEffect(() => {
    if (initialTab) return;

    try {
      const raw = sessionStorage.getItem('eventRequests.pendingFilter');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          tab?: string;
          filter?: string;
          weekScope?: EventRequestsWeekScope;
          myAssignmentsStatuses?: string[];
        };
        sessionStorage.removeItem('eventRequests.pendingFilter');
        const validTabs = ['all', 'new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments'];
        const validFilters = ['week', 'today', 'needsDriver', 'needsVan'];
        const validWeekScopes: EventRequestsWeekScope[] = ['current', 'next', '+2', '+3'];
        if (parsed.tab && validTabs.includes(parsed.tab)) setActiveTab(parsed.tab);
        if (parsed.weekScope && validWeekScopes.includes(parsed.weekScope)) {
          setWeekScope(parsed.weekScope);
          setQuickFilter(null);
        } else if (parsed.filter && validFilters.includes(parsed.filter)) {
          setQuickFilter(parsed.filter as typeof quickFilter);
          setWeekScope(null);
        }
        if (parsed.myAssignmentsStatuses?.length) {
          setMyAssignmentsStatusFilter(parsed.myAssignmentsStatuses);
        }
        return;
      }
    } catch {
      // ignore malformed/unavailable sessionStorage
    }

    setActiveTab(roleDefaults.defaultTab);
    setConfirmationFilter(roleDefaults.defaultConfirmationFilter);
    setSortBy(roleDefaults.defaultSort);
    setItemsPerPage(roleDefaults.itemsPerPage);
  }, [roleDefaults.defaultTab, roleDefaults.defaultConfirmationFilter, roleDefaults.defaultSort, roleDefaults.itemsPerPage, initialTab]);

  // Synchronize statusFilter with activeTab (only for status-based tabs)
  useEffect(() => {
    // Only sync statusFilter for tabs that correspond to status values
    if (['all', 'new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments'].includes(activeTab)) {
      setStatusFilter(activeTab);
    }
    // For admin_overview and sandwich_overview, don't change statusFilter
  }, [activeTab]);

  // Auto-sort by appropriate default for each tab (only when tab changes)
  // This provides smart defaults but user can still override
  useEffect(() => {
    if (activeTab === 'all') {
      setSortBy('event_date_asc');
    } else if (activeTab === 'new') {
      setSortBy('created_date_desc');
    } else if (activeTab === 'scheduled' || activeTab === 'in_process' || activeTab === 'my_assignments') {
      // For scheduled and my_assignments, show upcoming events first
      setSortBy('event_date_asc');
    } else if (activeTab === 'completed') {
      // Completed events: most recent first — past events are what users want to see when they switch tabs.
      setSortBy('event_date_desc');
    }
  }, [activeTab]);

  // Debounce search query to improve performance (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset pagination when filters or tab change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, debouncedSearchQuery, statusFilter, sortBy]);

  // Track if we've already handled the initial event to prevent reopening
  const [hasHandledInitialEvent, setHasHandledInitialEvent] = useState(false);
  const [lastHandledEventId, setLastHandledEventId] = useState<number | undefined>(undefined);

  // Reset handled flag when initialEventId changes to a new value
  useEffect(() => {
    if (initialEventId && initialEventId !== lastHandledEventId) {
      setHasHandledInitialEvent(false);
    }
  }, [initialEventId, lastHandledEventId]);

  // Handle initial event ID - auto-open event details if specified
  useEffect(() => {
    if (initialTab && ['new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'standby', 'stalled', 'non_event', 'my_assignments', 'admin_overview'].includes(initialTab)) {
      setActiveTab(initialTab);
    }

    if (initialEventId && eventRequests.length > 0 && !hasHandledInitialEvent) {
      const targetEvent = eventRequests.find(req => req.id === initialEventId);
      if (targetEvent) {
        // Open the details dialog via the new EventDialogContext helper.
        dialog.openEventDetails(targetEvent, { isEditing: false });
        setHasHandledInitialEvent(true); // Mark as handled to prevent reopening
        setLastHandledEventId(initialEventId); // Track which event was handled

        if (!initialTab) {
          if (targetEvent.status === 'completed') {
            setActiveTab('completed');
          } else if (isScheduledOrRescheduled(targetEvent.status)) {
            setActiveTab('scheduled');
          } else if (targetEvent.status === 'in_process') {
            setActiveTab('in_process');
          } else if (targetEvent.status === 'standby') {
            setActiveTab('standby');
          } else if (targetEvent.status === 'stalled') {
            setActiveTab('stalled');
          } else if (targetEvent.status === 'declined' || targetEvent.status === 'cancelled') {
            setActiveTab('declined');
          } else {
            setActiveTab('new');
          }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [initialTab, initialEventId, eventRequests, hasHandledInitialEvent]);

  // Memoize context value. This context now owns ONLY data / view / pagination
  // state — dialog and inline-editing state lives on EventDialogContext and is
  // consumed directly via useEventDialogState(). The Strangler pass-through that
  // used to spread those fields here was removed (that's where the re-render win
  // landed: consumers subscribe to just the context they need).
  const value: EventRequestContextType = useMemo(() => ({
    // ---- Fields owned by this context ----
    // Data
    eventRequests,
    isLoading,
    isPlaceholderData,
    quickFilter,
    setQuickFilter,
    weekScope,
    setWeekScope,
    requestsByStatus,
    statusCounts,
    statusCountsLoading,
    unviewedNewCount,

    // View state
    viewMode,
    setViewMode,
    scheduledViewMode,
    setScheduledViewMode,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    statusFilter,
    setStatusFilter,
    myAssignmentsStatusFilter,
    setMyAssignmentsStatusFilter,
    confirmationFilter,
    setConfirmationFilter,
    sortBy,
    inProcessFilters,
    setInProcessFilters,
    setSortBy,

    // Pagination
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,

  }), [
    // Query results / data this context owns
    eventRequests, isLoading, isPlaceholderData, statusCountsLoading,
    requestsByStatus, statusCounts, unviewedNewCount,
    // View state this context owns
    quickFilter, weekScope, viewMode, scheduledViewMode, activeTab, searchQuery, debouncedSearchQuery,
    statusFilter, myAssignmentsStatusFilter, confirmationFilter, sortBy, inProcessFilters,
    // Pagination
    currentPage, itemsPerPage,
  ]);

  return (
    <EventRequestContext.Provider value={value}>
      {children}
    </EventRequestContext.Provider>
  );
};