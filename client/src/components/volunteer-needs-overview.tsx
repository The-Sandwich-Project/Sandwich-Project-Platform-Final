import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Calendar,
  CalendarDays,
  Car,
  Users,
  Clock,
  HandHeart,
  List,
  Map as MapIcon,
  UserCheck,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { getTodayString, parseDateOnly } from '@shared/date-utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';

export type VolunteerHubView =
  | 'list'
  | 'calendar'
  | 'map'
  | 'my_signups'
  | 'pending_approvals'
  | 'coverage';

interface HubEventNeed {
  id: number;
  organizationName: string | null;
  scheduledEventDate: string | null;
  desiredEventDate: string | null;
  eventAddress: string | null;
  city: string | null;
  volunteersUnfilled: number;
  driversUnfilled: number;
  vanDriverNeeded: boolean;
  hasUnfilledNeeds: boolean;
}

interface VolunteerNeedsOverviewProps {
  onNavigate: (section: string) => void;
}

function formatEventDate(event: HubEventNeed): string {
  const dateString = getEffectiveEventDate(event);
  if (!dateString) return 'Date TBD';
  try {
    const date = parseDateOnly(dateString);
    return date && isValid(date) ? format(date, 'EEE, MMM d') : 'Date TBD';
  } catch {
    return 'Date TBD';
  }
}

function isThisWeek(dateString: string | null): boolean {
  if (!dateString) return false;
  const date = parseDateOnly(dateString);
  if (!date || !isValid(date)) return false;

  const today = parseDateOnly(getTodayString());
  if (!today || !isValid(today)) return false;

  const startOfWeek = new Date(today);
  const dayOfWeek = startOfWeek.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  return date >= startOfWeek && date <= endOfWeek;
}

export function navigateToVolunteerHub(onNavigate: (section: string) => void, view?: VolunteerHubView) {
  const url = view
    ? `/dashboard?section=volunteer-hub&view=${encodeURIComponent(view)}`
    : '/dashboard?section=volunteer-hub';
  try {
    window.history.pushState({}, '', url);
  } catch {
    // ignore unavailable history
  }
  onNavigate(view ? `volunteer-hub?view=${view}` : 'volunteer-hub');
}

/**
 * Dashboard Today widget for users who can open Volunteer Hub but not Event
 * Requests. Summarizes upcoming unfilled needs and deep-links only into hub
 * views — never the event-requests component.
 */
