import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Trophy, X, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { logger } from '@/lib/logger';
import {
  isDisplayableKudosEntityName,
  kudosContextLabel,
} from '@/lib/kudos-display';

interface UnnotifiedKudos {
  id: number;
  content: string;
  senderName: string;
  entityName?: string;
  contextType: 'task' | 'project';
  createdAt: string;
}

interface KudosToast {
  id: number;
  message: string;
  senderName: string;
  entityName?: string;
  contextType: 'task' | 'project';
  createdAt: string;
}

export function RealTimeKudosNotifier() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [shownKudosIds, setShownKudosIds] = React.useState<Set<number>>(
    new Set()
  );

  // Poll for unnotified kudos every 30 seconds
  const { data: unnotifiedKudos = [] } = useQuery<UnnotifiedKudos[]>({
    queryKey: ['/api/messaging/kudos/unnotified'],
    enabled: !!user,
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes (reduced from 30 seconds)
    staleTime: 0, // Always consider data stale to ensure fresh checks
  });

  // Ensure unnotifiedKudos is always an array
  const safeUnnotifiedKudos: UnnotifiedKudos[] = Array.isArray(unnotifiedKudos)
    ? unnotifiedKudos
    : [];

  // Mutation to mark kudos as initially notified
  const markInitiallyNotifiedMutation = useMutation({
    mutationFn: async (kudosIds: number[]) => {
      return apiRequest('POST', '/api/messaging/kudos/mark-initial-notified', {
        kudosIds,
      });
    },
    onSuccess: () => {
      // Invalidate notification count queries to update badges
      queryClient.invalidateQueries({
        queryKey: ['/api/message-notifications/unread-counts'],
      });
    },
    onError: (error) => {
      logger.error('Failed to mark kudos as initially notified:', error);
    },
  });

  // Show notifications for new kudos that haven't been shown yet
  React.useEffect(() => {
    if (!user || !safeUnnotifiedKudos || safeUnnotifiedKudos.length === 0) {
      return;
    }

    // Find kudos that we haven't shown yet
    const newKudos = safeUnnotifiedKudos.filter(
      (k) => !shownKudosIds.has(k.id)
    );

    if (newKudos.length === 0) {
      return;
    }

    // Show toast for each new kudos (limit to 3 at a time)
    const maxToasts = 3;
    const kudosToDisplay = newKudos.slice(0, maxToasts);
    const remainingCount = Math.max(0, newKudos.length - maxToasts);

    // Mark these kudos as shown immediately to prevent duplicates
    setShownKudosIds((prev) => {
      const updated = new Set(prev);
      newKudos.forEach((k) => updated.add(k.id));
      return updated;
    });

    // Show individual toasts with stagger
    kudosToDisplay.forEach((kudos, index) => {
      setTimeout(() => {
        showKudosToast(kudos);
      }, index * 800); // Stagger by 800ms
    });

    // Show summary if there are more kudos
    if (remainingCount > 0) {
      setTimeout(() => {
        showSummaryToast(remainingCount, newKudos.length);
      }, kudosToDisplay.length * 800);
    }

    // Mark all new kudos as initially notified in the database
    setTimeout(() => {
      markInitiallyNotifiedMutation.mutate(newKudos.map((k) => k.id));
    }, 1000);
  }, [safeUnnotifiedKudos, user, shownKudosIds]);

  const showKudosToast = (kudos: UnnotifiedKudos) => {
    const timeAgo = formatDistanceToNow(new Date(kudos.createdAt), {
      addSuffix: true,
    });

    toast({
      title: (
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">Kudos from {kudos.senderName}!</span>
        </div>
      ) as any,
      description: (
        <div className="space-y-2">
          {isDisplayableKudosEntityName(kudos.entityName) && (
            <p className="text-sm text-gray-700 font-medium">
              For {kudosContextLabel(kudos.contextType)}:{' '}
              <strong>{kudos.entityName}</strong>
            </p>
          )}
          <p className="text-sm bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
            "{kudos.content}"
          </p>
          <p className="text-xs text-gray-500">{timeAgo}</p>
          <div className="flex gap-2 mt-3">
            <button
              data-testid={`kudos-toast-view-archive-${kudos.id}`}
              onClick={() => handleViewArchive()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors"
            >
              <Eye className="w-3 h-3" />
              View Archive
            </button>
          </div>
        </div>
      ) as any,
      duration: 20000, // 20 seconds - longer to give time to read
    });
  };

  const showSummaryToast = (remainingCount: number, totalCount: number) => {
    toast({
      title: (
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">More Kudos Received!</span>
        </div>
      ) as any,
      description: (
        <div className="space-y-2">
          <p className="text-sm">
            You have <strong>{remainingCount}</strong> more kudos waiting!
          </p>
          <p className="text-xs text-gray-500">Total new: {totalCount} kudos</p>
          <div className="flex gap-2 mt-3">
            <button
              data-testid="kudos-toast-summary-view-archive"
              onClick={() => handleViewArchive()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors"
            >
              <Eye className="w-3 h-3" />
              View All in Archive
            </button>
          </div>
        </div>
      ) as any,
      duration: 20000,
    });
  };

  const handleViewArchive = () => {
    // Navigate to the kudos archive page
    window.location.assign('/dashboard?section=kudos');
  };

  // This component doesn't render anything - it only manages notifications
  return null;
}
