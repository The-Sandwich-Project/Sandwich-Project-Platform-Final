import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useErrorToast } from '@/hooks/use-error-toast';
import { apiRequest, invalidateEventRequestQueries, applyPatchResponseToCache, applyEventRequestSaveToCache, patchEventInListCaches, refreshEventRequestListAndCounts, findEventInListCaches, describeApiError, isServerUnavailableError } from '@/lib/queryClient';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { logger } from '@/lib/logger';

export const useEventMutations = () => {
  const { toast } = useToast();
  const { errorToast } = useErrorToast();
  const queryClient = useQueryClient();
  const {
    selectedEventRequest,
    setSelectedEventRequest,
    setIsEditing,
    setToolkitEventRequest,
    setScheduleCallDate,
    setScheduleCallTime,
    setFollowUpNotes,
    setEditingScheduledId,
    setEditingField,
    setEditingValue,
    closeDialog,
  } = useEventDialogState();

  const eventReportContext = () =>
    selectedEventRequest?.id
      ? {
          recordType: 'event_request' as const,
          recordId: String(selectedEventRequest.id),
          recordLabel: selectedEventRequest.organizationName || undefined,
        }
      : {};

  const deleteEventRequestMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest('DELETE', `/api/event-requests/${id}`),
    onSuccess: async (_, deletedId) => {
      const { dismiss } = toast({
        title: 'Event request deleted',
        description: 'Click Undo to restore',
        duration: 10000,
        action: (
          <button
            onClick={async () => {
              try {
                await apiRequest('POST', `/api/event-requests/${deletedId}/restore`);
                await invalidateEventRequestQueries(queryClient);
                dismiss();
                toast({
                  title: 'Event request restored',
                  description: 'The event request has been successfully restored.',
                });
              } catch (error) {
                errorToast({
                  title: 'Error',
                  description: 'Failed to restore event request.',
                  report: { whatDoing: 'Undo delete event request', ...eventReportContext() },
                });
              }
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Undo
          </button>
        ),
      });
      await invalidateEventRequestQueries(queryClient);
      closeDialog('eventDetails');
      setSelectedEventRequest(null);
    },
    onError: (error: any) => {
      const errorMessage = error?.data?.message || error?.message || 'Failed to delete event request.';
      errorToast({
        title: 'Error',
        description: errorMessage,
        report: { whatDoing: 'Delete an event request', ...eventReportContext() },
      });
    },
  });

  const updateEventRequestMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      logger.log('=== UPDATE MUTATION ===');
      logger.log('Event ID:', id);
      logger.log('Data being sent:', JSON.stringify(data, null, 2));

      // Row-level updatedAt locking was removed server-side (PR #417) and the
      // legacy _expectedVersion field is ignored/stripped there. Keep the
      // client payload clean so this path behaves like the other PATCH flows.
      const { _skipVersionCheck, ...rest } = data;
      const payload = { ...rest };

      return apiRequest('PATCH', `/api/event-requests/${id}`, payload);
    },
    onSuccess: async (updatedEvent, variables) => {
      logger.log('=== UPDATE SUCCESS ===');
      logger.log('Updated event:', updatedEvent);
      logger.log('Variables:', variables);

      const orgName = updatedEvent?.organizationName || 'Event';

      // Server attaches _droppedFields when it silently skipped any fields during processing
      // (invalid dates, missing columns, permission-gated fields, etc.). Surface that to the user
      // so silent drops never go unnoticed again.
      const droppedFields: Array<{ field: string; reason: string }> | undefined = updatedEvent?._droppedFields;
      if (Array.isArray(droppedFields) && droppedFields.length > 0) {
        logger.warn('Save succeeded but some fields were dropped:', droppedFields);
        const summary = droppedFields
          .map((d) => `• ${d.field}: ${d.reason}`)
          .join('\n');
        errorToast({
          title: '⚠️ Partial Save',
          description: `Saved "${orgName}" — but the following fields were not saved:\n${summary}`,
          duration: Number.POSITIVE_INFINITY,
          report: {
            whatDoing: 'Save changes to an event request',
            expectedOutcome: 'All edited fields should be saved to the database.',
            actualOutcome: `Partial save — fields dropped: ${summary}`,
            ...eventReportContext(),
          },
        });
      } else {
        toast({
          title: '✓ Changes Saved Successfully',
          description: `Your changes to "${orgName}" have been saved to the database.`,
          duration: 8000,
        });
      }

      // Patch caches surgically — infer status change from the cached row (or the
      // open dialog event), not only selectedEventRequest (card actions like
      // Approve often run with no dialog open).
      const previousStatus =
        findEventInListCaches(queryClient, variables.id)?.status ??
        (selectedEventRequest?.id === variables.id ? selectedEventRequest.status : undefined);

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus,
        touchedFields: Object.keys(variables.data || {}),
      });

      closeDialog('eventDetails');
      setSelectedEventRequest(null);
      setIsEditing(false);

      // Clear inline editing state as well
      setEditingScheduledId(null);
      setEditingField(null);
      setEditingValue('');
    },
    onError: async (error: any) => {
      logger.error('Update event request error:', error);

      const status = error?.status;
      const isNetworkError = error?.message?.includes('Failed to fetch') ||
                            error?.message?.includes('Request timeout') ||
                            error?.code?.includes('NETWORK_ERROR');
      const isConflict = status === 409 || error?.code?.includes('CONFLICT');
      const isPermissionDenied = status === 403;
      const isUnauthenticated = status === 401;

      const serverMessage = error?.data?.message ||
                           error?.message ||
                           error?.details;
      const missingFields = error?.data?.missingFields;

      let errorTitle = 'Save Failed';
      let errorDescription = serverMessage || 'Failed to update event request. Please check your data and try again.';

      if (missingFields && Array.isArray(missingFields) && missingFields.length > 0) {
        errorDescription = `${serverMessage || 'Missing required fields:'} ${missingFields.join(', ')}`;
      }

      if (isConflict) {
        errorTitle = 'Edit Conflict';
        errorDescription = 'This event was modified by another user or process. The latest data has been loaded — please reapply your changes and save again.';
        // Refresh list/counts and re-fetch the selected event so the next save starts from fresh data.
        await refreshEventRequestListAndCounts(queryClient);
        if (selectedEventRequest?.id) {
          try {
            const fresh = await apiRequest('GET', `/api/event-requests/${selectedEventRequest.id}`);
            setSelectedEventRequest(fresh);
          } catch {
            // best-effort — list refresh above will repopulate next time the dialog is opened
          }
        }
      } else if (isPermissionDenied) {
        errorTitle = 'Permission Denied';
        errorDescription = "Your account doesn't have permission to edit events. Ask an admin to grant you the EVENT_REQUESTS_EDIT permission.";
      } else if (isUnauthenticated) {
        errorTitle = 'Session Expired';
        errorDescription = 'Your session has expired. Please refresh the page and sign in again.';
      } else if (isNetworkError) {
        errorTitle = 'Connection Error';
        errorDescription = 'Could not save changes. Please check your internet connection and try again.';
      } else if (isServerUnavailableError(error)) {
        const described = describeApiError(error);
        errorTitle = described.title;
        errorDescription = described.description;
      } else {
        const described = describeApiError(error, errorDescription);
        errorTitle = described.title === 'Error' ? errorTitle : described.title;
        errorDescription = described.description;
      }

      errorToast({
        title: errorTitle,
        description: errorDescription,
        // Save failures are sticky — they don't auto-dismiss. User must click ✕ to acknowledge,
        // so silent failures stop slipping past busy operators.
        duration: Number.POSITIVE_INFINITY,
        report: {
          whatDoing: 'Save changes to an event request',
          ...eventReportContext(),
        },
      });
    },
  });

  const createEventRequestMutation = useMutation({
    mutationFn: async (data: any) => {
      logger.log('=== CREATE EVENT MUTATION STARTED ===');
      logger.log('Data being sent:', JSON.stringify(data, null, 2));
      const result = await apiRequest('POST', '/api/event-requests', data);
      logger.log('=== CREATE EVENT API RESPONSE ===');
      logger.log('Response:', result);
      return result;
    },
    onSuccess: (data) => {
      logger.log('=== CREATE EVENT SUCCESS HANDLER ===');
      logger.log('Created event:', data);

      const orgName = data?.organizationName || 'New event';
      toast({
        title: '✓ Event Created Successfully',
        description: `"${orgName}" has been created and saved to the database.`,
        duration: 8000,
      });

      // Close immediately — the event is already saved. Refresh lists in the
      // background so the dialog doesn't sit on "Creating..." while every
      // event/volunteer-hub query refetches.
      closeDialog('eventDetails');
      setSelectedEventRequest(null);
      setIsEditing(false);
      void refreshEventRequestListAndCounts(queryClient);
    },
    onError: (error: any) => {
      logger.error('Create event request error:', error);

      // Check for network/timeout errors
      const isNetworkError = error?.message?.includes('Failed to fetch') ||
                            error?.message?.includes('Request timeout') ||
                            error?.code?.includes('NETWORK_ERROR');

      let errorTitle = 'Creation Failed';
      let errorDescription = error?.data?.message || error?.message || 'Failed to create event request. Please check your data and try again.';

      if (isNetworkError) {
        errorTitle = 'Connection Error';
        errorDescription = 'Could not create event. Please check your internet connection and try again.';
      }

      errorToast({
        title: errorTitle,
        description: errorDescription,
        duration: 10000,
        report: { whatDoing: 'Create a new event request' },
      });
    },
  });

  const markToolkitSentMutation = useMutation({
    mutationFn: ({
      id,
      toolkitSentDate,
      contactAttempt,
    }: {
      id: number;
      toolkitSentDate: string;
      contactAttempt?: {
        method: string;
        outcome: string;
        notes?: string;
      };
    }) =>
      apiRequest('PATCH', `/api/event-requests/${id}/toolkit-sent`, {
        toolkitSentDate,
        contactAttempt,
      }),
    onSuccess: async (updatedEvent, variables) => {
      const message = variables.contactAttempt
        ? 'Toolkit marked as sent and phone call logged.'
        : 'Event status updated to "In Process".';
      toast({
        title: 'Toolkit marked as sent',
        description: message,
      });
      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus:
          findEventInListCaches(queryClient, variables.id)?.status ??
          (selectedEventRequest?.id === variables.id ? selectedEventRequest.status : undefined),
        touchedFields: ['toolkitSentDate', 'status', 'contactAttempts'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }

      // markToolkitSentMutation is shared by two dialogs:
      //   - 'toolkitSent'  (log-only path)
      //   - 'sendToolkit'  (send-email path)
      // Passing the dialog name to closeDialog would only close it if
      // that name happens to be the active one — when the OTHER dialog
      // is the active one, the call silently no-ops and leaves the
      // dialog stuck open after a successful save. Close whichever
      // dialog is active by omitting the argument.
      closeDialog();
      setToolkitEventRequest(null);
    },
    onError: (error: any) => {
      errorToast({
        title: 'Error',
        description: error?.data?.message || error?.message || 'Failed to mark toolkit as sent.',
        report: { whatDoing: 'Mark toolkit as sent', ...eventReportContext() },
      });
    },
  });

  const scheduleCallMutation = useMutation({
    mutationFn: ({
      id,
      scheduledCallDate,
    }: {
      id: number;
      scheduledCallDate: string;
    }) =>
      apiRequest('PATCH', `/api/event-requests/${id}/schedule-call`, {
        scheduledCallDate,
      }),
    onSuccess: async (updatedEvent, variables) => {
      toast({
        title: 'Call scheduled',
        description: 'Call has been scheduled successfully.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['scheduledCallDate'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }

      closeDialog('scheduleCall');
      setScheduleCallDate('');
      setScheduleCallTime('');
    },
    onError: (error: any) => {
      errorToast({
        title: 'Error',
        description: error?.data?.message || error?.message || 'Failed to schedule call.',
        report: { whatDoing: 'Schedule an intake call', ...eventReportContext() },
      });
    },
  });

  const updateScheduledFieldMutation = useMutation({
    mutationFn: ({
      id,
      field,
      value,
    }: {
      id: number;
      field: string;
      value: any;
    }) => {
      // Send only the edited field. The server's shared estimate rule
      // (shared/sandwich-estimate.ts) keeps the count, range and type
      // breakdown consistent: a new count keeps a single type, and a types
      // edit without amounts keeps the existing total. Clearing the other
      // fields here used to wipe the estimate (e.g. a type picked with no
      // quantity sent count: null).
      const payload: Record<string, unknown> = { [field]: value };


      return apiRequest('PATCH', `/api/event-requests/${id}`, payload);
    },
    // KEEP (Unit 2 decision, 2026-06-25): this is the one intentional optimistic
    // update left in the event-requests path. It targets the correct
    // `/api/event-requests/list` cache family (via patchEventInListCaches), cancels
    // in-flight list fetches, snapshots for rollback, and reverts in onError. Inline
    // scheduled-field edits (spreadsheet/card cells) need pre-response feedback so the
    // cell doesn't visibly lag a round-trip before committing — onSuccess's surgical
    // applyEventRequestSaveToCache alone would leave that gap. The bug Unit 2 looked
    // for was optimistic writes to DEAD keys (['/api/event-requests'] / [...,'v2']);
    // an audit confirmed none remain, so this correct-key patch stays.
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === '/api/event-requests/list',
      });

      const previousLists = new Map<readonly unknown[], unknown>();
      queryClient.getQueryCache().findAll({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === '/api/event-requests/list',
      }).forEach((query) => {
        previousLists.set(query.queryKey, queryClient.getQueryData(query.queryKey));
      });

      // Optimistic: just the edited field; the saved row (with the server's
      // reconciled estimate) replaces it in onSuccess.
      patchEventInListCaches(queryClient, id, (existing) => ({
        ...existing,
        [field]: value,
      }));

      return { previousLists };
    },
    onSuccess: async (updatedEvent, variables) => {
      toast({
        title: 'Field updated',
        description: 'Event field has been updated successfully.',
      });

      await applyEventRequestSaveToCache(queryClient, updatedEvent, {
        touchedFields: [variables.field],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }

      setEditingScheduledId(null);
      setEditingField(null);
      setEditingValue('');
    },
    onError: async (error: any, _vars, context) => {
      context?.previousLists?.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
      logger.error('Inline field update error:', error);

      const status = error?.status;
      let errorTitle = 'Save Failed';
      let errorDescription = error?.data?.message || error?.message || 'Failed to update field.';

      if (status === 403) {
        errorTitle = 'Permission Denied';
        errorDescription = "Your account doesn't have permission to edit events. Ask an admin to grant you the EVENT_REQUESTS_EDIT permission.";
      } else if (status === 401) {
        errorTitle = 'Session Expired';
        errorDescription = 'Your session has expired. Please refresh the page and sign in again.';
      } else if (status === 409) {
        errorTitle = 'Edit Conflict';
        errorDescription = 'This event was modified by another user or process. The latest data has been loaded — please try your edit again.';
        await refreshEventRequestListAndCounts(queryClient);
      }

      errorToast({
        title: errorTitle,
        description: errorDescription,
        // Sticky toast so a quick destructive error isn't missed during busy editing sessions.
        duration: Number.POSITIVE_INFINITY,
        report: {
          whatDoing: 'Edit an event field inline on the card',
          ...eventReportContext(),
        },
      });
    },
  });

  const oneDayFollowUpMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      apiRequest('PATCH', `/api/event-requests/${id}`, {
        followUpOneDayCompleted: true,
        followUpOneDayDate: new Date().toISOString(),
        followUpNotes: notes,
      }),
    onSuccess: async (updatedEvent, variables) => {
      toast({
        title: '1-day follow-up completed',
        description: 'Follow-up has been marked as completed.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['followUpOneDayCompleted', 'followUpOneDayDate', 'followUpNotes'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }

      closeDialog('oneDayFollowUp');
      setFollowUpNotes('');
    },
    onError: (error: any) => {
      errorToast({
        title: 'Error',
        description: error?.data?.message || error?.message || 'Failed to complete follow-up.',
        report: { whatDoing: 'Complete 1-day follow-up', ...eventReportContext() },
      });
    },
  });

  const oneMonthFollowUpMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      apiRequest('PATCH', `/api/event-requests/${id}`, {
        followUpOneMonthCompleted: true,
        followUpOneMonthDate: new Date().toISOString(),
        followUpNotes: notes,
      }),
    onSuccess: async (updatedEvent, variables) => {
      toast({
        title: '1-month follow-up completed',
        description: 'Follow-up has been marked as completed.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['followUpOneMonthCompleted', 'followUpOneMonthDate', 'followUpNotes'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }

      closeDialog('oneMonthFollowUp');
      setFollowUpNotes('');
    },
    onError: (error: any) => {
      errorToast({
        title: 'Error',
        description: error?.data?.message || error?.message || 'Failed to complete follow-up.',
        report: { whatDoing: 'Complete 1-month follow-up', ...eventReportContext() },
      });
    },
  });

  const rescheduleEventMutation = useMutation({
    mutationFn: ({ id, newDate, previousDate }: { id: number; newDate: Date; previousDate?: string | null }) =>
      apiRequest('PATCH', `/api/event-requests/${id}`, {
        scheduledEventDate: newDate.toISOString(),
      }),
    onSuccess: async (updatedEvent, variables) => {
      const { id, newDate, previousDate } = variables;
      const newDateStr = newDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const prevDateStr = previousDate
        ? new Date(previousDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;

      // Show toast with undo action if we have a previous date
      if (previousDate) {
        const { dismiss } = toast({
          title: 'Event rescheduled',
          description: `Date changed to ${newDateStr}. Click Undo to restore.`,
          duration: 10000,
          action: (
            <button
              onClick={async () => {
                try {
                  const restored = await apiRequest('PATCH', `/api/event-requests/${id}`, {
                    scheduledEventDate: previousDate,
                  });
                  await applyPatchResponseToCache(queryClient, restored, {
                    touchedFields: ['scheduledEventDate'],
                  });
                  dismiss();
                  toast({
                    title: 'Date restored',
                    description: `Event date restored to ${prevDateStr}.`,
                  });
                } catch (error) {
                  errorToast({
                    title: 'Restore failed',
                    description: 'Failed to restore event date.',
                    report: { whatDoing: 'Undo event reschedule', ...eventReportContext() },
                  });
                }
              }}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Undo
            </button>
          ),
        });
      } else {
        toast({
          title: 'Event rescheduled',
          description: `The event date has been set to ${newDateStr}.`,
        });
      }

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['scheduledEventDate'],
      });
    },
    onError: (error: any) => {
      errorToast({
        title: 'Error',
        description: error?.data?.message || error?.message || 'Failed to reschedule event.',
        report: { whatDoing: 'Reschedule an event', ...eventReportContext() },
      });
    },
  });

  // Recipient assignment mutation - uses the specific recipients endpoint
  const assignRecipientsMutation = useMutation({
    mutationFn: ({ id, assignedRecipientIds, recipientAllocations }: {
      id: number;
      assignedRecipientIds?: string[];
      recipientAllocations?: Array<{
        recipientId: string;
        recipientName: string;
        sandwichCount: number;
        sandwichType?: string;
        notes?: string;
      }>;
    }) => {
      logger.log('=== RECIPIENT ASSIGNMENT MUTATION ===');
      logger.log('Event ID:', id);
      logger.log('Recipient IDs:', assignedRecipientIds);
      logger.log('Recipient Allocations:', recipientAllocations);
      return apiRequest('PATCH', `/api/event-requests/${id}/recipients`, { assignedRecipientIds, recipientAllocations });
    },
    onSuccess: async (updatedEvent, variables) => {
      logger.log('=== RECIPIENT ASSIGNMENT SUCCESS ===');
      logger.log('Updated event:', updatedEvent);

      toast({
        title: 'Recipients assigned',
        description: 'Recipients have been successfully assigned to this event.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['assignedRecipientIds', 'recipientAllocations'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }
    },
    onError: (error: any) => {
      logger.error('=== RECIPIENT ASSIGNMENT ERROR ===');
      logger.error(error);

      errorToast({
        title: 'Failed to assign recipients',
        description: error?.data?.message || error?.message || 'There was an error assigning recipients to this event.',
        report: { whatDoing: 'Assign recipients to an event', ...eventReportContext() },
      });
    },
  });

  // TSP contact assignment mutation - uses the specific tsp-contact endpoint
  const assignTspContactMutation = useMutation({
    mutationFn: ({ id, tspContact, customTspContact }: { id: number; tspContact?: string | null; customTspContact?: string | null }) => {
      logger.log('=== TSP CONTACT ASSIGNMENT MUTATION ===');
      logger.log('Event ID:', id);
      logger.log('TSP Contact:', tspContact);
      logger.log('Custom TSP Contact:', customTspContact);
      return apiRequest('PATCH', `/api/event-requests/${id}/tsp-contact`, { tspContact, customTspContact });
    },
    onSuccess: async (updatedEvent, variables) => {
      logger.log('=== TSP CONTACT ASSIGNMENT SUCCESS ===');
      logger.log('Updated event:', updatedEvent);

      const isRemoval = !variables.tspContact && !variables.customTspContact;
      const isCustom = !!variables.customTspContact;

      toast({
        title: isRemoval ? 'TSP contact removed' : 'TSP contact assigned',
        description: isRemoval
          ? 'The TSP contact assignment has been cleared.'
          : isCustom
            ? 'Custom TSP contact has been successfully assigned.'
            : 'TSP contact has been successfully assigned and notified.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['tspContact', 'customTspContact'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }
    },
    onError: (error: any) => {
      logger.error('=== TSP CONTACT ASSIGNMENT ERROR ===');
      logger.error(error);

      errorToast({
        title: 'Failed to assign TSP contact',
        description: error?.data?.message || error?.message || 'There was an error assigning the TSP contact to this event.',
        report: { whatDoing: 'Assign TSP contact to an event', ...eventReportContext() },
      });
    },
  });

  // Corporate priority toggle mutation
  const toggleCorporatePriorityMutation = useMutation({
    mutationFn: ({ id, isCorporatePriority, coreTeamMemberNotes }: {
      id: number;
      isCorporatePriority: boolean;
      coreTeamMemberNotes?: string;
    }) => {
      logger.log('=== CORPORATE PRIORITY TOGGLE MUTATION ===');
      logger.log('Event ID:', id);
      logger.log('Corporate Priority:', isCorporatePriority);
      return apiRequest('PATCH', `/api/event-requests/${id}/corporate-priority`, {
        isCorporatePriority,
        coreTeamMemberNotes
      });
    },
    onSuccess: async (updatedEvent, variables) => {
      logger.log('=== CORPORATE PRIORITY TOGGLE SUCCESS ===');
      logger.log('Updated event:', updatedEvent);

      const action = variables.isCorporatePriority ? 'marked as' : 'removed from';
      toast({
        title: `Event ${action} Corporate Priority`,
        description: variables.isCorporatePriority
          ? 'Christine and Katie have been notified. This event requires immediate attention and core team member assignment.'
          : 'This event is no longer marked as corporate priority.',
      });

      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: selectedEventRequest?.status,
        touchedFields: ['isCorporatePriority', 'coreTeamMemberNotes'],
      });

      if (selectedEventRequest && selectedEventRequest.id === variables.id) {
        setSelectedEventRequest(updatedEvent);
      }
    },
    onError: (error: any) => {
      logger.error('=== CORPORATE PRIORITY TOGGLE ERROR ===');
      logger.error(error);

      errorToast({
        title: 'Failed to update corporate priority',
        description: error?.data?.message || error?.message || 'There was an error updating the corporate priority status.',
        report: { whatDoing: 'Toggle corporate priority on an event', ...eventReportContext() },
      });
    },
  });

  return {
    deleteEventRequestMutation,
    updateEventRequestMutation,
    createEventRequestMutation,
    markToolkitSentMutation,
    scheduleCallMutation,
    updateScheduledFieldMutation,
    oneDayFollowUpMutation,
    oneMonthFollowUpMutation,
    rescheduleEventMutation,
    assignRecipientsMutation,
    assignTspContactMutation,
    toggleCorporatePriorityMutation,
  };
};
