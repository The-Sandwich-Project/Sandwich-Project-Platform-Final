import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sandwich,
  Calendar,
  User,
  Users,
  Edit,
  Trash2,
  Upload,
  AlertTriangle,
  Scan,
  Square,
  SquareCheck,
  Filter,
  X,
  ArrowUp,
  ArrowDown,
  Download,
  Plus,
  Database,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Heart,
  Star,
  CheckCircle,
  AlertCircle,
  Info,
  Camera,
  Calculator,
} from 'lucide-react';
import { Link } from 'wouter';
import SendKudosButton from '@/components/send-kudos-button';
import sandwichLogo from '@assets/LOGOS/Copy of TSP_transparent.png';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import BulkDataManager from '@/components/bulk-data-manager';
import CollectiveLearningAutoLogCard from '@/components/collective-learning-auto-log-card';
import CollectionFormSelector from '@/components/collection-form-selector';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { usePageSession } from '@/hooks/usePageSession';
import { usePermissions } from '@/hooks/useResourcePermissions';
import {
  PERMISSIONS,
  canEditCollection,
  canDeleteCollection,
} from '@shared/auth-utils';
import type { SandwichCollection, Host } from '@shared/schema';
import { HelpBubble } from '@/components/help-system';
import {
  calculateTotalSandwiches,
  calculateGroupSandwiches,
} from '@/lib/analytics-utils';
import { logger } from '@/lib/logger';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { getCollectionDefaults, getRoleViewDescription } from '@shared/role-view-defaults';

interface ImportResult {
  totalRecords: number;
  successCount: number;
  errorCount: number;
  errors: string[];
}

interface DuplicateAnalysis {
  totalCollections: number;
  duplicateGroups: number;
  totalDuplicateEntries: number;
  suspiciousPatterns: number;
  ogDuplicates: number;
  duplicates: Array<{
    entries: SandwichCollection[];
    count: number;
    duplicateInfo: {
      collectionDate: string;
      groupNames: string;
      individualSandwiches: number;
      totalSandwiches: number;
    };
    keepNewest: {
      id: number;
      submittedAt: string;
      createdBy: string;
      individualSandwiches: number;
      totalSandwiches: number;
      groupNames: string;
    };
    toDelete: Array<{
      id: number;
      submittedAt: string;
      createdBy: string;
      individualSandwiches: number;
      totalSandwiches: number;
      groupNames: string;
    }>;
  }>;
  suspiciousEntries: SandwichCollection[];
  ogDuplicateEntries: Array<{
    ogEntry?: SandwichCollection;
    earlyEntry?: SandwichCollection;
    duplicateOgEntry?: SandwichCollection;
    reason: string;
  }>;
}

