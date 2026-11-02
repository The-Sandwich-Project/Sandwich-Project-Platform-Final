import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { StandbyCard } from '../cards/StandbyCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import type { EventRequest } from '@shared/schema';

export const StandbyTab: React.FC = () => {
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

  const standbyRequests = filterRequestsByStatus('standby');

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
          {isLoading ? 'Loading...' : `${standbyRequests.length} standby event${standbyRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Info banner explaining standby status */}
      <div className="mb-4 px-4">
        <div className="bg-tsp-mist border border-tsp-teal/30 rounded-lg p-3 text-sm text-tsp-navy">
          <strong>Standby events</strong> are waiting for the organizer to work out details on their end.
          Check back periodically to follow up, especially when expected response dates pass.
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <EventListSkeleton count={3} />
        ) : standbyRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No standby events
          </div>
        ) : (
          <EventListBatchProviders events={standbyRequests}>
          {standbyRequests.map((request) => (
          <StandbyCard
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
              if (window.confirm('Are you sure you want to permanently delete this standby event?')) {
                deleteEventRequestMutation.mutate(request.id);
              }
            }}
            onContact={() => {
              setContactEventRequest(request);
              openDialog('contactOrganizer');
            }}
            onCall={() => handleCall(request)}
            onReactivate={() => {
              if (window.confirm('Do you want to move this event back to In Process?')) {
                handleStatusChange(request.id, 'in_process');
                toast({
                  title: 'Event reactivated',
                  description: 'The event request has been moved to In Process.',
                });
              }
            }}
            onLogContact={() => {
              setLogContactEventRequest(request);
              openDialog('logContact');
            }}
            onMoveToStalled={() => {
              if (window.confirm('Move this event to Stalled? This is for events where you have not received any response after multiple attempts.')) {
                handleStatusChange(request.id, 'stalled');
                toast({
                  title: 'Event moved to Stalled',
                  description: 'The event request has been marked as stalled due to no response.',
                });
              }
            }}
            onDuplicate={() => {
              setDuplicateSourceRequest(request);
              setShowDuplicateDialog(true);
            }}
          />
          ))}
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
