import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Upload,
  Search,
  Filter,
  Download,
  HelpCircle,
  CalendarDays,
  List,
  Grid3x3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  RecipientForm,
  RecipientTable,
  RecipientDetailDrawer,
  RecipientWeeklyCalendar,
  RecipientScheduleMatrix,
  RecipientDirectoryList,
} from './recipients';
import {
  WEEK_DAYS,
  DELIVERY_CADENCE_OPTIONS,
  getRecipientCollectionDays,
  getRecipientFeedingDays,
  sortRecipients,
  type SortColumn,
  type SortDirection,
} from './recipients/recipient-schedule-utils';
import { useRecipientForm } from '@/hooks/useRecipientForm';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useResourcePermissions } from '@/hooks/useResourcePermissions';
import { usePageSession } from '@/hooks/usePageSession';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRegionFromCoordinates } from '@/lib/atlanta-regions';
import { normalizeFocusArea } from '@/lib/focus-area-groups';
import type { Recipient } from '@shared/schema';
import { logger } from '@/lib/logger';

export default function RecipientsManagement({ highlightRecipientId }: { highlightRecipientId?: number } = {}) {
  const { toast } = useToast();
  const { canEdit } = useResourcePermissions('RECIPIENTS');

  // Track page session for activity logging
  usePageSession({
    section: 'Directory',
    page: 'Recipients Management',
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [contractFilter, setContractFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [tspContactFilter, setTspContactFilter] = useState<string>('all');
  const [sandwichTypeFilter, setSandwichTypeFilter] = useState<string>('all');
  const [focusAreaFilter, setFocusAreaFilter] = useState<string>('all');
  const [collectionDayFilter, setCollectionDayFilter] = useState<string>('all');
  const [feedingDayFilter, setFeedingDayFilter] = useState<string>('all');
  const [cadenceFilter, setCadenceFilter] = useState<string>('all');
  const [servingFrequencyFilter, setServingFrequencyFilter] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showFilters, setShowFilters] = useState(false);
  // The plain directory list is the default view. The schedule-focused
  // views (detailed table, calendar, matrix) live under "Detailed views".
  const [topView, setTopView] = useState<'list' | 'detailed'>('list');
  const [viewMode, setViewMode] = useState<'table' | 'calendar' | 'matrix'>('table');
  const [inlineSavingId, setInlineSavingId] = useState<number | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);

  // Highlight state for search-driven navigation
  const [highlightedId, setHighlightedId] = useState<number | undefined>(highlightRecipientId);
  const highlightRowRef = useRef<HTMLTableRowElement>(null);

  // When highlightRecipientId changes (from URL param), reset filters so the card is visible
  useEffect(() => {
    if (highlightRecipientId) {
      setHighlightedId(highlightRecipientId);
      setSearchTerm('');
      setStatusFilter('all');
      setContractFilter('all');
      setRegionFilter('all');
      setTspContactFilter('all');
      setSandwichTypeFilter('all');
      setFocusAreaFilter('all');
      setCollectionDayFilter('all');
      setFeedingDayFilter('all');
      setCadenceFilter('all');
      setServingFrequencyFilter('all');
    }
  }, [highlightRecipientId]);

  // Form state hooks for add and edit modes
  const addForm = useRecipientForm({ initialData: null, mode: 'add' });
  const editForm = useRecipientForm({ initialData: editingRecipient, mode: 'edit' });

  // Sync edit form when editingRecipient changes
  useEffect(() => {
    if (editingRecipient) {
      editForm.setRecipient(editingRecipient);
    }
  }, [editingRecipient, editForm.setRecipient]);

  const { data: recipients = [], isLoading } = useQuery<Recipient[]>({
    queryKey: ['/api/recipients'],
    staleTime: 5 * 60 * 1000,
  });

  // Filtered and searched recipients
  const filteredRecipients = useMemo(() => {
    let filtered = recipients;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (recipient) =>
          recipient.name?.toLowerCase().includes(term) ||
          recipient.email?.toLowerCase().includes(term) ||
          recipient.phone?.toLowerCase().includes(term) ||
          recipient.address?.toLowerCase().includes(term) ||
          getRegionFromCoordinates(recipient.latitude, recipient.longitude).toLowerCase().includes(term) ||
          recipient.contactPersonName?.toLowerCase().includes(term) ||
          recipient.contactPersonEmail?.toLowerCase().includes(term) ||
          (recipient as any).secondContactPersonName?.toLowerCase().includes(term) ||
          (recipient as any).secondContactPersonEmail?.toLowerCase().includes(term) ||
          recipient.reportingGroup?.toLowerCase().includes(term) ||
          (() => {
            const areas = Array.isArray((recipient as any).focusAreas)
              ? (recipient as any).focusAreas
              : (recipient as any).focusArea ? [(recipient as any).focusArea] : [];
            return areas.some((area: string) => area.toLowerCase().includes(term));
          })() ||
          (recipient as any).instagramHandle?.toLowerCase().includes(term)
      );
    }

    if (statusFilter === 'active' && !showInactive) {
      filtered = filtered.filter((recipient) => recipient.status === 'active');
    } else if (statusFilter === 'active' && showInactive) {
      filtered = filtered.filter(
        (recipient) => recipient.status === 'active' || recipient.status === 'inactive'
      );
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter((recipient) => recipient.status === statusFilter);
    }

    if (contractFilter === 'signed') {
      filtered = filtered.filter((recipient) => recipient.contractSigned === true);
    } else if (contractFilter === 'unsigned') {
      filtered = filtered.filter((recipient) => !recipient.contractSigned);
    }

    if (regionFilter !== 'all') {
      filtered = filtered.filter((recipient) => {
        const derivedRegion = recipient.latitude && recipient.longitude
          ? getRegionFromCoordinates(recipient.latitude, recipient.longitude)
          : 'Not geocoded';
        return derivedRegion === regionFilter;
      });
    }

    if (tspContactFilter !== 'all') {
      filtered = filtered.filter(
        (recipient) =>
          recipient.tspContact &&
          recipient.tspContact.toLowerCase().includes(tspContactFilter.toLowerCase())
      );
    }

    if (sandwichTypeFilter !== 'all') {
      filtered = filtered.filter((recipient) => recipient.sandwichType === sandwichTypeFilter);
    }

    if (focusAreaFilter !== 'all') {
      filtered = filtered.filter((recipient) => {
        const areas = Array.isArray((recipient as any).focusAreas)
          ? (recipient as any).focusAreas
          : (recipient as any).focusArea ? [(recipient as any).focusArea] : [];
        return areas.some((a: string) => normalizeFocusArea(a) === focusAreaFilter);
      });
    }

    if (collectionDayFilter !== 'all') {
      filtered = filtered.filter((recipient) =>
        getRecipientCollectionDays(recipient).includes(collectionDayFilter)
      );
    }

    if (feedingDayFilter !== 'all') {
      filtered = filtered.filter((recipient) =>
        getRecipientFeedingDays(recipient).includes(feedingDayFilter)
      );
    }

    if (cadenceFilter !== 'all') {
      filtered = filtered.filter((recipient) => {
        const c = (recipient as Recipient & { deliveryCadence?: string | null }).deliveryCadence;
        if (cadenceFilter === 'none') return !c;
        return c === cadenceFilter;
      });
    }

    if (servingFrequencyFilter !== 'all') {
      filtered = filtered.filter((recipient) => {
        const f = (recipient as Recipient & { peopleServedFrequency?: string | null })
          .peopleServedFrequency;
        if (servingFrequencyFilter === 'none') return !f;
        return f === servingFrequencyFilter;
      });
    }

    return sortRecipients(filtered, sortColumn, sortDirection);
  }, [recipients, searchTerm, statusFilter, showInactive, contractFilter, regionFilter, tspContactFilter, sandwichTypeFilter, focusAreaFilter, collectionDayFilter, feedingDayFilter, cadenceFilter, servingFrequencyFilter, sortColumn, sortDirection]);

  // The directory list has no sortable headers, so it's always A–Z by name
  // regardless of the sort chosen in the detailed table.
  const listRecipients = useMemo(
    () => sortRecipients(filteredRecipients, 'name', 'asc'),
    [filteredRecipients]
  );

  // Scroll to highlighted card once data is loaded and rendered
  useEffect(() => {
    if (highlightedId && highlightRowRef.current) {
      const timer = setTimeout(() => {
        highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [highlightedId, filteredRecipients]);

  // Auto-clear highlight after animation
  useEffect(() => {
    if (highlightedId) {
      const timer = setTimeout(() => {
        setHighlightedId(undefined);
        // Clean up URL param
        const url = new URL(window.location.href);
        url.searchParams.delete('highlight');
        window.history.replaceState({}, '', url.toString());
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightedId]);

  const inactiveCount = useMemo(
    () => recipients.filter((r) => r.status === 'inactive').length,
    [recipients]
  );

  const activeCount = useMemo(
    () => recipients.filter((r) => r.status === 'active').length,
    [recipients]
  );

  // Get unique values for filter dropdowns (derived from geocoded coords only; no manual region)
  const uniqueRegions = useMemo(() => {
    const regions = recipients.map((r) =>
      r.latitude && r.longitude
        ? getRegionFromCoordinates(r.latitude, r.longitude)
        : 'Not geocoded'
    );
    return [...new Set(regions)].sort();
  }, [recipients]);

  const uniqueTspContacts = useMemo(() => {
    const allContacts = recipients
      .map((r) => r.tspContact)
      .filter((contact): contact is string => Boolean(contact))
      .flatMap((contact) => contact.split(/[/&,]|and/i).map((c) => c.trim()))
      .filter((contact) => contact.length > 0);
    return [...new Set(allContacts)].sort();
  }, [recipients]);

  const uniqueSandwichTypes = useMemo(() => {
    const types = recipients.map((r) => r.sandwichType).filter(Boolean);
    return [...new Set(types)].sort();
  }, [recipients]);

  const uniqueFocusAreas = useMemo(() => {
    const allAreas = recipients.flatMap((r) => {
      if (Array.isArray((r as any).focusAreas) && (r as any).focusAreas.length > 0) {
        return (r as any).focusAreas;
      } else if ((r as any).focusArea) {
        return [(r as any).focusArea];
      }
      return [];
    });
    const canonical = allAreas.map((a) => normalizeFocusArea(a)).filter(Boolean);
    return [...new Set(canonical)].sort();
  }, [recipients]);

  // Mutations
  const createRecipientMutation = useMutation({
    mutationFn: (recipient: any) => {
      logger.log('[CREATE RECIPIENT] Sending data:', recipient);
      return apiRequest('POST', '/api/recipients', recipient);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recipients/map'] }); // Invalidate map data too
      setIsAddModalOpen(false);
      addForm.resetForm();
      
      // Show geocoding status if address was provided
      if (variables.address) {
        toast({ 
          title: 'Recipient added successfully',
          description: 'Geocoding is in progress. The recipient will appear on the Driver Planning map once coordinates are ready (usually within a few seconds).',
          duration: 6000,
        });
      } else {
        toast({ title: 'Success', description: 'Recipient added successfully' });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add recipient', variant: 'destructive' });
    },
  });

  const updateRecipientMutation = useMutation({
    mutationFn: ({ id, ...updates }: any) => apiRequest('PUT', `/api/recipients/${id}`, updates),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recipients/map'] }); // Invalidate map data too
      setEditingRecipient(null);
      
      // Show geocoding status if address was changed
      if (variables.address) {
        toast({ 
          title: 'Recipient updated successfully',
          description: 'If the address changed, geocoding is in progress. The recipient location will update on the Driver Planning map once coordinates are ready (usually within a few seconds).',
          duration: 6000,
        });
      } else {
        toast({ title: 'Success', description: 'Recipient updated successfully' });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update recipient', variant: 'destructive' });
    },
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, ...updates }: any) => apiRequest('PUT', `/api/recipients/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recipients/map'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save change', variant: 'destructive' });
    },
    onSettled: () => {
      setInlineSavingId(null);
    },
  });

  const deleteRecipientMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/recipients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipients'] });
      toast({ title: 'Success', description: 'Recipient deleted successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete recipient', variant: 'destructive' });
    },
  });

  const importRecipientsMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/recipients/import', { method: 'POST', body: formData }).then((res) => res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipients'] });
      setImportResults(data);
      setImportFile(null);
      toast({ title: 'Import Complete', description: `Successfully imported ${data.imported} recipients` });
    },
    onError: () => {
      toast({ title: 'Import Error', description: 'Failed to import recipients', variant: 'destructive' });
    },
  });

  // Event handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { valid, errors } = addForm.validate();
    if (!valid) {
      toast({ title: 'Validation Error', description: errors[0], variant: 'destructive' });
      return;
    }
    createRecipientMutation.mutate(addForm.prepareSubmissionData());
  };

  const handleEdit = (recipient: Recipient) => {
    setEditingRecipient(recipient);
    editForm.setRecipient(recipient);
  };

  const handleUpdate = () => {
    if (!editingRecipient) return;
    const submissionData = editForm.prepareSubmissionData();
    updateRecipientMutation.mutate({ id: editingRecipient.id, ...submissionData });
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this recipient?')) {
      deleteRecipientMutation.mutate(id);
    }
  };

  const handleToggleStatus = (recipient: Recipient) => {
    const newStatus = recipient.status === 'active' ? 'inactive' : 'active';
    updateRecipientMutation.mutate({ ...recipient, status: newStatus });
  };

  const handleInlineUpdate = (recipient: Recipient, updates: Partial<Recipient>) => {
    if (!canEdit) return;
    setInlineSavingId(recipient.id);
    inlineUpdateMutation.mutate({ ...recipient, ...updates, id: recipient.id });
  };

  const handleOpenDrawer = (recipient: Recipient) => {
    setSelectedRecipient(recipient);
    setDrawerOpen(true);
  };

  const handleSortColumn = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResults(null);
    }
  };

  const handleImport = () => {
    if (importFile) {
      importRecipientsMutation.mutate(importFile);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/recipients/export-csv', { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recipients-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: 'Export completed successfully', description: `Exported ${filteredRecipients.length} recipients to CSV` });
    } catch {
      toast({ title: 'Export failed', description: 'Failed to export recipients data', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading recipients...</div>;
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="text-blue-500 w-6 h-6" />
              Recipients Management
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-teal-600 hover:text-teal-800 transition-colors">
                    <HelpCircle className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold mb-1">Recipients Management Help</p>
                  <p className="text-sm">Manage individuals and organizations who receive sandwiches. Track contact information, delivery addresses, and special requirements.</p>
                </TooltipContent>
              </Tooltip>
            </h1>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExport} className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
              <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Import CSV/XLSX
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby="import-recipients-description">
                  <DialogHeader>
                    <DialogTitle>Import Recipients from CSV/XLSX</DialogTitle>
                  </DialogHeader>
                  <p id="import-recipients-description" className="text-sm text-slate-600 mb-4">
                    Upload a CSV or Excel file with recipient data. Required columns: name, phone. Optional: email, address, preferences, status.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="file-upload">Select File</Label>
                      <Input id="file-upload" type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="mt-1" />
                      {importFile && <p className="text-sm text-green-600 mt-2">Selected: {importFile.name}</p>}
                    </div>
                    {importResults && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 className="font-medium text-green-800">Import Results</h4>
                        <p className="text-sm text-green-700 mt-1">
                          Successfully imported {importResults.imported} recipients
                          {importResults.skipped > 0 && `, skipped ${importResults.skipped} duplicates`}
                        </p>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportResults(null); }}>
                        Cancel
                      </Button>
                      <Button onClick={handleImport} disabled={!importFile || importRecipientsMutation.isPending}>
                        {importRecipientsMutation.isPending ? 'Importing...' : 'Import'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!canEdit} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Add Recipient
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby="add-recipient-description" className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader className="flex-shrink-0">
                    <DialogTitle>Add New Recipient</DialogTitle>
                  </DialogHeader>
                  <div className="overflow-y-auto flex-grow pr-1">
                    <p id="add-recipient-description" className="text-sm text-slate-600 mb-4">
                      Add a new recipient to the system for sandwich deliveries.
                    </p>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <RecipientForm
                        formData={addForm.formData}
                        sections={addForm.sections}
                        onFieldChange={addForm.updateField}
                        onSectionChange={addForm.updateSection}
                        mode="add"
                      />
                      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t bg-white sticky bottom-0">
                        <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={createRecipientMutation.isPending}>
                          {createRecipientMutation.isPending ? 'Adding...' : 'Add Recipient'}
                        </Button>
                      </div>
                    </form>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="space-y-3 p-4 bg-slate-50 rounded-lg border">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search recipients by name, email, phone, address, region..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters
              {(statusFilter !== 'all' || contractFilter !== 'all' || regionFilter !== 'all' || tspContactFilter !== 'all' || sandwichTypeFilter !== 'all' || focusAreaFilter !== 'all' || collectionDayFilter !== 'all' || feedingDayFilter !== 'all') && (
                <Badge variant="secondary" className="ml-1">
                  {[statusFilter !== 'all', contractFilter !== 'all', regionFilter !== 'all', tspContactFilter !== 'all', sandwichTypeFilter !== 'all', focusAreaFilter !== 'all', collectionDayFilter !== 'all', feedingDayFilter !== 'all'].filter(Boolean).length}
                </Badge>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-status" className="text-xs font-medium text-slate-600">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger id="filter-status" className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active Only</SelectItem>
                      <SelectItem value="inactive">Inactive Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-contract" className="text-xs font-medium text-slate-600">Contract</Label>
                  <Select value={contractFilter} onValueChange={setContractFilter}>
                    <SelectTrigger id="filter-contract" className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="signed">Signed</SelectItem>
                      <SelectItem value="unsigned">Unsigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-region" className="text-xs font-medium text-slate-600">Region</Label>
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger id="filter-region" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Regions</SelectItem>
                      {uniqueRegions.map((region) => (
                        <SelectItem key={region} value={region as string}>{region}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-tsp-contact" className="text-xs font-medium text-slate-600">TSP Contact</Label>
                  <Select value={tspContactFilter} onValueChange={setTspContactFilter}>
                    <SelectTrigger id="filter-tsp-contact" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Contacts</SelectItem>
                      {uniqueTspContacts.map((contact) => (
                        <SelectItem key={contact} value={contact as string}>{contact}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-sandwich-type" className="text-xs font-medium text-slate-600">Sandwich Type</Label>
                  <Select value={sandwichTypeFilter} onValueChange={setSandwichTypeFilter}>
                    <SelectTrigger id="filter-sandwich-type" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {uniqueSandwichTypes.map((type) => (
                        <SelectItem key={type} value={type as string}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-focus-area" className="text-xs font-medium text-slate-600">Focus Area</Label>
                  <Select value={focusAreaFilter} onValueChange={setFocusAreaFilter}>
                    <SelectTrigger id="filter-focus-area" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Areas</SelectItem>
                      {uniqueFocusAreas.map((area) => (
                        <SelectItem key={area} value={area as string}>{area}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-collection-day" className="text-xs font-medium text-slate-600">Collection Day</Label>
                  <Select value={collectionDayFilter} onValueChange={setCollectionDayFilter}>
                    <SelectTrigger id="filter-collection-day" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Day</SelectItem>
                      {WEEK_DAYS.map((day) => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-feeding-day" className="text-xs font-medium text-slate-600">Feeding Day</Label>
                  <Select value={feedingDayFilter} onValueChange={setFeedingDayFilter}>
                    <SelectTrigger id="filter-feeding-day" className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Day</SelectItem>
                      {WEEK_DAYS.map((day) => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-cadence" className="text-xs font-medium text-slate-600">Cadence</Label>
                  <Select value={cadenceFilter} onValueChange={setCadenceFilter}>
                    <SelectTrigger id="filter-cadence" className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any cadence</SelectItem>
                      {DELIVERY_CADENCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="none">— Not categorized</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <Label htmlFor="filter-serving-frequency" className="text-xs font-medium text-slate-600">
                    Serving frequency
                  </Label>
                  <Select value={servingFrequencyFilter} onValueChange={setServingFrequencyFilter}>
                    <SelectTrigger id="filter-serving-frequency" className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any frequency</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="none">— Not set</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>

        <Tabs value={topView} onValueChange={(v) => setTopView(v as 'list' | 'detailed')}>
          <TabsList>
            <TabsTrigger value="list" data-testid="tab-recipients-list">
              Directory
            </TabsTrigger>
            <TabsTrigger value="detailed" data-testid="tab-recipients-detailed">
              Detailed views
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Results Count + View Switcher */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap text-sm text-slate-600">
            <span>
              Showing {filteredRecipients.length} of {recipients.length} recipients
              {activeCount > 0 && ` (${activeCount} active`}
              {inactiveCount > 0 && `, ${inactiveCount} inactive`}
              {(activeCount > 0 || inactiveCount > 0) && ')'}
            </span>
            {inactiveCount > 0 && statusFilter !== 'inactive' && (
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                <Checkbox
                  id="show-inactive"
                  checked={showInactive}
                  onCheckedChange={(checked) => setShowInactive(checked === true)}
                />
                <span className="text-sm">Show inactive</span>
              </label>
            )}
          </div>
          {topView === 'detailed' && (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                aria-label="Table view"
                className={`px-2 py-1 rounded ${viewMode === 'table' ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                aria-pressed={viewMode === 'calendar'}
                aria-label="Calendar view"
                className={`px-2 py-1 rounded ${viewMode === 'calendar' ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <CalendarDays className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                aria-pressed={viewMode === 'matrix'}
                aria-label="Schedule matrix view"
                title="Schedule matrix — orgs as rows, days as columns"
                className={`px-2 py-1 rounded ${viewMode === 'matrix' ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
            </div>
          </div>
          )}
        </div>

        {filteredRecipients.length === 0 && (topView === 'list' || viewMode === 'table') ? (
          <div className="text-center py-12 text-slate-500 rounded-lg border border-dashed border-slate-300 bg-slate-50">
            {recipients.length > 0
              ? 'No recipients match your current filters. Try adjusting your search or filter criteria.'
              : 'No recipients found. Add a new recipient to get started.'}
          </div>
        ) : topView === 'list' ? (
          <RecipientDirectoryList
            recipients={listRecipients}
            onRowClick={handleOpenDrawer}
            highlightedId={highlightedId}
            highlightRowRef={highlightRowRef}
          />
        ) : viewMode === 'table' ? (
          <RecipientTable
            recipients={filteredRecipients}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSortColumn}
            onRowClick={handleOpenDrawer}
            highlightedId={highlightedId}
            highlightRowRef={highlightRowRef}
            canEdit={canEdit}
            savingId={inlineSavingId}
            onUpdateRecipient={handleInlineUpdate}
          />
        ) : viewMode === 'matrix' ? (
          <RecipientScheduleMatrix
            recipients={filteredRecipients}
            onRecipientClick={handleOpenDrawer}
          />
        ) : (
          <RecipientWeeklyCalendar
            recipients={filteredRecipients}
            onRecipientClick={handleOpenDrawer}
          />
        )}

        <RecipientDetailDrawer
          recipient={selectedRecipient}
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setSelectedRecipient(null);
          }}
          canEdit={canEdit}
          onEdit={(recipient) => {
            setDrawerOpen(false);
            handleEdit(recipient);
          }}
          onDelete={handleDelete}
          onToggleStatus={handleToggleStatus}
        />

        {/* Edit Modal */}
        {editingRecipient && (
          <Dialog open={!!editingRecipient} onOpenChange={() => setEditingRecipient(null)}>
            <DialogContent aria-describedby="edit-recipient-description" className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Recipient</DialogTitle>
              </DialogHeader>
              <p id="edit-recipient-description" className="text-sm text-slate-600 mb-4">
                Update recipient information.
              </p>
              <div className="space-y-4">
                <RecipientForm
                  formData={editForm.formData}
                  sections={editForm.sections}
                  onFieldChange={editForm.updateField}
                  onSectionChange={editForm.updateSection}
                  mode="edit"
                  idPrefix="edit"
                />
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => setEditingRecipient(null)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdate} disabled={updateRecipientMutation.isPending}>
                    {updateRecipientMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </TooltipProvider>
  );
}

