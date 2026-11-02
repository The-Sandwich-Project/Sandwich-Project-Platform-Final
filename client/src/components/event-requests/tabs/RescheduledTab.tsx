import React from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Eye, Trash2, Calendar, Building, Phone } from 'lucide-react';
import { formatEventDate } from '@/components/event-requests/utils';
import { statusColors, statusBorderColors, statusBgColors } from '@/components/event-requests/constants';
import { EventListSkeleton } from '../EventCardSkeleton';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

export const RescheduledTab: React.FC = () => {
  const { toast } = useToast();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation } = useEventMutations();
  const { resolveUserName } = useEventAssignments();

  const {
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    openDialog,
  } = useEventDialogState();

  const rescheduledRequests = filterRequestsByStatus('rescheduled');

  const borderColor = statusBorderColors['rescheduled'] || '#236383';
  const bgColor = statusBgColors['rescheduled'] || 'bg-[#E4EFF6]';

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${rescheduledRequests.length} rescheduled event${rescheduledRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <EventListSkeleton count={3} />
        ) : rescheduledRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No rescheduled events
          </div>
        ) : (
          rescheduledRequests.map((request) => {
            const displayDate = getEffectiveEventDate(request);
            const dateInfo = displayDate ? formatEventDate(displayDate.toString()) : null;

            return (
              <Card
                key={request.id}
                className={`relative overflow-hidden ${bgColor} hover:shadow-md transition-shadow cursor-pointer`}
                style={{ borderLeft: `4px solid ${borderColor}` }}
                onClick={() => {
                  setSelectedEventRequest(request);
                  setIsEditing(false);
                  openDialog('eventDetails');
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={statusColors['rescheduled'] || ''}>
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Rescheduled
                        </Badge>
                        {request.originalScheduledDate && (
                          <Badge className="bg-blue-100 text-blue-700 border border-blue-200 text-xs font-medium">
                            Rescheduled from {new Date(request.originalScheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold text-tsp-teal break-words min-w-0">
                        {request.organizationName}
                        {request.department && (
                          <span className="text-base sm:text-lg font-normal text-gray-600 ml-2">
                            &bull; {request.department}
                          </span>
                        )}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedEventRequest(request);
                          setIsEditing(true);
                          openDialog('eventDetails');
                        }}
                        className="h-8"
                        title="Edit details"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm('Are you sure you want to permanently delete this rescheduled event?')) {
                            deleteEventRequestMutation.mutate(request.id);
                          }
                        }}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                    {(request.firstName || request.lastName) && (
                      <span className="flex items-center gap-1">
                        <Building className="w-3.5 h-3.5" />
                        {[request.firstName, request.lastName].filter(Boolean).join(' ')}
                      </span>
                    )}
                    {dateInfo && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {dateInfo.text}
                      </span>
                    )}
                    {request.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" />
                        {request.phone}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
};
