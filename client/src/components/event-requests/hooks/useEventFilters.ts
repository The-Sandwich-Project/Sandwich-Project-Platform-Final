import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EventRequest, EventVolunteer } from '@shared/schema';
import { useEventRequestContext } from '../context/EventRequestContext';
import { useAuth } from '@/hooks/useAuth';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { compareEventsByDateThenTime } from '@/lib/event-sort';

export const useEventFilters = () => {
  const {
    eventRequests,
    debouncedSearchQuery,
    statusFilter,
    myAssignmentsStatusFilter,
    confirmationFilter,
    sortBy,
    currentPage,
    itemsPerPage,
  } = useEventRequestContext();

  const { user } = useAuth();

  // Fetch event volunteers data for all events (needed for search)
  const { data: eventVolunteers = [] } = useQuery<EventVolunteer[]>({
    queryKey: ['/api/event-requests/all-volunteers'],
    enabled: true,
  });

  // Fetch users to get TSP contact names
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
    enabled: true,
  });

  // Helper function to check if current user is assigned to an event
  const isUserAssignedToEvent = (request: EventRequest): boolean => {
    if (!user?.id) return false;

    // Check TSP Contact assignment (both old and new column names)
    if (request.tspContactAssigned === user.id || request.tspContact === user.id) {
      return true;
    }

    // Also check additional TSP contacts
    if (request.additionalContact1 === user.id || request.additionalContact2 === user.id) {
      return true;
    }

    // Check driver assignment in driverDetails JSONB field
    if (request.driverDetails) {
      try {
        const driverDetails = typeof request.driverDetails === 'string'
          ? JSON.parse(request.driverDetails)
          : request.driverDetails;

        // Driver assignments are stored as keys in the driverDetails object
        // Example: {"351": {"name": "Gary Munder", "assignedBy": "admin_..."}}
        if (driverDetails && typeof driverDetails === 'object' && !Array.isArray(driverDetails)) {
          const driverKeys = Object.keys(driverDetails);
          if (driverKeys.some(key => key === user.id || key === user.id.toString())) {
            return true;
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check speaker assignment in speakerDetails JSONB field
    if (request.speakerDetails) {
      try {
        const speakerDetails = typeof request.speakerDetails === 'string'
          ? JSON.parse(request.speakerDetails)
          : request.speakerDetails;

        // Speaker assignments are stored as keys in the speakerDetails object
        if (speakerDetails && typeof speakerDetails === 'object' && !Array.isArray(speakerDetails)) {
          const speakerKeys = Object.keys(speakerDetails);
          if (speakerKeys.some(key => key === user.id || key === user.id.toString())) {
            return true;
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check event volunteers assignment (driver, speaker, general)
    const userVolunteerAssignment = eventVolunteers.find(volunteer =>
      volunteer.eventRequestId === request.id &&
      volunteer.volunteerUserId === user.id
    );

    if (userVolunteerAssignment) {
      return true;
    }

    return false;
  };

  // Get user's assigned events regardless of status
  const userAssignedEvents = useMemo(() => {
    return eventRequests.filter(isUserAssignedToEvent);
  }, [eventRequests, eventVolunteers, user?.id]);

  // Helper function to get TSP contact name from user ID
  const getTspContactName = (userId: string | null | undefined): string => {
    if (!userId) return '';
    const user = users.find(u => u.id === userId);
    if (!user) return '';
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return fullName || user.email || user.name || '';
  };

  // Helper function to check if event has a volunteer matching the search
  const eventHasVolunteerMatch = (request: EventRequest, searchLower: string): boolean => {
    // Get all volunteers for this event from eventVolunteers table
    const eventVolunteersList = eventVolunteers.filter(v => v.eventRequestId === request.id);

    // Check registered volunteers (with user IDs)
    for (const volunteer of eventVolunteersList) {
      if (volunteer.volunteerUserId) {
        const volunteerName = getTspContactName(volunteer.volunteerUserId);
        if (volunteerName.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
      // Check non-registered volunteers
      if (volunteer.volunteerName && volunteer.volunteerName.toLowerCase().includes(searchLower)) {
        return true;
      }
      if (volunteer.volunteerEmail && volunteer.volunteerEmail.toLowerCase().includes(searchLower)) {
        return true;
      }
    }

    // Check speakerDetails JSONB field (primary storage for speaker assignments)
    if (request.speakerDetails) {
      try {
        const speakerDetails = typeof request.speakerDetails === 'string'
          ? JSON.parse(request.speakerDetails)
          : request.speakerDetails;
        if (speakerDetails && typeof speakerDetails === 'object' && !Array.isArray(speakerDetails)) {
          for (const [speakerId, speakerData] of Object.entries(speakerDetails)) {
            // Check the name stored in the details
            const data = speakerData as any;
            if (data?.name && data.name.toLowerCase().includes(searchLower)) {
              return true;
            }
            // Also check if the ID matches a user
            const speakerName = getTspContactName(speakerId);
            if (speakerName.toLowerCase().includes(searchLower)) {
              return true;
            }
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check driverDetails JSONB field (primary storage for driver assignments)
    if (request.driverDetails) {
      try {
        const driverDetails = typeof request.driverDetails === 'string'
          ? JSON.parse(request.driverDetails)
          : request.driverDetails;
        if (driverDetails && typeof driverDetails === 'object' && !Array.isArray(driverDetails)) {
          for (const [driverId, driverData] of Object.entries(driverDetails)) {
            // Check the name stored in the details
            const data = driverData as any;
            if (data?.name && data.name.toLowerCase().includes(searchLower)) {
              return true;
            }
            // Also check if the ID matches a user
            const driverName = getTspContactName(driverId);
            if (driverName.toLowerCase().includes(searchLower)) {
              return true;
            }
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Check volunteerDetails JSONB field (primary storage for volunteer assignments)
    if (request.volunteerDetails) {
      try {
        const volunteerDetails = typeof request.volunteerDetails === 'string'
          ? JSON.parse(request.volunteerDetails)
          : request.volunteerDetails;
        if (volunteerDetails && typeof volunteerDetails === 'object' && !Array.isArray(volunteerDetails)) {
          for (const [volunteerId, volunteerData] of Object.entries(volunteerDetails)) {
            // Check the name stored in the details
            const data = volunteerData as any;
            if (data?.name && data.name.toLowerCase().includes(searchLower)) {
              return true;
            }
            // Also check if the ID matches a user
            const volunteerName = getTspContactName(volunteerId);
            if (volunteerName.toLowerCase().includes(searchLower)) {
              return true;
            }
          }
        }
      } catch (e) {
        // If parsing fails, continue with other checks
      }
    }

    // Also check legacy assignedSpeakerIds array
    if (request.assignedSpeakerIds && Array.isArray(request.assignedSpeakerIds)) {
      for (const speakerId of request.assignedSpeakerIds) {
        const speakerName = getTspContactName(speakerId);
        if (speakerName.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Also check if it's a direct name string
        if (typeof speakerId === 'string' && speakerId.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
    }

    // Check assignedVolunteerIds array
    if (request.assignedVolunteerIds && Array.isArray(request.assignedVolunteerIds)) {
      for (const volunteerId of request.assignedVolunteerIds) {
        const volunteerName = getTspContactName(volunteerId);
        if (volunteerName.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Also check if it's a direct name string
        if (typeof volunteerId === 'string' && volunteerId.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
    }

    // Check assignedDriverIds array
    if (request.assignedDriverIds && Array.isArray(request.assignedDriverIds)) {
      for (const driverId of request.assignedDriverIds) {
        const driverName = getTspContactName(driverId);
        if (driverName.toLowerCase().includes(searchLower)) {
          return true;
        }
        // Also check if it's a direct name string
        if (typeof driverId === 'string' && driverId.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
    }

    return false;
  };

  // Helper to parse date in local timezone (avoids UTC midnight timezone shift)
  const parseLocalDate = (dateInput: string | Date | null | undefined): Date | null => {
    if (!dateInput) return null;
    if (dateInput instanceof Date) {
      // Normalize to local date (year, month, day only) to avoid timezone issues
      return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
    }
    if (typeof dateInput !== 'string') return null;
    
    const trimmed = dateInput.trim();
    
    // If it's just a date (YYYY-MM-DD), parse in local time to avoid timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    
    // Handle database timestamp format: "2024-12-01 00:00:00" or "2024-12-01 00:00:00.000"
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      const dateOnly = trimmed.split(' ')[0];
      const [year, month, day] = dateOnly.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    
    // Handle ISO format with timezone: "2024-12-01T00:00:00Z" or "2024-12-01T00:00:00.000Z"
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const dateOnly = trimmed.split('T')[0];
      const [year, month, day] = dateOnly.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    
    // For other formats, parse and normalize to local date
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      // Normalize to local date (year, month, day only) to avoid timezone issues
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    
    return null;
  };

  // Helper function to parse a date string from search query
  const parseSearchQueryAsDate = (searchQuery: string): Date | null => {
    if (!searchQuery) return null;
    
    const trimmed = searchQuery.trim();
    
    // Try YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    
    // Try MM/DD/YYYY or M/D/YYYY format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const parts = trimmed.split('/');
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
        return new Date(year, month - 1, day);
      }
    }
    
    // Try M-D-YYYY or MM-DD-YYYY format (with dashes)
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
      const parts = trimmed.split('-');
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
        return new Date(year, month - 1, day);
      }
    }
    
    // Try other common formats - be more lenient
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      // If it's a valid date, parse it in local timezone to avoid timezone shift
      // Only accept dates that seem reasonable (not epoch dates, etc.)
      const year = parsed.getFullYear();
      if (year >= 1900 && year <= 2100) {
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      }
    }
    
    return null;
  };

  // Helper function to check if a date matches the search query
  const dateMatchesSearch = (dateValue: string | Date | null | undefined, searchQuery: string): boolean => {
    if (!dateValue || !searchQuery) return false;

    try {
      const date = parseLocalDate(dateValue);
      if (!date) return false;

      // First, try to parse the search query as a date
      const searchDate = parseSearchQueryAsDate(searchQuery);
      if (searchDate) {
        // If search query is a date, compare actual date values (year, month, day)
        // Normalize both dates to midnight in local timezone for accurate comparison
        const dateNormalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const searchNormalized = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate());
        return dateNormalized.getTime() === searchNormalized.getTime();
      }

      // Fall back to string matching for non-date queries
      const searchLower = searchQuery.toLowerCase().trim();

      // Generate multiple date format strings to match against
      const formats = [
        // ISO format: YYYY-MM-DD
        `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
        // US format: MM/DD/YYYY
        `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`,
        // US format without leading zeros: M/D/YYYY
        `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
        // US format with dashes: MM-DD-YYYY
        `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}-${date.getFullYear()}`,
        // Locale-specific formats
        date.toLocaleDateString('en-US'),
        date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        // Just month/day for partial matches
        `${date.getMonth() + 1}/${date.getDate()}`,
        `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`,
      ];

      return formats.some(format => format.toLowerCase().includes(searchLower));
    } catch (error) {
      console.error('Error in dateMatchesSearch:', error, { dateValue, searchQuery });
      return false;
    }
  };

  // Filter and sort event requests
  const filteredAndSortedRequests = useMemo(() => {
    let filtered = eventRequests.filter((request: EventRequest) => {
      // Search matching
      let matchesSearch = debouncedSearchQuery === '';

      if (!matchesSearch) {
        const searchLower = debouncedSearchQuery.toLowerCase();

        // Check TSP contacts
        const tspContactName = getTspContactName(request.tspContact || request.tspContactAssigned);
        const additionalContact1Name = getTspContactName(request.additionalContact1);
        const additionalContact2Name = getTspContactName(request.additionalContact2);
        const customTspContact = request.customTspContact || '';

        const matchesTspContact =
          (tspContactName && tspContactName.toLowerCase().includes(searchLower)) ||
          (additionalContact1Name && additionalContact1Name.toLowerCase().includes(searchLower)) ||
          (additionalContact2Name && additionalContact2Name.toLowerCase().includes(searchLower)) ||
          (customTspContact && customTspContact.toLowerCase().includes(searchLower));

        // Check volunteers (drivers, speakers, general)
        const matchesVolunteer = eventHasVolunteerMatch(request, searchLower);

        matchesSearch =
          (request.organizationName && String(request.organizationName)
            .toLowerCase()
            .includes(searchLower)) ||
          (request.department && String(request.department).toLowerCase().includes(searchLower)) ||
          (request.firstName && String(request.firstName).toLowerCase().includes(searchLower)) ||
          (request.lastName && String(request.lastName).toLowerCase().includes(searchLower)) ||
          (request.email && String(request.email).toLowerCase().includes(searchLower)) ||
          (request.eventAddress && String(request.eventAddress).toLowerCase().includes(searchLower)) ||
          dateMatchesSearch(getEffectiveEventDate(request), debouncedSearchQuery) ||
          matchesTspContact ||
          matchesVolunteer;
      }

      const matchesStatus =
        statusFilter === 'all' || request.status === statusFilter ||
        (statusFilter === 'scheduled' && request.status === 'rescheduled');

      // Completed events are always considered confirmed
      const isEventConfirmed = request.status === 'completed' || request.isConfirmed;

      const matchesConfirmation =
        confirmationFilter === 'all' ||
        (confirmationFilter === 'confirmed' && isEventConfirmed) ||
        (confirmationFilter === 'requested' && !isEventConfirmed);

      return matchesSearch && matchesStatus && matchesConfirmation;
    });

    // Sort the filtered results
    filtered.sort((a: EventRequest, b: EventRequest) => {
      switch (sortBy) {
        case 'event_date_desc':
          return compareEventsByDateThenTime(a, b, 'desc');
        case 'event_date_asc':
          return compareEventsByDateThenTime(a, b, 'asc');
        case 'organization_asc':
          return (a.organizationName || '').localeCompare(b.organizationName || '');
        case 'organization_desc':
          return (b.organizationName || '').localeCompare(a.organizationName || '');
        case 'created_date_desc':
          const createdDateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const createdDateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return createdDateB - createdDateA;
        case 'created_date_asc':
          const oldCreatedDateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const oldCreatedDateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return oldCreatedDateA - oldCreatedDateB;
        default:
          return 0;
      }
    });

    return filtered;
  }, [eventRequests, debouncedSearchQuery, statusFilter, confirmationFilter, sortBy, eventVolunteers, users]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedRequests.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRequests = filteredAndSortedRequests.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  // Filter by status for tab display.
  // `skipPagination` returns the full filtered+sorted set (no page slice) —
  // used by the Export action so the spreadsheet contains every matching row,
  // not just the current page.
  const filterRequestsByStatus = (status: string, options?: { skipPagination?: boolean }) => {
    const source =
      status === 'all' || status === 'my_assignments'
        ? eventRequests
        : eventRequests.filter((req: EventRequest) => req.status === status || (status === 'scheduled' && req.status === 'rescheduled'));

    const sorted = source
      .filter((request: EventRequest) => {
        let matchesStatus = true;

        if (status === 'my_assignments') {
          // Special handling for my assignments - check if user is assigned
          // AND filter by selected statuses in myAssignmentsStatusFilter
          matchesStatus = isUserAssignedToEvent(request) && myAssignmentsStatusFilter.includes(request.status);
        } else if (status !== 'all') {
          // Regular status filtering - include rescheduled in scheduled tab
          matchesStatus = request.status === status || (status === 'scheduled' && request.status === 'rescheduled');
        }

        let matchesSearch = debouncedSearchQuery === '';

        if (!matchesSearch) {
          const searchLower = debouncedSearchQuery.toLowerCase();

          // Check TSP contacts
          const tspContactName = getTspContactName(request.tspContact || request.tspContactAssigned);
          const additionalContact1Name = getTspContactName(request.additionalContact1);
          const additionalContact2Name = getTspContactName(request.additionalContact2);
          const customTspContact = request.customTspContact || '';

          const matchesTspContact =
            tspContactName.toLowerCase().includes(searchLower) ||
            additionalContact1Name.toLowerCase().includes(searchLower) ||
            additionalContact2Name.toLowerCase().includes(searchLower) ||
            customTspContact.toLowerCase().includes(searchLower);

          // Check volunteers (drivers, speakers, general)
          const matchesVolunteer = eventHasVolunteerMatch(request, searchLower);

          matchesSearch =
            (request.organizationName && request.organizationName
              .toLowerCase()
              .includes(searchLower)) ||
            (request.department && request.department.toLowerCase().includes(searchLower)) ||
            (request.firstName && request.firstName
              .toLowerCase()
              .includes(searchLower)) ||
            (request.lastName && request.lastName
              .toLowerCase()
              .includes(searchLower)) ||
            (request.email && request.email
              .toLowerCase()
              .includes(searchLower)) ||
            (request.eventAddress && request.eventAddress.toLowerCase().includes(searchLower)) ||
            dateMatchesSearch(getEffectiveEventDate(request), debouncedSearchQuery) ||
            matchesTspContact ||
            matchesVolunteer;
        }

        // Completed events are always considered confirmed
        const isEventConfirmed = request.status === 'completed' || request.isConfirmed;

        const matchesConfirmation =
          confirmationFilter === 'all' ||
          (confirmationFilter === 'confirmed' && isEventConfirmed) ||
          (confirmationFilter === 'requested' && !isEventConfirmed);

        return matchesStatus && matchesSearch && matchesConfirmation;
      })
      .sort((a: EventRequest, b: EventRequest) => {
        switch (sortBy) {
          case 'event_date_desc':
            return compareEventsByDateThenTime(a, b, 'desc');
          case 'event_date_asc':
            return compareEventsByDateThenTime(a, b, 'asc');
          case 'organization_asc':
            return (a.organizationName || '').localeCompare(b.organizationName || '');
          case 'organization_desc':
            return (b.organizationName || '').localeCompare(a.organizationName || '');
          case 'created_date_desc':
            const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return createdB - createdA;
          case 'created_date_asc':
            const createdAscA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const createdAscB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return createdAscA - createdAscB;
          default:
            return 0;
        }
      });

    if (options?.skipPagination) {
      return sorted;
    }

    return sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  };

  return {
    filteredAndSortedRequests,
    paginatedRequests,
    totalPages,
    filterRequestsByStatus,
    dateMatchesSearch,
    userAssignedEvents,
    isUserAssignedToEvent,
  };
};
