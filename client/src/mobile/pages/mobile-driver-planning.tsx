import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Calendar,
  MapPin,
  Users,
  Phone,
  MessageSquare,
  Truck,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { PullToRefresh } from '../components/pull-to-refresh';
import { cn } from '@/lib/utils';
import { format, addWeeks, isWithinInterval, startOfToday, endOfDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

import { usePageSession } from '@/hooks/usePageSession';
/**
 * Parse a date string as a local date to avoid timezone shift issues.
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

interface EventForPlanning {
  id: number;
  organizationName?: string;
  title?: string;
  recipientName?: string;
  scheduledEventDate?: string;
  desiredEventDate?: string;
  eventStartTime?: string;
  eventEndTime?: string;
  pickupTime?: string;
  pickupTimeWindow?: string;
  eventAddress?: string;
  location?: string;
  address?: string;
  driversNeeded: number;
  tspContactAssigned?: string | null;
  tspContact?: string | null;
  customTspContact?: string | null;
  assignedRecipientIds?: string[] | null;
  assignedVanDriverId?: string | null;
  isDhlVan?: boolean | null;
  selfTransport?: boolean | null;
  assignedDriverIds?: Array<string | number>;
  estimatedSandwichCount?: number;
  status?: string;
  hostName?: string;
  hostPhone?: string;
  recipientPhone?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

interface Driver {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  area?: string;
  isActive?: boolean;
}

type DateFilter = 'today' | 'week' | '2weeks' | 'month';

/**
 * Mobile driver planning screen
 */
export function MobileDriverPlanning() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Driver Planning',
  });

  console.log('[MobileDriverPlanning] Component rendering');
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [dateFilter, setDateFilter] = useState<DateFilter>('week');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<EventForPlanning | null>(null);

  // Fetch events
  const { data: events = [], isLoading, refetch } = useQuery<EventForPlanning[]>({
    queryKey: ['/api/event-map'],
    staleTime: 60000,
  });

  // Fetch drivers
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
    staleTime: 300000,
  });

  // Fetch basic users to resolve assigned staff/driver user IDs to names
  const { data: usersBasic = [] } = useQuery<Array<{ id: string; displayName?: string; firstName?: string; lastName?: string; email?: string }>>({
    queryKey: ['/api/users/basic'],
    staleTime: 300000,
  });

  const usersById = new Map(usersBasic.map((u) => [
    u.id,
    (u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id || '').trim()
  ]));

  const extractCustomName = (id: string): string => {
    if (!id || typeof id !== 'string') return '';
    if (id.startsWith('custom-')) {
      const parts = id.split('-');
      if (parts.length >= 3) return parts.slice(2).join('-').replace(/-/g, ' ').trim() || 'Custom Volunteer';
      return 'Custom Volunteer';
    }
    if (id.startsWith('custom:')) return id.replace('custom:', '').trim();
    return '';
  };

  const resolvePersonName = (id: string): string => {
    const custom = extractCustomName(id);
    if (custom) return custom;
    return usersById.get(id) || id;
  };

  const getAssignedStaffLabel = (event: EventForPlanning): string | null => {
    const parts = [event.tspContactAssigned, event.tspContact, event.customTspContact]
      .map((v) => (v || '').trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    return Array.from(new Set(parts.map(resolvePersonName))).join(' • ');
  };

  // Helper to get event date
  const getEventDate = (event: EventForPlanning): Date | null => {
    const dateStr = getEffectiveEventDate(event);
    if (!dateStr) return null;
    return parseLocalDate(dateStr);
  };

  // Helper to calculate total drivers assigned (including van drivers)
  // Van driver and DHL van both count toward the total driver requirement
  const getTotalDriversAssigned = (event: EventForPlanning): number => {
    return (event.assignedDriverIds?.length || 0) +
           (event.assignedVanDriverId ? 1 : 0) +
           (event.isDhlVan ? 1 : 0);
  };

  // Helper to check if event needs drivers
  const eventNeedsDrivers = (event: EventForPlanning): boolean => {
    if (event.selfTransport) return false;
    const needed = event.driversNeeded || 0;
    if (needed === 0) return false;
    return getTotalDriversAssigned(event) < needed;
  };

  // Filter events
  const today = startOfToday();
  const filteredEvents = events
    .filter((event) => {
      const eventDate = getEventDate(event);
      if (!eventDate) return false;

      // Date filter - use endOfDay for proper boundary comparison
      const endDate = dateFilter === 'today' ? endOfDay(today)
        : dateFilter === 'week' ? endOfDay(addWeeks(today, 1))
        : dateFilter === '2weeks' ? endOfDay(addWeeks(today, 2))
        : endOfDay(addWeeks(today, 4));

      if (!isWithinInterval(eventDate, { start: today, end: endDate })) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          event.organizationName?.toLowerCase().includes(query) ||
          event.title?.toLowerCase().includes(query) ||
          event.recipientName?.toLowerCase().includes(query) ||
          event.eventAddress?.toLowerCase().includes(query) ||
          event.hostName?.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by date, then by needs drivers
      const aDate = getEventDate(a);
      const bDate = getEventDate(b);
      const dateCompare = (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
      if (dateCompare !== 0) return dateCompare;
      // Use helper that properly counts van drivers
      const aNeedsDrivers = eventNeedsDrivers(a);
      const bNeedsDrivers = eventNeedsDrivers(b);
      if (aNeedsDrivers && !bNeedsDrivers) return -1;
      if (!aNeedsDrivers && bNeedsDrivers) return 1;
      return 0;
    });

  // Get driver info by ID
  const getDriver = (id: number) => drivers.find((d) => d.id === id);

  const resolveAssignedDriverLabel = (rawId: string | number): string => {
    const idStr = String(rawId).trim();
    if (!idStr) return '';

    const custom = extractCustomName(idStr);
    if (custom) return custom;

    const userName = usersById.get(idStr);
    if (userName) return userName;

    // Allow formats like "driver-12"
    const numericTail = idStr.includes('-') ? idStr.split('-').pop() : idStr;
    if (numericTail && /^\d+$/.test(numericTail)) {
      const driver = getDriver(Number(numericTail));
      if (driver?.name) return driver.name;
    }

    return idStr;
  };

  // Copy SMS message to clipboard
  const copySMSMessage = (event: EventForPlanning, driver?: Driver) => {
    const driverName = driver ? driver.name.split(' ')[0] : '[Driver]';
    const eventDate = getEventDate(event);
    const dateStr = eventDate ? format(eventDate, 'EEEE, MMM d') : 'TBD';
    const message = `Hi ${driverName}! Can you help with a delivery on ${dateStr}? Pickup: ${event.hostName || 'TBD'} at ${event.pickupTime || 'TBD'}. Delivery to: ${event.organizationName || event.recipientName || event.title || 'TBD'}. Let me know!`;

    navigator.clipboard.writeText(message)
      .then(() => {
        toast({ title: 'Message copied to clipboard' });
      })
      .catch(() => {
        toast({ title: 'Failed to copy message', variant: 'destructive' });
      });
  };

  // Open phone dialer
  const callPhone = (phone: string) => {
    window.location.href = `tel:${phone}`;
  };

  // Open SMS app
  const sendSMS = (phone: string, message?: string) => {
    const smsUrl = message
      ? `sms:${phone}?body=${encodeURIComponent(message)}`
      : `sms:${phone}`;
    window.location.href = smsUrl;
  };

  // Use helper that properly counts van drivers toward driver requirement
  const needsDriversCount = filteredEvents.filter(eventNeedsDrivers).length;

  return (
    <MobileShell title="Driver Planning" showBack showNav>
      <div className="flex flex-col h-full">
        {/* Header stats */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {filteredEvents.length}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Events</p>
            </div>
            {needsDriversCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {needsDriversCount} need drivers
                </span>
              </div>
            )}
          </div>

          {/* Date filter */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: '2weeks', label: '2 Weeks' },
              { id: 'month', label: 'Month' },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setDateFilter(filter.id as DateFilter)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap",
                  "transition-colors",
                  dateFilter === filter.id
                    ? "bg-brand-primary text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full pl-10 pr-4 py-3 rounded-xl",
                "bg-white dark:bg-slate-800",
                "border border-slate-200 dark:border-slate-700",
                "text-slate-900 dark:text-slate-100",
                "placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              )}
            />
          </div>
        </div>

        {/* Events list */}
        <PullToRefresh onRefresh={async () => { await refetch(); }} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-2" />
                  <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              ))
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-12">
                <Truck className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-500 dark:text-slate-400">No events found</p>
              </div>
            ) : (
              filteredEvents.map((event) => {
                // Use helpers that properly count van drivers toward total
                const totalAssigned = getTotalDriversAssigned(event);
                const needed = event.driversNeeded || 0;
                const needsDrivers = eventNeedsDrivers(event);
                const isFull = totalAssigned >= needed && needed > 0;
                const driversShort = Math.max(0, needed - totalAssigned);

                return (
                  <div
                    key={event.id}
                    className={cn(
                      "bg-white dark:bg-slate-800 rounded-xl shadow-sm",
                      "border",
                      event.selfTransport
                        ? "border-slate-200 dark:border-slate-700"
                        : needsDrivers
                        ? "border-amber-300 dark:border-amber-700"
                        : isFull
                        ? "border-green-300 dark:border-green-700"
                        : "border-slate-200 dark:border-slate-700"
                    )}
                  >
                    <button
                      onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                      className="w-full p-4 text-left"
                    >
                      {/* Date badge */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {getEventDate(event) ? format(getEventDate(event)!, 'EEE, MMM d') : 'No date'}
                          {event.eventStartTime && ` at ${event.eventStartTime}`}
                        </span>
                        {event.selfTransport ? (
                          <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full font-medium">
                            Self-transport
                          </span>
                        ) : needsDrivers ? (
                          <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                            Needs {driversShort} driver{driversShort > 1 ? 's' : ''}
                          </span>
                        ) : isFull ? (
                          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Full
                          </span>
                        ) : null}
                      </div>

                      {/* Event name */}
                      <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-1">
                        {event.organizationName || event.recipientName || event.title || 'Untitled Event'}
                      </h3>

                      {/* Location */}
                      {(event.eventAddress || event.location || event.address) && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1 mb-2">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{event.eventAddress || event.location || event.address}</span>
                        </p>
                      )}

                      {/* Driver count */}
                      <div className="flex items-center gap-2 text-sm">
                        <Users className={cn(
                          "w-4 h-4",
                          needsDrivers ? "text-amber-500" : "text-slate-400"
                        )} />
                        <span className={cn(
                          needsDrivers ? "text-amber-600 dark:text-amber-400 font-medium" : "text-slate-500 dark:text-slate-400"
                        )}>
                          {totalAssigned}/{needed} drivers
                          {event.isDhlVan
                            ? ' (incl. DHL)'
                            : event.assignedVanDriverId
                              ? ' (incl. van)'
                              : ''}
                        </span>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {selectedEvent?.id === event.id && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-700">
                        {/* Assigned staff */}
                        {getAssignedStaffLabel(event) && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">ASSIGNED STAFF</p>
                            <p className="text-sm text-slate-900 dark:text-slate-100">
                              {getAssignedStaffLabel(event)}
                            </p>
                          </div>
                        )}

                        {/* Designated recipient */}
                        {Array.isArray(event.assignedRecipientIds) && event.assignedRecipientIds.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">RECIPIENT</p>
                            <p className="text-sm text-slate-900 dark:text-slate-100">
                              {event.assignedRecipientIds.filter(Boolean).join(', ')}
                            </p>
                          </div>
                        )}

                        {/* Pickup info */}
                        {event.hostName && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">PICKUP</p>
                            <p className="text-sm text-slate-900 dark:text-slate-100">
                              {event.hostName}
                              {event.pickupTime && ` at ${event.pickupTime}`}
                            </p>
                            {event.hostPhone && (
                              <button
                                onClick={() => callPhone(event.hostPhone!)}
                                className="text-sm text-brand-primary flex items-center gap-1 mt-1"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                {event.hostPhone}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Assigned drivers */}
                        {(event.assignedDriverIds?.length || 0) > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">ASSIGNED</p>
                            <div className="space-y-1">
                              {event.assignedDriverIds?.map((driverId) => {
                                const label = resolveAssignedDriverLabel(driverId);
                                const numericTail = String(driverId).includes('-') ? String(driverId).split('-').pop() : String(driverId);
                                const driver = numericTail && /^\d+$/.test(numericTail) ? getDriver(Number(numericTail)) : undefined;
                                return (
                                  <div key={String(driverId)} className="flex items-center justify-between">
                                    <span className="text-sm text-slate-900 dark:text-slate-100">
                                      {label}
                                    </span>
                                    {driver?.phone && (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => callPhone(driver.phone!)}
                                          className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-700"
                                        >
                                          <Phone className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                                        </button>
                                        <button
                                          onClick={() => sendSMS(driver.phone!)}
                                          className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-700"
                                        >
                                          <MessageSquare className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Quick actions */}
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => copySMSMessage(event)}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg",
                              "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
                              "text-sm font-medium"
                            )}
                          >
                            <Copy className="w-4 h-4" />
                            Copy SMS
                          </button>
                          <button
                            onClick={() => navigate(`/driver-planning?event=${event.id}`)}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg",
                              "bg-brand-primary text-white",
                              "text-sm font-medium"
                            )}
                          >
                            <ExternalLink className="w-4 h-4" />
                            Full View
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </PullToRefresh>
      </div>
    </MobileShell>
  );
}

export default MobileDriverPlanning;
