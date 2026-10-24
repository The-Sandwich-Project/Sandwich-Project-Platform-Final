import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useEventDialogState } from '../context/EventDialogContext';
import { useEventMutations } from '../hooks/useEventMutations';
import { useEventAssignments } from '../hooks/useEventAssignments';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit2,
  Save,
  X,
  Calendar,
  MapPin,
  Phone,
  Mail,
  Users,
  Package,
  Clock,
  Car,
  UserPlus,
  FileText,
  GripVertical,
  Eye,
  Plus,
  Trash2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { format } from 'date-fns';
import type { EventRequest } from '@shared/schema';
import { parseSandwichTypes } from '@/lib/sandwich-utils';
import { hasActiveSandwichRange, hasActiveSandwichTypes } from '@shared/sandwich-count-utils';
import {
  getDriverIds, getDriverCount, getTotalDriverCount,
  getVolunteerIds, getVolunteerCount
} from '@/lib/assignment-utils';
import { SANDWICH_TYPES } from '../constants';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface Column {
  id: string;
  label: string;
  width?: string;
  sortable?: boolean;
  hideOnMobile?: boolean;
  frozen?: boolean;
  center?: boolean;
  render?: (event: EventRequest) => React.ReactNode | string | { fullText: string; hasContent: boolean };
}

type SortField = 'eventDate' | 'groupName' | 'eventStartTime' | 'pickupTime' | 'estimatedSandwiches' | 'tspContact';
type SortDirection = 'asc' | 'desc';

interface ScheduledSpreadsheetViewProps {
  onEventDateClick?: (event: EventRequest) => void;
  openAssignmentDialog?: (eventId: number, type: 'driver' | 'volunteer') => void;
}

// Standalone component for staff need badge with popover (extracted to prevent re-mount on parent re-render)
interface StaffNeedBadgeProps {
  field: 'driversNeeded' | 'volunteersNeeded';
  needed: number;
  unfilled: number;
  Icon: React.ElementType;
  label: string;
  onUpdate: (field: 'driversNeeded' | 'volunteersNeeded', delta: number) => void;
}

