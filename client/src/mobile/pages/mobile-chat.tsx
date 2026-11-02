import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import {
  Search,
  Edit,
  Hash,
  Users,
  ChevronRight,
  MessageCircle,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import type { Channel as StreamChannel } from 'stream-chat';
import { useChatDock, isDirectMessage, otherMemberId } from '@/components/chat/chat-dock-context';
import { getMessageEventContext } from '@/components/chat/event-context';

interface Conversation {
  id: string;
  participantName: string;
  online: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: boolean;
}

/** The user's Team Chat DMs (the same conversations as the desktop popups). */
function useDirectMessages(enabled: boolean): Conversation[] | null {
  const { connection } = useChatDock();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  useEffect(() => {
    if (!enabled || !connection) return;
    const { client, streamUserId: me } = connection;
    let cancelled = false;
    const toConversation = (ch: StreamChannel): Conversation => {
      const otherId = otherMemberId(ch, me);
      const other = otherId ? ch.state.members[otherId]?.user : undefined;
      const msgs = ch.state.messages;
      const last = msgs[msgs.length - 1];
      const ctx = last ? getMessageEventContext(last) : null;
      return {
        id: ch.id || '',
        participantName: other?.name || 'Unknown',
        online: !!other?.online,
        lastMessage: last
          ? `${last.user?.id === me ? 'You: ' : ''}${last.text || (ctx ? `About: ${ctx.title}` : 'Attachment')}`
          : 'No messages yet',
        lastMessageAt: last?.created_at ? new Date(last.created_at).toISOString() : null,
        unread: ch.countUnread() > 0,
      };
    };
    const load = async () => {
      try {
        const channels = await client.queryChannels(
          { type: 'messaging', members: { $in: [me] }, member_count: 2 },
          { last_message_at: -1 },
          { limit: 30, watch: true, presence: true, state: true }
        );
        if (!cancelled) {
          setConversations(
            channels.filter((c) => isDirectMessage(c) && c.state.messages.length > 0).map(toConversation)
          );
        }
      } catch {
        if (!cancelled) setConversations([]);
      }
    };
    load();
    const subs = [
      client.on('message.new', load),
      client.on('notification.message_new', load),
      client.on('notification.mark_read', load),
      client.on('user.presence.changed', load),
    ];
    return () => {
      cancelled = true;
      subs.forEach((sub) => sub.unsubscribe());
    };
  }, [enabled, connection]);

  return conversations;
}

// Chat channel types
type ChannelType = 'general' | 'core-team' | 'host' | 'driver' | 'recipient';

const CHANNELS: { id: ChannelType; name: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'general', name: 'General', icon: Hash },
  { id: 'core-team', name: 'Core Team', icon: Users },
  { id: 'host', name: 'Hosts', icon: Hash },
  { id: 'driver', name: 'Drivers', icon: Hash },
  { id: 'recipient', name: 'Recipients', icon: Hash },
];

/**
 * Mobile chat screen - channel list and direct messages
 */