export default function VolunteerNeedsOverview({ onNavigate }: VolunteerNeedsOverviewProps) {
  const { user } = useAuth();
  const canApproveSignups = !!user && hasPermission(user, PERMISSIONS.VOLUNTEER_SIGNUP_APPROVE);

  const { data: events = [], isLoading, isError, refetch } = useQuery<HubEventNeed[]>({
    queryKey: ['/api/volunteer-hub/available-events', { needsOnly: true }, 'dashboard-overview'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/volunteer-hub/available-events?needsOnly=true', {
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error('Failed to load volunteer needs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const stats = useMemo(() => {
    const needingHelp = events.filter((event) => event.hasUnfilledNeeds);
    const volunteerSlots = needingHelp.reduce(
      (sum, event) => sum + Math.max(0, event.volunteersUnfilled || 0),
      0,
    );
    const driverSlots = needingHelp.reduce((sum, event) => {
      const drivers = Math.max(0, event.driversUnfilled || 0);
      return sum + drivers + (event.vanDriverNeeded ? 1 : 0);
    }, 0);
    const thisWeekCount = needingHelp.filter((event) =>
      isThisWeek(getEffectiveEventDate(event)),
    ).length;
    const upcoming = [...needingHelp]
      .sort((a, b) => {
        const dateA = getEffectiveEventDate(a);
        const dateB = getEffectiveEventDate(b);
        if (dateA && dateB) {
          const parsedA = parseDateOnly(dateA);
          const parsedB = parseDateOnly(dateB);
          if (parsedA && parsedB) return parsedA.getTime() - parsedB.getTime();
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return (a.organizationName || '').localeCompare(b.organizationName || '');
      })
      .slice(0, 5);

    return {
      eventsNeedingHelp: needingHelp.length,
      volunteerSlots,
      driverSlots,
      thisWeekCount,
      upcoming,
    };
  }, [events]);

  const goToHub = (view?: VolunteerHubView) => navigateToVolunteerHub(onNavigate, view);

  const hubViews: Array<{ id: VolunteerHubView; label: string; icon: typeof CalendarDays }> = [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'list', label: 'List', icon: List },
    { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'my_signups', label: 'My Signups', icon: UserCheck },
  ];
  if (canApproveSignups) {
    hubViews.push(
      { id: 'pending_approvals', label: 'Pending', icon: Clock },
      { id: 'coverage', label: 'Coverage', icon: Eye },
    );
  }

  if (isLoading) {
    return (
      <div className="mx-4 mb-8">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-4 mb-8">
        <div className="premium-card-elevated p-6" style={{ borderTop: '4px solid #236383' }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="premium-text-h4 text-brand-primary">Upcoming Volunteer Needs</h3>
              <p className="premium-text-body-sm text-gray-600 mt-1">
                Couldn&apos;t load volunteer opportunities right now.
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

  return (
    <div className="mx-4 mb-8">
      <div className="premium-card-elevated p-6" style={{ borderTop: '4px solid #236383' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-teal rounded-lg flex items-center justify-center">
              <HandHeart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="premium-text-h4 text-brand-primary">Upcoming Volunteer Needs</h3>
              <p className="premium-text-body-sm text-gray-600">
                Open spots on the Volunteer Hub
              </p>
            </div>
          </div>
          {stats.eventsNeedingHelp > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              {stats.eventsNeedingHelp} {stats.eventsNeedingHelp === 1 ? 'event' : 'events'} need help
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <button
            type="button"
            className="bg-white rounded-lg p-4 border border-gray-200 hover:border-brand-primary text-left transition-all"
            onClick={() => goToHub('calendar')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-brand-primary" />
              <span className="text-sm font-medium text-gray-600">This Week</span>
            </div>
            <div className="text-2xl font-bold text-brand-primary">{stats.thisWeekCount}</div>
            <div className="text-xs text-gray-500">events still needing people</div>
          </button>

          <button
            type="button"
            className={`bg-white rounded-lg p-4 border text-left transition-all ${
              stats.volunteerSlots > 0
                ? 'border-blue-300 hover:border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-brand-primary'
            }`}
            onClick={() => goToHub('list')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Users className={`w-5 h-5 ${stats.volunteerSlots > 0 ? 'text-blue-600' : 'text-brand-primary'}`} />
              <span className="text-sm font-medium text-gray-600">Volunteers Needed</span>
            </div>
            <div className={`text-2xl font-bold ${stats.volunteerSlots > 0 ? 'text-blue-700' : 'text-brand-primary'}`}>
              {stats.volunteerSlots}
            </div>
            <div className="text-xs text-gray-500">{stats.volunteerSlots === 1 ? 'open spot' : 'open spots'}</div>
          </button>

          <button
            type="button"
            className={`bg-white rounded-lg p-4 border text-left transition-all ${
              stats.driverSlots > 0
                ? 'border-orange-300 hover:border-orange-500 bg-orange-50'
                : 'border-gray-200 hover:border-brand-primary'
            }`}
            onClick={() => goToHub('list')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Car className={`w-5 h-5 ${stats.driverSlots > 0 ? 'text-orange-500' : 'text-brand-orange'}`} />
              <span className="text-sm font-medium text-gray-600">Drivers Needed</span>
            </div>
            <div className={`text-2xl font-bold ${stats.driverSlots > 0 ? 'text-orange-600' : 'text-brand-orange'}`}>
              {stats.driverSlots}
            </div>
            <div className="text-xs text-gray-500">{stats.driverSlots === 1 ? 'open spot' : 'open spots'}</div>
          </button>
        </div>

        {stats.upcoming.length > 0 ? (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Next openings
            </h4>
            <div className="space-y-2">
              {stats.upcoming.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="w-full flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-white border border-gray-200 hover:border-brand-primary transition-all gap-2 text-left"
                  onClick={() => goToHub('list')}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Calendar className="w-5 h-5 text-brand-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {event.organizationName || 'Upcoming event'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatEventDate(event)}
                        {event.city ? ` · ${event.city}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pl-8 sm:pl-0">
                    {event.volunteersUnfilled > 0 && (
                      <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-xs">
                        <Users className="w-3 h-3 mr-1" />
                        {event.volunteersUnfilled} volunteer{event.volunteersUnfilled === 1 ? '' : 's'}
                      </Badge>
                    )}
                    {(event.driversUnfilled > 0 || event.vanDriverNeeded) && (
                      <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 text-xs">
                        <Car className="w-3 h-3 mr-1" />
                        {event.driversUnfilled + (event.vanDriverNeeded ? 1 : 0)} driver
                        {event.driversUnfilled + (event.vanDriverNeeded ? 1 : 0) === 1 ? '' : 's'}
                      </Badge>
                    )}
                    <ArrowRight className="w-4 h-4 text-gray-400 hidden sm:block" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4">
            <p className="text-sm text-green-800 font-medium">
              Every upcoming hub event is fully staffed right now. You can still browse the
              Volunteer Hub if you want to add extra help.
            </p>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Open Volunteer Hub
          </p>
          <div className="flex flex-wrap gap-2">
            {hubViews.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="outline"
                onClick={() => goToHub(id)}
                className="border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white"
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
