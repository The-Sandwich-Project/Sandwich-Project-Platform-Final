import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Building,
  User,
  Mail,
  Phone,
  Calendar,
  Users,
  MapPin,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  UserCheck,
  Edit,
  Plus,
  X,
  ArrowUp,
  Download,
} from 'lucide-react';
import { formatDateForDisplay } from '@/lib/date-utils';
import { logger } from '@/lib/logger';
import { StandardFilterBar } from '@/components/ui/standard-filter-bar';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import type { UserForPermissions } from '@shared/types';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface OrganizationContact {
  organizationName: string;
  contactName: string;
  email?: string;
  phone?: string;
  department?: string;
  category?: string | null;
  schoolClassification?: string | null;
  isReligious?: boolean;
  latestRequestDate: string;
  latestActivityDate: string;
  totalRequests: number;
  status:
    | 'new'
    | 'contacted'
    | 'completed'
    | 'scheduled'
    | 'past'
    | 'declined'
    | 'cancelled'
    | 'contact_completed'
    | 'in_process';
  hasHostedEvent: boolean;
  eventDate?: string | null;
  totalSandwiches?: number;
  actualSandwichTotal?: number;
  actualEventCount?: number;
  eventFrequency?: string | null;
  latestCollectionDate?: string | null;
  tspContact?: string | null;
  tspContactAssigned?: string | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  pastEvents?: Array<{ date: string; sandwichCount: number }>;
  // Partner organization fields
  isPartnerEntry?: boolean;
  primaryOrganization?: string;
  partnerRole?: 'co-host' | 'partner' | 'sponsor';
  linkedEventId?: number;
  eventIds?: number[]; // All event IDs aggregated in this card
  isFromCollectionOnly?: boolean;
  // Co-host tracking for primary entries
  isCoHostedEvent?: boolean;
  coHostNames?: string[];
}

interface GroupCatalogProps {
  onNavigateToEventPlanning?: () => void;
}

// Helper function to get category display label
const getCategoryLabel = (category: string | null | undefined): string => {
  if (!category) return 'Uncategorized';
  const labels: Record<string, string> = {
    school: 'School',
    church_faith: 'Church/Faith',
    religious: 'Religious Organization',
    nonprofit: 'Nonprofit',
    government: 'Government',
    hospital: 'Hospital',
    political: 'Political Organization',
    club: 'Club',
    neighborhood: 'Neighborhood',
    greek_life: 'Fraternity/Sorority',
    cultural: 'Cultural Organization',
    corp: 'Company',
    large_corp: 'Company',
    small_medium_corp: 'Small Business',
    other: 'Other',
  };
  return labels[category] || category;
};

// Helper function to get category badge color
const getCategoryBadgeColor = (category: string | null | undefined): string => {
  if (!category) return 'bg-gray-100 text-gray-700';
  const colors: Record<string, string> = {
    school: 'bg-blue-100 text-blue-700',
    church_faith: 'bg-purple-100 text-purple-700',
    religious: 'bg-violet-100 text-violet-700',
    nonprofit: 'bg-rose-100 text-rose-700',
    government: 'bg-slate-100 text-slate-700',
    hospital: 'bg-cyan-100 text-cyan-700',
    political: 'bg-fuchsia-100 text-fuchsia-700',
    club: 'bg-green-100 text-green-700',
    neighborhood: 'bg-yellow-100 text-yellow-700',
    greek_life: 'bg-pink-100 text-pink-700',
    cultural: 'bg-amber-100 text-amber-700',
    corp: 'bg-indigo-100 text-indigo-700',
    large_corp: 'bg-indigo-100 text-indigo-700',
    small_medium_corp: 'bg-teal-100 text-teal-700',
    other: 'bg-gray-100 text-gray-700',
  };
  return colors[category] || 'bg-gray-100 text-gray-700';
};

// Helper function to determine if an event is in the future
function isFutureEvent(org: OrganizationContact): boolean {
  if (!org.eventDate) return false;
  const eventDate = new Date(org.eventDate);
  const now = new Date();
  return (isScheduledOrRescheduled(org.status) || org.status === 'in_process') && eventDate > now;
}

