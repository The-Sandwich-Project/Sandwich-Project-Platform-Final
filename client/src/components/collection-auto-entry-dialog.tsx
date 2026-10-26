import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatDateForDisplay } from '@shared/date-utils';

const SCHEDULE_KEY = 'collective-learning';
const WEEKS_URL = `/api/collection-auto-entries/${SCHEDULE_KEY}/weeks`;

type OverrideAction = 'default' | 'skip' | 'count';

interface WeekStatus {
  weekDate: string;
  override: { action: 'skip' | 'count'; count: number | null } | null;
  autoEntry: { id: number; count: number; deleted: boolean } | null;
  manualEntryCount: number;
  isFuture: boolean;
  beforeStart: boolean;
}

interface WeeksResponse {
  schedule: { hostName: string; defaultPbjCount: number; startWeek: string };
  weeks: WeekStatus[];
}

function describeWeek(week: WeekStatus, defaultCount: number): string {
  if (week.beforeStart) return 'Before automatic entries started';
  if (week.manualEntryCount > 0) return 'Entered manually — no automatic entry';
  if (week.isFuture) {
    if (week.override?.action === 'skip') return 'Will skip';
    if (week.override?.action === 'count') return `Will record ${week.override.count} PBJ`;
    return `Will record ${defaultCount} PBJ`;
  }
  if (week.autoEntry && !week.autoEntry.deleted) {
    return `Recorded ${week.autoEntry.count} PBJ automatically`;
  }
  if (week.override?.action === 'skip') return 'Skipped — didn’t collect';
  if (week.autoEntry?.deleted) return 'Automatic entry was deleted';
  return 'Pending — records tonight at 8 PM';
}

function WeekRow({ week, defaultCount }: { week: WeekStatus; defaultCount: number }) {
  const { toast } = useToast();
  const currentAction: OverrideAction = week.override?.action ?? 'default';
  const [action, setAction] = useState<OverrideAction>(currentAction);
  const [count, setCount] = useState(String(week.override?.count ?? defaultCount));

  const save = useMutation({
    mutationFn: () =>
      apiRequest('PUT', `${WEEKS_URL}/${week.weekDate}`, {
        action,
        ...(action === 'count' ? { count: Number(count) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WEEKS_URL] });
      queryClient.invalidateQueries({ queryKey: ['/api/sandwich-collections'] });
      toast({ title: 'Saved', description: `Week of ${formatDateForDisplay(week.weekDate)} updated.` });
    },
    onError: (error: any) =>
      toast({ title: 'Could not save', description: error?.message, variant: 'destructive' }),
  });

  const countValid = /^\d+$/.test(count);
  const dirty =
    action !== currentAction ||
    (action === 'count' && Number(count) !== (week.override?.count ?? NaN));

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Wed {formatDateForDisplay(week.weekDate)}</span>
        <span className="text-xs text-slate-500">{describeWeek(week, defaultCount)}</span>
      </div>
      {!week.beforeStart && (
        <div className="flex flex-wrap items-center gap-2">
          {(['default', 'skip', 'count'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={action === value ? 'default' : 'outline'}
              onClick={() => setAction(value)}
            >
              {value === 'default'
                ? `${defaultCount} (usual)`
                : value === 'skip'
                  ? "Didn't collect"
                  : 'Different number'}
            </Button>
          ))}
          {action === 'count' && (
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              className="w-24 h-8"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-label="PBJ count"
            />
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!dirty || save.isPending || (action === 'count' && !countValid)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CollectionAutoEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useQuery<WeeksResponse>({
    queryKey: [WEEKS_URL],
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="w-4 h-4" />
            {data?.schedule.hostName ?? 'Collective Learning'} weekly entry
          </DialogTitle>
          <DialogDescription>
            {data?.schedule.defaultPbjCount ?? 250} PBJ is recorded automatically each
            Wednesday. Change a week if they didn&apos;t collect or collected a different
            number — already-recorded entries update right away.{' '}
            <Badge variant="outline">Auto</Badge> marks these entries in the log.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-2">
            {data.weeks.map((week) => (
              <WeekRow
                // Remount when server state changes so local edits reset
                key={`${week.weekDate}:${week.override?.action ?? 'default'}:${week.override?.count ?? ''}`}
                week={week}
                defaultCount={data.schedule.defaultPbjCount}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CollectionAutoEntryDialog;
