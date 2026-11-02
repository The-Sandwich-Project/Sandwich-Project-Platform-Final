import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Package,
  ChevronLeft,
  ChevronRight,
  Calendar,
  MapPin,
  Building2,
  Truck,
} from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { format, addWeeks, startOfWeek, endOfWeek, addDays, isWithinInterval, isBefore, isAfter } from 'date-fns';
import { useEventQueries } from '../hooks/useEventQueries';
import { parsePostgresArray } from '../utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface SandwichDestinationOverviewProps {
  eventRequests: EventRequest[];
}

type TimeRange = '1week' | '2weeks' | '3weeks' | '1month' | 'all';

interface RecipientAllocation {
  recipientId: string;
  recipientName: string;
  sandwichCount: number;
  sandwichType?: string;
  notes?: string;
}

interface RecipientGroup {
  recipientId: string;
  recipientName: string;
  totalSandwiches: number;
  events: Array<{
    id: number;
    organizationName: string;
    eventDate: string;
    sandwichCount: number;
    sandwichType?: string;
    status: string;
    eventAddress?: string;
  }>;
}

// Parse date string as local date (avoid timezone shifts)
const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day);
};

export function SandwichDestinationOverview({ eventRequests }: SandwichDestinationOverviewProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('1week');

  const { recipients, hostContacts } = useEventQueries();

  const resolveRecipientName = (id: string): string => {
    // custom-timestamp-Name or custom:Name
    if (id.startsWith('custom-') || id.startsWith('custom:')) {
      const parts = id.split('-');
      if (parts.length >= 3) return parts.slice(2).join('-');
      if (id.includes(':')) return id.split(':')[1];
      return id.replace('custom-', '').replace('custom:', '');
    }
    // typed IDs like "recipient:123" or "host:123"
    if (id.includes(':')) {
      const [type, ...rest] = id.split(':');
      const numId = Number(rest.join(':'));
      if (!isNaN(numId)) {
        if (type === 'recipient') {
          const r = recipients.find((r: any) => r.id === numId);
          if (r) return r.name;
        } else if (type === 'host') {
          const hc = hostContacts.find((h: any) => h.id === numId);
          if (hc) return hc.displayName || hc.name || hc.hostLocationName || `Host ${numId}`;
        }
      }
    }
    // plain numeric ID
    if (!isNaN(Number(id))) {
      const numId = Number(id);
      const r = recipients.find((r: any) => r.id === numId);
      if (r) return r.name;
      const hc = hostContacts.find((h: any) => h.id === numId);
      if (hc) return hc.displayName || hc.name || hc.hostLocationName || `ID ${numId}`;
    }
    return id;
  };

  // Compute the date window
  const { windowStart, windowEnd, windowLabel } = useMemo(() => {
    const today = new Date();
    const baseStart = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 }); // Monday

    let start: Date;
    let end: Date;
    let label: string;

    switch (timeRange) {
      case '1week':
        start = baseStart;
        end = endOfWeek(baseStart, { weekStartsOn: 1 }); // Sunday
        label = `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
        break;
      case '2weeks':
        start = baseStart;
        end = endOfWeek(addWeeks(baseStart, 1), { weekStartsOn: 1 });
        label = `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
        break;
      case '3weeks':
        start = baseStart;
        end = endOfWeek(addWeeks(baseStart, 2), { weekStartsOn: 1 });
        label = `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
        break;
      case '1month':
        start = baseStart;
        end = addDays(baseStart, 29); // ~30 days
        label = `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
        break;
      case 'all':
        start = new Date(0); // epoch
        end = new Date(9999, 11, 31);
        label = 'All Planned Events';
        break;
      default:
        start = baseStart;
        end = endOfWeek(baseStart, { weekStartsOn: 1 });
        label = `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
    }

    return { windowStart: start, windowEnd: end, windowLabel: label };
  }, [weekOffset, timeRange]);

  // Filter events to the active window and relevant statuses
  const eventsInWindow = useMemo(() => {
    return eventRequests.filter((event) => {
      // Only include scheduled or in_process events
      if (!['scheduled', 'in_process'].includes(event.status || '')) return false;

      const dateStr = getEffectiveEventDate(event);
      if (!dateStr) return false;

      const eventDate = parseLocalDate(dateStr as string);

      if (timeRange === 'all') {
        // For "all", show future events only
        return !isBefore(eventDate, startOfWeek(new Date(), { weekStartsOn: 1 }));
      }

      return isWithinInterval(eventDate, { start: windowStart, end: windowEnd });
    });
  }, [eventRequests, windowStart, windowEnd, timeRange]);

  // Group events by recipient
  const recipientGroups = useMemo(() => {
    const groups = new Map<string, RecipientGroup>();
    let unallocatedEvents: Array<{
      id: number;
      organizationName: string;
      eventDate: string;
      sandwichCount: number;
      status: string;
      eventAddress?: string;
    }> = [];

    for (const event of eventsInWindow) {
      const dateStr = (getEffectiveEventDate(event)) as string;
      const eventDate = format(parseLocalDate(dateStr), 'EEE, MMM d');
      const sandwichCount = event.estimatedSandwichCount || 0;
      const allocations = (event.recipientAllocations as RecipientAllocation[] | null) || [];

      // Fall back to assignedRecipientIds when no explicit allocations are set
      const effectiveAllocations: RecipientAllocation[] = allocations.length > 0
        ? allocations
        : parsePostgresArray(event.assignedRecipientIds).map((id) => ({
            recipientId: id,
            recipientName: resolveRecipientName(id),
            sandwichCount: 0,
          }));

      if (effectiveAllocations.length > 0) {
        // Event has recipient allocations — add each allocation to its group
        for (const alloc of effectiveAllocations) {
          const key = alloc.recipientId || alloc.recipientName;
          if (!groups.has(key)) {
            groups.set(key, {
              recipientId: alloc.recipientId,
              recipientName: alloc.recipientName || 'Unknown Recipient',
              totalSandwiches: 0,
              events: [],
            });
          }
          const group = groups.get(key)!;
          group.totalSandwiches += alloc.sandwichCount || 0;
          group.events.push({
            id: event.id,
            organizationName: event.organizationName || 'Unknown',
            eventDate,
            sandwichCount: alloc.sandwichCount || 0,
            sandwichType: alloc.sandwichType,
            status: event.status || '',
            eventAddress: event.eventAddress || undefined,
          });
        }
      } else if (sandwichCount > 0) {
        // Event has sandwiches but no recipient allocation yet
        unallocatedEvents.push({
          id: event.id,
          organizationName: event.organizationName || 'Unknown',
          eventDate,
          sandwichCount,
          status: event.status || '',
          eventAddress: event.eventAddress || undefined,
        });
      }
    }

    // Sort groups by total sandwiches descending
    const sortedGroups = Array.from(groups.values()).sort(
      (a, b) => b.totalSandwiches - a.totalSandwiches
    );

    // Sort events within each group by date
    for (const group of sortedGroups) {
      group.events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    }

    return { recipientGroups: sortedGroups, unallocatedEvents };
  }, [eventsInWindow, recipients, hostContacts]);

  // Compute totals
  const totalSandwiches = useMemo(() => {
    return (
      recipientGroups.recipientGroups.reduce((sum, g) => sum + g.totalSandwiches, 0) +
      recipientGroups.unallocatedEvents.reduce((sum, e) => sum + e.sandwichCount, 0)
    );
  }, [recipientGroups]);

  const totalEvents = eventsInWindow.length;

  const handleWeekStep = (delta: number) => {
    const step = timeRange === '2weeks' ? 2 : timeRange === '3weeks' ? 3 : timeRange === '1month' ? 4 : 1;
    setWeekOffset((prev) => prev + delta * step);
  };

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-brand-primary" />
            Sandwich Destination Overview
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Where sandwiches are going and how many per recipient
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time range selector */}
          <Select value={timeRange} onValueChange={(val: TimeRange) => {
            setTimeRange(val);
            setWeekOffset(0);
          }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1week">1 Week</SelectItem>
              <SelectItem value="2weeks">2 Weeks</SelectItem>
              <SelectItem value="3weeks">3 Weeks</SelectItem>
              <SelectItem value="1month">1 Month</SelectItem>
              <SelectItem value="all">All Planned</SelectItem>
            </SelectContent>
          </Select>

          {/* Week navigation */}
          {timeRange !== 'all' && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleWeekStep(-1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs px-2"
                onClick={() => setWeekOffset(0)}
              >
                This Week
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleWeekStep(1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Date range display + summary stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 bg-brand-primary/5 px-4 py-2 rounded-lg">
          <Calendar className="w-4 h-4 text-brand-primary" />
          <span className="font-semibold text-brand-primary">{windowLabel}</span>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <Package className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {totalSandwiches.toLocaleString()} sandwiches
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {totalEvents} event{totalEvents !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {recipientGroups.recipientGroups.length} recipient{recipientGroups.recipientGroups.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* No data state */}
      {totalEvents === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No scheduled events in this time period</p>
            <p className="text-sm text-gray-400 mt-1">
              Try selecting a different date range or advancing the week
            </p>
          </CardContent>
        </Card>
      )}

      {/* Recipient groups */}
      {recipientGroups.recipientGroups.map((group) => (
        <Card key={group.recipientId} className="border-l-4 border-l-brand-primary">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-brand-primary flex-shrink-0" />
                <div>
                  <CardTitle className="text-lg font-bold text-gray-900">
                    {group.recipientName}
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {group.events.length} event{group.events.length !== 1 ? 's' : ''} contributing
                  </p>
                </div>
              </div>
              <Badge className="bg-brand-primary text-white text-base px-3 py-1">
                {group.totalSandwiches.toLocaleString()} sandwiches
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {group.events.map((event, idx) => (
                <div
                  key={`${event.id}-${idx}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {event.eventDate}
                    </span>
                    <span className="text-sm text-gray-600 truncate">
                      {event.organizationName}
                    </span>
                    {event.sandwichType && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {event.sandwichType}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        isScheduledOrRescheduled(event.status)
                          ? 'border-tsp-sky text-tsp-teal bg-tsp-sky/15'
                          : 'border-amber-300 text-amber-700 bg-amber-50'
                      }`}
                    >
                      {event.status === 'in_process' ? 'In Process' : 'Scheduled'}
                    </Badge>
                    <span className="text-sm font-semibold text-gray-800 min-w-[60px] text-right">
                      {event.sandwichCount.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Unallocated events */}
      {recipientGroups.unallocatedEvents.length > 0 && (
        <Card className="border-l-4 border-l-amber-400">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <div>
                  <CardTitle className="text-lg font-bold text-gray-900">
                    No Recipient Assigned
                  </CardTitle>
                  <p className="text-sm text-amber-600 mt-0.5">
                    {recipientGroups.unallocatedEvents.length} event{recipientGroups.unallocatedEvents.length !== 1 ? 's' : ''} with sandwiches but no recipient allocated
                  </p>
                </div>
              </div>
              <Badge className="bg-amber-500 text-white text-base px-3 py-1">
                {recipientGroups.unallocatedEvents.reduce((s, e) => s + e.sandwichCount, 0).toLocaleString()} sandwiches
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {recipientGroups.unallocatedEvents.map((event, idx) => (
                <div
                  key={`unalloc-${event.id}-${idx}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50/50 hover:bg-amber-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {event.eventDate}
                    </span>
                    <span className="text-sm text-gray-600 truncate">
                      {event.organizationName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        isScheduledOrRescheduled(event.status)
                          ? 'border-tsp-sky text-tsp-teal bg-tsp-sky/15'
                          : 'border-amber-300 text-amber-700 bg-amber-50'
                      }`}
                    >
                      {event.status === 'in_process' ? 'In Process' : 'Scheduled'}
                    </Badge>
                    <span className="text-sm font-semibold text-gray-800 min-w-[60px] text-right">
                      {event.sandwichCount.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
