import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Clock,
  Users,
  Car,
  Truck,
  Save,
  Loader2,
  X,
  AlertTriangle,
  UserPlus,
  Search,
  Building,
  User,
  Package,
  History,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import {
  useDraftPersistence,
  loadDraft,
  clearDraft,
  formatDraftTimestamp,
} from '@/hooks/useDraftPersistence';
import { logger } from '@/lib/logger';
import { getDriverIds, getVolunteerIds, extractNameFromAssignmentId, resolveAssignmentDisplayName } from '@/lib/assignment-utils';
import { getRecipientDisplayRegion } from '@/lib/atlanta-regions';
import type { EventRequest } from '@shared/schema';
import { EventRequestAuditLog } from '@/components/event-request-audit-log';

interface EventEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  event: EventRequest | null;
  onSaved?: () => void;
}

interface EventEditDraftData {
  driversNeeded: string;
  volunteersNeeded: string;
  pickupTime: string;
  eventStartTime: string;
  eventEndTime: string;
  pickupTimeWindow: string;
  tspContact: string;
  customTspContact: string;
  vanDriverNeeded: boolean;
  isCorporatePriority: boolean;
  assignedDriverIds: string[];
  assignedVolunteerIds: string[];
  assignedVanDriverId: string | null;
  assignedRecipientIds: string[];
}

// Helper function to format time for input (converts to 24-hour HH:mm format)
const formatTimeForInput = (time: string | null | undefined): string => {
  if (!time) return '';
  
  // Already in HH:mm format
  if (/^\d{1,2}:\d{2}$/.test(time)) return time.padStart(5, '0');
  
  // Has seconds
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) return time.slice(0, 5).padStart(5, '0');
  
  // Handle 12-hour format (e.g., "11:00 AM", "12:30 PM")
  const match = time.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3];
    
    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // If we can't parse it, return empty string to avoid HTML input errors
  console.warn('Failed to format time for input:', time);
  return '';
};

// Helper to parse PostgreSQL array format
const parsePostgresArray = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    if (value === '{}' || value === '') return [];
    const cleaned = value.replace(/^{|}$/g, '');
    if (!cleaned) return [];
    if (cleaned.includes('"')) {
      const matches = cleaned.match(/"[^"]*"|[^",]+/g);
      return matches ? matches.map(item => item.replace(/"/g, '').trim()).filter(Boolean) : [];
    }
    return cleaned.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
};

// Person selector component for assignments
interface PersonSelectorProps {
  selectedPeople: string[];
  onSelectionChange: (selected: string[]) => void;
  assignmentType: 'driver' | 'volunteer';
  vanDriverNeeded?: boolean;
  /** Stored assignment metadata (volunteerDetails, driverDetails, etc.) for name fallback */
  assignmentDetails?: Record<string, { name?: string }>;
}

function parseAssignmentDetails(
  details?: Record<string, { name?: string }> | string | null
): Record<string, { name?: string }> {
  if (!details) return {};
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return details;
}

function buildVolunteerNameLookup(volunteers: any[]): Map<string, string> {
  const map = new Map<string, string>();
  volunteers.forEach((vol: any) => {
    const name =
      `${vol.firstName || ''} ${vol.lastName || ''}`.trim() ||
      vol.name ||
      `Volunteer #${vol.id}`;
    const id = String(vol.id);
    map.set(id, name);
    map.set(`volunteer-${id}`, name);
  });
  return map;
}

function buildDriverNameLookup(drivers: any[]): Map<string, string> {
  const map = new Map<string, string>();
  drivers.forEach((driver: any) => {
    const name = driver.name || `Driver #${driver.id}`;
    const id = String(driver.id);
    map.set(id, name);
    map.set(`driver-${id}`, name);
  });
  return map;
}

function resolvePersonDisplayName(
  personId: string,
  opts: {
    assignmentDetails?: Record<string, { name?: string }>;
    availablePeople: Array<{ id: string; name: string }>;
    volunteerNameLookup: Map<string, string>;
    driverNameLookup: Map<string, string>;
    assignmentType: 'driver' | 'volunteer';
  }
): string {
  const storedName = opts.assignmentDetails?.[personId]?.name;
  if (storedName?.trim()) {
    const normalized = resolveAssignmentDisplayName(personId, { storedName });
    if (normalized !== 'Unknown') return normalized;
  }

  if (personId.startsWith('custom-') || personId.startsWith('custom:')) {
    return extractNameFromAssignmentId(personId) || personId;
  }

  const legacyName = extractNameFromAssignmentId(personId);
  if (legacyName) return legacyName;

  const person = opts.availablePeople.find((p) => p.id === personId);
  if (person?.name) return person.name;

  if (opts.assignmentType === 'volunteer') {
    const volName =
      opts.volunteerNameLookup.get(personId) ??
      opts.volunteerNameLookup.get(personId.replace(/^volunteer-/, ''));
    if (volName) return volName;
  }

  if (opts.assignmentType === 'driver') {
    const driverName =
      opts.driverNameLookup.get(personId) ??
      opts.driverNameLookup.get(personId.replace(/^driver-/, ''));
    if (driverName) return driverName;
  }

  return personId;
}

