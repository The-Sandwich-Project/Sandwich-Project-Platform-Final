/**
 * "TSP shopping": whether TSP is buying the food for an event.
 *   checked   = TSP is shopping for this event
 *   unchecked = the group does its own shopping
 * Stored in event_requests.is_tsp_shopped (strictly true/false).
 *
 * Every change goes through a confirmation popup, in both directions, so a
 * stray click can't flip it.
 *
 *  - TspShoppingCheckbox: the edit form's checkbox (changes form state only).
 *  - TspShoppingBadge: on cards; shows the state and saves the change itself.
 */
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiRequest, queryClient, applyEventRequestSaveToCache } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

/** The confirmation wording for switching to `next`. */
export function tspShoppingConfirmText(next: boolean, organizationName?: string | null) {
  const group = organizationName?.trim() || 'this group';
  return next
    ? {
        title: 'Mark as TSP shopping?',
        description: `TSP will buy the food for ${group}'s event. The group will not do its own shopping.`,
        confirm: 'Yes, TSP is shopping',
      }
    : {
        title: 'Switch to the group shopping?',
        description: `${group} will buy its own food. TSP will not shop for this event.`,
        confirm: 'Yes, the group is shopping',
      };
}

function TspShoppingConfirmDialog({
  next,
  organizationName,
  open,
  onCancel,
  onConfirm,
  busy = false,
}: {
  next: boolean;
  organizationName?: string | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const text = tspShoppingConfirmText(next, organizationName);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} data-testid="tsp-shopping-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-[#236383] hover:bg-[#1d5270]"
          >
            {text.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The edit form's checkbox. Changes form state only after the user confirms. */
export function TspShoppingCheckbox({
  checked,
  onChange,
  organizationName,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  organizationName?: string | null;
  disabled?: boolean;
}) {
  const [pending, setPending] = React.useState<boolean | null>(null);
  return (
    <div className="space-y-1" data-testid="tsp-shopping-field">
      <div className="flex items-center gap-2">
        <Checkbox
          id="isTspShopped"
          checked={checked}
          disabled={disabled}
          // Don't change anything yet: ask first.
          onCheckedChange={() => setPending(!checked)}
          data-testid="checkbox-tsp-shopping"
        />
        <Label htmlFor="isTspShopped" className="cursor-pointer font-medium">
          TSP is shopping for this event
        </Label>
      </div>
      <p className="text-xs text-gray-600 ml-6">
        {checked ? 'TSP is buying the food.' : 'Unchecked: the group does its own shopping.'}
      </p>
      <TspShoppingConfirmDialog
        next={pending ?? !checked}
        organizationName={organizationName}
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) onChange(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

/**
 * The card badge. Shows "TSP shopping" only when TSP is shopping; when the user
 * can edit, clicking it asks to confirm switching back to the group shopping.
 */
export function TspShoppingBadge({
  eventRequestId,
  isTspShopped,
  organizationName,
  canEdit,
  className = '',
  hideWhenFalse = false,
}: {
  eventRequestId: number;
  isTspShopped: boolean | null | undefined;
  organizationName?: string | null;
  canEdit: boolean;
  className?: string;
  /** @deprecated The badge always hides while the group is shopping. */
  hideWhenFalse?: boolean;
}) {
  const { toast } = useToast();
  const current = isTspShopped === true;
  const [open, setOpen] = React.useState(false);

  const mutation = useMutation({
    mutationFn: (next: boolean) => apiRequest('PATCH', `/api/event-requests/${eventRequestId}`, { isTspShopped: next }),
    onSuccess: async (updatedEvent) => {
      await applyEventRequestSaveToCache(queryClient, updatedEvent, { touchedFields: ['isTspShopped'] });
      setOpen(false);
    },
    onError: () => {
      toast({ title: 'Could not update TSP shopping', description: 'Please try again.', variant: 'destructive' });
    },
  });

  // Only shown once TSP shopping is ticked (in Edit). The group doing its own
  // shopping is the default, so there's no "Group shopping" badge.
  if (!current) return null;

  return (
    <>
      <Badge
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        aria-label={current ? 'TSP shopping (click to change)' : 'Group shopping (click to change)'}
        onClick={(e) => {
          e.stopPropagation();
          if (canEdit) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (canEdit && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={`${canEdit ? 'cursor-pointer hover:opacity-90' : ''} transition-opacity text-xs sm:text-sm font-medium inline-flex items-center gap-1 ${
          current ? 'bg-[#FBAD3F] text-[#114145] border border-[#D68319]' : 'bg-gray-50 text-gray-500 border border-gray-200'
        } ${className}`}
        data-testid="badge-tsp-shopping"
      >
        <ShoppingCart className="w-3 h-3" />
        {current ? 'TSP shopping' : 'Group shopping'}
      </Badge>
      <TspShoppingConfirmDialog
        next={!current}
        organizationName={organizationName}
        open={open}
        busy={mutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => mutation.mutate(!current)}
      />
    </>
  );
}
