import * as React from 'react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/components/ui/dialog';
import {
  Trash2,
  FileText,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useErrorToast } from '@/hooks/use-error-toast';
import { apiRequest, invalidateEventRequestQueries, applyEventRequestSaveToCache, refreshEventRequestListAndCounts } from '@/lib/queryClient';
import type { EventRequest } from '@shared/schema';
import { STATUS_DEFINITIONS } from './constants';
import type { EventStatus } from '@shared/event-status-workflow';
import { requiresReason, getReasonSatisfyingFields } from '@shared/event-status-workflow';
import { getPickupDateTimeForInput, parsePostgresArray } from './utils';
import { logger } from '@/lib/logger';
import { useAuth } from '@/hooks/useAuth';
import { useEventCollaboration } from '@/hooks/use-event-collaboration';
import { getEventRequestSourceIndicator } from '@/lib/event-request-source';
import { PresenceAvatars } from '@/components/collaboration';
import { RefrigerationWarningAlert } from './RefrigerationWarningBadge';
import { StatusReasonDialog } from './dialogs/StatusReasonDialog';
import {
  ContactInfoSection,
  BackupContactSection,
  CompletedEventSection,
  SandwichPlanningSection,
  ResourceRequirementsSection,
  EventScheduleSection,
  DeliverySection,
  AttendeeSection,
  NotesSection,
  InstructionsSection,
  StatusToolkitSection,
  TspContactSection,
  DateChangeDialog,
  VanConflictDialog,
  StandbyFollowUpDialog,
  DeleteConfirmDialog,
  type EventFormData,
} from './form-sections';
import {
  buildEventDataForServer,
  findMismatchedSavedFields,
  getDroppedServerFields,
  determineSandwichMode,
  determineBaselineSandwichMode,
  determineActualSandwichMode,
  resolveEstimatedAttendance,
  normalizeDraftAttendance,
} from './form-utils';

// ────────────────────────────────────────────────────────────────────────
// Helpers (kept in this file because they reference component-level state)
// ────────────────────────────────────────────────────────────────────────

/**
 * Intelligent merge of cached form data with current server data.
 * Preserves user's intentional changes while accepting server updates.
 * When both user and server changed the same field, server wins.
 */
function intelligentMergeFormData(
  cachedFormData: Record<string, any>,
  originalServerData: Record<string, any> | null | undefined,
  currentServerData: Record<string, any>
): {
  mergedData: Record<string, any>;
  conflicts: string[];
  serverUpdates: string[];
  userChangesPreserved: string[];
} {
  const mergedData: Record<string, any> = { ...currentServerData };
  const conflicts: string[] = [];
  const serverUpdates: string[] = [];
  const userChangesPreserved: string[] = [];

  if (!originalServerData) {
    logger.log('⚠️ No original server data in cache - using CURRENT SERVER DATA (discarding stale cache)');
    return { mergedData: currentServerData, conflicts: [], serverUpdates: [], userChangesPreserved: [] };
  }

  const valuesEqual = (a: any, b: any): boolean => {
    const normalize = (v: any) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    };
    return normalize(a) === normalize(b);
  };

  for (const key of Object.keys(cachedFormData)) {
    const cachedValue = cachedFormData[key];
    const originalValue = originalServerData[key];
    const currentValue = currentServerData[key];
    const userChangedField = !valuesEqual(cachedValue, originalValue);
    const serverChangedField = !valuesEqual(currentValue, originalValue);

    if (userChangedField && serverChangedField) {
      conflicts.push(key);
      mergedData[key] = currentValue;
    } else if (userChangedField) {
      userChangesPreserved.push(key);
      mergedData[key] = cachedValue;
    } else if (serverChangedField) {
      serverUpdates.push(key);
      mergedData[key] = currentValue;
    }
  }

  if (!mergedData.status) {
    mergedData.status = currentServerData.status || 'new';
  }

  return { mergedData, conflicts, serverUpdates, userChangesPreserved };
}

/**
 * Build form data object from an EventRequest.
 * This is the SINGLE source of truth for server → form mapping.
 * Used for initial population, discard recovery, and intelligent merge.
 */
