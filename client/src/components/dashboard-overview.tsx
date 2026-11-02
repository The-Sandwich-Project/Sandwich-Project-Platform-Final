import { useState } from 'react';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Calendar,
  Award,
  Download,
  ExternalLink,
  Sandwich,
  Eye,
  BarChart3,
  Target,
  Activity,
  Users,
  Zap,
  Clock,
  Building2,
  Layers,
  Calculator,
  Package,
  MessageSquare,
  BookOpen,
  HandHeart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/useResourcePermissions';
import { useAnnualSandwichGoal } from '@/hooks/useAppSettings';
import { PERMISSIONS } from '@shared/auth-utils';
import { getTodayString } from '@shared/date-utils';
import { useToast } from '@/hooks/use-toast';
import {
  calculateActualWeeklyAverage,
  calculateWeeklyData,
  parseCollectionDate,
  calculateTotalSandwiches,
} from '@/lib/analytics-utils';
import { encodeAssetPath } from '@/lib/asset-path';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { HelpBubble } from '@/components/help-system';
import { DocumentPreviewModal } from '@/components/document-preview-modal';
import CollectionFormSelector from '@/components/collection-form-selector';
import { AnimatedCounter } from '@/components/modern-dashboard/animated-counter';
// DashboardActionTracker import removed — the "My Action Tracker" widget
// was removed from the dashboard per user request. The component itself
// still exists at @/components/dashboard-action-tracker for use elsewhere.
import { RecentlyAccessedResources } from '@/components/recently-accessed-resources';
// DashboardSearch import removed — its UI consolidated into UnifiedTopSearch
// in the persistent top navigation header. The endpoint it called
// (/api/people/search) is now used by the unified bar.
import { VolunteerOpportunitiesSpotlight } from '@/components/volunteer-opportunities-spotlight';
import OperationalOverview from '@/components/operational-overview';
import VolunteerNeedsOverview from '@/components/volunteer-needs-overview';
import { LowVolumeAlert } from '@/components/low-volume-alert';
import { WEEK_OFFSET_TO_SCOPE } from '@/components/event-requests/lib/eventRequestsListQuery';
import { adminDocuments } from '@/pages/important-documents';

// Dark mode toggle removed per user request
import {
  SandwichStackIcon,
  GrowthTrendIcon,
  CommunityIcon,
  TargetIcon,
  SparkleIcon,
  NetworkIcon,
} from '@/components/modern-dashboard/custom-svg-icons';
// CMYK_PRINT_TSP_01 logo import removed — the centered logo card it powered
// was relocated to the sidebar brand block (simple-nav.tsx) so the dashboard
// can promote actionable content into the top slot.
import { logger } from '@/lib/logger';
// Using optimized SVG logos for faster loading
const tspLogoSvg = '/logo-optimized.svg';
const sandwichIconSvg = '/sandwich-icon-optimized.svg';

// TSP-built companion web apps, surfaced on the dashboard as a launcher so they
// read as one product suite rather than a loose list of external links. Each
// entry's `accent` is its brand color, used only for the icon tile and the
// card's left border — the Open action itself is a single uniform button across
// all apps, which is what makes the group feel like one suite (and sidesteps
// white-on-light-accent contrast issues). All apps open in a new tab.
const TSP_APPS: ReadonlyArray<{
  name: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}> = [
  {
    name: 'Service Hours Sign-Off Portal',
    description:
      'Volunteers enter their info and receive automated service-hours letters.',
    url: 'https://hour-hero-magic.lovable.app',
    icon: Clock,
    accent: '#FBAD3F',
  },
  {
    name: 'Donor Management Platform',
    description:
      'DIY donor management — tracks donations, donors, and "Friends in TSP" network connections.',
    url: 'https://bread-and-butter-donors.lovable.app/',
    icon: Users,
    accent: '#236383',
  },
  {
    name: 'Grant Tracking & Application Manager',
    description:
      'Track grants and deadlines, with AI research tools to work on grant applications.',
    url: 'https://tsp-grant-manager.lovable.app',
    icon: Target,
    accent: '#236383',
  },
  {
    name: 'Host Onboarding Tracker',
    description:
      'Track hosts being onboarded — will eventually include all existing hosts.',
    url: 'https://sandwich-steward.lovable.app',
    icon: Building2,
    accent: '#47B3CB', // brand-light-blue token (tailwind.config.ts)
  },
  {
    name: 'Donation Receipt Generator',
    description: 'Generate donation receipts for donors quickly and easily.',
    url: 'https://receipt-gen--katielong2316.replit.app',
    icon: FileText,
    accent: '#A31C41',
  },
];

interface DashboardOverviewProps {
  onSectionChange: (section: string) => void;
}

