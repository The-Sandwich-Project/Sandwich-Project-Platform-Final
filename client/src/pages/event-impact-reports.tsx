import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { apiRequest, invalidateEventRequestQueries } from '@/lib/queryClient';
import { format, parseISO } from 'date-fns';
import {
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  Users,
  Building,
  Sandwich,
  TrendingUp,
  BarChart3,
  Clock,
  MapPin,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CalendarDays,
  ListFilter,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  FileUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { AIInsightsChat } from '@/components/ai-insights-chat';
import { getReportableSandwichCount } from '@shared/sandwich-count-utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

// Helper to parse date strings in local timezone (avoids UTC midnight timezone shift)
function parseLocalDate(dateInput: string | Date | null | undefined): Date | null {
  if (!dateInput) return null;
  // If it's already a Date object (check both instanceof and duck typing for cross-realm compatibility)
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === 'object' && dateInput !== null && typeof (dateInput as any).getTime === 'function') {
    return dateInput as Date;
  }
  // If it's not a string at this point, bail
  if (typeof dateInput !== 'string') return null;
  // If it's just a date (YYYY-MM-DD), parse in local time
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [year, month, day] = dateInput.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  // For ISO datetime strings, use parseISO which handles timezone correctly
  return parseISO(dateInput);
}

// Organization category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  school: 'School',
  nonprofit: 'Non-Profit',
  church_faith: 'Church/Faith',
  religious: 'Religious Organization',
  hospital: 'Hospital/Healthcare',
  political: 'Political Organization',
  neighborhood: 'Neighborhood Group',
  club: 'Club',
  greek_life: 'Greek Life',
  cultural: 'Cultural Organization',
  government: 'Government',
  other: 'Other',
};

const CORPORATE_CATEGORY_VALUES = new Set([
  'business',
  'company',
  'corp',
  'corporate',
  'large_company',
  'large_corp',
  'large_corporation',
  'medium_business',
  'small_business',
  'small_company',
  'small_medium_business',
  'small_medium_corp',
  'small_medium_company',
]);

function normalizeOrganizationCategory(category?: string | null): string {
  if (!category) return 'other';

  const normalized = category
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (CORPORATE_CATEGORY_VALUES.has(normalized)) {
    return 'corporate';
  }

  return normalized || 'other';
}

function getCategoryLabel(category?: string | null): string {
  const normalized = normalizeOrganizationCategory(category);
  return CATEGORY_LABELS[normalized] || normalized;
}

function isScheduledStatus(status?: string | null): boolean {
  return status === 'scheduled' || status === 'rescheduled';
}

function getEventSandwichCount(event: any): number {
  return getReportableSandwichCount(event, { ignoreSuspiciousEstimatedCounts: true });
}

