import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calendar, TrendingDown, ChevronRight, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { EventRequest } from '@shared/schema';
import { logger } from '@/lib/logger';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { EVENT_REQUEST_LIST_FRESHNESS } from '@/components/event-requests/lib/eventRequestsListQuery';

interface LowVolumeAlertProps {
  /** Navigate to Event Requests filtered to a pipeline week (0 = this week). */
  onNavigateToWeek?: (weekOffset: number) => void;
}

interface WeekForecast {
  weekStart: Date;
  weekEnd: Date;
  weekLabel: string;
  totalSandwiches: number;
  actualSandwiches?: number; // Only for current week - sandwiches already collected
  eventCount: number;
  isCurrentWeek: boolean;
  events: Array<{
    id: number;
    organizationName: string | null;
    sandwichCount: number;
    isRange: boolean;
    date: Date;
  }>;
}

/**
 * Calculate sandwich count for an event, handling ranges appropriately.
 * For ranges, use the midpoint for forecasting purposes.
 */
function getEventSandwichCount(event: EventRequest): { count: number; isRange: boolean } {
  // Priority: actualSandwichCount > estimatedSandwichCount > range midpoint > sandwichTypes sum
  if (event.actualSandwichCount && event.actualSandwichCount > 0) {
    return { count: event.actualSandwichCount, isRange: false };
  }

  if (event.estimatedSandwichCount && event.estimatedSandwichCount > 0) {
    return { count: event.estimatedSandwichCount, isRange: false };
  }

  // Handle range estimates - use midpoint for forecasting
  const min = event.estimatedSandwichCountMin;
  const max = event.estimatedSandwichCountMax;
  if (min && max && min > 0 && max > 0) {
    const midpoint = Math.round((min + max) / 2);
    return { count: midpoint, isRange: true };
  }

  if (max && max > 0) {
    return { count: max, isRange: true };
  }

  if (min && min > 0) {
    return { count: min, isRange: true };
  }

  // Fall back to sandwichTypes if available
  if (event.sandwichTypes && Array.isArray(event.sandwichTypes)) {
    const typesTotal = event.sandwichTypes.reduce((sum: number, type: any) => {
      return sum + (type.quantity || type.count || 0);
    }, 0);
    if (typesTotal > 0) {
      return { count: typesTotal, isRange: false };
    }
  }

  return { count: 0, isRange: false };
}

/**
 * Get the start of a week (Monday)
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of a week (Sunday)
 */
function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Format a week range for display
 */
