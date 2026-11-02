import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { Channel } from 'stream-chat';
import { formatDistanceToNowStrict } from 'date-fns';
import { MessageCircle, Search, X, ChevronUp, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { useAuth } from '@/hooks/useAuth';
import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';
import { useChatDock, isDirectMessage, otherMemberId } from './chat-dock-context';
import { ChatDockColumn, CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT } from './chat-popup-window';
import { getMessageEventContext, useEventContextLabel } from './event-context';

/** Height of the bottom bar. Exposed to the page as --chat-dock-height. */
export const CHAT_DOCK_HEIGHT = 36;

const LAUNCHER_WIDTH = 190;
const ONLINE_WIDTH = 104; // also the lane the corner buttons sit above
const OVERFLOW_WIDTH = 64;

interface BasicUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  /** From /api/users/basic: false when this person has no Team Chat access. */
  canChat?: boolean;
}

function userName(u: BasicUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  return u.displayName || u.firstName || u.email || 'Team member';
}

function useOnlineUsers() {
  return useQuery<BasicUser[]>({
    queryKey: ['/api/users/online'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/users/online');
      return Array.isArray(response) ? response : [];
    },
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** How many expanded/tabbed conversations fit next to each other. */
function useVisibleSlots(): number {
  const compute = () => {
    if (typeof window === 'undefined') return 3;
    const free = window.innerWidth - LAUNCHER_WIDTH - ONLINE_WIDTH - OVERFLOW_WIDTH - 16;
    return Math.max(1, Math.min(3, Math.floor(free / CHAT_WINDOW_WIDTH)));
  };
  const [slots, setSlots] = useState(compute);
  useEffect(() => {
    const onResize = () => setSlots(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return slots;
}

/**
 * Tell the rest of the page how much room the dock takes, so layouts can
 * stop above the bar instead of disappearing under it, and corner buttons
 * can sit above it.
 */
function usePublishDockSpace(enabled: boolean, anyExpanded: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.style.removeProperty('--chat-dock-height');
      root.style.removeProperty('--chat-window-space');
      return;
    }
    root.style.setProperty('--chat-dock-height', `${CHAT_DOCK_HEIGHT}px`);
    root.style.setProperty('--chat-window-space', anyExpanded ? `${CHAT_WINDOW_HEIGHT}px` : '0px');
    return () => {
      root.style.removeProperty('--chat-dock-height');
      root.style.removeProperty('--chat-window-space');
    };
  }, [enabled, anyExpanded]);
}

export function ChatDock() {
  const dock = useChatDock();
  const { dmsUnread } = useStreamChatUnread();
  const { data: onlineUsers = [] } = useOnlineUsers();
  const { user } = useAuth();
  const slots = useVisibleSlots();
  const [overflowOpen, setOverflowOpen] = useState(false);

  const { connection, dockEnabled, windows } = dock;
  const visible = windows.slice(0, slots);
  const overflow = windows.slice(slots);
  const anyExpanded = visible.some((w) => !w.minimized);
  usePublishDockSpace(dockEnabled, anyExpanded);

  const othersOnline = onlineUsers.filter((u) => String(u.id) !== String(user?.id));

  if (!dockEnabled || !connection) return null;
  const { client, streamUserId: me } = connection;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[900] flex items-stretch border-t border-gray-300 bg-white text-gray-800 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
      style={{ height: CHAT_DOCK_HEIGHT }}
      data-chat-dock
    >
      {/* Launcher */}
      <div className="relative flex-shrink-0" style={{ width: LAUNCHER_WIDTH }}>
        <button
          type="button"
          onClick={() => dock.setLauncherOpen(!dock.launcherOpen)}
          className={cn(
            'flex h-full w-full items-center gap-2 px-3 text-sm font-semibold',
            dock.launcherOpen ? 'bg-[#e8f3f7] text-[#236383]' : 'hover:bg-gray-50',
            dmsUnread > 0 && !dock.launcherOpen && 'text-[#A35C00]'
          )}
          aria-expanded={dock.launcherOpen}
        >
          <MessageCircle className="h-4 w-4" />
          Chats
          {dmsUnread > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
              {dmsUnread > 99 ? '99+' : dmsUnread}
            </span>
          )}
          <ChevronUp className={cn('ml-auto h-4 w-4 transition-transform', !dock.launcherOpen && 'rotate-180')} />
        </button>
        {dock.launcherOpen && <ChatLauncherPanel onlineUsers={othersOnline} />}
      </div>

      <div className="flex-1" />

      {/* Conversations that don't fit */}
      {overflow.length > 0 && (
        <div className="relative flex-shrink-0 border-l border-gray-200" style={{ width: OVERFLOW_WIDTH }}>
          <button
            type="button"
            onClick={() => setOverflowOpen((o) => !o)}
            className="flex h-full w-full items-center justify-center text-sm font-semibold hover:bg-gray-50"
            aria-label={`${overflow.length} more chats`}
          >
            +{overflow.length}
          </button>
          {overflowOpen && (
            <div className="absolute bottom-full right-0 mb-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              {overflow.map((w) => {
                const ch = client.activeChannels[w.cid];
                const unread = ch ? ch.countUnread() : 0;
                const name = (client.state.users[w.otherUserId]?.name as string | undefined) || 'Chat';
                return (
                  <div key={w.cid} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                    <button
                      type="button"
                      className={cn('min-w-0 flex-1 truncate text-left', unread > 0 && 'font-semibold')}
                      onClick={() => {
                        dock.expandWindow(w.cid);
                        setOverflowOpen(false);
                      }}
                    >
                      {name}
                    </button>
                    {unread > 0 && (
                      <span className="rounded-full bg-red-500 px-1.5 text-[11px] text-white">{unread}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => dock.closeWindow(w.cid)}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label={`Close chat with ${name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Docked conversations: the newest sits closest to the right edge */}
      <div className="flex flex-row-reverse items-stretch">
        {visible.map((w) => (
          <ChatDockColumn
            key={w.cid}
            client={client}
            win={w}
            me={me}
            onToggle={() => dock.toggleMinimized(w.cid)}
            onClose={() => dock.closeWindow(w.cid)}
            onClearPendingEvent={() => dock.clearPendingEvent(w.cid)}
          />
        ))}
      </div>

      {/* Who's online (right lane — corner buttons stack above this) */}
      <button
        type="button"
        onClick={() => dock.setLauncherOpen(true)}
        className="flex flex-shrink-0 items-center justify-center gap-1.5 border-l border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
        style={{ width: ONLINE_WIDTH }}
        title="See who's online"
      >
        <span className={cn('h-2 w-2 rounded-full', othersOnline.length ? 'bg-green-500' : 'bg-gray-300')} />
        {othersOnline.length} online
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Launcher panel: recent conversations, who's online, start a chat    */
/* ------------------------------------------------------------------ */

function ChatLauncherPanel({ onlineUsers }: { onlineUsers: BasicUser[] }) {
  const dock = useChatDock();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<Channel[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const connection = dock.connection;
  const event = dock.launcherEvent;

  const { data: allUsers = [] } = useQuery<BasicUser[]>({
    queryKey: ['/api/users/basic'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/users/basic');
      return Array.isArray(response) ? response : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Recent DMs, live-updating while the panel is open
  useEffect(() => {
    if (!connection) return;
    const { client, streamUserId: me } = connection;
    let cancelled = false;
    const load = async () => {
      try {
        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [me] }, member_count: 2 },
          { last_message_at: -1 },
          { limit: 15, watch: true, presence: true, state: true }
        );
        if (!cancelled) setRecent(channels.filter((c) => isDirectMessage(c) && c.state.messages.length > 0));
      } catch (error) {
        logger.warn('Failed to load recent chats:', error);
        if (!cancelled) setRecent([]);
      }
    };
    load();
    const subs = [
      client.on('message.new', load),
      client.on('notification.message_new', load),
      client.on('notification.mark_read', () => setTick((t) => t + 1)),
      client.on('message.read', () => setTick((t) => t + 1)),
      client.on('user.presence.changed', () => setTick((t) => t + 1)),
    ];
    return () => {
      cancelled = true;
      subs.forEach((s) => s.unsubscribe());
    };
  }, [connection]);

  // Typing straight into search when picking someone for an event message
  useEffect(() => {
    if (event) searchRef.current?.focus();
  }, [event]);

  // Close on Escape or a click outside the panel / launcher button
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-chat-dock]')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  });

  function close() {
    dock.setLauncherOpen(false);
    dock.clearLauncherEvent();
  }

  const openUser = async (appUserId: string) => {
    setOpening(appUserId);
    try {
      await dock.openWithUser(appUserId, { event });
      close();
    } finally {
      setOpening(null);
    }
  };

  const me = connection?.streamUserId;
  const onlineIds = useMemo(() => new Set(onlineUsers.map((u) => String(u.id))), [onlineUsers]);
  const query = search.trim().toLowerCase();
  const people = useMemo(
    () =>
      allUsers
        .filter((u) => String(u.id) !== String(user?.id))
        // Only people who can actually see chat — otherwise the message goes nowhere.
        .filter((u) => u.canChat !== false)
        .filter((u) => !query || userName(u).toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query))
        .sort((a, b) => {
          const ao = onlineIds.has(String(a.id)) ? 0 : 1;
          const bo = onlineIds.has(String(b.id)) ? 0 : 1;
          return ao - bo || userName(a).localeCompare(userName(b));
        })
        .slice(0, 30),
    [allUsers, query, user?.id, onlineIds]
  );

  const showRecent = !query && !event;
  const eventLabel = useEventContextLabel(event);
  const noChatAccess = useMemo(
    () => new Set(allUsers.filter((u) => u.canChat === false).map((u) => String(u.id))),
    [allUsers]
  );
  const reachableOnline = onlineUsers.filter((u) => !noChatAccess.has(String(u.id)));

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-2 mb-1 flex w-[320px] flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl"
      style={{ maxHeight: 'min(480px, calc(100vh - 120px))' }}
      role="dialog"
      aria-label="Chats"
    >
      <div className="flex items-center justify-between bg-[#236383] px-3 py-2 text-white">
        <span className="text-sm font-semibold">{event ? 'Message someone about this event' : 'Chats'}</span>
        <button type="button" onClick={close} className="rounded p-1 hover:bg-white/20" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {event && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#7A4500]">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">About: </span>
            {eventLabel}
          </span>
          <button
            type="button"
            onClick={dock.clearLauncherEvent}
            className="rounded p-0.5 hover:bg-amber-200"
            title="Send a regular message instead"
            aria-label="Send a regular message instead"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="border-b border-gray-200 p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={event ? 'Who should get this?' : 'Message someone…'}
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:border-[#236383] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showRecent && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {recent === null && (
              <div className="flex justify-center py-3 text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {recent?.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">No conversations yet. Search above to start one.</div>
            )}
            {recent?.map((ch) => {
              if (!me) return null;
              const otherId = otherMemberId(ch, me);
              const other = otherId ? ch.state.members[otherId]?.user : undefined;
              const msgs = ch.state.messages;
              const last = msgs[msgs.length - 1];
              const unread = ch.countUnread();
              const ctx = last ? getMessageEventContext(last) : null;
              const preview = last
                ? `${last.user?.id === me ? 'You: ' : ''}${last.text || (ctx ? `About: ${ctx.title}` : 'Attachment')}`
                : '';
              return (
                <button
                  key={ch.cid}
                  type="button"
                  onClick={() => {
                    dock.openChannel(ch, { userInitiated: true });
                    close();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <PresenceDot online={!!other?.online} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn('truncate text-sm', unread > 0 ? 'font-semibold' : 'font-medium')}>
                        {other?.name || 'Chat'}
                      </span>
                      {last?.created_at && (
                        <span className="ml-auto flex-shrink-0 text-[11px] text-gray-400">
                          {formatDistanceToNowStrict(new Date(last.created_at))}
                        </span>
                      )}
                    </div>
                    <div className={cn('truncate text-xs', unread > 0 ? 'text-gray-900' : 'text-gray-500')}>{preview}</div>
                  </div>
                  {unread > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">{unread}</span>
                  )}
                </button>
              );
            })}

            <SectionLabel>
              <Users className="mr-1 inline h-3 w-3" /> Online now
            </SectionLabel>
            {reachableOnline.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">Nobody else is online.</div>
            )}
            {reachableOnline.map((u) => (
              <PersonRow key={u.id} name={userName(u)} online busy={opening === String(u.id)} onClick={() => openUser(String(u.id))} />
            ))}
          </>
        )}

        {!showRecent && (
          <>
            <SectionLabel>{query ? 'People' : 'Everyone'}</SectionLabel>
            {people.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">No one matches “{search}”.</div>}
            {people.map((u) => (
              <PersonRow
                key={u.id}
                name={userName(u)}
                online={onlineIds.has(String(u.id))}
                busy={opening === String(u.id)}
                onClick={() => openUser(String(u.id))}
              />
            ))}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          close();
          navigate('/dashboard?section=chat');
        }}
        className="border-t border-gray-200 px-3 py-2 text-left text-xs font-medium text-[#236383] hover:bg-gray-50"
      >
        Open Team Chat (rooms, groups & full history) →
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</div>
  );
}

function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', online ? 'bg-green-500' : 'bg-gray-300')}
      aria-label={online ? 'Online' : 'Offline'}
    />
  );
}

function PersonRow({
  name,
  online,
  busy,
  onClick,
}: {
  name: string;
  online: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-60"
    >
      <PresenceDot online={online} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
      ) : (
        <span className="text-[11px] text-gray-400">{online ? 'Online' : 'Offline'}</span>
      )}
    </button>
  );
}
