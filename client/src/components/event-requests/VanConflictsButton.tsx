/**
 * Van Conflicts scan button + dialog.
 *
 * Click → run a server-side scan for every active event request promised the
 * org van. Surfaces dates with 2+ van events split into:
 *   - "Must Resolve" (confirmed double-bookings — vanDriverNeeded × 2+)
 *   - "Worth Watching" (at least one is still vanNeededLikely / soft flag)
 *
 * Excludes self-transport orgs and DHL-van events. The query is on-demand
 * (no auto-refresh) so it doesn't add network noise to the dashboard.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Truck, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { parseEventDate } from '@/lib/date-utils';

interface VanConflictEvent {
  id: number;
  organizationName: string | null;
  status: string;
  vanDriverNeeded: boolean;
  vanNeededLikely: boolean;
  eventDate: string;
  eventStartTime: string | null;
}

interface VanConflictDate {
  date: string;
  events: VanConflictEvent[];
  confirmedCount: number;
  possiblyCount: number;
}

interface VanConflictsResult {
  confirmed: VanConflictDate[];
  potential: VanConflictDate[];
  totalEventsScanned: number;
  scannedAt: string;
}

function formatDateHeader(dateStr: string): string {
  const parsed = parseEventDate(dateStr);
  if (!parsed) return dateStr;
  return format(parsed, 'EEEE, MMMM d, yyyy');
}

function formatStatusLabel(status: string): string {
  if (status === 'in_process') return 'In Process';
  if (status === 'rescheduled') return 'Rescheduled';
  if (status === 'scheduled') return 'Scheduled';
  return status;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    in_process: 'bg-amber-50 text-amber-700 border-amber-200',
    scheduled: 'bg-tsp-sky/15 text-tsp-teal border-tsp-sky',
    rescheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <Badge variant="outline" className={`text-xs ${styles[status] || ''}`}>
      {formatStatusLabel(status)}
    </Badge>
  );
}

function VanFlagBadge({ event }: { event: VanConflictEvent }) {
  if (event.vanDriverNeeded) {
    return (
      <Badge className="bg-[#007E8C] text-white border-transparent text-xs">
        <Truck className="w-3 h-3 mr-1" />
        Confirmed
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-amber-50 text-amber-700 border-amber-300 text-xs"
    >
      <Truck className="w-3 h-3 mr-1" />
      Possibly
    </Badge>
  );
}

function ConflictDateCard({
  conflict,
  variant,
}: {
  conflict: VanConflictDate;
  variant: 'confirmed' | 'potential';
}) {
  const accent =
    variant === 'confirmed'
      ? 'border-l-[#A31C41] bg-[#FCE4E6]'
      : 'border-l-amber-400 bg-amber-50';
  return (
    <div className={`border-l-4 ${accent} rounded-md p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-semibold text-sm text-gray-900">
          {formatDateHeader(conflict.date)}
        </div>
        <div className="text-xs text-gray-600">
          {conflict.events.length} events ·{' '}
          {conflict.confirmedCount > 0 && (
            <>
              <span className="font-semibold text-[#007E8C]">
                {conflict.confirmedCount} confirmed
              </span>
              {conflict.possiblyCount > 0 && ' · '}
            </>
          )}
          {conflict.possiblyCount > 0 && (
            <span className="font-semibold text-amber-700">
              {conflict.possiblyCount} possibly
            </span>
          )}
        </div>
      </div>
      <ul className="space-y-1.5">
        {conflict.events.map((event) => (
          <li
            key={event.id}
            className="flex items-center justify-between gap-3 bg-white rounded-md px-3 py-2 border border-gray-200"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm text-gray-900 truncate">
                {event.organizationName || 'Unknown organization'}
              </div>
              {event.eventStartTime && (
                <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  {event.eventStartTime}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <StatusBadge status={event.status} />
              <VanFlagBadge event={event} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface VanConflictsButtonProps {
  isMobile?: boolean;
}

export function VanConflictsButton({ isMobile = false }: VanConflictsButtonProps) {
  const [open, setOpen] = useState(false);

  const { data, isFetching, refetch, error } = useQuery<VanConflictsResult>({
    queryKey: ['/api/event-requests/van-conflict-dates'],
    queryFn: async () => {
      const response = await fetch('/api/event-requests/van-conflict-dates');
      if (!response.ok) throw new Error('Failed to scan van conflicts');
      return response.json();
    },
    enabled: open, // Only run when the dialog is open
    staleTime: 30000, // Cache for 30s so re-opening the dialog doesn't refire immediately
    refetchOnWindowFocus: false,
  });

  const hasConfirmed = (data?.confirmed.length ?? 0) > 0;
  const hasPotential = (data?.potential.length ?? 0) > 0;
  const hasAny = hasConfirmed || hasPotential;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="premium-btn-outline text-sm whitespace-nowrap shrink-0"
        title="Check for dates with multiple van-needed events"
      >
        <Truck className="w-4 h-4" />
        {!isMobile && 'Van Conflicts'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-[#007E8C]" />
              Van Scheduling Conflicts
            </DialogTitle>
            <DialogDescription>
              Scans all in-process, scheduled, and rescheduled events promised
              the org van. DHL-van events and self-transport orgs are excluded.
            </DialogDescription>
          </DialogHeader>

          {isFetching && !data && (
            <div className="py-12 flex flex-col items-center justify-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">Scanning events…</p>
            </div>
          )}

          {error && (
            <div className="py-6 text-center text-red-600 text-sm">
              Could not run the scan. Please try again.
            </div>
          )}

          {data && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="flex items-center justify-between text-xs text-gray-600 border-b pb-2">
                <span>
                  Scanned {data.totalEventsScanned} event
                  {data.totalEventsScanned === 1 ? '' : 's'}.
                </span>
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="text-[#007E8C] hover:underline disabled:opacity-50"
                >
                  {isFetching ? 'Rescanning…' : 'Rescan'}
                </button>
              </div>

              {/* No conflicts */}
              {!hasAny && (
                <div className="text-center py-10 text-gray-600">
                  <Truck className="w-10 h-10 mx-auto mb-2 text-tsp-sky" />
                  <p className="font-semibold text-tsp-teal">All clear.</p>
                  <p className="text-sm">
                    No dates with multiple van-needed events were found.
                  </p>
                </div>
              )}

              {/* Confirmed conflicts */}
              {hasConfirmed && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-[#A31C41]" />
                    <h3 className="font-semibold text-[#A31C41]">
                      Must Resolve — Confirmed Double-Bookings
                    </h3>
                    <Badge className="bg-[#A31C41] text-white border-transparent">
                      {data.confirmed.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 mb-3">
                    Two or more events on the same date with the van confirmed
                    as needed.
                  </p>
                  <div className="space-y-3">
                    {data.confirmed.map((conflict) => (
                      <ConflictDateCard
                        key={conflict.date}
                        conflict={conflict}
                        variant="confirmed"
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Potential conflicts */}
              {hasPotential && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <h3 className="font-semibold text-amber-700">
                      Worth Watching — At Least One Still "Possibly"
                    </h3>
                    <Badge className="bg-amber-500 text-white border-transparent">
                      {data.potential.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 mb-3">
                    Two or more van events on the same date, but at least one
                    is still soft-flagged as "possibly needed." May resolve
                    itself once the event is scheduled.
                  </p>
                  <div className="space-y-3">
                    {data.potential.map((conflict) => (
                      <ConflictDateCard
                        key={conflict.date}
                        conflict={conflict}
                        variant="potential"
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
