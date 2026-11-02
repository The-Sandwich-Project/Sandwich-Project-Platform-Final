import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { Channel, LocalMessage, StreamChat } from 'stream-chat';
import { format, formatDistanceToNow, isToday } from 'date-fns';
import { ArrowLeft, ExternalLink, Minus, Send, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { OnboardingTooltip } from '@/components/ui/onboarding-tooltip';
import {
  MessageEventContext,
  ReplyingAboutChip,
  useEventContextLabel,
  getMessageEventContext,
  type ChatEventContext,
} from './event-context';
import { otherMemberId, type DockWindow } from './chat-dock-context';

export const CHAT_WINDOW_WIDTH = 300;
export const CHAT_WINDOW_HEIGHT = 420;

/* ---------- live channel state ---------- */

interface ChannelView {
  channel: Channel | null;
  messages: LocalMessage[];
  ready: boolean;
  error: boolean;
  /** Re-render counter bumped on any channel / presence event. */
  version: number;
}

function useDockChannel(client: StreamChat, win: DockWindow): ChannelView {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const channel = useMemo(() => client.channel('messaging', win.channelId), [client, win.channelId]);

  useEffect(() => {
    let cancelled = false;
    const bump = () => !cancelled && setVersion((v) => v + 1);

    const sub = channel.on(bump);
    const presenceSub = client.on('user.presence.changed', (e) => {
      if (e.user?.id === win.otherUserId) bump();
    });

    (async () => {
      try {
        if (!channel.initialized) {
          await channel.watch({ presence: true, messages: { limit: 30 } });
        }
        if (!cancelled) {
          setReady(true);
          bump();
        }
      } catch (err) {
        logger.error('Failed to load chat window:', err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      sub.unsubscribe();
      presenceSub.unsubscribe();
    };
  }, [channel, client, win.otherUserId]);

  return {
    channel,
    messages: ready ? [...channel.state.messages] : [],
    ready,
    error,
    version,
  };
}

/* ---------- small helpers ---------- */

function memberUser(channel: Channel | null, userId: string) {
  return channel?.state.members[userId]?.user;
}

function presenceText(online: boolean, lastActive?: string | Date | null): string {
  if (online) return 'Online';
  if (!lastActive) return 'Offline';
  try {
    return `Last seen ${formatDistanceToNow(new Date(lastActive), { addSuffix: true })}`;
  } catch {
    return 'Offline';
  }
}

function receiptTime(date: Date): string {
  return isToday(date) ? format(date, 'h:mmaaa') : format(date, 'EEE h:mmaaa');
}

/**
 * Minimal rendering for message text: keeps line breaks, turns [label](url)
 * and bare URLs into links, and **bold** into bold. (Older event messages
 * carried their context as markdown text.)
 */
function renderText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] && match[2]) {
      nodes.push(
        <a key={key++} href={match[2]} className="underline" target="_blank" rel="noreferrer">
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      nodes.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(
        <a key={key++} href={match[4]} className="underline break-all" target="_blank" rel="noreferrer">
          {match[4]}
        </a>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ---------- the window ---------- */

/**
 * One docked conversation: its tab in the bottom bar, plus (when expanded)
 * the chat window growing straight up out of that tab.
 */
export function ChatDockColumn({
  client,
  win,
  me,
  onToggle,
  onClose,
  onClearPendingEvent,
}: {
  client: StreamChat;
  win: DockWindow;
  me: string;
  onToggle: () => void;
  onClose: () => void;
  onClearPendingEvent: () => void;
}) {
  const view = useDockChannel(client, win);
  return (
    <div className="relative h-full flex-shrink-0" style={{ width: CHAT_WINDOW_WIDTH }}>
      {!win.minimized && (
        <div className="absolute bottom-full right-0">
          <ChatWindowPanel
            view={view}
            win={win}
            me={me}
            onMinimize={onToggle}
            onClose={onClose}
            onClearPendingEvent={onClearPendingEvent}
          />
        </div>
      )}
      <ChatWindowTab view={view} win={win} active={!win.minimized} onToggle={onToggle} onClose={onClose} />
    </div>
  );
}

function ChatWindowTab({
  view,
  win,
  active,
  onToggle,
  onClose,
}: {
  view: ChannelView;
  win: DockWindow;
  active: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const other = memberUser(view.channel, win.otherUserId);
  const name = other?.name || 'Chat';
  const unread = view.ready && view.channel ? view.channel.countUnread() : 0;

  return (
    <div
      className={cn(
        'group flex h-full items-center gap-2 border-l border-gray-200 px-2 text-sm cursor-pointer select-none',
        active ? 'bg-[#e8f3f7]' : 'hover:bg-gray-50',
        unread > 0 && 'bg-[#FFF4E0] animate-[pulse_2s_ease-in-out_3]'
      )}
      style={{ width: CHAT_WINDOW_WIDTH }}
      onClick={onToggle}
      role="button"
      aria-label={`${active ? 'Collapse' : 'Open'} chat with ${name}`}
    >
      <span
        className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', other?.online ? 'bg-green-500' : 'bg-gray-300')}
        aria-label={other?.online ? 'Online' : 'Offline'}
      />
      <span className={cn('min-w-0 flex-1 truncate', unread > 0 && 'font-semibold')}>{name}</span>
      {unread > 0 && (
        <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">{unread}</span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
        aria-label={`Close chat with ${name}`}
        title="Close (the conversation stays in Chats)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChatWindowPanel({
  view,
  win,
  me,
  onMinimize,
  onClose,
  onClearPendingEvent,
  variant = 'popup',
}: {
  view: ChannelView;
  win: DockWindow;
  me: string;
  onMinimize: () => void;
  onClose: () => void;
  onClearPendingEvent: () => void;
  /** 'fullscreen' = the phone conversation screen (no collapse; back instead of close). */
  variant?: 'popup' | 'fullscreen';
}) {
  const [, navigate] = useLocation();
  const fullscreen = variant === 'fullscreen';
  const { channel, messages, ready, error } = view;
  const other = memberUser(channel, win.otherUserId);
  const name = other?.name || 'Chat';

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [dismissedForMessageId, setDismissedForMessageId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.type !== 'deleted' && !m.deleted_at && m.type !== 'system'),
    [messages]
  );
  const lastMessage = visibleMessages[visibleMessages.length - 1];

  /* -- "Replying about" chip -- */
  const inherited = lastMessage ? getMessageEventContext(lastMessage) : null;
  const chip: ChatEventContext | null = win.pendingEvent
    ? win.pendingEvent
    : inherited && dismissedForMessageId !== lastMessage?.id
      ? { ...inherited, kind: 'reply' }
      : null;

  const removeChip = () => {
    if (win.pendingEvent) onClearPendingEvent();
    else if (lastMessage) setDismissedForMessageId(lastMessage.id);
  };

  /* -- focus only when the user opened this window themselves -- */
  // (Waits until the conversation has loaded — the input is disabled until then.)
  const handledFocusRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!win.focusRequest || !ready || handledFocusRequest.current === win.focusRequest) return;
    handledFocusRequest.current = win.focusRequest;
    inputRef.current?.focus({ preventScroll: true });
  }, [win.focusRequest, ready]);

  /* -- "read" means the user is actually in this window -- */
  const unread = ready && channel ? channel.countUnread() : 0;
  // On a phone, opening the conversation screen is itself the deliberate act.
  const engaged = fullscreen || focusWithin;
  useEffect(() => {
    if (!channel || !ready || !engaged || unread === 0) return;
    channel.markRead().catch((err) => logger.warn('markRead failed:', err));
  }, [channel, ready, engaged, unread]);

  /* -- keep scrolled to the newest message -- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length, ready]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const loadOlder = useCallback(async () => {
    if (!channel || loadingOlder || !visibleMessages.length) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await channel.query({ messages: { limit: 30, id_lt: visibleMessages[0].id } });
      if ((res.messages?.length ?? 0) < 30) setHasOlder(false);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      logger.warn('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [channel, loadingOlder, visibleMessages]);

  /* -- read receipt for my latest message -- */
  const myLastMessage = [...visibleMessages].reverse().find((m) => m.user?.id === me);
  const theirRead = channel?.state.read[win.otherUserId]?.last_read;
  let receipt: string | null = null;
  if (myLastMessage?.created_at) {
    const sentAt = new Date(myLastMessage.created_at);
    receipt =
      theirRead && new Date(theirRead) >= sentAt ? `Read · ${receiptTime(new Date(theirRead))}` : 'Sent';
  }

  const send = async () => {
    const text = draft.trim();
    if (!text || !channel || sending) return;
    setSending(true);
    try {
      const payload: Record<string, unknown> = { text };
      if (chip) {
        payload.tsp_event = {
          id: chip.id,
          title: chip.title,
          date: chip.date ?? null,
          kind: win.pendingEvent ? 'card' : 'reply',
        };
      }
      stickToBottom.current = true;
      await channel.sendMessage(payload as any);
      setDraft('');
      if (win.pendingEvent) onClearPendingEvent();
    } catch (err) {
      logger.error('Failed to send chat message:', err);
    } finally {
      setSending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const headerContextLabel = useEventContextLabel(chip);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      className={cn(
        'flex flex-col overflow-hidden bg-white outline-none',
        fullscreen
          ? 'h-full w-full'
          : cn(
              'rounded-t-lg border border-b-0 shadow-2xl',
              unread > 0 && !focusWithin ? 'border-[#FBAD3F] ring-2 ring-[#FBAD3F]/60' : 'border-gray-300'
            )
      )}
      style={fullscreen ? undefined : { width: CHAT_WINDOW_WIDTH, height: CHAT_WINDOW_HEIGHT }}
      role="dialog"
      aria-label={`Chat with ${name}`}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-start gap-2 px-3 py-2 text-white',
          !fullscreen && 'cursor-pointer',
          unread > 0 && !engaged ? 'bg-[#D68319]' : 'bg-[#236383]'
        )}
        onClick={fullscreen ? undefined : onMinimize}
      >
        {fullscreen && (
          <button
            type="button"
            onClick={onClose}
            className="-ml-1 rounded p-1 hover:bg-white/20"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <span
          className={cn(
            'mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0 ring-2 ring-white/70',
            other?.online ? 'bg-green-400' : 'bg-gray-400'
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-[11px] text-white/80">
            {presenceText(!!other?.online, other?.last_active as string | undefined)}
          </div>
          {chip && headerContextLabel && (
            <div className="truncate text-[11px] font-medium text-amber-100">Re: {headerContextLabel}</div>
          )}
        </div>
        {!fullscreen && <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="rounded p-1 hover:bg-white/20"
            title="Open in Team Chat"
            aria-label="Open in Team Chat"
            onClick={() => navigate('/dashboard?section=chat&tab=dms')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-white/20"
            title="Collapse"
            aria-label="Collapse"
            onClick={onMinimize}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-white/20"
            title="Close (the conversation stays in Chats)"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-gray-50 px-2.5 py-2 space-y-1.5">
        {!ready && !error && (
          <div className="flex h-full items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {error && (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-500">
            Couldn't load this conversation. Try closing and reopening it.
          </div>
        )}
        {ready && hasOlder && visibleMessages.length >= 30 && (
          <div className="text-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs text-[#236383] hover:underline disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {ready && visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-500">
            No messages yet. Say hi!
          </div>
        )}
        {visibleMessages.map((m) => {
          const mine = m.user?.id === me;
          const hasContext = !!getMessageEventContext(m);
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm shadow-sm',
                  mine ? 'bg-[#236383] text-white rounded-br-sm' : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm',
                  hasContext && 'space-y-1'
                )}
                title={m.created_at ? format(new Date(m.created_at), 'EEE MMM d, h:mmaaa') : undefined}
              >
                <MessageEventContext message={m} onDark={mine} />
                {m.text && <div className="whitespace-pre-wrap break-words">{renderText(m.text)}</div>}
                {(m.attachments || []).map((a, i) => {
                  const url = a.image_url || a.asset_url || a.thumb_url;
                  if (!url) return null;
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className={cn('block truncate text-xs underline', mine ? 'text-white/90' : 'text-[#236383]')}
                    >
                      📎 {a.title || a.fallback || 'Attachment'}
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
        {receipt && (
          <div className="pr-1 text-right text-[11px] text-gray-500" aria-live="polite">
            {receipt}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white p-2 space-y-1.5">
        {chip && (
          <OnboardingTooltip
            step="chat-event-reply"
            position="top"
            // Only once they're actually in this window, never over a popup that just opened by itself
            showWhen={!!chip && engaged}
            completeOnChildClick={false}
          >
            <ReplyingAboutChip context={chip} isNewMessage={!!win.pendingEvent} onRemove={removeChip} />
          </OnboardingTooltip>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={other?.online ? 'Message…' : `Message… (${name.split(' ')[0]} will see it later)`}
            className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#236383] focus:outline-none focus:ring-1 focus:ring-[#236383]"
            disabled={!ready}
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() || sending || !ready}
            className="rounded-md bg-[#236383] p-2 text-white hover:bg-[#236383] disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A single DM as a full screen — used on phones, where there's no room for
 * popups. Same conversation, event cards and read receipts as the popup.
 */
export function ChatConversationScreen({
  client,
  channelId,
  me,
  onBack,
}: {
  client: StreamChat;
  channelId: string;
  me: string;
  onBack: () => void;
}) {
  const [otherUserId, setOtherUserId] = useState('');
  const win: DockWindow = useMemo(
    () => ({ cid: `messaging:${channelId}`, channelId, otherUserId, minimized: false }),
    [channelId, otherUserId]
  );
  const view = useDockChannel(client, win);

  useEffect(() => {
    if (view.ready && view.channel && !otherUserId) {
      const other = otherMemberId(view.channel, me);
      if (other) setOtherUserId(other);
    }
  }, [view.ready, view.channel, otherUserId, me]);

  return (
    <ChatWindowPanel
      view={view}
      win={win}
      me={me}
      variant="fullscreen"
      onMinimize={onBack}
      onClose={onBack}
      onClearPendingEvent={() => {}}
    />
  );
}
