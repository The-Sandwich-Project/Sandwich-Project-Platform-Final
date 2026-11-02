import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { CalendarDays, ExternalLink, X } from 'lucide-react';
import { STATUS_DEFINITIONS, type EventStatus } from '@shared/event-status-workflow';
import { cn } from '@/lib/utils';

/**
 * Event context attached to a chat message.
 *
 * Stored on the Stream message as a custom `tsp_event` field (not baked into
 * the text), so the card can always show the event's *current* date and
 * status, even after it's rescheduled.
 *
 *  - kind 'card'  → the message was sent from an event card ("Message" button);
 *                   it renders as a full event card.
 *  - kind 'reply' → a reply that inherited the event context; it renders as a
 *                   small "Re: …" tag on the bubble.
 */
export interface ChatEventContext {
  id: number;
  title: string;
  date?: string | null;
  kind: 'card' | 'reply';
}

export function getMessageEventContext(message: unknown): ChatEventContext | null {
  const raw = (message as { tsp_event?: unknown } | null | undefined)?.tsp_event;
  if (!raw || typeof raw !== 'object') return null;
  const ctx = raw as Partial<ChatEventContext>;
  const id = Number(ctx.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    title: typeof ctx.title === 'string' && ctx.title ? ctx.title : `Event #${id}`,
    date: typeof ctx.date === 'string' ? ctx.date : null,
    kind: ctx.kind === 'card' ? 'card' : 'reply',
  };
}

export function eventLinkPath(eventId: number): string {
  return `/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
}

/** Parse a date-only or timestamp string as a local calendar date. */
function toLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatShortEventDate(value: string | null | undefined): string | null {
  const date = toLocalDate(value);
  if (!date) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Smith Elementary · Nov 12" */
export function eventContextLabel(ctx: Pick<ChatEventContext, 'title' | 'date'>): string {
  const date = formatShortEventDate(ctx.date);
  return date ? `${ctx.title} · ${date}` : ctx.title;
}

interface LiveEvent {
  id: number;
  organizationName?: string | null;
  department?: string | null;
  status?: string | null;
  scheduledEventDate?: string | null;
  desiredEventDate?: string | null;
}

function useLiveEvent(eventId: number | null | undefined) {
  return useQuery<LiveEvent>({
    enabled: !!eventId,
    queryKey: ['/api/event-requests', String(eventId)],
    queryFn: async () => {
      const res = await fetch(`/api/event-requests/${eventId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch event');
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * "Smith Elementary · Nov 12", using the event's current name and date when
 * they can be loaded (so a rescheduled event never shows its old date), and
 * falling back to what was saved with the message.
 */
export function useEventContextLabel(ctx: Pick<ChatEventContext, 'id' | 'title' | 'date'> | null | undefined): string {
  const { data: event } = useLiveEvent(ctx?.id);
  if (!ctx) return '';
  return eventContextLabel({
    title: event?.organizationName || ctx.title,
    date: event ? event.scheduledEventDate || event.desiredEventDate : ctx.date,
  });
}

function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUS_DEFINITIONS[status as EventStatus]?.label ?? status.replace(/_/g, ' ');
}

function useOpenEvent() {
  const [, navigate] = useLocation();
  return (eventId: number) => navigate(eventLinkPath(eventId));
}

/** Full event card shown on a message sent from an event card. */
export function EventContextCard({
  context,
  compact = false,
}: {
  context: ChatEventContext;
  compact?: boolean;
}) {
  const { data: event } = useLiveEvent(context.id);
  const openEvent = useOpenEvent();

  const title = event?.organizationName || context.title;
  const date = formatShortEventDate(
    event ? event.scheduledEventDate || event.desiredEventDate : context.date
  );
  const status = statusLabel(event?.status);

  return (
    <div
      className={cn(
        'rounded-md border-l-4 border-[#FBAD3F] bg-amber-50 text-gray-900',
        compact ? 'px-2 py-1.5' : 'px-3 py-2'
      )}
    >
      <div className="flex items-start gap-2">
        <CalendarDays className="h-4 w-4 mt-0.5 text-[#D68319] flex-shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#A35C00]">
            About an event
          </div>
          <div className="text-sm font-semibold leading-snug break-words">{title}</div>
          {(date || status) && (
            <div className="text-xs text-gray-600">
              {[date, status].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => openEvent(context.id)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#236383] hover:underline"
      >
        Open event <ExternalLink className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

/** Small "Re: Smith Elementary" tag on a reply that stayed tied to an event. */
export function EventReplyTag({ context, onDark = false }: { context: ChatEventContext; onDark?: boolean }) {
  const openEvent = useOpenEvent();
  return (
    <button
      type="button"
      onClick={() => openEvent(context.id)}
      title="Open this event"
      className={cn(
        'mb-0.5 inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        onDark ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-amber-100 text-[#A35C00] hover:bg-amber-200'
      )}
    >
      <CalendarDays className="h-3 w-3 flex-shrink-0" aria-hidden />
      <span className="truncate">Re: {context.title}</span>
    </button>
  );
}

/** Renders whichever event context a message carries (card, tag, or nothing). */
export function MessageEventContext({ message, onDark = false }: { message: unknown; onDark?: boolean }) {
  const ctx = getMessageEventContext(message);
  if (!ctx) return null;
  return ctx.kind === 'card' ? <EventContextCard context={ctx} compact /> : <EventReplyTag context={ctx} onDark={onDark} />;
}

/** The pinned "Replying about: …" chip above a chat input. */
export function ReplyingAboutChip({
  context,
  isNewMessage,
  onRemove,
}: {
  context: Pick<ChatEventContext, 'id' | 'title' | 'date'>;
  isNewMessage: boolean;
  onRemove: () => void;
}) {
  const label = useEventContextLabel(context);
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-[#7A4500]">
      <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-[#D68319]" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{isNewMessage ? 'About: ' : 'Replying about: '}</span>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title="Send as a regular message instead"
        aria-label="Send as a regular message instead"
        className="rounded p-0.5 hover:bg-amber-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
