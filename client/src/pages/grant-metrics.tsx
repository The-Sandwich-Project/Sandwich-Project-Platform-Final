import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { isInExcludedWeek } from '@/lib/excluded-weeks';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  TrendingUp,
  Heart,
  Users,
  Calendar,
  Award,
  Trophy,
  Target,
  MapPin,
  Clock,
  Zap,
  Star,
  BarChart3,
  Building2,
  Shield,
  DollarSign,
  Rocket,
  AlertTriangle,
  Download,
  FileText,
  HandHeart,
  PieChartIcon,
  Activity,
  Briefcase,
  Sandwich,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { calculateTotalSandwiches, calculateGroupSandwiches, parseCollectionDate } from '@/lib/analytics-utils';
import {
  GROUP_SANDWICHES_PER_ENGAGEMENT_CENTRAL,
  GROUP_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND,
  GROUP_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND,
  INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_CENTRAL,
  INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND,
  INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND,
  SANDWICHES_PER_ACTIVE_VOLUNTEER_HOUR,
  VOLUNTEER_ENGAGEMENT_METHODOLOGY_NOTE,
  VOLUNTEER_HOURS_METHODOLOGY_NOTE,
  calculateVolunteerEconomicValueUsd,
  estimateVolunteerEngagement,
  roundEngagementsForDisplay,
} from '@shared/volunteer-engagement-metrics';
import { getRegionFromCoordinates } from '@/lib/atlanta-regions';
import { normalizeFocusArea, sortFocusAreaEntries } from '@/lib/focus-area-groups';
import { logger } from '@/lib/logger';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

// =====================================================================
// EXTERNAL REFERENCE FIGURES — update annually before grant submissions.
// These are used in dollar-value and inflation callouts on this page.
//
// Both come from external sources that publish on their own cadence;
// neither updates automatically. When either source publishes a new
// figure, update the constant AND the YEAR/AS_OF label so the page
// citation stays honest.
// =====================================================================

/**
 * Independent Sector's "Value of Volunteer Time" — informally called the
 * "IRS volunteer rate." Used to compute the dollar value of volunteer
 * hours for grant reporting.
 *
 * Source: Independent Sector (https://independentsector.org/value-of-volunteer-time/)
 * Effective for: 2025
 * Announced: 2026-04-21
 * Previous value: $33.49 (2024 rate)
 *
 * NEXT UPDATE: Independent Sector typically announces the new annual
 * figure each April. Check independentsector.org and bump this constant
 * + the year label below.
 */
const IRS_VOLUNTEER_RATE_USD_PER_HOUR = 36.14;
const IRS_VOLUNTEER_RATE_YEAR = 2025;

/**
 * Cumulative food price inflation (Consumer Price Index — Food) since
 * early 2022. Used on the "Growth Despite Rising Costs" callout card.
 *
 * Source: Bureau of Labor Statistics CPI Food index
 *         (https://www.bls.gov/cpi/) — May 2026 release
 * As of: 2026-05
 * Methodology: CPI Food index moved from ~282 (Jan 2022) to 349.0
 *              (May 2026) — roughly +24% cumulative using a January
 *              2022 baseline. (A 2022-annual-average baseline yields
 *              closer to +14%; we use the early-2022 baseline.)
 * Previous value: +26%
 *
 * NEXT UPDATE: BLS releases monthly. Refresh quarterly or before
 * any grant submission that cites this figure.
 */
const FOOD_CPI_INFLATION_PCT_SINCE_2022 = 24;
const FOOD_CPI_AS_OF_LABEL = 'BLS CPI Food index, May 2026';

