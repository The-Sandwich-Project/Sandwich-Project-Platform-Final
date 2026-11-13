import { useEffect, useState, useMemo, Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Phone,
  Mail,
  User,
  AlertCircle,
  MapPin,
  Star,
  Building2,
  UserPlus,
  Crown,
  Search,
  Filter,
  X,
  CheckCircle,
  RefreshCw,
  Package,
  HelpCircle,
  Download,
  Power,
  PowerOff,
} from 'lucide-react';

// Lazy load map and cooler tracking components
const HostLocationsMap = lazyWithRetry(() => import('@/pages/route-map'));
const CoolerTracking = lazyWithRetry(() => import('@/pages/cooler-tracking'));
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { PERMISSIONS } from '@shared/auth-utils';
import { useResourcePermissions } from '@/hooks/useResourcePermissions';
import { usePageSession } from '@/hooks/usePageSession';
import type {
  Host,
  InsertHost,
  HostContact,
  InsertHostContact,
  Recipient,
} from '@shared/schema';
import { logger } from '@/lib/logger';

interface HostWithContacts extends Host {
  contacts: HostContact[];
}

interface ExtendedHostContact extends HostContact {
  newRoleType?: string;
  newAssignmentId?: number;
}

// Predefined host areas/locations
const HOST_AREAS = [
  'Alpharetta',
  'East Cobb/Roswell',
  'Dacula',
  'Dunwoody/PTC',
  'Flowery Branch',
  'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead',
  'Sandy Springs/Chastain',
  'UGA',
] as const;

// Predefined contact roles - standardized lowercase values
const CONTACT_ROLES = [
  { value: 'lead', label: 'Lead' },
  { value: 'host', label: 'Host' },
  { value: 'primary', label: 'Primary Contact' },
  { value: 'alternate', label: 'Alternate Contact' },
] as const;

