import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { User, Calendar, ArrowUpDown, ChevronDown, ChevronRight, ExternalLink, MapPin, ArrowUp, ArrowDown } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { useQuery } from '@tanstack/react-query';
import { formatDateShort } from '@/lib/date-utils';
import { LastContactAgeBadge } from '@/components/event-requests/LastContactAgeBadge';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { ActivityFeed } from '@/components/activity-feed';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface TspContactStats {
  userId: string;
  name: string;
  totalAssigned: number;
  byStatus: {
    new: number;
    in_process: number;
    scheduled: number;
    completed: number;
    declined: number;
  };
  events: EventRequest[];
}

interface AdminOverviewTabProps {
  eventRequests: EventRequest[];
}

export function AdminOverviewTab({ eventRequests }: AdminOverviewTabProps) {
  const { setActiveTab } = useEventRequestContext();
  const {
    setSelectedEventRequest,
    openDialog,
  } = useEventDialogState();
  const [sortBy, setSortBy] = useState<'name' | 'total' | 'new' | 'in_process'>('total');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'in_process' | 'scheduled'>('all');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [eventSortBy, setEventSortBy] = useState<'status' | 'date' | 'organization'>('date');
  const [eventSortDirection, setEventSortDirection] = useState<'asc' | 'desc'>('asc');

  // Fetch users to get proper names
  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  // Debug logging
  React.useEffect(() => {
    if (usersError) {
      console.error('Failed to fetch users for admin overview:', usersError);
    }
    if (!usersLoading && users.length === 0) {
      console.warn('Users array is empty in admin overview');
    }
  }, [users, usersLoading, usersError]);

  const handleSort = (field: 'name' | 'total' | 'new' | 'in_process') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  const handleViewEvent = (event: EventRequest) => {
    setSelectedEventRequest(event);
    setActiveTab(event.status || 'new');
    openDialog('eventDetails');
  };

  const tspContactStats = useMemo(() => {
    const statsMap = new Map<string, TspContactStats>();

    // Filter out completed/declined events by default unless includeCompleted is true
    let baseFilteredRequests = eventRequests;
    if (!includeCompleted) {
      baseFilteredRequests = eventRequests.filter(e => {
        const status = e.status?.toLowerCase();
        return status !== 'completed' && status !== 'declined' && status !== 'cancelled' && status !== 'contact_completed';
      });
    }

    // Apply status filter
    const filteredRequests = statusFilter === 'all'
      ? baseFilteredRequests
      : baseFilteredRequests.filter(e => e.status?.toLowerCase() === statusFilter);

    filteredRequests.forEach((event) => {
      const contactId = event.tspContact || event.customTspContact;
      if (!contactId) return;

      if (!statsMap.has(contactId)) {
        // Find the user name from users array
        const user = users.find(u => u.id === contactId);
        let userName = contactId; // Default to user ID if no match found

        if (user) {
          // Try to construct a proper name
          const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
          if (fullName) {
            userName = fullName;
          } else if (user.email) {
            userName = user.email;
          } else if (user.name) {
            userName = user.name;
          }
        }

        statsMap.set(contactId, {
          userId: contactId,
          name: userName,
          totalAssigned: 0,
          byStatus: {
            new: 0,
            in_process: 0,
            scheduled: 0,
            completed: 0,
            declined: 0,
          },
          events: [],
        });
      }

      const stats = statsMap.get(contactId)!;
      stats.totalAssigned++;

      // Count by status
      const status = event.status?.toLowerCase() || 'new';
      if (status in stats.byStatus) {
        stats.byStatus[status as keyof typeof stats.byStatus]++;
      }

      stats.events.push(event);
    });

    // Convert to array and apply sorting
    const sortedStats = Array.from(statsMap.values()).sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'total':
          comparison = a.totalAssigned - b.totalAssigned;
          break;
        case 'new':
          comparison = a.byStatus.new - b.byStatus.new;
          break;
        case 'in_process':
          comparison = a.byStatus.in_process - b.byStatus.in_process;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sortedStats;
  }, [eventRequests, sortBy, sortDirection, statusFilter, includeCompleted, users]);

  // Calculate totals based on filtered events (excluding completed by default)
  const activeEvents = includeCompleted
    ? eventRequests
    : eventRequests.filter(e => {
        const status = e.status?.toLowerCase();
        return status !== 'completed' && status !== 'declined' && status !== 'cancelled' && status !== 'contact_completed';
      });

  // Count events by status
  const newCount = eventRequests.filter(e => e.status?.toLowerCase() === 'new').length;
  const inProcessCount = eventRequests.filter(e => e.status?.toLowerCase() === 'in_process').length;
  const scheduledCount = eventRequests.filter(e => isScheduledOrRescheduled(e.status?.toLowerCase())).length;

  return (
    <div className="space-y-6">
      {/* Summary Stats and Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Stats Cards */}
        <div className="lg:col-span-2 grid grid-cols-1 xs:grid-cols-3 gap-3 sm:gap-4">
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">New</div>
            <div className="text-2xl font-bold text-blue-600">{newCount}</div>
            <div className="text-xs text-slate-500 mt-1">New requests</div>
          </div>
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">In Process</div>
            <div className="text-2xl font-bold text-yellow-600">{inProcessCount}</div>
            <div className="text-xs text-slate-500 mt-1">Being worked on</div>
          </div>
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">Scheduled</div>
            <div className="text-2xl font-bold text-tsp-teal">{scheduledCount}</div>
            <div className="text-xs text-slate-500 mt-1">Ready to go</div>
          </div>
        </div>
        
        {/* Activity Feed */}
        <div className="lg:col-span-1">
          <ActivityFeed limit={15} hours={48} maxHeight="200px" />
        </div>
      </div>

      {/* Filter and Sort Controls */}
      <div className="premium-card p-4 space-y-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex gap-2 items-center">
            <span className="text-sm font-medium text-slate-600">Status:</span>
            <div className="flex gap-1">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('new')}
              >
                New
              </Button>
              <Button
                variant={statusFilter === 'in_process' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('in_process')}
              >
                In Process
              </Button>
              <Button
                variant={statusFilter === 'scheduled' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('scheduled')}
              >
                Scheduled
              </Button>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCompleted}
                onChange={(e) => setIncludeCompleted(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-slate-600">Include completed/declined</span>
            </label>
          </div>
        </div>

        {/* Sort Controls */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm font-medium text-slate-600">Sort by:</span>
          <Button
            variant={sortBy === 'total' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('total')}
          >
            Total {sortBy === 'total' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'name' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('name')}
          >
            Name {sortBy === 'name' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'new' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('new')}
          >
            New {sortBy === 'new' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'in_process' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('in_process')}
          >
            In Process {sortBy === 'in_process' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
        </div>
      </div>

      {/* TSP Contact Stats */}
      <div className="space-y-3">
        {tspContactStats.length === 0 ? (
          <div className="text-center py-8 text-slate-500 premium-card">
            No TSP contact assignments found
          </div>
        ) : (
          <div className="space-y-2">
            {tspContactStats.map((stat) => {
              const isExpanded = expandedUserId === stat.userId;

              return (
                <div
                  key={stat.userId}
                  className="premium-card overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedUserId(isExpanded ? null : stat.userId)}
                    className="w-full p-4 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        )}
                        <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-brand-primary" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{stat.name}</div>
                          <div className="text-sm text-slate-500">
                            <Calendar className="w-3 h-3 inline mr-1" />
                            {stat.totalAssigned} {stat.totalAssigned === 1 ? 'event' : 'events'} assigned
                          </div>
                        </div>
                      </div>
                      <Badge className="bg-brand-primary text-white">
                        {stat.totalAssigned}
                      </Badge>
                    </div>

                    {/* Status Breakdown */}
                    <div className="flex flex-wrap gap-2 ml-13">
                      {stat.byStatus.new > 0 && (
                        <Badge variant="outline" className="text-xs border-[#47B3CB] bg-[#47B3CB]/10" style={{ color: '#236383' }}>
                          New: {stat.byStatus.new}
                        </Badge>
                      )}
                      {stat.byStatus.in_process > 0 && (
                        <Badge variant="outline" className="text-xs border-[#FBAD3F] bg-[#FBAD3F]/10" style={{ color: '#236383' }}>
                          In Process: {stat.byStatus.in_process}
                        </Badge>
                      )}
                      {stat.byStatus.scheduled > 0 && (
                        <Badge variant="outline" className="text-xs border-[#007E8C] bg-[#007E8C]/10" style={{ color: '#236383' }}>
                          Scheduled: {stat.byStatus.scheduled}
                        </Badge>
                      )}
                      {stat.byStatus.completed > 0 && (
                        <Badge variant="outline" className="text-xs border-[#007E8C] bg-[#007E8C]/20" style={{ color: '#236383' }}>
                          Completed: {stat.byStatus.completed}
                        </Badge>
                      )}
                      {stat.byStatus.declined > 0 && (
                        <Badge variant="outline" className="text-xs border-[#A31C41] bg-[#A31C41]/10" style={{ color: '#A31C41' }}>
                          Declined: {stat.byStatus.declined}
                        </Badge>
                      )}

                    </div>
                  </button>

                  {/* Expanded Event List */}
                  {isExpanded && (
                    <div className="border-t bg-slate-50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm text-slate-700">Assigned Events</h4>
                        <div className="flex gap-1">
                          <Button
                            variant={eventSortBy === 'status' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setEventSortBy('status')}
                            className="text-xs h-7"
                          >
                            Status
                          </Button>
                          <Button
                            variant={eventSortBy === 'date' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              if (eventSortBy === 'date') {
                                // Toggle direction if already sorting by date
                                setEventSortDirection(eventSortDirection === 'asc' ? 'desc' : 'asc');
                              } else {
                                // Set to date sort with ascending (most upcoming first) as default
                                setEventSortBy('date');
                                setEventSortDirection('asc');
                              }
                            }}
                            className="text-xs h-7 flex items-center gap-1"
                          >
                            Date
                            {eventSortBy === 'date' && (
                              eventSortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            )}
                          </Button>
                          <Button
                            variant={eventSortBy === 'organization' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setEventSortBy('organization')}
                            className="text-xs h-7"
                          >
                            Org
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {stat.events
                          .sort((a, b) => {
                            const dateA = a.scheduledEventDate ? new Date(a.scheduledEventDate).getTime() : a.desiredEventDate ? new Date(a.desiredEventDate).getTime() : 0;
                            const dateB = b.scheduledEventDate ? new Date(b.scheduledEventDate).getTime() : b.desiredEventDate ? new Date(b.desiredEventDate).getTime() : 0;

                            if (eventSortBy === 'status') {
                              // Sort by status first, then date (most upcoming first)
                              const statusOrder = { new: 0, in_process: 1, scheduled: 2, completed: 3, declined: 4, cancelled: 5, contact_completed: 6 };
                              const statusA = statusOrder[a.status?.toLowerCase() as keyof typeof statusOrder] ?? 99;
                              const statusB = statusOrder[b.status?.toLowerCase() as keyof typeof statusOrder] ?? 99;
                              if (statusA !== statusB) return statusA - statusB;
                              return dateA - dateB; // Most upcoming first
                            } else if (eventSortBy === 'date') {
                              // Sort by date direction (asc = upcoming first, desc = farthest first)
                              return eventSortDirection === 'asc' ? dateA - dateB : dateB - dateA;
                            } else {
                              return (a.organizationName || '').localeCompare(b.organizationName || '');
                            }
                          })
                          .map((event) => {
                            const eventDate = getEffectiveEventDate(event);
                            return (
                            <div
                              key={event.id}
                              className={`rounded-lg p-3 border-l-4 border transition-colors ${
                                event.status === 'new'
                                  ? 'bg-[#E2F5F6] border-l-[#47B3CB] border-slate-200 hover:shadow-md'
                                  : event.status === 'in_process'
                                  ? 'bg-[#FFF4E5] border-l-[#FBAD3F] border-slate-200 hover:shadow-md'
                                  : event.status === 'scheduled'
                                  ? 'bg-[#E4EFF6] border-l-[#007E8C] border-slate-200 hover:shadow-md'
                                  : event.status === 'completed' || event.status === 'contact_completed'
                                  ? 'bg-[#E8F7FB] border-l-[#007E8C] border-slate-200 hover:shadow-md'
                                  : event.status === 'declined' || event.status === 'cancelled'
                                  ? 'bg-[#FAE7ED] border-l-[#A31C41] border-slate-200 hover:shadow-md'
                                  : 'bg-white border-l-slate-300 border-slate-200 hover:shadow-md'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  {eventDate && (
                                    <div className="flex items-center gap-1 font-semibold text-base mb-1" style={{ color: '#236383' }}>
                                      <Calendar className="w-4 h-4" />
                                      {formatDateShort(eventDate)}
                                    </div>
                                  )}
                                  <div className="font-medium text-base text-slate-900 truncate">
                                    {event.organizationName || 'Unnamed Organization'}
                                  </div>
                                  <div className="text-sm mt-1 space-y-1" style={{ color: '#236383' }}>
                                    {event.eventAddress && (
                                      <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.eventAddress)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 hover:underline"
                                        style={{ color: '#007E8C' }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MapPin className="w-4 h-4" />
                                        {event.eventAddress}
                                      </a>
                                    )}
                                    {event.estimatedSandwichCount && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-base">🥪</span> {event.estimatedSandwichCount} sandwiches
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <Badge
                                    variant="outline"
                                    className={`text-sm ${
                                      event.status === 'new'
                                        ? 'border-[#47B3CB] text-[#236383]'
                                        : event.status === 'in_process'
                                        ? 'border-[#FBAD3F] text-[#236383]'
                                        : event.status === 'scheduled'
                                        ? 'border-[#007E8C] text-[#236383]'
                                        : event.status === 'completed'
                                        ? 'border-[#007E8C] text-[#236383] bg-[#007E8C]/10'
                                        : event.status === 'declined' || event.status === 'cancelled'
                                        ? 'border-[#A31C41] text-[#A31C41]'
                                        : event.status === 'contact_completed'
                                        ? 'border-[#007E8C] text-[#236383] bg-[#007E8C]/5'
                                        : 'border-slate-300 text-slate-600'
                                    }`}
                                  >
                                    {event.status?.replace('_', ' ') || '(no status)'}
                                  </Badge>
                                  {/* Last-contact-age signal — only meaningful for active workflow states */}
                                  {(event.status === 'in_process' || event.status === 'new' || event.status === 'standby' || event.status === 'stalled') && (
                                    <LastContactAgeBadge request={event} />
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-sm h-auto p-0 font-medium hover:bg-transparent"
                                    style={{ color: '#007E8C' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleViewEvent(event);
                                    }}
                                  >
                                    View <ExternalLink className="w-3.5 h-3.5 ml-1" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
