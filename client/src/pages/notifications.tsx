import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Bell,
  BellOff,
  Calendar,
  Truck,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCheck,
  ArrowLeft,
  RefreshCw,
  Filter,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

import { usePageSession } from '@/hooks/usePageSession';
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
  createdAt: string;
  metadata?: {
    eventId?: number;
    organizationName?: string;
    oldStatus?: string;
    newStatus?: string;
    changedBy?: string;
    changedByName?: string;
  };
}

const notificationIcons: Record<string, typeof Bell> = {
  events: Calendar,
  event: Calendar,
  event_status_change: ArrowRight,
  driver: Truck,
  tasks: MessageCircle,
  message: MessageCircle,
  alert: AlertCircle,
  updates: Bell,
  system: Bell,
  social: MessageCircle,
};

const notificationColors: Record<string, string> = {
  events: 'bg-blue-100 text-blue-600',
  event: 'bg-blue-100 text-blue-600',
  event_status_change: 'bg-purple-100 text-purple-600',
  driver: 'bg-amber-100 text-amber-600',
  tasks: 'bg-green-100 text-green-600',
  message: 'bg-green-100 text-green-600',
  alert: 'bg-red-100 text-red-600',
  updates: 'bg-purple-100 text-purple-600',
  system: 'bg-slate-100 text-slate-600',
  social: 'bg-pink-100 text-pink-600',
};

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

export default function NotificationsPage() {
  // Track page session for activity logging
  usePageSession({
    section: 'Notifications',
    page: 'Notifications',
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<string>('all');

  const { data: notificationsData, isLoading, refetch, isFetching } = useQuery<{ notifications: Notification[], unreadCount: number }>({
    queryKey: ['/api/notifications'],
    staleTime: 30000,
    refetchInterval: 60000,
  });
  
  const notifications: Notification[] = Array.isArray(notificationsData) 
    ? notificationsData 
    : (notificationsData?.notifications || []);

  const markAllRead = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to mark all as read');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      toast({ title: 'All notifications marked as read' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to mark notifications as read',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        credentials: 'include',
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

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filterCategory !== 'all' && (n.category || n.type) !== filterCategory) {
      return false;
    }
    if (filterRead === 'unread' && n.isRead) return false;
    if (filterRead === 'read' && !n.isRead) return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const categories = [...new Set(notifications.map((n) => n.category || n.type))].filter((c): c is string => Boolean(c));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-sm text-slate-500">{unreadCount} unread</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
              Refresh
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="w-4 h-4 mr-2" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        <Card className="mb-4">
          <CardHeader className="py-3">
            <div className="flex items-center gap-4">
              <Filter className="w-4 h-4 text-slate-400" />
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat?.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterRead} onValueChange={setFilterRead}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unread">Unread only</SelectItem>
                  <SelectItem value="read">Read only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-start gap-4 p-4 border-b">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="text-center py-16">
                <BellOff className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500 font-medium">No notifications</p>
                <p className="text-sm text-slate-400 mt-1">
                  {filterCategory !== 'all' || filterRead !== 'all' 
                    ? 'Try adjusting your filters' 
                    : "You're all caught up!"}
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[calc(100vh-300px)]">
                <div className="divide-y divide-slate-100">
                  {filteredNotifications.map((notification) => {
                    const iconKey = notification.type || notification.category || 'system';
                    const Icon = notificationIcons[iconKey] || Bell;
                    const colorClass = notificationColors[iconKey] || notificationColors.system;

                    return (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "flex items-start gap-4 p-4 cursor-pointer transition-colors",
                          notification.isRead
                            ? "bg-white hover:bg-slate-50"
                            : "bg-blue-50/50 hover:bg-blue-50"
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                          colorClass
                        )}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className={cn(
                                "text-sm",
                                notification.isRead
                                  ? "text-slate-700"
                                  : "font-semibold text-slate-900"
                              )}>
                                {notification.title}
                              </h3>
                              {notification.priority && notification.priority !== 'medium' && (
                                <Badge variant="outline" className={cn("text-xs", priorityColors[notification.priority])}>
                                  {notification.priority}
                                </Badge>
                              )}
                            </div>
                            {!notification.isRead && (
                              <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                            )}
                          </div>
                          {notification.message && (
                            <p className="text-sm text-slate-500 mt-1">
                              {notification.message}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex items-center gap-1 text-xs text-slate-400">
                              <Clock className="w-3 h-3" />
                              <span>
                                {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            {notification.category && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {notification.category}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
