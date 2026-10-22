import React, { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEventQueries } from '../hooks/useEventQueries';
import EventEmailLogDisplay from '@/components/event-email-log-display';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Clock,
  Package,
  MapPin,
  Building,
  Building2,
  Edit2,
  Save,
  X,
  Trash2,
  Calendar,
  Users,
  Car,
  Truck,
  UserPlus,
  Phone,
  Mail,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  History,
  FileText,
  MessageSquare,
  Loader2,
  Sparkles,
  Plus,
  Minus,
  Check,
  HelpCircle,
  User,
  MessageCircle,
  ClipboardList,
} from 'lucide-react';
import {
  formatTime12Hour,
  formatTimeForInput,
  formatEventDate,
} from '@/components/event-requests/utils';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import {
  SANDWICH_TYPES,
  statusOptions,
} from '@/components/event-requests/constants';
import {
  parseSandwichTypes,
  formatSandwichTypesDisplay,
} from '@/lib/sandwich-utils';
import { hasActiveSandwichRange } from '@shared/sandwich-count-utils';
import {
  extractNameFromAssignmentId,
  resolveAssignmentDisplayName,
} from '@/lib/assignment-utils';
import type { EventRequest } from '@shared/schema';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { MultiRecipientSelector } from '@/components/ui/multi-recipient-selector';
import { getMissingIntakeInfo } from '@/lib/event-request-validation';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';
import { ReminderRulesManager } from '@/components/event-requests/ReminderRulesManager';
import { MessageComposer } from '@/components/message-composer';
import { InstructionsSection } from '../form-sections/InstructionsSection';
import { MlkDayBadge } from '@/components/event-requests/MlkDayBadge';
import { MissingDriverTimeBadge } from '@/components/event-requests/MissingDriverTimeBadge';
import { RefrigerationWarningBadge } from '@/components/event-requests/RefrigerationWarningBadge';
import { TrafficConflictBadge } from '@/components/event-requests/TrafficConflictBadge';
import { VanNeededBadgeAndButton } from '@/components/event-requests/VanNeededBadgeAndButton';
import { SendEventDetailsSMSDialog } from '../dialogs/SendEventDetailsSMSDialog';
import { SendCorrectionSMSDialog } from '../dialogs/SendCorrectionSMSDialog';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { CommentThread } from '@/components/collaboration';
import { useToast } from '@/hooks/use-toast';
import { Sheet } from 'lucide-react';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import { patchEventRequestVerified } from '@/lib/event-save-verification';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PreEventFlagsBanner, PreEventFlagsDialog } from '@/components/pre-event-flags';
import { Flag } from 'lucide-react';
import { ProposeToSheetButton } from '@/components/propose-to-sheet-button';
import { InlineRecipientAllocationEditor } from '../InlineRecipientAllocationEditor';
import { useReturningOrganization } from '@/hooks/use-returning-organization';
import { RefreshCw, Copy, Ban, MapPinOff } from 'lucide-react';
import type { RecipientAllocation } from '../RecipientAllocationEditor';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';
import { CardActionRow, ActionRowSpacer, InfoBadge } from './card-ui';

interface ScheduledCardEnhancedProps {
  request: EventRequest;
  editingField: string | null;
  editingValue: string;
  isEditingThisCard: boolean;
  inlineSandwichMode: 'total' | 'types' | 'range';
  inlineTotalCount: number;
  inlineSandwichTypes: Array<{ type: string; quantity: number }>;
  inlineRangeMin: number;
  inlineRangeMax: number;
  inlineRangeType: string;
  isSaving?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onContact: () => void;
  onAssignTspContact: () => void;
  onEditTspContact: () => void;
  onLogContact: () => void;
  onReschedule: () => void;
  onCancelEvent?: () => void;
  onDuplicate?: () => void;
  onAiIntakeAssist?: () => void;
  startEditing: (field: string, value: string) => void;
  saveEdit: () => void;
  cancelEdit: () => void;
  setEditingValue: (value: string) => void;
  tempIsConfirmed: boolean;
  setTempIsConfirmed: (value: boolean) => void;
  quickToggleBoolean: (field: 'isConfirmed' | 'addedToOfficialSheet' | 'showOnVolunteerHub', value: boolean) => void;
  setInlineSandwichMode: (mode: 'total' | 'types' | 'range') => void;
  setInlineTotalCount: (count: number) => void;
  setInlineRangeMin: (count: number) => void;
  setInlineRangeMax: (count: number) => void;
  setInlineRangeType: (type: string) => void;
  addInlineSandwichType: () => void;
  updateInlineSandwichType: (index: number, field: 'type' | 'quantity', value: string | number) => void;
  removeInlineSandwichType: (index: number) => void;
  resolveUserName: (id: string) => string;
  resolveRecipientName?: (id: string) => string;
  openAssignmentDialog: (type: 'driver' | 'volunteer', isVanDriver?: boolean) => void;
  handleRemoveAssignment: (type: 'driver' | 'volunteer', personId: string) => void;
  quickUpdateField?: (field: string, value: any) => void;
  canEdit?: boolean;
  // Next Action handlers
  onAddNextAction?: () => void;
  onEditNextAction?: () => void;
  onCompleteNextAction?: () => void;
}

const parsePostgresArray = (arr: unknown): string[] => {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.map(String).filter((item) => item && item.trim());
  if (typeof arr === 'string') {
    if (arr === '{}' || arr === '') return [];
    const cleaned = arr.replace(/^{|}$/g, '');
    if (!cleaned) return [];
    return cleaned.split(',').map((item) => item.trim()).filter((item) => item);
  }
  return [];
};

const extractCustomName = (id: string): string => {
  return extractNameFromAssignmentId(id) || '';
};

