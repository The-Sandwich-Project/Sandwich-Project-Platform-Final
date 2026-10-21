import React, { useState, useMemo } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { InProcessCard } from '../cards/InProcessCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { Button } from '@/components/ui/button';
import { EyeOff, Eye, CalendarX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EventListSkeleton } from '../EventCardSkeleton';
import { EventListBatchProviders } from '../EventListBatchProviders';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { buildAttendancePatch } from '../form-utils';
import type { EventRequest } from '@shared/schema';

export const InProcessTab: React.FC = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { confirm, ConfirmationDialogComponent } = useConfirmation();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, updateEventRequestMutation, createEventRequestMutation } = useEventMutations();
  const { handleStatusChange, resolveUserName } = useEventAssignments();

  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  // Inline editing state
  const [editingInProcessId, setEditingInProcessId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [tempIsConfirmed, setTempIsConfirmed] = useState(false);

  // Hide past-date events toggle
  const [hidePastDateEvents, setHidePastDateEvents] = useState(false);

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
    setEditContactEventRequest,
    setEditContactAttemptData,
    setAiSuggestionEventRequest,
    setAiIntakeAssistantEventRequest,
    setNextActionEventRequest,
    setNextActionMode,
    setIntakeCallEventRequest,
    openDialog,
  } = useEventDialogState();

  const inProcessRequests = filterRequestsByStatus('in_process');

  // Helper to check if an event's date has passed
  const isEventDatePast = (request: any): boolean => {
    const eventDate = getEffectiveEventDate(request);
    if (!eventDate) return false;
    const date = new Date(eventDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Filter and count past-date events
  const { filteredRequests, pastDateCount } = useMemo(() => {
    const pastDateEvents = inProcessRequests.filter(isEventDatePast);
    const pastDateCount = pastDateEvents.length;

    const filteredRequests = hidePastDateEvents
      ? inProcessRequests.filter(req => !isEventDatePast(req))
      : inProcessRequests;

    return { filteredRequests, pastDateCount };
  }, [inProcessRequests, hidePastDateEvents]);

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

  // Check if event needs follow-up
  // Returns: 'toolkit' if toolkit sent > 1 week ago and no recent contact attempts
  //          'contact' if last contact attempt > 1 week ago
  //          null if no follow-up needed
  const getFollowUpStatus = (request: any) => {
    if (request.status !== 'in_process') return null;
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    // If there's a contact attempt logged
    if (request.contactAttempts && request.contactAttempts > 0 && request.lastContactAttempt) {
      const lastContactDate = new Date(request.lastContactAttempt);
      // If last contact was more than a week ago, need follow-up on that contact
      if (lastContactDate < oneWeekAgo) {
        return 'contact';
      }
      // If last contact was within a week, no follow-up needed
      return null;
    }
    
    // No contact attempts - check if toolkit sent over a week ago
    if (request.toolkitSentDate && new Date(request.toolkitSentDate) < oneWeekAgo) {
      return 'toolkit';
    }
    
    // Fallback: check if status changed to in_process over a week ago (for events without toolkit)
    if (request.statusChangedAt && new Date(request.statusChangedAt) < oneWeekAgo) {
      return 'toolkit';
    }
    
    return null;
  };
  
  // For backwards compatibility
  const isStale = (request: any) => {
    return getFollowUpStatus(request) === 'toolkit';
  };

  // Inline editing functions
  const startEditing = (id: number, field: string, currentValue: string) => {
    setEditingInProcessId(id);
    setEditingField(field);
    setEditingValue(currentValue || '');

    // When editing a date field, also load the current confirmation status
    if (field === 'desiredEventDate' || field === 'scheduledEventDate') {
      const eventRequest = inProcessRequests.find(req => req.id === id);
      if (eventRequest) {
        setTempIsConfirmed(eventRequest.isConfirmed || false);
      }
    }
  };

  const saveEdit = () => {
    if (editingInProcessId && editingField) {
      // Define the actual save logic
      const performSave = () => {
        if (editingField === 'isConfirmed') {
          // Special handling for boolean toggles
          const boolValue = editingValue === 'true';
          updateEventRequestMutation.mutate({
            id: editingInProcessId,
            data: { [editingField]: boolValue },
          });
        } else if (editingField === 'desiredEventDate' || editingField === 'scheduledEventDate') {
          // When saving a date field, also save the confirmation status if needed
          updateEventRequestMutation.mutate({
            id: editingInProcessId,
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
            const currentEvent = inProcessRequests.find(r => r.id === editingInProcessId);
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
            id: editingInProcessId,
            data: { partnerOrganizations: partnerOrgs.length > 0 ? partnerOrgs : [] },
          });
        } else if (editingField === 'attendanceBreakdown') {
          const [adults, teens, kids] = editingValue.split(',').map(v => {
            const parsed = parseInt(v);
            return isNaN(parsed) ? null : parsed;
          });
          const total = (adults || 0) + (teens || 0) + (kids || 0);
          updateEventRequestMutation.mutate({
            id: editingInProcessId,
            data: {
              attendanceAdults: adults,
              attendanceTeens: teens,
              attendanceKids: kids,
              // Clearing the breakdown must clear the legacy mirror too, or the
              // next read falls back to it and resurrects the cleared total.
              ...buildAttendancePatch(total),
            },
          });
        } else {
          // Default handling for other fields
          updateEventRequestMutation.mutate({
            id: editingInProcessId,
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
          setEditingInProcessId(null);
          setEditingField(null);
          setEditingValue('');
        },
        'default',
        () => {
          // Reset editing state on cancel
          cancelEdit();
        }
      );
    }
  };

  const cancelEdit = () => {
    setEditingInProcessId(null);
    setEditingField(null);
    setEditingValue('');
  };

  return (
    <>
      {/* Header with count. Export lives in the page-level top action bar. */}
      <div className="flex items-center justify-between mb-4 px-4">
        <div className="text-sm text-gray-600">
          {isLoading ? 'Loading...' : `${inProcessRequests.length} event${inProcessRequests.length !== 1 ? 's' : ''} in process`}
        </div>
      </div>

      {/* Toggle button for hiding past-date events */}
      {pastDateCount > 0 && (
        <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-amber-800">
            <CalendarX className="w-4 h-4" />
            <span className="text-sm font-medium">
              {pastDateCount} event{pastDateCount !== 1 ? 's' : ''} with past dates
            </span>
            {hidePastDateEvents && (
              <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
                Hidden
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHidePastDateEvents(!hidePastDateEvents)}
            className={hidePastDateEvents
              ? "border-amber-300 text-amber-700 hover:bg-amber-100"
              : "border-amber-300 text-amber-700 hover:bg-amber-100"
            }
          >
            {hidePastDateEvents ? (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Show Past Events
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4 mr-2" />
                Hide Past Events
              </>
            )}
          </Button>
        </div>
      )}

      {isLoading ? (
        <EventListSkeleton count={5} />
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {inProcessRequests.length === 0
            ? 'No events in process'
            : 'All past-date events are hidden. Click "Show Past Events" to view them.'}
        </div>
      ) : (
        <EventListBatchProviders events={filteredRequests}>
        <div className="space-y-4">
          {filteredRequests.map((request) => (
            <InProcessCard
              key={request.id}
              request={request}
              resolveUserName={resolveUserName}
              isStale={isStale(request)}
              onEdit={() => {
                setSelectedEventRequest(request);
                setIsEditing(true);
                openDialog('eventDetails');
              }}
              onDelete={() => deleteEventRequestMutation.mutate(request.id)}
              onSchedule={() => {
                setSchedulingEventRequest(request);
                openDialog('scheduling');
              }}
              onCall={() => handleCall(request)}
              onIntakeCall={() => {
                setIntakeCallEventRequest(request);
                openDialog('intakeCall');
              }}
              onContact={() => {
                setContactEventRequest(request);
                openDialog('contactOrganizer');
              }}
              onScheduleCall={() => {
                setSelectedEventRequest(request);
                openDialog('scheduleCall');
              }}
              onResendToolkit={() => {
                setSelectedEventRequest(request);
                setToolkitEventRequest(request);
                openDialog('toolkitSent');
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
              onDuplicate={() => {
                setDuplicateSourceRequest(request);
                setShowDuplicateDialog(true);
              }}
              onEditContactAttempt={(attemptNumber) => {
                // Find the contact attempt to edit
                const attempt = request.contactAttemptsLog?.find(
                  (a: any) => a.attemptNumber === attemptNumber
                );
                if (attempt) {
                  setEditContactEventRequest(request);
                  setEditContactAttemptData(attempt);
                  openDialog('editContact');
                }
              }}
              onDeleteContactAttempt={async (attemptNumber) => {
                // Filter out the attempt to delete
                const updatedLog = request.contactAttemptsLog?.filter(
                  (a: any) => a.attemptNumber !== attemptNumber
                );

                // Renumber remaining attempts
                const renumberedLog = updatedLog?.map((attempt: any, index: number) => ({
                  ...attempt,
                  attemptNumber: index + 1,
                }));

                // Find the most recent attempt
                const mostRecentAttempt = renumberedLog?.[renumberedLog.length - 1];

                await updateEventRequestMutation.mutateAsync({
                  id: request.id,
                  data: {
                    contactAttempts: renumberedLog?.length || 0,
                    lastContactAttempt: mostRecentAttempt?.timestamp || null,
                    contactMethod: mostRecentAttempt?.method || null,
                    contactOutcome: mostRecentAttempt?.outcome || null,
                    contactAttemptsLog: renumberedLog || [],
                  },
                });

                toast({
                  title: 'Contact attempt deleted',
                  description: `Successfully deleted attempt #${attemptNumber}`,
                });
              }}
              onAiSuggest={() => {
                setAiSuggestionEventRequest(request);
                openDialog('aiDateSuggestion');
              }}
              onAiIntakeAssist={() => {
                setAiIntakeAssistantEventRequest(request);
                openDialog('aiIntakeAssistant');
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
              // Inline editing props
              startEditing={(field, value) => startEditing(request.id, field, value)}
              saveEdit={saveEdit}
              cancelEdit={cancelEdit}
              setEditingValue={setEditingValue}
              isEditingThisCard={editingInProcessId === request.id}
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