const StaffNeedBadge: React.FC<StaffNeedBadgeProps> = ({ field, needed, unfilled, Icon, label, onUpdate }) => {
  if (needed === 0) return null;

  const isFilled = unfilled === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            isFilled
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          }`}
          title={`${label}: ${needed} needed, ${unfilled} unfilled. Click to edit.`}
        >
          <Icon className="h-3 w-3" />
          <span>{needed}</span>
          {!isFilled && <span className="text-amber-500">({unfilled})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-2" align="start">
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-600">{label} Needed</div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => onUpdate(field, -1)}
              disabled={needed === 0}
              className="w-8 h-8 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 font-bold"
            >
              -
            </button>
            <span className="min-w-[32px] text-center text-lg font-semibold text-[#236383]">{needed}</span>
            <button
              onClick={() => onUpdate(field, 1)}
              className="w-8 h-8 flex items-center justify-center rounded bg-[#47B3CB]/30 hover:bg-[#47B3CB]/50 text-[#236383] font-bold"
            >
              +
            </button>
          </div>
          <div className="text-xs text-gray-500 text-center">
            {unfilled > 0 ? `${unfilled} still needed` : 'All filled ✓'}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Standalone component for "Add Staff Need" dropdown (extracted to prevent re-mount on parent re-render)
interface AddStaffNeedDropdownProps {
  compact?: boolean;
  onlyShowMissing?: boolean;
  onUpdate: (field: 'driversNeeded' | 'volunteersNeeded', delta: number) => void;
  driversNeeded: number;
  volunteersNeeded: number;
}

const AddStaffNeedDropdown: React.FC<AddStaffNeedDropdownProps> = ({
  compact = false,
  onlyShowMissing = false,
  onUpdate,
  driversNeeded,
  volunteersNeeded
}) => {
  const showDriver = !onlyShowMissing || driversNeeded === 0;
  const showVolunteer = !onlyShowMissing || volunteersNeeded === 0;
  const hasAnyOptions = showDriver || showVolunteer;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {compact ? (
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Add another staff need"
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : (
          <button
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
            title="Add staff need"
          >
            <Plus className="h-3 w-3" />
            <span>Add Need</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-gray-600 mb-2">Add Staff Need</div>
          {showDriver && (
            <button
              onClick={() => onUpdate('driversNeeded', 1)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <Car className="h-4 w-4 text-[#236383]" />
              <span>Driver</span>
            </button>
          )}
          {showVolunteer && (
            <button
              onClick={() => onUpdate('volunteersNeeded', 1)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <UserPlus className="h-4 w-4 text-[#236383]" />
              <span>Volunteer</span>
            </button>
          )}
          {!hasAnyOptions && (
            <div className="text-xs text-gray-400 text-center py-1">All roles added</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// US state abbreviations for address parsing
const US_STATES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'dc': 'DC',
};

// Format address input into proper "Street, City, ST ZIP" format
const formatAddress = (input: string): string => {
  if (!input || input.trim() === '') return '';

  let address = input.trim();

  // If already looks well-formatted, just clean it up
  if (/^\d+\s+[\w\s]+,\s*[\w\s]+,\s*[A-Z]{2}\s*\d{5}(-\d{4})?$/.test(address)) {
    return address;
  }

  // Split by common delimiters: commas, multiple spaces, or newlines
  let parts = address
    .replace(/\n/g, ', ')
    .split(/[,]+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // If only one part, try splitting on multiple spaces
  if (parts.length === 1) {
    parts = address.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  }

  // Extract ZIP code from anywhere in the address
  let zipCode = '';
  const zipMatch = address.match(/\b(\d{5})(-\d{4})?\b/);
  if (zipMatch) {
    zipCode = zipMatch[0];
    // Remove ZIP from parts to avoid duplication
    parts = parts.map(p => p.replace(/\b\d{5}(-\d{4})?\b/, '').trim()).filter(p => p.length > 0);
  }

  // Find and normalize state abbreviation or full state name
  let stateAbbr = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].toLowerCase();

    // Check for 2-letter state abbreviation
    if (/^[a-z]{2}$/i.test(parts[i].trim())) {
      const abbr = parts[i].trim().toUpperCase();
      if (Object.values(US_STATES).includes(abbr)) {
        stateAbbr = abbr;
        parts.splice(i, 1);
        break;
      }
    }

    // Check for full state name
    for (const [stateName, abbr] of Object.entries(US_STATES)) {
      if (part.includes(stateName)) {
        stateAbbr = abbr;
        parts[i] = parts[i].toLowerCase().replace(stateName, '').trim();
        if (parts[i].length === 0) parts.splice(i, 1);
        break;
      }
    }
    if (stateAbbr) break;

    // Check if state abbr is attached to city (e.g., "Dallas TX")
    const stateAtEnd = parts[i].match(/\s+([A-Z]{2})$/i);
    if (stateAtEnd) {
      const possibleAbbr = stateAtEnd[1].toUpperCase();
      if (Object.values(US_STATES).includes(possibleAbbr)) {
        stateAbbr = possibleAbbr;
        parts[i] = parts[i].replace(/\s+[A-Z]{2}$/i, '').trim();
        break;
      }
    }
  }

  // Capitalize street type abbreviations properly
  const streetTypes: Record<string, string> = {
    'st': 'St', 'street': 'St', 'str': 'St',
    'ave': 'Ave', 'avenue': 'Ave', 'av': 'Ave',
    'blvd': 'Blvd', 'boulevard': 'Blvd',
    'rd': 'Rd', 'road': 'Rd',
    'dr': 'Dr', 'drive': 'Dr',
    'ln': 'Ln', 'lane': 'Ln',
    'ct': 'Ct', 'court': 'Ct',
    'pl': 'Pl', 'place': 'Pl',
    'cir': 'Cir', 'circle': 'Cir',
    'way': 'Way',
    'pkwy': 'Pkwy', 'parkway': 'Pkwy',
    'hwy': 'Hwy', 'highway': 'Hwy',
  };

  // Directional abbreviations
  const directions: Record<string, string> = {
    'n': 'N', 'north': 'N',
    's': 'S', 'south': 'S',
    'e': 'E', 'east': 'E',
    'w': 'W', 'west': 'W',
    'ne': 'NE', 'northeast': 'NE',
    'nw': 'NW', 'northwest': 'NW',
    'se': 'SE', 'southeast': 'SE',
    'sw': 'SW', 'southwest': 'SW',
  };

  // Title case each part and normalize abbreviations
  const titleCase = (str: string): string => {
    return str.replace(/\b\w+\b/g, (word) => {
      const lower = word.toLowerCase();

      // Check for street type
      if (streetTypes[lower]) return streetTypes[lower];

      // Check for direction
      if (directions[lower]) return directions[lower];

      // Regular title case
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  };

  // Process parts
  parts = parts.map(p => titleCase(p));

  // Reconstruct address
  if (parts.length === 0) return address; // Return original if we couldn't parse

  let formattedAddress = parts.join(', ');

  // Add state and zip if we found them
  if (stateAbbr) {
    if (zipCode) {
      formattedAddress += `, ${stateAbbr} ${zipCode}`;
    } else {
      formattedAddress += `, ${stateAbbr}`;
    }
  } else if (zipCode) {
    formattedAddress += ` ${zipCode}`;
  }

  return formattedAddress;
};

export const ScheduledSpreadsheetView: React.FC<ScheduledSpreadsheetViewProps> = ({ onEventDateClick, openAssignmentDialog }) => {
  const {
    eventRequests,
    setActiveTab,
  } = useEventRequestContext();

  const {
    editingScheduledId,
    setEditingScheduledId,
    editingField,
    setEditingField,
    editingValue,
    setEditingValue,
    setSelectedEventRequest,
  } = useEventDialogState();

  const { updateEventRequestMutation, updateScheduledFieldMutation } = useEventMutations();
  const { resolveUserName } = useEventAssignments();
  const { trackEvent, trackButtonClick } = useAnalytics();
  const isMobile = useIsMobile();

  // Fetch recipients for displaying assigned recipient names
  const { data: recipients = [], isLoading: recipientsLoading } = useQuery<Array<{ id: number; name: string; organizationName?: string }>>({
    queryKey: ['/api/recipients'],
    staleTime: 5 * 60 * 1000,
  });

  // Fetch hosts as fallback (some "recipient" IDs are actually host IDs)
  const { data: hosts = [], isLoading: hostsLoading } = useQuery<Array<{ id: number; name: string; locationName?: string }>>({
    queryKey: ['/api/hosts'],
    staleTime: 5 * 60 * 1000,
  });

  // Resolve recipient ID to name - checks both recipients AND hosts tables
  const resolveRecipientName = (recipientId: string): string => {
    if (!recipientId) return '';

    // If data hasn't loaded yet, show a placeholder
    if (recipientsLoading && hostsLoading) {
      return 'Loading...';
    }

    // Handle prefixed format like "recipient:5" or "host:5"
    const [prefix, id] = recipientId.includes(':') ? recipientId.split(':') : ['', recipientId];
    const numId = parseInt(id, 10);

    if (isNaN(numId)) return recipientId;

    // Try to find in recipients first
    const recipient = recipients.find(r => r.id === numId || String(r.id) === id);
    if (recipient) {
      return recipient.name || (recipient as any).organizationName || `Recipient ${numId}`;
    }

    // If not found in recipients, check hosts (this handles cases where host IDs are stored in assignedRecipientIds)
    const host = hosts.find(h => h.id === numId || String(h.id) === id);
    if (host) {
      return host.name || host.locationName || `Host ${numId}`;
    }
    
    // If still not found in either table, return a descriptive fallback
    return `Unknown (ID: ${numId})`;
  };

  const [sortField, setSortField] = useState<SortField>('eventDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'thisWeek' | 'nextWeek' | 'next2Weeks' | 'thisMonth' | 'nextMonth' | 'all'>('next2Weeks');
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    // Load saved column order from localStorage
    const saved = localStorage.getItem('scheduledSpreadsheetColumnOrder');
    return saved ? JSON.parse(saved) : null;
  });

  // Column width state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    // Load saved column widths from localStorage
    const saved = localStorage.getItem('scheduledSpreadsheetColumnWidths');
    return saved ? JSON.parse(saved) : {};
  });

  const [resizingColumn, setResizingColumn] = useState<{ id: string; startX: number; startWidth: number } | null>(null);

  // Sandwich types dialog state
  const [showSandwichDialog, setShowSandwichDialog] = useState(false);
  const [sandwichDialogEventId, setSandwichDialogEventId] = useState<number | null>(null);
  const [dialogSandwichTypes, setDialogSandwichTypes] = useState<Array<{ type: string; quantity: number }>>([]);

  // Time editing state for AM/PM
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('AM');

  // Fullscreen mode state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Filter to scheduled events only
  const scheduledEvents = useMemo(() => {
    return eventRequests.filter(req => isScheduledOrRescheduled(req.status));
  }, [eventRequests]);

  // Filter by date range
  const dateFilteredEvents = useMemo(() => {
    if (dateRange === 'all') return scheduledEvents;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startDate = new Date(today);
    let endDate = new Date(today);
    
    switch (dateRange) {
      case 'thisWeek':
        // Start of this week (Sunday)
        const dayOfWeek = today.getDay();
        startDate.setDate(today.getDate() - dayOfWeek);
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'nextWeek':
        // Next week (Sunday to Saturday)
        const nextWeekStart = new Date(today);
        const daysUntilNextSunday = 7 - today.getDay();
        nextWeekStart.setDate(today.getDate() + daysUntilNextSunday);
        startDate = nextWeekStart;
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'next2Weeks':
        // Next 2 weeks from today
        startDate = new Date(today);
        endDate = new Date(today);
        endDate.setDate(today.getDate() + 14);
        break;
      case 'thisMonth':
        // Current calendar month (1st to last day of current month)
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Last day of current month
        break;
      case 'nextMonth':
        // Next calendar month (e.g., if today is Nov 30, show all of December)
        startDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0); // Last day of next month
        break;
    }
    
    endDate.setHours(23, 59, 59, 999);
    
    return scheduledEvents.filter(event => {
      const eventDate = getEffectiveEventDate(event);
      if (!eventDate) return false;
      
      // Use timezone-safe date parsing
      let eventDateObj: Date;
      const dateStr = typeof eventDate === 'string' ? eventDate : eventDate.toISOString();
      
      if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        const dateOnly = dateStr.split(' ')[0];
        eventDateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
        const dateOnly = dateStr.split('T')[0];
        eventDateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        eventDateObj = new Date(dateStr + 'T12:00:00');
      } else {
        const tempDate = new Date(dateStr);
        if (isNaN(tempDate.getTime())) return false;
        const year = tempDate.getUTCFullYear();
        const month = String(tempDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(tempDate.getUTCDate()).padStart(2, '0');
        eventDateObj = new Date(`${year}-${month}-${day}T12:00:00`);
      }
      
      // Normalize comparison dates to noon as well
      const compareStart = new Date(startDate);
      compareStart.setHours(12, 0, 0, 0);
      const compareEnd = new Date(endDate);
      compareEnd.setHours(12, 0, 0, 0);
      
      return eventDateObj >= compareStart && eventDateObj <= compareEnd;
    });
  }, [scheduledEvents, dateRange]);

  // Filter by search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return dateFilteredEvents;
    const query = searchQuery.toLowerCase();
    return dateFilteredEvents.filter(event => 
      event.organizationName?.toLowerCase().includes(query) ||
      event.firstName?.toLowerCase().includes(query) ||
      event.lastName?.toLowerCase().includes(query) ||
      event.email?.toLowerCase().includes(query) ||
      event.phone?.toLowerCase().includes(query) ||
      event.eventAddress?.toLowerCase().includes(query)
    );
  }, [dateFilteredEvents, searchQuery]);

  // Sort events
  const sortedEvents = useMemo(() => {
    const sorted = [...filteredEvents];
    sorted.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'eventDate':
          // Use timezone-safe date parsing for sorting
          const parseDateSafe = (date: string | Date | null | undefined): number => {
            if (!date) return 0;
            const dateStr = typeof date === 'string' ? date : date.toISOString();
            let dateObj: Date;

            if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
              const dateOnly = dateStr.split(' ')[0];
              dateObj = new Date(dateOnly + 'T12:00:00');
            } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
              const dateOnly = dateStr.split('T')[0];
              dateObj = new Date(dateOnly + 'T12:00:00');
            } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
              dateObj = new Date(dateStr + 'T12:00:00');
            } else {
              const tempDate = new Date(dateStr);
              if (isNaN(tempDate.getTime())) return 0;
              const year = tempDate.getUTCFullYear();
              const month = String(tempDate.getUTCMonth() + 1).padStart(2, '0');
              const day = String(tempDate.getUTCDate()).padStart(2, '0');
              dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
            }
            return dateObj.getTime();
          };

          // Helper to parse time string to minutes (for secondary sort)
          const parseTimeToMinutes = (time: string | null | undefined): number => {
            if (!time) return 999999; // Events without time go to the end
            const timeMatch = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            if (!timeMatch) return 999999;

            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const isPM = timeMatch[3]?.toUpperCase() === 'PM';
            const isAM = timeMatch[3]?.toUpperCase() === 'AM';

            // Convert to 24-hour format
            if (isPM && hours !== 12) hours += 12;
            if (isAM && hours === 12) hours = 0;

            return hours * 60 + minutes;
          };

          aValue = parseDateSafe(getEffectiveEventDate(a));
          bValue = parseDateSafe(getEffectiveEventDate(b));

          // If dates are equal, sort by event start time, then pickup time
          if (aValue === bValue) {
            const aStartTime = parseTimeToMinutes(a.eventStartTime);
            const bStartTime = parseTimeToMinutes(b.eventStartTime);

            if (aStartTime !== bStartTime) {
              return sortDirection === 'asc' ? aStartTime - bStartTime : bStartTime - aStartTime;
            }

            // If start times are also equal, sort by pickup time
            const aPickupTime = parseTimeToMinutes(a.pickupTime);
            const bPickupTime = parseTimeToMinutes(b.pickupTime);

            if (aPickupTime !== bPickupTime) {
              return sortDirection === 'asc' ? aPickupTime - bPickupTime : bPickupTime - aPickupTime;
            }
          }
          break;
        case 'groupName':
          aValue = a.organizationName || `${a.firstName} ${a.lastName}`.trim() || '';
          bValue = b.organizationName || `${b.firstName} ${b.lastName}`.trim() || '';
          break;
        case 'eventStartTime':
          aValue = a.eventStartTime || '';
          bValue = b.eventStartTime || '';
          break;
        case 'pickupTime':
          aValue = a.pickupTime || '';
          bValue = b.pickupTime || '';
          break;
        case 'estimatedSandwiches':
          aValue = a.estimatedSandwichCount || 0;
          bValue = b.estimatedSandwichCount || 0;
          break;
        case 'tspContact':
          // Sort by TSP contact name
          const getContactName = (event: EventRequest) => {
            const contacts = [];
            if (event.tspContact) contacts.push(resolveUserName(event.tspContact));
            if (event.tspContactAssigned) contacts.push(resolveUserName(event.tspContactAssigned));
            if (event.customTspContact) contacts.push(event.customTspContact);
            const filtered = contacts.filter(c => c && c !== 'Not assigned');
            return filtered.length > 0 ? filtered[0] : '';
          };
          aValue = getContactName(a);
          bValue = getContactName(b);
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      
      return sortDirection === 'asc' 
        ? (aValue > bValue ? 1 : -1)
        : (aValue < bValue ? 1 : -1);
    });
    return sorted;
  }, [filteredEvents, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    const newDirection = sortField === field ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc';

    // Track sorting action
    trackEvent('spreadsheet_column_sorted', {
      field,
      direction: newDirection,
      previous_field: sortField,
      previous_direction: sortDirection,
      timestamp: new Date().toISOString(),
    });
    trackButtonClick(`sort_by_${field}_${newDirection}`, 'spreadsheet_view');

    if (sortField === field) {
      setSortDirection(newDirection);
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortFieldForColumn = (columnId: string): SortField | null => {
    const sortMap: Record<string, SortField> = {
      'eventDate': 'eventDate',
      'groupName': 'groupName',
      'eventStartTime': 'eventStartTime',
      'pickupTime': 'pickupTime',
      'estimatedSandwiches': 'estimatedSandwiches',
    };
    return sortMap[columnId] || null;
  };

  const startEditing = (eventId: number, field: string, currentValue: any) => {
    // Track inline editing start
    trackEvent('spreadsheet_inline_edit_started', {
      field,
      event_id: eventId,
      timestamp: new Date().toISOString(),
    });

    setEditingScheduledId(eventId);
    setEditingField(field);

    // Special handling for sandwich types
    if (field === 'sandwichType') {
      const event = eventRequests.find(e => e.id === eventId);
      if (event) {
        setEditingValue(getSandwichTypeEditValue(event));
        return;
      }
    }

    // Special handling for time fields - parse to 12-hour format with AM/PM
    if (['eventStartTime', 'eventEndTime', 'pickupTime'].includes(field)) {
      const timeStr = currentValue?.toString() || '';
      if (timeStr) {
        // Check if already in 12-hour format with AM/PM
        if (timeStr.includes('AM') || timeStr.includes('PM') || timeStr.includes('am') || timeStr.includes('pm')) {
          const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
          if (match) {
            setEditingValue(`${match[1]}:${match[2]}`);
            setTimePeriod(match[3].toUpperCase() as 'AM' | 'PM');
            return;
          }
        }
        // Parse 24-hour format to 12-hour
        const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
        if (match) {
          const hours24 = parseInt(match[1], 10);
          const minutes = match[2];
          let hours12 = hours24;
          let period: 'AM' | 'PM' = 'AM';
          
          if (hours24 === 0) {
            hours12 = 12;
            period = 'AM';
          } else if (hours24 < 12) {
            hours12 = hours24;
            period = 'AM';
          } else if (hours24 === 12) {
            hours12 = 12;
            period = 'PM';
          } else {
            hours12 = hours24 - 12;
            period = 'PM';
          }
          
          setEditingValue(`${hours12}:${minutes}`);
          setTimePeriod(period);
          return;
        }
      }
      setEditingValue('');
      setTimePeriod('AM');
      return;
    }

    setEditingValue(currentValue?.toString() || '');
  };

  const saveEdit = () => {
    if (editingScheduledId && editingField) {
      // Track inline edit save
      trackEvent('spreadsheet_inline_edit_saved', {
        field: editingField,
        event_id: editingScheduledId,
        timestamp: new Date().toISOString(),
      });
      trackButtonClick(`save_inline_edit_${editingField}`, 'spreadsheet_view');

      // Map spreadsheet column IDs to actual database field names
      const fieldMap: Record<string, string> = {
        'eventStartTime': 'eventStartTime',
        'eventEndTime': 'eventEndTime',
        'pickupTime': 'pickupTime',
        'estimatedSandwiches': 'estimatedSandwichCount',
        'toolkitSent': 'toolkitSent',
        'tspContact': 'tspContact',
        'address': 'eventAddress',
        'notes': 'planningNotes',
        'additionalNotes': 'schedulingNotes',
        'sandwichType': 'sandwichTypes',
        'eventDate': 'scheduledEventDate',
        'groupName': 'organizationName',
        'department': 'department',
        'vanBooked': 'vanDriverNeeded',
        'contactName': 'firstName', // Will need special handling for first/last
        'phone': 'phone',
        'email': 'email',
        'finalSandwiches': 'actualSandwichCount',
        'socialPost': 'socialMediaPostRequested',
      };

      const dbField = fieldMap[editingField] || editingField;

      // Handle boolean fields
      if (dbField === 'toolkitSent' || dbField === 'vanDriverNeeded' || dbField === 'socialMediaPostRequested') {
        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: { [dbField]: editingValue === 'Yes' || editingValue === 'true' || editingValue === 'Requested' },
        });
      }
      // Handle sandwich types
      else if (dbField === 'sandwichTypes') {
        const parsedTypes = parseSandwichTypeEditValue(editingValue);
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: dbField,
          value: parsedTypes,
        });
      }
      // Handle contact name (firstName/lastName combined)
      else if (editingField === 'contactName') {
        const nameParts = editingValue.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: { firstName, lastName },
        });
      }
      // Handle recipients - parse comma-separated names and convert to recipient IDs
      else if (editingField === 'recipients') {
        // Parse input: "Recipient 1: 50, Recipient 2: 30" or "Recipient 1, Recipient 2"
        const recipientParts = editingValue.split(',').map(p => p.trim()).filter(p => p.length > 0);
        const recipientIds: string[] = [];
        const recipientAllocations: Array<{
          recipientId: string;
          recipientName: string;
          sandwichCount: number;
          sandwichType?: string;
        }> = [];

        recipientParts.forEach(part => {
          // Check if format is "Name: Count" or just "Name"
          const countMatch = part.match(/^(.+?):\s*(\d+)$/);
          const recipientName = countMatch ? countMatch[1].trim() : part.trim();
          const sandwichCount = countMatch ? parseInt(countMatch[2], 10) : 0;

          if (!recipientName) return;

          // Find recipient by name (case-insensitive partial match)
          const recipient = recipients.find(r => 
            r.name.toLowerCase().includes(recipientName.toLowerCase()) ||
            recipientName.toLowerCase().includes(r.name.toLowerCase())
          );

          if (recipient) {
            const recipientId = `recipient:${recipient.id}`;
            recipientIds.push(recipientId);
            
            // If count is specified, add to allocations
            if (sandwichCount > 0) {
              recipientAllocations.push({
                recipientId,
                recipientName: recipient.name,
                sandwichCount,
              });
            }
          }
        });

        // Update both assignedRecipientIds and recipientAllocations
        // If allocations are provided, use them; otherwise clear allocations
        const updateData: any = {
          assignedRecipientIds: recipientIds,
        };
        
        if (recipientAllocations.length > 0) {
          updateData.recipientAllocations = recipientAllocations;
        } else {
          // Clear allocations if no counts specified
          updateData.recipientAllocations = [];
        }
        
        updateEventRequestMutation.mutate({
          id: editingScheduledId,
          data: updateData,
        });
      }
      // Handle numeric fields
      else if (['estimatedSandwichCount', 'actualSandwichCount'].includes(dbField)) {
        const numValue = parseInt(editingValue, 10);
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: dbField,
          value: isNaN(numValue) ? null : numValue,
        });
      }
      // Handle date fields
      else if (dbField === 'scheduledEventDate') {
        // Parse date input (expecting format like "9/3/2025" or "2025-09-03")
        let dateValue = editingValue;
        if (editingValue.includes('/')) {
          // Convert M/D/YYYY to YYYY-MM-DD
          const parts = editingValue.split('/');
          if (parts.length === 3) {
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            const year = parts[2];
            dateValue = `${year}-${month}-${day}`;
          }
        }
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: dbField,
          value: dateValue,
        });
      }
      // Handle address formatting
      else if (dbField === 'eventAddress') {
        const formattedAddress = formatAddress(editingValue);
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: dbField,
          value: formattedAddress,
        });
      }
      else {
        updateScheduledFieldMutation.mutate({
          id: editingScheduledId,
          field: dbField,
          value: editingValue,
        });
      }
      cancelEdit();
    }
  };

  const cancelEdit = () => {
    setEditingScheduledId(null);
    setEditingField(null);
    setEditingValue('');
    setTimePeriod('AM');
  };
  
  // Sandwich types dialog handlers
  const openSandwichDialog = (event: EventRequest) => {
    // Only seed from a breakdown that agrees with the exact count. Seeding a
    // stale one would show quantities the event's own count contradicts, and
    // saving the dialog re-sums them back over that count (exact 500 reappears
    // as 250 turkey + 248 PBJ = 498).
    const existingTypes = hasActiveSandwichTypes(event.sandwichTypes, event.estimatedSandwichCount)
      ? parseSandwichTypes(event.sandwichTypes) || []
      : [];
    setDialogSandwichTypes(existingTypes.length > 0 ? existingTypes : [{ type: 'deli', quantity: 0 }]);
    setSandwichDialogEventId(event.id);
    setShowSandwichDialog(true);
  };
  
  const closeSandwichDialog = () => {
    setShowSandwichDialog(false);
    setSandwichDialogEventId(null);
    setDialogSandwichTypes([]);
  };
  
  const addSandwichType = () => {
    setDialogSandwichTypes([...dialogSandwichTypes, { type: 'deli', quantity: 0 }]);
  };
  
  const updateSandwichType = (index: number, field: 'type' | 'quantity', value: string | number) => {
    const updated = [...dialogSandwichTypes];
    updated[index] = { ...updated[index], [field]: value };
    setDialogSandwichTypes(updated);
  };
  
  const removeSandwichType = (index: number) => {
    setDialogSandwichTypes(dialogSandwichTypes.filter((_, i) => i !== index));
  };
  
  const saveSandwichTypes = () => {
    if (!sandwichDialogEventId) return;
    
    // Filter out any entries with quantity 0 or invalid types
    const validTypes = dialogSandwichTypes.filter(st => st.quantity > 0);
    
    updateScheduledFieldMutation.mutate({
      id: sandwichDialogEventId,
      field: 'sandwichTypes',
      value: validTypes.length > 0 ? validTypes : null,
    });
    
    closeSandwichDialog();
  };

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '';
    try {
      // Handle timezone issues by parsing date-only strings at noon
      let dateObj: Date;
      const dateStr = typeof date === 'string' ? date : date.toISOString();
      
      // Check if it's a date-only format or midnight UTC timestamp
      if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        // Database timestamp format: "2025-09-03 00:00:00"
        const dateOnly = dateStr.split(' ')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
        // ISO format with midnight time (e.g., "2025-09-03T00:00:00.000Z")
        const dateOnly = dateStr.split('T')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // YYYY-MM-DD format
        dateObj = new Date(dateStr + 'T12:00:00');
      } else {
        // For other formats, try to extract date components
        const tempDate = new Date(dateStr);
        if (isNaN(tempDate.getTime())) return '';
        const year = tempDate.getUTCFullYear();
        const month = String(tempDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(tempDate.getUTCDate()).padStart(2, '0');
        dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
      }
      
      return format(dateObj, 'M/d/yy');
    } catch {
      return '';
    }
  };

  const formatDayOfWeek = (date: string | Date | null | undefined) => {
    if (!date) return '';
    try {
      // Handle timezone issues by parsing date-only strings at noon
      let dateObj: Date;
      const dateStr = typeof date === 'string' ? date : date.toISOString();
      
      // Check if it's a date-only format or midnight UTC timestamp
      if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        // Database timestamp format: "2025-09-03 00:00:00"
        const dateOnly = dateStr.split(' ')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
        // ISO format with midnight time (e.g., "2025-09-03T00:00:00.000Z")
        const dateOnly = dateStr.split('T')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // YYYY-MM-DD format
        dateObj = new Date(dateStr + 'T12:00:00');
      } else {
        // For other formats, try to extract date components
        const tempDate = new Date(dateStr);
        if (isNaN(tempDate.getTime())) return '';
        const year = tempDate.getUTCFullYear();
        const month = String(tempDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(tempDate.getUTCDate()).padStart(2, '0');
        dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
      }
      
      return format(dateObj, 'EEEE');
    } catch {
      return '';
    }
  };

  const getSandwichTypeDisplay = (event: EventRequest) => {
    const sandwichTypes = parseSandwichTypes(event.sandwichTypes);
    if (sandwichTypes && sandwichTypes.length > 0) {
      // Convert type values to friendly labels (without quantities - those are in a separate column)
      return sandwichTypes.map(st => {
        const typeConfig = SANDWICH_TYPES.find(t => t.value === st.type);
        const label = typeConfig?.label || st.type;
        return label;
      }).join(', ');
    }
    // If no sandwich types specified, return empty string
    return '';
  };

  const getSandwichTypeEditValue = (event: EventRequest): string => {
    const sandwichTypes = parseSandwichTypes(event.sandwichTypes);
    if (sandwichTypes && sandwichTypes.length > 0) {
      // Format for editing: "deli: 200, pbj: 100"
      return sandwichTypes.map(st => `${st.type}: ${st.quantity}`).join(', ');
    }
    return '';
  };

  const parseSandwichTypeEditValue = (value: string): any => {
    if (!value || !value.trim()) return null;
    
    try {
      // Parse format like "deli: 200, pbj: 100" or "deli (200), pbj (100)"
      const parts = value.split(',').map(p => p.trim());
      const types = parts.map(part => {
        // Handle both "type: quantity" and "type (quantity)" formats
        const colonMatch = part.match(/^(\w+):\s*(\d+)$/);
        const parenMatch = part.match(/^(\w+)\s*\((\d+)\)$/);
        
        if (colonMatch) {
          return { type: colonMatch[1].trim(), quantity: parseInt(colonMatch[2], 10) };
        } else if (parenMatch) {
          return { type: parenMatch[1].trim(), quantity: parseInt(parenMatch[2], 10) };
        }
        return null;
      }).filter(Boolean);
      
      return types.length > 0 ? types : null;
    } catch {
      return null;
    }
  };

  const formatTime = (timeString: string | null | undefined): string => {
    if (!timeString) return '';
    
    // If already formatted (contains AM/PM), return as-is
    if (timeString.includes('AM') || timeString.includes('PM') || timeString.includes('am') || timeString.includes('pm')) {
      return timeString;
    }
    
    // Parse HH:MM or HH:MM:SS format
    const match = timeString.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return timeString; // Return as-is if format not recognized
    
    const hours24 = parseInt(match[1], 10);
    const minutes = match[2];
    
    if (hours24 < 0 || hours24 > 23) return timeString;
    
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
    
    return `${hours12}:${minutes} ${period}`;
  };

  // Get the Monday of the week for a given date
  const getWeekStart = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    // Adjust to Monday (day 1), if Sunday (day 0), go back 6 days
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Week color palettes - alternating light/dark shades for each week
  const weekColorPalettes = [
    // Week 1: Blue shades
    { light: 'bg-blue-50', dark: 'bg-blue-100' },
    // Week 2: Green shades
    { light: 'bg-emerald-50', dark: 'bg-emerald-100' },
    // Week 3: Purple shades
    { light: 'bg-purple-50', dark: 'bg-purple-100' },
    // Week 4: Amber/Orange shades
    { light: 'bg-amber-50', dark: 'bg-amber-100' },
    // Week 5: Rose/Pink shades
    { light: 'bg-rose-50', dark: 'bg-rose-100' },
    // Week 6: Cyan shades
    { light: 'bg-cyan-50', dark: 'bg-cyan-100' },
    // Week 7: Slate shades (fallback)
    { light: 'bg-slate-50', dark: 'bg-slate-100' },
  ];

  // Calculate week indices for all events to determine row colors
  const eventWeekIndices = useMemo(() => {
    const weekMap = new Map<string, number>();
    let weekCounter = 0;
    let lastWeekStart: string | null = null;

    // Events are already sorted by date, so we can iterate through them
    sortedEvents.forEach(event => {
      const eventDate = getEffectiveEventDate(event);
      if (!eventDate) return;

      // Parse the date safely
      const dateStr = typeof eventDate === 'string' ? eventDate : eventDate.toISOString();
      let dateObj: Date;

      if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        const dateOnly = dateStr.split(' ')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T/)) {
        const dateOnly = dateStr.split('T')[0];
        dateObj = new Date(dateOnly + 'T12:00:00');
      } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dateObj = new Date(dateStr + 'T12:00:00');
      } else {
        const tempDate = new Date(dateStr);
        if (isNaN(tempDate.getTime())) return;
        dateObj = tempDate;
      }

      const weekStart = getWeekStart(dateObj);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      if (lastWeekStart !== weekStartStr) {
        if (lastWeekStart !== null) {
          weekCounter++;
        }
        lastWeekStart = weekStartStr;
      }

      weekMap.set(`${event.id}`, weekCounter);
    });

    return weekMap;
  }, [sortedEvents]);

  // Track row index within each week for alternating colors
  const getRowColor = (event: EventRequest, rowIndex: number) => {
    const weekIndex = eventWeekIndices.get(`${event.id}`) || 0;
    const palette = weekColorPalettes[weekIndex % weekColorPalettes.length];

    // Count how many rows of this week we've seen before this one
    let rowWithinWeek = 0;
    for (let i = 0; i < rowIndex; i++) {
      const prevEvent = sortedEvents[i];
      const prevWeekIndex = eventWeekIndices.get(`${prevEvent.id}`) || 0;
      if (prevWeekIndex === weekIndex) {
        rowWithinWeek++;
      }
    }

    // Alternate light/dark within the week
    return rowWithinWeek % 2 === 0 ? palette.light : palette.dark;
  };

  // Day border colors - using high-contrast alternating colors for clear day distinction
  // Alternating between warm and cool colors for maximum visibility
  const dayBorderColors = [
    '#236383', // dark teal
    '#fbad3f', // orange/gold
    '#a31c41', // burgundy/red
    '#007e8c', // teal
    '#9333ea', // purple (added for more variety)
  ];

  // Helper to get the date string for an event (for comparing same-day events)
  const getEventDateString = (event: EventRequest): string => {
    const eventDate = getEffectiveEventDate(event);
    if (!eventDate) return '';

    const dateStr = typeof eventDate === 'string' ? eventDate : eventDate.toISOString();

    if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
      return dateStr.split(' ')[0];
    } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return dateStr.split('T')[0];
    } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateStr;
    }

    const tempDate = new Date(dateStr);
    if (isNaN(tempDate.getTime())) return '';
    return tempDate.toISOString().split('T')[0];
  };

  // Determine if this event is the first of its day (for left border accent)
  const isFirstEventOfDay = (event: EventRequest, rowIndex: number): boolean => {
    if (rowIndex === 0) return true;

    const currentDateStr = getEventDateString(event);
    const prevEvent = sortedEvents[rowIndex - 1];
    const prevDateStr = getEventDateString(prevEvent);

    return currentDateStr !== prevDateStr;
  };

  // Calculate day indices for border colors - each unique day gets an index
  const eventDayIndices = useMemo(() => {
    const dayMap = new Map<string, number>();
    const dateToIndex = new Map<string, number>();
    let dayCounter = 0;

    sortedEvents.forEach(event => {
      const dateStr = getEventDateString(event);
      if (!dateStr) return;

      // If we haven't seen this date yet, assign it a new index
      if (!dateToIndex.has(dateStr)) {
        dateToIndex.set(dateStr, dayCounter);
        dayCounter++;
      }

      // Map event ID to its day index
      dayMap.set(`${event.id}`, dateToIndex.get(dateStr)!);
    });

    return dayMap;
  }, [sortedEvents]);

  // Get the left border style for a row (returns inline style object)
  // All events on the same day get the same color
  const getLeftBorderStyle = (event: EventRequest, rowIndex: number): React.CSSProperties => {
    const dayIndex = eventDayIndices.get(`${event.id}`) || 0;
    const borderColor = dayBorderColors[dayIndex % dayBorderColors.length];

    if (isFirstEventOfDay(event, rowIndex)) {
      // First event of the day: thick left border with brand color
      return { borderLeft: `5px solid ${borderColor}` };
    }
    // Same day as previous: same color border to show continuity
    return { borderLeft: `5px solid ${borderColor}` };
  };

  // Handle clicking on event date to navigate to card view
  const handleEventDateClick = (event: EventRequest) => {
    if (onEventDateClick) {
      onEventDateClick(event);
    } else {
      // Fallback if no callback provided
      setSelectedEventRequest(event);
      setActiveTab('scheduled');
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  };

  // Define default columns - ordered by workflow priority
  // Note: resolveUserName is used in the render functions, so columns must be defined after resolveUserName is available
  // Note: handleEventDateClick is used in renderCell, but we define it outside useMemo since it's stable
  // Frozen columns: eventDate, dayOfWeek, groupName, department stay fixed when scrolling horizontally
  const defaultColumns: Column[] = useMemo(() => [
    // 1. Event date (FROZEN)
    {
      id: 'eventDate',
      label: 'Date',
      width: '68px',
      sortable: true,
      frozen: true,
      center: true,
      render: (event) => formatDate(getEffectiveEventDate(event)),
    },
    // 2. Day of week (FROZEN) - rendering handled in renderCell for proper JSX support
    {
      id: 'dayOfWeek',
      label: 'Day',
      width: '45px',
      frozen: true,
      center: true,
    },
    // 3. Group name (FROZEN)
    {
      id: 'groupName',
      label: 'Group',
      width: '150px',
      sortable: true,
      frozen: true,
      render: (event) => {
        return event.organizationName || `${event.firstName} ${event.lastName}`.trim() || 'N/A';
      },
    },
    // 3b. Department (FROZEN)
    {
      id: 'department',
      label: 'Dept',
      width: '100px',
      hideOnMobile: true,
      frozen: true,
      render: (event) => event.department || '',
    },
    // 4. Location (with Google map link)
    {
      id: 'address',
      label: 'Location',
      width: '200px',
      render: (event) => {
        const address = event.eventAddress || '';
        if (!address) return '';
        return (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1a73e8] hover:text-[#1557b0] hover:underline flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{address}</span>
          </a>
        );
      },
    },
    // 4b. Assigned Recipients (with allocations if available)
    {
      id: 'recipients',
      label: 'Recipients',
      width: '220px',
      hideOnMobile: true,
      render: (event) => {
        // First check for new recipient allocations
        const allocations = (event as any).recipientAllocations as Array<{
          recipientId: string;
          recipientName: string;
          sandwichCount: number;
          sandwichType?: string;
        }> | null | undefined;

        if (allocations && allocations.length > 0) {
          // Show allocations with counts
          return allocations
            .filter(a => a.sandwichCount > 0)
            .map(a => {
              const typeLabel = a.sandwichType
                ? SANDWICH_TYPES.find(t => t.value === a.sandwichType)?.label
                : null;
              return `${a.recipientName}: ${a.sandwichCount}${typeLabel ? ` (${typeLabel})` : ''}`;
            })
            .join('; ') || '';
        }

        // Fall back to legacy assignedRecipientIds
        if (!event.assignedRecipientIds || event.assignedRecipientIds.length === 0) {
          return '';
        }
        const names = event.assignedRecipientIds
          .map(id => resolveRecipientName(id))
          .filter(name => name && name !== 'Loading...');
        return names.join(', ') || '';
      },
    },
    // 5. Assigned Staff (combined: shows needed counts with +/- buttons AND assigned names)
    {
      id: 'assignedStaff',
      label: 'Staff',
      width: '320px', // Increased width for buttons
      hideOnMobile: true,
      render: (event) => {
        const assigned = [];

        // Van driver
        if (event.assignedVanDriverId) {
          assigned.push(`🚐 ${resolveUserName(event.assignedVanDriverId)}`);
        }
        if (event.isDhlVan) {
          assigned.push('🚚 DHL Van');
        }

        // Drivers
        const driverIds = getDriverIds(event);
        if (driverIds.length > 0) {
          const driverNames = driverIds
            .map(id => resolveUserName(id))
            .filter(name => name && name !== 'Not assigned');
          if (driverNames.length > 0) {
            assigned.push(`🚗 ${driverNames.join(', ')}`);
          }
        }

        // Volunteers
        const volunteerIds = getVolunteerIds(event);
        if (volunteerIds.length > 0) {
          const volunteerNames = volunteerIds
            .map(id => resolveUserName(id))
            .filter(name => name && name !== 'Not assigned');
          if (volunteerNames.length > 0) {
            assigned.push(`👥 ${volunteerNames.join(', ')}`);
          }
        }

        // Return the fullText format expected by the rendering logic
        const fullText = assigned.join(' • ');
        return {
          fullText,
          hasContent: assigned.length > 0
        };
      },
    },
    // 7. Times - start, end, pickup
    {
      id: 'eventStartTime',
      label: 'Start',
      width: '70px',
      sortable: true,
      center: true,
      render: (event) => formatTime(event.eventStartTime),
    },
    {
      id: 'eventEndTime',
      label: 'End',
      width: '70px',
      hideOnMobile: true,
      center: true,
      render: (event) => formatTime(event.eventEndTime),
    },
    {
      id: 'pickupTime',
      label: 'Pickup',
      width: '70px',
      sortable: true,
      hideOnMobile: true,
      center: true,
      render: (event) => formatTime(event.pickupTime),
    },
    // 8. Sandwiches # and type
    {
      id: 'estimatedSandwiches',
      label: '# Sand.',
      width: '70px',
      sortable: true,
      center: true,
      render: (event) => {
        const count = event.estimatedSandwichCount;
        const min = event.estimatedSandwichCountMin;
        const max = event.estimatedSandwichCountMax;
        if (hasActiveSandwichRange(min, max, count)) return `${min}-${max}`;
        return count?.toString() || '';
      },
    },
    {
      id: 'sandwichType',
      label: 'Type',
      width: '80px',
      center: true,
      hideOnMobile: true,
      render: (event) => getSandwichTypeDisplay(event),
    },
    // 9. Assigned staff (TSP Contact)
    {
      id: 'tspContact',
      label: 'TSP Contact',
      width: '140px',
      sortable: true,
      hideOnMobile: true,
      render: (event) => {
        const contacts = [];
        if (event.tspContact) contacts.push(resolveUserName(event.tspContact));
        if (event.tspContactAssigned) contacts.push(resolveUserName(event.tspContactAssigned));
        if (event.customTspContact) contacts.push(event.customTspContact); // Custom is already text
        return contacts.filter(c => c && c !== 'Not assigned').join(', ') || '';
      },
    },
    // 10. Van booked
    {
      id: 'vanBooked',
      label: 'Van?',
      width: '55px',
      hideOnMobile: true,
      center: true,
      render: (event) => event.isDhlVan ? 'DHL' : event.vanDriverNeeded ? 'Yes' : 'No',
    },
    {
      id: 'vanNeededFor',
      label: 'Van for?',
      width: '90px',
      hideOnMobile: true,
      center: true,
      render: (event) => {
        if (!event.vanDriverNeeded && !event.isDhlVan) return '';
        if (event.vanNeededFor === 'transport') return 'Transport';
        if (event.vanNeededFor === 'refrigeration') return 'Refrigeration';
        return '';
      },
    },
    // 11. Contact name, #, and email for organization
    {
      id: 'contactName',
      label: 'Contact',
      width: '120px',
      hideOnMobile: true,
      render: (event) => `${event.firstName || ''} ${event.lastName || ''}`.trim() || 'N/A',
    },
    {
      id: 'phone',
      label: 'Phone',
      width: '110px',
      hideOnMobile: true,
      render: (event) => event.phone || '',
    },
    {
      id: 'email',
      label: 'Email',
      width: '160px',
      hideOnMobile: true,
      render: (event) => event.email || event.updatedEmail || '',
    },
    // 12. The rest (all details, etc.)
    {
      id: 'allDetails',
      label: 'Details',
      width: '150px',
      hideOnMobile: true,
      render: (event) => {
        const details = [];
        if (event.message) details.push(event.message);
        if (event.planningNotes) details.push(`Planning: ${event.planningNotes}`);
        if (event.schedulingNotes) details.push(`Scheduling: ${event.schedulingNotes}`);
        if (event.additionalRequirements) details.push(`Requirements: ${event.additionalRequirements}`);
        const fullText = details.join(' | ') || '';
        return { fullText, hasContent: fullText.length > 0 };
      },
    },
    {
      id: 'toolkitSent',
      label: 'Toolkit',
      width: '65px',
      hideOnMobile: true,
      center: true,
      render: (event) => event.toolkitSent ? 'Yes' : 'No',
    },
    {
      id: 'finalSandwiches',
      label: 'Final #',
      width: '60px',
      hideOnMobile: true,
      center: true,
      render: (event) => event.actualSandwichCount?.toString() || '',
    },
    {
      id: 'notes',
      label: 'Notes',
      width: '150px',
      hideOnMobile: true,
      render: (event) => event.planningNotes || '',
    },
    {
      id: 'additionalNotes',
      label: 'Add\'l',
      width: '120px',
      hideOnMobile: true,
      render: (event) => event.schedulingNotes || '',
    },
    {
      id: 'socialPost',
      label: 'Social',
      width: '60px',
      hideOnMobile: true,
      center: true,
      render: (event) => {
        if (event.socialMediaPostCompleted) return '✓';
        if (event.socialMediaPostRequested) return 'Req';
        return '';
      },
    },
  ], [resolveUserName, resolveRecipientName, recipients, hosts]);

  // Reorder columns based on saved order
  const columns: Column[] = useMemo(() => {
    // First, filter columns based on mobile vs desktop
    const visibleColumns = isMobile
      ? defaultColumns.filter(col => !col.hideOnMobile)
      : defaultColumns;

    // Reorder columns if saved order exists and matches current column count
    if (columnOrder && columnOrder.length === visibleColumns.length) {
      const columnMap = new Map(visibleColumns.map(col => [col.id, col]));
      const orderedColumns = columnOrder.map(id => columnMap.get(id)).filter(Boolean) as Column[];
      // If all columns are present, return ordered columns
      if (orderedColumns.length === visibleColumns.length) {
        return orderedColumns;
      }
    }

    // If saved order is outdated or doesn't exist, use default order
    // Clear outdated saved order
    if (columnOrder && columnOrder.length !== visibleColumns.length) {
      localStorage.removeItem('scheduledSpreadsheetColumnOrder');
      setColumnOrder(null);
    }

    return visibleColumns;
  }, [columnOrder, defaultColumns, isMobile]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColumnIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colIndex?: number) => {
    e.preventDefault();
    // Count frozen columns
    const frozenCount = columns.filter(col => col.frozen).length;
    // Show not-allowed cursor if trying to drop in frozen zone
    if (colIndex !== undefined && colIndex < frozenCount) {
      e.dataTransfer.dropEffect = 'none';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedColumnIndex === null || draggedColumnIndex === dropIndex) {
      setDraggedColumnIndex(null);
      return;
    }

    // Count frozen columns - drops must be after all frozen columns
    const frozenCount = columns.filter(col => col.frozen).length;

    // Prevent dropping into the frozen column zone
    if (dropIndex < frozenCount) {
      setDraggedColumnIndex(null);
      return;
    }

    // Get current column order (either from state or default)
    const currentOrder = columnOrder || defaultColumns.map(col => col.id);
    const newOrder = [...currentOrder];
    const [removed] = newOrder.splice(draggedColumnIndex, 1);
    newOrder.splice(dropIndex, 0, removed);

    // Track column reordering
    trackEvent('spreadsheet_column_reordered', {
      from_index: draggedColumnIndex,
      to_index: dropIndex,
      column_moved: removed,
      is_custom_order: !!columnOrder,
      timestamp: new Date().toISOString(),
    });
    trackButtonClick('reorder_columns', 'spreadsheet_view');

    setColumnOrder(newOrder);
    localStorage.setItem('scheduledSpreadsheetColumnOrder', JSON.stringify(newOrder));
    setDraggedColumnIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedColumnIndex(null);
  };

  // Column resizing handlers
  const handleResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const column = columns.find(col => col.id === columnId);
    if (!column) return;

    const currentWidth = columnWidths[columnId] || parseInt(column.width?.replace('px', '') || '150');

    setResizingColumn({
      id: columnId,
      startX: e.clientX,
      startWidth: currentWidth,
    });
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumn) return;

    const deltaX = e.clientX - resizingColumn.startX;
    const newWidth = Math.max(80, resizingColumn.startWidth + deltaX); // Min width 80px

    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn.id]: newWidth,
    }));
  };

  const handleResizeEnd = () => {
    if (!resizingColumn) return;

    // Save to localStorage
    const widthsToSave = {
      ...columnWidths,
      [resizingColumn.id]: columnWidths[resizingColumn.id],
    };
    localStorage.setItem('scheduledSpreadsheetColumnWidths', JSON.stringify(widthsToSave));

    // Track resize event
    trackEvent('spreadsheet_column_resized', {
      column_id: resizingColumn.id,
      new_width: columnWidths[resizingColumn.id],
      timestamp: new Date().toISOString(),
    });

    setResizingColumn(null);
  };

  // Add/remove mouse event listeners for resizing
  useEffect(() => {
    if (resizingColumn) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [resizingColumn, columnWidths]);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when fullscreen
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isFullscreen]);

  const isEditing = (eventId: number, field: string) => {
    return editingScheduledId === eventId && editingField === field;
  };

  const renderCell = (event: EventRequest, column: Column) => {
    const isEditable = [
      'eventStartTime', 'eventEndTime', 'pickupTime',
      'estimatedSandwiches', 'sandwichType', 'toolkitSent',
      'tspContact', 'address', 'notes', 'additionalNotes',
      'eventDate', 'groupName', 'department', 'vanBooked',
      'contactName', 'phone', 'email', 'finalSandwiches',
      'socialPost', 'recipients' // Recipients column
    ].includes(column.id);

    // Get the raw value for editing (not the formatted display)
    // Defined early so it can be used in special column handlers below
    const getRawValue = (): string => {
      switch (column.id) {
        case 'eventDate':
          // Convert to YYYY-MM-DD format for date input
          const eventDate = getEffectiveEventDate(event);
          if (!eventDate) return '';
          const dateStr = typeof eventDate === 'string' ? eventDate : eventDate.toISOString();
          if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            return dateStr.split('T')[0].split(' ')[0];
          }
          return '';
        case 'eventStartTime':
          return event.eventStartTime || '';
        case 'eventEndTime':
          return event.eventEndTime || '';
        case 'pickupTime':
          return event.pickupTime || '';
        case 'estimatedSandwiches':
          return event.estimatedSandwichCount?.toString() || '';
        case 'finalSandwiches':
          return event.actualSandwichCount?.toString() || '';
        case 'toolkitSent':
          return event.toolkitSent ? 'Yes' : 'No';
        case 'vanBooked':
          return event.isDhlVan ? 'DHL' : event.vanDriverNeeded ? 'Yes' : 'No';
        case 'tspContact':
          return event.tspContact || event.tspContactAssigned || '';
        case 'address':
          return event.eventAddress || '';
        case 'notes':
          return event.planningNotes || '';
        case 'additionalNotes':
          return event.schedulingNotes || '';
        case 'groupName':
          return event.organizationName || '';
        case 'department':
          return event.department || '';
        case 'contactName':
          return `${event.firstName || ''} ${event.lastName || ''}`.trim();
        case 'phone':
          return event.phone || '';
        case 'email':
          return event.email || event.updatedEmail || '';
        case 'socialPost':
          return event.socialMediaPostRequested ? 'Requested' : '';
        case 'recipients':
          // Get current recipients as comma-separated names for editing
          const allocations = (event as any).recipientAllocations as Array<{
            recipientId: string;
            recipientName: string;
            sandwichCount: number;
            sandwichType?: string;
          }> | null | undefined;
          
          if (allocations && allocations.length > 0) {
            // Return format: "Recipient 1: 50, Recipient 2: 30" or just names if no counts
            return allocations
              .filter(a => a.sandwichCount > 0)
              .map(a => {
                if (a.sandwichCount > 0) {
                  return `${a.recipientName}: ${a.sandwichCount}`;
                }
                return a.recipientName;
              })
              .join(', ') || '';
          }
          
          // Fall back to legacy assignedRecipientIds
          if (event.assignedRecipientIds && event.assignedRecipientIds.length > 0) {
            const names = event.assignedRecipientIds
              .map(id => resolveRecipientName(id))
              .filter(name => name && name !== 'Loading...');
            return names.join(', ') || '';
          }
          return '';
        default:
          return '';
      }
    };

    // Special handling for sandwich type - use dialog instead of inline edit
    if (column.id === 'sandwichType' && !isEditing(event.id, column.id)) {
      const displayValue = getSandwichTypeDisplay(event);
      return (
        <div 
          className="flex items-center gap-0.5 group min-h-[20px]"
          onDoubleClick={() => openSandwichDialog(event)}
        >
          <span className="text-base truncate flex-1 leading-relaxed font-normal">{displayValue || '-'}</span>
          <button
            onClick={() => openSandwichDialog(event)}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            data-testid={`button-edit-sandwich-types-${event.id}`}
          >
            <Edit2 className="h-3 w-3 text-[#007E8C]" />
          </button>
        </div>
      );
    }
    
    if (isEditing(event.id, column.id)) {
      // Special handling for boolean fields (toolkitSent, vanBooked, socialPost)
      if (column.id === 'toolkitSent' || column.id === 'vanBooked' || column.id === 'socialPost') {
        return (
          <div className="flex items-center gap-0.5">
            <Select
              value={editingValue}
              onValueChange={setEditingValue}
            >
              <SelectTrigger className="h-7 text-sm w-16 px-1.5 py-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {column.id === 'socialPost' ? (
                  <>
                    <SelectItem value="Requested">Requested</SelectItem>
                    <SelectItem value="">No</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={saveEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Save changes">
              <Save className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Cancel editing">
              <X className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
          </div>
        );
      }
      
      // Special handling for date fields
      if (column.id === 'eventDate') {
        return (
          <div className="flex items-center gap-0.5">
            <Input
              type="date"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              className="h-7 text-sm px-1.5 py-0.5 w-32"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Button size="sm" variant="ghost" onClick={saveEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Save changes">
              <Save className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Cancel editing">
              <X className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
          </div>
        );
      }

      // Special handling for time fields with auto-formatting and AM/PM selector
      if (['eventStartTime', 'eventEndTime', 'pickupTime'].includes(column.id)) {
        const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const input = e.target.value;
          // Remove all non-digits
          const digitsOnly = input.replace(/\D/g, '');

          // Auto-format as HH:MM while typing (12-hour format)
          if (digitsOnly.length === 0) {
            setEditingValue('');
          } else if (digitsOnly.length <= 2) {
            // Just hours
            const hours = parseInt(digitsOnly, 10);
            if (hours > 12) {
              // If > 12, treat as single digit hour
              setEditingValue(digitsOnly.slice(0, 1));
            } else {
              setEditingValue(digitsOnly);
            }
          } else if (digitsOnly.length <= 4) {
            const hours = digitsOnly.slice(0, 2);
            const minutes = digitsOnly.slice(2);
            const hoursNum = parseInt(hours, 10);
            // Validate hours (1-12)
            if (hoursNum > 12) {
              // If hours > 12, use first digit as hour
              setEditingValue(`${digitsOnly.slice(0, 1)}:${digitsOnly.slice(1, 3)}`);
            } else {
              setEditingValue(`${hours}:${minutes}`);
            }
          } else {
            // Limit to 4 digits (HHMM)
            const hours = digitsOnly.slice(0, 2);
            const minutes = digitsOnly.slice(2, 4);
            const hoursNum = parseInt(hours, 10);
            if (hoursNum > 12) {
              setEditingValue(`${digitsOnly.slice(0, 1)}:${digitsOnly.slice(1, 3)}`);
            } else {
              setEditingValue(`${hours}:${minutes}`);
            }
          }
        };

        // Convert 12-hour format to 24-hour format for saving
        const convertTo24Hour = (time12: string, period: 'AM' | 'PM'): string => {
          if (!time12) return '';
          const match = time12.match(/^(\d{1,2}):(\d{2})$/);
          if (!match) return time12;
          
          let hours = parseInt(match[1], 10);
          const minutes = match[2];
          
          if (period === 'AM') {
            if (hours === 12) hours = 0;
          } else { // PM
            if (hours !== 12) hours += 12;
          }
          
          return `${hours.toString().padStart(2, '0')}:${minutes}`;
        };

        return (
          <div className="flex items-center gap-0.5">
            <Input
              type="text"
              value={editingValue}
              onChange={handleTimeChange}
              placeholder="H:MM"
              className="h-7 text-sm px-1.5 py-0.5 w-16"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const time24 = convertTo24Hour(editingValue, timePeriod);
                  setEditingValue(time24);
                  saveEdit();
                }
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Select
              value={timePeriod}
              onValueChange={(value) => setTimePeriod(value as 'AM' | 'PM')}
            >
              <SelectTrigger className="h-7 text-sm w-14 px-1.5 py-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => {
              const time24 = convertTo24Hour(editingValue, timePeriod);
              setEditingValue(time24);
              saveEdit();
            }} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Save changes">
              <Save className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Cancel editing">
              <X className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
          </div>
        );
      }

      // Special handling for numeric fields
      if (['estimatedSandwiches', 'finalSandwiches'].includes(column.id)) {
        return (
          <div className="flex items-center gap-0.5">
            <Input
              type="number"
              min="0"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              className="h-7 text-sm px-1.5 py-0.5 w-20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Button size="sm" variant="ghost" onClick={saveEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Save changes">
              <Save className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Cancel editing">
              <X className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
          </div>
        );
      }

      // Special handling for recipients - allow editing as comma-separated names with optional counts
      if (column.id === 'recipients') {
        return (
          <div className="flex items-center gap-0.5">
            <Input
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              className="h-7 text-sm px-1.5 py-0.5 min-w-[200px]"
              placeholder="Recipient 1, Recipient 2 or Recipient 1: 50, Recipient 2: 30"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Button size="sm" variant="ghost" onClick={saveEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Save changes">
              <Save className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-11 w-11 md:h-5 md:w-5 p-2 md:p-0 touch-manipulation" title="Cancel editing">
              <X className="h-6 w-6 md:h-3 md:w-3" />
            </Button>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-0.5">
          <Input
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            className="h-7 text-sm px-1.5 py-0.5"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <Button size="sm" variant="ghost" onClick={saveEdit} className="h-5 w-5 p-0">
            <Save className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-5 w-5 p-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    const renderedContent = column.render ? column.render(event) : '';
    
    // Special handling for eventDate column (make it clickable and editable)
    if (column.id === 'eventDate') {
      const dateText = typeof renderedContent === 'string' ? renderedContent : String(renderedContent);
      return (
        <div className="flex items-center gap-0.5 group min-h-[20px]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleEventDateClick(event);
            }}
            className="text-lg font-bold text-[#007E8C] hover:text-[#236383] hover:underline cursor-pointer flex-1 text-left"
            title="Click to view event details in card view"
          >
            {dateText}
          </button>
          <button
            onClick={() => startEditing(event.id, column.id, getRawValue())}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-11 w-11 md:h-auto md:w-auto flex items-center justify-center touch-manipulation"
            title="Edit event date"
          >
            <Edit2 className="h-6 w-6 md:h-3 md:w-3 text-[#007E8C]" />
          </button>
        </div>
      );
    }

    // Special handling for dayOfWeek column (render the large abbreviation)
    if (column.id === 'dayOfWeek') {
      const day = formatDayOfWeek(getEffectiveEventDate(event));
      if (!day) return <span className="text-[#47B3CB]/60">-</span>;

      const dayMap: Record<string, string> = {
        'Monday': 'M',
        'Tuesday': 'Tu',
        'Wednesday': 'W',
        'Thursday': 'Th',
        'Friday': 'F',
        'Saturday': 'Sa',
        'Sunday': 'Su',
      };

      return (
        <span className="text-lg font-bold text-[#236383]">
          {dayMap[day] || day.substring(0, 2)}
        </span>
      );
    }

    // Special handling for groupName column (allow text wrapping)
    if (column.id === 'groupName') {
      const groupName = event.organizationName || `${event.firstName} ${event.lastName}`.trim() || 'N/A';
      return (
        <span className="text-base font-medium text-[#236383] whitespace-normal break-words leading-snug">
          {groupName}
        </span>
      );
    }

    // Special handling for department column (allow text wrapping)
    if (column.id === 'department') {
      const dept = event.department || '';
      if (!dept) return <span className="text-base text-[#47B3CB]/60">-</span>;
      return (
        <span className="text-base whitespace-normal break-words leading-snug">
          {dept}
        </span>
      );
    }


    // Special handling for address column - show city with popover for full address
    if (column.id === 'address') {
      const fullAddress = event.eventAddress || '';

      if (!fullAddress) {
        return (
          <div className="flex items-center gap-0.5 group min-h-[20px]">
            <span className="text-base text-[#47B3CB]/60 flex-1">-</span>
            <button
              onClick={() => startEditing(event.id, column.id, getRawValue())}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-11 w-11 md:h-auto md:w-auto flex items-center justify-center touch-manipulation"
              title="Edit address"
            >
              <Edit2 className="h-6 w-6 md:h-3 md:w-3 text-[#007E8C]" />
            </button>
          </div>
        );
      }

      // Extract venue name and city from address
      // Common formats:
      // - "Venue Name 123 Main St, City, ST 12345"
      // - "123 Main St, City, ST 12345"
      // - "City, ST"
      const extractVenueAndCity = (addr: string): string => {
        const parts = addr.split(',').map(p => p.trim());

        // Extract city (typically second to last part before state/zip)
        let city = '';
        if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1];
          if (/^[A-Z]{2}\s*\d{5}/.test(lastPart) || /^\d{5}/.test(lastPart)) {
            // Last part is "ST 12345" or just zip, so second to last is city
            city = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          } else if (parts.length >= 2) {
            const secondLast = parts[parts.length - 2];
            // If it doesn't start with numbers, it's likely the city
            if (!/^\d/.test(secondLast)) {
              city = secondLast;
            } else {
              city = parts[1];
            }
          }
        } else {
          city = addr;
        }

        // Check if first part has a venue name before the street number
        // A venue name is text before a street number (e.g., "Warren/Holyfield Boys & Girls Club 790 Berne St")
        const firstPart = parts[0];
        const venueMatch = firstPart.match(/^(.+?)\s+(\d+\s+\w+)/);

        if (venueMatch) {
          const venueName = venueMatch[1].trim();
          // Make sure it's not just a direction like "N" or "NE" before the number
          if (venueName.length > 2 && !/^[NSEW]{1,2}$/i.test(venueName)) {
            return `${venueName}, ${city}`;
          }
        }

        return city;
      };

      const displayLocation = extractVenueAndCity(fullAddress);
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

      return (
        <div className="flex items-center gap-1 group min-h-[20px]">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 text-base text-[#007E8C] hover:text-[#236383] hover:underline cursor-pointer"
                onClick={(e) => e.stopPropagation()}
                title="Click to see full address"
              >
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span>{displayLocation}</span>
                <Eye className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80"
              side="right"
              align="start"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-[#236383]">Full Address</h4>
                <p className="text-base text-[#236383]">{fullAddress}</p>
                <div className="flex gap-2">
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#007E8C] text-white text-sm rounded hover:bg-[#236383] transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MapPin className="h-3 w-3" />
                    Open in Maps
                  </a>
                  <button
                    onClick={() => startEditing(event.id, column.id, fullAddress)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#007E8C] text-[#007E8C] text-sm rounded hover:bg-[#007E8C]/10 transition-colors"
                  >
                    <Edit2 className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    }
    
    // Special handling for assignedStaff column - combined: shows needed counts with +/- buttons AND assigned names
    if (column.id === 'assignedStaff') {
      // Calculate current assignments
      const driversAssigned = getTotalDriverCount(event);
      const volunteersAssigned = getVolunteerCount(event);

      // Calculate needs
      const driversNeeded = event.driversNeeded || 0;
      const volunteersNeeded = event.volunteersNeeded || 0;

      // Calculate unfilled needs
      const driversUnfilled = Math.max(0, driversNeeded - driversAssigned);
      const volunteersUnfilled = Math.max(0, volunteersNeeded - volunteersAssigned);

      // Check if any roles are needed OR any are assigned (show buttons in either case)
      const hasDriversContent = driversNeeded > 0 || driversAssigned > 0;
      const hasVolunteersContent = volunteersNeeded > 0 || volunteersAssigned > 0;
      const hasAnyContent = hasDriversContent || hasVolunteersContent;

      const updateStaffCount = (field: 'driversNeeded' | 'volunteersNeeded', delta: number) => {
        const currentValue = event[field] || 0;
        const newValue = Math.max(0, currentValue + delta);
        updateScheduledFieldMutation.mutate({
          id: event.id,
          field,
          value: newValue,
        });
      };

      return (
        <TooltipProvider>
          <div className="w-full space-y-1">
            {/* Staff count badges with +/- buttons and assignment buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              {/* Drivers - with count adjustment and assignment */}
              {(hasDriversContent || driversNeeded > 0) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentDialog?.(event.id, 'driver');
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        driversNeeded === 0
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          : driversAssigned >= driversNeeded
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      }`}
                    >
                      <Car className="h-3 w-3" />
                      {driversNeeded > 0 ? `${driversAssigned}/${driversNeeded}` : driversAssigned}
                      {driversUnfilled > 0 && <span className="text-amber-600">({driversUnfilled})</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-600">Drivers Needed</div>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => updateStaffCount('driversNeeded', -1)}
                          disabled={driversNeeded === 0}
                          className="w-8 h-8 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 font-bold"
                        >
                          -
                        </button>
                        <span className="min-w-[32px] text-center text-lg font-semibold text-[#236383]">{driversNeeded}</span>
                        <button
                          onClick={() => updateStaffCount('driversNeeded', 1)}
                          className="w-8 h-8 flex items-center justify-center rounded bg-[#47B3CB]/30 hover:bg-[#47B3CB]/50 text-[#236383] font-bold"
                        >
                          +
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 text-center">
                        {driversUnfilled > 0 ? `${driversUnfilled} still needed` : 'All filled ✓'}
                      </div>
                      <button
                        onClick={() => openAssignmentDialog?.(event.id, 'driver')}
                        className="w-full mt-2 px-3 py-1.5 text-xs bg-[#007E8C] text-white rounded hover:bg-[#236383] transition-colors"
                      >
                        Manage Assignments
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {/* Volunteers - with count adjustment and assignment */}
              {(hasVolunteersContent || volunteersNeeded > 0) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentDialog?.(event.id, 'volunteer');
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        volunteersNeeded === 0
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          : volunteersAssigned >= volunteersNeeded
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      }`}
                    >
                      <UserPlus className="h-3 w-3" />
                      {volunteersNeeded > 0 ? `${volunteersAssigned}/${volunteersNeeded}` : volunteersAssigned}
                      {volunteersUnfilled > 0 && <span className="text-amber-600">({volunteersUnfilled})</span>}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-600">Volunteers Needed</div>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => updateStaffCount('volunteersNeeded', -1)}
                          disabled={volunteersNeeded === 0}
                          className="w-8 h-8 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 font-bold"
                        >
                          -
                        </button>
                        <span className="min-w-[32px] text-center text-lg font-semibold text-[#236383]">{volunteersNeeded}</span>
                        <button
                          onClick={() => updateStaffCount('volunteersNeeded', 1)}
                          className="w-8 h-8 flex items-center justify-center rounded bg-[#47B3CB]/30 hover:bg-[#47B3CB]/50 text-[#236383] font-bold"
                        >
                          +
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 text-center">
                        {volunteersUnfilled > 0 ? `${volunteersUnfilled} still needed` : 'All filled ✓'}
                      </div>
                      <button
                        onClick={() => openAssignmentDialog?.(event.id, 'volunteer')}
                        className="w-full mt-2 px-3 py-1.5 text-xs bg-[#007E8C] text-white rounded hover:bg-[#236383] transition-colors"
                      >
                        Manage Assignments
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {/* Add staff button - show if no content yet */}
              {!hasAnyContent && (
                <AddStaffNeedDropdown
                  onUpdate={updateStaffCount}
                  driversNeeded={driversNeeded}
                  volunteersNeeded={volunteersNeeded}
                />
              )}
            </div>

            {/* Assigned names with click-to-edit and tooltips */}
            <div className="space-y-0.5">
              {/* Van Driver */}
              {event.assignedVanDriverId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentDialog?.(event.id, 'driver');
                      }}
                      className="flex items-center gap-1 text-xs text-[#236383]/80 hover:text-[#236383] hover:bg-[#47B3CB]/10 rounded px-1 py-0.5 transition-colors w-full text-left"
                    >
                      <span>🚐</span>
                      <span className="truncate">{resolveUserName(event.assignedVanDriverId)}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Click to edit driver assignments</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Regular Drivers */}
              {getDriverCount(event) > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentDialog?.(event.id, 'driver');
                      }}
                      className="flex items-center gap-1 text-xs text-[#236383]/80 hover:text-[#236383] hover:bg-[#47B3CB]/10 rounded px-1 py-0.5 transition-colors w-full text-left"
                    >
                      <span>🚗</span>
                      <span className="truncate">
                        {getDriverIds(event)
                          .map(id => resolveUserName(id))
                          .filter(name => name && name !== 'Not assigned')
                          .join(', ')}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Click to edit driver assignments</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Volunteers */}
              {getVolunteerCount(event) > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentDialog?.(event.id, 'volunteer');
                      }}
                      className="flex items-center gap-1 text-xs text-[#236383]/80 hover:text-[#236383] hover:bg-[#47B3CB]/10 rounded px-1 py-0.5 transition-colors w-full text-left"
                    >
                      <span>👥</span>
                      <span className="truncate">
                        {getVolunteerIds(event)
                          .map(id => resolveUserName(id))
                          .filter(name => name && name !== 'Not assigned')
                          .join(', ')}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Click to edit volunteer assignments</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </TooltipProvider>
      );
    }

    // Special handling for allDetails column
    if (column.id === 'allDetails') {
      const detailsData = renderedContent as { fullText: string; hasContent: boolean };
      if (!detailsData.hasContent || !detailsData) {
        return <span className="text-base text-[#47B3CB]/60">-</span>;
      }

      // Check if text is truncated (will be truncated if longer than ~80 characters in a 150px column)
      const isTruncated = detailsData.fullText.length > 80;

      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="w-full text-left hover:bg-[#47B3CB]/5 rounded px-1 py-0.5 transition-colors group cursor-pointer"
              onClick={(e) => e.stopPropagation()} // Prevent double-click editing
            >
              <div className="flex items-center gap-1 min-w-0 w-full">
                <span
                  className="text-base font-medium leading-tight block overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0"
                  title={detailsData.fullText}
                >
                  {detailsData.fullText}
                </span>
                {isTruncated && (
                  <Eye className="h-3 w-3 text-[#007E8C] opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Click to view full details" />
                )}
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-96 max-h-96 overflow-y-auto"
            side="right"
            align="start"
            onClick={(e) => e.stopPropagation()} // Prevent event bubbling
          >
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[#236383] mb-2">All Details</h4>
              <div className="text-sm text-[#236383] whitespace-pre-wrap break-words">
                {detailsData.fullText || 'No details available'}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    
    const content = typeof renderedContent === 'string' ? renderedContent : String(renderedContent);

    return (
      <div
        className="flex items-center gap-0.5 group min-h-[20px]"
        onDoubleClick={() => isEditable && startEditing(event.id, column.id, getRawValue())}
      >
        <span className="text-base font-normal truncate flex-1 leading-relaxed">{content || '-'}</span>
        {isEditable && (
          <button
            onClick={() => startEditing(event.id, column.id, getRawValue())}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-11 w-11 md:h-auto md:w-auto flex items-center justify-center touch-manipulation"
            title="Edit this field"
          >
            <Edit2 className="h-6 w-6 md:h-3 md:w-3 text-[#007E8C]" />
          </button>
        )}
      </div>
    );
  };

  if (scheduledEvents.length === 0) {
    return (
      <div className="text-center py-8 text-[#236383]/60">
        No scheduled events
      </div>
    );
  }

  // Spreadsheet content that can be rendered normally or in fullscreen
  const spreadsheetContent = (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-white p-4 overflow-auto" : "w-full"}>
      {/* Fullscreen Header */}
      {isFullscreen && (
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#47B3CB]/30">
          <h2 className="text-xl font-semibold text-[#236383]">Scheduled Events Spreadsheet</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(false)}
            className="border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
          >
            <Minimize2 className="h-4 w-4 mr-2" />
            Exit Fullscreen
          </Button>
        </div>
      )}

      {/* Search and Controls */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
          <div className="text-sm text-[#236383]">
            {sortedEvents.length} event{sortedEvents.length !== 1 ? 's' : ''}
          </div>
          {/* Fullscreen toggle button - only show when NOT already fullscreen */}
          {!isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(true)}
              className="ml-auto border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
              title="Open spreadsheet in fullscreen mode for easier editing"
            >
              <Maximize2 className="h-4 w-4 mr-2" />
              Fullscreen
            </Button>
          )}
        </div>
        
        {/* Date Range Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-[#236383] font-medium">Show:</span>
          <Button
            variant={dateRange === 'thisWeek' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('thisWeek')}
            className={dateRange === 'thisWeek' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            This Week
          </Button>
          <Button
            variant={dateRange === 'nextWeek' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('nextWeek')}
            className={dateRange === 'nextWeek' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            Next Week
          </Button>
          <Button
            variant={dateRange === 'next2Weeks' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('next2Weeks')}
            className={dateRange === 'next2Weeks' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            Next 2 Weeks
          </Button>
          <Button
            variant={dateRange === 'thisMonth' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('thisMonth')}
            className={dateRange === 'thisMonth' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            This Month
          </Button>
          <Button
            variant={dateRange === 'nextMonth' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('nextMonth')}
            className={dateRange === 'nextMonth' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            Next Month
          </Button>
          <Button
            variant={dateRange === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDateRange('all')}
            className={dateRange === 'all' ? 'bg-[#007E8C] hover:bg-[#236383] text-white' : 'border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10'}
          >
            All Events
          </Button>
        </div>
      </div>

      {/* Mobile Card View */}
      {isMobile ? (
        <div className="space-y-3">
          {sortedEvents.map((event, rowIndex) => {
            const dayIndex = eventDayIndices.get(`${event.id}`) || 0;
            const borderColor = dayBorderColors[dayIndex % dayBorderColors.length];
            const rowBgColor = getRowColor(event, rowIndex);
            
            return (
              <div
                key={event.id}
                className="bg-white rounded-lg shadow-sm overflow-hidden"
                style={{ borderLeft: `4px solid ${borderColor}` }}
                onClick={() => handleEventDateClick(event)}
              >
                <div className={`p-3 ${rowBgColor}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[#236383]">
                          {formatDate(getEffectiveEventDate(event))}
                        </span>
                        <span className="text-xs text-[#007E8C] font-medium">
                          {formatDayOfWeek(getEffectiveEventDate(event))?.slice(0, 3)}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-[#236383] truncate">
                        {event.organizationName || `${event.firstName} ${event.lastName}`.trim() || 'N/A'}
                      </h3>
                      {event.department && (
                        <p className="text-xs text-[#236383]/70 truncate">{event.department}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-lg font-bold text-[#007E8C]">
                        {event.estimatedSandwichCount || '-'}
                      </div>
                      <div className="text-xs text-[#236383]/60">sandwiches</div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#236383]/80">
                    {event.eventStartTime && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-[#007E8C]" />
                        <span>{formatTime(event.eventStartTime)}</span>
                      </div>
                    )}
                    {event.eventAddress && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.eventAddress)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[#007E8C] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="truncate max-w-[120px]">
                          {(() => {
                            const parts = event.eventAddress.split(',');
                            return parts.length >= 2 ? parts[parts.length - 2].trim() : parts[0].trim();
                          })()}
                        </span>
                      </a>
                    )}
                  </div>
                  
                  {(event.driversNeeded || event.volunteersNeeded) && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-[#47B3CB]/20">
                      {event.driversNeeded > 0 && (() => {
                        const totalDriversAssigned = getTotalDriverCount(event);
                        return (
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              totalDriversAssigned >= event.driversNeeded
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-amber-50 text-amber-700 border-amber-300'
                            }`}
                          >
                            <Car className="h-3 w-3 mr-1" />
                            {totalDriversAssigned}/{event.driversNeeded}
                          </Badge>
                        );
                      })()}
                      {event.volunteersNeeded > 0 && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            getVolunteerCount(event) >= event.volunteersNeeded
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-amber-50 text-amber-700 border-amber-300'
                          }`}
                        >
                          <Users className="h-3 w-3 mr-1" />
                          {getVolunteerCount(event)}/{event.volunteersNeeded}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          {sortedEvents.length === 0 && (
            <div className="text-center py-8 text-[#236383]/60">
              No events found for the selected time period
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Table Container with Horizontal and Vertical Scroll */}
          <div className="border border-[#47B3CB]/30 rounded-lg overflow-hidden bg-white shadow-sm">
            <div className="overflow-x-auto" style={{ minHeight: '500px', maxHeight: isFullscreen ? 'calc(100vh - 180px)' : 'none', overflowY: 'auto', willChange: 'scroll-position' }}>
              <table className="w-full border-collapse">
            <thead className="bg-[#236383] border-b border-[#007E8C] sticky top-0 z-30" style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
              <tr>
                {columns.map((column, colIndex) => {
                  const columnWidth = columnWidths[column.id] || parseInt(column.width?.replace('px', '') || '150');

                  // Calculate left offset for frozen columns
                  let leftOffset = 0;
                  if (column.frozen) {
                    for (let i = 0; i < colIndex; i++) {
                      if (columns[i].frozen) {
                        leftOffset += columnWidths[columns[i].id] || parseInt(columns[i].width?.replace('px', '') || '150');
                      }
                    }
                  }

                  // Check if this is the last frozen column (for shadow)
                  const isLastFrozen = column.frozen && (colIndex === columns.length - 1 || !columns[colIndex + 1]?.frozen);

                  return (
                    <th
                      key={column.id}
                      draggable={!column.frozen}
                      onDragStart={(e) => !column.frozen && handleDragStart(e, colIndex)}
                      onDragOver={(e) => handleDragOver(e, colIndex)}
                      onDrop={(e) => handleDrop(e, colIndex)}
                      onDragEnd={handleDragEnd}
                      className={`px-1.5 py-2 ${column.center ? 'text-center' : 'text-left'} text-xs font-semibold text-white border-r border-[#007E8C]/50 select-none group relative ${
                        column.frozen ? 'sticky z-40 bg-[#236383]' : 'cursor-move'
                      } ${draggedColumnIndex === colIndex ? 'opacity-50' : 'hover:bg-[#007E8C]'} ${
                        isLastFrozen ? 'shadow-[2px_0_5px_-2px_rgba(0,0,0,0.2)] border-r-2 border-r-[#47B3CB]/30' : ''
                      }`}
                      style={{
                        width: `${columnWidth}px`,
                        minWidth: `${columnWidth}px`,
                        maxWidth: `${columnWidth}px`,
                        ...(column.frozen ? {
                          left: `${leftOffset}px`,
                          transform: 'translateZ(0)',
                          backfaceVisibility: 'hidden' as const,
                        } : {})
                      }}
                      title={column.frozen ? column.label : "Drag to reorder columns"}
                    >
                      <div className={`flex items-center gap-0.5 ${column.center ? 'justify-center' : ''}`}>
                        {!column.center && <GripVertical className="h-3 w-3 text-white/60 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />}
                        <span className={`leading-tight ${column.center ? '' : 'flex-1'}`}>{column.label}</span>
                        {column.sortable && (() => {
                          const columnSortField = getSortFieldForColumn(column.id);
                          const isActive = columnSortField && sortField === columnSortField;
                          return (
                            <button
                              onClick={() => {
                                if (columnSortField) {
                                  handleSort(columnSortField);
                                }
                              }}
                              className="hover:bg-[#47B3CB]/30 rounded p-1 md:p-0.5 ml-0.5 touch-manipulation"
                              title={`Sort by ${column.label}`}
                            >
                              {isActive ? (
                                sortDirection === 'asc' ? (
                                  <ArrowUp className="h-5 w-5 md:h-2.5 md:w-2.5 text-white" />
                                ) : (
                                  <ArrowDown className="h-5 w-5 md:h-2.5 md:w-2.5 text-white" />
                                )
                              ) : (
                                <ArrowUpDown className="h-5 w-5 md:h-2.5 md:w-2.5 text-white/70" />
                              )}
                            </button>
                          );
                        })()}
                      </div>
                      {/* Resize Handle */}
                      <div
                        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-[#47B3CB] active:bg-[#47B3CB]"
                        onMouseDown={(e) => handleResizeStart(e, column.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to resize column"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedEvents.map((event, rowIndex) => (
                <tr
                  key={event.id}
                  className={`${getRowColor(event, rowIndex)} border-b border-[#47B3CB]/20 hover:bg-[#47B3CB]/10 transition-colors`}
                  style={{ minHeight: '48px', ...getLeftBorderStyle(event, rowIndex) }}
                >
                  {columns.map((column, colIndex) => {
                    const columnWidth = columnWidths[column.id] || parseInt(column.width?.replace('px', '') || '150');

                    // Calculate left offset for frozen columns
                    let leftOffset = 0;
                    if (column.frozen) {
                      for (let i = 0; i < colIndex; i++) {
                        if (columns[i].frozen) {
                          leftOffset += columnWidths[columns[i].id] || parseInt(columns[i].width?.replace('px', '') || '150');
                        }
                      }
                    }

                    // Check if this is the last frozen column (for shadow)
                    const isLastFrozen = column.frozen && (colIndex === columns.length - 1 || !columns[colIndex + 1]?.frozen);

                    // Get the row background color for frozen cells
                    const rowBgColor = getRowColor(event, rowIndex);

                    return (
                      <td
                        key={column.id}
                        className={`px-1.5 py-2 border-r border-[#47B3CB]/20 text-base leading-relaxed overflow-hidden ${
                          column.center ? 'text-center' : 'align-top'
                        } ${
                          column.frozen ? `sticky z-20 ${rowBgColor}` : ''
                        } ${isLastFrozen ? 'border-r-2 border-r-[#47B3CB]/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]' : ''}`}
                        style={{
                          width: `${columnWidth}px`,
                          minWidth: `${columnWidth}px`,
                          maxWidth: `${columnWidth}px`,
                          ...(column.frozen ? {
                            left: `${leftOffset}px`,
                            transform: 'translateZ(0)',
                            backfaceVisibility: 'hidden' as const,
                          } : {})
                        }}
                      >
                        {renderCell(event, column)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

          {/* Instructions */}
          <div className="mt-4 text-xs text-[#236383]/70 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span>Double-click any editable cell to edit. Press Enter to save, Escape to cancel.</span>
            </div>
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4" />
              <span>Drag column headers to reorder columns. Your preference will be saved.</span>
            </div>
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4" />
              <span>Click Fullscreen for a larger workspace. Press Escape to exit fullscreen mode.</span>
            </div>
          </div>
        </>
      )}

      {/* Sandwich Types Dialog */}
      <Dialog open={showSandwichDialog} onOpenChange={setShowSandwichDialog}>
        <DialogContent className="w-[95vw] max-w-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit Sandwich Types</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {dialogSandwichTypes.map((sandwichType, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-[#47B3CB]/10 rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-[#236383]">Type</label>
                    <Select
                      value={sandwichType.type}
                      onValueChange={(value) => updateSandwichType(index, 'type', value)}
                    >
                      <SelectTrigger className="w-full" data-testid={`select-sandwich-type-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pbj">PB&J</SelectItem>
                        <SelectItem value="deli">Deli</SelectItem>
                        <SelectItem value="deli_turkey">Turkey</SelectItem>
                        <SelectItem value="deli_ham">Ham</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-[#236383]">Quantity</label>
                    <Input
                      type="number"
                      min="0"
                      value={sandwichType.quantity}
                      onChange={(e) => updateSandwichType(index, 'quantity', parseInt(e.target.value) || 0)}
                      className="w-full"
                      data-testid={`input-sandwich-quantity-${index}`}
                    />
                  </div>
                </div>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSandwichType(index)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 mt-6"
                  disabled={dialogSandwichTypes.length === 1}
                  data-testid={`button-remove-sandwich-type-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            
            <Button
              variant="outline"
              onClick={addSandwichType}
              className="w-full border-dashed border-[#007E8C] text-[#007E8C] hover:bg-[#007E8C]/10"
              data-testid="button-add-sandwich-type"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Another Type
            </Button>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeSandwichDialog}
              data-testid="button-cancel-sandwich-dialog"
            >
              Cancel
            </Button>
            <Button
              onClick={saveSandwichTypes}
              className="bg-[#007E8C] hover:bg-[#236383] text-white"
              data-testid="button-save-sandwich-types"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return spreadsheetContent;
};