function formatWeekRange(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startStr} - ${endStr}`;
}

export function LowVolumeAlert({ onNavigateToWeek }: LowVolumeAlertProps) {
  // Active upcoming pipeline only — the unfiltered `/api/event-requests` table
  // is far larger than this forecast needs and was starving the dashboard.
  const { data: eventRequests = [] } = useQuery<EventRequest[]>({
    queryKey: ['/api/event-requests/list', { status: 'scheduled,in_process,rescheduled' }, 'group-forecast'],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        '/api/event-requests/list?status=scheduled,in_process,rescheduled',
        { credentials: 'include', signal },
      );
      if (!response.ok) throw new Error('Failed to fetch event requests');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    ...EVENT_REQUEST_LIST_FRESHNESS,
  });

  // Fetch historical collection data to calculate baseline and current week actuals
  const { data: collectionsData } = useQuery<{ collections: any[] }>({
    queryKey: ['/api/sandwich-collections', { limit: 5000 }],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections?limit=5000', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch collections');
      return response.json();
    },
  });

  // Calculate forecasts for current week + next 3 weeks
  const { weekForecasts, historicalAverage, lowVolumeWeeks, currentWeekActual } = useMemo(() => {
    const today = new Date();
    const forecasts: WeekForecast[] = [];
    const currentWeekStart = getWeekStart(today);
    const currentWeekEnd = getWeekEnd(currentWeekStart);

    // Calculate historical weekly average from GROUP events only
    // (excluding individual donations to focus on group event volume)
    let historicalGroupTotal = 0;
    let historicalWeekCount = 0;
    let thisWeekActualSandwiches = 0;

    if (collectionsData?.collections) {
      const weeklyGroupTotals: Record<string, number> = {};
      const currentWeekKey = currentWeekStart.toISOString().split('T')[0];

      collectionsData.collections.forEach((collection: any) => {
        if (collection.collectionDate && collection.groupCollections) {
          const date = new Date(collection.collectionDate);
          const weekStart = getWeekStart(date);
          const weekKey = weekStart.toISOString().split('T')[0];

          const groupTotal = Array.isArray(collection.groupCollections)
            ? collection.groupCollections.reduce((sum: number, group: any) => {
                return sum + (group.count || group.sandwichCount || 0);
              }, 0)
            : 0;

          // Track current week's actual collections
          if (weekKey === currentWeekKey) {
            thisWeekActualSandwiches += groupTotal;
          }

          weeklyGroupTotals[weekKey] = (weeklyGroupTotals[weekKey] || 0) + groupTotal;
        }
      });

      // Calculate average from weeks that had group collections (excluding current week)
      const weeksWithGroups = Object.entries(weeklyGroupTotals)
        .filter(([key, total]) => total > 0 && key !== currentWeekKey)
        .map(([, total]) => total);
      if (weeksWithGroups.length > 0) {
        historicalGroupTotal = weeksWithGroups.reduce((a, b) => a + b, 0);
        historicalWeekCount = weeksWithGroups.length;
      }
    }

    const avgWeeklyFromGroups = historicalWeekCount > 0
      ? Math.round(historicalGroupTotal / historicalWeekCount)
      : 3000; // Default baseline if no historical data

    // Build forecasts for current week + next 3 weeks
    for (let weekOffset = 0; weekOffset <= 3; weekOffset++) {
      const weekStart = getWeekStart(today);
      weekStart.setDate(weekStart.getDate() + (weekOffset * 7));
      const weekEnd = getWeekEnd(weekStart);
      const isCurrentWeek = weekOffset === 0;

      // Get events for this week (new, in_process, and scheduled)
      const eventsThisWeek = eventRequests.filter((event) => {
        // Use scheduledEventDate if available, otherwise desiredEventDate
        const eventDateStr = getEffectiveEventDate(event);
        if (!eventDateStr) return false;

        // Include new, in_process, and scheduled events
        if (!['new', 'in_process', 'scheduled'].includes(event.status)) return false;

        const eventDate = new Date(eventDateStr);
        return eventDate >= weekStart && eventDate <= weekEnd;
      });

      // Calculate total sandwiches for this week
      const eventsWithCounts = eventsThisWeek.map(event => {
        const { count, isRange } = getEventSandwichCount(event);
        const eventDateStr = getEffectiveEventDate(event);
        return {
          id: event.id,
          organizationName: event.organizationName,
          sandwichCount: count,
          isRange,
          date: new Date(eventDateStr!),
        };
      });

      const totalSandwiches = eventsWithCounts.reduce((sum, e) => sum + e.sandwichCount, 0);

      // Format week label
      let weekLabel: string;
      if (weekOffset === 0) {
        weekLabel = 'This Week';
      } else if (weekOffset === 1) {
        weekLabel = 'Next Week';
      } else if (weekOffset === 2) {
        weekLabel = '2 Weeks Out';
      } else {
        weekLabel = '3 Weeks Out';
      }

      forecasts.push({
        weekStart,
        weekEnd,
        weekLabel,
        totalSandwiches,
        actualSandwiches: isCurrentWeek ? thisWeekActualSandwiches : undefined,
        eventCount: eventsThisWeek.length,
        isCurrentWeek,
        events: eventsWithCounts,
      });
    }

    // Identify weeks that are below 60% of the historical average (excluding current week from alerts)
    const threshold = avgWeeklyFromGroups * 0.6;
    const lowWeeks = forecasts.filter(f => !f.isCurrentWeek && f.totalSandwiches < threshold);

    logger.log('Low Volume Alert Analysis:', {
      historicalAverage: avgWeeklyFromGroups,
      threshold,
      currentWeekActual: thisWeekActualSandwiches,
      forecasts: forecasts.map(f => ({
        week: f.weekLabel,
        total: f.totalSandwiches,
        actual: f.actualSandwiches,
        eventCount: f.eventCount,
        isCurrentWeek: f.isCurrentWeek,
        isBelowThreshold: f.totalSandwiches < threshold,
      })),
    });

    return {
      weekForecasts: forecasts,
      historicalAverage: avgWeeklyFromGroups,
      lowVolumeWeeks: lowWeeks,
      currentWeekActual: thisWeekActualSandwiches,
    };
  }, [eventRequests, collectionsData]);

  const hasLowVolumeWeeks = lowVolumeWeeks.length > 0;
  const urgentWeek = hasLowVolumeWeeks ? lowVolumeWeeks[0] : null;
  const shortfall = urgentWeek ? historicalAverage - urgentWeek.totalSandwiches : 0;

  // ── Severity tier ─────────────────────────────────────────────────────
  // The orange warning icon used to appear any time there was AT LEAST ONE
  // forecast week below 60% of average — which meant the card looked like a
  // fire alarm almost continuously and users started ignoring it (alert
  // fatigue). The UI now distinguishes three tiers so the icon escalates
  // only when there's actually a problem worth shouting about:
  //
  //   healthy → trending-up green ("On track")        — no low weeks
  //   watch   → calendar neutral ("Forecast")         — there ARE low weeks
  //                                                     but the worst is a
  //                                                     soft dip (< 50% below)
  //   severe  → alert-triangle amber ("Action needed")— at least one week is
  //                                                     a SEVERE drop
  //                                                     (≥ 50% below avg).
  //                                                     This is the case
  //                                                     where leadership
  //                                                     should pay attention
  //                                                     (e.g. the 73% drop).
  //
  // The 50% threshold for "severe" is intentionally tighter than the 60%
  // detection threshold above so the icon doesn't flip back to amber for
  // borderline cases — it requires a genuinely alarming forecast.
  const SEVERE_DROP_THRESHOLD_PERCENT = 50;
  const worstDropPercent = hasLowVolumeWeeks
    ? Math.max(
        ...lowVolumeWeeks.map((w) =>
          historicalAverage > 0
            ? Math.round(((historicalAverage - w.totalSandwiches) / historicalAverage) * 100)
            : 0,
        ),
      )
    : 0;
  const severity: 'healthy' | 'watch' | 'severe' = !hasLowVolumeWeeks
    ? 'healthy'
    : worstDropPercent >= SEVERE_DROP_THRESHOLD_PERCENT
      ? 'severe'
      : 'watch';
  const percentBelow = urgentWeek ? Math.round((shortfall / historicalAverage) * 100) : 0;

  // Current week data
  const currentWeek = weekForecasts.find(w => w.isCurrentWeek);
  const currentWeekProgress = currentWeek && currentWeek.totalSandwiches > 0
    ? Math.min(100, Math.round((currentWeek.actualSandwiches || 0) / currentWeek.totalSandwiches * 100))
    : 0;

  // Card chrome driven by severity tier — see the comment block above.
  const cardClassName =
    severity === 'severe'
      ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800'
      : 'border-gray-200 dark:border-gray-700';

  return (
    <Card className={cardClassName}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {severity === 'severe' ? (
            <>
              <AlertTriangle className="h-5 w-5 text-amber-600" aria-label="Action needed" />
              <span className="text-amber-800 dark:text-amber-200">Group Event Forecast</span>
              <Badge variant="outline" className="text-amber-700 border-amber-400 ml-auto">
                {lowVolumeWeeks.length} {lowVolumeWeeks.length === 1 ? 'low week' : 'low weeks'}
              </Badge>
            </>
          ) : severity === 'watch' ? (
            <>
              {/* Neutral calendar icon for soft dips — there are a couple of
                  light weeks in the forecast, but nothing dire. */}
              <Calendar className="h-5 w-5 text-slate-500" aria-label="Forecast" />
              <span>Group Event Forecast</span>
              <Badge variant="outline" className="text-slate-600 border-slate-300 ml-auto">
                {lowVolumeWeeks.length} {lowVolumeWeeks.length === 1 ? 'lighter week' : 'lighter weeks'}
              </Badge>
            </>
          ) : (
            <>
              <TrendingUp className="h-5 w-5 text-green-600" aria-label="On track" />
              <span>Group Event Forecast</span>
              <Badge variant="outline" className="text-green-700 border-green-400 ml-auto">
                On track
              </Badge>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Week-by-week breakdown */}
        <div className="grid gap-2 sm:grid-cols-4">
          {weekForecasts.map((week, index) => {
            const isLow = !week.isCurrentWeek && lowVolumeWeeks.some(lw => lw.weekStart.getTime() === week.weekStart.getTime());
            const isClickable = !!onNavigateToWeek;
            return (
              <div
                key={index}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={isClickable ? () => onNavigateToWeek(index) : undefined}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onNavigateToWeek(index);
                        }
                      }
                    : undefined
                }
                className={`p-3 rounded-lg border ${
                  week.isCurrentWeek
                    ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700'
                    : isLow
                      ? 'bg-amber-100 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700'
                      : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'
                } ${isClickable ? 'cursor-pointer transition-shadow hover:shadow-md hover:border-[#236383]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#236383]' : ''}`}
                title={isClickable ? `View ${week.weekLabel} events in Event Requests` : undefined}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-medium text-sm ${week.isCurrentWeek ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    {week.weekLabel}
                  </span>
                  {isLow && <TrendingDown className="w-4 h-4 text-amber-600" />}
                  {week.isCurrentWeek && currentWeekProgress >= 100 && (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  )}
                </div>
                <div className="text-xs text-gray-500 mb-1">
                  {formatWeekRange(week.weekStart, week.weekEnd)}
                </div>

                {week.isCurrentWeek ? (
                  <>
                    <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                      {(week.actualSandwiches || 0).toLocaleString()}
                      <span className="text-sm font-normal text-gray-500"> / {week.totalSandwiches.toLocaleString()}</span>
                    </div>
                    {/* Taller bar with a clearly-tinted "container to fill" so the
                        forecast reads as a progress bar even at 0% — a 1.5px
                        hairline on a faint track was invisible when empty. */}
                    <Progress
                      value={currentWeekProgress}
                      className="h-2.5 mt-1.5 bg-blue-100 dark:bg-blue-950/40"
                    />
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 font-medium">
                      {currentWeekProgress === 0
                        ? 'Collecting toward this week’s goal'
                        : `${currentWeekProgress}% collected`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`text-lg font-bold ${isLow ? 'text-amber-700 dark:text-amber-300' : ''}`}>
                      {week.totalSandwiches.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {week.eventCount} event{week.eventCount !== 1 ? 's' : ''}
                      {isClickable && (
                        <ChevronRight className="w-3 h-3 ml-auto text-[#236383]" aria-hidden="true" />
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Context: Historical average */}
        <div className="text-xs text-gray-500 text-center">
          Weekly average from group events: <span className="font-medium">{historicalAverage.toLocaleString()}</span> sandwiches
        </div>

        {/* Alert message — only the SEVERE tier gets the amber "Heads up"
            block, since that's a genuine call-to-action moment. The watch
            tier surfaces a calmer slate-toned note so users see the soft
            dip but don't get the fire-alarm treatment for it. */}
        {hasLowVolumeWeeks && urgentWeek && (() => {
          // Calculate the Friday before the low week (weekStart is Monday, so Friday before is 3 days earlier)
          const calloutDate = new Date(urgentWeek.weekStart);
          calloutDate.setDate(calloutDate.getDate() - 3); // Go back to Friday
          const calloutDateStr = calloutDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          });
          const weekOf = urgentWeek.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          if (severity === 'severe') {
            return (
              <div className="bg-amber-100 dark:bg-amber-900/30 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>Heads up:</strong> The week of{' '}
                  <strong>{weekOf}</strong> is{' '}
                  <strong>{percentBelow}% below</strong> typical volume. Consider a callout for more individual sandwiches by{' '}
                  <strong>{calloutDateStr}</strong>.
                </p>
              </div>
            );
          }
          // Watch tier — calmer note, slate background.
          return (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                The week of <strong>{weekOf}</strong> is forecast slightly below typical volume
                ({percentBelow}% below). Likely fine, but worth a glance.
              </p>
            </div>
          );
        })()}

        {/* Hint — cards drill into Event Requests for that week. */}
        {onNavigateToWeek && (
          <p className="text-xs text-gray-500 text-center">
            Click a week to view its events in Event Requests
          </p>
        )}
      </CardContent>
    </Card>
  );
}