// Time period presets
const TIME_PRESETS = [
  { value: 'this-week', label: 'This Week' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'last-quarter', label: 'Last Quarter' },
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
  { value: 'all-time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

// Helper to calculate date ranges
function getDateRange(preset: string): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  switch (preset) {
    case 'this-week': {
      const day = now.getDay();
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'last-week': {
      const day = now.getDay();
      start.setDate(now.getDate() - day - 7);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'this-month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'last-month':
      start.setMonth(now.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(now.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'this-quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      start.setMonth(quarter * 3, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(quarter * 3 + 3, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'last-quarter': {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
      const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start.setFullYear(year, lastQuarter * 3, 1);
      start.setHours(0, 0, 0, 0);
      end.setFullYear(year, lastQuarter * 3 + 3, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'this-year':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    case 'last-year':
      start.setFullYear(now.getFullYear() - 1, 0, 1);
      start.setHours(0, 0, 0, 0);
      end.setFullYear(now.getFullYear() - 1, 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    case 'all-time':
      start.setFullYear(2000, 0, 1);
      start.setHours(0, 0, 0, 0);
      end.setFullYear(2100, 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      start.setMonth(now.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

const COLORS = ['#236383', '#FBAD3F', '#47B3CB', '#236383', '#A31C41', '#6B7280', '#10B981', '#8B5CF6', '#EC4899', '#F59E0B'];

// Helper to create histogram buckets for sandwich distribution
// Uses fixed buckets optimized for typical event sizes (most under 1000, few over 3000)
function createSandwichBuckets(events: any[]): { range: string; count: number; minVal: number }[] {
  const sandwichCounts = events
    .map((e: any) => getEventSandwichCount(e))
    .filter((c: number) => c > 0);

  if (sandwichCounts.length === 0) return [];

  // Fixed buckets focused on where most events fall
  const bucketDefs = [
    { min: 1, max: 99, label: '1-99' },
    { min: 100, max: 199, label: '100-199' },
    { min: 200, max: 299, label: '200-299' },
    { min: 300, max: 399, label: '300-399' },
    { min: 400, max: 499, label: '400-499' },
    { min: 500, max: 599, label: '500-599' },
    { min: 600, max: 699, label: '600-699' },
    { min: 700, max: 799, label: '700-799' },
    { min: 800, max: 899, label: '800-899' },
    { min: 900, max: 999, label: '900-999' },
    { min: 1000, max: 1499, label: '1000-1499' },
    { min: 1500, max: 1999, label: '1500-1999' },
    { min: 2000, max: 2999, label: '2000-2999' },
    { min: 3000, max: 4999, label: '3000-4999' },
    { min: 5000, max: Infinity, label: '5000+' },
  ];

  // Count events in each bucket
  const bucketCounts = bucketDefs.map(bucket => ({
    range: bucket.label,
    count: sandwichCounts.filter(c => c >= bucket.min && c <= bucket.max).length,
    minVal: bucket.min,
  }));

  // Only return buckets that have at least one event
  return bucketCounts.filter(b => b.count > 0);
}

// Helper to extract region from address (simplified - uses city or first part)
function extractRegion(address: string | null | undefined): string {
  if (!address) return 'Unknown';

  // Try to extract city from address
  // Common formats: "123 Main St, Atlanta, GA 30301" or "Atlanta, GA"
  const parts = address.split(',').map(p => p.trim());

  if (parts.length >= 2) {
    // Usually city is second to last (before state/zip)
    const cityPart = parts[parts.length - 2] || parts[0];
    // Remove numbers (zip codes that might be in wrong position)
    const city = cityPart.replace(/\d+/g, '').trim();
    if (city && city.length > 1) return city;
  }

  return parts[0] || 'Unknown';
}

// Status badge colors
const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  in_process: 'bg-yellow-100 text-yellow-800',
  new: 'bg-gray-100 text-gray-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function EventImpactReports() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user && hasPermission(user, PERMISSIONS.ADMIN_PANEL_ACCESS);

  const [timePreset, setTimePreset] = useState('this-year');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [showCategorizationTool, setShowCategorizationTool] = useState(false);
  const [categorizationProgress, setCategorizationProgress] = useState<{
    running: boolean;
    total: number;
    processed: number;
    patternMatched: number;
    aiCategorized: number;
    errors: number;
  } | null>(null);

  // Import dialog state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importCsvData, setImportCsvData] = useState('');
  const [importAnalysis, setImportAnalysis] = useState<{
    headers: string[];
    sampleRows: Record<string, string>[];
    suggestedMappings: Record<string, string | null>;
    confidence: string;
    notes: string;
    totalRows: number;
  } | null>(null);
  const [importMappings, setImportMappings] = useState<Record<string, string | null>>({});
  const [importResults, setImportResults] = useState<{
    processed: number;
    updated: number;
    notFound: number;
    errors: number;
    details: Array<{ row: number; status: string; message: string }>;
  } | null>(null);

  // Smart backfill state
  const [showBackfillTool, setShowBackfillTool] = useState(false);
  const [backfillData, setBackfillData] = useState<{
    eventsMissingTypes: Array<{
      id: number;
      organizationName: string;
      organizationCategory: string;
      scheduledEventDate: string;
      actualSandwichCount: number;
      department?: string | null;
      hasOrgPattern: boolean;
    }>;
    totalMissing: number;
    totalWithTypes: number;
  } | null>(null);
  const [backfillSuggestions, setBackfillSuggestions] = useState<Array<{
    eventId: number;
    organizationName: string;
    organizationCategory: string;
    scheduledEventDate: string;
    actualSandwichCount: number;
    suggestion: { deli: number; turkey: number; ham: number; pbj: number; generic: number };
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    approved: boolean;
    edited: boolean;
  }> | null>(null);
  const [selectedBackfillEvents, setSelectedBackfillEvents] = useState<Set<number>>(new Set());
  const [backfillStep, setBackfillStep] = useState<'select' | 'review' | 'complete'>('select');
  const [manualEntries, setManualEntries] = useState<Map<number, { deli: number; turkey: number; ham: number; pbj: number }>>(new Map());

  // Location backfill state
  const [showLocationTool, setShowLocationTool] = useState(false);
  const [locationEntries, setLocationEntries] = useState<Map<number, string>>(new Map());

  // Calculate actual date range
  const dateRange = useMemo(() => {
    if (timePreset === 'custom' && customStartDate && customEndDate) {
      const start = parseLocalDate(customStartDate) || new Date();
      const end = parseLocalDate(customEndDate) || new Date();
      // Set end date to end of day for inclusive filtering
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    return getDateRange(timePreset);
  }, [timePreset, customStartDate, customEndDate]);

  // Fetch event requests
  const { data: eventRequests = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['/api/event-requests'],
  });

  // Fetch group collections not linked to event requests
  const { data: unlinkedCollections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ['/api/sandwich-collections/unlinked-groups'],
  });

  const isLoading = eventsLoading || collectionsLoading;

  const { toast } = useToast();

  // Mutation for generating AI impact report PDF
  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/impact-reports/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
          reportType: 'custom',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate report');
      }

      // Get the PDF blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TSP_Impact_Report_${dateRange.start.toISOString().split('T')[0]}_to_${dateRange.end.toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () => {
      toast({
        title: 'Report Generated',
        description: 'Your AI-powered impact report has been downloaded.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Report Generation Failed',
        description: error.message || 'Failed to generate the impact report. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Mutation for analyzing CSV data
  const analyzeSheetMutation = useMutation({
    mutationFn: async (csvData: string) => {
      const response = await fetch('/api/impact-reports/analyze-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ csvData }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to analyze sheet');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setImportAnalysis(data);
      setImportMappings(data.suggestedMappings);
      toast({
        title: 'Sheet Analyzed',
        description: `Found ${data.totalRows} rows. AI confidence: ${data.confidence}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Analysis Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation for importing sandwich type data
  const importDataMutation = useMutation({
    mutationFn: async ({ csvData, mappings }: { csvData: string; mappings: Record<string, string | null> }) => {
      const response = await fetch('/api/impact-reports/backfill-sandwich-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ csvData, mappings }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to import data');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setImportResults(data);
      invalidateEventRequestQueries(queryClient);
      toast({
        title: 'Import Complete',
        description: `Updated ${data.updated} events. ${data.notFound} not found, ${data.errors} errors.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Import Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation for fetching events missing types
  const fetchMissingTypesMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/impact-reports/events-missing-types', {
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch events');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBackfillData(data);
      setBackfillStep('select');
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation for getting AI suggestions
  const getBackfillSuggestionsMutation = useMutation({
    mutationFn: async (eventIds: number[]) => {
      const response = await fetch('/api/impact-reports/ai-suggest-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ eventIds }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get suggestions');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBackfillSuggestions(
        data.suggestions.map((s: any) => ({ ...s, approved: true, edited: false }))
      );
      setBackfillStep('review');
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation for applying approved suggestions
  const applyBackfillMutation = useMutation({
    mutationFn: async (approvals: Array<{ eventId: number; types: any }>) => {
      const response = await fetch('/api/impact-reports/apply-sandwich-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ approvals }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to apply types');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Success',
        description: data.message,
      });
      setBackfillStep('complete');
      invalidateEventRequestQueries(queryClient);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation for applying location updates
  const applyLocationsMutation = useMutation({
    mutationFn: async (updates: Array<{ eventId: number; address: string }>) => {
      const response = await fetch('/api/impact-reports/apply-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to apply locations');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Success',
        description: data.message,
      });
      setShowLocationTool(false);
      setLocationEntries(new Map());
      invalidateEventRequestQueries(queryClient);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Process and filter events
  const processedData = useMemo(() => {
    if (!Array.isArray(eventRequests)) return null;

    // Build a map of eventRequestId -> collection data for linked collections
    // Track duplicates and orphans as data quality issues to surface to the user
    const linkedCollectionsByEventId = new Map<number, any>();
    const duplicateCollections: { eventRequestId: number; collections: any[] }[] = [];
    const collectionsByEventId = new Map<number, any[]>(); // Temporary for duplicate detection
    const trulyUnlinkedCollections: any[] = [];

    // Build a set of valid event request IDs for orphan detection
    const validEventIds = new Set(eventRequests.map((e: any) => e.id));

    if (Array.isArray(unlinkedCollections)) {
      // First pass: group collections by eventRequestId to detect duplicates
      unlinkedCollections.forEach((c: any) => {
        if (c.eventRequestId) {
          const existing = collectionsByEventId.get(c.eventRequestId) || [];
          existing.push(c);
          collectionsByEventId.set(c.eventRequestId, existing);
        } else {
          // This collection has no linked event request - it's truly unlinked
          trulyUnlinkedCollections.push({
            ...c,
            scheduledEventDate: c.scheduledEventDate || c.collectionDate,
            desiredEventDate: c.collectionDate,
            // organizationCategory is unknown for collections
            organizationCategory: 'other',
            status: 'completed',
            isFromCollection: true, // Flag to identify collection-originated entries
          });
        }
      });

      // Second pass: identify duplicates, orphans, and keep first collection per event
      collectionsByEventId.forEach((collections, eventRequestId) => {
        linkedCollectionsByEventId.set(eventRequestId, collections[0]);
        if (collections.length > 1) {
          duplicateCollections.push({ eventRequestId, collections });
        }
      });
    }

    // Identify orphaned collections (eventRequestId points to non-existent event)
    const orphanedCollections: { eventRequestId: number; collection: any }[] = [];
    linkedCollectionsByEventId.forEach((collection, eventRequestId) => {
      if (!validEventIds.has(eventRequestId)) {
        orphanedCollections.push({ eventRequestId, collection });
      }
    });

    // Convert orphaned collections to standalone entries (so data isn't lost)
    const orphanedAsStandalone = orphanedCollections.map(({ collection }) => ({
      ...collection,
      scheduledEventDate: collection.scheduledEventDate || collection.collectionDate,
      desiredEventDate: collection.collectionDate,
      organizationCategory: 'other',
      status: 'completed',
      isOrphaned: true, // Flag for display
      isFromCollection: true, // Flag to identify collection-originated entries
    }));

    // Merge event requests with their linked collections (if any)
    // IMPORTANT: Preserve event request metadata (status, category) but use collection's actual sandwich count
    const mergedEventRequests = eventRequests.map((event: any) => {
      const linkedCollection = linkedCollectionsByEventId.get(event.id);
      if (linkedCollection) {
        return {
          ...event,
          // Use collection's actual sandwich count when available
          actualSandwichCount: linkedCollection.actualSandwichCount || event.actualSandwichCount,
          // Mark that this event has collection data
          hasCollectionData: true,
        };
      }
      return event;
    });

    // Combine: merged event requests + truly unlinked collections + orphaned collections
    const allEvents = [...mergedEventRequests, ...trulyUnlinkedCollections, ...orphanedAsStandalone];

    // Statuses that should be excluded from statistics (events that didn't/won't happen)
    const EXCLUDED_STATUSES = ['cancelled', 'declined', 'non_event'];

    // Filter events in the date range
    let filteredEvents = allEvents.filter((event: any) => {
      const eventDate = parseLocalDate(event.scheduledEventDate)
        || parseLocalDate(event.desiredEventDate);
      if (!eventDate) return false;

      const inRange = eventDate >= dateRange.start && eventDate <= dateRange.end;

      // Status filter - if user selects "all", exclude cancelled/declined by default
      // If user explicitly selects a specific status, show only that status
      let matchesStatus = false;
      if (statusFilter === 'all') {
        // Exclude events that didn't happen from the default "all" view
        matchesStatus = !EXCLUDED_STATUSES.includes(event.status);
      } else {
        // User explicitly selected a status (including cancelled/declined)
        matchesStatus = statusFilter === 'scheduled'
          ? isScheduledStatus(event.status)
          : event.status === statusFilter;
      }

      // Category filter
      const eventCategory = normalizeOrganizationCategory(event.organizationCategory);
      const matchesCategory = categoryFilter === 'all' || eventCategory === categoryFilter;

      return inRange && matchesStatus && matchesCategory;
    });

    // Sort events
    filteredEvents = [...filteredEvents].sort((a: any, b: any) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          const dateA = parseLocalDate(getEffectiveEventDate(a)) || new Date(0);
          const dateB = parseLocalDate(getEffectiveEventDate(b)) || new Date(0);
          comparison = dateA.getTime() - dateB.getTime();
          break;
        case 'organization':
          comparison = (a.organizationName || '').localeCompare(b.organizationName || '');
          break;
        case 'sandwiches':
          const sandwichesA = getEventSandwichCount(a);
          const sandwichesB = getEventSandwichCount(b);
          comparison = sandwichesA - sandwichesB;
          break;
        case 'category':
          comparison = normalizeOrganizationCategory(a.organizationCategory).localeCompare(
            normalizeOrganizationCategory(b.organizationCategory),
          );
          break;
        default:
          comparison = 0;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    const completedEvents = filteredEvents.filter((e: any) => e.status === 'completed');
    const scheduledEvents = filteredEvents.filter((e: any) => isScheduledStatus(e.status));

    // Calculate totals
    let totalSandwiches = 0;
    let totalEstimatedSandwiches = 0;
    let totalActualSandwiches = 0;
    let totalVolunteers = 0;
    let totalAdults = 0;
    let totalChildren = 0;

    const organizations = new Set<string>();
    const categoryBreakdown = new Map<string, { count: number; sandwiches: number }>();
    const monthlyData: Record<string, { month: string; events: number; sandwiches: number; completed: number; scheduled: number }> = {};
    const weekdayData: Record<string, number> = {
      Sunday: 0,
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0,
    };

    // Sandwich type breakdown
    const sandwichTypeBreakdown: Record<string, number> = {
      deli: 0,
      turkey: 0,
      ham: 0,
      pbj: 0,
      generic: 0,
    };

    filteredEvents.forEach((event: any) => {
      // Sandwiches
      const actualSandwiches = event.actualSandwichCount || 0;
      const estimatedSandwiches = getReportableSandwichCount({
        estimatedSandwichCount: event.estimatedSandwichCount,
        estimatedSandwichCountMin: event.estimatedSandwichCountMin,
        estimatedSandwichCountMax: event.estimatedSandwichCountMax,
      }, { ignoreSuspiciousEstimatedCounts: true });
      const sandwichCount = actualSandwiches || estimatedSandwiches;

      totalSandwiches += sandwichCount;
      totalActualSandwiches += actualSandwiches;
      totalEstimatedSandwiches += estimatedSandwiches;

      // Aggregate sandwich types from actualSandwichTypes JSONB
      if (event.actualSandwichTypes && Array.isArray(event.actualSandwichTypes)) {
        event.actualSandwichTypes.forEach((st: { type: string; quantity: number }) => {
          const type = (st.type || '').toLowerCase();
          const qty = st.quantity || 0;
          if (type.includes('deli')) sandwichTypeBreakdown.deli += qty;
          else if (type.includes('turkey')) sandwichTypeBreakdown.turkey += qty;
          else if (type.includes('ham')) sandwichTypeBreakdown.ham += qty;
          else if (type.includes('pbj') || type.includes('peanut')) sandwichTypeBreakdown.pbj += qty;
          else sandwichTypeBreakdown.generic += qty;
        });
      }

      // Attendance - use actual data for completed events, planned data otherwise
      if (event.status === 'completed') {
        // For completed events, prefer actual attendance if available
        totalAdults += event.attendanceAdults || event.adultCount || 0;
        totalChildren += event.attendanceKids || event.childrenCount || 0;
        // Teens tracked separately in actual attendance
        const teens = event.attendanceTeens || 0;
        totalAdults += teens; // Include teens with adults for total count
      } else {
        // For planned events, use expected counts
        totalAdults += event.adultCount || 0;
        totalChildren += event.childrenCount || 0;
      }
      // volunteerCount is always the number of participants/volunteers expected
      totalVolunteers += event.volunteerCount || 0;

      // Organizations
      if (event.organizationName) {
        organizations.add(event.organizationName);
      }

      // Category breakdown
      const category = normalizeOrganizationCategory(event.organizationCategory);
      const existing = categoryBreakdown.get(category) || { count: 0, sandwiches: 0 };
      categoryBreakdown.set(category, {
        count: existing.count + 1,
        sandwiches: existing.sandwiches + sandwichCount,
      });

      // Monthly data
      const eventDate = parseLocalDate(getEffectiveEventDate(event)) || new Date();
      const monthKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = eventDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { month: monthLabel, events: 0, sandwiches: 0, completed: 0, scheduled: 0 };
      }
      monthlyData[monthKey].events += 1;
      monthlyData[monthKey].sandwiches += sandwichCount;
      if (event.status === 'completed') {
        monthlyData[monthKey].completed += 1;
      } else if (isScheduledStatus(event.status)) {
        monthlyData[monthKey].scheduled += 1;
      }

      // Weekday distribution
      const weekday = eventDate.toLocaleDateString('en-US', { weekday: 'long' });
      weekdayData[weekday] = (weekdayData[weekday] || 0) + 1;
    });

    // Convert to arrays for charts
    const monthlyChartData = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, data]) => data);

    const categoryChartData = Array.from(categoryBreakdown.entries())
      .map(([category, data]) => ({
        name: getCategoryLabel(category),
        rawCategory: category,
        events: data.count,
        sandwiches: data.sandwiches,
        avgSandwiches: data.count > 0 ? Math.round(data.sandwiches / data.count) : 0,
      }))
      .sort((a, b) => b.events - a.events);

    // ENHANCED: Weekday data with sandwich counts (not just event counts)
    const weekdaySandwichData: Record<string, number> = {
      Sunday: 0, Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0,
    };
    filteredEvents.forEach((event: any) => {
      const eventDate = parseLocalDate(getEffectiveEventDate(event)) || new Date();
      const weekday = eventDate.toLocaleDateString('en-US', { weekday: 'long' });
      const sandwichCount = getEventSandwichCount(event);
      weekdaySandwichData[weekday] = (weekdaySandwichData[weekday] || 0) + sandwichCount;
    });

    const weekdayChartData = Object.entries(weekdayData).map(([day, eventCount]) => ({
      day,
      events: eventCount,
      sandwiches: weekdaySandwichData[day] || 0,
      avgPerEvent: eventCount > 0 ? Math.round((weekdaySandwichData[day] || 0) / eventCount) : 0,
    }));

    // NEW: Sandwich distribution histogram
    const sandwichDistribution = createSandwichBuckets(filteredEvents);

    // NEW: Average sandwiches by org type with min/max/event count
    const categoryStats = new Map<string, { counts: number[]; total: number; eventCount: number }>();
    filteredEvents.forEach((event: any) => {
      const category = normalizeOrganizationCategory(event.organizationCategory);
      const sandwichCount = getEventSandwichCount(event);
      if (sandwichCount > 0) {
        const existing = categoryStats.get(category) || { counts: [], total: 0, eventCount: 0 };
        existing.counts.push(sandwichCount);
        existing.total += sandwichCount;
        existing.eventCount += 1;
        categoryStats.set(category, existing);
      }
    });

    const avgSandwichesByCategory = Array.from(categoryStats.entries())
      .filter(([category]) => category !== 'other') // Exclude "other" category
      .map(([category, stats]) => ({
        category: getCategoryLabel(category),
        rawCategory: category,
        avgSandwiches: stats.eventCount > 0 ? Math.round(stats.total / stats.eventCount) : 0,
        minSandwiches: stats.counts.length > 0 ? Math.min(...stats.counts) : 0,
        maxSandwiches: stats.counts.length > 0 ? Math.max(...stats.counts) : 0,
        eventCount: stats.eventCount,
        totalSandwiches: stats.total,
      }))
      .sort((a, b) => b.avgSandwiches - a.avgSandwiches);

    // NEW: Category trends over time (monthly breakdown by category)
    const categoryTrendsMap = new Map<string, Map<string, { events: number; sandwiches: number }>>();
    filteredEvents.forEach((event: any) => {
      const category = normalizeOrganizationCategory(event.organizationCategory);
      const eventDate = parseLocalDate(getEffectiveEventDate(event)) || new Date();
      const monthKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}`;
      const sandwichCount = getEventSandwichCount(event);

      if (!categoryTrendsMap.has(monthKey)) {
        categoryTrendsMap.set(monthKey, new Map());
      }
      const monthData = categoryTrendsMap.get(monthKey)!;
      const existing = monthData.get(category) || { events: 0, sandwiches: 0 };
      monthData.set(category, {
        events: existing.events + 1,
        sandwiches: existing.sandwiches + sandwichCount,
      });
    });

    // Get all unique categories for trend chart
    const allCategories = Array.from(new Set(filteredEvents.map((e: any) => normalizeOrganizationCategory(e.organizationCategory))));

    const categoryTrendsData = Array.from(categoryTrendsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, categoryData]) => {
        const date = parseLocalDate(monthKey + '-01') || new Date();
        const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const row: Record<string, any> = { month: monthLabel, monthKey };

        allCategories.forEach((cat) => {
          const data = categoryData.get(cat);
          row[`${cat}_events`] = data?.events || 0;
          row[`${cat}_sandwiches`] = data?.sandwiches || 0;
        });

        return row;
      });

    // NEW: Regional data
    const regionData = new Map<string, { events: number; sandwiches: number }>();
    filteredEvents.forEach((event: any) => {
      const region = extractRegion(event.eventAddress);
      const sandwichCount = getEventSandwichCount(event);
      const existing = regionData.get(region) || { events: 0, sandwiches: 0 };
      regionData.set(region, {
        events: existing.events + 1,
        sandwiches: existing.sandwiches + sandwichCount,
      });
    });

    const regionalChartData = Array.from(regionData.entries())
      .filter(([region]) => region !== 'Unknown') // Exclude events with no address
      .map(([region, data]) => ({
        region,
        events: data.events,
        sandwiches: data.sandwiches,
        avgPerEvent: data.events > 0 ? Math.round(data.sandwiches / data.events) : 0,
      }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 15); // Top 15 regions

    // Track count of events with unknown location for data quality indicator
    const eventsWithUnknownLocation = regionData.get('Unknown')?.events || 0;

    // NEW: Top organizations with more details (for enhanced leaderboard)
    const orgEventCounts = new Map<string, {
      count: number;
      sandwiches: number;
      category: string;
      lastEventDate: Date | null;
      firstEventDate: Date | null;
    }>();
    filteredEvents.forEach((event: any) => {
      if (event.organizationName) {
        const eventDate = parseLocalDate(getEffectiveEventDate(event)) || new Date();
        const existing = orgEventCounts.get(event.organizationName) || {
          count: 0,
          sandwiches: 0,
          category: normalizeOrganizationCategory(event.organizationCategory),
          lastEventDate: null,
          firstEventDate: null,
        };
        orgEventCounts.set(event.organizationName, {
          count: existing.count + 1,
          sandwiches: existing.sandwiches + getEventSandwichCount(event),
          category: normalizeOrganizationCategory(event.organizationCategory),
          lastEventDate: !existing.lastEventDate || eventDate > existing.lastEventDate ? eventDate : existing.lastEventDate,
          firstEventDate: !existing.firstEventDate || eventDate < existing.firstEventDate ? eventDate : existing.firstEventDate,
        });
      }
    });

    const topOrganizations = Array.from(orgEventCounts.entries())
      .map(([name, data]) => ({
        name,
        ...data,
        avgPerEvent: data.count > 0 ? Math.round(data.sandwiches / data.count) : 0,
      }))
      .sort((a, b) => b.sandwiches - a.sandwiches); // Sort by total sandwiches

    // NEW: Category retention analysis - which categories have repeat organizations?
    const categoryRetentionMap = new Map<string, {
      totalOrgs: number;
      repeatOrgs: number;
      totalEvents: number;
      totalSandwiches: number;
      avgEventsPerOrg: number;
    }>();

    // Group organizations by category and count repeats
    orgEventCounts.forEach((data) => {
      const category = normalizeOrganizationCategory(data.category);
      const existing = categoryRetentionMap.get(category) || {
        totalOrgs: 0,
        repeatOrgs: 0,
        totalEvents: 0,
        totalSandwiches: 0,
        avgEventsPerOrg: 0,
      };
      existing.totalOrgs += 1;
      existing.totalEvents += data.count;
      existing.totalSandwiches += data.sandwiches;
      if (data.count > 1) {
        existing.repeatOrgs += 1;
      }
      categoryRetentionMap.set(category, existing);
    });

    // Calculate averages and format for display
    const categoryRetentionData = Array.from(categoryRetentionMap.entries())
      .filter(([category]) => category !== 'other') // Exclude "other" category
      .map(([category, data]) => ({
        category,
        categoryLabel: getCategoryLabel(category),
        totalOrgs: data.totalOrgs,
        repeatOrgs: data.repeatOrgs,
        repeatRate: data.totalOrgs > 0 ? Math.round((data.repeatOrgs / data.totalOrgs) * 100) : 0,
        avgEventsPerOrg: data.totalOrgs > 0 ? Math.round((data.totalEvents / data.totalOrgs) * 10) / 10 : 0,
        totalEvents: data.totalEvents,
        totalSandwiches: data.totalSandwiches,
      }))
      .filter(d => d.totalOrgs >= 2) // Only show categories with at least 2 organizations
      .sort((a, b) => b.avgEventsPerOrg - a.avgEventsPerOrg); // Sort by avg events per org

    // Also get list of repeat organizations for display
    const repeatOrganizations = Array.from(orgEventCounts.entries())
      .filter(([_, data]) => data.count > 1)
      .map(([name, data]) => ({
        name,
        eventCount: data.count,
        sandwiches: data.sandwiches,
        category: data.category,
        categoryLabel: getCategoryLabel(data.category),
        avgPerEvent: data.count > 0 ? Math.round(data.sandwiches / data.count) : 0,
      }))
      .sort((a, b) => b.eventCount - a.eventCount);

    // Simple retention summary
    const totalOrgs = orgEventCounts.size;
    const repeatOrgCount = repeatOrganizations.length;
    const retentionRate = totalOrgs > 0 ? Math.round((repeatOrgCount / totalOrgs) * 100) : 0;

    // NEW: Data quality metrics
    const dataQuality = {
      totalEvents: filteredEvents.length,
      missingSandwichCount: filteredEvents.filter((e: any) => !e.actualSandwichCount && !e.estimatedSandwichCount).length,
      missingCategory: filteredEvents.filter((e: any) => !e.organizationCategory).length,
      missingAddress: filteredEvents.filter((e: any) => !e.eventAddress).length,
      missingOrgName: filteredEvents.filter((e: any) => !e.organizationName).length,
      missingSandwichPct: 0,
      missingCategoryPct: 0,
      missingAddressPct: 0,
    };

    dataQuality.missingSandwichPct = filteredEvents.length > 0 ? Math.round((dataQuality.missingSandwichCount / filteredEvents.length) * 100) : 0;
    dataQuality.missingCategoryPct = filteredEvents.length > 0 ? Math.round((dataQuality.missingCategory / filteredEvents.length) * 100) : 0;
    dataQuality.missingAddressPct = filteredEvents.length > 0 ? Math.round((dataQuality.missingAddress / filteredEvents.length) * 100) : 0;

    return {
      filteredEvents,
      completedEvents,
      scheduledEvents,
      totalEvents: filteredEvents.length,
      totalCompleted: completedEvents.length,
      totalScheduled: scheduledEvents.length,
      totalSandwiches,
      totalActualSandwiches,
      totalEstimatedSandwiches,
      totalVolunteers,
      totalAdults,
      totalChildren,
      uniqueOrganizations: organizations.size,
      avgSandwichesPerEvent: filteredEvents.length > 0 ? Math.round(totalSandwiches / filteredEvents.length) : 0,
      monthlyChartData,
      categoryChartData,
      weekdayChartData,
      topOrganizations,
      // NEW data
      sandwichDistribution,
      avgSandwichesByCategory,
      categoryTrendsData,
      allCategories,
      regionalChartData,
      categoryRetentionData,
      repeatOrganizations,
      retentionRate,
      repeatOrgCount,
      dataQuality,
      sandwichTypeBreakdown,
      // Data integrity issues
      duplicateCollections,
      orphanedCollections,
    };
  }, [eventRequests, unlinkedCollections, dateRange, statusFilter, categoryFilter, sortField, sortDirection]);

  // Get unique categories for filter
  const availableCategories = useMemo(() => {
    if (!Array.isArray(eventRequests)) return [];
    const categories = new Set<string>();
    eventRequests.forEach((event: any) => {
      if (event.organizationCategory) {
        categories.add(normalizeOrganizationCategory(event.organizationCategory));
      }
    });
    return Array.from(categories).sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b)));
  }, [eventRequests]);

  // Export to CSV
  const exportToCSV = () => {
    if (!processedData) return;

    const csvRows = [
      ['Event Impact Report'],
      [`Report Period: ${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`],
      ['Generated: ' + new Date().toLocaleString()],
      [''],
      ['SUMMARY METRICS'],
      ['Metric', 'Value'],
      ['Total Events', processedData.totalEvents],
      ['Completed Events', processedData.totalCompleted],
      ['Scheduled Events', processedData.totalScheduled],
      ['Total Sandwiches', processedData.totalSandwiches],
      ['Average Sandwiches per Event', processedData.avgSandwichesPerEvent],
      ['Unique Organizations', processedData.uniqueOrganizations],
      ['Total Volunteers', processedData.totalVolunteers],
      [''],
      ['CATEGORY BREAKDOWN'],
      ['Category', 'Events', 'Sandwiches', 'Avg per Event'],
      ...processedData.categoryChartData.map(c => [c.name, c.events, c.sandwiches, c.avgSandwiches]),
      [''],
      ['TOP ORGANIZATIONS'],
      ['Organization', 'Events', 'Sandwiches', 'Category'],
      ...processedData.topOrganizations.map(o => [o.name, o.count, o.sandwiches, getCategoryLabel(o.category)]),
      [''],
      ['EVENT DETAILS'],
      ['Date', 'Organization', 'Category', 'Status', 'Sandwiches (Est)', 'Sandwiches (Actual)', 'Event Time', 'Address'],
      ...processedData.filteredEvents.map((e: any) => [
        (parseLocalDate(getEffectiveEventDate(e)) || new Date()).toLocaleDateString(),
        e.organizationName || 'N/A',
        getCategoryLabel(e.organizationCategory),
        e.status || 'N/A',
        e.estimatedSandwichCount || '',
        e.actualSandwichCount || '',
        e.eventStartTime || '',
        e.eventAddress || '',
      ]),
    ];

    // Escape CSV cell values: convert to string, escape quotes by doubling them
    const escapeCell = (cell: any) => {
      const str = String(cell ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };
    const csvContent = csvRows.map(row => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `event-impact-report-${dateRange.start.toISOString().split('T')[0]}-to-${dateRange.end.toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Helper for keyboard navigation on sortable headers
  const handleSortKeyDown = (field: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(field);
    }
  };

  // Helper for toggle expansion with keyboard support
  const toggleEventExpansion = (eventId: number) => {
    setExpandedEvent(expandedEvent === eventId ? null : eventId);
  };

  const handleExpandKeyDown = (eventId: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleEventExpansion(eventId);
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  const formatEventDate = (date: string | null) => {
    if (!date) return 'TBD';
    const parsedDate = parseLocalDate(date);
    if (!parsedDate) return 'TBD';
    return parsedDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatEventDateSimple = (date: string | null | undefined) => {
    if (!date) return 'N/A';
    const parsedDate = parseLocalDate(date);
    if (!parsedDate) return 'N/A';
    return parsedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-brand-primary-lighter to-brand-primary-light min-h-screen p-6 flex items-center justify-center">
        <div className="text-lg text-gray-600">Loading event data...</div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-brand-primary-lighter to-brand-primary-light min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 print:mb-4">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Group Event Impact Report
          </h1>
          <p className="text-lg text-gray-600">
            Comprehensive data on sandwich-making events, organizations, and impact
          </p>
        </div>

        {/* Prominent Date Range Selector */}
        <Card className="mb-4 print:hidden border-2 border-[#236383]/20">
          <CardContent className="pt-6">
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
              {/* Quick Presets */}
              <div className="flex-1">
                <Label className="text-sm font-medium mb-2 block">Quick Select</Label>
                <div className="flex flex-wrap gap-2">
                  {TIME_PRESETS.slice(0, 6).map(preset => (
                    <Button
                      key={preset.value}
                      variant={timePreset === preset.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTimePreset(preset.value)}
                      className={timePreset === preset.value ? 'bg-[#236383] hover:bg-[#236383]/90' : ''}
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <Button
                    variant={timePreset === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTimePreset('custom')}
                    className={timePreset === 'custom' ? 'bg-[#236383] hover:bg-[#236383]/90' : ''}
                  >
                    Custom Range
                  </Button>
                </div>
              </div>

              {/* Calendar Date Pickers */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">From</Label>
                  <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full sm:w-[160px] justify-start text-left font-normal"
                      >
                        <CalendarDays className="mr-2 h-4 w-4 shrink-0" />
                        <span className="truncate">{format(dateRange.start, 'MMM d, yyyy')}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={dateRange.start}
                        onSelect={(date) => {
                          if (date) {
                            setCustomStartDate(format(date, 'yyyy-MM-dd'));
                            // Auto-fill end date if not set
                            if (!customEndDate) {
                              setCustomEndDate(format(dateRange.end, 'yyyy-MM-dd'));
                            }
                            setTimePreset('custom');
                            setStartDateOpen(false);
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1">
                  <Label className="text-sm font-medium">To</Label>
                  <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full sm:w-[160px] justify-start text-left font-normal"
                      >
                        <CalendarDays className="mr-2 h-4 w-4 shrink-0" />
                        <span className="truncate">{format(dateRange.end, 'MMM d, yyyy')}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={dateRange.end}
                        onSelect={(date) => {
                          if (date) {
                            setCustomEndDate(format(date, 'yyyy-MM-dd'));
                            // Auto-fill start date if not set
                            if (!customStartDate) {
                              setCustomStartDate(format(dateRange.start, 'yyyy-MM-dd'));
                            }
                            setTimePreset('custom');
                            setEndDateOpen(false);
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  <Button variant="outline" onClick={exportToCSV} className="flex-1 sm:flex-none">
                    <FileSpreadsheet className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Export CSV</span>
                  </Button>

                  <Button
                    variant="default"
                    onClick={() => generateReportMutation.mutate()}
                    disabled={generateReportMutation.isPending}
                    className="flex-1 sm:flex-none bg-brand-primary hover:bg-brand-primary/90"
                  >
                    {generateReportMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
                        <span className="hidden sm:inline">Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">AI Report</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      setImportCsvData('');
                      setImportAnalysis(null);
                      setImportMappings({});
                      setImportResults(null);
                      setShowImportDialog(true);
                    }}
                  >
                    <FileUp className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Import Data</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Results Summary Bar */}
            <div className="mt-4 p-3 bg-gradient-to-r from-[#236383]/10 to-[#47B3CB]/10 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                <Calendar className="w-4 h-4 inline mr-2 text-[#236383]" />
                <strong>{processedData?.totalEvents || 0}</strong> events from{' '}
                <strong>{format(dateRange.start, 'MMM d, yyyy')}</strong> to{' '}
                <strong>{format(dateRange.end, 'MMM d, yyyy')}</strong>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="text-gray-600"
                >
                  <Filter className="w-4 h-4 mr-1" />
                  Filters
                  {showFilters ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCategorizationTool(!showCategorizationTool)}
                    className="text-brand-teal"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    AI Categorize
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible Additional Filters */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Event Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All active statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Active Statuses</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="scheduled">Scheduled / Rescheduled</SelectItem>
                      <SelectItem value="in_process">In Process</SelectItem>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="rescheduled">Rescheduled</SelectItem>
                      <SelectItem disabled value="_separator" className="text-xs text-gray-400 font-medium">
                        --- Excluded from stats ---
                      </SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Organization Type</Label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {availableCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {getCategoryLabel(cat)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setStatusFilter('all');
                      setCategoryFilter('all');
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin AI Categorization Tool */}
        {isAdmin && showCategorizationTool && (
          <Card className="mb-4 print:hidden border-2 border-brand-teal/30 bg-brand-teal-light/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-brand-navy">
                <Sparkles className="w-5 h-5" />
                AI Organization Categorization Tool
              </CardTitle>
              <CardDescription>
                Use AI to automatically categorize events/organizations currently marked as "Other"
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Show count of "Other" organizations */}
              <div className="mb-4 p-3 bg-white rounded-lg border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      Organizations needing categorization
                    </p>
                    <p className="text-sm text-gray-500">
                      Events/organizations currently categorized as "Other" or uncategorized
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-lg px-3 py-1">
                    {processedData?.categoryChartData?.find(c => c.rawCategory === 'other')?.events || 0} events
                  </Badge>
                </div>
              </div>

              {/* Progress display */}
              {categorizationProgress && (
                <div className="mb-4 p-4 bg-white rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    {categorizationProgress.running ? (
                      <Loader2 className="w-4 h-4 animate-spin text-brand-teal" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    )}
                    <span className="font-medium">
                      {categorizationProgress.running ? 'Processing...' : 'Complete'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Processed:</span>{' '}
                      <strong>{categorizationProgress.processed}/{categorizationProgress.total}</strong>
                    </div>
                    <div>
                      <span className="text-gray-500">Pattern Matched:</span>{' '}
                      <strong className="text-blue-600">{categorizationProgress.patternMatched}</strong>
                    </div>
                    <div>
                      <span className="text-gray-500">AI Categorized:</span>{' '}
                      <strong className="text-brand-teal">{categorizationProgress.aiCategorized}</strong>
                    </div>
                    <div>
                      <span className="text-gray-500">Errors:</span>{' '}
                      <strong className={categorizationProgress.errors > 0 ? 'text-red-600' : 'text-gray-400'}>
                        {categorizationProgress.errors}
                      </strong>
                    </div>
                  </div>
                  {categorizationProgress.running && (
                    <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-brand-teal h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(categorizationProgress.processed / categorizationProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={async () => {
                    setCategorizationProgress({
                      running: true,
                      total: 0,
                      processed: 0,
                      patternMatched: 0,
                      aiCategorized: 0,
                      errors: 0,
                    });

                    try {
                      const response = await fetch('/api/ai-categorize-organizations', {
                        method: 'POST',
                        credentials: 'include',
                      });
                      const result = await response.json();

                      setCategorizationProgress({
                        running: false,
                        total: result.results?.total || 0,
                        processed: result.results?.total || 0,
                        patternMatched: result.results?.patternMatched || 0,
                        aiCategorized: result.results?.aiCategorized || 0,
                        errors: result.results?.errors || 0,
                      });

                      // Refresh data
                      invalidateEventRequestQueries(queryClient);
                    } catch (error) {
                      setCategorizationProgress((prev) =>
                        prev ? { ...prev, running: false, errors: prev.errors + 1 } : null
                      );
                    }
                  }}
                  disabled={categorizationProgress?.running}
                  className="bg-brand-primary hover:bg-brand-primary-dark"
                >
                  {categorizationProgress?.running ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Run AI Categorization
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowCategorizationTool(false)}
                >
                  Close
                </Button>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                This uses pattern matching first, then AI for remaining items. Results are saved automatically.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-gradient-to-r from-[#236383] to-[#236383] text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <CalendarDays className="w-5 h-5 mr-2" />
                Total Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {processedData?.totalEvents || 0}
              </div>
              <div className="flex gap-2 mt-2 text-base text-white/85">
                <span className="bg-green-500/30 px-2 py-0.5 rounded text-sm">
                  {processedData?.totalCompleted || 0} completed
                </span>
                <span className="bg-blue-500/30 px-2 py-0.5 rounded text-sm">
                  {processedData?.totalScheduled || 0} scheduled
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-[#FBAD3F] to-[#f59e0b] text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <Sandwich className="w-5 h-5 mr-2" />
                Total Sandwiches
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {processedData?.totalSandwiches?.toLocaleString() || 0}
              </div>
              <p className="text-white/85 text-base mt-1">
                ~{processedData?.avgSandwichesPerEvent || 0} avg per event
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-[#47B3CB] to-teal-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <Building className="w-5 h-5 mr-2" />
                Organizations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {processedData?.uniqueOrganizations || 0}
              </div>
              <p className="text-white/85 text-base mt-1">
                Unique organizations served
              </p>
            </CardContent>
          </Card>

          <Card className="bg-brand-burgundy text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <Users className="w-5 h-5 mr-2" />
                Volunteers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {processedData?.totalVolunteers?.toLocaleString() || 0}
              </div>
              <p className="text-white/85 text-base mt-1">
                Total volunteers engaged
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="events" className="space-y-6">
          <TabsList className="print:hidden grid grid-cols-4 lg:grid-cols-7 h-auto gap-1">
            <TabsTrigger value="events" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <ListFilter className="w-4 h-4" />
              <span className="hidden sm:inline">Event List</span>
              <span className="sm:hidden">Events</span>
            </TabsTrigger>
            <TabsTrigger value="sandwiches" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <Sandwich className="w-4 h-4" />
              <span className="hidden sm:inline">Sandwich Analysis</span>
              <span className="sm:hidden">Sandwiches</span>
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">By Category</span>
              <span className="sm:hidden">Categories</span>
            </TabsTrigger>
            <TabsTrigger value="geographic" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <MapPin className="w-4 h-4" />
              <span className="hidden sm:inline">Geographic</span>
              <span className="sm:hidden">Regions</span>
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <Building className="w-4 h-4" />
              <span className="hidden sm:inline">Organizations</span>
              <span className="sm:hidden">Orgs</span>
            </TabsTrigger>
            <TabsTrigger value="trends" className="flex items-center gap-1 text-xs sm:text-sm py-2">
              <TrendingUp className="w-4 h-4" />
              Trends
            </TabsTrigger>
            <TabsTrigger value="ai-insights" className="flex items-center gap-1 text-xs sm:text-sm py-2 bg-gradient-to-r from-[#47B3CB]/10 to-[#236383]/10 data-[state=active]:from-[#47B3CB] data-[state=active]:to-[#236383] data-[state=active]:text-white">
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">AI Insights</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
          </TabsList>

          {/* Events List Tab */}
          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Event Details</CardTitle>
                <CardDescription>
                  All events in the selected time period with detailed information
                </CardDescription>
              </CardHeader>
              <CardContent>
                {processedData?.filteredEvents && processedData.filteredEvents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort('date')}
                            tabIndex={0}
                            role="columnheader"
                            aria-sort={sortField === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                            onKeyDown={handleSortKeyDown('date')}
                          >
                            <div className="flex items-center gap-1">
                              Date <SortIcon field="date" />
                            </div>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort('organization')}
                            tabIndex={0}
                            role="columnheader"
                            aria-sort={sortField === 'organization' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                            onKeyDown={handleSortKeyDown('organization')}
                          >
                            <div className="flex items-center gap-1">
                              Organization <SortIcon field="organization" />
                            </div>
                          </TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort('category')}
                            tabIndex={0}
                            role="columnheader"
                            aria-sort={sortField === 'category' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                            onKeyDown={handleSortKeyDown('category')}
                          >
                            <div className="flex items-center gap-1">
                              Category <SortIcon field="category" />
                            </div>
                          </TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead
                            className="cursor-pointer hover:bg-gray-100 text-right"
                            onClick={() => handleSort('sandwiches')}
                            tabIndex={0}
                            role="columnheader"
                            aria-sort={sortField === 'sandwiches' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                            onKeyDown={handleSortKeyDown('sandwiches')}
                          >
                            <div className="flex items-center gap-1 justify-end">
                              Sandwiches <SortIcon field="sandwiches" />
                            </div>
                          </TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedData.filteredEvents.flatMap((event: any) => {
                          const rows = [
                            <TableRow
                              key={`row-${event.id}`}
                              className="cursor-pointer hover:bg-gray-50"
                              onClick={() => toggleEventExpansion(event.id)}
                              tabIndex={0}
                              aria-expanded={expandedEvent === event.id}
                              onKeyDown={handleExpandKeyDown(event.id)}
                            >
                              <TableCell className="font-medium">
                                {formatEventDate(getEffectiveEventDate(event))}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{event.organizationName || 'N/A'}</div>
                                {event.department && (
                                  <div className="text-sm text-gray-500">{event.department}</div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {getCategoryLabel(event.organizationCategory)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={STATUS_COLORS[event.status] || 'bg-gray-100 text-gray-800'}>
                                  {event.status || 'N/A'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div>
                                  {event.actualSandwichCount ? (
                                    <span className="font-bold text-green-600">
                                      {event.actualSandwichCount.toLocaleString()}
                                    </span>
                                  ) : event.estimatedSandwichCount ? (
                                    <span className="text-gray-600">
                                      ~{event.estimatedSandwichCount.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {event.eventStartTime && (
                                  <div className="flex items-center gap-1 text-sm">
                                    <Clock className="w-3 h-3" />
                                    {event.eventStartTime}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ];
                          if (expandedEvent === event.id) {
                            rows.push(
                              <TableRow key={`expanded-${event.id}`} className="bg-gray-50">
                                <TableCell colSpan={6}>
                                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {event.eventAddress && (
                                      <div>
                                        <div className="flex items-center gap-1 text-sm font-medium text-gray-500 mb-1">
                                          <MapPin className="w-3 h-3" />
                                          Location
                                        </div>
                                        <div className="text-sm">{event.eventAddress}</div>
                                      </div>
                                    )}
                                    <div>
                                      <div className="text-sm font-medium text-gray-500 mb-1">Contact</div>
                                      <div className="text-sm">
                                        {event.firstName} {event.lastName}
                                        {event.email && <div className="text-gray-500">{event.email}</div>}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-sm font-medium text-gray-500 mb-1">Sandwich Details</div>
                                      <div className="text-sm">
                                        {event.estimatedSandwichCount && (
                                          <div>Estimated: {event.estimatedSandwichCount.toLocaleString()}</div>
                                        )}
                                        {event.actualSandwichCount && (
                                          <div className="text-green-600 font-medium">
                                            Actual: {event.actualSandwichCount.toLocaleString()}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {event.volunteerCount && (
                                      <div>
                                        <div className="text-sm font-medium text-gray-500 mb-1">Volunteers</div>
                                        <div className="text-sm">{event.volunteerCount} expected</div>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          }
                          return rows;
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No events found for the selected filters</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sandwich Analysis Tab - NEW */}
          <TabsContent value="sandwiches">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Sandwich Type Breakdown - NEW */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sandwich className="w-5 h-5" />
                    Sandwich Types Breakdown
                  </CardTitle>
                  <CardDescription>
                    Distribution of sandwich types across all events in the selected period
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.sandwichTypeBreakdown && Object.values(processedData.sandwichTypeBreakdown).some(v => v > 0) ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Pie Chart */}
                      <ResponsiveContainer width="100%" height={300}>
                        <RechartsPieChart>
                          <Pie
                            data={[
                              { name: 'Deli', value: processedData.sandwichTypeBreakdown.deli, color: '#236383' },
                              { name: 'Turkey', value: processedData.sandwichTypeBreakdown.turkey, color: '#FBAD3F' },
                              { name: 'Ham', value: processedData.sandwichTypeBreakdown.ham, color: '#47B3CB' },
                              { name: 'PB&J', value: processedData.sandwichTypeBreakdown.pbj, color: '#9333ea' },
                              { name: 'Other', value: processedData.sandwichTypeBreakdown.generic, color: '#6B7280' },
                            ].filter(d => d.value > 0)}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {[
                              { name: 'Deli', value: processedData.sandwichTypeBreakdown.deli, color: '#236383' },
                              { name: 'Turkey', value: processedData.sandwichTypeBreakdown.turkey, color: '#FBAD3F' },
                              { name: 'Ham', value: processedData.sandwichTypeBreakdown.ham, color: '#47B3CB' },
                              { name: 'PB&J', value: processedData.sandwichTypeBreakdown.pbj, color: '#9333ea' },
                              { name: 'Other', value: processedData.sandwichTypeBreakdown.generic, color: '#6B7280' },
                            ].filter(d => d.value > 0).map((entry, index) => (
                              <Cell key={`type-cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Sandwiches']} />
                        </RechartsPieChart>
                      </ResponsiveContainer>

                      {/* Stats Table */}
                      <div className="space-y-4">
                        <div className="text-sm font-medium text-gray-500 mb-2">Breakdown by Type</div>
                        {[
                          { name: 'Deli', value: processedData.sandwichTypeBreakdown.deli, color: '#236383' },
                          { name: 'Turkey', value: processedData.sandwichTypeBreakdown.turkey, color: '#FBAD3F' },
                          { name: 'Ham', value: processedData.sandwichTypeBreakdown.ham, color: '#47B3CB' },
                          { name: 'PB&J', value: processedData.sandwichTypeBreakdown.pbj, color: '#9333ea' },
                          { name: 'Other/Generic', value: processedData.sandwichTypeBreakdown.generic, color: '#6B7280' },
                        ].map((type) => {
                          const total = Object.values(processedData.sandwichTypeBreakdown).reduce((a, b) => a + b, 0);
                          const pct = total > 0 ? ((type.value / total) * 100).toFixed(1) : '0';
                          return (
                            <div key={type.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: type.color }} />
                                <span className="font-medium">{type.name}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-lg">{type.value.toLocaleString()}</span>
                                <span className="text-gray-500 text-sm ml-2">({pct}%)</span>
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-2 border-t">
                          <div className="flex items-center justify-between p-3 bg-[#236383] text-white rounded-lg">
                            <span className="font-medium">Total with Type Data</span>
                            <span className="font-bold text-lg">
                              {Object.values(processedData.sandwichTypeBreakdown).reduce((a, b) => a + b, 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-[300px] flex flex-col items-center justify-center text-gray-500">
                      <Sandwich className="w-12 h-12 mb-4 opacity-30" />
                      <p className="font-medium">No sandwich type data available</p>
                      <p className="text-sm mt-1">Type data comes from the "actualSandwichTypes" field on completed events</p>
                      {isAdmin && (
                        <Button
                          className="mt-4 bg-purple-600 hover:bg-purple-700"
                          onClick={() => {
                            setShowBackfillTool(true);
                            fetchMissingTypesMutation.mutate();
                          }}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Smart Backfill Tool
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Smart Backfill Tool Card - Admin Only */}
              {isAdmin && (
                <Card className="lg:col-span-2 border-2 border-purple-200 bg-purple-50/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-900">
                      <Sparkles className="w-5 h-5" />
                      Smart Sandwich Type Backfill
                    </CardTitle>
                    <CardDescription>
                      Use AI to analyze historical patterns and suggest sandwich type distributions for events missing this data
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!showBackfillTool ? (
                      <div className="text-center py-6">
                        <p className="text-gray-600 mb-4">
                          This tool analyzes your existing event data to find patterns and suggests sandwich type breakdowns
                          for events that have total counts but no type information.
                        </p>
                        <Button
                          onClick={() => {
                            setShowBackfillTool(true);
                            fetchMissingTypesMutation.mutate();
                          }}
                          disabled={fetchMissingTypesMutation.isPending}
                          className="bg-purple-600 hover:bg-purple-700"
                        >
                          {fetchMissingTypesMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4 mr-2" />
                              Launch Smart Backfill Tool
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Step indicator */}
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${backfillStep === 'select' ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>
                            1. Select Events
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${backfillStep === 'review' ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>
                            2. Review Suggestions
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${backfillStep === 'complete' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>
                            3. Complete
                          </div>
                        </div>

                        {/* Step 1: Manual Entry */}
                        {backfillStep === 'select' && backfillData && (
                          <div className="space-y-4">
                            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                              <p className="font-medium text-blue-900">{backfillData.totalMissing} events missing sandwich type data</p>
                              <p className="text-sm text-blue-700 mt-1">
                                Enter the sandwich type breakdown for each event below. The "Sum" column shows your total - it will turn orange if it doesn't match the event's total sandwich count.
                              </p>
                            </div>

                            <div className="max-h-[500px] overflow-y-auto border rounded-lg">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Organization</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-center w-20">Deli</TableHead>
                                    <TableHead className="text-center w-20">Turkey</TableHead>
                                    <TableHead className="text-center w-20">Ham</TableHead>
                                    <TableHead className="text-center w-20">PB&J</TableHead>
                                    <TableHead className="text-center w-20">Sum</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {backfillData.eventsMissingTypes.slice(0, 100).map((event) => {
                                    const entry = manualEntries.get(event.id) || { deli: 0, turkey: 0, ham: 0, pbj: 0 };
                                    const entrySum = entry.deli + entry.turkey + entry.ham + entry.pbj;
                                    const hasEntry = entrySum > 0;
                                    return (
                                      <TableRow key={event.id} className={hasEntry ? 'bg-green-50' : ''}>
                                        <TableCell className="font-medium">
                                          {event.organizationName || 'Unknown'}
                                          {event.department && <span className="text-gray-500 font-normal"> • {event.department}</span>}
                                        </TableCell>
                                        <TableCell>{formatEventDateSimple(event.scheduledEventDate)}</TableCell>
                                        <TableCell className="text-right font-medium">{event.actualSandwichCount?.toLocaleString()}</TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={entry.deli || ''}
                                            onChange={(e) => {
                                              const newEntries = new Map(manualEntries);
                                              newEntries.set(event.id, { ...entry, deli: parseInt(e.target.value) || 0 });
                                              setManualEntries(newEntries);
                                            }}
                                            className="w-16 h-8 text-center p-1"
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={entry.turkey || ''}
                                            onChange={(e) => {
                                              const newEntries = new Map(manualEntries);
                                              newEntries.set(event.id, { ...entry, turkey: parseInt(e.target.value) || 0 });
                                              setManualEntries(newEntries);
                                            }}
                                            className="w-16 h-8 text-center p-1"
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={entry.ham || ''}
                                            onChange={(e) => {
                                              const newEntries = new Map(manualEntries);
                                              newEntries.set(event.id, { ...entry, ham: parseInt(e.target.value) || 0 });
                                              setManualEntries(newEntries);
                                            }}
                                            className="w-16 h-8 text-center p-1"
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={entry.pbj || ''}
                                            onChange={(e) => {
                                              const newEntries = new Map(manualEntries);
                                              newEntries.set(event.id, { ...entry, pbj: parseInt(e.target.value) || 0 });
                                              setManualEntries(newEntries);
                                            }}
                                            className="w-16 h-8 text-center p-1"
                                          />
                                        </TableCell>
                                        <TableCell className={`text-center font-medium ${entrySum > 0 && entrySum !== event.actualSandwichCount ? 'text-orange-600' : entrySum > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                          {entrySum > 0 ? entrySum : '-'}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>

                            <div className="flex justify-between items-center">
                              <p className="text-sm text-gray-500">
                                {Array.from(manualEntries.values()).filter(e => e.deli + e.turkey + e.ham + e.pbj > 0).length} events with manual entries
                              </p>
                              <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setShowBackfillTool(false)}>
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => {
                                    // Save manual entries directly
                                    const approvals = Array.from(manualEntries.entries())
                                      .filter(([_, entry]) => entry.deli + entry.turkey + entry.ham + entry.pbj > 0)
                                      .map(([eventId, entry]) => ({
                                        eventId,
                                        types: { ...entry, generic: 0 },
                                      }));
                                    applyBackfillMutation.mutate(approvals);
                                  }}
                                  disabled={Array.from(manualEntries.values()).filter(e => e.deli + e.turkey + e.ham + e.pbj > 0).length === 0 || applyBackfillMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  {applyBackfillMutation.isPending ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Saving...
                                    </>
                                  ) : (
                                    <>
                                      Save Manual Entries ({Array.from(manualEntries.values()).filter(e => e.deli + e.turkey + e.ham + e.pbj > 0).length})
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Step 2: Review Suggestions */}
                        {backfillStep === 'review' && backfillSuggestions && (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
                              <div>
                                <p className="font-medium">{backfillSuggestions.length} suggestions generated</p>
                                <p className="text-sm text-gray-500">
                                  Review and approve suggestions before applying
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setBackfillSuggestions(backfillSuggestions.map(s => ({ ...s, approved: true })));
                                  }}
                                >
                                  Approve All
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setBackfillSuggestions(backfillSuggestions.map(s => ({ ...s, approved: false })));
                                  }}
                                >
                                  Reject All
                                </Button>
                              </div>
                            </div>

                            <div className="max-h-[400px] overflow-y-auto space-y-2">
                              {backfillSuggestions.map((suggestion, idx) => (
                                <div
                                  key={suggestion.eventId}
                                  className={`p-4 rounded-lg border ${suggestion.approved ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}
                                >
                                  <div className="flex items-start justify-between mb-2">
                                    <div>
                                      <p className="font-medium">{suggestion.organizationName}</p>
                                      <p className="text-sm text-gray-500">
                                        {formatEventDateSimple(suggestion.scheduledEventDate)} • {suggestion.actualSandwichCount} sandwiches
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge className={
                                        suggestion.confidence === 'high' ? 'bg-green-100 text-green-800' :
                                        suggestion.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800'
                                      }>
                                        {suggestion.confidence} confidence
                                      </Badge>
                                      <Button
                                        variant={suggestion.approved ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => {
                                          const newSuggestions = [...backfillSuggestions];
                                          newSuggestions[idx] = { ...suggestion, approved: !suggestion.approved };
                                          setBackfillSuggestions(newSuggestions);
                                        }}
                                      >
                                        {suggestion.approved ? 'Approved' : 'Approve'}
                                      </Button>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500 mb-2">{suggestion.reasoning}</p>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                                    <div className="flex items-center gap-1">
                                      <label className="text-gray-600 whitespace-nowrap">Deli:</label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={suggestion.suggestion.deli}
                                        onChange={(e) => {
                                          const newSuggestions = [...backfillSuggestions];
                                          newSuggestions[idx] = {
                                            ...suggestion,
                                            suggestion: { ...suggestion.suggestion, deli: parseInt(e.target.value) || 0 },
                                            edited: true,
                                          };
                                          setBackfillSuggestions(newSuggestions);
                                        }}
                                        className="w-20 h-8 text-center"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <label className="text-gray-600 whitespace-nowrap">Turkey:</label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={suggestion.suggestion.turkey}
                                        onChange={(e) => {
                                          const newSuggestions = [...backfillSuggestions];
                                          newSuggestions[idx] = {
                                            ...suggestion,
                                            suggestion: { ...suggestion.suggestion, turkey: parseInt(e.target.value) || 0 },
                                            edited: true,
                                          };
                                          setBackfillSuggestions(newSuggestions);
                                        }}
                                        className="w-20 h-8 text-center"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <label className="text-gray-600 whitespace-nowrap">Ham:</label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={suggestion.suggestion.ham}
                                        onChange={(e) => {
                                          const newSuggestions = [...backfillSuggestions];
                                          newSuggestions[idx] = {
                                            ...suggestion,
                                            suggestion: { ...suggestion.suggestion, ham: parseInt(e.target.value) || 0 },
                                            edited: true,
                                          };
                                          setBackfillSuggestions(newSuggestions);
                                        }}
                                        className="w-20 h-8 text-center"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <label className="text-gray-600 whitespace-nowrap">PB&J:</label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={suggestion.suggestion.pbj}
                                        onChange={(e) => {
                                          const newSuggestions = [...backfillSuggestions];
                                          newSuggestions[idx] = {
                                            ...suggestion,
                                            suggestion: { ...suggestion.suggestion, pbj: parseInt(e.target.value) || 0 },
                                            edited: true,
                                          };
                                          setBackfillSuggestions(newSuggestions);
                                        }}
                                        className="w-20 h-8 text-center"
                                      />
                                    </div>
                                  </div>
                                  {suggestion.edited && (
                                    <p className="text-xs text-blue-600 mt-1">Manually edited</p>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="flex justify-between items-center">
                              <p className="text-sm text-gray-500">
                                {backfillSuggestions.filter(s => s.approved).length} of {backfillSuggestions.length} approved
                              </p>
                              <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setBackfillStep('select')}>
                                  Back
                                </Button>
                                <Button
                                  onClick={() => {
                                    const approvals = backfillSuggestions
                                      .filter(s => s.approved)
                                      .map(s => ({ eventId: s.eventId, types: s.suggestion }));
                                    applyBackfillMutation.mutate(approvals);
                                  }}
                                  disabled={backfillSuggestions.filter(s => s.approved).length === 0 || applyBackfillMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  {applyBackfillMutation.isPending ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Applying...
                                    </>
                                  ) : (
                                    <>
                                      Apply {backfillSuggestions.filter(s => s.approved).length} Changes
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Step 3: Complete */}
                        {backfillStep === 'complete' && (
                          <div className="text-center py-8">
                            <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-green-800 mb-2">Backfill Complete!</h3>
                            <p className="text-gray-600 mb-4">
                              Sandwich type data has been added to your events. The charts above should now show the updated data.
                            </p>
                            <Button
                              onClick={() => {
                                setShowBackfillTool(false);
                                setBackfillData(null);
                                setBackfillSuggestions(null);
                                setSelectedBackfillEvents(new Set());
                                setManualEntries(new Map());
                                setBackfillStep('select');
                              }}
                            >
                              Done
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Sandwich Distribution Histogram */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sandwich className="w-5 h-5" />
                    Sandwiches per Event Distribution
                  </CardTitle>
                  <CardDescription>
                    How many sandwiches do your events typically make? This histogram shows the distribution.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.sandwichDistribution && processedData.sandwichDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={processedData.sandwichDistribution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" angle={-45} textAnchor="end" height={80} fontSize={12} />
                        <YAxis label={{ value: 'Number of Events', angle: -90, position: 'insideLeft' }} />
                        <Tooltip
                          formatter={(value: number) => [`${value} events`, 'Events']}
                          labelFormatter={(label) => `${label} sandwiches`}
                        />
                        <Bar dataKey="count" fill="#236383" name="Events">
                          {processedData.sandwichDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[350px] flex items-center justify-center text-gray-500">
                      No sandwich distribution data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Average Sandwiches by Organization Type */}
              <Card>
                <CardHeader>
                  <CardTitle>Average Sandwiches by Organization Type</CardTitle>
                  <CardDescription>
                    Which organization types produce the most sandwiches per event?
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.avgSandwichesByCategory && processedData.avgSandwichesByCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={processedData.avgSandwichesByCategory} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="category" type="category" width={120} fontSize={11} />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === 'avgSandwiches') return [`${value.toLocaleString()}`, 'Avg per Event'];
                            return [value, name];
                          }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 border rounded shadow-lg text-sm">
                                  <p className="font-bold">{data.category}</p>
                                  <p>Avg: <span className="font-semibold">{data.avgSandwiches.toLocaleString()}</span> sandwiches</p>
                                  <p className="text-gray-500">Range: {data.minSandwiches.toLocaleString()} - {data.maxSandwiches.toLocaleString()}</p>
                                  <p className="text-gray-500">Based on {data.eventCount} events</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="avgSandwiches" fill="#FBAD3F" name="Avg Sandwiches" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[350px] flex items-center justify-center text-gray-500">
                      No category data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Category Stats Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Detailed Category Statistics</CardTitle>
                  <CardDescription>Event counts and sandwich ranges by organization type</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.avgSandwichesByCategory && processedData.avgSandwichesByCategory.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Events</TableHead>
                          <TableHead className="text-right">Avg</TableHead>
                          <TableHead className="text-right">Min</TableHead>
                          <TableHead className="text-right">Max</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedData.avgSandwichesByCategory.map((cat) => (
                          <TableRow key={cat.rawCategory}>
                            <TableCell className="font-medium">{cat.category}</TableCell>
                            <TableCell className="text-right">{cat.eventCount}</TableCell>
                            <TableCell className="text-right font-semibold text-[#FBAD3F]">{cat.avgSandwiches.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-gray-500">{cat.minSandwiches.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-gray-500">{cat.maxSandwiches.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{cat.totalSandwiches.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No data available</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Breakdown Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Events by Organization Type</CardTitle>
                  <CardDescription>Distribution of events across different organization categories</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.categoryChartData && processedData.categoryChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <RechartsPieChart>
                        <Pie
                          data={processedData.categoryChartData}
                          dataKey="events"
                          nameKey="name"
                          cx="50%"
                          cy="40%"
                          outerRadius={80}
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                        >
                          {processedData.categoryChartData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number, name: string) => [`${value} events`, name]} />
                        <Legend 
                          layout="horizontal" 
                          verticalAlign="bottom" 
                          align="center"
                          wrapperStyle={{ paddingTop: '20px' }}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-gray-500">
                      No category data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Category Details Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Category Statistics</CardTitle>
                  <CardDescription>Detailed breakdown by organization type</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.categoryChartData && processedData.categoryChartData.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Events</TableHead>
                          <TableHead className="text-right">Sandwiches</TableHead>
                          <TableHead className="text-right">Avg/Event</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedData.categoryChartData.map((cat, index) => (
                          <TableRow key={cat.rawCategory}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                {cat.name}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">{cat.events}</TableCell>
                            <TableCell className="text-right">{cat.sandwiches.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-gray-500">{cat.avgSandwiches}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No data available</div>
                  )}
                </CardContent>
              </Card>

              {/* Sandwiches by Category */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Sandwiches by Category</CardTitle>
                  <CardDescription>Total sandwiches made by organization type</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.categoryChartData && processedData.categoryChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={processedData.categoryChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={150} />
                        <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Sandwiches']} />
                        <Bar dataKey="sandwiches" fill="#236383" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-gray-500">
                      No data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Category Trends Over Time - NEW */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Category Mix Over Time</CardTitle>
                  <CardDescription>
                    How has your organization mix shifted? Track which categories are growing or declining.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.categoryTrendsData && processedData.categoryTrendsData.length > 0 && processedData.allCategories ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <AreaChart data={processedData.categoryTrendsData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {processedData.allCategories.slice(0, 8).map((cat: string, index: number) => (
                          <Area
                            key={cat}
                            type="monotone"
                            dataKey={`${cat}_events`}
                            stackId="1"
                            stroke={COLORS[index % COLORS.length]}
                            fill={COLORS[index % COLORS.length]}
                            name={getCategoryLabel(cat)}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[400px] flex items-center justify-center text-gray-500">
                      Not enough data to show trends
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Geographic Tab - NEW */}
          <TabsContent value="geographic">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Location Entry Tool Card - Admin Only */}
              {isAdmin && (
                <Card className="lg:col-span-2 border-orange-200 bg-orange-50/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-orange-600" />
                      Location Entry Tool
                    </CardTitle>
                    <CardDescription>
                      Add missing addresses to events for better geographic analysis
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!showLocationTool ? (
                      <div className="text-center py-4">
                        <p className="text-gray-600 mb-4">
                          {processedData?.filteredEvents?.filter((e: any) => !e.eventAddress && !e.isFromCollection && e.source !== 'collection' && !String(e.id).startsWith('collection-') && ['new', 'in_process', 'scheduled', 'rescheduled', 'completed'].includes(e.status)).length || 0} events are missing location data.
                        </p>
                        <Button
                          onClick={() => setShowLocationTool(true)}
                          variant="outline"
                          className="border-orange-300 hover:bg-orange-100"
                          disabled={!processedData?.filteredEvents?.filter((e: any) => !e.eventAddress && !e.isFromCollection && e.source !== 'collection' && !String(e.id).startsWith('collection-') && ['new', 'in_process', 'scheduled', 'rescheduled', 'completed'].includes(e.status)).length}
                        >
                          <MapPin className="w-4 h-4 mr-2" />
                          Open Location Entry Tool
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                          <p className="font-medium text-orange-900">Events missing location data</p>
                          <p className="text-sm text-orange-700 mt-1">
                            Enter the address for each event below. You can enter partial addresses like "Atlanta, GA" or full addresses.
                          </p>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto border rounded-lg">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Organization</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Sandwiches</TableHead>
                                <TableHead className="w-1/2">Address</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {processedData?.filteredEvents
                                ?.filter((e: any) => !e.eventAddress && !e.isFromCollection && e.source !== 'collection' && !String(e.id).startsWith('collection-') && ['new', 'in_process', 'scheduled', 'rescheduled', 'completed'].includes(e.status))
                                .slice(0, 100)
                                .map((event: any) => (
                                  <TableRow key={event.id} className={locationEntries.get(event.id) ? 'bg-green-50' : ''}>
                                    <TableCell className="font-medium">
                                      {event.organizationName || 'Unknown'}
                                      {event.department && <span className="text-gray-500 font-normal"> • {event.department}</span>}
                                    </TableCell>
                                    <TableCell>
                                      {formatEventDateSimple(getEffectiveEventDate(event))}
                                    </TableCell>
                                    <TableCell>{getEventSandwichCount(event) || '-'}</TableCell>
                                    <TableCell>
                                      <Input
                                        placeholder="Enter address..."
                                        value={locationEntries.get(event.id) || ''}
                                        onChange={(e) => {
                                          const newEntries = new Map(locationEntries);
                                          if (e.target.value) {
                                            newEntries.set(event.id, e.target.value);
                                          } else {
                                            newEntries.delete(event.id);
                                          }
                                          setLocationEntries(newEntries);
                                        }}
                                        className="w-full"
                                      />
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="flex justify-between items-center">
                          <p className="text-sm text-gray-500">
                            {locationEntries.size} locations entered
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowLocationTool(false);
                                setLocationEntries(new Map());
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={() => {
                                const updates = Array.from(locationEntries.entries())
                                  .filter(([_, address]) => address.trim())
                                  .map(([eventId, address]) => ({ eventId, address: address.trim() }));
                                applyLocationsMutation.mutate(updates);
                              }}
                              disabled={locationEntries.size === 0 || applyLocationsMutation.isPending}
                              className="bg-orange-600 hover:bg-orange-700"
                            >
                              {applyLocationsMutation.isPending ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  Save Locations ({locationEntries.size})
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Regional Breakdown Chart */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5" />
                    Events & Sandwiches by Region
                  </CardTitle>
                  <CardDescription>
                    Where are your events happening? Identify active regions vs underserved areas.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.regionalChartData && processedData.regionalChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart data={processedData.regionalChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="region" angle={-45} textAnchor="end" height={100} fontSize={11} />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 border rounded shadow-lg text-sm">
                                  <p className="font-bold">{data.region}</p>
                                  <p className="text-[#236383]">Events: <span className="font-semibold">{data.events}</span></p>
                                  <p className="text-[#FBAD3F]">Sandwiches: <span className="font-semibold">{data.sandwiches.toLocaleString()}</span></p>
                                  <p className="text-gray-500">Avg per event: {data.avgPerEvent.toLocaleString()}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="events" fill="#236383" name="Events" />
                        <Bar yAxisId="right" dataKey="sandwiches" fill="#FBAD3F" name="Sandwiches" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[400px] flex items-center justify-center text-gray-500">
                      No regional data available (address data may be missing)
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Regional Stats Table */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Regional Statistics</CardTitle>
                  <CardDescription>Detailed breakdown by location</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.regionalChartData && processedData.regionalChartData.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Region</TableHead>
                          <TableHead className="text-right">Events</TableHead>
                          <TableHead className="text-right">Sandwiches</TableHead>
                          <TableHead className="text-right">Avg/Event</TableHead>
                          <TableHead className="text-right">% of Events</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedData.regionalChartData.map((region) => (
                          <TableRow key={region.region}>
                            <TableCell className="font-medium">{region.region}</TableCell>
                            <TableCell className="text-right">{region.events}</TableCell>
                            <TableCell className="text-right">{region.sandwiches.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{region.avgPerEvent.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-gray-500">
                              {processedData.totalEvents > 0
                                ? `${Math.round((region.events / processedData.totalEvents) * 100)}%`
                                : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No regional data available</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Trends Tab */}
          <TabsContent value="trends">
            <div className="grid grid-cols-1 gap-6">
              {/* Monthly Trends */}
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Event Trends</CardTitle>
                  <CardDescription>Events and sandwiches over time</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.monthlyChartData && processedData.monthlyChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={processedData.monthlyChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="events"
                          stroke="#236383"
                          strokeWidth={2}
                          name="Total Events"
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="sandwiches"
                          stroke="#FBAD3F"
                          strokeWidth={2}
                          name="Sandwiches"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[400px] flex items-center justify-center text-gray-500">
                      No trend data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Weekday Distribution - ENHANCED */}
              <Card>
                <CardHeader>
                  <CardTitle>Events & Sandwiches by Day of Week</CardTitle>
                  <CardDescription>
                    Which days are most productive? Compare event counts vs sandwich output.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.weekdayChartData ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={processedData.weekdayChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="day" />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-3 border rounded shadow-lg text-sm">
                                  <p className="font-bold">{data.day}</p>
                                  <p className="text-[#236383]">Events: <span className="font-semibold">{data.events}</span></p>
                                  <p className="text-[#FBAD3F]">Sandwiches: <span className="font-semibold">{data.sandwiches?.toLocaleString() || 0}</span></p>
                                  <p className="text-gray-500">Avg per event: {data.avgPerEvent?.toLocaleString() || 0}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="events" fill="#236383" name="Events" label={{ position: 'top', fontSize: 10 }} />
                        <Bar yAxisId="right" dataKey="sandwiches" fill="#FBAD3F" name="Sandwiches" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[350px] flex items-center justify-center text-gray-500">
                      No data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Monthly Events & Sandwiches */}
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Events & Sandwiches</CardTitle>
                  <CardDescription>
                    Number of events and total sandwiches per month - tracks growth over time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.monthlyChartData && processedData.monthlyChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={processedData.monthlyChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis yAxisId="left" orientation="left" stroke="#47B3CB" />
                        <YAxis yAxisId="right" orientation="right" stroke="#236383" />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            value.toLocaleString(),
                            name === 'events' ? 'Events' : 'Sandwiches'
                          ]}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="events" fill="#47B3CB" name="Events" />
                        <Bar yAxisId="right" dataKey="sandwiches" fill="#236383" name="Sandwiches" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-gray-500">
                      No data available
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          {/* Organizations Tab - ENHANCED */}
          <TabsContent value="organizations">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Retention Summary */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Retention Summary
                  </CardTitle>
                  <CardDescription>
                    Organizations that have hosted more than one event
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <div className="text-3xl font-bold text-blue-700">
                        {processedData?.repeatOrgCount || 0}
                      </div>
                      <div className="text-sm text-blue-600">Repeat Organizations</div>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-600">Total Organizations</span>
                      <span className="font-bold">{processedData?.uniqueOrganizations || 0}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm text-green-700">Retention Rate</span>
                      <span className="font-bold text-green-700">{processedData?.retentionRate || 0}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Category Retention - Which categories produce repeat partners? */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Retention by Category</CardTitle>
                  <CardDescription>Which organization types are most likely to host multiple events? Sorted by average events per organization.</CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.categoryRetentionData && processedData.categoryRetentionData.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Orgs</TableHead>
                            <TableHead className="text-right">Repeat Orgs</TableHead>
                            <TableHead className="text-right">Repeat Rate</TableHead>
                            <TableHead className="text-right">Avg Events/Org</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {processedData.categoryRetentionData.map((cat: any) => (
                            <TableRow key={cat.category}>
                              <TableCell className="font-medium">{cat.categoryLabel}</TableCell>
                              <TableCell className="text-right">{cat.totalOrgs}</TableCell>
                              <TableCell className="text-right">{cat.repeatOrgs}</TableCell>
                              <TableCell className="text-right">
                                <span className={cat.repeatRate >= 30 ? 'text-green-600 font-semibold' : ''}>
                                  {cat.repeatRate}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={cat.avgEventsPerOrg >= 2 ? 'text-blue-600 font-semibold' : ''}>
                                  {cat.avgEventsPerOrg}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-gray-500">
                      No category data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Repeat Organizations List */}
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>Repeat Organizations</CardTitle>
                  <CardDescription>
                    Organizations that have hosted more than one event - your most engaged partners, sorted by event count
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.repeatOrganizations && processedData.repeatOrganizations.length > 0 ? (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Organization</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Events</TableHead>
                            <TableHead className="text-right">Total Sandwiches</TableHead>
                            <TableHead className="text-right">Avg/Event</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {processedData.repeatOrganizations.map((org: any) => (
                            <TableRow key={org.name}>
                              <TableCell className="font-medium">{org.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {org.categoryLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-bold text-blue-600">
                                {org.eventCount}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-[#FBAD3F]">
                                {org.sandwiches.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right text-gray-600">
                                {org.avgPerEvent.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      No repeat organizations found in this time period
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Enhanced Top Organizations Leaderboard */}
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>Organization Leaderboard</CardTitle>
                  <CardDescription>
                    Top organizations by total sandwiches. Click column headers to sort.
                    Organizations with recent events are MVPs; those inactive may need re-engagement.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {processedData?.topOrganizations && processedData.topOrganizations.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Organization</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Total Sandwiches</TableHead>
                            <TableHead className="text-right">Events</TableHead>
                            <TableHead className="text-right">Avg/Event</TableHead>
                            <TableHead className="text-right">Last Event</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {processedData.topOrganizations.slice(0, 25).map((org, index) => {
                            const lastEventParsed = org.lastEventDate ? parseLocalDate(org.lastEventDate) : null;
                            const daysSinceLastEvent = lastEventParsed
                              ? Math.floor((new Date().getTime() - lastEventParsed.getTime()) / (1000 * 60 * 60 * 24))
                              : null;
                            const isInactive = daysSinceLastEvent !== null && daysSinceLastEvent > 365;

                            return (
                              <TableRow key={org.name} className={isInactive ? 'bg-amber-50' : ''}>
                                <TableCell className="font-bold text-gray-400">{index + 1}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{org.name}</div>
                                  {isInactive && (
                                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 mt-1">
                                      Re-engage?
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {getCategoryLabel(org.category)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-bold text-[#FBAD3F]">
                                  {org.sandwiches.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-semibold text-[#236383]">
                                  {org.count}
                                </TableCell>
                                <TableCell className="text-right text-gray-600">
                                  {org.avgPerEvent?.toLocaleString() || '-'}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {lastEventParsed
                                    ? lastEventParsed.toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: '2-digit',
                                      })
                                    : '-'}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <Building className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No organization data available for the selected period</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* AI Insights Tab */}
          <TabsContent value="ai-insights">
            <AIInsightsChat dateRange={dateRange} />
          </TabsContent>
        </Tabs>

        {/* Print-only summary */}
        <div className="hidden print:block mt-8">
          <h3 className="text-lg font-bold mb-4">Summary Data</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2 text-left">Metric</th>
                <th className="border p-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border p-2">Total Events</td><td className="border p-2 text-right">{processedData?.totalEvents || 0}</td></tr>
              <tr><td className="border p-2">Completed Events</td><td className="border p-2 text-right">{processedData?.totalCompleted || 0}</td></tr>
              <tr><td className="border p-2">Scheduled Events</td><td className="border p-2 text-right">{processedData?.totalScheduled || 0}</td></tr>
              <tr><td className="border p-2">Total Sandwiches</td><td className="border p-2 text-right">{processedData?.totalSandwiches?.toLocaleString() || 0}</td></tr>
              <tr><td className="border p-2">Average Sandwiches/Event</td><td className="border p-2 text-right">{processedData?.avgSandwichesPerEvent || 0}</td></tr>
              <tr><td className="border p-2">Unique Organizations</td><td className="border p-2 text-right">{processedData?.uniqueOrganizations || 0}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Duplicate Collections Warning - Data Integrity Issue */}
        {processedData?.duplicateCollections && processedData.duplicateCollections.length > 0 && (
          <Card className="mt-8 border-red-300 bg-red-50 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Data Integrity Issue: Duplicate Collections Found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-red-700 mb-3">
                The following event requests have multiple collections linked to them. This indicates a data issue that should be resolved in the Collections Log.
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {processedData.duplicateCollections.map((dup: any) => (
                  <div key={dup.eventRequestId} className="text-sm bg-white p-2 rounded border border-red-200">
                    <span className="font-medium text-red-900">Event Request #{dup.eventRequestId}</span>
                    <span className="text-red-700 ml-2">
                      — {dup.collections.length} collections linked
                      (IDs: {dup.collections.map((c: any) => c.collectionId).join(', ')})
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Orphaned Collections Warning - Data Integrity Issue */}
        {processedData?.orphanedCollections && processedData.orphanedCollections.length > 0 && (
          <Card className="mt-4 border-orange-300 bg-orange-50 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Data Integrity Issue: Orphaned Collections Found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-orange-700 mb-3">
                The following collections reference event requests that no longer exist. These collections are included in the report but may need their event links updated or cleared.
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {processedData.orphanedCollections.map((orphan: any) => (
                  <div key={orphan.collection.collectionId} className="text-sm bg-white p-2 rounded border border-orange-200">
                    <span className="font-medium text-orange-900">Collection #{orphan.collection.collectionId}</span>
                    <span className="text-orange-700 ml-2">
                      — references deleted Event Request #{orphan.eventRequestId}
                      {orphan.collection.organizationName && ` (${orphan.collection.organizationName})`}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data Quality Notes - at bottom */}
        {processedData?.dataQuality && (processedData.dataQuality.missingSandwichPct > 0 || processedData.dataQuality.missingCategoryPct > 0) && (
          <Card className="mt-8 border-amber-200 bg-amber-50 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Data Quality Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="flex flex-col">
                  <span className="text-amber-700">Missing Sandwich Counts</span>
                  <span className="font-bold text-amber-900">{processedData.dataQuality.missingSandwichCount} ({processedData.dataQuality.missingSandwichPct}%)</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-amber-700">Missing Org Category</span>
                  <span className="font-bold text-amber-900">{processedData.dataQuality.missingCategory} ({processedData.dataQuality.missingCategoryPct}%)</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-amber-700">Missing Address</span>
                  <span className="font-bold text-amber-900">{processedData.dataQuality.missingAddress} ({processedData.dataQuality.missingAddressPct}%)</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-amber-700">Missing Org Name</span>
                  <span className="font-bold text-amber-900">{processedData.dataQuality.missingOrgName}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Import Sandwich Type Data Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="w-5 h-5" />
              Import Sandwich Type Data
            </DialogTitle>
            <DialogDescription>
              Paste CSV data from your Google Sheet to backfill sandwich type information for historical events.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Step 1: Paste CSV Data */}
            {!importAnalysis && !importResults && (
              <div className="space-y-4">
                <div>
                  <Label>Paste your CSV data from Google Sheets</Label>
                  <p className="text-sm text-gray-500 mb-2">
                    Copy from Google Sheets: Select cells → Ctrl/Cmd+C → Paste here
                  </p>
                  <Textarea
                    value={importCsvData}
                    onChange={(e) => setImportCsvData(e.target.value)}
                    placeholder="Date,Organization,Deli,Turkey,Ham,PBJ
1/15/2025,Local Church,50,30,20,40
1/20/2025,Community Center,100,60,40,80"
                    className="font-mono text-sm h-48"
                  />
                </div>
                <Button
                  onClick={() => analyzeSheetMutation.mutate(importCsvData)}
                  disabled={!importCsvData.trim() || analyzeSheetMutation.isPending}
                >
                  {analyzeSheetMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing with AI...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Analyze Columns
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Step 2: Review and Adjust Mappings */}
            {importAnalysis && !importResults && (
              <div className="space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>AI Confidence: {importAnalysis.confidence}</strong>
                    {importAnalysis.notes && ` - ${importAnalysis.notes}`}
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Found {importAnalysis.totalRows} rows to process
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Date Column *</Label>
                    <Select
                      value={importMappings.date || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, date: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Organization Column *</Label>
                    <Select
                      value={importMappings.organizationName || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, organizationName: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Deli Count</Label>
                    <Select
                      value={importMappings.deli || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, deli: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Turkey Count</Label>
                    <Select
                      value={importMappings.turkey || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, turkey: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Ham Count</Label>
                    <Select
                      value={importMappings.ham || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, ham: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>PB&J Count</Label>
                    <Select
                      value={importMappings.pbj || ''}
                      onValueChange={(v) => setImportMappings({ ...importMappings, pbj: v || null })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {importAnalysis.headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">Sample Data Preview</Label>
                  <div className="mt-2 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {importAnalysis.headers.map((h) => (
                            <TableHead key={h} className="text-xs">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importAnalysis.sampleRows.slice(0, 3).map((row, i) => (
                          <TableRow key={i}>
                            {importAnalysis.headers.map((h) => (
                              <TableCell key={h} className="text-xs">{row[h]}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportAnalysis(null);
                      setImportMappings({});
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => importDataMutation.mutate({ csvData: importCsvData, mappings: importMappings })}
                    disabled={!importMappings.date || !importMappings.organizationName || importDataMutation.isPending}
                  >
                    {importDataMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import {importAnalysis.totalRows} Rows
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Results */}
            {importResults && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{importResults.processed}</p>
                    <p className="text-xs text-gray-600">Processed</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-600">{importResults.updated}</p>
                    <p className="text-xs text-green-700">Updated</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-amber-600">{importResults.notFound}</p>
                    <p className="text-xs text-amber-700">Not Found</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-red-600">{importResults.errors}</p>
                    <p className="text-xs text-red-700">Errors</p>
                  </div>
                </div>

                {importResults.details.length > 0 && (
                  <div className="max-h-48 overflow-y-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Row</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResults.details.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{d.row}</TableCell>
                            <TableCell>
                              <Badge
                                variant={d.status === 'updated' ? 'default' : d.status === 'not_found' ? 'secondary' : 'destructive'}
                                className="text-xs"
                              >
                                {d.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{d.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <Button onClick={() => setShowImportDialog(false)}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
