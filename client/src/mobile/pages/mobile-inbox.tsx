import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  Mail,
  MailOpen,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { PullToRefresh } from '../components/pull-to-refresh';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
interface Message {
  id: number;
  subject: string;
  preview?: string;
  from?: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Mobile inbox screen - view messages and notifications
 */
export function MobileInbox() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Inbox',
  });

  const [, navigate] = useLocation();

  // Fetch messages
  const { data: messages = [], isLoading, refetch } = useQuery<Message[]>({
    queryKey: ['/api/messages'],
    staleTime: 30000,
  });

  const unreadCount = messages.filter((m) => !m.isRead).length;

  return (
    <MobileShell title="Inbox" showBack showNav>
      <PullToRefresh onRefresh={async () => { await refetch(); }} className="min-h-full">
        <div className="p-4">
          {/* Unread count */}
          {unreadCount > 0 && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-brand-primary/10 rounded-lg">
              <Mail className="w-4 h-4 text-brand-primary" />
              <span className="text-sm font-medium text-brand-primary">
                {unreadCount} unread message{unreadCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Messages list */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 dark:text-slate-400">No messages yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => navigate(`/inbox/${message.id}`)}
                  className={cn(
                    "w-full bg-white dark:bg-slate-800 rounded-xl p-4",
                    "border shadow-sm text-left relative",
                    message.isRead
                      ? "border-slate-200 dark:border-slate-700"
                      : "border-brand-primary/30 bg-brand-primary/5",
                    "active:scale-[0.99] transition-transform"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                      message.isRead
                        ? "bg-slate-100 dark:bg-slate-700"
                        : "bg-brand-primary/10"
                    )}>
                      {message.isRead ? (
                        <MailOpen className="w-4 h-4 text-slate-400" />
                      ) : (
                        <Mail className="w-4 h-4 text-brand-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={cn(
                        "text-sm mb-1 truncate",
                        message.isRead
                          ? "text-slate-700 dark:text-slate-300"
                          : "font-semibold text-slate-900 dark:text-slate-100"
                      )}>
                        {message.subject || 'No subject'}
                      </h3>
                      {message.preview && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {message.preview}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span>
                          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>
    </MobileShell>
  );
}

export default MobileInbox;
