import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { PermissionDenied } from '@/components/permission-denied';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';
import {
  EventRequestProvider,
  useEventRequestContext,
} from './context/EventRequestContext';
import { useEventDialogState } from './context/EventDialogContext';
import { NewRequestsTab } from './tabs/NewRequestsTab';
import { InProcessTab } from './tabs/InProcessTab';
import { ScheduledTab } from './tabs/ScheduledTab';
import { CompletedTab } from './tabs/CompletedTab';
import { DeclinedTab } from './tabs/DeclinedTab';
import { StandbyTab } from './tabs/StandbyTab';
import { StalledTab } from './tabs/StalledTab';
import { NonEventTab } from './tabs/NonEventTab';
import { RescheduledTab } from './tabs/RescheduledTab';
import { MyAssignmentsTab } from './tabs/MyAssignmentsTab';
import { AllEventsTab } from './tabs/AllEventsTab';
import { AdminOverviewTab } from './tabs/AdminOverviewTab';
import { SandwichDestinationOverview } from './tabs/SandwichDestinationOverview';
import { VolunteerOpportunitiesTab } from './tabs/VolunteerOpportunitiesTab';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Users, Package, HelpCircle, Calendar, Sheet, X, RefreshCw, ArrowUp, Car, Truck, MapPin, Shield, LayoutGrid, Table2, Download, Filter, ChevronDown, FileSpreadsheet } from 'lucide-react';
import { WEEK_SCOPE_LABELS } from './lib/eventRequestsListQuery';
import { exportEventRequestsToExcel } from '@/lib/excel-export';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { ButtonTooltip } from '@/components/ui/button-tooltip';
import { EventCalendarView } from '@/components/event-calendar-view';
const EventMapView = React.lazy(() => import('./EventMapView'));
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from '@/components/ui/tooltip';

// Import existing components that we'll reuse
import RequestFilters from '@/components/event-requests/RequestFilters';
import { VanConflictsButton } from '@/components/event-requests/VanConflictsButton';
import { PlanningSheetImportDialog } from '@/components/event-requests/PlanningSheetImportDialog';
import { PlanningSheetGapsDialog } from '@/components/event-requests/PlanningSheetGapsDialog';
import EventSchedulingForm from '@/components/event-requests/EventSchedulingForm';
import EventCollectionLog from '@/components/event-requests/EventCollectionLog';
import ToolkitSentDialog from '@/components/event-requests/ToolkitSentDialog';
import SendToolkitDialog from '@/components/event-requests/SendToolkitDialog';
import FollowUpDialog from '@/components/event-requests/FollowUpDialog';
import { ScheduleCallDialog } from '@/components/event-requests/ScheduleCallDialog';
import ContactOrganizerDialog from '@/components/ContactOrganizerDialog';
import LogContactAttemptDialog from '@/components/LogContactAttemptDialog';
import EditContactAttemptDialog from '@/components/EditContactAttemptDialog';
import SandwichForecastWidget from '@/components/sandwich-forecast-widget';
import StaffingForecastWidget from '@/components/staffing-forecast-widget';

// Import hooks
import { useEventMutations } from './hooks/useEventMutations';
import { useMarkNewEventViewedOnOpen } from './hooks/useMarkNewEventViewedOnOpen';
import { useEventQueries } from './hooks/useEventQueries';
import { useEventAssignments } from './hooks/useEventAssignments';
import { useEventFilters } from './hooks/useEventFilters';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEventRequestSocket } from '@/hooks/useEventRequestSocket';

// Import dialogs
import { TspContactAssignmentDialog } from './dialogs/TspContactAssignmentDialog';
import { AssignmentDialog } from './dialogs/AssignmentDialog';
import { EventDetailsDialog } from './dialogs/EventDetailsDialog';
import { AiDateSuggestionDialog } from './dialogs/AiDateSuggestionDialog';
import { AiIntakeAssistantDialog } from './dialogs/AiIntakeAssistantDialog';
import { StatusReasonDialog } from './dialogs/StatusReasonDialog';
import { NonEventDialog } from './dialogs/NonEventDialog';
import { RescheduleDialog } from './dialogs/RescheduleDialog';
import IntakeCallDialog from './IntakeCallDialog';
import NextActionDialog from './NextActionDialog';
import { StatusDefinitionsPanel } from './StatusDefinitionsPanel';
import { OnboardingTooltip } from '@/components/ui/onboarding-tooltip';
import { logger } from '@/lib/logger';
import { apiRequest, queryClient, invalidateEventRequestQueries, refreshEventRequestListAndCounts } from '@/lib/queryClient';
import { getRoleViewDescription } from '@shared/role-view-defaults';
import { Info } from 'lucide-react';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

// Tabs that render aggregate dashboards rather than a flat list of event
// rows — the Export action (a row-level spreadsheet) doesn't apply to them.
const EXPORT_EXCLUDED_TABS = ['admin_overview', 'sandwich_overview'];

