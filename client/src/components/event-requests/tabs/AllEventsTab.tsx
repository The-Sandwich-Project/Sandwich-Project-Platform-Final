import React from 'react';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { MapPin, Calendar, UserCheck, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

/** Parse a date string as local time (not UTC) to avoid off-by-one day shift */
const parseLocalDate = (dateInput: string | Date): Date => {
  if (dateInput instanceof Date) return dateInput;
  // Extract YYYY-MM-DD part and construct at local midnight
  const datePart = dateInput.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  if (year && month && day) return new Date(year, month - 1, day);
  return new Date(dateInput); // fallback
};

const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return 'Date TBD';
  try {
    return format(parseLocalDate(date), 'EEE, MMM d, yyyy');
  } catch {
    return 'Date TBD';
  }
};

const statusLabels: Record<string, string> = {
  new: 'New',
  in_process: 'In Process',
  scheduled: 'Scheduled',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

const statusStyles: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  scheduled: 'bg-tsp-sky/15 text-tsp-teal border-tsp-sky',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  declined: 'bg-rose-50 text-rose-700 border-rose-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const AllEventsTab: React.FC = () => {
  const { paginatedRequests } = useEventFilters();
  const { resolveUserName } = useEventAssignments();
  const {
    statusFilter,
    setStatusFilter,
    sortBy,
    setSortBy,
    setCurrentPage,
  } = useEventRequestContext();
  const {
    setSelectedEventRequest,
    setIsEditing,
    openDialog,
  } = useEventDialogState();

  const openEvent = (request: EventRequest) => {
    setSelectedEventRequest(request);
    setIsEditing(false);
    openDialog('eventDetails');
  };

  // Handle status filter change and reset to page 1
  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  // Handle sort change and reset to page 1
  const handleSortChange = (value: string) => {
    setSortBy(value as any);
    setCurrentPage(1);
  };

  // Toggle between ascending and descending date sort
  const toggleDateSort = () => {
    if (sortBy === 'event_date_asc') {
      setSortBy('event_date_desc');
    } else {
      setSortBy('event_date_asc');
    }
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filter and Sort Controls */}
      <div className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 rounded-lg border">
        <div className="flex items-center gap-2 flex-1">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filter:</span>
          <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="w-[160px] h-9 bg-white">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  New
                </div>
              </SelectItem>
              <SelectItem value="in_process">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  In Process
                </div>
              </SelectItem>
              <SelectItem value="scheduled">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-tsp-sky" />
                  Scheduled
                </div>
              </SelectItem>
              <SelectItem value="completed">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                  Completed
                </div>
              </SelectItem>
              <SelectItem value="declined">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  Declined
                </div>
              </SelectItem>
              <SelectItem value="cancelled">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  Cancelled
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Sort:</span>
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[180px] h-9 bg-white">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              <SelectItem value="event_date_asc">Event Date (Earliest)</SelectItem>
              <SelectItem value="event_date_desc">Event Date (Latest)</SelectItem>
              <SelectItem value="created_date_desc">Submitted (Newest)</SelectItem>
              <SelectItem value="created_date_asc">Submitted (Oldest)</SelectItem>
              <SelectItem value="organization_asc">Organization A-Z</SelectItem>
              <SelectItem value="organization_desc">Organization Z-A</SelectItem>
            </SelectContent>
          </Select>

          {/* Quick toggle button for date sort direction */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2"
            onClick={toggleDateSort}
            title={sortBy === 'event_date_asc' ? 'Currently: Earliest first' : 'Currently: Latest first'}
          >
            {sortBy === 'event_date_asc' ? (
              <ArrowUp className="w-4 h-4" />
            ) : (
              <ArrowDown className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Events List */}
      {!paginatedRequests.length ? (
        <Card className="p-6 text-center text-gray-600">
          No events match your filters.
        </Card>
      ) : (
        <div className="space-y-3">
          {paginatedRequests.map((request) => {
            const status = request.status || 'new';
            const statusLabel = statusLabels[status] || status;
            const statusClass = statusStyles[status] || 'bg-slate-50 text-slate-700 border-slate-200';

            return (
              <Card
                key={request.id}
                className="p-4 hover:border-tsp-teal hover:shadow-sm transition cursor-pointer"
                onClick={() => openEvent(request)}
                data-event-id={request.id}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-gray-900">{request.organizationName || 'No organization'}</h3>
                      <Badge variant="outline" className={statusClass}>
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-gray-600 flex items-center gap-2 flex-wrap">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(getEffectiveEventDate(request))}</span>
                      {request.eventAddress && (
                        <>
                          <span className="text-gray-400">•</span>
                          <MapPin className="w-4 h-4" />
                          <span>{request.eventAddress}</span>
                        </>
                      )}
                    </div>
                    {(request.tspContactAssigned || request.tspContact || request.customTspContact) && (
                      <div className="mt-1 text-sm text-gray-600 flex items-center gap-1">
                        <UserCheck className="w-4 h-4" />
                        <span>TSP Contact: {request.customTspContact || resolveUserName(request.tspContactAssigned || request.tspContact || '')}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <div>Submitted: {formatDate(request.createdAt as any)}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AllEventsTab;
