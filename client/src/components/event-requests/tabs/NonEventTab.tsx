import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { NonEventCard } from '../cards/NonEventCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import type { EventRequest } from '@shared/schema';

export const NonEventTab: React.FC = () => {
  const { toast } = useToast();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, createEventRequestMutation } = useEventMutations();
  const { resolveUserName } = useEventAssignments();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  const {
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    openDialog,
  } = useEventDialogState();

  const nonEventRequests = filterRequestsByStatus('non_event');

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${nonEventRequests.length} non-event request${nonEventRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <EventListSkeleton count={3} />
        ) : nonEventRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No non-event requests
          </div>
        ) : (
          nonEventRequests.map((request) => (
            <NonEventCard
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
                if (window.confirm('Are you sure you want to permanently delete this non-event?')) {
                  deleteEventRequestMutation.mutate(request.id);
                }
              }}
            />
          ))
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
