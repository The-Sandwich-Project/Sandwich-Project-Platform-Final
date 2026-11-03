import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Calendar,
  Truck,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCheck,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { PullToRefresh } from '../components/pull-to-refresh';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: number;
  type: string;
  priority?: string;
  title: string;
  message?: string;
  isRead: boolean;
  isArchived?: boolean;
  category?: string;
  actionUrl?: string;
  mobileRoute?: string;
  mobileParams?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

const notificationIcons: Record<string, typeof Bell> = {
  events: Calendar,
  event: Calendar,
  driver: Truck,
  tasks: MessageCircle,
  message: MessageCircle,
  alert: AlertCircle,
  updates: Bell,
  system: Bell,
  social: MessageCircle,
};

const notificationColors: Record<string, string> = {
  events: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  event: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  driver: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  tasks: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  message: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  alert: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  updates: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  system: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
  social: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400',
};

/**
 * Mobile notifications screen
 */
export function MobileNotifications() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch notifications - API returns { notifications: [...], unreadCount, pagination }
  const { data: notificationsData, isLoading, refetch } = useQuery<{ notifications: Notification[], unreadCount: number }>({
    queryKey: ['/api/notifications'],
    staleTime: 30000,
  });
  
  // Ensure notifications is always an array - handle both direct array and nested response
  const notifications: Notification[] = Array.isArray(notificationsData) 
    ? notificationsData 
    : (notificationsData?.notifications || []);

  // Mark all as read mutation
  const markAllRead = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to mark all as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to mark notifications as read',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  // Mark single as read mutation
  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to mark as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to mark notification as read',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }

    if (notification.mobileRoute === 'eventDetail' && notification.mobileParams?.eventId) {
      navigate(`/m/events/${notification.mobileParams.eventId}`);
      return;
    }
    if (notification.mobileRoute === 'collectionDetail' && notification.mobileParams?.collectionId) {
      navigate(`/m/collections/${notification.mobileParams.collectionId}`);
      return;
    }
    if (notification.mobileRoute === 'messageThread' && notification.mobileParams?.threadId) {
      navigate(`/m/chat/${notification.mobileParams.threadId}`);
      return;
    }
    if (notification.mobileRoute === 'resourceDetail') {
      navigate('/m/resources');
      return;
    }
    if (notification.actionUrl) {
      navigate(notification.actionUrl.startsWith('/m/') ? notification.actionUrl : `/m${notification.actionUrl}`);
    }
  };

  return (
    <MobileShell
      title="Notifications"
      showBack
      showNav
      headerActions={
        unreadCount > 0 ? (
          <button
            onClick={() => markAllRead.mutate()}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700"
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
        ) : undefined
      }
    >
      <PullToRefresh onRefresh={async () => { await refetch(); }} className="min-h-full">
        <div className="p-4">
          {/* Unread count */}
          {unreadCount > 0 && (
            <div className="mb-4 flex items-center justify-between px-3 py-2 bg-brand-primary/10 rounded-lg">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-brand-primary" />
                <span className="text-sm font-medium text-brand-primary">
                  {unreadCount} new notification{unreadCount !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-brand-primary font-medium"
                disabled={markAllRead.isPending}
              >
                Mark all read
              </button>
            </div>
          )}

          {/* Notifications list */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-full" />
                    <div className="flex-1">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <BellOff className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 dark:text-slate-400">No notifications</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                You're all caught up!
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => {
                // Try category first, then type, then default to system
                const iconKey = notification.category || notification.type || 'system';
                const Icon = notificationIcons[iconKey] || Bell;
                const colorClass = notificationColors[iconKey] || notificationColors.system;

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "w-full bg-white dark:bg-slate-800 rounded-xl p-4",
                      "border shadow-sm text-left",
                      notification.isRead
                        ? "border-slate-200 dark:border-slate-700"
                        : "border-brand-primary/30 bg-brand-primary/5",
                      "active:scale-[0.99] transition-transform"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                        colorClass
                      )}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={cn(
                            "text-sm",
                            notification.isRead
                              ? "text-slate-700 dark:text-slate-300"
                              : "font-semibold text-slate-900 dark:text-slate-100"
                          )}>
                            {notification.title}
                          </h3>
                          {!notification.isRead && (
                            <div className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
                          <Clock className="w-3 h-3" />
                          <span>
                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>
    </MobileShell>
  );
}

export default MobileNotifications;
