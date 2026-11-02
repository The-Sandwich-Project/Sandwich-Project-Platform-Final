import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendingUp, TrendingDown, Target, Calendar, Pencil, Check, X, Minus, ArrowRight, Download } from 'lucide-react';
import { useAnnualSandwichGoal, useUpdateAppSetting } from '@/hooks/useAppSettings';
import { useAuth } from '@/hooks/useAuth';
import { ANNUAL_SANDWICH_GOAL_KEY } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { SandwichCollection } from '@shared/schema';
import {
  calculateGroupSandwiches,
  calculateTotalSandwiches,
  parseCollectionDate,
} from '@/lib/analytics-utils';
import { downloadCsv } from '@/lib/csv-download';


type PresetKey = 'ytd' | 'mtd' | 'qtd' | 'last7' | 'last30' | 'last90' | 'custom';

interface Period {
  start: Date;
  end: Date;
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function shiftYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
function fmtDateRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = sameYear
    ? start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}
function daysBetween(start: Date, end: Date): number {
  const ms = endOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.max(1, Math.round(ms / (86400 * 1000)));
}
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}
function pct(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}
function fmtPct(p: number | null, withSign = true): string {
  if (p === null || !isFinite(p)) return '—';
  const sign = withSign && p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}
function fmtDelta(curr: number, prev: number): string {
  const diff = curr - prev;
  if (diff === 0) return 'Same as last year';
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${fmtNum(Math.abs(diff))} vs last year`;
}

/** Min |YoY change| (percentage points; pct() returns e.g. 5 for 5%) before showing up/down vs flat. */
const FLAT_TREND_THRESHOLD_PCT = 3;

function trendTone(pctValue: number | null): 'up' | 'down' | 'flat' | 'unknown' {
  if (pctValue === null || !isFinite(pctValue)) return 'unknown';
  if (Math.abs(pctValue) < FLAT_TREND_THRESHOLD_PCT) return 'flat';
  return pctValue > 0 ? 'up' : 'down';
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromISODate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

function getPresetPeriod(preset: PresetKey, now: Date): Period {
  const today = startOfDay(now);
  switch (preset) {
    case 'ytd':
      return {
        start: new Date(today.getFullYear(), 0, 1),
        end: endOfDay(today),
        label: 'Year to date',
      };
    case 'mtd':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: endOfDay(today),
        label: 'Month to date',
      };
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3);
      return {
        start: new Date(today.getFullYear(), q * 3, 1),
        end: endOfDay(today),
        label: 'Quarter to date',
      };
    }
    case 'last7':
      return { start: addDays(today, -6), end: endOfDay(today), label: 'Last 7 days' };
    case 'last30':
      return { start: addDays(today, -29), end: endOfDay(today), label: 'Last 30 days' };
    case 'last90':
      return { start: addDays(today, -89), end: endOfDay(today), label: 'Last 90 days' };
    default:
      return { start: today, end: endOfDay(today), label: 'Custom' };
  }
}

interface Totals {
  total: number;
  individual: number;
  group: number;
  entries: number;
}

function totalsForPeriod(
  collections: SandwichCollection[],
  start: Date,
  end: Date
): Totals {
  let total = 0;
  let individual = 0;
  let group = 0;
  let entries = 0;
  for (const c of collections) {
    const d = parseCollectionDate(c.collectionDate as unknown as string);
    if (isNaN(d.getTime())) continue;
    if (d < start || d > end) continue;
    entries++;
    individual += Number(c.individualSandwiches || 0);
    group += calculateGroupSandwiches(c);
    total += calculateTotalSandwiches(c);
  }
  return { total, individual, group, entries };
}

interface MonthBucket {
  month: string;
  monthIdx: number;
  current: number;
  prior: number;
}

function monthlyBreakdown(
  collections: SandwichCollection[],
  currentYear: number,
  priorYear: number,
  ytdCutoffMonth: number,
  ytdCutoffDay: number
): MonthBucket[] {
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const buckets: MonthBucket[] = monthNames.map((m, i) => ({
    month: m,
    monthIdx: i,
    current: 0,
    prior: 0,
  }));
  for (const c of collections) {
    const d = parseCollectionDate(c.collectionDate as unknown as string);
    if (isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    if (y !== currentYear && y !== priorYear) continue;
    // For both years, only count up through the same cutoff date for fair comparison
    if (m > ytdCutoffMonth) continue;
    if (m === ytdCutoffMonth && day > ytdCutoffDay) continue;
    const total = calculateTotalSandwiches(c);
    if (y === currentYear) buckets[m].current += total;
    else buckets[m].prior += total;
  }
  // Trim months after the cutoff for cleaner chart
  return buckets.slice(0, ytdCutoffMonth + 1);
}

export default function PaceComparisonAnalytics() {
  const [preset, setPreset] = useState<PresetKey>('ytd');
  const [customStart, setCustomStart] = useState<string>(
    toISODate(new Date(new Date().getFullYear(), 0, 1))
  );
  const [customEnd, setCustomEnd] = useState<string>(toISODate(new Date()));
  const ANNUAL_GOAL = useAnnualSandwichGoal();
  const { user } = useAuth();
  const canEditGoal = !!user && ['admin', 'super_admin', 'admin_coordinator'].includes((user as any).role);
  const updateSetting = useUpdateAppSetting();
  const { toast } = useToast();
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  const { data, isLoading } = useQuery<{ collections: SandwichCollection[] }>({
    queryKey: ['/api/sandwich-collections', { all: true, limit: 10000 }],
    queryFn: async () => {
      const res = await fetch('/api/sandwich-collections?page=1&limit=10000');
      if (!res.ok) throw new Error('Failed to load collections');
      return res.json();
    },
  });

  const now = new Date();
  const currentPeriod: Period = useMemo(() => {
    if (preset === 'custom') {
      const s = fromISODate(customStart);
      const e = endOfDay(fromISODate(customEnd));
      return { start: s, end: e, label: 'Custom range' };
    }
    return getPresetPeriod(preset, now);
  }, [preset, customStart, customEnd, now]);

  const priorYearPeriod: Period = useMemo(
    () => ({
      start: shiftYears(currentPeriod.start, -1),
      end: shiftYears(currentPeriod.end, -1),
      label: `${currentPeriod.label}, prior year`,
    }),
    [currentPeriod]
  );

  const priorPeriod: Period = useMemo(() => {
    const lengthMs = currentPeriod.end.getTime() - currentPeriod.start.getTime();
    const end = addDays(currentPeriod.start, -1);
    const start = new Date(end.getTime() - lengthMs);
    return { start: startOfDay(start), end: endOfDay(end), label: 'Prior equal-length period' };
  }, [currentPeriod]);

  const collections = data?.collections || [];

  const curr = useMemo(
    () => totalsForPeriod(collections, currentPeriod.start, currentPeriod.end),
    [collections, currentPeriod]
  );
  const ly = useMemo(
    () => totalsForPeriod(collections, priorYearPeriod.start, priorYearPeriod.end),
    [collections, priorYearPeriod]
  );
  const pp = useMemo(
    () => totalsForPeriod(collections, priorPeriod.start, priorPeriod.end),
    [collections, priorPeriod]
  );

  // Year-end projection (only meaningful for YTD)
  const projection = useMemo(() => {
    if (preset !== 'ytd') return null;
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const dayOfYear =
      Math.floor((now.getTime() - yearStart.getTime()) / (86400 * 1000)) + 1;
    const daysInYear =
      ((now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) ||
      now.getFullYear() % 400 === 0
        ? 366
        : 365);
    const projected = Math.round((curr.total / dayOfYear) * daysInYear);
    return { projected, dayOfYear, daysInYear };
  }, [curr.total, preset, now]);

  // Monthly chart data
  const monthly = useMemo(() => {
    if (preset !== 'ytd') return null;
    return monthlyBreakdown(
      collections,
      now.getFullYear(),
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate()
    );
  }, [collections, preset, now]);

  // Narrative
  const narrative = useMemo(() => {
    if (isLoading) return [];
    const lines: string[] = [];
    const yoyPct = pct(curr.total, ly.total);
    if (yoyPct !== null) {
      const diff = curr.total - ly.total;
      lines.push(
        diff >= 0
          ? `You're ahead of this time last year by ${fmtNum(diff)} sandwiches (${fmtPct(yoyPct)}).`
          : `You're behind this time last year by ${fmtNum(Math.abs(diff))} sandwiches (${fmtPct(yoyPct)}).`
      );
    }
    const indivPct = pct(curr.individual, ly.individual);
    const groupPct = pct(curr.group, ly.group);
    if (indivPct !== null && groupPct !== null) {
      if (Math.abs(groupPct) > Math.abs(indivPct) && Math.abs(groupPct) > 10) {
        lines.push(
          groupPct > 0
            ? `Growth is driven by group events — group sandwiches are up ${fmtPct(groupPct, false)} vs last year.`
            : `Group event totals are down ${fmtPct(Math.abs(groupPct), false)} vs last year — worth a look.`
        );
      } else if (Math.abs(indivPct) > 10) {
        lines.push(
          indivPct > 0
            ? `Individual collections are up ${fmtPct(indivPct, false)} vs last year.`
            : `Individual collections are down ${fmtPct(Math.abs(indivPct), false)} vs last year.`
        );
      }
    }
    if (projection) {
      const pctOfGoal = (projection.projected / ANNUAL_GOAL) * 100;
      lines.push(
        `At current pace you'll finish around ${fmtNum(projection.projected)} — about ${pctOfGoal.toFixed(0)}% of the ${fmtNum(ANNUAL_GOAL)} goal.`
      );
    }
    return lines;
  }, [curr, ly, projection, isLoading, ANNUAL_GOAL]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const yoyPctTotal = pct(curr.total, ly.total);
  const ppPctTotal = pct(curr.total, pp.total);
  const yoyTone = trendTone(yoyPctTotal);
  const headline =
    yoyPctTotal === null
      ? `Tracking ${fmtNum(curr.total)} sandwiches for ${currentPeriod.label.toLowerCase()}.`
      : yoyTone === 'flat'
        ? `${fmtNum(curr.total)} sandwiches so far — about the same as this point last year.`
        : yoyTone === 'up'
          ? `${fmtNum(curr.total)} sandwiches so far — ${fmtPct(yoyPctTotal)} ahead of this point last year.`
          : `${fmtNum(curr.total)} sandwiches so far — ${fmtPct(yoyPctTotal)} behind this point last year.`;

  const currentRangeLabel = fmtDateRange(currentPeriod.start, currentPeriod.end);
  const lyRangeLabel = fmtDateRange(priorYearPeriod.start, priorYearPeriod.end);
  const ppDayCount = daysBetween(priorPeriod.start, priorPeriod.end);
  const ppRangeLabel = fmtDateRange(priorPeriod.start, priorPeriod.end);

  const monthlyYtdCurrent = monthly?.reduce((sum, m) => sum + m.current, 0) ?? 0;
  const monthlyYtdPrior = monthly?.reduce((sum, m) => sum + m.prior, 0) ?? 0;
  const monthlyYtdPct = pct(monthlyYtdCurrent, monthlyYtdPrior);

  const handleExportCsv = () => {
    const rows: unknown[][] = [
      ['Pace & Comparison'],
      ['Generated', new Date().toLocaleString()],
      ['Period', currentPeriod.label],
      ['Current window', currentRangeLabel],
      ['Same dates last year', lyRangeLabel],
      ['Prior period', ppRangeLabel],
      [],
      ['SUMMARY'],
      [
        'Metric',
        'This period',
        'Same dates last year',
        'Change vs last year',
        `Prior ${ppDayCount} days`,
        'Change vs prior period',
      ],
      [
        'Total sandwiches',
        curr.total,
        ly.total,
        fmtPct(yoyPctTotal),
        pp.total,
        fmtPct(ppPctTotal),
      ],
      [
        'Individual',
        curr.individual,
        ly.individual,
        fmtPct(pct(curr.individual, ly.individual)),
        pp.individual,
        fmtPct(pct(curr.individual, pp.individual)),
      ],
      [
        'Group events',
        curr.group,
        ly.group,
        fmtPct(pct(curr.group, ly.group)),
        pp.group,
        fmtPct(pct(curr.group, pp.group)),
      ],
      ['Collection entries', curr.entries, ly.entries, '', pp.entries, ''],
    ];

    if (projection) {
      rows.push(
        [],
        ['YEAR-END PACE'],
        ['Projected total', projection.projected],
        ['Annual goal', ANNUAL_GOAL],
        ['Day of year', projection.dayOfYear],
        ['Days in year', projection.daysInYear],
        [
          'Percent of goal',
          `${((projection.projected / ANNUAL_GOAL) * 100).toFixed(0)}%`,
        ]
      );
    }

    if (monthly) {
      rows.push(
        [],
        ['MONTHLY COMPARISON'],
        ['Month', String(now.getFullYear()), String(now.getFullYear() - 1), 'Change']
      );
      for (const bucket of monthly) {
        rows.push([
          bucket.month,
          bucket.current,
          bucket.prior,
          fmtPct(pct(bucket.current, bucket.prior)),
        ]);
      }
      rows.push(['Year to date', monthlyYtdCurrent, monthlyYtdPrior, fmtPct(monthlyYtdPct)]);
    }

    if (narrative.length > 0) {
      rows.push([], ['NOTES']);
      for (const line of narrative) {
        rows.push([line]);
      }
    }

    downloadCsv(`pace-comparison-${toISODate(now)}.csv`, rows);
  };

  return (
    <div className="space-y-5">
      {/* Period picker — compact */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5 text-[#236383]" /> Time period
              </CardTitle>
              <CardDescription className="mt-1.5">
                Pick a window, then compare totals to the same dates last year and the immediately preceding period.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="w-4 h-4 mr-1.5" />
                Export CSV
              </Button>
              <Badge variant="outline" className="w-fit shrink-0 bg-slate-50 text-slate-700 font-normal">
                {currentPeriod.label} · {currentRangeLabel}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {([
              ['ytd', 'Year to date'],
              ['mtd', 'Month to date'],
              ['qtd', 'Quarter to date'],
              ['last7', 'Last 7 days'],
              ['last30', 'Last 30 days'],
              ['last90', 'Last 90 days'],
              ['custom', 'Custom…'],
            ] as [PresetKey, string][]).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={preset === k ? 'default' : 'outline'}
                className={preset === k ? 'bg-[#236383] hover:bg-[#236383]' : ''}
                onClick={() => setPreset(k)}
              >
                {label}
              </Button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex flex-wrap items-end gap-3 mt-3">
              <div>
                <Label htmlFor="pc-start">From</Label>
                <Input
                  id="pc-start"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-44"
                />
              </div>
              <div>
                <Label htmlFor="pc-end">To</Label>
                <Input
                  id="pc-end"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-44"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* At-a-glance headline */}
      <Card className="border-2 border-[#236383]/20 bg-gradient-to-br from-[#236383]/5 via-white to-[#236383]/5">
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2 min-w-0">
              <p className="text-sm font-medium uppercase tracking-wide text-[#236383]">
                At a glance
              </p>
              <p className="text-xl sm:text-2xl font-semibold text-slate-900 leading-snug">
                {headline}
              </p>
              {curr.entries > 0 && (
                <p className="text-sm text-slate-600">
                  Based on {curr.entries.toLocaleString()} collection{' '}
                  {curr.entries === 1 ? 'entry' : 'entries'} through{' '}
                  {fmtDate(currentPeriod.end)}.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3 shrink-0">
              <SnapshotStat
                label="This period"
                value={curr.total}
                emphasize
              />
              <div className="hidden sm:flex items-center text-slate-300 px-1">
                <ArrowRight className="h-5 w-5" />
              </div>
              <SnapshotStat label="Same dates last year" value={ly.total} />
              <TrendPill pct={yoyPctTotal} diff={curr.total - ly.total} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown cards */}
      <div>
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-slate-800">Breakdown by type</h3>
          <p className="text-xs text-slate-500">
            Last year window: {lyRangeLabel}
            {ppPctTotal !== null && (
              <> · Prior {ppDayCount}-day window: {ppRangeLabel}</>
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ComparisonCard
            title="Total sandwiches"
            current={curr.total}
            comparisons={[
              { shortLabel: 'Last year', detail: lyRangeLabel, value: ly.total, pct: yoyPctTotal },
              { shortLabel: `Prior ${ppDayCount} days`, detail: ppRangeLabel, value: pp.total, pct: ppPctTotal },
            ]}
          />
          <ComparisonCard
            title="Individual"
            current={curr.individual}
            comparisons={[
              {
                shortLabel: 'Last year',
                detail: lyRangeLabel,
                value: ly.individual,
                pct: pct(curr.individual, ly.individual),
              },
            ]}
          />
          <ComparisonCard
            title="Group events"
            current={curr.group}
            comparisons={[
              {
                shortLabel: 'Last year',
                detail: lyRangeLabel,
                value: ly.group,
                pct: pct(curr.group, ly.group),
              },
            ]}
          />
        </div>
      </div>

      {/* Year-end projection (YTD only) */}
      {projection && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-[#236383]" /> Year-end pace
                </CardTitle>
                <CardDescription>
                  Day {projection.dayOfYear} of {projection.daysInYear} — if collections continue at today&apos;s rate.
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className={
                  projection.projected >= ANNUAL_GOAL
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }
              >
                {projection.projected >= ANNUAL_GOAL ? 'On pace for goal' : 'Below annual goal at current pace'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Projected total
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {fmtNum(projection.projected)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Annual goal
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-slate-900">{fmtNum(ANNUAL_GOAL)}</p>
                  {canEditGoal && !editingGoal && (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalDraft(String(ANNUAL_GOAL));
                        setEditingGoal(true);
                      }}
                      className="text-slate-400 hover:text-slate-700"
                      title="Edit annual goal"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {editingGoal && (
                  <div className="flex items-center gap-1 mt-2">
                    <Input
                      type="number"
                      min={1}
                      value={goalDraft}
                      onChange={(e) => setGoalDraft(e.target.value)}
                      className="w-32 h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={updateSetting.isPending}
                      onClick={() => {
                        const n = parseInt(goalDraft, 10);
                        if (!Number.isFinite(n) || n <= 0) {
                          toast({
                            title: 'Invalid goal',
                            description: 'Enter a positive whole number.',
                            variant: 'destructive',
                          });
                          return;
                        }
                        updateSetting.mutate(
                          { key: ANNUAL_SANDWICH_GOAL_KEY, value: String(n) },
                          {
                            onSuccess: () => {
                              setEditingGoal(false);
                              toast({ title: 'Annual goal updated' });
                            },
                            onError: (err: any) => {
                              toast({
                                title: 'Could not update goal',
                                description: err?.message || 'Please try again.',
                                variant: 'destructive',
                              });
                            },
                          }
                        );
                      }}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => setEditingGoal(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  % of goal
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {((projection.projected / ANNUAL_GOAL) * 100).toFixed(0)}%
                </p>
              </div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs text-slate-600">
                <span>0</span>
                <span>Goal: {fmtNum(ANNUAL_GOAL)}</span>
              </div>
              <div className="h-4 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full transition-all ${projection.projected >= ANNUAL_GOAL ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{
                    width: `${Math.min(100, (projection.projected / ANNUAL_GOAL) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {projection.projected >= ANNUAL_GOAL
                  ? `Projected to exceed the goal by ${fmtNum(projection.projected - ANNUAL_GOAL)} sandwiches.`
                  : `Projected to fall short of the goal by ${fmtNum(ANNUAL_GOAL - projection.projected)} sandwiches.`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly side-by-side chart (YTD only) */}
      {monthly && monthly.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Month by month: {now.getFullYear()} vs {now.getFullYear() - 1}
            </CardTitle>
            <CardDescription>
              Each month only counts through the same day-of-month so the comparison stays fair.
              {monthlyYtdPct !== null && (
                <span className="block mt-1 font-medium text-slate-700">
                  YTD total is {fmtPct(monthlyYtdPct)} vs the same point last year (
                  {fmtNum(monthlyYtdCurrent)} vs {fmtNum(monthlyYtdPrior)}).
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => fmtNum(v)} />
                  <Tooltip formatter={(value: number) => fmtNum(value)} />
                  <Legend />
                  <Bar
                    dataKey="prior"
                    name={`${now.getFullYear() - 1}`}
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="current"
                    name={`${now.getFullYear()}`}
                    fill="#236383"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Narrative insights */}
      {narrative.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">What&apos;s driving the change</CardTitle>
            <CardDescription>Quick read on individual vs group collections and year-end outlook.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              {narrative.map((line, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 leading-relaxed"
                >
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SnapshotStat({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 min-w-[140px] ${
        emphasize ? 'border-[#236383]/30 bg-white shadow-sm' : 'border-slate-200 bg-white/80'
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 font-bold text-slate-900 ${emphasize ? 'text-2xl' : 'text-xl'}`}>
        {fmtNum(value)}
      </p>
    </div>
  );
}

function TrendPill({ pct, diff }: { pct: number | null; diff: number }) {
  const tone = trendTone(pct);
  const classes =
    tone === 'up'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'down'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : tone === 'flat'
          ? 'border-slate-200 bg-slate-50 text-slate-700'
          : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <div className={`rounded-lg border px-4 py-3 min-w-[140px] ${classes}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">Change</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {tone === 'up' && <TrendingUp className="h-5 w-5 shrink-0" />}
        {tone === 'down' && <TrendingDown className="h-5 w-5 shrink-0" />}
        {tone === 'flat' && <Minus className="h-5 w-5 shrink-0" />}
        <span className="text-xl font-bold">{pct === null ? '—' : fmtPct(pct)}</span>
      </div>
      {pct !== null && diff !== 0 && (
        <p className="mt-1 text-xs opacity-90">
          {diff > 0 ? '+' : '−'}
          {fmtNum(Math.abs(diff))} sandwiches
        </p>
      )}
    </div>
  );
}

function ComparisonCard({
  title,
  current,
  comparisons,
}: {
  title: string;
  current: number;
  comparisons: { shortLabel: string; detail?: string; value: number; pct: number | null }[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 bg-slate-50/80 border-b border-slate-100">
        <CardTitle className="text-sm font-semibold text-slate-700">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="text-3xl font-bold text-slate-900 tabular-nums">{fmtNum(current)}</div>
        <div className="mt-4 space-y-2">
          {comparisons.map((c, i) => {
            const tone = trendTone(c.pct);
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">{c.shortLabel}</p>
                  {c.detail && (
                    <p className="text-[11px] text-slate-500 truncate" title={c.detail}>
                      {c.detail}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-slate-800 tabular-nums">
                    {fmtNum(c.value)}
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      tone === 'unknown'
                        ? 'text-slate-600'
                        : tone === 'up'
                          ? 'text-emerald-800 border-emerald-200 bg-emerald-50'
                          : tone === 'down'
                            ? 'text-rose-800 border-rose-200 bg-rose-50'
                            : 'text-slate-700 border-slate-200 bg-white'
                    }
                  >
                    {c.pct === null ? '—' : fmtPct(c.pct)}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