function buildFormDataFromEventRequest(
  eventRequest: EventRequest | null,
  formatDateForInput: (date: any) => string,
  getPickupDateTimeForInputFn: typeof getPickupDateTimeForInput,
  parsePostgresArrayFn: typeof parsePostgresArray
): Record<string, any> {
  const existingSandwichTypes = eventRequest?.sandwichTypes ?
    (typeof eventRequest?.sandwichTypes === 'string' ?
      JSON.parse(eventRequest.sandwichTypes) : eventRequest?.sandwichTypes) : [];
  const totalCount = eventRequest?.estimatedSandwichCount || 0;
  const existingActualSandwichTypes = eventRequest?.actualSandwichTypes ?
    (typeof eventRequest?.actualSandwichTypes === 'string' ?
      JSON.parse(eventRequest.actualSandwichTypes) : eventRequest?.actualSandwichTypes) : [];

  return {
    eventDate: eventRequest ? formatDateForInput(eventRequest.desiredEventDate || eventRequest.scheduledEventDate) : '',
    dateFlexible: eventRequest?.dateFlexible ?? null,
    backupDates: (eventRequest as any)?.backupDates?.map((d: string) => formatDateForInput(d)) || [],
    eventStartTime: eventRequest?.eventStartTime || '',
    eventEndTime: eventRequest?.eventEndTime || '',
    pickupTime: eventRequest?.pickupTime || '',
    pickupDateTime: getPickupDateTimeForInputFn((eventRequest as any)?.pickupDateTime, eventRequest?.pickupTime, formatDateForInput(eventRequest?.desiredEventDate || eventRequest?.scheduledEventDate)),
    pickupDate: (() => {
      const pickupDT = getPickupDateTimeForInputFn((eventRequest as any)?.pickupDateTime, eventRequest?.pickupTime, formatDateForInput(eventRequest?.desiredEventDate || eventRequest?.scheduledEventDate));
      return pickupDT ? pickupDT.split('T')[0] : '';
    })(),
    pickupTimeSeparate: (() => {
      const pickupDT = getPickupDateTimeForInputFn((eventRequest as any)?.pickupDateTime, eventRequest?.pickupTime, formatDateForInput(eventRequest?.desiredEventDate || eventRequest?.scheduledEventDate));
      return pickupDT ? pickupDT.split('T')[1]?.substring(0, 5) : '';
    })(),
    eventAddress: eventRequest?.eventAddress || '',
    deliveryDestination: eventRequest?.deliveryDestination || '',
    holdingOvernight: !!(eventRequest?.overnightHoldingLocation),
    overnightHoldingLocation: eventRequest?.overnightHoldingLocation || '',
    overnightPickupTime: eventRequest?.overnightPickupTime || '',
    sandwichTypes: existingSandwichTypes,
    hasRefrigeration: eventRequest?.hasRefrigeration?.toString() || '',
    driversNeeded: eventRequest?.driversNeeded || 0,
    selfTransport: eventRequest?.selfTransport || false,
    vanDriverNeeded: eventRequest?.vanDriverNeeded || false,
    vanNeededFor: (eventRequest as any)?.vanNeededFor === 'transport' || (eventRequest as any)?.vanNeededFor === 'refrigeration'
      ? (eventRequest as any).vanNeededFor
      : '',
    vanNeededLikely: (eventRequest as any)?.vanNeededLikely || false,
    volunteersNeeded: eventRequest?.volunteersNeeded || 0,
    tspContact: eventRequest?.tspContact || '',
    customTspContact: (eventRequest as any)?.customTspContact || '',
    message: (eventRequest as any)?.message || '',
    schedulingNotes: (eventRequest as any)?.schedulingNotes || '',
    planningNotes: (eventRequest as any)?.planningNotes || '',
    nextAction: (eventRequest as any)?.nextAction || '',
    driverInstructions: (eventRequest as any)?.driverInstructions || '',
    volunteerInstructions: (eventRequest as any)?.volunteerInstructions || '',
    totalSandwichCount: totalCount,
    estimatedSandwichCountMin: (eventRequest as any)?.estimatedSandwichCountMin || 0,
    estimatedSandwichCountMax: (eventRequest as any)?.estimatedSandwichCountMax || 0,
    rangeSandwichType: (eventRequest as any)?.estimatedSandwichRangeType || '',
    // Single home for estimated attendance. Legacy records that only populated
    // the old volunteerCount column still open with their count.
    estimatedAttendance: resolveEstimatedAttendance(eventRequest as any),
    adultCount: (eventRequest as any)?.adultCount || 0,
    childrenCount: (eventRequest as any)?.childrenCount || 0,
    kidsAgeRange: (eventRequest as any)?.kidsAgeRange || '',
    firstName: eventRequest?.firstName || '',
    lastName: eventRequest?.lastName || '',
    email: eventRequest?.email || '',
    phone: eventRequest?.phone || '',
    organizationName: eventRequest?.organizationName || '',
    department: eventRequest?.department || '',
    organizationCategory: (eventRequest as any)?.organizationCategory || '',
    schoolClassification: (eventRequest as any)?.schoolClassification || '',
    backupContactFirstName: (eventRequest as any)?.backupContactFirstName || '',
    backupContactLastName: (eventRequest as any)?.backupContactLastName || '',
    backupContactEmail: (eventRequest as any)?.backupContactEmail || '',
    backupContactPhone: (eventRequest as any)?.backupContactPhone || '',
    backupContactRole: (eventRequest as any)?.backupContactRole || '',
    previouslyHosted: (eventRequest as any)?.previouslyHosted || 'i_dont_know',
    deliveryTimeWindow: (eventRequest as any)?.deliveryTimeWindow || '',
    deliveryParkingAccess: (eventRequest as any)?.deliveryParkingAccess || '',
    assignedVanDriverId: eventRequest?.assignedVanDriverId || '',
    isDhlVan: (eventRequest as any)?.isDhlVan || false,
    status: eventRequest?.status || 'new',
    toolkitSent: eventRequest?.toolkitSent || false,
    toolkitSentDate: eventRequest?.toolkitSentDate ? formatDateForInput(eventRequest.toolkitSentDate) : '',
    toolkitStatus: eventRequest?.toolkitStatus || 'not_sent',
    isCorporatePriority: (eventRequest as any)?.isCorporatePriority || false,
    standbyExpectedDate: (eventRequest as any)?.standbyExpectedDate ? formatDateForInput((eventRequest as any).standbyExpectedDate) : '',
    socialMediaPostRequested: (eventRequest as any)?.socialMediaPostRequested || false,
    socialMediaPostRequestedDate: (eventRequest as any)?.socialMediaPostRequestedDate ? formatDateForInput((eventRequest as any).socialMediaPostRequestedDate) : '',
    socialMediaPostCompleted: (eventRequest as any)?.socialMediaPostCompleted || false,
    socialMediaPostCompletedDate: (eventRequest as any)?.socialMediaPostCompletedDate ? formatDateForInput((eventRequest as any).socialMediaPostCompletedDate) : '',
    socialMediaPostNotes: (eventRequest as any)?.socialMediaPostNotes || '',
    actualSandwichCount: (eventRequest as any)?.actualSandwichCount || 0,
    actualSandwichTypes: existingActualSandwichTypes,
    actualSandwichCountRecordedDate: (eventRequest as any)?.actualSandwichCountRecordedDate ? formatDateForInput((eventRequest as any).actualSandwichCountRecordedDate) : '',
    actualSandwichCountRecordedBy: (eventRequest as any)?.actualSandwichCountRecordedBy || '',
    followUpOneDayCompleted: (eventRequest as any)?.followUpOneDayCompleted || false,
    followUpOneDayDate: (eventRequest as any)?.followUpOneDayDate ? formatDateForInput((eventRequest as any).followUpOneDayDate) : '',
    followUpOneMonthCompleted: (eventRequest as any)?.followUpOneMonthCompleted || false,
    followUpOneMonthDate: (eventRequest as any)?.followUpOneMonthDate ? formatDateForInput((eventRequest as any).followUpOneMonthDate) : '',
    followUpNotes: (eventRequest as any)?.followUpNotes || '',
    assignedRecipientIds: parsePostgresArrayFn((eventRequest as any)?.assignedRecipientIds),
    cancelledReason: (eventRequest as any)?.cancelledReason || '',
    cancelledNotes: (eventRequest as any)?.cancelledNotes || '',
    declinedReason: (eventRequest as any)?.declinedReason || '',
    declinedNotes: (eventRequest as any)?.declinedNotes || '',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

interface EventSchedulingFormProps {
  eventRequest: EventRequest | null;
  isVisible?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  onScheduled?: () => void;
  onEventScheduled?: () => void;
  onDelete?: (eventRequestId: number) => void;
  mode?: 'schedule' | 'edit' | 'create';
}

/**
 * A record is "full" when it carries columns the partial sources omit. The
 * event map (/api/event-map) hands the form a PARTIAL record (a subset of
 * columns), and a full-form save from that would blank the omitted fields.
 * Detect partial records via sentinel columns the map never selects, so we can
 * hydrate the full record before allowing a save.
 */
function isFullEventRecord(e: any): boolean {
  return !!e && e.planningNotes !== undefined && e.createdAt !== undefined;
}

const EventSchedulingForm: React.FC<EventSchedulingFormProps> = ({
  eventRequest: rawEventRequest,
  isVisible,
  isOpen,
  onClose,
  onScheduled,
  onEventScheduled,
  onDelete,
  mode = 'schedule',
}) => {
  const dialogOpen = isVisible || isOpen || false;
  const onSuccessCallback = onScheduled || onEventScheduled || (() => {});

  const eventRequest = rawEventRequest;
  // Event requests now use a single full-record shape from the list query.
  // Do not refetch a second "full" copy here; the form initializes from eventRequest.

  // ── Form State ─────────────────────────────────────────────────────

  const [formData, setFormData] = useState<Record<string, any>>({
    eventDate: '', backupDates: [] as string[], eventStartTime: '', eventEndTime: '',
    pickupTime: '', pickupDateTime: '', pickupDate: '', pickupTimeSeparate: '',
    eventAddress: '', deliveryDestination: '', holdingOvernight: false,
    overnightHoldingLocation: '', overnightPickupTime: '',
    sandwichTypes: [] as Array<{type: string, quantity: number}>,
    hasRefrigeration: '', driversNeeded: 0, selfTransport: false, vanDriverNeeded: false, vanNeededLikely: false, vanNeededFor: '',
    assignedVanDriverId: '', isDhlVan: false, volunteersNeeded: 0,
    tspContact: '', customTspContact: '', message: '', schedulingNotes: '',
    planningNotes: '', nextAction: '', driverInstructions: '', volunteerInstructions: '',
    totalSandwichCount: 0, estimatedSandwichCountMin: 0,
    estimatedSandwichCountMax: 0, rangeSandwichType: '',
    estimatedAttendance: 0, adultCount: 0, childrenCount: 0, kidsAgeRange: '',
    status: 'new', toolkitSent: false, toolkitSentDate: '', toolkitStatus: 'not_sent',
    socialMediaPostRequested: false, socialMediaPostRequestedDate: '',
    socialMediaPostCompleted: false, socialMediaPostCompletedDate: '',
    socialMediaPostNotes: '', actualSandwichCount: 0,
    actualSandwichTypes: [] as Array<{type: string, quantity: number}>,
    actualSandwichCountRecordedDate: '', actualSandwichCountRecordedBy: '',
    followUpOneDayCompleted: false, followUpOneDayDate: '',
    followUpOneMonthCompleted: false, followUpOneMonthDate: '', followUpNotes: '',
    assignedRecipientIds: [] as string[], manualEntrySource: '',
    firstName: '', lastName: '', email: '', phone: '', organizationName: '',
    department: '', organizationCategory: '', schoolClassification: '',
    backupContactFirstName: '', backupContactLastName: '', backupContactEmail: '',
    backupContactPhone: '', backupContactRole: '', previouslyHosted: 'i_dont_know',
    deliveryTimeWindow: '',
    deliveryParkingAccess: '', isCorporatePriority: false, standbyExpectedDate: '',
    cancelledReason: '', cancelledNotes: '', declinedReason: '', declinedNotes: '',
    dateFlexible: null as boolean | null,
  });

  const [sandwichMode, setSandwichMode] = useState<'total' | 'range' | 'types'>('total');
  const [actualSandwichMode, setActualSandwichMode] = useState<'total' | 'types'>('total');
  const [attendeeMode, setAttendeeMode] = useState<'total' | 'breakdown'>('total');

  // ── UI State ───────────────────────────────────────────────────────

  const [formInitialized, setFormInitialized] = useState(false);
  const originalFormDataRef = useRef<Record<string, any> | null>(null);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showBackupContactInfo, setShowBackupContactInfo] = useState(false);
  const [showCompletedDetails, setShowCompletedDetails] = useState(false);
  const [showDateConfirmation, setShowDateConfirmation] = useState(false);
  const [pendingDateChange, setPendingDateChange] = useState('');
  const [isMessageEditable, setIsMessageEditable] = useState(false);
  const [showVanConflictDialog, setShowVanConflictDialog] = useState(false);
  // Local session dismissal for the "Van Possibly Needed" panel. Lets the user
  // hide the reminder without taking a definitive action — the DB flag stays
  // set so the panel reappears next time the form opens (in case new info has
  // come in). Resets automatically when the dialog closes/reopens.
  const [vanPossiblyPanelDismissed, setVanPossiblyPanelDismissed] = useState(false);
  const [vanConflictDetails, setVanConflictDetails] = useState<{
    conflictingEvents: Array<{ id: number; name: string; time?: string }>;
    acknowledged: boolean;
  } | null>(null);
  const [vanConflictChecked, setVanConflictChecked] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [showStandbyFollowUpDialog, setShowStandbyFollowUpDialog] = useState(false);
  const [showStatusReasonDialog, setShowStatusReasonDialog] = useState(false);
  const [pendingReasonStatus, setPendingReasonStatus] = useState<'cancelled' | 'declined' | null>(null);
  const [standbyFollowUpDate, setStandbyFollowUpDate] = useState('');
  const [standbyFollowUpMode, setStandbyFollowUpMode] = useState<'specific' | 'one_week' | 'none'>('one_week');
  const standbySaveClickedRef = useRef(false);
  const [hasRecoveredData, setHasRecoveredData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const { errorToast } = useErrorToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  // ── Derived Values ─────────────────────────────────────────────────

  const isCreateMode = mode === 'create' || !eventRequest;

  // Manual creates/edits should treat the initial message like any other notes
  // field (always editable). Website/Google Form submissions keep click-to-edit
  // so the original form text isn't overwritten by accident.
  const alwaysEditableMessage = useMemo(() => {
    if (isCreateMode) return true;
    const source = getEventRequestSourceIndicator({
      externalId: (eventRequest as any)?.externalId,
      manualEntrySource:
        formData.manualEntrySource || (eventRequest as any)?.manualEntrySource,
      googleSheetRowId: (eventRequest as any)?.googleSheetRowId,
      createdBy: (eventRequest as any)?.createdBy,
      lastSyncedAt: (eventRequest as any)?.lastSyncedAt,
    });
    return source?.kind === 'manual';
  }, [
    isCreateMode,
    eventRequest,
    formData.manualEntrySource,
  ]);

  // Explicit loading state for the UI. When editing an existing event the form
  // populates from `eventRequest` in an init effect; until that has run the form
  // fields are empty, so Save must be disabled (saving now would write blanks).
  // Create mode has no record to load, so it is never "loading".
  const isFormLoading = !!eventRequest && !formInitialized;


  const canRemoveCorporatePriority = useMemo(() => {
    const allowedEmails = [
      'admin@sandwich.project', 'katielong2316@gmail.com',
      'katie@thesandwichproject.org', 'christine@thesandwichproject.org',
    ];
    const userEmail = currentUser?.email?.toLowerCase();
    return userEmail && allowedEmails.includes(userEmail);
  }, [currentUser?.email]);

  // ── Date Formatting ────────────────────────────────────────────────

  const formatDateForInput = (date: any) => {
    if (!date) return '';
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return dateObj.toISOString().split('T')[0];
    } catch {
      return '';
    }
  };

  // ── Auto-Save ──────────────────────────────────────────────────────

  const getAutoSaveKey = useCallback(() => {
    return `tsp-event-form-autosave-${eventRequest?.id || 'new'}`;
  }, [eventRequest?.id]);

  const clearAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    try { localStorage.removeItem(getAutoSaveKey()); } catch (e) { /* ignore */ }
  }, [getAutoSaveKey]);

  const saveToLocalStorage = useCallback(() => {
    if (!formInitialized) return;
    try {
      localStorage.setItem(getAutoSaveKey(), JSON.stringify({
        formData, sandwichMode, actualSandwichMode, attendeeMode,
        savedAt: new Date().toISOString(),
        eventId: eventRequest?.id || null,
        originalServerData: originalFormDataRef.current,
      }));
    } catch (e) { /* ignore */ }
  }, [formData, sandwichMode, actualSandwichMode, attendeeMode, formInitialized, getAutoSaveKey, eventRequest?.id]);

  const skipRecoveryRef = useRef(false);

  // ── Discard Recovered Data ─────────────────────────────────────────
  // FIXED: Now uses buildFormDataFromEventRequest instead of 200 lines of copy-paste

  const discardRecoveredData = useCallback(() => {
    clearAutoSave();
    setHasRecoveredData(false);
    skipRecoveryRef.current = true;

    const sourceEvent = eventRequest;
    if (!sourceEvent) return;

    // Use the shared helper instead of duplicating all field mappings
    const serverFormData = buildFormDataFromEventRequest(
      sourceEvent, formatDateForInput, getPickupDateTimeForInput, parsePostgresArray
    );
    setFormData(serverFormData);

    // Determine modes from data
    setSandwichMode(determineSandwichMode(
      sourceEvent.sandwichTypes,
      (sourceEvent as any)?.estimatedSandwichCountMin,
      (sourceEvent as any)?.estimatedSandwichCountMax,
      sourceEvent.estimatedSandwichCount,
    ));
    setActualSandwichMode(determineActualSandwichMode(sourceEvent?.actualSandwichTypes));
    const hasAttendeeBreakdown = ((sourceEvent as any)?.adultCount || 0) > 0 || ((sourceEvent as any)?.childrenCount || 0) > 0;
    setAttendeeMode(hasAttendeeBreakdown ? 'breakdown' : 'total');
    setShowCompletedDetails(sourceEvent?.status === 'completed');

    // Update originalFormDataRef using the same helper
    originalFormDataRef.current = serverFormData;
    setFormInitialized(true);

    toast({ title: 'Changes discarded', description: 'Form has been reset to the last saved version.' });
  }, [eventRequest, clearAutoSave, toast]);

  // ── Auto-save effect ───────────────────────────────────────────────

  useEffect(() => {
    if (!dialogOpen || !formInitialized || isSubmitting) return;
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    autoSaveTimeoutRef.current = setTimeout(() => {
      if (!isSubmitting) saveToLocalStorage();
    }, 1000);

    return () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); };
  }, [dialogOpen, formInitialized, formData, sandwichMode, actualSandwichMode, attendeeMode, saveToLocalStorage, isSubmitting]);

  // ── Collaboration ──────────────────────────────────────────────────

  const collaboration = useEventCollaboration(eventRequest?.id ?? null);
  const isCollaborationEnabled = !!(eventRequest && eventRequest.id);

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users/for-assignments'],
    staleTime: 10 * 60 * 1000,
  });

  const { data: vanDrivers = [] } = useQuery<any[]>({
    queryKey: ['/api/drivers'],
    select: (drivers) => drivers.filter(driver => driver.vanApproved),
    staleTime: 10 * 60 * 1000,
  });

  const handleFieldFocus = useCallback(async (fieldName: string) => {
    if (!isCollaborationEnabled || !collaboration) return;
    try {
      await collaboration.acquireFieldLock?.(fieldName);
    } catch (error) {
      const err = error as Error;
      const isLockConflict = err.message?.includes('locked by') || err.message?.includes('Field is locked');
      if (isLockConflict) {
        toast({ title: 'Field Locked', description: err.message || 'This field is currently being edited by another user.', variant: 'destructive' });
      }
    }
  }, [isCollaborationEnabled, collaboration, toast]);

  const handleFieldBlur = useCallback(async (fieldName: string) => {
    if (!isCollaborationEnabled || !collaboration) return;
    try { await collaboration.releaseFieldLock?.(fieldName); } catch (error) { /* ignore */ }
  }, [isCollaborationEnabled, collaboration]);

  const isFieldLockedByOther = useCallback((fieldName: string): boolean => {
    if (!isCollaborationEnabled || !collaboration || !currentUser) return false;
    return collaboration.isFieldLockedByOther?.(fieldName, currentUser.id) || false;
  }, [isCollaborationEnabled, collaboration, currentUser]);

  const getFieldLock = useCallback((fieldName: string) => {
    if (!isCollaborationEnabled || !collaboration) return null;
    return collaboration.locks?.get(fieldName) || null;
  }, [isCollaborationEnabled, collaboration]);

  // Handle real-time field updates from other users
  useEffect(() => {
    if (!isCollaborationEnabled || !collaboration) return;
    const cleanup = collaboration.onFieldUpdate?.((fieldName, value, version) => {
      if (fieldName === 'status' && !value) return;
      setFormData(prev => ({ ...prev, [fieldName]: value }));
      toast({ title: 'Field Updated', description: `${fieldName} was updated by another user.` });
    });
    return cleanup;
  }, [isCollaborationEnabled, collaboration, toast]);

  // Cleanup field locks on unmount
  useEffect(() => {
    return () => {
      if (!isCollaborationEnabled || !collaboration?.locks || !currentUser) return;
      collaboration.locks.forEach((lock, fieldName) => {
        if (lock.lockedBy === currentUser.id) {
          collaboration.releaseFieldLock?.(fieldName)?.catch(() => {});
        }
      });
    };
  }, [isCollaborationEnabled, collaboration, currentUser]);

  // ── Form Initialization ────────────────────────────────────────────

  const formInitSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (dialogOpen) {
      // The list endpoint now returns full event records, so the form has one
      // authoritative data source and no partial→full upgrade path.
      const currentEventId = eventRequest?.id || 'new';
      const sessionKey = String(currentEventId);

      if (formInitSessionRef.current === sessionKey && formInitialized) return;

      formInitSessionRef.current = sessionKey;
      setFormInitialized(false);
      setHasRecoveredData(false);

      let recoveredFromStorage = false;
      let mergedOriginalFormDataRef: Record<string, any> | null = null;

      // Auto-save recovery
      const shouldSkipRecovery = skipRecoveryRef.current;
      skipRecoveryRef.current = false;

      try {
        const savedDataStr = !shouldSkipRecovery ? localStorage.getItem(getAutoSaveKey()) : null;
        if (savedDataStr) {
          const savedData = JSON.parse(savedDataStr);
          const savedEventId = savedData.eventId;
          const currentEvtId = eventRequest?.id || null;

          if (savedEventId === currentEvtId) {
            const savedAt = new Date(savedData.savedAt);
            const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
            const savedStatus = savedData.formData?.status;
            const serverStatus = eventRequest?.status;
            const statusMismatch = savedStatus && serverStatus && savedStatus !== serverStatus;

            if (statusMismatch) {
              clearAutoSave();
            } else if (hoursSinceSave < 24) {
              const currentServerData = buildFormDataFromEventRequest(
                eventRequest, formatDateForInput, getPickupDateTimeForInput, parsePostgresArray
              );
              // Both halves of the draft are normalized so a draft written
              // before estimatedAttendance absorbed volunteerCount doesn't read
              // as a server-side attendance change and lose the user's edit.
              const { mergedData, conflicts, serverUpdates, userChangesPreserved } = intelligentMergeFormData(
                normalizeDraftAttendance(savedData.formData),
                normalizeDraftAttendance(savedData.originalServerData),
                currentServerData
              );

              // Same status-override rule as the no-recovery branch: when the dialog
              // was opened via "Mark Scheduled", reflect that intent in the dropdown.
              // Only override if the user hadn't already explicitly set a different
              // status in their saved draft (so we don't trample a manual choice).
              if (
                mode === 'schedule' &&
                mergedData.status !== 'scheduled' &&
                (savedData.formData?.status === savedData.originalServerData?.status)
              ) {
                mergedData.status = 'scheduled';
              }

              setFormData(mergedData as any);
              setSandwichMode(determineSandwichMode(
                eventRequest?.sandwichTypes,
                (eventRequest as any)?.estimatedSandwichCountMin,
                (eventRequest as any)?.estimatedSandwichCountMax,
                mergedData.totalSandwichCount ?? eventRequest?.estimatedSandwichCount,
              ));
              if (savedData.actualSandwichMode) setActualSandwichMode(savedData.actualSandwichMode);
              if (savedData.attendeeMode) setAttendeeMode(savedData.attendeeMode);
              setHasRecoveredData(true);
              recoveredFromStorage = true;
              // IMPORTANT: originalFormDataRef must be SERVER data, not merged data.
              // Otherwise recovered user changes won't be detected as "changed" on submit.
              mergedOriginalFormDataRef = currentServerData;
              setShowCompletedDetails(mergedData.status === 'completed');

              // Notify user about merge results
              if (conflicts.length > 0) {
                toast({ title: 'Changes merged with conflicts', description: `${conflicts.length} field(s) were updated by others: ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '...' : ''}`, duration: 10000 });
              } else if (serverUpdates.length > 0 && userChangesPreserved.length > 0) {
                toast({ title: 'Changes merged successfully', description: `${userChangesPreserved.length} change(s) preserved, ${serverUpdates.length} update(s) applied.`, duration: 6000 });
              } else if (userChangesPreserved.length > 0) {
                toast({ title: 'Form data recovered', description: 'Your unsaved changes have been restored. Click "Discard" to start fresh.' });
              }
            } else {
              clearAutoSave();
            }
          }
        }
      } catch (e) { /* ignore */ }

      // If no recovery, populate from server data
      if (!recoveredFromStorage) {
        const serverFormData = buildFormDataFromEventRequest(
          eventRequest, formatDateForInput, getPickupDateTimeForInput, parsePostgresArray
        );
        // When the user opens this dialog via "Mark Scheduled" (mode === 'schedule')
        // and the event isn't already scheduled, pre-set the form's status to
        // 'scheduled' so the dropdown reflects the user's intent. The baseline
        // (originalFormDataRef.current below) keeps the true server status, so
        // full-form save still sees the in_process → scheduled transition.
        if (mode === 'schedule' && serverFormData.status !== 'scheduled') {
          serverFormData.status = 'scheduled';
        }
        setFormData(serverFormData as any);
        setSandwichMode(determineSandwichMode(
          eventRequest?.sandwichTypes,
          (eventRequest as any)?.estimatedSandwichCountMin,
          (eventRequest as any)?.estimatedSandwichCountMax,
          eventRequest?.estimatedSandwichCount,
        ));
        setActualSandwichMode(determineActualSandwichMode(eventRequest?.actualSandwichTypes));
        const hasBreakdown = ((eventRequest as any)?.adultCount || 0) > 0 || ((eventRequest as any)?.childrenCount || 0) > 0;
        setAttendeeMode(hasBreakdown ? 'breakdown' : 'total');
        setShowCompletedDetails(eventRequest?.status === 'completed');
      }

      // Set originalFormDataRef to server data (the true DB baseline).
      // This must ALWAYS reflect what the server has — never the user's recovered/merged changes.
      originalFormDataRef.current = mergedOriginalFormDataRef ?? buildFormDataFromEventRequest(
        eventRequest, formatDateForInput, getPickupDateTimeForInput, parsePostgresArray
      );
      setFormInitialized(true);
    } else {
      // Dialog closed
      setFormInitialized(false);
      formInitSessionRef.current = null;
      // Reset session-only dismissals so reopening the form shows the panel again.
      setVanPossiblyPanelDismissed(false);

      if (originalFormDataRef.current) {
        if (JSON.stringify(formData) === JSON.stringify(originalFormDataRef.current)) {
          clearAutoSave();
        }
      }
    }
  }, [isVisible, isOpen, eventRequest, mode, getAutoSaveKey, clearAutoSave, toast]);

  // Auto-expand contact info in create mode
  useEffect(() => {
    if (isCreateMode) setShowContactInfo(true);
  }, [isCreateMode]);


  // ── Mutations ──────────────────────────────────────────────────────

  const updateEventRequestMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      // Row-level version gate was removed server-side (PR #417); _expectedVersion
      // is ignored by the server, so we no longer send it.
      return apiRequest('PATCH', `/api/event-requests/${id}`, data);
    },
    networkMode: 'always',
    onSuccess: async (updatedEvent: any, variables) => {
      setIsSubmitting(false);
      const orgName = eventRequest?.organizationName || formData.organizationName || 'Event';

      // Status-transition diagnostic on the response side. If the server
      // accepted the save but didn't actually persist the status change, that
      // shows up here as a mismatch between what we sent and what came back.
      const requestedStatus = variables.data?.status;
      if (requestedStatus && updatedEvent?.status !== requestedStatus) {
        logger.error('⚠️ STATUS MISMATCH after save', {
          eventId: eventRequest?.id,
          requested: requestedStatus,
          actualOnResponse: updatedEvent?.status,
          originalStatus: eventRequest?.status,
        });
        // Surface this to the user so it's not a silent revert.
        errorToast({
          title: 'Status change did not save',
          description: `You tried to move "${orgName}" to ${requestedStatus}, but the server reports the status is still ${updatedEvent?.status || 'unchanged'}. Try again, and if it keeps failing, the event may be locked by another process — refresh and reopen the card to see the latest state.`,
          duration: Number.POSITIVE_INFINITY,
          report: {
            whatDoing: `Move event to ${requestedStatus}`,
            expectedOutcome: `Event status updates to ${requestedStatus}.`,
            actualOutcome: `Save returned with status still ${updatedEvent?.status || 'unchanged'}.`,
            ...(eventRequest?.id
              ? {
                  recordType: 'event_request',
                  recordId: String(eventRequest.id),
                  recordLabel: eventRequest.organizationName || formData.organizationName,
                }
              : {}),
          },
        });
        // Keep the form open so the user can see the failure and retry.
        return;
      }

      // Only the server-reported dropped fields are authoritative enough to block
      // save completion. The heuristic round-trip comparison below is logged for
      // diagnostics but must NOT keep the dialog open — treating its false
      // positives as failures made every save look like it silently didn't save.
      const droppedFields = getDroppedServerFields(updatedEvent);
      const mismatchedFields = findMismatchedSavedFields(variables.data || {}, updatedEvent);
      if (mismatchedFields.length > 0) {
        logger.warn(
          '[EventSchedulingForm] Post-save field comparison flagged (non-blocking):',
          mismatchedFields,
        );
      }
      if (droppedFields.length > 0) {
        saveToLocalStorage();
        await refreshEventRequestListAndCounts(queryClient);

        errorToast({
          title: 'Partial Save - Please Review',
          description: `Not saved: ${droppedFields.map((d) => `${d.field} (${d.reason})`).join(', ')}`,
          duration: Number.POSITIVE_INFINITY,
          report: {
            whatDoing: mode === 'edit' ? 'Save event edits in scheduling form' : 'Schedule an event in the scheduling form',
            expectedOutcome: 'All form fields should be saved to the database.',
            actualOutcome: `Partial save — fields dropped: ${droppedFields.map((d) => d.field).join(', ')}`,
            ...(eventRequest?.id
              ? {
                  recordType: 'event_request',
                  recordId: String(eventRequest.id),
                  recordLabel: eventRequest.organizationName || formData.organizationName,
                }
              : {}),
          },
        });
        return;
      }

      clearAutoSave();
      setHasRecoveredData(false);
      const statusChanged =
        !!eventRequest?.status &&
        !!updatedEvent?.status &&
        eventRequest.status !== updatedEvent.status;
      await applyEventRequestSaveToCache(queryClient, updatedEvent, {
        statusChanged,
        touchedFields: Object.keys(variables.data || {}),
      });
      toast({
        title: mode === 'edit' ? 'Changes Saved Successfully' : 'Event Scheduled Successfully',
        description: mode === 'edit'
          ? `Your changes to "${orgName}" have been saved to the database.`
          : `"${orgName}" has been scheduled and saved.`,
        duration: 8000,
      });
      onSuccessCallback();
      onClose();
    },
    onError: async (error: any) => {
      setIsSubmitting(false);
      const serverMessage = error?.data?.message || error?.message;
      const isConflict = error?.status === 409 || error?.code?.includes('CONFLICT');
      const isNotFound = error?.status === 404 || serverMessage?.includes('not found');
      const isNetworkError = error?.message?.includes('Failed to fetch') || error?.message?.includes('Request timeout');
      const orgName = eventRequest?.organizationName || formData.organizationName || 'this event';

      // Capture the server's structured DB detail (see server pg-error-utils) so
      // the auto-filed error report pinpoints the real cause — the raw DB
      // message / SQLSTATE code / column — instead of just "Save Failed".
      const dbDetail = [
        error?.data?.dbError,
        error?.data?.dbCode ? `code=${error.data.dbCode}` : null,
        error?.data?.dbColumn || error?.data?.column
          ? `column=${error.data.dbColumn || error.data.column}`
          : null,
        error?.status ? `http=${error.status}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      let errorTitle = 'Save Failed';
      let errorDescription = mode === 'edit' ? 'Failed to update event.' : 'Failed to schedule event.';

      if (isConflict) {
        errorTitle = 'Edit Conflict';
        saveToLocalStorage();
        errorDescription = 'This event was modified by another user. Please close and reopen to see latest data. Your changes are saved locally.';
        await refreshEventRequestListAndCounts(queryClient);
      } else if (isNotFound) {
        errorTitle = 'Event Not Found';
        errorDescription = 'The event request was not found. It may have been deleted.';
      } else if (isNetworkError) {
        errorTitle = 'Connection Error';
        errorDescription = `Could not save changes to "${orgName}". Check your connection and try again.`;
      } else if (serverMessage) {
        errorDescription = serverMessage;
      }

      errorToast({
        title: errorTitle,
        description: errorDescription,
        duration: 10000,
        report: {
          whatDoing: mode === 'edit' ? 'Save event edits in scheduling form' : 'Schedule an event in the scheduling form',
          expectedOutcome: 'The event request should save successfully.',
          actualOutcome: dbDetail
            ? `${errorTitle}: ${errorDescription} [${dbDetail}]`
            : `${errorTitle}: ${errorDescription}`,
          ...(eventRequest?.id
            ? {
                recordType: 'event_request',
                recordId: String(eventRequest.id),
                recordLabel: eventRequest.organizationName || formData.organizationName,
              }
            : {}),
        },
      });
    },
  });

  const createEventRequestMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/event-requests', data),
    networkMode: 'always',
    onSuccess: () => {
      clearAutoSave();
      setHasRecoveredData(false);
      toast({ title: 'Event Created Successfully', description: `"${formData.organizationName || 'New event'}" has been created.`, duration: 8000 });
      // Close immediately — the event is already saved. List refresh must not
      // keep the dialog stuck on "Creating..." (users were canceling mid-wait
      // and then finding the event had already been created).
      onSuccessCallback();
      onClose();
      void refreshEventRequestListAndCounts(queryClient);
    },
    onError: (error: any) => {
      setIsSubmitting(false);
      saveToLocalStorage();
      const serverMessage = error?.data?.message || error?.message;
      const validationDetail = Array.isArray(error?.data?.details)
        ? error.data.details[0]?.message
        : undefined;
      const isNetworkError = error?.message?.includes('Failed to fetch') || error?.message?.includes('Request timeout');
      let errorTitle = 'Creation Failed';
      let errorDescription =
        validationDetail || serverMessage || 'Failed to create event. Please try again.';
      if (isNetworkError) {
        errorTitle = 'Connection Error';
        errorDescription = 'Could not create event. Check your connection.';
      }
      errorToast({
        title: errorTitle,
        description: errorDescription,
        duration: 10000,
        report: { whatDoing: 'Create a new event in the scheduling form' },
      });
    },
  });

  const deleteEventRequestMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/event-requests/${id}`),
    onSuccess: () => {
      toast({ title: 'Event deleted successfully', description: 'The event request has been deleted.' });
      invalidateEventRequestQueries(queryClient);
      onSuccessCallback();
      onClose();
    },
    onError: () => {
      errorToast({
        title: 'Error',
        description: 'Failed to delete event.',
        report: {
          whatDoing: 'Delete an event from the scheduling form',
          ...(eventRequest?.id
            ? {
                recordType: 'event_request',
                recordId: String(eventRequest.id),
                recordLabel: eventRequest.organizationName || formData.organizationName,
              }
            : {}),
        },
      });
    },
  });

  // ── Van Conflict Check ─────────────────────────────────────────────

  const eventLikelyNeedsVan = (): boolean => {
    if ((formData.vanDriverNeeded || formData.isDhlVan) && !formData.selfTransport) return true;
    const count = sandwichMode === 'total' ? formData.totalSandwichCount
      : sandwichMode === 'range' ? (formData.estimatedSandwichCountMax || formData.estimatedSandwichCountMin || 0)
      : formData.sandwichTypes.reduce((sum: number, item: any) => sum + item.quantity, 0);
    if (count > 500) return true;
    const notes = `${formData.schedulingNotes || ''} ${formData.planningNotes || ''}`.toLowerCase();
    if (/\bvan\b/.test(notes) && !notes.includes('van-approved') && !notes.includes('van approved')) return true;
    return false;
  };

  const checkVanConflicts = async (): Promise<boolean> => {
    if (!formData.eventDate || !eventLikelyNeedsVan()) return true;
    try {
      const response = await fetch(`/api/event-requests/conflicts-for-date?date=${formData.eventDate}`);
      if (!response.ok) return true;
      const data = await response.json();
      if (data.vanConflicts?.length > 0) {
        const conflictingEvents = data.vanConflicts.flatMap((c: any) => [
          { id: c.event1?.id, name: c.event1?.organizationName, time: c.event1?.eventStartTime },
          { id: c.event2?.id, name: c.event2?.organizationName, time: c.event2?.eventStartTime },
        ]).filter((e: any) => e.id !== eventRequest?.id);
        const uniqueEvents = Array.from(new Map(conflictingEvents.map((e: any) => [e.id, e])).values());
        if (uniqueEvents.length > 0) {
          toast({
            title: 'Van Availability Notice',
            description: `The van may already be assigned to: ${uniqueEvents.map((e: any) => e.name + (e.time ? ` at ${e.time}` : '')).join(', ')}`,
            duration: 12000,
          });
          return false;
        }
      }
      return true;
    } catch { return true; }
  };

  // ── Submit ─────────────────────────────────────────────────────────

  const performSubmit = async (skipSpeakerWarning = false, fieldOverrides?: Record<string, any>) => {
    setIsSubmitting(true);
    // NOTE: the recovery draft is intentionally cleared only after a successful
    // save (in the mutation onSuccess handlers). Clearing it here would wipe the
    // user's unsaved edits if the save then failed (network drop, timeout, 4xx/5xx).
    // The auto-save effect is suppressed while isSubmitting is true.

    // Block submission if form not initialized
    if (eventRequest && !formInitialized) {
      setIsSubmitting(false);
      logger.log('⛔ Save blocked: form not initialized');
      toast({ title: 'Please wait', description: 'Form is still loading. Please try again in a moment.', variant: 'destructive' });
      return;
    }

    // Block saving a partial record (e.g. opened from the map). A full-form save
    // from a partial record would overwrite columns the partial source omitted
    // (notes, backup contacts, toolkit, etc.) with empty/default values.
    if (eventRequest && !isFullEventRecord(eventRequest)) {
      setIsSubmitting(false);
      logger.log('⛔ Save blocked: partial event record detected (missing fields)');
      toast({
        title: "Can't save from map view",
        description: "This event was opened from the map and doesn't have all fields loaded. Please close this and reopen the event from the list to edit it.",
        variant: 'destructive',
        duration: 10000,
      });
      return;
    }

    // Speaker recommendation check used to block saves on events with
    // 500+ sandwiches if no speaker was assigned. Removed because (a) it
    // was framed as a "recommendation" but enforced as a hard block, and
    // (b) the nested warning dialog was implicated in silent save
    // failures when other dialogs (e.g. standby reminder) were also in
    // flight. Speaker staffing is now purely advisory — coordinators
    // see open speaker slots in the dashboards instead.

    // Manual entry source is strongly recommended, but should not block saves.
    // Intake often captures details over multiple touchpoints/calls.
    if (isCreateMode && !formData.manualEntrySource) {
      logger.log('⚠️ Save continuing without manual entry source');
      toast({
        title: 'Request source not selected',
        description: 'Save will continue. You can add "How did this request come in?" later from Primary Contact Information.',
        duration: 5000,
      });
      setShowContactInfo(true);
    }

    // Build server payload using extracted utility
    let eventData: Record<string, any>;
    try {
      eventData = buildEventDataForServer(formData as any, {
        mode,
        hasEventRequest: !!eventRequest,
        eventRequestStatus: eventRequest?.status,
        sandwichMode,
        actualSandwichMode,
        fieldOverrides,
      });
    } catch (constructionError) {
      logger.error('Failed to construct eventData for save:', constructionError);
      setIsSubmitting(false);
      toast({ title: 'Error', description: 'Failed to prepare form data. Please try again.', variant: 'destructive' });
      return;
    }

    if (eventRequest) {
      if (!eventRequest.id) {
        logger.log('⛔ Save blocked: no event ID');
        toast({ title: 'Error', description: 'Event request ID is missing. Please refresh.', variant: 'destructive' });
        setIsSubmitting(false);
        return;
      }

      if (!originalFormDataRef.current) {
        logger.log('⛔ Save blocked: originalFormDataRef is null');
        toast({ title: 'Please wait', description: 'Form is still initializing. Please try again.', variant: 'destructive' });
        setIsSubmitting(false);
        return;
      }

      // The single date box maps to BOTH desiredEventDate and scheduledEventDate.
      // In edit mode, if the user didn't change the date box, omit both date
      // columns so a non-date save can't overwrite a scheduled event's CONFIRMED
      // date with the originally-requested date (the box is initialized from
      // desiredEventDate). Scheduling/rescheduling write the date via schedule
      // mode / the Reschedule dialog.
      if (mode === 'edit' && formData.eventDate === originalFormDataRef.current?.eventDate) {
        delete eventData.scheduledEventDate;
        delete eventData.desiredEventDate;
      }

      // DIFF-BASED SAVE: send only the fields the user actually changed in this
      // form session, not the entire record. Re-serialize the ORIGINAL form
      // snapshot through the same builder and drop every key whose value is
      // unchanged. This closes the lost-update / clobber vector: a field left
      // untouched here can no longer overwrite a value that changed elsewhere
      // (an inline card edit, a background Sheets/toolkit write, another editor)
      // between when this dialog loaded and when it saves — untouched fields
      // simply aren't in the payload, so the server preserves them.
      //
      // Both sides go through buildEventDataForServer, so the comparison is in
      // server-field space and immune to form→server key renames/transforms.
      // A key is dropped only when the baseline ALSO produced it and the values
      // match, so genuinely new keys (e.g. scheduledEventDate that appears only
      // once status becomes 'scheduled') are always kept. The baseline is built
      // WITHOUT fieldOverrides so a value just entered this session (e.g. the
      // standby follow-up date) correctly registers as a change.
      if (originalFormDataRef.current) {
        // The baseline MUST be serialized from what is PHYSICALLY stored, not
        // the preferred UI mode. determineBaselineSandwichMode treats any
        // persisted min/max as 'range' even when a disagreeing exact count means
        // the UI opens in Exact Count — otherwise the diff sees null === null
        // for the companion clears and silently drops them. The stale range then
        // survives in the DB alongside the exact count (the "500 saves as 498"
        // bug — midpoint of a leftover 490-506 range).
        const baselineSandwichMode = determineBaselineSandwichMode(
          originalFormDataRef.current.sandwichTypes,
          originalFormDataRef.current.estimatedSandwichCountMin,
          originalFormDataRef.current.estimatedSandwichCountMax,
          originalFormDataRef.current.totalSandwichCount,
        );
        const baselineActualSandwichMode = determineActualSandwichMode(
          originalFormDataRef.current.actualSandwichTypes,
        );
        const baselineData = buildEventDataForServer(originalFormDataRef.current as any, {
          mode,
          hasEventRequest: !!eventRequest,
          eventRequestStatus: eventRequest?.status,
          sandwichMode: baselineSandwichMode,
          actualSandwichMode: baselineActualSandwichMode,
        });
        const omittedFields: string[] = [];
        for (const key of Object.keys(eventData)) {
          // Never drop a key the caller explicitly overrode this save — an
          // override is a deliberate write even when it equals the baseline.
          // (e.g. "No reminder" sends standbyExpectedDate: null; the baseline
          // also computes null because its status isn't 'standby' yet, so a
          // plain diff would silently drop the clear and a stale follow-up
          // date from a previous standby episode would survive.)
          if (fieldOverrides && Object.prototype.hasOwnProperty.call(fieldOverrides, key)) {
            continue;
          }
          if (
            Object.prototype.hasOwnProperty.call(baselineData, key) &&
            JSON.stringify(eventData[key]) === JSON.stringify(baselineData[key])
          ) {
            delete eventData[key];
            omittedFields.push(key);
          }
        }
        if (omittedFields.length > 0) {
          logger.log(`🧮 Diff-based save: omitted ${omittedFields.length} unchanged field(s):`, omittedFields.join(', '));
        }
      }

      // No-op guard: if nothing changed, skip the round-trip entirely (matches
      // EventEditDialog's behavior) so an accidental Save on an untouched form
      // doesn't bump updatedAt or fire activity/audit logs for a non-change.
      if (Object.keys(eventData).length === 0) {
        logger.log('🟰 Diff-based save: no changes detected, closing without a write');
        setIsSubmitting(false);
        toast({ description: 'No changes to save.' });
        onClose();
        return;
      }

      // Reason-required statuses (cancelled / declined / non_event) need a note
      // or structured reason. Catch this client-side so users get a clear message
      // instead of a generic MISSING_REASON failure from the server.
      const targetStatus = eventData.status as EventStatus | undefined;
      if (
        targetStatus &&
        targetStatus !== eventRequest.status &&
        requiresReason(targetStatus)
      ) {
        const reasonFields = getReasonSatisfyingFields(targetStatus);
        const hasReason = reasonFields.some((field) => {
          const incoming = (eventData as any)[field];
          const existing = (eventRequest as any)[field];
          const formValue = (formData as any)[field];
          const effective =
            incoming !== undefined
              ? incoming
              : formValue !== undefined && formValue !== ''
                ? formValue
                : existing;
          return typeof effective === 'string' && effective.trim() !== '';
        });
        if (!hasReason) {
          logger.log('⛔ Save blocked: missing reason for', targetStatus);
          setIsSubmitting(false);
          // If they somehow picked cancelled/declined without going through the
          // reason dialog (e.g. recovered draft), open it now instead of a toast.
          if (
            (targetStatus === 'cancelled' || targetStatus === 'declined') &&
            eventRequest
          ) {
            setPendingReasonStatus(targetStatus);
            setTimeout(() => setShowStatusReasonDialog(true), 0);
            return;
          }
          toast({
            title: 'Reason required',
            description: `Add a brief reason before marking this event as ${STATUS_DEFINITIONS[targetStatus]?.label || targetStatus}.`,
            variant: 'destructive',
            duration: 10000,
          });
          return;
        }
      }

      logger.log('🔄 Updating event (diff-based save):', eventRequest.id, 'changed field count:', Object.keys(eventData).length, 'van:', eventData.vanDriverNeeded);
      // Extra status-transition diagnostic: any standby-related save logs the
      // exact status payload being sent. Helps debug the "save closes but
      // status reverts" symptom when it shows up in production.
      if (eventData.status && eventData.status !== eventRequest.status) {
        logger.log('🔁 STATUS TRANSITION in payload:', {
          from: eventRequest.status,
          to: eventData.status,
          standbyExpectedDate: eventData.standbyExpectedDate,
          eventId: eventRequest.id,
        });
      }
      // Use mutateAsync so performSubmit's caller can await completion
      // and detect failures. The mutation's own onError handler still
      // toasts (no duplicate notifications) — awaiting here just lets
      // wrapper flows like the standby dialog keep their UI in sync
      // with whether the save actually landed.
      await updateEventRequestMutation.mutateAsync({ id: eventRequest.id, data: eventData });
    } else {
      logger.log('➕ Creating new event');
      await createEventRequestMutation.mutateAsync(eventData);
    }
  };

  // ── Status Change Handler ──────────────────────────────────────────

  const handleStatusChange = (newStatus: EventStatus) => {
    // Cancelled / Declined require a structured reason (server MISSING_REASON).
    // Open the reason dialog first; only apply the status once the user confirms.
    // Defer open so the parent non-modal Dialog doesn't tear down on focus churn
    // (same pattern as the standby follow-up dialog).
    if (newStatus === 'cancelled' || newStatus === 'declined') {
      if (!eventRequest) {
        toast({
          title: 'Reason required',
          description: `Add a brief reason in Planning Notes or Scheduling Notes before marking this as ${STATUS_DEFINITIONS[newStatus]?.label || newStatus}.`,
          duration: 8000,
        });
        setFormData(prev => ({ ...prev, status: newStatus }));
        return;
      }
      setPendingReasonStatus(newStatus);
      setTimeout(() => setShowStatusReasonDialog(true), 0);
      return;
    }

    if (newStatus === 'non_event' || newStatus === 'rescheduled') {
      const statusLabel = STATUS_DEFINITIONS[newStatus]?.label || newStatus;
      toast({
        title: 'Status Change Requires Documentation',
        description: `When saving, please ensure you've documented the reason for changing to ${statusLabel} in the notes field.`,
        duration: 8000,
      });
    }
    setFormData(prev => ({ ...prev, status: newStatus }));
  };

  // ── Form Submit Handler ────────────────────────────────────────────

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault?.();

    // Non-blocking van conflict check
    if (eventLikelyNeedsVan() && !vanConflictChecked) {
      checkVanConflicts()
        .then(noConflicts => { setVanConflictChecked(true); })
        .catch(() => { setVanConflictChecked(true); });
    }

    // Standby follow-up date prompt — fires for EVERY transition into standby
    // from another status, regardless of whether standbyExpectedDate already has
    // a value. Previously this check skipped the dialog when standbyExpectedDate
    // was truthy, which broke the flow when an event had a leftover date from a
    // prior standby episode: the dialog never appeared, but the save sometimes
    // landed in a state where the status reverted to scheduled without warning.
    // Always confirming the follow-up date with the user keeps intent explicit
    // for the current standby episode.
    const originalStatus = eventRequest?.status || 'new';
    if (formData.status === 'standby' && originalStatus !== 'standby') {
      // Pre-fill: use the existing standbyExpectedDate if present (so users
      // don't have to retype a date they already set), otherwise default to
      // one week from today.
      const existingDate = formData.standbyExpectedDate;
      if (existingDate) {
        setStandbyFollowUpDate(existingDate);
        setStandbyFollowUpMode('specific');
      } else {
        const oneWeekFromNow = new Date();
        oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
        setStandbyFollowUpDate(oneWeekFromNow.toISOString().split('T')[0]);
        setStandbyFollowUpMode('one_week');
      }
      logger.log('🟡 Standby transition detected: opening follow-up dialog', {
        originalStatus,
        targetStatus: formData.status,
        existingDate,
      });
      // Defer opening to a settled tick instead of opening synchronously inside
      // this click handler. The form lives in a non-modal parent Dialog
      // (<Dialog modal={false} onOpenChange={onClose}>), whose dismissable layer
      // watches for focus/pointer leaving its content. When the modal reminder
      // AlertDialog mounted during the SAME click that opened it, the in-flight
      // focus churn from that click could trip the parent's outside-interaction
      // detection, firing the parent's onClose — which unmounts the whole form.
      // That is the "popup flashes then disappears and the edit form refreshes"
      // bug: the parent closed and re-rendered from server data, reverting the
      // status. The van/speaker dialogs never hit this because they open after
      // an awaited fetch (a later, settled tick). Matching that timing here lets
      // the originating click fully resolve before the AlertDialog mounts.
      setTimeout(() => setShowStandbyFollowUpDialog(true), 0);
      return;
    }

    await performSubmit(false);
  };

  // ── Date Change ────────────────────────────────────────────────────

  const handleDateChangeConfirmation = () => {
    setFormData(prev => ({ ...prev, eventDate: pendingDateChange }));
    setShowDateConfirmation(false);
    setPendingDateChange('');
  };

  // ── Section Progress ───────────────────────────────────────────────

  const sectionStatus = {
    contact: !!(formData.firstName || formData.lastName || formData.email || formData.phone),
    schedule: !!formData.eventDate,
    delivery: !!(formData.eventAddress || (formData.assignedRecipientIds?.length > 0)),
    sandwiches: !!(formData.totalSandwichCount > 0 || formData.sandwichTypes?.length > 0 || formData.estimatedSandwichCountMin > 0),
    resources: !!(formData.driversNeeded > 0 || formData.volunteersNeeded > 0 || formData.selfTransport),
    notes: !!(formData.schedulingNotes || formData.planningNotes || formData.nextAction),
  };
  const completedSections = Object.values(sectionStatus).filter(Boolean).length;
  const totalSections = Object.keys(sectionStatus).length;

  // True whenever ANY nested confirmation/reminder dialog is mounted. The parent
  // form lives in a non-modal <Dialog modal={false}>, whose dismissable layer
  // treats focus/pointer churn from a child dialog mounting as an "interaction
  // outside" and fires the parent's onClose — unmounting the form and reverting
  // it from server data. (That's the "popup flashes then the edit form refreshes
  // and my change is gone" bug.) Suppressing onClose while any child is open
  // covers every nested dialog, not just the standby reminder that was patched
  // case-by-case before. Each child owns its own close + cleanup, so none of
  // them rely on the parent closing.
  const anyNestedDialogOpen =
    showDateConfirmation ||
    showVanConflictDialog ||
    showStandbyFollowUpDialog ||
    showStatusReasonDialog ||
    showDeleteConfirmation;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Dialog
      open={dialogOpen}
      // Don't let the form be dismissed out from under any nested dialog. While
      // a child confirmation/reminder is open it owns the interaction; a close
      // request to the parent here (e.g. a stray focus/pointer-outside from the
      // non-modal layer, including the focus churn of a child mounting) must be
      // ignored so the flow isn't torn down mid-decision. The user closes each
      // child via its own Cancel/Save. See anyNestedDialogOpen above.
      onOpenChange={(open) => { if (!open && !anyNestedDialogOpen) onClose(); }}
      modal={false}
    >
      {/* z-[9999] sits one step below the shared dialog layer (z-[10001]) so
          every nested dialog/confirmation and toast always stacks above this
          form. At equal z-index the browser falls back to DOM order, and
          whenever this content re-mounts while a child is open it re-appends
          to <body> last and covers the child ("popup hidden behind the edit
          form"). Non-modal, so no overlay of its own to sit under. */}
      <DialogContent className="z-[9999] w-[95vw] max-w-4xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-[#236383]">
              {isCreateMode ? 'Create New Event' : `${mode === 'edit' ? 'Edit Event Details:' : 'Schedule Event:'} ${eventRequest?.organizationName}`}
            </DialogTitle>
            {isCollaborationEnabled && currentUser && (
              <div className="flex items-center gap-2" data-testid="presence-avatars-container">
                <PresenceAvatars users={collaboration.presentUsers || []} currentUserId={currentUser.id} />
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6">
          {/* Auto-save Recovery Banner */}
          {hasRecoveredData && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between mb-4" data-testid="autosave-recovery-banner">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-600" />
                <span className="text-sm text-amber-800">Unsaved changes were recovered from your previous session.</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={discardRecoveredData}
                className="text-amber-700 border-amber-300 hover:bg-amber-100" data-testid="discard-recovered-data-btn">
                Discard
              </Button>
            </div>
          )}

          {/* Progress Indicator */}
          <div className="bg-slate-50 rounded-lg p-3 border mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#236383]">Form Progress</span>
              <span className="text-sm text-gray-600">{completedSections} of {totalSections} sections</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-[#47B3CB] h-2 rounded-full transition-all duration-300"
                style={{ width: `${(completedSections / totalSections) * 100}%` }} />
            </div>
          </div>

          {/* Workflow Guidance */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-blue-900 font-medium">Lifecycle workflow guidance</p>
            <p className="text-sm text-blue-800 mt-1">
              Save anytime as details come in. To move to <span className="font-semibold">Scheduled</span>, only an event date is required.
              All other details can be completed later.
            </p>
          </div>

          {/* Van-possibly confirmation panel.
              Surfaces when the event was previously flagged "possibly needs a van"
              from the in-process card. All three choices just mutate local form
              state, so the panel disappears via derived visibility (no separate
              dismiss flag) and saves go through normally. The "still not sure"
              option preserves the existing flag so a decision can be revisited
              later. */}
          {(formData as any).vanNeededLikely && !(formData as any).vanDriverNeeded && !vanPossiblyPanelDismissed && (
            <div className="mx-4 sm:mx-6 mb-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 sm:p-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-700 mt-0.5" aria-hidden="true">🚐</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    This event was flagged as possibly needing a van.
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Do you have an answer yet? You can leave it unresolved if you're still figuring it out.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          vanDriverNeeded: true,
                          vanNeededLikely: false,
                        }))
                      }
                      className="px-3 py-1.5 text-sm rounded-md bg-[#007E8C] text-white hover:bg-[#006873] font-medium"
                      data-testid="button-van-confirm-needed"
                    >
                      Yes, van is needed
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          vanNeededLikely: false,
                        }))
                      }
                      className="px-3 py-1.5 text-sm rounded-md bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 font-medium"
                      data-testid="button-van-clear-flag"
                    >
                      No, clear the flag
                    </button>
                    <button
                      type="button"
                      onClick={() => setVanPossiblyPanelDismissed(true)}
                      className="px-3 py-1.5 text-sm rounded-md bg-transparent border border-slate-300 text-slate-600 hover:bg-slate-100 font-medium"
                      data-testid="button-van-still-not-sure"
                    >
                      Still not sure — leave for now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" id="event-scheduling-form" noValidate>

            {/* Lifecycle & Core Scheduling */}
            <div className="bg-white border rounded-lg p-4 space-y-4">
              <h3 className="text-base font-semibold text-[#236383]">1) Lifecycle & Core Scheduling</h3>

              {/* Status & Toolkit */}
              <StatusToolkitSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                eventRequest={eventRequest}
                canRemoveCorporatePriority={!!canRemoveCorporatePriority}
                onStatusChange={handleStatusChange}
              />

              {/* Event Schedule */}
              <EventScheduleSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                isComplete={sectionStatus.schedule}
                eventRequest={eventRequest}
                formatDateForInput={formatDateForInput}
                onVanConflictReset={() => setVanConflictChecked(false)}
                onScheduledDateChange={(newDate) => {
                  setPendingDateChange(newDate);
                  setShowDateConfirmation(true);
                }}
              />
            </div>

            {/* Contacts */}
            <div className="bg-white border rounded-lg p-4 space-y-4">
              <h3 className="text-base font-semibold text-[#236383]">2) Contacts</h3>

              {/* Contact Info */}
              <ContactInfoSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                isExpanded={showContactInfo}
                onToggle={() => setShowContactInfo(!showContactInfo)}
                isComplete={sectionStatus.contact}
                isCreateMode={isCreateMode}
              />

              {/* Backup Contact */}
              <BackupContactSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                isExpanded={showBackupContactInfo}
                onToggle={() => setShowBackupContactInfo(!showBackupContactInfo)}
              />
            </div>

            {/* Planning & Logistics */}
            <div className="bg-white border rounded-lg p-4 space-y-4">
              <h3 className="text-base font-semibold text-[#236383]">3) Planning & Logistics</h3>

              {/* Sandwich Planning */}
              <SandwichPlanningSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                sandwichMode={sandwichMode}
                setSandwichMode={setSandwichMode}
                isComplete={sectionStatus.sandwiches}
              />

              {/* Attendees */}
              <AttendeeSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                attendeeMode={attendeeMode}
                setAttendeeMode={setAttendeeMode}
              />

              {/* Delivery */}
              <DeliverySection
                formData={formData as EventFormData}
                setFormData={setFormData}
                eventRequestId={eventRequest?.id}
              />

              {/* Refrigeration */}
              <div>
                <Label htmlFor="hasRefrigeration">Refrigeration Available?</Label>
                <Select value={formData.hasRefrigeration} onValueChange={(value) => setFormData(prev => ({ ...prev, hasRefrigeration: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select refrigeration status" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]" position="popper" sideOffset={5}>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
                <RefrigerationWarningAlert
                  sandwichTypes={formData.sandwichTypes}
                  hasRefrigeration={
                    formData.hasRefrigeration === 'true' ? true :
                    formData.hasRefrigeration === 'false' ? false : null
                  }
                  className="mt-2"
                />
              </div>

              {/* Resource Requirements */}
              <ResourceRequirementsSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                vanDrivers={vanDrivers}
                isComplete={sectionStatus.resources}
              />
            </div>

            {/* Internal Coordination */}
            <div className="bg-white border rounded-lg p-4 space-y-4">
              <h3 className="text-base font-semibold text-[#236383]">4) Internal Coordination & Notes</h3>

              {/* TSP Contact */}
              <TspContactSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                users={users}
                isCollaborationEnabled={isCollaborationEnabled}
                isFieldLockedByOther={isFieldLockedByOther}
                getFieldLock={getFieldLock}
                handleFieldFocus={handleFieldFocus}
                handleFieldBlur={handleFieldBlur}
              />

            {/* Contact Attempts History */}
            {eventRequest && (eventRequest.contactAttempts > 0 || eventRequest.unresponsiveNotes) && (
              <div className="space-y-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-blue-800 mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  Contact Attempts History
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="bg-white px-3 py-1 rounded border border-blue-300">
                      <span className="font-medium text-blue-900">Total Attempts:</span>{' '}
                      <span className="text-blue-700 font-bold">{eventRequest.contactAttempts || 0}</span>
                    </div>
                    {eventRequest.lastContactAttempt && (
                      <div className="bg-white px-3 py-1 rounded border border-blue-300">
                        <span className="font-medium text-blue-900">Last Attempt:</span>{' '}
                        <span className="text-blue-700">{new Date(eventRequest.lastContactAttempt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                    )}
                    {eventRequest.contactMethod && (
                      <div className="bg-white px-3 py-1 rounded border border-blue-300">
                        <span className="font-medium text-blue-900">Method:</span>{' '}
                        <span className="text-blue-700 capitalize">{eventRequest.contactMethod}</span>
                      </div>
                    )}
                  </div>
                  {eventRequest.unresponsiveNotes && (
                    <div className="bg-white p-3 rounded border border-blue-300">
                      <p className="text-sm font-medium text-blue-900 mb-1">Attempt Log:</p>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{eventRequest.unresponsiveNotes}</div>
                    </div>
                  )}
                  {eventRequest.isUnresponsive && (
                    <div className="bg-yellow-100 border border-yellow-400 rounded p-2 flex items-start gap-2">
                      <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-yellow-800">Marked as Unresponsive</p>
                        {eventRequest.unresponsiveReason && (
                          <p className="text-sm text-yellow-700">Reason: {eventRequest.unresponsiveReason}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

              {/* Notes & Requirements */}
              <NotesSection
                formData={formData as EventFormData}
                setFormData={setFormData}
                isComplete={sectionStatus.notes}
                isMessageEditable={isMessageEditable}
                setIsMessageEditable={setIsMessageEditable}
                alwaysEditableMessage={alwaysEditableMessage}
                isCollaborationEnabled={isCollaborationEnabled}
                isFieldLockedByOther={isFieldLockedByOther}
                getFieldLock={getFieldLock}
                handleFieldFocus={handleFieldFocus}
                handleFieldBlur={handleFieldBlur}
              />

              {/* Volunteer Instructions */}
              <InstructionsSection
                formData={formData as EventFormData}
                setFormData={setFormData}
              />
            </div>

            {/* Completed Event Details */}
            <CompletedEventSection
              formData={formData as EventFormData}
              setFormData={setFormData}
              isExpanded={showCompletedDetails}
              onToggle={() => setShowCompletedDetails(!showCompletedDetails)}
              actualSandwichMode={actualSandwichMode}
              setActualSandwichMode={setActualSandwichMode}
            />

          </form>
        </div>

        {/* Sticky Footer */}
        <div className="flex-shrink-0 flex justify-between px-4 sm:px-6 py-4 border-t bg-white">
          <div>
            {eventRequest && mode === 'edit' && (
              <Button type="button" variant="outline"
                className="border-[#A31C41] text-[#A31C41] hover:bg-[#A31C41] hover:text-white"
                onClick={() => setShowDeleteConfirmation(true)}
                disabled={deleteEventRequestMutation.isPending}
                data-testid="button-delete-event">
                <Trash2 className="w-4 h-4 mr-2" />
                {deleteEventRequestMutation.isPending ? 'Deleting...' : 'Delete Event'}
              </Button>
            )}
          </div>
          <div className="flex space-x-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            {/*
              Belt-and-suspenders: this button lives outside the <form>, so it relies on the
              `form` attribute to submit. Some browser/portal combinations don't honor that
              association, which made the button appear to do nothing. The onClick triggers the
              save directly. preventDefault suppresses the native form submit so there is no
              double submission, and the button stays disabled while a save is in flight.
            */}
            <Button type="submit" form="event-scheduling-form" className="text-white"
              style={{ backgroundColor: '#236383' }}
              disabled={isFormLoading || isSubmitting || updateEventRequestMutation.isPending || createEventRequestMutation.isPending}
              onClick={(e) => { e.preventDefault(); handleSubmit(e); }}
              data-testid="button-submit">
              {isFormLoading
                ? 'Loading…'
                : (updateEventRequestMutation.isPending || createEventRequestMutation.isPending)
                ? (isCreateMode ? 'Creating...' : mode === 'edit' ? 'Saving...' : 'Scheduling...')
                : (isCreateMode ? 'Create Event' : mode === 'edit' ? 'Save Changes' : 'Schedule Event')}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* ── Dialogs ─────────────────────────────────────────────── */}

      <DateChangeDialog
        open={showDateConfirmation}
        onOpenChange={setShowDateConfirmation}
        onConfirm={handleDateChangeConfirmation}
        onCancel={() => setShowDateConfirmation(false)}
      />

      <VanConflictDialog
        open={showVanConflictDialog}
        onOpenChange={(open) => { if (!open) { setShowVanConflictDialog(false); setVanConflictChecked(false); setIsSubmitting(false); } }}
        conflictDetails={vanConflictDetails}
        onGoBack={() => { setShowVanConflictDialog(false); setVanConflictChecked(false); setIsSubmitting(false); }}
        onAcknowledge={() => { setShowVanConflictDialog(false); setVanConflictChecked(true); }}
      />

      <StandbyFollowUpDialog
        open={showStandbyFollowUpDialog}
        onOpenChange={(open) => {
          if (!open && !standbySaveClickedRef.current) {
            setShowStandbyFollowUpDialog(false);
            setFormData(prev => ({ ...prev, status: eventRequest?.status || 'new' }));
            setIsSubmitting(false);
          }
        }}
        followUpDate={standbyFollowUpDate}
        setFollowUpDate={setStandbyFollowUpDate}
        followUpMode={standbyFollowUpMode}
        setFollowUpMode={setStandbyFollowUpMode}
        onSave={async () => {
          // Keep the dialog OPEN while the save is in flight so it never
          // visually disappears mid-flight. We close it only after the
          // submit resolves; if the save throws/toasts an error, leaving
          // the dialog open lets the user correct and retry instead of
          // seeing the form silently refresh with no feedback.
          standbySaveClickedRef.current = true;
          // "No reminder" clears the follow-up date — the reminder is optional.
          const dateToSave = standbyFollowUpMode === 'none' ? '' : standbyFollowUpDate;
          setFormData(prev => ({ ...prev, standbyExpectedDate: dateToSave }));
          try {
            await performSubmit(false, { standbyExpectedDate: dateToSave || null });
            setShowStandbyFollowUpDialog(false);
          } catch (err) {
            // performSubmit's mutation onError already toasts. We leave
            // the dialog open so the user can adjust and try again.
            logger.error('Standby save failed; keeping dialog open', err);
          } finally {
            standbySaveClickedRef.current = false;
          }
        }}
      />

      {eventRequest && pendingReasonStatus && (
        <StatusReasonDialog
          isOpen={showStatusReasonDialog}
          onClose={() => {
            setShowStatusReasonDialog(false);
            setPendingReasonStatus(null);
          }}
          request={eventRequest}
          type={pendingReasonStatus}
          onConfirm={async (_eventId, data) => {
            // Stash status + structured reason on the form; Save will send them
            // together and satisfy the server MISSING_REASON check (Susan's bug).
            setFormData((prev) => ({
              ...prev,
              status: data.status,
              cancelledReason: data.cancelledReason || '',
              cancelledNotes: data.cancelledNotes || '',
              declinedReason: data.declinedReason || '',
              declinedNotes: data.declinedNotes || '',
            }));
            setShowStatusReasonDialog(false);
            setPendingReasonStatus(null);
            toast({
              title: `${STATUS_DEFINITIONS[data.status as EventStatus]?.label || data.status} reason recorded`,
              description: 'Click Save to apply the status change.',
              duration: 6000,
            });
          }}
        />
      )}

      <DeleteConfirmDialog
        open={showDeleteConfirmation}
        onOpenChange={setShowDeleteConfirmation}
        eventRequest={eventRequest}
        onDelete={() => {
          if (eventRequest) {
            if (onDelete) { onDelete(eventRequest.id); }
            else { deleteEventRequestMutation.mutate(eventRequest.id); }
            setShowDeleteConfirmation(false);
          }
        }}
        isPending={deleteEventRequestMutation.isPending}
      />
    </Dialog>
  );
};

export default EventSchedulingForm;
