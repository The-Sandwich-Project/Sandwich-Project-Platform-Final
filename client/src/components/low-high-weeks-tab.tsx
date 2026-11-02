import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronsUpDown, Download, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useCollectionsData } from '@/hooks/useCollectionsData';
import {
  calculateGroupSandwiches,
  parseCollectionDate,
  getWeekStartFriday,
} from '@/lib/analytics-utils';
import type { SandwichCollection } from '@shared/schema';
import { downloadCsv } from '@/lib/csv-download';

// Color palette
const COLORS = {
  primary: '#236383',
  accent: '#FBAD3F',
  teal: '#236383',
  sky: '#47B3CB',
  red: '#A31C41',
};

interface WeekBucket {
  weekStart: string; // YYYY-MM-DD of the Friday start
  year: number;
  isoWeek: number;
  individual: number;
  group: number;
  total: number;
  records: number;
}

interface AggregatedWeek {
  isoWeek: number;
  avgTotal: number;
  avgIndividual: number;
  avgGroup: number;
  yearsCount: number;
  // For risk: how often this calendar week landed in the lowest 33% / highest 33%
  lowYearsCount: number;
  highYearsCount: number;
  pctLow: number;
  pctHigh: number;
  // Representative date range across the years used (e.g. "Jun 28 - Jul 4")
  sampleDateRange: string;
  // Per-year instances, sorted oldest → newest
  instances: WeekBucket[];
}

/**
 * Convert a Friday-week-start date into an ISO week number (1–53).
 * Uses the Thursday of the week to determine the ISO week.
 */
