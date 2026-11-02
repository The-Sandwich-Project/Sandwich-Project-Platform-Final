import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'wouter';
import type { Channel, Event as StreamEvent } from 'stream-chat';
import { useAuth } from '@/hooks/useAuth';
import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';
import { getStreamClient, type StreamConnection } from '@/lib/stream-client';
import { apiRequest } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import type { ChatEventContext } from './event-context';

/**
 * Bottom-of-screen chat popups ("chat dock").
 *
 * Every popup is a view onto a 1:1 Team Chat DM in Stream, so a conversation
 * is the same whether it's read here or on the Team Chat page. This provider
 * owns which windows are open, opens them for new DMs, and remembers them
 * across page loads. The UI lives in chat-dock.tsx.
 */

export interface DockWindow {
  cid: string;
  channelId: string;
  /** Stream user id of the other person (user_<appId>) */
  otherUserId: string;
  minimized: boolean;
  /** Event pinned by an event card's "Message" button; cleared once sent or removed. */
  pendingEvent?: ChatEventContext | null;
  /** Bumped when the user opened/clicked the window themselves → focus its input. */
  focusRequest?: number;
}

export interface MobileChatBanner {
  id: string;
  senderName: string;
  preview: string;
  channelId: string;
}

interface ChatDockContextValue {
  connection: StreamConnection | null;
  /** True when the desktop bar + popups are showing for this user/screen. */
  dockEnabled: boolean;
  /** True when chat is available to this user at all (any screen size). */
  chatEnabled: boolean;
  windows: DockWindow[];
  launcherOpen: boolean;
  setLauncherOpen: (open: boolean) => void;
  /** Event waiting for the user to pick who to message about it. */
  launcherEvent: ChatEventContext | null;
  /** Start a message about an event: opens the launcher to pick a recipient. */
  startEventMessage: (event: Omit<ChatEventContext, 'kind'>) => void;
  clearLauncherEvent: () => void;
  /** Open (or focus) the DM with an app user. */
  openWithUser: (appUserId: string, opts?: { event?: ChatEventContext | null }) => Promise<void>;
  /** Open (or focus) an existing DM channel. */
  openChannel: (channel: Channel, opts?: { userInitiated?: boolean }) => void;
  toggleMinimized: (cid: string) => void;
  expandWindow: (cid: string) => void;
  closeWindow: (cid: string) => void;
  clearPendingEvent: (cid: string) => void;
  mobileBanner: MobileChatBanner | null;
  dismissMobileBanner: () => void;
}

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export function useChatDock(): ChatDockContextValue {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock must be used within ChatDockProvider');
  return ctx;
}

/** Same as useChatDock, but returns null outside the provider instead of throwing. */
export function useChatDockOptional(): ChatDockContextValue | null {
  return useContext(ChatDockContext);
}

const DESKTOP_QUERY = '(min-width: 768px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

/* ---------- per-browser persistence (convenience only) ---------- */

function storageKey(userId: string, name: string) {
  return `tsp.chatDock.v1.${name}.${userId}`;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — windows just won't be remembered */
  }
}

/* ---------- helpers ---------- */

export function isDirectMessage(channel: Channel | null | undefined): boolean {
  if (!channel || channel.type !== 'messaging') return false;
  const count =
    (channel.data?.member_count as number | undefined) ??
    Object.keys(channel.state?.members || {}).length;
  return count === 2 && !(channel.data as { name?: string } | undefined)?.name;
}

export function otherMemberId(channel: Channel, me: string): string | null {
  const ids = Object.keys(channel.state?.members || {});
  return ids.find((id) => id !== me) ?? null;
}

function isOnTeamChatPage(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('section') === 'chat';
  } catch {
    return false;
  }
}

