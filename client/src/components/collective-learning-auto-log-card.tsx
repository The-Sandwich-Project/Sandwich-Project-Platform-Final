import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Repeat, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

const ENDPOINT = '/api/collective-learning-auto-log';

interface AutoLogConfig {
  enabled: boolean;
  hostName: string;
  defaultCount: number;
}

interface Override {
  id: number;
  weekOf: string;
  skipped: boolean;
  count: number | null;
  note: string | null;
  createdByName: string | null;
}

interface AutoEntry {
  id: number;
  collectionDate: string;
  individualSandwiches: number;
  deletedAt: string | null;
}

interface AutoLogStatus {
  config: AutoLogConfig;
  today: string;
  currentWeekOf: string;
  currentWeekHoliday: { excluded: boolean; reason?: string };
  overrides: Override[];
  recentAutoEntries: AutoEntry[];
}

interface ReconcileResult {
  weekOf: string;
  outcome: string;
  count: number | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  created: 'logged',
  updated: 'updated',
  restored: 'restored',
  removed: 'removed the auto entry',
  unchanged: 'already up to date',
  skipped_disabled: 'auto-log is off',
  skipped_future: 'saved — will apply when that week starts',
  skipped_override: 'no entry (marked as not collected)',
  skipped_holiday: 'no entry (holiday week)',
  skipped_manual_entry: 'no auto entry — someone already logged a real count that week',
};

function describe(result: ReconcileResult): string {
  const label = OUTCOME_LABELS[result.outcome] ?? result.outcome;
  return result.count != null && ['created', 'updated', 'restored', 'unchanged'].includes(result.outcome)
    ? `Week of ${formatWeek(result.weekOf)}: ${label} (${result.count})`
    : `Week of ${formatWeek(result.weekOf)}: ${label}`;
}

function formatWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Admin card on the Collections page for the weekly Collective Learning
 * auto-log: on/off, default count, and per-week "didn't collect" /
 * "collected N" overrides.
 */
