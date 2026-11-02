import React, { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import {
  Loader2,
  Plus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Upload,
  Filter,
  CalendarDays,
  X,
  Search,
  Check,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { Checkbox } from '@/components/ui/checkbox';
import { MonthlyCalendarGrid } from '@/components/monthly-calendar-grid';
import {
  MonthSectionsContent,
  chipKeyForTrackedCategory,
  chipKeyForYearlyCategory,
  countRenderableTrackedItems,
  type CalendarSectionChipKey,
} from '@/components/yearly-calendar/month-sections';
import { PermissionDenied } from '@/components/permission-denied';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { ButtonTooltip } from '@/components/ui/button-tooltip';

interface YearlyCalendarItem {
  id: number;
  month: number; // 1-12
  year: number;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  startDate: string | null; // YYYY-MM-DD for calendar display
  endDate: string | null; // YYYY-MM-DD for calendar display
  createdBy: string;
  createdByName: string;
  assignedTo: string[] | null;
  assignedToNames: string[] | null;
  isRecurring: boolean;
  isCompleted: boolean;
  completedAt: Date | string | null;
  completedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface TrackedCalendarItem {
  id: number;
  externalId: string | null;
  category: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  notes: string | null;
  metadata: {
    type?: string;
    districts?: string[];
    academicYear?: string | null;
    originalId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const CATEGORY_COLORS: Record<string, string> = {
  // Action items — the only category that exposes a Complete/Undo button.
  // Burgundy nods to the brand alert palette so users notice these as
  // to-dos rather than reference entries.
  action_item: 'bg-[#A31C41]/10 text-[#A31C41] border-[#A31C41]/30',
  event: 'bg-teal-100 text-teal-800 border-teal-300',
  preparation: 'bg-blue-100 text-blue-800 border-blue-300',
  planning: 'bg-sky-100 text-sky-800 border-sky-300',
  'event-rush': 'bg-red-100 text-red-800 border-red-300',
  staffing: 'bg-orange-100 text-orange-800 border-orange-300',
  board: 'bg-purple-100 text-purple-800 border-purple-300',
  leadership_availability: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  seasonal: 'bg-green-100 text-green-800 border-green-300',
  other: 'bg-gray-100 text-gray-800 border-gray-300',
  // Tracked calendar categories
  school_breaks: 'bg-amber-100 text-amber-800 border-amber-300',
  school_markers: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  religious_holidays: 'bg-violet-100 text-violet-800 border-violet-300',
  holiday: 'bg-rose-100 text-rose-800 border-rose-300',
};

const TRACKED_CATEGORY_LABELS: Record<string, string> = {
  school_breaks: 'School Breaks',
  school_markers: 'School Dates',
  religious_holidays: 'Religious Holidays',
  holiday: 'Holidays',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-600',
  medium: 'text-blue-600',
  high: 'text-red-600',
};

// Parse date string safely to avoid timezone boundary issues
// Adding T12:00:00 prevents UTC midnight from shifting the date back a day in local time
function parseDateSafe(dateStr: string): Date {
  // If already has time component, parse directly
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // Add noon time to avoid UTC midnight timezone shift
  return new Date(`${dateStr}T12:00:00`);
}

// Helper to check if a date range overlaps a month
function dateRangeOverlapsMonth(startDate: string, endDate: string, year: number, month: number): boolean {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // Last day of month
  const rangeStart = parseDateSafe(startDate);
  const rangeEnd = parseDateSafe(endDate);

  // Date range overlaps month if: rangeStart <= monthEnd AND rangeEnd >= monthStart
  return rangeStart <= monthEnd && rangeEnd >= monthStart;
}

// Format date range for display (compact format)
function formatDateRange(startDate: string, endDate: string): string {
  const start = parseDateSafe(startDate);
  const end = parseDateSafe(endDate);
  const month = start.toLocaleDateString('en-US', { month: 'short' });
  
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    if (start.getDate() === end.getDate()) {
      // Single-day observances name their weekday: a holiday landing on a
      // collection or distribution day affects operations differently than
      // one landing on a weekend.
      return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return `${month} ${start.getDate()}-${end.getDate()}`;
  }
  // Cross-month range
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
}

function formatDateRangeWithWeekday(startDate: string, endDate: string): string {
  const start = parseDateSafe(startDate);
  const end = parseDateSafe(endDate);
  const startLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (start.toDateString() === end.toDateString()) {
    return startLabel;
  }
  return `${startLabel} - ${endLabel}`;
}

export default function YearlyCalendar() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<YearlyCalendarItem | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isImportHolidaysDialogOpen, setIsImportHolidaysDialogOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importHolidaysJsonText, setImportHolidaysJsonText] = useState('');
  // ── Chip-based category filter ──────────────────────────────────────
  // Replaces the three "Hide X" toggle buttons that used to live in the
  // header. Each chip represents a logical grouping; toggling a chip OFF
  // hides every item whose underlying category falls into that bucket.
  // All chips default ON so the calendar feels welcoming on first load.
  // Filter chips mirror the four month sections (see month-sections.tsx).
  const [activeChips, setActiveChips] = useState<Set<CalendarSectionChipKey>>(
    new Set(['external', 'tsp_activities', 'planning_reminders', 'leadership']),
  );
  const toggleChip = (key: CalendarSectionChipKey) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [isAddTrackedItemDialogOpen, setIsAddTrackedItemDialogOpen] = useState(false);
  const [isEditTrackedItemDialogOpen, setIsEditTrackedItemDialogOpen] = useState(false);
  const [editingTrackedItem, setEditingTrackedItem] = useState<TrackedCalendarItem | null>(null);
  const [trackedTitle, setTrackedTitle] = useState('');
  const [trackedStartDate, setTrackedStartDate] = useState('');
  const [trackedEndDate, setTrackedEndDate] = useState('');
  const [trackedCategory, setTrackedCategory] = useState('school_breaks');
  const [trackedDistrict, setTrackedDistrict] = useState('');
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [formMonth, setFormMonth] = useState<number>(new Date().getMonth() + 1);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState<string>('preparation');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formStartDate, setFormStartDate] = useState<string>('');
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [formIsRecurring, setFormIsRecurring] = useState(true);
  // Recurrence form state
  const [formRecurrenceType, setFormRecurrenceType] = useState<string>('none');
  const [formDayOfWeek, setFormDayOfWeek] = useState<number>(1); // Monday default
  const [formDayOfMonth, setFormDayOfMonth] = useState<number>(1);
  const [formWeekOfMonth, setFormWeekOfMonth] = useState<number>(1);
  const [formRecurrenceEndDate, setFormRecurrenceEndDate] = useState<string>('');

  // Permission checks - use YEARLY_CALENDAR permissions
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canView = userPermissions.includes('YEARLY_CALENDAR_VIEW') || isAdmin;
  // canAdd: new granular permission or legacy YEARLY_CALENDAR_EDIT
  const canAdd = userPermissions.includes('YEARLY_CALENDAR_ADD') || userPermissions.includes('YEARLY_CALENDAR_EDIT') || isAdmin;

  // Granular edit permissions
  const canEditOwn = userPermissions.includes('YEARLY_CALENDAR_EDIT_OWN') || userPermissions.includes('YEARLY_CALENDAR_EDIT') || isAdmin;
  const canEditAll = userPermissions.includes('YEARLY_CALENDAR_EDIT_ALL') || isAdmin;

  // Granular delete permissions
  const canDeleteOwn = userPermissions.includes('YEARLY_CALENDAR_DELETE_OWN') || userPermissions.includes('YEARLY_CALENDAR_EDIT') || isAdmin;
  const canDeleteAll = userPermissions.includes('YEARLY_CALENDAR_DELETE_ALL') || isAdmin;

  // Check if user can edit a specific item (own items or has EDIT_ALL permission)
  const canEditItem = (item: YearlyCalendarItem) => {
    if (isAdmin) return true;
    if (canEditAll) return true;
    // Compare as strings to handle both string and number types
    const isOwner = String(item.createdBy) === String(user?.id);
    if (isOwner && canEditOwn) return true;
    return false;
  };

  // Check if user can delete a specific item (own items or has DELETE_ALL permission)
  const canDeleteItem = (item: YearlyCalendarItem) => {
    if (isAdmin) return true;
    if (canDeleteAll) return true;
    // Compare as strings to handle both string and number types
    const isOwner = String(item.createdBy) === String(user?.id);
    if (isOwner && canDeleteOwn) return true;
    return false;
  };

  // Fetch calendar items for selected year
  const { data: items = [], isLoading } = useQuery<YearlyCalendarItem[]>({
    queryKey: ['/api/yearly-calendar', selectedYear],
    queryFn: async () => {
      return await apiRequest('GET', `/api/yearly-calendar?year=${selectedYear}`);
    },
    enabled: canView,
  });

  // Fetch tracked calendar items (school breaks, etc.)
  const { data: trackedItemsResponse, isLoading: isLoadingTracked } = useQuery<{ items: TrackedCalendarItem[] }>({
    queryKey: ['/api/tracked-calendar', selectedYear],
    queryFn: async () => {
      return await apiRequest('GET', `/api/tracked-calendar?year=${selectedYear}`);
    },
    enabled: canView,
  });
  const trackedItems = trackedItemsResponse?.items || [];

  // Deduplicate items - handles both duplicate IDs and duplicate content
  const deduplicatedItems = useMemo(() => {
    const seenIds = new Set<number>();
    const seenContent = new Set<string>();

    return items.filter(item => {
      // First, filter by ID
      if (seenIds.has(item.id)) {
        return false;
      }
      seenIds.add(item.id);

      // Then, filter by content (keep only the first occurrence of matching title+month+year)
      const contentKey = `${item.month}-${item.year}-${item.title.toLowerCase().trim()}`;
      if (seenContent.has(contentKey)) {
        console.warn('Duplicate yearly calendar item detected:', item.title, 'in month', item.month);
        return false;
      }
      seenContent.add(contentKey);

      return true;
    });
  }, [items]);

  // Filter manual yearly items: chip filter, then optional search.
  const filteredYearlyItems = useMemo(() => {
    let filtered = deduplicatedItems.filter((item) =>
      activeChips.has(chipKeyForYearlyCategory(item.category)),
    );
    if (!searchQuery.trim()) return filtered;
    const query = searchQuery.toLowerCase();
    return filtered.filter(item =>
      item.title.toLowerCase().includes(query) ||
      (item.description && item.description.toLowerCase().includes(query)) ||
      item.category.toLowerCase().includes(query)
    );
  }, [deduplicatedItems, searchQuery, activeChips]);

  // Filter tracked items: chip filter, then optional search.
  const filteredTrackedItems = useMemo(() => {
    let filtered = trackedItems.filter((item) =>
      activeChips.has(chipKeyForTrackedCategory(item.category)),
    );

    if (!searchQuery.trim()) return filtered;
    const query = searchQuery.toLowerCase();
    return filtered.filter(item => {
      // Search in title
      if (item.title.toLowerCase().includes(query)) return true;
      // Search in notes
      if (item.notes && item.notes.toLowerCase().includes(query)) return true;
      // Search in category
      if (item.category.toLowerCase().includes(query)) return true;
      // Search in districts
      if (item.metadata?.districts) {
        if (item.metadata.districts.some((d: string) => d.toLowerCase().includes(query))) return true;
      }
      // Search for common break types
      const breakTypes = ['spring', 'winter', 'fall', 'summer', 'thanksgiving', 'christmas', 'mlk', 'presidents', 'memorial', 'labor'];
      if (breakTypes.some(bt => bt.includes(query) && item.title.toLowerCase().includes(bt))) return true;
      // Search for religious holiday terms
      const holidayTerms = ['holiday', 'new year', 'mlk', 'presidents', 'memorial', 'juneteenth', 'independence', 'labor', 'thanksgiving', 'christmas', 'veterans', 'easter', 'passover', 'hanukkah', 'chanukah', 'rosh', 'yom kippur', 'sukkot', 'shavuot', 'purim', 'lent', 'ash wednesday', 'good friday', 'palm sunday', 'jewish', 'christian'];
      if (holidayTerms.some(ht => ht.includes(query) && (item.title.toLowerCase().includes(ht) || (item.metadata as any)?.tradition?.toLowerCase().includes(ht)))) return true;
      return false;
    });
  }, [trackedItems, searchQuery, activeChips]);

  // Group items by month and sort them (uses filtered items)
  const itemsByMonth = useMemo(() => {
    const grouped: Record<number, YearlyCalendarItem[]> = {};
    for (let i = 1; i <= 12; i++) {
      grouped[i] = [];
    }
    filteredYearlyItems.forEach(item => {
      if (!grouped[item.month]) {
        grouped[item.month] = [];
      }
      grouped[item.month].push(item);
    });
    // Sort items within each month: incomplete first, then by start date (earliest first), then by priority, then by creation date
    Object.keys(grouped).forEach(month => {
      const monthNum = parseInt(month);
      grouped[monthNum].sort((a, b) => {
        // Incomplete items first
        if (a.isCompleted !== b.isCompleted) {
          return a.isCompleted ? 1 : -1;
        }
        // Then by start date (earliest first)
        const aDate = a.startDate ? new Date(a.startDate).getTime() : Infinity;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        // Then by priority
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = (priorityOrder[b.priority as keyof typeof priorityOrder] || 2) -
                            (priorityOrder[a.priority as keyof typeof priorityOrder] || 2);
        if (priorityDiff !== 0) return priorityDiff;
        // Finally by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    });
    return grouped;
  }, [filteredYearlyItems]);

  // Group tracked items by month using date range overlap (uses filtered items)
  const trackedItemsByMonth = useMemo(() => {
    const grouped: Record<number, Record<string, TrackedCalendarItem[]>> = {};
    for (let i = 1; i <= 12; i++) {
      grouped[i] = {};
    }

    filteredTrackedItems.forEach(item => {
      for (let month = 1; month <= 12; month++) {
        if (dateRangeOverlapsMonth(item.startDate, item.endDate, selectedYear, month)) {
          if (!grouped[month][item.category]) {
            grouped[month][item.category] = [];
          }
          grouped[month][item.category].push(item);
        }
      }
    });

    // Sort items within each category by start date
    Object.keys(grouped).forEach(month => {
      const monthNum = parseInt(month);
      Object.keys(grouped[monthNum]).forEach(category => {
        grouped[monthNum][category].sort((a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );
      });
    });

    return grouped;
  }, [filteredTrackedItems, selectedYear]);

  // Create item mutation
  const createItemMutation = useMutation({
    mutationFn: async (data: {
      month: number;
      year: number;
      title: string;
      description: string | null;
      category: string;
      priority: string;
      startDate: string | null;
      endDate: string | null;
      isRecurring: boolean;
    }) => {
      return await apiRequest('POST', '/api/yearly-calendar', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/yearly-calendar'] });
      setIsCreateDialogOpen(false);
      setFormTitle('');
      setFormDescription('');
      setFormCategory('event');
      setFormPriority('medium');
      setFormStartDate('');
      setFormEndDate('');
      setFormIsRecurring(false);
      setFormRecurrenceType('none');
      setFormRecurrenceEndDate('');
      toast({
        title: 'Event added to calendar',
        description: 'Your event has been saved',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not save event',
        description: error?.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  // Update item mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<YearlyCalendarItem> & { id: number }) => {
      return await apiRequest('PATCH', `/api/yearly-calendar/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/yearly-calendar'] });
      setIsEditDialogOpen(false);
      setEditingItem(null);
      toast({
        title: 'Calendar item updated',
        description: 'Your calendar item has been updated',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update calendar item',
        variant: 'destructive',
      });
    },
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/yearly-calendar/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/yearly-calendar'] });
      toast({
        title: 'Calendar item deleted',
        description: 'Your calendar item has been deleted',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to delete calendar item',
        variant: 'destructive',
      });
    },
  });

  // Copy to next year mutation
  const copyToNextYearMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('POST', `/api/yearly-calendar/${id}/copy-to-next-year`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/yearly-calendar'] });
      toast({
        title: 'Item copied',
        description: 'Calendar item has been copied to next year',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to copy calendar item',
        variant: 'destructive',
      });
    },
  });

  // Import school breaks mutation
  const importSchoolBreaksMutation = useMutation({
    mutationFn: async (data: any[]) => {
      return await apiRequest('POST', '/api/tracked-calendar/import-school-breaks', data);
    },
    onSuccess: (result: { created: number; updated: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      setIsImportDialogOpen(false);
      setImportJsonText('');
      toast({
        title: 'School breaks imported',
        description: `Created: ${result.created}, Updated: ${result.updated}${result.errors.length > 0 ? `, Errors: ${result.errors.length}` : ''}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Import failed',
        description: error?.message || 'Failed to import school breaks',
        variant: 'destructive',
      });
    },
  });

  // Import religious holidays mutation
  const importReligiousHolidaysMutation = useMutation({
    mutationFn: async (data: any[]) => {
      return await apiRequest('POST', '/api/tracked-calendar/import-religious-holidays', data);
    },
    onSuccess: (result: { created: number; updated: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      setIsImportHolidaysDialogOpen(false);
      setImportHolidaysJsonText('');
      toast({
        title: 'Religious holidays imported',
        description: `Created: ${result.created}, Updated: ${result.updated}${result.errors.length > 0 ? `, Errors: ${result.errors.length}` : ''}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Import failed',
        description: error?.message || 'Failed to import religious holidays',
        variant: 'destructive',
      });
    },
  });

  // Add common U.S./TSP-relevant holidays for the selected year
  const importUSHolidaysMutation = useMutation({
    mutationFn: async (year: number) => {
      return await apiRequest('POST', '/api/tracked-calendar/import-us-holidays', { year });
    },
    onSuccess: (result: { created: number; updated: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      // Make sure External Factors is on so the just-imported items appear.
      setActiveChips((prev) => {
        if (prev.has('external')) return prev;
        const next = new Set(prev);
        next.add('external');
        return next;
      });
      toast({
        title: 'Holidays added',
        description: `Created: ${result.created}, Updated: ${result.updated}${result.errors.length > 0 ? `, Errors: ${result.errors.length}` : ''}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Import failed',
        description: error?.message || 'Failed to add holidays',
        variant: 'destructive',
      });
    },
  });

  // Create a tracked calendar item (school breaks, holidays, etc.)
  const createTrackedItemMutation = useMutation({
    mutationFn: async (data: { title: string; startDate: string; endDate: string; category: string; district: string }) => {
      const metadata =
        data.category === 'religious_holidays'
          ? { type: data.category, tradition: data.district || null, source: 'manual' }
          : data.category === 'holiday'
            ? { type: 'holiday', holidayType: data.district || null, source: 'manual' }
            : { type: data.category, districts: data.district ? [data.district] : [], source: 'manual' };

      return await apiRequest('POST', '/api/tracked-calendar', {
        category: data.category,
        title: data.title,
        startDate: data.startDate,
        endDate: data.endDate,
        metadata,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      setIsAddTrackedItemDialogOpen(false);
      setTrackedTitle('');
      setTrackedStartDate('');
      setTrackedEndDate('');
      setTrackedCategory('school_breaks');
      setTrackedDistrict('');
      toast({
        title: 'Item added',
        description: 'The item has been added to the calendar.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to add item',
        variant: 'destructive',
      });
    },
  });

  // Update a tracked calendar item
  const updateTrackedItemMutation = useMutation({
    mutationFn: async (data: { id: number; title: string; startDate: string; endDate: string; category: string; metadata?: any }) => {
      return await apiRequest('PATCH', `/api/tracked-calendar/${data.id}`, {
        title: data.title,
        startDate: data.startDate,
        endDate: data.endDate,
        category: data.category,
        metadata: data.metadata,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      setIsEditTrackedItemDialogOpen(false);
      setEditingTrackedItem(null);
      toast({ title: 'Item updated', description: 'The calendar item has been updated.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error?.message || 'Failed to update item', variant: 'destructive' });
    },
  });

  // Delete a tracked calendar item
  const deleteTrackedItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/tracked-calendar/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tracked-calendar'] });
      toast({ title: 'Item deleted', description: 'The calendar item has been deleted.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error?.message || 'Failed to delete item', variant: 'destructive' });
    },
  });

  const handleEditTrackedItem = (item: TrackedCalendarItem) => {
    setEditingTrackedItem(item);
    setTrackedTitle(item.title);
    setTrackedStartDate(item.startDate);
    setTrackedEndDate(item.endDate);
    setTrackedCategory(item.category);
    setTrackedDistrict(item.metadata?.districts?.[0] || (item.metadata as any)?.tradition || (item.metadata as any)?.holidayType || '');
    setIsEditTrackedItemDialogOpen(true);
  };

  const handleUpdateTrackedItem = () => {
    if (!editingTrackedItem || !trackedTitle.trim() || !trackedStartDate || !trackedEndDate) return;
    // Auto-swap if dates are backwards
    const start = trackedStartDate <= trackedEndDate ? trackedStartDate : trackedEndDate;
    const end = trackedStartDate <= trackedEndDate ? trackedEndDate : trackedStartDate;
    updateTrackedItemMutation.mutate({
      id: editingTrackedItem.id,
      title: trackedTitle.trim(),
      startDate: start,
      endDate: end,
      category: trackedCategory,
      metadata: {
        ...editingTrackedItem.metadata,
        type: trackedCategory === 'holiday' ? 'holiday' : trackedCategory,
        districts: trackedCategory === 'school_breaks' || trackedCategory === 'school_markers'
          ? (trackedDistrict.trim() ? [trackedDistrict.trim()] : [])
          : [],
        tradition: trackedCategory === 'religious_holidays' ? trackedDistrict.trim() || null : undefined,
        holidayType: trackedCategory === 'holiday' ? trackedDistrict.trim() || null : undefined,
      },
    });
  };

  const handleDeleteTrackedItem = (item: TrackedCalendarItem) => {
    if (window.confirm(`Delete "${item.title}"?`)) {
      deleteTrackedItemMutation.mutate(item.id);
    }
  };

  const handleAddTrackedItem = () => {
    if (!trackedTitle.trim() || !trackedStartDate || !trackedEndDate) {
      toast({
        title: 'Error',
        description: 'Title, start date, and end date are required.',
        variant: 'destructive',
      });
      return;
    }
    // Auto-swap if dates are backwards
    const start = trackedStartDate <= trackedEndDate ? trackedStartDate : trackedEndDate;
    const end = trackedStartDate <= trackedEndDate ? trackedEndDate : trackedStartDate;
    createTrackedItemMutation.mutate({
      title: trackedTitle.trim(),
      startDate: start,
      endDate: end,
      category: trackedCategory,
      district: trackedDistrict.trim(),
    });
  };

  const handleImportReligiousHolidays = () => {
    try {
      const data = JSON.parse(importHolidaysJsonText);
      if (!Array.isArray(data)) {
        toast({
          title: 'Invalid format',
          description: 'JSON must be an array of religious holiday objects',
          variant: 'destructive',
        });
        return;
      }
      importReligiousHolidaysMutation.mutate(data);
    } catch (e) {
      toast({
        title: 'Invalid JSON',
        description: 'Please check your JSON format',
        variant: 'destructive',
      });
    }
  };

  const handleImportSchoolBreaks = () => {
    try {
      const data = JSON.parse(importJsonText);
      if (!Array.isArray(data)) {
        toast({
          title: 'Invalid format',
          description: 'JSON must be an array of school break objects',
          variant: 'destructive',
        });
        return;
      }
      importSchoolBreaksMutation.mutate(data);
    } catch (e) {
      toast({
        title: 'Invalid JSON',
        description: 'Please check your JSON format',
        variant: 'destructive',
      });
    }
  };

  const handleCreate = () => {
    if (!formTitle.trim()) {
      toast({
        title: 'Error',
        description: 'Title is required',
        variant: 'destructive',
      });
      return;
    }

    // Build recurrence pattern based on type
    let recurrencePattern = null;
    if (formRecurrenceType === 'weekly') {
      recurrencePattern = { dayOfWeek: formDayOfWeek };
    } else if (formRecurrenceType === 'monthly') {
      recurrencePattern = { dayOfMonth: formDayOfMonth };
    }

    createItemMutation.mutate({
      month: formMonth,
      year: selectedYear,
      title: formTitle.trim(),
      description: formDescription.trim() || null,
      category: formCategory,
      priority: formPriority,
      startDate: formStartDate || null,
      endDate: formEndDate || formStartDate || null,
      isRecurring: formRecurrenceType !== 'none',
      recurrenceType: formRecurrenceType,
      recurrencePattern,
      recurrenceEndDate: formRecurrenceEndDate || null,
    });
  };

  const handleEdit = (item: YearlyCalendarItem) => {
    setEditingItem(item);
    setFormMonth(item.month);
    setFormTitle(item.title);
    setFormDescription(item.description || '');
    setFormCategory(item.category);
    setFormPriority(item.priority);
    setFormStartDate(item.startDate || '');
    setFormEndDate(item.endDate || '');
    setFormIsRecurring(item.isRecurring);
    // Load recurrence settings
    setFormRecurrenceType((item as any).recurrenceType || 'none');
    const pattern = (item as any).recurrencePattern as { dayOfWeek?: number; dayOfMonth?: number; weekOfMonth?: number } | null;
    setFormDayOfWeek(pattern?.dayOfWeek ?? 1);
    setFormDayOfMonth(pattern?.dayOfMonth ?? 1);
    setFormWeekOfMonth(pattern?.weekOfMonth ?? 1);
    setFormRecurrenceEndDate((item as any).recurrenceEndDate || '');
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingItem || !formTitle.trim()) {
      toast({
        title: 'Error',
        description: 'Title is required',
        variant: 'destructive',
      });
      return;
    }

    // Build recurrence pattern based on type
    let recurrencePattern = null;
    if (formRecurrenceType === 'weekly') {
      recurrencePattern = { dayOfWeek: formDayOfWeek };
    } else if (formRecurrenceType === 'monthly') {
      recurrencePattern = { dayOfMonth: formDayOfMonth };
    }

    updateItemMutation.mutate({
      id: editingItem.id,
      title: formTitle.trim(),
      description: formDescription.trim() || null,
      category: formCategory,
      priority: formPriority,
      startDate: formStartDate || null,
      endDate: formEndDate || formStartDate || null,
      isRecurring: formIsRecurring,
      recurrenceType: formRecurrenceType,
      recurrencePattern,
      recurrenceEndDate: formRecurrenceEndDate || null,
    });
  };

  const handleToggleComplete = (item: YearlyCalendarItem) => {
    updateItemMutation.mutate({
      id: item.id,
      isCompleted: !item.isCompleted,
    });
  };

  if (!canView) {
    return (
      <div className="container mx-auto p-6">
        <PermissionDenied
          action="view the yearly calendar"
          requiredPermission="CALENDAR_VIEW"
          variant="card"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageBreadcrumbs segments={[{ label: 'TSP Yearly Calendar' }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Calendar className="h-8 w-8 text-[#236383]" />
            TSP Yearly Calendar
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Plan ahead for recurring activities and events throughout the year
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search calendar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 w-[220px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedYear(selectedYear - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-lg font-semibold min-w-[80px] text-center">
              {selectedYear}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedYear(selectedYear + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {/* Filter chips — replaces three "Hide / Show X" toggle buttons
              that felt like developer toggles. Each chip is on by default.
              Click toggles whether items in that bucket are visible. Active
              chips show a colored fill + checkmark; inactive chips are
              translucent so it's obvious what's filtered out at a glance. */}
          {(() => {
            const chips: Array<{
              key: CalendarSectionChipKey;
              label: string;
              activeBg: string;
              activeText: string;
            }> = [
              { key: 'external', label: 'External Factors', activeBg: 'bg-amber-500', activeText: 'text-white' },
              { key: 'tsp_activities', label: 'TSP Activities', activeBg: 'bg-teal-600', activeText: 'text-white' },
              { key: 'planning_reminders', label: 'Planning Reminders', activeBg: 'bg-sky-600', activeText: 'text-white' },
              { key: 'leadership', label: 'Leadership', activeBg: 'bg-indigo-600', activeText: 'text-white' },
            ];
            return (
              <div className="flex items-center gap-1.5 flex-wrap">
                {chips.map((chip) => {
                  const isActive = activeChips.has(chip.key);
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => toggleChip(chip.key)}
                      aria-pressed={isActive}
                      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? `${chip.activeBg} ${chip.activeText} border-transparent hover:opacity-90`
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {isActive && <Check className="h-3 w-3" />}
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedMonth(new Date().getFullYear() === selectedYear ? new Date().getMonth() + 1 : 1)}
            className="border-[#236383] text-[#236383] hover:bg-[#e8f4f8]"
          >
            <CalendarDays className="h-4 w-4 mr-2" />
            Open Calendar Grid
          </Button>
          {canEditAll && (
            <>
              <Button
                variant="outline"
                onClick={() => importUSHolidaysMutation.mutate(selectedYear)}
                disabled={importUSHolidaysMutation.isPending}
              >
                {importUSHolidaysMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CalendarDays className="h-4 w-4 mr-2" />
                )}
                Add {selectedYear} Holidays
              </Button>
              <ButtonTooltip
                explanation="Bulk-import district school break dates as JSON. Each item needs id, type (school_break), label, startDate, and endDate. Optional fields: districts, academicYear. Matching IDs update existing breaks; new IDs create new entries. Use Add Item for single breaks instead."
                size="md"
              >
                <Button
                  variant="outline"
                  onClick={() => setIsImportDialogOpen(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import School Breaks
                </Button>
              </ButtonTooltip>
              <Button
                variant="outline"
                onClick={() => setIsImportHolidaysDialogOpen(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Religious Holidays
              </Button>
            </>
          )}
          {canAdd && (
            <Button
              onClick={() => {
                // Reset form state for new item
                setFormMonth(new Date().getMonth() + 1);
                setFormTitle('');
                setFormDescription('');
                setFormCategory('event');
                setFormPriority('medium');
                setFormStartDate('');
                setFormEndDate('');
                setFormIsRecurring(false);
                setFormRecurrenceType('none');
                setFormDayOfWeek(1);
                setFormDayOfMonth(1);
                setFormWeekOfMonth(1);
                setFormRecurrenceEndDate('');
                setIsCreateDialogOpen(true);
              }}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Calendar Event
            </Button>
          )}
          {canAdd && (
            <Button
              onClick={() => {
                setTrackedTitle('');
                setTrackedStartDate('');
                setTrackedEndDate('');
                setTrackedCategory('school_breaks');
                setTrackedDistrict('');
                setIsAddTrackedItemDialogOpen(true);
              }}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Monthly View */}
      {expandedMonth !== null && (
        <div className="mb-6">
          <MonthlyCalendarGrid
            year={selectedYear}
            month={expandedMonth}
            trackedItems={filteredTrackedItems}
            yearlyItems={filteredYearlyItems}
            onMonthChange={(year, month) => {
              if (year !== selectedYear) {
                setSelectedYear(year);
              }
              setExpandedMonth(month);
            }}
            onClose={() => setExpandedMonth(null)}
          />
        </div>
      )}

      {/* Search Results Indicator */}
      {searchQuery.trim() && (
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="secondary" className="bg-[#e8f4f8] text-[#236383] border-[#236383]/20">
            <Search className="h-3 w-3 mr-1" />
            Searching: "{searchQuery}"
          </Badge>
          <span className="text-sm text-gray-600">
            Found {filteredYearlyItems.length} calendar item{filteredYearlyItems.length !== 1 ? 's' : ''}
            {filteredTrackedItems.length > 0 && ` and ${filteredTrackedItems.length} ${filteredTrackedItems.length === 1 ? 'tracked item' : 'tracked items'}`}
          </span>
          <button
            onClick={() => setSearchQuery('')}
            className="text-sm text-[#236383] hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {/* Calendar Grid */}
      {isLoading || isLoadingTracked ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#236383]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {MONTH_NAMES.map((monthName, index) => {
            const monthNumber = index + 1;
            const monthItems = itemsByMonth[monthNumber] || [];
            const monthTrackedItems = trackedItemsByMonth[monthNumber] || {};
            const totalTrackedCount = countRenderableTrackedItems(monthTrackedItems);
            const isCurrentMonth = new Date().getMonth() + 1 === monthNumber && new Date().getFullYear() === selectedYear;
            const isPastMonth = selectedYear < new Date().getFullYear() ||
              (selectedYear === new Date().getFullYear() && monthNumber < new Date().getMonth() + 1);
            const isExpanded = expandedMonth === monthNumber;

            return (
              <Card
                key={monthNumber}
                className={`min-w-0 overflow-hidden transition-all hover:shadow-md flex flex-col ${
                  isCurrentMonth ? 'ring-2 ring-[#236383]' : ''
                } ${isPastMonth ? 'opacity-75' : ''} ${isExpanded ? 'ring-2 ring-amber-400' : ''}`}
              >
                <CardHeader className="pb-3 flex-shrink-0 min-w-0">
                  <CardTitle className="text-lg min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
                      <span className="uppercase tracking-wide truncate min-w-0 max-w-full">
                        {monthName}
                      </span>
                      {(monthItems.length > 0 || totalTrackedCount > 0) && (
                        <div className="flex items-center gap-1 shrink-0 flex-wrap">
                          {monthItems.length > 0 && (
                            <Badge variant="secondary" className="tabular-nums">
                              {monthItems.length}
                            </Badge>
                          )}
                          {totalTrackedCount > 0 && (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-700 border-amber-300 tabular-nums"
                            >
                              {totalTrackedCount}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </CardTitle>
                  <Button
                    type="button"
                    variant={isExpanded ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setExpandedMonth(isExpanded ? null : monthNumber)}
                    className={isExpanded
                      ? 'mt-3 w-full bg-[#236383] hover:bg-[#236383] text-white'
                      : 'mt-3 w-full border-[#236383]/30 text-[#236383] hover:bg-[#e8f4f8]'
                    }
                  >
                    <CalendarDays className="h-4 w-4 mr-2" />
                    {isExpanded ? 'Close Calendar View' : 'View Single Month Grid'}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2 flex-1 overflow-y-auto max-h-[500px] min-h-[100px]">
                  {monthItems.length === 0 && totalTrackedCount === 0 ? (
                    <p className="text-sm text-gray-400 italic text-center py-4">
                      No items planned
                    </p>
                  ) : (
                    <MonthSectionsContent
                      scopeKey={`${selectedYear}-${monthNumber}`}
                      monthItems={monthItems}
                      monthTrackedItems={monthTrackedItems}
                      categoryColors={CATEGORY_COLORS}
                      priorityColors={PRIORITY_COLORS}
                      formatDateRange={formatDateRange}
                      formatDateRangeWithWeekday={formatDateRangeWithWeekday}
                      canEditAll={canEditAll}
                      canEditItem={canEditItem}
                      canDeleteItem={canDeleteItem}
                      onEditYearly={handleEdit}
                      onToggleComplete={handleToggleComplete}
                      onDeleteYearly={(id) => {
                        if (window.confirm('Are you sure you want to delete this item?')) {
                          deleteItemMutation.mutate(id);
                        }
                      }}
                      onCopyYearly={(id) => copyToNextYearMutation.mutate(id)}
                      onEditTracked={handleEditTrackedItem}
                      onDeleteTracked={handleDeleteTrackedItem}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Calendar Event</DialogTitle>
            <DialogDescription>
              Add an event or activity to {MONTH_NAMES[formMonth - 1]} {selectedYear}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-title">Event Name *</Label>
              <Input
                id="create-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g., Board Meeting, Hunger Walk, NCL Starts..."
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-start-date">Date</Label>
                <Input
                  id="create-start-date"
                  type="date"
                  value={formStartDate}
                  onChange={(e) => {
                    setFormStartDate(e.target.value);
                    if (e.target.value) {
                      const d = new Date(e.target.value + 'T12:00:00');
                      setFormMonth(d.getMonth() + 1);
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-end-date">End Date <span className="text-gray-400 font-normal">(optional)</span></Label>
                <Input
                  id="create-end-date"
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  min={formStartDate}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-month">Month <span className="text-gray-400 font-normal">(if no date above)</span></Label>
              <Select value={String(formMonth)} onValueChange={(v) => setFormMonth(parseInt(v))}>
                <SelectTrigger id="create-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, index) => (
                    <SelectItem key={index + 1} value={String(index + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-category">Type</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger id="create-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="action_item">Action Item (requires completion)</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="board">Board / Governance</SelectItem>
                    <SelectItem value="staffing">Staffing</SelectItem>
                    <SelectItem value="preparation">Preparation</SelectItem>
                    <SelectItem value="event-rush">Event Rush Period</SelectItem>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="leadership_availability">Leadership Availability</SelectItem>
                    <SelectItem value="seasonal">Seasonal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-priority">Priority</Label>
                <Select value={formPriority} onValueChange={setFormPriority}>
                  <SelectTrigger id="create-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea
                id="create-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Any additional details..."
                rows={2}
              />
            </div>
            <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
              <Label className="text-sm font-medium">Repeating Event</Label>
              <Select value={formRecurrenceType} onValueChange={setFormRecurrenceType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select recurrence type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  <SelectItem value="weekly">Repeats weekly</SelectItem>
                  <SelectItem value="monthly">Repeats monthly</SelectItem>
                  <SelectItem value="yearly">Repeats yearly</SelectItem>
                </SelectContent>
              </Select>

              {formRecurrenceType === 'weekly' && (
                <div className="space-y-2">
                  <Label className="text-sm">Repeat every</Label>
                  <Select value={String(formDayOfWeek)} onValueChange={(v) => setFormDayOfWeek(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sunday</SelectItem>
                      <SelectItem value="1">Monday</SelectItem>
                      <SelectItem value="2">Tuesday</SelectItem>
                      <SelectItem value="3">Wednesday</SelectItem>
                      <SelectItem value="4">Thursday</SelectItem>
                      <SelectItem value="5">Friday</SelectItem>
                      <SelectItem value="6">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formRecurrenceType === 'monthly' && (
                <div className="space-y-2">
                  <Label className="text-sm">Repeat on day</Label>
                  <Select value={String(formDayOfMonth)} onValueChange={(v) => setFormDayOfMonth(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formRecurrenceType !== 'none' && (
                <div className="space-y-2">
                  <Label className="text-sm">Stop repeating on <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input
                    type="date"
                    value={formRecurrenceEndDate}
                    onChange={(e) => setFormRecurrenceEndDate(e.target.value)}
                    min={formStartDate || undefined}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createItemMutation.isPending || !formTitle.trim()}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {createItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                <>Save to Calendar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Calendar Item</DialogTitle>
            <DialogDescription>
              Update calendar item details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-month">Month</Label>
              <Select value={String(formMonth)} onValueChange={(v) => setFormMonth(parseInt(v))}>
                <SelectTrigger id="edit-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, index) => (
                    <SelectItem key={index + 1} value={String(index + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title *</Label>
              <Input
                id="edit-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger id="edit-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="action_item">Action Item (requires completion)</SelectItem>
                    <SelectItem value="preparation">Preparation</SelectItem>
                    <SelectItem value="event-rush">Event Rush Preparation</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="staffing">Staffing</SelectItem>
                    <SelectItem value="board">Board/Governance</SelectItem>
                    <SelectItem value="leadership_availability">Leadership Availability</SelectItem>
                    <SelectItem value="seasonal">Seasonal Planning</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-priority">Priority</Label>
                <Select value={formPriority} onValueChange={setFormPriority}>
                  <SelectTrigger id="edit-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-start-date">Start Date (optional)</Label>
                <Input
                  id="edit-start-date"
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                />
                <p className="text-xs text-gray-500">For calendar grid display</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end-date">End Date (optional)</Label>
                <Input
                  id="edit-end-date"
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  min={formStartDate}
                />
                <p className="text-xs text-gray-500">Leave blank for single day</p>
              </div>
            </div>
            {/* Recurrence Options */}
            <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
              <Label className="text-sm font-medium">Recurrence</Label>
              <Select value={formRecurrenceType} onValueChange={setFormRecurrenceType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select recurrence type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No recurrence (one-time)</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>

              {formRecurrenceType === 'weekly' && (
                <div className="space-y-2">
                  <Label className="text-sm">Repeat every</Label>
                  <Select value={String(formDayOfWeek)} onValueChange={(v) => setFormDayOfWeek(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sunday</SelectItem>
                      <SelectItem value="1">Monday</SelectItem>
                      <SelectItem value="2">Tuesday</SelectItem>
                      <SelectItem value="3">Wednesday</SelectItem>
                      <SelectItem value="4">Thursday</SelectItem>
                      <SelectItem value="5">Friday</SelectItem>
                      <SelectItem value="6">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formRecurrenceType === 'monthly' && (
                <div className="space-y-2">
                  <Label className="text-sm">Repeat on day</Label>
                  <Select value={String(formDayOfMonth)} onValueChange={(v) => setFormDayOfMonth(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formRecurrenceType !== 'none' && (
                <div className="space-y-2">
                  <Label className="text-sm">End date (optional)</Label>
                  <Input
                    type="date"
                    value={formRecurrenceEndDate}
                    onChange={(e) => setFormRecurrenceEndDate(e.target.value)}
                    min={formStartDate || undefined}
                  />
                  <p className="text-xs text-gray-500">Leave blank to recur indefinitely</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateItemMutation.isPending || !formTitle.trim()}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {updateItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Updating...</>
              ) : (
                <>Update</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import School Breaks Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Import School Breaks
              <ButtonTooltip
                explanation="Paste a JSON array of break objects. Required fields per item: id, type (use school_break), label, startDate, endDate. Example IDs like winter-break-2025 help updates merge cleanly across imports."
                size="md"
              />
            </DialogTitle>
            <DialogDescription>
              Paste JSON data to import school breaks. Each item should have: id, type, label, startDate, endDate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="import-json">JSON Data</Label>
              <Textarea
                id="import-json"
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder={`[
  {
    "id": "winter-break-2025",
    "type": "school_break",
    "label": "Winter Break",
    "startDate": "2025-12-22",
    "endDate": "2026-01-05",
    "districts": ["All"],
    "academicYear": "2025-2026"
  }
]`}
                rows={12}
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-gray-500">
              Items with matching IDs will be updated. New items will be created.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImportSchoolBreaks}
              disabled={importSchoolBreaksMutation.isPending || !importJsonText.trim()}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {importSchoolBreaksMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> Import</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Religious Holidays Dialog */}
      <Dialog open={isImportHolidaysDialogOpen} onOpenChange={setIsImportHolidaysDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Import Religious Holidays</DialogTitle>
            <DialogDescription>
              Paste JSON data to import religious holidays. Each item should have: id, tradition, type, label, startDate, endDate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="import-holidays-json">JSON Data</Label>
              <Textarea
                id="import-holidays-json"
                value={importHolidaysJsonText}
                onChange={(e) => setImportHolidaysJsonText(e.target.value)}
                placeholder={`[
  {
    "id": "christian-2026-easter",
    "tradition": "Christian",
    "type": "religious_holiday",
    "label": "Easter Sunday",
    "startDate": "2026-04-05",
    "endDate": "2026-04-05",
    "notes": "Major Christian holiday."
  }
]`}
                rows={12}
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-gray-500">
              Items with matching IDs will be updated. New items will be created.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportHolidaysDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImportReligiousHolidays}
              disabled={importReligiousHolidaysMutation.isPending || !importHolidaysJsonText.trim()}
              className="bg-violet-500 hover:bg-violet-600"
            >
              {importReligiousHolidaysMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> Import</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Calendar Item Dialog */}
      <Dialog open={isAddTrackedItemDialogOpen} onOpenChange={setIsAddTrackedItemDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Add Calendar Item</DialogTitle>
            <DialogDescription>
              Add an item to the calendar with a date range and category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tracked-title">Title</Label>
              <Input
                id="tracked-title"
                value={trackedTitle}
                onChange={(e) => setTrackedTitle(e.target.value)}
                placeholder="e.g. Westminster Spring Break"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracked-category">Category</Label>
              <Select value={trackedCategory} onValueChange={setTrackedCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="school_breaks">School Breaks</SelectItem>
                    <SelectItem value="school_markers">School Dates</SelectItem>
                    <SelectItem value="religious_holidays">Religious Holidays</SelectItem>
                    <SelectItem value="holiday">Holidays</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tracked-district">
                {trackedCategory === 'religious_holidays' ? 'Tradition (optional)' : trackedCategory === 'holiday' ? 'Holiday type (optional)' : 'School / District (optional)'}
                </Label>
                <Input
                  id="tracked-district"
                  value={trackedDistrict}
                  onChange={(e) => setTrackedDistrict(e.target.value)}
                placeholder={trackedCategory === 'religious_holidays' ? 'e.g. Jewish, Christian' : trackedCategory === 'holiday' ? 'e.g. Federal, TSP no-collection week' : 'e.g. Westminster'}
                />
              </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tracked-start">Start Date</Label>
                <Input
                  id="tracked-start"
                  type="date"
                  value={trackedStartDate}
                  onChange={(e) => setTrackedStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tracked-end">End Date</Label>
                <Input
                  id="tracked-end"
                  type="date"
                  value={trackedEndDate}
                  onChange={(e) => setTrackedEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddTrackedItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddTrackedItem}
              disabled={createTrackedItemMutation.isPending || !trackedTitle.trim() || !trackedStartDate || !trackedEndDate}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {createTrackedItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding...</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" /> Add Item</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tracked Calendar Item Dialog */}
      <Dialog open={isEditTrackedItemDialogOpen} onOpenChange={(open) => {
        setIsEditTrackedItemDialogOpen(open);
        if (!open) setEditingTrackedItem(null);
      }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Calendar Item</DialogTitle>
            <DialogDescription>
              Update the details for this calendar item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-tracked-title">Title</Label>
              <Input
                id="edit-tracked-title"
                value={trackedTitle}
                onChange={(e) => setTrackedTitle(e.target.value)}
                placeholder="e.g. Westminster Spring Break"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tracked-category">Category</Label>
              <Select value={trackedCategory} onValueChange={setTrackedCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="school_breaks">School Breaks</SelectItem>
                    <SelectItem value="school_markers">School Dates</SelectItem>
                    <SelectItem value="religious_holidays">Religious Holidays</SelectItem>
                    <SelectItem value="holiday">Holidays</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tracked-district">
                {trackedCategory === 'religious_holidays' ? 'Tradition (optional)' : trackedCategory === 'holiday' ? 'Holiday type (optional)' : 'School / District (optional)'}
                </Label>
                <Input
                  id="edit-tracked-district"
                  value={trackedDistrict}
                  onChange={(e) => setTrackedDistrict(e.target.value)}
                placeholder={trackedCategory === 'religious_holidays' ? 'e.g. Jewish, Christian' : trackedCategory === 'holiday' ? 'e.g. Federal, TSP no-collection week' : 'e.g. Westminster'}
                />
              </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-tracked-start">Start Date</Label>
                <Input
                  id="edit-tracked-start"
                  type="date"
                  value={trackedStartDate}
                  onChange={(e) => setTrackedStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tracked-end">End Date</Label>
                <Input
                  id="edit-tracked-end"
                  type="date"
                  value={trackedEndDate}
                  onChange={(e) => setTrackedEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditTrackedItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateTrackedItem}
              disabled={updateTrackedItemMutation.isPending || !trackedTitle.trim() || !trackedStartDate || !trackedEndDate}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {updateTrackedItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="yearly-calendar"
        title="Calendar Assistant"
        subtitle="Ask about yearly calendar items and planning"
        contextData={{
          currentView: expandedMonth ? `Month: ${MONTH_NAMES[expandedMonth - 1]}` : 'Full Year',
          filters: {
            selectedYear,
            expandedMonth,
            searchQuery: searchQuery || undefined,
            activeChips: Array.from(activeChips),
          },
          summaryStats: {
            totalItems: filteredYearlyItems.length,
            totalTrackedItems: filteredTrackedItems.length,
            completedItems: filteredYearlyItems.filter(i => i.isCompleted).length,
            recurringItems: filteredYearlyItems.filter(i => i.isRecurring).length,
            itemsByCategory: Object.entries(
              filteredYearlyItems.reduce((acc: Record<string, number>, item) => {
                acc[item.category] = (acc[item.category] || 0) + 1;
                return acc;
              }, {})
            ).map(([category, count]) => `${category}: ${count}`).join(', '),
            itemsByPriority: Object.entries(
              filteredYearlyItems.reduce((acc: Record<string, number>, item) => {
                acc[item.priority] = (acc[item.priority] || 0) + 1;
                return acc;
              }, {})
            ).map(([priority, count]) => `${priority}: ${count}`).join(', '),
            itemsByMonth: MONTH_NAMES.map((name, i) => {
              const count = filteredYearlyItems.filter(item => item.month === i + 1).length;
              return count > 0 ? `${name}: ${count}` : null;
            }).filter(Boolean).join(', '),
          },
        }}
        getFullContext={() => ({
          rawData: filteredYearlyItems.map(item => ({
            id: item.id,
            title: item.title,
            description: item.description,
            month: item.month,
            monthName: MONTH_NAMES[item.month - 1],
            year: item.year,
            category: item.category,
            priority: item.priority,
            startDate: item.startDate,
            endDate: item.endDate,
            isRecurring: item.isRecurring,
            isCompleted: item.isCompleted,
            completedAt: item.completedAt,
            createdByName: item.createdByName,
            assignedToNames: item.assignedToNames,
          })),
          trackedItems: filteredTrackedItems.map(item => ({
            id: item.id,
            title: item.title,
            category: item.category,
            categoryLabel: TRACKED_CATEGORY_LABELS[item.category] || item.category,
            startDate: item.startDate,
            endDate: item.endDate,
            notes: item.notes,
            districts: item.metadata?.districts,
          })),
        })}
        suggestedQuestions={[
          "What items are coming up this month?",
          "Which high-priority items still need to be completed?",
          "Summarize what's planned for each month this year",
          "Are there any school breaks coming up soon?",
        ]}
      />
    </div>
  );
}