const MAX_TRACKED_WINDOWS = 8;

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const isDesktop = useIsDesktop();

  // Keeps the shared connection, unread badges, and activity heartbeat running.
  useStreamChatUnread();

  const userId = user?.id ? String(user.id) : null;
  const chatEnabled = !!user && hasPermission(user as any, PERMISSIONS.NAV_TEAM_CHAT);
  const onMobileShell = location === '/m' || location.startsWith('/m/');
  const dockEnabled = chatEnabled && isDesktop && !onMobileShell;

  const [connection, setConnection] = useState<StreamConnection | null>(null);
  const [windows, setWindows] = useState<DockWindow[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherEvent, setLauncherEvent] = useState<ChatEventContext | null>(null);
  const [mobileBanner, setMobileBanner] = useState<MobileChatBanner | null>(null);

  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const dockEnabledRef = useRef(dockEnabled);
  dockEnabledRef.current = dockEnabled;
  const channelIdByUser = useRef(new Map<string, string>());
  const restoredFor = useRef<string | null>(null);

  /* ---- connect ---- */
  useEffect(() => {
    if (!user || !chatEnabled) {
      setConnection(null);
      return;
    }
    let cancelled = false;
    getStreamClient(user).then((conn) => {
      if (!cancelled) setConnection(conn);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, chatEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- restore remembered windows ---- */
  useEffect(() => {
    if (!userId || restoredFor.current === userId) return;
    restoredFor.current = userId;
    const stored = readStored<DockWindow[]>(storageKey(userId, 'windows'), []);
    setWindows(
      Array.isArray(stored)
        ? stored
            .filter((w) => w && typeof w.cid === 'string' && typeof w.channelId === 'string')
            .map((w) => ({ cid: w.cid, channelId: w.channelId, otherUserId: w.otherUserId, minimized: !!w.minimized }))
        : []
    );
  }, [userId]);

  /* ---- remember windows ---- */
  useEffect(() => {
    if (!userId || restoredFor.current !== userId) return;
    writeStored(
      storageKey(userId, 'windows'),
      windows.map(({ cid, channelId, otherUserId, minimized }) => ({ cid, channelId, otherUserId, minimized }))
    );
  }, [windows, userId]);

  /* ---- window operations ---- */

  // Remember the newest message someone closed a window on, so an unread DM
  // they deliberately closed doesn't keep popping back up on every page load.
  const markClosedAt = useCallback(
    (cid: string, lastMessageId: string | null) => {
      if (!userId) return;
      const key = storageKey(userId, 'closed');
      const closed = readStored<Record<string, string | null>>(key, {});
      closed[cid] = lastMessageId;
      writeStored(key, closed);
    },
    [userId]
  );

  const wasClosedAt = useCallback(
    (cid: string): string | null | undefined => {
      if (!userId) return undefined;
      return readStored<Record<string, string | null>>(storageKey(userId, 'closed'), {})[cid];
    },
    [userId]
  );

  const upsertWindow = useCallback(
    (win: Omit<DockWindow, 'minimized'> & { minimized?: boolean }, userInitiated: boolean) => {
      setWindows((prev) => {
        const existing = prev.find((w) => w.cid === win.cid);
        const rest = prev.filter((w) => w.cid !== win.cid);
        const merged: DockWindow = {
          ...existing,
          ...win,
          // A popup that opens on its own never un-collapses a window the user collapsed.
          minimized: userInitiated ? false : existing ? existing.minimized : !!win.minimized,
          pendingEvent: win.pendingEvent !== undefined ? win.pendingEvent : existing?.pendingEvent,
          focusRequest: userInitiated ? Date.now() : existing?.focusRequest,
        };
        // User-opened windows (and new arrivals) move to the front (rightmost).
        const next = userInitiated || !existing ? [merged, ...rest] : prev.map((w) => (w.cid === win.cid ? merged : w));
        return next.slice(0, MAX_TRACKED_WINDOWS);
      });
    },
    []
  );

  const openChannel = useCallback(
    (channel: Channel, opts?: { userInitiated?: boolean }) => {
      const me = connection?.streamUserId;
      if (!me || !channel.id) return;
      const other = otherMemberId(channel, me);
      if (!other) return;
      channelIdByUser.current.set(other, channel.id);
      upsertWindow(
        { cid: channel.cid, channelId: channel.id, otherUserId: other },
        !!opts?.userInitiated
      );
    },
    [connection?.streamUserId, upsertWindow]
  );

  const openWithUser = useCallback(
    async (appUserId: string, opts?: { event?: ChatEventContext | null }) => {
      const otherStreamId = `user_${appUserId}`;

      // No popups on small screens: send people to the full chat page instead.
      if (!dockEnabledRef.current) {
        navigate(onMobileShell ? '/m/chat' : '/dashboard?section=chat&tab=dms');
        return;
      }
      if (!connection) {
        toast({ title: 'Chat is still connecting', description: 'Try again in a moment.' });
        return;
      }
      try {
        let channelId = channelIdByUser.current.get(otherStreamId);
        if (!channelId) {
          // Server creates the DM if needed and registers anyone new to chat.
          const res = await apiRequest('POST', '/api/stream/channels', {
            participants: [appUserId],
            channelType: 'messaging',
          });
          channelId = res?.channelId;
          if (!channelId) throw new Error('No channel id returned');
          channelIdByUser.current.set(otherStreamId, channelId);
        }
        upsertWindow(
          {
            cid: `messaging:${channelId}`,
            channelId,
            otherUserId: otherStreamId,
            pendingEvent: opts?.event ?? undefined,
          },
          true
        );
      } catch (error) {
        logger.error('Failed to open chat window:', error);
        toast({
          title: "Couldn't open that chat",
          description: 'Please try again.',
          variant: 'destructive',
        });
      }
    },
    [connection, navigate, onMobileShell, toast, upsertWindow]
  );

  const toggleMinimized = useCallback((cid: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.cid === cid
          ? { ...w, minimized: !w.minimized, focusRequest: w.minimized ? Date.now() : w.focusRequest }
          : w
      )
    );
  }, []);

  const expandWindow = useCallback((cid: string) => {
    setWindows((prev) => {
      const win = prev.find((w) => w.cid === cid);
      if (!win) return prev;
      // Bring to the front so it's visible even if it was in the overflow list.
      return [{ ...win, minimized: false, focusRequest: Date.now() }, ...prev.filter((w) => w.cid !== cid)];
    });
  }, []);

  const closeWindow = useCallback(
    (cid: string) => {
      const channel = connection?.client.activeChannels[cid];
      const msgs = channel?.state.messages || [];
      markClosedAt(cid, msgs.length ? msgs[msgs.length - 1].id : null);
      setWindows((prev) => prev.filter((w) => w.cid !== cid));
    },
    [connection, markClosedAt]
  );

  const clearPendingEvent = useCallback((cid: string) => {
    setWindows((prev) => prev.map((w) => (w.cid === cid ? { ...w, pendingEvent: null } : w)));
  }, []);

  const startEventMessage = useCallback(
    (event: Omit<ChatEventContext, 'kind'>) => {
      if (!dockEnabledRef.current) {
        navigate(onMobileShell ? '/m/chat' : '/dashboard?section=chat&tab=dms');
        return;
      }
      setLauncherEvent({ ...event, kind: 'card' });
      setLauncherOpen(true);
    },
    [navigate, onMobileShell]
  );

  const clearLauncherEvent = useCallback(() => setLauncherEvent(null), []);

  /* ---- pop windows open for new DMs ---- */
  useEffect(() => {
    if (!connection || !chatEnabled) return;
    const { client, streamUserId: me } = connection;

    const handleIncoming = async (event: StreamEvent) => {
      const message = event.message;
      if (!message || message.user?.id === me) return;
      const cid = event.cid || (event.channel as { cid?: string } | undefined)?.cid;
      if (!cid || !cid.startsWith('messaging:')) return;

      let channel: Channel | undefined = client.activeChannels[cid];
      if (!channel) {
        try {
          const [type, id] = cid.split(':');
          channel = client.channel(type, id);
          await channel.watch({ presence: true });
        } catch (error) {
          logger.warn('Could not load channel for incoming chat message:', error);
          return;
        }
      }
      if (!isDirectMessage(channel)) return;

      if (!dockEnabledRef.current) {
        // Phones: a brief banner at the top instead of a popup.
        // Already looking at chat — no banner needed.
        if (isOnTeamChatPage() || window.location.pathname.startsWith('/m/chat')) return;
        const text = message.text || (message.attachments?.length ? 'Sent an attachment' : 'New message');
        setMobileBanner({
          id: message.id,
          senderName: message.user?.name || 'Someone',
          preview: text.length > 90 ? `${text.slice(0, 90)}…` : text,
          channelId: channel.id || '',
        });
        return;
      }

      // Already looking at Team Chat — no need to pop anything.
      if (isOnTeamChatPage()) return;
      openChannel(channel, { userInitiated: false });
    };

    const subs = [
      client.on('message.new', handleIncoming),
      client.on('notification.message_new', handleIncoming),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, [connection, chatEnabled, openChannel]);

  /* ---- on arrival, pop up DMs with unread messages ---- */
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!connection || !dockEnabled || !userId) return;
    if (autoOpenedFor.current === userId) return;
    autoOpenedFor.current = userId;
    const { client, streamUserId: me } = connection;

    (async () => {
      try {
        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [me] }, member_count: 2 },
          { last_message_at: -1 },
          { limit: 20, watch: true, presence: true, state: true }
        );
        if (isOnTeamChatPage()) return;
        const unread = channels.filter((ch) => {
          if (!isDirectMessage(ch) || ch.countUnread() === 0) return false;
          const msgs = ch.state.messages;
          const lastId = msgs.length ? msgs[msgs.length - 1].id : null;
          // Don't re-pop a conversation the user closed, unless something new arrived since.
          const closedAt = wasClosedAt(ch.cid);
          return closedAt === undefined || closedAt !== lastId;
        });
        // Newest conversation opens expanded; the rest wait as highlighted tabs.
        unread
          .slice()
          .reverse()
          .forEach((ch, i, arr) => {
            const other = otherMemberId(ch, me);
            if (!other || !ch.id) return;
            channelIdByUser.current.set(other, ch.id);
            const isNewest = i === arr.length - 1;
            const already = windowsRef.current.some((w) => w.cid === ch.cid);
            if (already) return;
            upsertWindow(
              { cid: ch.cid, channelId: ch.id, otherUserId: other, minimized: !isNewest },
              false
            );
          });
      } catch (error) {
        logger.warn('Could not check for unread chats:', error);
      }
    })();
  }, [connection, dockEnabled, userId, upsertWindow, wasClosedAt]);

  /* ---- reset on logout ---- */
  useEffect(() => {
    if (user) return;
    setWindows([]);
    setLauncherOpen(false);
    setLauncherEvent(null);
    setMobileBanner(null);
    restoredFor.current = null;
    autoOpenedFor.current = null;
    channelIdByUser.current.clear();
  }, [user]);

  const value = useMemo<ChatDockContextValue>(
    () => ({
      connection,
      dockEnabled,
      chatEnabled,
      windows,
      launcherOpen,
      setLauncherOpen,
      launcherEvent,
      startEventMessage,
      clearLauncherEvent,
      openWithUser,
      openChannel,
      toggleMinimized,
      expandWindow,
      closeWindow,
      clearPendingEvent,
      mobileBanner,
      dismissMobileBanner: () => setMobileBanner(null),
    }),
    [
      connection,
      dockEnabled,
      chatEnabled,
      windows,
      launcherOpen,
      launcherEvent,
      startEventMessage,
      clearLauncherEvent,
      openWithUser,
      openChannel,
      toggleMinimized,
      expandWindow,
      closeWindow,
      clearPendingEvent,
      mobileBanner,
    ]
  );

  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

/* ---------- "Message" button on event cards ---------- */

interface EventLike {
  id: number;
  organizationName?: string | null;
  scheduledEventDate?: string | Date | null;
  desiredEventDate?: string | Date | null;
}

function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/**
 * Returns a click handler for an event card's "Message" button: opens the
 * bottom-bar chat picker with the event pinned, so whoever gets the message
 * sees exactly which event it's about.
 */
export function useMessageAboutEvent(request: EventLike): () => void {
  const dock = useChatDockOptional();
  return useCallback(() => {
    dock?.startEventMessage({
      id: request.id,
      title: request.organizationName || `Event #${request.id}`,
      date: toDateString(request.scheduledEventDate) ?? toDateString(request.desiredEventDate),
    });
  }, [dock, request.id, request.organizationName, request.scheduledEventDate, request.desiredEventDate]);
}
