import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Calendar,
  Car,
  Users,
  CheckCircle2,
  ArrowRight,
  Clock,
  TrendingUp,
  AlertCircle,
  Sparkles,
  Star,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Truck,
  Sandwich,
  MapPin,
} from 'lucide-react';
import { format, isValid, formatDistanceToNowStrict } from 'date-fns';
import { parseDateOnly } from '@shared/date-utils';
import { formatSandwichTypesDisplay, formatEventEstimate } from '@/lib/sandwich-utils';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';

interface UpcomingDeadline {
  id: number;
  organizationName: string;
  eventDate: string;
  status: string;
  needsDriver: boolean;
  needsVolunteer: boolean;
  isToday: boolean;
}

interface MyAssignmentItem {
  id: number;
  organizationName: string | null;
  status: string | null;
  eventDate: string | null;
  createdAt: string | null;
  daysSinceSubmitted: number | null;
  daysUntilEvent: number | null;
  urgentGaps: string[];
  needsUrgentDetails: boolean;
  lastContactAttempt: string | null;
  estimatedSandwichCount: number | null;
  estimatedSandwichCountMin: number | null;
  estimatedSandwichCountMax: number | null;
  sandwichTypes: unknown;
  needsFollowUp: boolean;
  vanNeeded: boolean;
  vanDriverNeeded: boolean;
  vanNeededLikely: boolean;
  isLargeEvent: boolean;
  isCorporatePriority: boolean;
}

interface MyAssignments {
  total: number;
  newRequestsCount: number;
  inProcessStaleCount: number;
  urgentDetailGapsCount: number;
  byStatus: {
    new: number;
    in_process: number;
    scheduled: number;
    rescheduled: number;
  };
  byStatusEvents: {
    new: MyAssignmentItem[];
    in_process: MyAssignmentItem[];
    scheduled: MyAssignmentItem[];
    rescheduled: MyAssignmentItem[];
  };
  newRequests: MyAssignmentItem[];
  inProcessStale: MyAssignmentItem[];
  urgentDetailEvents: MyAssignmentItem[];
  allMyEvents: MyAssignmentItem[];
}

interface OperationalStats {
  thisWeekEventsCount: number;
  eventsNeedingDrivers: number;
  eventsNeedingVolunteers: number;
  totalDriversNeeded: number;
  totalVolunteersNeeded: number;
  lastWeekCompletionRate: number | null;
  lastWeekCompleted: number;
  lastWeekTotal: number;
  upcomingDeadlines: UpcomingDeadline[];
  todayEventsCount: number;
  tomorrowEventsCount: number;
  activeEventsCount: number;
  statusCounts: {
    new: number;
    in_process: number;
    scheduled: number;
    rescheduled: number;
  };
  /** When the logged-in user has TSP-contact assignments, server returns
      this personalized snapshot. Null when no assignments (or user is not
      logged in). */
  myAssignments?: MyAssignments | null;
}

interface OperationalOverviewProps {
  onNavigate: (section: string) => void;
}

/**
 * Personalized snapshot rendered in place of the generic overview when the
 * current user has TSP-contact assignments. Layout (top → bottom):
 *   1. New requests assigned to me (first contact owed)
 *   2. In-process events with no contact in the last 7 days (stale)
 *   3. Events within 7 days missing time, location, or sandwich info (urgent)
 *   4. Assignment breakdown by status (counts; expandable detail lists)
 *   5. The rest of the user's events — only those not already surfaced in a
 *      box above (hidden when nothing is left over)
 *
 * Each event's CARD appears in exactly one place: the first (topmost) of
 * boxes 1–3 it qualifies for, otherwise the leftover list (5). Boxes are
 * de-duplicated against each other so a single event is never shown as a card
 * more than once; see the dedup memo in MyAssignmentsView for the rule.
 */
type AssignmentStatusKey = 'new' | 'in_process' | 'scheduled' | 'rescheduled';

const statusStyle: Record<string, string> = {
  new: 'bg-[#FBAD3F] text-[#3d2800] border-[#E8960C] shadow-md hover:shadow-lg',
  in_process: 'bg-[#236383] text-white border-[#1a4d63] shadow-md hover:shadow-lg',
  scheduled: 'bg-[#007E8C] text-white border-[#005f6b] shadow-md hover:shadow-lg',
  rescheduled: 'bg-[#47B3CB] text-[#0d3d4d] border-[#007E8C] shadow-md hover:shadow-lg',
};
const statusBadgeStyle: Record<string, string> = {
  new: 'bg-[#FBAD3F] text-[#3d2800] border-[#E8960C]',
  in_process: 'bg-[#236383] text-white border-[#236383]',
  scheduled: 'bg-[#007E8C] text-white border-[#007E8C]',
  rescheduled: 'bg-[#47B3CB] text-[#0d3d4d] border-[#007E8C]',
};
const statusRowAccent: Record<string, string> = {
  new: 'border-l-[#FBAD3F]',
  in_process: 'border-l-[#47B3CB]',
  scheduled: 'border-l-[#007E8C]',
  rescheduled: 'border-l-[#236383]',
};
const statusLabel: Record<string, string> = {
  new: 'New',
  in_process: 'In Process',
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
};

