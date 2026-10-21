import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { CompletedCard } from '../cards/CompletedCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import { useLinkedCollectionTotals } from '../hooks/useLinkedCollectionTotals';
import type { EventRequest } from '@shared/schema';

export const CompletedTab: React.FC = () => {
  const { toast } = useToast();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, createEventRequestMutation } = useEventMutations();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);
  const {
    handleStatusChange,
    resolveUserName,
    openAssignmentDialog,
    openEditAssignmentDialog,
    handleRemoveAssignment,
    handleSelfSignup,
    canSelfSignup,
    isUserSignedUp,
  } = useEventAssignments();

  const {
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    setCollectionLogEventRequest,
    setContactEventRequest,
    setTspContactEventRequest,
    setLogContactEventRequest,
    setNextActionEventRequest,
    setNextActionMode,
    openDialog,
  } = useEventDialogState();

  const completedRequests = filterRequestsByStatus('completed') || [];
  const { data: loggedTotals } = useLinkedCollectionTotals(
    completedRequests.map((r) => r.id)
  );

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${completedRequests.length} completed event${completedRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <EventListSkeleton count={5} />
        ) : completedRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No completed events
          </div>
        ) : (
        <EventListBatchProviders events={completedRequests}>
        {completedRequests.map((request) => (
          <CompletedCard
            key={request.id}
            request={request}
            loggedSandwiches={loggedTotals ? loggedTotals[request.id] ?? null : undefined}
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
              if (
                window.confirm(
                  'Are you sure you want to delete this completed event? This action cannot be undone.'
                )
              ) {
                deleteEventRequestMutation.mutate(request.id, {
                  onSuccess: () => {
                    toast({
                      title: 'Deleted',
                      description: 'The completed event was deleted.',
                    });
                  },
                  onError: (err: unknown) => {
                    toast({
                      variant: 'destructive',
                      title: 'Delete failed',
                      description:
                        err instanceof Error ? err.message : 'Unknown error',
                    });
                  },
                });
              }
            }}
            onContact={() => {
              setContactEventRequest(request);
              openDialog('contactOrganizer');
            }}
            onFollowUp1Day={() => {
              setSelectedEventRequest(request);
              openDialog('oneDayFollowUp');
            }}
            onFollowUp1Month={() => {
              setSelectedEventRequest(request);
              openDialog('oneMonthFollowUp');
            }}
            onViewCollectionLog={() => {
              setCollectionLogEventRequest(request);
              openDialog('collectionLog');
            }}
            onReschedule={() => {
              if (
                window.confirm(
                  'Do you want to reopen this event and move it back to Scheduled? (This is for data entry corrections.)'
                )
              ) {
                handleStatusChange(request.id, 'scheduled');
              }
            }}
            onDuplicate={() => {
              setDuplicateSourceRequest(request);
              setShowDuplicateDialog(true);
            }}
            onAssignTspContact={() => {
              setTspContactEventRequest(request);
              openDialog('tspContactAssignment');
            }}
            onEditTspContact={() => {
              setTspContactEventRequest(request);
              openDialog('tspContactAssignment');
            }}
            onLogContact={() => {
              setLogContactEventRequest(request);
              openDialog('logContact');
            }}
            onAddNextAction={() => {
              setNextActionEventRequest(request);
              setNextActionMode('add');
              openDialog('nextAction');
            }}
            onEditNextAction={() => {
              setNextActionEventRequest(request);
              setNextActionMode('edit');
              openDialog('nextAction');
            }}
            onCompleteNextAction={() => {
              setNextActionEventRequest(request);
              setNextActionMode('complete');
              openDialog('nextAction');
            }}
            openAssignmentDialog={(type, isVanDriver) => openAssignmentDialog(request.id, type, isVanDriver)}
            openEditAssignmentDialog={(type, personId) => openEditAssignmentDialog(request.id, type, personId)}
            handleRemoveAssignment={(type, personId) => handleRemoveAssignment(personId, type, request.id)}
            handleSelfSignup={(type) => handleSelfSignup(request.id, type)}
            canSelfSignup={canSelfSignup}
            isUserSignedUp={isUserSignedUp}
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
