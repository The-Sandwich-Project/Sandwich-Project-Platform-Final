/**
 * "Remind me again in N days", opened from a link in the daily event-alert
 * email (…&eventId=123&action=snooze&rule=no_contact&days=3).
 *
 * The link itself never snoozes anything: email security scanners open every
 * link in a message, so a link that acted on its own would snooze alerts
 * nobody asked to snooze. This asks the person to confirm (and lets them pick
 * a different number), then calls POST /api/event-check-in-reminders/:id/snooze.
 * The server caps the length so a snooze ends by the day before the event.
 */
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { readEventDeepLink, clearEventDeepLinkAction } from './lib/eventDeepLink';

const ALERT_LABELS: Record<string, string> = {
  no_contact: 'no contact logged',
  stale_event: 'no updates',
  date_approaching_inprocess: 'requested date coming up',
  date_approaching_scheduled: 'event coming up with missing info',
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; org: string; maxDays: number | null }
  | { kind: 'error'; message: string };

export function AlertSnoozeFromLink() {
  const { toast } = useToast();
  const [link] = useState(() => {
    const l = readEventDeepLink();
    return l && l.action === 'snooze' && l.ruleTypes.length > 0 ? l : null;
  });
  const [open, setOpen] = useState(!!link);
  const [state, setState] = useState<LoadState>({ kind: link ? 'loading' : 'idle' });
  const [days, setDays] = useState<number>(link?.days ?? 3);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    (async () => {
      try {
        const [snoozeRes, eventRes] = await Promise.all([
          fetch(`/api/event-check-in-reminders/${link.eventId}/snooze`, { credentials: 'include' }),
          fetch(`/api/event-requests/${link.eventId}`, { credentials: 'include' }),
        ]);
        if (snoozeRes.status === 403) throw new Error("Only this event's TSP contact can snooze its alerts.");
        if (!snoozeRes.ok || !eventRes.ok) throw new Error("Couldn't load this event. It may have been deleted.");
        const { maxDays } = (await snoozeRes.json()) as { maxDays: number | null };
        const event = (await eventRes.json()) as { organizationName?: string | null };
        if (cancelled) return;
        if (maxDays !== null) setDays(d => Math.max(1, Math.min(d, maxDays)));
        setState({ kind: 'ready', org: event.organizationName || 'this event', maxDays });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [link]);

  if (!link) return null;

  const close = () => {
    clearEventDeepLinkAction();
    setOpen(false);
  };

  const what = joinList(link.ruleTypes.map(r => ALERT_LABELS[r] || r.replace(/_/g, ' ')));
  const maxDays = state.kind === 'ready' ? state.maxDays : null;
  const tooClose = maxDays === 0;
  const validDays = Number.isInteger(days) && days >= 1 && days <= (maxDays ?? 90);

  const confirm = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/event-check-in-reminders/${link.eventId}/snooze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleTypes: link.ruleTypes, days }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't snooze that alert.");
      const until = new Date(body.until).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York',
      });
      toast({
        title: 'Got it',
        description: `If it still applies, you'll see this again in your email on ${until}.${body.shortened ? ' (Shortened so it lands before the event.)' : ''}`,
      });
      close();
    } catch (e) {
      toast({ title: 'Not snoozed', description: e instanceof Error ? e.message : 'Something went wrong.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => (o ? setOpen(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remind me again later</DialogTitle>
          <DialogDescription>
            {state.kind === 'ready'
              ? <>Pause the <strong>{what}</strong> alert for <strong>{state.org}</strong>. If it still applies when the pause ends, it'll be back in your daily email.</>
              : state.kind === 'error'
                ? state.message
                : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        {state.kind === 'ready' && (tooClose ? (
          <p className="text-sm text-gray-700">
            This event is today or tomorrow, so its alerts can't be paused.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Label htmlFor="snooze-days" className="text-sm text-gray-700">Remind me again in</Label>
            <Input
              id="snooze-days"
              type="number"
              min={1}
              max={maxDays ?? 90}
              value={Number.isNaN(days) ? '' : days}
              onChange={e => setDays(parseInt(e.target.value, 10))}
              className="w-20 h-8 text-center"
            />
            <span className="text-sm text-gray-700">day{days === 1 ? '' : 's'}</span>
          </div>
        ))}
        {state.kind === 'ready' && !tooClose && maxDays !== null && (
          <p className="text-xs text-gray-500">
            Up to {maxDays} day{maxDays === 1 ? '' : 's'}, so it can't hide the last alert before the event.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          {state.kind === 'ready' && !tooClose && (
            <Button
              className="bg-[#007E8C] hover:bg-[#006570] text-white"
              onClick={confirm}
              disabled={!validDays || saving}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
