export type EventRequestsQuickFilter = 'week' | 'today' | 'needsDriver' | 'needsVan' | null;

/** Monday–Sunday calendar week scope (matches dashboard pipeline cards). */
export type EventRequestsWeekScope = 'current' | 'next' | '+2' | '+3' | null;

export const WEEK_SCOPE_LABELS: Record<Exclude<EventRequestsWeekScope, null>, string> = {
  current: 'This Week',
  next: 'Next Week',
  '+2': '2 Weeks Out',
  '+3': '3 Weeks Out',
};

export const WEEK_OFFSET_TO_SCOPE: Exclude<EventRequestsWeekScope, null>[] = [
  'current',
  'next',
  '+2',
  '+3',
];

export type EventRequestsListFilterParams = {
  days?: number;
  week?: string;
  status?: string;
  needsAction?: string;
  needsDriver?: string;
  needsVan?: string;
};

function buildQueryString(filterParams: EventRequestsListFilterParams): string {
  const queryParams = new URLSearchParams();
  if (filterParams.days) queryParams.set('days', filterParams.days.toString());
  if (filterParams.week) queryParams.set('week', filterParams.week);
  if (filterParams.status) queryParams.set('status', filterParams.status);
  if (filterParams.needsAction) queryParams.set('needsAction', filterParams.needsAction);
  if (filterParams.needsDriver) queryParams.set('needsDriver', filterParams.needsDriver);
  if (filterParams.needsVan) queryParams.set('needsVan', filterParams.needsVan);
  return queryParams.toString();
}

export function buildEventRequestsListFilterParams(
  activeTab: string,
  quickFilter: EventRequestsQuickFilter,
  weekScope: EventRequestsWeekScope = null,
): EventRequestsListFilterParams {
  const ALL_ACTIVE_STATUSES = 'new,in_process,scheduled,rescheduled';
  const PIPELINE_STATUSES = 'new,in_process,scheduled';

  // Dashboard pipeline / forecast cards drill into a specific calendar week.
  if (weekScope) {
    return { week: weekScope, status: PIPELINE_STATUSES };
  }

  // Handle quick filters first
  if (quickFilter === 'week') {
    // Dashboard "This Week" tile: all active events within the current
    // Monday-Sunday calendar week (Eastern), matching thisWeekEventsCount.
    if (activeTab === 'all') {
      return { week: 'current', status: ALL_ACTIVE_STATUSES };
    }
    const status =
      activeTab === 'scheduled'
        ? 'scheduled'
        : activeTab === 'in_process'
          ? 'in_process'
          : activeTab === 'new'
            ? 'new'
            : undefined;
    return status ? { days: 7, status } : { days: 7 };
  }

  if (quickFilter === 'today') {
    const status =
      activeTab === 'scheduled'
        ? 'scheduled'
        : activeTab === 'in_process'
          ? 'in_process'
          : activeTab === 'new'
            ? 'new'
            : undefined;
    return status ? { days: 1, status } : { days: 1 };
  }

  if (quickFilter === 'needsDriver') {
    // Dashboard "Need Drivers" tile: all active events that need drivers,
    // matching eventsNeedingDrivers. The chip stays scheduled-scoped.
    if (activeTab === 'all') {
      return { status: ALL_ACTIVE_STATUSES, needsDriver: 'true' };
    }
    // Show ALL scheduled (or rescheduled) events that need drivers (no date restriction)
    return { status: 'scheduled,rescheduled', needsDriver: 'true' };
  }

  if (quickFilter === 'needsVan') {
    // Show ALL scheduled (or rescheduled) events that need a van (no date restriction)
    return { status: 'scheduled,rescheduled', needsVan: 'true' };
  }

  // Status-based tabs (no date restrictions)
  if (activeTab === 'new') return { status: 'new' };
  if (activeTab === 'in_process') return { status: 'in_process' };
  if (activeTab === 'scheduled') return { status: 'scheduled,rescheduled' };
  if (activeTab === 'rescheduled') return { status: 'rescheduled' };

  // Other status tabs (no date restrictions) - lazy load these on demand
  // "declined" tab shows both declined AND cancelled events
  if (activeTab === 'declined') {
    return { status: 'declined,cancelled' };
  }
  if (['completed', 'standby', 'stalled', 'non_event'].includes(activeTab)) {
    return { status: activeTab };
  }

  // "all" tab fetches every status (no filter). Without this the search bar
  // can't find completed / declined / standby / stalled events because the
  // client-side filter only sees what was fetched.
  if (activeTab === 'all') {
    return {};
  }

  // For "my_assignments", admin_overview, planning, etc:
  // Only load active events (new, in_process, scheduled, rescheduled) by default.
  // Completed/declined events are lazy-loaded when those tabs are clicked.
  return { status: 'new,in_process,scheduled,rescheduled' };
}

export function buildEventRequestsListQuery(
  activeTab: string,
  quickFilter: EventRequestsQuickFilter,
  weekScope: EventRequestsWeekScope = null,
) {
  const filterParams = buildEventRequestsListFilterParams(activeTab, quickFilter, weekScope);
  const queryString = buildQueryString(filterParams);

  const listUrl = queryString ? `/api/event-requests/list?${queryString}` : '/api/event-requests/list';
  const fullUrl = queryString ? `/api/event-requests?${queryString}` : '/api/event-requests';

  const queryKey = ['/api/event-requests/list', filterParams, quickFilter, weekScope, 'v3'] as const;

  return { queryKey, listUrl, fullUrl, filterParams, queryString };
}

/**
 * Shared freshness for Event Requests list / counts.
 *
 * Saves already broadcast `event_request_updated` over the default socket.
 * Phones still miss those events when Safari suspends the tab, and the old
 * 5-minute staleTime + refetchOnWindowFocus:false left them looking at the
 * laptop's last save until cache expired. Always refetch on focus/mount, and
 * poll only while the tab is visible as a fallback when the socket is dead.
 */
export const EVENT_REQUEST_LIST_FRESHNESS = {
  refetchOnWindowFocus: 'always' as const,
  refetchOnReconnect: 'always' as const,
  refetchOnMount: 'always' as const,
  refetchInterval: 45_000,
  refetchIntervalInBackground: false,
};


