import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search,
  User,
  Car,
  Truck,
  Building,
  Check,
  X,
  UserPlus,
  Users,
  CheckCircle,
  XCircle,
  HelpCircle,
  ExternalLink,
  Loader2,
  CircleHelp,
} from 'lucide-react';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import type { AvailabilitySlot } from '@shared/schema';
import { logger } from '@/lib/logger';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

interface ComprehensivePersonSelectorProps {
  selectedPeople: string[];
  onSelectionChange: (selected: string[]) => void;
  assignmentType: 'driver' | 'volunteer' | null;
  availabilitySlots: AvailabilitySlot[];
  isLoadingAvailability: boolean;
  vanDriverNeeded?: boolean;
}

function ComprehensivePersonSelector({
  selectedPeople,
  onSelectionChange,
  assignmentType,
  availabilitySlots,
  isLoadingAvailability,
  vanDriverNeeded = false
}: ComprehensivePersonSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [customEntryText, setCustomEntryText] = useState('');
  const [showCustomEntry, setShowCustomEntry] = useState(false);

  // Helper function to get availability status for a user ID
  const getAvailabilityStatus = (userId: string): 'available' | 'unavailable' | 'not_set' => {
    // Custom entries and non-user types don't have availability
    if (userId.startsWith('custom-') || userId.startsWith('volunteer-') || userId.startsWith('host-contact-')) {
      return 'not_set';
    }

    // Check if user has any availability slot
    const userSlot = availabilitySlots.find(slot => slot.userId === userId);
    
    if (!userSlot) {
      return 'not_set';
    }

    return userSlot.status === 'available' ? 'available' : 'unavailable';
  };

  // Fetch all the different types of people
  const { data: users = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ['/api/users/for-assignments'],
  });

  const { data: drivers = [], isLoading: driversLoading, error: driversError } = useQuery<any[]>({
    queryKey: ['/api/drivers'],
  });

  const { data: volunteers = [], isLoading: volunteersLoading, error: volunteersError } = useQuery<any[]>({
    queryKey: ['/api/volunteers'],
  });

  const { data: hostsWithContacts = [], isLoading: hostsLoading } = useQuery<any[]>({
    queryKey: ['/api/hosts-with-contacts'],
  });

  const isLoading = usersLoading || driversLoading || volunteersLoading || hostsLoading;

  // Debug logging for driver/volunteer list issue
  console.log('[AssignmentDialog] Query results:', {
    usersCount: users.length,
    driversCount: drivers.length,
    volunteersCount: volunteers.length,
    hostsWithContactsCount: hostsWithContacts.length,
    isLoading,
    driversLoading,
    volunteersLoading,
    driversError: driversError?.message || null,
    volunteersError: volunteersError?.message || null
  });

  // Extract all host contacts
  const hostContacts = hostsWithContacts.flatMap(host =>
    (host.contacts || []).map((contact: any) => ({
      ...contact,
      hostName: host.name,
      displayName: contact.name || contact.email || 'Unknown Contact',
      type: 'host-contact'
    }))
  );

  // Create lookup map for ALL drivers (for name resolution of already-assigned drivers)
  const driverNameLookup = new Map<string, string>();
  drivers.forEach((driver: any) => {
    driverNameLookup.set(driver.id.toString(), driver.name || 'Unknown Driver');
  });

  // Create lookup map for ALL host contacts (for name resolution of already-assigned host contacts)
  const hostContactNameLookup = new Map<string, string>();
  hostContacts.forEach((contact: any) => {
    hostContactNameLookup.set(`host-contact-${contact.id}`, contact.displayName || contact.name || 'Unknown Contact');
  });

  // Filter all people based on search term
  const allPeople = [
    ...users.map((user: any) => ({
      id: user.id,
      displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName || user.email || 'Unknown User',
      email: user.email,
      type: 'user',
      section: 'Team Members'
    })),
    ...drivers
      // Filter for active drivers who are not busy/off-duty - van-approved when van driver is needed
      .filter((driver: any) => {
        if (!driver.isActive) return false;
        // Exclude busy or off-duty drivers
        if (driver.availability === 'busy' || driver.availability === 'off-duty') return false;
        // Exclude temporarily unavailable drivers from driver assignments (they can still volunteer)
        if (assignmentType === 'driver' && driver.temporarilyUnavailable) return false;
        // Filter for van-approved drivers when van driver is needed
        if (assignmentType === 'driver' && vanDriverNeeded) {
          return driver.vanApproved === true;
        }
        return true;
      })
      .map((driver: any) => ({
        id: driver.id.toString(),
        displayName: driver.name,
        email: driver.email,
        phone: driver.phone,
        type: 'driver',
        section: 'Drivers',
        vanApproved: driver.vanApproved
      })),
    ...volunteers.map((volunteer: any) => ({
      id: `volunteer-${volunteer.id}`,
      displayName: `${volunteer.firstName || ''} ${volunteer.lastName || ''}`.trim() || volunteer.name || 'Unknown Volunteer',
      email: volunteer.email,
      phone: volunteer.phone,
      type: 'volunteer',
      section: 'Volunteers'
    })),
    ...hostContacts.map((contact: any) => ({
      id: `host-contact-${contact.id}`,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      hostName: contact.hostName,
      type: 'host-contact',
      section: 'Host Contacts'
    }))
  ].filter(person => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return person.displayName.toLowerCase().includes(searchLower) ||
           (person.email && person.email.toLowerCase().includes(searchLower)) ||
           ((person as any).phone && (person as any).phone.toLowerCase().includes(searchLower)) ||
           ((person as any).hostName && (person as any).hostName.toLowerCase().includes(searchLower));
  });

  // Sort all people alphabetically by displayName
  const sortedPeople = allPeople.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  );

  // Group people by section and sort within each section
  const groupedPeople = sortedPeople.reduce((acc, person) => {
    if (!acc[person.section]) acc[person.section] = [];
    acc[person.section].push(person);
    return acc;
  }, {} as Record<string, any[]>);

  // Debug logging for sections
  console.log('[AssignmentDialog] Final sections:', {
    allPeopleCount: allPeople.length,
    sections: Object.keys(groupedPeople),
    sectionCounts: Object.fromEntries(Object.entries(groupedPeople).map(([k, v]) => [k, (v as any[]).length]))
  });

  const togglePersonSelection = (personId: string) => {
    if (selectedPeople.includes(personId)) {
      onSelectionChange(selectedPeople.filter(id => id !== personId));
    } else {
      onSelectionChange([...selectedPeople, personId]);
    }
  };

  const removeSelectedPerson = (personId: string) => {
    onSelectionChange(selectedPeople.filter(id => id !== personId));
  };

  const handleAddCustomEntry = () => {
    if (customEntryText.trim()) {
      // Create a custom ID that won't conflict with existing IDs
      const customId = `custom-${Date.now()}-${customEntryText.replace(/\s+/g, '-')}`;
      onSelectionChange([...selectedPeople, customId]);
      setCustomEntryText('');
      setShowCustomEntry(false);
    }
  };

  // Helper to get display name for any person ID (including already-assigned unavailable drivers/contacts)
  const getPersonDisplayName = (personId: string) => {
    if (personId.startsWith('custom-')) {
      // Extract the custom name from the ID
      const parts = personId.split('-');
      return parts.slice(2).join(' ').replace(/-/g, ' ') || personId;
    }
    // First check allPeople (for available/selectable people)
    const person = allPeople.find(p => p.id === personId);
    if (person?.displayName) return person.displayName;
    // Fall back to driver lookup (for already-assigned unavailable drivers)
    const driverName = driverNameLookup.get(personId);
    if (driverName) return driverName;
    // Fall back to host contact lookup (for already-assigned host contacts)
    const hostContactName = hostContactNameLookup.get(personId);
    if (hostContactName) return hostContactName;
    // Final fallback to personId
    return personId;
  };

  return (
    <div className="flex-1 flex flex-col space-y-4">
      {/* Search and Custom Entry Controls */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tsp-teal w-4 h-4" aria-hidden="true" />
          <Input
            placeholder="Search by name, email, phone, or organization..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 border-tsp-teal/30 focus:border-tsp-teal focus:ring-tsp-teal/20"
          />
        </div>

        {/* Custom Entry Section */}
        <div className="space-y-2">
          {!showCustomEntry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCustomEntry(true)}
              className="w-full border-tsp-teal/30 text-tsp-teal hover:bg-tsp-teal/5 hover:border-tsp-teal"
            >
              <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
              Add Custom Entry (Person Not in List)
            </Button>
          ) : (
            <div className="flex gap-2 p-3 bg-tsp-teal/5 rounded-lg border border-tsp-teal/20">
              <Input
                placeholder="Enter name for custom assignment..."
                value={customEntryText}
                onChange={(e) => setCustomEntryText(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomEntry();
                  }
                }}
                className="flex-1"
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                onClick={handleAddCustomEntry}
                disabled={!customEntryText.trim()}
                className="bg-tsp-teal hover:bg-tsp-teal text-white"
              >
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowCustomEntry(false);
                  setCustomEntryText('');
                }}
                className="hover:bg-tsp-teal/10"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Selected People */}
      {selectedPeople.length > 0 && (
        <div className="space-y-2 p-3 bg-tsp-teal/5 rounded-lg border border-tsp-teal/10">
          <h3 className="text-sm font-semibold text-tsp-teal uppercase tracking-wide">
            Selected {assignmentType ? assignmentType.charAt(0).toUpperCase() + assignmentType.slice(1) + 's' : 'People'} ({selectedPeople.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {selectedPeople.map((personId) => {
              const isCustom = personId.startsWith('custom-');
              return (
                <Badge
                  key={personId}
                  variant="secondary"
                  className={isCustom ? "bg-tsp-cream text-tsp-navy border border-tsp-gold font-medium" : "bg-tsp-teal/10 text-tsp-teal border border-tsp-teal/30 font-medium"}
                >
                  {getPersonDisplayName(personId)}
                  {isCustom && <span className="ml-1 text-xs">(custom)</span>}
                  <button
                    onClick={() => removeSelectedPerson(personId)}
                    className="ml-2 hover:bg-tsp-teal/20 rounded-full w-4 h-4 flex items-center justify-center"
                    aria-label={`Remove ${getPersonDisplayName(personId)}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Available People by Category */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-96">
          <div className="space-y-6 pr-4">
            {Object.entries(groupedPeople).map(([section, people]) => (
              <div key={section}>
                <h3 className="text-sm font-semibold text-tsp-teal uppercase tracking-wide mb-3 pb-2 border-b border-tsp-teal/10">
                  {section} ({people.length})
                </h3>
                <div className="space-y-2">
                  {people.map((person) => {
                    const isSelected = selectedPeople.includes(person.id);
                    const availabilityStatus = getAvailabilityStatus(person.id);
                    
                    return (
                      <button
                        key={person.id}
                        type="button"
                        className={`w-full text-left p-3 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-tsp-teal/10 border-tsp-teal text-tsp-teal shadow-sm'
                            : 'bg-white border-gray-200 hover:bg-tsp-teal/5 hover:border-tsp-teal/30'
                        }`}
                        onClick={() => togglePersonSelection(person.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 flex-1">
                            {person.type === 'user' && <User className="w-4 h-4 text-tsp-teal" aria-hidden="true" />}
                            {person.type === 'driver' && <Car className="w-4 h-4 text-tsp-sky" aria-hidden="true" />}
                            {person.type === 'volunteer' && <Users className="w-4 h-4 text-tsp-gold" aria-hidden="true" />}
                            {person.type === 'host-contact' && <Building className="w-4 h-4 text-tsp-teal" aria-hidden="true" />}
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <div className="font-medium">{person.displayName}</div>
                                {/* Availability indicator */}
                                {!isLoadingAvailability && person.type === 'user' && (
                                  <>
                                    {availabilityStatus === 'available' && (
                                      <Badge variant="outline" className="bg-tsp-teal/10 text-tsp-teal border border-tsp-teal/30 text-xs font-medium">
                                        <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                                        Available
                                      </Badge>
                                    )}
                                    {availabilityStatus === 'unavailable' && (
                                      <Badge variant="outline" className="bg-tsp-red/10 text-tsp-red border border-tsp-red/30 text-xs font-medium">
                                        <XCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                                        Unavailable
                                      </Badge>
                                    )}
                                    {availabilityStatus === 'not_set' && (
                                      <Badge variant="outline" className="bg-gray-50 text-gray-600 border border-gray-300 text-xs font-medium">
                                        <HelpCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                                        Not Set
                                      </Badge>
                                    )}
                                  </>
                                )}
                                {isLoadingAvailability && person.type === 'user' && (
                                  <Loader2 className="w-3 h-3 animate-spin text-tsp-teal" aria-hidden="true" />
                                )}
                              </div>
                              {person.email && (
                                <div className="text-sm text-gray-500">{person.email}</div>
                              )}
                              {person.phone && (
                                <div className="text-sm text-gray-500">{person.phone}</div>
                              )}
                              {person.hostName && (
                                <div className="text-sm text-gray-500">Host: {person.hostName}</div>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <Check className="w-5 h-5 text-tsp-teal flex-shrink-0" aria-hidden="true" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {isLoading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center pointer-events-none">
          <div className="text-sm text-gray-500">Loading people...</div>
        </div>
      )}
    </div>
  );
}

interface AssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  assignmentType: 'driver' | 'volunteer' | null;
  selectedAssignees: string[];
  setSelectedAssignees: (assignees: string[]) => void;
  onAssign: (assignees: string[], isTentative: boolean) => void;
  isVanDriverAssignment?: boolean;
}

export const AssignmentDialog: React.FC<AssignmentDialogProps> = ({
  isOpen,
  onClose,
  assignmentType,
  selectedAssignees,
  setSelectedAssignees,
  onAssign,
  isVanDriverAssignment = false,
}) => {
  // Tentative assignment state
  const [isTentative, setIsTentative] = useState(false);

  // Get context to find the event date
  const { eventRequests } = useEventRequestContext();
  const { assignmentEventId } = useEventDialogState();

  // Find the current event request
  const currentEvent = useMemo(() => {
    return eventRequests.find(e => e.id === assignmentEventId);
  }, [eventRequests, assignmentEventId]);

  // Extract event date (use scheduledEventDate if available, otherwise desiredEventDate)
  const eventDate = useMemo(() => {
    if (!currentEvent) return null;
    
    const dateToUse = getEffectiveEventDate(currentEvent);
    if (!dateToUse) return null;

    // Format as YYYY-MM-DD for the API
    const date = new Date(dateToUse);
    return date.toISOString().split('T')[0];
  }, [currentEvent]);

  // Fetch availability data for the event date
  const { data: availabilitySlots = [], isLoading: isLoadingAvailability } = useQuery<AvailabilitySlot[]>({
    queryKey: ['/api/availability', eventDate],
    enabled: !!eventDate && isOpen, // Only fetch when dialog is open and we have a date
    queryFn: async () => {
      if (!eventDate) return [];
      const response = await fetch(`/api/availability?startDate=${eventDate}&endDate=${eventDate}`);
      if (!response.ok) {
        logger.error('Failed to fetch availability');
        return [];
      }
      return response.json();
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
        setSelectedAssignees([]);
        setIsTentative(false);
      }
    }}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader className="border-b border-tsp-teal/10 pb-4">
          <DialogTitle className="flex items-center gap-2 text-tsp-teal text-xl">
            <UserPlus className="w-5 h-5 text-tsp-teal" aria-hidden="true" />
            Assign {assignmentType ? assignmentType.charAt(0).toUpperCase() + assignmentType.slice(1) + 's' : 'People'}
          </DialogTitle>
          <DialogDescription className="text-gray-600 mt-2">
            {assignmentType === 'driver' && isVanDriverAssignment ? (
              <span className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-amber-600" />
                Van driver assignment - only showing van-approved drivers. Select a van-approved driver to assign.
              </span>
            ) : (
              `Select people to assign as ${assignmentType ? assignmentType + 's' : 'people'} for this event. You can choose from team members, drivers, volunteers, and host contacts.`
            )}
          </DialogDescription>
        </DialogHeader>

        {/* View Team Availability Link */}
        <div className="flex items-center justify-end pt-2">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => window.open('/team-availability', '_blank')}
            className="text-tsp-teal hover:text-tsp-teal font-medium"
            data-testid="link-view-team-availability"
          >
            <ExternalLink className="w-4 h-4 mr-1" aria-hidden="true" />
            View Full Team Availability Calendar
          </Button>
        </div>

        <ComprehensivePersonSelector
          selectedPeople={selectedAssignees}
          onSelectionChange={setSelectedAssignees}
          assignmentType={assignmentType}
          availabilitySlots={availabilitySlots}
          isLoadingAvailability={isLoadingAvailability}
          vanDriverNeeded={isVanDriverAssignment}
        />

        <div className="flex items-center justify-between pt-4 border-t border-tsp-teal/10">
          {/* Tentative checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="tentative-assignment"
              checked={isTentative}
              onCheckedChange={(checked) => setIsTentative(checked === true)}
              className="border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
            />
            <Label
              htmlFor="tentative-assignment"
              className="text-sm font-medium text-gray-700 cursor-pointer flex items-center gap-1.5"
            >
              <CircleHelp className="w-4 h-4 text-amber-500" aria-hidden="true" />
              Mark as tentative
              <span className="text-xs text-gray-500">(shown with ? badge)</span>
            </Label>
          </div>

          <div className="flex space-x-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onAssign(selectedAssignees, isTentative)}
              className={isTentative
                ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                : "bg-tsp-teal hover:bg-tsp-teal text-white shadow-sm"
              }
              disabled={selectedAssignees.length === 0}
            >
              {isTentative ? (
                <CircleHelp className="w-4 h-4 mr-2" aria-hidden="true" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {isTentative ? 'Add Tentative' : 'Assign'} {selectedAssignees.length} {assignmentType}
              {selectedAssignees.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};