// Standalone section band header — gives the dashboard a clear hierarchy
// (TODAY / QUICK RESOURCES / INSIGHTS / VOLUNTEERS / OPERATIONS / TOOLS) so the page reads as
// grouped priorities instead of one long undifferentiated scroll. Rendered as
// a sibling before each group (the parent's space-y stacking forms the bands),
// so it never has to wrap blocks and can't unbalance the surrounding JSX.
//
// Typography sized to OUTRANK the card titles below it (the H4s inside cards
// run around text-base / 16px). At `text-2xl` the section label clearly
// dominates and the subtitle reads as supporting text. Generous mt/pb give
// the band visual breathing room so it doesn't crush against the card above.
function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mx-4 mt-8 pb-3 border-b-2 border-gray-200">
      <h2 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-wide text-[#236383] leading-tight">
        {label}
      </h2>
      {hint && (
        <p className="mt-1 text-sm text-gray-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function DashboardOverview({
  onSectionChange,
}: {
  onSectionChange?: (section: string) => void;
}) {
  const { user } = useAuth();
  const {
    COLLECTIONS_ADD,
    COLLECTIONS_EDIT_OWN,
    ADMIN_ACCESS,
    NAV_EVENT_PLANNING,
    NAV_VOLUNTEER_HUB,
  } = usePermissions([
    'COLLECTIONS_ADD',
    'COLLECTIONS_EDIT_OWN',
    'ADMIN_ACCESS',
    'NAV_EVENT_PLANNING',
    'NAV_VOLUNTEER_HUB',
  ]);
  const canViewEventRequests = Boolean(NAV_EVENT_PLANNING);
  const canViewVolunteerHub = Boolean(NAV_VOLUNTEER_HUB);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const annualSandwichGoal = useAnnualSandwichGoal();

  // Form state
  const [showCollectionForm, setShowCollectionForm] = useState(false);

  // Modal state for document preview
  const [previewModal, setPreviewModal] = useState({
    isOpen: false,
    documentPath: '',
    documentName: '',
    documentType: '',
  });

  const openPreviewModal = (path: string, name: string, type: string) => {
    setPreviewModal({
      isOpen: true,
      documentPath: path,
      documentName: name,
      documentType: type,
    });
  };

  const closePreviewModal = () => {
    setPreviewModal({
      isOpen: false,
      documentPath: '',
      documentName: '',
      documentType: '',
    });
  };

  // Defer stats loading until after first render for better FCP/LCP
  const [deferredLoad, setDeferredLoad] = useState(false);

  const { data: statsData } = useQuery({
    queryKey: ['/api/sandwich-collections/stats'],
    queryFn: async () => {
      const response = await fetch('/api/sandwich-collections/stats', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds for dashboard stats
    refetchOnMount: true,
    refetchInterval: 2 * 60 * 1000, // Auto-refresh every 2 minutes
    enabled: deferredLoad,
  });
  React.useEffect(() => {
    const timer = setTimeout(() => setDeferredLoad(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Fetch dashboard documents configuration from API
  const { data: dashboardDocumentsData } = useQuery({
    queryKey: ['/api/dashboard-documents'],
    // Use global defaults (5 min staleTime) - invalidateQueries handles refetch on mutations
  });

  // Map dashboard document IDs to full document details from adminDocuments
  const importantDocuments = React.useMemo(() => {
    const toCard = (doc: (typeof adminDocuments)[number]) => ({
      title: doc.name,
      description: doc.description,
      category: doc.category,
      path: doc.path,
      type: doc.type,
      id: doc.id,
    });

    const handbook = adminDocuments.find((d) => d.id === 'volunteer-handbook');

    if (!dashboardDocumentsData || !Array.isArray(dashboardDocumentsData)) {
      logger.log('📄 Dashboard documents: No data or not array', dashboardDocumentsData);
      return handbook ? [toCard(handbook)] : [];
    }

    logger.log('📄 Dashboard documents data received:', dashboardDocumentsData);

    const mapped = dashboardDocumentsData
      .map((dashDoc: any) => {
        const doc = adminDocuments.find((d: any) => d.id === dashDoc.documentId);
        if (!doc) {
          logger.warn(`⚠️ Document not found in adminDocuments: ${dashDoc.documentId}`);
          return null;
        }

        logger.log(`✅ Found document: ${doc.name} (${dashDoc.documentId})`);
        return toCard(doc);
      })
      .filter((doc: any) => doc !== null);

    // Always surface the Volunteer Handbook PDF in this section.
    if (handbook && !mapped.some((d: any) => d.id === 'volunteer-handbook')) {
      mapped.unshift(toCard(handbook));
    }

    logger.log('📄 Final important documents:', mapped);
    return mapped;
  }, [dashboardDocumentsData]);

  // Fetch all collections for peak calculations
  const { data: allCollectionsData } = useQuery({
    queryKey: ['/api/sandwich-collections/all'],
    queryFn: async () => {
      const response = await fetch(
        '/api/sandwich-collections?page=1&limit=5000',
        {
          credentials: 'include',
        }
      );
      if (!response.ok) throw new Error('Failed to fetch collections');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes for peak calculations
    enabled: !!statsData, // Only fetch after stats are loaded
  });

  // Key statistics - All values calculated dynamically from real data
  const organizationalStats = React.useMemo(() => {
    if (!statsData) {
      return {
        totalLifetimeSandwiches: 'Loading...',
        peakWeekRecord: 'Loading...',
        peakWeekDate: 'Loading...',
        annualGoalNumber: 0,
        currentAnnualCapacity: 'Loading...',
        weeklyAverageNumber: 0,
        weeklyAverage: 'Loading...',
        weeklyBaseline: 'Loading...',
        weeklyBaselineMin: 'Loading...',
        weeklyBaselineMax: 'Loading...',
        surgingCapacity: 'Loading...',
        surgeMin: 'Loading...',
        surgeMax: 'Loading...',
        operationalYears: 'Loading...',
        growthMultiplier: 'Loading...',
        individualSandwiches: 'Loading...',
        groupSandwiches: 'Loading...',
        totalEntries: 'Loading...',
      };
    }

    const totalSandwiches = statsData.completeTotalSandwiches || 0;
    const individual = statsData.individualSandwiches || 0;
    const group = totalSandwiches - individual;

    // Calculate peak week from collections data if available
    let peakWeekRecord = statsData.peakWeekRecord || 0;
    let peakWeekDate = statsData.peakWeekDate || 'Calculating...';

    if (allCollectionsData?.collections) {
      const collections = allCollectionsData.collections;
      const weeklyTotals: Record<string, { total: number; date: string }> = {};

      collections.forEach((collection: any) => {
        if (collection.collectionDate) {
          const date = new Date(collection.collectionDate);
          // Get Monday of the week as key
          const monday = new Date(date);
          monday.setDate(date.getDate() - date.getDay() + 1);
          const weekKey = monday.toISOString().split('T')[0];

          if (!weeklyTotals[weekKey]) {
            weeklyTotals[weekKey] = {
              total: 0,
              date: monday.toLocaleDateString(),
            };
          }

          // Calculate total sandwiches for this collection
          const individualCount = collection.individualSandwiches || 0;
          let groupCount = 0;
          if (
            collection.groupCollections &&
            Array.isArray(collection.groupCollections)
          ) {
            groupCount = collection.groupCollections.reduce(
              (sum: number, group: any) => {
                return sum + (group.count || group.sandwichCount || 0);
              },
              0
            );
          }
          weeklyTotals[weekKey].total += individualCount + groupCount;
        }
      });

      // Find peak week
      const peakWeek = Object.values(weeklyTotals).reduce(
        (max, week) => (week.total > max.total ? week : max),
        { total: 0, date: 'N/A' }
      );

      if (peakWeek.total > peakWeekRecord) {
        peakWeekRecord = peakWeek.total;
        peakWeekDate = peakWeek.date;
      }
    }

    // Calculate dynamic values from actual data
    const currentYear = new Date().getFullYear();

    // Calculate operational years from actual data if available
    const earliestYear = statsData.earliestCollectionDate
      ? new Date(statsData.earliestCollectionDate).getFullYear()
      : 2020;
    const operationalYears = currentYear - earliestYear;

    // Annual goal - organizational target (configurable via app settings)
    const annualGoal = annualSandwichGoal;

    // Calculate weekly average using proper method that excludes holiday weeks
    // This accounts for Thanksgiving, Christmas, New Year's, July 4th, and Memorial Day weeks
    const weeklyAverage = allCollectionsData?.collections
      ? calculateActualWeeklyAverage(allCollectionsData.collections)
      : totalSandwiches / (operationalYears * 52); // Fallback to simple calculation

    // Calculate baseline and surge capacity from data patterns
    const baselineMin = Math.round(weeklyAverage * 0.7);
    const baselineMax = Math.round(weeklyAverage * 1.3);
    const surgeMin = Math.round(weeklyAverage * 3);
    const surgeMax = Math.round(weeklyAverage * 5);

    // Calculate growth multiplier using first year data if available
    const firstYearTotal = statsData.firstYearTotal || 1000; // Fallback estimate
    const firstYearWeekly = firstYearTotal / 52;
    const growthMultiplier =
      firstYearWeekly > 0
        ? Math.round(weeklyAverage / firstYearWeekly)
        : Math.round(weeklyAverage / (1000 / 52));

    return {
      totalLifetimeSandwiches: totalSandwiches.toLocaleString(),
      peakWeekRecord: peakWeekRecord.toLocaleString(),
      peakWeekDate: peakWeekDate,
      annualGoalNumber: annualGoal,
      currentAnnualCapacity: annualGoal.toLocaleString(),
      weeklyAverageNumber: Math.round(weeklyAverage),
      weeklyAverage: Math.round(weeklyAverage).toLocaleString(),
      weeklyBaseline: `${baselineMin.toLocaleString()}-${baselineMax.toLocaleString()}`,
      weeklyBaselineMin: baselineMin.toLocaleString(),
      weeklyBaselineMax: baselineMax.toLocaleString(),
      surgingCapacity: `${surgeMin.toLocaleString()}-${surgeMax.toLocaleString()}`,
      surgeMin: surgeMin.toLocaleString(),
      surgeMax: surgeMax.toLocaleString(),
      operationalYears: operationalYears.toString(),
      growthMultiplier: `${growthMultiplier}x`,
      individualSandwiches: individual.toLocaleString(),
      groupSandwiches: group.toLocaleString(),
      totalEntries: (statsData.totalEntries || 0).toLocaleString(),
    };
  }, [statsData, allCollectionsData, annualSandwichGoal]);

  // Last 12 completed weeks of real collection totals for the dashboard trend
  // chart. Excludes the in-progress week so the line doesn't dip artificially.
  const weeklyTrend = React.useMemo(() => {
    const collections = allCollectionsData?.collections;
    if (!collections?.length) return [];
    return calculateWeeklyData(collections)
      .filter((w) => w.isComplete)
      .slice(-12)
      .map((w) => ({
        week: w.weekLabel.split(' - ')[0], // short Friday label for x-axis
        weekFull: w.weekLabel, // full label (e.g. "Jan 12 - Jan 18") for tooltip
        sandwiches: w.totalSandwiches,
      }));
  }, [allCollectionsData]);

  // Year-over-year pace: this year's running total (Jan 1 → today) vs the
  // SAME calendar window last year (Jan 1 → today's month/day a year ago).
  // Apples-to-apples — both are partial-year totals to the same day-of-year,
  // so a healthy mid-year reading isn't penalized against a full prior year.
  // Computed client-side from the collections already loaded for the trend
  // chart, using the canonical per-record total, so no new endpoint is needed.
  const ytdYoY = React.useMemo(() => {
    const collections = allCollectionsData?.collections;
    if (!collections?.length) return null;

    // Anchor "today" to the app's Eastern-time definition (getTodayString),
    // not the viewer's local clock — otherwise the cutoff window can shift by
    // a day for users outside ET around midnight ET. getTodayString returns a
    // 1-based-month YYYY-MM-DD string; Date wants a 0-based month.
    const [thisYear, todayMonth1, todayDay] = getTodayString().split('-').map(Number);
    const lastYear = thisYear - 1;
    const month = todayMonth1 - 1;

    // Clamp the day to the last valid day of the target month so a Feb 29
    // "today" doesn't roll over to Mar 1 when last year isn't a leap year.
    const clampDay = (year: number, monthIdx: number, day: number) =>
      Math.min(day, new Date(year, monthIdx + 1, 0).getDate());

    // Inclusive end-of-day cutoffs so today's / last-year-today's records count.
    const thisStart = new Date(thisYear, 0, 1, 0, 0, 0, 0);
    const thisEnd = new Date(thisYear, month, clampDay(thisYear, month, todayDay), 23, 59, 59, 999);
    const lastStart = new Date(lastYear, 0, 1, 0, 0, 0, 0);
    const lastEnd = new Date(lastYear, month, clampDay(lastYear, month, todayDay), 23, 59, 59, 999);

    let thisSum = 0;
    let lastSum = 0;
    for (const c of collections) {
      if (!c.collectionDate) continue;
      const dt = parseCollectionDate(c.collectionDate);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt >= thisStart && dt <= thisEnd) {
        thisSum += calculateTotalSandwiches(c);
      } else if (dt >= lastStart && dt <= lastEnd) {
        lastSum += calculateTotalSandwiches(c);
      }
    }

    // No comparable window last year → nothing honest to show.
    if (lastSum <= 0) return null;
    const pct = Math.round(((thisSum - lastSum) / lastSum) * 100);
    return { pct, lastYear };
  }, [allCollectionsData]);

  // Min/max for the trend chart — used in the legend strip so the reader
  // has the line's scale even without inspecting the y-axis.
  const weeklyTrendStats = React.useMemo(() => {
    if (!weeklyTrend.length) return null;
    const totals = weeklyTrend.map((w) => w.sandwiches);
    return {
      min: Math.min(...totals),
      max: Math.max(...totals),
      avg: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
    };
  }, [weeklyTrend]);

  // Compact y-axis tick formatter — 12,500 → "12.5k", keeps the axis from
  // taking too much horizontal real estate.
  const formatCompactNumber = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
  };

  return (
    <div className="min-h-screen premium-gradient-subtle relative w-full overflow-x-hidden">
      {/* Dark Mode Toggle */}
      <div className="absolute top-4 right-4 z-50">
        {/* Dark mode toggle removed */}
      </div>
      <div className="space-y-8 pb-8 pt-4 w-full">
        {/* The big centered TSP logo+tagline card that used to live here was
            moved to the top-left of the sidebar so the dashboard's prime
            above-the-fold space (Universal Search + Collection CTA) shows
            without scrolling. The brand still anchors the page via the
            sidebar — standard SaaS convention (Slack, Linear, Notion). */}

        {/* The large in-dashboard search card that used to live here was
            removed — its functionality moved into UnifiedTopSearch in the
            persistent top navigation header so a single bar is available on
            every page. Reclaiming this vertical slot pulls the Collection
            CTA + impact milestone higher up the dashboard. */}

        {/* Collection Call-to-Action */}
        {(COLLECTIONS_ADD || COLLECTIONS_EDIT_OWN) && (
          <div className="premium-card-elevated mx-4 p-4 sm:p-6 max-w-full">
            <div className="text-center max-w-full">
              <div className="mb-4 sm:mb-6">
                <h2 className="premium-text-h3 text-brand-primary mb-2">
                  Record Collection Data
                </h2>
                {showCollectionForm && (
                  <p className="premium-text-body-sm text-gray-700">
                    Submit your sandwich contributions to help our community
                  </p>
                )}
              </div>
              {/* Primary + secondary action hierarchy.
                  "Enter New Collection Data" is the page's reason for being —
                  it gets the spotlight via larger padding, bigger text, and
                  the amber accent (#FBAD3F) which pops against the teal-heavy
                  page palette. "View Collection History" steps back to a
                  text-link treatment so the eye lands on the primary action
                  first. The buttons no longer share visual weight. */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
                <button
                  className="premium-btn-accent text-base sm:text-lg font-bold px-8 py-3.5 shadow-[0_4px_14px_rgba(251,173,63,0.4)] hover:shadow-[0_6px_20px_rgba(251,173,63,0.5)]"
                  style={{ minHeight: '52px' }}
                  onClick={() => setShowCollectionForm(!showCollectionForm)}
                  data-testid="button-enter-collection-data"
                >
                  {showCollectionForm
                    ? 'Hide Form'
                    : 'Enter New Collection Data'}
                </button>
                <button
                  className="text-sm font-medium text-brand-primary hover:text-brand-primary-dark hover:underline underline-offset-4 transition-colors px-3 py-2"
                  onClick={() => onSectionChange?.('collections')}
                  data-testid="button-view-collection-history"
                >
                  View Collection History →
                </button>
              </div>
            </div>

            {/* Embedded Collection Form - Full width on mobile */}
            {showCollectionForm && (
              <div className="mt-6">
                <CollectionFormSelector
                  onSuccess={() => {
                    setShowCollectionForm(false);
                    queryClient.invalidateQueries({
                      queryKey: ['/api/sandwich-collections'],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ['/api/sandwich-collections/stats'],
                    });
                    // Also refresh the full collections list backing the
                    // weekly trend chart and the YoY pace pill — otherwise the
                    // YTD total (from /stats) updates immediately while the
                    // YoY % stays stale until the next refetch.
                    queryClient.invalidateQueries({
                      queryKey: ['/api/sandwich-collections/all'],
                    });
                  }}
                  onCancel={() => setShowCollectionForm(false)}
                />
              </div>
            )}
          </div>
        )}

        {/* Hero Impact Section */}
        <div className="mx-4 mb-8 sm:mb-12 max-w-full">
          <div className="premium-card-featured p-8 sm:p-12 text-center max-w-full">
            <div className="mb-4">
              <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-brand-orange tracking-tight">
                <AnimatedCounter
                  value={statsData?.completeTotalSandwiches || 0}
                />
              </h1>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 mt-4">
                <div className="w-2 h-2 bg-brand-light-blue rounded-full hidden sm:block"></div>
                <p className="premium-text-body-lg text-brand-primary font-medium text-center">
                  Total sandwiches collected since 2020
                </p>
                <div className="w-2 h-2 bg-brand-light-blue rounded-full hidden sm:block"></div>
              </div>
            </div>
            <div className="premium-divider my-4 sm:my-6"></div>
            {/* Last month, year-to-date, and current month stats */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 mb-4">
              {statsData?.lastMonthSandwiches != null && (
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-brand-primary">
                    {(statsData.lastMonthSandwiches).toLocaleString()}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">
                    {statsData.lastMonthName} {statsData.lastMonthYear}
                  </p>
                </div>
              )}
              {statsData?.lastMonthSandwiches != null && statsData?.ytdSandwiches != null && (
                <div className="hidden sm:block w-px h-10 bg-gray-200"></div>
              )}
              {statsData?.ytdSandwiches != null && (
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-brand-primary">
                    {(statsData.ytdSandwiches).toLocaleString()}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">
                    in {statsData.ytdYear} so far
                  </p>
                  {/* YoY pace pill — running total vs the same window last year.
                      Green when up, amber when down; only shown when there's a
                      comparable prior-year window so we never invent a trend. */}
                  {ytdYoY && (
                    <p
                      className={`text-xs font-semibold mt-1 inline-flex items-center gap-0.5 ${
                        ytdYoY.pct >= 0 ? 'text-green-600' : 'text-amber-600'
                      }`}
                      title={`Year-to-date total vs Jan 1–today in ${ytdYoY.lastYear}`}
                    >
                      {ytdYoY.pct >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      {ytdYoY.pct >= 0 ? '+' : ''}
                      {ytdYoY.pct}% vs this point in {ytdYoY.lastYear}
                    </p>
                  )}
                </div>
              )}
              {statsData?.ytdSandwiches != null && statsData?.currentMonthSandwiches != null && (
                <div className="hidden sm:block w-px h-10 bg-gray-200"></div>
              )}
              {statsData?.currentMonthSandwiches != null && (
                <div className="text-center">
                  <p className="text-2xl sm:text-3xl font-bold text-brand-primary">
                    {(statsData.currentMonthSandwiches).toLocaleString()}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">
                    {statsData.currentMonthName} {statsData.currentMonthYear}
                  </p>
                  {/* Trend signal — projected month-end with a smart benchmark.
                      Computes TWO comparisons every render:
                        MoM  — projected month-end vs LAST month total
                        YoY  — running total today vs same window last year
                               (last year day 1 → today's day-of-month, both
                               apples-to-apples)
                      Then picks whichever percentage is HIGHER (most favorable
                      to current operations). The reasoning: for a seasonal
                      nonprofit, comparing June (summer dip) to May isn't a
                      fair benchmark — June vs last June is. Showing the more
                      flattering of the two avoids penalizing a perfectly
                      healthy June for not beating May, while still flagging
                      genuine declines (both numbers down). The comparison
                      label tells the user exactly which benchmark we're using
                      so it's transparent, not spin. */}
                  {(() => {
                    const ms = statsData;
                    if (!ms || ms.currentMonthSandwiches == null) return null;
                    const [eY, eM, eD] = getTodayString().split('-').map(Number);
                    const dayOfMonth = eD;
                    const daysInMonth = new Date(eY, eM, 0).getDate();
                    if (dayOfMonth < 1) return null;
                    const projected = Math.round((ms.currentMonthSandwiches / dayOfMonth) * daysInMonth);

                    // Candidate 1: month-over-month. Project current to full
                    // month, compare to last month's complete total.
                    const momPct = (ms.lastMonthSandwiches != null && ms.lastMonthSandwiches > 0)
                      ? Math.round(((projected - ms.lastMonthSandwiches) / ms.lastMonthSandwiches) * 100)
                      : null;
                    // Candidate 2: year-over-year, running total to-date.
                    // Compares June 1–today to last June 1–today so partial-vs-
                    // full doesn't poison the signal.
                    const yoyPct = (
                      (ms as any).lastYearSameMonthToDateSandwiches != null &&
                      (ms as any).lastYearSameMonthToDateSandwiches > 0
                    )
                      ? Math.round(
                          ((ms.currentMonthSandwiches - (ms as any).lastYearSameMonthToDateSandwiches) /
                            (ms as any).lastYearSameMonthToDateSandwiches) * 100,
                        )
                      : null;

                    // Choose the better comparison. When both exist, prefer
                    // the higher percentage. When only one exists, use it.
                    let usingPct: number | null = null;
                    let comparisonLabel = '';
                    if (momPct != null && yoyPct != null) {
                      if (yoyPct >= momPct) {
                        usingPct = yoyPct;
                        comparisonLabel = `vs ${(ms as any).lastYearSameMonthName} ${(ms as any).lastYearSameMonthYear} to date`;
                      } else {
                        usingPct = momPct;
                        comparisonLabel = `vs ${ms.lastMonthName}`;
                      }
                    } else if (yoyPct != null) {
                      usingPct = yoyPct;
                      comparisonLabel = `vs ${(ms as any).lastYearSameMonthName} ${(ms as any).lastYearSameMonthYear} to date`;
                    } else if (momPct != null) {
                      usingPct = momPct;
                      comparisonLabel = `vs ${ms.lastMonthName}`;
                    }

                    if (usingPct == null) return null;
                    const up = usingPct >= 0;
                    return (
                      <p className={`text-xs font-medium mt-0.5 flex items-center justify-center gap-0.5 ${up ? 'text-green-600' : 'text-amber-600'}`}>
                        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        on pace for ~{projected.toLocaleString()} ({up ? '+' : ''}{usingPct}% {comparisonLabel})
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
            {/* Progress toward the annual goal — turns the bare YTD number and
                the "Annual Goal" target into an at-a-glance progress bar. */}
            {statsData?.ytdSandwiches != null && annualSandwichGoal > 0 && (() => {
              const goalPct = Math.min(100, Math.round((statsData.ytdSandwiches / annualSandwichGoal) * 100));
              return (
                <div className="max-w-md mx-auto mb-4">
                  <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-1">
                    <span>{statsData.ytdYear} progress toward goal</span>
                    <span className="font-semibold text-brand-primary">
                      {statsData.ytdSandwiches.toLocaleString()} / {annualSandwichGoal.toLocaleString()} ({goalPct}%)
                    </span>
                  </div>
                  <Progress value={goalPct} className="h-2" />
                </div>
              );
            })()}
            <div className="premium-text-body-sm text-gray-600">
              Live total from every collection logged to date
            </div>
          </div>
        </div>

        {/* Volunteer Handbook — same external reference as the nav bar link,
            surfaced near the top so it is easy to find without opening the menu. */}
        <div className="mx-4 mb-8 max-w-full">
          <a
            href="https://tsp-host-handbook-ylfb92u.gamma.site/"
            target="_blank"
            rel="noopener noreferrer"
            className="block group"
            aria-label="Open TSP Volunteer Handbook in a new tab"
          >
            <div className="rounded-xl border-2 border-[#236383]/50 bg-gradient-to-r from-[#236383]/15 via-white to-[#236383]/10 p-5 sm:p-6 shadow-sm hover:shadow-md hover:border-[#236383] transition-all">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-[#236383] flex items-center justify-center shrink-0 shadow-sm">
                  <BookOpen className="w-7 h-7 text-white" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-[#236383]">
                    TSP Volunteer Handbook
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    The all-encompassing handbook for every volunteer role — policies, procedures, and reference material.
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-2 shrink-0 font-semibold text-[#236383] group-hover:underline underline-offset-4">
                  Open Handbook
                  <ExternalLink className="w-5 h-5" aria-hidden="true" />
                </div>
                <ExternalLink className="w-5 h-5 text-[#236383] shrink-0 sm:hidden" aria-hidden="true" />
              </div>
            </div>
          </a>
        </div>

        {/* ── TODAY: the things that need attention right now ── */}
        <SectionHeader label="Today" hint="What needs your attention right now" />

        {canViewEventRequests ? (
          <OperationalOverview onNavigate={onSectionChange || (() => {})} />
        ) : canViewVolunteerHub ? (
          <VolunteerNeedsOverview onNavigate={onSectionChange || (() => {})} />
        ) : null}

        {/* My Action Tracker widget removed from the dashboard per user
            request. The component is still imported by other places if
            needed; just not surfaced here. */}

        {/* Recently Visited Items — people reopen the same resources constantly. */}
        <div className="mx-4 mb-8 max-w-full">
          <RecentlyAccessedResources />
        </div>

        {/* ── QUICK RESOURCES (external links + in-app shortcuts) ── */}
        <SectionHeader label="Quick Resources" hint="Toolkits, directories, and common pages" />

        <div className="mx-4 mb-8 max-w-full">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-full">
            <a
              href="https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-[#236383] hover:bg-[#e8f4f8]/40 transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-[#236383] flex items-center justify-center shrink-0">
                <Calculator className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-[#236383] text-sm flex-1">Inventory Calculator</span>
              <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-[#236383]" aria-hidden="true" />
            </a>

            <a
              href="https://the-sandwich-project.github.io/sandwichinventory/toolkit.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-[#FBAD3F] hover:bg-[#FBAD3F]/10 transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-[#FBAD3F] flex items-center justify-center shrink-0">
                <Package className="w-4 h-4 text-[#3d2800]" />
              </div>
              <span className="font-semibold text-[#236383] text-sm flex-1">Event Toolkit</span>
              <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-[#FBAD3F]" aria-hidden="true" />
            </a>

            <a
              href="https://the-sandwich-project.github.io/sandwichprojectcollectionsites/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-[#236383] hover:bg-[#e8f4f8]/40 transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-[#236383] flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-[#236383] text-sm flex-1">Host Finder Tool</span>
              <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-[#236383]" aria-hidden="true" />
            </a>
          </div>

          {/* In-app shortcuts — separated from external links above */}
          <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 max-w-full mt-8 pt-8 border-t border-gray-200">
            <div
              className="premium-card premium-interactive p-4 group cursor-pointer"
              onClick={() => onSectionChange?.('collections')}
            >
              <div className="w-12 h-12 bg-brand-light-blue rounded-lg flex items-center justify-center mb-3">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                Collections
              </h3>
              <p className="premium-text-body-sm text-gray-600 mb-3">View all data</p>
              <div className="text-brand-primary font-medium text-sm flex items-center">
                Open Collections →
              </div>
            </div>

            <div
              className="premium-card premium-interactive p-4 group cursor-pointer"
              onClick={() => onSectionChange?.('analytics')}
            >
              <div className="w-12 h-12 bg-brand-orange rounded-lg flex items-center justify-center mb-3">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                Analytics
              </h3>
              <p className="premium-text-body-sm text-gray-600 mb-3">Deep insights</p>
              <div className="text-brand-primary font-medium text-sm flex items-center">
                View Analytics →
              </div>
            </div>

            <div
              className="premium-card premium-interactive p-4 group cursor-pointer"
              onClick={() => onSectionChange?.('grant-metrics')}
            >
              <div className="w-12 h-12 bg-brand-primary rounded-lg flex items-center justify-center mb-3">
                <Award className="w-6 h-6 text-white" />
              </div>
              <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                Grant Metrics
              </h3>
              <p className="premium-text-body-sm text-gray-600 mb-3">
                Funder-ready numbers
              </p>
              <div className="text-brand-primary font-medium text-sm flex items-center">
                View Grant Metrics →
              </div>
            </div>

            {canViewEventRequests ? (
              <div
                className="premium-card premium-interactive p-4 group cursor-pointer"
                onClick={() => onSectionChange?.('event-requests')}
              >
                <div className="w-12 h-12 bg-brand-teal rounded-lg flex items-center justify-center mb-3">
                  <Calendar className="w-6 h-6 text-white" />
                </div>
                <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                  Event Requests
                </h3>
                <p className="premium-text-body-sm text-gray-600 mb-3">Manage events</p>
                <div className="text-brand-primary font-medium text-sm flex items-center">
                  Open Event Requests →
                </div>
              </div>
            ) : canViewVolunteerHub ? (
              <button
                type="button"
                className="premium-card premium-interactive p-4 group cursor-pointer w-full h-full text-left"
                onClick={() => onSectionChange?.('volunteer-hub')}
              >
                <div className="w-12 h-12 bg-brand-teal rounded-lg flex items-center justify-center mb-3">
                  <HandHeart className="w-6 h-6 text-white" />
                </div>
                <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                  Volunteer Hub
                </h3>
                <p className="premium-text-body-sm text-gray-600 mb-3">Sign up for events</p>
                <div className="text-brand-primary font-medium text-sm flex items-center">
                  Open Volunteer Hub →
                </div>
              </button>
            ) : null}

            <div
              className="premium-card premium-interactive p-4 group cursor-pointer"
              onClick={() => onSectionChange?.('messages')}
            >
              <div className="w-12 h-12 bg-brand-burgundy rounded-lg flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <h3 className="premium-text-body font-semibold text-brand-primary mb-1">
                Messages
              </h3>
              <p className="premium-text-body-sm text-gray-600 mb-3">Communication</p>
              <div className="text-brand-primary font-medium text-sm flex items-center">
                Open Messages →
              </div>
            </div>
          </div>
        </div>

        {/* ── INSIGHTS ── (Action Tracker moved up to the Today section) */}
        <SectionHeader label="Insights" hint="Totals, capacity, and resources" />

        {/* Weekly collections trend — a compact 12-week chart so the dashboard
            shows momentum visually, not just as numbers. Full analytics live on
            the dedicated pages; this is the at-a-glance snapshot. */}
        {weeklyTrend.length > 1 && (
          <div className="mx-4 mb-8 max-w-full">
            <div className="premium-card p-4 sm:p-6">
              <div className="flex items-start justify-between mb-1 gap-2">
                <div>
                  <h3 className="premium-text-caption text-brand-primary uppercase">
                    Weekly Collections — last {weeklyTrend.length} weeks
                  </h3>
                  <p className="text-sm text-gray-700 mt-0.5">
                    Total sandwiches collected each week (individual + group)
                  </p>
                </div>
                <button
                  onClick={() => onSectionChange?.('analytics')}
                  className="text-sm text-brand-primary hover:underline flex items-center gap-1 flex-shrink-0 mt-1"
                >
                  Full analytics <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Legend strip — color swatch makes the line's meaning explicit
                  and the min/avg/max anchors give the reader scale before
                  they hover any point. */}
              {weeklyTrendStats && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-sm"
                      style={{ backgroundColor: '#236383' }}
                      aria-hidden="true"
                    />
                    <span>Sandwiches per week</span>
                  </span>
                  <span className="text-gray-300" aria-hidden="true">·</span>
                  <span>
                    Low <span className="font-semibold text-gray-800">{weeklyTrendStats.min.toLocaleString()}</span>
                  </span>
                  <span>
                    Avg <span className="font-semibold text-gray-800">{weeklyTrendStats.avg.toLocaleString()}</span>
                  </span>
                  <span>
                    High <span className="font-semibold text-gray-800">{weeklyTrendStats.max.toLocaleString()}</span>
                  </span>
                </div>
              )}

              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={weeklyTrend} margin={{ top: 5, right: 8, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="dashTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#236383" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#236383" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    interval="preserveStartEnd"
                    label={{
                      value: 'Week ending (Friday)',
                      position: 'insideBottom',
                      offset: -2,
                      style: { fontSize: 10, fill: '#9ca3af' },
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={formatCompactNumber}
                    width={44}
                    label={{
                      value: 'Sandwiches',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 12,
                      style: { fontSize: 10, fill: '#9ca3af', textAnchor: 'middle' },
                    }}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => [`${value.toLocaleString()} sandwiches`, 'Total collected']}
                    labelFormatter={(_label, payload) => {
                      const full = (payload?.[0]?.payload as { weekFull?: string } | undefined)?.weekFull;
                      return full ? `Week of ${full}` : '';
                    }}
                    labelStyle={{ color: '#236383', fontWeight: 600 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sandwiches"
                    name="Sandwiches collected"
                    stroke="#236383"
                    strokeWidth={2}
                    fill="url(#dashTrendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mx-4 mb-6 sm:mb-8 max-w-full">
          <div className="premium-card premium-interactive p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="premium-text-caption text-brand-primary uppercase">
                Individual Collections
              </h3>
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-brand-orange rounded-lg flex items-center justify-center">
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-white rounded-full"></div>
              </div>
            </div>
            <div className="premium-text-h2 text-brand-orange mb-2">
              <AnimatedCounter value={statsData?.individualSandwiches || 0} />
            </div>
            <p className="premium-text-body-sm text-gray-600">
              Personal contributions
            </p>
            <p className="text-xs text-gray-400 mt-1 uppercase tracking-wide">
              All-time total
            </p>
          </div>

          <div className="premium-card premium-interactive p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="premium-text-caption text-brand-primary uppercase">
                Group Collections
              </h3>
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-brand-light-blue rounded-lg flex items-center justify-center">
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-white rounded-full"></div>
              </div>
            </div>
            <div className="premium-text-h2 text-brand-light-blue mb-2">
              <AnimatedCounter
                value={
                  statsData
                    ? (statsData.completeTotalSandwiches || 0) -
                      (statsData.individualSandwiches || 0)
                    : 0
                }
              />
            </div>
            <p className="premium-text-body-sm text-gray-600">
              Organization donations
            </p>
            <p className="text-xs text-gray-400 mt-1 uppercase tracking-wide">
              All-time total
            </p>
          </div>

          <div className="premium-card premium-interactive p-4 sm:p-6 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="premium-text-caption text-brand-primary uppercase">
                Collection Records
              </h3>
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-brand-primary rounded-lg flex items-center justify-center">
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-white rounded-full"></div>
              </div>
            </div>
            <div className="premium-text-h2 text-brand-primary mb-2">
              <AnimatedCounter value={statsData?.totalEntries || 0} />
            </div>
            <p className="premium-text-body-sm text-gray-600">Data submissions</p>
            <p className="text-xs text-gray-400 mt-1 uppercase tracking-wide">
              All-time total
            </p>
          </div>
        </div>

        {/* Operational Capacity — Narrative-forward storytelling cards.
            Each card leads with an emoji + headline, anchors the big number
            visually, and closes with a supporting sentence that explains
            what the number means and the window it reflects. */}
        <div className="mx-4 mb-6 sm:mb-8 max-w-full">
          <div className="premium-card p-4 sm:p-6 max-w-full">
            <h2 className="premium-text-h3 text-gray-700 mb-4 sm:mb-6">
              Operational Capacity
            </h2>
            <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-w-full">
              {/* Peak Week — Our Best Week Ever (Burgundy) */}
              <div className="min-w-0 overflow-hidden premium-card-elevated border-l-4 border-l-brand-burgundy p-4 sm:p-5 flex flex-col">
                <div className="text-sm font-semibold text-brand-burgundy uppercase tracking-wide">
                  <span aria-hidden="true">🏆</span> Our Best Week Ever
                </div>
                <div className="mt-3 mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                  <span className="text-2xl sm:text-3xl xl:text-4xl font-extrabold text-brand-burgundy leading-none break-all">
                    {organizationalStats.peakWeekRecord}
                  </span>
                  <span className="text-sm text-gray-600 font-medium">
                    sandwiches
                  </span>
                </div>
                <p className="text-sm text-gray-700 leading-snug mt-2 break-words">
                  Our highest single-week total ever, set on{' '}
                  <span className="font-semibold">
                    {organizationalStats.peakWeekDate}
                  </span>
                  .
                </p>
              </div>

              {/* Annual Goal — This Year's Goal (Orange) */}
              <div className="min-w-0 overflow-hidden premium-card-elevated border-l-4 border-l-brand-orange p-4 sm:p-5 flex flex-col">
                <div className="text-sm font-semibold text-brand-orange uppercase tracking-wide">
                  <span aria-hidden="true">🎯</span> This Year's Goal
                </div>
                <div className="mt-3 mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                  <span className="text-2xl sm:text-3xl xl:text-4xl font-extrabold text-brand-orange leading-none break-all">
                    {organizationalStats.currentAnnualCapacity}
                  </span>
                  <span className="text-sm text-gray-600 font-medium">
                    sandwiches
                  </span>
                </div>
                <p className="text-sm text-gray-700 leading-snug mt-2 break-words">
                  What we're aiming to collect together in{' '}
                  <span className="font-semibold">
                    {new Date().getFullYear()}
                  </span>
                  .
                </p>
              </div>

              {/* Weekly Baseline — What a Typical Week Looks Like (Light Blue) */}
              <div className="min-w-0 overflow-hidden premium-card-elevated border-l-4 border-l-brand-light-blue p-4 sm:p-5 flex flex-col">
                <div className="text-sm font-semibold text-brand-light-blue uppercase tracking-wide">
                  <span aria-hidden="true">📦</span> A Typical Week
                </div>
                <div className="mt-3 mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                  <span className="text-2xl sm:text-3xl xl:text-4xl font-extrabold text-brand-light-blue leading-none break-all">
                    ~{organizationalStats.weeklyAverage}
                  </span>
                  <span className="text-sm text-gray-600 font-medium">
                    sandwiches
                  </span>
                </div>
                <p className="text-sm text-gray-700 leading-snug mt-2 break-words">
                  On any given week, most weeks fall between{' '}
                  <span className="font-semibold">
                    {organizationalStats.weeklyBaselineMin}
                  </span>{' '}
                  and{' '}
                  <span className="font-semibold">
                    {organizationalStats.weeklyBaselineMax}
                  </span>
                  . Every single week, thousands are fed because of this team.
                </p>
              </div>

              {/* Surge Capacity — When We Mobilize (Dark Teal).
                  Range is shown as stacked From/To lines so long numbers
                  never break mid-digit in a narrow grid column. */}
              <div className="min-w-0 overflow-hidden premium-card-elevated border-l-4 border-l-brand-teal p-4 sm:p-5 flex flex-col">
                <div className="text-sm font-semibold text-brand-teal uppercase tracking-wide">
                  <span aria-hidden="true">⚡</span> When We Mobilize
                </div>
                <div className="mt-3 mb-1 space-y-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-xs font-semibold text-gray-500 uppercase shrink-0 w-9">
                      From
                    </span>
                    <span className="text-xl sm:text-2xl xl:text-3xl font-extrabold text-brand-teal leading-none tabular-nums">
                      {organizationalStats.surgeMin}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-xs font-semibold text-gray-500 uppercase shrink-0 w-9">
                      To
                    </span>
                    <span className="text-xl sm:text-2xl xl:text-3xl font-extrabold text-brand-teal leading-none tabular-nums">
                      {organizationalStats.surgeMax}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 font-medium pl-11">
                    sandwiches
                  </p>
                </div>
                <p className="text-sm text-gray-700 leading-snug mt-2 break-words">
                  What we've reached when the call goes out — 3 to 5 times a
                  normal week's pace.
                </p>
              </div>
            </div>
          </div>
        </div>

        {canViewEventRequests && (
          <>
            <SectionHeader label="Volunteers" hint="Upcoming events that need people" />
            <VolunteerOpportunitiesSpotlight onNavigate={onSectionChange || (() => {})} />
            <SectionHeader label="Group Event Forecast" />
            <div className="mx-4">
              <LowVolumeAlert
                onNavigateToWeek={(weekOffset) => {
                  const weekScope = WEEK_OFFSET_TO_SCOPE[weekOffset] ?? 'current';
                  try {
                    sessionStorage.setItem(
                      'eventRequests.pendingFilter',
                      JSON.stringify({ tab: 'all', weekScope }),
                    );
                  } catch {
                    // ignore unavailable sessionStorage
                  }
                  onSectionChange?.('event-requests');
                }}
              />
            </div>
          </>
        )}

        {/* ── TOOLS ── */}
        <SectionHeader label="Tools" hint="Calculators, toolkits, and TSP apps" />

        {/* TSP Apps launcher — companion web apps rendered uniformly from
            TSP_APPS so they read as one product suite. One card pattern, one
            "Open" action; per-app brand color lives on the icon tile + left
            border only. */}
        <div className="mx-4 mb-8 max-w-full">
          <h3 className="premium-text-h3 text-brand-primary mb-1">
            TSP Apps
          </h3>
          <p className="premium-text-body-sm text-gray-600 mb-6">
            Companion apps we've built for TSP operations — each opens in a new tab.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-full">
            {TSP_APPS.map((app) => {
              const Icon = app.icon;
              return (
                <div
                  key={app.url}
                  className="premium-card-elevated p-5 flex flex-col"
                  style={{ borderLeft: `4px solid ${app.accent}` }}
                >
                  <div className="flex items-center mb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center mr-3 shrink-0"
                      style={{ backgroundColor: app.accent }}
                    >
                      <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                    </div>
                    <h4 className="premium-text-body font-semibold text-brand-primary">
                      {app.name}
                    </h4>
                  </div>
                  {/* flex-1 pushes every Open button to the same baseline
                      regardless of description length, so the row stays tidy. */}
                  <p className="premium-text-body-sm text-gray-600 mb-4 flex-1">
                    {app.description}
                  </p>
                  {/* Anchor (not button + window.open) so it carries real link
                      semantics — copy link, middle-click, context menu, and
                      screen-reader link recognition. rel guards the new tab. */}
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="premium-btn-primary w-full text-sm inline-flex items-center justify-center gap-1.5"
                    aria-label={`Open ${app.name} in a new tab`}
                  >
                    Open
                    <ExternalLink className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resources Section */}
        <div className="mx-4 mb-8 max-w-full">
          <h3 className="text-lg font-semibold text-brand-primary mb-6">
            Resources
          </h3>
          <div className="bg-white rounded-xl p-6 shadow-md max-w-full">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-brand-orange rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-xl font-semibold text-brand-primary">
                  Important Documents
                </h4>
                <p className="text-sm text-gray-600">
                  Essential organizational resources
                </p>
              </div>
            </div>

            {/* Documents Grid - Compact design */}
            {importantDocuments.length === 0 ? (
              <div className="text-center py-8 px-4 max-w-full" data-testid="no-documents-message">
                <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 mb-2">No documents configured for dashboard</p>
                {ADMIN_ACCESS && (
                  <p className="text-xs text-gray-400">
                    Admins can configure documents in the{' '}
                    <a href="/important-documents" className="text-brand-primary hover:underline">
                      Important Documents
                    </a>{' '}
                    page
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-full">
                {importantDocuments.map((doc, index) => {
                const isLink = doc.type === 'link' || doc.path.startsWith('http');
                const openUrl = isLink ? doc.path : encodeAssetPath(doc.path);
                return (
                <div
                  key={doc.id || index}
                  className="bg-gray-50 rounded-lg p-4 hover:shadow-md transition-all duration-200 border hover:border-brand-primary/30"
                >
                  <div className="flex items-center mb-3">
                    {isLink ? (
                      <BookOpen className="h-5 w-5 text-brand-primary mr-2 flex-shrink-0" />
                    ) : (
                      <FileText className="h-5 w-5 text-brand-primary mr-2 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-brand-primary truncate">
                        {doc.title}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded">
                          {doc.category}
                        </span>
                        <span className="text-xs text-gray-500">
                          {isLink ? 'Link' : 'PDF'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mb-3 line-clamp-2">
                    {doc.description}
                  </p>
                  <div className="flex gap-2">
                    {isLink ? (
                      <Button
                        size="sm"
                        onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')}
                        className="flex-1 h-8 text-xs bg-brand-primary hover:bg-brand-primary-dark text-white"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Open
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openPreviewModal(doc.path, doc.title, 'pdf')
                          }
                          className="flex-1 h-8 text-xs border-brand-primary/30 hover:border-brand-primary text-brand-primary"
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => window.open(openUrl, '_blank')}
                          className="flex-1 h-8 text-xs bg-brand-primary hover:bg-brand-primary-dark text-white"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Download
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Help System */}
        <div className="mx-4 mt-6 sm:mt-8 max-w-full">
          <HelpBubble
            title="Dashboard Overview"
            content="This dashboard shows your impact at a glance! These numbers represent real meals provided to community members in your area. Use the forms above to submit new collection data or browse documents for guidance."
            character="sandy"
            position="top"
            trigger="hover"
          >
            <div className="text-center text-xs sm:text-sm text-gray-500 cursor-help">
              Need help? Hover here for guidance
            </div>
          </HelpBubble>
        </div>
      </div>
      {/* Document Preview Modal */}
      <DocumentPreviewModal
        isOpen={previewModal.isOpen}
        onClose={closePreviewModal}
        documentPath={previewModal.documentPath}
        documentName={previewModal.documentName}
        documentType={previewModal.documentType}
      />
    </div>
  );
}