function PersonSelector({
  selectedPeople,
  onSelectionChange,
  assignmentType,
  vanDriverNeeded = false,
  assignmentDetails,
}: PersonSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [customEntryText, setCustomEntryText] = useState('');
  const [showCustomEntry, setShowCustomEntry] = useState(false);

  // Fetch users for assignments
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users/for-assignments'],
  });

  const { data: drivers = [] } = useQuery<any[]>({
    queryKey: ['/api/drivers'],
  });

  const { data: volunteers = [] } = useQuery<any[]>({
    queryKey: ['/api/volunteers'],
  });

  // Build list of available people based on assignment type
  const availablePeople = useMemo(() => {
    const people: Array<{ id: string; name: string; type: string; details?: string }> = [];

    // Add users (team members)
    users.forEach((user: any) => {
      people.push({
        id: user.id,
        name: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || user.id,
        type: 'user',
        details: user.email,
      });
    });

    // Add drivers (for driver assignments)
    if (assignmentType === 'driver') {
      drivers.forEach((driver: any) => {
        // Filter for van-approved AND willing to drive van if needed
        if (vanDriverNeeded && (!driver.vanApproved || !driver.interestedInVanDriving)) return;

        people.push({
          id: `driver-${driver.id}`,
          name: driver.name || `Driver #${driver.id}`,
          type: 'driver',
          details: driver.vanApproved ? 'Van Approved' : undefined,
        });
      });
    }

    // Add volunteers (for volunteer assignments)
    if (assignmentType === 'volunteer') {
      volunteers.forEach((vol: any) => {
        // Deactivated volunteers (including hosts unmarked as volunteers) can't be picked
        if (vol.isActive === false) return;
        people.push({
          id: `volunteer-${vol.id}`,
          name: vol.name || `${vol.firstName || ''} ${vol.lastName || ''}`.trim() || `Volunteer #${vol.id}`,
          type: 'volunteer',
        });
      });
    }

    return people;
  }, [users, drivers, volunteers, assignmentType, vanDriverNeeded]);

  const volunteerNameLookup = useMemo(
    () => buildVolunteerNameLookup(volunteers),
    [volunteers]
  );
  const driverNameLookup = useMemo(() => buildDriverNameLookup(drivers), [drivers]);

  const resolveDisplayName = useCallback(
    (personId: string) =>
      resolvePersonDisplayName(personId, {
        assignmentDetails,
        availablePeople,
        volunteerNameLookup,
        driverNameLookup,
        assignmentType,
      }),
    [assignmentDetails, availablePeople, volunteerNameLookup, driverNameLookup, assignmentType]
  );

  // Filter by search term
  const filteredPeople = useMemo(() => {
    if (!searchTerm) return availablePeople;
    const lower = searchTerm.toLowerCase();
    return availablePeople.filter(
      p => p.name.toLowerCase().includes(lower) || p.details?.toLowerCase().includes(lower)
    );
  }, [availablePeople, searchTerm]);

  const togglePerson = (personId: string) => {
    if (selectedPeople.includes(personId)) {
      onSelectionChange(selectedPeople.filter(id => id !== personId));
    } else {
      onSelectionChange([...selectedPeople, personId]);
    }
  };

  const handleAddCustomEntry = () => {
    if (!customEntryText.trim()) return;
    const customId = `custom-${Date.now()}-${customEntryText.trim().replace(/\s+/g, '-')}`;
    onSelectionChange([...selectedPeople, customId]);
    setCustomEntryText('');
    setShowCustomEntry(false);
  };

  const getDisplayName = (personId: string): string => resolveDisplayName(personId);

  const removePerson = (personId: string) => {
    onSelectionChange(selectedPeople.filter(id => id !== personId));
  };

  return (
    <div className="space-y-3">
      {/* Selected people */}
      {selectedPeople.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-gray-50 rounded-lg">
          {selectedPeople.map(personId => (
            <Badge key={personId} variant="secondary" className="flex items-center gap-1">
              {getDisplayName(personId)}
              <button
                type="button"
                onClick={() => removePerson(personId)}
                className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search people..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Custom entry */}
      {!showCustomEntry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCustomEntry(true)}
          className="w-full"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Add Custom Entry
        </Button>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Enter name..."
            value={customEntryText}
            onChange={e => setCustomEntryText(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleAddCustomEntry()}
            autoFocus
          />
          <Button size="sm" onClick={handleAddCustomEntry} disabled={!customEntryText.trim()}>
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowCustomEntry(false);
              setCustomEntryText('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* People list - using max-height with overflow instead of ScrollArea to allow parent scroll */}
      <div className="max-h-48 overflow-y-auto border rounded-lg">
        <div className="p-2 space-y-1">
          {filteredPeople.map(person => {
            const isSelected = selectedPeople.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => togglePerson(person.id)}
                className={`w-full text-left p-2 rounded-md flex items-center gap-2 transition-colors ${
                  isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                }`}
              >
                {person.type === 'user' && <User className="w-4 h-4 text-gray-500" />}
                {person.type === 'driver' && <Car className="w-4 h-4 text-blue-500" />}
                {person.type === 'volunteer' && <Users className="w-4 h-4 text-amber-500" />}
                <div className="flex-1">
                  <div className="text-sm font-medium">{person.name}</div>
                  {person.details && (
                    <div className="text-xs text-gray-500">{person.details}</div>
                  )}
                </div>
                {isSelected && <Badge variant="secondary" className="text-xs">Selected</Badge>}
              </button>
            );
          })}
          {filteredPeople.length === 0 && (
            <div className="text-center text-gray-500 py-4 text-sm">
              No matches found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const EventEditDialog: React.FC<EventEditDialogProps> = ({
  isOpen,
  onClose,
  event,
  onSaved,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  // Check if current user can remove corporate priority (only Katie and Christine)
  const canRemoveCorporatePriority = useMemo(() => {
    const allowedEmails = [
      'admin@sandwich.project',
      'katielong2316@gmail.com',
      'katie@thesandwichproject.org',
      'christine@thesandwichproject.org'
    ];
    const userEmail = user?.email?.toLowerCase();
    return userEmail && allowedEmails.includes(userEmail);
  }, [user?.email]);

  // Persistent save-error state. Toasts are easy to miss (auto-dismiss,
  // can be covered by other UI), so when a save attempt is rejected we
  // ALSO surface a persistent banner inside the dialog that names the
  // reason. The banner stays until the user either fixes the issue and
  // retries, edits any field (which is probably an attempt to fix it),
  // or closes the dialog. The toast still fires too — that's the
  // notification; this is the durable context.
  const [saveError, setSaveError] = useState<{
    title: string;
    message: string;
    missingFields?: string[];
  } | null>(null);

  // Form state for logistics
  const [driversNeeded, setDriversNeeded] = useState('');
  const [volunteersNeeded, setVolunteersNeeded] = useState('');
  const [pickupTime, setPickupTime] = useState('');
  const [eventStartTime, setEventStartTime] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [pickupTimeWindow, setPickupTimeWindow] = useState('');
  const [tspContact, setTspContact] = useState('');
  const [customTspContact, setCustomTspContact] = useState('');
  const [vanDriverNeeded, setVanDriverNeeded] = useState(false);
  const [isCorporatePriority, setIsCorporatePriority] = useState(false);

  // Staffing assignments
  const [assignedDriverIds, setAssignedDriverIds] = useState<string[]>([]);
  const [assignedVolunteerIds, setAssignedVolunteerIds] = useState<string[]>([]);
  const [assignedVanDriverId, setAssignedVanDriverId] = useState<string | null>(null);
  const [assignedRecipientIds, setAssignedRecipientIds] = useState<string[]>([]);

  // Fetch users for TSP contact dropdown
  const { data: usersBasic = [] } = useQuery<any[]>({
    queryKey: ['/api/users/basic'],
  });

  // Fetch recipients for delivery destination dropdown
  const { data: recipients = [] } = useQuery<any[]>({
    queryKey: ['/api/recipients'],
  });

  // Draft persistence — autosaves form state to localStorage. Suspended until
  // the form diverges from the initial event-populated state so we don't
  // overwrite a saved draft with the dialog's load values.
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [pendingRestoreDraft, setPendingRestoreDraft] = useState<
    | { savedAt: string; data: EventEditDraftData; version: string | null }
    | null
  >(null);
  // Snapshot of the initial data (from event or from a restored draft) used to
  // detect the first divergence — when current data differs from this baseline,
  // the user has interacted and autosave engages. The baseline is set directly
  // from the values we queue (not from current render state) to avoid a race
  // where the divergence detector reads pre-populate state and falsely flags
  // a populate as user interaction.
  const baselineRef = useRef<string | null>(null);
  // Tracks whether React has applied the populated/restored state to the
  // current render — only then does divergence detection become active.
  const baselineSettledRef = useRef(false);

  const draftKey = event ? `event-edit:${event.id}` : null;

  const computeEventValues = useCallback((evt: EventRequest): EventEditDraftData => ({
    driversNeeded: (evt.driversNeeded ?? 0).toString(),
    volunteersNeeded: (evt.volunteersNeeded ?? 0).toString(),
    // (speakersNeeded retired)
    pickupTime: formatTimeForInput(evt.pickupTime),
    eventStartTime: formatTimeForInput(evt.eventStartTime),
    eventEndTime: formatTimeForInput(evt.eventEndTime),
    pickupTimeWindow: evt.pickupTimeWindow || '',
    tspContact: evt.tspContact || '',
    customTspContact: evt.customTspContact || '',
    vanDriverNeeded: evt.vanDriverNeeded || false,
    isCorporatePriority: (evt as any).isCorporatePriority || false,
    assignedDriverIds: getDriverIds(evt),
    assignedVolunteerIds: getVolunteerIds(evt),
    assignedVanDriverId: evt.assignedVanDriverId || null,
    assignedRecipientIds: parsePostgresArray((evt as any).assignedRecipientIds),
  }), []);

  const applyDraftValues = useCallback((d: EventEditDraftData) => {
    setDriversNeeded(d.driversNeeded);
    setVolunteersNeeded(d.volunteersNeeded);
    setPickupTime(d.pickupTime);
    setEventStartTime(d.eventStartTime);
    setEventEndTime(d.eventEndTime);
    setPickupTimeWindow(d.pickupTimeWindow);
    setTspContact(d.tspContact);
    setCustomTspContact(d.customTspContact);
    setVanDriverNeeded(d.vanDriverNeeded);
    setIsCorporatePriority(d.isCorporatePriority);
    setAssignedDriverIds(d.assignedDriverIds);
    setAssignedVolunteerIds(d.assignedVolunteerIds);
    setAssignedVanDriverId(d.assignedVanDriverId);
    setAssignedRecipientIds(d.assignedRecipientIds);
  }, []);

  const populateFromEvent = useCallback((evt: EventRequest) => {
    const values = computeEventValues(evt);
    applyDraftValues(values);
    // Baseline is set synchronously to the values we just queued, so when
    // the divergence detector runs in the same commit it compares against
    // the correct target — not the pre-populate render state.
    baselineRef.current = JSON.stringify(values);
    baselineSettledRef.current = false;
  }, [computeEventValues, applyDraftValues]);

  // Populate form when the event changes. If a draft exists for this event,
  // show a restore banner and let the user decide before mutating state.
  useEffect(() => {
    if (!event) return;

    const existingDraft = loadDraft<EventEditDraftData>(`event-edit:${event.id}`);
    if (existingDraft) {
      setPendingRestoreDraft({
        savedAt: existingDraft.savedAt,
        data: existingDraft.data,
        version: existingDraft.version ?? null,
      });
      // Still pre-fill from the event so the dialog isn't blank while the
      // banner is up — if the user restores, those values get overwritten.
      populateFromEvent(event);
      setHasUserInteracted(false);
      return;
    }

    populateFromEvent(event);
    setHasUserInteracted(false);
  }, [event, populateFromEvent]);

  const draftData: EventEditDraftData = {
    driversNeeded,
    volunteersNeeded,
    pickupTime,
    eventStartTime,
    eventEndTime,
    pickupTimeWindow,
    tspContact,
    customTspContact,
    vanDriverNeeded,
    isCorporatePriority,
    assignedDriverIds,
    assignedVolunteerIds,
    assignedVanDriverId,
    assignedRecipientIds,
  };
  const { savedAt: draftSavedAt } = useDraftPersistence<EventEditDraftData>({
    key: draftKey,
    data: draftData,
    enabled: isOpen && hasUserInteracted && !pendingRestoreDraft,
    version: event?.updatedAt ?? null,
    debounceMs: 500,
  });

  // Watch for divergence between current form data and the baseline set
  // synchronously inside populateFromEvent / restorePendingDraft. Divergence
  // means the user has interacted; that's what enables autosave.
  //
  // The baselineSettledRef gate prevents a false positive: when populate
  // queues state setters, the next render's draftSerialized hasn't caught up
  // to the baseline yet. We wait for the first render where they match
  // (state has landed) before treating any further divergence as interaction.
  const draftSerialized = JSON.stringify(draftData);
  useEffect(() => {
    if (!isOpen || !event || baselineRef.current === null) return;
    if (!baselineSettledRef.current) {
      if (draftSerialized === baselineRef.current) {
        baselineSettledRef.current = true;
      }
      return;
    }
    if (!hasUserInteracted && draftSerialized !== baselineRef.current) {
      setHasUserInteracted(true);
    }
  }, [draftSerialized, isOpen, event, hasUserInteracted]);

  const restorePendingDraft = () => {
    if (!pendingRestoreDraft) return;
    const d = pendingRestoreDraft.data;
    // Normalize incoming draft (defensive against older shapes) before
    // applying — keeps state shapes consistent.
    const safe: EventEditDraftData = {
      driversNeeded: d.driversNeeded ?? '',
      volunteersNeeded: d.volunteersNeeded ?? '',
      pickupTime: d.pickupTime ?? '',
      eventStartTime: d.eventStartTime ?? '',
      eventEndTime: d.eventEndTime ?? '',
      pickupTimeWindow: d.pickupTimeWindow ?? '',
      tspContact: d.tspContact ?? '',
      customTspContact: d.customTspContact ?? '',
      vanDriverNeeded: Boolean(d.vanDriverNeeded),
      isCorporatePriority: Boolean(d.isCorporatePriority),
      assignedDriverIds: Array.isArray(d.assignedDriverIds) ? d.assignedDriverIds : [],
      assignedVolunteerIds: Array.isArray(d.assignedVolunteerIds) ? d.assignedVolunteerIds : [],
      assignedVanDriverId: d.assignedVanDriverId ?? null,
      assignedRecipientIds: Array.isArray(d.assignedRecipientIds) ? d.assignedRecipientIds : [],
    };
    applyDraftValues(safe);
    baselineRef.current = JSON.stringify(safe);
    baselineSettledRef.current = false;
    setPendingRestoreDraft(null);
    setHasUserInteracted(true);
  };

  const discardPendingDraft = () => {
    if (!event) return;
    clearDraft(`event-edit:${event.id}`);
    setPendingRestoreDraft(null);
    populateFromEvent(event);
    setHasUserInteracted(false);
  };

  // Detect whether the draft was based on a now-stale version of the event.
  // If the server's updatedAt has advanced since the draft was saved, the
  // user's draft may overwrite someone else's changes — warn them.
  const draftIsStale = Boolean(
    pendingRestoreDraft &&
      event?.updatedAt &&
      pendingRestoreDraft.version &&
      new Date(event.updatedAt).getTime() !==
        new Date(pendingRestoreDraft.version).getTime()
  );

  // Update mutation with retry for transient failures
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!event) throw new Error('No event selected');
      logger.log('Updating event:', event.id, data);
      return apiRequest('PATCH', `/api/event-requests/${event.id}`, data);
    },
    onSuccess: async (updatedEvent, variables) => {
      // Save succeeded — clear the autosaved draft for this event AND
      // clear any leftover save-error banner from a prior attempt.
      if (event) clearDraft(`event-edit:${event.id}`);
      setSaveError(null);
      await applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: event?.status,
        touchedFields: Object.keys(variables),
      });
      toast({
        title: 'Event updated',
        description: 'Your changes have been saved.',
      });
      onSaved?.();
      onClose();
    },
    onError: (error: any) => {
      logger.error('Failed to update event:', error);

      // Extract detailed error message - ApiError has .data with server response
      const serverMessage = error?.data?.message ||
                           error?.message ||
                           'There was an error saving your changes.';

      // Check for missing fields info from server
      const missingFields = error?.data?.missingFields;

      let errorTitle = 'Update failed';
      let errorDescription = serverMessage;

      // If server provided missing fields, include them in the message
      if (missingFields && Array.isArray(missingFields) && missingFields.length > 0) {
        errorDescription = `${serverMessage} Missing: ${missingFields.join(', ')}`;
      }

      // Preserve generic 409 handling in case another server-side conflict
      // guard reports one, but client-side _expectedVersion is no longer sent.
      const isConflict = error?.status === 409 || error?.data?.error === 'CONFLICT';
      if (isConflict) {
        errorTitle = 'Edit Conflict';
        errorDescription =
          'This event was modified by another user. Please close and reopen this dialog to see the latest data.';
        toast({
          title: errorTitle,
          description: errorDescription,
          variant: 'destructive',
        });
        // Also surface as a persistent banner so the user can't miss it.
        setSaveError({ title: errorTitle, message: errorDescription });
        return;
      }

      // Check for network/timeout errors
      const isNetworkError = error?.code?.includes('NETWORK_ERROR') ||
                             error?.message?.includes('Failed to fetch') ||
                             error?.message?.includes('Request timeout');
      if (isNetworkError) {
        errorTitle = 'Connection issue';
        errorDescription = 'Could not save changes due to a network issue. Please check your connection and try again.';
      }

      // Both signals: a notification toast (in case the user is looking
      // elsewhere) and a persistent banner inside the form (so the
      // reason is still there when they come back to it).
      toast({
        title: errorTitle,
        description: errorDescription,
        variant: 'destructive',
        duration: 10000,
      });
      setSaveError({
        title: errorTitle,
        message: errorDescription,
        missingFields:
          Array.isArray(missingFields) && missingFields.length > 0
            ? missingFields
            : undefined,
      });
    },
  });

  const handleSave = () => {
    // Clear any previous save-error banner; a fresh attempt deserves a
    // fresh state. If this attempt also fails, onError will repopulate it.
    setSaveError(null);
    const updates: any = {};
    console.log('[EventEditDialog] handleSave called');
    console.log('[EventEditDialog] Current state - tspContact:', tspContact, ', customTspContact:', customTspContact);
    console.log('[EventEditDialog] Original event - tspContact:', event?.tspContact, ', customTspContact:', event?.customTspContact);
    console.log('[EventEditDialog] vanDriverNeeded state:', vanDriverNeeded, 'event.vanDriverNeeded:', event?.vanDriverNeeded);

    // Logistics - use 0 as default for empty count fields (not null)
    // Compare against normalized values (null/undefined treated as 0)
    if (driversNeeded !== (event?.driversNeeded ?? 0).toString()) {
      updates.driversNeeded = driversNeeded ? parseInt(driversNeeded) : 0;
    }
    if (volunteersNeeded !== (event?.volunteersNeeded ?? 0).toString()) {
      updates.volunteersNeeded = volunteersNeeded ? parseInt(volunteersNeeded) : 0;
    }
    if (pickupTime !== formatTimeForInput(event?.pickupTime)) {
      updates.pickupTime = pickupTime || null;
    }
    if (eventStartTime !== formatTimeForInput(event?.eventStartTime)) {
      updates.eventStartTime = eventStartTime || null;
    }
    if (eventEndTime !== formatTimeForInput(event?.eventEndTime)) {
      updates.eventEndTime = eventEndTime || null;
    }
    if (pickupTimeWindow !== (event?.pickupTimeWindow || '')) {
      updates.pickupTimeWindow = pickupTimeWindow || null;
    }
    console.log('[EventEditDialog] vanDriverNeeded comparison:', vanDriverNeeded, '!==', (event?.vanDriverNeeded || false), '=', vanDriverNeeded !== (event?.vanDriverNeeded || false));
    if (vanDriverNeeded !== (event?.vanDriverNeeded || false)) {
      console.log('[EventEditDialog] Adding vanDriverNeeded to updates:', vanDriverNeeded);
      updates.vanDriverNeeded = vanDriverNeeded;
    }
    
    // Corporate Priority
    if (isCorporatePriority !== ((event as any)?.isCorporatePriority || false)) {
      updates.isCorporatePriority = isCorporatePriority;
    }

    // TSP Contact
    const currentTspContact = event?.tspContact || '';
    const currentCustomTspContact = event?.customTspContact || '';
    console.log('[EventEditDialog] TSP comparison - tspContact:', JSON.stringify(tspContact), 'currentTspContact:', JSON.stringify(currentTspContact), 'areEqual:', tspContact === currentTspContact);

    const tspContactChanged = tspContact !== currentTspContact;
    const customTspContactChanged = customTspContact !== currentCustomTspContact;

    if (tspContactChanged) {
      if (tspContact === 'custom') {
        updates.tspContact = null;
        console.log('[EventEditDialog] Setting updates.tspContact to null (custom mode)');
      } else {
        updates.tspContact = tspContact || null;
        console.log('[EventEditDialog] Setting updates.tspContact to:', JSON.stringify(updates.tspContact));
      }
    }
    if (customTspContactChanged) {
      updates.customTspContact = customTspContact || null;
      console.log('[EventEditDialog] Setting updates.customTspContact to:', JSON.stringify(updates.customTspContact));
    }

    // Set tspContactAssignedDate when TSP contact is being assigned/changed
    if (tspContactChanged || customTspContactChanged) {
      const hasNewTspContact = (tspContact && tspContact !== 'custom' && tspContact !== 'none') || customTspContact;
      if (hasNewTspContact) {
        updates.tspContactAssignedDate = new Date().toISOString();
        console.log('[EventEditDialog] Setting tspContactAssignedDate:', updates.tspContactAssignedDate);
      } else {
        // Clearing TSP contact - also clear the date
        updates.tspContactAssignedDate = null;
        console.log('[EventEditDialog] Clearing tspContactAssignedDate');
      }
    }

    // Staffing assignments
    const originalDriverIds = event ? getDriverIds(event) : [];
    if (JSON.stringify(assignedDriverIds.sort()) !== JSON.stringify(originalDriverIds.sort())) {
      updates.assignedDriverIds = assignedDriverIds;
      // Also update driverDetails JSONB to keep it in sync (source of truth)
      const driverDetailsObj = (event?.driverDetails || {}) as Record<string, { name?: string }>;
      const newDriverDetails: Record<string, { name?: string }> = {};
      assignedDriverIds.forEach(id => {
        newDriverDetails[id] = driverDetailsObj[id] || {};
      });
      updates.driverDetails = newDriverDetails;
    }

    const originalVolunteerIds = event ? getVolunteerIds(event) : [];
    if (JSON.stringify(assignedVolunteerIds.sort()) !== JSON.stringify(originalVolunteerIds.sort())) {
      updates.assignedVolunteerIds = assignedVolunteerIds;
      // Also update volunteerDetails JSONB to keep it in sync (source of truth)
      const volunteerDetailsObj = (event?.volunteerDetails || {}) as Record<string, { name?: string }>;
      const newVolunteerDetails: Record<string, { name?: string }> = {};
      assignedVolunteerIds.forEach(id => {
        newVolunteerDetails[id] = volunteerDetailsObj[id] || {};
      });
      updates.volunteerDetails = newVolunteerDetails;
    }

    if (assignedVanDriverId !== (event?.assignedVanDriverId || null)) {
      updates.assignedVanDriverId = assignedVanDriverId;
    }

    // Planned recipients (where sandwiches are going)
    const originalRecipientIds = parsePostgresArray((event as any)?.assignedRecipientIds);
    if (JSON.stringify(assignedRecipientIds.sort()) !== JSON.stringify(originalRecipientIds.sort())) {
      updates.assignedRecipientIds = assignedRecipientIds;
    }

    if (Object.keys(updates).length === 0) {
      console.log('[EventEditDialog] No changes detected, closing dialog');
      toast({
        description: 'No changes to save.',
      });
      onClose();
      return;
    }

    console.log('[EventEditDialog] Final updates object:', JSON.stringify(updates, null, 2));
    updateMutation.mutate(updates);
  };

  if (!event) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            Edit Event Details
            <Badge variant="outline" className="ml-2">
              #{event.id}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          {pendingRestoreDraft && (
            <div
              className={`mt-2 mb-4 border-l-4 rounded-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                draftIsStale
                  ? 'border-red-500 bg-red-50'
                  : 'border-amber-500 bg-amber-50'
              }`}
              role="alert"
            >
              <div className="text-sm">
                <div
                  className={`font-semibold ${
                    draftIsStale ? 'text-red-900' : 'text-amber-900'
                  }`}
                >
                  Unsaved edits found
                </div>
                <div
                  className={`mt-1 ${
                    draftIsStale ? 'text-red-800' : 'text-amber-800'
                  }`}
                >
                  A draft from{' '}
                  <span className="font-medium">
                    {formatDraftTimestamp(pendingRestoreDraft.savedAt)}
                  </span>{' '}
                  was autosaved for this event.{' '}
                  {draftIsStale
                    ? 'Note: the event has been updated by someone else since the draft was saved. Restoring may overwrite their changes.'
                    : 'Restore it, or discard and start fresh?'}
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
                  className={
                    draftIsStale
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                  }
                >
                  Restore draft
                </Button>
              </div>
            </div>
          )}
          <Tabs defaultValue="logistics" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="logistics">
                <Clock className="w-4 h-4 mr-2" />
                Logistics
              </TabsTrigger>
              <TabsTrigger value="staffing">
                <Users className="w-4 h-4 mr-2" />
                Staffing
              </TabsTrigger>
              <TabsTrigger value="activity">
                <History className="w-4 h-4 mr-2" />
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="logistics" className="space-y-4 mt-4">
              {/* Staffing Requirements */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="driversNeeded" className="flex items-center gap-1">
                    <Car className="w-4 h-4" /> Drivers Needed
                  </Label>
                  <Input
                    id="driversNeeded"
                    type="number"
                    min="0"
                    value={driversNeeded}
                    onChange={e => setDriversNeeded(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="volunteersNeeded" className="flex items-center gap-1">
                    <Users className="w-4 h-4" /> Volunteers Needed
                  </Label>
                  <Input
                    id="volunteersNeeded"
                    type="number"
                    min="0"
                    value={volunteersNeeded}
                    onChange={e => setVolunteersNeeded(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Van Driver */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  id="vanDriverNeeded"
                  checked={vanDriverNeeded}
                  onChange={e => {
                    setVanDriverNeeded(e.target.checked);
                    // When van driver is checked, default to no additional regular drivers needed
                    if (e.target.checked) {
                      setDriversNeeded('0');
                    }
                  }}
                  className="w-4 h-4"
                />
                <Label htmlFor="vanDriverNeeded" className="flex items-center gap-2 cursor-pointer">
                  <Truck className="w-4 h-4 text-amber-600" />
                  Van Driver Needed
                </Label>
              </div>

              {/* Corporate Priority */}
              <div className={`flex items-center space-x-3 p-3 rounded-lg border ${
                (event as any)?.isCorporatePriority && !canRemoveCorporatePriority 
                  ? 'bg-amber-100/70 border-amber-300' 
                  : 'bg-amber-50/50'
              }`}>
                <input
                  type="checkbox"
                  id="isCorporatePriority"
                  checked={isCorporatePriority}
                  onChange={(e) => setIsCorporatePriority(e.target.checked)}
                  disabled={(event as any)?.isCorporatePriority && !canRemoveCorporatePriority}
                  className={`h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500 ${
                    (event as any)?.isCorporatePriority && !canRemoveCorporatePriority 
                      ? 'opacity-60 cursor-not-allowed' 
                      : ''
                  }`}
                />
                <div>
                  <Label htmlFor="isCorporatePriority" className={`text-amber-900 font-medium ${
                    (event as any)?.isCorporatePriority && !canRemoveCorporatePriority 
                      ? 'cursor-not-allowed' 
                      : 'cursor-pointer'
                  }`}>
                    Corporate Priority Event
                  </Label>
                  <p className="text-xs text-amber-700">
                    {(event as any)?.isCorporatePriority && !canRemoveCorporatePriority 
                      ? 'Only Christine and Katie can remove the corporate priority flag.' 
                      : 'Mark this as a corporate priority event requiring immediate attention and core team member attendance.'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Times */}
              <div className="space-y-4">
                <h4 className="font-medium">Event Times</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pickupTime">Pickup Time</Label>
                    <Input
                      id="pickupTime"
                      type="time"
                      value={pickupTime}
                      onChange={e => setPickupTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pickupTimeWindow">Pickup Window</Label>
                    <Input
                      id="pickupTimeWindow"
                      value={pickupTimeWindow}
                      onChange={e => setPickupTimeWindow(e.target.value)}
                      placeholder="e.g. 30 minutes"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="eventStartTime">Event Start</Label>
                    <Input
                      id="eventStartTime"
                      type="time"
                      value={eventStartTime}
                      onChange={e => setEventStartTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="eventEndTime">Event End</Label>
                    <Input
                      id="eventEndTime"
                      type="time"
                      value={eventEndTime}
                      onChange={e => setEventEndTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* TSP Contact */}
              <div className="space-y-3">
                <h4 className="font-medium">TSP Contact</h4>
                <Select
                  value={tspContact || 'none'}
                  onValueChange={value => {
                    setTspContact(value === 'none' ? '' : value);
                    if (value && value !== 'custom' && value !== 'none') {
                      setCustomTspContact('');
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select TSP contact..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-gray-500">No TSP contact assigned</span>
                    </SelectItem>
                    {usersBasic.filter((u: any) => u.id).map((u: any) => {
                      const name = u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
                      return (
                        <SelectItem key={u.id} value={u.id}>
                          {name}
                        </SelectItem>
                      );
                    })}
                    <SelectItem value="custom">
                      <span className="italic">Enter custom contact...</span>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {tspContact === 'custom' && (
                  <Input
                    value={customTspContact}
                    onChange={e => setCustomTspContact(e.target.value)}
                    placeholder="Enter custom contact name"
                  />
                )}

                {tspContact && tspContact !== 'custom' && tspContact !== 'none' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => {
                      setTspContact('');
                      setCustomTspContact('');
                    }}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Remove TSP Contact
                  </Button>
                )}
              </div>

              <Separator />

              {/* Planned Recipients - Where are the sandwiches going */}
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Planned Recipients
                  {assignedRecipientIds.length > 0 && (
                    <Badge variant="secondary">{assignedRecipientIds.length} selected</Badge>
                  )}
                </h4>
                <p className="text-xs text-gray-500">Select where the sandwiches from this event will be delivered</p>

                {/* Selected recipients - detailed list */}
                {assignedRecipientIds.length > 0 ? (
                  <div className="space-y-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                    {assignedRecipientIds.map(recipientId => {
                      const recipient = recipients.find((r: any) => String(r.id) === recipientId);
                      return (
                        <div key={recipientId} className="flex items-center justify-between bg-white p-2 rounded border">
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{recipient?.name || `Recipient #${recipientId}`}</span>
                            {recipient && getRecipientDisplayRegion(recipient) && (
                              <span className="text-xs text-gray-500">{getRecipientDisplayRegion(recipient)}</span>
                            )}
                            {recipient?.address && (
                              <span className="text-xs text-gray-400">{recipient.address}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setAssignedRecipientIds(prev => prev.filter(id => id !== recipientId))}
                            className="ml-2 p-1 hover:bg-red-100 rounded-full text-red-500"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-center text-sm text-gray-500">
                    No recipients assigned yet. Use the dropdown below to add one.
                  </div>
                )}

                {/* Recipient selector */}
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value && !assignedRecipientIds.includes(value)) {
                      setAssignedRecipientIds(prev => [...prev, value]);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add a recipient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients
                      .filter((r: any) => r.status === 'active' && !assignedRecipientIds.includes(String(r.id)))
                      .map((r: any) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          <div className="flex flex-col">
                            <span>{r.name}</span>
                            {getRecipientDisplayRegion(r) && <span className="text-xs text-gray-500">{getRecipientDisplayRegion(r)}</span>}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="staffing" className="space-y-6 mt-4">
              {/* Drivers */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium flex items-center gap-2">
                    <Car className="w-4 h-4" />
                    Assigned Drivers
                    {parseInt(driversNeeded) > 0 && (
                      <Badge variant={assignedDriverIds.length >= parseInt(driversNeeded) ? 'secondary' : 'destructive'}>
                        {assignedDriverIds.length}/{driversNeeded}
                      </Badge>
                    )}
                  </h4>
                </div>
                <PersonSelector
                  selectedPeople={assignedDriverIds}
                  onSelectionChange={setAssignedDriverIds}
                  assignmentType="driver"
                  vanDriverNeeded={vanDriverNeeded}
                  assignmentDetails={parseAssignmentDetails(event?.driverDetails)}
                />
              </div>

              <Separator />

              {/* Van Driver (if needed) */}
              {vanDriverNeeded && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium flex items-center gap-2">
                        <Truck className="w-4 h-4 text-amber-600" />
                        Van Driver
                        {assignedVanDriverId ? (
                          <Badge variant="secondary">Assigned</Badge>
                        ) : (
                          <Badge variant="destructive">Needed</Badge>
                        )}
                      </h4>
                    </div>
                    <PersonSelector
                      selectedPeople={assignedVanDriverId ? [assignedVanDriverId] : []}
                      onSelectionChange={ids => setAssignedVanDriverId(ids[0] || null)}
                      assignmentType="driver"
                      vanDriverNeeded={true}
                      assignmentDetails={parseAssignmentDetails(event?.driverDetails)}
                    />
                  </div>
                  <Separator />
                </>
              )}

              {/* Volunteers */}
              {(parseInt(volunteersNeeded) > 0 || assignedVolunteerIds.length > 0) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Assigned Volunteers
                      {parseInt(volunteersNeeded) > 0 && (
                        <Badge variant={assignedVolunteerIds.length >= parseInt(volunteersNeeded) ? 'secondary' : 'destructive'}>
                          {assignedVolunteerIds.length}/{volunteersNeeded}
                        </Badge>
                      )}
                    </h4>
                  </div>
                  <PersonSelector
                    selectedPeople={assignedVolunteerIds}
                    onSelectionChange={setAssignedVolunteerIds}
                    assignmentType="volunteer"
                    assignmentDetails={parseAssignmentDetails(event?.volunteerDetails)}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <EventRequestAuditLog
                eventId={event.id?.toString()}
                showFilters={false}
                compact={true}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Persistent save-error banner. Sits directly above the Save
            button so the reason a save was rejected is impossible to
            miss — and stays visible until the user retries or closes
            the dialog. Complements (does not replace) the destructive
            toast that fires on the same error path. */}
        {saveError && (
          <div
            role="alert"
            className="mx-6 mb-2 rounded-md border-2 border-[#A31C41] bg-red-50 px-4 py-3 text-sm text-[#A31C41] flex items-start gap-3"
            data-testid="banner-save-error"
          >
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{saveError.title}</p>
              <p className="mt-0.5 text-[#7a1530]">{saveError.message}</p>
              {saveError.missingFields && saveError.missingFields.length > 0 && (
                <ul className="mt-1.5 list-disc list-inside text-[#7a1530] space-y-0.5">
                  {saveError.missingFields.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="text-[#A31C41]/70 hover:text-[#A31C41] flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-4 pb-6 px-6 border-t flex-shrink-0">
          <div className="text-xs text-gray-500 italic min-h-[1rem]">
            {draftSavedAt
              ? `Draft autosaved ${formatDraftTimestamp(draftSavedAt)}`
              : ''}
          </div>
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