export default function GrantMetrics() {
  const { trackView } = useActivityTracker();
  const [yearType, setYearType] = useState<'fiscal' | 'calendar'>(() => {
    const saved = localStorage.getItem('grantMetricsYearType');
    return (saved === 'fiscal' || saved === 'calendar') ? saved : 'fiscal';
  });
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>('all');
  const [selectedQuarter, setSelectedQuarter] = useState<string>('all');

  // Persist yearType to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('grantMetricsYearType', yearType);
  }, [yearType]);

  useEffect(() => {
    trackView(
      'Analytics',
      'Analytics',
      'Grant Metrics',
      'User accessed grant metrics page'
    );
  }, [trackView]);

  // Fetch collections data - use high limit to ensure we get all records.
  // staleTime kept short so the hero numbers reflect recent additions without
  // making users wait through a long cache window. 30s trades a little extra
  // refetch bandwidth for "looks fresh when you come back to the tab."
  const { data: collectionsData } = useQuery({
    queryKey: ['/api/sandwich-collections'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections?page=1&limit=10000', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch collections');
      return response.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  const collections = collectionsData?.collections || [];
  const totalCollectionsInDB = collectionsData?.pagination?.total || 0;

  // WARNING: Check if we're hitting the limit
  if (collections.length >= 10000) {
    logger.warn('⚠️ HITTING API LIMIT: Received 10,000 collections but there may be more in the database!');
    logger.warn('Total in DB:', totalCollectionsInDB);
  }

  if (typeof window !== "undefined") {
    (window as any).__collections = collections;
  }

  // Note: hybridStats removed - collection log is the source of truth
  // Scott's Excel was a reference that stopped being updated in August 2025

  // Fetch stats — short staleTime so hero totals stay fresh (see comment above).
  const { data: stats } = useQuery<{ uniqueGroups?: number }>({
    queryKey: ['/api/sandwich-collections/stats'],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  // Fetch recipients data
  const { data: recipientsData } = useQuery({
    queryKey: ['/api/recipients'],
    queryFn: async () => {
      const response = await fetch('/api/recipients', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch recipients');
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

  // Fetch event requests data (completed events)
  const { data: eventRequestsData } = useQuery({
    queryKey: ['/api/event-requests'],
    queryFn: async () => {
      const response = await fetch('/api/event-requests', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch event requests');
      return response.json();
    },
    staleTime: 60000,
  });

  // Hardcoded host count (35 active host homes)
  const totalHosts = 35;

  // Process recipients data
  const recipients = recipientsData || [];
  const activeRecipients = recipients.filter((r: any) => r.status === 'active');

  // Process event requests data
  const eventRequests = eventRequestsData || [];
  const completedEvents = eventRequests.filter((e: any) => e.status === 'completed');

  // Calculate REAL recipient metrics
  // Region: derived from geocoded coordinates when available; falls back to manual region field otherwise
  const calculateRecipientMetrics = () => {
    const byFocusArea: Record<string, number> = {};
    const byRegion: Record<string, number> = {};

    activeRecipients.forEach((r: any) => {
      const areas =
        Array.isArray(r.focusAreas) && r.focusAreas.length > 0
          ? r.focusAreas
          : r.focusArea
            ? [r.focusArea]
            : [];
      areas.forEach((area: string) => {
        const trimmed = area?.trim?.();
        if (trimmed) {
          const canonical = normalizeFocusArea(trimmed);
          if (canonical) {
            byFocusArea[canonical] = (byFocusArea[canonical] || 0) + 1;
          }
        }
      });
      // Use geocoded location only — derive region from coordinates; never use manual region (informal values like "Dunwoody (Karen)" deprecated)
      const region =
        r.latitude && r.longitude
          ? getRegionFromCoordinates(r.latitude, r.longitude)
          : 'Not geocoded';
      byRegion[region] = (byRegion[region] || 0) + 1;
    });

    const totalWeeklyCapacity = activeRecipients.reduce(
      (sum: number, r: any) => sum + (r.weeklyEstimate || r.estimatedSandwiches || 0),
      0
    );

    const contractsSigned = activeRecipients.filter((r: any) => r.contractSigned).length;

    return {
      total: activeRecipients.length,
      byFocusArea,
      byRegion,
      totalWeeklyCapacity,
      contractsSigned,
      contractSignedPercentage: activeRecipients.length > 0
        ? Math.round((contractsSigned / activeRecipients.length) * 100)
        : 0,
    };
  };

  // Calculate REAL event participation metrics from event requests
  const calculateEventMetrics = () => {
    // Filter for events within selected time period if applicable
    let eventsToAnalyze = completedEvents;

    if (selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      eventsToAnalyze = eventsToAnalyze.filter((e: any) => {
        if (!e.scheduledEventDate && !e.desiredEventDate) return false;
        const eventDate = new Date(getEffectiveEventDate(e));
        if (Number.isNaN(eventDate.getTime())) return false;

        const year = eventDate.getFullYear();
        const month = eventDate.getMonth();

        if (yearType === 'fiscal') {
          // Fiscal year logic: July-June
          if (month >= 6) { // July-December
            return year === selectedYear;
          } else { // January-June
            return year === selectedYear + 1;
          }
        } else {
          // Calendar year logic: January-December
          return year === selectedYear;
        }
      });
    }

    const totalEvents = eventsToAnalyze.length;
    const eventRequestSandwiches = eventsToAnalyze.reduce(
      (sum: number, e: any) => sum + (e.actualSandwichCount || e.estimatedSandwichCount || 0),
      0
    );

    // Include historical "Groups" location data NOT linked to event requests
    // These are from when group collections were classified as a "location" rather than events
    let historicalGroupsToAnalyze = collections.filter((c: any) => 
      c.hostName === 'Groups' && !c.eventRequestId
    );

    // Apply same year filtering to historical collections
    if (selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      historicalGroupsToAnalyze = historicalGroupsToAnalyze.filter((c: any) => {
        if (!c.collectionDate) return false;
        const date = parseCollectionDate(c.collectionDate);
        if (Number.isNaN(date.getTime())) return false;
        const year = date.getFullYear();
        const month = date.getMonth();

        if (yearType === 'fiscal') {
          if (month >= 6) return year === selectedYear;
          else return year === selectedYear + 1;
        } else {
          return year === selectedYear;
        }
      });
    }

    const historicalGroupSandwiches = historicalGroupsToAnalyze.reduce(
      (sum: number, c: any) => sum + calculateGroupSandwiches(c),
      0
    );

    // Total includes both event_requests and historical "Groups" location collections
    const totalActualSandwiches = eventRequestSandwiches + historicalGroupSandwiches;

    logger.log('=== HISTORICAL GROUPS DEBUG ===');
    logger.log('Historical Groups collections (not linked):', historicalGroupsToAnalyze.length);
    logger.log('Historical Groups sandwiches:', historicalGroupSandwiches);
    logger.log('Event request sandwiches:', eventRequestSandwiches);
    logger.log('Combined total:', totalActualSandwiches);

    // Debug logging
    logger.log('=== EVENT METRICS DEBUG ===');
    logger.log('Total completed events:', completedEvents.length);
    logger.log('Events to analyze (after filtering):', eventsToAnalyze.length);
    logger.log('Total sandwiches calculated:', totalActualSandwiches);
    logger.log('Sample events:', eventsToAnalyze.slice(0, 5).map((e: any) => ({
      id: e.id,
      org: e.organizationName,
      actual: e.actualSandwichCount,
      estimated: e.estimatedSandwichCount,
      used: e.actualSandwichCount || e.estimatedSandwichCount || 0
    })));

    // Get unique organizations
    const uniqueOrgs = new Set(
      eventsToAnalyze.map((e: any) => e.organizationName).filter(Boolean)
    );

    // DEBUG: Log unique org count
    logger.log('=== UNIQUE ORGS DEBUG ===');
    logger.log('Completed events total:', completedEvents.length);
    logger.log('Events to analyze:', eventsToAnalyze.length);
    logger.log('Unique organizations count:', uniqueOrgs.size);
    logger.log('First 10 orgs:', Array.from(uniqueOrgs).slice(0, 10));

    return {
      totalEvents,
      totalActualSandwiches,
      uniqueOrganizations: uniqueOrgs.size,
      avgSandwichesPerEvent: totalEvents > 0 ? Math.round(totalActualSandwiches / totalEvents) : 0,
    };
  };

  const recipientMetrics = calculateRecipientMetrics();
  const eventMetrics = calculateEventMetrics();

  // Filter collections by fiscal/calendar year and quarter
  const getFilteredCollections = () => {
    if (!Array.isArray(collections)) return [];

    let filtered = collections;

    if (selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      filtered = filtered.filter((c: any) => {
        if (!c.collectionDate) return false;
        const date = parseCollectionDate(c.collectionDate);
        if (Number.isNaN(date.getTime())) return false;
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11

        if (yearType === 'fiscal') {
          // Fiscal year runs July 1 - June 30
          if (month >= 6) { // July-December
            return year === selectedYear;
          } else { // January-June
            return year === selectedYear + 1;
          }
        } else {
          // Calendar year runs January 1 - December 31
          return year === selectedYear;
        }
      });
    }

    if (selectedQuarter !== 'all' && selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      const quarter = parseInt(selectedQuarter);
      filtered = filtered.filter((c: any) => {
        if (!c.collectionDate) return false;
        const date = parseCollectionDate(c.collectionDate);
        if (Number.isNaN(date.getTime())) return false;
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11

        let collectionQuarter = 0;
        let collectionYear = year;

        if (yearType === 'fiscal') {
          // Fiscal quarters: Q1: July-Sept, Q2: Oct-Dec, Q3: Jan-Mar, Q4: Apr-Jun
          if (month >= 6 && month <= 8) { // July-Sept
            collectionQuarter = 1;
          } else if (month >= 9 && month <= 11) { // Oct-Dec
            collectionQuarter = 2;
          } else if (month >= 0 && month <= 2) { // Jan-Mar
            collectionQuarter = 3;
            collectionYear = year - 1;
          } else { // Apr-Jun
            collectionQuarter = 4;
            collectionYear = year - 1;
          }
        } else {
          // Calendar quarters: Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
          if (month >= 0 && month <= 2) { // Jan-Mar
            collectionQuarter = 1;
          } else if (month >= 3 && month <= 5) { // Apr-Jun
            collectionQuarter = 2;
          } else if (month >= 6 && month <= 8) { // Jul-Sep
            collectionQuarter = 3;
          } else { // Oct-Dec
            collectionQuarter = 4;
          }
        }

        return collectionYear === selectedYear && collectionQuarter === quarter;
      });
    }

    return filtered;
  };

  const filteredCollections = getFilteredCollections();

  /** Completed group events in the selected reporting period (same filters as collections). */
  const getFilteredCompletedGroupEvents = (): number => {
    let eventsToAnalyze = completedEvents;

    if (selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      eventsToAnalyze = eventsToAnalyze.filter((e: any) => {
        if (!e.scheduledEventDate && !e.desiredEventDate) return false;
        const eventDate = new Date(getEffectiveEventDate(e));
        if (Number.isNaN(eventDate.getTime())) return false;

        const year = eventDate.getFullYear();
        const month = eventDate.getMonth();

        if (yearType === 'fiscal') {
          if (month >= 6) return year === selectedYear;
          return year === selectedYear + 1;
        }
        return year === selectedYear;
      });
    }

    if (selectedQuarter !== 'all' && selectedFiscalYear !== 'all') {
      const selectedYear = parseInt(selectedFiscalYear);
      const quarter = parseInt(selectedQuarter);
      eventsToAnalyze = eventsToAnalyze.filter((e: any) => {
        if (!e.scheduledEventDate && !e.desiredEventDate) return false;
        const eventDate = new Date(getEffectiveEventDate(e));
        if (Number.isNaN(eventDate.getTime())) return false;

        const year = eventDate.getFullYear();
        const month = eventDate.getMonth();

        let eventQuarter = 0;
        let eventYear = year;

        if (yearType === 'fiscal') {
          if (month >= 6 && month <= 8) eventQuarter = 1;
          else if (month >= 9 && month <= 11) eventQuarter = 2;
          else if (month >= 0 && month <= 2) {
            eventQuarter = 3;
            eventYear = year - 1;
          } else {
            eventQuarter = 4;
            eventYear = year - 1;
          }
        } else {
          if (month >= 0 && month <= 2) eventQuarter = 1;
          else if (month >= 3 && month <= 5) eventQuarter = 2;
          else if (month >= 6 && month <= 8) eventQuarter = 3;
          else eventQuarter = 4;
        }

        return eventYear === selectedYear && eventQuarter === quarter;
      });
    }

    return eventsToAnalyze.length;
  };

  const filteredCompletedGroupEvents = getFilteredCompletedGroupEvents();

  /**
   * Estimated volunteer engagements and active volunteer hours for the
   * selected period. Methodology and constants live in
   * `shared/volunteer-engagement-metrics.ts`.
   */
  const calculateVolunteerMetrics = (
    collectionsToAnalyze: any[],
    completedGroupEvents: number
  ) => {
    const totalSandwiches = collectionsToAnalyze.reduce(
      (sum: number, c: any) => sum + calculateTotalSandwiches(c),
      0
    );
    const groupEventSandwiches = collectionsToAnalyze.reduce(
      (sum: number, c: any) => sum + calculateGroupSandwiches(c),
      0
    );

    const estimate = estimateVolunteerEngagement({
      groupSandwiches: groupEventSandwiches,
      individualSandwiches: Math.max(0, totalSandwiches - groupEventSandwiches),
    });

    const economicValue = calculateVolunteerEconomicValueUsd(
      estimate.activeVolunteerHours,
      IRS_VOLUNTEER_RATE_USD_PER_HOUR
    );

    // Active sandwich-making time per engagement — a consequence of the two
    // rate assumptions, not an independent input.
    const avgHoursPerEngagement =
      estimate.centralEngagements > 0
        ? estimate.activeVolunteerHours / estimate.centralEngagements
        : 0;

    return {
      totalSandwiches,
      groupEventSandwiches,
      completedGroupEvents,
      individualSandwiches: estimate.individualSandwiches,

      // Headline figures, rounded for display only.
      estimatedEngagements: roundEngagementsForDisplay(estimate.centralEngagements),
      lowEngagements: roundEngagementsForDisplay(estimate.lowEngagements),
      highEngagements: roundEngagementsForDisplay(estimate.highEngagements),
      activeVolunteerHours: roundEngagementsForDisplay(estimate.activeVolunteerHours),
      /** Unabbreviated hours, for the methodology walkthrough. */
      activeVolunteerHoursExact: Math.round(estimate.activeVolunteerHours),

      // Per-stream detail for the methodology breakdown panels.
      groupEngagements: Math.round(estimate.groupEngagements),
      groupEngagementsLow: Math.round(
        estimate.groupSandwiches / GROUP_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND
      ),
      groupEngagementsHigh: Math.round(
        estimate.groupSandwiches / GROUP_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND
      ),
      individualEngagements: Math.round(estimate.individualEngagements),
      individualEngagementsLow: Math.round(
        estimate.individualSandwiches / INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND
      ),
      individualEngagementsHigh: Math.round(
        estimate.individualSandwiches / INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND
      ),

      economicValue,
      avgHoursPerEngagement,
    };
  };

  // Calculate cost efficiency metrics
  const calculateCostMetrics = (collectionsToAnalyze: any[]) => {
    const totalSandwiches = collectionsToAnalyze.reduce((sum: number, c: any) => sum + calculateTotalSandwiches(c), 0);

    // Per-sandwich ingredient cost estimate using a representative deli
    // baseline. Volunteers choose the exact brands they buy, but a reasonable
    // deli reference is Nature's Own Honey Wheat bread, Kirkland pre-sliced
    // cheddar, and Kirkland pre-sliced deli turkey.
    //
    // PB&J is lower cost, but the collection log does not yet provide a
    // complete deli/PB&J mix for all historical sandwich totals. Until that
    // mix is reliable, grant-facing food value uses the conservative deli
    // baseline rather than pretending the app knows the exact ingredient mix.
    //
    // A meal = 2 sandwiches, so the per-meal cost is 2x.
    const costPerSandwich = 2.00;
    const sandwichesPerMeal = 2;
    const costPerMeal = costPerSandwich * sandwichesPerMeal;
    const totalFoodValue = Math.round(totalSandwiches * costPerSandwich);
    const totalMeals = Math.floor(totalSandwiches / sandwichesPerMeal);

    return {
      totalSandwiches,
      costPerSandwich,
      costPerMeal,
      sandwichesPerMeal,
      totalMeals,
      totalFoodValue,
      // Kept for legacy callers; equals cost per meal (1 person = 1 meal = 2 sandwiches)
      costPerPerson: costPerMeal,
    };
  };

  // Calculate quarterly breakdown
  const getQuarterlyBreakdown = (collectionsToAnalyze: any[]) => {
    const quarterlyData: Record<string, { sandwiches: number; events: number; quarter: string }> = {};

    collectionsToAnalyze.forEach((c: any) => {
      if (!c.collectionDate) return;
      const date = parseCollectionDate(c.collectionDate);
      if (Number.isNaN(date.getTime())) return;

      const year = date.getFullYear();
      const month = date.getMonth();

      let quarter = '';
      let fy = year;

      if (month >= 6 && month <= 8) {
        quarter = `FY${year} Q1 (Jul-Sep)`;
      } else if (month >= 9 && month <= 11) {
        quarter = `FY${year} Q2 (Oct-Dec)`;
      } else if (month >= 0 && month <= 2) {
        fy = year - 1;
        quarter = `FY${fy} Q3 (Jan-Mar)`;
      } else {
        fy = year - 1;
        quarter = `FY${fy} Q4 (Apr-Jun)`;
      }

      if (!quarterlyData[quarter]) {
        quarterlyData[quarter] = { sandwiches: 0, events: 0, quarter };
      }

      quarterlyData[quarter].sandwiches += calculateTotalSandwiches(c);
      quarterlyData[quarter].events += 1;
    });

    return Object.values(quarterlyData).sort((a, b) => a.quarter.localeCompare(b.quarter));
  };

  // Calculate impressive metrics
  const calculateGrantMetrics = () => {
    if (!Array.isArray(collections) || collections.length === 0) {
      return {
        totalSandwiches: 0,
        totalCollections: 0,
        uniqueHosts: 0,
        yearTotals: {} as Record<number, number>,
        peakYear: { year: 2024, total: 0 },
        peakMonth: { month: '', total: 0, year: 0 },
        longestStreak: 0,
        avgPerCollection: 0,
        topHost: { name: '', total: 0 },
        weeklyAverage: 0,
        overallGrowthMultiplier: 0,
        monthlyData: {} as Record<string, number>,
        weeklyData: {} as Record<string, number>,
      };
    }

    const hostData: Record<string, number> = {};
    const monthlyData: Record<string, number> = {};
    const weeklyData: Record<string, number> = {};
    const uniqueHostsSet = new Set<string>();

    // Calculate yearly totals from actual collection log data (source of truth)
    const yearTotals: Record<number, number> = {};

    collections.forEach((collection: any) => {
      const hostName = collection.hostName || 'Unknown';

      const total = calculateTotalSandwiches(collection);

      uniqueHostsSet.add(hostName);
      hostData[hostName] = (hostData[hostName] || 0) + total;

      if (collection.collectionDate) {
        const date = parseCollectionDate(collection.collectionDate);
        if (!Number.isNaN(date.getTime())) {
          const year = date.getFullYear();
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

          // Calculate week key (week starting Monday)
          const monday = new Date(date);
          const day = monday.getDay();
          const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
          monday.setDate(diff);
          monday.setHours(0, 0, 0, 0);
          const weekKey = monday.toISOString().split('T')[0];

          monthlyData[monthKey] = (monthlyData[monthKey] || 0) + total;
          weeklyData[weekKey] = (weeklyData[weekKey] || 0) + total;

          // Always calculate from actual collections (source of truth)
          if (!yearTotals[year]) {
            yearTotals[year] = 0;
          }
          yearTotals[year] += total;
        }
      }
    });

    // Find peak year
    const peakYear = Object.entries(yearTotals)
      .reduce((max, [year, total]) => total > max.total ? { year: parseInt(year), total } : max, { year: 2024, total: 0 });

    // Find peak month
    const peakMonthEntry = Object.entries(monthlyData)
      .reduce((max, [month, total]) => total > max.total ? { month, total } : max, { month: '', total: 0 });

    const [peakYear2, peakMonthNum] = peakMonthEntry.month.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const peakMonth = {
      month: peakMonthEntry.month ? `${monthNames[parseInt(peakMonthNum) - 1]} ${peakYear2}` : '',
      total: peakMonthEntry.total,
      year: parseInt(peakYear2) || 0,
    };

    // Find top host (exclude "Groups" and "Unknown" as they're data collection artifacts)
    const topHostEntry = Object.entries(hostData)
      .filter(([name]) => name !== 'Groups' && name !== 'Unknown')
      .reduce((max, [name, total]) => total > max.total ? { name, total } : max, { name: '', total: 0 });

    // Calculate weekly average from last 4 complete weeks (more representative of current production)
    // Excluding no-collection weeks like Thanksgiving, Christmas, etc.
    const now = new Date();
    const fourWeeksAgo = new Date(now);
    fourWeeksAgo.setDate(now.getDate() - (4 * 7));

    const recentWeeks = Object.entries(weeklyData)
      .filter(([weekKey]) => {
        const weekDate = new Date(weekKey);
        if (weekDate < fourWeeksAgo) return false;
        // Exclude current incomplete week (if weekKey is this week's Monday)
        const thisMonday = new Date(now);
        const dayOfWeek = thisMonday.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        thisMonday.setDate(thisMonday.getDate() - daysFromMonday);
        thisMonday.setHours(0, 0, 0, 0);
        if (weekDate.toISOString().split('T')[0] === thisMonday.toISOString().split('T')[0]) {
          return false; // Skip current incomplete week
        }
        // weekKey is Monday - convert to Wednesday to check exclusion (add 2 days)
        const wednesday = new Date(weekDate);
        wednesday.setDate(weekDate.getDate() + 2);
        const wednesdayStr = `${wednesday.getFullYear()}-${String(wednesday.getMonth() + 1).padStart(2, '0')}-${String(wednesday.getDate()).padStart(2, '0')}`;
        return !isInExcludedWeek(wednesdayStr).excluded;
      })
      .sort(([a], [b]) => b.localeCompare(a)) // Sort by date descending (most recent first)
      .slice(0, 4) // Take the 4 most recent complete weeks
      .map(([, total]) => total);

    const weeklyAverage = recentWeeks.length > 0
      ? Math.round(recentWeeks.reduce((sum, total) => sum + total, 0) / recentWeeks.length)
      : 0;

    // Calculate overall growth multiplier (from earliest year to most recent)
    const years = Object.keys(yearTotals).map(y => parseInt(y)).sort();
    const earliestYear = years[0];
    const latestYear = years[years.length - 1];

    const overallGrowthMultiplier = yearTotals[earliestYear] > 0
      ? Math.round((yearTotals[latestYear] / yearTotals[earliestYear]) * 10) / 10
      : 0;

    // Calculate total sandwiches from the actual data
    const totalSandwiches = Object.values(yearTotals).reduce((sum, total) => sum + total, 0);
    const avgPerCollection = collections.length > 0 ? Math.round(totalSandwiches / collections.length) : 0;

    return {
      totalSandwiches,
      totalCollections: collections.length,
      uniqueHosts: uniqueHostsSet.size,
      yearTotals,
      peakYear,
      peakMonth,
      avgPerCollection,
      topHost: topHostEntry,
      weeklyAverage,
      overallGrowthMultiplier,
      monthlyData,
      weeklyData,
    };
  };

  // Calculate metrics for filtered data (respects fiscal year/quarter selection)
  const filteredVolunteerMetrics = calculateVolunteerMetrics(
    filteredCollections,
    filteredCompletedGroupEvents
  );
  const filteredCostMetrics = calculateCostMetrics(filteredCollections);
  const filteredQuarterlyBreakdown = getQuarterlyBreakdown(filteredCollections);

  // Calculate ALL-TIME metrics for the hero stats and growth charts (always show full history)
  const metrics = calculateGrantMetrics();

  // Derive live week-level metrics from the same weekly aggregates that
  // calculateGrantMetrics already builds (metrics.weeklyData). Reusing the
  // single source keeps the hero numbers in lock-step with the rest of the
  // page — there's no second pass over `collections` that could drift.
  const {
    liveWeeksOfService,
    livePeakWeekTotal,
    livePeakWeekDate,
    liveFirstWeekTotal,
    liveFirstWeekDate,
  } = (() => {
    const weekEntries = Object.entries(metrics.weeklyData);
    let peakKey = '';
    let peakTotal = 0;
    let earliestKey = '';
    for (const [key, total] of weekEntries) {
      if (total > peakTotal) {
        peakTotal = total;
        peakKey = key;
      }
      if (earliestKey === '' || key < earliestKey) {
        earliestKey = key;
      }
    }
    return {
      liveWeeksOfService: weekEntries.length,
      livePeakWeekTotal: peakTotal,
      livePeakWeekDate: peakKey,
      liveFirstWeekTotal: earliestKey ? (metrics.weeklyData[earliestKey] || 0) : 0,
      liveFirstWeekDate: earliestKey,
    };
  })();

  // Format a Monday-keyed week as a human-readable label like "Nov 2023".
  const formatWeekLabel = (mondayKey: string): string => {
    if (!mondayKey) return '';
    const [y, m] = mondayKey.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIdx = parseInt(m, 10) - 1;
    if (Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '';
    return `${monthNames[monthIdx]} ${y}`;
  };

  // Format the peak number for the hero the way grant copy reads it:
  // "10,000+", "12,500+", etc. Round DOWN to the nearest 500 so we never
  // over-state; the "+" keeps the marketing cadence.
  const formatHeroPeakWeek = (n: number): string => {
    if (n <= 0) return '0';
    const rounded = Math.floor(n / 500) * 500;
    return `${rounded.toLocaleString()}+`;
  };
  const liveHeroPeakWeek = formatHeroPeakWeek(livePeakWeekTotal);

  // Pre-format the big total sandwiches number for the hero: "2.5 Million",
  // "750K", "1.2 Million" — matches the marketing voice of the original
  // hardcoded "2.3 Million" while keeping the underlying count live.
  const formatHeroSandwiches = (n: number): string => {
    if (n >= 1_000_000) {
      const millions = n / 1_000_000;
      // One decimal for < 10M (e.g. "2.5 Million"), rounded for larger
      return millions < 10
        ? `${millions.toFixed(1)} Million`
        : `${Math.round(millions)} Million`;
    }
    if (n >= 1_000) {
      return `${Math.round(n / 1_000).toLocaleString()}K`;
    }
    return n.toLocaleString();
  };
  const liveHeroSandwiches = formatHeroSandwiches(metrics.totalSandwiches);

  // Get available years from data (fiscal or calendar)
  const availableFiscalYears = Array.from(
    new Set(
      collections.map((c: any) => {
        if (!c.collectionDate) return null;
        const date = parseCollectionDate(c.collectionDate);
        if (Number.isNaN(date.getTime())) return null;
        const year = date.getFullYear();

        if (yearType === 'fiscal') {
          const month = date.getMonth();
          // If July-Dec, fiscal year starts that year. If Jan-Jun, fiscal year started previous year
          return month >= 6 ? year : year - 1;
        } else {
          // Calendar year - just return the year
          return year;
        }
      }).filter(Boolean)
    )
  ).sort((a: any, b: any) => b - a);

  // Debug 2025 data calculation
  logger.log('=== 2025 DATA DEBUG ===');
  logger.log('Total collections received from API:', collections.length);
  logger.log('Total collections in database (from pagination):', totalCollectionsInDB);
  if (collections.length < totalCollectionsInDB) {
    logger.warn('⚠️ WARNING: Not all collections loaded! Missing', totalCollectionsInDB - collections.length, 'records');
  }

  const year2025Collections = collections.filter((c: any) =>
    c.collectionDate && c.collectionDate.startsWith('2025')
  );

  logger.log('2025 Collections Count:', year2025Collections.length);
  logger.log('2025 Year Total from yearTotals:', metrics.yearTotals[2025]);

  const manual2025Total = year2025Collections.reduce((sum: number, c: any) =>
    sum + calculateTotalSandwiches(c), 0
  );
  logger.log('2025 Manually Calculated Total:', manual2025Total);

  // Check for duplicate IDs in 2025 data
  const allIds = collections.map((c: any) => c.id);
  const duplicateIds = allIds.filter((id: any, index: number) => allIds.indexOf(id) !== index);
  logger.log('Duplicate IDs in ALL collections:', duplicateIds.length > 0 ? duplicateIds : 'None');

  const year2025Ids = year2025Collections.map((c: any) => c.id);
  const duplicate2025Ids = year2025Ids.filter((id: any, index: number) => year2025Ids.indexOf(id) !== index);
  logger.log('Duplicate IDs in 2025:', duplicate2025Ids.length > 0 ? duplicate2025Ids : 'None');

  // Sample some 2025 records to check calculation
  logger.log('Sample 2025 Collections (first 5):', year2025Collections.slice(0, 5).map((c: any) => ({
    id: c.id,
    date: c.collectionDate,
    individual: c.individualSandwiches,
    group1: c.group1Count,
    group2: c.group2Count,
    groupCollections: c.groupCollections,
    calculated: calculateTotalSandwiches(c),
    hostName: c.hostName,
  })));
  logger.log('=======================');

  // Prepare year-over-year chart data - ONLY COMPLETE YEARS
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-11

  // Get all years from data and sort
  const allYears = Object.keys(metrics.yearTotals)
    .map(y => parseInt(y))
    .filter(y => !isNaN(y))
    .sort((a, b) => a - b);

  // Only include complete years (exclude current year if we're not in December yet)
  const completeYears = allYears.filter(year => {
    if (year < currentYear) return true; // Past years are complete
    if (year === currentYear && currentMonth === 11) return true; // Current year in December
    return false; // Don't include incomplete current year
  });
  const latestCompleteYear = completeYears[completeYears.length - 1] || 0;
  const isCurrentYearIncomplete = Boolean(
    latestCompleteYear > 0 &&
    currentYear > latestCompleteYear &&
    metrics.yearTotals[currentYear]
  );

  // Peak year over *completed* years only. metrics.peakYear treats all
  // yearTotals equally and will pick the in-progress year if its YTD total
  // already exceeds prior years — which would make annual callouts
  // ("Food value delivered in 2026", "Sandwiches in 2026 - our best year")
  // compare a partial year against full years. Anywhere we want a year-level
  // peak to *mean* a full year, use this instead.
  const completeYearPeak = completeYears.reduce(
    (max, year) => {
      const total = metrics.yearTotals[year] || 0;
      return total > max.total ? { year, total } : max;
    },
    { year: 0, total: 0 }
  );

  // Prepare chart data from complete years only
  const yearChartData = completeYears.map(year => ({
    year: year.toString(),
    sandwiches: metrics.yearTotals[year] || 0,
  }));

  // Calculate year-over-year growth percentages for annotations
  const yearGrowthData = yearChartData.map((data, index) => {
    if (index === 0) return { ...data, growth: null };
    const prevYear = yearChartData[index - 1];
    const growth = prevYear.sandwiches > 0
      ? Math.round(((data.sandwiches - prevYear.sandwiches) / prevYear.sandwiches) * 100)
      : 0;
    return { ...data, growth };
  });
  const completedGrowthPoints = yearGrowthData.filter(
    (data) => data.growth !== null
  ) as Array<(typeof yearGrowthData)[number] & { growth: number }>;
  const latestGrowthPoint = completedGrowthPoints[completedGrowthPoints.length - 1];
  const averageYoYGrowth = completedGrowthPoints.length > 0
    ? Math.round(
        completedGrowthPoints.reduce((sum, data) => sum + data.growth, 0) / completedGrowthPoints.length
      )
    : null;
  const positiveGrowthYears = completedGrowthPoints.filter(data => data.growth > 0).length;
  const firstCompleteYear = completeYears[0] || 0;

  return (
    <div className="bg-gradient-to-br from-[#E8F4F8] to-[#F0F9FB] p-6 rounded-lg">
      <div className="max-w-7xl mx-auto">
        <PageBreadcrumbs segments={[
          { label: 'Analytics & Reports' },
          { label: 'Grant Metrics' }
        ]} />

        {/* Hero Section - Impact First with Sustainability Story */}
        <div className="mb-8 bg-gradient-to-r from-[#236383] to-[#236383] rounded-2xl p-8 text-white shadow-xl">
          {/* Lead with Impact + Consistency */}
          <div className="text-center mb-8">
            <div className="text-5xl md:text-7xl font-black text-[#fbad3f] mb-2">{liveHeroSandwiches}</div>
            <div className="text-xl md:text-2xl font-semibold text-white/90 mb-2">
              sandwiches delivered across <span className="text-[#fbad3f] font-bold">{liveWeeksOfService.toLocaleString()} weeks of collections</span>
            </div>
            <div className="text-base md:text-lg text-white/70">
              Weekly collections since April 2020 — pausing only for major holidays (Thanksgiving, Christmas/New Year, July 4, Memorial Day, and a small number of other holiday weeks).
            </div>
          </div>

          {/* Key Stats Grid - Capacity First, Then People */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-[#fbad3f]">{liveHeroPeakWeek}</div>
              <div className="text-sm md:text-base text-white/90 mt-1">Peak single-week total (sandwiches)</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-[#fbad3f]">{totalHosts}</div>
              <div className="text-sm md:text-base text-white/90 mt-1">Collection sites across Metro Atlanta</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-[#fbad3f]">4,000+</div>
              <div className="text-sm md:text-base text-white/90 mt-1">Community members in our broader network*</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-[#fbad3f]">{recipientMetrics.total > 0 ? recipientMetrics.total : '—'}</div>
              <div className="text-sm md:text-base text-white/90 mt-1">Active recipient partner organizations</div>
            </div>
          </div>
          <div className="text-xs text-white/60 text-center -mt-4 mb-6 italic">
            *Community network size reflects our private group membership, tracked outside this database. It is a separately maintained audience figure — not a count of measured annual volunteers, and not the same as the estimated volunteer engagements below.
          </div>

          {/* Our Story */}
          <div className="max-w-4xl mx-auto space-y-4 text-center">
            <p className="text-lg md:text-xl leading-relaxed">
              Our journey began in mid-2020, when the COVID-19 pandemic profoundly impacted countless lives.
              Even as the urgency of COVID has eased, housing costs, inflation, and systemic inequities
              force many families into impossible choices between food and other basic needs.
            </p>
            <p className="text-base md:text-lg leading-relaxed text-white/90">
              Through a network of dedicated volunteers, we create and deliver fresh, homemade sandwiches
              to individuals in need. We believe in the transformative power of community, compassion, and kindness —
              and in the fundamental right of every person to access nourishing food.
            </p>
            <p className="text-xl md:text-2xl font-semibold mt-6 text-[#47b3cb]">
              Fighting food insecurity. Fostering a spirit of service. Building a stronger community.
            </p>
          </div>
        </div>

        {/* Header with Filter Controls */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Grant Metrics & Impact Showcase
              </h1>
              <p className="text-lg text-gray-600">
                Highlighting our community impact for donors, grants, and partnerships
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex items-center gap-2"
                onClick={() => window.print()}
              >
                <Download className="w-4 h-4" />
                Export PDF
              </Button>
            </div>
          </div>

          {/* Fiscal Year and Quarter Filters */}
          <Card className="bg-white/80 backdrop-blur border-[#236383]/20">
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4">
                {/* Year Type Toggle */}
                <div className="flex items-center gap-4 pb-3 border-b border-gray-200">
                  <Calendar className="w-5 h-5 text-[#236383]" />
                  <span className="font-semibold text-gray-700">Year Type:</span>
                  <RadioGroup
                    value={yearType}
                    onValueChange={(value: 'fiscal' | 'calendar') => {
                      setYearType(value);
                      setSelectedFiscalYear('all');
                      setSelectedQuarter('all');
                    }}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="fiscal" id="fiscal" />
                      <Label htmlFor="fiscal" className="cursor-pointer">Fiscal Year</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="calendar" id="calendar" />
                      <Label htmlFor="calendar" className="cursor-pointer">Calendar Year</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Year and Quarter Selectors */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <span className="font-semibold text-gray-700">Reporting Period:</span>

                  <div className="flex flex-col sm:flex-row gap-3 flex-1">
                    <Select value={selectedFiscalYear} onValueChange={(value) => {
                      setSelectedFiscalYear(value);
                      if (value === 'all') setSelectedQuarter('all');
                    }}>
                      <SelectTrigger className="w-full sm:w-[200px]">
                        <SelectValue placeholder={yearType === 'fiscal' ? 'Select Fiscal Year' : 'Select Calendar Year'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Years</SelectItem>
                        {availableFiscalYears.map((year: any) => (
                          <SelectItem key={year} value={year.toString()}>
                            {yearType === 'fiscal'
                              ? `FY ${year} (Jul ${year} - Jun ${year + 1})`
                              : `${year}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={selectedQuarter}
                      onValueChange={setSelectedQuarter}
                      disabled={selectedFiscalYear === 'all'}
                    >
                      <SelectTrigger className="w-full sm:w-[200px]">
                        <SelectValue placeholder="Select Quarter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Quarters</SelectItem>
                        {yearType === 'fiscal' ? (
                          <>
                            <SelectItem value="1">Q1 (Jul-Sep)</SelectItem>
                            <SelectItem value="2">Q2 (Oct-Dec)</SelectItem>
                            <SelectItem value="3">Q3 (Jan-Mar)</SelectItem>
                            <SelectItem value="4">Q4 (Apr-Jun)</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="1">Q1 (Jan-Mar)</SelectItem>
                            <SelectItem value="2">Q2 (Apr-Jun)</SelectItem>
                            <SelectItem value="3">Q3 (Jul-Sep)</SelectItem>
                            <SelectItem value="4">Q4 (Oct-Dec)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <Badge variant="outline" className="bg-[#236383]/10 text-[#236383] border-[#236383]/30">
                    {selectedFiscalYear === 'all'
                      ? 'Showing All-Time Data'
                      : selectedQuarter === 'all'
                      ? (yearType === 'fiscal' ? `FY ${selectedFiscalYear}` : `${selectedFiscalYear}`)
                      : (yearType === 'fiscal' ? `FY ${selectedFiscalYear} Q${selectedQuarter}` : `${selectedFiscalYear} Q${selectedQuarter}`)}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Year-over-Year Growth Chart - COMPLETE YEARS ONLY */}
        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <BarChart3 className="w-6 h-6 mr-2 text-brand-primary" />
              Year-Over-Year Impact Growth (Complete Years)
            </CardTitle>
            <CardDescription>
              Demonstrating sustained community impact across completed years {isCurrentYearIncomplete && `(${currentYear} excluded - year in progress)`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={yearChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis dataKey="year" />
                  <YAxis
                    tickFormatter={(value) => value.toLocaleString()}
                    label={{ value: 'Sandwiches', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString(), 'Sandwiches']}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #ccc',
                      borderRadius: '8px',
                      padding: '10px'
                    }}
                  />
                  <Bar dataKey="sandwiches" fill="#236383" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Year-over-Year Growth Summary */}
            <div className="bg-gradient-to-r from-[#E8F4F8] to-white p-5 rounded-lg border border-[#236383]/20">
              <h3 className="font-bold text-gray-900 mb-3">Year-Over-Year Growth Rates</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {yearGrowthData.map((data, index) => (
                  <div key={data.year} className="text-center">
                    <div className="text-lg font-bold text-[#236383]">{data.year}</div>
                    <div className="text-2xl font-black text-gray-900 mb-1">
                      {data.sandwiches.toLocaleString()}
                    </div>
                    {data.growth !== null && (
                      <Badge
                        className={`${
                          data.growth > 0
                            ? 'bg-green-100 text-green-700 border-green-300'
                            : data.growth < 0
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : 'bg-gray-100 text-gray-700 border-gray-300'
                        }`}
                      >
                        {data.growth > 0 ? '+' : ''}{data.growth}% YoY
                      </Badge>
                    )}
                    {index === 0 && (
                      <div className="text-xs text-gray-500 mt-1">Baseline</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border border-[#236383]/20 bg-white">
                <div className="text-sm font-semibold text-gray-600">Peak Month</div>
                <div className="text-2xl font-black text-[#236383]">
                  {metrics.peakMonth.total.toLocaleString()}
                </div>
                <p className="text-xs text-gray-500">
                  {metrics.peakMonth.month || 'No monthly data yet'}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-[#236383]/20 bg-white">
                <div className="text-sm font-semibold text-gray-600">Latest Completed YoY</div>
                <div className="text-2xl font-black text-[#236383]">
                  {latestGrowthPoint ? `${latestGrowthPoint.growth > 0 ? '+' : ''}${latestGrowthPoint.growth}%` : '—'}
                </div>
                <p className="text-xs text-gray-500">
                  {latestGrowthPoint
                    ? `${Number(latestGrowthPoint.year) - 1} to ${latestGrowthPoint.year}`
                    : 'Needs at least two complete years'}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-[#A31C41]/20 bg-white">
                <div className="text-sm font-semibold text-gray-600">Crisis Response</div>
                <div className="text-2xl font-black text-[#A31C41]">14,023</div>
                <p className="text-xs text-gray-500">
                  Hurricane Helene surge, October 2024
                </p>
              </div>
            </div>

            {/* Current Year Status (if incomplete) */}
            {isCurrentYearIncomplete && (
              <div className="mt-4 p-4 bg-gradient-to-r from-[#FEF4E0] to-white rounded-lg border border-[#FBAD3F]/30">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-[#FBAD3F] shrink-0 mt-1" />
                  <div>
                    <h4 className="font-bold text-gray-900 mb-1">{currentYear} In Progress</h4>
                    <p className="text-sm text-gray-700">
                      Current year: <strong>{(metrics.yearTotals[currentYear] || 0).toLocaleString()} sandwiches</strong> so far
                      {completeYears.length > 0 && ` (on pace for ${Math.round((metrics.yearTotals[currentYear] || 0) / ((currentMonth + 1) / 12)).toLocaleString()})`}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      * Excluded from chart above to show only complete years for fair comparison
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Remarkable Growth Story */}
        <Card className="mb-8 bg-gradient-to-r from-[#47B3CB]/10 to-[#236383]/10 border-2 border-[#47B3CB]">
          <CardContent className="p-8">
            <div className="flex items-start gap-4 mb-6">
              <Rocket className="w-10 h-10 text-[#236383] flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Exponential Growth with Strategic Sustainability
                </h2>
                <p className="text-gray-600">
                  From pandemic response to community infrastructure in 5 years
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-4 rounded-lg border border-[#236383]/20">
                <div className="text-sm text-gray-600 mb-1">
                  {liveFirstWeekDate ? `First Week (${formatWeekLabel(liveFirstWeekDate)})` : 'First Week'}
                </div>
                <div className="text-3xl font-black text-[#236383]">
                  {liveFirstWeekTotal > 0 ? liveFirstWeekTotal.toLocaleString() : '—'}
                </div>
                <div className="text-xs text-gray-500">sandwiches</div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-[#A31C41]/20">
                <div className="text-sm text-gray-600 mb-1">
                  {livePeakWeekDate ? `Peak Week (${formatWeekLabel(livePeakWeekDate)})` : 'Peak Week'}
                </div>
                <div className="text-3xl font-black text-[#A31C41]">
                  {livePeakWeekTotal > 0 ? livePeakWeekTotal.toLocaleString() : '—'}
                </div>
                <div className="text-xs text-gray-500">sandwiches</div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-[#236383]/20">
                <div className="text-sm text-gray-600 mb-1">Weekly Avg (Recent)</div>
                <div className="text-3xl font-black text-[#236383]">
                  {metrics.weeklyAverage > 0 ? metrics.weeklyAverage.toLocaleString() : '—'}
                </div>
                <div className="text-xs text-gray-500">sandwiches/week (last 4 non-holiday weeks)</div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-[#FBAD3F]/20">
                <div className="text-sm text-gray-600 mb-1">Overall Growth</div>
                <div className="text-3xl font-black text-[#FBAD3F]">
                  {metrics.overallGrowthMultiplier > 0 ? `${metrics.overallGrowthMultiplier}x` : '—'}
                </div>
                <div className="text-xs text-gray-500">earliest vs. latest year on record</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inflation Resilience Callout */}
        {(() => {
          // Use the complete-year peak so we don't compare a full 2022 to a
          // YTD partial of the current year.
          const baseYearTotal = metrics.yearTotals[2022] || 0;
          const peakYearTotal = completeYearPeak.total;
          const peakYear = completeYearPeak.year;
          const realGrowthPct = baseYearTotal > 0
            ? Math.round(((peakYearTotal - baseYearTotal) / baseYearTotal) * 100)
            : 0;
          if (baseYearTotal === 0 || peakYearTotal === 0) return null;
          return (
            <Card className="mb-8 bg-gradient-to-r from-[#236383] to-[#236383] text-white shadow-xl border-0">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center gap-6">
                  <div className="flex-shrink-0 text-center md:text-left">
                    <div className="text-4xl md:text-5xl font-black text-[#fbad3f]">
                      +{FOOD_CPI_INFLATION_PCT_SINCE_2022}%
                    </div>
                    <div className="text-sm text-white/80">
                      food price inflation<br />since 2022
                    </div>
                    <div className="text-[10px] text-white/60 mt-1">
                      {FOOD_CPI_AS_OF_LABEL}
                    </div>
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold mb-2">Growth Despite Rising Costs — Absorbed by Volunteers</h3>
                    <p className="text-white/90">
                      Food prices have risen significantly since 2022. Because TSP does not pay for sandwich ingredients —
                      volunteers and partner groups supply them — every dollar of food inflation has been absorbed by
                      our community, not by our budget. Even so, output grew from{' '}
                      <strong className="text-[#fbad3f]">{baseYearTotal.toLocaleString()}</strong> sandwiches (2022) to{' '}
                      <strong className="text-[#fbad3f]">{peakYearTotal.toLocaleString()}</strong> ({peakYear})
                      {realGrowthPct > 0 && (
                        <> — a <strong className="text-[#fbad3f]">{realGrowthPct}% increase</strong> in volunteer contribution.</>
                      )}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-center md:text-right">
                    <div className="text-4xl md:text-5xl font-black text-[#fbad3f]">{formatHeroSandwiches(peakYearTotal)}</div>
                    <div className="text-sm text-white/80">sandwiches in {peakYear}<br />(peak year)</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* What Makes This Infrastructure Revolutionary */}
        <Card className="mb-8 border-2 border-[#A31C41] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#A31C41] to-[#8a1636] text-white">
            <CardTitle className="flex items-center text-xl">
              <Zap className="w-6 h-6 mr-2" />
              What Makes This Infrastructure Revolutionary
            </CardTitle>
            <CardDescription className="text-white/90">
              For funders evaluating systems-change, replication potential, and disaster preparedness
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Volunteer-Driven Production</div>
                <p className="text-sm text-gray-700">
                  Sandwich making and all ingredient costs are 100% volunteer-supplied. TSP pays nothing for sandwich supplies.
                </p>
              </div>
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Weekly Cadence</div>
                <p className="text-sm text-gray-700">
                  {liveWeeksOfService.toLocaleString()} weeks of collections since April 2020 — pausing only for major holidays. Within non-holiday weeks, our consistency is exceptional.
                </p>
              </div>
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Crisis-Ready</div>
                <p className="text-sm text-gray-700">
                  Surged response during Hurricane Helene (Oct 2024) — mobilized through existing volunteer network.
                </p>
              </div>
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Inflation-Resilient</div>
                <p className="text-sm text-gray-700">
                  Sandwich output has grown despite food-price inflation since 2022. Because volunteers and groups supply the food, rising costs hit them — not TSP's budget.
                </p>
              </div>
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Dual Collection Model</div>
                <p className="text-sm text-gray-700">
                  Scalable via both individuals and organizations — {metrics.avgPerCollection.toLocaleString()} sandwiches per collection on average.
                </p>
              </div>
              <div className="p-4 bg-[#FCE4E6] rounded-lg border border-[#A31C41]/20">
                <div className="font-bold text-[#A31C41] mb-2">Replicable Framework</div>
                <p className="text-sm text-gray-700">
                  Proven model that can be adapted for other cities facing food insecurity challenges.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GRANT-SPECIFIC SECTIONS */}

        {/* Volunteer Engagement & Economic Value - INTERACTIVE */}
        <Card className="mb-8 border-2 border-[#FBAD3F] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#FBAD3F] to-[#e89a2c] text-white">
            <CardTitle className="flex items-center text-xl">
              <HandHeart className="w-6 h-6 mr-2" />
              Volunteer Engagement & Economic Impact
            </CardTitle>
            <CardDescription className="text-white/90">
              Demonstrating community mobilization and in-kind value {selectedFiscalYear !== 'all' && `(FY ${selectedFiscalYear}${selectedQuarter !== 'all' ? ` Q${selectedQuarter}` : ''})`}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div className="text-center p-4 bg-[#FEF4E0] rounded-lg">
                <Users className="w-8 h-8 mx-auto mb-2 text-[#FBAD3F]" />
                <div className="text-3xl font-black text-[#FBAD3F] mb-1">
                  {filteredVolunteerMetrics.estimatedEngagements.toLocaleString()}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Estimated volunteer engagements
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Range {filteredVolunteerMetrics.lowEngagements.toLocaleString()}–{filteredVolunteerMetrics.highEngagements.toLocaleString()} · not unique people
                </p>
              </div>

              <div className="text-center p-4 bg-[#E0F2F1] rounded-lg">
                <Clock className="w-8 h-8 mx-auto mb-2 text-[#236383]" />
                <div className="text-3xl font-black text-[#236383] mb-1">
                  {filteredVolunteerMetrics.activeVolunteerHours.toLocaleString()}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Est. volunteer hours
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Active sandwich-making time only
                </p>
              </div>

              <div className="text-center p-4 bg-[#E8F4F8] rounded-lg">
                <DollarSign className="w-8 h-8 mx-auto mb-2 text-[#236383]" />
                <div className="text-3xl font-black text-[#236383] mb-1">
                  {(() => {
                    const v = filteredVolunteerMetrics.economicValue;
                    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
                    return `$${(v / 1000).toFixed(0)}K`;
                  })()}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Economic value (IRS rate)
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  @${IRS_VOLUNTEER_RATE_USD_PER_HOUR.toFixed(2)}/hour ({IRS_VOLUNTEER_RATE_YEAR})
                </p>
              </div>

              <div className="text-center p-4 bg-[#FCE4E6] rounded-lg">
                <Activity className="w-8 h-8 mx-auto mb-2 text-[#A31C41]" />
                <div className="text-3xl font-black text-[#A31C41] mb-1">
                  {filteredVolunteerMetrics.avgHoursPerEngagement.toFixed(1)}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Avg active hours per engagement
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Sandwich-making time per participation
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-gradient-to-r from-white to-[#E8F4F8] p-5 rounded-lg border border-[#236383]/30">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-[#236383]" />
                  Group sandwich-making engagements
                </h3>
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                      Sandwiches
                    </Badge>
                    <span>{filteredVolunteerMetrics.groupEventSandwiches.toLocaleString()} group-event sandwiches ({filteredVolunteerMetrics.completedGroupEvents.toLocaleString()} completed group events in this period)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                      Central
                    </Badge>
                    <span>÷ {GROUP_SANDWICHES_PER_ENGAGEMENT_CENTRAL} sandwiches per participant = {filteredVolunteerMetrics.groupEngagements.toLocaleString()} engagements</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                      Range
                    </Badge>
                    <span>÷ {GROUP_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND} to ÷ {GROUP_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND} = {filteredVolunteerMetrics.groupEngagementsLow.toLocaleString()}–{filteredVolunteerMetrics.groupEngagementsHigh.toLocaleString()} engagements</span>
                  </div>
                </div>
                <p className="text-xs text-[#236383] font-medium mt-3">
                  Historical group-event data supports {GROUP_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND}–{GROUP_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND} sandwiches per adult participant; adult/deli groups center around 20–{GROUP_SANDWICHES_PER_ENGAGEMENT_CENTRAL}.
                </p>
              </div>

              <div className="bg-gradient-to-r from-white to-[#FEF4E0] p-5 rounded-lg border border-[#FBAD3F]/30">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-[#FBAD3F]" />
                  Individual/household engagements
                </h3>
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#FBAD3F]/20 text-[#FBAD3F] border-[#FBAD3F]/30 shrink-0">
                      Sandwiches
                    </Badge>
                    <span>Total − group = {filteredVolunteerMetrics.individualSandwiches.toLocaleString()} individual sandwiches</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                      Central
                    </Badge>
                    <span>÷ {INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_CENTRAL} sandwiches per participant = {filteredVolunteerMetrics.individualEngagements.toLocaleString()} engagements</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                      Range
                    </Badge>
                    <span>÷ {INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_LOW_BOUND} to ÷ {INDIVIDUAL_SANDWICHES_PER_ENGAGEMENT_HIGH_BOUND} = {filteredVolunteerMetrics.individualEngagementsLow.toLocaleString()}–{filteredVolunteerMetrics.individualEngagementsHigh.toLocaleString()} engagements</span>
                  </div>
                </div>
                <p className="text-xs text-[#FBAD3F] font-medium mt-3">
                  No household-size multiplier is applied. Collection records store an area or host&apos;s aggregate individual total, not per-household drop-offs.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-white to-[#E0F2F1] p-5 rounded-lg border border-[#236383]/30 mb-4">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                <Clock className="w-5 h-5 mr-2 text-[#236383]" />
                Estimated active sandwich-making volunteer hours
              </h3>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-start gap-2">
                  <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                    Hours
                  </Badge>
                  <span>{filteredVolunteerMetrics.totalSandwiches.toLocaleString()} total sandwiches ÷ {SANDWICHES_PER_ACTIVE_VOLUNTEER_HOUR} per active hour = {filteredVolunteerMetrics.activeVolunteerHoursExact.toLocaleString()} hours</span>
                </div>
                <div className="flex items-start gap-2">
                  <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30 shrink-0">
                    Value
                  </Badge>
                  <span>× ${IRS_VOLUNTEER_RATE_USD_PER_HOUR.toFixed(2)}/hr (Independent Sector, {IRS_VOLUNTEER_RATE_YEAR}) = ${filteredVolunteerMetrics.economicValue.toLocaleString()}</span>
                </div>
              </div>
              <p className="text-xs text-[#236383] font-medium mt-3">
                {VOLUNTEER_HOURS_METHODOLOGY_NOTE}
              </p>
            </div>

            <p className="text-xs text-gray-600 italic px-1">
              * {VOLUNTEER_ENGAGEMENT_METHODOLOGY_NOTE}
            </p>
          </CardContent>
        </Card>

        {/* Cost Efficiency & Financial Metrics - INTERACTIVE */}
        <Card className="mb-8 border-2 border-[#236383] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#236383] to-[#236383] text-white">
            <CardTitle className="flex items-center text-xl">
              <DollarSign className="w-6 h-6 mr-2" />
              Cost Efficiency & Financial Impact
            </CardTitle>
            <CardDescription className="text-white/90">
              Demonstrating value delivered to community {selectedFiscalYear !== 'all' && `(FY ${selectedFiscalYear}${selectedQuarter !== 'all' ? ` Q${selectedQuarter}` : ''})`}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div className="text-center p-4 bg-[#E0F2F1] rounded-lg">
                <div className="text-4xl font-black text-[#236383] mb-2">
                  ${filteredCostMetrics.costPerSandwich.toFixed(2)}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Cost per sandwich
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Ingredients only
                </p>
              </div>

              <div className="text-center p-4 bg-[#E8F4F8] rounded-lg">
                <div className="text-4xl font-black text-[#236383] mb-2">
                  ${filteredCostMetrics.costPerMeal.toFixed(2)}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Cost per meal
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Ingredients only (2 sandwiches = 1 meal)
                </p>
              </div>

              <div className="text-center p-4 bg-[#FEF4E0] rounded-lg">
                <div className="text-4xl font-black text-[#FBAD3F] mb-2">
                  ${filteredCostMetrics.totalFoodValue >= 1000000
                    ? (filteredCostMetrics.totalFoodValue / 1000000).toFixed(2) + 'M'
                    : (filteredCostMetrics.totalFoodValue / 1000).toFixed(0) + 'K'}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Total food value delivered
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Selected period
                </p>
              </div>

              <div className="text-center p-4 bg-[#FCE4E6] rounded-lg">
                <div className="text-4xl font-black text-[#A31C41] mb-2">
                  ${((filteredVolunteerMetrics.economicValue + filteredCostMetrics.totalFoodValue) >= 1000000
                    ? ((filteredVolunteerMetrics.economicValue + filteredCostMetrics.totalFoodValue) / 1000000).toFixed(2) + 'M'
                    : ((filteredVolunteerMetrics.economicValue + filteredCostMetrics.totalFoodValue) / 1000).toFixed(0) + 'K')}
                </div>
                <p className="text-sm text-gray-700 font-medium">
                  Total community value
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Food + volunteer hours
                </p>
              </div>
            </div>

            <div className="mb-6 bg-white p-5 rounded-lg border border-[#236383]/20">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-[#236383]" />
                Ingredient Cost Baselines
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Volunteers buy different brands, so these are representative grocery baselines used to explain the food-value estimate. The current grant value uses the deli baseline because historical collection data does not yet have a complete deli vs. PB&J split.
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[#236383]/20 bg-[#E8F4F8]/60 p-4">
                  <h4 className="font-semibold text-[#236383] mb-2">Deli Sandwich Baseline</h4>
                  <ul className="space-y-1 text-sm text-gray-700">
                    <li>Nature's Own Honey Wheat bread, 2 slices</li>
                    <li>Kirkland prepackaged sliced cheddar cheese</li>
                    <li>Kirkland prepackaged sliced deli turkey meat</li>
                    <li>Individual sandwich bag</li>
                  </ul>
                  <p className="text-sm font-semibold text-gray-900 mt-3">
                    Reporting baseline: about ${filteredCostMetrics.costPerSandwich.toFixed(2)} per sandwich
                  </p>
                </div>
                <div className="rounded-lg border border-[#FBAD3F]/30 bg-[#FEF4E0]/70 p-4">
                  <h4 className="font-semibold text-[#B45309] mb-2">PB&J Sandwich Baseline</h4>
                  <ul className="space-y-1 text-sm text-gray-700">
                    <li>Nature's Own Honey Wheat bread, 2 slices</li>
                    <li>Jif peanut butter, about 2-3 tablespoons</li>
                    <li>Strawberry or grape jelly, about 2 teaspoons</li>
                    <li>Jelly only, not jam or preserves</li>
                    <li>Individual sandwich bag</li>
                  </ul>
                  <p className="text-sm font-semibold text-gray-900 mt-3">
                    Lower-cost reference, shown for transparency when explaining mixed sandwich production.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-[#E0F2F1] to-white p-5 rounded-lg border border-[#236383]/30">
              <h3 className="font-bold text-gray-900 mb-3">Why This Matters for Funders</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#236383] flex items-center justify-center text-white font-bold shrink-0">
                    1
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Exceptional Cost Efficiency</p>
                    <p className="text-sm text-gray-600">
                      At ${filteredCostMetrics.costPerMeal.toFixed(2)} per meal (2 sandwiches), we deliver dignified food assistance at a fraction of traditional meal program costs ($8-15/meal)
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#236383] flex items-center justify-center text-white font-bold shrink-0">
                    2
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Volunteer Force Multiplier</p>
                    <p className="text-sm text-gray-600">
                      Every $1 in grants leverages ${((filteredVolunteerMetrics.economicValue / Math.max(filteredCostMetrics.totalFoodValue, 1))).toFixed(1)} in volunteer economic value
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#FBAD3F] flex items-center justify-center text-white font-bold shrink-0">
                    3
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Proven Sustainability</p>
                    <p className="text-sm text-gray-600">
                      Operating on a weekly cadence since April 2020 — pausing only for major holidays — with consistent growth, not a one-time initiative
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#A31C41] flex items-center justify-center text-white font-bold shrink-0">
                    4
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Community Ownership</p>
                    <p className="text-sm text-gray-600">
                      About {filteredVolunteerMetrics.estimatedEngagements.toLocaleString()} volunteer engagements means deep community buy-in and resilience
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quarterly Reporting Breakdown - INTERACTIVE */}
        {filteredQuarterlyBreakdown.length > 0 && (
          <Card className="mb-8 border-2 border-[#47B3CB] shadow-lg">
            <CardHeader className="bg-gradient-to-r from-[#47B3CB] to-[#236383] text-white">
              <CardTitle className="flex items-center text-xl">
                <Calendar className="w-6 h-6 mr-2" />
                Quarterly Performance Breakdown
              </CardTitle>
              <CardDescription className="text-white/90">
                For grant reporting and compliance {selectedFiscalYear !== 'all' && `(FY ${selectedFiscalYear}${selectedQuarter !== 'all' ? ` Q${selectedQuarter}` : ''})`}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredQuarterlyBreakdown.slice(-12).map((quarter) => (
                  <div
                    key={quarter.quarter}
                    className="p-4 bg-gradient-to-br from-white to-[#E8F4F8] rounded-lg border border-[#47B3CB]/30 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge className="bg-[#47B3CB]/20 text-[#47B3CB] border-[#47B3CB]/30">
                        {quarter.quarter}
                      </Badge>
                      <BarChart3 className="w-5 h-5 text-[#236383]" />
                    </div>
                    <div className="text-3xl font-black text-[#236383] mb-1">
                      {quarter.sandwiches.toLocaleString()}
                    </div>
                    <p className="text-sm text-gray-600 mb-1">sandwiches distributed</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Building2 className="w-3 h-3" />
                      {quarter.events} collection events
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Geographic Reach & Demographics */}
        <Card className="mb-8 border-2 border-[#A31C41] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#A31C41] to-[#8a1636] text-white">
            <CardTitle className="flex items-center text-xl">
              <MapPin className="w-6 h-6 mr-2" />
              Geographic Reach & Communities Served
            </CardTitle>
            <CardDescription className="text-white/90">
              Demonstrating diversity and accessibility
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-[#A31C41]" />
                  Service Area
                </h3>
                <div className="space-y-3">
                  <div className="p-3 bg-[#FCE4E6] rounded-lg">
                    <div className="font-semibold text-gray-900 mb-1">Metro Atlanta Coverage</div>
                    <div className="text-sm text-gray-700">
                      <strong>35 collection sites</strong> across Fulton, DeKalb, Gwinnett, and Cobb counties
                    </div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-[#A31C41]/20">
                    <div className="font-semibold text-gray-900 mb-1">Strategic Distribution</div>
                    <div className="text-sm text-gray-700">
                      <strong>50+ partner organizations</strong> receiving weekly deliveries in high-need zip codes
                    </div>
                  </div>
                  <div className="p-3 bg-[#FCE4E6] rounded-lg">
                    <div className="font-semibold text-gray-900 mb-1">Expansion</div>
                    <div className="text-sm text-gray-700">
                      Extended operations to <strong>Athens-Clarke County</strong> in 2024
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Users className="w-5 h-5 mr-2 text-[#A31C41]" />
                  Diverse Communities Served
                </h3>
                <div className="bg-gradient-to-br from-white to-[#FCE4E6] p-5 rounded-lg border border-[#A31C41]/20">
                  <p className="text-sm text-gray-700 mb-4">
                    Our distribution network serves diverse populations across Metro Atlanta:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Black communities</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Latino communities</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>AAPI communities</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>White communities</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Housed individuals</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Unhoused individuals</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Seniors</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Children & families</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Veterans</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>LGBTQ+ community</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Trafficking survivors</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#A31C41]"></div>
                      <span>Recovery programs</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-4 italic">
                    Distribution partners serve their communities directly, ensuring cultural competence and dignity
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Partnership & Collaboration Strength - NOW WITH REAL DATA! */}
        <Card className="mb-8 border-2 border-[#47B3CB] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#47B3CB] to-[#236383] text-white">
            <CardTitle className="flex items-center text-xl">
              <Building2 className="w-6 h-6 mr-2" />
              Partnership & Collaboration Network
            </CardTitle>
            <CardDescription className="text-white/90">
              Evidence of community integration and collaboration (LIVE DATA from database)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="text-center p-6 bg-gradient-to-br from-[#47B3CB]/10 to-white rounded-lg border border-[#47B3CB]/30">
                <Building2 className="w-12 h-12 mx-auto mb-3 text-[#47B3CB]" />
                <div className="text-4xl font-black text-[#47B3CB] mb-2">
                  {recipientMetrics.total}
                </div>
                <p className="font-medium text-gray-900">Active Recipient Partners</p>
                <p className="text-sm text-gray-600 mt-2">
                  Organizations in database
                </p>
              </div>

              <div className="text-center p-6 bg-gradient-to-br from-[#236383]/10 to-white rounded-lg border border-[#236383]/30">
                <MapPin className="w-12 h-12 mx-auto mb-3 text-[#236383]" />
                <div className="text-4xl font-black text-[#236383] mb-2">
                  {totalHosts}
                </div>
                <p className="font-medium text-gray-900">Host Locations</p>
                <p className="text-sm text-gray-600 mt-2">
                  Active collection sites
                </p>
              </div>

              <div className="text-center p-6 bg-gradient-to-br from-[#236383]/10 to-white rounded-lg border border-[#236383]/30">
                <Users className="w-12 h-12 mx-auto mb-3 text-[#236383]" />
                <div className="text-4xl font-black text-[#236383] mb-2">
                  {eventMetrics.uniqueOrganizations}
                </div>
                <p className="font-medium text-gray-900">Event Organizations</p>
                <p className="text-sm text-gray-600 mt-2">
                  Unique organizations with completed events
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Focus Areas Breakdown */}
              <div className="bg-gradient-to-r from-white to-[#E8F4F8] p-5 rounded-lg border border-[#47B3CB]/30">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Target className="w-5 h-5 mr-2 text-[#47B3CB]" />
                  Recipients by Focus Area
                </h3>
                <div className="space-y-2">
                  {sortFocusAreaEntries(Object.entries(recipientMetrics.byFocusArea))
                    .map(([area, count]) => (
                      <div key={area} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 capitalize">{area}</span>
                        <Badge className="bg-[#47B3CB]/20 text-[#47B3CB] border-[#47B3CB]/30">
                          {count} orgs
                        </Badge>
                      </div>
                    ))}
                  {Object.keys(recipientMetrics.byFocusArea).length === 0 && (
                    <p className="text-sm text-gray-500 italic">No focus areas set. Add focus areas in Recipients Management.</p>
                  )}
                </div>
              </div>

              {/* Geographic Distribution */}
              <div className="bg-gradient-to-r from-white to-[#FEF4E0] p-5 rounded-lg border border-[#FBAD3F]/30">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-[#FBAD3F]" />
                  Recipients by Region (Geocoded)
                </h3>
                <div className="space-y-2">
                  {Object.entries(recipientMetrics.byRegion)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([region, count]) => (
                      <div key={region} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{region}</span>
                        <Badge className="bg-[#FBAD3F]/20 text-[#FBAD3F] border-[#FBAD3F]/30">
                          {count} orgs
                        </Badge>
                      </div>
                    ))}
                  {Object.keys(recipientMetrics.byRegion).length === 0 && (
                    <p className="text-sm text-gray-500 italic">Run geocoding on recipients with addresses to see regional distribution.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-[#E0F2F1] to-white p-5 rounded-lg border border-[#236383]/30">
              <h3 className="font-bold text-gray-900 mb-3">Estimated Weekly Bare Minimum Need</h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-black text-[#236383]">
                    {recipientMetrics.totalWeeklyCapacity.toLocaleString()}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Baseline weekly amount we try to meet for core recipient partners in the app.
                  </p>
                  <p className="text-xs text-gray-500 mt-2 max-w-3xl">
                    This is likely an undercount of true community need. Many recipient partners can take extra sandwiches, which is why TSP can place all sandwiches even during 10,000+ sandwich weeks. This number is best understood as the bare-minimum weekly baseline, not the ceiling of demand.
                  </p>
                </div>
                <BarChart3 className="w-16 h-16 text-[#236383]/30" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Group Events Impact - REAL DATA */}
        {eventMetrics.totalEvents > 0 && (
          <Card className="mb-8 border-2 border-[#236383] shadow-lg">
            <CardHeader className="bg-gradient-to-r from-[#236383] to-[#236383] text-white">
              <CardTitle className="flex items-center text-xl">
                <Users className="w-6 h-6 mr-2" />
                Group Events & Community Engagement
              </CardTitle>
              <CardDescription className="text-white/90">
                Tracked event participation from database {selectedFiscalYear !== 'all' && `(FY ${selectedFiscalYear})`}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="text-center p-4 bg-[#E8F4F8] rounded-lg">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-[#236383]" />
                  <div className="text-3xl font-black text-[#236383] mb-1">
                    {eventMetrics.totalEvents}
                  </div>
                  <p className="text-sm text-gray-700 font-medium">
                    Completed group events
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Tracked in database
                  </p>
                </div>

                <div className="text-center p-4 bg-[#FCE4E6] rounded-lg">
                  <Building2 className="w-8 h-8 mx-auto mb-2 text-[#A31C41]" />
                  <div className="text-3xl font-black text-[#A31C41] mb-1">
                    {eventMetrics.uniqueOrganizations}
                  </div>
                  <p className="text-sm text-gray-700 font-medium">
                    Unique organizations
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Hosted events
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gradient-to-r from-white to-[#E8F4F8] p-5 rounded-lg border border-[#236383]/30">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <Trophy className="w-5 h-5 mr-2 text-[#236383]" />
                    Sandwiches from Group Events
                  </h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-4xl font-black text-[#236383]">
                        {eventMetrics.totalActualSandwiches.toLocaleString()}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Sandwiches made at group events
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        From completed event requests plus historical group collections
                      </p>
                    </div>
                    <Award className="w-16 h-16 text-[#236383]/20" />
                  </div>
                </div>

                <div className="bg-gradient-to-r from-white to-[#FEF4E0] p-5 rounded-lg border border-[#FBAD3F]/30">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                    <BarChart3 className="w-5 h-5 mr-2 text-[#FBAD3F]" />
                    Average Event Output
                  </h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-4xl font-black text-[#FBAD3F]">
                        {eventMetrics.avgSandwichesPerEvent > 0
                          ? eventMetrics.avgSandwichesPerEvent.toLocaleString()
                          : '—'}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        sandwiches per completed group event
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Based on sandwich counts we actually track, not attendance or social-media reporting.
                      </p>
                    </div>
                    <Sandwich className="w-16 h-16 text-[#FBAD3F]/20" />
                  </div>
                </div>
              </div>

              <div className="mt-6 p-5 bg-gradient-to-br from-[#236383]/10 to-white rounded-lg border border-[#236383]/30">
                <h3 className="font-bold text-gray-900 mb-3">Why Group Events Matter</h3>
                <p className="text-sm text-gray-700 mb-3">
                  Group events transform sandwich-making into community building experiences, creating lasting partnerships with:
                </p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-[#236383] shrink-0 mt-0.5" />
                    <span><strong>Corporations:</strong> Team building events that serve the community</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-[#236383] shrink-0 mt-0.5" />
                    <span><strong>Faith Communities:</strong> Service projects connecting members</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-[#236383] shrink-0 mt-0.5" />
                    <span><strong>Schools:</strong> Student engagement and civic education</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-[#236383] shrink-0 mt-0.5" />
                    <span><strong>Community Groups:</strong> Volunteer mobilization at scale</span>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Capacity Building & Organizational Development */}
        <Card className="mb-8 border-2 border-[#FBAD3F] shadow-lg">
          <CardHeader className="bg-gradient-to-r from-[#FBAD3F] to-[#e89a2c] text-white">
            <CardTitle className="flex items-center text-xl">
              <Rocket className="w-6 h-6 mr-2" />
              Capacity Building & Infrastructure Development
            </CardTitle>
            <CardDescription className="text-white/90">
              Strategic investments for sustainable growth
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-white to-[#E0F2F1] p-5 rounded-lg border-l-4 border-[#47B3CB]">
                <div className="flex items-start gap-4">
                  <Users className="w-8 h-8 text-[#47B3CB] shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-gray-900 mb-2">Low-Overhead Mission Model</h3>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>What volunteers cover:</strong> All sandwich making and all sandwich ingredients. TSP does not need grant dollars for food materials, an office, or staff to do the hands-on work that fuels the mission.
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>What paid support protects:</strong> The coordination backbone behind that volunteer power — recipient communication, group-event scheduling, transportation logistics, reporting, systems maintenance, and operational follow-up.
                    </p>
                    <Badge className="bg-[#47B3CB]/20 text-[#47B3CB] border-[#47B3CB]/30">
                      Mission delivery remains volunteer-powered and materials-light
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-white to-[#E0F2F1] p-5 rounded-lg border-l-4 border-[#236383]">
                <div className="flex items-start gap-4">
                  <Activity className="w-8 h-8 text-[#236383] shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-gray-900 mb-2">Logistics Infrastructure</h3>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Need:</strong> Additional refrigerated van for expanded distribution capacity
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Impact:</strong> Enable simultaneous routes, reduce volunteer burden, improve crisis response time
                    </p>
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30">
                      Est. Cost: $35K-50K (one-time)
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-[#FEF4E0] to-white p-5 rounded-lg border-l-4 border-[#FBAD3F]">
                <div className="flex items-start gap-4">
                  <Briefcase className="w-8 h-8 text-[#FBAD3F] shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-gray-900 mb-2">Paid Coordination Capacity</h3>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Need:</strong> TSP now has a large and growing amount of operational work to run weekly collections, coordinate group events, manage recipient needs, and keep sandwich transportation moving. We have some paid/contract help, but the workload has outgrown what volunteers can sustainably absorb.
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Grant argument:</strong> Staffing and operations may look less exciting than direct materials, but for TSP they are the leverage point. Because volunteers provide the food and hands-on service, paid coordination lets thousands of volunteer hours and donated ingredients continue turning into meals with very little traditional overhead.
                    </p>
                    <Badge className="bg-[#FBAD3F]/20 text-[#FBAD3F] border-[#FBAD3F]/30">
                      Funding needed for paid operations and events coordination
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-[#E8F4F8] to-white p-5 rounded-lg border-l-4 border-[#236383]">
                <div className="flex items-start gap-4">
                  <Shield className="w-8 h-8 text-[#236383] shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-gray-900 mb-2">Technology & Systems</h3>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Current:</strong> Custom internal platform including collection tracking, event request intake and scheduling, recipient and host management, driver planning with route optimization, volunteer coordination, grant metrics and impact analytics, real-time messaging, email/SMS notifications, Google Sheets sync, and meeting management.
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Cost context:</strong> TSP avoided a substantial custom software expense because this operational system was built internally with AI-assisted development and volunteer labor.
                    </p>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Ongoing need:</strong> The platform reduces manual work, but it still requires maintenance, hosting, security updates, integrations, and continued improvements so TSP's internal operations can keep running smoothly as volume grows.
                    </p>
                    <Badge className="bg-[#236383]/20 text-[#236383] border-[#236383]/30">
                      Ongoing technology maintenance and operations support needed
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-5 bg-gradient-to-br from-[#FBAD3F]/10 to-white rounded-lg border border-[#FBAD3F]/30">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                <Target className="w-5 h-5 mr-2 text-[#FBAD3F]" />
                Why These Investments Matter
              </h3>
              <p className="text-sm text-gray-700 mb-3">
                The Sandwich Project has grown{' '}
                {metrics.overallGrowthMultiplier > 0 ? `${metrics.overallGrowthMultiplier}x` : 'substantially'}{' '}
                in annual output from its earliest year on record to its peak year while avoiding the large material, facility, and direct-service staffing costs common to traditional food distribution models. These investments fund the coordination backbone that keeps that model possible:
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-[#FBAD3F] shrink-0 mt-0.5" />
                  <span>
                    <strong>Sustainability:</strong> Reduce burnout risk by moving essential coordination work into paid roles
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-[#FBAD3F] shrink-0 mt-0.5" />
                  <span>
                    <strong>Scale:</strong> Help coordinate more group events, recipient relationships, and transportation logistics without adding major material overhead
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-[#FBAD3F] shrink-0 mt-0.5" />
                  <span>
                    <strong>Impact:</strong> Preserve the volunteer-powered model so donated food, donated time, and community goodwill continue producing unusually high impact per grant dollar
                  </span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="collections"
        title="Grant Metrics Assistant"
        subtitle="Ask about impact metrics and data"
        contextData={{
          currentView: 'grant-metrics',
          filters: {
            yearType,
            selectedYear: selectedFiscalYear,
            selectedQuarter,
          },
          summaryStats: {
            totalCollections: metrics.totalCollections,
            totalSandwiches: metrics.totalSandwiches,
            activeHosts: totalHosts,
            uniqueGroups: stats?.uniqueGroups || 0,
          },
        }}
        getFullContext={() => ({
          rawData: collections.map((c: any) => ({
            id: c.id,
            hostName: c.hostName,
            collectionDate: c.collectionDate,
            individualSandwiches: c.individualSandwiches,
            group1Name: c.group1Name,
            group1Count: c.group1Count,
            group2Name: c.group2Name,
            group2Count: c.group2Count,
            groupCollections: c.groupCollections,
            totalSandwiches: calculateTotalSandwiches(c),
          })),
        })}
        suggestedQuestions={[
          "What are our key impact metrics?",
          "Show me year-over-year growth",
          "How many sandwiches this fiscal year?",
          "What's our total sandwich count?",
          "How many active hosts do we have?",
          "What metrics can I use for grants?",
        ]}
      />
    </div>
  );
}
