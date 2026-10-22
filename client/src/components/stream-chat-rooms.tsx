import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Chat,
  Channel,
  MessageList,
  MessageInput,
  Thread,
  Window,
  ChannelHeader,
  LoadingIndicator,
  Message,
  useMessageContext,
  useChannelStateContext,
  useChatContext,
  MessageActionsArray,
} from 'stream-chat-react';
import { StreamChat, Channel as ChannelType } from 'stream-chat';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PERMISSIONS } from '@shared/auth-utils';
import {
  Hash,
  Shield,
  Users,
  Heart,
  Truck,
  MessageSquare,
  Plus,
  Search,
  X,
  MessageCircle,
  ChevronLeft,
  Trash2,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { hasPermission } from '@shared/unified-auth-utils';
import { Check, CheckCheck } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Import Stream Chat styles
import 'stream-chat-react/dist/css/v2/index.css';
import { logger } from '@/lib/logger';

// Module-level flag to prevent multiple initializations across re-renders
let streamChatInitialized = false;
let streamChatInitPromise: Promise<void> | null = null;

// Custom Message component with read receipts and permission-based actions
const CustomMessage = () => {
  const { message, readBy } = useMessageContext();
  const { channel } = useChannelStateContext();
  const { user } = useAuth();

  // Hide deleted messages entirely — no "This message was deleted" placeholder.
  if (message?.type === 'deleted' || message?.deleted_at) {
    return null;
  }

  // Check if this is the current user's message
  const isOwnMessage = message?.user?.id === `user_${user?.id}`;
  const currentUserId = user?.id ? `user_${user.id}` : null;

  // Check permissions for message moderation
  const userPermissions = (user?.permissions as string[]) || [];
  const canModerateMessages = userPermissions.includes(PERMISSIONS.CHAT_MODERATE_MESSAGES);

  // Determine which message actions to show
  // - Own messages: always allow edit and delete
  // - Others' messages: only allow edit/delete if user has CHAT_MODERATE_MESSAGES permission
  const getMessageActions = useCallback((): MessageActionsArray<string> => {
    const actions: string[] = ['react', 'reply', 'quote'];

    if (isOwnMessage) {
      // Users can always edit/delete their own messages
      actions.push('edit', 'delete');
    } else if (canModerateMessages) {
      // Admins with moderation permission can edit/delete anyone's messages
      actions.push('edit', 'delete');
    }

    return actions as MessageActionsArray<string>;
  }, [isOwnMessage, canModerateMessages]);

  // Get read receipts - Stream Chat tracks reads in readBy array
  // Filter out the sender from the readers array (sender should not count as a reader)
  const allReaders = readBy || [];
  const readers = currentUserId
    ? allReaders.filter((reader: any) => reader.user?.id !== currentUserId)
    : allReaders;
  const hasReaders = readers.length > 0;

  // Get channel member count to determine if all have read
  // Ensure memberCount is never negative (edge case when members object is empty or undefined)
  const rawMemberCount = channel?.state?.members ? Object.keys(channel.state.members).length - 1 : 0; // -1 to exclude sender
  const memberCount = Math.max(0, rawMemberCount);
  const allRead = memberCount > 0 && readers.length >= memberCount;

  return (
    <>
      <Message
        message={message}
        messageActions={getMessageActions()}
      />
      {/* Show read receipts for your own messages */}
      {isOwnMessage && (
        <div className="read-receipt-indicator">
          {hasReaders ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    {allRead ? (
                      <CheckCheck className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-gray-400" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs">
                    <p className="font-medium mb-1">
                      {memberCount === 0
                        ? 'Read'
                        : allRead
                          ? 'Read by everyone'
                          : `Read by ${readers.length} of ${memberCount}`}
                    </p>
                    {readers.length > 0 && (
                      <div className="space-y-1">
                        {readers.slice(0, 5).map((reader: any, index: number) => {
                          const readerName = reader.user?.name || reader.user?.id || 'Someone';
                          return (
                            <p key={reader.user?.id || `reader-${index}`} className="text-gray-300">
                              {readerName}
                            </p>
                          );
                        })}
                        {readers.length > 5 && (
                          <p className="text-gray-400 italic">+{readers.length - 5} more</p>
                        )}
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Check className="w-3.5 h-3.5 text-gray-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Sent
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </>
  );
};

// Custom CSS for Stream Chat with brand colors
const customChatStyles = `
  /* Fill dashboard content area instead of a fixed viewport calc */
  .str-chat {
    height: 100%;
    width: 100%;
    min-height: 0;
    display: flex;
  }

  /* Multi-line textarea */
  .str-chat__textarea textarea {
    min-height: 60px !important;
    max-height: 200px !important;
    resize: vertical !important;
  }

  /* Brand colors */
  .str-chat__message--me .str-chat__message-bubble {
    background: #236383 !important;
    color: #ffffff !important;
  }

  .str-chat__message--other .str-chat__message-bubble {
    background: #47B3CB20 !important;
    border: 1px solid #47B3CB40 !important;
  }

  .str-chat__input-flat {
    border-color: #47B3CB !important;
  }

  .str-chat__input-flat:focus-within {
    border-color: #236383 !important;
    box-shadow: 0 0 0 1px #236383 !important;
  }

  .str-chat__send-button {
    background: #007E8C !important;
  }

  .str-chat__send-button:hover {
    background: #236383 !important;
  }

  /* Channel list active state */
  .str-chat__channel-list-messenger__main .str-chat__channel-preview-messenger--active {
    background: #47B3CB20 !important;
    border-left: 4px solid #236383 !important;
  }

  /* Header */
  .str-chat__header-livestream {
    background: #236383 !important;
    color: #ffffff !important;
  }

  /* Read receipts for own messages */
  .str-chat__message--me .str-chat__message-bubble {
    position: relative;
  }

  /* Link colors for better contrast */
  .str-chat__message--me .str-chat__message-bubble a {
    color: #A3E8FF !important;
    text-decoration: underline !important;
  }

  .str-chat__message--me .str-chat__message-bubble a:hover {
    color: #ffffff !important;
  }

  .str-chat__message--other .str-chat__message-bubble a {
    color: #236383 !important;
    text-decoration: underline !important;
  }

  .str-chat__message--other .str-chat__message-bubble a:hover {
    color: #007E8C !important;
  }

  /* @mention styling - must override default royal blue for readability on teal bubbles */
  .str-chat__message--me .str-chat__message-bubble .str-chat__message-mention {
    color: #A3E8FF !important;
    font-weight: 700 !important;
    background: rgba(255, 255, 255, 0.15) !important;
    padding: 0 3px !important;
    border-radius: 3px !important;
  }

  .str-chat__message--me .str-chat__message-bubble .str-chat__message-mention:hover {
    color: #ffffff !important;
    background: rgba(255, 255, 255, 0.25) !important;
  }

  .str-chat__message--other .str-chat__message-bubble .str-chat__message-mention {
    color: #236383 !important;
    font-weight: 700 !important;
    background: rgba(35, 99, 131, 0.1) !important;
    padding: 0 3px !important;
    border-radius: 3px !important;
  }

  .str-chat__message--other .str-chat__message-bubble .str-chat__message-mention:hover {
    color: #007E8C !important;
    background: rgba(35, 99, 131, 0.2) !important;
  }

  .read-receipt-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    padding-left: 8px;
    font-size: 11px;
  }

  /* Make sender names more prominent and always visible in messages */
  .str-chat__message-sender-name {
    font-weight: 700 !important;
    font-size: 13px !important;
    color: #236383 !important;
    display: inline !important;
    visibility: visible !important;
    max-width: none !important;
    overflow: visible !important;
  }

  /* Always show sender name above messages (including own messages) */
  .str-chat__message--me .str-chat__message-sender-name,
  .str-chat__message--other .str-chat__message-sender-name {
    display: inline !important;
    visibility: visible !important;
  }

  /* Avatar styling with better visibility */
  .str-chat__avatar {
    font-size: 11px !important;
  }

  /* Show full name text next to avatar in message */
  .str-chat__avatar-fallback {
    font-size: 11px !important;
    letter-spacing: 0.5px !important;
  }

  /* Ensure message metadata (name + time) is always visible */
  .str-chat__message-data {
    display: flex !important;
    align-items: baseline !important;
    gap: 8px !important;
    margin-bottom: 4px !important;
  }

  /* ── #1: Alignment & ownership model ──────────────────────────────
     Standard chat UI: my messages on the right, others on the left.
     Stream Chat ships them all left-aligned by default; here we flip
     the user's own messages so spatial position alone communicates
     ownership before the user reads anything. */
  .str-chat__list .str-chat__message--me,
  .str-chat__list .str-chat__message-simple--me {
    flex-direction: row-reverse !important;
    justify-content: flex-end !important;
    text-align: right !important;
  }

  /* The inner wrapper that holds the bubble + metadata stack should
     also align right so the metadata sits flush with the bubble's
     right edge. */
  .str-chat__list .str-chat__message--me .str-chat__message-inner,
  .str-chat__list .str-chat__message-simple--me .str-chat__message-inner {
    align-items: flex-end !important;
  }

  /* Push avatar to the right side of own messages too — Stream's
     default leaves it on the left even when the bubble flips. */
  .str-chat__list .str-chat__message--me .str-chat__avatar,
  .str-chat__list .str-chat__message-simple--me .str-chat__avatar {
    margin-left: 8px !important;
    margin-right: 0 !important;
  }

  /* ── #2: Metadata hierarchy ───────────────────────────────────────
     Sender name should appear ABOVE the bubble, not below it. The
     timestamp can sit next to the name in a smaller/lighter font.
     Stream renders metadata in a single .str-chat__message-data
     row; we hoist it above the bubble via flex order. */
  .str-chat__list .str-chat__message-inner,
  .str-chat__list .str-chat__message-simple .str-chat__message-inner {
    display: flex !important;
    flex-direction: column !important;
  }

  .str-chat__list .str-chat__message-data {
    order: -1 !important;        /* before the bubble */
    margin-top: 0 !important;
    margin-bottom: 4px !important;
    font-size: 12px !important;
  }

  /* Lighter timestamp so the eye lands on the name first. */
  .str-chat__list .str-chat__message-data time,
  .str-chat__list .str-chat__message-timestamp {
    color: #6b7280 !important;
    font-weight: 400 !important;
    font-size: 11px !important;
  }

  /* ── #4: Hide deleted messages entirely ───────────────────────────
     Stream's default UI shows a "This message was deleted" placeholder.
     We suppress that in CustomMessage; this CSS is a safety net for any
     deleted row that still mounts (e.g. thread previews). */
  .str-chat__list .str-chat__message--deleted,
  .str-chat__list .str-chat__message-simple--deleted,
  .str-chat__thread .str-chat__message--deleted,
  .str-chat__thread .str-chat__message-simple--deleted {
    display: none !important;
  }
`;

// Room definitions matching your Socket.io setup
const CHAT_ROOMS = [
  { id: 'general', name: 'General Chat', icon: Hash, permission: 'CHAT_GENERAL' },
  { id: 'core-team', name: 'Core Team', icon: Shield, permission: 'CHAT_CORE_TEAM' },
  { id: 'grants-committee', name: 'Grants Committee', icon: Users, permission: 'CHAT_GRANTS_COMMITTEE' },
  { id: 'events-committee', name: 'Events Committee', icon: Users, permission: 'CHAT_EVENTS_COMMITTEE' },
  { id: 'board-chat', name: 'Board Chat', icon: Users, permission: 'CHAT_BOARD' },
  { id: 'web-committee', name: 'Web Committee', icon: Users, permission: 'CHAT_WEB_COMMITTEE' },
  { id: 'volunteer-management', name: 'Volunteer Chat', icon: Users, permission: 'CHAT_VOLUNTEER_MANAGEMENT' },
  { id: 'host', name: 'Host Chat', icon: Heart, permission: 'CHAT_HOST' },
  { id: 'driver', name: 'Driver Chat', icon: Truck, permission: 'CHAT_DRIVER' },
  { id: 'recipient', name: 'Recipient Chat', icon: MessageSquare, permission: 'CHAT_RECIPIENT' },
];

// Extended room type with member info
interface RoomWithMembers {
  id: string;
  name: string;
  icon: any;
  permission: string;
  memberCount: number;
  channel?: ChannelType;
}

export default function StreamChatRooms({ defaultTab }: { defaultTab?: string | null }) {
  const { user } = useAuth();
  const { track } = useOnboardingTracker();
  const [client, setClient] = useState<StreamChat | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelType | null>(null);
  const [userRooms, setUserRooms] = useState<typeof CHAT_ROOMS>([]);
  const [teamRoomChannels, setTeamRoomChannels] = useState<Map<string, RoomWithMembers>>(new Map());
  const [streamUserId, setStreamUserId] = useState<string>('');
  const [directMessages, setDirectMessages] = useState<ChannelType[]>([]);
  const [groupChats, setGroupChats] = useState<ChannelType[]>([]);
  const [showNewMessageDialog, setShowNewMessageDialog] = useState(false);
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const initialSection = (defaultTab === 'dms' || defaultTab === 'groups') ? defaultTab : 'rooms';
  const [activeSection, setActiveSection] = useState<'rooms' | 'dms' | 'groups'>(initialSection);
  const [unreadCounts, setUnreadCounts] = useState<{ rooms: number; dms: number; groups: number }>({ rooms: 0, dms: 0, groups: 0 });
  // Tick counter bumped on every Stream Chat message event. Per-row unread
  // badges read `channel.countUnread()` directly during render — Stream Chat
  // updates that count internally on its channel objects but doesn't expose it
  // through React state, so without a tick the rows never re-render and the
  // per-room badges stay frozen at their initial value. Bumping this on
  // message.new / message.read / notification.mark_read forces the list to
  // re-evaluate every channel's unread count.
  const [messageTick, setMessageTick] = useState(0);

  // Sync activeSection when defaultTab prop changes (e.g., navigating via sidebar)
  useEffect(() => {
    if (defaultTab === 'dms' || defaultTab === 'groups' || defaultTab === 'rooms') {
      setActiveSection(defaultTab);
    }
  }, [defaultTab]);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Members dialog (for group chats / channels where preview truncates member list)
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [membersDialogTitle, setMembersDialogTitle] = useState<string>('Chat Members');
  const [membersDialogUsers, setMembersDialogUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [membersDialogChannel, setMembersDialogChannel] = useState<ChannelType | null>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [membersToAdd, setMembersToAdd] = useState<string[]>([]);
  const [isSavingMembers, setIsSavingMembers] = useState(false);

  // DM deletion (hide-for-me) confirmation
  const [dmToDelete, setDmToDelete] = useState<ChannelType | null>(null);

  // Permission flags for managing group membership (admins/coordinators only)
  const canAddMembers = hasPermission(user, PERMISSIONS.CHAT_GROUP_ADD_MEMBERS);
  const canRemoveMembers = hasPermission(user, PERMISSIONS.CHAT_GROUP_REMOVE_MEMBERS);
  const canManageMembers = canAddMembers || canRemoveMembers;

  // Mobile view: show sidebar (rooms list) or chat
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);

  // Build the (sorted, current-user-excluded) member list for a channel.
  const getChannelMemberList = (channel: ChannelType) =>
    Object.values(channel.state?.members || {})
      .map((m: any) => {
        const id = String(m.user?.id || m.user_id || '');
        const name = String(m.user?.name || m.user_id || m.user?.id || 'Unknown');
        return { id, name };
      })
      .filter((m) => m.id && m.id !== streamUserId)
      .sort((a, b) => a.name.localeCompare(b.name));

  const openMembersDialog = async (channel: ChannelType) => {
    // Channels opened from the sidebar list may not be watched yet, so channel.state.members can
    // be a partial subset. Watch first so the full member list (and the group-vs-DM member count
    // used to gate edit controls) is accurate.
    try {
      await channel.watch();
    } catch (error) {
      logger.error('Failed to load channel members:', error);
    }
    setMembersDialogChannel(channel);
    setMembersDialogUsers(getChannelMemberList(channel));
    setMembersDialogTitle(String((channel.data as any)?.name || 'Chat Members'));
    setShowAddMembers(false);
    setMembersToAdd([]);
    setMemberSearch('');
    setShowMembersDialog(true);
  };

  // Hide a DM for the current user only (non-destructive; clears their copy of history).
  const hideDirectMessage = async (channel: ChannelType) => {
    if (!client || !streamUserId) return;
    try {
      // hide(null, clearHistory) hides for the connected user and clears their copy of history
      await channel.hide(null, true);
      if (activeChannel?.cid === channel.cid) {
        setActiveChannel(null);
        setMobileShowSidebar(true);
      }
      await loadUserChannels(client, streamUserId);
      toast({
        title: 'Conversation deleted',
        description: 'It has been removed from your list. It will reappear if a new message is sent.',
      });
    } catch (error) {
      logger.error('Failed to hide DM:', error);
      toast({
        title: 'Failed to delete conversation',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDmToDelete(null);
    }
  };

  // Add or remove members on an existing group chat via the server (admin-gated).
  const updateGroupMembers = async (
    channel: ChannelType,
    changes: { add?: string[]; remove?: string[] }
  ) => {
    if (!client || !streamUserId) return;
    setIsSavingMembers(true);
    try {
      const result = await apiRequest('POST', `/api/stream/channels/${channel.type}/${channel.id}/members`, changes);
      // Refresh the channel state so the dialog and list reflect the actual result (a partial
      // failure may still have committed some changes).
      await channel.watch();
      setMembersDialogUsers(getChannelMemberList(channel));
      setMembersToAdd([]);
      setMemberSearch('');
      setShowAddMembers(false);
      await loadUserChannels(client, streamUserId);

      if (result?.success === false) {
        // HTTP 207: the mutation failed. If anything committed it's a partial update; if nothing
        // committed it's an outright failure.
        toast({
          title: result?.changed ? 'Group only partially updated' : 'Failed to update group',
          description:
            result?.error ||
            (result?.changed
              ? 'Some changes could not be applied. Please review the member list.'
              : 'No changes could be applied. Please try again.'),
          variant: 'destructive',
        });
      } else if (result?.changed === false) {
        toast({
          title: 'No changes',
          description: 'The member list was already up to date.',
        });
      } else {
        toast({
          title: 'Group updated',
          description: 'The member list has been updated.',
        });
      }
    } catch (error: any) {
      logger.error('Failed to update group members:', error);
      // The request failed outright — still refresh so the UI reflects the true state.
      try {
        await channel.watch();
        setMembersDialogUsers(getChannelMemberList(channel));
        await loadUserChannels(client, streamUserId);
      } catch (refreshError) {
        logger.error('Failed to refresh group after error:', refreshError);
      }
      toast({
        title: 'Failed to update group',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingMembers(false);
    }
  };

  // Fetch all users for DM/group creation (uses for-assignments endpoint - no special permissions needed)
  const { data: allUsers = [] } = useQuery({
    queryKey: ['/api/users/for-assignments'],
    queryFn: () => apiRequest('GET', '/api/users/for-assignments'),
  });

  // Filter users for search
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return allUsers;
    const query = searchQuery.toLowerCase();
    return allUsers.filter((u: any) =>
      u.firstName?.toLowerCase().includes(query) ||
      u.lastName?.toLowerCase().includes(query) ||
      u.email?.toLowerCase().includes(query)
    );
  }, [allUsers, searchQuery]);

  // Get user display name
  const getUserDisplayName = (u: any) => {
    if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
    if (u.firstName) return u.firstName;
    return u.email;
  };

  // Get user initials
  const getUserInitials = (u: any) => {
    if (u.firstName && u.lastName) return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase();
    if (u.firstName) return u.firstName[0].toUpperCase();
    return u.email?.[0]?.toUpperCase() || '?';
  };

  // Calculate and update unread counts for all sections
  const updateUnreadCounts = (dmChannels: ChannelType[], groupChannels: ChannelType[], roomChannelsMap: Map<string, RoomWithMembers>) => {
    const dmsUnread = dmChannels.reduce((sum, ch) => sum + (ch.countUnread() || 0), 0);
    const groupsUnread = groupChannels.reduce((sum, ch) => sum + (ch.countUnread() || 0), 0);
    const roomsUnread = Array.from(roomChannelsMap.values()).reduce((sum, r) => sum + (r.channel?.countUnread() || 0), 0);
    setUnreadCounts({ rooms: roomsUnread, dms: dmsUnread, groups: groupsUnread });
  };

  // Load DMs and group chats - returns arrays for unread count calculation
  const loadUserChannels = async (chatClient: StreamChat, currentStreamUserId: string): Promise<{ dmChannels: ChannelType[]; groupChannels: ChannelType[] }> => {
    try {
      // Query for direct message channels (1:1)
      const dmFilter = {
        type: 'messaging',
        members: { $in: [currentStreamUserId] },
        member_count: 2,
      };
      const dmChannels = await chatClient.queryChannels(dmFilter, { last_message_at: -1 }, { limit: 20 });
      setDirectMessages(dmChannels);

      // Query for group chats (3+ members)
      const groupFilter = {
        type: 'messaging',
        members: { $in: [currentStreamUserId] },
        member_count: { $gt: 2 },
      };
      const groupChannels = await chatClient.queryChannels(groupFilter, { last_message_at: -1 }, { limit: 20 });
      setGroupChats(groupChannels);

      return { dmChannels, groupChannels };
    } catch (error) {
      logger.error('Failed to load user channels:', error);
      return { dmChannels: [], groupChannels: [] };
    }
  };

  // Create a new DM
  const createDirectMessage = async (targetUserId: string) => {
    if (!client || !streamUserId) return;

    try {
      // Use the server endpoint to create the channel (ensures users are registered with Stream)
      const response = await apiRequest('POST', '/api/stream/channels', {
        participants: [targetUserId],
        channelType: 'messaging',
      });

      if (!response?.channelCid) {
        throw new Error('Failed to create channel');
      }

      // Now watch the channel from the client
      const channel = client.channel('messaging', response.channelId);
      await channel.watch();

      setActiveChannel(channel);
      setActiveSection('dms');
      setShowNewMessageDialog(false);
      setSearchQuery('');

      // Refresh DM list
      await loadUserChannels(client, streamUserId);

      toast({
        title: 'Conversation started',
        description: 'You can now send messages.',
      });
    } catch (error) {
      logger.error('Failed to create DM:', error);
      toast({
        title: 'Failed to start conversation',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Create a new group chat
  const createGroupChat = async () => {
    if (!client || !streamUserId || selectedUsers.length < 2) return;

    try {
      // Use the server endpoint to create the channel (ensures all users are registered with Stream)
      const response = await apiRequest('POST', '/api/stream/channels', {
        participants: selectedUsers,
        channelType: 'messaging',
        channelName: groupName || `Group Chat (${selectedUsers.length + 1} members)`,
      });

      if (!response?.channelCid) {
        throw new Error('Failed to create channel');
      }

      // Now watch the channel from the client
      const channel = client.channel('messaging', response.channelId);
      await channel.watch();

      setActiveChannel(channel);
      setActiveSection('groups');
      setShowNewGroupDialog(false);
      setSelectedUsers([]);
      setGroupName('');
      setSearchQuery('');

      // Refresh group list
      await loadUserChannels(client, streamUserId);

      toast({
        title: 'Group created',
        description: `Group chat with ${selectedUsers.length + 1} members created.`,
      });
    } catch (error) {
      logger.error('Failed to create group:', error);
      toast({
        title: 'Failed to create group',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Toggle user selection for group chat
  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  // Initialize Stream Chat client
  useEffect(() => {
    const initializeClient = async () => {
      // Skip if no user or already initialized
      if (!user || streamChatInitialized) return;

      // If initialization is in progress, wait for it
      if (streamChatInitPromise) {
        await streamChatInitPromise;
        return;
      }

      // Create the initialization promise
      streamChatInitPromise = (async () => {
        try {
          // Get Stream credentials and user token from backend
          const response = await fetch('/api/stream/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || 'Failed to get Stream credentials'
          );
        }

        const { apiKey, userToken, streamUserId } = await response.json();

        const chatClient = StreamChat.getInstance(apiKey);

        // Only connect if not already connected (prevents duplicate connectUser warnings)
        if (!chatClient.userID) {
          await chatClient.connectUser(
            {
              id: streamUserId,
              name: (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email) || user.email || 'User',
            } as any,
            userToken
          );
        }

        streamChatInitialized = true;

        // Listen for new messages from this user to track challenge completion
        chatClient.on('message.new', (event) => {
          // Only track if it's the current user sending the message
          if (event.user?.id === streamUserId) {
            track('chat_first_message');
          }
        });

        setClient(chatClient);
        setStreamUserId(streamUserId);

        // Send heartbeat to mark user as online (for notification suppression)
        const sendHeartbeat = () => {
          fetch('/api/stream/heartbeat', {
            method: 'POST',
            credentials: 'include',
          }).catch(() => {}); // Ignore errors
        };

        // Send initial heartbeat
        sendHeartbeat();

        // Send heartbeat every 2 minutes while chat is open
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, 2 * 60 * 1000);

        // Load DMs and group chats
        const { dmChannels, groupChannels } = await loadUserChannels(chatClient, streamUserId);

        // Filter rooms based on user permissions
        const accessibleRooms = CHAT_ROOMS.filter(room => {
          // Check if user has permission for this room
          const permissions = user.permissions as string[] | undefined;
          if (!permissions || !Array.isArray(permissions)) return false;
          return permissions.includes(room.permission);
        });

        setUserRooms(accessibleRooms);

        // Query all team channels to get proper member counts
        const roomChannelsMap = new Map<string, RoomWithMembers>();

        // Query channels with full member data
        const teamChannelFilter = {
          type: 'team',
          id: { $in: accessibleRooms.map(r => r.id) }
        };

        try {
          const channels = await chatClient.queryChannels(
            teamChannelFilter,
            { created_at: -1 },
            {
              limit: 20,
              state: true,
              watch: true,
            }
          );

          // Map channels to rooms with member counts
          for (const room of accessibleRooms) {
            const channel = channels.find(c => c.id === room.id);
            if (channel) {
              // Use channel.data.member_count for accurate server-side count
              const memberCount = (channel.data?.member_count as number) || Object.keys(channel.state?.members || {}).length;
              roomChannelsMap.set(room.id, {
                ...room,
                memberCount,
                channel
              });
              logger.log(`Channel ${room.id} has ${memberCount} members (data.member_count: ${channel.data?.member_count})`);
            } else {
              // Channel doesn't exist yet, just watch it
              const newChannel = chatClient.channel('team', room.id);
              await newChannel.watch();
              const memberCount = (newChannel.data?.member_count as number) || Object.keys(newChannel.state?.members || {}).length;
              roomChannelsMap.set(room.id, {
                ...room,
                memberCount,
                channel: newChannel
              });
            }
          }
        } catch (queryError) {
          logger.error('Failed to query team channels:', queryError);
          // Fallback: just watch each channel individually
          for (const room of accessibleRooms) {
            try {
              const channel = chatClient.channel('team', room.id);
              await channel.watch();
              const memberCount = (channel.data?.member_count as number) || Object.keys(channel.state?.members || {}).length;
              roomChannelsMap.set(room.id, {
                ...room,
                memberCount,
                channel
              });
            } catch (error) {
              logger.error(`Failed to join channel ${room.id}:`, error);
            }
          }
        }

        setTeamRoomChannels(roomChannelsMap);

        // Update unread counts for all sections
        updateUnreadCounts(dmChannels, groupChannels, roomChannelsMap);

        // Set first accessible room as active
        if (accessibleRooms.length > 0) {
          const firstRoomData = roomChannelsMap.get(accessibleRooms[0].id);
          if (firstRoomData?.channel) {
            setActiveChannel(firstRoomData.channel);
          } else {
            const firstChannel = chatClient.channel('team', accessibleRooms[0].id);
            await firstChannel.watch();
            setActiveChannel(firstChannel);
          }

          // Track that user has viewed team chat messages
          track('chat_read_messages');
        }
      } catch (error) {
        logger.error('Failed to initialize Stream Chat:', error);
        streamChatInitPromise = null; // Reset so it can be retried
        toast({
          title: 'Chat Initialization Failed',
          description: 'Unable to connect to chat service. Please try refreshing.',
          variant: 'destructive',
        });
      }
      })();

      await streamChatInitPromise;
    };

    initializeClient();

    return () => {
      if (client) {
        client.disconnectUser();
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [user]);

  // Real-time unread count updates
  useEffect(() => {
    if (!client) return;

    const handleMessageEvent = () => {
      // Recalculate unread counts from current state
      const dmsUnread = directMessages.reduce((sum, ch) => sum + (ch.countUnread() || 0), 0);
      const groupsUnread = groupChats.reduce((sum, ch) => sum + (ch.countUnread() || 0), 0);
      const roomsUnread = Array.from(teamRoomChannels.values()).reduce((sum, r) => sum + (r.channel?.countUnread() || 0), 0);
      setUnreadCounts({ rooms: roomsUnread, dms: dmsUnread, groups: groupsUnread });
      // Force per-row badges (rooms, DMs, groups) to re-evaluate countUnread().
      // Without this, only the aggregate `unreadCounts` updates and individual
      // room badges stay frozen at their initial render value.
      setMessageTick((t) => t + 1);
    };

    // Listen for message events to update unread counts
    client.on('message.new', handleMessageEvent);
    client.on('message.read', handleMessageEvent);
    client.on('notification.mark_read', handleMessageEvent);

    return () => {
      client.off('message.new', handleMessageEvent);
      client.off('message.read', handleMessageEvent);
      client.off('notification.mark_read', handleMessageEvent);
    };
  }, [client, directMessages, groupChats, teamRoomChannels]);

  // A DM someone else starts (e.g. an event-card message) creates a channel this
  // client isn't watching yet; reload the lists so it shows up without a refresh.
  useEffect(() => {
    if (!client || !streamUserId) return;

    const refreshChannelLists = async () => {
      const { dmChannels, groupChannels } = await loadUserChannels(client, streamUserId);
      updateUnreadCounts(dmChannels, groupChannels, teamRoomChannels);
    };

    client.on('notification.added_to_channel', refreshChannelLists);
    client.on('notification.message_new', refreshChannelLists);

    return () => {
      client.off('notification.added_to_channel', refreshChannelLists);
      client.off('notification.message_new', refreshChannelLists);
    };
  }, [client, streamUserId, teamRoomChannels]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          Please log in to access chat rooms
        </p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingIndicator />
      </div>
    );
  }

  if (userRooms.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            You don't have access to any chat rooms yet.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Contact an administrator to get access.
          </p>
        </div>
      </div>
    );
  }

  // Helper to get channel display name for DMs
  const getDMDisplayName = (channel: ChannelType) => {
    const members = Object.values(channel.state?.members || {});
    const otherMember = members.find((m: any) => m.user_id !== streamUserId);
    return otherMember?.user?.name || otherMember?.user?.id || 'Unknown';
  };

  // Helper to get channel initials for DMs
  const getDMInitials = (channel: ChannelType) => {
    const name = getDMDisplayName(channel);
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name[0]?.toUpperCase() || '?';
  };

  return (
    <>
      <style>{customChatStyles}</style>
      <div className="flex h-full min-h-0 bg-white rounded-lg border overflow-hidden">
        <Chat client={client}>
        {/* Sidebar - hidden on mobile when viewing chat */}
        <div className={`w-full md:w-72 border-r border-[#47B3CB]/30 bg-gradient-to-b from-[#236383]/5 to-white flex flex-col ${!mobileShowSidebar ? 'hidden md:flex' : 'flex'}`}>
          {/* Header with section tabs */}
          <div className="p-3 border-b border-[#47B3CB]/30 bg-[#236383] text-white">
            <h2 className="text-lg font-semibold mb-1">Messages</h2>
            {/* Clarifier line: states that Team Chat is for real-time
                messaging and links to Project Threads for users who want an
                email-style thread instead. */}
            <p className="text-xs text-white/80 mb-2 leading-snug">
              For quick back-and-forth with the team — messages are real-time.{' '}
              <a
                href="/dashboard?section=gmail-inbox"
                className="font-medium underline hover:text-white whitespace-nowrap"
              >
                📁 Start a Thread instead
              </a>
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setActiveSection('rooms')}
                className={`relative flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeSection === 'rooms'
                    ? 'bg-white text-[#236383]'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                Rooms
                {unreadCounts.rooms > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCounts.rooms > 99 ? '99+' : unreadCounts.rooms}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveSection('dms')}
                className={`relative flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeSection === 'dms'
                    ? 'bg-white text-[#236383]'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                DMs
                {unreadCounts.dms > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCounts.dms > 99 ? '99+' : unreadCounts.dms}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveSection('groups')}
                className={`relative flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  activeSection === 'groups'
                    ? 'bg-white text-[#236383]'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                Groups
                {unreadCounts.groups > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCounts.groups > 99 ? '99+' : unreadCounts.groups}
                  </span>
                )}
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {/* Team Rooms Section */}
            {activeSection === 'rooms' && (
              <div>
                {/* messageTick is referenced so the linter sees the dependency
                    (the actual re-render is driven by the parent component
                    re-rendering when the tick state changes — calling
                    countUnread() inline picks up the fresh value). */}
                {void messageTick}
                {userRooms.map((room) => {
                  const Icon = room.icon;
                  const isActive = activeChannel?.id === room.id && activeChannel?.type === 'team';
                  const roomData = teamRoomChannels.get(room.id);
                  const memberCount = roomData?.memberCount || 0;
                  const unreadCount = roomData?.channel?.countUnread() || 0;
                  const hasUnread = unreadCount > 0 && !isActive;
                  return (
                    <div
                      key={room.id}
                      className={`p-3 border-b border-[#47B3CB]/20 cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[#47B3CB]/20 border-l-4 border-l-[#236383] text-[#236383] font-medium'
                          : hasUnread
                            ? 'hover:bg-[#47B3CB]/10 border-l-4 border-l-[#A31C41] bg-[#A31C41]/[0.03] text-gray-800'
                            : 'hover:bg-[#47B3CB]/10 hover:border-l-4 hover:border-l-[#FBAD3F]/50 text-gray-700'
                      }`}
                      onClick={async () => {
                        try {
                          const existingChannel = roomData?.channel || client.channel('team', room.id);
                          await existingChannel.watch();
                          setActiveChannel(existingChannel);
                          setMobileShowSidebar(false);
                        } catch (error) {
                          logger.error(`Failed to switch to channel ${room.id}:`, error);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`relative flex items-center justify-center w-8 h-8 rounded-full ${
                          isActive
                            ? 'bg-[#236383] text-white'
                            : 'bg-[#47B3CB]/20 text-[#007E8C]'
                        }`}>
                          <Icon className="w-4 h-4" />
                          {/* Slack-style unread dot on the icon — small but unmissable */}
                          {hasUnread && (
                            <span
                              aria-label={`${unreadCount} unread`}
                              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#A31C41] ring-2 ring-white"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-sm truncate block ${
                                hasUnread ? 'font-bold text-[#236383]' : 'font-medium'
                              }`}
                            >
                              {room.name}
                            </span>
                            {unreadCount > 0 && (
                              <Badge variant="destructive" className="text-xs flex-shrink-0">
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-gray-500">
                            {memberCount} member{memberCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Direct Messages Section */}
            {activeSection === 'dms' && (
              <div>
                <div className="p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-[#47B3CB] text-[#007E8C] hover:bg-[#47B3CB]/10"
                    onClick={() => setShowNewMessageDialog(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    New Message
                  </Button>
                </div>
                {directMessages.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No direct messages yet
                  </div>
                ) : (
                  directMessages.map((channel) => {
                    const isActive = activeChannel?.cid === channel.cid;
                    const unreadCount = channel.countUnread();
                    const hasUnread = unreadCount > 0 && !isActive;
                    return (
                      <div
                        key={channel.cid}
                        className={`p-3 border-b border-[#47B3CB]/20 cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[#47B3CB]/20 border-l-4 border-l-[#236383] text-[#236383] font-medium'
                            : hasUnread
                              ? 'hover:bg-[#47B3CB]/10 border-l-4 border-l-[#A31C41] bg-[#A31C41]/[0.03] text-gray-800'
                              : 'hover:bg-[#47B3CB]/10 hover:border-l-4 hover:border-l-[#FBAD3F]/50 text-gray-700'
                        }`}
                        onClick={async () => {
                          await channel.watch();
                          setActiveChannel(channel);
                          setMobileShowSidebar(false);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className={isActive ? 'bg-[#236383] text-white' : 'bg-[#47B3CB]/20 text-[#007E8C]'}>
                                {getDMInitials(channel)}
                              </AvatarFallback>
                            </Avatar>
                            {hasUnread && (
                              <span
                                aria-label={`${unreadCount} unread`}
                                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#A31C41] ring-2 ring-white"
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span
                              className={`text-sm truncate block ${
                                hasUnread ? 'font-bold text-[#236383]' : 'font-medium'
                              }`}
                            >
                              {getDMDisplayName(channel)}
                            </span>
                            {channel.state?.messages?.length > 0 && (
                              <span className="text-xs text-gray-500 truncate block">
                                {channel.state.messages[channel.state.messages.length - 1]?.text?.substring(0, 30)}...
                              </span>
                            )}
                          </div>
                          {unreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {unreadCount}
                            </Badge>
                          )}
                          <button
                            type="button"
                            aria-label={`Delete conversation with ${getDMDisplayName(channel)}`}
                            title="Delete conversation"
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setDmToDelete(channel);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Group Chats Section */}
            {activeSection === 'groups' && (
              <div>
                <div className="p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-[#47B3CB] text-[#007E8C] hover:bg-[#47B3CB]/10"
                    onClick={() => setShowNewGroupDialog(true)}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    New Group
                  </Button>
                </div>
                {groupChats.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No group chats yet
                  </div>
                ) : (
                  groupChats.map((channel) => {
                    const isActive = activeChannel?.cid === channel.cid;
                    const unreadCount = channel.countUnread();
                    const hasUnread = unreadCount > 0 && !isActive;
                    const members = Object.values(channel.state?.members || {});
                    const memberCount = members.length;
                    // Get member names (excluding current user, limit to first 3)
                    const memberNames = members
                      .filter((m: any) => m.user_id !== streamUserId)
                      .slice(0, 3)
                      .map((m: any) => {
                        const name = m.user?.name || m.user_id;
                        // Get first name only for brevity
                        return name.split(' ')[0];
                      });
                    const additionalCount = memberCount - 1 - memberNames.length; // -1 for current user
                    const memberDisplay = additionalCount > 0
                      ? `${memberNames.join(', ')} +${additionalCount}`
                      : memberNames.join(', ');

                    return (
                      <div
                        key={channel.cid}
                        className={`p-3 border-b border-[#47B3CB]/20 cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[#47B3CB]/20 border-l-4 border-l-[#236383] text-[#236383] font-medium'
                            : hasUnread
                              ? 'hover:bg-[#47B3CB]/10 border-l-4 border-l-[#A31C41] bg-[#A31C41]/[0.03] text-gray-800'
                              : 'hover:bg-[#47B3CB]/10 hover:border-l-4 hover:border-l-[#FBAD3F]/50 text-gray-700'
                        }`}
                        onClick={async () => {
                          await channel.watch();
                          setActiveChannel(channel);
                          setMobileShowSidebar(false);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`relative flex items-center justify-center w-8 h-8 rounded-full ${
                            isActive ? 'bg-[#236383] text-white' : 'bg-[#47B3CB]/20 text-[#007E8C]'
                          }`}>
                            <Users className="w-4 h-4" />
                            {hasUnread && (
                              <span
                                aria-label={`${unreadCount} unread`}
                                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#A31C41] ring-2 ring-white"
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span
                              className={`text-sm truncate block ${
                                hasUnread ? 'font-bold text-[#236383]' : 'font-medium'
                              }`}
                            >
                              {(channel.data as any)?.name || `Group (${memberCount})`}
                            </span>
                            <span className="text-xs text-gray-500 truncate block" title={memberDisplay}>
                              {memberNames.length > 0 ? (
                                <>
                                  {memberNames.join(', ')}
                                  {additionalCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        openMembersDialog(channel);
                                      }}
                                      className="ml-1 text-[#007E8C] hover:underline font-medium"
                                      aria-label={`View all ${memberCount} members`}
                                    >
                                      +{additionalCount} more
                                    </button>
                                  )}
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    openMembersDialog(channel);
                                  }}
                                  className="text-[#007E8C] hover:underline font-medium"
                                  aria-label={`View all ${memberCount} members`}
                                >
                                  {memberCount} members
                                </button>
                              )}
                            </span>
                          </div>
                          {unreadCount > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {unreadCount}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Main Chat Area - hidden on mobile when sidebar is showing */}
        <div className={`flex-1 flex flex-col ${mobileShowSidebar ? 'hidden md:flex' : 'flex'}`}>
          {activeChannel ? (
            <Channel channel={activeChannel}>
              <Window>
                {/* Mobile back button */}
                <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b bg-[#236383] text-white">
                  <button
                    onClick={() => setMobileShowSidebar(true)}
                    className="p-1 hover:bg-white/20 rounded"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="font-medium truncate">
                    {(activeChannel.data as any)?.name || 'Chat'}
                  </span>
                </div>
                <div className="hidden md:block">
                  <ChannelHeader />
                </div>
                {/* Members affordance: lets users see the full member list even when previews are truncated */}
                <div className="px-4 py-2 border-b bg-white flex items-center justify-between">
                  <div className="text-xs text-gray-600 truncate">
                    Members hidden in preview? View the full list here.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => openMembersDialog(activeChannel)}
                  >
                    <Users className="w-3.5 h-3.5 mr-1" />
                    Members
                  </Button>
                </div>
                <MessageList Message={CustomMessage} />
                <MessageInput />
              </Window>
              <Thread Message={CustomMessage} />
            </Channel>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Select a chat room to start messaging
                </p>
              </div>
            </div>
          )}
        </div>
      </Chat>
    </div>

    {/* Members Dialog */}
    <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{membersDialogTitle}</DialogTitle>
          <DialogDescription>
            {membersDialogUsers.length} member{membersDialogUsers.length === 1 ? '' : 's'}
          </DialogDescription>
        </DialogHeader>
        {(() => {
          // Total members on the channel (independent of how the current user is filtered out
          // of the display list, so a 2-person DM can never be mistaken for a group).
          const totalMemberCount = Object.keys(membersDialogChannel?.state?.members || {}).length;

          // Membership can only be edited on group chats (messaging channels with 3+ members),
          // and only by admins/coordinators. Team rooms and DMs are not editable here.
          const isEditableGroup =
            canManageMembers &&
            membersDialogChannel?.type === 'messaging' &&
            totalMemberCount > 2;

          // App user IDs already in the channel (strip the `user_` Stream prefix).
          const currentMemberAppIds = new Set(
            Object.keys(membersDialogChannel?.state?.members || {}).map((sid) =>
              sid.replace(/^user_/, '')
            )
          );

          const addableUsers = allUsers.filter((u: any) => {
            if (currentMemberAppIds.has(String(u.id))) return false;
            if (!memberSearch.trim()) return true;
            const q = memberSearch.toLowerCase();
            return (
              u.firstName?.toLowerCase().includes(q) ||
              u.lastName?.toLowerCase().includes(q) ||
              u.email?.toLowerCase().includes(q)
            );
          });

          return (
            <>
              <ScrollArea className="max-h-[280px] pr-3">
                <div className="space-y-2">
                  {membersDialogUsers.map((m) => {
                    const initials = m.name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join('')
                      .toUpperCase();

                    return (
                      <div key={m.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-50">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="bg-[#47B3CB]/20 text-[#007E8C] text-xs">
                            {initials || 'TM'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 truncate">{m.name}</div>
                          <div className="text-xs text-gray-500 truncate">{m.id}</div>
                        </div>
                        {isEditableGroup && canRemoveMembers && (
                          <button
                            type="button"
                            aria-label={`Remove ${m.name} from group`}
                            title="Remove from group"
                            disabled={isSavingMembers}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            onClick={() =>
                              updateGroupMembers(membersDialogChannel!, {
                                remove: [m.id.replace(/^user_/, '')],
                              })
                            }
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              {isEditableGroup && canAddMembers && (
                <div className="border-t pt-3 mt-1">
                  {!showAddMembers ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-dashed border-[#47B3CB] text-[#007E8C] hover:bg-[#47B3CB]/10"
                      onClick={() => setShowAddMembers(true)}
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add members
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                          placeholder="Search team members..."
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <ScrollArea className="h-40">
                        {addableUsers.length === 0 ? (
                          <div className="text-center text-gray-500 py-4 text-sm">
                            No team members to add
                          </div>
                        ) : (
                          addableUsers.map((u: any) => (
                            <div
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${
                                membersToAdd.includes(u.id) ? 'bg-[#47B3CB]/20' : 'hover:bg-gray-100'
                              }`}
                              onClick={() =>
                                setMembersToAdd((prev) =>
                                  prev.includes(u.id)
                                    ? prev.filter((id) => id !== u.id)
                                    : [...prev, u.id]
                                )
                              }
                            >
                              <Checkbox checked={membersToAdd.includes(u.id)} />
                              <Avatar className="w-8 h-8">
                                <AvatarFallback className="bg-[#47B3CB]/20 text-[#007E8C] text-xs">
                                  {getUserInitials(u)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{getUserDisplayName(u)}</div>
                                <div className="text-xs text-gray-500 truncate">{u.email}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </ScrollArea>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="flex-1"
                          disabled={isSavingMembers}
                          onClick={() => {
                            setShowAddMembers(false);
                            setMembersToAdd([]);
                            setMemberSearch('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1 bg-[#007E8C] hover:bg-[#236383]"
                          disabled={membersToAdd.length === 0 || isSavingMembers}
                          onClick={() =>
                            updateGroupMembers(membersDialogChannel!, { add: membersToAdd })
                          }
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Add{membersToAdd.length > 0 ? ` (${membersToAdd.length})` : ''}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </DialogContent>
    </Dialog>

    {/* Delete (hide) DM confirmation */}
    <AlertDialog open={!!dmToDelete} onOpenChange={(open) => !open && setDmToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the conversation{dmToDelete ? ` with ${getDMDisplayName(dmToDelete)}` : ''} from
            your list and clears your copy of the messages. The other person will still have it, and the
            conversation will reappear if a new message is sent.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            onClick={() => dmToDelete && hideDirectMessage(dmToDelete)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* New Direct Message Dialog */}
    <Dialog open={showNewMessageDialog} onOpenChange={setShowNewMessageDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Direct Message</DialogTitle>
          <DialogDescription>
            Search for a team member to start a conversation
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <ScrollArea className="h-64">
            {filteredUsers
              .filter((u: any) => u.id !== user?.id)
              .map((u: any) => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 cursor-pointer"
                  onClick={() => createDirectMessage(u.id)}
                >
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-[#47B3CB]/20 text-[#007E8C]">
                      {getUserInitials(u)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getUserDisplayName(u)}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </div>
                  <MessageCircle className="w-4 h-4 text-gray-400" />
                </div>
              ))}
            {filteredUsers.filter((u: any) => u.id !== user?.id).length === 0 && (
              <div className="text-center text-gray-500 py-4">
                No users found
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>

    {/* New Group Chat Dialog */}
    <Dialog open={showNewGroupDialog} onOpenChange={setShowNewGroupDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Group Chat</DialogTitle>
          <DialogDescription>
            Select team members to add to your group
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Group name (optional)"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((userId) => {
                const selectedUser = allUsers.find((u: any) => u.id === userId);
                return selectedUser ? (
                  <Badge
                    key={userId}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {getUserDisplayName(selectedUser)}
                    <X
                      className="w-3 h-3 cursor-pointer"
                      onClick={() => toggleUserSelection(userId)}
                    />
                  </Badge>
                ) : null;
              })}
            </div>
          )}
          <ScrollArea className="h-48">
            {filteredUsers
              .filter((u: any) => u.id !== user?.id)
              .map((u: any) => (
                <div
                  key={u.id}
                  className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${
                    selectedUsers.includes(u.id) ? 'bg-[#47B3CB]/20' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => toggleUserSelection(u.id)}
                >
                  <Checkbox
                    checked={selectedUsers.includes(u.id)}
                    onCheckedChange={() => toggleUserSelection(u.id)}
                  />
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-[#47B3CB]/20 text-[#007E8C] text-xs">
                      {getUserInitials(u)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getUserDisplayName(u)}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </div>
                </div>
              ))}
          </ScrollArea>
          <Button
            className="w-full bg-[#007E8C] hover:bg-[#236383]"
            disabled={selectedUsers.length < 2}
            onClick={createGroupChat}
          >
            <Users className="w-4 h-4 mr-2" />
            Create Group ({selectedUsers.length + 1} members)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}