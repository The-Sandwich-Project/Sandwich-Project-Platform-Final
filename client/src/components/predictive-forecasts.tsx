import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Target,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { SandwichCollection } from '@shared/schema';
import {
  calculateTotalSandwiches,
  parseCollectionDate,
} from '@/lib/analytics-utils';
import { isDateInExcludedWeek } from '@/lib/excluded-weeks';
import { logger } from '@/lib/logger';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

export default function PredictiveForecasts() {
  // Week offset: 0 = current week, -1 = last week, 1 = next week, etc.
  const [weekOffset, setWeekOffset] = useState(0);
  // Month offset: 0 = current month, -1 = last month, 1 = next month, etc.
  const [monthOffset, setMonthOffset] = useState(0);

  const { data: collectionsData } = useQuery<{ collections: SandwichCollection[] }>({
    queryKey: ['/api/sandwich-collections/all'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections?limit=5000');
      if (!response.ok) throw new Error('Failed to fetch collections');
      return response.json();
    },
  });

  // Fetch event requests for scheduled events forecast
  const { data: eventRequests } = useQuery<any[]>({
    queryKey: ['/api/event-requests'],
    queryFn: async () => {
      const response = await fetch('/api/event-requests?all=true');
      if (!response.ok) throw new Error('Failed to fetch event requests');
      return response.json();
    },
  });

  // Fetch weekly monitoring status to check if core hosts have reported
  const { data: weeklyMonitoring } = useQuery<any[]>({
    queryKey: ['/api/monitoring/weekly-status', 0], // 0 = current week
    queryFn: async () => {
      const response = await fetch('/api/monitoring/weekly-status/0');
      if (!response.ok) throw new Error('Failed to fetch weekly monitoring');
      return response.json();
    },
  });

  const collections = collectionsData?.collections || [];

  const forecasts = useMemo(() => {
    if (!collections.length) return null;

    // Check if core hosts have reported for current week (only relevant when weekOffset = 0)
    const coreHostsReported = weeklyMonitoring ?
      weeklyMonitoring.filter((status: any) => status.hasSubmitted).length : 0;
    const totalCoreHosts = weeklyMonitoring ? weeklyMonitoring.length : 8; // Default to 8 expected hosts
    const reportingPercentage = totalCoreHosts > 0 ? (coreHostsReported / totalCoreHosts) * 100 : 100;
    const today = new Date();
    const dow = today.getDay();
    const daysFromFri = (dow + 2) % 7; // Fri=0, Sat=1, ..., Wed=5, Thu=6
    // Hosts collect on Wednesday; reporting happens Wed/Thu. Don't flag before collection day (Wed).
    const isPastCollectionDay = daysFromFri >= 5; // Wed=5, Thu=6
    const hasIncompleteReporting = isPastCollectionDay && reportingPercentage < 80; // Only flag Wed/Thu when <80% reported


    // Helper function for consistent date formatting
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // Calculate the target week based on weekOffset
    // Week runs Friday to Thursday (distribution day)
    const targetWeekStart = new Date(today);
    const dayOfWeek = dow; // 0=Sun, 5=Fri
    const daysFromFriday = daysFromFri; // Days since last Friday
    targetWeekStart.setDate(today.getDate() - daysFromFriday + (weekOffset * 7));
    targetWeekStart.setHours(0, 0, 0, 0);

    const targetWeekEnd = new Date(targetWeekStart);
    targetWeekEnd.setDate(targetWeekStart.getDate() + 6); // Fri + 6 = Thu
    targetWeekEnd.setHours(23, 59, 59, 999);

    // Check if target week is an excluded/holiday week
    const excludedWeekCheck = isDateInExcludedWeek(targetWeekStart);
    const isExcludedWeek = excludedWeekCheck.excluded;
    const excludedWeekReason = excludedWeekCheck.reason || 'Holiday week';

    // Check if target week is complete (past Thursday) or in the future
    const isTargetWeekComplete = today > targetWeekEnd;
    const isTargetWeekFuture = today < targetWeekStart;
    const isCurrentWeek = weekOffset === 0;

    // Calculate the target month based on monthOffset
    const targetMonthDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const targetYear = targetMonthDate.getFullYear();
    const targetMonth = targetMonthDate.getMonth();
    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    // For current month, use actual day. For past months, use last day. For future, use 0.
    let dayOfTargetMonth: number;
    let targetMonthProgress: number;
    if (monthOffset === 0) {
      dayOfTargetMonth = today.getDate();
      targetMonthProgress = dayOfTargetMonth / daysInTargetMonth;
    } else if (monthOffset < 0) {
      dayOfTargetMonth = daysInTargetMonth;
      targetMonthProgress = 1; // 100% complete
    } else {
      dayOfTargetMonth = 0;
      targetMonthProgress = 0; // 0% complete (future month)
    }

    // Get all events this week with relevant statuses
    const allEventsThisWeek = (eventRequests || []).filter((event) => {
      if (!event.desiredEventDate) return false;
      // Include in_process, scheduled, AND completed events for accurate weekly totals
      if (!['in_process', 'scheduled', 'completed'].includes(event.status)) return false;

      const eventDate = new Date(event.desiredEventDate);
      return eventDate >= targetWeekStart && eventDate <= targetWeekEnd;
    });

    // Split events into past (already happened) and future (truly scheduled)
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    const pastEventsThisWeek = allEventsThisWeek.filter((event) => {
      const eventDate = new Date(event.desiredEventDate);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate < todayStart;
    });

    const futureEventsThisWeek = allEventsThisWeek.filter((event) => {
      const eventDate = new Date(event.desiredEventDate);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= todayStart;
    });

    logger.log('🔍 ALL events this week:', allEventsThisWeek.map(e => ({
      org: e.organizationName,
      date: e.desiredEventDate,
      count: e.estimatedSandwichCount,
      status: e.status
    })));
    logger.log('📅 Past events (already happened):', pastEventsThisWeek.length);
    logger.log('📆 Future events (upcoming):', futureEventsThisWeek.length);

    // Calculate totals separately
    const pastEventsTotal = pastEventsThisWeek.reduce(
      (sum, event) => sum + (event.estimatedSandwichCount || 0),
      0
    );

    const scheduledWeeklyTotal = futureEventsThisWeek.reduce(
      (sum, event) => sum + (event.estimatedSandwichCount || 0),
      0
    );

    // For backward compatibility, keep scheduledThisWeek as future events only
    const scheduledThisWeek = futureEventsThisWeek;

    // Get target week collections (already completed AND planned for future dates this week)
    const targetWeekCollections = collections.filter((c) => {
      const date = parseCollectionDate(c.collectionDate);
      return date >= targetWeekStart && date <= targetWeekEnd;
    });

    // Split into completed (past) and planned (future)
    const completedThisWeek = targetWeekCollections.filter((c) => {
      const date = parseCollectionDate(c.collectionDate);
      return date <= today;
    });

    const plannedThisWeek = targetWeekCollections.filter((c) => {
      const date = parseCollectionDate(c.collectionDate);
      return date > today;
    });

    const targetWeekTotal = targetWeekCollections.reduce(
      (sum, c) => sum + calculateTotalSandwiches(c),
      0
    );

    const completedTotal = completedThisWeek.reduce(
      (sum, c) => sum + calculateTotalSandwiches(c),
      0
    );

    const plannedTotal = plannedThisWeek.reduce(
      (sum, c) => sum + calculateTotalSandwiches(c),
      0
    );

    // Get target month data
    const targetMonthCollections = collections.filter((c) => {
      const date = parseCollectionDate(c.collectionDate);
      return date.getMonth() === targetMonth && date.getFullYear() === targetYear;
    });

    const targetMonthTotal = targetMonthCollections.reduce(
      (sum, c) => sum + calculateTotalSandwiches(c),
      0
    );

    // Calculate historical averages
    const weekMap = new Map<string, number>();
    const monthMap = new Map<string, number>();

    collections.forEach((c) => {
      const date = parseCollectionDate(c.collectionDate);

      // Week aggregation (Fri-Thu) - matches Google Sheet and official reporting
      const weekStart = new Date(date);
      const collectionDayOfWeek = date.getDay();
      const daysFromFri = (collectionDayOfWeek + 2) % 7; // Fri=0, Sat=1, ..., Thu=6
      weekStart.setDate(date.getDate() - daysFromFri);
      const weekKey = weekStart.toISOString().split('T')[0];
      const weekCurrent = weekMap.get(weekKey) || 0;
      weekMap.set(weekKey, weekCurrent + calculateTotalSandwiches(c));

      // Month aggregation
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthCurrent = monthMap.get(monthKey) || 0;
      monthMap.set(monthKey, monthCurrent + calculateTotalSandwiches(c));
    });

    const weeklyTotals = Array.from(weekMap.values());
    const monthlyTotals = Array.from(monthMap.values());

    const avgWeekly = weeklyTotals.length > 0
      ? weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length
      : 0;

    const avgMonthly = monthlyTotals.length > 0
      ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length
      : 0;

    // Weekly projection - combine historical pace with scheduled events
    // For Fri-Thu week: Fri=0 days, Sat=1, ..., Thu=6 (matches Google Sheet)
    const todayDayOfWeek = today.getDay();
    const daysElapsedInWeek = (todayDayOfWeek + 2) % 7 + 1; // daysFromFriday + 1 to count today

    // Calculate average collections by day of week for remaining days
    const dayOfWeekTotals = new Map<number, { total: number; count: number }>();
    collections.forEach((c) => {
      const date = parseCollectionDate(c.collectionDate);
      const dow = date.getDay();
      const current = dayOfWeekTotals.get(dow) || { total: 0, count: 0 };
      dayOfWeekTotals.set(dow, {
        total: current.total + calculateTotalSandwiches(c),
        count: current.count + 1,
      });
    });

    // Calculate expected collections for remaining days based on historical averages
    let expectedRemainingDays = 0;
    for (let i = 1; i <= 7 - daysElapsedInWeek; i++) {
      const futureDayOfWeek = (todayDayOfWeek + i) % 7;
      const dayData = dayOfWeekTotals.get(futureDayOfWeek);
      if (dayData && dayData.count > 0) {
        expectedRemainingDays += dayData.total / dayData.count;
      }
    }

    // Baseline expectation for typical Wednesday location collections (~5k) - we never expect all sandwiches from events alone.
    // For current week: add only if Wednesday hasn't passed (Fri-Sat-Sun-Mon-Tue). For future weeks: always include.
    const baselineIndividualExpectation = 5000;
    const wednesdayHasPassed = isCurrentWeek && (dayOfWeek === 3 || dayOfWeek === 4); // Wed=3, Thu=4
    const expectedTypicalWednesday = (isTargetWeekComplete || wednesdayHasPassed) ? 0 : baselineIndividualExpectation;

    // Combined projection: Already collected + Scheduled events + typical Wednesday baseline (when still expected)
    const weeklyProjected = isTargetWeekComplete
      ? targetWeekTotal
      : targetWeekTotal + scheduledWeeklyTotal + expectedTypicalWednesday;

    // Debug logging
    logger.log('=== WEEKLY FORECAST DEBUG ===');
    logger.log('Week range:', formatDate(targetWeekStart), 'to', formatDate(targetWeekEnd));
    logger.log('Week offset:', weekOffset, isTargetWeekComplete ? '(complete)' : isTargetWeekFuture ? '(future)' : '(in progress)');
    logger.log('Today:', today.toLocaleDateString());
    logger.log('Current day of week:', todayDayOfWeek, '(0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)');
    logger.log('---');
    logger.log('Completed this week (past dates):', completedTotal);
    logger.log('Planned collections this week (future dates):', plannedTotal);
    logger.log('Planned collections detail:', plannedThisWeek.map(c => ({
      date: c.collectionDate,
      total: calculateTotalSandwiches(c),
      individual: c.individualSandwiches || 0,
      groups: c.groupCollections || []
    })));
    logger.log('---');
    logger.log('Scheduled events total:', scheduledWeeklyTotal);
    logger.log('Scheduled events count:', scheduledThisWeek.length);
    logger.log('Scheduled events detail:', scheduledThisWeek.map(e => ({
      org: e.organizationName,
      date: e.desiredEventDate,
      count: e.estimatedSandwichCount,
      status: e.status
    })));
    logger.log('---');
    logger.log('Expected remaining individual donations:', Math.round(expectedRemainingDays));
    logger.log('Days elapsed in week:', daysElapsedInWeek);
    logger.log('Days remaining in week:', 7 - daysElapsedInWeek);
    logger.log('---');
    logger.log('📊 TOTAL PROJECTED:', weeklyProjected);
    logger.log('📈 Average weekly:', Math.round(avgWeekly));
    logger.log('Difference:', weeklyProjected - avgWeekly);

    // Also log ALL collections with future dates to help find the missing 2900
    const allFutureCollections = collections.filter((c) => {
      const date = parseCollectionDate(c.collectionDate);
      return date > today;
    }).slice(0, 20); // First 20 to not spam console
    logger.log('---');
    logger.log('🔍 ALL future collections (first 20):', allFutureCollections.map(c => ({
      date: c.collectionDate,
      total: calculateTotalSandwiches(c),
      host: c.hostName || 'Unknown',
      groups: c.groupCollections || []
    })));

    const weeklyVsAvg = avgWeekly > 0 ? ((weeklyProjected - avgWeekly) / avgWeekly) * 100 : 0;
    const weeklyAbsDiff = Math.abs(weeklyProjected - avgWeekly);
    // Within range if difference is 300 or less sandwiches
    const isWeeklyWithinRange = weeklyAbsDiff <= 300;

    // Monthly projection - match weekly logic: recorded + scheduled events + expected individual (~5k per Wed)
    // Past months: use actual. Current/future: add scheduled events + ~5k per remaining Wednesday (don't extrapolate incomplete data).
    const TYPICAL_WEDNESDAY_BASELINE = 5000;
    let monthlyProjected: number;
    if (monthOffset < 0) {
      monthlyProjected = targetMonthTotal;
    } else {
      const monthStart = new Date(targetYear, targetMonth, 1);
      const monthEnd = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
      // Match calendar logic: use getEffectiveEventDate (scheduled wins, falls back to desired), include new/in_process/scheduled/completed
      const futureEventsThisMonth = (eventRequests || []).filter((e: any) => {
        const eventDate = getEffectiveEventDate(e);
        if (!eventDate || !['new', 'in_process', 'scheduled', 'completed'].includes(e.status)) return false;
        const d = new Date(eventDate);
        d.setHours(0, 0, 0, 0);
        return d >= todayStart && d >= monthStart && d <= monthEnd;
      });
      const scheduledMonthTotal = futureEventsThisMonth.reduce(
        (s: number, e: any) => s + (e.actualSandwichCount || e.estimatedSandwichCount || 0),
        0
      );
      let remainingWednesdays = 0;
      const check = new Date(monthStart);
      while (check <= monthEnd) {
        if (check.getDay() === 3) {
          const wedStart = new Date(check);
          wedStart.setHours(0, 0, 0, 0);
          if (wedStart >= todayStart) remainingWednesdays++;
        }
        check.setDate(check.getDate() + 1);
      }
      monthlyProjected = Math.round(
        targetMonthTotal + scheduledMonthTotal + (TYPICAL_WEDNESDAY_BASELINE * remainingWednesdays)
      );
    }
    const monthlyVsAvg = avgMonthly > 0 ? ((monthlyProjected - avgMonthly) / avgMonthly) * 100 : 0;
    const monthlyAbsDiff = Math.abs(monthlyProjected - avgMonthly);
    const isMonthlyWithinRange = monthlyAbsDiff <= 300;

    // Calculate remaining days needed for monthly average
    const monthlyGap = avgMonthly - targetMonthTotal;
    const daysRemainingInMonth = daysInTargetMonth - dayOfTargetMonth;
    const dailyNeeded = daysRemainingInMonth > 0 ? Math.round(monthlyGap / daysRemainingInMonth) : 0;

    // Get recent weekly trend: last 4 COMPLETED weeks (relative to today) + current week projected
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const completedWeeks = Array.from(weekMap.entries())
      .filter(([weekKey]) => {
        const weekFri = new Date(weekKey);
        const weekThu = new Date(weekFri);
        weekThu.setDate(weekFri.getDate() + 6);
        return weekThu < today; // Only weeks that have fully ended
      })
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 4)
      .reverse();

    const trendData = completedWeeks.map(([weekKey, total]) => {
      const weekFri = new Date(weekKey);
      const weekThu = new Date(weekFri);
      weekThu.setDate(weekFri.getDate() + 6);
      const label = `${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${weekThu.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      return { week: label, actual: total, average: avgWeekly };
    });

    // Add current week projection (always last so it rolls forward over time)
    trendData.push({
      week: `This week (${formatDate(targetWeekStart)}–${formatDate(targetWeekEnd)})`,
      actual: weeklyProjected,
      average: avgWeekly,
    });

    // Calculate trend direction from last 3 completed weeks (exclude "This Week")
    const recentThreeWeeks = completedWeeks.slice(-3).map(([, total]) => total);
    const isUptrend = recentThreeWeeks.length >= 2 &&
      recentThreeWeeks[recentThreeWeeks.length - 1] > recentThreeWeeks[0];

    // Format month name for display
    const targetMonthName = targetMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return {
      weekly: {
        current: targetWeekTotal,
        completed: completedTotal,
        planned: plannedTotal,
        projected: weeklyProjected,
        scheduled: scheduledWeeklyTotal,
        scheduledEventCount: scheduledThisWeek.length,
        pastEvents: pastEventsTotal,
        pastEventCount: pastEventsThisWeek.length,
        expectedIndividual: expectedTypicalWednesday,
        average: Math.round(avgWeekly),
        vsAvg: weeklyVsAvg,
        absDiff: weeklyAbsDiff,
        isWithinRange: isWeeklyWithinRange,
        dayOfWeek: todayDayOfWeek,
        daysRemaining: isTargetWeekComplete ? 0 : (isTargetWeekFuture ? 7 : 7 - daysElapsedInWeek),
        isComplete: isTargetWeekComplete,
        isFuture: isTargetWeekFuture,
        isCurrent: isCurrentWeek,
        weekStart: formatDate(targetWeekStart),
        weekEnd: formatDate(targetWeekEnd),
        weekOffset,
        // Host reporting status (only relevant for current week)
        coreHostsReported: isCurrentWeek ? coreHostsReported : 0,
        totalCoreHosts: isCurrentWeek ? totalCoreHosts : 0,
        reportingPercentage: isCurrentWeek ? reportingPercentage : 100,
        hasIncompleteReporting: isCurrentWeek && hasIncompleteReporting,
        // Holiday/excluded week
        isExcludedWeek,
        excludedWeekReason,
      },
      monthly: {
        current: targetMonthTotal,
        projected: monthlyProjected,
        average: Math.round(avgMonthly),
        vsAvg: monthlyVsAvg,
        absDiff: monthlyAbsDiff,
        isWithinRange: isMonthlyWithinRange,
        progress: targetMonthProgress * 100,
        dayOfMonth: dayOfTargetMonth,
        daysInMonth: daysInTargetMonth,
        dailyNeeded: dailyNeeded > 0 ? dailyNeeded : 0,
        gap: monthlyGap > 0 ? monthlyGap : 0,
        monthName: targetMonthName,
        monthOffset,
        isComplete: monthOffset < 0,
        isFuture: monthOffset > 0,
        isCurrent: monthOffset === 0,
      },
      trend: {
        isUptrend,
        data: trendData,
      },
    };
  }, [collections, eventRequests, weeklyMonitoring, weekOffset, monthOffset]);

  if (!forecasts) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading forecast data...</p>
      </div>
    );
  }

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDayName = weekdays[forecasts.weekly.dayOfWeek];

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="min-w-0">
        <h2 className="text-3xl font-bold text-brand-primary">Predictive Forecasts</h2>
        <p className="text-gray-600 mt-2">
          Projections based on current pace and historical patterns • Week runs Fri-Thu
        </p>
      </div>

      {/* Weekly Forecast */}
      <Card className="min-w-0 overflow-hidden border-l-4 border-l-brand-primary">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                Weekly Forecast
                {forecasts.weekly.isExcludedWeek ? (
                  <Badge className="bg-blue-100 text-blue-800 text-xs">
                    {forecasts.weekly.excludedWeekReason}
                  </Badge>
                ) : forecasts.weekly.isComplete ? (
                  <Badge className="bg-gray-100 text-gray-800 text-xs">
                    Complete
                  </Badge>
                ) : forecasts.weekly.isFuture ? (
                  <Badge className="bg-purple-100 text-purple-800 text-xs">
                    Future Week
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                    Week in Progress
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2 min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={() => setWeekOffset(weekOffset - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  {forecasts.weekly.weekStart} - {forecasts.weekly.weekEnd}
                  {forecasts.weekly.isCurrent && ` • Currently ${currentDayName}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setWeekOffset(weekOffset + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {weekOffset !== 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs ml-2"
                    onClick={() => setWeekOffset(0)}
                  >
                    Today
                  </Button>
                )}
              </CardDescription>
            </div>
            <Calendar className="h-8 w-8 text-brand-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 min-w-0">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">
                {forecasts.weekly.isComplete
                  ? 'Week Total (Final)'
                  : forecasts.weekly.isFuture
                    ? 'Planned Collections'
                    : `Week Total (through ${currentDayName})`}
              </p>
              <p className="text-3xl font-bold text-brand-primary">
                {forecasts.weekly.current.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1 italic">From collection log</p>
            </div>
            <div className={`text-center p-4 rounded-lg border-2 ${
              forecasts.weekly.vsAvg >= 10
                ? 'bg-[#236383]/10 border-[#236383]'
                : forecasts.weekly.isWithinRange || forecasts.weekly.vsAvg >= 0
                ? 'bg-brand-primary/10 border-brand-primary'
                : forecasts.weekly.vsAvg >= -10
                ? 'bg-brand-orange/20 border-brand-orange'
                : 'bg-[#A31C41]/10 border-[#A31C41]'
            }`}>
              <p className="text-sm text-gray-600 mb-1">Projected Week Total</p>
              <p className={`text-3xl font-bold ${
                forecasts.weekly.vsAvg >= 10 ? 'text-[#236383]' :
                forecasts.weekly.isWithinRange || forecasts.weekly.vsAvg >= 0 ? 'text-brand-primary' :
                forecasts.weekly.vsAvg >= -10 ? 'text-brand-orange' :
                'text-[#A31C41]'
              }`}>
                {forecasts.weekly.projected.toLocaleString()}
              </p>
              <div className="text-xs text-gray-700 mt-2 space-y-0.5">
                <div>{forecasts.weekly.completed.toLocaleString()} completed collections (past)</div>
                {forecasts.weekly.pastEventCount > 0 && (
                  <div>+ {forecasts.weekly.pastEventCount} past {forecasts.weekly.pastEventCount === 1 ? 'event' : 'events'} ({forecasts.weekly.pastEvents.toLocaleString()})</div>
                )}
                {forecasts.weekly.planned > 0 && (
                  <div>+ {forecasts.weekly.planned.toLocaleString()} planned group collections</div>
                )}
                {forecasts.weekly.scheduledEventCount > 0 && (
                  <div>+ {forecasts.weekly.scheduledEventCount} upcoming {forecasts.weekly.scheduledEventCount === 1 ? 'event' : 'events'} ({forecasts.weekly.scheduled.toLocaleString()})</div>
                )}
                {forecasts.weekly.expectedIndividual > 0 && (
                  <div>+ {forecasts.weekly.expectedIndividual.toLocaleString()} expected individual</div>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2 italic">Collections log + events + historical avg</p>

              {/* Clear status indicator */}
              <div className={`mt-3 px-3 py-2 rounded-md font-semibold text-sm ${
                forecasts.weekly.vsAvg >= 10
                  ? 'bg-[#236383] text-white'
                  : forecasts.weekly.isWithinRange || forecasts.weekly.vsAvg >= 0
                  ? 'bg-brand-primary text-white'
                  : forecasts.weekly.vsAvg >= -10
                  ? 'bg-brand-orange text-white'
                  : 'bg-[#A31C41] text-white'
              }`}>
                {forecasts.weekly.vsAvg >= 10 ? (
                  <>
                    <TrendingUp className="inline h-4 w-4 mr-1" />
                    Exceeding Average (+{Math.round(forecasts.weekly.vsAvg)}%)
                  </>
                ) : forecasts.weekly.isWithinRange || forecasts.weekly.vsAvg >= 0 ? (
                  <>
                    <Target className="inline h-4 w-4 mr-1" />
                    On Track (Within Range)
                  </>
                ) : forecasts.weekly.vsAvg >= -10 ? (
                  <>
                    <AlertCircle className="inline h-4 w-4 mr-1" />
                    Slightly Below Average ({Math.round(forecasts.weekly.vsAvg)}%)
                  </>
                ) : (
                  <>
                    <TrendingDown className="inline h-4 w-4 mr-1" />
                    Significantly Below Average ({Math.round(forecasts.weekly.vsAvg)}%)
                  </>
                )}
              </div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">Weekly Average</p>
              <p className="text-3xl font-bold text-gray-700">
                {forecasts.weekly.average.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1 italic">Historical avg (all weeks)</p>
            </div>
          </div>

          {/* Holiday/Excluded Week Notice - shows instead of action needed */}
          {forecasts.weekly.isExcludedWeek && (
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 flex items-start gap-3">
              <Calendar className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-800">{forecasts.weekly.excludedWeekReason}</p>
                <p className="text-sm text-gray-700 mt-1">
                  This is a scheduled off-week with expected reduced or zero collections.
                  This week is excluded from performance averages and targets.
                </p>
                <p className="text-xs text-gray-500 mt-2 italic">
                  Enjoy the break! Regular collections resume next week.
                </p>
              </div>
            </div>
          )}
          {!forecasts.weekly.isExcludedWeek && forecasts.weekly.vsAvg < -10 && (
            <div className="bg-[#A31C41]/10 border-2 border-[#A31C41] rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-[#A31C41] mt-0.5" />
              <div>
                <p className="font-semibold text-[#A31C41]">Action Needed: Below Weekly Target</p>
                <p className="text-sm text-gray-700 mt-1">
                  Need {Math.round(forecasts.weekly.average - forecasts.weekly.projected).toLocaleString()} more sandwiches this week to reach average weekly performance.
                </p>
              </div>
            </div>
          )}
          {!forecasts.weekly.isExcludedWeek && forecasts.weekly.vsAvg >= -10 && forecasts.weekly.vsAvg < 0 && (
            <div className="bg-brand-orange/10 border-2 border-brand-orange rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-brand-orange mt-0.5" />
              <div>
                <p className="font-semibold text-brand-orange">Slightly Below Weekly Average</p>
                <p className="text-sm text-gray-700 mt-1">
                  {Math.round(forecasts.weekly.average - forecasts.weekly.projected).toLocaleString()} more sandwiches needed this week to meet historical average.
                </p>
              </div>
            </div>
          )}
          {!forecasts.weekly.isExcludedWeek && forecasts.weekly.vsAvg >= 10 && (
            <div className="bg-[#236383]/10 border-2 border-[#236383] rounded-lg p-4 flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-[#236383] mt-0.5" />
              <div>
                <p className="font-semibold text-[#236383]">Excellent Week!</p>
                <p className="text-sm text-gray-700 mt-1">
                  On track to exceed weekly average by {Math.round(forecasts.weekly.projected - forecasts.weekly.average).toLocaleString()} sandwiches.
                </p>
              </div>
            </div>
          )}

          {/* Actionable Suggestions - What to do */}
          <div className="mt-6 bg-brand-teal/10 border-2 border-brand-teal rounded-lg p-4">
            <h4 className="font-semibold text-brand-teal mb-2 flex items-center gap-2">
              <Target className="h-5 w-5" />
              What to do this week
            </h4>
            <div className="space-y-2 text-sm">
              {forecasts.weekly.isExcludedWeek ? (
                <>
                  <p className="text-gray-700">• <strong>Status:</strong> Scheduled off-week ({forecasts.weekly.excludedWeekReason})</p>
                  <p className="text-gray-700">• <strong>Relax:</strong> No collection targets this week - enjoy the holiday!</p>
                  <p className="text-gray-700">• <strong>Planning:</strong> Use this time to prepare for next week's return to regular collections</p>
                </>
              ) : forecasts.weekly.vsAvg >= 10 ? (
                <>
                  <p className="text-gray-700">• <strong>Celebrate:</strong> Share this success with your team and volunteers!</p>
                  <p className="text-gray-700">• <strong>Opportunity:</strong> Document what worked well this week to replicate in future weeks</p>
                </>
              ) : forecasts.weekly.isWithinRange && forecasts.weekly.vsAvg >= 0 ? (
                <>
                  <p className="text-gray-700">• <strong>Status:</strong> On track! Maintain current momentum</p>
                  <p className="text-gray-700">• <strong>Recommendation:</strong> Continue regular host check-ins and event coordination</p>
                </>
              ) : forecasts.weekly.vsAvg >= -10 && forecasts.weekly.vsAvg < 0 ? (
                <>
                  <p className="text-gray-700">• <strong>Action:</strong> Light outreach to individual volunteers could close the gap</p>
                  <p className="text-gray-700">• <strong>Target:</strong> {Math.round(forecasts.weekly.average - forecasts.weekly.projected)} more sandwiches needed this week</p>
                </>
              ) : (
                <>
                  <p className="text-gray-700">• <strong>Priority:</strong> Add one more collection event or send out volunteer reminder for {forecasts.weekly.daysRemaining} remaining {forecasts.weekly.daysRemaining === 1 ? 'day' : 'days'}</p>
                  {forecasts.weekly.daysRemaining > 0 ? (
                    <p className="text-gray-700">• <strong>Goal:</strong> Recruit ~{Math.round((forecasts.weekly.average - forecasts.weekly.projected) / forecasts.weekly.daysRemaining)} sandwiches/day for remaining {forecasts.weekly.daysRemaining} {forecasts.weekly.daysRemaining === 1 ? 'day' : 'days'}</p>
                  ) : (
                    <p className="text-gray-700">• <strong>Goal:</strong> Final push needed today - {Math.round(forecasts.weekly.average - forecasts.weekly.projected)} sandwiches to reach weekly average</p>
                  )}
                </>
              )}
              {!forecasts.weekly.isExcludedWeek && (
                <>
                  {forecasts.weekly.pastEventCount > 0 && (
                    <p className="text-gray-700">• <strong>Past events this week:</strong> {forecasts.weekly.pastEventCount} {forecasts.weekly.pastEventCount === 1 ? 'event' : 'events'} for {forecasts.weekly.pastEvents.toLocaleString()} sandwiches</p>
                  )}
                  <p className="text-gray-700">• <strong>Upcoming events:</strong> {forecasts.weekly.scheduledEventCount} {forecasts.weekly.scheduledEventCount === 1 ? 'event' : 'events'} for {forecasts.weekly.scheduled.toLocaleString()} sandwiches</p>
                  <p className="text-gray-700">• <strong>Expected individual collections:</strong> ~{forecasts.weekly.expectedIndividual.toLocaleString()} sandwiches from regular donors</p>
                </>
              )}
            </div>
          </div>

          {/* Host Reporting Warning - hide during excluded weeks */}
          {!forecasts.weekly.isExcludedWeek && forecasts.weekly.hasIncompleteReporting && forecasts.weekly.vsAvg < 0 && (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-semibold text-yellow-800">Incomplete Host Reporting</p>
                <p className="text-sm text-gray-700 mt-1">
                  Only {forecasts.weekly.coreHostsReported} of {forecasts.weekly.totalCoreHosts} core hosts ({Math.round(forecasts.weekly.reportingPercentage)}%) have reported this week.
                  Low count may be due to missing data rather than actual performance issues.
                </p>
                <p className="text-xs text-gray-600 mt-2 italic">
                  Check the Weekly Monitoring dashboard to see which hosts haven't reported yet.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Forecast */}
      <Card className="min-w-0 overflow-hidden border-l-4 border-l-brand-teal">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                Monthly Forecast
                {forecasts.monthly.isComplete ? (
                  <Badge className="bg-gray-100 text-gray-800 text-xs">
                    Complete
                  </Badge>
                ) : forecasts.monthly.isFuture ? (
                  <Badge className="bg-purple-100 text-purple-800 text-xs">
                    Future Month
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                    Month in Progress
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2 min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={() => setMonthOffset(monthOffset - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  {forecasts.monthly.monthName}
                  {forecasts.monthly.isCurrent && ` • Day ${forecasts.monthly.dayOfMonth} of ${forecasts.monthly.daysInMonth}`}
                  {!forecasts.monthly.isCurrent && forecasts.monthly.isComplete && ` • ${forecasts.monthly.daysInMonth} days`}
                  {` (${Math.round(forecasts.monthly.progress)}% complete)`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setMonthOffset(monthOffset + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {monthOffset !== 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs ml-2"
                    onClick={() => setMonthOffset(0)}
                  >
                    This Month
                  </Button>
                )}
              </CardDescription>
            </div>
            <Target className="h-8 w-8 text-brand-teal" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Month Progress</span>
              <span className="text-sm font-semibold text-brand-primary">
                Day {forecasts.monthly.dayOfMonth} of {forecasts.monthly.daysInMonth}
              </span>
            </div>
            <Progress value={forecasts.monthly.progress} className="h-3" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 min-w-0">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">
                {forecasts.monthly.isComplete
                  ? 'Month Total (Final)'
                  : forecasts.monthly.isFuture
                    ? 'Planned Collections'
                    : 'Month Total (So Far)'}
              </p>
              <p className="text-3xl font-bold text-brand-primary">
                {forecasts.monthly.current.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1 italic">From collection log</p>
            </div>
            <div className={`text-center p-4 rounded-lg border-2 ${
              forecasts.monthly.vsAvg >= 10
                ? 'bg-[#236383]/10 border-[#236383]'
                : forecasts.monthly.isWithinRange || forecasts.monthly.vsAvg >= 0
                ? 'bg-brand-teal/10 border-brand-teal'
                : forecasts.monthly.vsAvg >= -10
                ? 'bg-brand-orange/20 border-brand-orange'
                : 'bg-[#A31C41]/10 border-[#A31C41]'
            }`}>
              <p className="text-sm text-gray-600 mb-1">Projected Month Total</p>
              <p className={`text-3xl font-bold ${
                forecasts.monthly.vsAvg >= 10 ? 'text-[#236383]' :
                forecasts.monthly.isWithinRange || forecasts.monthly.vsAvg >= 0 ? 'text-brand-teal' :
                forecasts.monthly.vsAvg >= -10 ? 'text-brand-orange' :
                'text-[#A31C41]'
              }`}>
                {forecasts.monthly.projected.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-2 italic">Recorded + scheduled events + ~5k per remaining Wed</p>

              {/* Clear status indicator */}
              <div className={`mt-3 px-3 py-2 rounded-md font-semibold text-sm ${
                forecasts.monthly.vsAvg >= 10
                  ? 'bg-[#236383] text-white'
                  : forecasts.monthly.isWithinRange || forecasts.monthly.vsAvg >= 0
                  ? 'bg-brand-teal text-white'
                  : forecasts.monthly.vsAvg >= -10
                  ? 'bg-brand-orange text-white'
                  : 'bg-[#A31C41] text-white'
              }`}>
                {forecasts.monthly.vsAvg >= 10 ? (
                  <>
                    <TrendingUp className="inline h-4 w-4 mr-1" />
                    Exceeding Average (+{Math.round(forecasts.monthly.vsAvg)}%)
                  </>
                ) : forecasts.monthly.isWithinRange || forecasts.monthly.vsAvg >= 0 ? (
                  <>
                    <Target className="inline h-4 w-4 mr-1" />
                    On Track (Within Range)
                  </>
                ) : forecasts.monthly.vsAvg >= -10 ? (
                  <>
                    <AlertCircle className="inline h-4 w-4 mr-1" />
                    Slightly Below Average ({Math.round(forecasts.monthly.vsAvg)}%)
                  </>
                ) : (
                  <>
                    <TrendingDown className="inline h-4 w-4 mr-1" />
                    Significantly Below Average ({Math.round(forecasts.monthly.vsAvg)}%)
                  </>
                )}
              </div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">Monthly Average</p>
              <p className="text-3xl font-bold text-gray-700">
                {forecasts.monthly.average.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1 italic">Historical avg (all months)</p>
            </div>
          </div>

          {forecasts.monthly.gap > 0 && (
            <div className="bg-brand-primary/10 border-2 border-brand-primary rounded-lg p-4">
              <p className="font-semibold text-brand-primary mb-2">Path to Monthly Average</p>
              <p className="text-sm text-gray-700">
                Need {forecasts.monthly.gap.toLocaleString()} more sandwiches over the remaining{' '}
                {forecasts.monthly.daysInMonth - forecasts.monthly.dayOfMonth} days to reach monthly average.
              </p>
              {(forecasts.monthly.daysInMonth - forecasts.monthly.dayOfMonth) > 0 ? (
                <p className="text-sm text-gray-700 mt-1">
                  <span className="font-semibold">Weekly target: </span>
                  ~{Math.round((forecasts.monthly.gap / (forecasts.monthly.daysInMonth - forecasts.monthly.dayOfMonth)) * 7).toLocaleString()} sandwiches/week for remaining weeks
                </p>
              ) : (
                <p className="text-sm text-gray-700 mt-1">
                  <span className="font-semibold">Final day: </span>
                  Collection period ends today - results finalize tomorrow
                </p>
              )}
            </div>
          )}

          {/* Monthly Actionable Suggestions */}
          <div className="mt-6 bg-brand-orange/10 border-2 border-brand-orange rounded-lg p-4">
            <h4 className="font-semibold text-brand-orange mb-2 flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              What to do this month
            </h4>
            <div className="space-y-2 text-sm">
              {forecasts.monthly.vsAvg >= 10 ? (
                <>
                  <p className="text-gray-700">• <strong>Celebrate:</strong> Exceeding monthly average - great momentum!</p>
                  <p className="text-gray-700">• <strong>Opportunity:</strong> Use this success to recruit new hosts and volunteers</p>
                  <p className="text-gray-700">• <strong>Planning:</strong> Start recruiting for next month's events now</p>
                </>
              ) : forecasts.monthly.vsAvg < 0 && forecasts.monthly.gap > 0 ? (
                <>
                  <p className="text-gray-700">• <strong>Priority:</strong> Schedule additional events to close the {forecasts.monthly.gap.toLocaleString()}-sandwich gap</p>
                  {(forecasts.monthly.daysInMonth - forecasts.monthly.dayOfMonth) > 0 ? (
                    <p className="text-gray-700">• <strong>Target:</strong> Aim for {Math.round((forecasts.monthly.gap / (forecasts.monthly.daysInMonth - forecasts.monthly.dayOfMonth)) * 7).toLocaleString()} sandwiches per remaining week</p>
                  ) : (
                    <p className="text-gray-700">• <strong>Target:</strong> Final day - need {forecasts.monthly.gap.toLocaleString()} sandwiches to reach monthly average</p>
                  )}
                  <p className="text-gray-700">• <strong>Strategy:</strong> Focus on high-volume group collections and event partnerships</p>
                </>
              ) : (
                <>
                  <p className="text-gray-700">• <strong>Status:</strong> Monthly goals on track!</p>
                  <p className="text-gray-700">• <strong>Recommendation:</strong> Maintain current collection pace and event schedule</p>
                  <p className="text-gray-700">• <strong>Planning:</strong> Start recruiting for next month's events now</p>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trend Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Weekly Trend Analysis
          </CardTitle>
          <CardDescription>
            Recent performance vs. historical average
            {forecasts.trend.isUptrend && (
              <Badge className="ml-2 bg-green-100 text-green-800">Upward Trend</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecasts.trend.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(1)}K`} />
                <Tooltip
                  formatter={(value: number) => value.toLocaleString()}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #ccc' }}
                />
                <ReferenceLine
                  y={forecasts.weekly.average}
                  stroke="#666"
                  strokeDasharray="3 3"
                  label="Average"
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="var(--color-brand-primary)"
                  strokeWidth={3}
                  dot={{ fill: 'var(--color-brand-primary)', r: 5 }}
                  name="Actual"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
