import React, { useState, useEffect } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAnalytics } from '@/hooks/useAnalytics';
import { ScheduledCardEnhanced } from '../cards/ScheduledCardEnhanced';
import { RescheduleDialog } from '../dialogs/RescheduleDialog';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { parseSandwichTypes, stringifySandwichTypes } from '@/lib/sandwich-utils';
import { hasActiveSandwichRange, hasActiveSandwichTypes } from '@shared/sandwich-count-utils';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import type { EventRequest } from '@shared/schema';
import { ScheduledSpreadsheetView } from '../views/ScheduledSpreadsheetView';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Table2, Download } from 'lucide-react';
import { EventListBatchProviders } from '../EventListBatchProviders';
import { EventListSkeleton } from '../EventCardSkeleton';

export const ScheduledTab: React.FC = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { trackEvent, trackButtonClick } = useAnalytics();
  const { confirm, ConfirmationDialogComponent } = useConfirmation();
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [rescheduleRequest, setRescheduleRequest] = useState<EventRequest | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  // Use context-level scheduled view mode so toolbar can control it
  const { scheduledViewMode: viewMode, setScheduledViewMode: setViewMode } = useEventRequestContext();
  const [viewStartTime, setViewStartTime] = useState<number>(Date.now());

  // State for confirmation checkbox when editing dates
  const [tempIsConfirmed, setTempIsConfirmed] = useState(false);

  // Track when user first lands on scheduled tab
  useEffect(() => {
    trackEvent('scheduled_tab_viewed', {
      default_view: 'card',
      is_default: true,
      is_mobile: isMobile,
      timestamp: new Date().toISOString(),
    });
    setViewStartTime(Date.now());
  }, [trackEvent, isMobile]);

  // Track view mode changes and time spent in each view
  const handleViewModeChange = (newMode: 'card' | 'spreadsheet') => {
    const timeSpent = Date.now() - viewStartTime;

    // Track time spent in previous view
    trackEvent('view_mode_duration', {
      view_mode: viewMode,
      duration_seconds: Math.round(timeSpent / 1000),
      switched_to: newMode,
    });

    // Track the switch
    trackEvent('view_mode_changed', {
      from: viewMode,
      to: newMode,
      tab: 'scheduled',
      timestamp: new Date().toISOString(),
    });

    trackButtonClick(`switch_to_${newMode}_view`, 'event_requests_scheduled_tab');

    setViewMode(newMode);
    setViewStartTime(Date.now());
  };

  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, updateEventRequestMutation, updateScheduledFieldMutation, rescheduleEventMutation, createEventRequestMutation } = useEventMutations();
  const {
    handleStatusChange,
    openAssignmentDialog,
    openEditAssignmentDialog,
    handleRemoveAssignment,
    handleSelfSignup,
    canSelfSignup,
    isUserSignedUp,
    resolveUserName,
    resolveRecipientName,
  } = useEventAssignments();

  const {
    eventRequests,
    isLoading,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    setSchedulingEventRequest,
    setCollectionLogEventRequest,
    setContactEventRequest,
    setTspContactEventRequest,
    setLogContactEventRequest,
    setAiIntakeAssistantEventRequest,
    setNextActionEventRequest,
    setNextActionMode,
    setReasonDialogEventRequest,
    editingScheduledId,
    setEditingScheduledId,
    editingField,
    setEditingField,
    editingValue,
    setEditingValue,
    inlineSandwichMode,
    setInlineSandwichMode,
    inlineTotalCount,
    setInlineTotalCount,
    inlineSandwichTypes,
    setInlineSandwichTypes,
    inlineRangeMin,
    setInlineRangeMin,
    inlineRangeMax,
    setInlineRangeMax,
    inlineRangeType,
    setInlineRangeType,
    openDialog,
  } = useEventDialogState();

  // filterRequestsByStatus('scheduled') already includes 'rescheduled'
  // events internally (see useEventFilters.ts:541) AND applies the
  // active sortBy across the combined list. Calling it a second time
  // for 'rescheduled' and concatenating the two arrays broke the sort
  // (all scheduled events would come first, then all rescheduled),
  // duplicated the rescheduled events (they'd already been returned in
  // the first call), and multiplied the pagination window.
  //
  // Historically this list sorts by event date ascending, then by
  // event start time ascending within each date. That's baked into
  // the 'event_date_asc' branch of the sort in useEventFilters.
  const scheduledRequests = filterRequestsByStatus('scheduled');

  // Inline editing functions - SPECIFIC to scheduled tab
  const startEditing = (id: number, field: string, currentValue: string) => {
    setEditingScheduledId(id);
    setEditingField(field);
    setEditingValue(currentValue || '');

    // When editing a date field, also load the current confirmation status
    if (field === 'desiredEventDate' || field === 'scheduledEventDate') {
      const eventRequest = eventRequests.find(req => req.id === id);
      if (eventRequest) {
        setTempIsConfirmed(eventRequest.isConfirmed || false);
      }
    }

    // Special handling for sandwich types
    if (field === 'sandwichTypes') {
      const eventRequest = eventRequests.find(req => req.id === id);
      if (eventRequest) {
        const existingSandwichTypes = parseSandwichTypes(eventRequest.sandwichTypes) || [];
        // A breakdown that disagrees with the exact count is stale leftover
        // data. Opening it in "types" mode would re-sum it over the count the
        // user actually entered on save (exact 500 → 250 turkey + 248 PBJ →
        // saved back as 498), so treat it as absent and open on the count.
        const hasTypesData = hasActiveSandwichTypes(
          eventRequest.sandwichTypes,
          eventRequest.estimatedSandwichCount,
        );
        const hasRangeData = hasActiveSandwichRange(
          (eventRequest as any).estimatedSandwichCountMin,
          (eventRequest as any).estimatedSandwichCountMax,
          eventRequest.estimatedSandwichCount,
        );
        const totalCount = eventRequest.estimatedSandwichCount || 0;

        setInlineSandwichMode(hasTypesData ? 'types' : hasRangeData ? 'range' : 'total');
        setInlineTotalCount(totalCount);
        setInlineSandwichTypes(hasTypesData ? existingSandwichTypes : []);

        // Set range values if range data exists
        if (hasRangeData) {
          setInlineRangeMin((eventRequest as any).estimatedSandwichCountMin || 0);
          setInlineRangeMax((eventRequest as any).estimatedSandwichCountMax || 0);
          setInlineRangeType((eventRequest as any).estimatedSandwichRangeType || '');
        }
      }
    }
  };

  const saveEdit = () => {
    if (editingScheduledId && editingField) {
      // Define the actual save logic
      const performSave = () => {

      // Special handling for sandwich types
      if (editingField === 'sandwichTypes') {
        const updateData: any = {};

        if (inlineSandwichMode === 'total') {
          updateData.estimatedSandwichCount = inlineTotalCount;
          updateData.sandwichTypes = null;
          updateData.estimatedSandwichCountMin = null;
          updateData.estimatedSandwichCountMax = null;
          updateData.estimatedSandwichRangeType = null;
        } else if (inlineSandwichMode === 'range') {
          updateData.estimatedSandwichCountMin = inlineRangeMin;
          updateData.estimatedSandwichCountMax = inlineRangeMax;
          updateData.estimatedSandwichRangeType = inlineRangeType || null;
          updateData.estimatedSandwichCount = null;
          updateData.sandwichTypes = null;
        } else {
          updateData.sandwichTypes = stringifySandwichTypes(inlineSandwichTypes);
          updateData.estimatedSandwichCount = inlineSandwichTypes.reduce((sum, item) => sum + item.quantity, 0);
          updateData.estimatedSandwichCountMin = null;
          updateData.estimatedSandwichCountMax = null;
          updateData.estimatedSandwichRangeType = null;
        }

        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: updateData,
        });
      } else if (editingField === 'hasRefrigeration') {
        // Special handling for refrigeration
        let refrigerationValue: boolean | null;
        if (editingValue === 'true') {
          refrigerationValue = true;
        } else if (editingValue === 'false') {
          refrigerationValue = false;
        } else {
          refrigerationValue = null;
        }

        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: { hasRefrigeration: refrigerationValue },
        });
      } else if (editingField === 'isConfirmed' || editingField === 'addedToOfficialSheet' || editingField === 'selfTransport') {
        // Special handling for boolean toggles
        const boolValue = editingValue === 'true';
        const updateData: any = { [editingField]: boolValue };

        // When setting selfTransport to true, clear driversNeeded
        if (editingField === 'selfTransport' && boolValue) {
          updateData.driversNeeded = 0;
        }

        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: updateData,
        });
      } else if (editingField === 'desiredEventDate' || editingField === 'scheduledEventDate') {
        // When saving a date field, also save the confirmation status
        // Completed events are always confirmed
        const eventRequest = eventRequests.find(r => r.id === editingScheduledId);
        const isCompleted = eventRequest?.status === 'completed';

        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: {
            [editingField]: editingValue,
            isConfirmed: isCompleted ? true : tempIsConfirmed
          },
        });
      } else if (editingField === 'assignedRecipientIds') {
        // Special handling for assignedRecipientIds - parse JSON string to array
        const recipientIds = JSON.parse(editingValue);
        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: { assignedRecipientIds: recipientIds },
        });
      } else if (editingField === 'attendanceBreakdown') {
        // Special handling for attendance breakdown - parse comma-separated values
        const [adults, teens, kids] = editingValue.split(',').map(v => {
          const parsed = parseInt(v);
          return isNaN(parsed) ? null : parsed;
        });
        const total = (adults || 0) + (teens || 0) + (kids || 0);
        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: {
            attendanceAdults: adults,
            attendanceTeens: teens,
            attendanceKids: kids,
            estimatedAttendance: total > 0 ? total : null,
          },
        });
      } else if (editingField === 'partnerOrganizations' || editingField.startsWith('partnerOrg_')) {
        // Special handling for partner organizations
        let partnerOrgs: Array<{ name: string; department?: string; role?: string }>;
        
        if (editingField.startsWith('partnerOrg_')) {
          // Editing a single partner organization (name + optional department)
          const index = parseInt(editingField.split('_')[1]);
          const currentEvent = eventRequests.find(r => r.id === editingScheduledId);
          const currentPartners = Array.isArray(currentEvent?.partnerOrganizations) 
            ? (currentEvent.partnerOrganizations as any[]) 
            : [];
          partnerOrgs = [...currentPartners];

          // Parse combined payload if provided as JSON (name/department)
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
            // ignore parse errors, fallback to trimmed string as name
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
          id: editingScheduledId,
          data: { partnerOrganizations: partnerOrgs.length > 0 ? partnerOrgs : [] },
        });
      } else {
        // Regular field update
        const numericFields = ['driversNeeded', 'volunteersNeeded'];
        const valueToSend = numericFields.includes(editingField)
          ? (editingValue === '' ? null : Number(editingValue))
          : editingValue;
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: editingField,
          value: valueToSend as any,
        });
      }
      };

      // Check if this is a critical field that requires confirmation
      const criticalFields = ['eventStartTime', 'eventEndTime', 'pickupTime', 'pickupDateTime', 'overnightPickupTime', 'eventAddress', 'overnightHoldingLocation', 'deliveryDestination', 'hasRefrigeration', 'driversNeeded', 'volunteersNeeded'];

      if (criticalFields.includes(editingField)) {
        const fieldName = editingField.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, str => str.toUpperCase());
        confirm(
          `Update ${fieldName}`,
          `Are you sure you want to update ${fieldName}? This will change the event details and may affect planning.`,
          () => {
            performSave();
            cancelEdit();
          },
          'default',
          () => {
            // Cancel callback: reset editing state
            cancelEdit();
          }
        );
      } else {
        // For non-critical fields, save directly
        performSave();
        cancelEdit();
      }
    }
  };

  const cancelEdit = () => {
    setEditingScheduledId(null);
    setEditingField(null);
    setEditingValue('');
    setInlineSandwichMode('total');
    setInlineTotalCount(0);
    setInlineSandwichTypes([]);
  };

  // Batch save function for saving multiple time fields at once (used by TimeDialogContent)
  const saveTimes = (requestId: number, data: { eventStartTime?: string; eventEndTime?: string; pickupDateTime?: string }) => {
    updateEventRequestMutation.mutate({
      id: requestId,
      data,
    });
    cancelEdit();
  };

  const addInlineSandwichType = () => {
    setInlineSandwichTypes(prev => [...prev, { type: 'turkey', quantity: 0 }]);
  };

  const updateInlineSandwichType = (index: number, field: 'type' | 'quantity', value: string | number) => {
    setInlineSandwichTypes(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const removeInlineSandwichType = (index: number) => {
    setInlineSandwichTypes(prev => prev.filter((_, i) => i !== index));
  };

  const quickToggleBoolean = (id: number, field: 'isConfirmed' | 'addedToOfficialSheet' | 'showOnVolunteerHub', currentValue: boolean) => {
    const data: Record<string, any> = { [field]: !currentValue };
    // Track when the event was added to the official sheet
    if (field === 'addedToOfficialSheet') {
      data.addedToOfficialSheetAt = !currentValue ? new Date().toISOString() : null;
    }
    updateEventRequestMutation.mutate({ id, data });
  };

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

  const handleReschedule = (request: EventRequest) => {
    setRescheduleRequest(request);
    setShowRescheduleDialog(true);
  };

  const performReschedule = async (eventId: number, data: {
    status: string;
    scheduledEventDate: string;
    originalScheduledDate?: string | Date | null;
    postponementNotes?: string;
  }) => {
    await updateEventRequestMutation.mutateAsync({ id: eventId, data });
    setShowRescheduleDialog(false);
    setRescheduleRequest(null);
  };

  const performDuplicate = async (newEventData: Partial<EventRequest>) => {
    await createEventRequestMutation.mutateAsync(newEventData);
    setShowDuplicateDialog(false);
    setDuplicateSourceRequest(null);
  };

  return (
    <>
      {/* Event count */}
      <div className="text-sm text-gray-600 mb-4 px-4">
        {isLoading ? 'Loading...' : `${scheduledRequests.length} scheduled event${scheduledRequests.length !== 1 ? 's' : ''}`}
      </div>

      {!isMobile && viewMode === 'spreadsheet' ? (
        <ScheduledSpreadsheetView
          onEventDateClick={(event) => {
            setSelectedEventRequest(event);
            trackEvent('scheduled_tab_view_mode_toggle', {
              view_mode: 'card',
              previous_mode: 'spreadsheet',
              source: 'spreadsheet_event_click',
              event_id: event.id,
            });
            setViewMode('card');
            // Scroll to the card after React has rendered the card view
            setTimeout(() => {
              const cardElement = document.querySelector(`[data-event-id="${event.id}"]`);
              if (cardElement) {
                cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                // If card not found, try again after a longer delay
                setTimeout(() => {
                  const retryElement = document.querySelector(`[data-event-id="${event.id}"]`);
                  if (retryElement) {
                    retryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }, 200);
              }
            }, 150);
          }}
          openAssignmentDialog={openAssignmentDialog}
        />
      ) : isLoading ? (
        <EventListSkeleton count={5} />
      ) : scheduledRequests.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No scheduled events
        </div>
      ) : (
        <EventListBatchProviders events={scheduledRequests}>
          <div className="space-y-4 max-w-7xl mx-auto px-2 sm:px-4">
            {scheduledRequests.map((request) => (
              <div key={request.id} className="w-full" data-event-id={request.id}>
                <ScheduledCardEnhanced
                request={request}
                editingField={editingField}
                editingValue={editingValue}
                isEditingThisCard={editingScheduledId === request.id}
                inlineSandwichMode={inlineSandwichMode}
                inlineTotalCount={inlineTotalCount}
                inlineSandwichTypes={inlineSandwichTypes}
                inlineRangeMin={inlineRangeMin}
                inlineRangeMax={inlineRangeMax}
                inlineRangeType={inlineRangeType}
                isSaving={updateEventRequestMutation.isPending || updateScheduledFieldMutation.isPending}
                onEdit={() => {
                  setSelectedEventRequest(request);
                  setIsEditing(true);
                  openDialog('eventDetails');
                }}
                onDelete={() => deleteEventRequestMutation.mutate(request.id)}
                onContact={() => {
                  setContactEventRequest(request);
                  openDialog('contactOrganizer');
                }}
                onLogContact={() => {
                  setLogContactEventRequest(request);
                  openDialog('logContact');
                }}
                onReschedule={() => {
                  setRescheduleRequest(request);
                  setShowRescheduleDialog(true);
                }}
                onCancelEvent={async () => {
                  const result = await handleStatusChange(request.id, 'cancelled');
                  if (result === 'needs_reason') {
                    setReasonDialogEventRequest(request);
                    openDialog('cancel');
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
                onAiIntakeAssist={() => {
                  setAiIntakeAssistantEventRequest(request);
                  openDialog('aiIntakeAssistant');
                }}
                startEditing={(field, value) => startEditing(request.id, field, value)}
                saveEdit={saveEdit}
                cancelEdit={cancelEdit}
                setEditingValue={setEditingValue}
                saveTimes={(data) => saveTimes(request.id, data)}
                tempIsConfirmed={tempIsConfirmed}
                setTempIsConfirmed={setTempIsConfirmed}
                quickToggleBoolean={(field, value) => quickToggleBoolean(request.id, field, value)}
                setInlineSandwichMode={setInlineSandwichMode}
                setInlineTotalCount={setInlineTotalCount}
                setInlineRangeMin={setInlineRangeMin}
                setInlineRangeMax={setInlineRangeMax}
                setInlineRangeType={setInlineRangeType}
                addInlineSandwichType={addInlineSandwichType}
                updateInlineSandwichType={updateInlineSandwichType}
                removeInlineSandwichType={removeInlineSandwichType}
                resolveUserName={resolveUserName}
                resolveRecipientName={resolveRecipientName}
                openAssignmentDialog={(type, isVanDriver) => openAssignmentDialog(request.id, type, isVanDriver)}
                handleRemoveAssignment={(type, personId) => handleRemoveAssignment(personId, type, request.id)}
                quickUpdateField={(field, value) => {
                  updateScheduledFieldMutation.mutate({
                    id: request.id,
                    field,
                    value,
                  });
                }}
                canEdit={true}
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
              />
              </div>
            ))}
          </div>
        </EventListBatchProviders>
      )}

    <RescheduleDialog
      isOpen={showRescheduleDialog}
      onClose={() => {
        setShowRescheduleDialog(false);
        setRescheduleRequest(null);
      }}
      request={rescheduleRequest}
      onConfirm={performReschedule}
    />
    <DuplicateEventDialog
      isOpen={showDuplicateDialog}
      onClose={() => {
        setShowDuplicateDialog(false);
        setDuplicateSourceRequest(null);
      }}
      request={duplicateSourceRequest}
      onConfirm={performDuplicate}
    />
    {ConfirmationDialogComponent}
  </>
  );
};
