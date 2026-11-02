/**
 * Three-state van-needed control for event request cards.
 *
 * States:
 *  - Confirmed (`vanDriverNeeded` true): solid teal "Van Needed" badge.
 *  - Possibly (`vanNeededLikely` true, `vanDriverNeeded` false): amber-outline
 *    "Van Possibly Needed" badge; click to upgrade to confirmed.
 *    (Schema column is still `van_needed_likely` for historical reasons —
 *    only the UI label changed.)
 *  - Unknown (both false): small "Needs Van?" button. Clicking opens a dialog
 *    with [Possibly / For sure / Cancel].
 *
 * Sets fields via PATCH. The Mark-Scheduled flow has its own inline panel that
 * picks up the "likely" state when the user transitions the event; this control
 * is for the in-process tab where the user is still triaging logistics.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Truck, HelpCircle, AlertTriangle } from 'lucide-react';
import { apiRequest, queryClient, applyEventRequestSaveToCache } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface VanNeededBadgeAndButtonProps {
  eventRequestId: number;
  vanDriverNeeded: boolean | null | undefined;
  vanNeededLikely: boolean | null | undefined;
  /** Effective event date — used to show other same-day van requests on the badge. */
  eventDate?: Date | string | null;
  canEdit?: boolean;
  /**
   * When true, skip the Possibly/For sure dialog and the "likely" state entirely.
   * The button becomes a one-click toggle: click to set vanDriverNeeded=true,
   * click the resulting badge to clear it. Intended for the scheduled card where
   * the team already knows whether a van is needed.
   */
  simpleToggle?: boolean;
  /**
   * Controls which parts of the control render:
   *  - 'full'   (default) — renders whichever state applies: badge, possibly-badge, or button
   *  - 'badge'  — only renders the badge for "Van Needed" / "Van Possibly Needed";
   *               renders nothing when neither is set. Use at the top of a card.
   *  - 'button' — only renders the "Needs Van?" / "Mark Van Needed" call-to-action
   *               button (the un-set state); renders nothing when a badge would
   *               otherwise show. Use in the bottom action row.
   */
  mode?: 'full' | 'badge' | 'button';
}

type VanChoice = 'likely' | 'confirmed';

interface SameDayVanRequest {
  id: number;
  organizationName: string | null;
  status: string;
  vanDriverNeeded: boolean;
  vanNeededLikely: boolean;
  eventStartTime: string | null;
}

function normalizeDateStr(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return typeof date === 'string' ? date.split('T')[0] : date.toISOString().split('T')[0];
}

function formatStatusLabel(status: string): string {
  if (status === 'in_process') return 'In Process';
  if (status === 'rescheduled') return 'Rescheduled';
  return 'Scheduled';
}

