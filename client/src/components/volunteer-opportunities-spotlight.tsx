import { useQuery } from '@tanstack/react-query';
import { Users, Calendar, MapPin, ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateShort } from '@/lib/date-utils';
import { getVolunteerCount, getTotalDriverCount } from '@/lib/assignment-utils';
import type { EventRequest } from '@shared/schema';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';
import { parseDateOnly, getTodayString } from '@shared/date-utils';
import { EVENT_REQUEST_LIST_FRESHNESS } from '@/components/event-requests/lib/eventRequestsListQuery';

// Whole-day difference between an event's date and today, parsing the
// date-only value as a local date (parseDateOnly) so YYYY-MM-DD isn't shifted
// to the previous day by UTC-midnight interpretation in Eastern time.
const daysUntil = (request: EventRequest): number => {
  const date = getEffectiveEventDate(request);
  const parsed = date ? parseDateOnly(date) : null;
  if (!parsed) return Infinity;
  // Anchor "today" on the same local-noon basis as the event date (parseDateOnly
  // returns noon, and getTodayString gives today's date in Eastern Time) so both
  // timestamps share a noon reference. Otherwise a midnight "today" leaves a
  // half-day offset that rounds same-day events up to 1 and skews the urgency
  // thresholds.
  const today = parseDateOnly(getTodayString());
  if (!today) return Infinity;
  return Math.round((parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

interface VolunteerOpportunitiesSpotlightProps {
  onNavigate: (section: string) => void;
}

interface UnfilledNeeds {
  needsVolunteer: boolean;
  needsDriver: boolean;
  volunteersNeeded: number;
  driversNeeded: number;
}

const getUnfilledNeeds = (request: EventRequest): UnfilledNeeds => {
  const volunteersNeededCount = request.volunteersNeeded ?? 0;
  const volunteersAssignedCount = getVolunteerCount(request);
  const needsVolunteer = volunteersNeededCount > volunteersAssignedCount;
  const volunteersNeeded = Math.max(0, volunteersNeededCount - volunteersAssignedCount);

  const driversNeededCount = request.driversNeeded ?? 0;
  const driversAssignedCount = getTotalDriverCount(request);
  const needsDriver = driversNeededCount > driversAssignedCount;
  const driversNeeded = Math.max(0, driversNeededCount - driversAssignedCount);

  return { needsVolunteer, needsDriver, volunteersNeeded, driversNeeded };
};

// Color-code each opportunity by how soon it is, so understaffed events that
// are nearly here read as urgent at a glance: Red = within 3 days (critical),
// Amber = within a week (needs help soon), teal = further out.
type Urgency = { level: 'critical' | 'soon' | 'upcoming'; label: string; badgeClass: string; borderClass: string };

const getUrgency = (request: EventRequest): Urgency => {
  const days = daysUntil(request);
  if (days <= 3) {
    return { level: 'critical', label: 'Critical', badgeClass: 'bg-red-100 text-red-800', borderClass: 'border-l-red-500' };
  }
  if (days <= 7) {
    return { level: 'soon', label: 'Needs help soon', badgeClass: 'bg-amber-100 text-amber-800', borderClass: 'border-l-amber-500' };
  }
  return { level: 'upcoming', label: 'Upcoming', badgeClass: 'bg-[#236383]/10 text-[#236383]', borderClass: 'border-l-[#236383]' };
};

export function VolunteerOpportunitiesSpotlight({ onNavigate }: VolunteerOpportunitiesSpotlightProps) {
  // Only scheduled/rescheduled rows — never the full event-requests table.
  // The unfiltered `/api/event-requests` payload is large enough to leave this
  // widget stuck on its skeleton while the dashboard's other sections render.
  const { data: eventRequests = [], isLoading, isError, refetch } = useQuery<EventRequest[]>({
    queryKey: ['/api/event-requests/list', { status: 'scheduled,rescheduled' }, 'volunteer-spotlight'],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        '/api/event-requests/list?status=scheduled,rescheduled',
        { credentials: 'include', signal },
      );
      if (!response.ok) {
        throw new Error('Failed to fetch volunteer opportunities');
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60 * 1000,
    ...EVENT_REQUEST_LIST_FRESHNESS,
  });

  const understaffedUpcoming = (Array.isArray(eventRequests) ? eventRequests : [])
    .filter((request) => isScheduledOrRescheduled(request.status))
    .filter((request) => daysUntil(request) >= 0)
    .filter((request) => {
      const { needsVolunteer, needsDriver } = getUnfilledNeeds(request);
      return needsVolunteer || needsDriver;
    })
    .sort((a, b) => {
      const dateA = getEffectiveEventDate(a);
      const dateB = getEffectiveEventDate(b);
      const timeA = dateA ? (parseDateOnly(dateA)?.getTime() ?? Infinity) : Infinity;
      const timeB = dateB ? (parseDateOnly(dateB)?.getTime() ?? Infinity) : Infinity;
      return timeA - timeB;
    });

  const opportunities = understaffedUpcoming.slice(0, 3);

  const formatEventDate = (request: EventRequest) => {
    const date = getEffectiveEventDate(request);
    return formatDateShort(date);
  };

  if (isLoading) {
    return (
      <div className="premium-card-elevated p-6 mx-4 mb-8 animate-pulse" style={{ borderTop: '4px solid #236383' }}>
        <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
        <div className="space-y-3">
          <div className="h-20 bg-gray-100 rounded"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="premium-card-elevated p-6 mx-4 mb-8" style={{ borderTop: '4px solid #236383' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="premium-text-h4 text-[#236383]">Volunteer Opportunities</h3>
            <p className="premium-text-body-sm text-gray-600 mt-1">
              Couldn't load volunteer needs right now.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="premium-btn-outline text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="premium-card-elevated p-6 mx-4 mb-8" style={{ borderTop: '4px solid #236383' }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <Users className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h3 className="premium-text-h4 text-[#236383]">Volunteer Opportunities</h3>
            <p className="premium-text-body-sm text-gray-600">
              🎉 Every upcoming event is fully staffed — nothing needs volunteers right now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="premium-card-elevated p-6 mx-4 mb-8" style={{ borderTop: '4px solid #236383' }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#236383] rounded-lg flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="premium-text-h3 text-[#236383] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#FBAD3F]" />
              Volunteer Opportunities
            </h3>
            <p className="premium-text-body-sm text-gray-600">
              Upcoming events that need your help
            </p>
          </div>
        </div>
        <button
          onClick={() => onNavigate('event-requests')}
          className="premium-btn-outline text-sm hidden sm:flex"
          data-testid="button-view-all-opportunities"
        >
          View All
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      </div>

      <div className="space-y-3">
        {opportunities.map((event) => {
          const needs = getUnfilledNeeds(event);
          const urgency = getUrgency(event);
          return (
            <Card
              key={event.id}
              className={`hover:shadow-md transition-shadow cursor-pointer border-l-4 ${urgency.borderClass}`}
              onClick={() => onNavigate('event-requests')}
              data-testid={`opportunity-card-${event.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-[#236383] truncate">
                        {event.organizationName}
                      </h4>
                      {urgency.level !== 'upcoming' && (
                        <Badge className={`${urgency.badgeClass} flex-shrink-0`}>
                          {urgency.label}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 mt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {formatEventDate(event)}
                      </span>
                      {event.address && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{event.address.split(',')[0]}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {needs.needsVolunteer && (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                        {needs.volunteersNeeded} {needs.volunteersNeeded === 1 ? 'Volunteer' : 'Volunteers'} Needed
                      </Badge>
                    )}
                    {needs.needsDriver && (
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200">
                        {needs.driversNeeded} {needs.driversNeeded === 1 ? 'Driver' : 'Drivers'} Needed
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {opportunities.length < understaffedUpcoming.length
            ? `Showing ${opportunities.length} of ${understaffedUpcoming.length} opportunities`
            : `${opportunities.length} upcoming opportunit${opportunities.length !== 1 ? 'ies' : 'y'}`}
        </p>
        <button
          onClick={() => onNavigate('event-requests')}
          className="premium-btn-primary text-sm sm:hidden"
          data-testid="button-view-all-opportunities-mobile"
        >
          View All Opportunities
        </button>
      </div>
    </div>
  );
}