export default function GroupCatalog({
  onNavigateToEventPlanning: _onNavigateToEventPlanning,
}: GroupCatalogProps = {}) {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchScope, setSearchScope] = useState<'all' | 'organization' | 'department'>('all');
  const [sortBy, setSortBy] = useState('groupName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  // The aggregated view collapsed organizations into each other and lost roughly
  // half the catalog, so the catalog always requests individual cards.
  const viewMode = 'individual' as const;

  // Consolidated filter state
  const [filters, setFilters] = useState({
    status: [] as string[],
    category: [] as string[],
    dateRange: {} as { from?: Date; to?: Date },
    hostedEvents: [] as string[], // 'hosted', 'not-hosted'
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(24);
  const [selectedOrganization, setSelectedOrganization] =
    useState<OrganizationContact | null>(null);
  const [showEventDetailsDialog, setShowEventDetailsDialog] = useState(false);
  const [eventDetails, setEventDetails] = useState<any>(null);
  const [loadingEventDetails, setLoadingEventDetails] = useState(false);
  const [organizationDetails, setOrganizationDetails] = useState<any>(null);
  const [loadingOrganizationDetails, setLoadingOrganizationDetails] =
    useState(false);
  const [showContactDetailsModal, setShowContactDetailsModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<OrganizationContact | null>(null);

  // Edit category dialog state
  const [showEditCategoryDialog, setShowEditCategoryDialog] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState<OrganizationContact | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editSchoolClassification, setEditSchoolClassification] = useState('');
  const [editIsReligious, setEditIsReligious] = useState(false);
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Edit name dialog state
  const [showEditNameDialog, setShowEditNameDialog] = useState(false);
  const [editNameOrganization, setEditNameOrganization] = useState<OrganizationContact | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editDeptName, setEditDeptName] = useState('');
  const [partnerOrganizations, setPartnerOrganizations] = useState<Array<{ name: string; role: string }>>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const { user } = useAuth();
  const { toast } = useToast();

  // Check if user has permission to edit categories
  const canEditCategories = user && hasPermission(user as UserForPermissions, PERMISSIONS.ADMIN_PANEL_ACCESS);
  const canViewEventRequests = user && hasPermission(user as UserForPermissions, PERMISSIONS.NAV_EVENT_PLANNING);

  // Fetch groups data
  const {
    data: groupsResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['/api/groups-catalog', viewMode],
    queryFn: async () => {
      logger.log('🔄 Groups catalog fetching data from API...', { viewMode });
      const response = await fetch(`/api/groups-catalog?viewMode=${viewMode}`);
      if (!response.ok) throw new Error('Failed to fetch groups');
      const data = await response.json();
      logger.log('✅ Groups catalog received data:', data);
      return data;
    },
    // Use global defaults (5 min staleTime) - invalidateQueries handles refetch on mutations
  });

  // Mutation for updating organization category
  const updateCategoryMutation = useMutation({
    mutationFn: async (data: { name: string; category: string; schoolClassification?: string; isReligious?: boolean }) => {
      return apiRequest('POST', '/api/groups-catalog/upsert', data);
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Organization category updated successfully',
      });
      // Invalidate and force immediate refetch of groups catalog
      queryClient.invalidateQueries({ queryKey: ['/api/groups-catalog'], refetchType: 'all' });
      setShowEditCategoryDialog(false);
      setIsAddingNewCategory(false);
      setNewCategoryName('');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update organization category',
        variant: 'destructive',
      });
    },
  });

  // Mutation for renaming organization/department
  const renameOrganizationMutation = useMutation({
    mutationFn: async (data: {
      oldName: string;
      newName: string | null; // Can be null for co-hosted events
      oldDepartment?: string;
      newDepartment?: string;
      partnerOrganizations?: Array<{ name: string; role: string }>;
      eventId?: number; // If provided, only update this specific event
      eventIds?: number[]; // If provided, only update these specific events (for aggregated cards)
    }) => {
      return apiRequest('POST', '/api/groups-catalog/rename', data);
    },
    onSuccess: (data: any) => {
      const eventCount = data.updatedEventRequests || 0;
      const collectionCount = data.updatedCollections || 0;
      const description = eventCount === 1 && collectionCount === 0
        ? 'Event updated successfully.'
        : `Updated ${eventCount} event${eventCount !== 1 ? 's' : ''} and ${collectionCount} collection${collectionCount !== 1 ? 's' : ''}.`;

      toast({
        title: 'Success',
        description,
      });
      // Invalidate and force immediate refetch of groups catalog
      queryClient.invalidateQueries({ queryKey: ['/api/groups-catalog'], refetchType: 'all' });
      setShowEditNameDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to rename organization',
        variant: 'destructive',
      });
    },
  });

  // Handler to open edit name dialog
  const handleEditName = (org: OrganizationContact) => {
    setEditNameOrganization(org);
    setEditOrgName(org.organizationName);
    setEditDeptName(org.department || '');
    setPartnerOrganizations([]);
    setShowEditNameDialog(true);
  };

  // Handler to save name changes
  const handleSaveName = () => {
    // Filter out empty partner organizations
    const validPartners = partnerOrganizations.filter(p => p.name.trim());

    // Allow empty primary org if we have co-hosts (for truly co-hosted events)
    const hasValidPrimaryOrg = editOrgName.trim().length > 0;
    const hasValidCoHosts = validPartners.length > 0;

    if (!editNameOrganization || (!hasValidPrimaryOrg && !hasValidCoHosts)) {
      toast({
        title: 'Error',
        description: 'Please enter an organization name or add co-hosting organizations',
        variant: 'destructive',
      });
      return;
    }

    // For single-event cards (linkedEventId), we can edit the department
    // For aggregated cards (eventIds), we can still edit but it affects all events in the card
    // For cards without event IDs, we can still edit but it will match by organization name
    const hasLinkedEvent = !!editNameOrganization.linkedEventId;
    const hasEventIds = editNameOrganization.eventIds && editNameOrganization.eventIds.length > 0;
    const hasOrgName = !!editNameOrganization.organizationName;

    // Department editing is allowed if we have linkedEventId, eventIds, or organization name
    // (organization name allows matching by name, which is less precise but still works)
    const canEditDepartment = hasLinkedEvent || hasEventIds || hasOrgName;

    const mutationData = {
      oldName: editNameOrganization.organizationName,
      newName: editOrgName.trim() || null, // Allow empty/null for co-hosted events
      // Include department data when we can edit
      // Include oldDepartment to help match the right events (especially when no event IDs)
      oldDepartment: canEditDepartment ? (editNameOrganization.department || '') : undefined,
      newDepartment: canEditDepartment ? (editDeptName.trim() || '') : undefined,
      partnerOrganizations: validPartners.length > 0 ? validPartners : undefined,
      eventId: editNameOrganization.linkedEventId || undefined, // Only update this specific event if available
      // If no single linkedEventId, pass all eventIds for aggregated cards
      eventIds: hasEventIds ? editNameOrganization.eventIds : undefined,
    };
    console.log('🔵 Rename mutation data:', mutationData);
    console.log('🔵 editNameOrganization:', editNameOrganization);
    renameOrganizationMutation.mutate(mutationData);
  };

  // Handler to open edit category dialog
  const handleEditCategory = (org: OrganizationContact) => {
    setEditingOrganization(org);
    setEditCategory(org.category || '');
    setEditSchoolClassification(org.schoolClassification || '');
    setEditIsReligious(org.isReligious || false);
    setShowEditCategoryDialog(true);
  };

  // Handler to save category changes
  const handleSaveCategory = () => {
    if (!editingOrganization || !editCategory) {
      toast({
        title: 'Error',
        description: 'Please select a category',
        variant: 'destructive',
      });
      return;
    }

    updateCategoryMutation.mutate({
      name: editingOrganization.organizationName,
      category: editCategory,
      schoolClassification: editCategory === 'school' ? editSchoolClassification : undefined,
      isReligious: editIsReligious,
    });
  };

  // Function to fetch complete event details
  const fetchEventDetails = async (organization: OrganizationContact) => {
    setLoadingEventDetails(true);
    try {
      const response = await fetch(
        `/api/event-requests/details/${encodeURIComponent(
          organization.organizationName
        )}/${encodeURIComponent(organization.contactName)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch event details');
      }
      const details = await response.json();
      setEventDetails(details);
    } catch (error) {
      logger.error('Error fetching event details:', error);
      setEventDetails(null);
    } finally {
      setLoadingEventDetails(false);
    }
  };

  // Function to fetch complete organization details
  const fetchOrganizationDetails = async (organizationName: string) => {
    setLoadingOrganizationDetails(true);
    try {
      const response = await fetch(
        `/api/groups-catalog/details/${encodeURIComponent(organizationName)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch organization details');
      }
      const details = await response.json();
      setOrganizationDetails(details);
      setShowEventDetailsDialog(true);
    } catch (error) {
      logger.error('Error fetching organization details:', error);
      setOrganizationDetails(null);
    } finally {
      setLoadingOrganizationDetails(false);
    }
  };

  // Function to navigate to event request for editing
  const handleEditEventRequest = (eventId: number) => {
    if (!user || !hasPermission(user as UserForPermissions, PERMISSIONS.NAV_EVENT_PLANNING)) {
      return;
    }
    setShowEventDetailsDialog(false);
    setLocation(`/dashboard?section=event-requests&eventId=${eventId}`);
  };

  // Helper function to get status badge color
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'new':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'contacted':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'in_process':
        return 'bg-brand-primary-light text-brand-primary-dark border-brand-primary-border';
      case 'scheduled':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'completed':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'past':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'declined':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Extract and flatten groups from response
  const rawGroups = groupsResponse?.groups || [];

  // Create category lookup map by organization name
  const organizationCategoryMap = new Map<string, { category: string | null, schoolClassification: string | null, isReligious: boolean }>();
  rawGroups.forEach((org: any) => {
    organizationCategoryMap.set(org.name, {
      category: org.category || null,
      schoolClassification: org.schoolClassification || null,
      isReligious: org.isReligious || false,
    });
  });

  // Convert to flat structure and separate active vs historical organizations
  // Combine departments and contacts but deduplicate by unique key
  const allContactsAndDepartments = rawGroups.flatMap((org: any) => {
    const contacts = org.departments || org.contacts || [];
    return contacts.map((contact: any) => ({
      organizationName: org.name,
      contactName: contact.contactName || contact.name,
      email: contact.email,
      phone: contact.phone,
      department: contact.department,
      latestRequestDate: contact.latestRequestDate || org.lastRequestDate,
      latestActivityDate:
        contact.latestActivityDate ||
        contact.latestRequestDate ||
        org.lastRequestDate,
      totalRequests: contact.totalRequests || 1,
      status: contact.status || 'new',
      hasHostedEvent: contact.hasHostedEvent || org.hasHostedEvent,
      eventDate: contact.eventDate || null,
      totalSandwiches: contact.totalSandwiches || 0,
      actualSandwichTotal: contact.actualSandwichTotal || 0,
      actualEventCount: contact.actualEventCount || 0,
      eventFrequency: contact.eventFrequency || null,
      latestCollectionDate: contact.latestCollectionDate || null,
      tspContact: contact.tspContact || null,
      tspContactAssigned: contact.tspContactAssigned || null,
      assignedTo: contact.assignedTo || null,
      assignedToName: contact.assignedToName || null,
      category: org.category || null,
      schoolClassification: org.schoolClassification || null,
      isReligious: org.isReligious || false,
      // Event tracking for single-card edits
      linkedEventId: contact.linkedEventId || null,
      eventIds: contact.eventIds || [],
      // Partner/co-host tracking
      isPartnerEntry: contact.isPartnerEntry || false,
      primaryOrganization: contact.primaryOrganization || null,
      partnerRole: contact.partnerRole || null,
      isFromCollectionOnly: contact.isFromCollectionOnly || false,
      isCoHostedEvent: contact.isCoHostedEvent || false,
      coHostNames: contact.coHostNames || [],
      pastEvents: contact.pastEvents || [],
    }));
  });

  // Deduplicate by creating unique key from organization + department + contact + email
  // Include department to ensure cards with different departments are preserved.
  // The event ID keeps repeat events from the same contact as separate entries;
  // collection-only entries have no event ID and fall back to one entry per contact.
  const uniqueOrganizationsMap = new Map<string, OrganizationContact>();
  allContactsAndDepartments.forEach((org: any) => {
    const uniqueKey = `${org.organizationName}|${org.department || ''}|${org.contactName}|${org.email || 'no-email'}|${org.linkedEventId ?? 'no-event'}`;
    if (!uniqueOrganizationsMap.has(uniqueKey)) {
      uniqueOrganizationsMap.set(uniqueKey, org);
    }
  });

  const allOrganizations: OrganizationContact[] = Array.from(uniqueOrganizationsMap.values());

  // Hosting history belongs to the organization, not to a single entry. Each entry
  // only knows about its own event, so a declined request would otherwise place an
  // organization that has hosted before under "Never Hosted".
  const organizationsWithHostingHistory = new Set<string>(
    allOrganizations
      .filter((org) => org.hasHostedEvent || (org.actualSandwichTotal ?? 0) > 0)
      .map((org) => org.organizationName)
  );
  const hasHostingHistory = (org: OrganizationContact) =>
    organizationsWithHostingHistory.has(org.organizationName);

  // Filter all organizations uniformly (no separation between active/historical)
  const filteredActiveGroups = allOrganizations.filter((org) => {
    // Search logic based on scope
    let matchesSearch = true;
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();

      if (searchScope === 'organization') {
        // Only search organization name
        matchesSearch = org.organizationName && org.organizationName.toLowerCase().includes(lowerSearchTerm);
      } else if (searchScope === 'department') {
        // Only search department name
        matchesSearch = org.department && org.department.toLowerCase().includes(lowerSearchTerm);
      } else {
        // Search all fields (default)
        matchesSearch =
          (org.organizationName && org.organizationName.toLowerCase().includes(lowerSearchTerm)) ||
          (org.contactName && org.contactName.toLowerCase().includes(lowerSearchTerm)) ||
          (org.email && org.email.toLowerCase().includes(lowerSearchTerm)) ||
          (org.phone && org.phone.includes(searchTerm)) ||
          (org.department && org.department.toLowerCase().includes(lowerSearchTerm));
      }
    }

    // Category filter - empty array means show all categories
    const orgCategory = org.category || null;
    const matchesCategory = filters.category.length === 0 || filters.category.includes(orgCategory || '');

    // For organizations without email/status (from collections only), only apply search and category filter
    if (!org.email || org.contactName === 'Historical Organization' || org.contactName === 'Collection Logged Only') {
      return matchesSearch && matchesCategory;
    }

    // For organizations with event requests, apply all filters
    const matchesStatus = filters.status.length === 0 || filters.status.includes(org.status);

    // Use event date for filtering (when the event actually happened), not activity date (when it was created)
    const eventDate = org.eventDate ? new Date(org.eventDate) : null;
    const matchesDateStart = !filters.dateRange.from || !eventDate || eventDate >= filters.dateRange.from;
    const matchesDateEnd = !filters.dateRange.to || !eventDate || eventDate <= filters.dateRange.to;

    // Hosted events filter
    // "Never Hosted" = organizations that were declined/cancelled (they engaged but never hosted)
    // "Has Hosted" = organizations with completed events or collection data
    const matchesHosted = filters.hostedEvents.length === 0 ||
      (filters.hostedEvents.includes('hosted') && hasHostingHistory(org)) ||
      (filters.hostedEvents.includes('not-hosted') &&
        !hasHostingHistory(org) &&
        ['declined', 'cancelled'].includes(org.status));

    return matchesSearch && matchesCategory && matchesStatus && matchesDateStart && matchesDateEnd && matchesHosted;
  });

  // Group entries by group name
  interface GroupInfo {
    groupName: string;
    departments: OrganizationContact[];
    totalRequests: number;
    totalDepartments: number;
    hasHostedEvent: boolean;
    latestRequestDate: string;
    latestActivityDate: string;
  }

  // Process active organizations into groups
  const activeGroupInfo: GroupInfo[] = Array.from(
    filteredActiveGroups
      .reduce((groups: Map<string, GroupInfo>, org) => {
        const orgName = org.organizationName || 'Unknown Organization';

        if (!groups.has(orgName)) {
          groups.set(orgName, {
            groupName: orgName,
            departments: [],
            totalRequests: 0,
            totalDepartments: 0,
            hasHostedEvent: false,
            latestRequestDate: org.latestRequestDate,
            latestActivityDate: org.latestActivityDate,
          });
        }

        const group = groups.get(orgName)!;
        group.departments.push(org);
        group.totalRequests += org.totalRequests;
        group.hasHostedEvent = group.hasHostedEvent || org.hasHostedEvent;

        // Update latest request date
        if (
          new Date(org.latestRequestDate) > new Date(group.latestRequestDate)
        ) {
          group.latestRequestDate = org.latestRequestDate;
        }

        // Update latest activity date
        if (
          new Date(org.latestActivityDate) > new Date(group.latestActivityDate)
        ) {
          group.latestActivityDate = org.latestActivityDate;
        }

        return groups;
      }, new Map())
      .values()
  );

  // Helper to get sortable name (strips leading "The " for alphabetical sorting)
  const getSortableName = (name: string): string => {
    const trimmed = name.trim();
    if (trimmed.toLowerCase().startsWith('the ')) {
      return trimmed.substring(4).trim();
    }
    return trimmed;
  };

  // Sort groups by organization name or latest activity date
  const sortedActiveGroups = activeGroupInfo.sort((a, b) => {
    if (sortBy === 'groupName') {
      const aName = getSortableName(a.groupName || '');
      const bName = getSortableName(b.groupName || '');
      return sortOrder === 'desc'
        ? bName.localeCompare(aName)
        : aName.localeCompare(bName);
    }

    if (sortBy === 'category') {
      const aInfo = organizationCategoryMap.get(a.groupName);
      const bInfo = organizationCategoryMap.get(b.groupName);
      const aCategory = getCategoryLabel(aInfo?.category);
      const bCategory = getCategoryLabel(bInfo?.category);
      return sortOrder === 'desc'
        ? bCategory.localeCompare(aCategory)
        : aCategory.localeCompare(bCategory);
    }

    // Default sort by latest activity date (includes both requests and collections)
    const aDate = new Date(a.latestActivityDate).getTime();
    const bDate = new Date(b.latestActivityDate).getTime();
    return sortOrder === 'desc' ? bDate - aDate : aDate - bDate;
  });

  // Sort departments within each group
  sortedActiveGroups.forEach((group) => {
    group.departments.sort((a, b) => {
      if (sortBy === 'eventDate') {
        const aDate = a.eventDate
          ? new Date(a.eventDate).getTime()
          : sortOrder === 'desc'
            ? -Infinity
            : Infinity;
        const bDate = b.eventDate
          ? new Date(b.eventDate).getTime()
          : sortOrder === 'desc'
            ? -Infinity
            : Infinity;
        return sortOrder === 'desc' ? bDate - aDate : aDate - bDate;
      }

      if (sortBy === 'totalRequests') {
        return sortOrder === 'desc'
          ? b.totalRequests - a.totalRequests
          : a.totalRequests - b.totalRequests;
      }

      if (sortBy === 'category') {
        const aCategory = getCategoryLabel(a.category);
        const bCategory = getCategoryLabel(b.category);
        return sortOrder === 'desc'
          ? bCategory.localeCompare(aCategory)
          : aCategory.localeCompare(bCategory);
      }

      // Sort by contact name or department
      const aValue = a.department || a.contactName;
      const bValue = b.department || b.contactName;
      return sortOrder === 'desc'
        ? bValue.localeCompare(aValue)
        : aValue.localeCompare(bValue);
    });

    group.totalDepartments = group.departments.length;
  });

  // Pagination logic for active groups
  const totalActiveItems = sortedActiveGroups.length;
  const totalActivePages = Math.ceil(totalActiveItems / itemsPerPage);
  
  // Debug logging
  logger.log('🔍 Pagination Debug:', {
    totalActiveItems,
    totalActivePages,
    itemsPerPage,
    currentPage,
    shouldShowPagination: totalActiveItems > 0 && totalActivePages > 1
  });
  const activeStartIndex = (currentPage - 1) * itemsPerPage;
  const activeEndIndex = activeStartIndex + itemsPerPage;
  const paginatedActiveGroups = Array.isArray(sortedActiveGroups)
    ? sortedActiveGroups.slice(activeStartIndex, activeEndIndex)
    : [];

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, searchScope, filters, sortBy, sortOrder]);

  // Handle scroll to show/hide back to top button
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      setShowBackToTop(scrollTop > 300); // Show button after scrolling 300px
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top function
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const escapeCsvCell = (value: unknown): string => {
    let str = String(value ?? '');
    // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const handleExportCSV = () => {
    if (filteredActiveGroups.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'No organizations match the current filters.',
      });
      return;
    }

    try {
      const headers = [
        'Organization',
        'Department',
        'Category',
        'School Classification',
        'Contact Name',
        'Email',
        'Phone',
        'Status',
        'Has Hosted Event',
        'Event Date',
        'Total Requests',
        'Estimated Sandwich Total',
        'Actual Sandwich Total',
        'Actual Event Count',
        'Latest Activity Date',
        'Latest Collection Date',
        'TSP Contact',
        'Assigned To',
        'Is Partner Entry',
        'Partner Role',
        'Primary Organization',
        'Co-Hosts',
      ];

      const rows = filteredActiveGroups.map((org) => [
        org.organizationName || '',
        org.department || '',
        getCategoryLabel(org.category),
        org.schoolClassification || '',
        org.contactName || '',
        org.email || '',
        org.phone || '',
        org.status || '',
        hasHostingHistory(org) ? 'Yes' : 'No',
        org.eventDate ? formatDateForDisplay(org.eventDate) : '',
        org.totalRequests ?? '',
        org.totalSandwiches ?? '',
        org.actualSandwichTotal ?? '',
        org.actualEventCount ?? '',
        org.latestActivityDate ? formatDateForDisplay(org.latestActivityDate) : '',
        org.latestCollectionDate ? formatDateForDisplay(org.latestCollectionDate) : '',
        org.tspContactAssigned || org.tspContact || '',
        org.assignedToName || org.assignedTo || '',
        org.isPartnerEntry ? 'Yes' : 'No',
        org.partnerRole || '',
        org.primaryOrganization || '',
        (org.coHostNames || []).join('; '),
      ]);

      const csvContent = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((row) => row.map(escapeCsvCell).join(',')),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `groups-catalog-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export completed',
        description: `Exported ${filteredActiveGroups.length} organization${filteredActiveGroups.length === 1 ? '' : 's'} to CSV.`,
      });
    } catch (error) {
      logger.error('Groups catalog CSV export failed:', error);
      toast({
        title: 'Export failed',
        description: 'Failed to export groups catalog data.',
        variant: 'destructive',
      });
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'new':
        return 'New Request';
      case 'contacted':
        return 'Contacted';
      case 'in_process':
        return 'In Process';
      case 'contact_completed':
        return 'Event Complete';
      case 'scheduled':
        return 'Upcoming Event';
      case 'completed':
        return 'Completed';
      case 'past':
        return 'Past Event';
      case 'declined':
        return 'Event Postponed';
      default:
        return 'Unknown';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return (
          <Badge className="bg-gradient-to-r from-teal-100 to-cyan-200 text-teal-800 border border-teal-300 shadow-sm">
            New Request
          </Badge>
        );
      case 'contacted':
        return (
          <Badge className="bg-gradient-to-r from-emerald-100 to-teal-200 text-teal-700 border border-teal-300 shadow-sm">
            Contacted
          </Badge>
        );
      case 'in_process':
        return (
          <Badge className="bg-gradient-to-r from-blue-100 to-indigo-200 text-brand-primary-dark border border-brand-primary-border-strong shadow-sm">
            In Process
          </Badge>
        );
      case 'contact_completed':
        return (
          <Badge className="bg-gradient-to-r from-orange-100 to-amber-200 text-orange-800 border border-orange-300 shadow-sm">
            Event Complete
          </Badge>
        );
      case 'scheduled':
        return (
          <Badge className="bg-gradient-to-r from-yellow-100 to-orange-200 text-yellow-800 border border-yellow-300 shadow-sm">
            Upcoming Event
          </Badge>
        );
      case 'completed':
        return (
          <Badge className="bg-gradient-to-r from-green-100 to-emerald-200 text-green-800 border border-green-300 shadow-sm">
            Completed
          </Badge>
        );
      case 'past':
        return (
          <Badge className="bg-gradient-to-r from-gray-100 to-slate-200 text-gray-700 border border-gray-300 shadow-sm">
            Past Event
          </Badge>
        );
      case 'declined':
        return (
          <Badge
            className="text-white border-2 font-bold shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #A31C41 0%, #8B1538 100%)',
              borderColor: '#A31C41',
            }}
          >
            🚫 EVENT POSTPONED
          </Badge>
        );
      default:
        return null; // Remove confusing "Unknown" badges
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-teal-100 to-cyan-200 shadow-sm">
            <Building className="w-6 h-6 text-teal-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Groups Catalog</h1>
            <p className="text-gray-600">Loading organization contacts...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 bg-gray-200 animate-pulse rounded-lg"
            ></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <Building className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Failed to load organizations catalog</p>
          <p className="text-sm text-gray-500 mt-2">
            {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-teal-100 flex-shrink-0">
          <Building className="w-5 h-5 sm:w-6 sm:h-6 text-teal-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Groups Catalog</h1>
          <p className="text-sm sm:text-base text-gray-600 hidden sm:block">
            Directory of all organizations we've worked with from event requests
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          className="flex items-center gap-2 flex-shrink-0 min-h-[44px]"
          data-testid="button-export-groups-catalog"
          title="Download a CSV of organizations matching the current filters"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      </div>

      {/* Search and Filter Controls */}
      <div className="bg-white rounded-lg border p-3 sm:p-4 shadow-sm">
        <StandardFilterBar
          searchPlaceholder="Search organizations, contacts, emails, phone numbers, departments..."
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          filters={[
            {
              id: 'status',
              label: 'Status',
              type: 'multi-select',
              options: [
                { value: 'new', label: 'New Requests', count: allOrganizations.filter(o => o.status === 'new').length },
                { value: 'in_process', label: 'In Process', count: allOrganizations.filter(o => o.status === 'in_process').length },
                { value: 'contacted', label: 'Contacted', count: allOrganizations.filter(o => o.status === 'contacted').length },
                { value: 'scheduled', label: 'Upcoming Events', count: allOrganizations.filter(o => o.status === 'scheduled').length },
                { value: 'completed', label: 'Completed', count: allOrganizations.filter(o => o.status === 'completed').length },
                { value: 'declined', label: 'Declined', count: allOrganizations.filter(o => o.status === 'declined').length },
                { value: 'cancelled', label: 'Cancelled', count: allOrganizations.filter(o => o.status === 'cancelled').length },
                { value: 'past', label: 'Past Events', count: allOrganizations.filter(o => o.status === 'past').length },
              ],
            },
            {
              id: 'category',
              label: 'Category',
              type: 'multi-select',
              options: [
                { value: 'school', label: 'School', count: allOrganizations.filter(o => o.category === 'school').length },
                { value: 'church_faith', label: 'Church/Faith', count: allOrganizations.filter(o => o.category === 'church_faith').length },
                { value: 'religious', label: 'Religious Organization', count: allOrganizations.filter(o => o.category === 'religious').length },
                { value: 'nonprofit', label: 'Nonprofit', count: allOrganizations.filter(o => o.category === 'nonprofit').length },
                { value: 'government', label: 'Government', count: allOrganizations.filter(o => o.category === 'government').length },
                { value: 'hospital', label: 'Hospital', count: allOrganizations.filter(o => o.category === 'hospital').length },
                { value: 'political', label: 'Political Organization', count: allOrganizations.filter(o => o.category === 'political').length },
                { value: 'club', label: 'Club', count: allOrganizations.filter(o => o.category === 'club').length },
                { value: 'neighborhood', label: 'Neighborhood', count: allOrganizations.filter(o => o.category === 'neighborhood').length },
                { value: 'greek_life', label: 'Fraternity/Sorority', count: allOrganizations.filter(o => o.category === 'greek_life').length },
                { value: 'cultural', label: 'Cultural Organization', count: allOrganizations.filter(o => o.category === 'cultural').length },
                { value: 'corp', label: 'Company', count: allOrganizations.filter(o => o.category === 'corp').length },
                { value: 'large_corp', label: 'Corporation', count: allOrganizations.filter(o => o.category === 'large_corp').length },
                { value: 'small_medium_corp', label: 'Small Business', count: allOrganizations.filter(o => o.category === 'small_medium_corp').length },
                { value: 'other', label: 'Other', count: allOrganizations.filter(o => o.category === 'other').length },
              ],
            },
            {
              id: 'hostedEvents',
              label: 'Event History',
              type: 'tags',
              options: [
                { value: 'hosted', label: 'Has Hosted', count: allOrganizations.filter(o => hasHostingHistory(o)).length },
                { value: 'not-hosted', label: 'Never Hosted', count: allOrganizations.filter(o =>
                  !hasHostingHistory(o) &&
                  ['declined', 'cancelled'].includes(o.status)
                ).length },
              ],
            },
            {
              id: 'dateRange',
              label: 'Event Date Range',
              type: 'date-range',
              placeholder: 'Filter by event date',
            },
          ]}
          filterValues={filters}
          onFilterChange={(id, value) => setFilters({ ...filters, [id]: value })}
          showActiveFilters
          onClearAll={() => {
            setSearchTerm('');
            setSearchScope('all');
            setFilters({
              status: [],
              category: [],
              dateRange: {},
              hostedEvents: [],
            });
          }}
        />

        {/* Search Scope Selector */}
        {searchTerm && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Search in:</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={searchScope === 'all' ? 'default' : 'outline'}
                onClick={() => setSearchScope('all')}
                className={`min-h-[44px] sm:min-h-0 ${searchScope === 'all' ? 'bg-[#236383] hover:bg-[#1a4d66]' : ''}`}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={searchScope === 'organization' ? 'default' : 'outline'}
                onClick={() => setSearchScope('organization')}
                className={`min-h-[44px] sm:min-h-0 ${searchScope === 'organization' ? 'bg-[#236383] hover:bg-[#1a4d66]' : ''}`}
              >
                Org Name
              </Button>
              <Button
                size="sm"
                variant={searchScope === 'department' ? 'default' : 'outline'}
                onClick={() => setSearchScope('department')}
                className={`min-h-[44px] sm:min-h-0 ${searchScope === 'department' ? 'bg-[#236383] hover:bg-[#1a4d66]' : ''}`}
              >
                Department
              </Button>
            </div>
          </div>
        )}

        {/* Sort Controls */}
        <div className="mt-4 flex flex-col gap-3">
          {/* Row 1: Sort and Order */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-gray-600">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm min-h-[44px] flex-1 sm:flex-none"
            >
              <option value="groupName">Group Name</option>
              <option value="contactName">Contact Name</option>
              <option value="eventDate">Event Date</option>
              <option value="totalRequests">Total Requests</option>
              <option value="category">Category</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 min-h-[44px] min-w-[44px]"
              aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </Button>
          </div>

          {/* Row 2: Per Page */}
          <div className="flex flex-wrap gap-3 items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="border border-gray-300 rounded px-3 py-2 text-sm min-h-[44px]"
              >
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div className="mt-4 pt-3 border-t">
          <small className="text-gray-600">
            Showing {activeStartIndex + 1}-
            {Math.min(activeEndIndex, totalActiveItems)} of {totalActiveItems}{' '}
            organizations
          </small>
        </div>
      </div>

      {/* Organizations Display */}
      {totalActiveItems === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No organizations found</p>
          <p className="text-sm text-gray-500 mt-2">
            {searchTerm || filters.status.length > 0 || filters.category.length > 0
              ? 'Try adjusting your search or filters'
              : 'Event requests will populate this directory'}
          </p>
        </div>
      ) : (
        <>
          {/* Active Organizations Section */}
          {totalActiveItems > 0 && (
            <div className="space-y-4 sm:space-y-8">
              <div className="flex items-center flex-wrap gap-2 sm:space-x-3 mb-4 sm:mb-6">
                <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-teal-100 to-cyan-200">
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-teal-700" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                  Active Organizations
                </h2>
                <Badge className="bg-teal-100 text-teal-700 text-xs sm:text-sm">
                  {totalActiveItems}
                </Badge>
              </div>

              {/* Organization Grouped Layout - All Events and Departments Displayed */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {paginatedActiveGroups.map((group, groupIndex) => (
                  <div
                    key={`group-${group.groupName}-${groupIndex}`}
                    className="bg-gradient-to-br from-white via-gray-50 to-slate-100 rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm"
                  >
                    {/* Organization Header */}
                    <div className="mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-gray-200">
                      {/* Organization Name with Rename Button */}
                      <div className="flex items-start gap-2 mb-2">
                        <Building
                          className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5"
                          style={{ color: '#236383' }}
                        />
                        <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex-1 break-words leading-tight">
                          {group.groupName}
                        </h2>
                        {canEditCategories && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 sm:h-6 sm:w-6 p-0 hover:bg-teal-100 flex-shrink-0 touch-manipulation"
                            onClick={() => {
                              // Collect all event IDs from all departments in this group
                              const allEventIds = group.departments.flatMap(dept => dept.eventIds || []);
                              const uniqueEventIds = [...new Set(allEventIds)].filter(id => id !== null && id !== undefined);
                              
                              // Get the first department's data as a base
                              const firstDept = group.departments[0];
                              
                              handleEditName({
                                organizationName: group.groupName,
                                contactName: firstDept?.contactName || '',
                                department: firstDept?.department || '',
                                latestRequestDate: firstDept?.latestRequestDate || '',
                                latestActivityDate: firstDept?.latestActivityDate || '',
                                totalRequests: firstDept?.totalRequests || 0,
                                status: firstDept?.status || 'new',
                                hasHostedEvent: firstDept?.hasHostedEvent || false,
                                // Include event IDs so department editing is enabled
                                eventIds: uniqueEventIds.length > 0 ? uniqueEventIds : undefined,
                                linkedEventId: uniqueEventIds.length === 1 ? uniqueEventIds[0] : undefined,
                              });
                            }}
                            title="Rename organization"
                            data-testid={`button-edit-name-${group.groupName}`}
                          >
                            <Edit className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-teal-600" />
                          </Button>
                        )}
                      </div>

                      {/* Category Badge with Inline Edit */}
                      <div className="flex items-center gap-2 mb-2 ml-7 sm:ml-8">
                        {(() => {
                          const orgInfo = organizationCategoryMap.get(group.groupName);
                          const category = orgInfo?.category;
                          return (
                            <div className="flex items-center gap-1.5">
                              <Badge className={`${getCategoryBadgeColor(category)} text-xs sm:text-sm`}>
                                {getCategoryLabel(category)}
                              </Badge>
                              {canEditCategories && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 sm:h-5 sm:w-5 p-0 hover:bg-teal-100 touch-manipulation"
                                  onClick={() => handleEditCategory({
                                    organizationName: group.groupName,
                                    contactName: group.departments[0]?.contactName || '',
                                    department: group.departments[0]?.department,
                                    latestRequestDate: group.departments[0]?.latestRequestDate || '',
                                    latestActivityDate: group.departments[0]?.latestActivityDate || '',
                                    totalRequests: group.departments[0]?.totalRequests || 0,
                                    status: group.departments[0]?.status || 'new',
                                    hasHostedEvent: group.departments[0]?.hasHostedEvent || false,
                                    category: category,
                                  })}
                                  title="Edit category"
                                  data-testid={`button-edit-category-header-${group.groupName}`}
                                >
                                  <Edit className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-teal-600" />
                                </Button>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Department Count */}
                      <div className="flex items-center text-xs sm:text-sm text-gray-600 ml-7 sm:ml-8">
                        <span className="flex items-center space-x-1">
                          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          <span>
                            {group.totalDepartments}{' '}
                            {group.totalDepartments === 1
                              ? 'contact'
                              : 'depts'}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Group Departments by Department Name */}
                    {(() => {
                      // Group departments by department name to show related events together
                      const departmentGroups = new Map();
                      
                      group.departments.forEach((org) => {
                        const deptName = org.department || 'General';
                        if (!departmentGroups.has(deptName)) {
                          departmentGroups.set(deptName, []);
                        }
                        departmentGroups.get(deptName).push(org);
                      });

                      return Array.from(departmentGroups.entries()).map(([deptName, deptEvents], deptIndex) => (
                        <div
                          key={`dept-${deptName}-${deptIndex}`}
                          className={`mb-3 sm:mb-4 ${deptName !== 'General' ? 'p-2 sm:p-3 bg-purple-50/50 border border-purple-200 sm:border-2 rounded-lg' : ''}`}
                        >
                          {/* Department Header - Only show for non-General departments */}
                          {deptName !== 'General' && (
                            <div className="mb-2 sm:mb-3 pb-2 border-b border-purple-300">
                              <div className="flex items-start sm:items-center gap-1.5 sm:space-x-2 flex-wrap">
                                <Building className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 flex-shrink-0 mt-0.5 sm:mt-0" />
                                <h3 className="text-sm sm:text-base font-semibold text-purple-900 break-words flex-1 min-w-0">
                                  {deptName}
                                </h3>
                                <Badge className="bg-purple-200 text-purple-800 text-xs sm:text-sm font-semibold">
                                  {deptEvents.length} event{deptEvents.length !== 1 ? 's' : ''}
                                </Badge>
                              </div>
                            </div>
                          )}

                          {/* Events Grid for this Department */}
                          <div className="space-y-2">
                            {/* Show only first 3 events to prevent cards from being too tall */}
                            {deptEvents.slice(0, 3).map((org: OrganizationContact, index: number) => (
                              <Card
                                key={`${org.organizationName}-${org.contactName}-${index}`}
                                className={`hover:shadow-lg transition-all duration-300 border-l-4 w-full ${
                                  org.status === 'declined'
                                    ? 'border-l-4 border-2 shadow-xl'
                                    : 'bg-gradient-to-br from-white to-orange-50 border-l-4'
                                }`}
                                style={
                                  org.status === 'declined'
                                    ? {
                                        background:
                                          'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
                                        borderLeftColor: '#A31C41',
                                        borderColor: '#A31C41',
                                      }
                                    : { borderLeftColor: '#FBAD3F' }
                                }
                              >
                                <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-4 pt-3 sm:pt-4">
                                  {/* Department Name and Event Date - Top of Card */}
                                  <div className="mb-2 sm:mb-4 pb-2 sm:pb-3 border-b border-gray-200">
                                    {/* Edit button for this specific event card */}
                                    <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                                      <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                                        {org.department && org.department !== 'General' && (
                                          <>
                                            <Building className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 flex-shrink-0" />
                                            <h4 className="text-sm sm:text-base font-semibold text-gray-800 break-words truncate">
                                              {org.department}
                                            </h4>
                                          </>
                                        )}
                                      </div>
                                      {canEditCategories && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 sm:h-6 sm:w-6 p-0 hover:bg-teal-100 flex-shrink-0 touch-manipulation"
                                          onClick={() => handleEditName(org)}
                                          title="Edit this event"
                                          data-testid={`button-edit-event-${org.organizationName}-${org.department}-${index}`}
                                        >
                                          <Edit className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-teal-600" />
                                        </Button>
                                      )}
                                    </div>
                                    {/* Event Date */}
                                    {org.eventDate ? (
                                      <div className="flex items-center flex-wrap gap-1.5 sm:space-x-2 text-sm sm:text-base text-gray-700">
                                        <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600" />
                                        <span className="font-semibold">
                                          {formatDateForDisplay(org.eventDate)}
                                        </span>
                                        {org.isFromCollectionOnly && (
                                          <Badge className="bg-gray-100 text-gray-600 text-[10px] sm:text-xs">
                                            collection
                                          </Badge>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center space-x-1.5 sm:space-x-2 text-sm sm:text-base text-gray-500">
                                        <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                                        <span>No date</span>
                                      </div>
                                    )}
                                    {/* Partner Organization Badge (for entries created from partner data) - hidden on mobile */}
                                    {org.isPartnerEntry && org.primaryOrganization && (
                                      <div className="hidden sm:flex items-center mt-2">
                                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                                          {org.partnerRole === 'co-host' ? 'Co-hosted' : org.partnerRole === 'sponsor' ? 'Sponsored' : 'Partner'} with {org.primaryOrganization}
                                        </Badge>
                                      </div>
                                    )}
                                    {/* Partner Organizations Display - show below organization name */}
                                    {org.isCoHostedEvent && org.coHostNames && org.coHostNames.length > 0 && !org.isPartnerEntry && (
                                      <div className="flex items-center mt-2 text-xs sm:text-sm text-gray-600">
                                        <span className="font-medium">Partner:</span>{' '}
                                        <span>{org.coHostNames.join(', ')}</span>
                                      </div>
                                    )}
                                    {/* Co-host Badge (for primary entries that have co-hosts) - hidden on mobile */}
                                    {org.isCoHostedEvent && org.coHostNames && org.coHostNames.length > 0 && !org.isPartnerEntry && (
                                      <div className="hidden sm:flex items-center mt-2">
                                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                                          Co-hosted with {org.coHostNames.join(', ')}
                                        </Badge>
                                      </div>
                                    )}
                                  </div>

                                  {/* Organization Name */}
                                  <div className="mb-2 sm:mb-3">
                                    <div className="flex items-center space-x-1.5 sm:space-x-2 text-sm sm:text-base font-semibold text-gray-900">
                                      <Building className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600 flex-shrink-0" />
                                      <span>{org.organizationName}</span>
                                    </div>
                                    {/* Partner Organizations Display - below organization name */}
                                    {org.isCoHostedEvent && org.coHostNames && org.coHostNames.length > 0 && !org.isPartnerEntry && (
                                      <div className="mt-1 text-xs text-gray-600 ml-6">
                                        <span className="font-medium">Partner:</span>{' '}
                                        <span>{org.coHostNames.join(', ')}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Contact Information */}
                                  <div className="space-y-1.5 sm:space-y-2 mb-2 sm:mb-3">
                                    <div className="flex items-center space-x-1.5 sm:space-x-2 text-sm sm:text-base">
                                      <User className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600 flex-shrink-0" />
                                      <button
                                        onClick={() => {
                                          setSelectedContact(org);
                                          setShowContactDetailsModal(true);
                                        }}
                                        className="font-medium text-gray-900 hover:text-teal-600 truncate transition-colors underline decoration-dotted underline-offset-2 min-h-[44px] sm:min-h-0 flex items-center touch-manipulation"
                                        data-testid={`button-contact-${org.organizationName}-${org.contactName}`}
                                      >
                                        {org.contactName}
                                      </button>
                                    </div>
                                    {org.email && (
                                      <div className="hidden sm:flex items-center space-x-2 text-sm">
                                        <Mail className="w-4 h-4 text-teal-500" />
                                        <span className="text-teal-700 hover:text-teal-800 truncate">
                                          {org.email}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Status and Metrics */}
                                  <div className="bg-gradient-to-r from-orange-50 to-yellow-50 p-2 sm:p-3 border border-orange-200 rounded text-xs sm:text-sm mt-2 sm:mt-3">
                                    <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                                      <Badge
                                        className={`${getStatusBadgeColor(org.status)} text-xs`}
                                        variant="outline"
                                      >
                                        {getStatusText(org.status)}
                                      </Badge>
                                      {org.totalRequests > 1 && (
                                        <span className="text-gray-600 font-medium text-xs">
                                          {org.totalRequests} req
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center space-x-1">
                                        <span className="text-sm sm:text-lg">🥪</span>
                                        {(() => {
                                          const isFuture = isFutureEvent(org);
                                          const estimatedCount = org.totalSandwiches || 0;
                                          const actualCount = org.actualSandwichTotal || 0;

                                          // For future events: show estimated with "planned" label, only if > 0
                                          if (isFuture) {
                                            if (estimatedCount > 0) {
                                              return (
                                                <span className="font-semibold text-orange-700 text-sm sm:text-base italic">
                                                  {estimatedCount} <span className="text-[10px] sm:text-xs not-italic text-gray-600 hidden sm:inline">planned</span>
                                                </span>
                                              );
                                            }
                                            return null;
                                          }

                                          if (actualCount > 0) {
                                            return (
                                              <span className="font-semibold text-orange-700 text-sm sm:text-base">
                                                {actualCount}
                                              </span>
                                            );
                                          }

                                          if (estimatedCount > 0) {
                                            return (
                                              <span className="font-semibold text-orange-700 text-sm sm:text-base">
                                                {estimatedCount}
                                              </span>
                                            );
                                          }

                                          if (org.actualSandwichTotal !== undefined && org.actualSandwichTotal === 0) {
                                            return (
                                              <span className="font-semibold text-orange-700 text-sm sm:text-base">
                                                0
                                              </span>
                                            );
                                          }

                                          return null;
                                        })()}
                                      </div>
                                      <div className="flex items-center space-x-1">
                                        <span className="text-sm sm:text-lg">📦</span>
                                        <span className="font-semibold text-brand-primary text-sm sm:text-base">
                                          {org.actualEventCount || (org.hasHostedEvent ? 1 : 0)}
                                        </span>
                                      </div>
                                    </div>

                                    {/* TSP Contact Display - hidden on mobile */}
                                    {(() => {
                                      let tspContactName = null;

                                      if (org.assignedToName && org.assignedToName.trim() &&
                                          !org.assignedToName.includes('@') &&
                                          !org.assignedToName.match(/^[a-f0-9-]{8,}$/i)) {
                                        tspContactName = org.assignedToName;
                                      } else if (org.tspContactAssigned && org.tspContactAssigned.trim()) {
                                        tspContactName = org.tspContactAssigned;
                                      } else if (org.tspContact && org.tspContact.trim()) {
                                        tspContactName = org.tspContact;
                                      }

                                      return tspContactName ? (
                                        <div className="hidden sm:flex items-center space-x-1.5 text-sm mt-2 pt-2 border-t border-orange-300">
                                          <UserCheck className="w-4 h-4 text-purple-500" />
                                          <span className="text-purple-700 font-medium truncate">
                                            TSP: {tspContactName}
                                          </span>
                                        </div>
                                      ) : null;
                                    })()}

                                    {/* Past Events List - hidden on mobile */}
                                    {org.pastEvents && org.pastEvents.length > 0 && (
                                      <div className="hidden sm:block mt-2 pt-2 border-t border-orange-300">
                                        <div className="text-sm font-semibold text-gray-700 mb-2">
                                          Past Events:
                                        </div>
                                        <div className="space-y-1.5 max-h-28 overflow-y-auto">
                                          {org.pastEvents.map((event, idx) => (
                                            <div
                                              key={idx}
                                              className="flex items-center justify-between bg-white/60 px-2 py-1 rounded"
                                            >
                                              <div className="flex items-center space-x-1.5">
                                                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                                                <span className="text-gray-700 text-xs">
                                                  {formatDateForDisplay(event.date)}
                                                </span>
                                              </div>
                                              <div className="flex items-center space-x-1.5">
                                                <span className="font-semibold text-orange-700 text-xs">
                                                  {event.sandwichCount}
                                                </span>
                                                <img
                                                  src="/attached_assets/LOGOS/sandwich logo.png"
                                                  alt="sandwich"
                                                  className="w-3.5 h-3.5 object-contain"
                                                />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </CardHeader>

                                <CardContent className="pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                                  {/* View Complete History Button */}
                                  <Button
                                    onClick={() => {
                                      setSelectedOrganization(org);
                                      setOrganizationDetails(null);
                                      fetchOrganizationDetails(org.organizationName);
                                    }}
                                    variant="outline"
                                    size="sm"
                                    className="w-full text-xs sm:text-sm bg-brand-orange hover:bg-brand-orange/90 text-white border-brand-orange hover:border-brand-orange/90 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 touch-manipulation"
                                  >
                                    <ExternalLink className="w-4 h-4 mr-1" />
                                    <span className="sm:hidden">View History</span>
                                    <span className="hidden sm:inline">View Complete History</span>
                                  </Button>
                                </CardContent>
                              </Card>
                            ))}
                            {/* Show indicator if there are more events */}
                            {deptEvents.length > 3 && (
                              <div className="text-center py-1.5 sm:py-2 px-2 sm:px-3 bg-gradient-to-r from-orange-50 to-yellow-50 rounded border border-orange-200">
                                <p className="text-xs sm:text-sm text-gray-600 font-medium">
                                  + {deptEvents.length - 3} more
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ))}
              </div>

                {/* REMOVED: Single-department organizations are now integrated above in the main loop */}
                {(() => {
                  // DISABLED: Single-department organizations are now integrated above
                  return null;
                  
                  const singleDepartmentGroups = paginatedActiveGroups.filter(group => group.totalDepartments === 1);
                  
                  if (singleDepartmentGroups.length === 0) return null;

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-green-100 to-emerald-200">
                          <Users className="w-5 h-5 text-green-700" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          Single-Department Organizations
                        </h3>
                        <Badge className="bg-green-100 text-green-700">
                          {singleDepartmentGroups.length} organizations
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {singleDepartmentGroups.map((group, groupIndex) => {
                        const org = group.departments[0]; // Single department
                        return (
                          <Card
                            key={`single-${group.groupName}-${groupIndex}`}
                            className={`hover:shadow-lg transition-all duration-300 border-l-4 ${
                              org.status === 'declined'
                                ? 'border-l-4 border-2 shadow-xl'
                                : 'bg-gradient-to-br from-white to-orange-50 border-l-4'
                            }`}
                            style={
                              org.status === 'declined'
                                ? {
                                    background:
                                      'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)',
                                    borderLeftColor: '#A31C41',
                                    borderColor: '#A31C41',
                                  }
                                : { borderLeftColor: '#FBAD3F' }
                            }
                          >
                            <CardHeader className="pb-3">
                              {/* Organization Header */}
                              <div className="mb-3">
                                {/* Organization Name with Rename Button */}
                                <div className="flex items-center gap-2 mb-2">
                                  <Building
                                    className="w-5 h-5 flex-shrink-0"
                                    style={{ color: '#236383' }}
                                  />
                                  <h3 className="text-lg font-bold text-gray-900 flex-1">
                                    {group.groupName}
                                  </h3>
                                  {canEditCategories && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 hover:bg-teal-100 flex-shrink-0 ml-1"
                                      onClick={() => handleEditName(org)}
                                      title="Rename organization"
                                      data-testid={`button-edit-name-single-${group.groupName}`}
                                    >
                                      <Edit className="h-3.5 w-3.5 text-teal-600" />
                                    </Button>
                                  )}
                                </div>

                                {/* Category Badge with Inline Edit */}
                                <div className="flex items-center gap-2 ml-7">
                                  {(() => {
                                    const orgInfo = organizationCategoryMap.get(group.groupName);
                                    const category = orgInfo?.category;
                                    return (
                                      <div className="flex items-center gap-1">
                                        <Badge className={getCategoryBadgeColor(category)}>
                                          {getCategoryLabel(category)}
                                        </Badge>
                                        {canEditCategories && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-5 w-5 p-0 hover:bg-teal-100"
                                            onClick={() => handleEditCategory({
                                              ...org,
                                              category: category,
                                            })}
                                            title="Edit category"
                                            data-testid={`button-edit-category-single-${group.groupName}`}
                                          >
                                            <Edit className="h-3 w-3 text-teal-600" />
                                          </Button>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>

                              {/* Main headline with org name and date */}
                              <div className="space-y-2">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    {org.department && (
                                      <h4 className="text-lg font-semibold text-gray-800 leading-tight">
                                        {org.department}
                                      </h4>
                                    )}
                                    {/* Event Date - Compact */}
                                    {org.eventDate ? (
                                      <div
                                        className="flex items-center flex-wrap gap-1 mt-1 text-sm font-semibold"
                                        style={{ color: '#FBAD3F' }}
                                      >
                                        <Calendar className="w-4 h-4 mr-1" />
                                        <span className="truncate">
                                          {formatDateForDisplay(org.eventDate)}
                                        </span>
                                        {org.isFromCollectionOnly && (
                                          <Badge className="bg-gray-100 text-gray-600 text-xs ml-1">
                                            from log
                                          </Badge>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center mt-1 text-xs text-gray-500">
                                        <Calendar className="w-3 h-3 mr-1" />
                                        <span>No date specified</span>
                                      </div>
                                    )}
                                    {/* Partner Organization Badge - Compact */}
                                    {org.isPartnerEntry && org.primaryOrganization && (
                                      <div className="mt-1">
                                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                                          {org.partnerRole === 'co-host' ? 'Co-host' : org.partnerRole === 'sponsor' ? 'Sponsor' : 'Partner'}: {org.primaryOrganization}
                                        </Badge>
                                      </div>
                                    )}
                                    {/* Partner Organizations Display - Compact */}
                                    {org.isCoHostedEvent && org.coHostNames && org.coHostNames.length > 0 && !org.isPartnerEntry && (
                                      <div className="mt-1 text-xs text-gray-600">
                                        <span className="font-medium">Partner:</span>{' '}
                                        <span>{org.coHostNames.join(', ')}</span>
                                      </div>
                                    )}
                                    {/* Co-host Badge - Compact (for primary entries that have co-hosts) */}
                                    {org.isCoHostedEvent && org.coHostNames && org.coHostNames.length > 0 && !org.isPartnerEntry && (
                                      <div className="mt-1">
                                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                                          Co-host: {org.coHostNames.join(', ')}
                                        </Badge>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Contact Info - Compact */}
                                <div className="space-y-1">
                                  <div className="flex items-center space-x-1 text-xs text-gray-600">
                                    <User className="w-3 h-3" />
                                    <span className="font-medium truncate">
                                      {org.contactName}
                                    </span>
                                  </div>
                                  {org.email && (
                                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                                      <Mail className="w-3 h-3" />
                                      <span className="truncate">{org.email}</span>
                                    </div>
                                  )}
                                  {/* TSP Contact Display - Compact */}
                                  {(() => {
                                    let tspContactName = null;
                                    
                                    if (org.assignedToName && org.assignedToName.trim() && 
                                        !org.assignedToName.includes('@') && 
                                        !org.assignedToName.match(/^[a-f0-9-]{8,}$/i)) {
                                      tspContactName = org.assignedToName;
                                    } else if (org.tspContactAssigned && org.tspContactAssigned.trim()) {
                                      tspContactName = org.tspContactAssigned;
                                    } else if (org.tspContact && org.tspContact.trim()) {
                                      tspContactName = org.tspContact;
                                    }
                                    
                                    return tspContactName ? (
                                      <div className="flex items-center space-x-1 text-xs">
                                        <UserCheck className="w-3 h-3 text-purple-500" />
                                        <span className="text-purple-700 font-medium truncate">
                                          TSP: {tspContactName}
                                        </span>
                                      </div>
                                    ) : null;
                                  })()}
                                </div>

                                {/* Compact Key Metrics */}
                                <div className="bg-gradient-to-r from-orange-50 to-yellow-50 p-2 border border-orange-200 rounded text-xs">
                                  <div className="flex items-center justify-between mb-1">
                                    <Badge
                                      className={getStatusBadgeColor(org.status)}
                                      variant="outline"
                                    >
                                      {getStatusText(org.status)}
                                    </Badge>
                                    {org.totalRequests > 1 && (
                                      <span className="text-gray-500">
                                        {org.totalRequests} requests
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-1">
                                      <span>🥪</span>
                                      {(() => {
                                        const isFuture = isFutureEvent(org);
                                        const estimatedCount = org.totalSandwiches || 0;
                                        const actualCount = org.actualSandwichTotal || 0;
                                        
                                        // For future events: show estimated with "planned" label, only if > 0
                                        if (isFuture) {
                                          if (estimatedCount > 0) {
                                            return (
                                              <span className="font-semibold text-orange-700 italic">
                                                {estimatedCount} <span className="text-xs not-italic text-gray-600">planned</span>
                                              </span>
                                            );
                                          }
                                          // Don't show anything for future events without estimates
                                          return null;
                                        }
                                        
                                        // For past/completed events: prioritize actual count
                                        if (actualCount > 0) {
                                          return (
                                            <span className="font-semibold text-orange-700">
                                              {actualCount}
                                            </span>
                                          );
                                        }
                                        
                                        // Show estimated if available for past events
                                        if (estimatedCount > 0) {
                                          return (
                                            <span className="font-semibold text-orange-700">
                                              {estimatedCount}
                                            </span>
                                          );
                                        }
                                        
                                        // Show 0 only if actualSandwichTotal is explicitly 0 (completed event with 0 sandwiches)
                                        if (org.actualSandwichTotal !== undefined && org.actualSandwichTotal === 0) {
                                          return (
                                            <span className="font-semibold text-orange-700">
                                              0
                                            </span>
                                          );
                                        }
                                        
                                        // Don't show anything if no count available
                                        return null;
                                      })()}
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span>📦</span>
                                          <span className="font-semibold text-brand-primary">
                                            {org.actualEventCount || (org.hasHostedEvent ? 1 : 0)} event{(org.actualEventCount || (org.hasHostedEvent ? 1 : 0)) !== 1 ? 's' : ''}
                                          </span>
                                    </div>
                                  </div>

                                  {/* Past Events List - Compact */}
                                  {org.pastEvents && org.pastEvents.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-orange-300">
                                      <div className="text-xs font-semibold text-gray-700 mb-1">
                                        Past Events:
                                      </div>
                                      <div className="space-y-1 max-h-24 overflow-y-auto">
                                        {org.pastEvents.map((event, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center justify-between bg-white/60 px-1.5 py-0.5 rounded"
                                          >
                                            <div className="flex items-center space-x-1">
                                              <Calendar className="w-2.5 h-2.5 text-teal-600" />
                                              <span className="text-gray-700" style={{ fontSize: '10px' }}>
                                                {formatDateForDisplay(event.date)}
                                              </span>
                                            </div>
                                            <div className="flex items-center space-x-1">
                                              <span className="font-semibold text-orange-700" style={{ fontSize: '10px' }}>
                                                {event.sandwichCount}
                                              </span>
                                              <img 
                                                src="/attached_assets/LOGOS/sandwich logo.png" 
                                                alt="sandwich" 
                                                className="w-2.5 h-2.5 object-contain"
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardHeader>

                            <CardContent className="pt-0">
                              <div className="space-y-2">
                                {/* Compact Contact Information */}
                                <div className="space-y-1">
                                  <div className="flex items-center space-x-1 text-sm">
                                    <User className="w-4 h-4 text-teal-600" />
                                    <button
                                      onClick={() => {
                                        setSelectedContact(org);
                                        setShowContactDetailsModal(true);
                                      }}
                                      className="font-medium text-gray-900 hover:text-teal-600 truncate transition-colors underline decoration-dotted underline-offset-2"
                                      data-testid={`button-contact-${org.organizationName}`}
                                    >
                                      {org.contactName}
                                    </button>
                                  </div>
                                  {org.email && (
                                    <div className="flex items-center space-x-1 text-xs">
                                      <Mail className="w-3 h-3 text-teal-500" />
                                      <a
                                        href={`mailto:${org.email}`}
                                        className="text-teal-700 hover:text-teal-900 truncate hover:underline transition-colors"
                                        data-testid={`link-email-${org.email}`}
                                      >
                                        {org.email}
                                      </a>
                                    </div>
                                  )}
                                </div>

                                {/* Compact View History Button */}
                                <Button
                                  onClick={() => {
                                    setSelectedOrganization(org);
                                    setOrganizationDetails(null);
                                    fetchOrganizationDetails(org.organizationName);
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="w-full text-xs bg-brand-orange hover:bg-brand-orange/90 text-white border-brand-orange hover:border-brand-orange/90 py-1"
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  View History
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      </div>
                    </div>
                  );
                })()}
              </div>
          )}

          {/* Pagination Controls - Only for Active Organizations */}
          {totalActiveItems > 0 && totalActivePages > 1 && (
            <div className="flex items-center justify-between bg-white rounded-lg border p-4 shadow-sm mt-6">
              <div className="text-sm text-gray-600">
                Page {currentPage} of {totalActivePages}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="h-8"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalActivePages, 5) }, (_, i) => {
                    let pageNum;
                    if (totalActivePages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalActivePages - 2) {
                      pageNum = totalActivePages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="h-8 w-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalActivePages))}
                  disabled={currentPage === totalActivePages}
                  className="h-8"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Items per page:</span>
                <Select
                  value={itemsPerPage.toString()}
                  onValueChange={(value) => {
                    setItemsPerPage(parseInt(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                <SelectItem value="12">12</SelectItem>
                <SelectItem value="24">24</SelectItem>
                <SelectItem value="48">48</SelectItem>
                <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </>
      )}


      {/* Organization History Dialog */}
      <Dialog
        open={showEventDetailsDialog}
        onOpenChange={setShowEventDetailsDialog}
      >
        <DialogContent className="w-[95vw] max-w-6xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Organization History:{' '}
              {organizationDetails?.organizationName ||
                selectedOrganization?.organizationName}
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              Complete event history and analytics
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {loadingOrganizationDetails ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  Loading organization details...
                </span>
              </div>
            ) : organizationDetails ? (
              <div className="space-y-6">
                {/* Summary Statistics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-brand-primary dark:text-blue-400">
                        {organizationDetails.summary.totalEvents}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Total Events
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {organizationDetails.summary.completedEvents}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Completed
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                        {organizationDetails.summary.totalActualSandwiches.toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Sandwiches Made
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                        {organizationDetails.summary.eventFrequency ||
                          'First Time'}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Frequency
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Contacts */}
                {organizationDetails.contacts &&
                  organizationDetails.contacts.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Users className="w-5 h-5" />
                          Organization Contacts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {organizationDetails.contacts.map(
                            (contact: any, index: number) => (
                              <div
                                key={index}
                                className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                              >
                                <div className="font-semibold">
                                  {contact.name}
                                </div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                  {contact.email && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Mail className="w-3 h-3" />
                                      {contact.email}
                                    </div>
                                  )}
                                  {contact.phone && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Phone className="w-3 h-3" />
                                      {contact.phone}
                                    </div>
                                  )}
                                  {contact.department && (
                                    <div className="text-xs mt-1 text-brand-primary dark:text-blue-400">
                                      {contact.department}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                {/* Event History */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Event History ({organizationDetails.events.length} events)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {organizationDetails.events.map(
                        (event: any, index: number) => (
                          <div
                            key={index}
                            className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-brand-primary-border-strong dark:hover:border-brand-primary transition-colors"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="font-semibold text-gray-900 dark:text-gray-100 text-base">
                                    {formatDateForDisplay(event.date)}
                                  </div>
                                  <Badge
                                    className={
                                      event.type === 'sandwich_collection'
                                        ? 'bg-green-100 text-green-800 border-green-200'
                                        : 'bg-brand-primary-light text-brand-primary-dark border-brand-primary-border'
                                    }
                                  >
                                    {event.type === 'sandwich_collection'
                                      ? 'Collection'
                                      : 'Request'}
                                  </Badge>
                                  {getStatusBadge(event.status)}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <div className="font-medium text-gray-900 dark:text-gray-100">
                                      Contact
                                    </div>
                                    <div className="text-gray-900 dark:text-gray-100">
                                      {event.contactName}
                                    </div>
                                    {event.email && (
                                      <div className="text-xs text-gray-600 dark:text-gray-400">
                                        {event.email}
                                      </div>
                                    )}
                                  </div>

                                  <div>
                                    <div className="font-medium text-gray-900 dark:text-gray-100">
                                      Sandwiches
                                    </div>
                                    <div className="text-gray-900 dark:text-gray-100">
                                      {event.actualSandwiches > 0
                                        ? `${event.actualSandwiches.toLocaleString()} made`
                                        : event.estimatedSandwiches > 0
                                          ? `${event.estimatedSandwiches.toLocaleString()} estimated`
                                          : 'Not specified'}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="font-medium text-gray-900 dark:text-gray-100">
                                      Details
                                    </div>
                                    <div className="text-gray-900 dark:text-gray-100">
                                      {event.department && (
                                        <div>Dept: {event.department}</div>
                                      )}
                                      {event.hostName && (
                                        <div>Host: {event.hostName}</div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {event.notes && (
                                  <div className="mt-2 text-sm text-gray-900 dark:text-gray-100 italic">
                                    {event.notes}
                                  </div>
                                )}
                              </div>

                              {/* Edit button for event requests */}
                              {canViewEventRequests && event.type === 'event_request' && event.id && (
                                <div className="ml-4 flex-shrink-0">
                                  <Button
                                    onClick={() => handleEditEventRequest(event.id)}
                                    variant="outline"
                                    size="sm"
                                    className="text-brand-primary hover:bg-brand-primary hover:text-white"
                                    data-testid={`button-edit-event-${event.id}`}
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit Request
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      )}

                      {organizationDetails.events.length === 0 && (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                          No events found for this organization
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No organization details available
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Details Modal */}
      <Dialog open={showContactDetailsModal} onOpenChange={setShowContactDetailsModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-heading text-brand-primary">
              Contact Information
            </DialogTitle>
            <DialogDescription>
              Complete contact details for this organization
            </DialogDescription>
          </DialogHeader>
          
          {selectedContact && (
            <div className="space-y-4 mt-4">
              {/* Organization Name */}
              <div className="border-b pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building className="w-5 h-5 text-brand-primary" />
                  <h3 className="font-semibold text-gray-900">
                    {selectedContact.organizationName}
                  </h3>
                </div>
                {selectedContact.department && (
                  <p className="text-sm text-gray-600 ml-7">
                    Department: {selectedContact.department}
                  </p>
                )}
              </div>

              {/* Contact Details */}
              <div className="space-y-3">
                {/* Contact Name */}
                <div className="flex items-start gap-2">
                  <User className="w-5 h-5 text-teal-600 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Contact Name</p>
                    <p className="font-medium text-gray-900">{selectedContact.contactName}</p>
                  </div>
                </div>

                {/* Email */}
                {selectedContact.email && (
                  <div className="flex items-start gap-2">
                    <Mail className="w-5 h-5 text-teal-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Email Address</p>
                      <a
                        href={`mailto:${selectedContact.email}`}
                        className="font-medium text-teal-700 hover:text-teal-900 hover:underline"
                        data-testid={`link-modal-email-${selectedContact.email}`}
                      >
                        {selectedContact.email}
                      </a>
                    </div>
                  </div>
                )}

                {/* Phone */}
                {selectedContact.phone && (
                  <div className="flex items-start gap-2">
                    <Phone className="w-5 h-5 text-teal-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Phone Number</p>
                      <a
                        href={`tel:${selectedContact.phone}`}
                        className="font-medium text-teal-700 hover:text-teal-900 hover:underline"
                        data-testid={`link-modal-phone-${selectedContact.phone}`}
                      >
                        {selectedContact.phone}
                      </a>
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Current Status</p>
                    <div className="mt-1">{getStatusBadge(selectedContact.status)}</div>
                  </div>
                </div>

                {/* Latest Activity */}
                {selectedContact.latestActivityDate && (
                  <div className="flex items-start gap-2">
                    <Clock className="w-5 h-5 text-teal-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Latest Activity</p>
                      <p className="font-medium text-gray-900">
                        {formatDateForDisplay(selectedContact.latestActivityDate.toString())}
                      </p>
                    </div>
                  </div>
                )}

                {/* Event Date */}
                {selectedContact.eventDate && (
                  <div className="flex items-start gap-2">
                    <Calendar className="w-5 h-5 text-teal-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">Event Date</p>
                      <p className="font-medium text-gray-900">
                        {formatDateForDisplay(selectedContact.eventDate)}
                      </p>
                    </div>
                  </div>
                )}

                {/* TSP Contact */}
                {selectedContact.tspContactAssigned && (
                  <div className="flex items-start gap-2">
                    <UserCheck className="w-5 h-5 text-teal-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-600">TSP Contact</p>
                      <p className="font-medium text-gray-900">
                        {selectedContact.tspContactAssigned}
                      </p>
                    </div>
                  </div>
                )}

                {/* Statistics */}
                {(selectedContact.actualEventCount || selectedContact.totalRequests) && (
                  <div className="border-t pt-3 mt-3">
                    <p className="text-sm text-gray-600 mb-2">Event History</p>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedContact.actualEventCount && selectedContact.actualEventCount > 0 && (
                        <div>
                          <p className="text-2xl font-bold text-brand-primary">
                            {selectedContact.actualEventCount}
                          </p>
                          <p className="text-xs text-gray-600">
                            Completed Event{selectedContact.actualEventCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                      {selectedContact.totalRequests > 0 && (
                        <div>
                          <p className="text-2xl font-bold text-brand-secondary">
                            {selectedContact.totalRequests}
                          </p>
                          <p className="text-xs text-gray-600">
                            Total Request{selectedContact.totalRequests !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Past Events */}
                {selectedContact.pastEvents && selectedContact.pastEvents.length > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <p className="text-sm text-gray-600 mb-2">Past Collection Events</p>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {selectedContact.pastEvents.map((event, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between bg-gray-50 p-2 rounded text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-teal-600" />
                            <span>{formatDateForDisplay(event.date)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-orange-700">
                              {event.sandwichCount}
                            </span>
                            <img 
                              src="/attached_assets/LOGOS/sandwich logo.png" 
                              alt="sandwich" 
                              className="w-4 h-4 object-contain"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={showEditCategoryDialog} onOpenChange={setShowEditCategoryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Organization Category</DialogTitle>
            <DialogDescription>
              Update the category for {editingOrganization?.organizationName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category">Organization Category</Label>
              {isAddingNewCategory ? (
                <div className="space-y-2">
                  <Input
                    id="new-category-name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Enter new category name"
                    autoFocus
                    data-testid="input-new-category"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsAddingNewCategory(false);
                        setNewCategoryName('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!newCategoryName.trim()}
                      onClick={() => {
                        // Convert to snake_case for the category value
                        const categoryValue = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
                        setEditCategory(categoryValue);
                        setIsAddingNewCategory(false);
                        setNewCategoryName('');
                      }}
                    >
                      Use Category
                    </Button>
                  </div>
                </div>
              ) : (
                <Select
                  value={editCategory}
                  onValueChange={(value) => {
                    if (value === '__add_new__') {
                      setIsAddingNewCategory(true);
                      return;
                    }
                    setEditCategory(value);
                    // Clear school classification if category changes to non-school
                    if (value !== 'school') {
                      setEditSchoolClassification('');
                    }
                  }}
                >
                  <SelectTrigger id="edit-category" data-testid="select-edit-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="school">School</SelectItem>
                    <SelectItem value="church_faith">Church/Faith Group</SelectItem>
                    <SelectItem value="religious">Religious Organization</SelectItem>
                    <SelectItem value="nonprofit">Nonprofit</SelectItem>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="hospital">Hospital</SelectItem>
                    <SelectItem value="political">Political Organization</SelectItem>
                    <SelectItem value="club">Club</SelectItem>
                    <SelectItem value="neighborhood">Neighborhood</SelectItem>
                    <SelectItem value="greek_life">Fraternity/Sorority</SelectItem>
                    <SelectItem value="cultural">Cultural Organization</SelectItem>
                    <SelectItem value="corp">Company</SelectItem>
                    <SelectItem value="large_corp">Large Corporation</SelectItem>
                    <SelectItem value="small_medium_corp">Small/Medium Business</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="__add_new__" className="text-blue-600 font-medium">
                      + Add New Category...
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {/* Show the custom category if one was entered */}
              {editCategory && !['school', 'church_faith', 'religious', 'nonprofit', 'government', 'hospital', 'political', 'club', 'neighborhood', 'greek_life', 'cultural', 'corp', 'large_corp', 'small_medium_corp', 'other'].includes(editCategory) && (
                <p className="text-xs text-blue-600">
                  Custom category: {editCategory.replace(/_/g, ' ')}
                </p>
              )}
            </div>

            {/* School Classification - only shown when category is 'school' */}
            {editCategory === 'school' && (
              <div className="space-y-2">
                <Label htmlFor="edit-school-classification">School Classification</Label>
                <Select
                  value={editSchoolClassification}
                  onValueChange={setEditSchoolClassification}
                >
                  <SelectTrigger id="edit-school-classification" data-testid="select-edit-school-classification">
                    <SelectValue placeholder="Select school type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="charter">Charter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditCategoryDialog(false);
                  setIsAddingNewCategory(false);
                  setNewCategoryName('');
                }}
                data-testid="button-cancel-edit-category"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveCategory}
                disabled={updateCategoryMutation.isPending || !editCategory}
                data-testid="button-save-category"
              >
                {updateCategoryMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Name Dialog */}
      <Dialog open={showEditNameDialog} onOpenChange={setShowEditNameDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update the organization name and add partner organizations if this event is co-hosted.
            </DialogDescription>
          </DialogHeader>
          {/* Warning for multi-event cards */}
          {editNameOrganization && !editNameOrganization.linkedEventId && (editNameOrganization.eventIds?.length ?? 0) > 1 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
              <strong>Note:</strong> This card represents {editNameOrganization.eventIds?.length} events.
              Changes will apply to ALL events for this organization.
            </div>
          )}
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-org-name">Organization Name</Label>
              <Input
                id="edit-org-name"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                placeholder="Enter organization name (or leave empty for co-hosted events)"
                data-testid="input-edit-org-name"
              />
              <p className="text-xs text-gray-500">
                For co-hosted events: leave this empty and add both organizations as co-hosts below.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dept-name">Department (optional)</Label>
              {/* Allow department edits when we have specific events to target OR when we have an organization name to match */}
              {(editNameOrganization?.linkedEventId || 
                (editNameOrganization?.eventIds && editNameOrganization.eventIds.length > 0) ||
                editNameOrganization?.organizationName) ? (
                <>
                  <Input
                    id="edit-dept-name"
                    value={editDeptName}
                    onChange={(e) => setEditDeptName(e.target.value)}
                    placeholder="Enter department name"
                    data-testid="input-edit-dept-name"
                  />
                  {editNameOrganization?.eventIds && editNameOrganization.eventIds.length > 1 && (
                    <p className="text-xs text-amber-600">
                      This will update the department for all {editNameOrganization.eventIds.length} events in this card.
                    </p>
                  )}
                  {!editNameOrganization?.linkedEventId && 
                   (!editNameOrganization?.eventIds || editNameOrganization.eventIds.length === 0) && (
                    <p className="text-xs text-amber-600">
                      This will update the department for all events matching this organization name.
                    </p>
                  )}
                </>
              ) : (
                <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded border">
                  Department editing is disabled for this card type.
                  Try editing from the event details view.
                </div>
              )}
            </div>

            {/* Partner Organizations Section */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label>Partner Organizations</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPartnerOrganizations([...partnerOrganizations, { name: '', role: 'partner' }])}
                  data-testid="button-add-partner"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Partner
                </Button>
              </div>
              {partnerOrganizations.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  No partner organizations. Click "Add Partner" if this event is co-hosted.
                </p>
              ) : (
                <div className="space-y-2">
                  {partnerOrganizations.map((partner, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={partner.name}
                        onChange={(e) => {
                          const updated = [...partnerOrganizations];
                          updated[index] = { ...updated[index], name: e.target.value };
                          setPartnerOrganizations(updated);
                        }}
                        placeholder="Partner organization name"
                        className="flex-1"
                        data-testid={`input-partner-name-${index}`}
                      />
                      <Select
                        value={partner.role}
                        onValueChange={(value) => {
                          const updated = [...partnerOrganizations];
                          updated[index] = { ...updated[index], role: value };
                          setPartnerOrganizations(updated);
                        }}
                      >
                        <SelectTrigger className="w-28" data-testid={`select-partner-role-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="co-host">Co-host</SelectItem>
                          <SelectItem value="partner">Partner</SelectItem>
                          <SelectItem value="sponsor">Sponsor</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          const updated = partnerOrganizations.filter((_, i) => i !== index);
                          setPartnerOrganizations(updated);
                        }}
                        data-testid={`button-remove-partner-${index}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setShowEditNameDialog(false)}
                data-testid="button-cancel-edit-name"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveName}
                disabled={renameOrganizationMutation.isPending || (!editOrgName.trim() && partnerOrganizations.filter(p => p.name.trim()).length === 0)}
                data-testid="button-save-name"
              >
                {renameOrganizationMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="organizations"
        title="Groups Assistant"
        subtitle="Ask about partner organizations"
        // Lightweight context - computed every render but cheap
        contextData={{
          currentView: 'groups-catalog',
          filters: {
            searchTerm: searchTerm || undefined,
            status: filters.status,
            category: filters.category,
            hostedEvents: filters.hostedEvents,
          },
          summaryStats: {
            totalOrganizations: sortedActiveGroups.length,
            totalContacts: allOrganizations.length,
            organizationsWithEvents: sortedActiveGroups.filter(g => g.hasHostedEvent).length,
            organizationsWithoutEvents: sortedActiveGroups.filter(g => !g.hasHostedEvent).length,
          },
        }}
        // Heavy context - only computed when user sends a message
        getFullContext={() => ({
          rawData: sortedActiveGroups.flatMap(group =>
            group.departments.map(dept => ({
              organizationName: group.groupName,
              category: organizationCategoryMap.get(group.groupName)?.category || null,
              status: dept.status,
              hasHostedEvent: dept.hasHostedEvent,
              totalRequests: dept.totalRequests,
              actualSandwichTotal: dept.actualSandwichTotal,
              eventDate: dept.eventDate,
              contactName: dept.contactName,
              department: dept.department,
              locations: (dept as any).locations || [],
            }))
          ),
          selectedItem: selectedOrganization ? {
            organizationName: selectedOrganization.organizationName,
            contactName: selectedOrganization.contactName,
            category: selectedOrganization.category,
            status: selectedOrganization.status,
            hasHostedEvent: selectedOrganization.hasHostedEvent,
            totalRequests: selectedOrganization.totalRequests,
          } : undefined,
        })}
        suggestedQuestions={[
          "How many groups are in our catalog?",
          "Which groups have had the most events?",
          "How many schools vs churches do we partner with?",
          "What groups haven't hosted events yet?",
          "Show me the breakdown by category",
          "Which groups were recently active?",
          "Do we have any groups near Covington?",
        ]}
      />

      {/* Back to Top Button */}
      {showBackToTop && (
        <Button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 rounded-full h-12 w-12 p-0 shadow-lg bg-[#236383] hover:bg-[#007E8C] text-white transition-all duration-300"
          aria-label="Back to top"
          title="Back to top"
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