export default function SandwichCollectionLog() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { trackDataEntry, trackButtonClick, trackDownload } = useAnalytics();

  // Get role-based defaults for collections
  const collectionDefaults = useMemo(() => {
    if (!user?.role) {
      return getCollectionDefaults('viewer');
    }
    return getCollectionDefaults(user.role);
  }, [user?.role]);

  // Activity Tracking Integration
  const {
    trackActivity,
    trackClick,
    trackFormSubmit,
    trackView,
    trackCreate,
    trackUpdate,
    trackDelete,
  } = useActivityTracker();

  // Track page session with duration
  usePageSession({
    section: 'Collections',
    page: 'Collection Log',
    context: {
      userRole: user?.role,
    },
  });

  // Check user permissions using the unified hook
  const {
    COLLECTIONS_ADD,
    COLLECTIONS_EDIT_OWN,
    COLLECTIONS_EDIT_ALL,
    COLLECTIONS_DELETE_ALL,
  } = usePermissions([
    'COLLECTIONS_ADD',
    'COLLECTIONS_EDIT_OWN',
    'COLLECTIONS_EDIT_ALL',
    'COLLECTIONS_DELETE_ALL',
  ]);

  // Check user permissions for creating collections (automatically grants edit/delete of own)
  const canCreateCollections = COLLECTIONS_ADD || COLLECTIONS_EDIT_OWN;
  const canEditAllCollections = COLLECTIONS_EDIT_ALL;
  const canDeleteAllCollections = COLLECTIONS_DELETE_ALL;
  // Simplified approach: CREATE_COLLECTIONS automatically includes edit/delete own permissions
  const canEditData = COLLECTIONS_ADD || COLLECTIONS_EDIT_ALL;
  const canDeleteData = COLLECTIONS_ADD || COLLECTIONS_DELETE_ALL;
  const [editingCollection, setEditingCollection] =
    useState<SandwichCollection | null>(null);
  const [showDuplicateAnalysis, setShowDuplicateAnalysis] = useState(false);
  const [duplicateAnalysis, setDuplicateAnalysis] =
    useState<DuplicateAnalysis | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<Set<number>>(
    new Set()
  );
  const [selectedSuspiciousIds, setSelectedSuspiciousIds] = useState<
    Set<number>
  >(new Set());
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<number>>(
    new Set()
  );
  const [selectedKeepIds, setSelectedKeepIds] = useState<Map<number, number>>(
    new Map()
  );
  const [skippedGroups, setSkippedGroups] = useState<Set<number>>(new Set());
  const [duplicatePage, setDuplicatePage] = useState(0);
  const DUPLICATES_PER_PAGE = 10;
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [batchEditData, setBatchEditData] = useState({
    hostName: '',
    collectionDate: '',
  });
  const [searchFilters, setSearchFilters] = useState({
    globalSearch: '',
    hostName: '',
    groupName: '',
    collectionDateFrom: '',
    collectionDateTo: '',
    createdAtFrom: '',
    createdAtTo: '',
  });

  // Debounced search filters for actual queries
  const [debouncedSearchFilters, setDebouncedSearchFilters] = useState({
    globalSearch: '',
    hostName: '',
    groupName: '',
    collectionDateFrom: '',
    collectionDateTo: '',
    createdAtFrom: '',
    createdAtTo: '',
  });

  // Convert role-based sort default to component format
  const getInitialSortConfig = useCallback(() => {
    const sortMap: Record<string, { field: keyof SandwichCollection; direction: 'asc' | 'desc' }> = {
      'date_desc': { field: 'collectionDate', direction: 'desc' },
      'date_asc': { field: 'collectionDate', direction: 'asc' },
      'host_asc': { field: 'hostName', direction: 'asc' },
      'host_desc': { field: 'hostName', direction: 'desc' },
      'sandwiches_desc': { field: 'individualSandwiches', direction: 'desc' },
      'sandwiches_asc': { field: 'individualSandwiches', direction: 'asc' },
    };
    return sortMap[collectionDefaults.defaultSort] || { field: 'collectionDate', direction: 'desc' };
  }, [collectionDefaults.defaultSort]);

  const [sortConfig, setSortConfig] = useState(getInitialSortConfig());
  const [showFilters, setShowFilters] = useState(false);
  // One-tap quick-filter chip below the global search. Each chip applies an
  // additive filter to the same client-side filtering pipeline that the
  // search input + advanced filters use.
  //   'all'         — no chip filter active (default)
  //   'host'        — records with an individual sandwich count > 0
  //   'group'       — records with at least one group collection entry
  //   'thisMonth'   — collectionDate within the current calendar month
  //   'last30Days'  — collectionDate within the past 30 days
  //   'mine'        — records the current user submitted (createdBy === user.id)
  type QuickFilter = 'all' | 'host' | 'group' | 'thisMonth' | 'last30Days' | 'mine';
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(collectionDefaults.itemsPerPage);
  const [editFormData, setEditFormData] = useState({
    collectionDate: '',
    hostName: '',
    individualSandwiches: '',
    groupCollections: '',
    individualDeli: '',
    individualPbj: '',
    individualGeneric: '',
  });
  const [editGroupCollections, setEditGroupCollections] = useState<
    Array<{ id: string; groupName: string; department?: string; count?: number; sandwichCount?: number; deli?: number; pbj?: number; generic?: number; hasTypeBreakdown?: boolean }>
  >([]);
  const [showEditIndividualBreakdown, setShowEditIndividualBreakdown] = useState(false);
  
  // Validation state for Edit Collection Dialog
  const [editIndividualBreakdownError, setEditIndividualBreakdownError] = useState<string>('');
  const [editGroupBreakdownErrors, setEditGroupBreakdownErrors] = useState<Map<string, string>>(new Map());
  
  // Calculator state for edit form
  const [editActiveCalcField, setEditActiveCalcField] = useState<string | null>(null);
  const [editCalcDisplay, setEditCalcDisplay] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [newCollectionData, setNewCollectionData] = useState({
    collectionDate: '',
    hostName: '',
    individualSandwiches: '',
    groupCollections: '',
  });
  const [newGroupCollections, setNewGroupCollections] = useState<
    Array<{ id: string; groupName: string; sandwichCount: number }>
  >([{ id: Math.random().toString(36), groupName: '', sandwichCount: 0 }]);
  const [newCollectionGroupOnlyMode, setNewCollectionGroupOnlyMode] =
    useState(false);

  // Sync state with role defaults when user loads (handles async user fetch)
  useEffect(() => {
    setSortConfig(getInitialSortConfig());
    setItemsPerPage(collectionDefaults.itemsPerPage);
  }, [collectionDefaults.defaultSort, collectionDefaults.itemsPerPage, getInitialSortConfig]);

  // Use standardized calculation functions from analytics-utils.ts for data consistency
  const calculateGroupTotal = calculateGroupSandwiches;
  const calculateTotal = calculateTotalSandwiches;

  // Listen for form open events from dashboard
  useEffect(() => {
    const handleOpenForm = () => {
      setShowSubmitForm(true);
    };

    window.addEventListener('openCollectionForm', handleOpenForm);
    return () =>
      window.removeEventListener('openCollectionForm', handleOpenForm);
  }, []);

  // Track form views when form visibility changes
  useEffect(() => {
    if (showSubmitForm) {
      trackView(
        'collection_form',
        'Collections',
        'Collection Log',
        'User opened collection form to add new collection data'
      );
    }
  }, [showSubmitForm, trackView]);

  // Track edit form views
  useEffect(() => {
    if (editingCollection) {
      trackView(
        'edit_collection_form',
        'Collections',
        'Collection Log',
        `Editing collection ID: ${editingCollection.id}`
      );
    }
  }, [editingCollection, trackView]);

  // Debounce search filters to prevent excessive queries.
  // Date <input type="date"> fields fire onChange for every intermediate
  // "complete" value while the user is still typing the year (e.g. 0002,
  // 0020, 0206, 2026). We let the controlled input track those keystrokes
  // so the user can keep typing, but we only commit date filters to the
  // query when the year looks plausible (1900-2099). This keeps the list
  // from "refreshing" with results for bogus early years.
  useEffect(() => {
    const isCommittableDate = (value: string) => {
      if (!value) return true;
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return false;
      const year = parseInt(match[1], 10);
      return year >= 1900 && year <= 2099;
    };

    const dateFieldsReady =
      isCommittableDate(searchFilters.collectionDateFrom) &&
      isCommittableDate(searchFilters.collectionDateTo) &&
      isCommittableDate(searchFilters.createdAtFrom) &&
      isCommittableDate(searchFilters.createdAtTo);

    if (!dateFieldsReady) {
      return;
    }

    const timeoutId = setTimeout(() => {
      logger.log('Setting debounced filters:', searchFilters);
      setDebouncedSearchFilters(searchFilters);
    }, 500); // Wait 500ms after user stops typing

    return () => clearTimeout(timeoutId);
  }, [searchFilters]);

  // Validation for individual sandwich breakdown in Edit dialog
  useEffect(() => {
    if (!showEditIndividualBreakdown) {
      setEditIndividualBreakdownError('');
      return;
    }

    const individualDeli = parseInt(editFormData.individualDeli) || 0;
    const individualPbj = parseInt(editFormData.individualPbj) || 0;
    const individualGeneric = parseInt(editFormData.individualGeneric) || 0;
    const individualSandwiches = parseInt(editFormData.individualSandwiches) || 0;

    const breakdownSum = individualDeli + individualPbj + individualGeneric;
    const hasAnyValue = individualDeli > 0 || individualPbj > 0 || individualGeneric > 0;

    if (!hasAnyValue) {
      // Allow empty breakdown (optional)
      setEditIndividualBreakdownError('');
      return;
    }

    // If any value is entered, enforce sum validation
    if (breakdownSum !== individualSandwiches) {
      setEditIndividualBreakdownError(`Type breakdown (${breakdownSum}) must equal total individual sandwiches (${individualSandwiches})`);
    } else {
      setEditIndividualBreakdownError('');
    }
  }, [showEditIndividualBreakdown, editFormData.individualDeli, editFormData.individualPbj, editFormData.individualGeneric, editFormData.individualSandwiches]);

  // Validation for group breakdown in Edit dialog
  useEffect(() => {
    const errors = new Map<string, string>();
    
    editGroupCollections.forEach((group) => {
      // Only validate groups that have type breakdown enabled
      if (!group.hasTypeBreakdown) {
        return;
      }

      const deli = group.deli || 0;
      const pbj = group.pbj || 0;
      const generic = group.generic || 0;
      const breakdownSum = deli + pbj + generic;
      const hasAnyValue = deli > 0 || pbj > 0 || generic > 0;
      
      if (!hasAnyValue) {
        // Allow empty breakdown (optional)
        return;
      }

      // Support both 'count' and 'sandwichCount' field names for compatibility
      const groupCount = group.count || group.sandwichCount || 0;

      // If any value is entered, enforce sum validation
      if (breakdownSum !== groupCount) {
        errors.set(group.id, `Group type breakdown (${breakdownSum}) must equal group total (${groupCount})`);
      }
    });
    
    setEditGroupBreakdownErrors(errors);
  }, [editGroupCollections]);

  // Memoize expensive computations using debounced filters
  // Only fetch all data when we need client-side filtering/sorting, not for basic pagination
  // Also triggers when a quick-filter chip is active so the chip can filter
  // across the full dataset, not just the current paginated slice.
  const needsAllData = useMemo(
    () =>
      showFilters ||
      quickFilter !== 'all' ||
      Object.values(debouncedSearchFilters).some((v) => v),
    [showFilters, quickFilter, debouncedSearchFilters]
  );

  const queryKey = useMemo(
    () => [
      '/api/sandwich-collections',
      needsAllData ? 'all' : currentPage,
      currentPage, // Always include current page for proper cache keying
      itemsPerPage, // Always include to trigger refetch when items per page changes
      debouncedSearchFilters,
      sortConfig,
      quickFilter, // Re-evaluate when the chip changes
    ],
    [
      needsAllData,
      currentPage,
      itemsPerPage,
      debouncedSearchFilters,
      sortConfig,
      quickFilter,
    ]
  );

  const { data: collectionsResponse, isLoading } = useQuery({
    queryKey,
    queryFn: useCallback(async () => {
      if (needsAllData) {
        logger.log(
          'Fetching all data for filtering with filters:',
          debouncedSearchFilters
        );
        const response = await fetch('/api/sandwich-collections?limit=5000');
        if (!response.ok) throw new Error('Failed to fetch collections');
        const data = await response.json();

        let filteredCollections = data.collections || [];
        logger.log('Initial collections count:', filteredCollections.length);

        // Apply filters using debounced values
        if (debouncedSearchFilters.hostName) {
          const searchTerm = debouncedSearchFilters.hostName.toLowerCase();
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) =>
              c.hostName?.toLowerCase()?.includes(searchTerm)
          );
          logger.log(
            `Host name filter '${searchTerm}' applied: ${filteredCollections.length} results`
          );
        }

        if (debouncedSearchFilters.collectionDateFrom) {
          const fromDate = new Date(debouncedSearchFilters.collectionDateFrom);
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => new Date(c.collectionDate) >= fromDate
          );
          logger.log(
            `Date from filter '${debouncedSearchFilters.collectionDateFrom}' applied: ${filteredCollections.length} results`
          );
        }

        if (debouncedSearchFilters.collectionDateTo) {
          const toDate = new Date(debouncedSearchFilters.collectionDateTo);
          // Add 23:59:59 to include the entire day
          toDate.setHours(23, 59, 59, 999);
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => new Date(c.collectionDate) <= toDate
          );
        }

        if (debouncedSearchFilters.createdAtFrom) {
          const fromDate = new Date(debouncedSearchFilters.createdAtFrom);
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => new Date(c.submittedAt) >= fromDate
          );
        }

        if (debouncedSearchFilters.createdAtTo) {
          const toDate = new Date(debouncedSearchFilters.createdAtTo);
          // Add 23:59:59 to include the entire day
          toDate.setHours(23, 59, 59, 999);
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => new Date(c.submittedAt) <= toDate
          );
        }

        // Global search filter - searches across multiple fields
        if (debouncedSearchFilters.globalSearch) {
          const searchTerm = debouncedSearchFilters.globalSearch.toLowerCase();
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => {
              // Search in host name (also serves as the "collection location"
              // for individual/host drop-offs).
              const hostNameMatch = c.hostName
                ?.toLowerCase()
                ?.includes(searchTerm) ?? false;

              // Search in submitter name (createdByName) so the user can
              // find "all the collections Katie submitted" in one query.
              const submitterMatch = c.createdByName
                ?.toLowerCase()
                ?.includes(searchTerm) ?? false;

              // Search in group names AND the group's department/organization
              // — a "Cox Enterprises" search should find a Cox group whose
              // groupName is the company and whose department is the team.
              const groupData = getGroupCollections(c);
              const groupNameMatch = groupData.some((group) =>
                group.groupName?.toLowerCase()?.includes(searchTerm)
              );
              // getGroupCollections returns a union type where the legacy
              // fallback branch lacks `department` — only the JSONB branch has
              // it. Cast to any to read it safely; missing values just no-op.
              const organizationMatch = groupData.some((group) =>
                (group as any).department?.toLowerCase()?.includes(searchTerm)
              );

              // Search in collection date - check multiple formats
              let dateMatch = false;
              if (c.collectionDate) {
                try {
                  // Parse the collection date
                  const dateStr = c.collectionDate;
                  let date: Date;
                  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // YYYY-MM-DD format - add noon to prevent timezone shift
                    date = new Date(dateStr + 'T12:00:00');
                  } else {
                    date = new Date(dateStr);
                  }

                  if (!isNaN(date.getTime())) {
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
                      // Month name formats
                      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
                    ];

                    dateMatch = formats.some(format => format.toLowerCase().includes(searchTerm));
                  }
                } catch (error) {
                  // If date parsing fails, fall back to string matching on the raw date string
                  dateMatch = c.collectionDate?.toLowerCase()?.includes(searchTerm) ?? false;
                }
              }

              return (
                hostNameMatch ||
                submitterMatch ||
                groupNameMatch ||
                organizationMatch ||
                dateMatch
              );
            }
          );
          logger.log(
            `Global search filter '${searchTerm}' applied: ${filteredCollections.length} results`
          );
        }

        // Group name specific filter
        if (debouncedSearchFilters.groupName) {
          const searchTerm = debouncedSearchFilters.groupName.toLowerCase();
          filteredCollections = filteredCollections.filter(
            (c: SandwichCollection) => {
              const groupData = getGroupCollections(c);
              return groupData.some((group) =>
                group.groupName?.toLowerCase()?.includes(searchTerm)
              );
            }
          );
          logger.log(
            `Group name filter '${searchTerm}' applied: ${filteredCollections.length} results`
          );
        }

        // Quick-filter chip — applied last so it composes additively with
        // search + advanced filters. A user can search for "Smith" AND
        // narrow to This Month with the chip.
        if (quickFilter !== 'all') {
          const beforeCount = filteredCollections.length;
          if (quickFilter === 'host') {
            // Records with individual sandwich pickups (host drop-offs).
            filteredCollections = filteredCollections.filter(
              (c: SandwichCollection) => (c.individualSandwiches || 0) > 0
            );
          } else if (quickFilter === 'group') {
            // Records with at least one group collection entry.
            filteredCollections = filteredCollections.filter(
              (c: SandwichCollection) => getGroupCollections(c).length > 0
            );
          } else if (quickFilter === 'thisMonth') {
            // collectionDate within the current calendar month, in user's local time.
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            filteredCollections = filteredCollections.filter(
              (c: SandwichCollection) => {
                if (!c.collectionDate) return false;
                const dateStr = c.collectionDate;
                const date = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
                  ? new Date(dateStr + 'T12:00:00')
                  : new Date(dateStr);
                if (isNaN(date.getTime())) return false;
                return date >= monthStart && date <= monthEnd;
              }
            );
          } else if (quickFilter === 'last30Days') {
            // collectionDate within the past 30 days.
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            cutoff.setHours(0, 0, 0, 0);
            filteredCollections = filteredCollections.filter(
              (c: SandwichCollection) => {
                if (!c.collectionDate) return false;
                const dateStr = c.collectionDate;
                const date = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
                  ? new Date(dateStr + 'T12:00:00')
                  : new Date(dateStr);
                if (isNaN(date.getTime())) return false;
                return date >= cutoff;
              }
            );
          } else if (quickFilter === 'mine') {
            // Records the current user submitted. Requires a logged-in user.
            if (user?.id) {
              filteredCollections = filteredCollections.filter(
                (c: SandwichCollection) => String((c as any).createdBy) === String(user.id)
              );
            } else {
              filteredCollections = [];
            }
          }
          logger.log(
            `Quick filter '${quickFilter}' applied: ${beforeCount} → ${filteredCollections.length} results`
          );
        }

        // Apply role-based sorting - show user's own collections first if role specifies
        filteredCollections.sort((a: any, b: any) => {
          // First, if role specifies showing own first, prioritize user's collections
          if (collectionDefaults.showOwnFirst && user?.id) {
            const aIsOwn = a.createdBy === user.id;
            const bIsOwn = b.createdBy === user.id;

            if (aIsOwn && !bIsOwn) return -1;
            if (!aIsOwn && bIsOwn) return 1;
          }

          // Then apply normal sorting
          const aVal = a[sortConfig.field];
          const bVal = b[sortConfig.field];

          if (aVal === bVal) return 0;
          if (aVal === null || aVal === undefined) return 1;
          if (bVal === null || bVal === undefined) return -1;

          const comparison = aVal < bVal ? -1 : 1;
          return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

        // Apply pagination
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedResults = filteredCollections.slice(
          startIndex,
          endIndex
        );

        logger.log('Pagination debug:', {
          currentPage,
          itemsPerPage,
          startIndex,
          endIndex,
          totalFiltered: filteredCollections.length,
          resultCount: paginatedResults.length,
        });

        // Calculate stats from ALL filtered collections for accurate totals
        let individualTotal = 0;
        let groupTotal = 0;
        const dates: string[] = [];
        const hostNames = new Set<string>();

        filteredCollections.forEach((collection: any) => {
          individualTotal += collection.individualSandwiches || 0;
          // Calculate group total using the standardized function that handles both JSONB and legacy formats
          groupTotal += calculateGroupTotal(collection);
          if (collection.collectionDate) {
            dates.push(collection.collectionDate);
          }
          if (collection.hostName) {
            hostNames.add(collection.hostName);
          }
        });

        let dateRange = null;
        if (dates.length > 0) {
          dates.sort();
          const earliestDate = new Date(dates[0]);
          const latestDate = new Date(dates[dates.length - 1]);
          dateRange = {
            earliest: earliestDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
            latest: latestDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
          };
        }

        const filteredStats = {
          totalEntries: filteredCollections.length,
          individualSandwiches: individualTotal,
          groupSandwiches: groupTotal,
          completeTotalSandwiches: individualTotal + groupTotal,
          hostName: hostNames.size === 1 ? Array.from(hostNames)[0] : null,
          dateRange,
        };

        return {
          collections: paginatedResults,
          pagination: {
            currentPage,
            totalPages: Math.ceil(filteredCollections.length / itemsPerPage),
            totalItems: filteredCollections.length,
            itemsPerPage,
          },
          filteredStats, // Include stats calculated from all filtered data
        };
      } else {
        const sortParam = `&sort=${sortConfig.field}&order=${sortConfig.direction}`;
        const url = `/api/sandwich-collections?page=${currentPage}&limit=${itemsPerPage}${sortParam}`;
        logger.log('Fetching paginated collections:', url);
        const response = await fetch(url);
        if (!response.ok) {
          logger.error('Failed to fetch collections:', response.status, response.statusText);
          throw new Error('Failed to fetch collections');
        }
        const data = await response.json();
        logger.log('Paginated collections response:', {
          collectionsCount: data.collections?.length || 0,
          pagination: data.pagination
        });
        return data;
      }
    }, [
      needsAllData,
      currentPage,
      itemsPerPage,
      debouncedSearchFilters,
      sortConfig,
      collectionDefaults.showOwnFirst,
      user?.id,
      quickFilter,
    ]),
  });

  const collections = collectionsResponse?.collections || [];
  const pagination = collectionsResponse?.pagination;
  const filteredStatsFromResponse = collectionsResponse?.filteredStats;

  // Extract pagination info - handle both client-side and server-side pagination responses
  const totalItems = pagination?.totalItems || pagination?.total || 0;
  const totalPages =
    pagination?.totalPages || Math.ceil(totalItems / itemsPerPage) || 1;
  const currentPageFromServer =
    pagination?.currentPage || pagination?.page || 1;
  const hasNext = pagination?.hasNext || currentPage < totalPages;
  const hasPrev = pagination?.hasPrev || currentPage > 1;

  const { data: hostsList = [] } = useQuery<Host[]>({
    queryKey: ['/api/hosts'],
  });

  // Query for complete database totals including both individual and group collections
  const { data: totalStats } = useQuery({
    queryKey: ['/api/sandwich-collections/stats'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
  });

  // The user's personal "notable" bookmarks. Kept as a Set for O(1)
  // membership checks when rendering each row. Loaded once and updated
  // optimistically on toggle so the star fills/empties instantly.
  const { data: favoritesData } = useQuery<{ collectionIds: number[] }>({
    queryKey: ['/api/collection-favorites'],
    queryFn: async () => {
      const response = await fetch('/api/collection-favorites', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load favorites');
      return response.json();
    },
  });
  const favoritedIds = React.useMemo(
    () => new Set(favoritesData?.collectionIds ?? []),
    [favoritesData],
  );

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (params: { collectionId: number; favorited: boolean }) => {
      const { collectionId, favorited } = params;
      // Toggle: if currently favorited, send DELETE; otherwise POST.
      const method = favorited ? 'DELETE' : 'POST';
      const response = await fetch(`/api/collection-favorites/${collectionId}`, {
        method,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to update favorite');
      return response.json();
    },
    onMutate: async ({ collectionId, favorited }) => {
      // Optimistic update so the star flips immediately on click.
      await queryClient.cancelQueries({
        queryKey: ['/api/collection-favorites'],
      });
      const previous = queryClient.getQueryData<{ collectionIds: number[] }>([
        '/api/collection-favorites',
      ]);
      queryClient.setQueryData<{ collectionIds: number[] }>(
        ['/api/collection-favorites'],
        (current) => {
          const set = new Set(current?.collectionIds ?? []);
          if (favorited) set.delete(collectionId);
          else set.add(collectionId);
          return { collectionIds: Array.from(set) };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['/api/collection-favorites'],
          context.previous,
        );
      }
      toast({
        title: 'Could not update favorite',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection-favorites'] });
    },
  });

  // Calculate filtered statistics from current collections data
  const calculateFilteredStats = (collectionsData: SandwichCollection[]) => {
    if (!collectionsData || collectionsData.length === 0) {
      return {
        totalEntries: 0,
        individualSandwiches: 0,
        groupSandwiches: 0,
        completeTotalSandwiches: 0,
        hostName: null,
        dateRange: null,
      };
    }

    let individualTotal = 0;
    let groupTotal = 0;
    const dates: string[] = [];
    const hostNames = new Set<string>();

    collectionsData.forEach((collection) => {
      individualTotal += collection.individualSandwiches || 0;
      groupTotal += calculateGroupTotal(collection);
      if (collection.collectionDate) {
        dates.push(collection.collectionDate);
      }
      if (collection.hostName) {
        hostNames.add(collection.hostName);
      }
    });

    // Calculate date range
    let dateRange = null;
    if (dates.length > 0) {
      dates.sort();
      const earliestDate = new Date(dates[0]);
      const latestDate = new Date(dates[dates.length - 1]);
      dateRange = {
        earliest: earliestDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        latest: latestDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };
    }

    return {
      totalEntries: collectionsData.length,
      individualSandwiches: individualTotal,
      groupSandwiches: groupTotal,
      completeTotalSandwiches: individualTotal + groupTotal,
      hostName: hostNames.size === 1 ? Array.from(hostNames)[0] : null,
      dateRange,
    };
  };

  // Determine if we're showing filtered data and get all data for calculations.
  // Include quick-filter chips — they filter the dataset the same way as search
  // filters but live in separate state.
  const hasActiveFilters =
    quickFilter !== 'all' ||
    Object.values(debouncedSearchFilters).some((v) => v && v.trim() !== '');

  const quickFilterLabel =
    quickFilter === 'host'
      ? 'Host Collections'
      : quickFilter === 'group'
        ? 'Group Collections'
        : quickFilter === 'thisMonth'
          ? 'This Month'
          : quickFilter === 'last30Days'
            ? 'Last 30 Days'
            : quickFilter === 'mine'
              ? 'My Submissions'
              : null;

  // Calculate current statistics to display
  // Priority: filtered collections from main query > global stats (only when no filters)
  const currentStats = (() => {
    // When filters are active, use pre-calculated stats from response (for all filtered data)
    // or calculate from current page if pre-calculated stats aren't available
    if (hasActiveFilters) {
      if (filteredStatsFromResponse) {
        return filteredStatsFromResponse;
      } else if (collections.length > 0) {
        return calculateFilteredStats(collections);
      } else {
        // Even with filters active, if no data is available, show zero stats
        return {
          totalEntries: 0,
          individualSandwiches: 0,
          groupSandwiches: 0,
          completeTotalSandwiches: 0,
          hostName: null,
          dateRange: null,
        };
      }
    }

    // No filters active - prefer current collections over global stats for consistency
    if (needsAllData && collections.length > 0) {
      return calculateFilteredStats(collections);
    }

    // Fallback to global stats only when no filters are active and no current data
    return {
      totalEntries: totalStats?.totalEntries || 0,
      individualSandwiches: totalStats?.individualSandwiches || 0,
      groupSandwiches: totalStats?.groupSandwiches || 0,
      completeTotalSandwiches: totalStats?.completeTotalSandwiches || 0,
      hostName: null,
      dateRange: null,
    };
  })();

  // When needsAllData is true, filtering and pagination are already handled in the queryFn
  // When needsAllData is false, server-side pagination and sorting are used
  const filteredCollections = collections;

  // Use pagination info from backend when available, otherwise it's already calculated in queryFn
  const effectiveTotalItems = totalItems;
  const effectiveTotalPages = totalPages;

  // Collections are already paginated - no additional slicing needed
  const paginatedCollections = filteredCollections;

  // Reset to first page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchFilters, sortConfig]);

  // Pagination Controls Component with Full Page Numbers
  const PaginationControls = ({ position }: { position: 'top' | 'bottom' }) => {
    // Calculate which page numbers to show
    const getVisiblePages = () => {
      const totalPages = effectiveTotalPages;
      const current = currentPage;
      const delta = 2; // Show 2 pages on each side of current page

      let pages = [];

      // Always show first page
      if (totalPages > 0) {
        pages.push(1);
      }

      // Calculate start and end of middle section
      let start = Math.max(2, current - delta);
      let end = Math.min(totalPages - 1, current + delta);

      // Add ellipsis after first page if needed
      if (start > 2) {
        pages.push('...');
      }

      // Add middle pages
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== totalPages) {
          pages.push(i);
        }
      }

      // Add ellipsis before last page if needed
      if (end < totalPages - 1) {
        pages.push('...');
      }

      // Always show last page (if different from first)
      if (totalPages > 1) {
        pages.push(totalPages);
      }

      return pages;
    };

    const visiblePages = getVisiblePages();

    return (
      <div className="flex flex-col sm:flex-row justify-between items-center p-4 bg-white border-t border-slate-200 gap-4">
        {/* Left side - Per page selector only */}
        <div className="flex items-center gap-2 text-base">
          <span className="text-slate-600">Per page:</span>
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
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Right side - Page navigation with individual page numbers */}
        {effectiveTotalPages > 1 && (
          <div className="flex items-center gap-1 max-w-full overflow-x-auto">
            {/* Previous button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-2 bg-white border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              Previous
            </Button>

            {/* Page number buttons */}
            {visiblePages.map((page, index) => {
              if (page === '...') {
                return (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 py-2 text-slate-400"
                  >
                    ...
                  </span>
                );
              }

              const pageNum = page as number;
              return (
                <Button
                  key={pageNum}
                  variant={pageNum === currentPage ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-10 h-10 ${pageNum === currentPage ? 'bg-brand-primary text-white' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'}`}
                >
                  {pageNum}
                </Button>
              );
            })}

            {/* Next button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === effectiveTotalPages}
              className="px-3 py-2 bg-white border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              Next
            </Button>

            {/* Last button (if not already visible) */}
            {currentPage < effectiveTotalPages - 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(effectiveTotalPages)}
                disabled={currentPage === effectiveTotalPages}
                className="px-3 py-2 bg-white border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
              >
                Last
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  // Get unique host names from collections for filtering
  const uniqueHostNames = Array.from(
    new Set(collections.map((c: SandwichCollection) => c.hostName))
  ).sort();

  // Include all hosts (active and inactive) for collection assignment
  const hostOptions = [
    ...hostsList.map((host) => host.name),
    'Other',
  ];

  const formatDate = (dateInput: string | Date | null | undefined) => {
    if (!dateInput) return 'N/A';
    // If it's already a Date object, use it directly
    if (dateInput instanceof Date) {
      return dateInput.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    // If it's not a string, bail
    if (typeof dateInput !== 'string') return 'N/A';
    // Parse date as local date to avoid timezone issues
    const [year, month, day] = dateInput.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    return localDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatSubmittedAt = (timestamp: string | Date) => {
    return (
      new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }) +
      ' at ' +
      new Date(timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  };

  // PHASE 6: Helper to get group collections from new JSONB array structure
  const getGroupCollections = (collection: SandwichCollection) => {
    // First check if the new groupCollections JSONB array exists and has data
    if (
      collection.groupCollections &&
      Array.isArray(collection.groupCollections) &&
      collection.groupCollections.length > 0
    ) {
      return collection.groupCollections
        .filter((group: any) => group.name && group.count > 0)
        .map((group: any) => ({
          groupName: group.name,
          department: group.department || undefined,
          sandwichCount: group.count,
          deli: group.deli || 0,
          pbj: group.pbj || 0,
        }));
    }

    // Fall back to legacy fields for backward compatibility
    const groups = [];
    const group1Name = (collection as any).group1Name;
    const group1Count = (collection as any).group1Count;
    const group2Name = (collection as any).group2Name;
    const group2Count = (collection as any).group2Count;

    if (group1Name && group1Count > 0) {
      groups.push({ groupName: group1Name, sandwichCount: group1Count });
    }
    if (group2Name && group2Count > 0) {
      groups.push({ groupName: group2Name, sandwichCount: group2Count });
    }
    return groups;
  };

  // Mutations for update and delete
  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; updates: any }) => {
      trackDataEntry('sandwich_collection_edit', 'collections_log');
      return await apiRequest(
        'PATCH',
        `/api/sandwich-collections/${data.id}`,
        data.updates
      );
    },
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections/stats'],
      });
      setEditingCollection(null);

      // Track successful update
      trackFormSubmit('edit_collection_form', 'Collections', 'Collection Log', true);
      trackUpdate('sandwich_collection', 'Collections', 'Collection Log', variables.id.toString());

      toast({
        title: 'Collection Updated Successfully! ✏️',
        description:
          'Your changes have been saved and the collection data has been updated.',
        duration: 4000,
      });
    },
    onError: (error, variables) => {
      // Track failed update
      trackFormSubmit('edit_collection_form', 'Collections', 'Collection Log', false);
      trackActivity({
        action: 'Update Failed',
        section: 'Collections',
        feature: 'Collection Log',
        details: `Failed to update collection ID: ${variables.id}`,
        metadata: {
          collectionId: variables.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        },
      });

      toast({
        title: 'Error',
        description: 'Failed to update collection. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      trackButtonClick('delete_collection', 'collections_log');
      const result = await apiRequest(
        'DELETE',
        `/api/sandwich-collections/${id}`
      );
      return { result, id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections/stats'],
      });

      // Track successful deletion
      trackDelete('sandwich_collection', 'Collections', 'Collection Log', data.id.toString());

      const { dismiss } = toast({
        title: 'Collection Deleted 🗑️',
        description: 'Click Undo to restore',
        duration: 5000,
        action: (
          <button
            onClick={async () => {
              try {
                await apiRequest('POST', `/api/sandwich-collections/${data.id}/restore`);
                queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections'] });
                queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections/stats'] });
                dismiss();
                toast({
                  title: 'Collection Restored ✅',
                  description: 'The collection has been successfully restored.',
                });
              } catch (error) {
                toast({
                  title: 'Error',
                  description: 'Failed to restore collection.',
                  variant: 'destructive',
                });
              }
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Undo
          </button>
        ),
      });
    },
    onError: async (error: any, id: number) => {
      logger.error('Delete collection error:', error);

      // Refresh data first to check if the deletion actually succeeded
      // (sometimes the delete works but the response is lost due to network issues)
      await queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections/stats'],
      });

      // The list query key includes page, filters, and sort — an exact lookup
      // of ['/api/sandwich-collections'] always misses and used to report a
      // failed delete as a success while the row stayed on screen. Only the
      // active list matters; older cached pages can still contain the id.
      const lists = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['/api/sandwich-collections'], type: 'active' })
        .map((query) => query.state.data as { collections?: Array<{ id: number }> } | undefined)
        .filter(
          (data): data is { collections: Array<{ id: number }> } =>
            Array.isArray(data?.collections)
        );
      const stillExists = lists.some((data) =>
        data.collections.some((c) => c.id === id)
      );

      if (lists.length > 0 && !stillExists) {
        // The deletion actually worked! Show success message instead of error
        trackDelete('sandwich_collection', 'Collections', 'Collection Log', id.toString());
        toast({
          title: 'Collection Deleted 🗑️',
          description: 'The collection was successfully deleted.',
          duration: 4000,
        });
        return;
      }

      // Track failed deletion only if it actually failed
      trackActivity({
        action: 'Delete Failed',
        section: 'Collections',
        feature: 'Collection Log',
        details: `Failed to delete collection ID: ${id}`,
        metadata: {
          collectionId: id,
          error: error?.message || 'Unknown error occurred',
          timestamp: new Date().toISOString()
        },
      });

      // Show a more helpful error message
      const errorMessage = error?.message || 'Unknown error occurred';
      if (
        errorMessage.includes('401') ||
        errorMessage.includes('Unauthorized')
      ) {
        toast({
          title: 'Authentication Error',
          description:
            'Your session may have expired. Please refresh the page and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Delete Error',
          description:
            'Failed to delete collection. Please try again.',
          variant: 'destructive',
        });
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      logger.log('=== CLIENT MUTATION DEBUG ===');
      logger.log('Submitting data:', JSON.stringify(data, null, 2));
      trackDataEntry('sandwich_collection', 'collections_log');
      try {
        const result = await apiRequest(
          'POST',
          '/api/sandwich-collections',
          data
        );
        logger.log('API call successful, result:', result);
        return result;
      } catch (error) {
        logger.error('API call failed:', error);
        throw error;
      }
    },
    onSuccess: (response, variables) => {
      const totalSandwiches =
        (variables.individualSandwiches || 0) +
        (variables.groupSandwiches || 0);

      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections/stats'],
      });
      setShowAddForm(false);
      setNewCollectionData({
        collectionDate: '',
        hostName: '',
        individualSandwiches: '',
        groupCollections: '',
      });
      setNewGroupCollections([
        { id: Math.random().toString(36), groupName: '', sandwichCount: 0 },
      ]);
      setNewCollectionGroupOnlyMode(false);

      // Track successful form submission
      trackFormSubmit('collection_form', 'Collections', 'Collection Log', true);
      trackCreate('sandwich_collection', 'Collections', 'Collection Log', response?.id?.toString());

      toast({
        title: 'Collection Successfully Added! 🥪',
        description: `Recorded ${totalSandwiches} sandwiches from ${variables.hostName} on ${new Date(variables.collectionDate).toLocaleDateString()}. Thank you for your contribution!`,
        duration: 5000,
      });
    },
    onError: (error) => {
      // Track failed form submission
      trackFormSubmit('collection_form', 'Collections', 'Collection Log', false);
      trackActivity({
        action: 'Submit Failed',
        section: 'Collections',
        feature: 'Collection Log',
        details: `Failed to create collection: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        },
      });

      toast({
        title: 'Submission Failed',
        description:
          'Failed to add the collection. Please check your permissions and try again.',
        variant: 'destructive',
        duration: 7000,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('csvFile', file);

      const response = await fetch('/api/import-collections', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (result: ImportResult) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      toast({
        title: 'Import completed',
        description: `Successfully imported ${result.successCount} of ${result.totalRecords} records.`,
      });
      if (result.errorCount > 0) {
        logger.log('Import errors:', result.errors);
      }
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: (error) => {
      toast({
        title: 'Import failed',
        description:
          error instanceof Error ? error.message : 'Failed to import CSV file',
        variant: 'destructive',
      });
    },
  });

  const analyzeDuplicatesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(
        'GET',
        '/api/sandwich-collections/analyze-duplicates'
      ) as Promise<DuplicateAnalysis>;
    },
    onSuccess: (result: DuplicateAnalysis) => {
      setDuplicateAnalysis(result);
      setShowDuplicateAnalysis(true);

      const initialKeepIds = new Map<number, number>();
      result.duplicates.forEach((group, index) => {
        initialKeepIds.set(index, group.keepNewest.id);
      });
      setSelectedKeepIds(initialKeepIds);

      toast({
        title: 'Analysis complete',
        description: `Found ${result.totalDuplicateEntries} duplicate entries and ${result.suspiciousPatterns} suspicious patterns.`,
      });
    },
    onError: () => {
      toast({
        title: 'Analysis failed',
        description: 'Failed to analyze duplicates. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const cleanDuplicatesMutation = useMutation({
    mutationFn: async (mode: 'exact' | 'suspicious' | 'og-duplicates') => {
      return apiRequest(
        'DELETE',
        '/api/sandwich-collections/clean-duplicates',
        { mode }
      );
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      setShowDuplicateAnalysis(false);
      setDuplicateAnalysis(null);
      setSelectedSuspiciousIds(new Set());
      setSelectedKeepIds(new Map());
      setSkippedGroups(new Set());
      setDuplicatePage(0);
      toast({
        title: 'Cleanup completed',
        description: `Successfully cleaned ${result.deletedCount} duplicate entries.`,
      });
    },
    onError: () => {
      toast({
        title: 'Cleanup failed',
        description: 'Failed to clean duplicates. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const cleanSelectedSuspiciousMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      return apiRequest('DELETE', '/api/sandwich-collections/clean-selected', {
        ids,
      });
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      setShowDuplicateAnalysis(false);
      setDuplicateAnalysis(null);
      setSelectedSuspiciousIds(new Set());
      setSelectedKeepIds(new Map());
      setSkippedGroups(new Set());
      setDuplicatePage(0);
      toast({
        title: 'Selected entries deleted',
        description: `Successfully deleted ${result.deletedCount} selected entries.`,
      });
    },
    onError: () => {
      toast({
        title: 'Deletion failed',
        description: 'Failed to delete selected entries. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const batchEditMutation = useMutation({
    mutationFn: async (data: {
      ids: number[];
      updates: Partial<SandwichCollection>;
    }) => {
      logger.log('Batch edit request:', data);
      const response = await fetch('/api/sandwich-collections/batch-edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Batch edit error response:', errorData);
        throw new Error(errorData.message || 'Failed to update collections');
      }

      const result = await response.json();
      logger.log('Batch edit success response:', result);
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      setSelectedCollections(new Set());
      setShowBatchEdit(false);
      setBatchEditData({ hostName: '', collectionDate: '' });
      toast({
        title: 'Batch edit completed',
        description: `Successfully updated ${result.updatedCount} of ${result.totalRequested} collections.`,
      });
    },
    onError: (error: any) => {
      logger.error('Batch edit mutation error:', error);
      toast({
        title: 'Batch edit failed',
        description:
          error.message || 'Failed to update collections. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Export function
  const exportToCSV = async () => {
    try {
      // Fetch all collections data for export
      const response = await fetch('/api/sandwich-collections?limit=10000');
      if (!response.ok) throw new Error('Failed to fetch all collections');
      const allCollectionsData = await response.json();
      const allCollections = allCollectionsData.collections || [];

      if (allCollections.length === 0) {
        toast({
          title: 'No data to export',
          description: 'There are no collections to export.',
          variant: 'destructive',
        });
        return;
      }

      // PHASE 5: Format group collections from new column structure
      const formatGroupCollections = (collection: SandwichCollection) => {
        const groups = getGroupCollections(collection);
        if (groups.length === 0) return '';
        return groups
          .map((group) => `${group.groupName}: ${group.sandwichCount}`)
          .join('; ');
      };

      // PHASE 5: Simplified CSV calculations using only new column structure
      const calculateGroupTotalForCSV = (collection: SandwichCollection) => {
        return calculateGroupTotal(collection);
      };

      const calculateTotalForCSV = (collection: SandwichCollection) => {
        return calculateTotal(collection);
      };

      const headers = [
        'ID',
        'Host Name',
        'Collection Date',
        'Individual Sandwiches',
        'Group Sandwiches',
        'Group Collections Detail',
        'Total Sandwiches',
        'Submitted At',
        'Created By',
      ];

      const csvData = [
        headers.join(','),
        ...allCollections.map((collection: SandwichCollection) =>
          [
            collection.id,
            `"${collection.hostName}"`,
            `"${collection.collectionDate}"`,
            collection.individualSandwiches || 0,
            calculateGroupTotalForCSV(collection),
            `"${formatGroupCollections(collection)}"`,
            calculateTotalForCSV(collection),
            `"${new Date(collection.submittedAt).toLocaleString()}"`,
            `"${collection.createdByName || 'Unknown'}"`,
          ].join(',')
        ),
      ].join('\n');

      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `sandwich-collections-complete-${new Date().toISOString().split('T')[0]}.csv`
      );
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'Export successful',
        description: `All ${allCollections.length} collections exported to CSV with complete data including group totals.`,
      });
    } catch (error) {
      logger.error('CSV Export Error:', error);
      toast({
        title: 'Export failed',
        description: 'Failed to export collections data. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const response = await fetch('/api/sandwich-collections/batch-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      return response.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        queryKey: ['/api/sandwich-collections'],
      });
      setSelectedCollections(new Set());
      toast({
        title: 'Batch delete completed',
        description: `Successfully deleted ${result.deletedCount} collections.`,
      });
    },
    onError: () => {
      toast({
        title: 'Batch delete failed',
        description: 'Failed to delete collections. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      importMutation.mutate(file);
    } else {
      toast({
        title: 'Invalid file',
        description: 'Please select a valid CSV file.',
        variant: 'destructive',
      });
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCollections(
        new Set(filteredCollections.map((c: SandwichCollection) => c.id))
      );
    } else {
      setSelectedCollections(new Set());
    }
  };

  const handleSelectCollection = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedCollections);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedCollections(newSelected);
  };

  const handleBatchEdit = () => {
    if (selectedCollections.size === 0) {
      toast({
        title: 'No collections selected',
        description: 'Please select collections to edit.',
        variant: 'destructive',
      });
      return;
    }

    // Track batch edit button click
    trackClick('batch_edit_button', 'Collections', 'Collection Log', `Opening batch edit for ${selectedCollections.size} collections`);
    trackActivity({
      action: 'Click',
      section: 'Collections',
      feature: 'Collection Log',
      details: 'Opened batch edit dialog',
      metadata: {
        selectedCount: selectedCollections.size,
        selectedIds: Array.from(selectedCollections),
        timestamp: new Date().toISOString()
      },
    });

    setShowBatchEdit(true);
  };

  const submitBatchEdit = () => {
    logger.log('submitBatchEdit called with batchEditData:', batchEditData);
    logger.log('selectedCollections:', Array.from(selectedCollections));

    const updates: Partial<SandwichCollection> = {};
    if (batchEditData.hostName) updates.hostName = batchEditData.hostName;
    if (batchEditData.collectionDate)
      updates.collectionDate = batchEditData.collectionDate;

    logger.log('Prepared updates:', updates);

    if (Object.keys(updates).length === 0) {
      logger.log('No updates to apply');
      toast({
        title: 'No changes specified',
        description: 'Please specify at least one field to update.',
        variant: 'destructive',
      });
      return;
    }

    logger.log('Submitting batch edit with:', {
      ids: Array.from(selectedCollections),
      updates,
    });

    batchEditMutation.mutate({
      ids: Array.from(selectedCollections),
      updates,
    });
  };

  const handleBatchDelete = () => {
    if (selectedCollections.size === 0) {
      toast({
        title: 'No collections selected',
        description: 'Please select collections to delete.',
        variant: 'destructive',
      });
      return;
    }

    // Track batch delete button click
    trackClick('batch_delete_button', 'Collections', 'Collection Log', `Attempting to delete ${selectedCollections.size} collections`);

    if (
      confirm(
        `Are you sure you want to delete ${selectedCollections.size} selected collections? This action cannot be undone.`
      )
    ) {
      // Track confirmed batch delete
      trackActivity({
        action: 'Batch Delete',
        section: 'Collections',
        feature: 'Collection Log',
        details: `Confirmed batch deletion of ${selectedCollections.size} collections`,
        metadata: {
          selectedCount: selectedCollections.size,
          selectedIds: Array.from(selectedCollections),
          timestamp: new Date().toISOString()
        },
      });

      batchDeleteMutation.mutate(Array.from(selectedCollections));
    }
  };

  const handleEdit = (collection: SandwichCollection) => {
    setEditingCollection(collection);

    // Track edit button click
    trackClick('edit_collection_button', 'Collections', 'Collection Log', `Editing collection ID: ${collection.id}`);

    // Check if individual type breakdown exists
    const hasIndividualBreakdown = !!(collection.individualDeli || collection.individualPbj || (collection as any).individualGeneric);
    setShowEditIndividualBreakdown(hasIndividualBreakdown);

    setEditFormData({
      collectionDate: collection.collectionDate,
      hostName: collection.hostName,
      individualSandwiches: collection.individualSandwiches.toString(),
      groupCollections: '', // Not used with new schema
      individualDeli: collection.individualDeli?.toString() || '',
      individualPbj: collection.individualPbj?.toString() || '',
      individualGeneric: (collection as any).individualGeneric?.toString() || '',
    });

    // Parse existing group collections from new schema fields
    const groupList = [];

    // First try to read from the new groupCollections array
    if (
      collection.groupCollections &&
      Array.isArray(collection.groupCollections) &&
      collection.groupCollections.length > 0
    ) {
      collection.groupCollections.forEach((group: any, index: number) => {
        if (group.name && group.count > 0) {
          const hasTypeData = !!(group.deli || group.pbj || group.generic);
          const groupData: any = {
            id: `edit-${index + 1}`,
            groupName: group.name,
            department: group.department || '', // Preserve department field
            sandwichCount: group.count,
            hasTypeBreakdown: hasTypeData, // Track if this group has type breakdown
          };

          // Include type breakdown if available
          if (hasTypeData) {
            groupData.deli = group.deli || 0;
            groupData.pbj = group.pbj || 0;
            groupData.generic = group.generic || 0;
          }

          groupList.push(groupData);
        }
      });
    } else {
      // Fall back to legacy group1/group2 fields for backward compatibility
      if (collection.group1Name && collection.group1Count) {
        groupList.push({
          id: 'edit-1',
          groupName: collection.group1Name,
          sandwichCount: collection.group1Count,
          hasTypeBreakdown: false,
        });
      }
      if (collection.group2Name && collection.group2Count) {
        groupList.push({
          id: 'edit-2',
          groupName: collection.group2Name,
          sandwichCount: collection.group2Count,
          hasTypeBreakdown: false,
        });
      }
    }

    if (groupList.length > 0) {
      setEditGroupCollections(groupList);
    } else {
      setEditGroupCollections([
        { id: 'edit-1', groupName: '', sandwichCount: 0 },
      ]);
    }
  };

  const handleUpdate = () => {
    if (!editingCollection) return;

    // Check for individual breakdown validation errors
    if (editIndividualBreakdownError) {
      toast({ 
        title: 'Invalid individual breakdown', 
        description: editIndividualBreakdownError,
        variant: 'destructive' 
      });
      return;
    }

    // Check for group breakdown validation errors
    if (editGroupBreakdownErrors.size > 0) {
      const firstError = Array.from(editGroupBreakdownErrors.values())[0];
      toast({ 
        title: 'Invalid group breakdown', 
        description: firstError,
        variant: 'destructive' 
      });
      return;
    }

    // Convert editGroupCollections to new schema format
    const validGroups = editGroupCollections.filter(
      (g) => g.groupName.trim() && (g.sandwichCount ?? 0) > 0
    );

    // Prepare groupCollections array for unlimited groups with type breakdown
    const groupCollections = validGroups.map((group) => {
      const groupData: any = {
        name: group.groupName,
        count: group.sandwichCount,
      };

      // Include department if present
      if (group.department && group.department.trim()) {
        groupData.department = group.department.trim();
      }

      // Only include type breakdown if this group has it enabled
      if (group.hasTypeBreakdown && (group.deli || group.pbj || group.generic)) {
        groupData.deli = group.deli || 0;
        groupData.pbj = group.pbj || 0;
        groupData.generic = group.generic || 0;
      }

      return groupData;
    });

    const updates: any = {
      collectionDate: editFormData.collectionDate,
      hostName: editFormData.hostName,
      individualSandwiches: parseInt(editFormData.individualSandwiches) || 0,
      // Include individual type breakdown
      individualDeli: parseInt(editFormData.individualDeli) || 0,
      individualPbj: parseInt(editFormData.individualPbj) || 0,
      individualGeneric: parseInt(editFormData.individualGeneric) || 0,
      // Include the new unlimited groups array
      groupCollections: groupCollections,
      // Keep legacy fields for backward compatibility (first 2 groups only)
      group1Name: validGroups[0]?.groupName || null,
      group1Count: validGroups[0]?.sandwichCount || null,
      group2Name: validGroups[1]?.groupName || null,
      group2Count: validGroups[1]?.sandwichCount || null,
    };

    updateMutation.mutate({
      id: editingCollection.id,
      updates,
    });
  };

  // Helper functions for edit group collections
  const addEditGroupRow = () => {
    const newId = `edit-${Date.now()}`;
    setEditGroupCollections([
      ...editGroupCollections,
      { id: newId, groupName: '', sandwichCount: 0, hasTypeBreakdown: false },
    ]);

    // Track group addition
    trackClick('add_group_button', 'Collections', 'Collection Log', 'Added group row in edit form');
    trackActivity({
      action: 'Add Group',
      section: 'Collections',
      feature: 'Collection Log',
      details: 'Added new group row in edit collection form',
      metadata: {
        formType: 'edit',
        totalGroups: editGroupCollections.length + 1,
        timestamp: new Date().toISOString()
      },
    });
  };

  const removeEditGroupRow = (id: string) => {
    if (editGroupCollections.length > 1) {
      setEditGroupCollections(
        editGroupCollections.filter((group) => group.id !== id)
      );

      // Track group removal
      trackClick('remove_group_button', 'Collections', 'Collection Log', 'Removed group row in edit form');
    }
  };

  const updateEditGroupCollection = (
    id: string,
    field: 'groupName' | 'department' | 'sandwichCount',
    value: string | number
  ) => {
    setEditGroupCollections(
      editGroupCollections.map((group) =>
        group.id === id ? { ...group, [field]: value } : group
      )
    );
  };

  // Calculator functions for edit form
  const safeMathEvaluator = (expression: string): number => {
    const sanitized = expression.replace(/[^0-9+\-*/().]/g, '');
    if (!sanitized || sanitized === '') return 0;
    
    const tokens: (number | string)[] = [];
    let currentNumber = '';
    
    for (const char of sanitized) {
      if ('0123456789.'.includes(char)) {
        currentNumber += char;
      } else if ('+-*/'.includes(char)) {
        if (currentNumber) {
          tokens.push(parseFloat(currentNumber));
          currentNumber = '';
        }
        tokens.push(char);
      }
    }
    if (currentNumber) {
      tokens.push(parseFloat(currentNumber));
    }
    
    const evaluateTokens = (tokenList: (number | string)[]): number => {
      // First pass: handle * and /
      let i = 0;
      while (i < tokenList.length) {
        if (tokenList[i] === '*' || tokenList[i] === '/') {
          const left = tokenList[i - 1] as number;
          const right = tokenList[i + 1] as number;
          const result = tokenList[i] === '*' ? left * right : left / right;
          tokenList.splice(i - 1, 3, result);
          i--;
        }
        i++;
      }
      
      // Second pass: handle + and -
      let result = tokenList[0] as number;
      for (let j = 1; j < tokenList.length; j += 2) {
        const operator = tokenList[j];
        const operand = tokenList[j + 1] as number;
        if (operator === '+') result += operand;
        else if (operator === '-') result -= operand;
      }
      
      return result;
    };
    
    return evaluateTokens([...tokens]);
  };

  const handleEditCalcInput = (value: string) => {
    if (value === '=') {
      try {
        const result = safeMathEvaluator(editCalcDisplay);
        const rounded = Math.round(result);
        setEditCalcDisplay(rounded.toString());
      } catch {
        setEditCalcDisplay('Error');
      }
    } else if (value === 'C') {
      setEditCalcDisplay('');
    } else if (value === '←') {
      setEditCalcDisplay(editCalcDisplay.slice(0, -1));
    } else {
      setEditCalcDisplay(editCalcDisplay + value);
    }
  };

  const openEditCalculator = (fieldId: string, currentValue: string | number) => {
    setEditActiveCalcField(fieldId);
    setEditCalcDisplay(currentValue ? currentValue.toString() : '');
  };

  const EditCalculatorPopover = ({
    fieldId,
    onUseResult,
    children
  }: {
    fieldId: string;
    onUseResult: () => void;
    children: React.ReactNode;
  }) => (
    <Popover
      open={editActiveCalcField === fieldId}
      onOpenChange={(open) => {
        if (!open) {
          setEditActiveCalcField(null);
          setEditCalcDisplay('');
        }
      }}
    >
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start" side="bottom">
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            Calculate your count (e.g., 150 - 25 = 125)
          </p>

          <input
            type="text"
            value={editCalcDisplay}
            readOnly
            className="w-full h-9 px-3 border border-gray-200 rounded text-right bg-gray-50 text-sm"
            placeholder="Enter calculation..."
          />

          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              className="h-9 border rounded bg-brand-primary text-white text-sm font-semibold hover:bg-brand-primary/90"
              onClick={() => handleEditCalcInput('C')}
            >
              C
            </button>
            <button
              type="button"
              className="h-9 border rounded bg-brand-primary text-white text-sm font-semibold hover:bg-brand-primary/90"
              onClick={() => handleEditCalcInput('←')}
            >
              ←
            </button>
            <button
              type="button"
              className="h-9 border rounded bg-white hover:bg-gray-50 text-sm"
              onClick={() => handleEditCalcInput('/')}
            >
              /
            </button>
            <button
              type="button"
              className="h-9 border rounded bg-white hover:bg-gray-50 text-sm"
              onClick={() => handleEditCalcInput('*')}
            >
              ×
            </button>

            {['7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3'].map((btn) => (
              <button
                key={btn}
                type="button"
                className="h-9 border rounded bg-white hover:bg-gray-50 text-sm"
                onClick={() => handleEditCalcInput(btn)}
              >
                {btn}
              </button>
            ))}
            <button
              type="button"
              className="h-9 border rounded bg-white hover:bg-gray-50 text-sm"
              onClick={() => handleEditCalcInput('=')}
            >
              =
            </button>
            <button
              type="button"
              className="h-9 border rounded bg-white hover:bg-gray-50 text-sm col-span-2"
              onClick={() => handleEditCalcInput('0')}
            >
              0
            </button>
            <button
              type="button"
              className="h-9 border rounded bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
              onClick={() => {
                onUseResult();
                setEditActiveCalcField(null);
                setEditCalcDisplay('');
              }}
            >
              Use
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  const handleDelete = (id: number) => {
    // Delete is now triggered by ConfirmationDialog's onConfirm
    deleteMutation.mutate(id);
  };

  const handleNewCollectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // In group-only mode, we only require collection date and group collections
    if (newCollectionGroupOnlyMode) {
      if (!newCollectionData.collectionDate) {
        toast({
          title: 'Missing information',
          description: 'Please fill in the collection date.',
          variant: 'destructive',
        });
        return;
      }

      const validGroupCollections = newGroupCollections.filter(
        (g) => g.sandwichCount > 0
      );

      if (validGroupCollections.length === 0) {
        toast({
          title: 'Missing group collections',
          description:
            'Please add at least one group collection with a sandwich count.',
          variant: 'destructive',
        });
        return;
      }
    } else {
      // Regular mode requires host name and collection date
      if (!newCollectionData.collectionDate || !newCollectionData.hostName) {
        toast({
          title: 'Missing required fields',
          description: 'Please fill in the collection date and host name.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Format group collections to match the new schema (separate columns)
    const validGroupCollections = newGroupCollections.filter(
      (group) => group.sandwichCount > 0
    );

    const submissionData = {
      collectionDate: newCollectionData.collectionDate,
      hostName: newCollectionGroupOnlyMode
        ? 'Groups - Unassigned'
        : newCollectionData.hostName,
      individualSandwiches: newCollectionGroupOnlyMode
        ? 0
        : parseInt(newCollectionData.individualSandwiches) || 0,
      // New schema: separate group columns (snake_case to match database)
      group1_name: validGroupCollections[0]?.groupName.trim() ?? null,
      group1_count: validGroupCollections[0]?.sandwichCount ?? null,
      group2_name: validGroupCollections[1]?.groupName.trim() ?? null,
      group2_count: validGroupCollections[1]?.sandwichCount ?? null,
    };

    createMutation.mutate(submissionData);
  };

  const addNewGroupRow = () => {
    setNewGroupCollections([
      ...newGroupCollections,
      {
        id: Math.random().toString(36),
        groupName: '',
        sandwichCount: 0,
      },
    ]);

    // Track group addition
    trackClick('add_group_button', 'Collections', 'Collection Log', 'Added group row in new collection form');
    trackActivity({
      action: 'Add Group',
      section: 'Collections',
      feature: 'Collection Log',
      details: 'Added new group row in new collection form',
      metadata: {
        formType: 'new',
        totalGroups: newGroupCollections.length + 1,
        timestamp: new Date().toISOString()
      },
    });
  };

  const removeNewGroupRow = (id: string) => {
    if (newGroupCollections.length > 1) {
      setNewGroupCollections(
        newGroupCollections.filter((group) => group.id !== id)
      );

      // Track group removal
      trackClick('remove_group_button', 'Collections', 'Collection Log', 'Removed group row in new collection form');
    }
  };

  const updateNewGroupCollection = (
    id: string,
    field: 'groupName' | 'sandwichCount',
    value: string | number
  ) => {
    setNewGroupCollections(
      newGroupCollections.map((group) =>
        group.id === id ? { ...group, [field]: value } : group
      )
    );
  };

  // Handler functions that reset page when sorting/filtering
  const handleSortChange = (field: keyof SandwichCollection) => {
    setSortConfig((prev) => ({ ...prev, field }));
    setCurrentPage(1);
  };

  const handleSortDirectionChange = () => {
    setSortConfig((prev) => ({
      ...prev,
      direction: prev.direction === 'asc' ? 'desc' : 'asc',
    }));
    setCurrentPage(1);
  };

  const handleFilterChange = (filterUpdates: Partial<typeof searchFilters>) => {
    logger.log('Filter change:', filterUpdates);
    setSearchFilters((prev) => {
      const newFilters = { ...prev, ...filterUpdates };
      logger.log('New search filters:', newFilters);
      return newFilters;
    });
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    // Track clear filters button click
    trackClick('clear_filters_button', 'Collections', 'Collection Log', 'Cleared all filters');

    const emptyFilters = {
      globalSearch: '',
      hostName: '',
      groupName: '',
      collectionDateFrom: '',
      collectionDateTo: '',
      createdAtFrom: '',
      createdAtTo: '',
    };
    setSearchFilters(emptyFilters);
    setDebouncedSearchFilters(emptyFilters);
    setSortConfig({ field: 'collectionDate', direction: 'desc' });
    setCurrentPage(1);
    setShowFilters(false);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="h-6 bg-slate-200 rounded animate-pulse"></div>
        </div>
        <div className="p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-lg p-4 space-y-3"
            >
              <div className="h-4 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-3 bg-slate-100 rounded animate-pulse"></div>
              <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-3 sm:px-6 py-4 border-b border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-slate-900 flex items-center">
              <img
                src={sandwichLogo}
                alt="Sandwich Logo"
                className="mr-2 w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0"
              />
              <span className="truncate">Collections</span>
            </h2>
            <p className="text-sm sm:text-base text-slate-500 mt-1">
              Manage collection data and bulk operations
            </p>
          </div>
          {canEditData && (
            <Button
              onClick={() => setShowDataManagement(true)}
              variant="outline"
              size="sm"
              className="flex items-center space-x-2 w-full sm:w-auto btn-outline-tsp h-10 text-base"
              style={{
                borderColor: 'var(--color-brand-teal)',
                color: 'var(--color-brand-teal)',
              }}
            >
              <Database className="w-4 h-4" />
              <span className="hidden sm:inline">Data Management</span>
              <span className="sm:hidden">Data</span>
            </Button>
          )}
        </div>
      </div>

      <div className="px-3 sm:px-6 py-4">
        {/* Weekly Collective Learning auto-log controls (admins only) */}
        {user?.role &&
          ['admin', 'super_admin', 'admin_coordinator'].includes(user.role) && (
            <CollectiveLearningAutoLogCard />
          )}

        {/* Role-customized view indicator */}
        {user?.role && user.role !== 'super_admin' && user.role !== 'admin' && (
          <div className="mb-4 p-3 rounded border-l-4" style={{
            backgroundColor: 'rgba(0, 126, 140, 0.08)',
            borderLeftColor: '#007E8C'
          }}>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#007E8C' }} />
              <p className="text-sm" style={{ color: '#236383' }}>
                {getRoleViewDescription(user.role, 'collections')}
              </p>
            </div>
          </div>
        )}

        {/* Global Search Field - Prominent placement at top.
            Includes a "?" affordance because the placeholder can't
            comfortably list every searchable field. Hovering / tapping
            the icon reveals the full set so users know they can search
            by date range, group name, etc. — not just the three things
            the placeholder names. */}
        <div className="mb-6">
          <div className="relative max-w-md mx-auto flex items-center gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Scan className="h-5 w-5 text-slate-400" />
              </div>
              <Input
                data-testid="input-global-search"
                type="text"
                placeholder="Search hosts, organizations, submitters..."
                value={searchFilters.globalSearch}
                onChange={(e) =>
                  setSearchFilters((prev) => ({
                    ...prev,
                    globalSearch: e.target.value,
                  }))
                }
                className="pl-10 pr-4 py-3 w-full border-2 border-slate-300 focus:border-blue-500 focus:ring-brand-primary-muted rounded-lg text-base"
              />
              {searchFilters.globalSearch && (
                <button
                  data-testid="button-clear-global-search"
                  onClick={() =>
                    setSearchFilters((prev) => ({ ...prev, globalSearch: '' }))
                  }
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="What can I search?"
                  data-testid="button-search-help"
                  className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-[#236383] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary-muted"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                className="w-72 text-sm"
              >
                <p className="font-semibold text-[#236383] mb-2">
                  What can I search?
                </p>
                <p className="text-slate-600 mb-2 text-xs">
                  This search box matches any of the fields below — partial
                  matches work too.
                </p>
                <ul className="space-y-1 text-xs text-slate-700">
                  <li>
                    <span className="font-semibold">Host name</span> &nbsp;
                    <span className="text-slate-500">e.g. Alpharetta</span>
                  </li>
                  <li>
                    <span className="font-semibold">Organization</span> &nbsp;
                    <span className="text-slate-500">e.g. Boy Scouts</span>
                  </li>
                  <li>
                    <span className="font-semibold">Submitter</span> &nbsp;
                    <span className="text-slate-500">person who logged it</span>
                  </li>
                  <li>
                    <span className="font-semibold">Group name</span> &nbsp;
                    <span className="text-slate-500">inside group breakdowns</span>
                  </li>
                  <li>
                    <span className="font-semibold">Date</span> &nbsp;
                    <span className="text-slate-500">
                      try <code>2026</code>, <code>Jan 2026</code>, <code>1/15</code>
                    </span>
                  </li>
                </ul>
              </PopoverContent>
            </Popover>
          </div>
          {searchFilters.globalSearch && (
            <p className="text-center text-base text-slate-600 mt-2">
              Searching across hosts, organizations, submitters, group names, and dates
            </p>
          )}

          {/* Quick-filter chips — one-tap shortcuts that compose with the
              global search and advanced filters above. Each chip narrows the
              current result set; selecting a different chip swaps the filter
              rather than stacking (single-select). "All" is the default. */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'host', label: 'Host Collections' },
                { value: 'group', label: 'Group Collections' },
                { value: 'thisMonth', label: 'This Month' },
                { value: 'last30Days', label: 'Last 30 Days' },
                { value: 'mine', label: 'My Submissions' },
              ] as Array<{ value: typeof quickFilter; label: string }>
            ).map(({ value, label }) => {
              const isActive = quickFilter === value;
              // Hide "My Submissions" if there's no signed-in user — clicking
              // it would otherwise just produce an empty list.
              if (value === 'mine' && !user?.id) return null;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setQuickFilter(value);
                    setCurrentPage(1); // Reset pagination so the user sees results from the top
                  }}
                  data-testid={`chip-quick-filter-${value}`}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    isActive
                      ? 'bg-[#007E8C] text-white border-[#007E8C] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-[#007E8C] hover:text-[#007E8C]'
                  }`}
                  aria-pressed={isActive}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 mb-4">
          {/* Enhanced Display-Friendly Stats with Filtered Stats Support */}
          <div className="space-y-4">
            {/* Filter Status and Context */}
            {hasActiveFilters && (
              <div className="bg-brand-primary-lighter border border-brand-primary-border rounded-lg p-3 text-base">
                <div className="flex items-center text-brand-primary-dark">
                  <Filter className="w-4 h-4 mr-2" />
                  <span className="font-medium">
                    {currentStats.hostName
                      ? `Statistics for ${currentStats.hostName}`
                      : quickFilterLabel
                        ? `Statistics for ${quickFilterLabel}`
                        : 'Filtered Statistics'}
                  </span>
                </div>
                {currentStats.dateRange && (
                  <div className="text-brand-primary mt-1 text-sm">
                    Date range: {currentStats.dateRange.earliest} -{' '}
                    {currentStats.dateRange.latest}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <p className="text-base text-slate-500 font-medium">
                  {hasActiveFilters
                    ? `${currentStats.totalEntries}`
                    : `${totalItems}`}
                  {hasActiveFilters ? ' filtered' : ''} entries
                </p>
                {hasActiveFilters && !currentStats.hostName && (
                  <span className="text-sm text-brand-primary bg-brand-primary-light px-2 py-1 rounded-full">
                    Multiple Hosts
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-xl sm:text-2xl font-black text-[#FBAD3F] drop-shadow-sm">
                  {currentStats.completeTotalSandwiches.toLocaleString()}
                </div>
                <div className="text-base font-semibold text-[#FBAD3F] uppercase tracking-wide">
                  {hasActiveFilters ? 'Filtered' : 'Total'} Sandwiches
                </div>
              </div>
            </div>

            {/* Statistics Display */}
            <div
              className={`flex justify-center gap-4 sm:gap-8 rounded-xl py-4 px-4 sm:px-6 border shadow-sm ${
                hasActiveFilters
                  ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-brand-primary-border'
                  : 'bg-gradient-to-r from-teal-50 to-yellow-50 border-yellow-200'
              }`}
            >
              <div className="text-center">
                <div
                  className={`text-lg sm:text-xl font-bold drop-shadow-sm ${
                    hasActiveFilters ? 'text-brand-primary' : 'text-teal-700'
                  }`}
                >
                  {currentStats.individualSandwiches.toLocaleString()}
                </div>
                <div
                  className={`text-base font-semibold uppercase tracking-wide mt-1 ${
                    hasActiveFilters ? 'text-brand-primary' : 'text-teal-600'
                  }`}
                >
                  Individual
                </div>
              </div>
              <div
                className={`w-px bg-gradient-to-b ${
                  hasActiveFilters
                    ? 'from-blue-300 to-indigo-300'
                    : 'from-teal-300 to-yellow-300'
                }`}
              ></div>
              <div className="text-center">
                <div
                  className={`text-lg sm:text-xl font-bold drop-shadow-sm ${
                    hasActiveFilters ? 'text-indigo-600' : 'text-[#FBAD3F]'
                  }`}
                >
                  {currentStats.groupSandwiches.toLocaleString()}
                </div>
                <div
                  className={`text-base font-semibold uppercase tracking-wide mt-1 ${
                    hasActiveFilters ? 'text-indigo-600' : 'text-[#FBAD3F]'
                  }`}
                >
                  Groups
                </div>
              </div>
            </div>

            {/* Global Stats Reference when filtering */}
            {hasActiveFilters && totalStats && (
              <div className="text-center text-sm text-slate-500 border-t pt-3">
                <span>
                  Global totals:{' '}
                  {totalStats.completeTotalSandwiches.toLocaleString()}{' '}
                  sandwiches across {totalStats.totalEntries} entries
                </span>
              </div>
            )}
          </div>

          {/* Action buttons - Mobile optimized */}
          <div className="flex flex-col sm:flex-row gap-2">
            {canCreateCollections && (
              <>
                <HelpBubble
                  title="Recording Collections"
                  content="Click here to submit new sandwich collection data. Fill in the host location, date, and sandwich counts to track your impact!"
                  character="sandy"
                  position="bottom"
                  trigger="hover"
                >
                  <Button
                    data-tour="add-collection"
                    onClick={() => setShowSubmitForm(!showSubmitForm)}
                    variant="default"
                    size="sm"
                    className="flex items-center justify-center space-x-2 w-full sm:w-auto bg-brand-primary hover:bg-brand-primary-dark py-4 px-6 !text-lg sm:!text-base min-h-[56px] sm:min-h-[40px]"
                  >
                    <Sandwich className="w-5 h-5 sm:w-4 sm:h-4" />
                    <span className="font-medium">
                      {showSubmitForm ? 'Hide Form' : 'Enter New Collection Data'}
                    </span>
                  </Button>
                </HelpBubble>
                <HelpBubble
                  title="Photo Scanner"
                  content="Take a photo of your handwritten sign-in sheet and let AI extract the collection data automatically!"
                  character="guide"
                  position="bottom"
                  trigger="hover"
                >
                  <Link href="/photo-scanner">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center justify-center space-x-2 w-full sm:w-auto py-4 px-6 !text-lg sm:!text-base min-h-[56px] sm:min-h-[40px] bg-white border-brand-primary text-brand-primary hover:bg-brand-primary/5"
                    >
                      <Camera className="w-5 h-5 sm:w-4 sm:h-4" />
                      <span className="font-medium">Scan Sign-in Sheet</span>
                    </Button>
                  </Link>
                </HelpBubble>
              </>
            )}
            <HelpBubble
              title="Filter Collections"
              content="Use these filters to search and sort your collection data by date, host, or other criteria. Perfect for finding specific entries!"
              character="guide"
              position="bottom"
              trigger="hover"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center space-x-1 w-full sm:w-auto justify-center py-2.5 bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                <Filter className="w-4 h-4" />
                <span>Filter</span>
              </Button>
            </HelpBubble>
            {canEditData && (
              <Button
                onClick={() => setShowDataManagement(true)}
                variant="outline"
                size="sm"
                className="flex items-center space-x-2 w-full sm:w-auto justify-center py-2.5 bg-white border-teal-400 text-teal-600 hover:bg-teal-50"
              >
                <Database className="w-4 h-4" />
                <span className="hidden sm:inline">Data Management</span>
                <span className="sm:hidden">Data</span>
              </Button>
            )}
            {selectedCollections.size > 0 && canEditData && (
              <div className="flex flex-col xs:flex-row gap-2 w-full mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchEdit}
                  className="flex items-center flex-1 justify-center py-2.5 bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  <span>Edit ({selectedCollections.size})</span>
                </Button>
                {canDeleteData && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBatchDelete}
                    className="flex items-center flex-1 justify-center py-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 bg-white border-gray-300"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    <span>Delete ({selectedCollections.size})</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Submit Collection Form - Full width */}
      {showSubmitForm && (
        <div className="mb-4">
          <CollectionFormSelector
            onSuccess={() => {
              setShowSubmitForm(false);
              queryClient.invalidateQueries({
                queryKey: ['/api/sandwich-collections'],
              });
            }}
            onCancel={() => setShowSubmitForm(false)}
          />
        </div>
      )}

      {/* Filter Panel */}
      {showFilters && (
        <div className="px-3 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div>
              <Label
                htmlFor="hostFilter"
                className="text-base font-medium text-slate-700"
              >
                Host/Location Name
              </Label>
              <Input
                id="hostFilter"
                data-testid="input-filter-host"
                placeholder="Search by host name..."
                value={searchFilters.hostName}
                onChange={(e) =>
                  handleFilterChange({ hostName: e.target.value })
                }
                className="mt-1"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    handleFilterChange({ hostName: 'OG Sandwich Project' })
                  }
                  className="px-3 py-1 text-sm bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
                >
                  👑 Historical OG Project
                </button>
                <button
                  onClick={() => handleFilterChange({ hostName: '' })}
                  className="px-3 py-1 text-sm bg-slate-100 text-slate-700 border border-slate-300 rounded-full hover:bg-slate-200 transition-colors"
                >
                  All Locations
                </button>
              </div>
            </div>
            <div>
              <Label
                htmlFor="groupFilter"
                className="text-base font-medium text-slate-700"
              >
                Group Name
              </Label>
              <Input
                id="groupFilter"
                data-testid="input-filter-group"
                placeholder="Search by group name..."
                value={searchFilters.groupName}
                onChange={(e) =>
                  handleFilterChange({ groupName: e.target.value })
                }
                className="mt-1"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => handleFilterChange({ groupName: '' })}
                  className="px-3 py-1 text-sm bg-slate-100 text-slate-700 border border-slate-300 rounded-full hover:bg-slate-200 transition-colors"
                >
                  All Groups
                </button>
              </div>
            </div>
            <div>
              <Label
                htmlFor="collectionFromDate"
                className="text-base font-medium text-slate-700"
              >
                Collection Date From
              </Label>
              <Input
                id="collectionFromDate"
                data-testid="input-filter-date-from"
                type="date"
                value={searchFilters.collectionDateFrom}
                onChange={(e) =>
                  handleFilterChange({ collectionDateFrom: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label
                htmlFor="collectionToDate"
                className="text-base font-medium text-slate-700"
              >
                Collection Date To
              </Label>
              <Input
                id="collectionToDate"
                data-testid="input-filter-date-to"
                type="date"
                value={searchFilters.collectionDateTo}
                onChange={(e) =>
                  handleFilterChange({ collectionDateTo: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label
                htmlFor="createdFromDate"
                className="text-base font-medium text-slate-700"
              >
                Created Date From
              </Label>
              <Input
                id="createdFromDate"
                data-testid="input-filter-created-from"
                type="date"
                value={searchFilters.createdAtFrom}
                onChange={(e) =>
                  handleFilterChange({ createdAtFrom: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label
                htmlFor="createdToDate"
                className="text-base font-medium text-slate-700"
              >
                Created Date To
              </Label>
              <Input
                id="createdToDate"
                data-testid="input-filter-created-to"
                type="date"
                value={searchFilters.createdAtTo}
                onChange={(e) =>
                  handleFilterChange({ createdAtTo: e.target.value })
                }
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-4 gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="text-base text-slate-600">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, totalItems)} of{' '}
                {totalItems} entries
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                <Label className="text-base font-medium text-slate-700">
                  Sort by:
                </Label>
                <div className="flex items-center space-x-2">
                  <Select
                    value={sortConfig.field}
                    onValueChange={(value) =>
                      handleSortChange(value as keyof SandwichCollection)
                    }
                  >
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="collectionDate">
                        Collection Date
                      </SelectItem>
                      <SelectItem value="hostName">Host Name</SelectItem>
                      <SelectItem value="individualSandwiches">
                        Sandwich Count
                      </SelectItem>
                      <SelectItem value="submittedAt">Created Date</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSortDirectionChange}
                    className="flex items-center space-x-1"
                  >
                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    <span className="hidden sm:inline">
                      {sortConfig.direction === 'asc' ? 'Asc' : 'Desc'}
                    </span>
                  </Button>
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="flex items-center space-x-1 w-full sm:w-auto bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
            >
              <X className="w-4 h-4" />
              <span>Clear Filters</span>
            </Button>
          </div>
        </div>
      )}

      {/* Top Pagination Controls */}
      {totalItems > 0 && <PaginationControls position="top" />}

      <div className="p-6">
        {paginatedCollections.length > 0 && (
          <div className="flex items-center space-x-3 mb-4 pb-3 border-b border-slate-200">
            <button
              onClick={() =>
                handleSelectAll(
                  !selectedCollections.size ||
                    selectedCollections.size < filteredCollections.length
                )
              }
              className="flex items-center space-x-2 text-base text-slate-600 hover:text-slate-900"
            >
              {selectedCollections.size === filteredCollections.length ? (
                <SquareCheck className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>Select All</span>
            </button>
            {selectedCollections.size > 0 && (
              <span className="text-base text-slate-500">
                {selectedCollections.size} of {filteredCollections.length}{' '}
                selected
              </span>
            )}
          </div>
        )}
        <div className="space-y-2" data-tour="collections-table">
          {paginatedCollections.map((collection: SandwichCollection) => {
            const groupData = getGroupCollections(collection);
            const totalSandwiches = calculateTotal(collection);
            const isSelected = selectedCollections.has(collection.id);

            // Check if the host is inactive
            const hostData = hostsList.find(
              (h) => h.name === collection.hostName
            );
            const isInactiveHost = hostData?.status === 'inactive';

            return (
              <div
                key={collection.id}
                // py-4 → py-3 trims 8px per card; gap reduced inside.
                className={`border-b py-3 px-3 hover:bg-slate-50 transition-colors ${
                  isSelected
                    ? 'bg-brand-primary-lighter'
                    : isInactiveHost
                      ? 'bg-gray-50 opacity-70'
                      : ''
                }`}
              >
                {/* Responsive layout: vertical stack for all rows.
                    gap-3 → gap-2 saves 4px per card across 3 row breaks. */}
                <div className="flex flex-col gap-2">
                  {/* First Row: Checkbox, Date, Host */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Checkbox */}
                    {(canEditAllCollections ||
                      canEditCollection(user, collection)) && (
                      <button
                        onClick={() =>
                          handleSelectCollection(collection.id, !isSelected)
                        }
                        className="flex items-center shrink-0"
                      >
                        {isSelected ? (
                          <SquareCheck className="w-5 h-5 text-brand-primary" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                        )}
                      </button>
                    )}

                    {/* Date - American format (Oct 1, 2025) */}
                    <div className="shrink-0">
                      <span className="text-sm lg:text-base font-semibold text-slate-700 whitespace-nowrap">
                        {formatDate(collection.collectionDate)}
                      </span>
                    </div>

                    {/* Location/Host */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm lg:text-base font-medium text-slate-900 break-words">
                          {collection.hostName}
                        </span>
                        {collection.hostName === 'OG Sandwich Project' && (
                          <span className="text-xs bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 px-2 py-1 rounded-full font-medium border border-amber-300 shrink-0">
                            👑
                          </span>
                        )}
                        {isInactiveHost && (
                          <span className="text-xs bg-gray-300 text-gray-800 px-2 py-1 rounded-full font-medium shrink-0">
                            INACTIVE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Second Row: Individual & Group Event.
                      Empty columns now collapse instead of reserving 64px of
                      placeholder space, and the min-h-[88px] anchor is gone —
                      content drives height. A record with only Individual or
                      only Group Event no longer carries dead air in the other
                      column. Saves roughly 64-88px on any single-type card. */}
                  <div className="flex flex-col gap-2 md:grid md:grid-cols-[160px_minmax(0,1fr)] md:gap-4 items-start ml-0 sm:ml-4 md:ml-12 lg:ml-20">
                    {/* Individual — render only when there's a value */}
                    {collection.individualSandwiches > 0 && (
                      <div className="w-full sm:min-w-[160px] sm:pl-3 md:pl-4">
                        <div className="text-xs text-slate-500 mb-0.5 font-semibold uppercase tracking-wide">Individual</div>
                        <div className="text-base lg:text-lg font-bold">
                          {(() => {
                            const hasTypes = collection.individualDeli || collection.individualPbj || (collection as any).individualGeneric;
                            if (hasTypes) {
                              return (
                                <div className="space-y-0.5">
                                  {(collection.individualDeli ?? 0) > 0 && <div>{collection.individualDeli} Deli</div>}
                                  {(collection.individualPbj ?? 0) > 0 && <div>{collection.individualPbj} PB&J</div>}
                                  {((collection as any).individualGeneric ?? 0) > 0 && <div>{(collection as any).individualGeneric}</div>}
                                </div>
                              );
                            }
                            return collection.individualSandwiches;
                          })()}
                        </div>
                      </div>
                    )}
                    {/* If the Individual column is empty but Group Event is
                        present, render an empty spacer ONLY in sm+ layouts so
                        the CSS grid columns stay aligned. On mobile (single
                        column) the spacer is unnecessary. */}
                    {!(collection.individualSandwiches > 0) &&
                      calculateGroupTotal(collection) > 0 &&
                      groupData.length > 0 && (
                        <div className="hidden sm:block" aria-hidden="true" />
                      )}

                    {/* Group Event — render only when there's data */}
                    {calculateGroupTotal(collection) > 0 && groupData.length > 0 && (
                      <div className="w-full sm:min-w-[200px] sm:pl-3 md:pl-4">
                        <div className="text-xs text-slate-500 mb-0.5 font-semibold uppercase tracking-wide">Group Event</div>
                        <div className="text-base lg:text-lg font-bold">
                          {(() => {
                            return (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {groupData.map((group: any, index: number) => {
                                const hasTypes = group.deli || group.pbj || group.generic;
                                const colors = ['#236383', '#FBAD3F', '#007E8C', '#47B3CB'];
                                const colorIndex = index % colors.length;
                                const borderColor = colors[colorIndex];
                                return (
                                  <div
                                    key={index}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm flex flex-col gap-1"
                                    style={{ borderLeft: `3px solid ${borderColor}` }}
                                  >
                                    <div className="text-sm font-semibold text-slate-800 truncate" title={group.groupName}>
                                      {group.groupName}
                                    </div>
                                    {group.department && (
                                      <div className="text-sm text-slate-600 truncate" title={group.department}>
                                        {group.department}
                                      </div>
                                    )}
                                    {hasTypes ? (
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-semibold text-slate-900">
                                        {(group.deli ?? 0) > 0 && <span>{group.deli} Deli</span>}
                                        {(group.pbj ?? 0) > 0 && <span>{group.pbj} PB&J</span>}
                                        {(group.generic ?? 0) > 0 && <span>{group.generic}</span>}
                                      </div>
                                    ) : (
                                      <div className="text-lg font-semibold text-slate-900">{group.sandwichCount}</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    )}
                  </div>

                  {/* Third Row: Total & Actions */}
                  <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto] sm:items-center gap-3 lg:gap-4 ml-0 sm:ml-4 md:ml-12 lg:ml-20">
                    {/* Total — slightly downsized so the card height drops
                        without sacrificing legibility. text-xl on mobile,
                        text-xl on desktop (down from text-2xl). */}
                    <div className="shrink-0 flex items-center gap-2 lg:flex-col lg:items-end lg:gap-0 justify-self-end">
                      <div className="text-xs text-slate-500 font-semibold">Total:</div>
                      <div className="text-lg lg:text-xl font-bold">{totalSandwiches}</div>
                    </div>

                    {/* Actions — each icon-only button is wrapped in a
                        Tooltip so users who aren't used to icon-only
                        interfaces get a hover label explaining what the
                        button does (star = personal favorite, kudos =
                        send recognition to the submitter, comment =
                        message, pencil = edit, trash = delete). */}
                    <TooltipProvider delayDuration={200}>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0 justify-self-end">
                        {/* Star = personal "notable" bookmark. Distinct
                            from the kudos icon: this stays on the entry
                            for the current user, not on the submitter. */}
                        {(() => {
                          const isFavorited = favoritedIds.has(collection.id);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={toggleFavoriteMutation.isPending}
                                  onClick={() =>
                                    toggleFavoriteMutation.mutate({
                                      collectionId: collection.id,
                                      favorited: isFavorited,
                                    })
                                  }
                                  aria-label={
                                    isFavorited
                                      ? 'Remove from your favorites'
                                      : 'Mark this entry as notable'
                                  }
                                  aria-pressed={isFavorited}
                                  data-testid={`button-favorite-${collection.id}`}
                                  className={`h-11 w-11 sm:h-8 sm:w-8 p-0 bg-white border-gray-300 ${
                                    isFavorited
                                      ? 'text-amber-500 hover:text-amber-600'
                                      : 'text-gray-500 hover:text-amber-500'
                                  } hover:bg-amber-50`}
                                >
                                  <Star
                                    className={`w-4 h-4 ${isFavorited ? 'fill-amber-500' : ''}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isFavorited
                                  ? 'Remove from your favorites'
                                  : 'Mark this entry as notable'}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                        {collection.createdBy &&
                          collection.createdByName && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <SendKudosButton
                                    recipientId={collection.createdBy}
                                    recipientName={collection.createdByName}
                                    contextType="task"
                                    contextId={collection.id.toString()}
                                    contextTitle={`${totalSandwiches} sandwiches from ${collection.hostName}`}
                                    size="sm"
                                    variant="outline"
                                    iconOnly={true}
                                    className="h-11 w-11 sm:h-8 sm:w-8 p-0 bg-white border-gray-300 hover:bg-gray-50 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Send kudos to {collection.createdByName}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        {canEditCollection(user, collection) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEdit(collection)}
                                aria-label="Edit this entry"
                                className="h-11 w-11 sm:h-8 sm:w-8 p-0 bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit this entry</TooltipContent>
                          </Tooltip>
                        )}
                        {canDeleteCollection(user, collection) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* Span, not the button: the confirm dialog must
                                  own the button so its click handler actually
                                  lands on a DOM node. Tooltip.Root drops
                                  unknown props, so nesting it inside the
                                  dialog trigger swallowed the click. */}
                              <span className="inline-flex">
                                <ConfirmationDialog
                                  trigger={
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label="Delete this entry"
                                      className="h-11 w-11 sm:h-8 sm:w-8 p-0 text-gray-600 hover:text-[#A31C41] hover:bg-red-50 bg-white border-gray-300"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  }
                                  title="Delete Collection Entry"
                                  description="Are you sure you want to delete this collection? You can undo this action within 5 seconds."
                                  confirmText="Delete"
                                  variant="destructive"
                                  onConfirm={() => handleDelete(collection.id)}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Delete this entry</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TooltipProvider>
                  </div>

                  {/* Submission info - small footer detail */}
                  <div className="mt-1 ml-4 sm:ml-20 md:ml-28 lg:ml-32 text-xs text-slate-500 leading-snug">
                    Submitted {formatSubmittedAt(collection.submittedAt)}
                    {collection.createdByName && (
                      <span className="ml-1 font-medium">
                        by {collection.createdByName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {collections.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No collection entries found. Use the form above to record sandwich
              collections.
            </div>
          )}

          {collections.length > 0 && filteredCollections.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No entries match the current filters. Try adjusting your search
              criteria.
            </div>
          )}
        </div>

        {/* Bottom Pagination Controls */}
        {totalItems > 0 && <PaginationControls position="bottom" />}
      </div>

      {/* Duplicate Analysis Modal */}
      <Dialog
        open={showDuplicateAnalysis}
        onOpenChange={setShowDuplicateAnalysis}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" />
              Duplicate Analysis Results
            </DialogTitle>
          </DialogHeader>
          {duplicateAnalysis && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900">
                    {duplicateAnalysis.totalCollections}
                  </div>
                  <div className="text-base text-slate-600">
                    Total Collections
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {duplicateAnalysis.totalDuplicateEntries}
                  </div>
                  <div className="text-base text-slate-600">
                    Duplicate Entries
                  </div>
                </div>
              </div>

              {duplicateAnalysis.totalDuplicateEntries > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-900">
                      Exact Duplicates (
                      {duplicateAnalysis.totalDuplicateEntries})
                    </h3>
                  </div>
                  <div className="text-base text-slate-600 mb-2">
                    Use radio buttons to select which entry to keep in each
                    duplicate group, or click "Skip" to leave duplicates as-is. Only selected groups will be processed.
                  </div>
                  <div className="mb-3 flex items-center justify-between bg-slate-100 p-3 rounded-lg">
                    <div className="text-sm text-slate-600">
                      Showing duplicates {duplicatePage * DUPLICATES_PER_PAGE + 1} - {Math.min((duplicatePage + 1) * DUPLICATES_PER_PAGE, duplicateAnalysis.duplicates.length)} of {duplicateAnalysis.duplicates.length}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDuplicatePage(Math.max(0, duplicatePage - 1))}
                        disabled={duplicatePage === 0}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDuplicatePage(duplicatePage + 1)}
                        disabled={(duplicatePage + 1) * DUPLICATES_PER_PAGE >= duplicateAnalysis.duplicates.length}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                    <div className="space-y-3 p-3">
                      {duplicateAnalysis.duplicates
                        .slice(duplicatePage * DUPLICATES_PER_PAGE, (duplicatePage + 1) * DUPLICATES_PER_PAGE)
                        .map((group, sliceIndex) => {
                          const groupIndex = duplicatePage * DUPLICATES_PER_PAGE + sliceIndex;
                          const isSkipped = skippedGroups.has(groupIndex);
                          return (
                        <div
                          key={groupIndex}
                          className={`border rounded-lg p-3 ${
                            isSkipped
                              ? 'bg-slate-100 border-slate-300 opacity-60'
                              : 'border-slate-100 bg-slate-50'
                          }`}
                        >
                          {/* Duplicate Info Header */}
                          <div className={`mb-3 p-3 border rounded-lg ${
                            isSkipped
                              ? 'bg-slate-200 border-slate-400'
                              : 'bg-blue-50 border-blue-200'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <Calendar className="w-4 h-4 text-blue-600" />
                                <span className="font-semibold text-blue-900">
                                  {new Date(
                                    group.duplicateInfo.collectionDate
                                  ).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                              <span className="text-base font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded">
                                {group.count} duplicate
                                {group.count !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-base">
                              <div>
                                <div className="text-sm text-blue-600 font-medium mb-1">
                                  Group Names
                                </div>
                                <div className="text-blue-900 font-medium">
                                  {group.duplicateInfo.groupNames ||
                                    'No groups'}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm text-blue-600 font-medium mb-1">
                                  Sandwich Counts
                                </div>
                                <div className="text-blue-900 font-medium">
                                  {group.duplicateInfo.individualSandwiches}{' '}
                                  individual,{' '}
                                  {group.duplicateInfo.totalSandwiches} total
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Show ALL entries with radio buttons to select which to keep */}
                          <div className="space-y-2">
                            <div className="text-sm font-bold text-slate-700 mb-2 uppercase">
                              Select which entry to keep:
                            </div>
                            <RadioGroup
                              value={
                                selectedKeepIds.get(groupIndex)?.toString() ||
                                group.keepNewest.id.toString()
                              }
                              onValueChange={(value) => {
                                const newMap = new Map(selectedKeepIds);
                                newMap.set(groupIndex, parseInt(value));
                                setSelectedKeepIds(newMap);
                              }}
                            >
                              {/* Combine all entries (keepNewest + toDelete) into one list */}
                              {[group.keepNewest, ...group.toDelete].map(
                                (entry) => {
                                  const isSelected =
                                    selectedKeepIds.get(groupIndex) ===
                                    entry.id;
                                  return (
                                    <div
                                      key={entry.id}
                                      className={`flex items-start space-x-3 p-3 border-2 rounded-lg transition-colors ${
                                        isSelected
                                          ? 'bg-green-50 border-green-400 shadow-sm'
                                          : 'bg-white border-slate-200 hover:border-slate-300'
                                      }`}
                                      data-testid={`entry-${entry.id}`}
                                    >
                                      <div className="flex items-start pt-1">
                                        <RadioGroupItem
                                          value={entry.id.toString()}
                                          id={`entry-${groupIndex}-${entry.id}`}
                                          className="mt-0.5"
                                        />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center space-x-2">
                                            {isSelected && (
                                              <span className="text-sm font-bold text-green-700 uppercase bg-green-200 px-2 py-1 rounded">
                                                ✓ Keeping
                                              </span>
                                            )}
                                            <span
                                              className={`text-sm font-medium ${isSelected ? 'text-green-600' : 'text-slate-500'}`}
                                            >
                                              ID: {entry.id}
                                            </span>
                                          </div>
                                          <div
                                            className={`text-base font-medium ${isSelected ? 'text-green-700' : 'text-slate-600'}`}
                                          >
                                            <User className="w-4 h-4 inline mr-1" />
                                            {entry.createdBy}
                                          </div>
                                        </div>

                                        {/* Group Names Display */}
                                        {entry.groupNames && (
                                          <div
                                            className={`mb-2 p-2 border rounded ${
                                              isSelected
                                                ? 'bg-green-100 border-green-300'
                                                : 'bg-slate-50 border-slate-200'
                                            }`}
                                          >
                                            <div className="flex items-center space-x-2">
                                              <Users
                                                className={`w-4 h-4 ${isSelected ? 'text-green-700' : 'text-slate-600'}`}
                                              />
                                              <div>
                                                <div
                                                  className={`text-sm font-medium ${isSelected ? 'text-green-600' : 'text-slate-500'}`}
                                                >
                                                  Groups
                                                </div>
                                                <div
                                                  className={`text-base font-semibold ${isSelected ? 'text-green-900' : 'text-slate-700'}`}
                                                >
                                                  {entry.groupNames}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        <div className="flex items-center justify-between text-base mb-2">
                                          <div className="flex items-center space-x-3">
                                            <span
                                              className={
                                                isSelected
                                                  ? 'text-slate-700'
                                                  : 'text-slate-600'
                                              }
                                            >
                                              <Sandwich className="w-3 h-3 inline mr-1" />
                                              {entry.individualSandwiches}{' '}
                                              individual
                                            </span>
                                          </div>
                                          <span
                                            className={`font-bold px-2 py-1 rounded ${
                                              isSelected
                                                ? 'text-green-900 bg-green-100'
                                                : 'text-slate-900 bg-slate-100'
                                            }`}
                                          >
                                            {entry.totalSandwiches} total
                                          </span>
                                        </div>

                                        <div
                                          className={`text-sm ${isSelected ? 'text-green-600' : 'text-slate-500'}`}
                                        >
                                          <Calendar className="w-3 h-3 inline mr-1" />
                                          Submitted:{' '}
                                          {new Date(
                                            entry.submittedAt
                                          ).toLocaleString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                              )}
                            </RadioGroup>

                            {/* Skip/Keep Both Button */}
                            <div className="mt-3 pt-3 border-t">
                              <Button
                                variant={isSkipped ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  const newSkipped = new Set(skippedGroups);
                                  if (isSkipped) {
                                    newSkipped.delete(groupIndex);
                                  } else {
                                    newSkipped.add(groupIndex);
                                  }
                                  setSkippedGroups(newSkipped);
                                }}
                                className="w-full"
                              >
                                {isSkipped ? '✓ Skipped - Will Keep All Duplicates' : 'Skip This Group (Keep All)'}
                              </Button>
                            </div>
                          </div>
                        </div>
                          );
                        })}
                    </div>
                  </div>
                  {duplicateAnalysis.duplicates.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="text-base text-blue-800">
                        {(() => {
                          const totalEntriesToDelete =
                            duplicateAnalysis.duplicates.reduce(
                              (sum, group, index) => {
                                if (skippedGroups.has(index)) {
                                  return sum; // Skip this group
                                }
                                const keepId =
                                  selectedKeepIds.get(index) ||
                                  group.keepNewest.id;
                                const allIds = [
                                  group.keepNewest,
                                  ...group.toDelete,
                                ].map((e) => e.id);
                                return (
                                  sum +
                                  allIds.filter((id) => id !== keepId).length
                                );
                              },
                              0
                            );
                          const groupsToProcess = duplicateAnalysis.duplicates.length - skippedGroups.size;
                          const skippedText = skippedGroups.size > 0 ? ` (${skippedGroups.size} group${skippedGroups.size === 1 ? '' : 's'} skipped)` : '';
                          return `${totalEntriesToDelete} duplicate entr${totalEntriesToDelete === 1 ? 'y' : 'ies'} will be deleted from ${groupsToProcess} group${groupsToProcess === 1 ? '' : 's'}${skippedText}`;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {duplicateAnalysis.suspiciousPatterns > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-900">
                      Suspicious Patterns (
                      {duplicateAnalysis.suspiciousPatterns})
                    </h3>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const allIds = new Set(
                            duplicateAnalysis.suspiciousEntries.map(
                              (entry) => entry.id
                            )
                          );
                          setSelectedSuspiciousIds(
                            selectedSuspiciousIds.size === allIds.size
                              ? new Set()
                              : allIds
                          );
                        }}
                        className="text-sm"
                      >
                        {selectedSuspiciousIds.size ===
                        duplicateAnalysis.suspiciousEntries.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </Button>
                    </div>
                  </div>
                  <div className="text-base text-slate-600 mb-2">
                    Review and select specific entries to delete. These entries
                    have problematic host names or data entry errors.
                  </div>
                  <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                    <div className="space-y-1 p-2">
                      {duplicateAnalysis.suspiciousEntries.map((entry) => {
                        const groupData = getGroupCollections(entry);
                        const totalSandwiches = calculateTotal(entry);
                        return (
                          <div
                            key={entry.id}
                            className="flex items-center space-x-3 p-2 border border-slate-100 rounded hover:bg-slate-50"
                          >
                            <Checkbox
                              id={`suspicious-${entry.id}`}
                              checked={selectedSuspiciousIds.has(entry.id)}
                              onCheckedChange={(checked) => {
                                const newSet = new Set(selectedSuspiciousIds);
                                if (checked) {
                                  newSet.add(entry.id);
                                } else {
                                  newSet.delete(entry.id);
                                }
                                setSelectedSuspiciousIds(newSet);
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-base">
                                    "{entry.hostName || 'No Host'}"
                                  </span>
                                  <span className="text-sm text-slate-500">
                                    ID: {entry.id}
                                  </span>
                                </div>
                                <div className="text-base font-medium text-slate-900">
                                  {totalSandwiches} sandwiches
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-sm text-slate-600 mt-1">
                                <div>
                                  <Calendar className="w-3 h-3 inline mr-1" />
                                  {entry.collectionDate || 'No Date'}
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span>
                                    {entry.individualSandwiches} individual
                                  </span>
                                  {groupData.length > 0 && (
                                    <span>
                                      {groupData.reduce(
                                        (sum: number, g: any) =>
                                          sum + (Number(g.sandwichCount) || 0),
                                        0
                                      )}{' '}
                                      group
                                    </span>
                                  )}
                                </div>
                              </div>
                              {groupData.length > 0 && (
                                <div className="text-sm text-slate-500 mt-1">
                                  Groups:{' '}
                                  {groupData
                                    .map(
                                      (g: any) =>
                                        `${g.groupName || g.name}: ${g.sandwichCount || g.count}`
                                    )
                                    .join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {selectedSuspiciousIds.size > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="text-base text-amber-800">
                        {selectedSuspiciousIds.size} entr
                        {selectedSuspiciousIds.size === 1 ? 'y' : 'ies'}{' '}
                        selected for deletion
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDuplicateAnalysis(false);
                    setSelectedSuspiciousIds(new Set());
                    setSelectedDuplicateIds(new Set());
                    setSelectedKeepIds(new Map());
                    setSkippedGroups(new Set());
                    setDuplicatePage(0);
                  }}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                {duplicateAnalysis.duplicates.length > 0 && (
                  <Button
                    onClick={() => {
                      const idsToDelete: number[] = [];
                      duplicateAnalysis.duplicates.forEach((group, index) => {
                        if (skippedGroups.has(index)) {
                          return; // Skip this group
                        }
                        const keepId =
                          selectedKeepIds.get(index) || group.keepNewest.id;
                        const allIds = [
                          group.keepNewest,
                          ...group.toDelete,
                        ].map((e) => e.id);
                        allIds.forEach((id) => {
                          if (id !== keepId) {
                            idsToDelete.push(id);
                          }
                        });
                      });
                      if (idsToDelete.length > 0) {
                        cleanSelectedSuspiciousMutation.mutate(idsToDelete);
                      }
                    }}
                    disabled={cleanSelectedSuspiciousMutation.isPending}
                    className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto"
                  >
                    {cleanSelectedSuspiciousMutation.isPending
                      ? 'Deleting...'
                      : (() => {
                          const totalToDelete =
                            duplicateAnalysis.duplicates.reduce(
                              (sum, group, index) => {
                                if (skippedGroups.has(index)) {
                                  return sum; // Skip this group
                                }
                                const keepId =
                                  selectedKeepIds.get(index) ||
                                  group.keepNewest.id;
                                const allIds = [
                                  group.keepNewest,
                                  ...group.toDelete,
                                ].map((e) => e.id);
                                return (
                                  sum +
                                  allIds.filter((id) => id !== keepId).length
                                );
                              },
                              0
                            );
                          return `Delete Duplicates (${totalToDelete})`;
                        })()}
                  </Button>
                )}
                {selectedSuspiciousIds.size > 0 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      cleanSelectedSuspiciousMutation.mutate(
                        Array.from(selectedSuspiciousIds)
                      )
                    }
                    disabled={cleanSelectedSuspiciousMutation.isPending}
                    className="text-red-600 hover:text-red-700 border-red-300 w-full sm:w-auto"
                  >
                    {cleanSelectedSuspiciousMutation.isPending
                      ? 'Deleting...'
                      : `Delete Selected Suspicious (${selectedSuspiciousIds.size})`}
                  </Button>
                )}
                {duplicateAnalysis.suspiciousPatterns > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => cleanDuplicatesMutation.mutate('suspicious')}
                    disabled={cleanDuplicatesMutation.isPending}
                    className="text-amber-600 hover:text-amber-700 border-amber-300 w-full sm:w-auto"
                  >
                    {cleanDuplicatesMutation.isPending
                      ? 'Cleaning...'
                      : `Delete All Suspicious (${duplicateAnalysis.suspiciousPatterns})`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog
        open={!!editingCollection}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCollection(null);
            setShowEditIndividualBreakdown(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-date">Collection Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={editFormData.collectionDate}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    collectionDate: e.target.value,
                  })
                }
              />
            </div>

            <div>
              <Label htmlFor="edit-host">Host Name</Label>
              <Select
                value={editFormData.hostName}
                onValueChange={(value) => {
                  setEditFormData({ ...editFormData, hostName: value });

                  // Track location selection
                  trackActivity({
                    action: 'Select',
                    section: 'Collections',
                    feature: 'Collection Log',
                    details: `Selected host/location: ${value}`,
                    metadata: {
                      formType: 'edit',
                      selectedHost: value,
                      collectionId: editingCollection?.id,
                      timestamp: new Date().toISOString()
                    },
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select host" />
                </SelectTrigger>
                <SelectContent>
                  {hostOptions.map((host, index) => (
                    <SelectItem key={`edit-host-${index}-${host}`} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-individual">Individual Sandwiches</Label>
              {!showEditIndividualBreakdown ? (
                <div className="flex gap-2 items-center">
                  <Input
                    id="edit-individual"
                    type="number"
                    min="0"
                    value={editFormData.individualSandwiches}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        individualSandwiches: e.target.value,
                      })
                    }
                    className="flex-1"
                  />
                  <EditCalculatorPopover
                    fieldId="edit-individual"
                    onUseResult={() => {
                      if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                        setEditFormData({
                          ...editFormData,
                          individualSandwiches: Math.round(Number(editCalcDisplay)).toString(),
                        });
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="p-2 hover:bg-gray-100 rounded-md border border-gray-200"
                      onClick={() => openEditCalculator('edit-individual', editFormData.individualSandwiches)}
                    >
                      <Calculator className="h-5 w-5 text-gray-600" />
                    </button>
                  </EditCalculatorPopover>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                  <div>
                    <Label htmlFor="edit-deli" className="text-sm">Deli</Label>
                    <div className="flex gap-1 items-center">
                      <Input
                        id="edit-deli"
                        type="number"
                        min="0"
                        value={editFormData.individualDeli}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditFormData({
                            ...editFormData,
                            individualDeli: value,
                            individualSandwiches: (
                              (parseInt(value) || 0) +
                              (parseInt(editFormData.individualPbj) || 0) +
                              (parseInt(editFormData.individualGeneric) || 0)
                            ).toString(),
                          });
                        }}
                        placeholder="0"
                        className="flex-1"
                      />
                      <EditCalculatorPopover
                        fieldId="edit-deli"
                        onUseResult={() => {
                          if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                            const value = Math.round(Number(editCalcDisplay)).toString();
                            setEditFormData({
                              ...editFormData,
                              individualDeli: value,
                              individualSandwiches: (
                                (parseInt(value) || 0) +
                                (parseInt(editFormData.individualPbj) || 0) +
                                (parseInt(editFormData.individualGeneric) || 0)
                              ).toString(),
                            });
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="p-1.5 hover:bg-gray-100 rounded border border-gray-200"
                          onClick={() => openEditCalculator('edit-deli', editFormData.individualDeli)}
                        >
                          <Calculator className="h-4 w-4 text-gray-600" />
                        </button>
                      </EditCalculatorPopover>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit-pbj" className="text-sm">PBJ</Label>
                    <div className="flex gap-1 items-center">
                      <Input
                        id="edit-pbj"
                        type="number"
                        min="0"
                        value={editFormData.individualPbj}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditFormData({
                            ...editFormData,
                            individualPbj: value,
                            individualSandwiches: (
                              (parseInt(editFormData.individualDeli) || 0) +
                              (parseInt(value) || 0) +
                              (parseInt(editFormData.individualGeneric) || 0)
                            ).toString(),
                          });
                        }}
                        placeholder="0"
                        className="flex-1"
                      />
                      <EditCalculatorPopover
                        fieldId="edit-pbj"
                        onUseResult={() => {
                          if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                            const value = Math.round(Number(editCalcDisplay)).toString();
                            setEditFormData({
                              ...editFormData,
                              individualPbj: value,
                              individualSandwiches: (
                                (parseInt(editFormData.individualDeli) || 0) +
                                (parseInt(value) || 0) +
                                (parseInt(editFormData.individualGeneric) || 0)
                              ).toString(),
                            });
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="p-1.5 hover:bg-gray-100 rounded border border-gray-200"
                          onClick={() => openEditCalculator('edit-pbj', editFormData.individualPbj)}
                        >
                          <Calculator className="h-4 w-4 text-gray-600" />
                        </button>
                      </EditCalculatorPopover>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit-generic" className="text-sm">Generic</Label>
                    <div className="flex gap-1 items-center">
                      <Input
                        id="edit-generic"
                        type="number"
                        min="0"
                        value={editFormData.individualGeneric}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditFormData({
                            ...editFormData,
                            individualGeneric: value,
                            individualSandwiches: (
                              (parseInt(editFormData.individualDeli) || 0) +
                              (parseInt(editFormData.individualPbj) || 0) +
                              (parseInt(value) || 0)
                            ).toString(),
                          });
                        }}
                        placeholder="0"
                        className="flex-1"
                      />
                      <EditCalculatorPopover
                        fieldId="edit-generic"
                        onUseResult={() => {
                          if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                            const value = Math.round(Number(editCalcDisplay)).toString();
                            setEditFormData({
                              ...editFormData,
                              individualGeneric: value,
                              individualSandwiches: (
                                (parseInt(editFormData.individualDeli) || 0) +
                                (parseInt(editFormData.individualPbj) || 0) +
                                (parseInt(value) || 0)
                              ).toString(),
                            });
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="p-1.5 hover:bg-gray-100 rounded border border-gray-200"
                          onClick={() => openEditCalculator('edit-generic', editFormData.individualGeneric)}
                        >
                          <Calculator className="h-4 w-4 text-gray-600" />
                        </button>
                      </EditCalculatorPopover>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Toggle for individual sandwich type breakdown */}
              <div className="mt-3">
                <div className={`border rounded-lg p-3 ${showEditIndividualBreakdown ? 'bg-brand-primary-lighter border-brand-primary' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="edit-individual-breakdown"
                      checked={showEditIndividualBreakdown}
                      onChange={(e) => {
                        setShowEditIndividualBreakdown(e.target.checked);
                        if (!e.target.checked) {
                          // Clear breakdown when hiding
                          setEditFormData({
                            ...editFormData,
                            individualDeli: '',
                            individualPbj: '',
                            individualGeneric: '',
                          });
                        }
                      }}
                      className="w-4 h-4 text-brand-primary focus:ring-brand-primary"
                    />
                    <label htmlFor="edit-individual-breakdown" className="text-sm font-medium cursor-pointer">
                      Specify sandwich types (Deli/PBJ/Generic)
                    </label>
                  </div>
                </div>
              </div>

              {/* Validation Status for Individual Breakdown */}
              {showEditIndividualBreakdown && (
                <div className="mt-2">
                  {(() => {
                    const individualDeli = parseInt(editFormData.individualDeli) || 0;
                    const individualPbj = parseInt(editFormData.individualPbj) || 0;
                    const individualGeneric = parseInt(editFormData.individualGeneric) || 0;
                    const individualSandwiches = parseInt(editFormData.individualSandwiches) || 0;
                    const breakdownSum = individualDeli + individualPbj + individualGeneric;
                    const hasAnyValue = individualDeli > 0 || individualPbj > 0 || individualGeneric > 0;
                    
                    if (!hasAnyValue) {
                      return null;
                    }

                    const isValid = breakdownSum === individualSandwiches;
                    
                    return (
                      <div className={`border rounded-lg p-3 ${isValid ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
                        <div className="flex items-center gap-2">
                          {isValid ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-red-600" />
                          )}
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              Breakdown Total: {breakdownSum} / Expected: {individualSandwiches}
                            </div>
                            {!isValid && (
                              <div className="text-xs text-red-600 mt-1">
                                {editIndividualBreakdownError}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div>
              <Label>Group Collections</Label>

              <div className="space-y-3 mt-2">
                {editGroupCollections.map((group) => (
                  <div key={group.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex gap-3 items-start flex-wrap">
                      <div className="flex-1 min-w-[200px] space-y-2">
                        <Input
                          placeholder="Group/Organization name"
                          value={group.groupName || ''}
                          onChange={(e) =>
                            updateEditGroupCollection(
                              group.id,
                              'groupName',
                              e.target.value
                            )
                          }
                          className="w-full"
                          required
                        />
                        <Input
                          placeholder="Department (optional)"
                          value={group.department || ''}
                          onChange={(e) =>
                            updateEditGroupCollection(
                              group.id,
                              'department',
                              e.target.value
                            )
                          }
                          className="w-full text-sm"
                          title="Optional department field - helps split organization names for catalog"
                        />
                      </div>
                      {!group.hasTypeBreakdown && (
                        <div className="flex gap-1 items-center">
                          <Input
                            type="number"
                            min="0"
                            placeholder="Count"
                            value={(() => {
                              const groupCount = group.count || group.sandwichCount || 0;
                              return groupCount === 0 ? '' : groupCount.toString();
                            })()}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || value === '0') {
                                updateEditGroupCollection(
                                  group.id,
                                  'sandwichCount',
                                  0
                                );
                              } else {
                                updateEditGroupCollection(
                                  group.id,
                                  'sandwichCount',
                                  parseInt(value) || 0
                                );
                              }
                            }}
                            onFocus={(e) => {
                              if (e.target.value === '0') {
                                e.target.value = '';
                              }
                            }}
                            className="w-24"
                          />
                          <EditCalculatorPopover
                            fieldId={`group-count-${group.id}`}
                            onUseResult={() => {
                              if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                                updateEditGroupCollection(
                                  group.id,
                                  'sandwichCount',
                                  Math.round(Number(editCalcDisplay))
                                );
                              }
                            }}
                          >
                            <button
                              type="button"
                              className="p-1.5 hover:bg-gray-100 rounded border border-gray-200"
                              onClick={() => openEditCalculator(`group-count-${group.id}`, group.count || group.sandwichCount || 0)}
                            >
                              <Calculator className="h-4 w-4 text-gray-600" />
                            </button>
                          </EditCalculatorPopover>
                        </div>
                      )}
                      
                      {/* Individual toggle for this group's type breakdown */}
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          id={`group-${group.id}-breakdown`}
                          checked={group.hasTypeBreakdown || false}
                          onChange={(e) => {
                            const updatedGroup = {
                              ...group,
                              hasTypeBreakdown: e.target.checked,
                            };
                            if (!e.target.checked) {
                              // Clear type data when disabling
                              updatedGroup.deli = undefined;
                              updatedGroup.pbj = undefined;
                              updatedGroup.generic = undefined;
                            }
                            setEditGroupCollections(
                              editGroupCollections.map((g) =>
                                g.id === group.id ? updatedGroup : g
                              )
                            );
                          }}
                          className="w-4 h-4 text-brand-primary focus:ring-brand-primary"
                          title="Show sandwich types for this group"
                        />
                        <label 
                          htmlFor={`group-${group.id}-breakdown`} 
                          className="text-xs text-slate-600 cursor-pointer whitespace-nowrap"
                          title="Show sandwich types for this group"
                        >
                          Types
                        </label>
                      </div>
                      
                      {editGroupCollections.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeEditGroupRow(group.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    
                    {/* Type breakdown fields for group when enabled */}
                    {group.hasTypeBreakdown && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-gray-50 p-2 rounded">
                          <div>
                            <Label className="text-xs">Deli</Label>
                            <div className="flex gap-1 items-center">
                              <Input
                                type="number"
                                min="0"
                                value={group.deli || ''}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value) || 0;
                                  const updatedGroup = {
                                    ...group,
                                    deli: value,
                                    sandwichCount: value + (group.pbj || 0) + (group.generic || 0),
                                  };
                                  setEditGroupCollections(
                                    editGroupCollections.map((g) =>
                                      g.id === group.id ? updatedGroup : g
                                    )
                                  );
                                }}
                                placeholder="0"
                                className="h-8 flex-1"
                              />
                              <EditCalculatorPopover
                                fieldId={`group-deli-${group.id}`}
                                onUseResult={() => {
                                  if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                                    const value = Math.round(Number(editCalcDisplay));
                                    const updatedGroup = {
                                      ...group,
                                      deli: value,
                                      sandwichCount: value + (group.pbj || 0) + (group.generic || 0),
                                    };
                                    setEditGroupCollections(
                                      editGroupCollections.map((g) =>
                                        g.id === group.id ? updatedGroup : g
                                      )
                                    );
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className="p-1 hover:bg-gray-200 rounded border border-gray-300"
                                  onClick={() => openEditCalculator(`group-deli-${group.id}`, group.deli || 0)}
                                >
                                  <Calculator className="h-3.5 w-3.5 text-gray-600" />
                                </button>
                              </EditCalculatorPopover>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">PBJ</Label>
                            <div className="flex gap-1 items-center">
                              <Input
                                type="number"
                                min="0"
                                value={group.pbj || ''}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value) || 0;
                                  const updatedGroup = {
                                    ...group,
                                    pbj: value,
                                    sandwichCount: (group.deli || 0) + value + (group.generic || 0),
                                  };
                                  setEditGroupCollections(
                                    editGroupCollections.map((g) =>
                                      g.id === group.id ? updatedGroup : g
                                    )
                                  );
                                }}
                                placeholder="0"
                                className="h-8 flex-1"
                              />
                              <EditCalculatorPopover
                                fieldId={`group-pbj-${group.id}`}
                                onUseResult={() => {
                                  if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                                    const value = Math.round(Number(editCalcDisplay));
                                    const updatedGroup = {
                                      ...group,
                                      pbj: value,
                                      sandwichCount: (group.deli || 0) + value + (group.generic || 0),
                                    };
                                    setEditGroupCollections(
                                      editGroupCollections.map((g) =>
                                        g.id === group.id ? updatedGroup : g
                                      )
                                    );
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className="p-1 hover:bg-gray-200 rounded border border-gray-300"
                                  onClick={() => openEditCalculator(`group-pbj-${group.id}`, group.pbj || 0)}
                                >
                                  <Calculator className="h-3.5 w-3.5 text-gray-600" />
                                </button>
                              </EditCalculatorPopover>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Generic</Label>
                            <div className="flex gap-1 items-center">
                              <Input
                                type="number"
                                min="0"
                                value={group.generic || ''}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value) || 0;
                                  const updatedGroup = {
                                    ...group,
                                    generic: value,
                                    sandwichCount: (group.deli || 0) + (group.pbj || 0) + value,
                                  };
                                  setEditGroupCollections(
                                    editGroupCollections.map((g) =>
                                      g.id === group.id ? updatedGroup : g
                                    )
                                  );
                                }}
                                placeholder="0"
                                className="h-8 flex-1"
                              />
                              <EditCalculatorPopover
                                fieldId={`group-generic-${group.id}`}
                                onUseResult={() => {
                                  if (editCalcDisplay && !isNaN(Number(editCalcDisplay))) {
                                    const value = Math.round(Number(editCalcDisplay));
                                    const updatedGroup = {
                                      ...group,
                                      generic: value,
                                      sandwichCount: (group.deli || 0) + (group.pbj || 0) + value,
                                    };
                                    setEditGroupCollections(
                                      editGroupCollections.map((g) =>
                                        g.id === group.id ? updatedGroup : g
                                      )
                                    );
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className="p-1 hover:bg-gray-200 rounded border border-gray-300"
                                  onClick={() => openEditCalculator(`group-generic-${group.id}`, group.generic || 0)}
                                >
                                  <Calculator className="h-3.5 w-3.5 text-gray-600" />
                                </button>
                              </EditCalculatorPopover>
                            </div>
                          </div>
                        </div>
                        
                        {/* Validation Status for Group Breakdown */}
                        {(() => {
                          const deli = group.deli || 0;
                          const pbj = group.pbj || 0;
                          const generic = group.generic || 0;
                          const breakdownSum = deli + pbj + generic;
                          const hasAnyValue = deli > 0 || pbj > 0 || generic > 0;
                          
                          if (!hasAnyValue) {
                            return null;
                          }

                          const groupCount = group.count || group.sandwichCount || 0;
                          const isValid = breakdownSum === groupCount;
                          const errorMsg = editGroupBreakdownErrors.get(group.id);
                          
                          return (
                            <div className={`border rounded-lg p-2 mt-2 ${isValid ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
                              <div className="flex items-center gap-2">
                                {isValid ? (
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                ) : (
                                  <AlertCircle className="h-4 w-4 text-red-600" />
                                )}
                                <div className="flex-1">
                                  <div className="text-xs font-medium">
                                    Breakdown Total: {breakdownSum} / Expected: {groupCount}
                                  </div>
                                  {!isValid && errorMsg && (
                                    <div className="text-xs text-red-600 mt-1">
                                      {errorMsg}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                ))}

                {/* Add Another Group Button - Below existing group rows */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addEditGroupRow}
                >
                  ➕ Add Another Group
                </Button>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setEditingCollection(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdate}
                disabled={updateMutation.isPending || editIndividualBreakdownError !== '' || editGroupBreakdownErrors.size > 0}
              >
                {updateMutation.isPending ? 'Updating...' : 'Update Collection'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch Edit Modal */}
      <Dialog open={showBatchEdit} onOpenChange={setShowBatchEdit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Batch Edit Collections</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-base text-slate-600">
              Editing {selectedCollections.size} selected collections. Leave
              fields empty to keep existing values.
            </p>

            <div>
              <Label htmlFor="batch-date">Collection Date</Label>
              <Input
                id="batch-date"
                type="date"
                value={batchEditData.collectionDate}
                onChange={(e) =>
                  setBatchEditData({
                    ...batchEditData,
                    collectionDate: e.target.value,
                  })
                }
              />
            </div>

            <div>
              <Label htmlFor="batch-host">Host Name</Label>
              <Select
                value={batchEditData.hostName}
                onValueChange={(value) =>
                  setBatchEditData({ ...batchEditData, hostName: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select host (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {hostOptions.map((host, index) => (
                    <SelectItem
                      key={`batch-host-${index}-${host}`}
                      value={host}
                    >
                      {host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setShowBatchEdit(false)}>
                Cancel
              </Button>
              <Button
                onClick={submitBatchEdit}
                disabled={batchEditMutation.isPending}
              >
                {batchEditMutation.isPending
                  ? 'Updating...'
                  : 'Update Collections'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Data Management Dialog */}
      <Dialog open={showDataManagement} onOpenChange={setShowDataManagement}>
        <DialogContent className="w-[95vw] max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Data Management Center</DialogTitle>
          </DialogHeader>
          <BulkDataManager
            onExportCSV={exportToCSV}
            onImportCSV={() => fileInputRef.current?.click()}
            onCheckDuplicates={() => analyzeDuplicatesMutation.mutate()}
            onCleanOGDuplicates={() =>
              cleanDuplicatesMutation.mutate('og-duplicates')
            }
          />
        </DialogContent>
      </Dialog>

      {/* Quick Help Button */}

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="collections"
        title="Collection Insights"
        subtitle="Ask about your collection data"
        contextData={{
          currentView: 'collection-log',
          filters: {
            dateRange: {
              start: searchFilters.collectionDateFrom || undefined,
              end: searchFilters.collectionDateTo || undefined,
            },
            selectedHost: searchFilters.hostName || undefined,
            searchQuery: searchFilters.globalSearch || undefined,
          },
          summaryStats: {
            totalCollections: totalStats?.totalCollections || totalItems,
            totalSandwiches: totalStats?.totalSandwiches || 0,
            activeHosts: totalStats?.totalHosts || 0,
            displayedCollections: collections.length,
          },
        }}
        getFullContext={() => ({
          rawData: collections.map(c => ({
            id: c.id,
            hostName: c.hostName,
            collectionDate: c.collectionDate,
            individualSandwiches: c.individualSandwiches,
            individualDeli: c.individualDeli,
            individualTurkey: c.individualTurkey,
            individualHam: c.individualHam,
            individualPbj: c.individualPbj,
            individualGeneric: c.individualGeneric,
            group1Name: c.group1Name,
            group1Count: c.group1Count,
            group2Name: c.group2Name,
            group2Count: c.group2Count,
            groupCollections: c.groupCollections,
            totalSandwiches: calculateTotalSandwiches(c),
          })),
        })}
        suggestedQuestions={[
          "What's our total sandwich count this month?",
          "What percentage of our sandwiches in 2025 were PBJ?",
          "What's our average collection size?",
          "Show collections by month",
          "How are we trending compared to last month?",
          "Show monthly trends as a chart",
          "What was our collection total last week?",
        ]}
      />
    </div>
  );
}
