import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest, invalidateEventRequestQueries } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { FileSpreadsheet, ShieldCheck, AlertTriangle } from 'lucide-react';

interface PreviewRow {
  rowIndex: number;
  fingerprint: string;
  date: string;
  dateDisplay: string;
  groupName: string;
  estimateSandwiches: string;
  finalSandwiches: string;
  contactName: string;
  address: string;
  suggestedStatus: 'scheduled' | 'completed' | 'cancelled';
  matchedEvent?: { id: number; organizationName: string | null; status: string };
}

interface PreviewResponse {
  sheetRowCount: number;
  skippedRows: number;
  missing: PreviewRow[];
  possible: PreviewRow[];
  inApp: PreviewRow[];
}

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_process', label: 'In Process' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface RowLineProps {
  row: PreviewRow;
  checked: boolean;
  status: string;
  onToggle: (checked: boolean) => void;
  onStatusChange: (status: string) => void;
}

function RowLine({ row, checked, status, onToggle, onStatusChange }: RowLineProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-2 border-b last:border-b-0 hover:bg-gray-50">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
        data-testid={`checkbox-import-row-${row.rowIndex}`}
      />
      <span className="text-sm font-medium w-28 flex-shrink-0">{formatDate(row.date)}</span>
      <span className="text-sm flex-1 min-w-[10rem]">
        {row.groupName}
        {row.matchedEvent && (
          <span className="block text-xs text-amber-700">
            Similar in app: "{row.matchedEvent.organizationName}" ({row.matchedEvent.status})
          </span>
        )}
      </span>
      <span className="text-xs text-gray-500 w-24 flex-shrink-0">
        {row.finalSandwiches || row.estimateSandwiches
          ? `${row.finalSandwiches || row.estimateSandwiches} sandwiches`
          : ''}
      </span>
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-32 h-8 text-xs" data-testid={`select-status-row-${row.rowIndex}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PlanningSheetImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PreviewResponse>({
    queryKey: ['/api/planning-sheet-import/preview'],
    enabled: open,
    staleTime: 0,
  });

  // Selection state, keyed by sheet row index.
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [statuses, setStatuses] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!data) return;
    const nextChecked: Record<number, boolean> = {};
    const nextStatuses: Record<number, string> = {};
    for (const row of data.missing) {
      nextChecked[row.rowIndex] = true; // missing rows pre-checked
      nextStatuses[row.rowIndex] = row.suggestedStatus;
    }
    for (const row of data.possible) {
      nextChecked[row.rowIndex] = false; // possible matches need a human yes
      nextStatuses[row.rowIndex] = row.suggestedStatus;
    }
    setChecked(nextChecked);
    setStatuses(nextStatuses);
  }, [data]);

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );

  const importMutation = useMutation({
    mutationFn: async () => {
      // Echo each row's fingerprint back so the server can refuse rows that
      // shifted position on the sheet since this preview was loaded.
      const fingerprintByRow = new Map<number, string>();
      for (const row of [...(data?.missing ?? []), ...(data?.possible ?? [])]) {
        fingerprintByRow.set(row.rowIndex, row.fingerprint);
      }
      const selections = Object.entries(checked)
        .filter(([, v]) => v)
        .map(([rowIndex]) => ({
          rowIndex: Number(rowIndex),
          fingerprint: fingerprintByRow.get(Number(rowIndex)) || '',
          status: statuses[Number(rowIndex)] || 'scheduled',
        }));
      const res = await apiRequest('POST', '/api/planning-sheet-import/import', {
        selections,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      toast({
        title: 'Import complete',
        description:
          result.message +
          (result.skipped?.length
            ? ` (${result.skipped.length} skipped — already in the app or the sheet changed)`
            : ''),
      });
      await invalidateEventRequestQueries(queryClient);
      await queryClient.invalidateQueries({
        queryKey: ['/api/planning-sheet-import/preview'],
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Import failed',
        description:
          error?.message || 'Something went wrong. Nothing was imported.',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Compare with Planning Sheet
          </DialogTitle>
          <DialogDescription className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-tsp-teal" />
            <span>
              This only reads your planning sheet — it never changes it. Nothing
              is added to the app until you click Import, and re-running this can
              never create duplicates.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {isLoading && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {isError && (
            <p className="text-sm text-red-600 py-4">
              Could not read the planning sheet. Please try again in a moment.
            </p>
          )}

          {data && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">{data.sheetRowCount} rows on sheet</Badge>
                <Badge variant="outline" className="text-tsp-teal border-tsp-sky">
                  {data.inApp.length} already in the app
                </Badge>
                <Badge variant="outline" className="text-blue-700 border-blue-300">
                  {data.missing.length} not in the app
                </Badge>
                {data.possible.length > 0 && (
                  <Badge variant="outline" className="text-amber-700 border-amber-300">
                    {data.possible.length} possible matches to review
                  </Badge>
                )}
              </div>

              {data.missing.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-semibold">
                      Not in the app yet — checked rows will be imported
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setChecked((prev) => {
                            const next = { ...prev };
                            for (const r of data.missing) next[r.rowIndex] = true;
                            return next;
                          })
                        }
                      >
                        Check all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setChecked((prev) => {
                            const next = { ...prev };
                            for (const r of data.missing) next[r.rowIndex] = false;
                            return next;
                          })
                        }
                      >
                        Uncheck all
                      </Button>
                    </div>
                  </div>
                  <div className="border rounded-md">
                    {data.missing.map((row) => (
                      <RowLine
                        key={row.rowIndex}
                        row={row}
                        checked={checked[row.rowIndex] || false}
                        status={statuses[row.rowIndex] || row.suggestedStatus}
                        onToggle={(v) =>
                          setChecked((prev) => ({ ...prev, [row.rowIndex]: v }))
                        }
                        onStatusChange={(s) =>
                          setStatuses((prev) => ({ ...prev, [row.rowIndex]: s }))
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {data.possible.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-1 mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Possible matches — check only if these are truly different events
                  </h4>
                  <p className="text-xs text-gray-500 mb-1">
                    Each of these sheet rows looks similar to an event already in
                    the app on the same date. Left unchecked, nothing happens.
                  </p>
                  <div className="border rounded-md border-amber-200">
                    {data.possible.map((row) => (
                      <RowLine
                        key={row.rowIndex}
                        row={row}
                        checked={checked[row.rowIndex] || false}
                        status={statuses[row.rowIndex] || row.suggestedStatus}
                        onToggle={(v) =>
                          setChecked((prev) => ({ ...prev, [row.rowIndex]: v }))
                        }
                        onStatusChange={(s) =>
                          setStatuses((prev) => ({ ...prev, [row.rowIndex]: s }))
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {data.missing.length === 0 && data.possible.length === 0 && (
                <p className="text-sm text-tsp-teal py-2">
                  The app already has every event on the planning sheet — nothing to import.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close Without Importing
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={selectedCount === 0 || importMutation.isPending || !data}
            data-testid="button-import-selected"
          >
            {importMutation.isPending
              ? 'Importing…'
              : `Import ${selectedCount} Event${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
