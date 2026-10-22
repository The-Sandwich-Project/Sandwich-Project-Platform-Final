import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Phone,
  CheckCircle2,
  Circle,
  AlertCircle,
  MapPin,
  Calendar,
  Users,
  Package,
  Refrigerator,
  UtensilsCrossed,
  Car,
  UserCheck,
  FileText,
  Clock,
  ExternalLink,
  AlertTriangle,
  Check,
} from 'lucide-react';
import type { EventRequest } from '@shared/schema';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import {
  parseDateOnly,
  toDateOnlyString,
  formatDateShort,
} from '@shared/date-utils';
import {
  useDraftPersistence,
  loadDraft,
  clearDraft,
  formatDraftTimestamp,
} from '@/hooks/useDraftPersistence';
import { EventConflictWarnings, useEventConflicts } from './EventConflictWarnings';
import { getTrafficConflict } from '@shared/traffic-conflicts';
import { buildAttendancePatch } from './form-utils';

interface IntakeDraftData {
  checkedItems: string[];
  itemAnswers: Record<string, string>;
  callNotes: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

interface IntakeCallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequest: EventRequest | null;
}

interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  required?: boolean;
  notes?: string;
}

const OPERATING_AREAS = [
  'Dunwoody',
  'Sandy Springs',
  'Intown (generally not South Atlanta)',
  'Buckhead',
  'Peachtree Corners',
  'Alpharetta',
  'Milton',
  'Marietta',
  'Roswell',
];

// Extract the first integer from an operator's free-text answer.
// Handles common formats: "750", "around 200", "750ish", "1,200" (US-style
// thousands), "approximately 1000", "200-300" (first number only).
//
// Space-separated thousands ("1 200") are deliberately not handled — doing so
// would also turn two distinct space-separated numbers ("200 300") into
// 200300, which would silently corrupt counts. With the comma-only rule, the
// rare "1 200" input parses as 1, which is obviously wrong on the toast.
function parseNumberFromText(text: string): number | null {
  // Try thousands-formatted number first (e.g. "1,200" or "1,200,000").
  const formatted = text.match(/\d{1,3}(?:,\d{3})+/);
  if (formatted) {
    const n = parseInt(formatted[0].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) return n;
  }
  // Fall back to a plain run of digits.
  const plain = text.match(/\d+/);
  if (!plain) return null;
  const n = parseInt(plain[0], 10);
  return Number.isFinite(n) ? n : null;
}

// Convert a native date-input value (YYYY-MM-DD) into a friendlier display
// string for the planningNotes summary block. Uses the shared date utility
// so we render consistently with the rest of the app (Eastern Time).
function formatIsoDateForNotes(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return formatDateShort(dateStr);
}

