/**
 * EventDialogContext
 *
 * Owns the (large) pile of UI state related to dialogs and modals on the
 * Event Requests screen: visibility booleans, the "active event" reference
 * each dialog operates on, the assignment dialog's working state, and the
 * inline-editing state for cells in the scheduled view.
 *
 * This was previously all on EventRequestContext, which made every dialog
 * open/close fan out re-renders to consumers that only cared about list data
 * or filters. Splitting it into its own provider is the first step of the
 * Strangler refactor for that mega-context.
 *
 * Migration status (PR 1): EventRequestContext still exports every field
 * below via pass-through, so existing consumers don't need to change. PR 2
 * will switch consumers to call useEventDialogState() directly and remove
 * the pass-through, which is where the actual re-render perf win lands.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { EventRequest } from '@shared/schema';

/**
 * The single source of truth for "which dialog is open."
 *
 * This replaces the 23 independent `showXDialog` booleans this context used to
 * carry (Unit 5 of the Event Requests Reliability Plan). Because exactly one
 * dialog can be open at a time, a single discriminated value both eliminates a
 * whole class of "two dialogs open at once / stuck dialog" bugs and makes the
 * open/close transitions trivially debuggable.
 *
 * The per-dialog *event* references (schedulingEventRequest, etc.) intentionally
 * stay as separate state below — several of them (e.g. selectedEventRequest) are
 * shared across multiple dialogs, so folding them into this union would force
 * duplication rather than remove it.
 */
export type ActiveDialog =
  | 'none'
  | 'eventDetails'
  | 'eventDetailsPreview'
  | 'scheduling'
  | 'toolkitSent'
  | 'sendToolkit'
  | 'scheduleCall'
  | 'oneDayFollowUp'
  | 'oneMonthFollowUp'
  | 'contactOrganizer'
  | 'collectionLog'
  | 'assignment'
  | 'tspContactAssignment'
  | 'sandwichPlanning'
  | 'staffingPlanning'
  | 'logContact'
  | 'editContact'
  | 'aiDateSuggestion'
  | 'aiIntakeAssistant'
  | 'intakeCall'
  | 'decline'
  | 'cancel'
  | 'nonEvent'
  | 'reschedule'
  | 'nextAction';

export interface EventDialogContextType {
  // Selected event for the main details dialog (the most-used field on
  // the old context). Pairs with isEditing/activeDialog === 'eventDetails'.
  selectedEventRequest: EventRequest | null;
  setSelectedEventRequest: (event: EventRequest | null) => void;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;

  // Which dialog (if any) is currently open. Replaces the old pile of
  // showXDialog booleans.
  activeDialog: ActiveDialog;
  setActiveDialog: (dialog: ActiveDialog) => void;
  /** Open a dialog (closes any other open dialog automatically). */
  openDialog: (dialog: Exclude<ActiveDialog, 'none'>) => void;
  /**
   * Close the open dialog. Pass a dialog name to close *only* if that specific
   * dialog is the one currently open — this makes "open A, close B" sequences
   * order-independent (closing B is a no-op once A is already open), which the
   * old independent-boolean model relied on.
   */
  closeDialog: (only?: Exclude<ActiveDialog, 'none'>) => void;

