import { useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, TrendingUp, Users, AlertTriangle, Info, Download, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';
import { formatEventDate, formatTime12Hour } from '@/components/event-requests/utils';
import { exportSandwichPlanning } from '@/lib/planning-pdf-export';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

interface SandwichForecastWidgetProps {
  hideHeader?: boolean;
}

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Preset week configurations
const WEEK_PRESETS = [
  { label: 'Thu → Tue', startDay: 4, endDay: 2, description: 'Thursday through Tuesday (6 days)' },
  { label: 'Sat → Fri', startDay: 6, endDay: 5, description: 'Saturday through Friday (7 days)' },
  { label: 'Mon → Sun', startDay: 1, endDay: 0, description: 'Monday through Sunday (standard week)' },
  { label: 'Sun → Sat', startDay: 0, endDay: 6, description: 'Sunday through Saturday (7 days)' },
  { label: 'Custom', startDay: -1, endDay: -1, description: 'Choose your own start and end days' },
];

export default function SandwichForecastWidget({ hideHeader = false }: SandwichForecastWidgetProps) {
  const { data: eventRequests, isLoading } = useQuery<EventRequest[]>({
    queryKey: ['/api/event-requests?all=true'],
  });

  // Week range state - default to Thu → Tue
  const [weekStartDay, setWeekStartDay] = useState(4); // Thursday
  const [weekEndDay, setWeekEndDay] = useState(2); // Tuesday
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);

  // Find matching preset or show as custom
  const currentPreset = WEEK_PRESETS.find(p => p.startDay === weekStartDay && p.endDay === weekEndDay)
    || WEEK_PRESETS[WEEK_PRESETS.length - 1]; // Default to "Custom"

  // Calculate days in the week range
  const getDaysInRange = (start: number, end: number) => {
    if (end >= start) {
      return end - start + 1;
    } else {
      return (7 - start) + end + 1;
    }
  };

  // Weekly sandwich prediction calculator
  const weeklySandwichForecast = useMemo(() => {
    if (!eventRequests) return [];

    const weeklyData: Record<
      string,
      {
        weekKey: string;
        weekStartDate: string;
        weekEndDate: string;
        distributionDate?: string;
        isComplete: boolean;
        events: EventRequest[];
        totalEstimated: number;
        confirmedCount: number;
        pendingCount: number;
      }
    > = {};

    // Helper function to get the start of the week based on weekStartDay
    const getWeekStart = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const currentDay = d.getDay();

      // Check if we're in the "gap" between week end and next week start
      // For Thu→Tue (4→2), Wed (3) is after Tue (2) but before Thu (4), so it belongs to the NEXT Thu
      const isInGapAfterWeekEnd = (() => {
        if (weekEndDay >= weekStartDay) {
          // Normal week like Mon→Fri: after Fri means next week
          return currentDay > weekEndDay;
        } else {
          // Wrapped week like Thu→Tue: after Tue but before Thu means next week
          return currentDay > weekEndDay && currentDay < weekStartDay;
        }
      })();

      if (isInGapAfterWeekEnd) {
        // Move forward to the next week's start
        let daysForward = weekStartDay - currentDay;
        if (daysForward <= 0) daysForward += 7;
        d.setDate(d.getDate() + daysForward);
      } else {
        // Normal case: go back to this week's start
        let daysBack = currentDay - weekStartDay;
        if (daysBack < 0) daysBack += 7;
        d.setDate(d.getDate() - daysBack);
      }

      return d;
    };

    // Helper function to get the end of the week based on weekEndDay
    const getWeekEnd = (weekStart: Date) => {
      const d = new Date(weekStart);
      const daysInRange = getDaysInRange(weekStartDay, weekEndDay);
      d.setDate(d.getDate() + daysInRange - 1);
      return d;
    };

    // Helper function to check if a week is complete
    const isWeekComplete = (endDate: Date) => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return now > endDate;
    };

    // Helper function to safely parse dates without timezone issues
    const parseEventDate = (dateString: string | null | undefined): Date | null => {
      if (!dateString) return null;

      try {
        // Handle ISO date strings (YYYY-MM-DD) by parsing as local date
        if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = dateString.split('-').map(Number);
          return new Date(year, month - 1, day, 12, 0, 0); // Noon to avoid timezone issues
        }

        // Handle full ISO strings or other formats
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;

        // Normalize to local noon
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
      } catch {
        return null;
      }
    };

    // Helper function to get sandwich count
    const getSandwichCount = (request: EventRequest): number => {
      // For completed events, prefer actual count
      if (request.status === 'completed' && request.actualSandwichCount) {
        return request.actualSandwichCount;
      }

      // Check estimatedSandwichCount first
      if (request.estimatedSandwichCount && request.estimatedSandwichCount > 0) {
        return request.estimatedSandwichCount;
      }

      // Check for min/max range - use max if available, otherwise min
      if (request.estimatedSandwichCountMax && request.estimatedSandwichCountMax > 0) {
        return request.estimatedSandwichCountMax;
      }
      if (request.estimatedSandwichCountMin && request.estimatedSandwichCountMin > 0) {
        return request.estimatedSandwichCountMin;
      }

      // Fall back to summing sandwichTypes quantities
      const types = request.sandwichTypes as Array<{ type: string; quantity: number }> | undefined;
      if (types && Array.isArray(types) && types.length > 0) {
        return types.reduce((sum, t) => sum + (t.quantity || 0), 0);
      }

      return 0;
    };

    // Process events - include only scheduled and completed
    const relevantEvents = eventRequests.filter((request) => {
      // Only include scheduled and completed events
      if (!['scheduled', 'completed'].includes(request.status)) {
        return false;
      }

      // Use scheduledEventDate if available, otherwise use desiredEventDate
      const dateToUse = getEffectiveEventDate(request);

      if (!dateToUse) return false;

      try {
        const eventDate = parseEventDate(dateToUse.toString());
        if (!eventDate) return false;

        // Include events from 4 weeks ago to 12 weeks forward
        const now = new Date();
        const fourWeeksAgo = new Date(now);
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
        const twelveWeeksFromNow = new Date(now);
        twelveWeeksFromNow.setDate(twelveWeeksFromNow.getDate() + 84);

        return eventDate >= fourWeeksAgo && eventDate <= twelveWeeksFromNow;
      } catch (error) {
        return false;
      }
    });

    relevantEvents.forEach((request) => {
      try {
        const dateToUse = (isScheduledOrRescheduled(request.status) || request.status === 'completed') && request.scheduledEventDate
          ? request.scheduledEventDate
          : request.desiredEventDate;

        const eventDate = parseEventDate(dateToUse!.toString());
        if (!eventDate) return;

        const weekStart = getWeekStart(eventDate);
        const weekEnd = getWeekEnd(weekStart);
        const weekKey = weekStart.toISOString().split('T')[0];

        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = {
            weekKey,
            weekStartDate: weekStart.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
            weekEndDate: weekEnd.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
            distributionDate: weekEnd.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }),
            isComplete: isWeekComplete(weekEnd),
            events: [],
            totalEstimated: 0,
            confirmedCount: 0,
            pendingCount: 0,
          };
        }

        const week = weeklyData[weekKey];
        week.events.push(request);

        const sandwichCount = getSandwichCount(request);
        week.totalEstimated += sandwichCount;

        if (request.status === 'completed' || isScheduledOrRescheduled(request.status)) {
          week.confirmedCount += sandwichCount;
        } else {
          week.pendingCount += sandwichCount;
        }
      } catch (error) {
        logger.warn('Error processing event date:', request.desiredEventDate);
      }
    });

    // Convert to array and sort by week start date
    return Object.values(weeklyData)
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  }, [eventRequests, weekStartDay, weekEndDay]);

  // Reset week index when week range changes
  useEffect(() => {
    setCurrentWeekIndex(0);
  }, [weekStartDay, weekEndDay]);

  // Find the current week (closest to today that isn't complete)
  useEffect(() => {
    if (weeklySandwichForecast.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find the first incomplete week or the most recent week
      const currentIndex = weeklySandwichForecast.findIndex(week => !week.isComplete);
      if (currentIndex !== -1) {
        setCurrentWeekIndex(currentIndex);
      } else if (weeklySandwichForecast.length > 0) {
        setCurrentWeekIndex(weeklySandwichForecast.length - 1);
      }
    }
  }, [weeklySandwichForecast.length, weekStartDay, weekEndDay]);

  // Only show one week at a time
  const currentWeek = weeklySandwichForecast[currentWeekIndex] || null;

  if (isLoading) {
    return (
      <Card className={hideHeader ? "border-0 shadow-none" : "border-2 border-brand-primary/20"}>
        <CardHeader className="pb-3">
          <CardTitle className="text-brand-primary flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Weekly Sandwich Planning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card className={hideHeader ? "border-0 shadow-none" : "border-2 border-brand-primary/20"}>
        {!hideHeader && (
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-brand-primary flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Weekly Sandwich Planning
                </CardTitle>
                <p className="text-sm text-[#646464] mt-1">
                  Track sandwich counts by week for planning and production.
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end ml-4">
                {/* Week Range Selector */}
                <Popover open={showCustomPicker} onOpenChange={setShowCustomPicker} modal>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCustomPicker(true);
                      }}
                    >
                      <Settings2 className="w-3 h-3" />
                      {currentPreset.label}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 z-[10010]" align="end" side="bottom">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium text-sm mb-2">Week Range Presets</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {WEEK_PRESETS.slice(0, -1).map((preset) => (
                            <Button
                              key={preset.label}
                              variant={currentPreset.label === preset.label ? 'default' : 'outline'}
                              size="sm"
                              className="text-xs"
                              onClick={() => {
                                setWeekStartDay(preset.startDay);
                                setWeekEndDay(preset.endDay);
                              }}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="border-t pt-3">
                        <h4 className="font-medium text-sm mb-2">Custom Range</h4>
                        <div className="flex gap-3 items-center">
                          <div className="flex-1">
                            <label className="text-xs text-gray-500 block mb-1">Start Day</label>
                            <Select
                              value={weekStartDay.toString()}
                              onValueChange={(v) => setWeekStartDay(parseInt(v))}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DAY_NAMES.map((day, i) => (
                                  <SelectItem key={i} value={i.toString()}>{day}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <span className="text-gray-400 mt-5">→</span>
                          <div className="flex-1">
                            <label className="text-xs text-gray-500 block mb-1">End Day</label>
                            <Select
                              value={weekEndDay.toString()}
                              onValueChange={(v) => setWeekEndDay(parseInt(v))}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DAY_NAMES.map((day, i) => (
                                  <SelectItem key={i} value={i.toString()}>{day}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {getDaysInRange(weekStartDay, weekEndDay)} days: {DAY_NAMES_SHORT[weekStartDay]} → {DAY_NAMES_SHORT[weekEndDay]}
                        </p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
        )}
        <CardContent className={hideHeader ? "p-0 space-y-6" : "space-y-6"}>
          {/* Week Range Info Banner - Always visible */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-800">
                <strong>Week view:</strong> {DAY_NAMES[weekStartDay]} → {DAY_NAMES[weekEndDay]} ({getDaysInRange(weekStartDay, weekEndDay)} days)
              </span>
            </div>
            {hideHeader && (
              <Popover open={showCustomPicker} onOpenChange={setShowCustomPicker} modal>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-blue-600 hover:text-blue-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCustomPicker(true);
                    }}
                  >
                    <Settings2 className="w-3 h-3" />
                    Change
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 z-[10010]" align="end" side="bottom">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-sm mb-2">Week Range Presets</h4>
                      <div className="grid grid-cols-2 gap-2">
                        {WEEK_PRESETS.slice(0, -1).map((preset) => (
                          <Button
                            key={preset.label}
                            variant={currentPreset.label === preset.label ? 'default' : 'outline'}
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              setWeekStartDay(preset.startDay);
                              setWeekEndDay(preset.endDay);
                            }}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="border-t pt-3">
                      <h4 className="font-medium text-sm mb-2">Custom Range</h4>
                      <div className="flex gap-3 items-center">
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 block mb-1">Start Day</label>
                          <Select
                            value={weekStartDay.toString()}
                            onValueChange={(v) => setWeekStartDay(parseInt(v))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAY_NAMES.map((day, i) => (
                                <SelectItem key={i} value={i.toString()}>{day}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <span className="text-gray-400 mt-5">→</span>
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 block mb-1">End Day</label>
                          <Select
                            value={weekEndDay.toString()}
                            onValueChange={(v) => setWeekEndDay(parseInt(v))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAY_NAMES.map((day, i) => (
                                <SelectItem key={i} value={i.toString()}>{day}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        {getDaysInRange(weekStartDay, weekEndDay)} days: {DAY_NAMES_SHORT[weekStartDay]} → {DAY_NAMES_SHORT[weekEndDay]}
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Week Navigation */}
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="outline"
              onClick={() => setCurrentWeekIndex(i => Math.max(0, i - 1))}
              disabled={currentWeekIndex === 0}
              style={{ color: '#236383', borderColor: '#236383' }}
            >
              ← Previous
            </Button>
            <div className="flex flex-col items-center">
              <div className="font-bold text-lg text-brand-primary">
                {currentWeek?.weekStartDate} - {currentWeek?.weekEndDate}
              </div>
              {currentWeek && !currentWeek.isComplete && (
                <Badge className="bg-yellow-100 text-yellow-800 text-xs mt-1">
                  Week in Progress
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentWeekIndex(i => Math.min(weeklySandwichForecast.length - 1, i + 1))}
                disabled={currentWeekIndex === weeklySandwichForecast.length - 1}
                style={{ color: '#236383', borderColor: '#236383' }}
              >
                Next →
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (currentWeek) {
                        exportSandwichPlanning(currentWeek);
                      }
                    }}
                    disabled={!currentWeek}
                    className="gap-1"
                    style={{ borderColor: '#236383', color: '#236383' }}
                  >
                    <Download className="w-4 h-4" />
                    Export PDF
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Download a stylized PDF of this week's sandwich planning
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Totals Section */}
          {currentWeek && (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg border border-[#236383] bg-[#F0FBFC] mb-4">
                <span style={{ color: '#236383', fontWeight: 700, fontSize: '1.1em' }}>
                  Week Total:
                </span>
                <span style={{ color: '#236383', fontWeight: 700, fontSize: '1.1em' }}>
                  🥪 {currentWeek.totalEstimated.toLocaleString()} sandwiches
                </span>
                <span className="text-sm text-[#646464] ml-2">
                  ({currentWeek.events.length} events)
                </span>
              </div>

              {/* Events list */}
              <div className="space-y-3">
                <h4 className="font-semibold text-brand-primary">
                  Events This Week ({currentWeek.events.length} total)
                </h4>
                {currentWeek.events.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No events scheduled for this week.
                  </div>
                ) : (
                  currentWeek.events
                    .sort((a, b) => {
                      const dateA = getEffectiveEventDate(a);
                      const dateB = getEffectiveEventDate(b);
                      if (!dateA && !dateB) return 0;
                      if (!dateA) return 1;
                      if (!dateB) return -1;
                      return new Date(dateA).getTime() - new Date(dateB).getTime();
                    })
                    .map((event) => {
                      const sandwichCount = event.status === 'completed' && event.actualSandwichCount
                        ? event.actualSandwichCount
                        : event.estimatedSandwichCount || 0;
                      const dateStr = getEffectiveEventDate(event);
                      const dateInfo = dateStr ? formatEventDate(dateStr.toString()) : null;

                      // Get sandwich types if available
                      const types = event.sandwichTypes as any[] | undefined;
                      const typesStr = types && Array.isArray(types) && types.length > 0
                        ? types.map((t: any) => `${t.quantity} ${t.type}`).join(', ')
                        : '';

                      return (
                        <div key={event.id} className="bg-white border rounded-lg p-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium text-brand-primary">
                                {event.organizationName}
                              </div>
                              <div className="text-sm text-gray-600">
                                📅 {dateInfo?.text || 'Date TBD'}
                                {event.eventStartTime && (
                                  <span className="ml-2">🕐 {formatTime12Hour(event.eventStartTime)}</span>
                                )}
                              </div>
                              {typesStr && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Types: {typesStr}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-[#236383]">
                                🥪 {sandwichCount.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </>
          )}

          {!currentWeek && (
            <div className="text-center py-8 text-gray-500">
              No events found for the selected week range.
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