function useSameDayVanRequests(
  eventDate: Date | string | null | undefined,
  eventRequestId: number,
  enabled: boolean
) {
  const dateStr = normalizeDateStr(eventDate);

  return useQuery<{ otherEvents: SameDayVanRequest[] }>({
    queryKey: ['van-requests-for-date', dateStr, eventRequestId],
    queryFn: async () => {
      const params = new URLSearchParams({ date: dateStr! });
      params.set('excludeEventId', String(eventRequestId));
      const response = await fetch(`/api/event-requests/van-requests-for-date?${params}`);
      if (!response.ok) throw new Error('Failed to fetch same-day van requests');
      return response.json();
    },
    enabled: enabled && !!dateStr,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

function SameDayVanTooltipLines({ otherEvents }: { otherEvents: SameDayVanRequest[] }) {
  if (otherEvents.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/60">
      <p className="text-xs font-medium text-amber-700">
        {otherEvents.length} other event{otherEvents.length !== 1 ? 's' : ''} on this date also need{otherEvents.length === 1 ? 's' : ''} a van:
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {otherEvents.map((event) => (
          <li key={event.id}>
            {event.organizationName || 'Unknown org'} ({formatStatusLabel(event.status)}
            {event.vanDriverNeeded ? '' : ', possibly'}
            {event.eventStartTime ? ` · ${event.eventStartTime}` : ''})
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VanNeededBadgeAndButton({
  eventRequestId,
  vanDriverNeeded,
  vanNeededLikely,
  eventDate,
  canEdit = true,
  simpleToggle = false,
  mode = 'full',
}: VanNeededBadgeAndButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const showSameDayContext = !!(vanDriverNeeded || vanNeededLikely) && mode !== 'button';
  const { data: sameDayData } = useSameDayVanRequests(eventDate, eventRequestId, showSameDayContext);
  const otherVanEvents = sameDayData?.otherEvents ?? [];
  const hasSameDayVanRequests = otherVanEvents.length > 0;

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest('PATCH', `/api/event-requests/${eventRequestId}`, data),
    onSuccess: async (updatedEvent, variables) => {
      await applyEventRequestSaveToCache(queryClient, updatedEvent, {
        touchedFields: Object.keys(variables),
      });
      setDialogOpen(false);
    },
    onError: () => {
      toast({
        title: 'Could not update van status',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const applyChoice = (choice: VanChoice) => {
    if (choice === 'confirmed') {
      // Confirmed wins — clear the soft flag if it was set.
      updateMutation.mutate({ vanDriverNeeded: true, vanNeededLikely: false });
    } else {
      updateMutation.mutate({ vanNeededLikely: true, vanDriverNeeded: false });
    }
  };

  const clearVan = () => {
    updateMutation.mutate({ vanDriverNeeded: false, vanNeededLikely: false, vanNeededFor: null });
  };

  // ── Simple toggle mode (scheduled cards): no dialog, no "likely" tier.
  // One click sets vanDriverNeeded=true; clicking the badge clears it.
  if (simpleToggle) {
    if (vanDriverNeeded) {
      // Badge slot: render the "Van Needed" pill (or nothing in button mode).
      if (mode === 'button') return null;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                onClick={() => canEdit && clearVan()}
                className={`inline-flex items-center gap-1 whitespace-nowrap bg-tsp-teal text-white border-transparent ${hasSameDayVanRequests ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}`}
                data-testid="badge-van-needed"
              >
                <Truck className="w-3 h-3" />
                Van Needed
                {hasSameDayVanRequests && (
                  <>
                    <AlertTriangle className="w-3 h-3 text-amber-200" />
                    <span className="text-[10px] font-semibold">+{otherVanEvents.length}</span>
                  </>
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {canEdit ? <p>A van is needed for this event. Click to clear.</p> : <p>A van is needed for this event.</p>}
              <SameDayVanTooltipLines otherEvents={otherVanEvents} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    // Button slot: the un-set state. Skip in badge-only mode.
    if (mode === 'badge') return null;
    if (!canEdit) return null;
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateMutation.mutate({ vanDriverNeeded: true, vanNeededLikely: false })}
        disabled={updateMutation.isPending}
        className="h-6 px-2 text-xs border-tsp-teal text-tsp-teal hover:bg-tsp-teal/10"
        data-testid="button-mark-van-needed"
      >
        <Truck className="w-3 h-3 mr-1" />
        Mark Van Needed
      </Button>
    );
  }

  // CONFIRMED — solid teal badge (badge slot)
  if (vanDriverNeeded) {
    if (mode === 'button') return null;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              onClick={() => canEdit && setDialogOpen(true)}
              className={`inline-flex items-center gap-1 whitespace-nowrap bg-tsp-teal text-white border-transparent ${hasSameDayVanRequests ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}`}
              data-testid="badge-van-needed"
            >
              <Truck className="w-3 h-3" />
              Van Needed
              {hasSameDayVanRequests && (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-200" />
                  <span className="text-[10px] font-semibold">+{otherVanEvents.length}</span>
                </>
              )}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {canEdit ? <p>A van has been confirmed as needed. Click to change.</p> : <p>A van is needed for this event.</p>}
            <SameDayVanTooltipLines otherEvents={otherVanEvents} />
          </TooltipContent>
        </Tooltip>

        <VanChoiceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          current="confirmed"
          onChoose={applyChoice}
          onClear={clearVan}
          isSaving={updateMutation.isPending}
        />
      </TooltipProvider>
    );
  }

  // POSSIBLY — amber outline badge (badge slot)
  if (vanNeededLikely) {
    if (mode === 'button') return null;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              onClick={() => canEdit && setDialogOpen(true)}
              className={`inline-flex items-center gap-1 whitespace-nowrap bg-amber-50 text-amber-700 border-amber-300 ${hasSameDayVanRequests ? 'ring-2 ring-red-300 ring-offset-1' : ''} ${canEdit ? 'cursor-pointer hover:bg-amber-100' : ''}`}
              data-testid="badge-van-likely-needed"
            >
              <Truck className="w-3 h-3" />
              Van Possibly Needed
              {hasSameDayVanRequests && (
                <>
                  <AlertTriangle className="w-3 h-3 text-red-600" />
                  <span className="text-[10px] font-semibold">+{otherVanEvents.length}</span>
                </>
              )}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>Flagged as possibly needing a van. You'll be asked about it when scheduling, but you can leave it unresolved if you're still not sure.</p>
            {canEdit && <p className="text-xs text-muted-foreground mt-1">Click to change.</p>}
            <SameDayVanTooltipLines otherEvents={otherVanEvents} />
          </TooltipContent>
        </Tooltip>

        <VanChoiceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          current="likely"
          onChoose={applyChoice}
          onClear={clearVan}
          isSaving={updateMutation.isPending}
        />
      </TooltipProvider>
    );
  }

  // UNKNOWN — show the "Needs Van?" button (button slot)
  if (mode === 'badge') return null;
  if (!canEdit) return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDialogOpen(true)}
        className="h-6 px-2 text-xs border-slate-300 text-slate-600 hover:bg-slate-100"
        data-testid="button-needs-van"
      >
        <HelpCircle className="w-3 h-3 mr-1" />
        Needs Van?
      </Button>

      <VanChoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        current="none"
        onChoose={applyChoice}
        onClear={clearVan}
        isSaving={updateMutation.isPending}
      />
    </>
  );
}

interface VanChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the current state is, so we can show the right CTAs/clear option. */
  current: 'none' | 'likely' | 'confirmed';
  onChoose: (choice: VanChoice) => void;
  onClear: () => void;
  isSaving: boolean;
}

function VanChoiceDialog({
  open,
  onOpenChange,
  current,
  onChoose,
  onClear,
  isSaving,
}: VanChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Will this event need a van?</DialogTitle>
          <DialogDescription>
            {current === 'none'
              ? "Flag this now so the team is reminded to confirm before scheduling."
              : current === 'likely'
                ? "Currently flagged as possibly needed. You can confirm it now or change the flag."
                : "Currently confirmed as needing a van. You can downgrade or clear the flag."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Button
            type="button"
            variant={current === 'confirmed' ? 'secondary' : 'default'}
            disabled={isSaving || current === 'confirmed'}
            onClick={() => onChoose('confirmed')}
            className="w-full justify-start bg-tsp-teal hover:bg-brand-primary-dark text-white disabled:opacity-50"
            data-testid="button-van-confirmed"
          >
            <Truck className="w-4 h-4 mr-2" />
            For sure — van is needed
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={isSaving || current === 'likely'}
            onClick={() => onChoose('likely')}
            className="w-full justify-start border-amber-300 text-amber-700 hover:bg-amber-50"
            data-testid="button-van-likely"
          >
            <Truck className="w-4 h-4 mr-2" />
            Possibly — flag for follow-up
          </Button>

          {current !== 'none' && (
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={onClear}
              className="w-full justify-start text-slate-500 hover:text-slate-700"
              data-testid="button-van-clear"
            >
              Clear the flag — van not needed
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