  // Per-dialog active event references
  schedulingEventRequest: EventRequest | null;
  setSchedulingEventRequest: (event: EventRequest | null) => void;
  toolkitEventRequest: EventRequest | null;
  setToolkitEventRequest: (event: EventRequest | null) => void;
  collectionLogEventRequest: EventRequest | null;
  setCollectionLogEventRequest: (event: EventRequest | null) => void;
  contactEventRequest: EventRequest | null;
  setContactEventRequest: (event: EventRequest | null) => void;
  tspContactEventRequest: EventRequest | null;
  setTspContactEventRequest: (event: EventRequest | null) => void;
  logContactEventRequest: EventRequest | null;
  setLogContactEventRequest: (event: EventRequest | null) => void;
  editContactEventRequest: EventRequest | null;
  setEditContactEventRequest: (event: EventRequest | null) => void;
  editContactAttemptData: any | null;
  setEditContactAttemptData: (data: any | null) => void;
  aiSuggestionEventRequest: EventRequest | null;
  setAiSuggestionEventRequest: (event: EventRequest | null) => void;
  aiIntakeAssistantEventRequest: EventRequest | null;
  setAiIntakeAssistantEventRequest: (event: EventRequest | null) => void;
  intakeCallEventRequest: EventRequest | null;
  setIntakeCallEventRequest: (event: EventRequest | null) => void;
  reasonDialogEventRequest: EventRequest | null;
  setReasonDialogEventRequest: (event: EventRequest | null) => void;
  nonEventDialogEventRequest: EventRequest | null;
  setNonEventDialogEventRequest: (event: EventRequest | null) => void;
  rescheduleDialogEventRequest: EventRequest | null;
  setRescheduleDialogEventRequest: (event: EventRequest | null) => void;
  nextActionEventRequest: EventRequest | null;
  setNextActionEventRequest: (event: EventRequest | null) => void;
  nextActionMode: 'add' | 'edit' | 'complete';
  setNextActionMode: (mode: 'add' | 'edit' | 'complete') => void;

  // Assignment dialog working state
  assignmentType: 'driver' | 'volunteer' | null;
  setAssignmentType: (type: 'driver' | 'volunteer' | null) => void;
  assignmentEventId: number | null;
  setAssignmentEventId: (id: number | null) => void;
  selectedAssignees: string[];
  setSelectedAssignees: (assignees: string[]) => void;
  isEditingAssignment: boolean;
  setIsEditingAssignment: (editing: boolean) => void;
  editingAssignmentPersonId: string | null;
  setEditingAssignmentPersonId: (id: string | null) => void;
  isVanDriverAssignment: boolean;
  setIsVanDriverAssignment: (isVan: boolean) => void;
  customPersonData: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    vanCapable: boolean;
  };
  setCustomPersonData: (data: any) => void;

  // Schedule-call form scratch state (lives in the schedule call dialog)
  scheduleCallDate: string;
  setScheduleCallDate: (date: string) => void;
  scheduleCallTime: string;
  setScheduleCallTime: (time: string) => void;

  // Follow-up dialog scratch
  followUpNotes: string;
  setFollowUpNotes: (notes: string) => void;

  // Inline editing in the scheduled spreadsheet view.
  // (Categorically borderline — it's a "view" concern, not a dialog. Lives
  // here for now because mutation cleanup paths reset it; see PR audit.)
  editingScheduledId: number | null;
  setEditingScheduledId: (id: number | null) => void;
  editingField: string | null;
  setEditingField: (field: string | null) => void;
  editingValue: string;
  setEditingValue: (value: string) => void;

  // Modal sandwich count editing scratch state (the inline quick edit keeps
  // its own state: CardSandwichEstimateEdit)
  modalSandwichMode: 'total' | 'types';
  setModalSandwichMode: (mode: 'total' | 'types') => void;
  modalTotalCount: number;
  setModalTotalCount: (count: number) => void;
  modalSandwichTypes: Array<{ type: string; quantity: number }>;
  setModalSandwichTypes: (types: Array<{ type: string; quantity: number }>) => void;

  // Completed-event inline editing
  editingCompletedId: number | null;
  setEditingCompletedId: (id: number | null) => void;
  completedEdit: any;
  setCompletedEdit: (edit: any) => void;

  // Helpers used by external effects (e.g. the initialEventId auto-open
  // logic) so they can open the details dialog without depending on the
  // mega-context.
  openEventDetails: (event: EventRequest, options?: { isEditing?: boolean }) => void;
}

const EventDialogContext = createContext<EventDialogContextType | null>(null);

