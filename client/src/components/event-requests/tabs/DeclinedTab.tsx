import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { DeclinedCard } from '../cards/DeclinedCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import type { EventRequest } from '@shared/schema';

export const DeclinedTab: React.FC = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, createEventRequestMutation } = useEventMutations();
  const { handleStatusChange, resolveUserName } = useEventAssignments();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  const {
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    setContactEventRequest,
    setLogContactEventRequest,
    openDialog,
  } = useEventDialogState();

  const declinedRequests = filterRequestsByStatus('declined');
  const cancelledRequests = filterRequestsByStatus('cancelled');
  const allDeclinedOrCancelled = [...declinedRequests, ...cancelledRequests];

  const handleCall = (request: any) => {
    const phoneNumber = request.phone;

    if (isMobile) {
      window.location.href = `tel:${phoneNumber}`;
    } else {
      navigator.clipboard.writeText(phoneNumber || '').then(() => {
        toast({
          title: 'Phone number copied!',
          description: `${phoneNumber} has been copied to your clipboard.`,
        });
      }).catch(() => {
        toast({
          title: 'Failed to copy',
          description: 'Please copy manually: ' + phoneNumber,
          variant: 'destructive',
        });
      });
    }
  };

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${allDeclinedOrCancelled.length} declined/cancelled event${allDeclinedOrCancelled.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="space-y-6">
        {isLoading ? (
        <EventListSkeleton count={3} />
      ) : declinedRequests.length === 0 && cancelledRequests.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No declined or cancelled events
        </div>
      ) : (
        <EventListBatchProviders events={allDeclinedOrCancelled}>
        <>
          {/* Declined Events Section */}
          {declinedRequests.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b-2 border-red-200">
                <h3 className="text-lg font-semibold text-red-700">Declined Events</h3>
                <span className="text-sm text-gray-500">({declinedRequests.length})</span>
              </div>
              {declinedRequests.map((request) => (
                <DeclinedCard
                  key={request.id}
                  request={request}
                  resolveUserName={resolveUserName}
                  onView={() => {
                    setSelectedEventRequest(request);
                    setIsEditing(false);
                    openDialog('eventDetails');
                  }}
                  onEdit={() => {
                    setSelectedEventRequest(request);
                    setIsEditing(true);
                    openDialog('eventDetails');
                  }}
                  onDelete={() => {
                    if (window.confirm('Are you sure you want to permanently delete this declined event?')) {
                      deleteEventRequestMutation.mutate(request.id);
                    }
                  }}
                  onContact={() => {
                    setContactEventRequest(request);
                    openDialog('contactOrganizer');
                  }}
                  onCall={() => handleCall(request)}
                  onReactivate={() => {
                    if (window.confirm('Do you want to reactivate this event request?')) {
                      handleStatusChange(request.id, 'new');
                      toast({
                        title: 'Event reactivated',
                        description: 'The event request has been moved back to New Requests.',
                      });
                    }
                  }}
                  onLogContact={() => {
                    setLogContactEventRequest(request);
                    openDialog('logContact');
                  }}
                />
              ))}
            </div>
          )}

          {/* Cancelled Events Section */}
          {cancelledRequests.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b-2 border-gray-300">
                <h3 className="text-lg font-semibold text-gray-700">Cancelled Events</h3>
                <span className="text-sm text-gray-500">({cancelledRequests.length})</span>
              </div>
              {cancelledRequests.map((request) => (
                <DeclinedCard
                  key={request.id}
                  request={request}
                  resolveUserName={resolveUserName}
                  onView={() => {
                    setSelectedEventRequest(request);
                    setIsEditing(false);
                    openDialog('eventDetails');
                  }}
                  onEdit={() => {
                    setSelectedEventRequest(request);
                    setIsEditing(true);
                    openDialog('eventDetails');
                  }}
                  onDelete={() => {
                    if (window.confirm('Are you sure you want to permanently delete this cancelled event?')) {
                      deleteEventRequestMutation.mutate(request.id);
                    }
                  }}
                  onContact={() => {
                    setContactEventRequest(request);
                    openDialog('contactOrganizer');
                  }}
                  onCall={() => handleCall(request)}
                  onReactivate={() => {
                    if (window.confirm('Do you want to reactivate this event request?')) {
                      handleStatusChange(request.id, 'new');
                      toast({
                        title: 'Event reactivated',
                        description: 'The event request has been moved back to New Requests.',
                      });
                    }
                  }}
                  onLogContact={() => {
                    setLogContactEventRequest(request);
                    openDialog('logContact');
                  }}
                />
              ))}
            </div>
          )}
        </>
        </EventListBatchProviders>
        )}
      </div>
      <DuplicateEventDialog
        isOpen={showDuplicateDialog}
        onClose={() => {
          setShowDuplicateDialog(false);
          setDuplicateSourceRequest(null);
        }}
        request={duplicateSourceRequest}
        onConfirm={async (newEventData) => {
          await createEventRequestMutation.mutateAsync(newEventData);
          setShowDuplicateDialog(false);
          setDuplicateSourceRequest(null);
        }}
      />
    </>
  );
};