import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { StalledCard } from '../cards/StalledCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import type { EventRequest } from '@shared/schema';
import { emailOrganizer } from '../lib/emailOrganizer';

export const StalledTab: React.FC = () => {
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
    setReasonDialogEventRequest,
    openDialog,
  } = useEventDialogState();

  const stalledRequests = filterRequestsByStatus('stalled');

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
          {isLoading ? 'Loading...' : `${stalledRequests.length} stalled event${stalledRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Info banner explaining stalled status */}
      <div className="mb-4 px-4">
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 text-sm text-gray-700">
          <strong>Stalled events</strong> are requests where we have not received any response after multiple outreach attempts.
          These are kept in limbo for periodic follow-up (every few months). If the organizer officially declines, move them to Declined.
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <EventListSkeleton count={3} />
        ) : stalledRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No stalled events
          </div>
        ) : (
          <EventListBatchProviders events={stalledRequests}>
          {stalledRequests.map((request) => (
          <StalledCard
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
              if (window.confirm('Are you sure you want to permanently delete this stalled event?')) {
                deleteEventRequestMutation.mutate(request.id);
              }
            }}
            onContact={() =>
              emailOrganizer(request, () => {
                setContactEventRequest(request);
                openDialog('contactOrganizer');
              })
            }
            onCall={() => handleCall(request)}
            onReactivate={() => {
              if (window.confirm('The organizer responded! Move this event back to In Process?')) {
                handleStatusChange(request.id, 'in_process');
                toast({
                  title: 'Event reactivated',
                  description: 'Great news! The event request has been moved back to In Process.',
                });
              }
            }}
            onLogContact={() => {
              setLogContactEventRequest(request);
              openDialog('logContact');
            }}
            onDecline={async () => {
              const result = await handleStatusChange(request.id, 'declined');
              if (result === 'needs_reason') {
                setReasonDialogEventRequest(request);
                openDialog('decline');
              }
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
