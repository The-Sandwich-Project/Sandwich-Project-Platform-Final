import React, { useState } from 'react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventFilters } from '../hooks/useEventFilters';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { NewRequestCard } from '../cards/NewRequestCard';
import { ScheduledCardEnhanced } from '../cards/ScheduledCardEnhanced';
import { CompletedCard } from '../cards/CompletedCard';
import { InProcessCard } from '../cards/InProcessCard';
import { DeclinedCard } from '../cards/DeclinedCard';
import { DuplicateEventDialog } from '../dialogs/DuplicateEventDialog';
import { EventListBatchProviders } from '../EventListBatchProviders';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Filter } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { EventRequest } from '@shared/schema';
import { useLinkedCollectionTotals } from '../hooks/useLinkedCollectionTotals';

export const MyAssignmentsTab: React.FC = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { filterRequestsByStatus } = useEventFilters();
  const { deleteEventRequestMutation, updateEventRequestMutation, updateScheduledFieldMutation, toggleCorporatePriorityMutation, createEventRequestMutation } = useEventMutations();
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

  // State for confirmation checkbox when editing dates (needed for ScheduledCardEnhanced)
  const [tempIsConfirmed, setTempIsConfirmed] = useState(false);

  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateSourceRequest, setDuplicateSourceRequest] = useState<EventRequest | null>(null);

  const {
    isLoading,
    myAssignmentsStatusFilter,
    setMyAssignmentsStatusFilter,
  } = useEventRequestContext();

  const {
    setSelectedEventRequest,
    setIsEditing,
    setSchedulingEventRequest,
    setToolkitEventRequest,
    setContactEventRequest,
    setTspContactEventRequest,
    setCollectionLogEventRequest,
    setLogContactEventRequest,
    setIntakeCallEventRequest,
    setNextActionEventRequest,
    setNextActionMode,
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
    editingCompletedId,
    setEditingCompletedId,
    completedEdit,
    setCompletedEdit,
    setReasonDialogEventRequest,
    setNonEventDialogEventRequest,
    openDialog,
  } = useEventDialogState();

  // Helper functions for ScheduledCardEnhanced
  const quickToggleBoolean = (id: number, field: 'isConfirmed' | 'addedToOfficialSheet' | 'showOnVolunteerHub', currentValue: boolean) => {
    const data: Record<string, any> = { [field]: !currentValue };
    if (field === 'addedToOfficialSheet') {
      data.addedToOfficialSheetAt = !currentValue ? new Date().toISOString() : null;
    }
    updateEventRequestMutation.mutate({ id, data });
  };

  const addInlineSandwichType = () => {
    setInlineSandwichTypes((prev: Array<{ type: string; quantity: number }>) => [...prev, { type: 'turkey', quantity: 0 }]);
  };

  const updateInlineSandwichType = (index: number, field: 'type' | 'quantity', value: string | number) => {
    setInlineSandwichTypes((prev: Array<{ type: string; quantity: number }>) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const removeInlineSandwichType = (index: number) => {
    setInlineSandwichTypes((prev: Array<{ type: string; quantity: number }>) => prev.filter((_, i) => i !== index));
  };

  const saveTimes = (id: number, data: any) => {
    updateEventRequestMutation.mutate({
      id,
      data,
    });
    setEditingScheduledId(null);
    setEditingField(null);
    setEditingValue('');
  };

  const myAssignments = filterRequestsByStatus('my_assignments');
  const { data: loggedTotals } = useLinkedCollectionTotals(
    myAssignments
      .filter((r: EventRequest) => r.status === 'completed')
      .map((r: EventRequest) => r.id)
  );

  const toggleStatusFilter = (status: string) => {
    setMyAssignmentsStatusFilter((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
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

  // Function to render appropriate card based on status
  const renderEventCard = (request: any) => {
    const commonProps = {
      key: request.id,
      request,
      onEdit: () => {
        setSelectedEventRequest(request);
        setIsEditing(true);
        openDialog('eventDetails');
      },
      onDelete: () => deleteEventRequestMutation.mutate(request.id),
      onCall: () => handleCall(request),
      onContact: () => {
        setContactEventRequest(request);
        openDialog('contactOrganizer');
      },
      onDuplicate: () => {
        setDuplicateSourceRequest(request);
        setShowDuplicateDialog(true);
      },
    };

    switch (request.status) {
      case 'new':
        return (
          <NewRequestCard
            {...commonProps}
            onIntakeCall={() => {
              setIntakeCallEventRequest(request);
              openDialog('intakeCall');
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
            onScheduleCall={() => {
              setSelectedEventRequest(request);
              openDialog('scheduleCall');
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
            onToggleCorporatePriority={(isCorporatePriority) => {
              toggleCorporatePriorityMutation.mutate({
                id: request.id,
                isCorporatePriority
              });
            }}
          />
        );

      case 'in_process':
        return (
          <InProcessCard
            {...commonProps}
            resolveUserName={resolveUserName}
            onSchedule={() => {
              setSelectedEventRequest(request);
              setSchedulingEventRequest(request);
              openDialog('scheduling');
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
        );

      case 'scheduled':
        return (
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
            onReschedule={() => {
              // Handle reschedule if needed
            }}
            onCancelEvent={async () => {
              const result = await handleStatusChange(request.id, 'cancelled');
              if (result === 'needs_reason') {
                setReasonDialogEventRequest(request);
                openDialog('cancel');
              }
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
            startEditing={(field, value) => {
              setEditingScheduledId(request.id);
              setEditingField(field);
              setEditingValue(value || '');
            }}
            saveEdit={() => {
              if (editingScheduledId && editingField) {
                updateScheduledFieldMutation.mutate({
                  id: editingScheduledId,
                  field: editingField,
                  value: editingValue,
                });
              }
            }}
            cancelEdit={() => {
              setEditingScheduledId(null);
              setEditingField(null);
              setEditingValue('');
            }}
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
        );

      case 'completed':
        return (
          <CompletedCard
            {...commonProps}
            loggedSandwiches={loggedTotals ? loggedTotals[request.id] ?? null : undefined}
            onView={() => {
              setSelectedEventRequest(request);
              setIsEditing(false);
              openDialog('eventDetails');
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
              if (window.confirm('Do you want to create a new event request based on this completed event?')) {
                handleStatusChange(request.id, 'new');
              }
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
            resolveUserName={resolveUserName}
            openAssignmentDialog={(type, isVanDriver) => openAssignmentDialog(request.id, type, isVanDriver)}
            openEditAssignmentDialog={(type, personId) => openEditAssignmentDialog(request.id, type, personId)}
            handleRemoveAssignment={(type, personId) => handleRemoveAssignment(personId, type, request.id)}
            handleSelfSignup={(type) => handleSelfSignup(request.id, type)}
            canSelfSignup={canSelfSignup}
            isUserSignedUp={isUserSignedUp}
          />
        );

      case 'declined':
        return (
          <DeclinedCard
            {...commonProps}
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
            resolveUserName={resolveUserName}
          />
        );

      default:
        return (
          <NewRequestCard
            {...commonProps}
            onIntakeCall={() => {
              setIntakeCallEventRequest(request);
              openDialog('intakeCall');
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
            onScheduleCall={() => {
              setSelectedEventRequest(request);
              openDialog('scheduleCall');
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
            onToggleCorporatePriority={(isCorporatePriority) => {
              toggleCorporatePriorityMutation.mutate({
                id: request.id,
                isCorporatePriority
              });
            }}
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Dropdown */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">
          {isLoading ? (
            'Loading...'
          ) : myAssignments.length === 0 ? (
            'No assignments found with selected filters'
          ) : (
            <>Showing {myAssignments.length} assignment{myAssignments.length !== 1 ? 's' : ''}</>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              Filter Status
              {myAssignmentsStatusFilter.length < 7 && (
                <Badge variant="secondary" className="ml-2">
                  {myAssignmentsStatusFilter.length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('new')}
              onCheckedChange={() => toggleStatusFilter('new')}
            >
              <Badge className="bg-blue-100 text-blue-800 border-blue-300 mr-2">
                New
              </Badge>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('in_process')}
              onCheckedChange={() => toggleStatusFilter('in_process')}
            >
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 mr-2">
                In Process
              </Badge>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('scheduled')}
              onCheckedChange={() => toggleStatusFilter('scheduled')}
            >
              <Badge className="bg-green-100 text-green-800 border-green-300 mr-2">
                Scheduled
              </Badge>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('completed')}
              onCheckedChange={() => toggleStatusFilter('completed')}
            >
              <Badge className="bg-teal-100 text-teal-800 border-teal-300 mr-2">
                Completed
              </Badge>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('declined')}
              onCheckedChange={() => toggleStatusFilter('declined')}
            >
              <Badge className="bg-orange-100 text-orange-800 border-orange-300 mr-2">
                Declined
              </Badge>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={myAssignmentsStatusFilter.includes('cancelled')}
              onCheckedChange={() => toggleStatusFilter('cancelled')}
            >
              <Badge className="bg-red-100 text-red-800 border-red-300 mr-2">
                Cancelled
              </Badge>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">
          Loading your assignments...
        </div>
      ) : myAssignments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="mb-2">No assignments found</div>
          <div className="text-sm">
            No events found matching your filter criteria where you are assigned as TSP contact, driver, speaker, or volunteer.
          </div>
        </div>
      ) : (
        <EventListBatchProviders events={myAssignments}>
        <div className="space-y-4" data-tour="my-assignments-list">
          {myAssignments.map((request) => (
            <div
              key={request.id}
              className="border-2 border-[#47B3CB] rounded-lg p-1 bg-[#47B3CB]/5 shadow-sm hover:shadow-md transition-all"
            >
              {renderEventCard(request)}
            </div>
          ))}
        </div>
        </EventListBatchProviders>
      )}
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
    </div>
  );
};