// Get all contacts eligible to be selected as "alternate for" (exclude the contact itself and volunteers)
function getAlternateForOptions(hostsWithContacts: HostWithContacts[], excludeContactId?: number): { id: number; name: string; hostName: string }[] {
  const options: { id: number; name: string; hostName: string }[] = [];
  for (const host of hostsWithContacts) {
    if (host.status === 'hidden') continue;
    for (const contact of host.contacts) {
      if (contact.id === excludeContactId) continue;
      if (contact.role?.toLowerCase() === 'volunteer') continue;
      options.push({ id: contact.id, name: contact.name, hostName: host.name });
    }
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

// Normalize legacy freeform role values to standardized ones
// Old data has: "Host", "Host Home", "Host Collection Site", "head of school", etc.
function normalizeContactRole(raw: string | null | undefined): string {
  if (!raw) return 'host';
  const lower = raw.toLowerCase().trim();

  // Direct matches
  if (lower === 'lead') return 'lead';
  if (lower === 'primary' || lower === 'primary contact') return 'primary';
  if (lower === 'alternate' || lower === 'alternate contact') return 'alternate';
  if (lower === 'volunteer') return 'volunteer';

  // Legacy values that are all just "host" with extra words
  if (lower.includes('host')) return 'host';

  // Anything else that doesn't match a known role → default to host
  // (these are contacts ON host locations, so "host" is the safest default)
  return 'host';
}

// Get display label for a normalized role
function roleLabel(role: string): string {
  const found = CONTACT_ROLES.find((r) => r.value === role);
  return found ? found.label : role.charAt(0).toUpperCase() + role.slice(1);
}

export default function HostsManagementConsolidated() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { canEdit } = useResourcePermissions('HOSTS');

  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'Hosts Management',
    context: { userRole: user?.role },
  });

  // Check if user can edit their own host contact details (matched by email)
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEditOwnContact = userPermissions.includes(PERMISSIONS.HOSTS_EDIT_OWN) || canEdit || isAdmin;

  // Check if user can edit a specific contact (owns it by email match, or has full edit permission)
  const canEditContact = (contact: HostContact) => {
    if (isAdmin || canEdit) return true;
    if (!canEditOwnContact) return false;
    // Match by email (case-insensitive)
    const userEmail = user?.email?.toLowerCase()?.trim();
    const contactEmail = contact.email?.toLowerCase()?.trim();
    return userEmail && contactEmail && userEmail === contactEmail;
  };

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedHost, setSelectedHost] = useState<HostWithContacts | null>(
    null
  );
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [editingContact, setEditingContact] =
    useState<ExtendedHostContact | null>(null);
  const [expandedContacts, setExpandedContacts] = useState<Set<number>>(
    new Set()
  );
  const [hideEmptyHosts, setHideEmptyHosts] = useState(false);
  const [activeLocationTab, setActiveLocationTab] = useState<string>('active');

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [contactFilter, setContactFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  // Former hosts are hidden by default; flip this to include them in the
  // contacts view. The card list, the host grid in the locations view, and
  // the search are all filtered by this.
  const [showFormerHosts, setShowFormerHosts] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'locations' | 'contacts'>(
    'contacts'
  );

  // Helper function to sort contacts by priority (leads first, then primary contacts)
  const sortContactsByPriority = (contacts: HostContact[]) => {
    return [...contacts].sort((a, b) => {
      // First priority: leads
      if (a.role === 'lead' && b.role !== 'lead') return -1;
      if (b.role === 'lead' && a.role !== 'lead') return 1;

      // Second priority: primary contacts
      if (a.isPrimary && !b.isPrimary) return -1;
      if (b.isPrimary && !a.isPrimary) return 1;

      // Third priority: primary role contacts
      if (a.role === 'primary' && b.role !== 'primary') return -1;
      if (b.role === 'primary' && a.role !== 'primary') return 1;

      // Default: alphabetical by name
      return a.name.localeCompare(b.name);
    });
  };

  const toggleContactExpansion = (hostId: number) => {
    setExpandedContacts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(hostId)) {
        newSet.delete(hostId);
      } else {
        newSet.add(hostId);
      }
      return newSet;
    });
  };

  const [newHost, setNewHost] = useState<InsertHost>({
    name: '',
    address: '',
    status: 'active',
    notes: '',
  });

  useEffect(() => {
    const handleOpenCreate = () => {
      setNewHost({
        name: '',
        address: '',
        status: 'active',
        notes: '',
      });
      setIsAddModalOpen(true);
    };

    window.addEventListener('openHostCreateDialog', handleOpenCreate);
    return () => {
      window.removeEventListener('openHostCreateDialog', handleOpenCreate);
    };
  }, []);
  const [newContact, setNewContact] = useState({
    name: '',
    role: '',
    phone: '',
    email: '',
    address: '',
    hostLocation: '',
    isPrimary: false,
    driverAgreementSigned: false,
    vanApproved: false,
    isVolunteer: false,
    notes: '',
    alternateForContactId: null as number | null,
  });

  const { data: hostsWithContacts = [], isLoading } = useQuery<
    HostWithContacts[]
  >({
    queryKey: ['/api/hosts-with-contacts'],
    // Use global defaults (5 min staleTime, 10 min gcTime) - proper cache invalidation after mutations
    select: (data) =>
      data.map((host) => ({
        ...host,
        contacts: host.contacts.map((contact) => ({
          ...contact,
          role: normalizeContactRole(contact.role),
        })),
      })),
  });

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ['/api/recipients'],
  });

  // Get unique locations for the location filter
  const uniqueLocations = useMemo(() => {
    const locations = hostsWithContacts
      .map((host) => host.name)
      .filter((name) => name && name.trim())
      .sort();
    return Array.from(new Set(locations));
  }, [hostsWithContacts]);

  // Filtered and searched hosts
  const filteredHosts = useMemo(() => {
    // First, filter out contacts with 'volunteer' role from each host
    // These contacts should only appear in Volunteer Management, not Host Management
    let filtered = hostsWithContacts.map((host) => ({
      ...host,
      contacts: host.contacts.filter(
        (contact) => contact.role?.toLowerCase() !== 'volunteer'
      ),
    }));

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (host) =>
          host.name.toLowerCase().includes(term) ||
          host.notes?.toLowerCase().includes(term) ||
          host.contacts.some(
            (contact) =>
              contact.name.toLowerCase().includes(term) ||
              contact.email?.toLowerCase().includes(term) ||
              contact.phone?.toLowerCase().includes(term)
          )
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((host) => host.status === statusFilter);
    }

    // Apply location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter((host) => host.name === locationFilter);
    }

    // Apply contact filter
    if (contactFilter === 'has_contacts') {
      filtered = filtered.filter((host) => host.contacts.length > 0);
    } else if (contactFilter === 'no_contacts') {
      filtered = filtered.filter((host) => host.contacts.length === 0);
    } else if (contactFilter === 'has_primary') {
      filtered = filtered.filter((host) =>
        host.contacts.some((c) => c.isPrimary)
      );
    } else if (contactFilter === 'has_lead') {
      filtered = filtered.filter((host) =>
        host.contacts.some((c) => c.role === 'lead')
      );
    }

    // Apply role filter
    if (roleFilter !== 'all') {
      if (roleFilter === 'leads') {
        filtered = filtered.filter((host) =>
          host.contacts.some((c) => c.role === 'lead')
        );
      } else if (roleFilter === 'hosts') {
        filtered = filtered.filter((host) =>
          host.contacts.some((c) => c.role === 'host' || c.role === 'primary')
        );
      } else if (roleFilter === 'alternates') {
        filtered = filtered.filter((host) =>
          host.contacts.some(
            (c) => c.role === 'alternate' || c.role === 'alternate contact'
          )
        );
      }
    }

    // Apply hide empty hosts filter
    if (hideEmptyHosts) {
      filtered = filtered.filter((host) => host.contacts.length > 0);
    }

    return filtered;
  }, [
    hostsWithContacts,
    searchTerm,
    statusFilter,
    locationFilter,
    contactFilter,
    roleFilter,
    hideEmptyHosts,
  ]);

  // Individual contacts for contact view mode
  const allContacts = useMemo(() => {
    const contacts: (HostContact & {
      hostName: string;
      hostStatus: string;
    })[] = [];

    filteredHosts.forEach((host) => {
      host.contacts.forEach((contact) => {
        contacts.push({
          ...contact,
          hostName: host.name,
          hostStatus: host.status,
        });
      });
    });

    return contacts;
  }, [filteredHosts]);

  // Filter contacts based on search term in contact view mode
  const filteredContacts = useMemo(() => {
    if (viewMode !== 'contacts') return [];

    let filtered = allContacts;

    // Hide former hosts unless the toggle is on. They stay in the data set
    // for reference but don't clutter the active roster view.
    if (!showFormerHosts) {
      filtered = filtered.filter((contact) => !(contact as any).isFormerHost);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (contact) =>
          contact.name.toLowerCase().includes(term) ||
          contact.email?.toLowerCase().includes(term) ||
          contact.phone.toLowerCase().includes(term) ||
          contact.role.toLowerCase().includes(term) ||
          contact.hostName.toLowerCase().includes(term) ||
          contact.address?.toLowerCase().includes(term) ||
          contact.notes?.toLowerCase().includes(term)
      );
    }

    // Apply location filter for contacts view
    if (locationFilter !== 'all') {
      filtered = filtered.filter(
        (contact) => contact.hostName === locationFilter
      );
    }

    // Apply role filter for contacts view
    if (roleFilter !== 'all') {
      if (roleFilter === 'leads') {
        filtered = filtered.filter((contact) => contact.role === 'lead');
      } else if (roleFilter === 'hosts') {
        filtered = filtered.filter(
          (contact) => contact.role === 'host' || contact.role === 'primary'
        );
      } else if (roleFilter === 'alternates') {
        filtered = filtered.filter(
          (contact) => contact.role === 'alternate'
        );
      }
    }

    return filtered.sort((a, b) => {
      // Sort by role priority first (lead > primary > others)
      if (a.role === 'lead' && b.role !== 'lead') return -1;
      if (b.role === 'lead' && a.role !== 'lead') return 1;
      if (a.isPrimary && !b.isPrimary) return -1;
      if (b.isPrimary && !a.isPrimary) return 1;

      // Then by name
      return a.name.localeCompare(b.name);
    });
  }, [allContacts, searchTerm, locationFilter, roleFilter, viewMode, showFormerHosts]);

  // Alias for backward compatibility
  const hosts = filteredHosts;

  const createHostMutation = useMutation({
    mutationFn: async (data: InsertHost) => {
      return await apiRequest('POST', '/api/hosts', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      setNewHost({ name: '', address: '', status: 'active', notes: '' });
      setIsAddModalOpen(false);
      toast({
        title: 'Host added',
        description: 'New host has been added successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to add host: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const updateHostMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<Host> }) => {
      return await apiRequest('PATCH', `/api/hosts/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      toast({
        title: 'Host updated',
        description: 'Host has been updated successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to update host: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const deleteHostMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/hosts/${id}`);
    },
    onSuccess: (_, hostId) => {
      // Immediately update cache to remove deleted host
      queryClient.setQueryData(
        ['/api/hosts-with-contacts'],
        (oldData: HostWithContacts[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.filter((host) => host.id !== hostId);
        }
      );

      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      toast({
        title: 'Host deleted',
        description: 'Host has been deleted successfully.',
      });
    },
    onError: async (error: any, hostId) => {
      const errorMessage = error?.message || 'Failed to delete host';

      // Check if it's a constraint violation (409) - host has associated data
      if (
        error?.status === 409 ||
        errorMessage.includes('associated collection')
      ) {
        toast({
          title: 'Cannot delete host',
          description:
            'This host has collection records and cannot be deleted. Please remove or reassign the collection data first.',
          variant: 'destructive',
        });
      }
      // Check if it's a 404 error (host not found)
      else if (
        errorMessage.includes('404') ||
        errorMessage.includes('not found')
      ) {
        // Force a complete data refresh to sync with the database
        await queryClient.invalidateQueries({
          queryKey: ['/api/hosts-with-contacts'],
        });
        await queryClient.refetchQueries({
          queryKey: ['/api/hosts-with-contacts'],
        });

        toast({
          title: 'Data refreshed',
          description: 'Host data has been synchronized with the database.',
        });
      } else {
        toast({
          title: 'Cannot delete host',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (data: InsertHostContact) => {
      return await apiRequest('POST', '/api/host-contacts', data);
    },
    onSuccess: async () => {
      // Invalidate and refetch the hosts data
      await queryClient.invalidateQueries({
        queryKey: ['/api/hosts-with-contacts'],
      });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      // "Also a volunteer" creates a linked volunteer record server-side
      queryClient.invalidateQueries({ queryKey: ['/api/volunteers'] });
      await queryClient.refetchQueries({
        queryKey: ['/api/hosts-with-contacts'],
      });

      // Update the selected host with fresh data
      if (selectedHost) {
        const freshHosts = queryClient.getQueryData([
          '/api/hosts-with-contacts',
        ]) as HostWithContacts[];
        const freshHost = freshHosts?.find((h) => h.id === selectedHost.id);
        if (freshHost) {
          setSelectedHost(freshHost);
        }
      }

      setNewContact({
        name: '',
        role: '',
        phone: '',
        email: '',
        address: '',
        hostLocation: '',
        isPrimary: false,
        driverAgreementSigned: false,
        vanApproved: false,
        isVolunteer: false,
        notes: '',
        alternateForContactId: null,
      });
      setIsAddingContact(false);
      toast({
        title: 'Contact added',
        description: 'New contact has been added successfully.',
      });
    },
    onError: (error: any) => {
      const errorMessage =
        error?.message || error?.response?.data?.message || 'Unknown error';

      // Handle specific duplicate contact error
      if (error?.status === 409 || errorMessage.includes('already exists')) {
        toast({
          title: 'Duplicate Contact',
          description: errorMessage,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: `Failed to add contact: ${errorMessage}`,
          variant: 'destructive',
        });
      }
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<HostContact> }) => {
      logger.log('PATCH request data:', data);
      return await apiRequest(
        'PATCH',
        `/api/host-contacts/${data.id}`,
        data.updates
      );
    },
    onSuccess: (updatedContact, { id, updates }) => {
      // Update the cache immediately with the new contact data
      queryClient.setQueryData(
        ['/api/hosts-with-contacts'],
        (oldData: HostWithContacts[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.map((host) => ({
            ...host,
            contacts: host.contacts.map((contact) =>
              contact.id === id ? { ...contact, ...updates } : contact
            ),
          }));
        }
      );

      // Update selectedHost immediately if this contact belongs to it
      if (selectedHost) {
        const updatedContacts = selectedHost.contacts.map((contact) =>
          contact.id === id ? { ...contact, ...updates } : contact
        );
        setSelectedHost({
          ...selectedHost,
          contacts: updatedContacts,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      queryClient.invalidateQueries({ queryKey: ['/api/volunteers'] });
      setEditingContact(null);
      toast({
        title: 'Contact updated',
        description: 'Contact has been updated successfully.',
      });
    },
    onError: async (error: any) => {
      const errorMessage = error.message || 'Unknown error occurred';

      // Check if it's a 404 error (contact not found)
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        // Force a complete data refresh to sync with the database
        await queryClient.invalidateQueries({
          queryKey: ['/api/hosts-with-contacts'],
        });
        await queryClient.refetchQueries({
          queryKey: ['/api/hosts-with-contacts'],
        });

        // Get fresh data after refetch
        const freshHosts = queryClient.getQueryData([
          '/api/hosts-with-contacts',
        ]) as HostWithContacts[];
        if (selectedHost && freshHosts) {
          const freshHost = freshHosts.find((h) => h.id === selectedHost.id);
          if (freshHost) {
            setSelectedHost(freshHost);
          }
        }

        setEditingContact(null);
        toast({
          title: 'Data refreshed',
          description: 'Contact data has been synchronized with the database.',
        });
      } else {
        toast({
          title: 'Error',
          description: `Failed to update contact: ${errorMessage}`,
          variant: 'destructive',
        });
      }
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/host-contacts/${id}`);
    },
    onSuccess: (_, deletedContactId) => {
      // Remove the deleted contact from all queries immediately to prevent 404s
      queryClient.setQueryData(
        ['/api/hosts-with-contacts'],
        (oldData: HostWithContacts[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.map((host) => ({
            ...host,
            contacts: host.contacts.filter(
              (contact) => contact.id !== deletedContactId
            ),
          }));
        }
      );

      // Invalidate multiple related queries to ensure UI refresh
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/host-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });

      // Update selectedHost immediately to show the contact is gone
      if (selectedHost) {
        const updatedContacts = selectedHost.contacts.filter(
          (contact) => contact.id !== deletedContactId
        );
        setSelectedHost({
          ...selectedHost,
          contacts: updatedContacts,
        });
      }

      // Force a refetch in the background for data consistency
      queryClient.refetchQueries({ queryKey: ['/api/hosts-with-contacts'] });

      toast({
        title: 'Contact deleted',
        description: 'Contact has been deleted successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to delete contact: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const refreshAvailabilityMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/hosts/scrape-availability');
    },
    onSuccess: (result: any) => {
      // Refresh hosts data to show updated weekly active status
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.refetchQueries({ queryKey: ['/api/hosts-with-contacts'] });

      toast({
        title: 'Availability Updated',
        description: `${result.matchedContacts} contacts marked as available, ${result.unmatchedContacts} as unavailable.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to refresh availability: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const geocodeAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/hosts/geocode-all');
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });

      if (result.contactsProcessed === 0) {
        toast({
          title: 'All Geocoded',
          description: 'All host contacts with addresses already have coordinates.',
        });
      } else {
        toast({
          title: 'Geocoding Started',
          description: `Geocoding ${result.contactsProcessed} host contacts in background. Refresh the page in a minute to see updated map pins.`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to start geocoding: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const forceGeocodeAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/hosts/geocode-all?force=true');
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/hosts-with-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/hosts/map'] });
      toast({
        title: 'Re-geocoding Started',
        description: `Re-geocoding ${result.contactsProcessed} host contacts in background. Refresh the page in a minute to see corrected map pins.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: `Failed to start re-geocoding: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const handleAddHost = () => {
    if (!newHost.name.trim()) return;
    createHostMutation.mutate(newHost);
  };

  const handleDeleteHost = (id: number) => {
    const host = hostsWithContacts.find((h) => h.id === id);
    if (
      confirm(
        `Are you sure you want to hide "${host?.name}" from this list? It will be completely hidden but data will be preserved.`
      )
    ) {
      // Set status to hidden to completely remove from display
      updateHostMutation.mutate({
        id: id,
        updates: { status: 'hidden' },
      });
    }
  };

  const handleAddContact = async () => {
    if (!newContact.name.trim()) return;

    // If adding from within a host dialog, use that host's ID
    if (selectedHost) {
      createContactMutation.mutate({
        ...newContact,
        hostId: selectedHost.id,
      });
      return;
    }

    // If adding from main page, find or create a host for the selected area
    let hostId: number;
    const areaName = newContact.hostLocation || 'Unassigned';

    // Try to find existing host with matching name
    const existingHost = hostsWithContacts.find(h => h.name === areaName);

    if (existingHost) {
      hostId = existingHost.id;
      createContactMutation.mutate({
        ...newContact,
        hostId,
      });
    } else {
      // Create new host for this area
      try {
        const newHost = await apiRequest('POST', '/api/hosts', {
          name: areaName,
          status: 'active',
          notes: `Auto-created for ${areaName} area`,
        });
        createContactMutation.mutate({
          ...newContact,
          hostId: newHost.id,
        });
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to create host area for contact',
          variant: 'destructive',
        });
      }
    }
  };

  const handleUpdateContact = () => {
    if (!editingContact) return;

    logger.log('Updating contact:', editingContact.id, editingContact);

    // Clean the updates object to only include valid HostContact fields - exclude timestamps and IDs
    const updates = {
      name: editingContact.name?.trim(),
      role: editingContact.role?.trim(),
      phone: editingContact.phone?.trim(),
      email: editingContact.email?.trim(),
      address: editingContact.address?.trim() || '',
      hostLocation: editingContact.hostLocation?.trim() || '',
      weeklyActive: editingContact.weeklyActive || false,
      isPrimary: editingContact.isPrimary || false,
      driverAgreementSigned: editingContact.driverAgreementSigned || false,
      vanApproved: editingContact.vanApproved || false,
      isFormerHost: editingContact.isFormerHost || false,
      isVolunteer: editingContact.isVolunteer || false,
      alternateForContactId: editingContact.role === 'alternate' ? (editingContact.alternateForContactId || null) : null,
      notes: editingContact.notes?.trim() || '',
    };

    updateContactMutation.mutate({
      id: editingContact.id,
      updates: updates,
    });
  };

  const handleDeleteContact = (id: number) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      deleteContactMutation.mutate(id);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/hosts/export-csv', { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hosts-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast({ title: 'Export completed successfully', description: `Exported hosts and contacts to CSV` });
    } catch {
      toast({ title: 'Export failed', description: 'Failed to export hosts data', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-600">Loading hosts...</div>
      </div>
    );
  }

  // Filter hosts by status and contact count
  // Also exclude contacts with 'volunteer' role for display consistency
  const visibleHosts = hostsWithContacts
    .map((host) => ({
      ...host,
      contacts: host.contacts.filter(
        (contact) => contact.role?.toLowerCase() !== 'volunteer'
      ),
    }))
    .filter((host) => {
      // Always hide "hidden" hosts
      if (host.status === 'hidden') return false;

      // Optionally hide hosts with no contacts (after filtering out volunteers)
      if (hideEmptyHosts && (!host.contacts || host.contacts.length === 0))
        return false;

      return true;
    });

  const activeHosts = visibleHosts.filter((host) => host.status === 'active');
  const inactiveHosts = visibleHosts.filter(
    (host) => host.status === 'inactive'
  );

  // Render host grid component
  const HostGrid = ({ hostList }: { hostList: HostWithContacts[] }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {hostList.map((host) => (
        <Card
          key={host.id}
          className={`hover:shadow-md transition-shadow ${
            host.status === 'inactive'
              ? 'bg-gray-100 border-gray-400 opacity-70'
              : ''
          }`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-2 flex-1 min-w-0">
                <Building2
                  className={`w-5 h-5 mt-0.5 flex-shrink-0 ${host.status === 'inactive' ? 'text-gray-400' : 'text-slate-600'}`}
                />
                <CardTitle
                  className={`text-base leading-tight ${host.status === 'inactive' ? 'text-gray-600' : ''}`}
                >
                  {host.name.split('/').map((part, index, array) => (
                    <span key={index}>
                      {part.trim()}
                      {index < array.length - 1 && (
                        <span className="text-slate-400">/</span>
                      )}
                      {index < array.length - 1 && <wbr />}
                    </span>
                  ))}
                </CardTitle>
              </div>
              <Badge
                variant={host.status === 'active' ? 'default' : 'secondary'}
                className={
                  host.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }
              >
                {host.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Display contacts */}
            {host.contacts && host.contacts.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Contacts:
                </div>
                {(() => {
                  // Hide former hosts unless the toggle is on (consistent
                  // with the contacts-view filter; otherwise the location's
                  // sub-list would show them but the dedicated view wouldn't).
                  const visibleHostContacts = showFormerHosts
                    ? host.contacts
                    : host.contacts.filter((c) => !(c as any).isFormerHost);
                  const sortedContacts = sortContactsByPriority(visibleHostContacts);
                  const isExpanded = expandedContacts.has(host.id);
                  // Show first 5 contacts by default, then allow expanding to see all
                  const contactsToShow = isExpanded
                    ? sortedContacts
                    : sortedContacts.slice(0, 5);

                  return (
                    <>
                      {contactsToShow.map((contact) => (
                        <div
                          key={contact.id}
                          className="space-y-1 border-l-2 border-brand-primary-border pl-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">
                              {contact.name}
                            </span>
                            <div className="flex items-center space-x-1">
                              {contact.weeklyActive && (
                                <span
                                  className="group relative flex items-center"
                                  tabIndex={0}
                                >
                                  <CheckCircle
                                    className="w-3 h-3 text-green-600 fill-current"
                                    aria-label={`Available this week${contact.lastScraped ? ` (updated ${new Date(contact.lastScraped).toLocaleDateString()})` : ''}`}
                                  />
                                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover:block group-focus:block bg-slate-800 text-white text-xs rounded px-2 py-1 z-10 whitespace-nowrap">
                                    {`Available this week${contact.lastScraped ? ` (updated ${new Date(contact.lastScraped).toLocaleDateString()})` : ''}`}
                                  </span>
                                </span>
                              )}
                              {contact.role === 'lead' && (
                                <Crown className="w-3 h-3 text-purple-600 fill-current" />
                              )}
                              {contact.isPrimary && (
                                <Star className="w-3 h-3 text-yellow-500 fill-current" />
                              )}
                            </div>
                          </div>
                          {contact.role && (
                            <div className="text-xs text-slate-600">
                              {roleLabel(contact.role)}
                              {contact.role === 'alternate' && contact.alternateForContactId && (() => {
                                const altFor = hostsWithContacts.flatMap(h => h.contacts).find(c => c.id === contact.alternateForContactId);
                                return altFor ? <span className="text-slate-500 italic"> for {altFor.name}</span> : null;
                              })()}
                            </div>
                          )}
                          <div className="flex items-center text-xs text-slate-600">
                            <Phone className="w-3 h-3 mr-1" />
                            {contact.phone}
                          </div>
                          {contact.email && (
                            <div className="flex items-center text-xs text-slate-600">
                              <Mail className="w-3 h-3 mr-1" />
                              {contact.email}
                            </div>
                          )}
                          {contact.address && (
                            <div className="flex items-start text-xs text-slate-600">
                              <MapPin className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                              <span>{contact.address}</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {sortedContacts.length > 5 && (
                        <button
                          onClick={() => toggleContactExpansion(host.id)}
                          className="text-xs text-brand-primary hover:text-brand-primary-dark hover:underline cursor-pointer"
                        >
                          {isExpanded
                            ? 'Show less'
                            : `+${sortedContacts.length - 5} more contacts`}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {host.notes && (
              <div className="flex items-start text-sm text-slate-600">
                <AlertCircle className="w-4 h-4 mr-2 mt-0.5" />
                <span className="text-xs">{host.notes}</span>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  // Force fresh data when opening host details
                  await queryClient.refetchQueries({
                    queryKey: ['/api/hosts-with-contacts'],
                  });
                  // Get the refreshed host data
                  const freshHosts = queryClient.getQueryData([
                    '/api/hosts-with-contacts'
                  ]) as HostWithContacts[];
                  const freshHost = freshHosts?.find((h) => h.id === host.id);
                  setSelectedHost(freshHost || host);
                }}
                className="w-full"
              >
                <Users className="w-3 h-3 mr-1" />
                Manage Contacts
              </Button>
              {/* Inline status toggle — the Details tab inside Manage
                  Contacts already exposes this same control, but burying
                  it three clicks deep made coordinators think the feature
                  didn't exist. Surfacing the toggle on the card lets you
                  deactivate a location with one click + confirm. */}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-full ${
                    host.status === 'active'
                      ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      : 'text-green-700 border-green-200 hover:bg-green-50 hover:text-green-800'
                  }`}
                  disabled={updateHostMutation.isPending}
                  onClick={() => {
                    const nextStatus = host.status === 'active' ? 'inactive' : 'active';
                    const verb = nextStatus === 'inactive' ? 'inactive' : 'active';
                    if (
                      window.confirm(
                        `Mark "${host.name}" as ${verb}? ` +
                          (nextStatus === 'inactive'
                            ? 'This location will be hidden from the collection-log dropdown and other active host lists. You can mark it active again any time.'
                            : 'This location will appear in active host lists and the collection-log dropdown again.'),
                      )
                    ) {
                      updateHostMutation.mutate({
                        id: host.id,
                        updates: { status: nextStatus },
                      });
                    }
                  }}
                >
                  {host.status === 'active' ? (
                    <>
                      <PowerOff className="w-3 h-3 mr-1" />
                      Mark Inactive
                    </>
                  ) : (
                    <>
                      <Power className="w-3 h-3 mr-1" />
                      Mark Active
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <TooltipProvider>
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
              Host Management
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-teal-600 hover:text-teal-800 transition-colors">
                    <HelpCircle className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold mb-1">Host Management Help</p>
                  <p className="text-sm">Manage host contacts organized by region. Each region groups nearby hosts for coordination and deliveries — lead hosts and alternates have their own addresses listed on their contact cards.</p>
                </TooltipContent>
              </Tooltip>
            </h2>
            <p className="text-slate-600 mt-1">
              Manage host contacts by region. Regions group nearby hosts for coordination — addresses belong to individual contacts.
            </p>
          </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <Tabs
            value={viewMode}
            onValueChange={(value) =>
              setViewMode(value as 'locations' | 'contacts')
            }
            className="w-auto"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="locations"
                className="flex items-center gap-2"
              >
                <Building2 className="w-4 h-4" />
                Locations
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Contacts
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {viewMode === 'locations' && (
            <Button
              onClick={() => setActiveLocationTab('map')}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white font-semibold shadow-md flex-1 sm:flex-none"
              size="lg"
            >
              <MapPin className="w-5 h-5 mr-2" />
              View Host Map
            </Button>
          )}
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canEdit} className="flex-1 sm:flex-none">
                <Plus className="w-4 h-4 mr-2" />
                Add Contact
              </Button>
            </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-md sm:max-w-lg max-h-[85vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl">
                Add New Contact
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddContact();
              }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="main-contact-name">Name *</Label>
                <Input
                  id="main-contact-name"
                  value={newContact.name}
                  onChange={(e) => {
                    e.stopPropagation();
                    setNewContact({
                      ...newContact,
                      name: e.target.value,
                    });
                  }}
                  placeholder="Enter contact name"
                />
              </div>
              <div>
                <Label htmlFor="main-contact-role">Role</Label>
                <Select
                  value={newContact.role || ''}
                  onValueChange={(value) => {
                    setNewContact({
                      ...newContact,
                      role: value === 'none' ? '' : value,
                    });
                  }}
                >
                  <SelectTrigger id="main-contact-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Role</SelectItem>
                    {CONTACT_ROLES.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newContact.role === 'alternate' && (
                <div>
                  <Label htmlFor="main-alternate-for">Alternate For</Label>
                  <Select
                    value={newContact.alternateForContactId?.toString() || 'none'}
                    onValueChange={(value) => setNewContact({ ...newContact, alternateForContactId: value === 'none' ? null : parseInt(value) })}
                  >
                    <SelectTrigger id="main-alternate-for">
                      <SelectValue placeholder="Select who this person alternates for" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {getAlternateForOptions(hostsWithContacts).map((opt) => (
                        <SelectItem key={opt.id} value={opt.id.toString()}>
                          {opt.name} ({opt.hostName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="main-contact-phone">Phone</Label>
                <Input
                  id="main-contact-phone"
                  value={newContact.phone}
                  onChange={(e) => {
                    e.stopPropagation();
                    setNewContact({
                      ...newContact,
                      phone: e.target.value,
                    });
                  }}
                  placeholder="Enter phone number"
                />
              </div>
              <div>
                <Label htmlFor="main-contact-email">Email</Label>
                <Input
                  id="main-contact-email"
                  type="email"
                  value={newContact.email}
                  onChange={(e) => {
                    e.stopPropagation();
                    setNewContact({
                      ...newContact,
                      email: e.target.value,
                    });
                  }}
                  placeholder="Enter email address"
                />
              </div>
              <div>
                <Label htmlFor="main-contact-address">Address</Label>
                <Input
                  id="main-contact-address"
                  value={newContact.address || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    setNewContact({
                      ...newContact,
                      address: e.target.value,
                    });
                  }}
                  placeholder="Enter contact address"
                />
              </div>
              <div>
                <Label htmlFor="main-contact-location">Area/Location</Label>
                <Select
                  value={newContact.hostLocation || ''}
                  onValueChange={(value) => {
                    setNewContact({
                      ...newContact,
                      hostLocation: value,
                    });
                  }}
                >
                  <SelectTrigger id="main-contact-location">
                    <SelectValue placeholder="Select an area..." />
                  </SelectTrigger>
                  <SelectContent>
                    {HOST_AREAS.map((area) => (
                      <SelectItem key={area} value={area}>
                        {area}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">
                  Used to group contacts by geographic area on the main view
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="main-contact-primary"
                  checked={newContact.isPrimary}
                  onCheckedChange={(checked) =>
                    setNewContact({ ...newContact, isPrimary: checked })
                  }
                />
                <Label htmlFor="main-contact-primary">Primary Contact</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="main-contact-driver-agreement"
                  checked={newContact.driverAgreementSigned}
                  onCheckedChange={(checked) =>
                    setNewContact({ ...newContact, driverAgreementSigned: checked })
                  }
                />
                <Label htmlFor="main-contact-driver-agreement">Driver Agreement Signed</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="main-contact-van-approved"
                  checked={newContact.vanApproved || false}
                  onCheckedChange={(checked) =>
                    setNewContact({ ...newContact, vanApproved: checked })
                  }
                />
                <Label htmlFor="main-contact-van-approved">
                  Approved Van Driver
                  <span className="block text-xs text-slate-500">
                    Can be assigned to drive the van for events
                  </span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="main-contact-volunteer"
                  checked={newContact.isVolunteer || false}
                  onCheckedChange={(checked) =>
                    setNewContact({ ...newContact, isVolunteer: checked })
                  }
                />
                <Label htmlFor="main-contact-volunteer" className="text-sm">
                  Also a Volunteer
                  <span className="block text-xs text-slate-500">
                    Lists this host in volunteer dropdowns so they can be assigned to events
                  </span>
                </Label>
              </div>
              <div>
                <Label htmlFor="main-contact-notes">Notes</Label>
                <Textarea
                  id="main-contact-notes"
                  value={newContact.notes || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    setNewContact({
                      ...newContact,
                      notes: e.target.value,
                    });
                  }}
                  placeholder="Enter any additional notes"
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !newContact.name.trim() || createContactMutation.isPending
                  }
                >
                  {createContactMutation.isPending ? 'Adding...' : 'Add Contact'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Button
          variant="outline"
          onClick={handleExport}
          disabled={!hostsWithContacts || hostsWithContacts.length === 0}
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>

        <Button
          variant="outline"
          disabled={!canEdit || refreshAvailabilityMutation.isPending}
          onClick={() => refreshAvailabilityMutation.mutate()}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshAvailabilityMutation.isPending ? 'animate-spin' : ''}`} />
          {refreshAvailabilityMutation.isPending ? 'Refreshing...' : 'Refresh Availability'}
        </Button>

        <Button
          variant="outline"
          disabled={!canEdit || geocodeAllMutation.isPending}
          onClick={() => geocodeAllMutation.mutate()}
        >
          <MapPin className={`w-4 h-4 mr-2 ${geocodeAllMutation.isPending ? 'animate-spin' : ''}`} />
          {geocodeAllMutation.isPending ? 'Geocoding...' : 'Geocode Missing'}
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || forceGeocodeAllMutation.isPending}
          onClick={() => forceGeocodeAllMutation.mutate()}
        >
          <MapPin className={`w-4 h-4 mr-2 ${forceGeocodeAllMutation.isPending ? 'animate-spin' : ''}`} />
          {forceGeocodeAllMutation.isPending ? 'Re-geocoding...' : 'Fix All Map Pins'}
        </Button>
      </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="space-y-3 p-4 bg-slate-50 rounded-lg border">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Bar */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              data-tour="hosts-search"
              placeholder="Search hosts, contacts, locations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filter Toggle Button */}
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Filters
            {(statusFilter !== 'all' ||
              contactFilter !== 'all' ||
              locationFilter !== 'all' ||
              roleFilter !== 'all') && (
              <Badge variant="secondary" className="ml-1">
                {
                  [
                    statusFilter !== 'all' && 'Status',
                    contactFilter !== 'all' && 'Contacts',
                    locationFilter !== 'all' && 'Location',
                    roleFilter !== 'all' && 'Role',
                  ].filter(Boolean).length
                }
              </Badge>
            )}
          </Button>
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="flex flex-col md:flex-row gap-3 pt-3 border-t border-slate-200">
            <div className="flex flex-col space-y-2">
              <Label className="text-xs font-medium text-slate-600">
                Status
              </Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="inactive">Inactive Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col space-y-2">
              <Label className="text-xs font-medium text-slate-600">
                Location
              </Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {uniqueLocations.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col space-y-2">
              <Label className="text-xs font-medium text-slate-600">Role</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="leads">Leads</SelectItem>
                  <SelectItem value="hosts">Hosts</SelectItem>
                  <SelectItem value="alternates">Alternates</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col space-y-2">
              <Label className="text-xs font-medium text-slate-600">
                Contacts
              </Label>
              <Select value={contactFilter} onValueChange={setContactFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Hosts</SelectItem>
                  <SelectItem value="has_contacts">Has Contacts</SelectItem>
                  <SelectItem value="no_contacts">No Contacts</SelectItem>
                  <SelectItem value="has_primary">
                    Has Primary Contact
                  </SelectItem>
                  <SelectItem value="has_lead">Has Lead Contact</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setLocationFilter('all');
                  setRoleFilter('all');
                  setContactFilter('all');
                }}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center space-x-2">
              <Switch
                id="hide-empty-hosts"
                checked={hideEmptyHosts}
                onCheckedChange={setHideEmptyHosts}
              />
              <Label htmlFor="hide-empty-hosts" className="text-sm font-medium">
                Hide locations with no contacts
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="show-former-hosts"
                checked={showFormerHosts}
                onCheckedChange={setShowFormerHosts}
              />
              <Label htmlFor="show-former-hosts" className="text-sm font-medium">
                Show former hosts
              </Label>
            </div>
          </div>

          {/* Results Summary */}
          <div className="text-sm text-slate-600">
            Showing {visibleHosts.length} of {hostsWithContacts.length} hosts
            {searchTerm && <span> • Search: "{searchTerm}"</span>}
            {statusFilter !== 'all' && <span> • {statusFilter}</span>}
            {locationFilter !== 'all' && (
              <span> • Location: {locationFilter}</span>
            )}
            {roleFilter !== 'all' && <span> • Role: {roleFilter}</span>}
            {contactFilter !== 'all' && (
              <span> • {contactFilter.replace('_', ' ')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content based on View Mode */}
      {viewMode === 'contacts' ? (
        /* Individual Contact Cards View */
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            Showing {filteredContacts.length} individual contacts
            {searchTerm && <span> • Search: "{searchTerm}"</span>}
            {locationFilter !== 'all' && (
              <span> • Location: {locationFilter}</span>
            )}
            {roleFilter !== 'all' && <span> • Role: {roleFilter}</span>}
          </div>

          {filteredContacts.length === 0 ? (
            <div className="text-center py-12">
              <User className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">
                No contacts found
              </h3>
              <p className="text-slate-500">
                {searchTerm
                  ? 'Try adjusting your search terms.'
                  : 'No contacts are available in the system.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-tour="hosts-list">
              {filteredContacts.map((contact) => (
                <Card
                  key={contact.id}
                  className={`hover:shadow-md transition-shadow ${
                    (contact as any).isFormerHost
                      ? 'bg-gray-50 border-gray-300 opacity-75'
                      : ''
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Contact Header */}
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className={`font-semibold truncate ${
                            (contact as any).isFormerHost ? 'text-gray-500' : 'text-gray-900'
                          }`}>
                            {contact.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {(contact as any).isFormerHost && (
                              <Badge className="bg-gray-200 text-gray-700 border-gray-300 text-xs">
                                Former Host
                              </Badge>
                            )}
                            {(contact as any).isVolunteer && (
                              <Badge className="bg-violet-100 text-violet-800 border-violet-200 text-xs">
                                Volunteer
                              </Badge>
                            )}
                            {contact.weeklyActive && (
                              <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Available This Week
                              </Badge>
                            )}
                            <Badge
                              className={`text-xs ${
                                contact.role === 'lead'
                                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                                  : contact.isPrimary
                                    ? 'bg-brand-primary-light text-brand-primary-dark border-brand-primary-border'
                                    : contact.role === 'primary'
                                      ? 'bg-green-100 text-green-800 border-green-200'
                                      : 'bg-gray-100 text-gray-800 border-gray-200'
                              }`}
                            >
                              {roleLabel(contact.role)}
                            </Badge>
                            {contact.isPrimary && (
                              <Badge className="bg-brand-primary-light text-brand-primary-dark border-brand-primary-border text-xs">
                                <Star className="w-3 h-3 mr-1" />
                                Primary
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Region */}
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Building2 className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{contact.hostName}</span>
                      </div>

                      {/* Contact Information */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <a
                            href={`tel:${contact.phone}`}
                            className="text-brand-primary hover:underline truncate"
                          >
                            {contact.phone}
                          </a>
                        </div>

                        {contact.email && (
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-brand-primary hover:underline truncate"
                            >
                              {contact.email}
                            </a>
                          </div>
                        )}

                        {contact.address && (
                          <div className="flex items-start gap-2 text-sm text-gray-600">
                            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span className="text-xs">{contact.address}</span>
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      {contact.notes && (
                        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                          <p className="text-xs italic">{contact.notes}</p>
                        </div>
                      )}

                      {/* Edit Actions */}
                      {(() => {
                        const contactCanEdit = canEditContact(contact);
                        const contactCanDelete = canEdit; // Only full edit permission can delete
                        const showActions = contactCanEdit || contactCanDelete;

                        return showActions && (
                          <div className="flex gap-2 pt-2 border-t">
                            {contactCanEdit && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-xs"
                                onClick={() =>
                                  setEditingContact(contact as ExtendedHostContact)
                                }
                              >
                                <Edit className="w-3 h-3 mr-1" />
                                Edit
                              </Button>
                            )}
                            {contactCanDelete && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteContact(contact.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Edit Contact Dialog for Contacts View */}
          <Dialog
            open={!!editingContact && viewMode === 'contacts'}
            onOpenChange={(open) => !open && setEditingContact(null)}
          >
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Contact</DialogTitle>
              </DialogHeader>
              {editingContact && (
                <div className="space-y-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleUpdateContact();
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <Label htmlFor="edit-contact-name">Name *</Label>
                      <Input
                        id="edit-contact-name"
                        value={editingContact.name}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingContact({
                            ...editingContact,
                            name: e.target.value,
                          });
                        }}
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit-contact-role">Role</Label>
                      <Select
                        value={editingContact.role || ''}
                        onValueChange={(value) => {
                          setEditingContact({
                            ...editingContact,
                            role: value === 'none' ? '' : value,
                          });
                        }}
                      >
                        <SelectTrigger id="edit-contact-role">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Role</SelectItem>
                          {CONTACT_ROLES.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {editingContact.role === 'alternate' && (
                      <div>
                        <Label htmlFor="edit-alternate-for">Alternate For</Label>
                        <Select
                          value={editingContact.alternateForContactId?.toString() || 'none'}
                          onValueChange={(value) => setEditingContact({ ...editingContact, alternateForContactId: value === 'none' ? null : parseInt(value) })}
                        >
                          <SelectTrigger id="edit-alternate-for">
                            <SelectValue placeholder="Select who this person alternates for" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not specified</SelectItem>
                            {getAlternateForOptions(hostsWithContacts, editingContact.id).map((opt) => (
                              <SelectItem key={opt.id} value={opt.id.toString()}>
                                {opt.name} ({opt.hostName})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="edit-contact-phone">Phone *</Label>
                      <Input
                        id="edit-contact-phone"
                        value={editingContact.phone}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingContact({
                            ...editingContact,
                            phone: e.target.value,
                          });
                        }}
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit-contact-email">Email</Label>
                      <Input
                        id="edit-contact-email"
                        type="email"
                        value={editingContact.email || ''}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingContact({
                            ...editingContact,
                            email: e.target.value,
                          });
                        }}
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit-contact-address">Address</Label>
                      <Input
                        id="edit-contact-address"
                        value={editingContact.address || ''}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingContact({
                            ...editingContact,
                            address: e.target.value,
                          });
                        }}
                        placeholder="Enter contact address"
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit-contact-location">
                        Area/Location
                      </Label>
                      <Select
                        value={editingContact.hostLocation || ''}
                        onValueChange={(value) => {
                          setEditingContact({
                            ...editingContact,
                            hostLocation: value,
                          });
                        }}
                      >
                        <SelectTrigger id="edit-contact-location">
                          <SelectValue placeholder="Select an area..." />
                        </SelectTrigger>
                        <SelectContent>
                          {HOST_AREAS.map((area) => (
                            <SelectItem key={area} value={area}>
                              {area}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500 mt-1">
                        Used to group contacts by geographic area on the main
                        view
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="edit-contact-notes">Notes</Label>
                      <Textarea
                        id="edit-contact-notes"
                        value={editingContact.notes || ''}
                        onChange={(e) => {
                          e.stopPropagation();
                          setEditingContact({
                            ...editingContact,
                            notes: e.target.value,
                          });
                        }}
                        rows={3}
                      />
                    </div>

                    <div className="border-t pt-4">
                      <h3 className="font-medium text-sm text-slate-700 mb-3">
                        Contact Settings
                      </h3>
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="edit-contact-primary"
                            checked={editingContact.isPrimary || false}
                            onCheckedChange={(checked) => {
                              setEditingContact({
                                ...editingContact,
                                isPrimary: checked,
                              });
                            }}
                          />
                          <Label
                            htmlFor="edit-contact-primary"
                            className="text-sm"
                          >
                            Mark as Primary Contact
                            <span className="block text-xs text-slate-500">
                              Primary contacts are highlighted with a star icon
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="edit-contact-weekly-active"
                            checked={editingContact.weeklyActive || false}
                            onCheckedChange={(checked) => {
                              setEditingContact({
                                ...editingContact,
                                weeklyActive: checked,
                              });
                            }}
                          />
                          <Label
                            htmlFor="edit-contact-weekly-active"
                            className="text-sm"
                          >
                            Available This Week (Manual Override)
                            <span className="block text-xs text-slate-500">
                              Will be reset on next Monday at 1pm when availability is auto-updated
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="edit-contact-driver-agreement"
                            checked={editingContact.driverAgreementSigned || false}
                            onCheckedChange={(checked) => {
                              setEditingContact({
                                ...editingContact,
                                driverAgreementSigned: checked,
                              });
                            }}
                          />
                          <Label
                            htmlFor="edit-contact-driver-agreement"
                            className="text-sm"
                          >
                            Driver Agreement Signed
                            <span className="block text-xs text-slate-500">
                              Has this host signed the driver agreement form?
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="edit-contact-van-approved"
                            checked={editingContact.vanApproved || false}
                            onCheckedChange={(checked) => {
                              setEditingContact({
                                ...editingContact,
                                vanApproved: checked,
                              });
                            }}
                          />
                          <Label
                            htmlFor="edit-contact-van-approved"
                            className="text-sm"
                          >
                            Approved Van Driver
                            <span className="block text-xs text-slate-500">
                              Can be assigned to drive the van for events
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="edit-contact-volunteer"
                            checked={editingContact.isVolunteer || false}
                            onCheckedChange={(checked) =>
                              setEditingContact({ ...editingContact, isVolunteer: checked })
                            }
                          />
                          <Label htmlFor="edit-contact-volunteer" className="text-sm">
                            Also a Volunteer
                            <span className="block text-xs text-slate-500">
                              Lists this host in volunteer dropdowns so they can be assigned to events
                            </span>
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/*
                      Organization Status section. Intentionally separated
                      from the Contact Settings toggles above because this
                      isn't a flag — it's a distinct status. Uses the word
                      "Former" rather than "inactive" so it doesn't collide
                      with the location-level active/inactive (collection
                      log dropdown) or the weekly availability flag.
                    */}
                    <div className="border-t pt-4">
                      <h3 className="font-medium text-sm text-slate-700 mb-3">
                        Organization Status
                      </h3>
                      <RadioGroup
                        value={editingContact.isFormerHost ? 'former' : 'active'}
                        onValueChange={(value) => {
                          setEditingContact({
                            ...editingContact,
                            isFormerHost: value === 'former',
                          });
                        }}
                        className="space-y-2"
                      >
                        <div className="flex items-start space-x-2">
                          <RadioGroupItem value="active" id="edit-contact-status-active" className="mt-0.5" />
                          <Label htmlFor="edit-contact-status-active" className="text-sm cursor-pointer font-normal">
                            Active
                            <span className="block text-xs text-slate-500">
                              Currently part of TSP. Appears in active rosters and event assignments.
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-start space-x-2">
                          <RadioGroupItem value="former" id="edit-contact-status-former" className="mt-0.5" />
                          <Label htmlFor="edit-contact-status-former" className="text-sm cursor-pointer font-normal">
                            Former Host
                            <span className="block text-xs text-slate-500">
                              No longer with TSP (left, moved, etc.). Hidden from active views by default; record kept for reference.
                            </span>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingContact(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          !editingContact.name.trim() ||
                          !editingContact.phone.trim() ||
                          updateContactMutation.isPending
                        }
                      >
                        {updateContactMutation.isPending
                          ? 'Saving...'
                          : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        /* Original Location-based View */
        <Tabs value={activeLocationTab} onValueChange={setActiveLocationTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Active ({activeHosts.length})
            </TabsTrigger>
            <TabsTrigger value="inactive" className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Inactive ({inactiveHosts.length})
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Map
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-6">
            {activeHosts.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  No active hosts found
                </h3>
                <p className="text-slate-500">Add a new host to get started.</p>
              </div>
            ) : (
              <HostGrid hostList={activeHosts} />
            )}
          </TabsContent>

          <TabsContent value="inactive" className="mt-6">
            {inactiveHosts.length === 0 ? (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  No inactive hosts
                </h3>
                <p className="text-slate-500">
                  All host locations are currently active.
                </p>
              </div>
            ) : (
              <HostGrid hostList={inactiveHosts} />
            )}
          </TabsContent>

          <TabsContent value="map" className="mt-6">
            <Suspense fallback={
              <div className="text-center py-12">
                <RefreshCw className="w-8 h-8 text-slate-400 mx-auto mb-2 animate-spin" />
                <p className="text-slate-500">Loading map...</p>
              </div>
            }>
              <HostLocationsMap />
            </Suspense>
          </TabsContent>
        </Tabs>
      )}

      {/* Host Details Dialog */}
      <Dialog
        open={!!selectedHost}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHost(null);
          }
          // Remove automatic refresh on modal open to prevent form interference
        }}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Building2 className="w-5 h-5 mr-2" />
              {selectedHost?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedHost && (
            <Tabs defaultValue="contacts" className="w-full">
              <TabsList>
                <TabsTrigger value="contacts">Contacts</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">
                      Contacts for {selectedHost.name}
                    </h3>
                    <p className="text-sm text-slate-600">
                      Manage contact information for this host
                    </p>
                  </div>
                  <Dialog
                    open={isAddingContact}
                    onOpenChange={setIsAddingContact}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" disabled={!canEdit}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Contact
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add New Contact</DialogTitle>
                      </DialogHeader>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAddContact();
                        }}
                        className="space-y-4"
                      >
                        <div>
                          <Label htmlFor="contact-name">Name *</Label>
                          <Input
                            id="contact-name"
                            value={newContact.name}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewContact({
                                ...newContact,
                                name: e.target.value,
                              });
                            }}
                            placeholder="Enter contact name"
                          />
                        </div>
                        <div>
                          <Label htmlFor="contact-role">Role</Label>
                          <Select
                            value={newContact.role || ''}
                            onValueChange={(value) => {
                              setNewContact({
                                ...newContact,
                                role: value === 'none' ? '' : value,
                              });
                            }}
                          >
                            <SelectTrigger id="contact-role">
                              <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Role</SelectItem>
                              {CONTACT_ROLES.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="contact-phone">Phone</Label>
                          <Input
                            id="contact-phone"
                            value={newContact.phone}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewContact({
                                ...newContact,
                                phone: e.target.value,
                              });
                            }}
                            placeholder="Enter phone number"
                          />
                        </div>
                        <div>
                          <Label htmlFor="contact-email">Email</Label>
                          <Input
                            id="contact-email"
                            type="email"
                            value={newContact.email}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewContact({
                                ...newContact,
                                email: e.target.value,
                              });
                            }}
                            placeholder="Enter email address"
                          />
                        </div>
                        <div>
                          <Label htmlFor="contact-address">Address</Label>
                          <Input
                            id="contact-address"
                            value={newContact.address || ''}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewContact({
                                ...newContact,
                                address: e.target.value,
                              });
                            }}
                            placeholder="Enter contact address"
                          />
                        </div>
                        <div>
                          <Label htmlFor="contact-location">Area/Location</Label>
                          <Select
                            value={newContact.hostLocation || ''}
                            onValueChange={(value) => {
                              setNewContact({
                                ...newContact,
                                hostLocation: value,
                              });
                            }}
                          >
                            <SelectTrigger id="contact-location">
                              <SelectValue placeholder="Select an area..." />
                            </SelectTrigger>
                            <SelectContent>
                              {HOST_AREAS.map((area) => (
                                <SelectItem key={area} value={area}>
                                  {area}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-slate-500 mt-1">
                            Used to group contacts by geographic area on the main view
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="contact-primary"
                            checked={newContact.isPrimary}
                            onCheckedChange={(checked) =>
                              setNewContact({
                                ...newContact,
                                isPrimary: checked,
                              })
                            }
                          />
                          <Label htmlFor="contact-primary">
                            Primary Contact
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="contact-driver-agreement"
                            checked={newContact.driverAgreementSigned}
                            onCheckedChange={(checked) =>
                              setNewContact({
                                ...newContact,
                                driverAgreementSigned: checked,
                              })
                            }
                          />
                          <Label htmlFor="contact-driver-agreement">
                            Driver Agreement Signed
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="contact-van-approved"
                            checked={newContact.vanApproved || false}
                            onCheckedChange={(checked) =>
                              setNewContact({
                                ...newContact,
                                vanApproved: checked,
                              })
                            }
                          />
                          <Label htmlFor="contact-van-approved">
                            Approved Van Driver
                            <span className="block text-xs text-slate-500">
                              Can be assigned to drive the van for events
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="contact-volunteer"
                            checked={newContact.isVolunteer || false}
                            onCheckedChange={(checked) =>
                              setNewContact({ ...newContact, isVolunteer: checked })
                            }
                          />
                          <Label htmlFor="contact-volunteer" className="text-sm">
                            Also a Volunteer
                            <span className="block text-xs text-slate-500">
                              Lists this host in volunteer dropdowns so they can be assigned to events
                            </span>
                          </Label>
                        </div>
                        <div>
                          <Label htmlFor="contact-notes">Notes</Label>
                          <Textarea
                            id="contact-notes"
                            value={newContact.notes}
                            onChange={(e) => {
                              e.stopPropagation();
                              setNewContact({
                                ...newContact,
                                notes: e.target.value,
                              });
                            }}
                            placeholder="Additional notes"
                            rows={3}
                          />
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsAddingContact(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={
                              !newContact.name.trim() ||
                              createContactMutation.isPending
                            }
                          >
                            {createContactMutation.isPending
                              ? 'Adding...'
                              : 'Add Contact'}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sortContactsByPriority(selectedHost.contacts).map(
                    (contact) => (
                      <Card key={contact.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <h4 className="font-medium">{contact.name}</h4>
                                <div className="flex items-center space-x-1">
                                  {contact.role === 'lead' && (
                                    <Crown className="w-3 h-3 text-purple-600 fill-current" />
                                  )}
                                  {contact.isPrimary && (
                                    <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                  )}
                                </div>
                              </div>
                              {contact.role && (
                                <div className="text-sm text-slate-600">
                                  {roleLabel(contact.role)}
                                </div>
                              )}
                              <div className="flex items-center text-sm text-slate-600">
                                <Phone className="w-4 h-4 mr-2" />
                                {contact.phone}
                              </div>
                              {contact.email && (
                                <div className="flex items-center text-sm text-slate-600">
                                  <Mail className="w-4 h-4 mr-2" />
                                  {contact.email}
                                </div>
                              )}
                              {contact.address && (
                                <div className="flex items-start text-sm text-slate-600">
                                  <MapPin className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                                  <span>{contact.address}</span>
                                </div>
                              )}
                              {contact.notes && (
                                <p className="text-sm text-slate-600 mt-2">
                                  {contact.notes}
                                </p>
                              )}
                            </div>
                            <div className="flex space-x-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canEditContact(contact)}
                                onClick={async () => {
                                  logger.log(
                                    'Edit button clicked for contact:',
                                    contact.id,
                                    contact.name
                                  );

                                  // Force fresh data before editing to ensure contact IDs are correct
                                  await queryClient.refetchQueries({
                                    queryKey: ['/api/hosts-with-contacts'],
                                  });
                                  const freshHosts =
                                    queryClient.getQueryData([
                                      '/api/hosts-with-contacts',
                                    ]) as HostWithContacts[];
                                  const freshHost = freshHosts?.find(
                                    (h) => h.id === selectedHost?.id
                                  );
                                  const freshContact =
                                    freshHost?.contacts?.find(
                                      (c) => c.id === contact.id
                                    );

                                  logger.log(
                                    'Fresh contact found:',
                                    freshContact
                                  );

                                  if (freshContact) {
                                    setEditingContact(freshContact);
                                  } else {
                                    logger.error(
                                      'Could not find fresh contact data for ID:',
                                      contact.id,
                                      'Contact:',
                                      contact.name
                                    );
                                    setEditingContact(contact);
                                  }
                                }}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>

                              <Dialog
                                open={editingContact?.id === contact.id}
                                onOpenChange={(open) =>
                                  !open && setEditingContact(null)
                                }
                              >
                                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                                  <DialogHeader>
                                    <DialogTitle>Edit Contact</DialogTitle>
                                  </DialogHeader>
                                  {editingContact && (
                                    <div className="space-y-4">
                                      <form
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          handleUpdateContact();
                                        }}
                                        className="space-y-4"
                                      >
                                        <div>
                                          <Label htmlFor="edit-contact-name">
                                            Name *
                                          </Label>
                                          <Input
                                            id="edit-contact-name"
                                            value={editingContact.name}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setEditingContact({
                                                ...editingContact,
                                                name: e.target.value,
                                              });
                                            }}
                                          />
                                        </div>

                                        <div>
                                          <Label htmlFor="edit-contact-role">
                                            Role
                                          </Label>
                                          <Select
                                            value={editingContact.role || ''}
                                            onValueChange={(value) => {
                                              setEditingContact({
                                                ...editingContact,
                                                role: value === 'none' ? '' : value,
                                              });
                                            }}
                                          >
                                            <SelectTrigger id="edit-contact-role">
                                              <SelectValue placeholder="Select a role" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="none">No Role</SelectItem>
                                              {CONTACT_ROLES.map((role) => (
                                                <SelectItem key={role.value} value={role.value}>
                                                  {role.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div>
                                          <Label htmlFor="edit-contact-phone">
                                            Phone *
                                          </Label>
                                          <Input
                                            id="edit-contact-phone"
                                            value={editingContact.phone}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setEditingContact({
                                                ...editingContact,
                                                phone: e.target.value,
                                              });
                                            }}
                                          />
                                        </div>
                                        <div>
                                          <Label htmlFor="edit-contact-email">
                                            Email
                                          </Label>
                                          <Input
                                            id="edit-contact-email"
                                            type="email"
                                            value={editingContact.email || ''}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setEditingContact({
                                                ...editingContact,
                                                email: e.target.value,
                                              });
                                            }}
                                          />
                                        </div>

                                        <div>
                                          <Label htmlFor="edit-contact-address">
                                            Address
                                          </Label>
                                          <Input
                                            id="edit-contact-address"
                                            value={editingContact.address || ''}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setEditingContact({
                                                ...editingContact,
                                                address: e.target.value,
                                              });
                                            }}
                                            placeholder="Enter contact address"
                                          />
                                        </div>

                                        <div>
                                          <Label htmlFor="edit-contact-location">
                                            Area/Location
                                          </Label>
                                          <Select
                                            value={editingContact.hostLocation || ''}
                                            onValueChange={(value) => {
                                              setEditingContact({
                                                ...editingContact,
                                                hostLocation: value,
                                              });
                                            }}
                                          >
                                            <SelectTrigger id="edit-contact-location">
                                              <SelectValue placeholder="Select an area..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {HOST_AREAS.map((area) => (
                                                <SelectItem key={area} value={area}>
                                                  {area}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                          <p className="text-xs text-slate-500 mt-1">
                                            Used to group contacts by geographic area on the main view
                                          </p>
                                        </div>

                                        <div>
                                          <Label htmlFor="edit-contact-notes">
                                            Notes
                                          </Label>
                                          <Textarea
                                            id="edit-contact-notes"
                                            value={editingContact.notes || ''}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setEditingContact({
                                                ...editingContact,
                                                notes: e.target.value,
                                              });
                                            }}
                                            rows={3}
                                          />
                                        </div>

                                        {/* Change Role & Assignment Section */}
                                        <div className="border-t pt-4">
                                          <h3 className="font-medium text-sm text-slate-700 mb-3">
                                            Contact Settings
                                          </h3>
                                          <div className="space-y-3">
                                            <div className="flex items-center space-x-2">
                                              <Switch
                                                id="edit-contact-primary-hosts"
                                                checked={editingContact.isPrimary || false}
                                                onCheckedChange={(checked) => {
                                                  setEditingContact({
                                                    ...editingContact,
                                                    isPrimary: checked,
                                                  });
                                                }}
                                              />
                                              <Label
                                                htmlFor="edit-contact-primary-hosts"
                                                className="text-sm"
                                              >
                                                Mark as Primary Contact
                                                <span className="block text-xs text-slate-500">
                                                  Primary contacts are highlighted with a
                                                  star in the main view
                                                </span>
                                              </Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                              <Switch
                                                id="edit-contact-driver-agreement-hosts"
                                                checked={editingContact.driverAgreementSigned || false}
                                                onCheckedChange={(checked) => {
                                                  setEditingContact({
                                                    ...editingContact,
                                                    driverAgreementSigned: checked,
                                                  });
                                                }}
                                              />
                                              <Label
                                                htmlFor="edit-contact-driver-agreement-hosts"
                                                className="text-sm"
                                              >
                                                Driver Agreement Signed
                                                <span className="block text-xs text-slate-500">
                                                  Has this host signed the driver agreement form?
                                                </span>
                                              </Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                              <Switch
                                                id="edit-contact-van-approved-hosts"
                                                checked={editingContact.vanApproved || false}
                                                onCheckedChange={(checked) => {
                                                  setEditingContact({
                                                    ...editingContact,
                                                    vanApproved: checked,
                                                  });
                                                }}
                                              />
                                              <Label
                                                htmlFor="edit-contact-van-approved-hosts"
                                                className="text-sm"
                                              >
                                                Approved Van Driver
                                                <span className="block text-xs text-slate-500">
                                                  Can be assigned to drive the van for events
                                                </span>
                                              </Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                              <Switch
                                                id="edit-contact-volunteer-hosts"
                                                checked={editingContact.isVolunteer || false}
                                                onCheckedChange={(checked) =>
                                                  setEditingContact({ ...editingContact, isVolunteer: checked })
                                                }
                                              />
                                              <Label htmlFor="edit-contact-volunteer-hosts" className="text-sm">
                                                Also a Volunteer
                                                <span className="block text-xs text-slate-500">
                                                  Lists this host in volunteer dropdowns so they can be assigned to events
                                                </span>
                                              </Label>
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex justify-end space-x-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                              setEditingContact(null)
                                            }
                                          >
                                            Cancel
                                          </Button>
                                          <Button
                                            type="submit"
                                            disabled={
                                              !editingContact.name.trim() ||
                                              !editingContact.phone.trim() ||
                                              updateContactMutation.isPending
                                            }
                                          >
                                            {updateContactMutation.isPending
                                              ? 'Saving...'
                                              : 'Save Changes'}
                                          </Button>
                                        </div>
                                      </form>
                                    </div>
                                  )}
                                </DialogContent>
                              </Dialog>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canEdit}
                                onClick={() => handleDeleteContact(contact.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  )}

                  {selectedHost.contacts.length === 0 && (
                    <div className="text-center py-8">
                      <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-600">
                        No contacts found for this host.
                      </p>
                      <p className="text-sm text-slate-500">
                        Add a contact to get started.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-700">
                      Host Name
                    </Label>
                    <p className="text-slate-900">{selectedHost.name}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">
                      Status
                    </Label>
                    {canEdit ? (
                      <Select
                        value={selectedHost.status}
                        onValueChange={(newStatus) => {
                          if (newStatus === selectedHost.status) return;
                          updateHostMutation.mutate({
                            id: selectedHost.id,
                            updates: { status: newStatus },
                          });
                        }}
                        disabled={updateHostMutation.isPending}
                      >
                        <SelectTrigger className="h-8 w-36 mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant={
                          selectedHost.status === 'active'
                            ? 'default'
                            : 'secondary'
                        }
                        className={
                          selectedHost.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }
                      >
                        {selectedHost.status}
                      </Badge>
                    )}
                  </div>
                  {selectedHost.notes && (
                    <div className="col-span-2">
                      <Label className="text-sm font-medium text-slate-700">
                        Notes
                      </Label>
                      <p className="text-slate-900">{selectedHost.notes}</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
