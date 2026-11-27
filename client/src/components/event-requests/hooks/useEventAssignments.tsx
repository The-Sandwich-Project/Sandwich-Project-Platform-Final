import React from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventMutations } from './useEventMutations';
import { useEventQueries } from './useEventQueries';
import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { isValidTransition, getTransitionError, requiresReason, STATUS_DEFINITIONS } from '../constants';
import { isScheduledOrRescheduled, type EventStatus } from '@shared/event-status-workflow';
import { extractNameFromAssignmentId } from '@/lib/assignment-utils';

export const useEventAssignments = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { users, usersForAssignments, recipients, drivers, volunteers, hostsWithContacts } = useEventQueries();
  
  // Use usersForAssignments for TSP contact resolution (no special permissions required)
  const allUsers = users.length > 0 ? users : usersForAssignments;
  const { updateEventRequestMutation, assignRecipientsMutation } = useEventMutations();
  const {
    eventRequests,
  } = useEventRequestContext();
  const {
    setAssignmentType,
    setAssignmentEventId,
    setIsEditingAssignment,
    setEditingAssignmentPersonId,
    setSelectedAssignees,
    setIsVanDriverAssignment,
    openDialog,
  } = useEventDialogState();

  // Helper function to safely parse PostgreSQL arrays
  const parsePostgresArray = (assignments: any): string[] => {
    if (!assignments) return [];

    if (Array.isArray(assignments)) {
      return assignments;
    }

    if (typeof assignments === 'string') {
      if (assignments === '{}' || assignments === '') return [];

      let cleaned = assignments.replace(/^{|}$/g, '');
      if (!cleaned) return [];

      if (cleaned.includes('"')) {
        const matches = cleaned.match(/"[^"]*"|[^",]+/g);
        return matches ? matches.map(item => item.replace(/"/g, '').trim()).filter(item => item) : [];
      } else {
        return cleaned.split(',').map(item => item.trim()).filter(item => item);
      }
    }

    if (typeof assignments === 'object' && assignments.length !== undefined) {
      return Array.from(assignments);
    }

    return [];
  };

  // Helper function to resolve user ID or email to name
  const resolveUserName = (userIdOrName: string | undefined): string => {
    if (!userIdOrName) return 'Not assigned';

    try {
      // Handle custom- prefixed IDs FIRST (format: custom-timestamp-Name)
      // Example: custom-1763183106406-Chef-Hank => Chef Hank
      if (userIdOrName.startsWith('custom-') || userIdOrName.startsWith('custom:')) {
        const extracted = extractNameFromAssignmentId(userIdOrName);
        if (extracted) return extracted;
        return userIdOrName.replace('custom-', '').replace(/-/g, ' ');
      }

      // Handle host-contact- prefixed IDs FIRST (before checking if data is loaded)
      // This is critical for driver assignments
      if (userIdOrName.startsWith('host-contact-')) {
        const contactId = userIdOrName.replace('host-contact-', '');
        const numericContactId = parseInt(contactId);

        // Check if hostsWithContacts is loaded and not empty
        if (hostsWithContacts && hostsWithContacts.length > 0) {
          // Find the contact in hostsWithContacts
          for (const host of hostsWithContacts) {
            const contact = host.contacts?.find((c: any) => c.id === numericContactId);
            if (contact) {
              const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || contact.email;
              return contactName || `Contact #${contactId}`;
            }
          }
        }

        // If hostsWithContacts not loaded yet, show loading state instead of raw ID
        return 'Loading...';
      }

      // Ensure we have loaded data before proceeding for other types
      if (!allUsers || !drivers || !volunteers) {
        // Return user ID as fallback if data not loaded, but make it more readable
        return userIdOrName.length > 20 ? `User ID: ${userIdOrName.slice(-8)}` : userIdOrName;
      }

      // Handle user IDs (format: user_xxxx_xxxxx, admin_xxxx, committee_xxxx, or driver_xxxx)
      if (userIdOrName.includes('_') && (userIdOrName.startsWith('user_') || userIdOrName.startsWith('admin_') || userIdOrName.startsWith('committee_') || userIdOrName.startsWith('driver_'))) {
        const user = allUsers.find((u) => u?.id === userIdOrName);
        if (user) {
          return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName || user.email || 'Unknown User';
        }
        // If user not found in users array, return a more readable format
        // Only warn if we actually have users loaded (avoids spam during loading)
        if (allUsers.length > 0) {
          logger.warn(`User not found: ${userIdOrName}`);
        }
        return `User (${userIdOrName.slice(-8)})`;
      }

      // Handle email addresses
      if (userIdOrName.includes('@')) {
        const user = allUsers.find((u) => u?.email === userIdOrName);
        if (user) {
          return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown User';
        }
      }

      // Handle driver- prefixed IDs (e.g., "driver-443")
      if (userIdOrName.startsWith('driver-')) {
        const driverId = userIdOrName.replace('driver-', '');
        const numericDriverId = parseInt(driverId);
        
        const driver = drivers.find((d) => d && d.id === numericDriverId);
        if (driver) {
          return driver.name || `Driver #${driverId}`;
        }
        
        logger.warn(`Driver not found: ${userIdOrName}`);
        return `Driver #${driverId}`;
      }

      // Handle volunteer- prefixed IDs (e.g., "volunteer-123")
      if (userIdOrName.startsWith('volunteer-')) {
        const volunteerId = userIdOrName.replace('volunteer-', '');
        const numericVolunteerId = parseInt(volunteerId);
        
        const volunteer = volunteers.find((v) => v && v.id === numericVolunteerId);
        if (volunteer) {
          return `${volunteer.firstName || ''} ${volunteer.lastName || ''}`.trim() || volunteer.name || `Volunteer #${volunteerId}`;
        }
        
        logger.warn(`Volunteer not found: ${userIdOrName}`);
        return `Volunteer #${volunteerId}`;
      }

      // Handle numeric IDs (could be drivers, volunteers, or speakers)
      if (/^\d+$/.test(userIdOrName)) {
        const numericId = parseInt(userIdOrName);
        
        // First try drivers - ensure driver object exists and has required fields
        const driver = drivers.find((d) => d && (d.id === numericId || d.id?.toString() === userIdOrName));
        if (driver && driver.name) {
          return driver.name;
        }

        // Then try volunteers (speakers are volunteers) - ensure volunteer object exists
        const volunteer = volunteers.find((v) => v && (v.id === numericId || v.id?.toString() === userIdOrName));
        if (volunteer && volunteer.name) {
          return volunteer.name;
        }
        
        // If not found, return a generic placeholder
        // Only warn if we actually have data loaded (avoids spam during loading)
        if (allUsers.length > 0 || drivers.length > 0 || volunteers.length > 0) {
          logger.warn(`Person not found in resolveUserName: ID=${userIdOrName}`);
        }
        return `Person #${userIdOrName}`;
      }

      const legacyName = extractNameFromAssignmentId(userIdOrName);
      if (legacyName) return legacyName;

      return userIdOrName;
    } catch (error) {
      logger.error('Error in resolveUserName:', error, 'Input:', userIdOrName);
      return `Error: ${userIdOrName}`;
    }
  };

  // Helper function to resolve recipient ID to name
  const resolveRecipientName = (recipientIdOrName: string | undefined): string => {
    if (!recipientIdOrName) return 'Not specified';

    // Handle host-contact IDs by delegating to resolveUserName
    if (recipientIdOrName.startsWith('host-contact-')) {
      return resolveUserName(recipientIdOrName);
    }

    // Handle new "host:ID" format from MultiRecipientSelector
    if (recipientIdOrName.startsWith('host:')) {
      const hostId = recipientIdOrName.replace('host:', '');
      const numericHostId = parseInt(hostId);
      
      // Try to find in hostsWithContacts
      if (hostsWithContacts && hostsWithContacts.length > 0) {
        for (const host of hostsWithContacts) {
          const contact = host.contacts?.find((c: any) => c.id === numericHostId);
          if (contact) {
            const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || contact.email;
            return contactName || `Host Contact #${hostId}`;
          }
        }
      }
      
      return `Host Contact #${hostId}`;
    }

    // Handle new "recipient:ID" format from MultiRecipientSelector
    if (recipientIdOrName.startsWith('recipient:')) {
      const recipientId = recipientIdOrName.replace('recipient:', '');
      const recipient = recipients.find((r) => r.id.toString() === recipientId);
      return recipient ? recipient.name : `Recipient #${recipientId}`;
    }

    // Handle custom entries "custom:name"
    if (recipientIdOrName.startsWith('custom:')) {
      return recipientIdOrName.replace('custom:', '');
    }

    // Legacy numeric IDs
    if (/^\d+$/.test(recipientIdOrName)) {
      const recipient = recipients.find((r) => r.id.toString() === recipientIdOrName);
      return recipient ? recipient.name : recipientIdOrName;
    }

    return recipientIdOrName;
  };

  // Open assignment dialog
  const openAssignmentDialog = (
    eventId: number,
    type: 'driver' | 'volunteer' | 'recipient',
    isVanDriver: boolean = false
  ) => {
    setAssignmentEventId(eventId);
    setAssignmentType(type);
    setIsEditingAssignment(false);
    setEditingAssignmentPersonId(null);
    setSelectedAssignees([]);
    setIsVanDriverAssignment(isVanDriver);
    openDialog('assignment');
  };

  // Open assignment dialog in edit mode
  const openEditAssignmentDialog = (
    eventId: number,
    type: 'driver' | 'volunteer' | 'recipient',
    personId: string
  ) => {
    setAssignmentEventId(eventId);
    setAssignmentType(type);
    setIsEditingAssignment(true);
    setEditingAssignmentPersonId(personId);
    setSelectedAssignees([personId]);
    // A van-driver assignment leaves this flag on; clear it so changing a
    // regular driver or volunteer replaces them instead of the van slot.
    setIsVanDriverAssignment(false);
    openDialog('assignment');
  };

  // Handle removing assignment with undo capability
  const handleRemoveAssignment = async (
    personId: string,
    type: 'driver' | 'volunteer',
    eventId: number
  ) => {
    try {
      const eventRequest = eventRequests.find(req => req.id === eventId);
      if (!eventRequest) return;

      // Store the original data for undo
      const originalData: any = {};
      let updateData: any = {};
      const personName = resolveUserName(personId);

      if (type === 'driver') {
        // Check if this is the van driver
        if (eventRequest.assignedVanDriverId === personId) {
          originalData.assignedVanDriverId = eventRequest.assignedVanDriverId;
          updateData.assignedVanDriverId = null;
        } else {
          // Check if it's a tentative driver
          const currentTentativeDrivers = eventRequest.tentativeDriverIds || [];
          if (currentTentativeDrivers.includes(personId)) {
            originalData.tentativeDriverIds = [...currentTentativeDrivers];
            updateData.tentativeDriverIds = currentTentativeDrivers.filter(id => id !== personId);
          } else {
            // Regular driver - remove from assignedDriverIds array
            const currentDrivers = eventRequest.assignedDriverIds || [];
            originalData.assignedDriverIds = [...currentDrivers];
            updateData.assignedDriverIds = currentDrivers.filter(id => id !== personId);

            const currentDriverDetails = eventRequest.driverDetails || {};
            originalData.driverDetails = { ...currentDriverDetails };
            const newDriverDetails = { ...currentDriverDetails };
            delete newDriverDetails[personId];
            updateData.driverDetails = newDriverDetails;
          }
        }
      } else if (type === 'volunteer') {
        // Check if it's a tentative volunteer
        const currentTentativeVolunteers = eventRequest.tentativeVolunteerIds || [];
        if (currentTentativeVolunteers.includes(personId)) {
          originalData.tentativeVolunteerIds = [...currentTentativeVolunteers];
          updateData.tentativeVolunteerIds = currentTentativeVolunteers.filter(id => id !== personId);
        } else {
          const currentVolunteers = eventRequest.assignedVolunteerIds || [];
          originalData.assignedVolunteerIds = [...currentVolunteers];
          updateData.assignedVolunteerIds = currentVolunteers.filter(id => id !== personId);

          const currentVolunteerDetails = eventRequest.volunteerDetails || {};
          originalData.volunteerDetails = { ...currentVolunteerDetails };
          const newVolunteerDetails = { ...currentVolunteerDetails };
          delete newVolunteerDetails[personId];
          updateData.volunteerDetails = newVolunteerDetails;

          const currentVolunteerAssignments = eventRequest.volunteerAssignments || [];
          originalData.volunteerAssignments = [...currentVolunteerAssignments];
          const volunteerName = currentVolunteerDetails[personId]?.name;
          if (volunteerName) {
            updateData.volunteerAssignments = currentVolunteerAssignments.filter(name => name !== volunteerName);
          }
        }
      }

      await updateEventRequestMutation.mutateAsync({
        id: eventId,
        data: updateData,
      });

      // Show toast with undo action
      const { dismiss } = toast({
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} removed`,
        description: `${personName} has been removed. Click Undo to restore.`,
        duration: 8000,
        action: (
          <button
            onClick={async () => {
              try {
                await updateEventRequestMutation.mutateAsync({
                  id: eventId,
                  data: originalData,
                });
                dismiss();
                toast({
                  title: 'Assignment restored',
                  description: `${personName} has been restored as ${type}.`,
                });
              } catch (error) {
                toast({
                  title: 'Restore failed',
                  description: 'Failed to restore assignment.',
                  variant: 'destructive',
                });
              }
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Undo
          </button>
        ),
      });
    } catch (error) {
      logger.error('Failed to remove assignment:', error);
      toast({
        title: 'Removal failed',
        description: 'Failed to remove assignment. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Handle self-signup
  const handleSelfSignup = async (eventId: number, type: 'driver' | 'volunteer') => {
    if (!user) {
      toast({
        title: 'Authentication required',
        description: 'Please log in to sign up for roles',
        variant: 'destructive',
      });
      return;
    }

    try {
      const eventRequest = eventRequests.find(req => req.id === eventId);
      if (!eventRequest) return;

      let updateData: any = {};

      if (type === 'driver') {
        const currentDrivers = eventRequest.assignedDriverIds || [];
        if (currentDrivers.includes(user.id)) {
          toast({
            title: 'Already signed up',
            description: 'You are already assigned as a driver for this event',
          });
          return;
        }

        const driversNeeded = eventRequest.driversNeeded;
        if (typeof driversNeeded === 'number' && currentDrivers.length >= driversNeeded) {
          toast({
            title: 'No spots available',
            description: 'All driver spots are filled for this event',
            variant: 'destructive',
          });
          return;
        }

        const newDrivers = [...currentDrivers, user.id];
        updateData.assignedDriverIds = newDrivers;

        const currentDriverDetails = eventRequest.driverDetails || {};
        updateData.driverDetails = {
          ...currentDriverDetails,
          [user.id]: {
            name: `${user.firstName} ${user.lastName}`.trim(),
            assignedAt: new Date().toISOString(),
            assignedBy: user.id,
            selfAssigned: true,
          },
        };
      } else if (type === 'volunteer') {
        if (!eventRequest.volunteersNeeded || eventRequest.volunteersNeeded <= 0) {
          if (!isScheduledOrRescheduled(eventRequest.status)) {
            toast({
              title: 'Volunteers not needed',
              description: 'This event does not require volunteers',
              variant: 'destructive',
            });
            return;
          }
        }

        const currentVolunteers = eventRequest.assignedVolunteerIds || [];
        if (typeof eventRequest.volunteersNeeded === 'number' &&
            eventRequest.volunteersNeeded > 0 &&
            currentVolunteers.length >= eventRequest.volunteersNeeded) {
          toast({
            title: 'No volunteer spots available',
            description: 'All volunteer spots are filled for this event',
            variant: 'destructive',
          });
          return;
        }

        if (currentVolunteers.includes(user.id)) {
          toast({
            title: 'Already signed up',
            description: 'You are already assigned as a volunteer for this event',
          });
          return;
        }

        const newVolunteers = [...currentVolunteers, user.id];
        updateData.assignedVolunteerIds = newVolunteers;

        const currentVolunteerDetails = eventRequest.volunteerDetails || {};
        updateData.volunteerDetails = {
          ...currentVolunteerDetails,
          [user.id]: {
            name: `${user.firstName} ${user.lastName}`.trim(),
            assignedAt: new Date().toISOString(),
            assignedBy: user.id,
            selfAssigned: true,
          },
        };

        const currentVolunteerAssignments = eventRequest.volunteerAssignments || [];
        const userName = `${user.firstName} ${user.lastName}`.trim();
        if (!currentVolunteerAssignments.includes(userName)) {
          updateData.volunteerAssignments = [...currentVolunteerAssignments, userName];
        }
      }

      await updateEventRequestMutation.mutateAsync({
        id: eventId,
        data: updateData,
      });

      toast({
        title: 'Signed up successfully!',
        description: `You have been signed up as a ${type} for this event`,
      });
    } catch (error) {
      logger.error('Failed to self-signup:', error);
      toast({
        title: 'Signup failed',
        description: 'Failed to sign up. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Check if user can sign up
  const canSelfSignup = (eventRequest: EventRequest, type: 'driver' | 'volunteer'): boolean => {
    if (!user) return false;

    // Check if user has the self-signup permission
    if (!hasPermission(user, PERMISSIONS.EVENT_REQUESTS_SELF_SIGNUP)) {
      return false;
    }

    if (type === 'driver') {
      const currentDrivers = parsePostgresArray(eventRequest.assignedDriverIds);
      const driversNeeded = eventRequest.driversNeeded;
      return !currentDrivers.includes(user.id) &&
        (typeof driversNeeded !== 'number' || currentDrivers.length < driversNeeded);
    } else if (type === 'volunteer') {
      if (isScheduledOrRescheduled(eventRequest.status)) {
        const currentVolunteers = parsePostgresArray(eventRequest.assignedVolunteerIds);
        return !currentVolunteers.includes(user.id);
      }

      if (eventRequest.volunteersNeeded && eventRequest.volunteersNeeded > 0) {
        const currentVolunteers = parsePostgresArray(eventRequest.assignedVolunteerIds);
        const hasCapacity = currentVolunteers.length < eventRequest.volunteersNeeded;
        return !currentVolunteers.includes(user.id) && hasCapacity;
      }

      return false;
    }

    return false;
  };

  // Check if user is signed up
  const isUserSignedUp = (eventRequest: EventRequest, type: 'driver' | 'volunteer'): boolean => {
    if (!user) return false;

    if (type === 'driver') {
      const currentDrivers = parsePostgresArray(eventRequest.assignedDriverIds);
      return currentDrivers.includes(user.id);
    } else if (type === 'volunteer') {
      const currentVolunteers = parsePostgresArray(eventRequest.assignedVolunteerIds);
      return currentVolunteers.includes(user.id);
    }

    return false;
  };

  // Format status labels for display
  const formatStatus = (s: string) => {
    return STATUS_DEFINITIONS[s as EventStatus]?.label || s;
  };

  /**
   * Handle status change with validation, reason-capture dialogs, and undo.
   *
   * For declined, cancelled: returns 'needs_reason' so the caller
   * can open the appropriate reason dialog instead of doing the change inline.
   *
   * Returns: 'done' | 'needs_reason' | 'blocked'
   */
  const handleStatusChange = async (
    id: number,
    status: string,
    additionalData?: Record<string, any>
  ): Promise<'done' | 'needs_reason' | 'blocked'> => {
    const request = eventRequests.find(r => r.id === id);
    if (!request) return 'blocked';

    const previousStatus = request.status as EventStatus;
    const targetStatus = status as EventStatus;
    const orgName = request.organizationName || 'Event';

    // Validate the transition
    if (!isValidTransition(previousStatus, targetStatus)) {
      const errorMsg = getTransitionError(previousStatus, targetStatus);
      toast({
        title: 'Invalid Status Change',
        description: errorMsg,
        variant: 'destructive',
        duration: 8000,
      });
      return 'blocked';
    }

    // Signal to caller to open the reason/date dialog. Reason-required statuses
    // come from the shared workflow (single source of truth, also enforced
    // server-side); rescheduled is special — it needs a new date, not a reason.
    if (requiresReason(targetStatus) || targetStatus === 'rescheduled') {
      return 'needs_reason';
    }

    // When moving to scheduled, check for incomplete next actions
    if (status === 'scheduled') {
      if (request.nextAction && request.nextAction.trim()) {
        const confirmed = window.confirm(
          `This event has a next action that hasn't been marked complete:\n\n"${request.nextAction}"\n\nHave you completed this action? If not, please complete it before marking as scheduled.`
        );

        if (!confirmed) {
          toast({
            title: 'Action Required',
            description: 'Please complete or clear the next action before marking this event as scheduled.',
            variant: 'destructive',
          });
          return 'blocked';
        }
      }
    }

    // Confirm completed status
    if (status === 'completed') {
      const confirmed = window.confirm(
        `Are you sure you want to mark "${orgName}" as ${formatStatus(status)}?`
      );
      if (!confirmed) return 'blocked';
    }

    // The "scheduled → default to desired date" rule now lives in the shared
    // workflow and is applied server-side (getScheduledDateDefault), so every
    // scheduling path gets it consistently — no need to set it here.
    const data: any = { status, ...additionalData };

    try {
      await updateEventRequestMutation.mutateAsync({
        id,
        data
      });

      // Show toast with undo action
      const { dismiss } = toast({
        title: 'Status changed',
        description: `${orgName} is now ${formatStatus(status)}. Click Undo to restore.`,
        duration: 10000,
        action: (
          <button
            onClick={async () => {
              try {
                const undoData: any = { status: previousStatus };
                await updateEventRequestMutation.mutateAsync({
                  id,
                  data: undoData,
                });
                dismiss();
                toast({
                  title: 'Status restored',
                  description: `${orgName} restored to ${formatStatus(previousStatus)}.`,
                });
              } catch (error) {
                toast({
                  title: 'Restore failed',
                  description: 'Failed to restore status.',
                  variant: 'destructive',
                });
              }
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Undo
          </button>
        ),
      });
      return 'done';
    } catch (error: any) {
      logger.error('Failed to change status:', error);

      // Use server error message if available (includes transition validation errors)
      const serverMessage = error?.data?.message || error?.message || 'Failed to update event status. Please try again.';

      toast({
        title: 'Status change failed',
        description: serverMessage,
        variant: 'destructive',
        duration: 8000,
      });
      return 'blocked';
    }
  };

  return {
    parsePostgresArray,
    resolveUserName,
    resolveRecipientName,
    openAssignmentDialog,
    openEditAssignmentDialog,
    handleRemoveAssignment,
    handleSelfSignup,
    canSelfSignup,
    isUserSignedUp,
    handleStatusChange,
  };
};