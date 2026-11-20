import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { NewRequestCard } from '../cards/NewRequestCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import type { EventRequest } from '@shared/schema';

export const NewRequestsTab: React.FC = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { confirm, ConfirmationDialogComponent } = useConfirmation();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, updateEventRequestMutation, createEventRequestMutation } = useEventMutations();
  const { handleStatusChange } = useEventAssignments();

  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  // Inline editing state
  const [editingNewRequestId, setEditingNewRequestId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [tempIsConfirmed, setTempIsConfirmed] = useState(false);

  const {
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    setSchedulingEventRequest,
    setToolkitEventRequest,
    setContactEventRequest,
    setTspContactEventRequest,
    setLogContactEventRequest,
    setAiSuggestionEventRequest,
    setAiIntakeAssistantEventRequest,
    setIntakeCallEventRequest,
    setNextActionEventRequest,
    setNextActionMode,
    setReasonDialogEventRequest,
    setNonEventDialogEventRequest,
    openDialog,
  } = useEventDialogState();

  const newRequests = filterRequestsByStatus('new');

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

  // Inline editing functions
  const startEditing = (id: number, field: string, currentValue: string) => {
    setEditingNewRequestId(id);
    setEditingField(field);
    setEditingValue(currentValue || '');

    // When editing a date field, also load the current confirmation status
    if (field === 'desiredEventDate' || field === 'scheduledEventDate') {
      const eventRequest = newRequests.find(req => req.id === id);
      if (eventRequest) {
        setTempIsConfirmed(eventRequest.isConfirmed || false);
      }
    }
  };

  const saveEdit = () => {
    if (editingNewRequestId && editingField) {
      // Define the actual save logic
      const performSave = () => {
        if (editingField === 'isConfirmed') {
          // Special handling for boolean toggles
          const boolValue = editingValue === 'true';
          updateEventRequestMutation.mutate({
            id: editingNewRequestId,
            data: { [editingField]: boolValue },
          });
        } else if (editingField === 'desiredEventDate' || editingField === 'scheduledEventDate') {
          // When saving a date field, also save the confirmation status if needed
          updateEventRequestMutation.mutate({
            id: editingNewRequestId,
            data: {
              [editingField]: editingValue,
              isConfirmed: tempIsConfirmed,
            },
          });
        } else if (editingField === 'partnerOrganizations' || editingField.startsWith('partnerOrg_')) {
          // Special handling for partner organizations
          let partnerOrgs: Array<{ name: string; department?: string; role?: string }>;
          
          if (editingField.startsWith('partnerOrg_')) {
            // Editing a single partner organization (name + optional department)
            const index = parseInt(editingField.split('_')[1]);
            const currentEvent = newRequests.find(r => r.id === editingNewRequestId);
            const currentPartners = Array.isArray(currentEvent?.partnerOrganizations) 
              ? (currentEvent.partnerOrganizations as any[]) 
              : [];
            partnerOrgs = [...currentPartners];

            let parsed = { name: editingValue?.trim?.() || '', department: '' };
            try {
              const maybe = JSON.parse(editingValue);
              if (maybe && typeof maybe === 'object') {
                parsed = {
                  name: (maybe as any).name?.toString().trim() || '',
                  department: (maybe as any).department?.toString() || '',
                };
              }
            } catch {
              // ignore parse errors
            }

            const target = partnerOrgs[index] || {};
            const updated = {
              ...target,
              name: parsed.name || target.name || '',
              department: parsed.department ?? target.department ?? '',
              role: target.role || 'partner',
            };

            if (partnerOrgs[index]) {
              partnerOrgs[index] = updated;
            } else if (updated.name) {
              partnerOrgs.push(updated);
            }
          } else {
            // Editing the full array
            try {
              partnerOrgs = JSON.parse(editingValue);
            } catch {
              partnerOrgs = [];
            }
          }
          
          // Filter out empty partners (where name is empty or just whitespace)
          partnerOrgs = partnerOrgs.filter(p => p && p.name && p.name.trim() !== '');
          
          // Ensure each partner has a role
          partnerOrgs = partnerOrgs.map(p => ({
            ...p,
            role: p.role || 'partner'
          }));
          
          // Send the update - use empty array instead of null to ensure it's saved
          updateEventRequestMutation.mutate({
            id: editingNewRequestId,
            data: { partnerOrganizations: partnerOrgs.length > 0 ? partnerOrgs : [] },
          });
        } else {
          // Default handling for other fields
          updateEventRequestMutation.mutate({
            id: editingNewRequestId,
            data: { [editingField]: editingValue },
          });
        }
      };

      // Always show confirmation for inline edits
      const fieldName = editingField.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, str => str.toUpperCase());
      confirm(
        `Update ${fieldName}`,
        `Are you sure you want to update ${fieldName}?`,
        () => {
          performSave();
          // Reset editing state
          setEditingNewRequestId(null);
          setEditingField(null);
          setEditingValue('');
        },
        'default',
        () => {
          // Reset editing state on cancel
          setEditingNewRequestId(null);
          setEditingField(null);
          setEditingValue('');
        }
      );
    }
  };

  const cancelEdit = () => {
    setEditingNewRequestId(null);
    setEditingField(null);
    setEditingValue('');
  };

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar
          (consistent across every tab), not inline here. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${newRequests.length} new request${newRequests.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {isLoading ? (
        <EventListSkeleton count={3} />
      ) : newRequests.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No new event requests
        </div>
      ) : (
        <EventListBatchProviders events={newRequests}>
        <div className="space-y-4">
          {newRequests.map((request) => (
            <NewRequestCard
              key={request.id}
              request={request}
              canEdit={true}
              canDelete={true}
              onEdit={() => {
                setSelectedEventRequest(request);
                setIsEditing(true);
                openDialog('eventDetails');
              }}
              onDelete={() => deleteEventRequestMutation.mutate(request.id)}
              onCall={() => handleCall(request)}
              onContact={() => {
                setContactEventRequest(request);
                openDialog('contactOrganizer');
              }}
              onToolkit={() => {
                setSelectedEventRequest(request);
                setToolkitEventRequest(request);
                openDialog('toolkitSent');
              }}
              onSendToolkit={() => {
                setSelectedEventRequest(request);
                setToolkitEventRequest(request);
                openDialog('sendToolkit');
              }}
              onAssignTspContact={() => {
                setTspContactEventRequest(request);
                openDialog('tspContactAssignment');
              }}
              onEditTspContact={() => {
                setTspContactEventRequest(request);
                openDialog('tspContactAssignment');
              }}
              onApprove={() => handleStatusChange(request.id, 'in_process')}
              onDecline={async () => {
                const result = await handleStatusChange(request.id, 'declined');
                if (result === 'needs_reason') {
                  setReasonDialogEventRequest(request);
                  openDialog('decline');
                }
              }}
              onNonEvent={async () => {
                const result = await handleStatusChange(request.id, 'non_event');
                if (result === 'needs_reason') {
                  setNonEventDialogEventRequest(request);
                  openDialog('nonEvent');
                }
              }}
              onLogContact={() => {
                setLogContactEventRequest(request);
                openDialog('logContact');
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
              // Inline editing props
              startEditing={(field, value) => startEditing(request.id, field, value)}
              saveEdit={saveEdit}
              cancelEdit={cancelEdit}
              setEditingValue={setEditingValue}
              isEditingThisCard={editingNewRequestId === request.id}
              editingField={editingField || ''}
              editingValue={editingValue}
              tempIsConfirmed={tempIsConfirmed}
            />
          ))}
        </div>
        </EventListBatchProviders>
      )}
      {ConfirmationDialogComponent}
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
