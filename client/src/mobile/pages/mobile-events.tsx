import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  ChevronRight,
  CalendarDays,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format, isToday, isTomorrow, isThisWeek } from 'date-fns';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

import { usePageSession } from '@/hooks/usePageSession';
/**
 * Parse a date string as a local date to avoid timezone shift issues.
 * Date-only strings (YYYY-MM-DD) are treated as local dates.
 * Timestamps are stripped of their time component to avoid timezone shifts.
 */
function parseLocalDate(dateString: string): Date {
  if (!dateString) return new Date();

  // Extract just the date part (YYYY-MM-DD) from any format
  // This handles both YYYY-MM-DD and YYYY-MM-DDTHH:MM:SS formats
  const datePart = dateString.split('T')[0];
  const [yearStr, monthStr, dayStr] = datePart.split('-');

  // Create date at local midnight (not UTC midnight) to avoid timezone shifts
  return new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
}

type EventFilter = 'all' | 'today' | 'week' | 'upcoming';

/**
 * Mobile events screen - view and manage events
 */
export function MobileEvents() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Events',
  });

  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<EventFilter>('today');

  // Fetch events
  const { data: events, isLoading } = useQuery({
    queryKey: ['/api/event-requests'],
    staleTime: 60000,
  });

  // Filter events based on selected filter
  const filteredEvents = events?.filter((event: any) => {
    // Use scheduledEventDate first, fall back to desiredEventDate
    const dateField = getEffectiveEventDate(event);
    if (!dateField) return filter === 'all';
    
    const eventDate = parseLocalDate(dateField);

    switch (filter) {
      case 'today':
        return isToday(eventDate);
      case 'week':
        return isThisWeek(eventDate);
      case 'upcoming':
        return eventDate >= new Date();
      default:
        return true;
    }
  }) || [];

  // Group events by date
  const groupedEvents = filteredEvents.reduce((acc: any, event: any) => {
    const dateField = getEffectiveEventDate(event);
    const dateKey = dateField
      ? format(parseLocalDate(dateField), 'yyyy-MM-dd')
      : 'no-date';
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {});

  return (
    <MobileShell title="Events" showNav>
      <div className="flex flex-col h-full">
        {/* Filter tabs */}
        <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 p-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'all', label: 'All' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as EventFilter)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap",
                  "transition-colors",
                  filter === f.id
                    ? "bg-brand-primary text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Events list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            // Loading skeleton
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-3" />
                <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
              </div>
            ))
          ) : Object.keys(groupedEvents).length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 dark:text-slate-400">
                No events {filter === 'today' ? 'today' : filter === 'week' ? 'this week' : 'found'}
              </p>
            </div>
          ) : (
            Object.entries(groupedEvents).map(([dateKey, dayEvents]: [string, any]) => (
              <div key={dateKey}>
                {/* Date header */}
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {formatDateHeader(dateKey)}
                  </span>
                </div>

                {/* Events for this date */}
                <div className="space-y-2">
                  {dayEvents.map((event: any) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onClick={() => navigate(`/events/${event.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </MobileShell>
  );
}

function EventCard({
  event,
  onClick,
}: {
  event: any;
  onClick: () => void;
}) {
  const needsDrivers = (event.driversNeeded || 0) > (event.driversAssigned || 0);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full bg-white dark:bg-slate-800 rounded-xl p-4",
        "border shadow-sm text-left relative",
        needsDrivers
          ? "border-amber-300 dark:border-amber-700"
          : "border-slate-200 dark:border-slate-700",
        "active:scale-[0.99] transition-transform"
      )}
    >
      {/* Event name */}
      <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-2">
        {event.organizationName || event.title || event.recipientName || 'Untitled Event'}
      </h3>

      {/* Details */}
      <div className="space-y-1.5 text-sm">
        {(event.eventAddress || event.location) && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <MapPin className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{event.eventAddress || event.location}</span>
          </div>
        )}

        {event.eventStartTime && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>{event.eventStartTime}{event.eventEndTime ? ` - ${event.eventEndTime}` : ''}</span>
          </div>
        )}

        {/* Driver status */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <span className={cn(
              "text-sm",
              needsDrivers
                ? "text-amber-600 dark:text-amber-400 font-medium"
                : "text-slate-500 dark:text-slate-400"
            )}>
              {event.driversAssigned || 0}/{event.driversNeeded || 0} drivers
            </span>
          </div>

          {needsDrivers && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full font-medium">
              Needs drivers
            </span>
          )}
        </div>
      </div>

      <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
    </button>
  );
}

function formatDateHeader(dateKey: string): string {
  if (dateKey === 'no-date') return 'Unscheduled';

  const date = parseLocalDate(dateKey);

  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';

  return format(date, 'EEEE, MMMM d');
}

export default MobileEvents;
