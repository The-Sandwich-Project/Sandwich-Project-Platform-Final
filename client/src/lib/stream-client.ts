import { StreamChat } from 'stream-chat';
import { logger } from '@/lib/logger';

/**
 * App-wide Stream Chat connection.
 *
 * There is exactly one Stream connection per browser tab, owned by this
 * module. Components ask for it with `getStreamClient(user)` and must never
 * call `disconnectUser()` themselves — leaving a page is not a reason to hang
 * up, because the unread badges (and chat popups) elsewhere in the app share
 * the same connection.
 *
 * The connection is closed only when the logged-in user changes or logs out
 * (`disconnectStreamClient`).
 */

export interface StreamConnection {
  client: StreamChat;
  streamUserId: string;
}

interface StreamUserLike {
  id: string | number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

let connection: StreamConnection | null = null;
let connectingFor: string | null = null;
let connectPromise: Promise<StreamConnection | null> | null = null;
// Bumped on every new attempt and on disconnect, so a stale attempt can tell
// it has been superseded and must not publish its result.
let generation = 0;

function displayName(user: StreamUserLike): string {
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  return user.email || 'User';
}

/**
 * Returns the shared Stream connection for this user, connecting on first
 * call. Concurrent callers share one in-flight attempt. Returns null if the
 * connection could not be made; a later call will retry.
 */
export async function getStreamClient(user: StreamUserLike): Promise<StreamConnection | null> {
  const appUserId = String(user.id);

  if (connection && connection.client.userID === `user_${appUserId}`) {
    return connection;
  }

  if (connectPromise && connectingFor === appUserId) {
    return connectPromise;
  }

  // A different user is connected (or connecting) in this tab — hang up first.
  if (connection || connectPromise) {
    await disconnectStreamClient();
  }

  connectingFor = appUserId;
  const myGeneration = ++generation;
  const attempt = (async (): Promise<StreamConnection | null> => {
    try {
      const response = await fetch('/api/stream/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to get Stream credentials');
      }

      const { apiKey, userToken, streamUserId } = await response.json();
      const client = StreamChat.getInstance(apiKey);

      if (client.userID && client.userID !== streamUserId) {
        await client.disconnectUser();
      }
      if (!client.userID) {
        await client.connectUser({ id: streamUserId, name: displayName(user) } as any, userToken);
      }

      // Only publish the connection if nobody switched users while we waited.
      if (myGeneration !== generation) return null;
      connection = { client, streamUserId };
      return connection;
    } catch (error) {
      logger.error('Failed to connect to Stream Chat:', error);
      return null;
    } finally {
      if (myGeneration === generation) {
        connectPromise = null;
        connectingFor = null;
      }
    }
  })();
  connectPromise = attempt;

  return attempt;
}

/** The current connection, if one is already established. */
export function getCurrentStreamConnection(): StreamConnection | null {
  return connection;
}

/** Close the shared connection. Call on logout or when the user changes. */
export async function disconnectStreamClient(): Promise<void> {
  const current = connection;
  generation++;
  connection = null;
  connectPromise = null;
  connectingFor = null;
  stopActivityHeartbeat();
  if (current) {
    try {
      await current.client.disconnectUser();
    } catch (error) {
      logger.warn('Error disconnecting Stream Chat:', error);
    }
  }
}

/*
 * Activity heartbeat.
 *
 * The server decides whether to text/email someone about a new chat message
 * by whether they've pinged /api/stream/heartbeat in the last 5 minutes. That
 * ping has to come from anywhere in the app — not just the Team Chat page —
 * or people working elsewhere in the app get texted for messages they can
 * already see. It only pings while the tab is visible, so a tab left in the
 * background long enough still counts as "away" and gets the nudge.
 */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function sendHeartbeat() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  fetch('/api/stream/heartbeat', { method: 'POST', credentials: 'include' }).catch(() => {});
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') sendHeartbeat();
}

/** Start pinging the server while the app is open. Safe to call repeatedly. */
export function startActivityHeartbeat(): void {
  if (heartbeatTimer || typeof window === 'undefined') return;
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

export function stopActivityHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}
