import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, Download, RefreshCw } from 'lucide-react';

/**
 * Planning Sheet Gaps — a READ-ONLY report for super admins.
 *
 * It calls GET /api/planning-sheet-import/gaps, which only reads the sheet and
 * the app's events. This dialog has no mutation, no import action, and no way
 * to write to the spreadsheet or the app — it exists purely to surface a list
 * of group events on the planning sheet that don't appear to exist in the app
 * under any status.
 */

interface GapRow {
  rowIndex: number;
  fingerprint: string;
  date: string; // YYYY-MM-DD
  dateDisplay: string;
  groupName: string;
  estimateSandwiches: string;
  finalSandwiches: string;
  contactName: string;
  address: string;
  matchedEvent?: { id: number; organizationName: string | null; status: string };
}

interface GapsResponse {
  sheetRowCount: number;
  skippedRows: number;
  inAppCount: number;
  possibleMatchCount: number;
  gaps: GapRow[];
  possibleMatches: GapRow[];
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Build a CSV (client-side only — no upload) from the gap rows. */
function toCsv(rows: GapRow[]): string {
  const header = ['Date', 'Group', 'Estimate', 'Final', 'Contact', 'Address'];
  const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.date, r.groupName, r.estimateSandwiches, r.finalSandwiches, r.contactName, r.address]
      .map((v) => esc(String(v ?? '')))
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export function PlanningSheetGapsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<GapsResponse>({
    queryKey: ['/api/planning-sheet-import/gaps'],
    enabled: open,
    staleTime: 0,
  });

  const gaps = data?.gaps ?? [];

  const downloadCsv = useMemo(
    () => () => {
      const csv = toCsv(gaps);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'planning-sheet-gaps.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on a timer so the browser has finished reading the blob first
      // (revoking immediately can produce an empty download in some browsers).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [gaps]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-tsp-teal" />
            Planning Sheet Gaps
          </DialogTitle>
          <DialogDescription>
            Group events on the planning sheet that don&apos;t appear to exist in
            the app under any status. This is a <strong>read-only report</strong>{' '}
            — it only reads the sheet and never changes anything in the sheet or
            the app.
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
                  {data.inAppCount} already in the app
                </Badge>
                <Badge variant="outline" className="text-blue-700 border-blue-300">
                  {gaps.length} not in the app
                </Badge>
                {data.possibleMatchCount > 0 && (
                  <Badge variant="outline" className="text-amber-700 border-amber-300">
                    {data.possibleMatchCount} possible matches
                  </Badge>
                )}
              </div>

              {gaps.length === 0 ? (
                <p className="text-sm text-tsp-teal py-2">
                  Every group event on the planning sheet appears to be represented
                  in the app. No gaps found.
                </p>
              ) : (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 py-2 px-2 border-b bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <span className="w-28 flex-shrink-0">Date</span>
                    <span className="flex-1 min-w-[10rem]">Group</span>
                    <span className="w-24 flex-shrink-0 text-right">Sandwiches</span>
                  </div>
                  {gaps.map((row) => (
                    <div
                      key={row.fingerprint}
                      className="flex flex-wrap items-center gap-2 py-2 px-2 border-b last:border-b-0"
                      data-testid={`gap-row-${row.rowIndex}`}
                    >
                      <span className="text-sm font-medium w-28 flex-shrink-0">
                        {formatDate(row.date)}
                      </span>
                      <span className="text-sm flex-1 min-w-[10rem]">
                        {row.groupName}
                        {(row.contactName || row.address) && (
                          <span className="block text-xs text-gray-500">
                            {[row.contactName, row.address].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500 w-24 flex-shrink-0 text-right">
                        {row.finalSandwiches || row.estimateSandwiches || ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {data.possibleMatches.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-amber-700 mb-1">
                    Possible matches — not counted as gaps
                  </h4>
                  <p className="text-xs text-gray-500 mb-1">
                    These sheet rows look like a close (name + same-date) match to
                    an event already in the app, so they&apos;re excluded from the
                    gap list above. The match is a heuristic — check any where the
                    names don&apos;t really line up, in case a weak match is hiding
                    a real gap.
                  </p>
                  <div className="border rounded-md border-amber-200">
                    {data.possibleMatches.map((row) => (
                      <div
                        key={row.fingerprint}
                        className="flex flex-wrap items-center gap-2 py-2 px-2 border-b last:border-b-0"
                        data-testid={`possible-row-${row.rowIndex}`}
                      >
                        <span className="text-sm font-medium w-28 flex-shrink-0">
                          {formatDate(row.date)}
                        </span>
                        <span className="text-sm flex-1 min-w-[10rem]">
                          {row.groupName}
                          {row.matchedEvent && (
                            <span className="block text-xs text-amber-700">
                              matched to &quot;{row.matchedEvent.organizationName}&quot; ({row.matchedEvent.status})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-gaps-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={downloadCsv}
            disabled={gaps.length === 0}
            data-testid="button-gaps-export"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
