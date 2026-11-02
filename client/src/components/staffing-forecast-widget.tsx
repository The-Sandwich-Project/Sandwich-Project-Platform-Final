import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Truck,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Download,
  Calendar,
  Settings2
} from 'lucide-react';

import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';
import { formatEventDate, formatTime12Hour, getSandwichTypesSummary } from '@/components/event-requests/utils';
import { getDriverCount, getVolunteerCount } from '@/lib/assignment-utils';
import { exportStaffingPlanning } from '@/lib/planning-pdf-export';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { isScheduledOrRescheduled } from '@shared/event-status-workflow';

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

interface WeeklyStaffing {
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  distributionDate: string;
  events: EventRequest[];
  totalDriversNeeded: number;
  totalVolunteersNeeded: number;
  totalVanDriversNeeded: number;
  driversAssigned: number;
  volunteersAssigned: number;
  vanDriversAssigned: number;
  unfulfilled: {
    drivers: number;
    volunteers: number;
    vanDrivers: number;
  };
}

interface StaffingForecastWidgetProps {
  hideHeader?: boolean;
}

export default function StaffingForecastWidget({ hideHeader = false }: StaffingForecastWidgetProps) {
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // Week range state - default to Thu → Tue
  const [weekStartDay, setWeekStartDay] = useState(4); // Thursday
  const [weekEndDay, setWeekEndDay] = useState(2); // Tuesday

  const { data: eventRequests, isLoading } = useQuery<EventRequest[]>({
    queryKey: ['/api/event-requests/all'],
    queryFn: async () => {
      const response = await fetch('/api/event-requests?all=true');
      if (!response.ok) throw new Error('Failed to fetch event requests');
      return response.json();
    },
  });

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

  // Weekly staffing forecast calculator
  const weeklyStaffingForecast = useMemo(() => {
    if (!eventRequests) return [];

    const weeklyData: Record<string, WeeklyStaffing> = {};

    // Helper function to get the start of the week based on weekStartDay
    const getWeekStart = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const currentDay = d.getDay();

      // Calculate days to go back to reach the start day
      let daysBack = currentDay - weekStartDay;
      if (daysBack < 0) daysBack += 7;

      d.setDate(d.getDate() - daysBack);
      return d;
    };

    // Helper function to get the end of the week based on weekEndDay
    const getWeekEnd = (weekStart: Date) => {
      const d = new Date(weekStart);
      const daysInRange = getDaysInRange(weekStartDay, weekEndDay);
      d.setDate(d.getDate() + daysInRange - 1);
      return d;
    };

    // Get current date for filtering events
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Process events that need staffing (scheduled events only)
    const relevantEvents = eventRequests.filter((request) => {
      // Only include scheduled (or rescheduled) events
      if (!isScheduledOrRescheduled(request.status)) {
        return false;
      }

      // Use scheduledEventDate for scheduled events, fall back to desiredEventDate
      const dateToUse = getEffectiveEventDate(request);
      if (!dateToUse) return false;

      // Only include events that need staffing
      const needsStaffing =
        (request.driversNeeded && request.driversNeeded > 0) ||
        (request.volunteersNeeded && request.volunteersNeeded > 0) ||
        request.vanDriverNeeded;

      if (!needsStaffing) return false;

      try {
        const eventDate = new Date(dateToUse);
        if (isNaN(eventDate.getTime())) return false;

        // Include events from 1 week ago to 8 weeks forward
        const oneWeekAgo = new Date(today);
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const eightWeeksFromNow = new Date(today);
        eightWeeksFromNow.setDate(eightWeeksFromNow.getDate() + 56);

        return eventDate >= oneWeekAgo && eventDate <= eightWeeksFromNow;
      } catch (error) {
        return false;
      }
    });

    relevantEvents.forEach((request) => {
      try {
        const dateToUse = getEffectiveEventDate(request);
        const eventDate = new Date(dateToUse!);
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
            events: [],
            totalDriversNeeded: 0,
            totalVolunteersNeeded: 0,
            totalVanDriversNeeded: 0,
            driversAssigned: 0,
            volunteersAssigned: 0,
            vanDriversAssigned: 0,
            unfulfilled: {
              drivers: 0,
              volunteers: 0,
              vanDrivers: 0,
            }
          };
        }

        const week = weeklyData[weekKey];
        week.events.push(request);

        // Calculate staffing needs
        const driversNeeded = request.driversNeeded || 0;
        const volunteersNeeded = request.volunteersNeeded || 0;
        const vanDriversNeeded = request.vanDriverNeeded ? 1 : 0;

        const driversAssigned = getDriverCount(request);
        const volunteersAssigned = getVolunteerCount(request);
        const vanDriversAssigned = (request.assignedVanDriverId ? 1 : 0) + (request.isDhlVan ? 1 : 0);

        week.totalDriversNeeded += driversNeeded;
        week.totalVolunteersNeeded += volunteersNeeded;
        week.totalVanDriversNeeded += vanDriversNeeded;

        week.driversAssigned += driversAssigned;
        week.volunteersAssigned += volunteersAssigned;
        week.vanDriversAssigned += vanDriversAssigned;

        // Calculate unfulfilled positions
        week.unfulfilled.drivers += Math.max(0, driversNeeded - driversAssigned);
        week.unfulfilled.volunteers += Math.max(0, volunteersNeeded - volunteersAssigned);
        week.unfulfilled.vanDrivers += Math.max(0, vanDriversNeeded - vanDriversAssigned);

      } catch (error) {
        logger.warn('Error processing event date:', request.desiredEventDate);
      }
    });

    // Convert to array and sort by week start date
    return Object.values(weeklyData)
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
      .slice(0, 12); // Show up to 12 weeks
  }, [eventRequests, weekStartDay, weekEndDay]);

  // Reset week index when date range options change
  useEffect(() => {
    setCurrentWeekIndex(0);
  }, [weekStartDay, weekEndDay]);

  // Only show one week at a time
  const currentWeek = weeklyStaffingForecast[currentWeekIndex] || null;

  const getTotalUnfulfilled = (week: WeeklyStaffing) => {
    return week.unfulfilled.drivers +
           week.unfulfilled.volunteers + week.unfulfilled.vanDrivers;
  };

  if (isLoading) {
    return (
      <Card className="border-2 border-brand-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-brand-primary flex items-center gap-2">
            <Users className="h-5 w-5" />
            Staffing Forecast
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
      <Card className={hideHeader ? "border-0 shadow-none" : "border-2 border-orange-200"}>
        {!hideHeader && (
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-brand-orange flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Weekly Staffing Planning
                </CardTitle>
                <p className="text-sm text-[#646464] mt-1">
                  Track driver and volunteer needs for upcoming events requiring staffing.
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
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-orange-800">
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
                    className="gap-1 text-xs text-orange-600 hover:text-orange-800"
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
              data-testid="button-previous-week"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <div className="font-bold text-lg text-brand-primary">
              {currentWeek?.weekStartDate} - {currentWeek?.weekEndDate}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentWeekIndex(i => Math.min(weeklyStaffingForecast.length - 1, i + 1))}
                disabled={currentWeekIndex === weeklyStaffingForecast.length - 1}
                style={{ color: '#236383', borderColor: '#236383' }}
                data-testid="button-next-week"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (currentWeek) {
                        exportStaffingPlanning(currentWeek);
                      }
                    }}
                    disabled={!currentWeek}
                    className="gap-1"
                    style={{ borderColor: '#FBAD3F', color: '#FBAD3F' }}
                  >
                    <Download className="w-4 h-4" />
                    Export PDF
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Download a stylized PDF of this week's staffing planning
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {currentWeek ? (
            <div className="space-y-4">
              {/* Overall Status */}
              <div className={`rounded-lg p-4 border-2 ${
                getTotalUnfulfilled(currentWeek) === 0
                  ? 'bg-green-50 border-green-300 text-green-800'
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}>
                <div className="flex items-center space-x-2">
                  {getTotalUnfulfilled(currentWeek) === 0 ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-semibold">All positions filled for this week!</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      <span className="font-semibold">
                        {getTotalUnfulfilled(currentWeek)} total positions still needed
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Events List */}
              <div className="space-y-3">
                <h4 className="font-semibold text-brand-primary">Events with Unmet Staffing Needs:</h4>
                {(() => {
                  // Helper function to safely get array length for PostgreSQL arrays
                  const getAssignmentCount = (assignments: any) => {
                    if (!assignments) return 0;

                    // If it's already a JavaScript array
                    if (Array.isArray(assignments)) {
                      return assignments.length;
                    }

                    // If it's a string (PostgreSQL array format like "{item1,item2}" or '{"item1","item2"}')
                    if (typeof assignments === 'string') {
                      // Empty PostgreSQL array
                      if (assignments === '{}' || assignments === '') return 0;

                      // Remove curly braces and handle quoted strings
                      let cleaned = assignments.replace(/^{|}$/g, '');

                      if (!cleaned) return 0;

                      // Handle quoted elements like "Andy Hiles","Barbara Bancroft"
                      if (cleaned.includes('"')) {
                        // Split by comma but handle quoted strings properly
                        const matches = cleaned.match(/"[^"]*"|[^",]+/g);
                        return matches ? matches.filter(item => item.trim()).length : 0;
                      } else {
                        // Simple comma-separated values
                        return cleaned.split(',').filter(item => item.trim()).length;
                      }
                    }

                    // Fallback: if it's an object, check if it has length property
                    if (typeof assignments === 'object' && assignments.length !== undefined) {
                      return assignments.length;
                    }

                    return 0;
                  };

                  // Filter events to only show those with unmet staffing needs
                  const eventsWithUnmetNeeds = currentWeek.events.filter((event) => {
                    const driversNeeded = Math.max(0, (event.driversNeeded || 0) - getAssignmentCount(event.assignedDriverIds));
                    const volunteersNeeded = Math.max(0, (event.volunteersNeeded || 0) - getAssignmentCount(event.assignedVolunteerIds));
                    const vanDriverNeeded = Math.max(0, (event.vanDriverNeeded ? 1 : 0) - ((event.assignedVanDriverId ? 1 : 0) + (event.isDhlVan ? 1 : 0)));
                    const totalUnfulfilled = driversNeeded + volunteersNeeded + vanDriverNeeded;
                    return totalUnfulfilled > 0;
                  });

                  if (eventsWithUnmetNeeds.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                        <p className="text-gray-600">All staffing needs have been met for this week!</p>
                      </div>
                    );
                  }

                  return eventsWithUnmetNeeds
                    .sort((a, b) => {
                      // Sort by date (earliest first)
                      const dateA = getEffectiveEventDate(a);
                      const dateB = getEffectiveEventDate(b);
                      if (!dateA && !dateB) return 0;
                      if (!dateA) return 1;
                      if (!dateB) return -1;
                      return new Date(dateA).getTime() - new Date(dateB).getTime();
                    })
                    .map((event) => {
                      const driversNeeded = Math.max(0, (event.driversNeeded || 0) - getAssignmentCount(event.assignedDriverIds));
                      const volunteersNeeded = Math.max(0, (event.volunteersNeeded || 0) - getAssignmentCount(event.assignedVolunteerIds));
                      const vanDriverNeeded = Math.max(0, (event.vanDriverNeeded ? 1 : 0) - ((event.assignedVanDriverId ? 1 : 0) + (event.isDhlVan ? 1 : 0)));
                      const totalUnfulfilled = driversNeeded + volunteersNeeded + vanDriverNeeded;

                  // Get sandwich count
                  const sandwichInfo = getSandwichTypesSummary(event);
                  const sandwichCount = sandwichInfo.total || event.estimatedSandwichCount || 0;

                  return (
                    <div key={event.id} className="bg-white border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="font-medium text-brand-primary text-lg">
                            {event.organizationName}
                          </div>
                          <div className="text-sm text-gray-600">
                            {(() => {
                              // Use scheduledEventDate first, fall back to desiredEventDate
                              const dateStr = getEffectiveEventDate(event);
                              if (!dateStr) return 'Date TBD';
                              const dateInfo = formatEventDate(dateStr.toString());
                              return dateInfo.text || 'Date TBD';
                            })()}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                            {event.eventStartTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {formatTime12Hour(event.eventStartTime)}
                              </span>
                            )}
                            {sandwichCount > 0 && (
                              <span className="flex items-center gap-1">
                                🥪 {sandwichCount.toLocaleString()} sandwiches
                              </span>
                            )}
                          </div>
                          {event.eventAddress && (
                            <div className="mt-1">
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.eventAddress)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-sm text-[#236383] hover:text-[#236383] hover:underline"
                              >
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="line-clamp-1">{event.eventAddress}</span>
                              </a>
                            </div>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className={`ml-2 ${totalUnfulfilled === 0 ? 'bg-green-100 text-green-800' : 'text-white'}`}
                          style={totalUnfulfilled > 0 ? { backgroundColor: '#A31C41' } : undefined}
                          data-testid={`badge-event-${event.id}-staffing`}
                        >
                          {totalUnfulfilled === 0 ? 'Fully Staffed' : `${totalUnfulfilled} needed`}
                        </Badge>
                      </div>

                      {/* Show specific unfilled roles */}
                      {totalUnfulfilled > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {driversNeeded > 0 && (
                            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
                              <Truck className="w-3 h-3 mr-1" />
                              {driversNeeded} Driver{driversNeeded > 1 ? 's' : ''} needed
                            </Badge>
                          )}
                          {volunteersNeeded > 0 && (
                            <Badge variant="outline" className="border-brand-primary-border-strong text-brand-primary bg-brand-primary-lighter">
                              <UserCheck className="w-3 h-3 mr-1" />
                              {volunteersNeeded} Volunteer{volunteersNeeded > 1 ? 's' : ''} needed
                            </Badge>
                          )}
                          {vanDriverNeeded > 0 && (
                            <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-50">
                              <Users className="w-3 h-3 mr-1" />
                              Van Driver needed
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  );
                    });
                })()}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No upcoming events requiring staffing</p>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