export function MobileChat() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<'channels' | 'direct'>('direct');
  const [searchQuery, setSearchQuery] = useState('');

  // Per-channel unread counts come from Stream Chat (the same source the
  // desktop uses); roomDetails[].id matches our channel ids (general,
  // core-team, host, driver, recipient).
  const { roomDetails } = useStreamChatUnread();
  const unreadCounts = roomDetails.reduce<Record<string, number>>(
    (acc, room) => {
      acc[room.id] = room.unread;
      return acc;
    },
    {}
  );

  // Direct messages come from Team Chat (Stream), the same as the desktop popups.
  const directMessages = useDirectMessages(activeTab === 'direct');
  const q = searchQuery.trim().toLowerCase();
  const conversations = directMessages?.filter(
    (c) => !q || c.participantName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
  );

  return (
    <MobileShell title="Messages" showNav>
      <div className="flex flex-col h-full">
        {/* Search bar */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full pl-10 pr-4 py-3 rounded-xl",
                "bg-white dark:bg-slate-800",
                "border border-slate-200 dark:border-slate-700",
                "text-slate-900 dark:text-slate-100",
                "placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              )}
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <button
            onClick={() => setActiveTab('channels')}
            className={cn(
              "flex-1 py-3 text-sm font-medium text-center transition-colors",
              activeTab === 'channels'
                ? "text-brand-primary border-b-2 border-brand-primary"
                : "text-slate-500 dark:text-slate-400"
            )}
          >
            Channels
          </button>
          <button
            onClick={() => setActiveTab('direct')}
            className={cn(
              "flex-1 py-3 text-sm font-medium text-center transition-colors",
              activeTab === 'direct'
                ? "text-brand-primary border-b-2 border-brand-primary"
                : "text-slate-500 dark:text-slate-400"
            )}
          >
            Direct Messages
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'channels' ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {CHANNELS.map((channel) => {
                const Icon = channel.icon;
                const unread = unreadCounts?.[channel.id] || 0;

                return (
                  <button
                    key={channel.id}
                    onClick={() => navigate(`/chat/${channel.id}`)}
                    className={cn(
                      "w-full flex items-center gap-3 p-4",
                      "bg-white dark:bg-slate-800",
                      "active:bg-slate-50 dark:active:bg-slate-700",
                      "transition-colors"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        # {channel.name}
                      </span>
                    </div>
                    {unread > 0 && (
                      <span className="min-w-[24px] h-6 flex items-center justify-center bg-brand-primary text-white text-xs font-bold rounded-full px-2">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {conversations === undefined ? (
                <div className="py-12 text-center text-slate-400">Loading…</div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-12">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                  <p className="text-slate-500 dark:text-slate-400">No conversations yet</p>
                  <button
                    onClick={() => navigate('/chat/new')}
                    className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-full font-medium"
                  >
                    Start a Conversation
                  </button>
                </div>
              ) : (
                conversations.map((convo) => (
                  <ConversationItem
                    key={convo.id}
                    conversation={convo}
                    onClick={() => navigate(`/chat/dm/${encodeURIComponent(convo.id)}`)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Floating compose button */}
        <button
          onClick={() => navigate('/chat/new')}
          className={cn(
            "fixed right-4 bottom-20 z-40",
            "w-14 h-14 rounded-full",
            "bg-brand-primary text-white shadow-lg",
            "flex items-center justify-center",
            "active:scale-95 transition-transform"
          )}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Compose new message"
        >
          <Edit className="w-5 h-5" />
        </button>
      </div>
    </MobileShell>
  );
}

function ConversationItem({
  conversation,
  onClick,
}: {
  conversation: Conversation;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-4",
        "bg-white dark:bg-slate-800",
        "active:bg-slate-50 dark:active:bg-slate-700",
        "transition-colors text-left"
      )}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark flex items-center justify-center text-white font-semibold">
          {conversation.participantName?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <span
          className={cn(
            'absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white',
            conversation.online ? 'bg-green-500' : 'bg-slate-300'
          )}
          aria-label={conversation.online ? 'Online' : 'Offline'}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={cn(
            "font-medium truncate",
            conversation.unread
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-700 dark:text-slate-300"
          )}>
            {conversation.participantName || 'Unknown'}
          </span>
          <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
            {conversation.lastMessageAt
              ? formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: false })
              : ''}
          </span>
        </div>
        <p className={cn(
          "text-sm truncate",
          conversation.unread
            ? "text-slate-700 dark:text-slate-200 font-medium"
            : "text-slate-500 dark:text-slate-400"
        )}>
          {conversation.lastMessage || 'No messages yet'}
        </p>
      </div>

      {/* Unread indicator */}
      {conversation.unread && (
        <div className="w-3 h-3 rounded-full bg-brand-primary flex-shrink-0" />
      )}
    </button>
  );
}

export default MobileChat;
