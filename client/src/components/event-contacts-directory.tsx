import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Search, Users, Filter, Building, Phone, Mail, Calendar, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import type { EventContact } from '@shared/schema';

import { usePageSession } from '@/hooks/usePageSession';
// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  corp: 'Corporate',
  small_medium_corp: 'Small/Medium Corp',
  large_corp: 'Large Corp',
  church_faith: 'Church/Faith',
  religious: 'Religious',
  nonprofit: 'Nonprofit',
  government: 'Government',
  hospital: 'Hospital',
  political: 'Political',
  school: 'School',
  neighborhood: 'Neighborhood',
  club: 'Club',
  greek_life: 'Greek Life',
  cultural: 'Cultural',
  other: 'Other',
};

// Role badge colors
const roleColors: Record<string, string> = {
  primary: 'bg-blue-100 text-blue-700 border-blue-200',
  backup: 'bg-purple-100 text-purple-700 border-purple-200',
  tsp: 'bg-green-100 text-green-700 border-green-200',
};

// Compact contact card component
function CompactContactCard({ contact, onClick }: { contact: EventContact; onClick: () => void }) {
  return (
    <div
      className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
      onClick={onClick}
    >
      {/* Name and roles */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900 truncate">
            {contact.fullName || 'Unknown Contact'}
          </span>
          <div className="flex gap-1 flex-shrink-0">
            {contact.contactRoles.map((role) => (
              <Badge
                key={role}
                variant="outline"
                className={`text-[10px] px-1.5 py-0 capitalize ${roleColors[role] || ''}`}
              >
                {role === 'tsp' ? 'TSP' : role.charAt(0).toUpperCase()}
              </Badge>
            ))}
          </div>
        </div>

        {/* Contact info and org on one line */}
        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
          {contact.email && (
            <span className="flex items-center gap-1 truncate max-w-[140px]">
              <Mail className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{contact.email}</span>
            </span>
          )}
          {contact.phone && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <Phone className="w-3 h-3" />
              {contact.phone}
            </span>
          )}
          {contact.organizations.length > 0 && (
            <span className="flex items-center gap-1 truncate">
              <Building className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {contact.organizations[0]}
                {contact.organizations.length > 1 && ` +${contact.organizations.length - 1}`}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Event count and status */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Calendar className="w-3 h-3" />
          <span className="font-medium">{contact.totalEvents}</span>
        </div>
        {contact.hasOnlyIncompleteEvents && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
            Active
          </Badge>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
    </div>
  );
}

export default function EventContactsDirectory() {
  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'Event Contacts',
  });

  const [, setLocation] = useLocation();

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [organizationFilter, setOrganizationFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch contacts
  const { data: contacts = [], isLoading } = useQuery<EventContact[]>({
    queryKey: ['/api/event-contacts'],
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Get unique organizations for filter dropdown
  const uniqueOrganizations = useMemo(() => {
    const orgs = new Set<string>();
    contacts.forEach(contact => {
      contact.organizations.forEach(org => orgs.add(org));
    });
    return Array.from(orgs).sort();
  }, [contacts]);

  // Get unique categories for filter dropdown
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    contacts.forEach(contact => {
      if (contact.organizationCategories) {
        contact.organizationCategories.forEach(cat => cats.add(cat));
      }
    });
    return Array.from(cats).sort();
  }, [contacts]);

  // Filtered and sorted contacts
  const filteredContacts = useMemo(() => {
    let filtered = contacts;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        contact =>
          contact.fullName.toLowerCase().includes(term) ||
          contact.email?.toLowerCase().includes(term) ||
          contact.phone?.includes(term) ||
          contact.organizations.some(org => org.toLowerCase().includes(term))
      );
    }

    // Role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(contact =>
        contact.contactRoles.includes(roleFilter as 'primary' | 'backup' | 'tsp')
      );
    }

    // Status filter (has completed events or not)
    if (statusFilter === 'completed') {
      filtered = filtered.filter(contact => contact.completedEvents > 0);
    } else if (statusFilter === 'in-progress') {
      filtered = filtered.filter(contact => contact.hasOnlyIncompleteEvents);
    }

    // Organization filter
    if (organizationFilter !== 'all') {
      filtered = filtered.filter(contact =>
        contact.organizations.includes(organizationFilter)
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(contact =>
        contact.organizationCategories?.includes(categoryFilter)
      );
    }

    // Sort alphabetically by full name
    filtered = [...filtered].sort((a, b) =>
      (a.fullName || '').localeCompare(b.fullName || '')
    );

    return filtered;
  }, [contacts, searchTerm, roleFilter, statusFilter, organizationFilter, categoryFilter]);

  // Count active filters
  const activeFilterCount = [
    roleFilter !== 'all',
    statusFilter !== 'all',
    organizationFilter !== 'all',
    categoryFilter !== 'all',
  ].filter(Boolean).length;

  const handleContactClick = (contact: EventContact) => {
    // Navigate to contact detail page
    setLocation(`/event-contact/${encodeURIComponent(contact.id)}`);
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-slate-500">Loading event contacts...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="text-blue-500 w-5 h-5" />
              Event Contacts Directory
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-teal-600 hover:text-teal-800 transition-colors">
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold mb-1">Event Contacts Help</p>
                  <p className="text-sm">
                    A directory of all contacts from group events. Each contact appears once,
                    with a summary of all events they've been involved in. Click a contact to
                    see their full event history.
                  </p>
                </TooltipContent>
              </Tooltip>
            </h1>
            <span className="text-sm text-slate-500">
              {filteredContacts.length} of {contacts.length} contacts
            </span>
          </div>

          {/* Search and Filters */}
          <div className="px-4 py-3 space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              {/* Search Input */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Search by name, email, phone, or organization..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>

              {/* Filter Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2"
              >
                <Filter className="w-4 h-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </div>

            {/* Filter Dropdowns */}
            {showFilters && (
              <div className="space-y-3 pt-3 border-t border-slate-200">
                <div className="flex flex-wrap gap-3">
                  {/* Category Filter */}
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="filter-category" className="text-xs font-medium text-slate-600">
                      Category
                    </Label>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger id="filter-category" className="w-[160px] h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {uniqueCategories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {CATEGORY_LABELS[cat] || cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Role Filter */}
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="filter-role" className="text-xs font-medium text-slate-600">
                      Contact Role
                    </Label>
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
                      <SelectTrigger id="filter-role" className="w-[140px] h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="primary">Primary</SelectItem>
                        <SelectItem value="backup">Backup</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status Filter */}
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="filter-status" className="text-xs font-medium text-slate-600">
                      Event Status
                    </Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger id="filter-status" className="w-[160px] h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Contacts</SelectItem>
                        <SelectItem value="completed">Has Completed</SelectItem>
                        <SelectItem value="in-progress">Only In-Progress</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Organization Filter */}
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="filter-organization" className="text-xs font-medium text-slate-600">
                      Organization
                    </Label>
                    <Select value={organizationFilter} onValueChange={setOrganizationFilter}>
                      <SelectTrigger id="filter-organization" className="w-[180px] h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Organizations</SelectItem>
                        {uniqueOrganizations.map((org) => (
                          <SelectItem key={org} value={org}>
                            {org}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Clear Filters */}
                  {activeFilterCount > 0 && (
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRoleFilter('all');
                          setStatusFilter('all');
                          setOrganizationFilter('all');
                          setCategoryFilter('all');
                        }}
                        className="text-slate-500 hover:text-slate-700 h-8"
                      >
                        Clear filters
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contacts List - Compact Layout */}
        <div className="space-y-2">
          {filteredContacts.map((contact) => (
            <CompactContactCard
              key={contact.id}
              contact={contact}
              onClick={() => handleContactClick(contact)}
            />
          ))}

          {filteredContacts.length === 0 && contacts.length > 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-lg border border-slate-200">
              <Building className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p>No contacts match your current filters.</p>
              <p className="text-sm mt-1">Try adjusting your search or filter criteria.</p>
            </div>
          )}

          {contacts.length === 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-lg border border-slate-200">
              <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p>No event contacts found.</p>
              <p className="text-sm mt-1">Contacts will appear here once events are created.</p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