export const useEventDialogState = (): EventDialogContextType => {
  const ctx = useContext(EventDialogContext);
  if (!ctx) {
    throw new Error('useEventDialogState must be used within EventDialogProvider');
  }
  return ctx;
};

export const EventDialogProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // Selected event for the main details dialog
  const [selectedEventRequest, setSelectedEventRequest] = useState<EventRequest | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Which dialog is open. One field replaces the old 23 boolean flags.
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('none');
  const openDialog = useCallback(
    (dialog: Exclude<ActiveDialog, 'none'>) => setActiveDialog(dialog),
    []
  );
  const closeDialog = useCallback(
    (only?: Exclude<ActiveDialog, 'none'>) =>
      setActiveDialog((prev) => (only && prev !== only ? prev : 'none')),
    []
  );

  // Per-dialog active event references
  const [schedulingEventRequest, setSchedulingEventRequest] = useState<EventRequest | null>(null);
  const [toolkitEventRequest, setToolkitEventRequest] = useState<EventRequest | null>(null);
  const [collectionLogEventRequest, setCollectionLogEventRequest] = useState<EventRequest | null>(null);
  const [contactEventRequest, setContactEventRequest] = useState<EventRequest | null>(null);
  const [tspContactEventRequest, setTspContactEventRequest] = useState<EventRequest | null>(null);
  const [logContactEventRequest, setLogContactEventRequest] = useState<EventRequest | null>(null);
  const [editContactEventRequest, setEditContactEventRequest] = useState<EventRequest | null>(null);
  const [editContactAttemptData, setEditContactAttemptData] = useState<any | null>(null);
  const [aiSuggestionEventRequest, setAiSuggestionEventRequest] = useState<EventRequest | null>(null);
  const [aiIntakeAssistantEventRequest, setAiIntakeAssistantEventRequest] = useState<EventRequest | null>(null);
  const [intakeCallEventRequest, setIntakeCallEventRequest] = useState<EventRequest | null>(null);
  const [reasonDialogEventRequest, setReasonDialogEventRequest] = useState<EventRequest | null>(null);
  const [nonEventDialogEventRequest, setNonEventDialogEventRequest] = useState<EventRequest | null>(null);
  const [rescheduleDialogEventRequest, setRescheduleDialogEventRequest] = useState<EventRequest | null>(null);
  const [nextActionEventRequest, setNextActionEventRequest] = useState<EventRequest | null>(null);
  const [nextActionMode, setNextActionMode] = useState<'add' | 'edit' | 'complete'>('add');

  // Assignment dialog state
  const [assignmentType, setAssignmentType] = useState<'driver' | 'volunteer' | null>(null);
  const [assignmentEventId, setAssignmentEventId] = useState<number | null>(null);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [isEditingAssignment, setIsEditingAssignment] = useState(false);
  const [editingAssignmentPersonId, setEditingAssignmentPersonId] = useState<string | null>(null);
  const [isVanDriverAssignment, setIsVanDriverAssignment] = useState(false);
  const [customPersonData, setCustomPersonData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    vanCapable: false,
  });

  // Schedule-call & follow-up
  const [scheduleCallDate, setScheduleCallDate] = useState('');
  const [scheduleCallTime, setScheduleCallTime] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');

  // Inline editing
  const [editingScheduledId, setEditingScheduledId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // Sandwich-count editing
  const [modalSandwichMode, setModalSandwichMode] = useState<'total' | 'types'>('total');
  const [modalTotalCount, setModalTotalCount] = useState(0);
  const [modalSandwichTypes, setModalSandwichTypes] = useState<Array<{ type: string; quantity: number }>>([]);

  // Completed-event editing
  const [editingCompletedId, setEditingCompletedId] = useState<number | null>(null);
  const [completedEdit, setCompletedEdit] = useState<any>({});

  // Composite helper used by initialEventId auto-open and similar flows.
  // Stable identity (useCallback) so effects depending on it don't re-fire.
  const openEventDetails = useCallback(
    (event: EventRequest, options?: { isEditing?: boolean }) => {
      setSelectedEventRequest(event);
      setIsEditing(!!options?.isEditing);
      setActiveDialog('eventDetails');
    },
    []
  );

  const value: EventDialogContextType = useMemo(
    () => ({
      // Selected event
      selectedEventRequest,
      setSelectedEventRequest,
      isEditing,
      setIsEditing,

      // Dialog visibility (single source of truth)
      activeDialog,
      setActiveDialog,
      openDialog,
      closeDialog,

      // Active event references
      schedulingEventRequest,
      setSchedulingEventRequest,
      toolkitEventRequest,
      setToolkitEventRequest,
      collectionLogEventRequest,
      setCollectionLogEventRequest,
      contactEventRequest,
      setContactEventRequest,
      tspContactEventRequest,
      setTspContactEventRequest,
      logContactEventRequest,
      setLogContactEventRequest,
      editContactEventRequest,
      setEditContactEventRequest,
      editContactAttemptData,
      setEditContactAttemptData,
      aiSuggestionEventRequest,
      setAiSuggestionEventRequest,
      aiIntakeAssistantEventRequest,
      setAiIntakeAssistantEventRequest,
      intakeCallEventRequest,
      setIntakeCallEventRequest,
      reasonDialogEventRequest,
      setReasonDialogEventRequest,
      nonEventDialogEventRequest,
      setNonEventDialogEventRequest,
      rescheduleDialogEventRequest,
      setRescheduleDialogEventRequest,
      nextActionEventRequest,
      setNextActionEventRequest,
      nextActionMode,
      setNextActionMode,

      // Assignment dialog
      assignmentType,
      setAssignmentType,
      assignmentEventId,
      setAssignmentEventId,
      selectedAssignees,
      setSelectedAssignees,
      isEditingAssignment,
      setIsEditingAssignment,
      editingAssignmentPersonId,
      setEditingAssignmentPersonId,
      isVanDriverAssignment,
      setIsVanDriverAssignment,
      customPersonData,
      setCustomPersonData,

      // Schedule-call & follow-up
      scheduleCallDate,
      setScheduleCallDate,
      scheduleCallTime,
      setScheduleCallTime,
      followUpNotes,
      setFollowUpNotes,

      // Inline editing
      editingScheduledId,
      setEditingScheduledId,
      editingField,
      setEditingField,
      editingValue,
      setEditingValue,

      // Sandwich editing
      modalSandwichMode,
      setModalSandwichMode,
      modalTotalCount,
      setModalTotalCount,
      modalSandwichTypes,
      setModalSandwichTypes,

      // Completed-event editing
      editingCompletedId,
      setEditingCompletedId,
      completedEdit,
      setCompletedEdit,

      // Composite helper
      openEventDetails,
    }),
    [
      selectedEventRequest, isEditing,
      activeDialog, openDialog, closeDialog,
      schedulingEventRequest, toolkitEventRequest, collectionLogEventRequest,
      contactEventRequest, tspContactEventRequest, logContactEventRequest,
      editContactEventRequest, editContactAttemptData, aiSuggestionEventRequest,
      aiIntakeAssistantEventRequest, intakeCallEventRequest,
      reasonDialogEventRequest, nonEventDialogEventRequest, rescheduleDialogEventRequest,
      nextActionEventRequest, nextActionMode,
      assignmentType, assignmentEventId, selectedAssignees, isEditingAssignment,
      editingAssignmentPersonId, isVanDriverAssignment, customPersonData,
      scheduleCallDate, scheduleCallTime, followUpNotes,
      editingScheduledId, editingField, editingValue,
      modalSandwichMode, modalTotalCount, modalSandwichTypes,
      editingCompletedId, completedEdit,
      openEventDetails,
    ]
  );

  return (
    <EventDialogContext.Provider value={value}>
      {children}
    </EventDialogContext.Provider>
  );
};