function getIsoWeekNumber(fridayStart: Date): number {
  // ISO week is defined by the Thursday of the week.
  // Our weeks are Fri–Thu, so Thursday is fridayStart + 6 days.
  const thursday = new Date(fridayStart);
  thursday.setDate(thursday.getDate() + 6);
  // ISO algorithm
  const d = new Date(Date.UTC(thursday.getFullYear(), thursday.getMonth(), thursday.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateRange(fridayStart: Date): string {
  const thursday = new Date(fridayStart);
  thursday.setDate(thursday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(fridayStart)} – ${fmt(thursday)}`;
}

interface PreparedData {
  aggregatedWeeks: AggregatedWeek[];
  overallAvg: number;
  lowThreshold: number;
  highThreshold: number;
  availableYears: number[]; // every year present in the unfiltered dataset
}

function prepareData(
  collections: SandwichCollection[],
  selectedYears: Set<number>,
): PreparedData {
  // Bucket every collection into Friday-start weeks
  const buckets = new Map<string, WeekBucket>();
  const allYears = new Set<number>();

  for (const c of collections) {
    if (!c.collectionDate) continue;
    const d = parseCollectionDate(c.collectionDate);
    if (Number.isNaN(d.getTime())) continue;

    const fridayStart = getWeekStartFriday(d);
    const year = fridayStart.getFullYear();
    allYears.add(year);
    if (!selectedYears.has(year)) continue;

    const key = fridayStart.toISOString().slice(0, 10);
    const ind = Number(c.individualSandwiches || 0);
    const grp = calculateGroupSandwiches(c);

    if (!buckets.has(key)) {
      buckets.set(key, {
        weekStart: key,
        year,
        isoWeek: getIsoWeekNumber(fridayStart),
        individual: 0,
        group: 0,
        total: 0,
        records: 0,
      });
    }
    const b = buckets.get(key)!;
    b.individual += ind;
    b.group += grp;
    b.total += ind + grp;
    b.records += 1;
  }

  // Treat very-thinly-recorded weeks (< 3 records) as incomplete and drop
  const weeks = Array.from(buckets.values()).filter((w) => w.records >= 3);

  // Stats across all included weeks
  const totals = weeks.map((w) => w.total).sort((a, b) => a - b);
  const overallAvg = totals.length
    ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length)
    : 0;
  const lowThreshold = totals.length
    ? totals[Math.floor(totals.length * 0.33)]
    : 0;
  const highThreshold = totals.length
    ? totals[Math.floor(totals.length * 0.67)]
    : 0;

  // Group instances by ISO week number
  const byIsoWeek = new Map<number, WeekBucket[]>();
  for (const w of weeks) {
    if (!byIsoWeek.has(w.isoWeek)) byIsoWeek.set(w.isoWeek, []);
    byIsoWeek.get(w.isoWeek)!.push(w);
  }

  // Aggregate per ISO-week-of-year
  const aggregatedWeeks: AggregatedWeek[] = [];
  for (const [isoWeek, instances] of Array.from(byIsoWeek.entries())) {
    const sortedByYear = [...instances].sort((a, b) => a.year - b.year);
    const yearsCount = sortedByYear.length;
    const avgTotal = Math.round(
      sortedByYear.reduce((s, i) => s + i.total, 0) / yearsCount,
    );
    const avgIndividual = Math.round(
      sortedByYear.reduce((s, i) => s + i.individual, 0) / yearsCount,
    );
    const avgGroup = Math.round(
      sortedByYear.reduce((s, i) => s + i.group, 0) / yearsCount,
    );
    const lowYearsCount = sortedByYear.filter((i) => i.total <= lowThreshold).length;
    const highYearsCount = sortedByYear.filter((i) => i.total >= highThreshold).length;
    // Sample range = most recent year's Friday range (gives a familiar date label)
    const sample = sortedByYear[sortedByYear.length - 1];
    const sampleDateRange = formatDateRange(parseCollectionDate(sample.weekStart));
    aggregatedWeeks.push({
      isoWeek,
      avgTotal,
      avgIndividual,
      avgGroup,
      yearsCount,
      lowYearsCount,
      highYearsCount,
      pctLow: Math.round((lowYearsCount / yearsCount) * 100),
      pctHigh: Math.round((highYearsCount / yearsCount) * 100),
      sampleDateRange,
      instances: sortedByYear,
    });
  }

  return {
    aggregatedWeeks,
    overallAvg,
    lowThreshold,
    highThreshold,
    availableYears: Array.from(allYears).sort((a, b) => a - b),
  };
}

function riskInfo(pct: number, kind: 'low' | 'high') {
  if (pct >= 80)
    return {
      label: kind === 'low' ? 'High risk' : 'Strong peak',
      color: COLORS.red,
      bg: `${COLORS.red}1A`,
    };
  if (pct >= 50)
    return {
      label: kind === 'low' ? 'Medium risk' : 'Reliable peak',
      color: COLORS.accent,
      bg: `${COLORS.accent}1A`,
    };
  return {
    label: 'Moderate',
    color: COLORS.teal,
    bg: `${COLORS.teal}1A`,
  };
}

function StatPill({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center rounded-lg px-4 py-2 bg-white/15">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

interface WeekRowProps {
  week: AggregatedWeek;
  rank: number;
  variant: 'low' | 'high';
}

function WeekRow({ week, rank, variant }: WeekRowProps) {
  const [expanded, setExpanded] = useState(false);
  const pct = variant === 'low' ? week.pctLow : week.pctHigh;
  const risk = riskInfo(pct, variant);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-mono text-slate-400 w-6 shrink-0">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">
              Week {week.isoWeek}
            </span>
            <span className="text-xs text-slate-500">{week.sampleDateRange}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Avg <span className="font-semibold text-slate-700">{week.avgTotal.toLocaleString()}</span>
            <span className="mx-1">·</span>
            Ind {week.avgIndividual.toLocaleString()}
            <span className="mx-1">·</span>
            Grp {week.avgGroup.toLocaleString()}
            <span className="mx-1">·</span>
            {week.yearsCount} {week.yearsCount === 1 ? 'year' : 'years'}
          </div>
        </div>
        <Badge
          className="shrink-0 text-xs"
          style={{ color: risk.color, background: risk.bg, borderColor: risk.color }}
          variant="outline"
        >
          {risk.label} · {pct}%
        </Badge>
        <ChevronsUpDown className="w-3 h-3 text-slate-400" />
      </button>
      {expanded && (
        <div className="border-t border-slate-200 px-3 py-2 bg-slate-50/50 text-xs">
          <div className="font-medium text-slate-600 mb-1">Per-year breakdown</div>
          <div className="space-y-1">
            {week.instances.map((i) => (
              <div key={i.weekStart} className="flex items-center justify-between">
                <span className="font-mono text-slate-500">{i.year}</span>
                <span>
                  <span className="font-semibold text-slate-900">
                    {i.total.toLocaleString()}
                  </span>
                  <span className="text-slate-400 ml-2">
                    (Ind {i.individual.toLocaleString()} · Grp {i.group.toLocaleString()})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PanelProps {
  title: string;
  icon: React.ReactNode;
  weeks: AggregatedWeek[];
  variant: 'low' | 'high';
  description: string;
}

/** Matches the ranked lists shown on the tab. */
const DISPLAYED_WEEK_COUNT = 20;

function Panel({ title, icon, weeks, variant, description }: PanelProps) {
  // Top 20, sorted by avg (asc for low, desc for high)
  const sorted = [...weeks].sort((a, b) =>
    variant === 'low' ? a.avgTotal - b.avgTotal : b.avgTotal - a.avgTotal,
  );
  const top = sorted.slice(0, DISPLAYED_WEEK_COUNT);

  // Chart data
  const chartData = top.map((w) => ({
    label: `W${w.isoWeek}`,
    Individual: w.avgIndividual,
    Group: w.avgGroup,
  }));

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: variant === 'low' ? COLORS.red : COLORS.teal }}>
              {icon}
            </span>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          </div>
          <p className="text-xs text-slate-500">{description}</p>
        </div>

        {/* Stacked bar chart */}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  value.toLocaleString(),
                  name,
                ]}
              />
              <Bar dataKey="Individual" stackId="a" fill={COLORS.primary} />
              <Bar dataKey="Group" stackId="a" fill={COLORS.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* List */}
        <div className="space-y-1.5">
          {top.map((w, i) => (
            <WeekRow key={w.isoWeek} week={w} rank={i + 1} variant={variant} />
          ))}
          {top.length === 0 && (
            <p className="text-sm text-slate-500 italic py-4 text-center">
              No data in the selected window.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type ViewMode = 'both' | 'low' | 'high';
type WindowMode = '2024-2025' | 'all' | 'custom';

interface YearPickerProps {
  available: number[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}

function YearPicker({ available, selected, onChange }: YearPickerProps) {
  const label = selected.size === 0
    ? 'Select years…'
    : selected.size === available.length
      ? 'All years'
      : `${selected.size} year${selected.size === 1 ? '' : 's'} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs">
          {label}
          <ChevronsUpDown className="w-3 h-3 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          {available.map((year) => (
            <label
              key={year}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer text-sm"
            >
              <Checkbox
                checked={selected.has(year)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked) next.add(year);
                  else next.delete(year);
                  onChange(next);
                }}
              />
              {year}
            </label>
          ))}
          {available.length === 0 && (
            <div className="text-xs text-slate-500 px-2 py-1">No years in data.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function LowHighWeeksTab() {
  const { collections, isLoading } = useCollectionsData();

  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [windowMode, setWindowMode] = useState<WindowMode>('2024-2025');
  // Years selected when windowMode === 'custom'
  const [customYears, setCustomYears] = useState<Set<number>>(new Set());

  // First pass: figure out available years (so the custom picker has something to show).
  // We let `prepareData` do this with an "everything selected" pass.
  const allYears = useMemo(() => {
    if (!collections?.length) return [] as number[];
    const ys = new Set<number>();
    for (const c of collections) {
      if (!c.collectionDate) continue;
      const d = parseCollectionDate(c.collectionDate);
      if (Number.isNaN(d.getTime())) continue;
      ys.add(getWeekStartFriday(d).getFullYear());
    }
    return Array.from(ys).sort((a, b) => a - b);
  }, [collections]);

  // Resolve which years are in scope for the current window mode
  const selectedYears = useMemo<Set<number>>(() => {
    if (windowMode === '2024-2025') return new Set([2024, 2025]);
    if (windowMode === 'all') return new Set(allYears);
    return customYears;
  }, [windowMode, allYears, customYears]);

  // Initialize custom years when switching into custom mode
  const switchToCustom = () => {
    setWindowMode('custom');
    if (customYears.size === 0 && allYears.length > 0) {
      setCustomYears(new Set(allYears));
    }
  };

  const prepared = useMemo(
    () => prepareData(collections ?? [], selectedYears),
    [collections, selectedYears],
  );

  if (isLoading) {
    return (
      <div className="p-6 text-center text-slate-500">Loading collections data…</div>
    );
  }

  if (!collections?.length) {
    return (
      <div className="p-6 text-center text-slate-500">No collections data available.</div>
    );
  }

  const yearsLabel =
    selectedYears.size === 0
      ? 'no years selected'
      : selectedYears.size === 1
        ? Array.from(selectedYears)[0].toString()
        : `${Array.from(selectedYears).sort((a, b) => a - b).join(', ')}`;

  const handleExportCsv = () => {
    const lowWeeks = [...prepared.aggregatedWeeks]
      .sort((a, b) => a.avgTotal - b.avgTotal)
      .slice(0, DISPLAYED_WEEK_COUNT);
    const highWeeks = [...prepared.aggregatedWeeks]
      .sort((a, b) => b.avgTotal - a.avgTotal)
      .slice(0, DISPLAYED_WEEK_COUNT);

    const weekHeaders = [
      'Rank',
      'ISO week',
      'Typical dates',
      'Avg total',
      'Avg individual',
      'Avg group',
      'Years counted',
      'Times in this band',
      'Percent of years',
      'Label',
    ];

    const rows: unknown[][] = [
      ['Historically Low & High Collection Weeks'],
      ['Generated', new Date().toLocaleString()],
      ['Years included', yearsLabel],
      ['Average weekly total', prepared.overallAvg],
      ['Low threshold (33rd percentile)', prepared.lowThreshold],
      ['High threshold (67th percentile)', prepared.highThreshold],
      ['Note', 'Weeks with fewer than 3 records are excluded as incomplete.'],
      [],
    ];

    const pushWeeks = (
      title: string,
      weeks: AggregatedWeek[],
      variant: 'low' | 'high',
    ) => {
      rows.push([title]);
      rows.push(weekHeaders);
      weeks.forEach((week, index) => {
        const share = variant === 'low' ? week.pctLow : week.pctHigh;
        const times = variant === 'low' ? week.lowYearsCount : week.highYearsCount;
        rows.push([
          index + 1,
          week.isoWeek,
          week.sampleDateRange,
          week.avgTotal,
          week.avgIndividual,
          week.avgGroup,
          week.yearsCount,
          times,
          `${share}%`,
          riskInfo(share, variant).label,
        ]);
      });
      rows.push([]);
      rows.push([`${title} — per year`]);
      rows.push([
        'ISO week',
        'Typical dates',
        'Year',
        'Week start',
        'Individual',
        'Group',
        'Total',
      ]);
      for (const week of weeks) {
        for (const instance of week.instances) {
          rows.push([
            week.isoWeek,
            week.sampleDateRange,
            instance.year,
            instance.weekStart,
            instance.individual,
            instance.group,
            instance.total,
          ]);
        }
      }
      rows.push([]);
    };

    if (viewMode === 'both' || viewMode === 'low') {
      pushWeeks('HISTORICALLY LOW WEEKS', lowWeeks, 'low');
    }
    if (viewMode === 'both' || viewMode === 'high') {
      pushWeeks('HISTORICALLY HIGH WEEKS', highWeeks, 'high');
    }

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`low-high-weeks-${stamp}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div
        className="rounded-xl p-5 text-white"
        style={{
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.teal})`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold mb-1">
              Historically Low & High Collection Weeks
            </h2>
            <p className="text-sm opacity-90">
              Ranked by average weekly total · Individual vs. group breakdown · Helps
              you decide when to recruit groups or where natural peaks already do the
              work.
            </p>
            <p className="text-xs opacity-75 mt-2">Years included: {yearsLabel}</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <StatPill
              value={prepared.overallAvg.toLocaleString()}
              label="Avg weekly total"
            />
            <StatPill
              value={prepared.lowThreshold.toLocaleString()}
              label="Low threshold (33rd pct)"
            />
            <StatPill
              value={prepared.highThreshold.toLocaleString()}
              label="High threshold (67th pct)"
            />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-slate-600 mr-1">Window:</span>
          <Button
            variant={windowMode === '2024-2025' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setWindowMode('2024-2025')}
            className="text-xs"
          >
            2024–2025
          </Button>
          <Button
            variant={windowMode === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setWindowMode('all')}
            className="text-xs"
          >
            All-time
          </Button>
          <Button
            variant={windowMode === 'custom' ? 'default' : 'outline'}
            size="sm"
            onClick={switchToCustom}
            className="text-xs"
          >
            Custom
          </Button>
          {windowMode === 'custom' && (
            <YearPicker
              available={allYears}
              selected={customYears}
              onChange={setCustomYears}
            />
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="text-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Export CSV
          </Button>
          <span className="text-xs font-medium text-slate-600 mr-1">View:</span>
          <Button
            variant={viewMode === 'both' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('both')}
            className="text-xs"
          >
            Both
          </Button>
          <Button
            variant={viewMode === 'low' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('low')}
            className="text-xs"
          >
            Low only
          </Button>
          <Button
            variant={viewMode === 'high' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('high')}
            className="text-xs"
          >
            High only
          </Button>
        </div>
      </div>

      {/* Panels */}
      <div
        className={`grid gap-4 ${
          viewMode === 'both' ? 'lg:grid-cols-2 grid-cols-1' : 'grid-cols-1'
        }`}
      >
        {(viewMode === 'both' || viewMode === 'low') && (
          <Panel
            title="Historically Low Weeks"
            icon={<TrendingDown className="w-5 h-5" />}
            weeks={prepared.aggregatedWeeks}
            variant="low"
            description="Calendar weeks that landed below the 33rd-percentile threshold most often. Plan ahead — recruit groups, boost Wednesday social-media asks."
          />
        )}
        {(viewMode === 'both' || viewMode === 'high') && (
          <Panel
            title="Historically High Weeks"
            icon={<TrendingUp className="w-5 h-5" />}
            weeks={prepared.aggregatedWeeks}
            variant="high"
            description="Calendar weeks that landed above the 67th-percentile threshold most often. Natural peaks — protect them by avoiding logistics changes."
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2">
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm inline-block flex-shrink-0"
            style={{ background: COLORS.primary }}
          />
          Individual (Wednesday sandwich makers)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm inline-block flex-shrink-0"
            style={{ background: COLORS.accent }}
          />
          Group collections
        </span>
        <span className="ml-auto">
          Weeks with fewer than 3 records are treated as incomplete and excluded.
        </span>
      </div>
    </div>
  );
}