// Friendlier display for itemAnswers values when summarizing into planningNotes.
function formatItemAnswerForNotes(itemId: string, value: string): string {
  if (itemId === 'event_date') return formatIsoDateForNotes(value);
  if (itemId === 'refrigeration') {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (itemId === 'is_corporate_event') {
    return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value;
  }
  return value;
}

interface StructuredIntakeResult {
  updates: Record<string, unknown>;
  // Per-field mapping result for surfacing in the success toast.
  mapped: Array<{ itemId: string; column: string; display: string }>;
  // Items the operator filled in but we couldn't parse — fall back to
  // planningNotes; warn the user so they know structured data was missed.
  unparseable: Array<{ itemId: string; rawValue: string }>;
}

// Parse the structured intake fields out of itemAnswers and build a partial
// update payload of typed column values. Items that don't parse cleanly are
// surfaced separately so the user can be warned in the toast rather than
// having the data silently dropped.
function buildStructuredUpdates(
  itemAnswers: Record<string, string>,
  existingOrgCategory: string | null
): StructuredIntakeResult {
  const updates: Record<string, unknown> = {};
  const mapped: StructuredIntakeResult['mapped'] = [];
  const unparseable: StructuredIntakeResult['unparseable'] = [];

  // event_date — native date input gives YYYY-MM-DD.
  // Always writes to desiredEventDate; the audit log preserves any prior
  // value so the original requested date is recoverable from history.
  //
  // We send the bare YYYY-MM-DD string (not a full ISO timestamp) so the
  // server's parseDateOnly does the timezone-safe conversion in one place
  // — that matches how the rest of the codebase serializes date-only
  // fields and avoids a client→ISO→server round-trip that could reintroduce
  // drift. parseDateOnly is still called client-side just to validate.
  const dateValue = itemAnswers.event_date?.trim();
  const dateUndecided = itemAnswers.event_date_undecided === 'true';
  if (dateUndecided) {
    // Operator marked the date as not decided yet. Clear the existing
    // desiredEventDate column so downstream views don't keep showing a
    // stale date the group has walked back from. The potential-dates
    // note rides along in planningNotes via the summary block below.
    updates.desiredEventDate = null;
    mapped.push({
      itemId: 'event_date',
      column: 'desired event date',
      display: 'Not decided yet (cleared)',
    });
  } else if (dateValue) {
    if (parseDateOnly(dateValue)) {
      updates.desiredEventDate = dateValue;
      mapped.push({
        itemId: 'event_date',
        column: 'desired event date',
        display: formatIsoDateForNotes(dateValue),
      });
    } else {
      unparseable.push({ itemId: 'event_date', rawValue: dateValue });
    }
  }

  // sandwich_count — free text → integer.
  const sandwichValue = itemAnswers.sandwich_count?.trim();
  if (sandwichValue) {
    const n = parseNumberFromText(sandwichValue);
    if (n !== null) {
      updates.estimatedSandwichCount = n;
      mapped.push({
        itemId: 'sandwich_count',
        column: 'estimated sandwich count',
        display: String(n),
      });
    } else {
      unparseable.push({ itemId: 'sandwich_count', rawValue: sandwichValue });
    }
  }

  // participant_count — free text → integer.
  const participantValue = itemAnswers.participant_count?.trim();
  if (participantValue) {
    const n = parseNumberFromText(participantValue);
    if (n !== null) {
      // Keeps the legacy volunteerCount mirror in step with the estimate.
      Object.assign(updates, buildAttendancePatch(n));
      mapped.push({
        itemId: 'participant_count',
        column: 'estimated attendance',
        display: String(n),
      });
    } else {
      unparseable.push({
        itemId: 'participant_count',
        rawValue: participantValue,
      });
    }
  }

  // how_heard — Select with one of the predefined values (or null).
  // Notes field is captured separately and always mapped if non-empty.
  const howHeardValue = itemAnswers.how_heard?.trim();
  if (howHeardValue) {
    const HOW_HEARD_LABELS: Record<string, string> = {
      previous_event: 'Previous event',
      friend_family: 'Friend or family',
      internet_search: 'Internet search',
      other: 'Other',
    };
    if (HOW_HEARD_LABELS[howHeardValue]) {
      updates.howHeardAboutUs = howHeardValue;
      mapped.push({
        itemId: 'how_heard',
        column: 'how heard about us',
        display: HOW_HEARD_LABELS[howHeardValue],
      });
    }
  }
  const howHeardNotesValue = itemAnswers.how_heard_notes?.trim();
  if (howHeardNotesValue) {
    updates.howHeardAboutUsNotes = howHeardNotesValue;
    // No `mapped` entry — notes ride along quietly; the dropdown is the
    // searchable/reportable column.
  }

  // refrigeration_status — multi-option Select. Maps to the boolean
  // hasRefrigeration column; the specific "why" (van needed / exemption /
  // must make more) is captured in planningNotes + Next Action by the
  // save handler, not here.
  const refrigValue = itemAnswers.refrigeration_status?.trim();
  if (refrigValue === 'yes') {
    updates.hasRefrigeration = true;
    mapped.push({
      itemId: 'refrigeration_status',
      column: 'has refrigeration',
      display: 'Yes',
    });
  } else if (
    refrigValue === 'no_make_more_or_pbj' ||
    refrigValue === 'no_van_needed' ||
    refrigValue === 'special_exemption'
  ) {
    updates.hasRefrigeration = false;
    const label =
      refrigValue === 'no_van_needed'
        ? 'No — van needed'
        : refrigValue === 'special_exemption'
        ? 'No — special exemption requested'
        : 'No — must make more or switch to PBJ';
    mapped.push({
      itemId: 'refrigeration_status',
      column: 'has refrigeration',
      display: label,
    });
  }

  // is_corporate_event — only writes to organizationCategory when the
  // column is currently null/empty (fills in unknowns; never overwrites
  // a specific category the team has already set). A clear "Yes" against
  // an existing non-corp category is flagged as unparseable so the
  // operator knows the column wasn't touched.
  const existing = (existingOrgCategory || '').toLowerCase();
  const isExistingCorp =
    existing === 'corp' ||
    existing === 'small_medium_corp' ||
    existing === 'large_corp';
  const corpAnswer = itemAnswers.is_corporate_event?.trim().toLowerCase();
  if (corpAnswer === 'yes') {
    if (!existing) {
      updates.organizationCategory = 'corp';
      mapped.push({
        itemId: 'is_corporate_event',
        column: 'organization category',
        display: 'Corporate',
      });
    } else if (!isExistingCorp) {
      // Operator says Yes but column already says school/church/nonprofit/etc.
      // Don't silently overwrite — flag it so the team can review.
      unparseable.push({
        itemId: 'is_corporate_event',
        rawValue: `Yes (existing category "${existingOrgCategory}" preserved)`,
      });
    }
  } else if (corpAnswer === 'no' && isExistingCorp) {
    // Clear a corp category when the operator says it's not corporate.
    updates.organizationCategory = null;
    mapped.push({
      itemId: 'is_corporate_event',
      column: 'organization category',
      display: 'No (cleared corp category)',
    });
  }

  return { updates, mapped, unparseable };
}

const IntakeCallDialog: React.FC<IntakeCallDialogProps> = ({
  isOpen,
  onClose,
  eventRequest,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [itemAnswers, setItemAnswers] = useState<Record<string, string>>({});
  const [callNotes, setCallNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Contact person info - auto-filled from event request, editable during call
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // Whether the operator is currently editing/replacing the address. When the
  // dialog opens with an existing address we show it as a confirm-or-change
  // card; clicking "Change" flips this to true and exposes the input. If
  // there's no address on file, we start in editing mode.
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  // Draft persistence: per-event key, autosave to localStorage with debounce.
  // Suspended until the user actually interacts so we don't overwrite a saved
  // draft with the initial form state when the dialog mounts.
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [pendingRestoreDraft, setPendingRestoreDraft] = useState<
    | { savedAt: string; data: IntakeDraftData }
    | null
  >(null);

  const draftKey = eventRequest ? `intake:${eventRequest.id}` : null;
  const draftData: IntakeDraftData = {
    checkedItems: Array.from(checkedItems),
    itemAnswers,
    callNotes,
    contactName,
    contactPhone,
    contactEmail,
  };
  const { savedAt: draftSavedAt } = useDraftPersistence<IntakeDraftData>({
    key: draftKey,
    data: draftData,
    // Suspend autosave while the restore banner is up so typing into the
    // pre-populated form doesn't overwrite the existing localStorage draft
    // before the user has a chance to click Restore.
    enabled: isOpen && hasUserInteracted && !pendingRestoreDraft,
    version: eventRequest?.updatedAt ?? null,
    debounceMs: 500,
  });

  // Wrap the state setters so any user action flips hasUserInteracted on,
  // which is what gates the autosave effect above.
  const markInteracted = () => {
    if (!hasUserInteracted) setHasUserInteracted(true);
  };

  // Live conflict check on whatever event_date is currently in the form.
  // We pass the bare YYYY-MM-DD string; the conflict endpoint accepts ISO or
  // date-only. We exclude the current event id so it doesn't conflict with
  // itself if its own date hasn't changed.
  const conflictDate = itemAnswers.event_date?.trim() || null;
  const { data: conflicts } = useEventConflicts({
    eventId: eventRequest?.id,
    scheduledEventDate: conflictDate,
    organizationName: eventRequest?.organizationName ?? null,
    enabled: !!conflictDate,
  });

  // Atlanta World Cup match conflict on the requested date.
  const trafficConflict = conflictDate ? getTrafficConflict(conflictDate) : null;

  // Auto-check the "Event Times" required item whenever any of the three
  // sub-fields has a value. The sub-fields are stored under their own keys
  // (event_start_time / event_end_time / event_pickup_time) so handleAnswerChange's
  // auto-toggle doesn't see the parent — we drive it from this effect instead.
  const anyEventTimeFilled =
    !!itemAnswers.event_start_time?.trim() ||
    !!itemAnswers.event_end_time?.trim() ||
    !!itemAnswers.event_pickup_time?.trim();
  useEffect(() => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (anyEventTimeFilled) {
        if (next.has('event_times')) return prev;
        next.add('event_times');
      } else {
        if (!next.has('event_times')) return prev;
        next.delete('event_times');
      }
      return next;
    });
  }, [anyEventTimeFilled]);

  // Mark event_date as complete when the operator selects "Not decided yet"
  // — the field is required but has no value in that mode. The handleAnswerChange
  // auto-mark on event_date covers the specific-date case; this covers undecided.
  const eventDateUndecided = itemAnswers.event_date_undecided === 'true';
  useEffect(() => {
    if (!eventDateUndecided) return;
    setCheckedItems((prev) => {
      if (prev.has('event_date')) return prev;
      const next = new Set(prev);
      next.add('event_date');
      return next;
    });
  }, [eventDateUndecided]);

  // Corporate-event answer. Drives whether the corporate follow-up questions
  // (participant count, additional volunteers) are shown and the dynamic
  // guidance text next to each.
  const isCorporateEvent = itemAnswers.is_corporate_event === 'yes';

  // Sandwich-count gating: the form's later sections behave differently
  // depending on the count entered in the Sandwich Logistics section.
  //
  // - under 200: not eligible as a group event. The remainder of the form
  //   is grayed out unless the operator types a free-text override note
  //   explaining why they're proceeding (and confirming they cleared it
  //   with Marcy/Christine). The override note also seeds a follow-up
  //   to-do on save.
  // - 200–499: normal flow, no van offer.
  // - 500+: van offer becomes available in the refrigeration question.
  const sandwichCountNum = (() => {
    const raw = itemAnswers.sandwich_count?.trim();
    if (!raw) return null;
    const n = parseNumberFromText(raw);
    return n;
  })();
  const isUnder200 = sandwichCountNum !== null && sandwichCountNum < 200;
  const isUnder500 = sandwichCountNum !== null && sandwichCountNum < 500;
  const has200OverrideNote =
    !!itemAnswers.under_200_override_note?.trim();
  const formGatedByLowCount = isUnder200 && !has200OverrideNote;

  // Sandwich types are stored comma-separated in itemAnswers.sandwich_types
  // for round-tripping through the rest of the form's plain-text answers
  // model. Parse to a Set for easy membership checks.
  const selectedTypes = new Set(
    (itemAnswers.sandwich_types || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );
  const hasNonPbjType =
    selectedTypes.has('turkey') ||
    selectedTypes.has('chicken') ||
    selectedTypes.has('ham') ||
    selectedTypes.has('deli_tbd');
  const isPbjOnly = selectedTypes.has('pbj') && !hasNonPbjType;

  // Auto-check the parent sandwich_types row when any type is selected.
  useEffect(() => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (selectedTypes.size > 0) {
        if (next.has('sandwich_types')) return prev;
        next.add('sandwich_types');
      } else {
        if (!next.has('sandwich_types')) return prev;
        next.delete('sandwich_types');
      }
      return next;
    });
  }, [selectedTypes.size]);

  // Consult-Christine-&-Marcy flag: World Cup match, or any high-volume
  // day/week warning from the conflict endpoint. Anything else (regular van
  // / driver conflicts) is shown as a warning but doesn't trigger
  // the consult prompt — that's reserved for capacity/scheduling sanity.
  const highVolumeWarnings = (conflicts?.warnings || []).filter(
    (w) => w.type === 'high_volume_day' || w.type === 'high_volume_week'
  );
  const shouldConsultTeam = !!trafficConflict || highVolumeWarnings.length > 0;

  // Shared "load the event's current values into form state" routine, used
  // by the open-dialog effect and by discardPendingDraft.
  const populateFromEventRequest = useCallback((req: EventRequest) => {
    const fullName = `${req.firstName || ''} ${req.lastName || ''}`.trim();
    setContactName(fullName);
    setContactPhone(req.phone || '');
    setContactEmail(req.email || '');

    const initialAnswers: Record<string, string> = {};
    const initialChecked = new Set<string>();
    if (fullName) {
      initialAnswers.contact_name = fullName;
      initialChecked.add('contact_name');
    }
    if (req.phone) {
      initialAnswers.contact_phone = req.phone;
      initialChecked.add('contact_phone');
    }
    if (req.email) {
      initialAnswers.contact_email = req.email;
      initialChecked.add('contact_email');
    }

    // Pre-fill the structured checklist items from existing event data so
    // the operator sees what we already know and only re-types if it changed.
    // Uses shared toDateOnlyString so the pre-fill matches the convention
    // used everywhere else in the app (and any future fixes to timezone
    // handling apply automatically rather than needing patches here too).
    if (req.desiredEventDate) {
      const dateStr = toDateOnlyString(req.desiredEventDate);
      if (dateStr) {
        initialAnswers.event_date = dateStr;
        initialChecked.add('event_date');
      }
    }
    if (req.estimatedSandwichCount != null) {
      initialAnswers.sandwich_count = String(req.estimatedSandwichCount);
      initialChecked.add('sandwich_count');
    }
    if (req.estimatedAttendance != null) {
      initialAnswers.participant_count = String(req.estimatedAttendance);
      initialChecked.add('participant_count');
    }
    if (req.hasRefrigeration === true) {
      initialAnswers.refrigeration_status = 'yes';
      initialChecked.add('refrigeration_status');
    }
    // Don't pre-fill a specific "no" sub-option — the operator picks the
    // correct one based on the count + type combination on this call.
    if (req.eventAddress) {
      initialAnswers.event_address = req.eventAddress;
      initialChecked.add('event_address');
      setIsEditingAddress(false);
    } else {
      setIsEditingAddress(true);
    }
    // Event Times — three sub-fields stored under a single "event_times"
    // logical row in the checklist. We mark the parent checked as soon as
    // any of the three has a value (mirrors the auto-check rule used for
    // other items via handleAnswerChange).
    if (req.eventStartTime) {
      initialAnswers.event_start_time = req.eventStartTime;
      initialChecked.add('event_times');
    }
    if (req.eventEndTime) {
      initialAnswers.event_end_time = req.eventEndTime;
      initialChecked.add('event_times');
    }
    if (req.pickupTime) {
      initialAnswers.event_pickup_time = req.pickupTime;
      initialChecked.add('event_times');
    }
    if ((req as any).howHeardAboutUs) {
      initialAnswers.how_heard = (req as any).howHeardAboutUs;
      initialChecked.add('how_heard');
    }
    if ((req as any).howHeardAboutUsNotes) {
      initialAnswers.how_heard_notes = (req as any).howHeardAboutUsNotes;
    }
    // Pre-fill the corporate-event answer from organizationCategory. Any
    // of the corp-flavored categories (corp / small_medium_corp / large_corp)
    // counts as Yes. Other known categories (school, church, nonprofit, etc.)
    // count as No. Null/unknown stays blank so the operator picks fresh.
    const orgCat = (req.organizationCategory || '').toLowerCase();
    if (orgCat === 'corp' || orgCat === 'small_medium_corp' || orgCat === 'large_corp') {
      initialAnswers.is_corporate_event = 'yes';
      initialChecked.add('is_corporate_event');
    } else if (orgCat) {
      initialAnswers.is_corporate_event = 'no';
      initialChecked.add('is_corporate_event');
    }

    setItemAnswers(initialAnswers);
    setCheckedItems(initialChecked);
    setCallNotes('');
  }, []);

  // Initialize contact info from event request when dialog opens.
  // If a draft exists for this event, surface a restore banner. Autosave
  // is gated by hasUserInteracted, so a draft only exists when the user
  // actually changed something — including contact-field corrections,
  // which are part of the saved payload and must not be silently dropped.
  useEffect(() => {
    if (!isOpen || !eventRequest) return;

    const existingDraft = loadDraft<IntakeDraftData>(`intake:${eventRequest.id}`);
    if (existingDraft) {
      setPendingRestoreDraft({
        savedAt: existingDraft.savedAt,
        data: existingDraft.data,
      });
      // Pre-populate from the event so the dialog body has content while
      // the user decides. If they restore, those values get overwritten;
      // if they discard, the pre-fill stays.
      populateFromEventRequest(eventRequest);
      setHasUserInteracted(false);
      return;
    }

    populateFromEventRequest(eventRequest);
    setHasUserInteracted(false);
  }, [isOpen, eventRequest, populateFromEventRequest]);

  const restorePendingDraft = () => {
    if (!pendingRestoreDraft) return;
    const d = pendingRestoreDraft.data;
    setCheckedItems(new Set(d.checkedItems || []));
    setItemAnswers(d.itemAnswers || {});
    setCallNotes(d.callNotes || '');
    setContactName(d.contactName || '');
    setContactPhone(d.contactPhone || '');
    setContactEmail(d.contactEmail || '');
    setPendingRestoreDraft(null);
    // Treat the restored content as already-interacted so autosave resumes
    // immediately and keeps the draft fresh.
    setHasUserInteracted(true);
  };

  const discardPendingDraft = () => {
    if (!eventRequest) return;
    clearDraft(`intake:${eventRequest.id}`);
    setPendingRestoreDraft(null);
    populateFromEventRequest(eventRequest);
    setHasUserInteracted(false);
  };

  const toggleItem = (itemId: string) => {
    markInteracted();
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleCall = () => {
    if (!eventRequest?.phone) return;

    if (isMobile) {
      window.location.href = `tel:${eventRequest?.phone}`;
    } else {
      navigator.clipboard.writeText(eventRequest?.phone || '').then(() => {
        window.alert(`Phone number copied!\n${eventRequest?.phone} has been copied to your clipboard.`);
      });
    }
  };

  const handleAnswerChange = (itemId: string, answer: string) => {
    markInteracted();
    setItemAnswers((prev) => {
      const next = {
        ...prev,
        [itemId]: answer,
      };

      if (itemId === 'is_corporate_event' && answer !== 'yes') {
        next.participant_count = '';
        next.additional_volunteers = '';
      }

      return next;
    });
    
    // Automatically check the item when text is entered
    if (answer.trim() && !checkedItems.has(itemId)) {
      setCheckedItems((prev) => new Set(prev).add(itemId));
    }
    // Uncheck if answer is cleared
    if (!answer.trim() && checkedItems.has(itemId)) {
      setCheckedItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  // Move-to-Non-Event exit path for under-200 requests. Patches the event's
  // status, clears any autosaved intake draft, and closes the dialog. Does
  // NOT save the partial intake notes — the operator already has the host
  // finder in their hand and we don't want to mix a partial draft into
  // planningNotes for a non-event.
  const handleMoveToNonEvent = async () => {
    if (!eventRequest) return;
    try {
      const updated = await apiRequest('PATCH', `/api/event-requests/${eventRequest.id}`, {
        status: 'non_event',
        nonEventReason: 'Sandwich count under 200 — directed to host finder.',
        nonEventAt: new Date().toISOString(),
      });
      await applyPatchResponseToCache(queryClient, updated, {
        previousStatus: eventRequest.status,
        statusChanged: true,
      });
      clearDraft(`intake:${eventRequest.id}`);
      toast({
        title: 'Moved to Non-Event',
        description: 'The request was marked as Non-Event. Directed the organizer to the host finder.',
      });
      // NOTE: do not set status to in_process here — this path must stay non_event.
      onClose();
    } catch (error: any) {
      toast({
        title: 'Failed to move to Non-Event',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const saveIntakeCall = async ({
    markCallComplete,
  }: {
    markCallComplete: boolean;
  }) => {
    if (!eventRequest || isSaving) {
      return;
    }

    // (Speaker role retired: the former corporate-event requirement — that a
    // speaker or volunteer be filled in before completing the call — has been
    // dropped entirely. Corporate events can now be completed without it.)

    setIsSaving(true);

    try {
      const nowLabel = new Date().toLocaleString();
      const summaryTitle = markCallComplete
        ? `Intake call completed: ${nowLabel}`
        : `Intake call notes saved: ${nowLabel}`;
      const answeredItems = checklistItems.filter((item) => {
        // event_times is a virtual parent — show it in the summary when any
        // of the three sub-fields is filled.
        if (item.id === 'event_times') {
          return (
            !!itemAnswers.event_start_time?.trim() ||
            !!itemAnswers.event_end_time?.trim() ||
            !!itemAnswers.event_pickup_time?.trim()
          );
        }
        // Checkbox-only items are included in the saved summary when ticked.
        if (CONFIRMATION_ITEM_IDS.has(item.id)) {
          return checkedItems.has(item.id);
        }
        // Sandwich types — show when at least one type is selected.
        if (item.id === 'sandwich_types') {
          return (itemAnswers.sandwich_types || '').trim().length > 0;
        }
        // event_date — also show when operator chose "not decided yet"
        // (so the potential-dates note isn't dropped).
        if (item.id === 'event_date') {
          return (
            !!itemAnswers.event_date?.trim() ||
            itemAnswers.event_date_undecided === 'true'
          );
        }
        const value = itemAnswers[item.id];
        return value && value.trim().length > 0;
      });

      const renderItemForNotes = (item: ChecklistItem): string => {
        if (item.id === 'event_times') {
          const parts: string[] = [];
          if (itemAnswers.event_start_time?.trim()) parts.push(`start ${itemAnswers.event_start_time.trim()}`);
          if (itemAnswers.event_end_time?.trim()) parts.push(`end ${itemAnswers.event_end_time.trim()}`);
          if (itemAnswers.event_pickup_time?.trim()) parts.push(`pickup ${itemAnswers.event_pickup_time.trim()}`);
          return `- ${item.label}: ${parts.join(', ')}`;
        }
        if (item.id === 'outside_operating_area') {
          return `- ${item.label}: YES (flagged for leadership review)`;
        }
        if (item.id === 'young_children_pbj') {
          return `- ${item.label}: YES (flagged for leadership exception)`;
        }
        if (item.id === 'pbj_spatulas_mentioned') {
          return `- ${item.label}: Yes (mentioned toolkit link)`;
        }
        if (item.id === 'assembly_reviewed') {
          return `- ${item.label}: Yes (assembly + food-safety walked through)`;
        }
        if (CONFIRMATION_ITEM_IDS.has(item.id)) {
          return `- ${item.label}: Yes`;
        }
        if (item.id === 'sandwich_types') {
          const LABELS: Record<string, string> = {
            turkey: 'Turkey',
            chicken: 'Chicken',
            ham: 'Ham',
            pbj: 'PBJ',
            deli_tbd: 'Deli (TBD)',
          };
          const list = (itemAnswers.sandwich_types || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => LABELS[t] || t)
            .join(', ');
          return `- ${item.label}: ${list}`;
        }
        if (item.id === 'event_date' && itemAnswers.event_date_undecided === 'true') {
          const note = itemAnswers.event_date_undecided_note?.trim();
          return note
            ? `- ${item.label}: NOT DECIDED YET — ${note}`
            : `- ${item.label}: NOT DECIDED YET`;
        }
        return `- ${item.label}: ${formatItemAnswerForNotes(item.id, itemAnswers[item.id].trim())}`;
      };

      const summaryLines = [
        summaryTitle,
        `Contact: ${contactName || 'N/A'} | ${contactPhone || 'N/A'} | ${contactEmail || 'N/A'}`,
        ...answeredItems.map(renderItemForNotes),
      ];

      if (callNotes.trim()) {
        summaryLines.push(`Notes: ${callNotes.trim()}`);
      }

      const summaryBlock = summaryLines.join('\n');
      const existingNotes = eventRequest?.planningNotes || '';
      const updatedPlanningNotes = existingNotes
        ? `${existingNotes}\n\n${summaryBlock}`
        : summaryBlock;

      // Build structured updates first so they don't get overwritten by
      // the explicit contact/address mappings below if there's any overlap.
      const structured = buildStructuredUpdates(
        itemAnswers,
        eventRequest?.organizationCategory ?? null
      );
      const updates: Record<string, unknown> = {
        ...structured.updates,
        planningNotes: updatedPlanningNotes,
      };

      const trimmedContactName = contactName.trim();
      if (trimmedContactName) {
        const [firstName, ...rest] = trimmedContactName.split(' ');
        updates.firstName = firstName || null;
        updates.lastName = rest.length ? rest.join(' ') : null;
      }

      if (contactPhone.trim()) {
        updates.phone = contactPhone.trim();
      }

      if (contactEmail.trim()) {
        updates.email = contactEmail.trim();
      }

      if (itemAnswers.event_address?.trim()) {
        updates.eventAddress = itemAnswers.event_address.trim();
      }

      // Event Times — three free-text fields; save each non-empty one to its
      // own column. We don't write null/empty to avoid blowing away an
      // existing value when the operator leaves a field blank during a follow-up.
      if (itemAnswers.event_start_time?.trim()) {
        updates.eventStartTime = itemAnswers.event_start_time.trim();
      }
      if (itemAnswers.event_end_time?.trim()) {
        updates.eventEndTime = itemAnswers.event_end_time.trim();
      }
      if (itemAnswers.event_pickup_time?.trim()) {
        updates.pickupTime = itemAnswers.event_pickup_time.trim();
      }

      // Build any Next Action follow-ups raised by the intake call. Each
      // follow-up is its own block; multiple can be appended in one save.
      // We always append (never overwrite) so any prior next action is kept.
      const followUpBlocks: string[] = [];

      // (a) Scheduling conflicts — World Cup match or high-volume day/week.
      if (shouldConsultTeam) {
        const conflictLines: string[] = [];
        if (trafficConflict) {
          conflictLines.push(
            `• ${trafficConflict.label}${trafficConflict.detail ? ` — ${trafficConflict.detail}` : ''}${trafficConflict.kickoffEt ? ` (kickoff ${trafficConflict.kickoffEt})` : ''}`
          );
        }
        for (const w of highVolumeWarnings) {
          conflictLines.push(`• ${w.message}`);
        }
        followUpBlocks.push(
          ['Consult with Christine & Marcy about scheduling conflicts:', ...conflictLines].join('\n')
        );
      }

      // (b) Outside our typical operating areas — operator ticked the box.
      const isOutsideOperatingArea = checkedItems.has('outside_operating_area');
      if (isOutsideOperatingArea) {
        followUpBlocks.push(
          'Consult with Christine & Marcy about coordinating this event — outside our typical operating areas. Let the group know we will try to make it work but need leadership confirmation first.'
        );
      }

      // (c) Under-200 sandwich count — operator chose to proceed past the
      //     low-count gate by filling in an override note.
      const proceededWithUnder200 = isUnder200 && has200OverrideNote;
      if (proceededWithUnder200) {
        const overrideNote = itemAnswers.under_200_override_note?.trim() || '';
        followUpBlocks.push(
          `Run this under-200 event by Christine/Marcy.\nOperator override note: ${overrideNote}`
        );
      }

      // (d) Refrigeration status decisions — by tier.
      const refrigChoice = itemAnswers.refrigeration_status?.trim();
      const eventLocation = (itemAnswers.event_address?.trim() || eventRequest?.eventAddress || 'no address yet');
      const eventDateStr = itemAnswers.event_date?.trim() || (eventRequest?.scheduledEventDate ? new Date(eventRequest.scheduledEventDate).toLocaleDateString() : 'no date yet');
      const startTimeStr = itemAnswers.event_start_time?.trim() || eventRequest?.eventStartTime || 'time TBD';
      const sandwichCountStr = sandwichCountNum !== null ? String(sandwichCountNum) : 'count TBD';

      if (refrigChoice === 'no_van_needed') {
        // ≥500 + insufficient refrigeration → van offered. Flip the flag
        // and queue the team-consult to-do.
        updates.vanDriverNeeded = true;
        updates.vanNeededLikely = false;
        updates.vanNeededFor = 'refrigeration';
        followUpBlocks.push(
          [
            'Van needed for this event — confirm with Christine/Marcy before promising it to the group.',
            `• Location: ${eventLocation}`,
            `• Date: ${eventDateStr}`,
            `• Start time: ${startTimeStr}`,
            `• Sandwich count: ${sandwichCountStr}`,
            'Also check the calendar for other van-needed events on this date.',
          ].join('\n')
        );
      } else if (
        refrigChoice === 'yes' ||
        refrigChoice === 'no_make_more_or_pbj' ||
        refrigChoice === 'special_exemption'
      ) {
        // A later intake call can replace a refrigeration-derived van with
        // "has refrigeration" / "make more or PBJ" / exemption. Clear that
        // refrigeration-purpose van only — leave a transport-purpose van.
        const existingPurpose = (eventRequest as { vanNeededFor?: string | null } | undefined)
          ?.vanNeededFor;
        if (existingPurpose === 'refrigeration') {
          updates.vanDriverNeeded = false;
          updates.vanNeededLikely = false;
          updates.vanNeededFor = null;
        }
        if (refrigChoice === 'special_exemption') {
          followUpBlocks.push(
            `Refrigeration special-exemption request — confirm with Christine/Marcy. Event ${eventLocation} on ${eventDateStr}, ${sandwichCountStr} sandwiches.`
          );
        }
      }

      // (e) Young children + PBJ — exception request.
      const isYoungChildrenPbj = checkedItems.has('young_children_pbj');
      if (isYoungChildrenPbj) {
        followUpBlocks.push(
          'PBJ + young children (school or under 13): confirm with Christine/Marcy whether we can grant an exception. Higher adult-to-child ratio improves the odds.'
        );
      }

      // Save the operator's sandwich-type selection in planningNotes
      // (not the structured sandwichTypes jsonb column — that one holds
      // {type, quantity} pairs and uses different canonical strings; the
      // detailed structured value is set later in the scheduling flow).
      // The summary block built above already includes this row, so no
      // extra work is needed here.

      if (followUpBlocks.length > 0) {
        const newActionBlock = followUpBlocks.join('\n\n');
        const existingNextAction = eventRequest?.nextAction?.trim() || '';
        updates.nextAction = existingNextAction
          ? `${existingNextAction}\n\n${newActionBlock}`
          : newActionBlock;
      }

      // Completing intake moves new requests into the normal workflow.
      if (markCallComplete && eventRequest.status === 'new') {
        updates.status = 'in_process';
      }

      const updated = await apiRequest('PATCH', `/api/event-requests/${eventRequest?.id}`, updates);

      await applyPatchResponseToCache(queryClient, updated, {
        previousStatus: eventRequest?.status,
        touchedFields: Object.keys(updates),
      });

      // Build a toast that tells the operator exactly which structured fields
      // got mapped to columns and which inputs couldn't be parsed (those still
      // live in planningNotes, but the operator should know they're not
      // searchable/reportable as structured data).
      const toastParts: string[] = ['Notes and contact updates saved.'];
      if (structured.mapped.length > 0) {
        toastParts.push(
          'Saved to event: ' +
            structured.mapped.map((m) => `${m.column} (${m.display})`).join(', ')
        );
      }
      if (followUpBlocks.length > 0) {
        const reasons: string[] = [];
        if (shouldConsultTeam) reasons.push('scheduling conflicts');
        if (isOutsideOperatingArea) reasons.push('event outside operating areas');
        if (proceededWithUnder200) reasons.push('under-200 sandwich count');
        if (refrigChoice === 'no_van_needed') reasons.push('van needed');
        if (refrigChoice === 'special_exemption') reasons.push('refrigeration exemption');
        if (isYoungChildrenPbj) reasons.push('young children + PBJ');
        toastParts.push(
          `Next Action added: consult with Christine & Marcy about ${reasons.join('; ')}.`
        );
      }
      const hasUnparseable = structured.unparseable.length > 0;
      if (hasUnparseable) {
        // Translate internal item ids back to the checklist labels the
        // operator actually sees on screen — "sandwich_count" reads as
        // jargon, "Number of sandwiches" is what they typed under.
        const labelById = new Map(
          checklistItems.map((item) => [item.id, item.label])
        );
        toastParts.push(
          "Couldn't parse: " +
            structured.unparseable
              .map((u) => labelById.get(u.itemId) ?? u.itemId)
              .join(', ') +
            ' — kept in notes only.'
        );
      }
      toast({
        title: hasUnparseable
          ? 'Intake notes saved (with warnings)'
          : markCallComplete
            ? 'Intake call saved'
            : 'Intake notes saved',
        description: toastParts.join(' '),
        variant: hasUnparseable ? 'destructive' : 'default',
        duration: hasUnparseable ? 12000 : 5000,
      });

      // Save succeeded — clear the autosaved draft for this event.
      clearDraft(`intake:${eventRequest?.id}`);

      setCheckedItems(new Set());
      setItemAnswers({});
      setCallNotes('');
      setContactName('');
      setContactPhone('');
      setContactEmail('');
      setHasUserInteracted(false);
      onClose();
    } catch (error: any) {
      toast({
        title: 'Save failed',
        description:
          error?.message ||
          'Unable to save intake call notes. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndClose = () => {
    void saveIntakeCall({ markCallComplete: false });
  };

  const handleComplete = () => {
    void saveIntakeCall({ markCallComplete: true });
  };

  if (!eventRequest) return null;

  const checklistItems: ChecklistItem[] = [
    // Contact Confirmation
    {
      id: 'contact_name',
      label: 'Contact person name',
      category: 'Contact Confirmation',
      required: true,
    },
    {
      id: 'contact_phone',
      label: 'Contact phone number',
      category: 'Contact Confirmation',
      required: true,
    },
    {
      id: 'contact_email',
      label: 'Contact email',
      category: 'Contact Confirmation',
      required: true,
    },

    // Event Basics
    {
      id: 'event_date',
      label: 'Event date',
      category: 'Event Basics',
      required: true,
      notes:
        "Pre-filled from the interest form. Change here if the group is going with a different date, or pick 'Not decided yet' if they're still figuring it out.",
    },
    // (Conflict warnings render inline below the event_date row — not a
    // separate checklist item.)
    // (Event Times live in Sandwich Logistics as a single
    // multi-field row — see `event_times` below.)

    {
      id: 'event_address',
      label: 'Event address',
      category: 'Event Basics',
      required: true,
    },
    {
      id: 'outside_operating_area',
      label: 'Event is outside our typical operating areas',
      category: 'Event Basics',
      notes:
        'If checked, a follow-up will be added to consult with Christine & Marcy. Let the group know we will try to make it work but need leadership confirmation first.',
    },

    // Sandwich Logistics
    {
      id: 'sandwich_count',
      label: 'How many sandwiches do they plan to make?',
      category: 'Sandwich Logistics',
      required: true,
      notes:
        '500+ opens the door to sending the van. Under 500: no van (generally). Under 200: not a group event — direct them to drop sandwiches at a host home on a Wednesday.',
    },
    {
      id: 'under_200_override_note',
      label: 'Reason for proceeding under 200',
      category: 'Sandwich Logistics',
      notes:
        'Required to continue when under 200. Explain why this is being approved (e.g. discussed with Marcy/Christine).',
    },
    {
      id: 'sandwich_types',
      label: 'Type of sandwiches',
      category: 'Sandwich Logistics',
      required: true,
      notes: 'Multi-select. Refrigeration questions depend on whether non-PBJ is involved.',
    },
    {
      id: 'is_corporate_event',
      label: 'Is this a corporate event?',
      category: 'Sandwich Logistics',
      required: true,
      notes:
        'A corporate event is one hosted by or at a company.',
    },
    {
      id: 'participant_count',
      label: 'Approximate number of people',
      category: 'Sandwich Logistics',
    },
    {
      id: 'additional_volunteers',
      label: 'Additional volunteers needed?',
      category: 'Sandwich Logistics',
    },
    {
      id: 'event_times',
      label: 'Event Times',
      category: 'Sandwich Logistics',
      required: true,
      notes: 'Start and End Times Are Ideal (Required if Volunteers are desired), Pickup Time required if they need a driver',
    },

    // Food Safety & Assembly
    {
      id: 'refrigeration_status',
      label: 'Sufficient refrigeration available?',
      category: 'Food Safety & Assembly',
      notes: 'Only relevant when a refrigerated sandwich (turkey / chicken / deli) is selected.',
    },
    {
      id: 'young_children_pbj',
      label: 'School or group of children under 13?',
      category: 'Food Safety & Assembly',
      notes:
        'PBJ-only: we generally do not let children under 13 make PBJ for safety/hygiene reasons. High adult-to-child ratio improves the odds of an exception.',
    },
    {
      id: 'pbj_spatulas_mentioned',
      label: 'Mentioned recommended PBJ spatulas (link in toolkit)',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'assembly_reviewed',
      label: 'Reviewed assembly + food-safety instructions with the group',
      category: 'Food Safety & Assembly',
      required: true,
    },
    {
      id: 'review_toolkit',
      label: 'Review toolkit (food safety, setup, supplies)',
      category: 'Food Safety & Assembly',
      required: true,
      notes: '• Food safety protocols\n• Setup requirements\n• Supplies needed\n• Tablecloths\n• Food-safe gloves',
    },
    {
      id: 'food_safe_gloves',
      label: 'Include food safe gloves, tablecloths, etc.',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'meat_cheese_refrigeration',
      label: 'Meat and cheese must be refrigerated until used',
      category: 'Food Safety & Assembly',
      notes: 'Only take out what is needed. Once made and packed back into bread bag, put back in fridge',
    },
    {
      id: 'discuss_shopping',
      label: 'Discuss shopping: coolers, deli meat & cheese storage, bread',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'transport_meat_cheese',
      label: 'When transporting: meat/cheese on ice packs in cooler',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'buying_supplies',
      label: 'Meat/cheese bought just before event, remain unopened until making',
      category: 'Food Safety & Assembly',
      notes: 'One person who reviewed food safety protocols should buy supplies. Others should not bring ingredients',
    },
    {
      id: 'cooling_sandwiches',
      label: 'Last sandwiches in freezer to cool OR pickup 30+ min after making',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'discuss_process',
      label: 'Discuss how groups make sandwiches',
      category: 'Food Safety & Assembly',
      notes: 'Have them open PDF: Two slices bread, two slices cheese, two to three slices turkey',
    },
    {
      id: 'assembly_line',
      label: 'Discuss teams making sandwiches in assembly line',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'runner_role',
      label: 'Discuss having a runner (gets meat/cheese out, puts sandwiches back)',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'typical_rules',
      label: 'Discuss typical event rules: runner needed, food safety (hair tied back, gloves, tablecloths), someone to snap photos',
      category: 'Food Safety & Assembly',
    },
    {
      id: 'food_safety_notes',
      label: 'Food safety / assembly notes',
      category: 'Food Safety & Assembly',
      notes: 'Optional shared notes for exceptions, concerns, or anything that needs a follow-up.',
    },

    // Logistics Details
    {
      id: 'parking_access',
      label: 'Information for TSP volunteer: parking or building access?',
      category: 'Logistics Details',
    },
    {
      id: 'backup_contact',
      label: 'Back-up contact? (Name and number)',
      category: 'Logistics Details',
    },

    // Admin Wrap-Up
    {
      id: 'how_heard',
      label: 'How did they hear about us?',
      category: 'Admin Wrap-Up',
      required: true,
    },
  ];

  const CONFIRMATION_ITEM_IDS = new Set<string>([
    'outside_operating_area',
    'young_children_pbj',
    'pbj_spatulas_mentioned',
    'assembly_reviewed',
    'review_toolkit',
    'food_safe_gloves',
    'meat_cheese_refrigeration',
    'discuss_shopping',
    'transport_meat_cheese',
    'buying_supplies',
    'cooling_sandwiches',
    'discuss_process',
    'assembly_line',
    'runner_role',
    'typical_rules',
  ]);

  const itemsByCategory = checklistItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const requiredCount = checklistItems.filter((item) => item.required).length;
  const checkedRequiredCount = checklistItems.filter(
    (item) => item.required && checkedItems.has(item.id)
  ).length;

  const handleClose = (open: boolean) => {
    if (!open) {
      // Reset visible state when dialog closes. Note: we deliberately do NOT
      // call clearDraft here — closing without saving should preserve the
      // autosaved draft so the user can resume on the next open.
      setCheckedItems(new Set());
      setItemAnswers({});
      setCallNotes('');
      setContactName('');
      setContactPhone('');
      setContactEmail('');
      setHasUserInteracted(false);
      setPendingRestoreDraft(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-4 sm:px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-xl sm:text-2xl text-[#236383]">
                <Phone className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                Intake Call Guide
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm sm:text-base break-words">
                {eventRequest?.organizationName} • {eventRequest?.firstName}{' '}
                {eventRequest?.lastName}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="text-sm px-3 py-1"
                style={{ borderColor: '#007E8C', color: '#007E8C' }}
              >
                {checkedRequiredCount}/{requiredCount} Required
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCall}
                className="flex items-center gap-2"
              >
                <Phone className="w-4 h-4" />
                {isMobile ? 'Call' : 'Copy Number'}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {pendingRestoreDraft && (
              <div
                className="border-l-4 border-amber-500 bg-amber-50 rounded-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                role="alert"
              >
                <div className="text-sm">
                  <div className="font-semibold text-amber-900">
                    Unsaved intake notes found
                  </div>
                  <div className="text-amber-800 mt-1">
                    A draft from{' '}
                    <span className="font-medium">
                      {formatDraftTimestamp(pendingRestoreDraft.savedAt)}
                    </span>{' '}
                    was autosaved for this event. Restore it, or discard and
                    start fresh?
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={discardPendingDraft}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={restorePendingDraft}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Restore draft
                  </Button>
                </div>
              </div>
            )}

            {/* Quick Info Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-[#236383] mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Quick Reference
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {eventRequest?.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Phone:</span>
                    <span>{eventRequest?.phone}</span>
                  </div>
                )}
                {eventRequest?.email && (
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Email:</span>
                    <span className="truncate">{eventRequest?.email}</span>
                  </div>
                )}
                {eventRequest?.eventAddress && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Address:</span>
                    <span className="truncate">{eventRequest?.eventAddress}</span>
                  </div>
                )}
                {(eventRequest?.desiredEventDate || eventRequest?.scheduledEventDate) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Date:</span>
                    <span>
                      {eventRequest?.scheduledEventDate
                        ? new Date(eventRequest.scheduledEventDate).toLocaleDateString()
                        : eventRequest?.desiredEventDate
                        ? new Date(eventRequest.desiredEventDate).toLocaleDateString()
                        : 'Not set'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Checklist by Category */}
            {Object.entries(itemsByCategory).map(([category, items]) => (
              <div key={category} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-[#236383] mb-3 text-lg flex items-center gap-2">
                  {category === 'Contact Confirmation' && <Users className="w-5 h-5" />}
                  {category === 'Event Basics' && <MapPin className="w-5 h-5" />}
                  {category === 'Sandwich Logistics' && <Refrigerator className="w-5 h-5" />}
                  {category === 'Food Safety & Assembly' && <UtensilsCrossed className="w-5 h-5" />}
                  {category === 'Logistics Details' && <FileText className="w-5 h-5" />}
                  {category === 'Admin Wrap-Up' && <Clock className="w-5 h-5" />}
                  {category}
                </h3>
                <div className="space-y-2">
                  {items.map((item) => {
                    // Conditional visibility for intake-call branches.
                    // The override-note input only appears when the count is
                    // under 200. Refrigeration only when at least one
                    // non-PBJ type is selected. PBJ-only-specific items
                    // (young children, spatulas) only when PBJ is the only
                    // selection.
                    if (item.id === 'under_200_override_note' && !isUnder200) return null;
                    if (item.id === 'refrigeration_status' && !hasNonPbjType) return null;
                    if (item.id === 'young_children_pbj' && !isPbjOnly) return null;
                    if (item.id === 'pbj_spatulas_mentioned' && !selectedTypes.has('pbj')) return null;
                    if (['participant_count', 'additional_volunteers'].includes(item.id) && !isCorporateEvent) return null;

                    // Gate everything past the low-count decision when the
                    // count is under 200 and the override note isn't
                    // filled. The two un-grayed items are sandwich_count
                    // itself (so the operator can change it) and the
                    // override-note field (so they can fill it in). The
                    // section header still renders normally.
                    const isUnderGated =
                      formGatedByLowCount &&
                      item.id !== 'sandwich_count' &&
                      item.id !== 'under_200_override_note';

                    // Items that are pure "I told/confirmed this verbally"
                    // prompts get the checkbox UI — the tick IS the answer.
                    // Every other item is a regular form row (label + input
                    // only). Confirmation items have no input branch in the
                    // render switch below; non-confirmation items do.
                    const isConfirmationItem = CONFIRMATION_ITEM_IDS.has(item.id);

                    return (
                    <React.Fragment key={item.id}>
                    <div
                      className={`${
                        isConfirmationItem ? 'flex items-start gap-3' : ''
                      } p-2 rounded-md transition-colors ${
                        checkedItems.has(item.id)
                          ? 'bg-green-50 border border-green-200'
                          : 'hover:bg-gray-50'
                      } ${isUnderGated ? 'opacity-40 pointer-events-none' : ''}`}
                    >
                      {isConfirmationItem && (
                        <button
                          type="button"
                          onClick={() => toggleItem(item.id)}
                          className="mt-0.5 flex-shrink-0"
                          aria-label={`Toggle ${item.label}`}
                        >
                          {checkedItems.has(item.id) ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <label
                            className={`text-sm flex-1 font-medium ${
                              isConfirmationItem
                                ? `cursor-pointer ${
                                    checkedItems.has(item.id)
                                      ? 'text-gray-600 line-through'
                                      : 'text-gray-900'
                                  }`
                                : 'text-gray-900'
                            }`}
                            onClick={isConfirmationItem ? () => toggleItem(item.id) : undefined}
                          >
                            {item.label}
                            {item.required && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </label>
                        </div>
                        {item.notes && (
                          <div className={`text-xs text-gray-500 mt-1 italic ${isConfirmationItem ? 'ml-7' : ''}`}>
                            {item.notes.split('\n').map((line, idx) => (
                              <div key={idx}>{line}</div>
                            ))}
                          </div>
                        )}
                        {/* Answer input field - special handling for contact info */}
                        <div className={`mt-2 ${isConfirmationItem ? 'ml-7' : ''}`}>
                          {item.id === 'contact_name' ? (
                            <Input
                              type="text"
                              placeholder="Record notes here"
                              value={contactName}
                              onChange={(e) => {
                                const value = e.target.value;
                                markInteracted();
                                setContactName(value);
                                handleAnswerChange(item.id, value);
                              }}
                              className="text-sm h-8"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : item.id === 'contact_phone' ? (
                            <Input
                              type="tel"
                              placeholder="Record notes here"
                              value={contactPhone}
                              onChange={(e) => {
                                const value = e.target.value;
                                markInteracted();
                                setContactPhone(value);
                                handleAnswerChange(item.id, value);
                              }}
                              className="text-sm h-8"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : item.id === 'contact_email' ? (
                            <Input
                              type="email"
                              placeholder="Record notes here"
                              value={contactEmail}
                              onChange={(e) => {
                                const value = e.target.value;
                                markInteracted();
                                setContactEmail(value);
                                handleAnswerChange(item.id, value);
                              }}
                              className="text-sm h-8"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : item.id === 'event_date' ? (
                            // Specific-date OR "not decided yet" toggle.
                            // When undecided, the conflict checker turns off
                            // (it keys on itemAnswers.event_date) and the
                            // potential-dates textarea surfaces below.
                            (() => {
                              const isUndecided = itemAnswers.event_date_undecided === 'true';
                              const setMode = (mode: 'specific' | 'undecided') => {
                                if (mode === 'undecided') {
                                  // Clear the date so the conflict checker
                                  // disables and the date doesn't accidentally
                                  // get saved back to desiredEventDate.
                                  handleAnswerChange('event_date', '');
                                  handleAnswerChange('event_date_undecided', 'true');
                                } else {
                                  handleAnswerChange('event_date_undecided', '');
                                }
                              };
                              return (
                                <div className="space-y-2">
                                  <Select
                                    value={isUndecided ? 'undecided' : 'specific'}
                                    onValueChange={(v) => setMode(v as 'specific' | 'undecided')}
                                  >
                                    <SelectTrigger
                                      className="text-sm h-8"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="specific">Specific date</SelectItem>
                                      <SelectItem value="undecided">Not decided yet</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {isUndecided ? (
                                    <Textarea
                                      placeholder="Explain why it's not decided yet and any potential dates or windows (e.g. 'sometime in July', 'Saturday morning in late June')."
                                      value={itemAnswers.event_date_undecided_note || ''}
                                      onChange={(e) => handleAnswerChange('event_date_undecided_note', e.target.value)}
                                      className="text-sm min-h-[80px]"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <Input
                                      type="date"
                                      value={itemAnswers[item.id] || ''}
                                      onChange={(e) =>
                                        handleAnswerChange(item.id, e.target.value)
                                      }
                                      className="text-sm h-8"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  )}
                                </div>
                              );
                            })()
                          ) : item.id === 'sandwich_count' ? (
                            <div className="space-y-2">
                              <Input
                                type="text"
                                placeholder="e.g. 750"
                                value={itemAnswers[item.id] || ''}
                                onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                                className="text-sm h-8"
                                onClick={(e) => e.stopPropagation()}
                              />
                              {isUnder200 && (
                                <div className="border-l-4 border-[#A31C41] bg-[#A31C41]/5 rounded-md p-3">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-[#A31C41] flex-shrink-0 mt-0.5" />
                                    <div className="text-xs text-[#7a1632] space-y-2">
                                      <p>
                                        Under 200 sandwiches is not a group event. Let the group know they can make this quantity and drop them at a host home on a Wednesday — share our host finder:
                                      </p>
                                      <a
                                        href="https://tsp-host-finder-tool.web.app/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-medium text-[#A31C41] underline hover:no-underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        Open TSP Host Finder
                                      </a>
                                      <p>
                                        To proceed anyway, fill in the override note below. To mark this as a non-event instead, use the button at the bottom of the dialog.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : item.id === 'under_200_override_note' ? (
                            <Textarea
                              placeholder="Why are we proceeding with under 200? Confirm you've talked to Marcy and/or Christine."
                              value={itemAnswers[item.id] || ''}
                              onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                              className="text-sm min-h-[80px]"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : item.id === 'sandwich_types' ? (
                            // Multi-select; values comma-joined into the
                            // single string answer so the rest of the form's
                            // plain-text answers model still works.
                            (() => {
                              const TYPE_OPTIONS: Array<{ value: string; label: string; sublabel?: string }> = [
                                { value: 'turkey', label: 'Turkey' },
                                { value: 'chicken', label: 'Chicken' },
                                { value: 'ham', label: 'Ham', sublabel: 'allowed but not preferred' },
                                { value: 'pbj', label: 'Peanut butter & jelly' },
                                { value: 'deli_tbd', label: 'Deli (type to be determined)' },
                              ];
                              const toggleType = (value: string, checked: boolean) => {
                                const current = new Set(selectedTypes);
                                if (checked) current.add(value);
                                else current.delete(value);
                                handleAnswerChange(
                                  'sandwich_types',
                                  Array.from(current).join(',')
                                );
                              };
                              return (
                                <div className="flex flex-wrap gap-3">
                                  {TYPE_OPTIONS.map((opt) => (
                                    <label
                                      key={opt.value}
                                      className="flex items-center gap-2 text-sm cursor-pointer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Checkbox
                                        checked={selectedTypes.has(opt.value)}
                                        onCheckedChange={(c) => toggleType(opt.value, c === true)}
                                      />
                                      <span>
                                        {opt.label}
                                        {opt.sublabel && (
                                          <span className="text-xs text-gray-500 italic ml-1">({opt.sublabel})</span>
                                        )}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              );
                            })()
                          ) : item.id === 'refrigeration_status' ? (
                            // Options depend on count tier.
                            // <500: Yes / No (must make more or PBJ) / Special exemption
                            // ≥500: Yes / No (van needed)
                            <Select
                              value={itemAnswers[item.id] || ''}
                              onValueChange={(v) => handleAnswerChange(item.id, v)}
                            >
                              <SelectTrigger
                                className="text-sm h-8"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SelectValue placeholder="Sufficient refrigeration?" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="yes">Yes — sufficient refrigeration</SelectItem>
                                {isUnder500 ? (
                                  <>
                                    <SelectItem value="no_make_more_or_pbj">
                                      No — group must make more or switch to PBJ
                                    </SelectItem>
                                    <SelectItem value="special_exemption">
                                      Request special exemption
                                    </SelectItem>
                                  </>
                                ) : (
                                  <SelectItem value="no_van_needed">
                                    No — van needed
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          ) : item.id === 'how_heard' ? (
                            // Dropdown + free-text notes as one logical
                            // question. The notes textarea is inline, not
                            // its own checklist row.
                            <div className="space-y-2">
                              <Select
                                value={itemAnswers[item.id] || ''}
                                onValueChange={(v) => handleAnswerChange(item.id, v)}
                              >
                                <SelectTrigger
                                  className="text-sm h-8"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <SelectValue placeholder="Select how they heard about us" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="previous_event">Previous event</SelectItem>
                                  <SelectItem value="friend_family">Friend or family</SelectItem>
                                  <SelectItem value="internet_search">Internet search</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                              <Textarea
                                placeholder="Notes — e.g. event name, specific search term, friend's name (optional)"
                                value={itemAnswers.how_heard_notes || ''}
                                onChange={(e) => handleAnswerChange('how_heard_notes', e.target.value)}
                                className="text-sm min-h-[60px]"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ) : item.id === 'is_corporate_event' ? (
                            <div className="space-y-2">
                              <Select
                                value={itemAnswers[item.id] || ''}
                                onValueChange={(v) => handleAnswerChange(item.id, v)}
                              >
                                <SelectTrigger
                                  className="text-sm h-8"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <SelectValue placeholder="Yes / No" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                              {itemAnswers[item.id] === 'yes' && (
                                <p className="text-xs text-[#A31C41] italic">
                                  Corporate follow-ups will appear below: participant count and volunteer needs.
                                </p>
                              )}
                            </div>
                          ) : item.id === 'additional_volunteers' ? (
                            <div className="space-y-2">
                              <Input
                                type="text"
                                placeholder="Record notes here"
                                value={itemAnswers[item.id] || ''}
                                onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                                className="text-sm h-8"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <p className="text-xs text-gray-600 italic">
                                Our volunteer roster is limited, so we generally prioritize larger and corporate events. Only offer volunteers if it really fits the event.
                              </p>
                            </div>
                          ) : item.id === 'outside_operating_area' ? (
                            <p className="text-xs text-gray-500 italic">
                              Tick the box if the event location falls outside the areas listed above.
                            </p>
                          ) : item.id === 'young_children_pbj' ? (
                            <p className="text-xs text-gray-500 italic">
                              Check the box if this applies. A follow-up will be added on save to clear an exception with Christine/Marcy.
                            </p>
                          ) : item.id === 'pbj_spatulas_mentioned' ? (
                            <p className="text-xs text-gray-500 italic">
                              Check once you've mentioned the recommended PBJ spatulas. Link is in the toolkit.
                            </p>
                          ) : item.id === 'assembly_reviewed' ? (
                            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-gray-800 space-y-2">
                              <div>
                                <span className="font-semibold text-[#236383]">Deli:</span>{' '}
                                bread → cheese → meat → cheese → bread. Check the serving size on the meat package and use that many slices per sandwich (= 2 oz, our required amount). Two pieces of cheese per sandwich, with the meat in between. Each sandwich goes in its own sandwich-sized ziploc, stacked 10–12 per stack, returned to the bag the loaf of bread came out of.
                              </div>
                              <div>
                                <span className="font-semibold text-[#236383]">PBJ:</span>{' '}
                                peanut butter spread on BOTH sides of the bread. Jelly on one side neatly, kept away from the edges to prevent leakage.
                              </div>
                              <div>
                                <span className="font-semibold text-[#236383]">All events:</span>{' '}
                                food-safe gloves, hairnets (beardnets where relevant), access to sinks for handwashing — hand sanitizer is NOT sufficient. Disposable tablecloths are incredibly helpful for keeping the prep area clean.
                              </div>
                              <p className="italic text-gray-600 pt-1">
                                Check the box above once you've walked the group through these.
                              </p>
                            </div>
                          ) : item.id === 'event_address' ? (
                            // Address: show existing as a confirm-or-change card
                            // when we already have one; otherwise show a plain
                            // input. Always show a "View in Google Maps" button
                            // when there is a value to view, so the operator can
                            // eyeball whether it falls in our operating areas.
                            (() => {
                              const currentAddress = (itemAnswers.event_address || '').trim();
                              const mapsHref = currentAddress
                                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentAddress)}`
                                : null;
                              // Keep the snapshot we'd revert to on Cancel —
                              // the address on the event when the dialog
                              // opened. If there was none, Cancel just clears.
                              const originalAddress = (eventRequest?.eventAddress || '').trim();
                              const showCard = !isEditingAddress && !!currentAddress;
                              const trimmedTyped = currentAddress;
                              const canSave = trimmedTyped.length > 0;
                              return (
                                <div className="space-y-2">
                                  {showCard ? (
                                    <div className="bg-white border border-[#47B3CB]/40 rounded-md p-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2 min-w-0">
                                          <MapPin className="w-4 h-4 text-[#236383] flex-shrink-0 mt-0.5" />
                                          <div className="text-sm text-gray-900 break-words min-w-0">
                                            {currentAddress}
                                          </div>
                                        </div>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 text-xs flex-shrink-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            markInteracted();
                                            setIsEditingAddress(true);
                                          }}
                                        >
                                          Change
                                        </Button>
                                      </div>
                                      <p className="text-xs text-gray-500 mt-2">
                                        Confirm this address with the organizer, or click Change to enter a different one.
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <Input
                                        type="text"
                                        placeholder="Enter event address"
                                        value={itemAnswers.event_address || ''}
                                        onChange={(e) => handleAnswerChange('event_address', e.target.value)}
                                        className="text-sm h-8 flex-1"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-8 bg-[#007E8C] hover:bg-[#236383] text-white"
                                        disabled={!canSave}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIsEditingAddress(false);
                                        }}
                                      >
                                        <Check className="w-4 h-4" />
                                      </Button>
                                      {originalAddress && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-8"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleAnswerChange('event_address', originalAddress);
                                            setIsEditingAddress(false);
                                          }}
                                        >
                                          Cancel
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                  {mapsHref && (
                                    <a
                                      href={mapsHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs font-medium text-[#007E8C] hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <MapPin className="w-3.5 h-3.5" />
                                      View in Google Maps
                                    </a>
                                  )}
                                </div>
                              );
                            })()
                          ) : item.id === 'event_times' ? (
                            // Three free-text fields in one row. Auto-checks
                            // the parent `event_times` row when any field has
                            // a value. Saves to eventStartTime / eventEndTime
                            // / pickupTime columns on submit.
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <Label className="text-xs text-gray-600 mb-1 block">Start time</Label>
                                <Input
                                  type="text"
                                  placeholder="e.g. 10:00 AM"
                                  value={itemAnswers.event_start_time || ''}
                                  onChange={(e) => handleAnswerChange('event_start_time', e.target.value)}
                                  className="text-sm h-8"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-gray-600 mb-1 block">End time</Label>
                                <Input
                                  type="text"
                                  placeholder="e.g. 12:30 PM"
                                  value={itemAnswers.event_end_time || ''}
                                  onChange={(e) => handleAnswerChange('event_end_time', e.target.value)}
                                  className="text-sm h-8"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-gray-600 mb-1 block">Pickup time</Label>
                                <Input
                                  type="text"
                                  placeholder="e.g. anytime after 3pm"
                                  value={itemAnswers.event_pickup_time || ''}
                                  onChange={(e) => handleAnswerChange('event_pickup_time', e.target.value)}
                                  className="text-sm h-8"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            </div>
                          ) : item.id === 'food_safety_notes' ? (
                            <Textarea
                              placeholder="Optional: exceptions, follow-up concerns, supply questions, refrigeration concerns, or anything unusual from the safety review."
                              value={itemAnswers[item.id] || ''}
                              onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                              className="text-sm min-h-[90px]"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            isConfirmationItem ? null : (
                              <Input
                                type="text"
                                placeholder="Record notes here"
                                value={itemAnswers[item.id] || ''}
                                onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                                className="text-sm h-8"
                                onClick={(e) => e.stopPropagation()}
                              />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Live calendar conflicts: rendered immediately after
                        the event_date row so the operator can see what the
                        app already knows about this day without leaving the
                        section. Driven by the existing /check-conflicts and
                        traffic-conflicts infrastructure. */}
                    {item.id === 'event_date' && conflictDate && (
                      <div className="space-y-3">
                        {shouldConsultTeam && (
                          <div className="border-l-4 border-[#A31C41] bg-[#A31C41]/5 rounded-md p-4">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-[#A31C41] flex-shrink-0 mt-0.5" />
                              <div className="text-sm">
                                <div className="font-semibold text-[#A31C41]">
                                  Consult with Christine &amp; Marcy before scheduling
                                </div>
                                <ul className="mt-2 list-disc list-inside text-[#7a1632] space-y-1">
                                  {trafficConflict && (
                                    <li>
                                      <span className="font-medium">{trafficConflict.label}</span>
                                      {trafficConflict.detail ? ` — ${trafficConflict.detail}` : ''}
                                      {trafficConflict.kickoffEt ? ` (kickoff ${trafficConflict.kickoffEt})` : ''}
                                    </li>
                                  )}
                                  {highVolumeWarnings.map((w, i) => (
                                    <li key={i}>{w.message}</li>
                                  ))}
                                </ul>
                                <p className="mt-2 text-xs text-[#7a1632]/80">
                                  You can still complete this form. A reminder will be added to the event's Next Action when you save.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                        <EventConflictWarnings
                          eventId={eventRequest?.id}
                          scheduledEventDate={conflictDate}
                          organizationName={eventRequest?.organizationName ?? null}
                        />
                      </div>
                    )}
                    {/* When the operator picked "Not decided yet" we
                        explicitly tell them the conflict check is off. */}
                    {item.id === 'event_date' && !conflictDate && itemAnswers.event_date_undecided === 'true' && (
                      <div className="text-xs text-gray-500 italic px-2">
                        No conflict check while the date is undecided — it will run as soon as a date is finalized.
                      </div>
                    )}

                    {/* Operating-areas reference box: rendered immediately
                        after the event_address row so the operator can
                        eyeball the address against our typical service area
                        before deciding whether to tick "outside operating
                        areas" below. */}
                    {item.id === 'event_address' && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <h4 className="font-semibold text-[#236383] mb-2 flex items-center gap-2 text-sm">
                          <MapPin className="w-4 h-4" />
                          Typical Operating Areas
                        </h4>
                        <p className="text-xs text-gray-700 mb-2">
                          If you're not sure whether the event address falls in our service area, use the <span className="font-semibold">View in Google Maps</span> link above to check. If the location is outside the areas listed below, tick the <span className="font-semibold">Event is outside our typical operating areas</span> box that appears next — saving the form will add a Next Action to clear the farther location with Christine &amp; Marcy.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {OPERATING_AREAS.map((area) => (
                            <Badge
                              key={area}
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: '#FBAD3F', color: '#D68319' }}
                            >
                              {area}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}


            {/* Other Notes — final admin wrap-up bucket for anything that
                didn't fit a structured question above. */}
            <div className="bg-white border border-gray-300 rounded-lg p-4">
              <Label htmlFor="call-notes" className="text-base font-semibold text-[#236383] mb-2 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Other Notes
              </Label>
              <Textarea
                id="call-notes"
                value={callNotes}
                onChange={(e) => {
                  markInteracted();
                  setCallNotes(e.target.value);
                }}
                placeholder="Anything that came up during the call that didn't fit a question above — questions they asked, side context, things to remember next time."
                className="min-h-[150px] mt-2"
              />
              <p className="text-xs text-gray-500 mt-2">
                Catch-all for anything that doesn't belong in a specific question above. Don't repeat what you already entered in the structured fields.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-4 border-t flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-shrink-0 bg-gray-50">
          <div className="text-sm text-gray-600 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            {checkedRequiredCount === requiredCount ? (
              <span className="text-green-600 font-medium">
                ✓ All required items completed
              </span>
            ) : (
              <span>
                Complete {requiredCount - checkedRequiredCount} more required item
                {requiredCount - checkedRequiredCount !== 1 ? 's' : ''}
              </span>
            )}
            {draftSavedAt && (
              <span className="text-xs text-gray-500 italic">
                Draft autosaved {formatDraftTimestamp(draftSavedAt)}
              </span>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={onClose} disabled={isSaving} className="w-full sm:w-auto">
              Close
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveAndClose}
              disabled={isSaving}
              className="border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10 w-full sm:w-auto"
            >
              {isSaving ? 'Saving...' : 'Close & Save'}
            </Button>
            {/* Move to Non-Event — shown when under-200 and the operator
                hasn't filled in an override note. Direct exit path for
                requests too small to be a group event. */}
            {isUnder200 && !has200OverrideNote && (
              <ConfirmationDialog
                trigger={
                  <Button
                    variant="outline"
                    className="border-[#A31C41] text-[#A31C41] hover:bg-[#A31C41]/10 w-full sm:w-auto"
                    disabled={isSaving}
                  >
                    Move to Non-Event
                  </Button>
                }
                title="Move this request to Non-Event?"
                description="This will change the request status to Non-Event and close the intake dialog without saving call notes. Use this when the sandwich count is too small for a group event and the organizer has been directed to the host finder instead."
                confirmText="Move to Non-Event"
                cancelText="Cancel"
                variant="destructive"
                onConfirm={handleMoveToNonEvent}
              />
            )}
            <Button
              onClick={handleComplete}
              className="bg-[#007E8C] hover:bg-[#236383] text-white w-full sm:w-auto"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Mark Call Complete'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default IntakeCallDialog;
