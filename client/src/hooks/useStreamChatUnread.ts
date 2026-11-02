import { useState, useEffect, useCallback } from 'react';
import { StreamChat } from 'stream-chat';
import { useAuth } from './useAuth';
import { logger } from '@/lib/logger';
import {
  getStreamClient,
  getCurrentStreamConnection,
  disconnectStreamClient,
  startActivityHeartbeat,
} from '@/lib/stream-client';

interface RoomUnreadDetail {
  id: string;
  name: string;
  unread: number;
}

interface StreamChatUnreadCounts {
  totalUnread: number;
  roomsUnread: number;
  dmsUnread: number;
  groupsUnread: number;
  roomDetails: RoomUnreadDetail[];
}

let globalUnreadCounts: StreamChatUnreadCounts = {
  totalUnread: 0,
  roomsUnread: 0,
  dmsUnread: 0,
  groupsUnread: 0,
  roomDetails: [],
};
let listeners: Set<(counts: StreamChatUnreadCounts) => void> = new Set();

// Notify all listeners when counts change
function notifyListeners() {
  listeners.forEach(listener => listener({ ...globalUnreadCounts }));
}

// The Stream user whose events we're already listening to, so the shared
// connection only gets one set of unread listeners.
let trackingFor: string | null = null;

// Start tracking unread counts on the shared app-wide Stream connection.
async function initializeStreamChat(user: any): Promise<StreamChat | null> {
  // Pinging the server keeps people from being texted about chat messages
  // while they're actively in the app (even if Stream itself is unreachable).
  startActivityHeartbeat();

  const conn = await getStreamClient(user);
  if (!conn) return null;
  const { client, streamUserId } = conn;

  if (trackingFor === streamUserId) return client;
  trackingFor = streamUserId;

  // Calculate initial unread counts
  await updateUnreadCounts(client, streamUserId);

  const refresh = () => {
    // Ignore events once a different user has connected (StreamChat.getInstance
    // reuses the same client object, so compare the user, not the object).
    if (getCurrentStreamConnection()?.streamUserId !== streamUserId) return;
    updateUnreadCounts(client, streamUserId);
  };

  client.on('message.new', (event) => {
    // New message from someone else, update counts
    if (event.user?.id !== streamUserId) refresh();
  });
  client.on('message.read', refresh);
  client.on('notification.message_new', refresh);
  client.on('notification.mark_read', refresh);

  return client;
}

// Update unread counts from Stream Chat
async function updateUnreadCounts(client: StreamChat, streamUserId: string) {
  try {
    let roomsUnread = 0;
    let dmsUnread = 0;
    let groupsUnread = 0;

    // Query team channels (rooms)
    const teamChannels = await client.queryChannels(
      { type: 'team', members: { $in: [streamUserId] } },
      {},
      { limit: 30 }
    );

    const roomDetails: RoomUnreadDetail[] = [];
    for (const channel of teamChannels) {
      const unread = channel.countUnread();
      roomsUnread += unread;
      if (unread > 0) {
        roomDetails.push({
          id: channel.id || '',
          name: ((channel.data as any)?.name as string) || channel.id || 'Chat Room',
          unread,
        });
      }
    }

    // Query DM channels (2 members)
    const dmChannels = await client.queryChannels(
      { type: 'messaging', members: { $in: [streamUserId] }, member_count: 2 },
      {},
      { limit: 30 }
    );

    for (const channel of dmChannels) {
      const unread = channel.countUnread();
      dmsUnread += unread;
    }

    // Query group channels (3+ members)
    const groupChannels = await client.queryChannels(
      { type: 'messaging', members: { $in: [streamUserId] }, member_count: { $gt: 2 } },
      {},
      { limit: 30 }
    );

    for (const channel of groupChannels) {
      const unread = channel.countUnread();
      groupsUnread += unread;
    }

    globalUnreadCounts = {
      totalUnread: roomsUnread + dmsUnread + groupsUnread,
      roomsUnread,
      dmsUnread,
      groupsUnread,
      roomDetails,
    };

    notifyListeners();
  } catch (error) {
    logger.error('Failed to update Stream Chat unread counts:', error);
  }
}

/**
 * Hook to get Stream Chat unread message counts
 * This is separate from the custom messaging system
 */
export function useStreamChatUnread() {
  const { user } = useAuth();
  const [unreadCounts, setUnreadCounts] = useState<StreamChatUnreadCounts>(globalUnreadCounts);

  useEffect(() => {
    if (!user?.id) {
      // Logged out: close the shared connection and clear stale counts.
      if (trackingFor) {
        trackingFor = null;
        globalUnreadCounts = {
          totalUnread: 0, roomsUnread: 0, dmsUnread: 0, groupsUnread: 0, roomDetails: [],
        };
        notifyListeners();
        disconnectStreamClient();
      }
      return;
    }

    // Subscribe to updates
    const listener = (counts: StreamChatUnreadCounts) => {
      setUnreadCounts(counts);
    };
    listeners.add(listener);

    // Initialize if not already done
    initializeStreamChat(user);

    return () => {
      listeners.delete(listener);
    };
  }, [user?.id]);

  // Force refresh counts
  const refreshCounts = useCallback(async () => {
    const conn = getCurrentStreamConnection();
    if (conn && user?.id) {
      await updateUnreadCounts(conn.client, conn.streamUserId);
    }
  }, [user?.id]);

  return {
    ...unreadCounts,
    refreshCounts,
  };
}

/**
 * Mark a specific channel as read
 */
export async function markStreamChannelAsRead(channelId: string, channelType: string = 'messaging') {
  const conn = getCurrentStreamConnection();
  if (!conn) return;

  try {
    const channel = conn.client.channel(channelType, channelId);
    await channel.markRead();
  } catch (error) {
    logger.error('Failed to mark Stream channel as read:', error);
  }
}