// Main component that uses the context
const EventRequestsManagementContent: React.FC = () => {
  const { track } = useOnboardingTracker();

  // Enable real-time updates for event requests (e.g., from Google Sheets imports)
  useEventRequestSocket();

  // Track onboarding challenge on component mount
  useEffect(() => {
    track('view_event_requests');
  }, []);

  // Listen for focus-event-search event from command palette (Cmd+/)
  useEffect(() => {
    const handleFocusSearch = () => {
      const searchInput = document.getElementById('event-requests-search');
      if (searchInput) {
        searchInput.focus();
        // Scroll to top to make search visible — use content container, fall back to window
        const scrollEl = scrollContainerRef.current;
        if (scrollEl) {
          scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('focus-event-search', handleFocusSearch);
    return () => window.removeEventListener('focus-event-search', handleFocusSearch);
  }, []);

  const {
    eventRequests,
    isLoading,
    viewMode,
    setViewMode,
    scheduledViewMode,
    setScheduledViewMode,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    confirmationFilter,
    setConfirmationFilter,
    sortBy,
    setSortBy,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    statusCounts,
    statusCountsLoading,
    unviewedNewCount,
    quickFilter,
    setQuickFilter,
    weekScope,
    setWeekScope,
  } = useEventRequestContext();

  const {
    nextActionEventRequest,
    setNextActionEventRequest,
    nextActionMode,
    setNextActionMode,
    assignmentType,
    setAssignmentType,
    assignmentEventId,
    setAssignmentEventId,
    selectedAssignees,
    setSelectedAssignees,
    isVanDriverAssignment,
    setIsVanDriverAssignment,
    selectedEventRequest,
    setSelectedEventRequest,
    isEditing,
    setIsEditing,
    schedulingEventRequest,
    setSchedulingEventRequest,
    toolkitEventRequest,
    setToolkitEventRequest,
    collectionLogEventRequest,
    setCollectionLogEventRequest,
    contactEventRequest,
    setContactEventRequest,
    tspContactEventRequest,
    setTspContactEventRequest,
    logContactEventRequest,
    setLogContactEventRequest,
    editContactEventRequest,
    setEditContactEventRequest,
    editContactAttemptData,
    setEditContactAttemptData,
    aiSuggestionEventRequest,
    setAiSuggestionEventRequest,
    aiIntakeAssistantEventRequest,
    setAiIntakeAssistantEventRequest,
    intakeCallEventRequest,
    setIntakeCallEventRequest,
    reasonDialogEventRequest,
    setReasonDialogEventRequest,
    nonEventDialogEventRequest,
    setNonEventDialogEventRequest,
    rescheduleDialogEventRequest,
    setRescheduleDialogEventRequest,
    scheduleCallDate,
    setScheduleCallDate,
    scheduleCallTime,
    setScheduleCallTime,
    followUpNotes,
    setFollowUpNotes,
    activeDialog,
    openDialog,
    closeDialog,
  } = useEventDialogState();

  const {
    markToolkitSentMutation,
    scheduleCallMutation,
    oneDayFollowUpMutation,
    assignRecipientsMutation,
    oneMonthFollowUpMutation,
    updateEventRequestMutation,
  } = useEventMutations();

  const { resolveUserName, resolveRecipientName } = useEventAssignments();

  // Per-tab row filtering — single source of truth for "what this tab shows".
  // Used by Export so the spreadsheet matches the visible rows (e.g. My
  // Assignments exports only the current user's events, not the raw cache).
  const { filterRequestsByStatus } = useEventFilters();

  const queryClient = useQueryClient();

  // Sync from Google Sheets mutation
  const syncFromSheetsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/event-requests/sync/from-sheets', {});
    },
    onSuccess: (result: any) => {
      toast({
        title: 'Sync Complete',
        description: result.message || `Synced: ${result.created || 0} created, ${result.updated || 0} skipped`,
      });
      // Refresh event requests
      invalidateEventRequestQueries(queryClient);
    },
    onError: (error: any) => {
      toast({
        title: 'Sync Failed',
        description: error?.message || 'Failed to sync from Google Sheets',
        variant: 'destructive',
      });
    },
  });

  const { users, drivers, hostsWithContacts } = useEventQueries();
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const { markViewedIfNew } = useMarkNewEventViewedOnOpen(user?.id);

  useEffect(() => {
    const event =
      activeDialog === 'intakeCall' ? intakeCallEventRequest : selectedEventRequest;
    if (
      (activeDialog === 'eventDetails' ||
        activeDialog === 'eventDetailsPreview' ||
        activeDialog === 'intakeCall') &&
      event?.status === 'new'
    ) {
      markViewedIfNew(event);
    }
  }, [
    activeDialog,
    selectedEventRequest,
    intakeCallEventRequest,
    markViewedIfNew,
    user?.id,
  ]);

  const openManualEventRequest = useCallback(() => {
    closeDialog('scheduleCall');
    closeDialog('oneDayFollowUp');
    closeDialog('oneMonthFollowUp');
    closeDialog('toolkitSent');
    setSelectedEventRequest(null);
    setIsEditing(true);
    openDialog('eventDetails');
  }, [
    closeDialog,
    openDialog,
    setSelectedEventRequest,
    setIsEditing,
  ]);

  useEffect(() => {
    const handleOpenCreate = () => {
      openManualEventRequest();
    };

    window.addEventListener('openEventRequestCreateDialog', handleOpenCreate);
    return () => {
      window.removeEventListener(
        'openEventRequestCreateDialog',
        handleOpenCreate
      );
    };
  }, [openManualEventRequest]);
  const { trackButtonClick, trackFormSubmit } = useAnalytics();

  // Track initial page load only once
  const hasLoggedInitialView = useRef(false);

  // Check if user has permission to sync event requests from Google Sheets
  const [planningImportOpen, setPlanningImportOpen] = useState(false);
  const [planningGapsOpen, setPlanningGapsOpen] = useState(false);
  const canSyncEvents = user?.permissions?.includes(PERMISSIONS.EVENT_REQUESTS_SYNC) ||
    user?.role === 'admin' || user?.role === 'super_admin';

  // Support both old and new permission strings for backward compatibility
  const hasAdminOverviewPermission = user?.permissions?.includes(PERMISSIONS.EVENT_REQUESTS_VIEW_ADMIN_OVERVIEW) ||
    user?.permissions?.includes('view_admin_overview') ||
    user?.role === 'super_admin';

  // Track initial page load with default tab (only once)
  useEffect(() => {
    if (user?.id && !hasLoggedInitialView.current) {
      hasLoggedInitialView.current = true;

      trackButtonClick('event_requests_page_loaded', 'event_requests');

      // Track which tab user lands on (now defaults to 'scheduled' for key roles)
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'event_requests_initial_view', {
          initial_tab: activeTab,
          user_role: user.role,
          is_new_default: activeTab === 'scheduled',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }, [user?.id, trackButtonClick, activeTab, user?.role]);

  // Track tab changes
  useEffect(() => {
    if (user?.id && activeTab) {
      trackButtonClick(`tab_${activeTab}_viewed`, 'event_requests');
    }
  }, [activeTab, user?.id]);

  // Scroll to top when component mounts
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // State for volunteer opportunities dialog
  const [showVolunteerOpportunities, setShowVolunteerOpportunities] = useState(false);

  // State for back to top button
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Track scroll position for back to top button
  // Listens on the nearest scrollable ancestor (the dashboard content div), not window
  useEffect(() => {
    // Find the closest scrollable parent
    const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
      while (el) {
        const style = getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    // Small delay so the DOM is ready
    const timer = setTimeout(() => {
      const container =
        findScrollParent(document.querySelector('[data-event-requests-root]') as HTMLElement) ||
        null;
      scrollContainerRef.current = container;

      if (!container) return;

      const handleScroll = () => {
        setShowBackToTop(container.scrollTop > 400);
      };
      container.addEventListener('scroll', handleScroll, { passive: true });
      // Also check right away
      handleScroll();

      return () => container.removeEventListener('scroll', handleScroll);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Scroll to top function — scrolls the content container, not window
  const scrollToTop = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Memoize tab children to prevent recreation on every render
  const tabChildren = useMemo(() => {
    const tabs: any = {
      all: <AllEventsTab />,
      new: <NewRequestsTab />,
      in_process: <InProcessTab />,
      scheduled: <ScheduledTab />,
      completed: <CompletedTab />,
      declined: <DeclinedTab />,
      standby: <StandbyTab />,
      stalled: <StalledTab />,
      non_event: <NonEventTab />,
      rescheduled: <RescheduledTab />,
      my_assignments: <MyAssignmentsTab />,
    };

    // Add admin overview tab for users with permission (support both old and new permission strings)
    if (user?.permissions?.includes(PERMISSIONS.EVENT_REQUESTS_VIEW_ADMIN_OVERVIEW) ||
        user?.permissions?.includes('view_admin_overview') ||
        user?.role === 'super_admin') {
      tabs.admin_overview = <AdminOverviewTab eventRequests={eventRequests} />;
    }

    if (user?.permissions?.includes(PERMISSIONS.EVENT_REQUESTS_VIEW_ADMIN_OVERVIEW) ||
        user?.permissions?.includes('view_admin_overview') ||
        user?.role === 'super_admin') {
      tabs.sandwich_overview = <SandwichDestinationOverview eventRequests={eventRequests} />;
    }

    return tabs;
  }, [eventRequests, user?.role, user?.permissions]);

  const handleScheduleCall = () => {
    if (!selectedEventRequest || !scheduleCallDate) return;

    // Use provided time or default to start of day if no time specified
    const timeToUse = scheduleCallTime || '00:00';
    const combinedDateTime = new Date(
      `${scheduleCallDate}T${timeToUse}`
    ).toISOString();

    trackButtonClick('schedule_call', 'event_requests');
    scheduleCallMutation.mutate({
      id: selectedEventRequest.id,
      scheduledCallDate: combinedDateTime,
    });
  };

  // Handle floating button click to switch to scheduled + spreadsheet view
  const handleSwitchToSpreadsheet = () => {
    const previousTab = activeTab;
    setActiveTab('scheduled');

    // Track floating button usage with detailed context
    trackButtonClick('floating_spreadsheet_button', 'event_requests');

    // Track navigation from current tab to scheduled
    if (user) {
      const event = {
        feature: 'floating_spreadsheet_button',
        from_tab: previousTab,
        to_tab: 'scheduled',
        user_role: user.role,
        timestamp: new Date().toISOString(),
      };

      // Log to analytics
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'spreadsheet_quick_access', event);
      }
    }
  };

  // Handle dismissing floating button tip

  if (isLoading) {
    return (
      <div className="space-y-4 premium-gradient-subtle min-h-screen p-2 sm:p-4">
        {/* Header skeleton */}
        <div className="premium-card p-4 sm:p-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-10 w-32" />
            </div>
            {/* Tab skeleton */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-10 w-24 flex-shrink-0" />
              ))}
            </div>
            {/* Filter bar skeleton */}
            <div className="flex gap-2">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
        </div>
        {/* Event cards skeleton */}
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="premium-card p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
              <div className="flex gap-2 mt-4 pt-4 border-t">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Calculate total for filters
  const totalItems = eventRequests.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <TooltipProvider>
      <div className="space-y-4 premium-gradient-subtle min-h-screen min-w-0 max-w-full p-2 sm:p-4" data-event-requests-root>
        {/* Header — title left, admin actions right. The action group wraps
            onto its own line when it no longer fits beside the title, so the
            buttons stay inside the card. */}
        <div className="premium-card p-4 sm:p-6 min-w-0 max-w-full">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-full">
              <div className="flex items-center gap-2">
                <h1 className="premium-text-h1">Event Requests Management</h1>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-teal-600 hover:text-teal-800 transition-colors">
                      <HelpCircle className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs premium-tooltip">
                    <p className="font-semibold mb-1">Event Requests Help</p>
                    <p className="text-sm">Track and manage all event requests from organizations. Use tabs to filter by status, assign TSP contacts, schedule events, and plan sandwich deliveries.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="premium-text-body text-brand-primary">
                {isMobile ? 'Manage event requests' : 'Manage and track event requests from organizations'}
              </p>
            </div>

            {/* Admin/utility actions — grouped right, wrapping inside the card */}
            <div className="flex min-w-[min(100%,20rem)] max-w-full flex-1 flex-wrap items-center justify-end gap-2">
              {canSyncEvents && (
                <button
                  onClick={() => syncFromSheetsMutation.mutate()}
                  disabled={syncFromSheetsMutation.isPending}
                  className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
                  title="Sync new event requests from Google Sheets (safe - won't create duplicates)"
                >
                  <RefreshCw className={`w-4 h-4 ${syncFromSheetsMutation.isPending ? 'animate-spin' : ''}`} />
                  {!isMobile && 'Sync'}
                </button>
              )}
              {canSyncEvents && (
                <button
                  onClick={() => setPlanningImportOpen(true)}
                  className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
                  title="Compare the planning sheet with the app and import missing events (review first — nothing is added until you approve)"
                  data-testid="button-planning-sheet-import"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {!isMobile && 'Import from Planning Sheet'}
                </button>
              )}
              <PlanningSheetImportDialog
                open={planningImportOpen}
                onOpenChange={setPlanningImportOpen}
              />
              {user?.role === 'super_admin' && (
                <button
                  onClick={() => setPlanningGapsOpen(true)}
                  className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
                  title="Read-only report: planning-sheet group events not represented in the app (nothing is changed)"
                  data-testid="button-planning-sheet-gaps"
                >
                  <Shield className="w-4 h-4" />
                  {!isMobile && 'Planning Sheet Gaps'}
                </button>
              )}
              <PlanningSheetGapsDialog
                open={planningGapsOpen}
                onOpenChange={setPlanningGapsOpen}
              />
              <VanConflictsButton isMobile={isMobile} />
              {/* Export — available on any list-view tab. We export the same
                  rows the tab displays (via filterRequestsByStatus, skipping
                  pagination) rather than the raw eventRequests cache, because
                  "virtual" tabs like My Assignments fetch all active events and
                  filter client-side — exporting the raw cache would leak every
                  active request. Hidden on the dashboard tabs (admin overview /
                  sandwich overview), which aren't flat row lists, and
                  in Calendar/Map views which render their own data. Lives in the
                  top-right action group with Add Event because it's a one-off
                  action that downloads a file, not a view. */}
              {viewMode === 'list' && !EXPORT_EXCLUDED_TABS.includes(activeTab) && (
                <button
                  onClick={async () => {
                    try {
                      // The Declined tab shows declined AND cancelled events,
                      // so its export must include both. Every other tab's
                      // displayed set maps 1:1 to filterRequestsByStatus
                      // (scheduled already includes rescheduled).
                      const rows = activeTab === 'declined'
                        ? [
                            ...filterRequestsByStatus('declined', { skipPagination: true }),
                            ...filterRequestsByStatus('cancelled', { skipPagination: true }),
                          ]
                        : filterRequestsByStatus(activeTab, { skipPagination: true });
                      if (rows.length === 0) {
                        toast({ title: 'Nothing to export', description: 'No events match the current view.' });
                        return;
                      }
                      await exportEventRequestsToExcel(rows, activeTab);
                      toast({ title: 'Export complete' });
                    } catch { toast({ title: 'Export failed', variant: 'destructive' }); }
                  }}
                  className="premium-btn-outline text-sm whitespace-nowrap shrink-0 disabled:opacity-50"
                  data-testid="button-export-events"
                  title="Download a spreadsheet of the events shown on this tab"
                >
                  <Download className="w-4 h-4" />
                  {!isMobile && 'Export'}
                </button>
              )}
              <button
                onClick={openManualEventRequest}
                className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
                data-testid="button-add-manual-event"
              >
                <Plus className="w-4 h-4" />
                {!isMobile && 'Add Event'}
              </button>
              <button
                onClick={() => setShowVolunteerOpportunities(true)}
                className="premium-btn-primary whitespace-nowrap shrink-0"
                style={{ backgroundColor: '#007E8C' }}
              >
                <Users className="w-4 h-4" />
                {!isMobile && 'Volunteer Opps'}
              </button>
            </div>
          </div>
        </div>

        {/* Role-customized view indicator */}
        {user?.role && user.role !== 'super_admin' && user.role !== 'admin' && (
          <div className="premium-card-flat p-3 border-l-4" style={{
            backgroundColor: 'rgba(0, 126, 140, 0.08)',
            borderLeftColor: '#007E8C'
          }}>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#007E8C' }} />
              <p className="text-sm" style={{ color: '#236383' }}>
                {getRoleViewDescription(user.role, 'events')}
              </p>
            </div>
          </div>
        )}

        {/* Controls toolbar — view controls (primary, left) + filters & tools (right) */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center px-2 sm:px-0">
          {/* Primary: View mode controls. Labeled with "View as:" so users
              notice this is a view picker — without the label the segmented
              control reads as decoration and users miss the calendar/map
              options entirely. */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#236383] hidden sm:inline">
              View as:
            </span>
          <div className="flex items-center gap-1 bg-[#007E8C]/10 border border-[#007E8C]/20 rounded-lg p-0.5">
            {/* Consistent view switcher on every tab: Cards, Spreadsheet,
                Calendar, Map always appear in the same order and place so the
                controls don't reshuffle when you change tabs. The Spreadsheet
                view only exists for the Scheduled tab, so on other tabs it
                stays visible but greyed-out (with a tooltip explaining why)
                rather than silently disappearing. */}
            <button
              onClick={() => {
                setViewMode('list');
                if (activeTab === 'scheduled') {
                  setScheduledViewMode('card');
                  localStorage.setItem('scheduledTabViewMode', 'card');
                }
              }}
              className={`min-h-11 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'list' && (activeTab !== 'scheduled' || scheduledViewMode === 'card') ? 'bg-white shadow-sm text-[#007E8C]' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <LayoutGrid className="w-4 h-4" />
              Cards
            </button>
            {!isMobile && activeTab === 'scheduled' ? (
              <button
                onClick={() => { setViewMode('list'); setScheduledViewMode('spreadsheet'); localStorage.setItem('scheduledTabViewMode', 'spreadsheet'); }}
                className={`min-h-11 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'list' && scheduledViewMode === 'spreadsheet' ? 'bg-white shadow-sm text-[#007E8C]' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <Table2 className="w-4 h-4" />
                Spreadsheet
              </button>
            ) : !isMobile ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      disabled
                      aria-disabled="true"
                      className="min-h-11 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium flex items-center gap-1.5 text-gray-400 opacity-60 cursor-not-allowed"
                    >
                      <Table2 className="w-4 h-4" />
                      {isMobile ? 'Sheet' : 'Spreadsheet'}
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Spreadsheet view is only available on the Scheduled tab</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
            <button
              data-tour="calendar-tab"
              onClick={() => setViewMode('calendar')}
              className={`min-h-11 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'calendar' ? 'bg-white shadow-sm text-[#007E8C]' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <Calendar className="w-4 h-4" />
              {isMobile ? 'Cal' : 'Calendar'}
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`min-h-11 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'map' ? 'bg-white shadow-sm text-[#007E8C]' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <MapPin className="w-4 h-4" />
              Map
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => {
              void refreshEventRequestListAndCounts(queryClient);
            }}
            title="Refresh event list"
          >
            <RefreshCw className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          </div>

          {/* Export was previously slotted here between Map and Driver Planning,
              but it's an ACTION (downloads a file), not a view. Moved to the
              top-right header action group near Add Event so the view toggles
              read consistently as "ways to view data." */}

          {/* Driver Planning Map link — desktop/tablet only; not a phone workflow */}
          <ButtonTooltip
            explanation="Opens the Driver Planning Map to match upcoming events with volunteer drivers. See events, nearby hosts and recipients, and suggested drivers on one map. Start the full walkthrough anytime from the help button (bottom-right)."
            size="md"
          >
            <Link href="/driver-planning" className="hidden sm:inline-flex">
              <Button
                variant="outline"
                size="sm"
                className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
              >
                <MapPin className="w-4 h-4 mr-1.5" />
                {!isMobile && 'Driver Planning Map'}
              </Button>
            </Link>
          </ButtonTooltip>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Quick Filters dropdown */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={quickFilter || weekScope ? 'border-[#007E8C] text-[#007E8C] bg-[#007E8C]/5' : ''}
              >
                <Filter className="w-4 h-4 mr-1.5" />
                {weekScope
                  ? WEEK_SCOPE_LABELS[weekScope]
                  : quickFilter
                  ? quickFilter === 'needsDriver' ? 'Needs Driver'
                  : quickFilter === 'needsVan' ? 'Needs Van'
                  : quickFilter === 'week' ? 'This Week'
                  : quickFilter === 'today' ? 'Today'
                  : quickFilter === 'corporatePriority' ? 'Corporate'
                  : 'Filters'
                  : 'Filters'}
                <ChevronDown className="w-3.5 h-3.5 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2" align="end">
              <div className="space-y-1">
                <button
                  onClick={() => { setActiveTab('scheduled'); setSearchQuery(''); setWeekScope(null); setQuickFilter(quickFilter === 'needsDriver' ? null : 'needsDriver'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${quickFilter === 'needsDriver' ? 'bg-[#236383] text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                >
                  <Car className="w-4 h-4" /> Needs Driver
                </button>
                <button
                  onClick={() => { setActiveTab('scheduled'); setSearchQuery(''); setWeekScope(null); setQuickFilter(quickFilter === 'needsVan' ? null : 'needsVan'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${quickFilter === 'needsVan' ? 'bg-[#D68319] text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                >
                  <Truck className="w-4 h-4" /> Needs Van
                </button>
                <button
                  onClick={() => { setActiveTab('scheduled'); setSearchQuery(''); setWeekScope(null); setQuickFilter(quickFilter === 'week' ? null : 'week'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${quickFilter === 'week' ? 'bg-[#007E8C] text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                >
                  <Calendar className="w-4 h-4" /> This Week
                </button>
                <button
                  onClick={() => { setActiveTab('scheduled'); setSearchQuery(''); setWeekScope(null); setQuickFilter(quickFilter === 'today' ? null : 'today'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${quickFilter === 'today' ? 'bg-[#007E8C] text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                >
                  <Calendar className="w-4 h-4" /> Today
                </button>
                <button
                  onClick={() => { setSearchQuery(''); setWeekScope(null); setQuickFilter(quickFilter === 'corporatePriority' ? null : 'corporatePriority'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${quickFilter === 'corporatePriority' ? 'bg-amber-600 text-white' : 'hover:bg-gray-100 text-amber-700'}`}
                >
                  <Shield className="w-4 h-4" /> Corporate Priority
                </button>
                {(quickFilter || weekScope) && (
                  <>
                    <div className="border-t border-gray-200 my-1" />
                    <button
                      onClick={() => {
                        setQuickFilter(null);
                        setWeekScope(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100"
                    >
                      <X className="w-4 h-4" /> Clear Filter
                    </button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Status Definitions - inline reference */}
          <OnboardingTooltip
            step="status-definitions-review"
            position="bottom"
          >
            <StatusDefinitionsPanel />
          </OnboardingTooltip>
        </div>

        {/* View Content: Calendar, Map, or List */}
        {viewMode === 'calendar' ? (
          <EventCalendarView
            onEventClick={(event) => {
              setSelectedEventRequest(event);
              openDialog('eventDetailsPreview');
            }}
          />
        ) : viewMode === 'map' ? (
          <React.Suspense fallback={<div className="flex items-center justify-center h-[60vh]"><Skeleton className="w-full h-full" /></div>}>
            <EventMapView
              onEventClick={(event: any) => {
                setSelectedEventRequest(event);
                openDialog('eventDetailsPreview');
              }}
            />
          </React.Suspense>
        ) : (
          <>
            {/* Filters and Tabs */}
            <RequestFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            confirmationFilter={confirmationFilter}
            onConfirmationFilterChange={setConfirmationFilter}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            currentPage={currentPage}
            onCurrentPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            onItemsPerPageChange={setItemsPerPage}
            statusCounts={statusCounts}
            statusCountsLoading={statusCountsLoading}
            unviewedNewCount={unviewedNewCount}
            totalItems={totalItems}
            totalPages={totalPages}
            children={tabChildren}
          />
          </>
        )}

        {/* Event Details Preview Dialog */}
        <EventDetailsDialog
          event={selectedEventRequest}
          isOpen={(activeDialog === 'eventDetailsPreview')}
          onClose={() => {
            closeDialog('eventDetailsPreview');
            setSelectedEventRequest(null);
          }}
          onEdit={() => {
            closeDialog('eventDetailsPreview');
            openDialog('eventDetails');
            setIsEditing(false);
          }}
          resolveUserName={resolveUserName}
          resolveRecipientName={resolveRecipientName}
        />

        {/* Event Details Edit Modal */}
        {(activeDialog === 'eventDetails') && (selectedEventRequest || isEditing) && (
          <EventSchedulingForm
            eventRequest={selectedEventRequest}
            isOpen={(activeDialog === 'eventDetails')}
            mode={selectedEventRequest ? 'edit' : 'create'}
            onClose={() => {
              closeDialog('eventDetails');
              setSelectedEventRequest(null);
              setIsEditing(false);
            }}
            onEventScheduled={() => {
              closeDialog('eventDetails');
              setSelectedEventRequest(null);
              setIsEditing(false);
            }}
          />
        )}

        {/* Event Scheduling Dialog */}
        {(activeDialog === 'scheduling') && schedulingEventRequest && (
          <EventSchedulingForm
            eventRequest={schedulingEventRequest}
            isOpen={(activeDialog === 'scheduling')}
            onClose={() => {
              closeDialog('scheduling');
              setSchedulingEventRequest(null);
            }}
            onEventScheduled={() => {
              closeDialog('scheduling');
              setSchedulingEventRequest(null);
            }}
          />
        )}

        {/* Collection Log Dialog */}
        {(activeDialog === 'collectionLog') && collectionLogEventRequest && (
          <EventCollectionLog
            eventRequest={collectionLogEventRequest}
            isVisible={(activeDialog === 'collectionLog')}
            onClose={() => {
              closeDialog('collectionLog');
              setCollectionLogEventRequest(null);
            }}
          />
        )}

        {/* Toolkit Sent Dialog — LOG-ONLY path: record that a toolkit
            was sent outside the app (forwarded from a personal inbox,
            hand-delivered, etc.). Sets the date + optional call-log
            and moves status to In Process. */}
        {(activeDialog === 'toolkitSent') && toolkitEventRequest && (
          <ToolkitSentDialog
            eventRequest={toolkitEventRequest}
            isOpen={(activeDialog === 'toolkitSent')}
            onClose={() => {
              closeDialog('toolkitSent');
              setToolkitEventRequest(null);
            }}
            onToolkitSent={(toolkitSentDate: string, contactAttempt?: { method: string; outcome: string; notes?: string }) => {
              if (toolkitEventRequest) {
                trackButtonClick('mark_toolkit_sent', 'event_requests');
                markToolkitSentMutation.mutate({
                  id: toolkitEventRequest.id,
                  toolkitSentDate,
                  contactAttempt,
                });
              }
            }}
            isLoading={markToolkitSentMutation.isPending}
          />
        )}

        {/* Send Toolkit Dialog — SEND-NOW path: opens the email
            composer pre-loaded with the toolkit. When the email
            actually leaves, the send-time becomes the toolkit-sent
            timestamp and the same markToolkitSent mutation fires,
            flipping the event to In Process automatically. */}
        {(activeDialog === 'sendToolkit') && toolkitEventRequest && (
          <SendToolkitDialog
            eventRequest={toolkitEventRequest}
            isOpen={(activeDialog === 'sendToolkit')}
            onClose={() => {
              closeDialog('sendToolkit');
              setToolkitEventRequest(null);
            }}
            onToolkitEmailSent={(toolkitSentDate: string) => {
              if (toolkitEventRequest) {
                trackButtonClick('send_toolkit_email', 'event_requests');
                markToolkitSentMutation.mutate({
                  id: toolkitEventRequest.id,
                  toolkitSentDate,
                });
              }
            }}
          />
        )}

        {/* Schedule Call Dialog */}
        <ScheduleCallDialog
          isOpen={(activeDialog === 'scheduleCall')}
          onClose={() => closeDialog('scheduleCall')}
          eventRequest={selectedEventRequest}
          onCallScheduled={handleScheduleCall}
          isLoading={scheduleCallMutation.isPending}
          scheduleCallDate={scheduleCallDate}
          setScheduleCallDate={setScheduleCallDate}
          scheduleCallTime={scheduleCallTime}
          setScheduleCallTime={setScheduleCallTime}
        />

        {/* 1-Day Follow-up Dialog */}
        <FollowUpDialog
          isOpen={(activeDialog === 'oneDayFollowUp')}
          onClose={() => {
            closeDialog('oneDayFollowUp');
            setFollowUpNotes(''); // Clear notes when dialog closes
          }}
          eventRequest={selectedEventRequest}
          onFollowUpCompleted={(notes) => {
            if (selectedEventRequest) {
              trackButtonClick('1day_followup', 'event_requests');
              oneDayFollowUpMutation.mutate({
                id: selectedEventRequest.id,
                notes,
              });
            }
          }}
          isLoading={oneDayFollowUpMutation.isPending}
          followUpType="1-day"
          notes={followUpNotes}
          setNotes={setFollowUpNotes}
        />

        {/* 1-Month Follow-up Dialog */}
        <FollowUpDialog
          isOpen={(activeDialog === 'oneMonthFollowUp')}
          onClose={() => {
            closeDialog('oneMonthFollowUp');
            setFollowUpNotes(''); // Clear notes when dialog closes
          }}
          eventRequest={selectedEventRequest}
          onFollowUpCompleted={(notes) => {
            if (selectedEventRequest) {
              trackButtonClick('1month_followup', 'event_requests');
              oneMonthFollowUpMutation.mutate({
                id: selectedEventRequest.id,
                notes,
              });
            }
          }}
          isLoading={oneMonthFollowUpMutation.isPending}
          followUpType="1-month"
          notes={followUpNotes}
          setNotes={setFollowUpNotes}
        />

        {/* Contact Organizer Dialog */}
        <ContactOrganizerDialog
          isOpen={(activeDialog === 'contactOrganizer')}
          onClose={() => {
            closeDialog('contactOrganizer');
            setContactEventRequest(null);
          }}
          eventRequest={contactEventRequest}
        />

        {/* Log Contact Attempt Dialog */}
        <LogContactAttemptDialog
          isOpen={(activeDialog === 'logContact')}
          onClose={() => {
            closeDialog('logContact');
            setLogContactEventRequest(null);
          }}
          eventRequest={logContactEventRequest}
          onLogContact={async (data) => {
            if (!logContactEventRequest) return;
            await updateEventRequestMutation.mutateAsync({
              id: logContactEventRequest.id,
              data: { ...data, _skipVersionCheck: true },
            });
          }}
        />

        {/* Edit Contact Attempt Dialog */}
        <EditContactAttemptDialog
          isOpen={(activeDialog === 'editContact')}
          onClose={() => {
            closeDialog('editContact');
            setEditContactEventRequest(null);
            setEditContactAttemptData(null);
          }}
          eventRequest={editContactEventRequest}
          contactAttempt={editContactAttemptData}
          onEditContact={async (data) => {
            if (!editContactEventRequest) return;
            await updateEventRequestMutation.mutateAsync({
              id: editContactEventRequest.id,
              data: { ...data, _skipVersionCheck: true },
            });
          }}
        />

        {/* AI Date Suggestion Dialog */}
        {aiSuggestionEventRequest && (
          <AiDateSuggestionDialog
            open={(activeDialog === 'aiDateSuggestion')}
            onClose={() => {
              closeDialog('aiDateSuggestion');
              setAiSuggestionEventRequest(null);
            }}
            eventRequest={aiSuggestionEventRequest}
            onSelectDate={(date) => {
              // Automatically open scheduling dialog with the recommended date
              setSchedulingEventRequest(aiSuggestionEventRequest);
              openDialog('scheduling');
              closeDialog('aiDateSuggestion');
              setAiSuggestionEventRequest(null);
            }}
          />
        )}

        {/* AI Intake Assistant Dialog */}
        {aiIntakeAssistantEventRequest && (
          <AiIntakeAssistantDialog
            open={(activeDialog === 'aiIntakeAssistant')}
            onClose={() => {
              closeDialog('aiIntakeAssistant');
              setAiIntakeAssistantEventRequest(null);
            }}
            eventRequest={aiIntakeAssistantEventRequest}
            onEditEvent={() => {
              // Open edit dialog
              setSelectedEventRequest(aiIntakeAssistantEventRequest);
              setIsEditing(true);
            }}
            onLogContact={() => {
              // Open log contact dialog
              setLogContactEventRequest(aiIntakeAssistantEventRequest);
              openDialog('logContact');
            }}
            onScheduleCall={() => {
              // Open contact organizer dialog for scheduling a call
              setSelectedEventRequest(aiIntakeAssistantEventRequest);
              openDialog('contactOrganizer');
            }}
            onAddNote={() => {
              // Open edit dialog to add notes
              setSelectedEventRequest(aiIntakeAssistantEventRequest);
              setIsEditing(true);
            }}
          />
        )}

        {/* Decline Reason Dialog */}
        {reasonDialogEventRequest && (activeDialog === 'decline') && (
          <StatusReasonDialog
            isOpen={(activeDialog === 'decline')}
            onClose={() => {
              closeDialog('decline');
              setReasonDialogEventRequest(null);
            }}
            request={reasonDialogEventRequest}
            type="declined"
            onConfirm={async (eventId, data) => {
              await updateEventRequestMutation.mutateAsync({ id: eventId, data });
              closeDialog('decline');
              setReasonDialogEventRequest(null);
            }}
          />
        )}

        {/* Cancel Reason Dialog */}
        {reasonDialogEventRequest && (activeDialog === 'cancel') && (
          <StatusReasonDialog
            isOpen={(activeDialog === 'cancel')}
            onClose={() => {
              closeDialog('cancel');
              setReasonDialogEventRequest(null);
            }}
            request={reasonDialogEventRequest}
            type="cancelled"
            onConfirm={async (eventId, data) => {
              await updateEventRequestMutation.mutateAsync({ id: eventId, data });
              closeDialog('cancel');
              setReasonDialogEventRequest(null);
            }}
          />
        )}

        {/* Non-Event Dialog */}
        {nonEventDialogEventRequest && (activeDialog === 'nonEvent') && (
          <NonEventDialog
            isOpen={(activeDialog === 'nonEvent')}
            onClose={() => {
              closeDialog('nonEvent');
              setNonEventDialogEventRequest(null);
            }}
            request={nonEventDialogEventRequest}
            onConfirm={async (eventId, data) => {
              await updateEventRequestMutation.mutateAsync({ id: eventId, data });
              closeDialog('nonEvent');
              setNonEventDialogEventRequest(null);
            }}
          />
        )}

        {/* Reschedule Dialog */}
        {rescheduleDialogEventRequest && (activeDialog === 'reschedule') && (
          <RescheduleDialog
            isOpen={(activeDialog === 'reschedule')}
            onClose={() => {
              closeDialog('reschedule');
              setRescheduleDialogEventRequest(null);
            }}
            request={rescheduleDialogEventRequest}
            onConfirm={async (eventId, data) => {
              await updateEventRequestMutation.mutateAsync({ id: eventId, data });
              closeDialog('reschedule');
              setRescheduleDialogEventRequest(null);
            }}
          />
        )}

        {/* Intake Call Dialog */}
        {intakeCallEventRequest && (
          <IntakeCallDialog
            isOpen={(activeDialog === 'intakeCall')}
            onClose={() => {
              closeDialog('intakeCall');
              setIntakeCallEventRequest(null);
            }}
            eventRequest={intakeCallEventRequest}
          />
        )}

        {/* Next Action Dialog */}
        {nextActionEventRequest && (
          <NextActionDialog
            isOpen={(activeDialog === 'nextAction')}
            onClose={() => {
              closeDialog('nextAction');
              setNextActionEventRequest(null);
              setNextActionMode('add');
            }}
            eventRequest={nextActionEventRequest}
            mode={nextActionMode}
          />
        )}

        {/* TSP Contact Assignment Dialog */}
        <TspContactAssignmentDialog
          isOpen={(activeDialog === 'tspContactAssignment')}
          onClose={() => {
            closeDialog('tspContactAssignment');
            setTspContactEventRequest(null);
          }}
          eventRequestId={tspContactEventRequest?.id || 0}
          eventRequestTitle={tspContactEventRequest?.organizationName}
          currentTspContact={tspContactEventRequest?.tspContact || undefined}
          currentCustomTspContact={tspContactEventRequest?.customTspContact || undefined}
        />

        {/* General Assignment Dialog for Drivers/Volunteers */}
        <AssignmentDialog
          isOpen={(activeDialog === 'assignment')}
          onClose={() => {
            closeDialog('assignment');
            setAssignmentType(null);
            setAssignmentEventId(null);
            setSelectedAssignees([]);
            setIsVanDriverAssignment(false);
          }}
          assignmentType={assignmentType}
          selectedAssignees={selectedAssignees}
          setSelectedAssignees={setSelectedAssignees}
          isVanDriverAssignment={isVanDriverAssignment}
          onAssign={async (assignees: string[], isTentative: boolean = false) => {
            if (!assignmentEventId || !assignmentType) return;

            // Prevent double submission
            if (updateEventRequestMutation.isPending) {
              logger.log('=== ASSIGNMENT SUBMIT BLOCKED (already pending) ===');
              return;
            }

            logger.log('=== ASSIGNMENT SUBMIT ===');
            logger.log('Event ID:', assignmentEventId);
            logger.log('Assignment Type:', assignmentType);
            logger.log('Selected Assignees:', assignees);
            logger.log('Is Tentative:', isTentative);
            logger.log('Available drivers:', (drivers ?? []).map((d: any) => ({ id: d.id, name: d.name })));
            logger.log('Available users:', (users ?? []).map((u: any) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })));

            // Get the current event to preserve existing assignments
            const currentEvent = eventRequests.find(e => e.id === assignmentEventId);
            if (!currentEvent) {
              toast({
                title: 'Error',
                description: 'Event not found',
                variant: 'destructive',
              });
              return;
            }

            // Build the update data based on assignment type
            let updateData: any = {};

            if (assignmentType === 'driver') {
              // Helper to parse PostgreSQL arrays
              const parsePostgresArray = (arr: any): string[] => {
                if (!arr) return [];
                if (Array.isArray(arr)) return arr.map(String).filter((item) => item && item.trim());
                if (typeof arr === 'string') {
                  if (arr === '{}' || arr === '') return [];
                  const cleaned = arr.replace(/^{|}$/g, '');
                  if (!cleaned) return [];
                  if (cleaned.includes('"')) {
                    const matches = cleaned.match(/"[^"]*"|[^",]+/g);
                    return matches ? matches.map(item => item.replace(/"/g, '').trim()).filter(item => item) : [];
                  } else {
                    return cleaned.split(',').map(item => item.trim()).filter(item => item);
                  }
                }
                return [];
              };

              // Check if this is a van driver assignment using the flag from context
              // The flag is set when the van driver button is clicked
              const isVanDriver = isVanDriverAssignment;

              if (isVanDriver) {
                // Assign as van driver (van drivers can't be tentative for now)
                updateData.assignedVanDriverId = assignees[0];
                // Also set vanDriverNeeded to true if not already set
                if (!currentEvent.vanDriverNeeded) {
                  updateData.vanDriverNeeded = true;
                  // Default to no additional regular drivers when van driver is newly needed
                  updateData.driversNeeded = 0;
                }
              } else if (isTentative) {
                // Tentative driver assignment - add to tentativeDriverIds
                const existingTentativeDrivers = currentEvent.tentativeDriverIds || [];
                const allTentativeDriverIds = [...new Set([...existingTentativeDrivers, ...assignees])];
                updateData.tentativeDriverIds = allTentativeDriverIds;
              } else {
                // Regular driver assignment
                // Get existing drivers and merge with new ones
                const existingDrivers = currentEvent.assignedDriverIds || [];
                const existingDriverDetails = currentEvent.driverDetails || {};

                // Merge new drivers with existing ones (avoiding duplicates)
                const allDriverIds = [...new Set([...existingDrivers, ...assignees])];
                updateData.assignedDriverIds = allDriverIds;

                // Build driver details object, preserving existing details
                const driverDetails: any = { ...existingDriverDetails };
                allDriverIds.forEach(driverId => {
                  // Only add new details if they don't exist yet
                  if (!driverDetails[driverId]) {
                  // Check if it's a numeric driver ID
                  const isNumericId = /^\d+$/.test(driverId);

                  let driverName = driverId; // fallback to ID if name not found

                  if (isNumericId) {
                    // It's a traditional driver ID - look it up in the drivers array
                    const driver = (drivers ?? []).find((d: any) => d.id.toString() === driverId || d.id === parseInt(driverId));
                    if (driver) {
                      driverName = driver.name;
                      logger.log(`Found driver: ID=${driverId}, Name=${driver.name}`);
                    } else {
                      logger.warn(`Driver not found in loaded drivers: ID=${driverId}`);
                      // Keep the ID as-is, it will show as "Driver #350" in the UI
                    }
                  } else {
                    // It's a user ID - look it up in the users array
                    const foundUser = (users ?? []).find((u: any) => u.id === driverId);
                    if (foundUser) {
                      driverName = `${foundUser.firstName} ${foundUser.lastName}`.trim();
                    }
                  }

                    driverDetails[driverId] = {
                      name: driverName,
                      assignedAt: new Date().toISOString(),
                      assignedBy: user?.id || 'system'
                    };
                  }
                });
                updateData.driverDetails = driverDetails;
              }

            } else if (assignmentType === 'volunteer') {
              if (isTentative) {
                // Tentative volunteer assignment - add to tentativeVolunteerIds
                const existingTentativeVolunteers = currentEvent.tentativeVolunteerIds || [];
                const allTentativeVolunteerIds = [...new Set([...existingTentativeVolunteers, ...assignees])];
                updateData.tentativeVolunteerIds = allTentativeVolunteerIds;
              } else {
              // Get existing volunteers and merge with new ones
              const existingVolunteers = currentEvent.assignedVolunteerIds || [];
              const existingVolunteerDetails = currentEvent.volunteerDetails || {};

              // Merge new volunteers with existing ones (avoiding duplicates)
              const allVolunteerIds = [...new Set([...existingVolunteers, ...assignees])];
              updateData.assignedVolunteerIds = allVolunteerIds;

              // Build volunteer details object, preserving existing details
              const volunteerDetails: any = { ...existingVolunteerDetails };
              const volunteerAssignments: string[] = [];

              // Add details for all volunteers (existing + new)
              allVolunteerIds.forEach(volunteerId => {
                // Only add new details if they don't exist yet
                if (!volunteerDetails[volunteerId]) {
                  let name = volunteerId; // Default fallback
                  
                  // Handle custom IDs (e.g., "custom-1762134226512-David")
                  if (volunteerId.startsWith('custom-')) {
                    const parts = volunteerId.split('-');
                    if (parts.length >= 3) {
                      const nameParts = parts.slice(2);
                      name = nameParts.join('-').replace(/-/g, ' ').trim() || 'Custom Volunteer';
                    } else {
                      name = 'Custom Volunteer';
                    }
                  }
                  // Handle host-contact IDs (e.g., "host-contact-4")
                  else if (volunteerId.startsWith('host-contact-')) {
                    const contactId = parseInt(volunteerId.replace('host-contact-', ''));
                    // Try to find in hostsWithContacts
                    let found = false;
                    if (hostsWithContacts && hostsWithContacts.length > 0) {
                      for (const host of hostsWithContacts) {
                        const contact = host.contacts?.find((c: any) => c.id === contactId);
                        if (contact) {
                          name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || contact.email || `Contact #${contactId}`;
                          found = true;
                          break;
                        }
                      }
                    }
                    if (!found) {
                      name = `Contact #${contactId}`;
                    }
                  }
                  // Handle regular user IDs
                  else {
                    const foundUser = (users ?? []).find((u: any) => u.id === volunteerId);
                    if (foundUser) {
                      name = `${foundUser.firstName} ${foundUser.lastName}`.trim() || foundUser.displayName || volunteerId;
                    }
                  }

                  volunteerDetails[volunteerId] = {
                    name: name,
                    assignedAt: new Date().toISOString(),
                    assignedBy: user?.id || 'system'
                  };
                }
                volunteerAssignments.push(volunteerDetails[volunteerId].name || volunteerId);
              });

              updateData.volunteerDetails = volunteerDetails;
              updateData.volunteerAssignments = volunteerAssignments;
              }
            }

            try {
              logger.log('Update data:', updateData);

              const result = await updateEventRequestMutation.mutateAsync({
                id: assignmentEventId,
                data: updateData,
              });

              logger.log('Update result:', result);

              // Close the dialog
              closeDialog('assignment');
              setAssignmentType(null);
              setAssignmentEventId(null);
              setSelectedAssignees([]);

              toast({
                title: 'Success',
                description: isTentative
                  ? `${assignmentType}s added as tentative (?)`
                  : `${assignmentType}s assigned successfully`,
              });
            } catch (error) {
              // onError on updateEventRequestMutation already shows a user-facing toast
              logger.error('Assignment error:', error);
            }
          }}
        />

        {/* Sandwich Planning Modal */}
        <Dialog
          open={(activeDialog === 'sandwichPlanning')}
          onOpenChange={(open) => (open ? openDialog('sandwichPlanning') : closeDialog('sandwichPlanning'))}
        >
          <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-brand-primary flex items-center gap-3">
                <Package className="w-6 h-6" />
                Weekly Sandwich Planning
              </DialogTitle>
              <DialogDescription>
                Plan sandwich production based on scheduled events. Monitor
                trends and adjust quantities based on demand patterns.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-6">
              <SandwichForecastWidget />

              <div className="bg-[#e6f2f5] border border-[#007E8C]/30 rounded-lg p-4">
                <h4 className="font-semibold text-[#1A2332] mb-2 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Sandwich Planning Tips
                </h4>
                <ul className="text-sm text-[#236383] space-y-1">
                  <li>
                    • Plan sandwich types based on dietary restrictions and
                    preferences
                  </li>
                  <li>
                    • Factor in 10-15% extra sandwiches for unexpected attendees
                  </li>
                  <li>
                    • Coordinate with kitchen volunteers for preparation
                    schedules
                  </li>
                  <li>
                    • Check delivery addresses for any special requirements
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button
                onClick={() => closeDialog('sandwichPlanning')}
                className="text-white"
                style={{ backgroundColor: '#236383' }}
              >
                Close Sandwich Planning
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Volunteer Opportunities Dialog */}
        <Dialog
          open={showVolunteerOpportunities}
          onOpenChange={setShowVolunteerOpportunities}
        >
          <DialogContent className="!w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] !h-[88vh] flex flex-col overflow-hidden p-0">
            <div className="px-4 sm:px-8 pt-6 pb-4 flex-shrink-0">
              <DialogHeader>
                <DialogTitle className="text-xl sm:text-3xl font-bold flex items-center gap-2 sm:gap-4 mb-2" style={{ color: '#007E8C' }}>
                  <Users className="w-6 h-6 sm:w-8 sm:h-8" />
                  Volunteer Opportunities
                </DialogTitle>
                <DialogDescription className="text-sm sm:text-lg font-medium">
                  Sign up to speak or volunteer at upcoming events
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pb-8">
              <VolunteerOpportunitiesTab />
            </div>
          </DialogContent>
        </Dialog>

        {/* Staffing Planning Modal */}
        <Dialog
          open={(activeDialog === 'staffingPlanning')}
          onOpenChange={(open) => (open ? openDialog('staffingPlanning') : closeDialog('staffingPlanning'))}
        >
          <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-brand-primary flex items-center gap-3">
                <Users className="w-6 h-6" />
                Weekly Staffing Planning
              </DialogTitle>
              <DialogDescription>
                Coordinate drivers and volunteers for scheduled
                events. Ensure all positions are filled before event dates.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-6">
              <StaffingForecastWidget />

              <div className="bg-[#e6f2f5] border border-[#007E8C]/30 rounded-lg p-4">
                <h4 className="font-semibold text-[#1A2332] mb-2 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Staffing Planning Tips
                </h4>
                <ul className="text-sm text-[#236383] space-y-1">
                  <li>
                    • Check driver assignments early - transportation is
                    critical
                  </li>
                  <li>
                    • Van drivers are needed for large events or special
                    delivery requirements
                  </li>
                  <li>
                    • Volunteers help with event setup and sandwich distribution
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button
                onClick={() => closeDialog('staffingPlanning')}
                className="text-white"
                style={{ backgroundColor: '#236383' }}
              >
                Close Staffing Planning
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Back to Top Floating Button - Desktop only to avoid mobile crowding */}
        {showBackToTop && (
          <div className="hidden sm:block fixed bottom-[calc(1.5rem+var(--chat-dock-height,0px))] left-6 z-50">
            <button
              onClick={scrollToTop}
              className="h-10 w-10 rounded-full shadow-lg bg-slate-600 hover:bg-slate-700 active:bg-slate-800 transition-all duration-200 flex items-center justify-center text-white hover:scale-105 active:scale-95"
              title="Back to Top"
              aria-label="Scroll back to top"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Floating Action Button for Spreadsheet View - Desktop only, hidden on mobile to avoid crowding */}
        {activeTab !== 'scheduled' && (
          <div className="hidden sm:block fixed bottom-[calc(1.5rem+var(--chat-dock-height,0px))] right-6 z-50">
            <button
              onClick={handleSwitchToSpreadsheet}
              className="h-14 w-14 rounded-full shadow-xl bg-green-600 hover:bg-green-700 active:bg-green-800 transition-all duration-200 flex items-center justify-center text-white hover:scale-105 active:scale-95"
              title="Switch to Spreadsheet View"
              aria-label="Switch to Spreadsheet View"
            >
              <Sheet className="h-5 w-5" />
            </button>

          </div>
        )}

        {/* AI Assistant */}
        <FloatingAIChat
          contextType="events"
          title="Events Assistant"
          subtitle="Ask about event requests and scheduling"
          contextData={{
            currentView: activeTab,
            filters: {
              statusFilter,
              confirmationFilter,
              searchQuery,
            },
            summaryStats: (() => {
              // Calculate this week's events (Mon-Sun)
              const now = new Date();
              const dayOfWeek = now.getDay();
              const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
              const monday = new Date(now);
              monday.setDate(now.getDate() + mondayOffset);
              monday.setHours(0, 0, 0, 0);
              const sunday = new Date(monday);
              sunday.setDate(monday.getDate() + 6);
              sunday.setHours(23, 59, 59, 999);

              const thisWeekEvents = eventRequests.filter(e => {
                const eventDate = getEffectiveEventDate(e);
                if (!eventDate) return false;
                const date = new Date(eventDate);
                return date >= monday && date <= sunday && ['scheduled', 'in_process'].includes(e.status);
              });

              const thisWeekSandwiches = thisWeekEvents.reduce((sum, e) =>
                sum + (e.estimatedSandwichCount || e.actualSandwichCount || 0), 0
              );

              return {
                totalEvents: eventRequests.length,
                scheduledEvents: eventRequests.filter(e => isScheduledOrRescheduled(e.status)).length,
                inProcessEvents: eventRequests.filter(e => e.status === 'in_process').length,
                newRequests: eventRequests.filter(e => e.status === 'new').length,
                completedEvents: eventRequests.filter(e => e.status === 'completed').length,
                confirmedEvents: eventRequests.filter(e => e.isConfirmed).length,
                // Pre-calculated weekly stats so AI doesn't have to count from truncated data
                thisWeekDateRange: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                thisWeekEventCount: thisWeekEvents.length,
                thisWeekSandwichTotal: thisWeekSandwiches,
                thisWeekEventsList: thisWeekEvents.map(e => ({
                  name: e.organizationName,
                  date: new Date(getEffectiveEventDate(e)!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                  sandwiches: e.estimatedSandwichCount || e.actualSandwichCount || 0,
                  status: e.status,
                })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
              };
            })(),
          }}
          getFullContext={() => ({
            rawData: eventRequests.map(e => ({
              id: e.id,
              organizationName: e.organizationName,
              status: e.status,
              scheduledEventDate: e.scheduledEventDate,
              desiredEventDate: e.desiredEventDate,
              estimatedSandwichCount: e.estimatedSandwichCount,
              actualSandwichCount: e.actualSandwichCount,
              isConfirmed: e.isConfirmed,
              category: e.category,
              eventStartTime: e.eventStartTime,
              eventEndTime: e.eventEndTime,
              driversNeeded: e.driversNeeded,
              speakersNeeded: e.speakersNeeded,
              volunteersNeeded: e.volunteersNeeded,
            })),
            selectedItem: selectedEventRequest ? {
              organizationName: selectedEventRequest.organizationName,
              status: selectedEventRequest.status,
              scheduledEventDate: selectedEventRequest.scheduledEventDate,
              desiredEventDate: selectedEventRequest.desiredEventDate,
              estimatedSandwichCount: selectedEventRequest.estimatedSandwichCount,
              isConfirmed: selectedEventRequest.isConfirmed,
            } : undefined,
          })}
          suggestedQuestions={[
            "How many events are scheduled this month?",
            "What events need follow-up?",
            "Show events by status",
            "Which events are pending confirmation?",
            "What's our total sandwich count for scheduled events?",
          ]}
        />
      </div>
    </TooltipProvider>
  );
};

// Main component with provider wrapper
export default function EventRequestsManagementV2({
  initialTab,
  initialEventId,
}: {
  initialTab?: string | null;
  initialEventId?: number;
} = {}) {
  const { user } = useAuth();
  if (!user || !hasPermission(user, PERMISSIONS.NAV_EVENT_PLANNING)) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <PermissionDenied
          action="view Event Requests"
          requiredPermission={PERMISSIONS.NAV_EVENT_PLANNING}
          message="Event Requests is for the event management team. Volunteer sign-ups live in Volunteer Hub."
        />
      </div>
    );
  }

  return (
    <EventRequestProvider
      initialTab={initialTab}
      initialEventId={initialEventId}
    >
      <EventRequestsManagementContent />
    </EventRequestProvider>
  );
}
