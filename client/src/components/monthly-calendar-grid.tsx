import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// TrackedCalendarItem type (matches schema)
interface TrackedCalendarItem {
  id: number;
  externalId: string | null;
  category: string;
  title: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  metadata: {
    type?: string;
    districts?: string[];
    academicYear?: string | null;
    tradition?: string; // "Christian", "Jewish" for religious holidays
  };
}

// YearlyCalendarItem type (TSP planning items)
interface YearlyCalendarItem {
  id: number;
  month: number;
  year: number;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  isCompleted: boolean;
}

interface MonthlyCalendarGridProps {
  year: number;
  month: number; // 1-12
  trackedItems: TrackedCalendarItem[];
  yearlyItems?: YearlyCalendarItem[]; // Optional TSP calendar items
  onMonthChange?: (year: number, month: number) => void;
  onClose?: () => void;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// TSP Brand Colors
// #236383 (dark blue) - Primary
// #fbad3f (golden/amber) - Secondary
// #236383 (teal) - Accent
// #47b3cb (light blue/cyan) - Accent
// #a31c41 (burgundy/maroon) - Accent

// Color definitions using brand palette (with lighter backgrounds)
interface ColorStyle {
  bg: string;      // background hex
  text: string;    // text hex
  border: string;  // border hex
}

// District colors using brand palette rotation
const DISTRICT_COLORS: Record<string, ColorStyle> = {
  'CCS': { bg: '#e8f4f8', text: '#236383', border: '#236383' },           // Primary blue
  'Columbus City': { bg: '#e8f4f8', text: '#236383', border: '#236383' }, // Primary blue
  'Westerville': { bg: '#e6f7f8', text: '#236383', border: '#236383' },   // Teal
  'Worthington': { bg: '#ecf9fc', text: '#47b3cb', border: '#47b3cb' },   // Light blue
  'Dublin': { bg: '#fef6e8', text: '#b8860b', border: '#fbad3f' },        // Golden
  'Hilliard': { bg: '#f9e8ec', text: '#a31c41', border: '#a31c41' },      // Burgundy
  'Upper Arlington': { bg: '#e6f7f8', text: '#236383', border: '#236383' }, // Teal
  'Grandview': { bg: '#ecf9fc', text: '#47b3cb', border: '#47b3cb' },     // Light blue
  'Bexley': { bg: '#e8f4f8', text: '#236383', border: '#236383' },        // Primary blue
  'Gahanna': { bg: '#f9e8ec', text: '#a31c41', border: '#a31c41' },       // Burgundy
  'New Albany': { bg: '#e6f7f8', text: '#236383', border: '#236383' },    // Teal
  'South-Western': { bg: '#fef6e8', text: '#b8860b', border: '#fbad3f' }, // Golden
  'Groveport': { bg: '#ecf9fc', text: '#47b3cb', border: '#47b3cb' },     // Light blue
  'Canal Winchester': { bg: '#e8f4f8', text: '#236383', border: '#236383' }, // Primary blue
  'Reynoldsburg': { bg: '#f9e8ec', text: '#a31c41', border: '#a31c41' },  // Burgundy
  'All': { bg: '#fef6e8', text: '#b8860b', border: '#fbad3f' },           // Golden (shared)
  'default': { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' },       // Gray fallback
};

// Category colors using brand palette
const CATEGORY_COLORS: Record<string, ColorStyle> = {
  // Tracked calendar categories
  school_breaks: { bg: '#fef6e8', text: '#b8860b', border: '#fbad3f' },   // Golden/amber
  school_markers: { bg: '#e6f7f8', text: '#236383', border: '#236383' },  // Teal
  religious_holidays: { bg: '#f3e8ff', text: '#6d28d9', border: '#8b5cf6' }, // Violet
  holiday: { bg: '#f9e8ec', text: '#a31c41', border: '#a31c41' },         // Burgundy
  // TSP calendar item categories
  preparation: { bg: '#e8f4f8', text: '#236383', border: '#236383' },     // Primary blue
  'event-rush': { bg: '#f9e8ec', text: '#a31c41', border: '#a31c41' },    // Burgundy (urgent)
  event: { bg: '#fef6e8', text: '#b8860b', border: '#fbad3f' },           // Golden (events)
  planning: { bg: '#ecf9fc', text: '#47b3cb', border: '#47b3cb' },        // Light blue
  staffing: { bg: '#e6f7f8', text: '#236383', border: '#236383' },        // Teal
  board: { bg: '#e6f7f8', text: '#236383', border: '#236383' },           // Teal
  seasonal: { bg: '#e8f4f8', text: '#236383', border: '#236383' },        // Primary blue
  other: { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' },           // Gray
  default: { bg: '#e8f4f8', text: '#236383', border: '#236383' },         // Primary blue
};

// Safe date parsing (avoid timezone issues)
function parseDateSafe(dateStr: string): Date {
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  return new Date(`${dateStr}T12:00:00`);
}

// Get the days in a month
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Get what day of week the month starts on (0 = Sunday)
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

// Calculate which days a date range spans within a specific month
function getDateRangeInMonth(
  startDate: string,
  endDate: string,
  year: number,
  month: number
): { startDay: number; endDay: number; extendsBeforeMonth: boolean; extendsAfterMonth: boolean } | null {
  const rangeStart = parseDateSafe(startDate);
  const rangeEnd = parseDateSafe(endDate);
  const monthStart = new Date(year, month - 1, 1);
  const daysInMonth = getDaysInMonth(year, month);
  const monthEnd = new Date(year, month - 1, daysInMonth);

  // Check if range overlaps with month at all
  if (rangeStart > monthEnd || rangeEnd < monthStart) {
    return null;
  }

  // Calculate effective start/end days within the month
  let startDay: number;
  let endDay: number;
  let extendsBeforeMonth = false;
  let extendsAfterMonth = false;

  if (rangeStart < monthStart) {
    startDay = 1;
    extendsBeforeMonth = true;
  } else {
    startDay = rangeStart.getDate();
  }

  if (rangeEnd > monthEnd) {
    endDay = daysInMonth;
    extendsAfterMonth = true;
  } else {
    endDay = rangeEnd.getDate();
  }

  return { startDay, endDay, extendsBeforeMonth, extendsAfterMonth };
}

// Format date for display
function formatDateShort(dateStr: string): string {
  const date = parseDateSafe(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Single-day observances name their weekday: a holiday landing on a collection
// or distribution day affects operations differently than one landing on a weekend.
function formatItemDateRange(startDate: string, endDate: string): string {
  const start = parseDateSafe(startDate);
  const end = parseDateSafe(endDate);
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  return `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
}

// Get color for an item based on its district(s) or category
function getItemColor(item: TrackedCalendarItem): { bg: string; text: string; border: string } {
  // Religious holidays use category color directly
  if (item.category === 'religious_holidays') {
    return CATEGORY_COLORS.religious_holidays;
  }

  const districts = item.metadata?.districts || [];

  // If multiple districts or "All", use amber
  if (districts.length > 1 || districts.includes('All')) {
    return DISTRICT_COLORS['All'];
  }

  // Single district - use district-specific color, fall back to category color
  if (districts.length === 1) {
    return DISTRICT_COLORS[districts[0]] || CATEGORY_COLORS[item.category] || CATEGORY_COLORS.default;
  }

  // Fallback to category color
  return CATEGORY_COLORS[item.category] || CATEGORY_COLORS.default;
}

// Detect single-day school markers (last/first day of school, etc.) from the title.
// These are NOT breaks — e.g. "Last Day of School" marks the start of a district's
// summer break, not a break period itself. Returns '' when the title is not a marker.
function getSchoolMarkerType(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('last day')) return 'Last Day';
  if (
    t.includes('first day') ||
    t.includes('school starts') ||
    t.includes('school start') ||
    t.includes('school resumes')
  )
    return '1st Day';
  if (t.includes('early release') || t.includes('early dismissal')) return 'Early Release';
  if (t.includes('graduation')) return 'Graduation';
  return '';
}

// Get abbreviated break type from title
function getBreakType(title: string): string {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('winter')) return 'Winter';
  if (lowerTitle.includes('spring')) return 'Spring';
  if (lowerTitle.includes('fall')) return 'Fall';
  if (lowerTitle.includes('summer')) return 'Summer';
  if (lowerTitle.includes('thanksgiving')) return 'Thanksgiving';
  if (lowerTitle.includes('christmas')) return 'Christmas';
  if (lowerTitle.includes('mlk') || lowerTitle.includes('martin luther')) return 'MLK';
  if (lowerTitle.includes('president')) return 'Presidents';
  if (lowerTitle.includes('memorial')) return 'Memorial';
  if (lowerTitle.includes('labor')) return 'Labor';
  if (lowerTitle.includes('columbus')) return 'Columbus';
  if (lowerTitle.includes('veteran')) return 'Veterans';
  return 'Break'; // Generic fallback
}

// Get display label for an item (district name + break type, or holiday name)
function getItemLabel(item: TrackedCalendarItem): string {
  // Religious holidays show a compact label
  if (item.category === 'religious_holidays') {
    // Shorten long names for the calendar bar
    const title = item.title;
    if (title.includes('(')) return title.split('(')[0].trim();
    return title;
  }

  const districts = item.metadata?.districts || [];
  const isBreak = item.category === 'school_breaks' || item.title.toLowerCase().includes('break');

  if (districts.length === 0) {
    return item.title;
  }

  // Get abbreviated district name
  let districtLabel: string;
  if (districts.length === 1) {
    const district = districts[0];
    if (district === 'Columbus City' || district === 'CCS') districtLabel = 'CCS';
    else if (district === 'Upper Arlington') districtLabel = 'UA';
    else if (district === 'South-Western') districtLabel = 'SW';
    else if (district === 'Canal Winchester') districtLabel = 'CW';
    else if (district === 'New Albany') districtLabel = 'NA';
    else districtLabel = district;
  } else if (districts.includes('All')) {
    districtLabel = 'All';
  } else {
    districtLabel = `${districts.length} Dist`;
  }

  // Single-day school markers (e.g. last/first day of school) take precedence over
  // break labeling so they aren't mislabeled as a generic "Break".
  const markerType = getSchoolMarkerType(item.title);
  if (markerType) {
    return `${districtLabel} ${markerType}`;
  }

  // Add break type context
  if (isBreak) {
    const breakType = getBreakType(item.title);
    return `${districtLabel} ${breakType}`;
  }

  return districtLabel;
}

// Calculate district overlap for a specific day
function getDistrictsOnBreak(
  trackedItems: TrackedCalendarItem[],
  year: number,
  month: number,
  day: number
): { count: number; districts: string[] } {
  const targetDate = new Date(year, month - 1, day);
  const districtsOnBreak = new Set<string>();

  trackedItems.forEach(item => {
    if (item.category !== 'school_breaks') return;

    const startDate = parseDateSafe(item.startDate);
    const endDate = parseDateSafe(item.endDate);

    // Check if this day falls within the break
    if (targetDate >= startDate && targetDate <= endDate) {
      const districts = item.metadata?.districts || [];
      districts.forEach(d => districtsOnBreak.add(d));
    }
  });

  return {
    count: districtsOnBreak.size,
    districts: Array.from(districtsOnBreak).sort(),
  };
}

// Get severity level based on district count
function getBreakSeverity(districtCount: number): {
  level: 'none' | 'light' | 'moderate' | 'critical';
  color: string;
  bgColor: string;
} {
  if (districtCount === 0) return { level: 'none', color: '', bgColor: '' };
  if (districtCount <= 2) return { level: 'light', color: '#b8860b', bgColor: '#fef6e8' };
  if (districtCount <= 3) return { level: 'moderate', color: '#c2410c', bgColor: '#fff7ed' };
  return { level: 'critical', color: '#a31c41', bgColor: '#fef2f2' };
}

// Unified calendar item for display (combines tracked and yearly items)
interface UnifiedCalendarItem {
  id: string; // Prefixed to avoid collisions
  type: 'tracked' | 'yearly';
  title: string;
  startDate: string;
  endDate: string;
  category: string;
  colors: { bg: string; text: string; border: string };
  label: string;
  // Tracked item specific
  districts?: string[];
  tradition?: string; // "Christian", "Jewish" for religious holidays
  notes?: string | null;
  // Yearly item specific
  description?: string | null;
  priority?: string;
  isCompleted?: boolean;
}

export function MonthlyCalendarGrid({
  year,
  month,
  trackedItems,
  yearlyItems = [],
  onMonthChange,
  onClose,
}: MonthlyCalendarGridProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = getFirstDayOfMonth(year, month);

  // Calculate weeks needed (including partial weeks)
  const totalCells = firstDayOfWeek + daysInMonth;
  const weeksNeeded = Math.ceil(totalCells / 7);

  // Combine and filter tracked items and yearly items that have dates
  const allItems = useMemo((): UnifiedCalendarItem[] => {
    const items: UnifiedCalendarItem[] = [];

    // Process tracked items
    trackedItems.forEach(item => {
      const range = getDateRangeInMonth(item.startDate, item.endDate, year, month);
      if (range) {
        items.push({
          id: `tracked-${item.id}`,
          type: 'tracked',
          title: item.title,
          startDate: item.startDate,
          endDate: item.endDate,
          category: item.category,
          colors: getItemColor(item),
          label: getItemLabel(item),
          districts: item.metadata?.districts,
          tradition: item.metadata?.tradition,
          notes: item.notes,
        });
      }
    });

    // Process yearly items that have dates
    yearlyItems.forEach(item => {
      if (item.startDate) {
        let startDate = item.startDate;
        let endDate = item.endDate || item.startDate;

        // Fix: If endDate is before startDate, swap them
        if (endDate < startDate) {
          console.warn('Yearly item has endDate before startDate, swapping:', item.title, startDate, endDate);
          [startDate, endDate] = [endDate, startDate];
        }

        const range = getDateRangeInMonth(startDate, endDate, year, month);
        console.log('Processing yearly item for grid:', {
          id: item.id,
          title: item.title,
          startDate,
          endDate,
          month,
          year,
          hasRange: !!range,
          range,
        });
        if (range) {
          const categoryColors = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.default;
          items.push({
            id: `yearly-${item.id}`,
            type: 'yearly',
            title: item.title,
            startDate: startDate,
            endDate: endDate,
            category: item.category,
            colors: categoryColors,
            label: item.title,
            description: item.description,
            priority: item.priority,
            isCompleted: item.isCompleted,
          });
        }
      }
    });

    console.log('Total items for calendar grid:', items.length, 'yearlyItems with dates:', yearlyItems.filter(i => i.startDate).length);

    return items;
  }, [trackedItems, yearlyItems, year, month]);

  // Calculate item positions with lane assignments to prevent overlap
  const itemBars = useMemo(() => {
    const bars = allItems.map(item => {
      const range = getDateRangeInMonth(item.startDate, item.endDate, year, month)!;

      // Calculate grid positions
      const startCellIndex = firstDayOfWeek + range.startDay - 1;
      const endCellIndex = firstDayOfWeek + range.endDay - 1;

      // Break into week segments
      const segments: { weekIndex: number; startCol: number; endCol: number; isStart: boolean; isEnd: boolean }[] = [];

      let currentCell = startCellIndex;
      while (currentCell <= endCellIndex) {
        const weekIndex = Math.floor(currentCell / 7);
        const startCol = currentCell % 7;
        const weekEndCell = (weekIndex + 1) * 7 - 1;
        const segmentEndCell = Math.min(endCellIndex, weekEndCell);
        const endCol = segmentEndCell % 7;

        segments.push({
          weekIndex,
          startCol,
          endCol,
          isStart: currentCell === startCellIndex && !range.extendsBeforeMonth,
          isEnd: segmentEndCell === endCellIndex && !range.extendsAfterMonth,
        });

        currentCell = (weekIndex + 1) * 7;
      }

      return {
        item,
        range,
        segments,
        startCellIndex,
        endCellIndex,
      };
    });

    // Sort bars by start date, then by length (longer first) for better lane assignment
    bars.sort((a, b) => {
      if (a.startCellIndex !== b.startCellIndex) {
        return a.startCellIndex - b.startCellIndex;
      }
      return (b.endCellIndex - b.startCellIndex) - (a.endCellIndex - a.startCellIndex);
    });

    // Assign lanes to prevent overlap within each week
    const weekLanes: Map<string, { endCol: number; lane: number }>[] = [];
    for (let w = 0; w < weeksNeeded; w++) {
      weekLanes.push(new Map());
    }

    const barsWithLanes = bars.map(bar => {
      const lanes: Record<number, number> = {};

      bar.segments.forEach(segment => {
        const weekOccupied = weekLanes[segment.weekIndex];
        let lane = 0;

        // Find first available lane
        const occupiedLanes = Array.from(weekOccupied.values())
          .filter(occ => occ.endCol >= segment.startCol)
          .map(occ => occ.lane);

        while (occupiedLanes.includes(lane)) {
          lane++;
        }

        lanes[segment.weekIndex] = lane;
        weekOccupied.set(bar.item.id, { endCol: segment.endCol, lane });
      });

      return { ...bar, lanes };
    });

    return barsWithLanes;
  }, [allItems, firstDayOfWeek, year, month, weeksNeeded]);

  // Calculate max lanes per week to set appropriate row height
  const maxLanesPerWeek = useMemo(() => {
    const maxLanes: number[] = Array(weeksNeeded).fill(0);

    itemBars.forEach(bar => {
      Object.entries(bar.lanes).forEach(([weekStr, lane]) => {
        const week = parseInt(weekStr);
        maxLanes[week] = Math.max(maxLanes[week], lane + 1);
      });
    });

    return maxLanes;
  }, [itemBars, weeksNeeded]);

  // Navigate to previous month
  const goToPrevMonth = () => {
    if (onMonthChange) {
      if (month === 1) {
        onMonthChange(year - 1, 12);
      } else {
        onMonthChange(year, month - 1);
      }
    }
  };

  // Navigate to next month
  const goToNextMonth = () => {
    if (onMonthChange) {
      if (month === 12) {
        onMonthChange(year + 1, 1);
      } else {
        onMonthChange(year, month + 1);
      }
    }
  };

  // Check if a day is today
  const today = new Date();
  const isToday = (day: number) => {
    return today.getFullYear() === year &&
           today.getMonth() === month - 1 &&
           today.getDate() === day;
  };

  // Get unique districts, tracked categories, and yearly categories for legend
  const { uniqueDistricts, uniqueCategories, uniqueTrackedCategories } = useMemo(() => {
    const districts = new Set<string>();
    const categories = new Set<string>();
    const trackedCategories = new Set<string>();

    allItems.forEach(item => {
      if (item.type === 'tracked') {
        if (item.districts) {
          item.districts.forEach(d => districts.add(d));
        }
        trackedCategories.add(item.category);
      }
      if (item.type === 'yearly') {
        categories.add(item.category);
      }
    });

    return {
      uniqueDistricts: Array.from(districts).sort(),
      uniqueCategories: Array.from(categories).sort(),
      uniqueTrackedCategories: Array.from(trackedCategories).sort(),
    };
  }, [allItems]);

  // Category display labels
  const CATEGORY_LABELS: Record<string, string> = {
    preparation: 'Preparation',
    'event-rush': 'Event Rush',
    event: 'Event',
    planning: 'Planning',
    staffing: 'Staffing',
    board: 'Board',
    seasonal: 'Seasonal',
    holiday: 'Holidays',
    religious_holidays: 'Religious Holidays',
    other: 'Other',
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm" style={{ borderColor: '#47b3cb' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#47b3cb' }}>
        <div className="flex items-center gap-2">
          {onMonthChange && (
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevMonth}
              className="hover:bg-[#e8f4f8]"
              style={{ color: '#236383' }}
              aria-label="Go to previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <h3 className="text-lg font-semibold" style={{ color: '#236383' }}>
            {MONTH_NAMES[month - 1]} {year}
          </h3>
          {onMonthChange && (
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextMonth}
              className="hover:bg-[#e8f4f8]"
              style={{ color: '#236383' }}
              aria-label="Go to next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="hover:bg-[#e8f4f8]"
            style={{ color: '#236383' }}
          >
            Back to Year View
          </Button>
        )}
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {DAYS_OF_WEEK.map(day => (
          <div
            key={day}
            className="p-2 text-center text-sm font-medium text-gray-500 border-r last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid with date range bars */}
      <div className="relative">
        {/* Week rows */}
        {Array.from({ length: weeksNeeded }).map((_, weekIndex) => {
          // Calculate row height based on number of bars
          const numLanes = Math.max(maxLanesPerWeek[weekIndex], 1);
          const rowHeight = Math.max(80, 28 + numLanes * 22); // Base 28px for date + 22px per lane

          return (
            <div key={weekIndex} className="relative">
              {/* Day cells */}
              <div className="grid grid-cols-7">
                {Array.from({ length: 7 }).map((_, dayIndex) => {
                  const cellIndex = weekIndex * 7 + dayIndex;
                  const dayNumber = cellIndex - firstDayOfWeek + 1;
                  const isValidDay = dayNumber >= 1 && dayNumber <= daysInMonth;

                  // Calculate district overlap for this day
                  const breakInfo = isValidDay
                    ? getDistrictsOnBreak(trackedItems, year, month, dayNumber)
                    : { count: 0, districts: [] };
                  const severity = getBreakSeverity(breakInfo.count);

                  return (
                    <div
                      key={dayIndex}
                      style={{
                        height: `${rowHeight}px`,
                        backgroundColor: isValidDay && isToday(dayNumber)
                          ? '#e8f4f8'
                          : isValidDay && severity.level !== 'none'
                            ? severity.bgColor
                            : !isValidDay
                              ? '#f9fafb'
                              : undefined,
                      }}
                      className={cn(
                        'p-1 border-r border-b last:border-r-0 relative'
                      )}
                    >
                      {isValidDay && (
                        <div className="flex items-start justify-between">
                          <span
                            className={cn(
                              'text-sm font-medium',
                              isToday(dayNumber) && 'text-white rounded-full w-6 h-6 flex items-center justify-center'
                            )}
                            style={isToday(dayNumber) ? { backgroundColor: '#236383' } : undefined}
                          >
                            {dayNumber}
                          </span>
                          {/* Severity indicator for multiple districts on break */}
                          {severity.level !== 'none' && breakInfo.count >= 3 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="text-xs font-bold px-1 rounded"
                                    style={{
                                      backgroundColor: severity.color,
                                      color: 'white',
                                    }}
                                  >
                                    {breakInfo.count}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <div className="space-y-1">
                                    <p className="font-semibold" style={{ color: severity.color }}>
                                      ⚠️ {breakInfo.count} Districts on Break
                                    </p>
                                    <p className="text-xs text-gray-600">
                                      {breakInfo.districts.join(', ')}
                                    </p>
                                    <p className="text-xs text-amber-700 mt-1">
                                      Expect reduced volunteer availability. Consider extra outreach or group events.
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Date range bars overlaid on this week */}
              <div className="absolute inset-0 pointer-events-none">
                {itemBars.map(({ item, segments, lanes }) =>
                  segments
                    .filter(seg => seg.weekIndex === weekIndex)
                    .map((segment, segIndex) => {
                      const leftPercent = (segment.startCol / 7) * 100;
                      const widthPercent = ((segment.endCol - segment.startCol + 1) / 7) * 100;
                      const lane = lanes[weekIndex] || 0;
                      const topOffset = 24 + lane * 22; // Start below date number

                      return (
                        <TooltipProvider key={`${item.id}-${segIndex}`}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'absolute h-5 flex items-center px-1.5 text-xs font-medium pointer-events-auto cursor-pointer',
                                  'border shadow-sm',
                                  segment.isStart ? 'rounded-l-md' : 'border-l-0',
                                  segment.isEnd ? 'rounded-r-md' : 'border-r-0',
                                  item.isCompleted && 'opacity-50 line-through'
                                )}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  top: `${topOffset}px`,
                                  backgroundColor: item.colors.bg,
                                  color: item.colors.text,
                                  borderColor: item.colors.border,
                                }}
                              >
                                <span className="truncate">
                                  {item.label}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="space-y-1">
                                <p className="font-semibold">{item.title}</p>
                                <p className="text-sm text-gray-600">
                                  {formatItemDateRange(item.startDate, item.endDate)}
                                </p>
                                {/* Tracked item: show districts */}
                                {item.type === 'tracked' && item.districts && item.districts.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {item.districts.map(district => {
                                      const districtColors = DISTRICT_COLORS[district] || DISTRICT_COLORS['default'];
                                      return (
                                        <Badge
                                          key={district}
                                          variant="outline"
                                          className="text-xs"
                                          style={{
                                            backgroundColor: districtColors.bg,
                                            color: districtColors.text,
                                            borderColor: districtColors.border,
                                          }}
                                        >
                                          {district}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                )}
                                {/* Religious holiday: show tradition */}
                                {item.type === 'tracked' && item.category === 'religious_holidays' && item.tradition && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs"
                                    style={{
                                      backgroundColor: '#f3e8ff',
                                      color: '#6d28d9',
                                      borderColor: '#8b5cf6',
                                    }}
                                  >
                                    {item.tradition}
                                  </Badge>
                                )}
                                {/* School break impact note */}
                                {item.type === 'tracked' && item.category === 'school_breaks' && (
                                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                                    <p className="font-medium text-amber-800">Volunteer Impact</p>
                                    <p className="text-amber-700 mt-1">
                                      School breaks often mean lower volunteer availability. Consider scheduling extra group events or targeted outreach to maintain collection numbers.
                                    </p>
                                  </div>
                                )}
                                {item.notes && (
                                  <p className="text-xs text-gray-500 mt-1">{item.notes}</p>
                                )}
                                {/* Yearly item: show category and priority */}
                                {item.type === 'yearly' && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-500 capitalize">{item.category?.replace('-', ' ')}</span>
                                    {item.priority && (
                                      <span style={{
                                        color: item.priority === 'high' ? '#a31c41' :
                                               item.priority === 'medium' ? '#236383' : '#6b7280'
                                      }}>
                                        {item.priority} priority
                                      </span>
                                    )}
                                    {item.isCompleted && (
                                      <span className="text-green-600">Completed</span>
                                    )}
                                  </div>
                                )}
                                {item.description && (
                                  <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend showing districts, tracked categories, and yearly categories */}
      {(uniqueDistricts.length > 0 || uniqueCategories.length > 0 || uniqueTrackedCategories.length > 0) && (
        <div className="p-3 border-t bg-gray-50 space-y-3">
          {uniqueDistricts.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">School Districts:</div>
              <div className="flex flex-wrap gap-2">
                {uniqueDistricts.map(district => {
                  const colors = DISTRICT_COLORS[district] || DISTRICT_COLORS['default'];
                  return (
                    <Badge
                      key={district}
                      variant="outline"
                      className="text-xs"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                        borderColor: colors.border,
                      }}
                    >
                      {district}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
          {uniqueTrackedCategories.filter(c => c !== 'school_breaks' && c !== 'school_markers').length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Tracked Calendars:</div>
              <div className="flex flex-wrap gap-2">
                {uniqueTrackedCategories.filter(c => c !== 'school_breaks' && c !== 'school_markers').map(category => {
                  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS['default'];
                  return (
                    <Badge
                      key={category}
                      variant="outline"
                      className="text-xs"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                        borderColor: colors.border,
                      }}
                    >
                      {CATEGORY_LABELS[category] || category}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
          {uniqueCategories.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">TSP Calendar Items:</div>
              <div className="flex flex-wrap gap-2">
                {uniqueCategories.map(category => {
                  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS['default'];
                  return (
                    <Badge
                      key={category}
                      variant="outline"
                      className="text-xs"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                        borderColor: colors.border,
                      }}
                    >
                      {CATEGORY_LABELS[category] || category}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MonthlyCalendarGrid;
