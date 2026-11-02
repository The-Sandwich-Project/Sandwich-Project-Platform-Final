import { useStreamChatUnread } from '@/hooks/useStreamChatUnread';

/**
 * Keeps the app-wide Stream Chat connection (and the "I'm active" heartbeat)
 * running on every logged-in page, not just the ones that show chat badges.
 * Renders nothing. Mounted once in App.tsx.
 */
export function StreamConnectionManager() {
  useStreamChatUnread();
  return null;
}