export const ScheduledCardEnhanced: React.FC<ScheduledCardEnhancedProps> = ({
  request,
  editingField,
  editingValue,
  isEditingThisCard,
  inlineSandwichMode,
  inlineTotalCount,
  inlineSandwichTypes,
  inlineRangeMin,
  inlineRangeMax,
  inlineRangeType,
  isSaving = false,
  onEdit,
  onDelete,
  onContact,
  onAssignTspContact,
  onEditTspContact,
  onLogContact,
  onReschedule,
  onCancelEvent,
  onDuplicate,
  onAiIntakeAssist,
  startEditing,
  saveEdit,
  cancelEdit,
  setEditingValue,
  tempIsConfirmed,
  setTempIsConfirmed,
  quickToggleBoolean,
  setInlineSandwichMode,
  setInlineTotalCount,
  setInlineRangeMin,
  setInlineRangeMax,
  setInlineRangeType,
  addInlineSandwichType,
  updateInlineSandwichType,
  removeInlineSandwichType,
  resolveUserName,
  resolveRecipientName,
  openAssignmentDialog,
  handleRemoveAssignment,
  quickUpdateField,
  canEdit = true,
  onAddNextAction,
  onEditNextAction,
  onCompleteNextAction,
}) => {
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showSchedulingNotes, setShowSchedulingNotes] = useState(false);
  const [showNotesAndRequirements, setShowNotesAndRequirements] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [showInstructionsDialog, setShowInstructionsDialog] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState({ driverInstructions: '', volunteerInstructions: '' });
  const [showSendSmsDialog, setShowSendSmsDialog] = useState(false);
  const [showSendCorrectionDialog, setShowSendCorrectionDialog] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAllocationEditor, setShowAllocationEditor] = useState(false);
  const [showFlagsDialog, setShowFlagsDialog] = useState(false);
  const [showContactLog, setShowContactLog] = useState(false);

  const { user } = useAuth();
  const canSendSMS = user && hasPermission(user, PERMISSIONS.EVENT_REQUESTS_SEND_SMS);
  const canEditTspContact = user && hasPermission(user, PERMISSIONS.EVENT_REQUESTS_EDIT_TSP_CONTACT);

  // Collaboration hook for comments
  const collaboration = useEventCollaboration(request.id);

  // Check if this organization is returning (has past events) and if the contact is the same
  // Contact matching requires email OR (name + phone) to prevent false positives from same names
  const contactFullName = [request.firstName, request.lastName].filter(Boolean).join(' ') || null;
  const { data: returningOrgData } = useReturningOrganization(
    request.organizationName,
    request.id,
    request.email,
    contactFullName,
    request.phone,        // contactPhone - used with name for secondary matching
    request.department,   // department - used for umbrella org matching (churches, scouts)
    isScheduledOrRescheduled(request.status)
  );

  // Check if there's any communication/notes content to show
  // Safely check if contactAttemptsLog is an array with items
  const hasContactAttempts = Array.isArray(request.contactAttemptsLog) && request.contactAttemptsLog.length > 0;
  const hasCommunicationContent = !!(
    hasContactAttempts ||
    (request.unresponsiveNotes && !hasContactAttempts) ||
    request.followUpNotes ||
    request.distributionNotes ||
    request.duplicateNotes ||
    request.socialMediaPostNotes
  );

  // Default to collapsed when there's no content
  const [showCommunicationNotes, setShowCommunicationNotes] = useState(hasCommunicationContent);
  const [addingAllTimes, setAddingAllTimes] = useState(false);
  const [tempStartTime, setTempStartTime] = useState('');
  const [tempEndTime, setTempEndTime] = useState('');
  const [tempPickupTime, setTempPickupTime] = useState('');
  const [tempOvernightHolding, setTempOvernightHolding] = useState('');

  // State for recording actual/final sandwich count
  const [isEditingActualCount, setIsEditingActualCount] = useState(false);
  const [actualCountMode, setActualCountMode] = useState<'simple' | 'detailed'>('simple');
  const [actualCountSimple, setActualCountSimple] = useState('');
  const [actualCountTypes, setActualCountTypes] = useState<Record<string, number>>({});

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Mutation for updating event request fields
  const updateFieldsMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) =>
      patchEventRequestVerified(request.id, updates),
    onSuccess: (updatedEvent, variables) => {
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: request.status,
        touchedFields: Object.keys(variables),
      });
      setAddingAllTimes(false);
      setTempStartTime('');
      setTempEndTime('');
      setTempPickupTime('');
    },
    onError: (error: any) => {
      toast({
        title: 'Save failed',
        description: error?.message || 'Could not save this event update.',
        variant: 'destructive',
        duration: Number.POSITIVE_INFINITY,
      });
    },
  });

  const hasInstructions = !!(
    (request as any).driverInstructions?.trim() || (request as any).volunteerInstructions?.trim()
  );

  const openInstructionsDialog = () => {
    setInstructionsDraft({
      driverInstructions: (request as any).driverInstructions || '',
      volunteerInstructions: (request as any).volunteerInstructions || '',
    });
    setShowInstructionsDialog(true);
  };

  const saveInstructions = () => {
    updateFieldsMutation.mutate(
      {
        driverInstructions: instructionsDraft.driverInstructions.trim() || null,
        volunteerInstructions: instructionsDraft.volunteerInstructions.trim() || null,
      },
      {
        onSuccess: () => {
          setShowInstructionsDialog(false);
          toast({ description: 'Instructions saved' });
        },
      }
    );
  };

  const toggleDhlVan = (value: boolean) => {
    const payload: Record<string, unknown> = { isDhlVan: value };
    if (value) {
      payload.vanDriverNeeded = true;
      payload.assignedVanDriverId = null;
      // Default to no additional regular drivers when van is enabled
      payload.driversNeeded = 0;
    }
    updateFieldsMutation.mutate(payload);
  };

  // Use shared reference data from useEventQueries (eliminates duplicate API calls)
  const {
    hostContacts,
    hostContactsLoading: isLoadingHostContacts,
    recipients,
    hosts: hostLocations,
  } = useEventQueries();

  const resolveLocalRecipientName = (recipientId: string): string => {
    // Handle custom entries with format "custom-timestamp-Name" or "custom:Name"
    if (recipientId.startsWith('custom-') || recipientId.startsWith('custom:')) {
      // Extract just the name part from formats like:
      // - "custom-1761977247368-David" -> "David"
      // - "custom:David" -> "David"
      const parts = recipientId.split('-');
      if (parts.length >= 3) {
        // Format: custom-timestamp-Name
        return parts.slice(2).join('-'); // Handle names with dashes
      } else if (recipientId.includes(':')) {
        // Format: custom:Name
        return recipientId.split(':')[1];
      }
      return recipientId.replace('custom-', '').replace('custom:', '');
    }

    if (recipientId.includes(':')) {
      const [type, ...rest] = recipientId.split(':');
      const value = rest.join(':');

      if (!isNaN(Number(value))) {
        const numId = Number(value);

        if (type === 'host') {
          console.log(`resolveLocalRecipientName: Looking for host ID ${numId} in ${hostContacts.length} contacts`);
          const hostContact = hostContacts.find(hc => hc.id === numId);
          if (hostContact) {
            console.log(`resolveLocalRecipientName: Found host contact:`, hostContact);
            // Prefer displayName (includes host location), then name, then hostLocationName
            if (hostContact.displayName) {
              return hostContact.displayName;
            }
            if (hostContact.name) {
              return hostContact.name;
            }
            if (hostContact.hostLocationName) {
              return hostContact.hostLocationName;
            }
          }
          console.log(`resolveLocalRecipientName: Host contact ${numId} not found, checking host locations`);
          const hostLocation = hostLocations.find(h => h.id === numId);
          if (hostLocation) {
            console.log(`resolveLocalRecipientName: Found host location:`, hostLocation);
            return hostLocation.name;
          }
          // If host not found, return a helpful message instead of just the ID
          console.warn(`resolveLocalRecipientName: Host ${numId} not found in either contacts or locations! Available IDs:`, hostContacts.map(h => h.id));
          return `Host ID ${numId}`;
        } else if (type === 'recipient') {
          // Check recipients first
          const recipient = recipients.find(r => r.id === numId);
          if (recipient) return recipient.name;

          // Fallback: check host contacts (in case data was mislabeled)
          console.log(`resolveLocalRecipientName: Recipient ${numId} not found, checking hosts as fallback`);
          const hostContact = hostContacts.find(hc => hc.id === numId);
          if (hostContact) {
            if (hostContact.displayName) return hostContact.displayName;
            if (hostContact.name) return hostContact.name;
            if (hostContact.hostLocationName) return hostContact.hostLocationName;
          }

          // Fallback: check host locations
          const hostLocation = hostLocations.find(h => h.id === numId);
          if (hostLocation) return hostLocation.name;

          // If not found anywhere, return a helpful message
          return `Recipient ID ${numId}`;
        }
      }
      return value;
    }

    // Handle plain numeric IDs (legacy format without "host:" prefix)
    if (!isNaN(Number(recipientId))) {
      const numId = Number(recipientId);
      // Check host contacts first (more specific), then locations, then recipients
      const hostContact = hostContacts.find(h => h.id === numId);
      if (hostContact) {
        // Prefer displayName (includes host location), then name, then hostLocationName
        if (hostContact.displayName) {
          return hostContact.displayName;
        }
        if (hostContact.name) {
          return hostContact.name;
        }
        if (hostContact.hostLocationName) {
          return hostContact.hostLocationName;
        }
      }
      const hostLocation = hostLocations.find(h => h.id === numId);
      if (hostLocation) return hostLocation.name;
      const recipient = recipients.find(r => r.id === numId);
      if (recipient) return recipient.name;
      // If not found anywhere, return a helpful message
      return `ID ${numId}`;
    }

    return recipientId;
  };

  // Use the prop if provided, otherwise use local implementation
  const getRecipientName = resolveRecipientName || resolveLocalRecipientName;

  // Get display date
  const displayDate = getEffectiveEventDate(request);
  const dateInfo = displayDate ? formatEventDate(displayDate.toString()) : null;

  // Calculate follow-up reminder status
  // Show indicator when event is 2 weeks prior if scheduled more than 3 weeks ahead, or 1 week prior ideally
  const followUpStatus = (() => {
    if (!displayDate || !isScheduledOrRescheduled(request.status)) return null;
    
    try {
      const eventDate = new Date(displayDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      
      const daysUntilEvent = Math.round((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // Check when event was scheduled (use statusChangedAt or createdAt as fallback)
      const scheduledAt = request.statusChangedAt ? new Date(request.statusChangedAt) : (request.createdAt ? new Date(request.createdAt) : null);
      const daysSinceScheduled = scheduledAt ? Math.round((today.getTime() - scheduledAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
      
      // If scheduled more than 3 weeks (21 days) ahead and we're now 2 weeks (14 days) prior
      if (daysSinceScheduled !== null && daysSinceScheduled >= 21 && daysUntilEvent === 14) {
        return { type: '2weeks', daysUntil: daysUntilEvent };
      }
      
      // If 1 week (7 days) prior
      if (daysUntilEvent === 7) {
        return { type: '1week', daysUntil: daysUntilEvent };
      }
      
      return null;
    } catch {
      return null;
    }
  })();

  // Calculate staffing
  // driversNeeded tracks regular drivers only — van driver is separate
  const driverAssigned = parsePostgresArray(request.assignedDriverIds).length;
  const volunteerAssigned = parsePostgresArray(request.assignedVolunteerIds).length;
  const driverNeeded = request.driversNeeded || 0;
  const volunteerNeeded = request.volunteersNeeded || 0;
  const showMarkVanNeeded =
    canEdit &&
    !request.selfTransport &&
    !request.assignedVanDriverId &&
    !request.isDhlVan &&
    !request.vanDriverNeeded;
  const showVolunteerSection =
    !request.selfTransport &&
    (volunteerNeeded > 0 || (isEditingThisCard && editingField === 'volunteersNeeded'));
  const showCondensedStaffingAdds =
    !request.selfTransport && !showVolunteerSection && canEdit;
  // Include van driver in staffing totals as a separate slot
  const vanDriverNeededCount = (request.vanDriverNeeded && !request.assignedVanDriverId && !request.isDhlVan) ? 1 : 0;
  const vanDriverAssignedCount = (request.assignedVanDriverId || request.isDhlVan) ? 1 : 0;
  const totalAssigned = driverAssigned + vanDriverAssignedCount + volunteerAssigned;
  const totalNeeded = driverNeeded + (request.vanDriverNeeded ? 1 : 0) + volunteerNeeded;
  const staffingComplete = totalAssigned >= totalNeeded && totalNeeded > 0;

  // Check if event is within next 7 days (for urgent staffing badge color)
  // Note: displayDate is already defined above
  const isWithin7Days = (() => {
    if (!displayDate) return false;
    // Parse as local date to avoid timezone issues
    const dateStr = displayDate.toString().split('T')[0];
    const [year, month, day] = dateStr.split('-').map(Number);
    const eventDate = new Date(year, month - 1, day);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    return eventDate <= sevenDaysFromNow && eventDate >= today;
  })();

  // Staffing badge colors - urgent burgundy fill (passes AA) if within 7 days,
  // otherwise the accessible "attention" tone (dark text on light gold). The old
  // gold fill used white text (#FBAD3F on white ≈ 1.9:1) and failed WCAG AA.
  const staffingBadgeColors = isWithin7Days
    ? 'bg-[#A31C41] text-white border border-[#A31C41]'
    : 'bg-amber-50 text-amber-800 border border-amber-400';

  // Sandwich info — ignore a leftover range whose midpoint disagrees with the
  // exact count (stale range after Exact Count save → "500 shows as 498").
  const hasRange = hasActiveSandwichRange(
    request.estimatedSandwichCountMin,
    request.estimatedSandwichCountMax,
    request.estimatedSandwichCount,
  );
  let sandwichInfo;
  if (hasRange) {
    const rangeType = request.estimatedSandwichRangeType;
    const typeLabel = rangeType ? SANDWICH_TYPES.find(t => t.value === rangeType)?.label : null;
    sandwichInfo = `${request.estimatedSandwichCountMin}-${request.estimatedSandwichCountMax}${typeLabel ? ` ${typeLabel}` : ''}`;
  } else {
    sandwichInfo = formatSandwichTypesDisplay(request.sandwichTypes, request.estimatedSandwichCount ?? undefined);
  }

  // Compact sandwich count for the header badge (prevents long type strings from overflowing the card)
  const sandwichCountBadgeText = (() => {
    if (hasRange) {
      return `${request.estimatedSandwichCountMin}-${request.estimatedSandwichCountMax}`;
    }
    if (typeof request.estimatedSandwichCount === 'number' && request.estimatedSandwichCount > 0) {
      return `${request.estimatedSandwichCount}`;
    }
    const parsedTypes = parseSandwichTypes(request.sandwichTypes);
    const totalFromTypes =
      parsedTypes?.reduce((sum, t) => sum + (typeof t.quantity === 'number' ? t.quantity : 0), 0) ?? 0;
    return totalFromTypes > 0 ? `${totalFromTypes}` : 'TBD';
  })();

  // TSP Contact display (was lost in redesign; show under Event Details / Sandwiches)
  const tspContactDisplay = useMemo(() => {
    const custom = (request.customTspContact || '').trim();
    if (custom) return custom;
    if (request.tspContactAssigned) return resolveUserName(request.tspContactAssigned);
    if (request.tspContact) return resolveUserName(request.tspContact);
    return null;
  }, [request.customTspContact, request.tspContactAssigned, request.tspContact, resolveUserName]);

  // Address is flagged by the dedicated top-right "No Location" badge, so drop
  // it here to avoid doubling up (the shared check also only flags it when
  // drivers are needed, which made it show inconsistently).
  const missingInfo = getMissingIntakeInfo(request).filter((item) => item !== 'Address');

  const formatDateForInput = (dateStr: string) => {
    if (!dateStr) return '';
    return dateStr.split('T')[0];
  };

  let dateFieldToEdit = 'desiredEventDate';
  let dateLabel = 'Requested Date';
  if (request.scheduledEventDate) {
    dateFieldToEdit = 'scheduledEventDate';
    dateLabel = request.status === 'completed' ? 'Event Date' : 'Scheduled Date';
  }

  // Handlers for recording actual/final sandwich count
  const startEditingActualCount = () => {
    const currentCount = (request as any).actualSandwichCount || 0;
    const currentTypes = (request as any).actualSandwichTypes;

    if (currentTypes && Array.isArray(currentTypes) && currentTypes.length > 0) {
      const typeMap: Record<string, number> = {};
      currentTypes.forEach((item: { type?: string; quantity?: number }) => {
        if (item.type && item.quantity) {
          typeMap[item.type.toLowerCase()] = item.quantity;
        }
      });
      setActualCountTypes(typeMap);
      setActualCountMode('detailed');
    } else {
      setActualCountSimple(currentCount > 0 ? currentCount.toString() : '');
      setActualCountMode('simple');
    }
    setIsEditingActualCount(true);
  };

  const saveActualCount = () => {
    const todayDate = new Date().toISOString();

    if (actualCountMode === 'simple') {
      const count = parseInt(actualCountSimple, 10);
      if (isNaN(count) || count < 0) {
        toast({
          title: 'Invalid count',
          description: 'Please enter a valid positive number.',
          variant: 'destructive',
        });
        return;
      }

      updateFieldsMutation.mutate({
        actualSandwichCount: count,
        actualSandwichCountRecordedDate: todayDate,
        actualSandwichCountRecordedBy: user?.id?.toString() || null,
      }, {
        onSuccess: () => {
          setIsEditingActualCount(false);
          setActualCountSimple('');
          toast({
            title: 'Final count recorded',
            description: `Recorded ${count} sandwiches for this event.`,
          });
        }
      });
    } else {
      const types: Array<{ type: string; quantity: number }> = [];
      let total = 0;

      Object.entries(actualCountTypes).forEach(([type, count]) => {
        if (count && count > 0) {
          types.push({ type, quantity: count });
          total += count;
        }
      });

      if (total === 0) {
        toast({
          title: 'Invalid count',
          description: 'Please enter at least one sandwich type with a count.',
          variant: 'destructive',
        });
        return;
      }

      updateFieldsMutation.mutate({
        actualSandwichCount: total,
        actualSandwichTypes: types,
        actualSandwichCountRecordedDate: todayDate,
        actualSandwichCountRecordedBy: user?.id?.toString() || null,
      }, {
        onSuccess: () => {
          setIsEditingActualCount(false);
          setActualCountTypes({});
          toast({
            title: 'Final count recorded',
            description: `Recorded ${total} sandwiches for this event.`,
          });
        }
      });
    }
  };

  const cancelActualCountEdit = () => {
    setIsEditingActualCount(false);
    setActualCountSimple('');
    setActualCountTypes({});
  };

  return (
    <Card 
      data-event-card
      className="w-full min-w-0 overflow-hidden bg-[#E4EFF6] border-l-[4px] shadow-[0_1px_4px_rgba(0,0,0,0.08)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.10)] transition-all border-[#D8DEE2] rounded-xl"
      style={{ borderLeftColor: '#236383' }}
    >
      <CardContent className="p-3">
        {/* Pre-Event Flags Banner */}
        {request.preEventFlags && Array.isArray(request.preEventFlags) && request.preEventFlags.length > 0 && (
          <PreEventFlagsBanner
            flags={request.preEventFlags}
            eventId={request.id}
            eventName={request.organizationName || 'Event'}
            compact={false}
          />
        )}
        
        {/* Header Row - Organization & Status.
            Tightened to mirror InProcessCard density: removed the thick teal
            divider and heavy pb-3 in favor of a single mb-3 bottom margin. */}
        <div className="flex flex-col gap-2 mb-3">
          {/* Top: Date + Organization Name */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            {/* Organization Name + Department (separate edit targets) */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {isEditingThisCard && editingField === 'organizationName' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="h-9 text-lg sm:text-xl font-bold w-full sm:w-64"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <Button size="sm" variant="ghost" onClick={saveEdit} className="h-8 w-8 p-0">
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 w-8 p-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group">
                    <h2 className="text-lg sm:text-xl font-bold text-[#236383] break-words">
                      {request.organizationName}
                    </h2>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing('organizationName', request.organizationName || '')}
                        className="h-6 px-2 hidden group-hover:inline-flex"
                        title="Edit organization name"
                        data-testid="button-edit-org-name"
                      >
                        <Edit2 className="w-3 h-3 sm:w-4 sm:h-4" />
                      </Button>
                    )}
                  </div>
                )}

                {(request.department || (isEditingThisCard && editingField === 'department') || canEdit) && (
                  <>
                    <span className="text-gray-500 text-lg">&bull;</span>
                    {isEditingThisCard && editingField === 'department' ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="h-8 text-base sm:text-lg font-medium text-[#236383] w-full sm:w-48"
                          placeholder="Department"
                          autoFocus
                          data-testid="input-department"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <Button size="sm" variant="ghost" onClick={saveEdit} className="h-7 w-7 p-0" data-testid="button-save-department">
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 w-7 p-0" data-testid="button-cancel-department">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        {request.department ? (
                          <span className="text-base sm:text-lg font-medium text-[#236383]/70 break-words">{request.department}</span>
                        ) : canEdit ? (
                          <span className="text-base sm:text-lg font-normal text-gray-400 italic">No department</span>
                        ) : null}
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing('department', request.department || '')}
                            className="h-6 px-2 hidden group-hover:inline-flex"
                            title={request.department ? 'Edit department' : 'Add department'}
                            data-testid="button-edit-department"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Date — placed directly under the org name so every card leads
                  with date/time (consistent card skeleton). Moved here from the
                  former top-right position. */}
              <div className="flex items-center gap-1 mt-1 group">
                {isEditingThisCard && editingField === dateFieldToEdit ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-[#007E8C]" />
                    <Input
                      type="date"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="h-8 bg-white text-gray-900 border-[#007E8C]/20"
                    />
                    <Button size="sm" onClick={saveEdit} aria-label="Save date">
                      <Save className="w-3 h-3" aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100" aria-label="Cancel editing">
                      <X className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-[#007E8C]" />
                    <span className="text-sm uppercase text-gray-600 mr-1">{dateLabel}:</span>
                    <span className="text-base sm:text-lg md:text-xl font-bold text-[#47B3CB]">
                      {dateInfo ? dateInfo.text : <span className="text-gray-600 font-medium text-sm">No date</span>}
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing(dateFieldToEdit, formatDateForInput(displayDate?.toString() || ''))}
                        className="text-[#007E8C] hover:bg-[#007E8C]/10 h-6 px-1 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Edit date"
                      >
                        <Edit2 className="w-3 h-3" aria-hidden="true" />
                      </Button>
                    )}
                  </>
                )}
              </div>
              {/* Traffic conflict (e.g. World Cup matches). Once scheduled, only
                  the confirmed scheduled date matters — checking the original
                  desiredEventDate too left a stale badge when an event was
                  rescheduled off a conflict date onto a clear one. */}
              <TrafficConflictBadge
                dates={[getEffectiveEventDate(request)]}
                className="mt-1 mr-1"
              />
              {/* Returning Organization Indicator */}
              {returningOrgData?.isReturning && (() => {
                const eventDate = returningOrgData.mostRecentEvent?.eventDate ? new Date(returningOrgData.mostRecentEvent.eventDate) : null;
                const collectionDate = returningOrgData.mostRecentCollection?.dateCollected ? new Date(returningOrgData.mostRecentCollection.dateCollected) : null;
                const lastDate = eventDate && collectionDate
                  ? (eventDate > collectionDate ? eventDate : collectionDate)
                  : eventDate || collectionDate;
                const lastDateLabel = lastDate && !isNaN(lastDate.getTime())
                  ? lastDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                  : null;
                return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={`whitespace-nowrap cursor-help mt-1 ${
                        returningOrgData.isReturningContact
                          ? 'bg-purple-50 text-purple-700 border-purple-300'
                          : (request.email || request.firstName || request.lastName || request.phone)
                            ? 'bg-amber-50 text-amber-700 border-amber-300'
                            : 'bg-gray-50 text-gray-600 border-gray-300'
                      }`}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Returning Org
                      {lastDateLabel && (
                        <span className="ml-1 text-xs opacity-80">&middot; Last: {lastDateLabel}</span>
                      )}
                      {returningOrgData.isReturningContact
                        ? <span className="ml-1 text-xs opacity-80">&middot; Same Contact</span>
                        : (request.email || request.firstName || request.lastName || request.phone)
                          ? <span className="ml-1 text-xs opacity-80">&middot; New Contact</span>
                          : null
                      }
                      {returningOrgData.pastEventCount > 0 && (
                        <span className="ml-1 text-xs opacity-80">
                          ({returningOrgData.pastEventCount} past event{returningOrgData.pastEventCount !== 1 ? 's' : ''})
                        </span>
                      )}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-medium">This organization has worked with us before!</p>
                      {returningOrgData.pastEventCount > 0 && (
                        <p className="text-sm">
                          {returningOrgData.pastEventCount} previous event{returningOrgData.pastEventCount !== 1 ? 's' : ''} on file
                        </p>
                      )}
                      {returningOrgData.collectionCount > 0 && (
                        <p className="text-sm">
                          {returningOrgData.collectionCount} sandwich collection{returningOrgData.collectionCount !== 1 ? 's' : ''} recorded
                        </p>
                      )}
                      {returningOrgData.mostRecentEvent && (
                        <p className="text-xs text-muted-foreground">
                          Most recent: {returningOrgData.mostRecentEvent.eventDate
                            ? new Date(returningOrgData.mostRecentEvent.eventDate).toLocaleDateString()
                            : 'Date unknown'}
                          {returningOrgData.mostRecentEvent.status && ` (${returningOrgData.mostRecentEvent.status})`}
                        </p>
                      )}
                      {returningOrgData.pastDepartments && returningOrgData.pastDepartments.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Past department{returningOrgData.pastDepartments.length !== 1 ? 's' : ''}: {returningOrgData.pastDepartments.join(', ')}
                        </p>
                      )}
                      {returningOrgData.isReturningContact ? (
                        <p className="text-xs text-purple-600 font-medium mt-2">
                          Same contact as a previous event &mdash; personalize your outreach!
                        </p>
                      ) : (request.email || request.firstName || request.lastName || request.phone) ? (
                        <div className="mt-2">
                          {returningOrgData.pastContactName && (
                            <p className="text-xs text-muted-foreground">
                              Past contact: {returningOrgData.pastContactName}
                            </p>
                          )}
                          <p className="text-xs text-amber-600 font-medium">
                            New contact for this org &mdash; treat as a first-time outreach
                          </p>
                        </div>
                      ) : (
                        <div className="mt-2">
                          {returningOrgData.pastContactName && (
                            <p className="text-xs text-muted-foreground">
                              Past contact: {returningOrgData.pastContactName}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 font-medium">
                            No contact information provided for this request
                          </p>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
                );
              })()}
              {/* Returning Contact badge - shows when the contact person has submitted before but org didn't match */}
              {!returningOrgData?.isReturning && returningOrgData?.isReturningContact && (() => {
                const likelySameOrg = returningOrgData.orgSimilarityScore && returningOrgData.orgSimilarityScore >= 0.7;
                return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={`whitespace-nowrap cursor-help mt-1 ${
                        likelySameOrg
                          ? 'bg-orange-50 text-orange-700 border-orange-300'
                          : 'bg-purple-50 text-purple-700 border-purple-300'
                      }`}
                    >
                      <User className="w-3 h-3 mr-1" />
                      Returning Contact
                      {likelySameOrg
                        ? <span className="ml-1 text-xs opacity-80">&middot; Likely Same Org</span>
                        : <span className="ml-1 text-xs opacity-80">&middot; Different Org</span>
                      }
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-medium">This contact has submitted a request before!</p>
                      {returningOrgData.contactPastOrgs && returningOrgData.contactPastOrgs.length > 0 && (
                        <p className="text-sm">
                          Previously submitted under: {returningOrgData.contactPastOrgs.join(', ')}
                        </p>
                      )}
                      {likelySameOrg ? (
                        <p className="text-xs text-orange-600 font-medium mt-2">
                          The org name is similar to a past submission &mdash; likely the same organization with a slightly different name. Consider updating the org name on one to match.
                        </p>
                      ) : (
                        <p className="text-xs text-purple-600 font-medium mt-2">
                          Same person, different organization &mdash; personalize your outreach!
                        </p>
                      )}
                      {returningOrgData.pastContactName && (
                        <p className="text-xs text-muted-foreground">
                          Past name on file: {returningOrgData.pastContactName}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
                );
              })()}
              {/* New Department Indicator */}
              {returningOrgData?.isReturning && request.department && returningOrgData.pastDepartments && returningOrgData.pastDepartments.length > 0 && !returningOrgData.pastDepartments.some(
                d => d === (request.department || '').trim().replace(/\s+/g, ' ').toLowerCase()
              ) && (
                <Badge
                  variant="outline"
                  className="whitespace-nowrap bg-blue-50 text-blue-700 border-blue-300 mt-1"
                >
                  New Department
                </Badge>
              )}
              {/* Rescheduled from postponement indicator */}
              {request.wasPostponed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="whitespace-nowrap bg-amber-50 text-amber-700 border-amber-300 mt-1 cursor-help"
                    >
                      <History className="w-3 h-3 mr-1" />
                      Rescheduled
                      {request.postponementCount && request.postponementCount > 1 && ` (${request.postponementCount}x)`}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-medium">This event was previously postponed and rescheduled</p>
                      {request.originalScheduledDate && (
                        <p className="text-sm">
                          Originally scheduled: {new Date(request.originalScheduledDate).toLocaleDateString()}
                        </p>
                      )}
                      {request.postponementReason && (
                        <p className="text-sm">
                          Reason: {request.postponementReason}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Partner Organizations - inline on same row */}
              {request.partnerOrganizations && Array.isArray(request.partnerOrganizations) && request.partnerOrganizations.length > 0 && (
                <div className="flex items-center flex-wrap gap-1 mt-1">
                  <span className="text-[#236383]/60 text-sm sm:text-base">Partner:</span>
                  {request.partnerOrganizations.map((partner, index) => (
                    <span
                      key={index}
                      className={`text-base sm:text-lg text-[#236383]/80 font-medium ${canEdit ? 'cursor-pointer hover:text-[#007E8C]' : ''}`}
                      onClick={() =>
                        canEdit &&
                        startEditing(
                          `partnerOrg_${index}`,
                          JSON.stringify({ name: partner.name || '', department: partner.department || '' })
                        )
                      }
                    >
                      {partner.name}
                      {partner.department && ` • ${partner.department}`}
                    </span>
                  ))}
                </div>
              )}
              
              {/* Address - moved from Event Details */}
              {isEditingThisCard && editingField === 'eventAddress' ? (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <MapPin className="w-5 h-5 shrink-0 text-[#007E8C]" />
                  <Input
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    placeholder="Enter event address"
                    className="h-9 text-base flex-1 min-w-[200px] max-w-md"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Button size="sm" onClick={saveEdit} aria-label="Save address">
                    <Save className="w-3 h-3" aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100" aria-label="Cancel editing">
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </div>
              ) : request.eventAddress ? (
                <div className="flex items-start gap-2 mt-2 group">
                  <MapPin className="w-5 h-5 shrink-0 mt-0.5 text-[#007E8C]" />
                  <a
                    href={`https://maps.google.com/maps?q=${encodeURIComponent(request.eventAddress)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lg sm:text-xl font-bold text-[#007E8C] hover:text-[#007E8C]/80 underline break-words"
                  >
                    {request.eventAddress}
                  </a>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing('eventAddress', request.eventAddress || '')}
                      className="text-[#007E8C] hover:bg-[#007E8C]/10 h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Edit address"
                    >
                      <Edit2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ) : canEdit ? (
                <div className="flex items-center gap-2 mt-2">
                  <MapPin className="w-5 h-5 shrink-0 text-gray-400" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEditing('eventAddress', '')}
                    className="text-[#007E8C] border-[#007E8C]/30 hover:bg-[#007E8C]/10 h-7 px-3"
                  >
                    <Plus className="w-3 h-3 mr-1" aria-hidden="true" />
                    Add Address
                  </Button>
                </div>
              ) : null}
            </div>

            {/* No-location flag — pinned top-right so a scheduled event missing
                its address stands out when scanning the list. Hidden while the
                address is being edited so re-clicking it can't wipe the draft. */}
            {!request.eventAddress?.trim() && !(isEditingThisCard && editingField === 'eventAddress') && (
              <InfoBadge
                tone="urgent"
                icon={MapPinOff}
                onClick={canEdit ? (e) => { e.stopPropagation(); startEditing('eventAddress', ''); } : undefined}
                className={`self-end sm:self-start shrink-0 order-first sm:order-none bg-red-600 hover:bg-red-600 text-white border-red-700 shadow-sm text-xs sm:text-sm font-semibold whitespace-nowrap sm:whitespace-nowrap ${canEdit ? 'hover:opacity-90' : ''}`}
                title={canEdit ? 'No event location — click to add an address' : 'No event location'}
                data-testid="badge-no-location"
              >
                No Location
              </InfoBadge>
            )}
          </div>

          {/* Rescheduled Badge */}
          {request.status === 'rescheduled' && request.originalScheduledDate && (
            <div className="mb-1">
              <Badge className="bg-blue-100 text-blue-700 border border-blue-200 text-xs font-medium">
                <RefreshCw className="w-3 h-3 mr-1" />
                Rescheduled from {new Date(request.originalScheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Badge>
            </div>
          )}


          {/* Status & Action Badges — visually tiered.
              Two-tier rule of thumb applied across all chips below:
                STATUS (informational, no action required): muted gray
                  background, no icon. Reader knows the state but isn't
                  asked to do anything.
                ACTION (something is wrong, missing, or undecided): solid
                  red / amber background with ⚠️ icon prefix and white
                  text so the eye lands on them first when scanning a
                  list of 25 cards.
              The previous styling treated "Date Confirmed" and "On
              Volunteer Hub" with the same visual weight as warning
              chips, which is why the row looked flat — every chip was
              demanding attention equally. */}
          <div className="flex flex-wrap items-center gap-1 xs:gap-1.5 sm:gap-2 min-w-0">
            <Badge
              onClick={(e) => { e.stopPropagation(); canEdit && quickToggleBoolean('isConfirmed', request.isConfirmed); }}
              className={`cursor-pointer hover:opacity-90 transition-opacity text-xs sm:text-sm font-medium ${
                request.isConfirmed
                  ? // STATUS: date is confirmed — informational, mute it
                    'bg-gray-100 text-gray-700 border border-gray-300'
                  : // ACTION: date is still pending — needs attention
                    'bg-amber-500 text-white border border-amber-600 inline-flex items-center gap-1'
              }`}
            >
              {request.isConfirmed ? (
                'Date Confirmed'
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3" />
                  Date Pending
                </>
              )}
            </Badge>

            <Badge
              onClick={(e) => { e.stopPropagation(); canEdit && quickToggleBoolean('addedToOfficialSheet', request.addedToOfficialSheet); }}
              className={`cursor-pointer hover:opacity-90 transition-opacity text-xs sm:text-sm font-medium flex items-center gap-1 ${
                request.addedToOfficialSheet
                  ? // STATUS: on the calendar — mute
                    'bg-gray-100 text-gray-700 border border-gray-300'
                  : // ACTION: not on calendar — needs attention
                    'bg-amber-500 text-white border border-amber-600'
              }`}
            >
              {request.addedToOfficialSheet ? (
                `On Calendar${request.addedToOfficialSheetAt ? ` · ${new Date(request.addedToOfficialSheetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3" />
                  Not on Calendar
                </>
              )}
            </Badge>

            <Badge
              onClick={(e) => { e.stopPropagation(); canEdit && quickToggleBoolean('showOnVolunteerHub', (request as any).showOnVolunteerHub); }}
              className={`cursor-pointer hover:opacity-90 transition-opacity text-xs sm:text-sm font-medium ${
                // STATUS in both states: hub is informational, not a
                // call to action either way.
                (request as any).showOnVolunteerHub
                  ? 'bg-gray-100 text-gray-700 border border-gray-300'
                  : 'bg-gray-50 text-gray-500 border border-gray-200'
              }`}
            >
              {(request as any).showOnVolunteerHub ? 'On Volunteer Hub' : 'Not on Hub'}
            </Badge>

            {request.isMlkDayEvent && <MlkDayBadge />}

            {/* Corporate Badge */}
            {(request as any).isCorporatePriority && (
              <Badge className="bg-gradient-to-br from-[#B8860B] to-[#DAA520] text-white text-xs sm:text-sm font-medium flex items-center gap-1">
                <Building className="w-3 h-3" />
                <span className="hidden sm:inline">Corporate</span>
                <span className="sm:hidden">Corp</span>
              </Badge>
            )}

            <RefrigerationWarningBadge
              sandwichTypes={request.sandwichTypes}
              hasRefrigeration={request.hasRefrigeration}
              className="text-xs sm:text-sm"
            />

            <MissingDriverTimeBadge
              driversNeeded={(request as any).driversNeeded}
              selfTransport={(request as any).selfTransport}
              eventStartTime={(request as any).eventStartTime}
              eventEndTime={(request as any).eventEndTime}
              pickupTime={(request as any).pickupTime}
              pickupDateTime={(request as any).pickupDateTime}
              pickupTimeWindow={(request as any).pickupTimeWindow}
              driverPickupTime={(request as any).driverPickupTime}
              className="text-xs sm:text-sm"
            />

            {/* Sandwich count badge.
                STATUS when we have a real count (just informational).
                ACTION when count is TBD — escalate to warning so it
                stands out alongside other "data missing" chips. */}
            {(() => {
              const isTbd = sandwichCountBadgeText === 'TBD';
              return (
                <Badge
                  className={`text-xs sm:text-sm font-medium flex items-center gap-1 min-w-0 max-w-full ${
                    isTbd
                      ? 'bg-amber-500 text-white border border-amber-600'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                  title={sandwichInfo}
                >
                  {isTbd ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <span aria-hidden="true">🥪</span>
                  )}
                  <span className="min-w-0 truncate">
                    {isTbd ? 'Sandwich count needed' : sandwichCountBadgeText}
                  </span>
                  {!isTbd && (
                    <span className="hidden sm:inline opacity-90">
                      &nbsp;sandwiches
                    </span>
                  )}
                </Badge>
              );
            })()}

            {/* Attendance badge - show when attendance is set */}
            {(request.attendanceAdults || request.attendanceTeens || request.attendanceKids) && (
              <Badge
                className="bg-[#007E8C] text-white border border-[#007E8C] text-xs sm:text-sm font-medium flex items-center gap-1"
                title={`${request.attendanceAdults || 0} adults, ${request.attendanceTeens || 0} teens, ${request.attendanceKids || 0} kids`}
              >
                <Users className="w-3 h-3" />
                <span>{(request.attendanceAdults || 0) + (request.attendanceTeens || 0) + (request.attendanceKids || 0)}</span>
                <span className="hidden sm:inline opacity-90">attending</span>
              </Badge>
            )}

            {/* Self-transport badge */}
            {request.selfTransport && (
              <Badge className="bg-amber-50 text-amber-800 border border-amber-400 text-xs sm:text-sm font-medium flex items-center gap-1">
                <Car className="w-3 h-3" />
                <span className="hidden sm:inline">Driving Own</span>
                <span className="sm:hidden">Self</span>
              </Badge>
            )}

            {/* Overnight holding badge */}
            {request.overnightHoldingLocation && (
              <Badge className="bg-[#236383] text-white border border-[#236383] text-xs sm:text-sm font-medium flex items-center gap-1">
                <span>🌙</span>
                <span className="hidden sm:inline">Holding Overnight</span>
                <span className="sm:hidden">O/N</span>
              </Badge>
            )}

            {/* Manual entry indicator moved to a subtle footer line below the
                Activity History section so it doesn't compete visually with the
                operational badges (van/staffing/etc.). It's a helpful note, not
                an alert. */}

            {/* Only show staffing badges if NOT self-transport */}
            {!request.selfTransport && (
              <>
                {staffingComplete ? (
                  <Badge className="bg-gradient-to-br from-[#47B3CB] to-[#007E8C] text-white border border-[#47B3CB] text-xs sm:text-sm font-medium">
                    Fully Staffed
                  </Badge>
                ) : (
                  <>
                    {/* Show regular driver needs only if NOT a van driver event (van takes precedence) */}
                    {driverNeeded > driverAssigned && !request.vanDriverNeeded && (
                      <Badge className={`${staffingBadgeColors} text-xs sm:text-sm font-medium`}>
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {driverNeeded - driverAssigned} driver{driverNeeded - driverAssigned > 1 ? 's' : ''} needed
                      </Badge>
                    )}
                    {/* Van Needed badge — unified.
                        The badge means "this event requires a van" regardless of
                        whether a driver has been assigned yet. It also surfaces
                        the same-day count of OTHER events needing a van that day,
                        which matters for fleet planning. Uses the shared
                        VanNeededBadgeAndButton (teal #007E8C) to match the badge
                        on InProcessCard. DHL-provided vans get their own badge
                        below since that's separate context (who supplies the van),
                        not whether one is needed. */}
                    {request.vanDriverNeeded && !request.isDhlVan && (
                      <VanNeededBadgeAndButton
                        eventRequestId={request.id}
                        vanDriverNeeded={request.vanDriverNeeded}
                        vanNeededLikely={(request as any).vanNeededLikely}
                        eventDate={displayDate}
                        canEdit={!!canEdit}
                        simpleToggle
                        mode="badge"
                      />
                    )}
                    {volunteerNeeded > volunteerAssigned && (
                      <Badge className={`${staffingBadgeColors} text-xs sm:text-sm font-medium`}>
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {volunteerNeeded - volunteerAssigned} volunteer{volunteerNeeded - volunteerAssigned > 1 ? 's' : ''} needed
                      </Badge>
                    )}
                  </>
                )}

                {/* Redundant "🚐 Van" assigned-driver badge removed — the unified
                    Van Needed badge above already conveys "this event needs a van"
                    regardless of assignment, and the dedicated Van slot lower in
                    the card shows who's assigned. The earlier badge added clutter
                    without surfacing new operational info. */}

                {request.isDhlVan && (
                  <Badge className="bg-amber-100 text-amber-900 border border-amber-300 text-xs sm:text-sm font-medium">
                    🚚 DHL Van
                  </Badge>
                )}
              </>
            )}

            {missingInfo.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="bg-gradient-to-br from-[#A31C41] to-[#8B1538] text-white border border-[#A31C41] text-xs sm:text-sm font-medium animate-pulse cursor-help">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Missing: {missingInfo.join(', ')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium mb-1">Missing Information:</p>
                  <ul className="list-disc list-inside text-sm">
                    {missingInfo.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Add Action — freeform escape hatch; only when no nextAction exists.
                Right-aligned in the badges row (mirrors InProcessCard) so it doesn't
                consume an entire extra row below. */}
            {onAddNextAction && !request.nextAction && (
              <Button
                size="sm"
                variant="outline"
                onClick={onAddNextAction}
                className="h-7 text-xs border-slate-300 text-slate-600 hover:bg-slate-100 ml-auto"
                data-testid="button-add-action"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Action
              </Button>
            )}
          </div>

          {/* Add department/partner buttons - hidden on mobile, shown on hover on desktop */}
          {canEdit && (
            <div className="hidden sm:flex items-center gap-2 mt-1">
              {!request.department && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-1 text-[#236383]/50 hover:text-[#007E8C] hover:bg-[#007E8C]/10 rounded transition-colors text-xs"
                      onClick={() => startEditing('department', '')}
                    >
                      <Building2 className="w-3 h-3 inline mr-1" />
                      Add dept
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Add department</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {(!request.partnerOrganizations || request.partnerOrganizations.length === 0) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-1 text-[#236383]/50 hover:text-[#007E8C] hover:bg-[#007E8C]/10 rounded transition-colors text-xs"
                      onClick={() => {
                        startEditing('partnerOrganizations', JSON.stringify([{ name: '', department: '', role: 'partner' }]));
                      }}
                    >
                      <Users className="w-3 h-3 inline mr-1" />
                      Add partner
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Add partner organization</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        {/* Van status — dedicated prominent row so the badge doesn't get lost in the
            pills wrap. The "Van Needed" badge hides once a van driver is assigned
            (or DHL is set); the Transport/Refrigeration purpose stays visible
            because it still matters after the van is covered. */}
        {!request.selfTransport && (
          (!request.assignedVanDriverId && !request.isDhlVan && (request.vanDriverNeeded || (request as any).vanNeededLikely))
          || request.vanNeededFor
        ) && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase font-bold tracking-wide text-[#236383]/70">
              Van:
            </span>
            {!request.assignedVanDriverId && !request.isDhlVan && (request.vanDriverNeeded || (request as any).vanNeededLikely) && (
              <VanNeededBadgeAndButton
                eventRequestId={request.id}
                vanDriverNeeded={request.vanDriverNeeded}
                vanNeededLikely={(request as any).vanNeededLikely}
                eventDate={displayDate}
                canEdit={!!canEdit}
                simpleToggle
                mode="badge"
              />
            )}
            {(request.vanDriverNeeded || request.assignedVanDriverId || request.isDhlVan) && request.vanNeededFor === 'transport' && (
              <span className="text-xs text-[#236383]">Transport</span>
            )}
            {(request.vanDriverNeeded || request.assignedVanDriverId || request.isDhlVan) && request.vanNeededFor === 'refrigeration' && (
              <span className="text-xs text-[#236383]">Refrigeration</span>
            )}
          </div>
        )}

        {/* Auto-flag: this event flipped to "van needed" but still has assigned regular drivers.
            The regular driver slot won't satisfy the van requirement — coordinator should
            review (likely reassign as van driver or remove). */}
        {!request.selfTransport && request.vanDriverNeeded && driverAssigned > 0 && !request.assignedVanDriverId && !request.isDhlVan && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-[#A31C41]/40 bg-[#A31C41]/5 px-3 py-2 text-xs text-[#A31C41]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Driver conflict — van is needed</div>
              <div className="text-[#A31C41]/80 mt-0.5">
                {driverAssigned} regular driver{driverAssigned !== 1 ? 's are' : ' is'} assigned, but this event now needs a van driver.
                Review the volunteer hub and reassign or remove them.
              </div>
            </div>
          </div>
        )}

        {/* Partner editing modals */}
        {isEditingThisCard && editingField?.startsWith('partnerOrg_') && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {(() => {
              const index = parseInt(editingField.split('_')[1]);
              const partner = request.partnerOrganizations?.[index];
              let parsed = { name: partner?.name || '', department: partner?.department || '' };
              try {
                const maybeParsed = JSON.parse(editingValue || '{}');
                if (maybeParsed && typeof maybeParsed === 'object') {
                  parsed = {
                    name: (maybeParsed as any).name ?? parsed.name,
                    department: (maybeParsed as any).department ?? parsed.department,
                  };
                }
              } catch {
                // ignore
              }
              return (
                <>
                  <Input
                    value={parsed.name}
                    onChange={(e) =>
                      setEditingValue(JSON.stringify({ name: e.target.value, department: parsed.department }))
                    }
                    className="h-8 text-base w-40 sm:w-48"
                    autoFocus
                    placeholder="Partner name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Input
                    value={parsed.department || ''}
                    onChange={(e) =>
                      setEditingValue(JSON.stringify({ name: parsed.name, department: e.target.value }))
                    }
                    className="h-8 text-base w-32 sm:w-40"
                    placeholder="Dept (optional)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={saveEdit} className="h-7 w-7 p-0">
                    <Save className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 w-7 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </>
              );
            })()}
          </div>
        )}
        {isEditingThisCard && editingField === 'partnerOrganizations' && (!request.partnerOrganizations || request.partnerOrganizations.length === 0) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {(() => {
              let parsed = { name: '', department: '' };
              try {
                const arr = JSON.parse(editingValue || '[]');
                if (Array.isArray(arr) && arr.length > 0) {
                  parsed = { name: arr[0]?.name || '', department: arr[0]?.department || '' };
                }
              } catch {
                // ignore
              }
              return (
                <>
                  <Input
                    value={parsed.name}
                    onChange={(e) => setEditingValue(JSON.stringify([{ name: e.target.value, department: parsed.department, role: 'partner' }]))}
                    className="h-8 text-base w-40 sm:w-48"
                    autoFocus
                    placeholder="Partner name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Input
                    value={parsed.department}
                    onChange={(e) => setEditingValue(JSON.stringify([{ name: parsed.name, department: e.target.value, role: 'partner' }]))}
                    className="h-8 text-base w-32 sm:w-40"
                    placeholder="Dept (optional)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={saveEdit} className="h-7 w-7 p-0">
                    <Save className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 w-7 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </>
              );
            })()}
          </div>
        )}

        {/* Next Action — only the "has-an-action" prominent display.
            The "Add Action" affordance lives in the header pills row when no
            nextAction exists, so we no longer render an entire extra row here
            just to host that button. */}
        {request.nextAction && (
          <div className="mb-4 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">Next Action:</span>
                  <p className="mt-1 text-amber-900 font-medium break-words">{request.nextAction}</p>
                </div>
              </div>
              <div className="flex gap-1 sm:gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
                {onEditNextAction && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onEditNextAction}
                    className="h-auto min-h-7 px-2 py-1 text-amber-700 hover:bg-amber-100"
                    title="Edit action"
                    aria-label="Edit action"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                )}
                {onCompleteNextAction && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onCompleteNextAction}
                    className="h-auto min-h-7 px-2 py-1 text-green-600 hover:bg-green-100"
                    title="Complete action"
                    aria-label="Complete action"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Info Section - 2 Column Grid.
            Matches InProcessCard density: Event Details + Event Organizer in
            the left column, Team Assignments in the right column. Activates at
            `lg` (≥1024px viewport) which is the same breakpoint InProcessCard
            uses. At narrower widths (mobile, half-panel multi-view) it collapses
            to a single column gracefully. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-4 lg:items-start">
          {/* Column 1: Event Details */}
          <div className="flex flex-col gap-4 h-full">
            {/* Event Details Card */}
            <div className="bg-white rounded-lg p-4 border-l-4 border-[#47B3CB] border-t border-r border-b border-[#47B3CB]/20 shadow-md">
              <h3 className="text-sm uppercase font-bold tracking-wide text-[#236383] flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4 text-[#47B3CB]" aria-hidden="true" />
                Event Details
              </h3>
              <div className="space-y-3">
            {/* Times Row with Add Times button */}
            <div className="space-y-3">
              {/* Time fields - stacked layout when editing, grid when not */}
              {addingAllTimes ? (
                /* Stacked layout when editing all times */
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[#236383] text-sm uppercase font-semibold w-16">Start</span>
                    <Input
                      type="time"
                      value={tempStartTime}
                      onChange={(e) => setTempStartTime(e.target.value)}
                      className="h-10 bg-white text-gray-900 text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20 px-3 w-32"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[#236383] text-sm uppercase font-semibold w-16">End</span>
                    <Input
                      type="time"
                      value={tempEndTime}
                      onChange={(e) => setTempEndTime(e.target.value)}
                      className="h-10 bg-white text-gray-900 text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20 px-3 w-32"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-700 text-sm uppercase font-semibold w-16">Pickup</span>
                    <Input
                      type="time"
                      value={tempPickupTime}
                      onChange={(e) => setTempPickupTime(e.target.value)}
                      className="h-10 bg-white text-gray-900 text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20 px-3 w-32"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const updates: Record<string, string> = {};
                        const existingPickupTime = request.pickupDateTime
                          ? formatTimeForInput(new Date(request.pickupDateTime).toTimeString().slice(0, 5))
                          : (request.pickupTime ? formatTimeForInput(request.pickupTime) : '');
                        if (tempStartTime && tempStartTime !== formatTimeForInput(request.eventStartTime || '')) {
                          updates.eventStartTime = tempStartTime;
                        }
                        if (tempEndTime && tempEndTime !== formatTimeForInput(request.eventEndTime || '')) {
                          updates.eventEndTime = tempEndTime;
                        }
                        if (tempPickupTime && tempPickupTime !== existingPickupTime) {
                          updates.pickupTime = tempPickupTime;
                        }
                        if (Object.keys(updates).length > 0) {
                          updateFieldsMutation.mutate(updates);
                        } else {
                          setAddingAllTimes(false);
                        }
                      }}
                      className="h-9 px-4 text-sm"
                      disabled={updateFieldsMutation.isPending}
                      aria-label="Save all times"
                    >
                      <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                      {updateFieldsMutation.isPending ? 'Saving...' : 'Save All'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingAllTimes(false);
                        setTempStartTime('');
                        setTempEndTime('');
                        setTempPickupTime('');
                      }}
                      className="text-gray-600 hover:bg-gray-100 h-9 px-4 text-sm"
                      aria-label="Cancel"
                    >
                      <X className="w-4 h-4 mr-2" aria-hidden="true" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                /* Compact layout when viewing - inline on mobile */
                <div className="flex flex-col gap-3">
                  {/* Mobile: Compact inline times */}
                  <div className="sm:hidden">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#236383]" />
                        <span 
                          className="font-bold text-[#236383] cursor-pointer" 
                          onClick={() => canEdit && startEditing('eventStartTime', formatTimeForInput(request.eventStartTime || ''))}
                        >
                          {request.eventStartTime ? formatTime12Hour(request.eventStartTime) : '—'}
                        </span>
                        <span className="text-gray-400">-</span>
                        <span 
                          className="font-bold text-[#236383] cursor-pointer"
                          onClick={() => canEdit && startEditing('eventEndTime', formatTimeForInput(request.eventEndTime || ''))}
                        >
                          {request.eventEndTime ? formatTime12Hour(request.eventEndTime) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-600">
                        <span className="text-xs uppercase font-medium">Pickup:</span>
                        <span 
                          className="font-bold text-gray-900 cursor-pointer"
                          onClick={() => canEdit && startEditing('pickupDateTime', request.pickupDateTime?.toString() || '')}
                        >
                          {request.pickupDateTime 
                            ? formatTime12Hour(new Date(request.pickupDateTime).toTimeString().slice(0, 5))
                            : request.pickupTime 
                              ? formatTime12Hour(request.pickupTime)
                              : '—'}
                        </span>
                      </div>
                      {/* Attendance on mobile */}
                      {(request.attendanceAdults || request.attendanceTeens || request.attendanceKids) && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <Users className="w-3.5 h-3.5" />
                          <span className="font-bold text-gray-900">
                            {(request.attendanceAdults || 0) + (request.attendanceTeens || 0) + (request.attendanceKids || 0)}
                          </span>
                          <span className="text-xs">attending</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Desktop: Original grid layout */}
                  <div className="hidden sm:flex flex-row items-start justify-between gap-4 min-w-0">
                    <div className="grid grid-cols-3 gap-3 text-sm flex-1 min-w-0">
                      {/* Start Time */}
                      <div className="min-w-0">
                        <div className="text-[#236383] text-sm uppercase font-semibold mb-1">Start</div>
                        {isEditingThisCard && editingField === 'eventStartTime' ? (
                          <div className="flex flex-col gap-2">
                            <Input
                              type="time"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="h-10 bg-white text-gray-900 text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20 px-3"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={saveEdit} className="h-8 px-3 text-sm" aria-label="Save">
                                <Save className="w-4 h-4 mr-1" aria-hidden="true" />
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 px-3 text-gray-600 hover:bg-gray-100 text-sm" aria-label="Cancel">
                                <X className="w-4 h-4 mr-1" aria-hidden="true" />
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-base font-bold group cursor-pointer text-[#236383] py-1" onClick={() => canEdit && startEditing('eventStartTime', formatTimeForInput(request.eventStartTime || ''))}>
                            {request.eventStartTime ? formatTime12Hour(request.eventStartTime) : <span className="text-gray-600 font-medium">Not set</span>}
                          </div>
                        )}
                      </div>

                      {/* End Time */}
                      <div className="min-w-0">
                        <div className="text-[#236383] text-sm uppercase font-semibold mb-1">End</div>
                        {isEditingThisCard && editingField === 'eventEndTime' ? (
                          <div className="flex flex-col gap-2">
                            <Input
                              type="time"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="h-10 bg-white text-gray-900 text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20 px-3"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={saveEdit} className="h-8 px-3 text-sm" aria-label="Save">
                                <Save className="w-4 h-4 mr-1" aria-hidden="true" />
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 px-3 text-gray-600 hover:bg-gray-100 text-sm" aria-label="Cancel">
                                <X className="w-4 h-4 mr-1" aria-hidden="true" />
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-base font-bold group cursor-pointer text-[#236383] py-1" onClick={() => canEdit && startEditing('eventEndTime', formatTimeForInput(request.eventEndTime || ''))}>
                            {request.eventEndTime ? formatTime12Hour(request.eventEndTime) : <span className="text-gray-600 font-medium">Not set</span>}
                          </div>
                        )}
                      </div>

                    {/* Pickup Time */}
                    <div className="min-w-0">
                      <div className="text-gray-700 text-sm uppercase font-semibold mb-1">Pickup</div>
                      {isEditingThisCard && editingField === 'pickupDateTime' ? (
                        <div className="flex flex-col gap-2">
                          <DateTimePicker
                            value={editingValue}
                            onChange={setEditingValue}
                            className="h-10 min-w-0 w-full text-base border-[#007E8C]/30 focus:border-[#007E8C] focus:ring-2 focus:ring-[#007E8C]/20"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={saveEdit} className="h-8 px-3 text-sm" aria-label="Save">
                              <Save className="w-4 h-4 mr-1" aria-hidden="true" />
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 px-3 text-gray-600 hover:bg-gray-100 text-sm" aria-label="Cancel">
                              <X className="w-4 h-4 mr-1" aria-hidden="true" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-base font-bold group cursor-pointer text-gray-900 flex items-center gap-2 flex-wrap min-w-0" onClick={() => canEdit && startEditing('pickupDateTime', request.pickupDateTime?.toString() || '')}>
                            {(() => {
                              // Check if overnight holding is set and use overnight pickup time if available
                              // Overnight pickup is always next day
                              if (request.overnightHoldingLocation && request.overnightPickupTime) {
                                const timeStr = formatTime12Hour(request.overnightPickupTime);
                                // Calculate next day date from event date
                                const nextDayDate = displayDate ? (() => {
                                  const dateStr = displayDate.toString().split('T')[0];
                                  const [year, month, day] = dateStr.split('-').map(Number);
                                  const eventDate = new Date(year, month - 1, day);
                                  const nextDay = new Date(eventDate);
                                  nextDay.setDate(nextDay.getDate() + 1);
                                  return nextDay.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  });
                                })() : null;
                                return (
                                  <>
                                    <span>{timeStr}</span>
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs font-semibold max-w-full whitespace-normal break-words px-2 py-0.5">
                                      Next Day {nextDayDate ? `(${nextDayDate})` : ''}
                                    </Badge>
                                  </>
                                );
                              }
                              
                              // Use pickupDateTime if set
                              if (request.pickupDateTime) {
                                const pickupDate = new Date(request.pickupDateTime);
                                const eventDate = displayDate ? (() => {
                                  const dateStr = displayDate.toString().split('T')[0];
                                  const [year, month, day] = dateStr.split('-').map(Number);
                                  return new Date(year, month - 1, day);
                                })() : null;
                                
                                // Check if pickup is the next day after event
                                const isNextDay = eventDate ? (() => {
                                  const pickupDateOnly = new Date(pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate());
                                  const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
                                  const diffDays = Math.round((pickupDateOnly.getTime() - eventDateOnly.getTime()) / (1000 * 60 * 60 * 24));
                                  return diffDays === 1;
                                })() : false;
                                
                                const timeStr = formatTime12Hour(new Date(request.pickupDateTime).toTimeString().slice(0, 5));
                                
                                // If it's the next day, show indicator
                                if (isNextDay) {
                                  // Format the pickup date
                                  const nextDayDateStr = pickupDate.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  });
                                  return (
                                    <>
                                      <span>{timeStr}</span>
                                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs font-semibold max-w-full whitespace-normal break-words px-2 py-0.5">
                                        Next Day ({nextDayDateStr})
                                      </Badge>
                                    </>
                                  );
                                }
                                
                                return <span>{timeStr}</span>;
                              }
                              
                              // Fall back to pickupTime
                              return request.pickupTime ? formatTime12Hour(request.pickupTime) : <span className="text-gray-600 font-medium">Not set</span>;
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                  </div>

                  {/* Add Times button - only show when not editing and times are missing */}
                  {canEdit && (!request.eventStartTime || !request.eventEndTime || (!request.pickupDateTime && !request.pickupTime)) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-[#007E8C]/10 hover:bg-[#007E8C]/20 text-[#007E8C] border-[#007E8C]/30 px-3 h-auto min-h-9 max-w-full whitespace-normal break-words text-sm mt-4"
                      onClick={() => {
                        setTempStartTime(formatTimeForInput(request.eventStartTime || ''));
                        setTempEndTime(formatTimeForInput(request.eventEndTime || ''));
                        setTempPickupTime(request.pickupDateTime ? formatTimeForInput(new Date(request.pickupDateTime).toTimeString().slice(0, 5)) : (request.pickupTime ? formatTimeForInput(request.pickupTime) : ''));
                        setAddingAllTimes(true);
                      }}
                      title="Set all time fields at once"
                    >
                      <Clock className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Recipient Logistics - moved from Column 3 */}
            {((request.assignedRecipientIds && request.assignedRecipientIds.length > 0) || request.recipientsCount || request.overnightHoldingLocation || (isEditingThisCard && editingField === 'assignedRecipientIds')) ? (
              <div className="bg-gradient-to-r from-[#FBAD3F]/40 to-[#FBAD3F]/25 rounded-lg p-4 border-l-4 border-[#FBAD3F] border-t border-r border-b border-[#FBAD3F]/20 shadow-md mt-3">
                <h3 className="text-sm uppercase font-bold tracking-wide text-[#236383] mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#FBAD3F]" aria-hidden="true" />
                  Recipient Logistics
                </h3>
                
                <div className="space-y-4">
                  {/* Recipients */}
                  {(request.assignedRecipientIds && request.assignedRecipientIds.length > 0) || (isEditingThisCard && editingField === 'assignedRecipientIds') ? (
                    <div>
                      <div className="flex items-center justify-between mb-2 group">
                        <span className="text-xs uppercase text-gray-600 font-medium">Recipients</span>
                        {canEdit && !isEditingThisCard && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setTempOvernightHolding(request.overnightHoldingLocation || '');
                              startEditing('assignedRecipientIds', JSON.stringify(request.assignedRecipientIds || []));
                            }}
                            className="h-5 px-1.5 text-[#007E8C] hover:bg-[#007E8C]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {isEditingThisCard && editingField === 'assignedRecipientIds' ? (
                        <div className="space-y-2">
                          <MultiRecipientSelector
                            value={(() => {
                              try {
                                return JSON.parse(editingValue || '[]');
                              } catch {
                                return request.assignedRecipientIds || [];
                              }
                            })()}
                            onChange={(value) => setEditingValue(JSON.stringify(value))}
                            placeholder="Select recipient organizations..."
                            data-testid="assigned-recipients-editor"
                          />
                          <div className="flex items-center gap-2">
                            <Input
                              value={tempOvernightHolding}
                              onChange={(e) => setTempOvernightHolding(e.target.value)}
                              placeholder="Overnight holding location (optional)"
                              className="flex-1 bg-white text-gray-900"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                const updates: Record<string, any> = {};
                                try {
                                  const newRecipients = JSON.parse(editingValue || '[]');
                                  if (JSON.stringify(newRecipients) !== JSON.stringify(request.assignedRecipientIds || [])) {
                                    updates.assignedRecipientIds = newRecipients;
                                  }
                                } catch {
                                  // ignore
                                }
                                if (tempOvernightHolding !== request.overnightHoldingLocation) {
                                  updates.overnightHoldingLocation = tempOvernightHolding || null;
                                }
                                updateFieldsMutation.mutate(updates, {
                                  onSuccess: () => {
                                    cancelEdit();
                                  },
                                });
                              }}
                              disabled={updateFieldsMutation.isPending}
                            >
                              <Save className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : showAllocationEditor ? (
                        <InlineRecipientAllocationEditor
                          eventId={request.id}
                          assignedRecipientIds={parsePostgresArray(request.assignedRecipientIds)}
                          currentAllocations={request.recipientAllocations as RecipientAllocation[] | null | undefined}
                          estimatedSandwichCount={request.estimatedTotalSandwiches || request.sandwichCount}
                          resolveRecipientName={(id) => ({
                            name: getRecipientName ? getRecipientName(id) : id,
                            type: 'recipient'
                          })}
                          onCancel={() => setShowAllocationEditor(false)}
                          onSave={() => setShowAllocationEditor(false)}
                        />
                      ) : (
                        <div className="space-y-1">
                          {parsePostgresArray(request.assignedRecipientIds).map((id) => {
                            // Find allocation for this recipient
                            const allocations = request.recipientAllocations as RecipientAllocation[] | null | undefined;
                            const allocation = allocations?.find(a => a.recipientId === id);
                            return (
                              <div key={id} className="bg-white/60 rounded px-3 py-1.5 border border-[#FBAD3F]/30 flex items-center justify-between">
                                <span className="text-base font-semibold text-gray-900">
                                  {getRecipientName ? getRecipientName(id) : id}
                                </span>
                                {allocation && allocation.sandwichCount > 0 && (
                                  <Badge variant="outline" className="bg-white text-[#236383] border-[#236383]/30 text-xs">
                                    {allocation.sandwichCount} sandwiches
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                          {/* Button to edit allocations */}
                          {canEdit && parsePostgresArray(request.assignedRecipientIds).length > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setShowAllocationEditor(true)}
                              className="w-full h-7 mt-2 text-[#007E8C] hover:bg-[#007E8C]/10 border border-dashed border-[#007E8C]/30"
                            >
                              <Edit2 className="w-3 h-3 mr-1" />
                              {(request.recipientAllocations as RecipientAllocation[] | null | undefined)?.some(a => a.sandwichCount > 0)
                                ? 'Edit Allocations'
                                : 'Set Sandwich Allocations'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Overnight Holding */}
                  {request.overnightHoldingLocation && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 group">
                        <span className="text-xs uppercase text-gray-600 font-medium">Overnight Holding</span>
                        {canEdit && !isEditingThisCard && editingField !== 'overnightHoldingLocation' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing('overnightHoldingLocation', request.overnightHoldingLocation || '')}
                            className="h-5 px-1.5 text-[#007E8C] hover:bg-[#007E8C]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {isEditingThisCard && editingField === 'overnightHoldingLocation' ? (
                        <div className="flex flex-col gap-2">
                          <Input
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            placeholder="Overnight holding location"
                            className="bg-white text-gray-900"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={saveEdit}>
                              <Save className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-gray-900" title={request.overnightHoldingLocation || undefined}>
                          {request.overnightHoldingLocation}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Next-Day Pickup Time */}
                  {request.overnightHoldingLocation && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 group">
                        <span className="text-xs uppercase text-gray-600 font-medium">Next-Day Pickup Time</span>
                        {canEdit && !(isEditingThisCard && editingField === 'overnightPickupTime') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing('overnightPickupTime', formatTimeForInput(request.overnightPickupTime || ''))}
                            className="h-5 px-1.5 text-[#007E8C] hover:bg-[#007E8C]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {isEditingThisCard && editingField === 'overnightPickupTime' ? (
                        <div className="flex flex-col gap-2">
                          <Input
                            type="time"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="bg-white text-gray-900"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={saveEdit}>
                              <Save className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm font-semibold text-gray-900">
                          {request.overnightPickupTime ? formatTime12Hour(request.overnightPickupTime) : <span className="text-gray-500 italic">Not set</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : canEdit ? (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase text-gray-600 font-medium">Recipient Logistics</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-[#FBAD3F]/20 text-[#B8871F] border-[#FBAD3F] text-xs py-0.5 px-2">
                    Not set
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTempOvernightHolding(request.overnightHoldingLocation || '');
                      startEditing('assignedRecipientIds', JSON.stringify(request.assignedRecipientIds || []));
                    }}
                    className="h-5 px-2 text-[#007E8C] text-xs"
                  >
                    <Edit2 className="w-3 h-3 mr-1" />
                    Set
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Sandwiches - inside Event Details container, after Recipient Logistics */}
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200 mt-3">
              <Package className="w-5 h-5 shrink-0" />
              {isEditingThisCard && editingField === 'sandwichTypes' ? (
                <div className="flex-1 bg-white/10 rounded p-2 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={inlineSandwichMode === 'total' ? 'default' : 'outline'}
                      onClick={() => setInlineSandwichMode('total')}
                      className="h-7"
                    >
                      Exact
                    </Button>
                    <Button
                      size="sm"
                      variant={inlineSandwichMode === 'range' ? 'default' : 'outline'}
                      onClick={() => setInlineSandwichMode('range')}
                      className="h-7"
                    >
                      Range
                    </Button>
                    <Button
                      size="sm"
                      variant={inlineSandwichMode === 'types' ? 'default' : 'outline'}
                      onClick={() => setInlineSandwichMode('types')}
                      className="h-7"
                    >
                      By Type
                    </Button>
                  </div>

                  {inlineSandwichMode === 'total' && (
                    <Input
                      type="number"
                      value={inlineTotalCount}
                      onChange={(e) => setInlineTotalCount(parseInt(e.target.value) || 0)}
                      placeholder="Total count"
                      className="bg-white text-gray-900"
                    />
                  )}

                  {inlineSandwichMode === 'range' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Input
                          type="number"
                          value={inlineRangeMin}
                          onChange={(e) => setInlineRangeMin(parseInt(e.target.value) || 0)}
                          placeholder="Min"
                          className="w-24 bg-white text-gray-900"
                        />
                        <span className="text-white self-center">to</span>
                        <Input
                          type="number"
                          value={inlineRangeMax}
                          onChange={(e) => setInlineRangeMax(parseInt(e.target.value) || 0)}
                          placeholder="Max"
                          className="w-24 bg-white text-gray-900"
                        />
                      </div>
                      <Select value={inlineRangeType || undefined} onValueChange={setInlineRangeType}>
                        <SelectTrigger className="bg-white text-gray-900">
                          <SelectValue placeholder="Type (optional)" />
                        </SelectTrigger>
                        <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                          {SANDWICH_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {inlineSandwichMode === 'types' && (
                    <div className="space-y-2">
                      {inlineSandwichTypes.map((item, index) => (
                        <div key={index} className="flex gap-2">
                          <Select
                            value={item.type}
                            onValueChange={(value) => updateInlineSandwichType(index, 'type', value)}
                          >
                            <SelectTrigger className="bg-white text-gray-900">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={5}>
                              {SANDWICH_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateInlineSandwichType(index, 'quantity', parseInt(e.target.value) || 0)}
                            className="w-20 bg-white text-gray-900"
                          />
                          <Button size="sm" variant="ghost" onClick={() => removeInlineSandwichType(index)} className="text-white" aria-label="Remove sandwich type">
                            <X className="w-3 h-3" aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" onClick={addInlineSandwichType} variant="outline" className="w-full">
                        + Add Type
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={saveEdit} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-3 h-3 mr-1" /> Save
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-white hover:bg-white/20">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 group flex items-center gap-2">
                  <Badge className="bg-amber-50 text-amber-800 text-lg font-bold px-3 py-1.5 border-2 border-amber-400 shadow-sm flex items-center gap-2">
                    <span className="text-xl">🥪</span>
                    <span>{sandwichInfo}</span>
                  </Badge>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing('sandwichTypes', '')}
                      className="text-[#236383] hover:bg-[#236383]/10 h-6 px-2 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Edit sandwich types"
                    >
                      <Edit2 className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Record Final Sandwich Count - for day-of recording before event completes */}
            <div className="flex items-center gap-2 pt-3 border-t border-gray-200 mt-3">
              <Check className="w-5 h-5 shrink-0 text-green-600" aria-hidden="true" />
              {isEditingActualCount ? (
                <div className="flex-1 bg-green-50 rounded p-3 space-y-2 border border-green-200">
                  <div className="text-xs uppercase text-green-700 font-semibold">Record Final Count</div>
                  <div className="flex gap-2 mb-2">
                    <Button
                      size="sm"
                      variant={actualCountMode === 'simple' ? 'default' : 'outline'}
                      onClick={() => setActualCountMode('simple')}
                      className="h-7"
                    >
                      Total
                    </Button>
                    <Button
                      size="sm"
                      variant={actualCountMode === 'detailed' ? 'default' : 'outline'}
                      onClick={() => setActualCountMode('detailed')}
                      className="h-7"
                    >
                      By Type
                    </Button>
                  </div>

                  {actualCountMode === 'simple' && (
                    <Input
                      type="number"
                      value={actualCountSimple}
                      onChange={(e) => setActualCountSimple(e.target.value)}
                      placeholder="Enter final sandwich count"
                      className="bg-white"
                    />
                  )}

                  {actualCountMode === 'detailed' && (
                    <div className="space-y-2">
                      {SANDWICH_TYPES.map((type) => (
                        <div key={type.value} className="flex items-center gap-2">
                          <span className="text-sm w-24">{type.label}</span>
                          <Input
                            type="number"
                            value={actualCountTypes[type.value] || ''}
                            onChange={(e) => setActualCountTypes(prev => ({
                              ...prev,
                              [type.value]: parseInt(e.target.value) || 0
                            }))}
                            placeholder="0"
                            className="w-20 bg-white"
                          />
                        </div>
                      ))}
                      <div className="text-sm font-semibold text-green-700 pt-1">
                        Total: {Object.values(actualCountTypes).reduce((sum, n) => sum + (n || 0), 0)}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={saveActualCount} disabled={updateFieldsMutation.isPending}>
                      {updateFieldsMutation.isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-3 h-3 mr-1" /> Save Final Count
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelActualCountEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase text-gray-600 font-medium">Final Count</div>
                      <div className="text-sm font-semibold">
                        {(request as any).actualSandwichCount ? (
                          <span className="text-green-700">
                            {(request as any).actualSandwichCount} sandwiches recorded
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">Not yet recorded</span>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={startEditingActualCount}
                        className="h-7 px-3 text-xs border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400"
                      >
                        <Edit2 className="w-3 h-3 mr-1" />
                        {(request as any).actualSandwichCount ? 'Edit' : 'Record Final Count'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

              </div>
            </div>
          </div>

          {/* Column 2: Event Organizer (top) + Team Assignments (bottom).
              Event Organizer was previously in Column 1; moved here so the right
              column carries the people-oriented info (organizer + TSP contact + team)
              and the left column is purely Event Details. */}
          <div className="flex flex-col gap-4 h-full">
            <div className="bg-white rounded-lg p-4 border-l-4 border-[#47B3CB] border-t border-r border-b border-[#47B3CB]/20 shadow-md">
              <h3 className="text-sm uppercase font-bold tracking-wide text-[#236383] pb-2 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#47B3CB]" aria-hidden="true" />
                Event Organizer
              </h3>
              <div className="space-y-2 text-sm text-gray-900">
                {(request.firstName || request.lastName) && (
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 shrink-0" />
                    <span className="text-base font-semibold">
                      {request.firstName} {request.lastName}
                    </span>
                  </div>
                )}
                {request.email && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-4 h-4 shrink-0" />
                    <a href={`mailto:${request.email}`} className="hover:underline break-all min-w-0">
                      {request.email}
                    </a>
                  </div>
                )}
                {request.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 shrink-0" />
                    <a href={`tel:${request.phone}`} className="hover:underline">
                      {request.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg p-4 border-l-4 border-[#47B3CB] border-t border-r border-b border-[#47B3CB]/20 shadow-md flex-1">
              <h3 className="text-sm uppercase font-bold tracking-wide text-[#236383] mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#236383]" aria-hidden="true" />
                Team Assignments
              </h3>
              {/* TSP Contact + Mark Van Needed — one compact row */}
              {(tspContactDisplay || showMarkVanNeeded) && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200 group flex-wrap">
                  {tspContactDisplay ? (
                    <>
                      <UserPlus className="w-5 h-5 shrink-0 text-[#236383]" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs uppercase text-gray-600 font-medium">TSP Contact</div>
                        <div className="text-sm font-semibold text-gray-900 truncate" title={tspContactDisplay}>
                          {tspContactDisplay}
                        </div>
                      </div>
                      {canEditTspContact && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={onEditTspContact}
                          className="h-7 px-2 text-[#007E8C] hover:bg-[#007E8C]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Edit TSP contact"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <div className="flex-1 min-w-0" />
                  )}
                  {showMarkVanNeeded && (
                    <VanNeededBadgeAndButton
                      eventRequestId={request.id}
                      vanDriverNeeded={request.vanDriverNeeded}
                      vanNeededLikely={(request as any).vanNeededLikely}
                      canEdit={!!canEdit}
                      simpleToggle
                      mode="button"
                    />
                  )}
                </div>
              )}
              <div className="space-y-3">
                {/* Drivers */}
                {request.selfTransport ? (
                  // Organization is transporting sandwiches themselves
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-1 pb-3 border-b border-gray-200">
                    <Badge variant="outline" className="bg-[#FBAD3F]/20 text-[#D68319] border-[#FBAD3F] font-semibold text-sm py-1.5 px-3">
                      <Car className="w-4 h-4 mr-1.5" />
                      Organization Self-Transport
                    </Badge>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          // Clear self-transport and set drivers needed
                          startEditing('selfTransport', 'false');
                          setTimeout(() => saveEdit(), 0);
                        }}
                        className="h-5 px-2 text-[#007E8C] text-xs"
                      >
                        <Edit2 className="w-3 h-3 mr-0.5" />
                        Change
                      </Button>
                    )}
                  </div>
                ) : (driverNeeded > 0 || request.vanDriverNeeded || request.assignedVanDriverId || request.isDhlVan || (isEditingThisCard && editingField === 'driversNeeded')) ? (
                  <div className="pb-3 border-b border-gray-200 space-y-3">
                    {/* Van Driver Section - Show if vanDriverNeeded is true OR van driver is already assigned */}
                    {(request.vanDriverNeeded || request.assignedVanDriverId || request.isDhlVan) && (
                      <div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                          <span className="text-base font-bold text-gray-900 flex items-center gap-1 min-w-0">
                            <Truck className="w-5 h-5 text-amber-600 shrink-0" />
                            Van Driver
                            {request.assignedVanDriverId || request.isDhlVan ? ' (Assigned)' : ' (Needed)'}
                          </span>
                          {canEdit && !request.assignedVanDriverId && !request.isDhlVan && (
                            <Button 
                              size="sm" 
                              onClick={() => {
                                // Open assignment dialog for van driver
                                openAssignmentDialog('driver', true);
                              }} 
                              className="h-7 bg-amber-600 hover:bg-amber-700 text-white" 
                              aria-label="Assign van driver"
                            >
                              <Truck className="w-3 h-3" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                        <div className="space-y-1">
                          {request.assignedVanDriverId && (
                            <div className="flex items-start gap-2 bg-[#007E8C]/20 rounded px-3 py-1.5 border-2 border-[#007E8C]/40 min-w-0">
                              <span className="text-base font-bold text-[#007E8C] flex-1 min-w-0 break-words leading-tight">
                                {resolveUserName(request.assignedVanDriverId)} 🚐 (Van)
                              </span>
                              {canEdit && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemoveAssignment('driver', request.assignedVanDriverId!)}
                                  className="h-5 w-5 p-0 text-red-600 shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          )}
                          {request.isDhlVan && (
                            <div className="flex items-start gap-2 bg-amber-100 rounded px-3 py-1.5 border-2 border-amber-300 min-w-0">
                              <span className="text-base font-bold text-amber-900 flex-1 min-w-0 break-words leading-tight">
                                DHL Van 🚚
                              </span>
                              {canEdit && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => toggleDhlVan(false)}
                                  className="h-5 w-5 p-0 text-red-600 shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          )}
                          {request.vanDriverNeeded && !request.assignedVanDriverId && !request.isDhlVan && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 font-medium">
                              <Truck className="w-3 h-3 mr-1" />Van driver needed
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Regular Drivers Section - Show if driversNeeded > 0 */}
                    {(driverNeeded > 0 || (isEditingThisCard && editingField === 'driversNeeded')) && (
                      <div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                          {isEditingThisCard && editingField === 'driversNeeded' ? (
                            <div className="flex items-center gap-2 flex-1">
                              <Car className="w-4 h-4 text-[#236383]" />
                              <Input
                                type="number"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                className="h-7 w-16 text-sm"
                                min="0"
                                placeholder="0"
                              />
                              <span className="text-sm text-[#236383]">needed</span>
                              <Button size="sm" onClick={saveEdit} className="h-6 px-2" aria-label="Save">
                                <Save className="w-3 h-3" aria-hidden="true" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2" aria-label="Cancel">
                                <X className="w-3 h-3" aria-hidden="true" />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <span className="text-base font-bold text-gray-900 flex items-center gap-1">
                                <Car className="w-5 h-5" />
                                {driverNeeded > 0 ? `Drivers (${parsePostgresArray(request.assignedDriverIds).length}/${driverNeeded})` : 'Drivers'}
                              </span>
                              <div className="flex items-center gap-1">
                                {canEdit && (
                                  <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
                                    <button
                                      onClick={() => {
                                        const newVal = Math.max(0, driverNeeded - 1);
                                        if (quickUpdateField) {
                                          quickUpdateField('driversNeeded', newVal);
                                        } else {
                                          updateFieldsMutation.mutate({ driversNeeded: newVal });
                                        }
                                      }}
                                      className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                                      aria-label="Decrease drivers needed"
                                      title="Decrease drivers needed"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="h-7 w-7 flex items-center justify-center text-xs font-semibold text-gray-700 border-x border-gray-200 bg-gray-50">{driverNeeded}</span>
                                    <button
                                      onClick={() => {
                                        if (quickUpdateField) {
                                          quickUpdateField('driversNeeded', driverNeeded + 1);
                                        } else {
                                          updateFieldsMutation.mutate({ driversNeeded: driverNeeded + 1 });
                                        }
                                      }}
                                      className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                                      aria-label="Increase drivers needed"
                                      title="Increase drivers needed"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                                {canEdit && driverNeeded > 0 && (
                                  <Button
                                    size="sm"
                                    onClick={() => openAssignmentDialog('driver')}
                                    className="h-7"
                                    aria-label="Add driver"
                                  >
                                    <UserPlus className="w-3 h-3" aria-hidden="true" />
                                  </Button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="space-y-1">
                          {parsePostgresArray(request.assignedDriverIds).map((id) => {
                            const isCustom = id.startsWith('custom-');
                            // Check if the ID itself looks like a human name (not a system ID)
                            const idLooksLikeName = id &&
                              !id.startsWith('user_') &&
                              !id.startsWith('driver_') &&
                              !id.startsWith('driver-') &&
                              !id.startsWith('custom-') &&
                              !id.startsWith('host-contact-') &&
                              !/^\d+$/.test(id) &&
                              id.includes(' ');
                            const resolvedName = resolveUserName(id);
                            const displayName = isCustom
                              ? extractCustomName(id)
                              : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
                            const driverPersonNotes = (request.driverDetails as Record<string, { notes?: string }>)?.[id]?.notes || '';
                            const notesFieldKey = `driver-notes-${id}`;
                            const isEditingNotes = isEditingThisCard && editingField === notesFieldKey;
                            const nameFieldKey = `driver-name-${id}`;
                            const isEditingName = isEditingThisCard && editingField === nameFieldKey;
                            return (
                            <div key={id} className="bg-[#47B3CB]/20 rounded px-3 py-1.5 border border-[#47B3CB]/30 min-w-0 group">
                              <div className="flex items-start gap-2">
                                <span className="text-base font-bold text-[#236383] flex-1 min-w-0 break-words leading-tight">{displayName}</span>
                                {canEdit && (
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {isCustom && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => startEditing(nameFieldKey, displayName)}
                                        className="h-5 w-5 p-0 text-gray-500 hover:text-[#236383] opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Edit name"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => startEditing(notesFieldKey, driverPersonNotes)}
                                      className="h-5 w-5 p-0 text-gray-500 hover:text-[#236383] opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Add/edit note"
                                    >
                                      <MessageSquare className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRemoveAssignment('driver', id)}
                                      className="h-5 w-5 p-0 text-red-600 shrink-0"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {isEditingName && (
                                <div className="mt-1.5 flex items-center gap-1">
                                  <Input
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    autoFocus
                                    placeholder="Name"
                                    className="h-7 text-sm flex-1"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const trimmed = editingValue.trim();
                                      if (!trimmed || trimmed === displayName) {
                                        cancelEdit();
                                        return;
                                      }
                                      const newId = `custom-${Date.now()}-${trimmed.replace(/\s+/g, '-')}`;
                                      const arr = parsePostgresArray(request.assignedDriverIds);
                                      const newArr = arr.map((x) => (x === id ? newId : x));
                                      const details = (request.driverDetails as Record<string, any>) || {};
                                      const newDetails = { ...details };
                                      if (newDetails[id] !== undefined) {
                                        newDetails[newId] = newDetails[id];
                                        delete newDetails[id];
                                      }
                                      updateFieldsMutation.mutate({ assignedDriverIds: newArr, driverDetails: newDetails });
                                      cancelEdit();
                                    }}
                                    className="h-7 px-2 text-xs"
                                  >
                                    Save
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 px-2 text-xs text-gray-600">
                                    Cancel
                                  </Button>
                                </div>
                              )}
                              {isEditingNotes ? (
                                <div className="mt-1.5 space-y-1">
                                  <Textarea
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    placeholder="Add a note for this driver..."
                                    className="text-sm min-h-[60px] resize-none"
                                    autoFocus
                                  />
                                  <div className="flex items-center gap-1 justify-end">
                                    {driverPersonNotes && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updatedDetails = {
                                            ...((request.driverDetails as Record<string, any>) || {}),
                                            [id]: { ...((request.driverDetails as Record<string, any>)?.[id] || {}), notes: null },
                                          };
                                          updateFieldsMutation.mutate({ driverDetails: updatedDetails });
                                          cancelEdit();
                                        }}
                                        className="h-6 px-2 text-red-600 text-xs"
                                      >
                                        Delete
                                      </Button>
                                    )}
                                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2 text-gray-600 text-xs">
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        const updatedDetails = {
                                          ...((request.driverDetails as Record<string, any>) || {}),
                                          [id]: { ...((request.driverDetails as Record<string, any>)?.[id] || {}), notes: editingValue.trim() || null },
                                        };
                                        updateFieldsMutation.mutate({ driverDetails: updatedDetails });
                                        cancelEdit();
                                      }}
                                      className="h-6 px-2 text-xs"
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              ) : driverPersonNotes ? (
                                <p
                                  className="mt-1 text-xs text-gray-600 italic cursor-pointer hover:text-gray-800 whitespace-pre-wrap"
                                  onClick={() => canEdit && startEditing(notesFieldKey, driverPersonNotes)}
                                  title={canEdit ? "Click to edit note" : undefined}
                                >
                                  {driverPersonNotes}
                                </p>
                              ) : null}
                            </div>
                            );
                          })}
                          {parsePostgresArray(request.assignedDriverIds).length === 0 && driverNeeded > 0 && parsePostgresArray(request.tentativeDriverIds).length === 0 && (
                            <Badge variant="outline" className="bg-[#236383]/20 text-[#236383] border-[#236383] font-medium">
                              <Car className="w-3 h-3 mr-1" />None assigned
                            </Badge>
                          )}
                          {/* Tentative Drivers */}
                          {parsePostgresArray(request.tentativeDriverIds).map((id) => {
                            const isCustom = id.startsWith('custom-');
                            const idLooksLikeName = id &&
                              !id.startsWith('user_') &&
                              !id.startsWith('driver_') &&
                              !id.startsWith('driver-') &&
                              !id.startsWith('custom-') &&
                              !id.startsWith('host-contact-') &&
                              !/^\d+$/.test(id) &&
                              id.includes(' ');
                            const resolvedName = resolveUserName(id);
                            const displayName = isCustom
                              ? extractCustomName(id)
                              : (resolvedName !== id ? resolvedName : (idLooksLikeName ? id : resolvedName));
                            const tDriverPersonNotes = (request.driverDetails as Record<string, { notes?: string }>)?.[id]?.notes || '';
                            const tDriverNotesFieldKey = `tdriver-notes-${id}`;
                            const isEditingTDriverNotes = isEditingThisCard && editingField === tDriverNotesFieldKey;
                            const tDriverNameFieldKey = `tdriver-name-${id}`;
                            const isEditingTDriverName = isEditingThisCard && editingField === tDriverNameFieldKey;
                            return (
                            <div key={`tentative-${id}`} className="bg-amber-100 rounded px-3 py-1.5 border border-amber-300 min-w-0 group">
                              <div className="flex items-start gap-2">
                                <span className="text-base font-bold text-amber-700 flex-1 min-w-0 break-words leading-tight flex items-center gap-1">
                                  <HelpCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                  {displayName}
                                  <span className="text-xs text-amber-500">(tentative)</span>
                                </span>
                                {canEdit && (
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {isCustom && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => startEditing(tDriverNameFieldKey, displayName)}
                                        className="h-5 w-5 p-0 text-gray-500 hover:text-amber-700"
                                        title="Edit name"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => startEditing(tDriverNotesFieldKey, tDriverPersonNotes)}
                                      className="h-5 w-5 p-0 text-gray-500 hover:text-amber-700"
                                      title="Add/edit note"
                                    >
                                      <MessageSquare className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRemoveAssignment('driver', id)}
                                      className="h-5 w-5 p-0 text-red-600 shrink-0"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {isEditingTDriverName && (
                                <div className="mt-1.5 flex items-center gap-1">
                                  <Input
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    autoFocus
                                    placeholder="Name"
                                    className="h-7 text-sm flex-1"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const trimmed = editingValue.trim();
                                      if (!trimmed || trimmed === displayName) {
                                        cancelEdit();
                                        return;
                                      }
                                      const newId = `custom-${Date.now()}-${trimmed.replace(/\s+/g, '-')}`;
                                      const arr = parsePostgresArray(request.tentativeDriverIds);
                                      const newArr = arr.map((x) => (x === id ? newId : x));
                                      const details = (request.driverDetails as Record<string, any>) || {};
                                      const newDetails = { ...details };
                                      if (newDetails[id] !== undefined) {
                                        newDetails[newId] = newDetails[id];
                                        delete newDetails[id];
                                      }
                                      updateFieldsMutation.mutate({ tentativeDriverIds: newArr, driverDetails: newDetails });
                                      cancelEdit();
                                    }}
                                    className="h-7 px-2 text-xs"
                                  >
                                    Save
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 px-2 text-xs text-gray-600">
                                    Cancel
                                  </Button>
                                </div>
                              )}
                              {isEditingTDriverNotes ? (
                                <div className="mt-1.5 space-y-1">
                                  <Textarea
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    placeholder="Add a note for this driver..."
                                    className="text-sm min-h-[60px] resize-none"
                                    autoFocus
                                  />
                                  <div className="flex items-center gap-1 justify-end">
                                    {tDriverPersonNotes && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          const updatedDetails = {
                                            ...((request.driverDetails as Record<string, any>) || {}),
                                            [id]: { ...((request.driverDetails as Record<string, any>)?.[id] || {}), notes: null },
                                          };
                                          updateFieldsMutation.mutate({ driverDetails: updatedDetails });
                                          cancelEdit();
                                        }}
                                        className="h-6 px-2 text-red-600 text-xs"
                                      >
                                        Delete
                                      </Button>
                                    )}
                                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2 text-gray-600 text-xs">
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        const updatedDetails = {
                                          ...((request.driverDetails as Record<string, any>) || {}),
                                          [id]: { ...((request.driverDetails as Record<string, any>)?.[id] || {}), notes: editingValue.trim() || null },
                                        };
                                        updateFieldsMutation.mutate({ driverDetails: updatedDetails });
                                        cancelEdit();
                                      }}
                                      className="h-6 px-2 text-xs"
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              ) : tDriverPersonNotes ? (
                                <p
                                  className="mt-1 text-xs text-amber-800 italic cursor-pointer hover:text-amber-900 whitespace-pre-wrap"
                                  onClick={() => canEdit && startEditing(tDriverNotesFieldKey, tDriverPersonNotes)}
                                  title={canEdit ? "Click to edit note" : undefined}
                                >
                                  {tDriverPersonNotes}
                                </p>
                              ) : null}
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : canEdit ? (
                  <div className="flex items-center justify-end py-0.5 gap-1 pb-3 border-b border-gray-200">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing('driversNeeded', '1')}
                      className="h-5 px-2 text-[#007E8C] text-xs"
                    >
                      <Car className="w-3 h-3 mr-0.5" />
                      Add Driver Need
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        startEditing('selfTransport', 'true');
                        setTimeout(() => saveEdit(), 0);
                      }}
                      className="h-5 px-2 text-[#D68319] text-xs"
                      title="Organization will transport sandwiches themselves"
                    >
                      <Car className="w-3 h-3 mr-0.5" />
                      Self-Transport
                    </Button>
                  </div>
                ) : null}

                {/* Condensed add volunteer when the role is not needed */}
                {showCondensedStaffingAdds && (
                  <div className="flex items-center justify-end gap-1 py-0.5 pb-3 border-b border-gray-200">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEditing('volunteersNeeded', '1')}
                          className="h-5 w-5 p-0 text-[#007E8C]"
                        >
                          <Users className="w-3 h-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add volunteer need</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}

                {/* Volunteers */}
                {showVolunteerSection && (
                  <div className="pb-3 border-b border-gray-200">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                      {isEditingThisCard && editingField === 'volunteersNeeded' ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Users className="w-4 h-4 text-[#236383]" />
                          <Input
                            type="number"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="h-7 w-16 text-sm"
                            min="0"
                            placeholder="0"
                          />
                          <span className="text-sm text-[#236383]">needed</span>
                          <Button size="sm" onClick={saveEdit} className="h-6 px-2" aria-label="Save">
                            <Save className="w-3 h-3" aria-hidden="true" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2" aria-label="Cancel">
                            <X className="w-3 h-3" aria-hidden="true" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-base font-bold text-gray-900 flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Users className="w-5 h-5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Volunteers</p>
                              </TooltipContent>
                            </Tooltip>
                            Volunteers ({volunteerAssigned}/{volunteerNeeded})
                          </span>
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
                                <button
                                  onClick={() => {
                                    const newVal = Math.max(0, volunteerNeeded - 1);
                                    if (quickUpdateField) {
                                      quickUpdateField('volunteersNeeded', newVal);
                                    } else {
                                      updateFieldsMutation.mutate({ volunteersNeeded: newVal });
                                    }
                                  }}
                                  className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                                  aria-label="Decrease volunteers needed"
                                  title="Decrease volunteers needed"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="h-7 w-7 flex items-center justify-center text-xs font-semibold text-gray-700 border-x border-gray-200 bg-gray-50">{volunteerNeeded}</span>
                                <button
                                  onClick={() => {
                                    if (quickUpdateField) {
                                      quickUpdateField('volunteersNeeded', volunteerNeeded + 1);
                                    } else {
                                      updateFieldsMutation.mutate({ volunteersNeeded: volunteerNeeded + 1 });
                                    }
                                  }}
                                  className="h-7 w-7 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
                                  aria-label="Increase volunteers needed"
                                  title="Increase volunteers needed"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            {canEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="sm" onClick={() => openAssignmentDialog('volunteer')} className="h-7" aria-label="Add volunteer">
                                    <UserPlus className="w-3 h-3" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Assign volunteers</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="space-y-1">
                      {parsePostgresArray(request.assignedVolunteerIds).map((id) => {
                        const detailName = (request.volunteerDetails as Record<string, { name?: string }>)?.[id]?.name;
                        const resolvedName = resolveUserName(id);
                        const displayName = resolveAssignmentDisplayName(id, {
                          storedName: detailName,
                          resolvedName,
                          fallback: resolvedName || 'Unknown Volunteer',
                        });
                        const isCustom = id.startsWith('custom-') || /^\d{10,}[\s-]/.test(id);
                        const volunteerPersonNotes = (request.volunteerDetails as Record<string, { notes?: string }>)?.[id]?.notes || '';
                        const volunteerNotesFieldKey = `volunteer-notes-${id}`;
                        const isEditingVolunteerNotes = isEditingThisCard && editingField === volunteerNotesFieldKey;
                        const volunteerNameFieldKey = `volunteer-name-${id}`;
                        const isEditingVolunteerName = isEditingThisCard && editingField === volunteerNameFieldKey;
                        return (
                        <div key={id} className="bg-[#47B3CB]/20 rounded px-3 py-1.5 border border-[#47B3CB]/30 min-w-0 group">
                          <div className="flex items-start gap-2">
                            <span className="text-base font-bold text-[#236383] flex-1 min-w-0 break-words leading-tight">{displayName}</span>
                            {canEdit && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                {isCustom && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => startEditing(volunteerNameFieldKey, displayName)}
                                    className="h-5 w-5 p-0 text-gray-500 hover:text-[#236383] opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Edit name"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => startEditing(volunteerNotesFieldKey, volunteerPersonNotes)}
                                  className="h-5 w-5 p-0 text-gray-500 hover:text-[#236383] opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Add/edit note"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                </Button>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRemoveAssignment('volunteer', id)}
                                      className="h-5 w-5 p-0 text-red-600 shrink-0"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Remove volunteer assignment</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                          {isEditingVolunteerName && (
                            <div className="mt-1.5 flex items-center gap-1">
                              <Input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                autoFocus
                                placeholder="Name"
                                className="h-7 text-sm flex-1"
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  const trimmed = editingValue.trim();
                                  if (!trimmed || trimmed === displayName) {
                                    cancelEdit();
                                    return;
                                  }
                                  const newId = `custom-${Date.now()}-${trimmed.replace(/\s+/g, '-')}`;
                                  const arr = parsePostgresArray(request.assignedVolunteerIds);
                                  const newArr = arr.map((x) => (x === id ? newId : x));
                                  const details = (request.volunteerDetails as Record<string, any>) || {};
                                  const newDetails = { ...details };
                                  if (newDetails[id] !== undefined) {
                                    newDetails[newId] = newDetails[id];
                                    delete newDetails[id];
                                  }
                                  updateFieldsMutation.mutate({ assignedVolunteerIds: newArr, volunteerDetails: newDetails });
                                  cancelEdit();
                                }}
                                className="h-7 px-2 text-xs"
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 px-2 text-xs text-gray-600">
                                Cancel
                              </Button>
                            </div>
                          )}
                          {isEditingVolunteerNotes ? (
                            <div className="mt-1.5 space-y-1">
                              <Textarea
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                placeholder="Add a note for this volunteer..."
                                className="text-sm min-h-[60px] resize-none"
                                autoFocus
                              />
                              <div className="flex items-center gap-1 justify-end">
                                {volunteerPersonNotes && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const updatedDetails = {
                                        ...((request.volunteerDetails as Record<string, any>) || {}),
                                        [id]: { ...((request.volunteerDetails as Record<string, any>)?.[id] || {}), notes: null },
                                      };
                                      updateFieldsMutation.mutate({ volunteerDetails: updatedDetails });
                                      cancelEdit();
                                    }}
                                    className="h-6 px-2 text-red-600 text-xs"
                                  >
                                    Delete
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2 text-gray-600 text-xs">
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const updatedDetails = {
                                      ...((request.volunteerDetails as Record<string, any>) || {}),
                                      [id]: { ...((request.volunteerDetails as Record<string, any>)?.[id] || {}), notes: editingValue.trim() || null },
                                    };
                                    updateFieldsMutation.mutate({ volunteerDetails: updatedDetails });
                                    cancelEdit();
                                  }}
                                  className="h-6 px-2 text-xs"
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : volunteerPersonNotes ? (
                            <p
                              className="mt-1 text-xs text-gray-600 italic cursor-pointer hover:text-gray-800 whitespace-pre-wrap"
                              onClick={() => canEdit && startEditing(volunteerNotesFieldKey, volunteerPersonNotes)}
                              title={canEdit ? "Click to edit note" : undefined}
                            >
                              {volunteerPersonNotes}
                            </p>
                          ) : null}
                        </div>
                        );
                      })}
                      {volunteerAssigned === 0 && parsePostgresArray(request.tentativeVolunteerIds).length === 0 && <Badge variant="outline" className="bg-[#47B3CB]/15 text-[#236383] border-[#47B3CB]/40 font-medium"><Users className="w-3 h-3 mr-1" />None assigned</Badge>}
                      {/* Tentative Volunteers */}
                      {parsePostgresArray(request.tentativeVolunteerIds).map((id) => {
                        const detailName = (request.volunteerDetails as Record<string, { name?: string }>)?.[id]?.name;
                        const resolvedName = resolveUserName(id);
                        const displayName = resolveAssignmentDisplayName(id, {
                          storedName: detailName,
                          resolvedName,
                          fallback: resolvedName || 'Unknown Volunteer',
                        });
                        const isCustom = id.startsWith('custom-') || /^\d{10,}[\s-]/.test(id);
                        const tVolunteerPersonNotes = (request.volunteerDetails as Record<string, { notes?: string }>)?.[id]?.notes || '';
                        const tVolunteerNotesFieldKey = `tvolunteer-notes-${id}`;
                        const isEditingTVolunteerNotes = isEditingThisCard && editingField === tVolunteerNotesFieldKey;
                        const tVolunteerNameFieldKey = `tvolunteer-name-${id}`;
                        const isEditingTVolunteerName = isEditingThisCard && editingField === tVolunteerNameFieldKey;
                        return (
                        <div key={`tentative-${id}`} className="bg-amber-100 rounded px-3 py-1.5 border border-amber-300 min-w-0 group">
                          <div className="flex items-start gap-2">
                            <span className="text-base font-bold text-amber-700 flex-1 min-w-0 break-words leading-tight flex items-center gap-1">
                              <HelpCircle className="w-4 h-4 text-amber-500 shrink-0" />
                              {displayName}
                              <span className="text-xs text-amber-500">(tentative)</span>
                            </span>
                            {canEdit && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                {isCustom && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => startEditing(tVolunteerNameFieldKey, displayName)}
                                    className="h-5 w-5 p-0 text-gray-500 hover:text-amber-700"
                                    title="Edit name"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => startEditing(tVolunteerNotesFieldKey, tVolunteerPersonNotes)}
                                  className="h-5 w-5 p-0 text-gray-500 hover:text-amber-700"
                                  title="Add/edit note"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemoveAssignment('volunteer', id)}
                                  className="h-5 w-5 p-0 text-red-600 shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                          {isEditingTVolunteerName && (
                            <div className="mt-1.5 flex items-center gap-1">
                              <Input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                autoFocus
                                placeholder="Name"
                                className="h-7 text-sm flex-1"
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  const trimmed = editingValue.trim();
                                  if (!trimmed || trimmed === displayName) {
                                    cancelEdit();
                                    return;
                                  }
                                  const newId = `custom-${Date.now()}-${trimmed.replace(/\s+/g, '-')}`;
                                  const arr = parsePostgresArray(request.tentativeVolunteerIds);
                                  const newArr = arr.map((x) => (x === id ? newId : x));
                                  const details = (request.volunteerDetails as Record<string, any>) || {};
                                  const newDetails = { ...details };
                                  if (newDetails[id] !== undefined) {
                                    newDetails[newId] = newDetails[id];
                                    delete newDetails[id];
                                  }
                                  updateFieldsMutation.mutate({ tentativeVolunteerIds: newArr, volunteerDetails: newDetails });
                                  cancelEdit();
                                }}
                                className="h-7 px-2 text-xs"
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 px-2 text-xs text-gray-600">
                                Cancel
                              </Button>
                            </div>
                          )}
                          {isEditingTVolunteerNotes ? (
                            <div className="mt-1.5 space-y-1">
                              <Textarea
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                placeholder="Add a note for this volunteer..."
                                className="text-sm min-h-[60px] resize-none"
                                autoFocus
                              />
                              <div className="flex items-center gap-1 justify-end">
                                {tVolunteerPersonNotes && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const updatedDetails = {
                                        ...((request.volunteerDetails as Record<string, any>) || {}),
                                        [id]: { ...((request.volunteerDetails as Record<string, any>)?.[id] || {}), notes: null },
                                      };
                                      updateFieldsMutation.mutate({ volunteerDetails: updatedDetails });
                                      cancelEdit();
                                    }}
                                    className="h-6 px-2 text-red-600 text-xs"
                                  >
                                    Delete
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 px-2 text-gray-600 text-xs">
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const updatedDetails = {
                                      ...((request.volunteerDetails as Record<string, any>) || {}),
                                      [id]: { ...((request.volunteerDetails as Record<string, any>)?.[id] || {}), notes: editingValue.trim() || null },
                                    };
                                    updateFieldsMutation.mutate({ volunteerDetails: updatedDetails });
                                    cancelEdit();
                                  }}
                                  className="h-6 px-2 text-xs"
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : tVolunteerPersonNotes ? (
                            <p
                              className="mt-1 text-xs text-amber-800 italic cursor-pointer hover:text-amber-900 whitespace-pre-wrap"
                              onClick={() => canEdit && startEditing(tVolunteerNotesFieldKey, tVolunteerPersonNotes)}
                              title={canEdit ? "Click to edit note" : undefined}
                            >
                              {tVolunteerPersonNotes}
                            </p>
                          ) : null}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Attendance */}
                <div className="flex items-start gap-2 pb-3 border-b border-gray-200">
                  <Users className="w-5 h-5 shrink-0 mt-0.5" />
                  {isEditingThisCard && editingField === 'attendanceBreakdown' ? (
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-1 xs:grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-300 block mb-1">Adults</label>
                          <Input
                            type="number"
                            value={editingValue.split(',')[0] || ''}
                            onChange={(e) => {
                              const parts = editingValue.split(',');
                              parts[0] = e.target.value;
                              setEditingValue(parts.join(','));
                            }}
                            className="h-8 w-full bg-white text-gray-900"
                            placeholder="0"
                            min="0"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-300 block mb-1">Teens</label>
                          <Input
                            type="number"
                            value={editingValue.split(',')[1] || ''}
                            onChange={(e) => {
                              const parts = editingValue.split(',');
                              parts[1] = e.target.value;
                              setEditingValue(parts.join(','));
                            }}
                            className="h-8 w-full bg-white text-gray-900"
                            placeholder="0"
                            min="0"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-300 block mb-1">Kids</label>
                          <Input
                            type="number"
                            value={editingValue.split(',')[2] || ''}
                            onChange={(e) => {
                              const parts = editingValue.split(',');
                              parts[2] = e.target.value;
                              setEditingValue(parts.join(','));
                            }}
                            className="h-8 w-full bg-white text-gray-900"
                            placeholder="0"
                            min="0"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={saveEdit}>
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-gray-600 hover:bg-gray-100">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 group cursor-pointer" onClick={() => canEdit && startEditing('attendanceBreakdown', `${request.attendanceAdults || ''},${request.attendanceTeens || ''},${request.attendanceKids || ''}`)}>
                      <div className="text-base font-semibold">
                        {(request.attendanceAdults || request.attendanceTeens || request.attendanceKids) ? (
                          <div className="flex flex-wrap gap-2">
                            {request.attendanceAdults ? <span>{request.attendanceAdults} adults</span> : null}
                            {request.attendanceTeens ? <span>{request.attendanceTeens} teens</span> : null}
                            {request.attendanceKids ? <span>{request.attendanceKids} kids</span> : null}
                            <span className="text-gray-300">
                              ({(request.attendanceAdults || 0) + (request.attendanceTeens || 0) + (request.attendanceKids || 0)} total)
                            </span>
                          </div>
                        ) : request.estimatedAttendance ? (
                          `${request.estimatedAttendance} people expected`
                        ) : (
                          <span className="text-gray-600 font-medium">No attendance set</span>
                        )}
                      </div>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); startEditing('attendanceBreakdown', `${request.attendanceAdults || ''},${request.attendanceTeens || ''},${request.attendanceKids || ''}`); }}
                          className="text-white hover:bg-white/20 h-6 px-2 transition-colors"
                          aria-label="Edit attendance"
                        >
                          <Edit2 className="w-3 h-3" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Scheduling Notes - Collapsed by Default */}
        {request.schedulingNotes && (
          <div className="bg-gradient-to-r from-green-50 to-green-50/50 rounded-lg mb-4 border-l-4 border-green-500 border-t border-r border-b border-green-200 shadow-sm">
            <button
              type="button"
              onClick={() => setShowSchedulingNotes(!showSchedulingNotes)}
              className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-green-50/80 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-green-600" />
                <h3 className="text-sm uppercase font-bold tracking-wide text-green-700">
                  Scheduling Notes
                </h3>
              </div>
              <div className="flex items-center gap-1">
                {canEdit && showSchedulingNotes && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); startEditing('schedulingNotes', request.schedulingNotes || ''); }}
                    className="h-6 px-2 text-green-700 hover:text-green-800 hover:bg-green-100"
                    aria-label="Edit scheduling notes"
                  >
                    <Edit2 className="w-3 h-3" aria-hidden="true" />
                  </Button>
                )}
                {showSchedulingNotes ? <ChevronUp className="w-4 h-4 text-green-600" /> : <ChevronDown className="w-4 h-4 text-green-600" />}
              </div>
            </button>
            {showSchedulingNotes && (
              <div className="px-4 pb-4">
                {isEditingThisCard && editingField === 'schedulingNotes' ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded text-sm min-h-[100px] text-gray-900 bg-white"
                      placeholder="Add scheduling notes..."
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={saveEdit}>
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-2 border-green-400 whitespace-pre-wrap">
                    {request.schedulingNotes}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Notes & Requirements Section */}
        {(request.message ||
          request.planningNotes ||
          request.additionalRequirements ||
          request.volunteerNotes ||
          request.driverNotes ||
          request.vanDriverNotes ||
          request.followUpNotes ||
          request.distributionNotes ||
          request.duplicateNotes ||
          request.unresponsiveNotes ||
          request.socialMediaPostNotes) && (
          <div className="bg-gradient-to-r from-[#236383]/30 to-[#236383]/15 rounded-lg p-4 mb-4 border-l-4 border-[#236383] border-t border-r border-b border-[#236383]/20 shadow-md">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNotesAndRequirements(!showNotesAndRequirements)}
              className="w-full justify-between text-[#236383] hover:text-[#236383] hover:bg-[#236383]/10 font-medium p-0 h-auto mb-0"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#236383]" />
                <h3 className="text-sm uppercase font-bold tracking-wide text-[#236383]">
                  Notes & Requirements
                </h3>
              </div>
              {showNotesAndRequirements ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </Button>
            {showNotesAndRequirements && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto mt-3">
              {request.message && (
                <div className="sm:col-span-2">
                  <p className="text-sm font-medium mb-1 text-gray-900">Original Request Message:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-[#007E8C] whitespace-pre-wrap">
                    {request.message}
                  </p>
                </div>
              )}
              {request.additionalRequirements && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Special Requirements:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-orange-400 whitespace-pre-wrap">
                    {request.additionalRequirements}
                  </p>
                </div>
              )}
              {request.planningNotes && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900">Planning Notes:</p>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing('planningNotes', request.planningNotes || '')}
                        className="h-6 px-2"
                        aria-label="Edit planning notes"
                      >
                        <Edit2 className="w-3 h-3" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {isEditingThisCard && editingField === 'planningNotes' ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded text-sm min-h-[100px] text-gray-900 bg-white"
                        placeholder="Add planning notes..."
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={saveEdit}>
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          <X className="w-3 h-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 bg-gradient-to-r from-[#47B3CB]/30 to-[#47B3CB]/15 p-3 rounded border-l-4 border-[#47B3CB] border-t border-r border-b border-[#47B3CB]/20 whitespace-pre-wrap">
                      {request.planningNotes}
                    </p>
                  )}
                </div>
              )}
              {request.volunteerNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Volunteer Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-purple-400 whitespace-pre-wrap">
                    {request.volunteerNotes}
                  </p>
                </div>
              )}
              {request.driverNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Driver Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-[#007E8C] whitespace-pre-wrap">
                    {request.driverNotes}
                  </p>
                </div>
              )}
              {request.vanDriverNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Van Driver Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-red-400 whitespace-pre-wrap">
                    {request.vanDriverNotes}
                  </p>
                </div>
              )}
              {request.followUpNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Follow-up Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-yellow-400 whitespace-pre-wrap">
                    {request.followUpNotes}
                  </p>
                </div>
              )}
              {request.distributionNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Distribution Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-teal-400 whitespace-pre-wrap">
                    {request.distributionNotes}
                  </p>
                </div>
              )}
              {/* Duplicate check notes hidden - runs in background only */}
              {request.unresponsiveNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Contact Attempts Logged:</p>
                  <p className="text-sm text-gray-700 bg-gradient-to-r from-[#A31C41]/30 to-[#A31C41]/15 p-3 rounded border-l-4 border-[#A31C41]">
                    {request.unresponsiveNotes}
                  </p>
                </div>
              )}
              {request.socialMediaPostNotes && (
                <div>
                  <p className="text-sm font-medium mb-1 text-gray-900">Social Media Notes:</p>
                  <p className="text-sm text-gray-700 bg-white p-3 rounded border-l-4 border-indigo-400">
                    {request.socialMediaPostNotes}
                  </p>
                </div>
              )}
              </div>
            )}
          </div>
        )}


        {/* Action Buttons Row — actions grouped by purpose with thin vertical dividers:
            (1) organizer outreach, (2) recipient SMS, (3) team coordination,
            (4) event management, (5) official calendar/sheet, and finally the
            card-management cluster (Edit + Delete) pushed to the right. The van
            toggle lives in the Team Assignments box, and "Follow Up" is intentionally
            absent — that step belongs to completed events, not scheduled ones. */}
        <TooltipProvider>
          <CardActionRow className="mb-4">
            {/* Group 1 — Organizer outreach */}
            <Button onClick={onContact} size="sm">
              <Mail className="w-4 h-4 mr-2" />
              <span className="sm:hidden">Contact</span>
              <span className="hidden sm:inline">Contact Organizer</span>
            </Button>
            <Button size="sm" variant="outline" onClick={onLogContact}>
              <MessageSquare className="w-4 h-4 mr-1" />
              Log Contact
            </Button>

            {/* Group 2 — Recipient SMS (event details + corrections texted to opted-in recipients) */}
            {canEdit && canSendSMS && (
              <>
                <div className="h-6 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowSendSmsDialog(true)}
                      className="border-[#236383] text-[#236383] hover:bg-[#236383]/10"
                      data-testid="button-send-sms-card"
                    >
                      <Phone className="w-4 h-4 mr-1" />
                      Send SMS
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Send event details via SMS</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowSendCorrectionDialog(true)}
                      className="border-orange-400 text-orange-700 hover:bg-orange-100"
                      data-testid="button-send-correction-card"
                    >
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      Send Correction
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Send correction SMS</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Group 3 — Team coordination (message other TSP team members about this event) */}
            <div className="h-6 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowMessageDialog(true)}
                  className="border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
                  data-testid="button-message-event"
                >
                  <MessageSquare className="w-4 h-4 mr-1" />
                  Message
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Message the team about this event</p>
              </TooltipContent>
            </Tooltip>

            {canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openInstructionsDialog}
                    className="border-purple-400 text-purple-700 hover:bg-purple-50"
                    data-testid="button-edit-instructions"
                  >
                    <ClipboardList className="w-4 h-4 mr-1" />
                    {hasInstructions ? 'Edit Instructions' : 'Add Instructions'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Driver & volunteer instructions (included in reminders)</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Group 4 — Event management */}
            <div className="h-6 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
            {!(request.tspContact || request.customTspContact) && canEditTspContact && (
              <Button
                size="sm"
                variant="outline"
                onClick={onAssignTspContact}
                className="border-[#FBAD3F]/30 text-[#FBAD3F] hover:bg-[#FBAD3F]/10"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                <span className="sm:hidden">Assign TSP</span>
                <span className="hidden sm:inline">Assign TSP Contact</span>
              </Button>
            )}

            {onAiIntakeAssist && (
              <Button
                size="sm"
                variant="outline"
                onClick={onAiIntakeAssist}
                className="border-purple-500/30 text-purple-600 hover:bg-purple-50"
                data-testid="button-ai-intake-check"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                <span className="sm:hidden">AI Intake</span>
                <span className="hidden sm:inline">AI Intake Check</span>
              </Button>
            )}

            <ReminderRulesManager
              eventRequestId={request.id}
              tspContactUserId={request.tspContact || request.tspContactAssigned}
              eventStatus={request.status}
            />

            <Button size="sm" variant="outline" onClick={onReschedule}>
              Reschedule
            </Button>

            {onCancelEvent && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onCancelEvent}
                    className="border-red-400 text-red-600 hover:bg-red-50"
                    data-testid="button-cancel-event"
                  >
                    <Ban className="w-4 h-4 mr-1" />
                    Cancel Event
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Cancel this scheduled event (requires a reason)</p>
                </TooltipContent>
              </Tooltip>
            )}

            {onDuplicate && (
              <Button size="sm" variant="outline" onClick={onDuplicate}>
                <Copy className="w-4 h-4 mr-1" />
                <span className="sm:hidden">Duplicate</span>
                <span className="hidden sm:inline">Duplicate Event</span>
              </Button>
            )}

            {/* Group 5 — Official calendar / Google Sheet */}
            <div className="h-6 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
            <ProposeToSheetButton
              eventId={request.id}
              organizationName={request.organizationName || 'Unknown'}
              variant="outline"
              size="sm"
              showLabel
            />

            {/* For users who type the event into the Google Sheet by hand instead of
                using "Push to Sheet" — lets them mark it On Calendar without an actual
                push. Hidden once the event is already on the calendar. */}
            {canEdit && !request.addedToOfficialSheet && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); quickToggleBoolean('addedToOfficialSheet', false); }}
                className="border-[#236383]/30 text-[#236383] hover:bg-[#236383]/10"
              >
                <Calendar className="w-4 h-4 mr-1" />
                <span className="sm:hidden">Added to Sheet</span>
                <span className="hidden sm:inline">Manually Added to Google Sheet</span>
              </Button>
            )}

            {/* Spacer + card-management cluster (Edit + Delete) right-aligned */}
            {canEdit && (
              <>
                <ActionRowSpacer />
                <div
                  className="self-stretch border-l border-slate-200 mx-1"
                  aria-hidden="true"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onEdit}
                      data-testid="button-edit-event"
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit event</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <ConfirmationDialog
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 h-8"
                            aria-label="Delete event"
                            data-testid="button-delete-event"
                          >
                            <Trash2 className="w-4 h-4 mr-1.5 sm:mr-0" />
                            <span className="sm:hidden">Delete</span>
                          </Button>
                        }
                        title="Delete Event"
                        description={`Delete ${request.organizationName}?`}
                        confirmText="Delete"
                        onConfirm={onDelete}
                        variant="destructive"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Delete event</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </CardActionRow>
        </TooltipProvider>

        {/* Team Comments Section */}
        {request.id && (
          <div className="bg-white rounded-lg p-4 mb-4 border border-gray-200">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowComments(!showComments)}
                className="flex-1 justify-between text-gray-700 hover:text-gray-700 hover:bg-gray-50 font-medium p-2 h-auto min-w-0"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-gray-600" />
                  <h3 className="text-sm font-semibold">Team Comments</h3>
                  {collaboration.comments && collaboration.comments.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {collaboration.comments.length}
                    </Badge>
                  )}
                </div>
                {showComments ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>

            {showComments && (
              <div className="mt-3 max-h-[500px]">
                <CommentThread
                  comments={collaboration.comments || []}
                  currentUserId={user?.id || ''}
                  currentUserName={user?.fullName || user?.email || ''}
                  eventId={request.id}
                  onAddComment={collaboration.addComment}
                  onEditComment={collaboration.updateComment}
                  onDeleteComment={collaboration.deleteComment}
                  isLoading={collaboration.commentsLoading || false}
                />
              </div>
            )}
          </div>
        )}

        {/* Pre-Event Flags Button */}
        <div className="border-t-2 border-[#007E8C]/10 pt-4 mb-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowFlagsDialog(true);
              }}
              className="flex-1 justify-between text-[#236383] hover:text-[#236383] hover:bg-[#007E8C]/5 font-medium"
              type="button"
            >
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4" aria-hidden="true" />
                <span>Pre-Event Flags</span>
                {request.preEventFlags && Array.isArray(request.preEventFlags) && 
                 request.preEventFlags.filter((f: any) => !f.resolvedAt).length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {request.preEventFlags.filter((f: any) => !f.resolvedAt).length}
                  </Badge>
                )}
              </div>
            </Button>
          </div>
        </div>

        {/* Contact Log Toggle — shows the full history of Log Contact entries for
            this scheduled event. Read-only here; use the "Log Contact" button in the
            action row above to add a new entry. */}
        <div className="border-t-2 border-[#007E8C]/10 pt-4 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowContactLog((v) => !v);
            }}
            className="w-full justify-between text-[#236383] hover:text-[#236383] hover:bg-[#007E8C]/5 font-medium"
            type="button"
            data-testid="button-toggle-contact-log"
          >
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4" aria-hidden="true" />
              <span>Contact Log</span>
              {hasContactAttempts && (
                <Badge variant="secondary" className="ml-1">
                  {(request.contactAttemptsLog as any[]).length}
                </Badge>
              )}
              {request.lastContactAttempt && (
                <span className="text-xs font-normal text-slate-500">
                  Last: {new Date(request.lastContactAttempt).toLocaleDateString()}
                </span>
              )}
            </div>
            {showContactLog ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          </Button>

          {showContactLog && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {!hasContactAttempts ? (
                <div className="text-sm text-slate-600 italic">
                  No contact attempts logged yet. Use the <span className="font-medium">Log Contact</span> button above to add one.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {(request.contactAttemptsLog as any[])
                    .slice()
                    .sort((a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0))
                    .map((attempt: any) => {
                      if (!attempt || typeof attempt !== 'object') return null;

                      const methodIcons: Record<string, React.ReactNode> = {
                        phone: <Phone className="w-3 h-3" />,
                        email: <Mail className="w-3 h-3" />,
                        text: <MessageCircle className="w-3 h-3" />,
                        both: <MessageSquare className="w-3 h-3" />,
                        phone_and_toolkit: <MessageSquare className="w-3 h-3" />,
                        email_and_toolkit: <Mail className="w-3 h-3" />,
                      };

                      const methodLabels: Record<string, string> = {
                        phone: 'Phone',
                        email: 'Email',
                        text: 'Text',
                        both: 'Phone & Email',
                        phone_and_toolkit: 'Phone + Toolkit',
                        email_and_toolkit: 'Email + Toolkit',
                      };

                      const outcomeLabels: Record<string, string> = {
                        successful: 'Success',
                        toolkit_sent: 'Toolkit Sent',
                        toolkit_sent_left_message: 'Toolkit + Voicemail',
                        no_answer: 'No answer',
                        left_message: 'Left message',
                        wrong_number: 'Wrong number',
                        email_bounced: 'Bounced',
                        requested_callback: 'Callback requested',
                        other: 'Other',
                      };

                      let parsedDate: Date | undefined;
                      if (attempt.timestamp) {
                        try {
                          parsedDate = new Date(attempt.timestamp);
                          if (isNaN(parsedDate.getTime())) parsedDate = undefined;
                        } catch (e) {
                          parsedDate = undefined;
                        }
                      }

                      const userName = attempt.createdByName || attempt.createdBy || 'Unknown';
                      const hasNotes = attempt.notes && String(attempt.notes).trim().length > 0;

                      return (
                        <div
                          key={attempt.attemptNumber || attempt.timestamp}
                          className="bg-white rounded px-2.5 py-1.5 border border-amber-200 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold text-amber-900 flex-shrink-0">
                              #{attempt.attemptNumber || '?'}
                            </span>
                            {attempt.method && (
                              <div className="flex items-center gap-1 text-amber-700 flex-shrink-0">
                                {methodIcons[attempt.method as string] || <Phone className="w-3 h-3" />}
                                <span>{methodLabels[attempt.method as string] || attempt.method}</span>
                              </div>
                            )}
                            {attempt.outcome && (
                              <span className="text-gray-700 flex-shrink-0">
                                • {outcomeLabels[attempt.outcome as string] || attempt.outcome}
                              </span>
                            )}
                            {parsedDate && (
                              <span className="text-gray-500 flex-shrink-0">
                                • {parsedDate.toLocaleDateString()} {parsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            {userName && userName !== 'unknown' && userName !== 'system' && (
                              <span className="text-gray-500 flex-shrink-0">
                                • by {userName}
                              </span>
                            )}
                          </div>
                          {hasNotes && (
                            <div className="mt-1 text-gray-600 italic whitespace-pre-wrap">
                              {attempt.notes}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activity History Toggle */}
        <div className="border-t-2 border-[#007E8C]/10 pt-4 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowAuditLog(!showAuditLog);
            }}
            className="w-full justify-between text-[#236383] hover:text-[#236383] hover:bg-[#007E8C]/5 font-medium"
            type="button"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" aria-hidden="true" />
              Activity History
            </div>
            {showAuditLog ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          </Button>
        </div>

        {showAuditLog && (
          <div className="mt-4 pt-4 border-t-2 border-[#007E8C]/10">
            <EventRequestAuditLog
              eventId={request.id?.toString()}
              showFilters={false}
              compact={true}
            />
          </div>
        )}

        {/* Email Log - shows if any template emails have been sent */}
        <EventEmailLogDisplay eventId={request.id} compact />

        {/* Manual entry origin — a quiet note, NOT a status badge. Lives at the
            bottom of the card so it stays discoverable for context without
            competing with operational alerts at the top. */}
        {request.externalId && request.externalId.startsWith('manual-') && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500 italic">
            <FileText className="w-3 h-3 text-gray-400" aria-hidden="true" />
            <span>Created via manual entry</span>
          </div>
        )}
      </CardContent>

      {/* Message Composer Dialog */}
      <Dialog open={showMessageDialog} onOpenChange={setShowMessageDialog}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Message About Event: {request.organizationName}</DialogTitle>
          </DialogHeader>
          <MessageComposer
            contextType="event"
            contextId={request.id.toString()}
            contextTitle={`${request.organizationName} event${displayDate ? ` on ${formatEventDate(displayDate.toString())}` : ''}`}
            onSent={() => setShowMessageDialog(false)}
            onCancel={() => setShowMessageDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Driver / Volunteer Instructions Dialog */}
      <Dialog open={showInstructionsDialog} onOpenChange={setShowInstructionsDialog}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Instructions: {request.organizationName}</DialogTitle>
          </DialogHeader>
          <InstructionsSection formData={instructionsDraft as any} setFormData={setInstructionsDraft} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowInstructionsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveInstructions} disabled={updateFieldsMutation.isPending}>
              {updateFieldsMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              Save Instructions
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Event Details via SMS Dialog */}
      <SendEventDetailsSMSDialog
        isOpen={showSendSmsDialog}
        onClose={() => setShowSendSmsDialog(false)}
        eventRequest={request}
      />

      {/* Send Correction SMS Dialog */}
      <SendCorrectionSMSDialog
        isOpen={showSendCorrectionDialog}
        onClose={() => setShowSendCorrectionDialog(false)}
        eventRequest={request}
      />

      {/* Pre-Event Flags Dialog */}
      <PreEventFlagsDialog
        flags={request.preEventFlags || []}
        eventId={request.id}
        eventName={request.organizationName || 'Event'}
        isOpen={showFlagsDialog}
        onClose={() => setShowFlagsDialog(false)}
      />
    </Card>
  );
};