function formatEventDateParts(dateString: string | null) {
  if (!dateString) {
    return { day: '—', month: 'TBD', weekday: 'Date TBD', full: 'Date TBD' };
  }
  try {
    const date = parseDateOnly(dateString);
    if (!date || !isValid(date)) {
      return { day: '—', month: 'TBD', weekday: 'Date TBD', full: 'Date TBD' };
    }
    return {
      day: format(date, 'd'),
      month: format(date, 'MMM'),
      weekday: format(date, 'EEE'),
      full: format(date, 'EEE, MMM d, yyyy'),
    };
  } catch {
    return { day: '—', month: 'TBD', weekday: 'Date TBD', full: 'Date TBD' };
  }
}

function formatLastContact(ts: string | null): string {
  if (!ts) return 'never';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return 'never';
    return `${formatDistanceToNowStrict(d)} ago`;
  } catch {
    return 'never';
  }
}

function formatDaysSinceSubmitted(days: number | null | undefined): string | null {
  if (days == null) return null;
  if (days === 0) return 'Submitted today';
  if (days === 1) return 'Submitted 1 day ago';
  return `Submitted ${days} days ago`;
}

function formatDaysUntilEvent(days: number | null | undefined): string | null {
  if (days == null) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function UrgentGapBadge({ gap }: { gap: string }) {
  const isTime = gap.toLowerCase().includes('time');
  const isLocation = gap.toLowerCase().includes('location');
  const Icon = isTime ? Clock : isLocation ? MapPin : Sandwich;
  const className = isTime
    ? 'border-red-600 text-white bg-red-600'
    : isLocation
      ? 'border-orange-600 text-white bg-orange-600'
      : 'border-[#A31C41] text-white bg-[#A31C41]';

  return (
    <Badge className={`text-[10px] font-semibold border-0 shadow-sm ${className}`}>
      <Icon className="w-3 h-3 mr-1" />
      {gap}
    </Badge>
  );
}

function getSandwichSummary(event: MyAssignmentItem): string {
  return formatEventEstimate(event as any);
}

function AssignmentEventRow({
  event,
  onOpen,
  showStatus = false,
  emphasizeSubmittedAge = false,
}: {
  event: MyAssignmentItem;
  onOpen: (event: MyAssignmentItem) => void;
  showStatus?: boolean;
  emphasizeSubmittedAge?: boolean;
}) {
  const dateParts = formatEventDateParts(event.eventDate);
  const sandwichSummary = getSandwichSummary(event);
  const hasSandwichInfo = sandwichSummary !== 'Not specified';
  const submittedLabel = formatDaysSinceSubmitted(event.daysSinceSubmitted);
  const untilEventLabel = formatDaysUntilEvent(event.daysUntilEvent);
  const isUrgent = event.needsUrgentDetails;
  const rowAccent = statusRowAccent[event.status || ''] || 'border-l-gray-300';

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className={`w-full text-left p-3 rounded-lg border-l-4 transition-all shadow-sm hover:shadow-md ${
        isUrgent
          ? 'border-l-red-600 bg-red-50 border-y border-r border-red-400 ring-2 ring-red-200 hover:bg-red-100'
          : `${rowAccent} bg-white border-y border-r border-[#47B3CB]/50 hover:border-[#007E8C] hover:bg-[#e8f4f8]/60`
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-[4.5rem] text-center rounded-lg bg-gradient-to-b from-[#007E8C] to-[#236383] border border-[#005f6b] px-2 py-2 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#FBAD3F]">
            {dateParts.month}
          </div>
          <div className="text-2xl font-bold leading-none text-white mt-0.5">
            {dateParts.day}
          </div>
          <div className="text-[10px] font-semibold text-[#47B3CB] mt-0.5">
            {dateParts.weekday}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {showStatus && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border mb-1 shadow-sm ${statusBadgeStyle[event.status || ''] || 'bg-gray-600 text-white border-gray-600'}`}
                >
                  {statusLabel[event.status || ''] || event.status}
                </span>
              )}
              <div className="font-bold text-gray-900 truncate">
                {event.organizationName || 'Untitled organization'}
              </div>
              {(emphasizeSubmittedAge || event.status === 'new') && submittedLabel && (
                <div className="mt-1">
                  <Badge
                    className={`text-[10px] font-bold border-0 shadow-sm ${
                      (event.daysSinceSubmitted ?? 0) >= 3
                        ? 'bg-[#A31C41] text-white'
                        : 'bg-[#FBAD3F] text-[#3d2800]'
                    }`}
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    {submittedLabel}
                  </Badge>
                </div>
              )}
              <div className="text-sm font-semibold text-[#236383] mt-0.5">
                {dateParts.full}
                {untilEventLabel && event.needsUrgentDetails && (
                  <span className="ml-2 text-red-700 font-bold">· {untilEventLabel}</span>
                )}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#007E8C] shrink-0 mt-1" />
          </div>

          {hasSandwichInfo && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-[#236383] mt-2">
              <Sandwich className="w-3.5 h-3.5 text-[#FBAD3F] shrink-0" />
              <span>{sandwichSummary}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mt-2">
            {event.urgentGaps?.map((gap) => (
              <UrgentGapBadge key={gap} gap={gap} />
            ))}
            {event.needsFollowUp && (
              <Badge className="text-[10px] font-semibold border-0 bg-amber-500 text-white shadow-sm">
                <AlertTriangle className="w-3 h-3 mr-1" />
                No contact in 7+ days
              </Badge>
            )}
            {event.vanNeeded && (
              <Badge className="text-[10px] font-semibold border-0 bg-orange-600 text-white shadow-sm">
                <Truck className="w-3 h-3 mr-1" />
                {event.vanDriverNeeded ? 'Van needed' : 'Van likely needed'}
              </Badge>
            )}
            {event.isLargeEvent && (
              <Badge className="text-[10px] font-semibold border-0 bg-purple-600 text-white shadow-sm">
                Large event (500+)
              </Badge>
            )}
            {event.isCorporatePriority && (
              <Badge className="text-[10px] font-semibold border-0 bg-[#A31C41] text-white shadow-sm">
                Corporate priority
              </Badge>
            )}
          </div>

          {event.lastContactAttempt != null && (
            <div className="text-xs font-medium text-[#236383]/80 mt-2">
              Last contact {formatLastContact(event.lastContactAttempt)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

type AssignmentActionSectionId = 'new-requests' | 'stale-followup' | 'urgent-details';

function AssignmentActionBar({
  newRequests,
  inProcessStale,
  urgentDetailEvents,
  onOpenEvent,
  onScrollToSection,
}: {
  // These are the de-duplicated lists actually rendered in the boxes below, so
  // the action bar indexes into exactly what the user sees (no phantom "make
  // first contact" action for an event that's shown only in the urgent box).
  newRequests: MyAssignmentItem[];
  inProcessStale: MyAssignmentItem[];
  urgentDetailEvents: MyAssignmentItem[];
  onOpenEvent: (event: MyAssignmentItem) => void;
  onScrollToSection: (sectionId: AssignmentActionSectionId) => void;
}) {
  const actions = useMemo(() => {
    const items: Array<{
      id: AssignmentActionSectionId;
      label: string;
      className: string;
      icon: ReactNode;
      onClick: () => void;
    }> = [];

    if (newRequests.length > 0) {
      const top = newRequests[0];
      const days = top?.daysSinceSubmitted;
      const ageHint =
        days != null && days > 0 ? ` (oldest: ${days} day${days === 1 ? '' : 's'})` : '';
      items.push({
        id: 'new-requests',
        label:
          newRequests.length === 1
            ? `Make first contact — ${top?.organizationName || 'new request'}${ageHint}`
            : `Make first contact on ${newRequests.length} new requests${ageHint}`,
        className: 'bg-[#FBAD3F] text-[#3d2800] hover:bg-[#E8960C] border-[#E8960C]',
        icon: <Sparkles className="w-3.5 h-3.5 shrink-0" />,
        onClick: () => {
          if (top) {
            onOpenEvent(top);
            return;
          }
          onScrollToSection('new-requests');
        },
      });
    }

    if (inProcessStale.length > 0) {
      const top = inProcessStale[0];
      items.push({
        id: 'stale-followup',
        label:
          inProcessStale.length === 1
            ? `Follow up — no contact in 7+ days (${top?.organizationName || 'in process'})`
            : `Follow up on ${inProcessStale.length} events with no contact in 7+ days`,
        className: 'bg-amber-500 text-white hover:bg-amber-600 border-amber-600',
        icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
        onClick: () => {
          if (top) {
            onOpenEvent(top);
            return;
          }
          onScrollToSection('stale-followup');
        },
      });
    }

    const urgentCount = urgentDetailEvents.length;
    if (urgentCount > 0) {
      const top = urgentDetailEvents[0];
      const when =
        top?.daysUntilEvent === 0
          ? 'today'
          : top?.daysUntilEvent === 1
            ? 'tomorrow'
            : top?.daysUntilEvent != null
              ? `in ${top.daysUntilEvent} days`
              : 'soon';
      const gapHint = top?.urgentGaps?.length
        ? ` — needs ${top.urgentGaps.join(', ').toLowerCase()}`
        : '';
      items.push({
        id: 'urgent-details',
        label:
          urgentCount === 1
            ? `Add missing details before event ${when}${gapHint}`
            : `Add missing details on ${urgentCount} events happening within 7 days`,
        className: 'bg-red-600 text-white hover:bg-red-700 border-red-700',
        icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
        onClick: () => {
          if (top) {
            onOpenEvent(top);
            return;
          }
          onScrollToSection('urgent-details');
        },
      });
    }

    return items;
  }, [newRequests, inProcessStale, urgentDetailEvents, onOpenEvent, onScrollToSection]);

  if (actions.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border-2 border-[#A31C41]/40 bg-[#A31C41]/5 p-3 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-[#A31C41] mb-2">
        Your next steps
      </p>
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            className={`w-full inline-flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border-2 text-left text-sm font-bold shadow-sm transition-all hover:shadow-md hover:scale-[1.01] ${action.className}`}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              {action.icon}
              <span className="leading-snug">{action.label}</span>
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MyAssignmentsView({
  my,
  onNavigate,
  drillToEvents,
}: {
  my: MyAssignments;
  onNavigate: (section: string) => void;
  drillToEvents: (tab: string, filter?: string) => void;
}) {
  const { user } = useAuth();
  const canViewVolunteerHub = !!user && hasPermission(user, PERMISSIONS.NAV_VOLUNTEER_HUB);
  const [expandedStatus, setExpandedStatus] = useState<AssignmentStatusKey | null>(null);
  const newRequestsRef = useRef<HTMLDivElement>(null);
  const staleFollowupRef = useRef<HTMLDivElement>(null);
  const urgentDetailsRef = useRef<HTMLDivElement>(null);

  const scrollToActionSection = (sectionId: AssignmentActionSectionId) => {
    const refMap = {
      'new-requests': newRequestsRef,
      'stale-followup': staleFollowupRef,
      'urgent-details': urgentDetailsRef,
    };
    refMap[sectionId].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openAssignmentEvent = (event: MyAssignmentItem) => {
    try {
      sessionStorage.setItem(
        'eventRequests.pendingFilter',
        JSON.stringify({
          tab: 'my_assignments',
          myAssignmentsStatuses: event.status ? [event.status] : undefined,
        }),
      );
    } catch {
      // ignore unavailable sessionStorage
    }
    window.history.pushState({}, '', '/dashboard?section=event-requests&tab=my_assignments');
    onNavigate('event-requests');
  };

  const drillToStatusTab = (tab: AssignmentStatusKey) => {
    try {
      sessionStorage.setItem(
        'eventRequests.pendingFilter',
        JSON.stringify({
          tab: 'my_assignments',
          myAssignmentsStatuses: [tab],
        }),
      );
    } catch {
      // ignore unavailable sessionStorage
    }
    window.history.pushState({}, '', '/dashboard?section=event-requests&tab=my_assignments');
    onNavigate('event-requests');
  };

  // Open the My Assignments tab in Event Requests, optionally pre-filtered to
  // a set of statuses. Used by the "+ N more" overflow hints so events beyond
  // the first few rendered in a priority box are still reachable rather than
  // silently dropped (they're excluded from the catch-all list below).
  const openMyAssignments = (statuses?: AssignmentStatusKey[]) => {
    try {
      sessionStorage.setItem(
        'eventRequests.pendingFilter',
        JSON.stringify({
          tab: 'my_assignments',
          myAssignmentsStatuses: statuses,
        }),
      );
    } catch {
      // ignore unavailable sessionStorage
    }
    window.history.pushState({}, '', '/dashboard?section=event-requests&tab=my_assignments');
    onNavigate('event-requests');
  };

  const toggleStatusExpand = (key: AssignmentStatusKey) => {
    setExpandedStatus((prev) => (prev === key ? null : key));
  };

  const byStatusEvents = my.byStatusEvents ?? {
    new: my.newRequests,
    in_process: my.allMyEvents.filter((e) => e.status === 'in_process'),
    scheduled: my.allMyEvents.filter((e) => e.status === 'scheduled'),
    rescheduled: my.allMyEvents.filter((e) => e.status === 'rescheduled'),
  };

  // De-duplicate where each event's CARD appears. The server sends the same
  // event in several overlapping buckets (a new request that's also missing
  // urgent details lands in both `newRequests` and `urgentDetailEvents`, and
  // every event is also in `allMyEvents`). Rendering each bucket verbatim made
  // the dashboard show a single event as a card three or four times over.
  //
  // Rule: each event's card appears in the first (topmost) "needs attention"
  // box it qualifies for, reading down the page — new requests, then stale
  // follow-ups, then urgent details — and the catch-all list at the bottom
  // shows only what's left. New and in-process are status-disjoint, so only
  // the urgent-details box overlaps the others; an urgent event already shown
  // above keeps its urgent-gap badges on the card, so no signal is lost.
  //
  // The header count, "Your next steps" summary, and status-count tiles are
  // aggregate/summary views (not repeated event cards) and follow this same
  // de-duplicated set so they stay consistent with the boxes they index into.
  const {
    newRequestsToShow,
    inProcessStaleToShow,
    urgentDetailsToShow,
    otherEvents,
    actionableCount,
  } = useMemo(() => {
    const newList = my.newRequests;
    const staleList = my.inProcessStale;
    const claimed = new Set<number>([
      ...newList.map((e) => e.id),
      ...staleList.map((e) => e.id),
    ]);
    // Urgent details only surfaces events not already shown as new/stale above.
    const urgentList = (my.urgentDetailEvents ?? []).filter((e) => !claimed.has(e.id));

    const surfaced = new Set<number>([...claimed, ...urgentList.map((e) => e.id)]);
    const others = my.allMyEvents.filter((e) => !surfaced.has(e.id));

    return {
      newRequestsToShow: newList,
      inProcessStaleToShow: staleList,
      urgentDetailsToShow: urgentList,
      otherEvents: others,
      // Distinct events that need action across all "needs attention" boxes.
      actionableCount: surfaced.size,
    };
  }, [my]);

  return (
    <div className="mx-4 mb-8">
      <div
        className="premium-card-elevated p-6 bg-gradient-to-br from-white via-[#e8f4f8]/40 to-white"
        style={{ borderTop: '5px solid #007E8C', boxShadow: '0 4px 24px rgba(35, 99, 131, 0.12)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 bg-gradient-to-br from-[#007E8C] to-[#236383] rounded-xl flex items-center justify-center shadow-md">
            <Star className="w-5 h-5 text-[#FBAD3F]" />
          </div>
          <div>
            <h3 className="premium-text-h4 text-[#236383] font-bold">My Assignments</h3>
            <p className="premium-text-body-sm text-[#007E8C] font-medium">
              {my.total} {my.total === 1 ? 'event' : 'events'} you're the TSP contact for
            </p>
          </div>
        </div>

        {/* "Your next steps" is a prioritized index into the boxes below. It
            earns its place when there are several things to triage; with a
            single actionable event it just echoes the one card right below it,
            so we hide it in that case to avoid showing the same event twice. */}
        {actionableCount > 1 && (
          <AssignmentActionBar
            newRequests={newRequestsToShow}
            inProcessStale={inProcessStaleToShow}
            urgentDetailEvents={urgentDetailsToShow}
            onOpenEvent={openAssignmentEvent}
            onScrollToSection={scrollToActionSection}
          />
        )}

        {/* PRIORITY 1: New requests assigned to me — first contact owed. Topmost
            box, so it shows every new request; the urgent-details box below
            skips any it already covers. */}
        {newRequestsToShow.length > 0 && (
          <div
            ref={newRequestsRef}
            id="my-assignments-new-requests"
            className="mb-6 rounded-xl border-2 border-[#FBAD3F] bg-gradient-to-br from-[#FBAD3F]/30 to-[#FBAD3F]/10 p-4 shadow-sm scroll-mt-4"
          >
            <h4 className="text-sm font-bold text-[#3d2800] mb-3 flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#FBAD3F] shadow-sm">
                <Sparkles className="w-4 h-4 text-[#3d2800]" />
              </span>
              {newRequestsToShow.length === 1 ? 'New request' : `${newRequestsToShow.length} new requests`} assigned to you
              <span className="text-xs font-semibold text-[#A31C41]">
                — make first contact
              </span>
            </h4>
            <div className="space-y-2">
              {newRequestsToShow.slice(0, 5).map((e) => (
                <AssignmentEventRow
                  key={e.id}
                  event={e}
                  onOpen={openAssignmentEvent}
                  emphasizeSubmittedAge
                />
              ))}
              {newRequestsToShow.length > 5 && (
                <button
                  type="button"
                  onClick={() => openMyAssignments(['new'])}
                  className="text-xs font-semibold text-[#3d2800] pl-3 hover:underline"
                >
                  + {newRequestsToShow.length - 5} more →
                </button>
              )}
            </div>
          </div>
        )}

        {/* PRIORITY 2: In-process events with no contact in the last 7 days.
            The urgent-details box below skips any it already covers. */}
        {inProcessStaleToShow.length > 0 && (
          <div
            ref={staleFollowupRef}
            id="my-assignments-stale-followup"
            className="mb-6 rounded-xl border-2 border-amber-500 bg-gradient-to-br from-amber-200 to-amber-50 p-4 shadow-sm scroll-mt-4"
          >
            <h4 className="text-sm font-bold text-amber-950 mb-3 flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500 shadow-sm">
                <AlertTriangle className="w-4 h-4 text-white" />
              </span>
              {inProcessStaleToShow.length === 1
                ? 'In-process event needs follow-up'
                : `${inProcessStaleToShow.length} in-process events need follow-up`}
              <span className="text-xs font-semibold text-amber-900">
                — no contact in 7+ days
              </span>
            </h4>
            <div className="space-y-2">
              {inProcessStaleToShow.slice(0, 5).map((e) => (
                <AssignmentEventRow key={e.id} event={e} onOpen={openAssignmentEvent} />
              ))}
              {inProcessStaleToShow.length > 5 && (
                <button
                  type="button"
                  onClick={() => openMyAssignments(['in_process'])}
                  className="text-xs font-semibold text-amber-950 pl-3 hover:underline"
                >
                  + {inProcessStaleToShow.length - 5} more →
                </button>
              )}
            </div>
          </div>
        )}

        {/* PRIORITY 2b: Events within 7 days missing time, location, or sandwich
            info. Shows only urgent events not already surfaced as new/stale
            above — they still carry their urgent-gap badges up there. */}
        {urgentDetailsToShow.length > 0 && (
          <div
            ref={urgentDetailsRef}
            id="my-assignments-urgent-details"
            className="mb-6 rounded-xl border-2 border-red-600 bg-gradient-to-br from-red-200 to-red-50 p-4 shadow-md scroll-mt-4"
          >
            <h4 className="text-sm font-bold text-red-950 mb-3 flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-600 shadow-sm animate-pulse">
                <AlertCircle className="w-4 h-4 text-white" />
              </span>
              {urgentDetailsToShow.length === 1
                ? 'Event needs details before it happens'
                : `${urgentDetailsToShow.length} events need details before they happen`}
              <span className="text-xs font-semibold text-red-900">
                — within 7 days, missing time, location, or sandwich info
              </span>
            </h4>
            <div className="space-y-2">
              {urgentDetailsToShow.slice(0, 5).map((e) => (
                <AssignmentEventRow key={e.id} event={e} onOpen={openAssignmentEvent} showStatus />
              ))}
              {urgentDetailsToShow.length > 5 && (
                <button
                  type="button"
                  onClick={() => openMyAssignments()}
                  className="text-xs font-semibold text-red-950 pl-3 hover:underline"
                >
                  + {urgentDetailsToShow.length - 5} more →
                </button>
              )}
            </div>
          </div>
        )}

        {/* PRIORITY 3: Status breakdown — click a tile to expand event details */}
        <div className="rounded-xl border-2 border-[#47B3CB]/50 bg-gradient-to-br from-[#e8f4f8] to-white p-4 mb-6 shadow-sm">
          <h4 className="text-sm font-bold text-[#236383] mb-1 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#007E8C]" />
            Your assignments by status
          </h4>
          <p className="text-xs font-medium text-[#007E8C] mb-3">
            Click a status to expand details. Click an event to open it in Event Requests.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {(['new', 'in_process', 'scheduled', 'rescheduled'] as const).map((key) => {
              const count = my.byStatus[key];
              if (count === 0) return null;
              const isExpanded = expandedStatus === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleStatusExpand(key)}
                  aria-expanded={isExpanded}
                  className={`px-3 py-3 rounded-lg border-2 text-left transition-all ${statusStyle[key]} ${
                    isExpanded ? 'ring-4 ring-offset-2 ring-[#FBAD3F] scale-[1.02]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-3xl font-black leading-none">{count}</div>
                      <div className="text-xs font-bold mt-1 uppercase tracking-wide">{statusLabel[key]}</div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 shrink-0 opacity-90" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0 opacity-90" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {expandedStatus && byStatusEvents[expandedStatus]?.length > 0 && (
            <div className="mt-4 space-y-2 border-t-2 border-[#47B3CB]/30 pt-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h5 className="text-sm font-bold text-[#236383]">
                  {statusLabel[expandedStatus]} events
                </h5>
                <button
                  type="button"
                  onClick={() => drillToStatusTab(expandedStatus)}
                  className="text-xs font-bold text-[#007E8C] hover:text-[#236383] hover:underline shrink-0"
                >
                  Open in Event Requests →
                </button>
              </div>
              {byStatusEvents[expandedStatus].map((event) => (
                <AssignmentEventRow
                  key={event.id}
                  event={event}
                  onOpen={openAssignmentEvent}
                />
              ))}
            </div>
          )}
        </div>

        {/* PRIORITY 4: The rest of the user's events — everything NOT already
            pulled out into a "needs attention" box above. This used to list
            every event (including the urgent/new/stale ones shown above),
            which is what made the dashboard feel like it repeated the same
            event over and over. Hidden entirely when nothing is left over. */}
        {otherEvents.length > 0 && (
          <div className="mb-6 rounded-xl border border-[#47B3CB]/40 bg-white p-4 shadow-sm">
            <h4 className="text-sm font-bold text-[#236383] mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#007E8C]" />
              {otherEvents.length === my.total ? 'Your events' : 'Your other events'}
            </h4>
            <div className="space-y-2">
              {otherEvents.slice(0, 8).map((e) => (
                <AssignmentEventRow
                  key={e.id}
                  event={e}
                  onOpen={openAssignmentEvent}
                  showStatus
                />
              ))}
              {otherEvents.length > 8 && (
                <button
                  type="button"
                  onClick={() => onNavigate('event-requests')}
                  className="w-full text-center text-sm font-bold text-[#007E8C] hover:text-[#236383] hover:underline py-2"
                >
                  View all your events →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => onNavigate('event-requests')}
            className="bg-[#236383] hover:bg-[#007E8C] text-white font-bold shadow-md"
          >
            <Calendar className="w-4 h-4 mr-2" />
            Open Event Requests
          </Button>
          {canViewVolunteerHub && (
            <Button
              variant="outline"
              onClick={() => onNavigate('volunteer-hub')}
              className="border-2 border-[#007E8C] text-[#007E8C] font-bold hover:bg-[#007E8C] hover:text-white"
            >
              <Users className="w-4 h-4 mr-2" />
              Volunteer Hub
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OperationalOverview({ onNavigate }: OperationalOverviewProps) {
  const { user } = useAuth();
  const canViewVolunteerHub = !!user && hasPermission(user, PERMISSIONS.NAV_VOLUNTEER_HUB);

  const { data: stats, isLoading, isError, error, refetch } = useQuery<OperationalStats | null>({
    queryKey: ['/api/event-requests/operational-stats'],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const res = await fetch('/api/event-requests/operational-stats', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.status === 403 || res.status === 401) {
          // No permission / not logged in — hide the widget quietly.
          return null;
        }
        if (!res.ok) {
          throw new Error('Failed to load operational stats');
        }
        return (await res.json()) as OperationalStats;
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      }
    },
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // Refresh every 2 minutes
  });

  const formatDate = (dateString: string) => {
    try {
      const date = parseDateOnly(dateString);
      return date && isValid(date) ? format(date, 'EEE, MMM d') : '';
    } catch {
      return '';
    }
  };

  // Drill down into the filtered Event Requests view. We stash the target tab
  // + quick filter in sessionStorage (read on mount by EventRequestContext)
  // then navigate. The tiles drill in via the "all" tab so the opened list
  // spans every active stage and its total exactly matches the tile count
  // (which /operational-stats computes across all active statuses).
  const drillToEvents = (tab: string, filter?: string) => {
    try {
      sessionStorage.setItem('eventRequests.pendingFilter', JSON.stringify({ tab, filter }));
    } catch {
      // ignore unavailable sessionStorage
    }
    const url = tab
      ? `/dashboard?section=event-requests&tab=${encodeURIComponent(tab)}`
      : '/dashboard?section=event-requests';
    window.history.pushState({}, '', url);
    onNavigate('event-requests');
  };

  if (isLoading) {
    return (
      <div className="mx-4 mb-8">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Permission-denied path returns null data without throwing.
  if (!stats && !isError) {
    return null;
  }

  if (isError || !stats) {
    return (
      <div className="mx-4 mb-8">
        <div
          className="premium-card-elevated p-6"
          style={{ borderTop: '4px solid #007E8C' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="premium-text-h4 text-brand-primary">My Assignments</h3>
              <p className="premium-text-body-sm text-gray-600 mt-1">
                Couldn't load your assigned events right now.
                {error instanceof Error && error.name === 'AbortError'
                  ? ' The request timed out.'
                  : ''}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white"
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Personalized snapshot takes priority for users with TSP-contact
  // assignments — they need to see THEIR events, not the global view. Users
  // with no assignments fall through to the existing generic overview below.
  if (stats.myAssignments && stats.myAssignments.total > 0) {
    return (
      <MyAssignmentsView
        my={stats.myAssignments}
        onNavigate={onNavigate}
        drillToEvents={drillToEvents}
      />
    );
  }

  // Check if there are urgent items: events today that still need staffing
  const hasUrgentItems = stats.upcomingDeadlines.some(
    d => d.isToday && (d.needsDriver || d.needsVolunteer)
  );

  return (
    <div className="mx-4 mb-8">
      <div className="premium-card-elevated p-6" style={{ borderTop: '4px solid #007E8C' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-teal rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="premium-text-h4 text-brand-primary">Operational Overview</h3>
              <p className="premium-text-body-sm text-gray-600">What needs attention right now</p>
            </div>
          </div>
          {hasUrgentItems && (
            <Badge variant="destructive" className="animate-pulse">
              <AlertCircle className="w-3 h-3 mr-1" />
              Attention Needed
            </Badge>
          )}
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {/* This Week's Events */}
          <div
            className="bg-white rounded-lg p-4 border border-gray-200 hover:border-brand-primary cursor-pointer transition-all"
            onClick={() => drillToEvents('all', 'week')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-brand-primary" />
              <span className="text-sm font-medium text-gray-600">This Week</span>
            </div>
            <div className="text-2xl font-bold text-brand-primary">{stats.thisWeekEventsCount}</div>
            <div className="text-xs text-gray-500">events scheduled</div>
          </div>

          {/* Events Needing Drivers */}
          <div
            className={`bg-white rounded-lg p-4 border cursor-pointer transition-all ${
              stats.eventsNeedingDrivers > 0
                ? 'border-red-300 hover:border-red-500 bg-red-50'
                : 'border-gray-200 hover:border-brand-primary'
            }`}
            onClick={() => drillToEvents('all', 'needsDriver')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Car className={`w-5 h-5 ${stats.eventsNeedingDrivers > 0 ? 'text-red-500' : 'text-brand-orange'}`} />
              <span className="text-sm font-medium text-gray-600">Need Drivers</span>
            </div>
            <div className={`text-2xl font-bold ${stats.eventsNeedingDrivers > 0 ? 'text-red-600' : 'text-brand-orange'}`}>
              {stats.eventsNeedingDrivers}
            </div>
            <div className="text-xs text-gray-500">events</div>
          </div>

          {/* Completion Rate */}
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-600">Last Week</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              {stats.lastWeekCompletionRate !== null ? `${stats.lastWeekCompletionRate}%` : 'N/A'}
            </div>
            <div className="text-xs text-gray-500">
              {stats.lastWeekTotal > 0
                ? `${stats.lastWeekCompleted}/${stats.lastWeekTotal} completed`
                : 'no events'
              }
            </div>
          </div>
        </div>

        {/* Staffing Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Staffing Needs Across All Active Events
          </h4>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                stats.totalDriversNeeded > 0 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
              }`}>
                <Car className="w-4 h-4 mr-1" />
                {stats.totalDriversNeeded} {stats.totalDriversNeeded === 1 ? 'driver' : 'drivers'} needed
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                stats.totalVolunteersNeeded > 0 ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
              }`}>
                <Users className="w-4 h-4 mr-1" />
                {stats.totalVolunteersNeeded} {stats.totalVolunteersNeeded === 1 ? 'volunteer' : 'volunteers'} needed
              </span>
            </div>
          </div>
        </div>

        {/* Upcoming Deadlines */}
        {stats.upcomingDeadlines.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Upcoming Deadlines
              {stats.todayEventsCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {stats.todayEventsCount} TODAY
                </Badge>
              )}
            </h4>
            <div className="space-y-2">
              {stats.upcomingDeadlines.slice(0, 5).map((deadline) => (
                <div
                  key={deadline.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg cursor-pointer transition-all gap-2 bg-white border border-gray-200 hover:border-brand-primary"
                  onClick={() => onNavigate('event-requests')}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Calendar className="w-5 h-5 text-brand-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{deadline.organizationName}</div>
                      <div className="text-sm text-gray-500">
                        {deadline.isToday ? 'Today' : 'Tomorrow'} - {formatDate(deadline.eventDate)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pl-8 sm:pl-0">
                    {deadline.needsDriver && (
                      <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 text-xs">
                        <Car className="w-3 h-3 mr-1" />
                        Driver
                      </Badge>
                    )}
                    {deadline.needsVolunteer && (
                      <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-xs">
                        <Users className="w-3 h-3 mr-1" />
                        Volunteer
                      </Badge>
                    )}
                    <ArrowRight className="w-4 h-4 text-gray-400 hidden sm:block" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => onNavigate('event-requests')}
            className="bg-brand-primary hover:bg-brand-primary-dark"
          >
            <Calendar className="w-4 h-4 mr-2" />
            View All Events
          </Button>
          <Button
            variant="outline"
            onClick={() => onNavigate('drivers')}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white"
          >
            <Car className="w-4 h-4 mr-2" />
            Assign Drivers
          </Button>
          {canViewVolunteerHub && (
            <Button
              variant="outline"
              onClick={() => onNavigate('volunteer-hub')}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white"
            >
              <Users className="w-4 h-4 mr-2" />
              Volunteer Hub
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onNavigate('collections')}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white"
          >
            Log Collection Data
          </Button>
        </div>
      </div>
    </div>
  );
}