export default function CollectiveLearningAutoLogCard() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [weekOf, setWeekOf] = useState('');
  const [mode, setMode] = useState<'skipped' | 'count'>('skipped');
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [defaultCountDraft, setDefaultCountDraft] = useState('');
  const [backfillFrom, setBackfillFrom] = useState('');
  const [backfillThrough, setBackfillThrough] = useState('');
  const [backfillResults, setBackfillResults] = useState<ReconcileResult[] | null>(null);

  const { data: status, isLoading } = useQuery<AutoLogStatus>({
    queryKey: [ENDPOINT],
  });

  // Edits, deletes and undo in the Collections log can change auto entries and
  // their overrides, but those handlers only refresh the collections queries.
  // Refresh this card whenever the collections list reloads.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        event.query.queryKey[0] === '/api/sandwich-collections'
      ) {
        queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      }
    });
  }, []);

  useEffect(() => {
    if (status && !weekOf) setWeekOf(status.currentWeekOf);
    if (status && defaultCountDraft === '') setDefaultCountDraft(String(status.config.defaultCount));
  }, [status, weekOf, defaultCountDraft]);

  const onDone = (result?: ReconcileResult) => {
    queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
    queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections'] });
    queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections/stats'] });
    if (result) toast({ title: 'Collective Learning auto-log', description: describe(result) });
  };
  const onError = (error: Error) =>
    toast({ title: 'Something went wrong', description: error.message, variant: 'destructive' });

  const configMutation = useMutation({
    mutationFn: (patch: Partial<AutoLogConfig>) => apiRequest('PATCH', `${ENDPOINT}/config`, patch),
    onSuccess: (res) => onDone(res.reconcile),
    onError,
  });

  const overrideMutation = useMutation({
    mutationFn: () =>
      apiRequest('PUT', `${ENDPOINT}/overrides`, {
        weekOf,
        skipped: mode === 'skipped',
        count: mode === 'count' ? Number(count) : null,
        note: note || null,
      }),
    onSuccess: (res) => {
      setNote('');
      setCount('');
      onDone(res.reconcile);
    },
    onError,
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (week: string) => apiRequest('DELETE', `${ENDPOINT}/overrides/${week}`),
    onSuccess: (res) => onDone(res.reconcile),
    onError,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest('POST', `${ENDPOINT}/run`, {}),
    onSuccess: (res) => onDone(res),
    onError,
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', `${ENDPOINT}/backfill`, {
        from: backfillFrom,
        ...(backfillThrough ? { through: backfillThrough } : {}),
      }),
    onSuccess: (res: { results: ReconcileResult[] }) => {
      setBackfillResults(res.results);
      const filled = res.results.filter((r) => ['created', 'restored', 'updated'].includes(r.outcome)).length;
      onDone();
      toast({
        title: 'Past weeks filled in',
        description: `${filled} of ${res.results.length} weeks logged; the rest were left alone (see list).`,
      });
    },
    onError,
  });

  if (isLoading || !status) return null;

  const { config } = status;
  const currentOverride = status.overrides.find((o) => o.weekOf === status.currentWeekOf);
  const thisWeekText = !config.enabled
    ? 'Auto-log is off'
    : currentOverride?.skipped
      ? 'Marked as not collected'
      : currentOverride?.count != null
        ? `${currentOverride.count} PBJ (override)`
        : status.currentWeekHoliday.excluded
          ? `Holiday week (${status.currentWeekHoliday.reason}) — nothing logged`
          : `${config.defaultCount} PBJ (default)`;

  const countValid = mode === 'skipped' || (count !== '' && Number.isInteger(Number(count)) && Number(count) >= 0);
  const defaultCountValid =
    defaultCountDraft !== '' && Number.isInteger(Number(defaultCountDraft)) && Number(defaultCountDraft) >= 0;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        data-testid="button-toggle-cl-auto-log"
      >
        <div className="flex items-start gap-2 min-w-0">
          <Repeat className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#007E8C' }} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {config.hostName} weekly auto-log
              <span className={`ml-2 text-xs font-normal ${config.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                {config.enabled ? 'On' : 'Off'}
              </span>
            </p>
            <p className="text-xs text-slate-600 truncate">
              Week of {formatWeek(status.currentWeekOf)}: {thisWeekText}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-5 border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600">
            Every week this logs <strong>{config.defaultCount} PB&amp;J</strong> for {config.hostName}, dated the
            Wednesday of the week. Use an override below when they didn't collect or made a different number —
            it works before or after the week is logged. Holiday weeks and weeks where someone logs a real
            count are left alone automatically. Editing an auto entry in the log below turns it into a regular log
            entry with your numbers; deleting one marks that week "didn't collect."
          </p>

          {/* Settings */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="cl-auto-log-enabled"
                checked={config.enabled}
                disabled={configMutation.isPending}
                onCheckedChange={(enabled) => configMutation.mutate({ enabled })}
              />
              <Label htmlFor="cl-auto-log-enabled">Auto-log every week</Label>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="cl-default-count" className="text-xs">Default weekly count</Label>
                <Input
                  id="cl-default-count"
                  type="number"
                  min={0}
                  className="w-28 h-9"
                  value={defaultCountDraft}
                  onChange={(e) => setDefaultCountDraft(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !defaultCountValid ||
                  Number(defaultCountDraft) === config.defaultCount ||
                  configMutation.isPending
                }
                onClick={() => configMutation.mutate({ defaultCount: Number(defaultCountDraft) })}
              >
                Save
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="sm:ml-auto"
              disabled={runMutation.isPending}
              onClick={() => runMutation.mutate()}
            >
              Run this week now
            </Button>
          </div>

          {/* Override form */}
          <div className="rounded border border-slate-200 bg-white p-3 space-y-3">
            <p className="text-sm font-medium text-slate-900">Change a week</p>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div>
                <Label htmlFor="cl-override-week" className="text-xs">Any day in the week</Label>
                <Input
                  id="cl-override-week"
                  type="date"
                  className="h-9"
                  value={weekOf}
                  onChange={(e) => setWeekOf(e.target.value)}
                />
              </div>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as 'skipped' | 'count')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="skipped" id="cl-mode-skipped" />
                  <Label htmlFor="cl-mode-skipped" className="text-sm">Didn't collect</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="count" id="cl-mode-count" />
                  <Label htmlFor="cl-mode-count" className="text-sm">Collected</Label>
                </div>
              </RadioGroup>
              {mode === 'count' && (
                <Input
                  type="number"
                  min={0}
                  placeholder="# PBJ"
                  className="w-28 h-9"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              )}
            </div>
            <Input
              placeholder="Note (optional)"
              className="h-9"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!weekOf || !countValid || overrideMutation.isPending}
              onClick={() => overrideMutation.mutate()}
              style={{ backgroundColor: '#007E8C' }}
            >
              Save override
            </Button>
          </div>

          {/* Backfill */}
          <div className="rounded border border-slate-200 bg-white p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Fill in past weeks</p>
              <p className="text-xs text-slate-600">
                Logs the default count for every week in the range that's still missing. Weeks with a real
                log, holiday weeks, and weeks marked "didn't collect" above are skipped, so mark any
                intentional gaps first.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div>
                <Label htmlFor="cl-backfill-from" className="text-xs">From</Label>
                <Input
                  id="cl-backfill-from"
                  type="date"
                  className="h-9"
                  value={backfillFrom}
                  onChange={(e) => setBackfillFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cl-backfill-through" className="text-xs">Through (blank = this week)</Label>
                <Input
                  id="cl-backfill-through"
                  type="date"
                  className="h-9"
                  value={backfillThrough}
                  onChange={(e) => setBackfillThrough(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!backfillFrom || backfillMutation.isPending}
                onClick={() => backfillMutation.mutate()}
              >
                {backfillMutation.isPending ? 'Filling in…' : 'Fill in missing weeks'}
              </Button>
            </div>
            {backfillResults && (
              <ul className="text-xs text-slate-600 space-y-0.5 max-h-48 overflow-y-auto">
                {backfillResults.map((r) => (
                  <li key={r.weekOf}>{describe(r)}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Existing overrides */}
          {status.overrides.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-900 mb-2">Overrides</p>
              <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                {[...status.overrides].reverse().map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">Week of {formatWeek(o.weekOf)}</span>
                      <span className="text-slate-600">
                        {' — '}
                        {o.skipped ? "didn't collect" : `${o.count} PBJ`}
                      </span>
                      {o.note && <span className="text-slate-500"> · {o.note}</span>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove override for week of ${o.weekOf}`}
                      disabled={deleteOverrideMutation.isPending}
                      onClick={() => deleteOverrideMutation.mutate(o.weekOf)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recent auto entries */}
          {status.recentAutoEntries.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-900 mb-1">Recent auto-logged weeks</p>
              <p className="text-xs text-slate-600">
                {status.recentAutoEntries
                  .map(
                    (e) =>
                      `${formatWeek(e.collectionDate)}: ${e.deletedAt ? 'removed' : e.individualSandwiches}`
                  )
                  .join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
