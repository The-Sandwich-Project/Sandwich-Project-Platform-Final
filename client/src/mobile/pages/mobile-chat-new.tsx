import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface BasicUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  canChat?: boolean;
}

function userName(u: BasicUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  return u.displayName || u.firstName || u.email || 'Team member';
}

/** Phone screen to pick someone and start (or reopen) a DM. */
export function MobileChatNew() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<BasicUser[]>({
    queryKey: ['/api/users/basic'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/users/basic');
      return Array.isArray(res) ? res : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: online = [] } = useQuery<BasicUser[]>({
    queryKey: ['/api/users/online'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/users/online');
      return Array.isArray(res) ? res : [];
    },
  });
  const onlineIds = useMemo(() => new Set(online.map((u) => String(u.id))), [online]);

  const q = search.trim().toLowerCase();
  const people = users
    .filter((u) => String(u.id) !== String(user?.id) && u.canChat !== false)
    .filter((u) => !q || userName(u).toLowerCase().includes(q))
    .sort(
      (a, b) =>
        (onlineIds.has(String(a.id)) ? 0 : 1) - (onlineIds.has(String(b.id)) ? 0 : 1) ||
        userName(a).localeCompare(userName(b))
    );

  const start = async (appUserId: string) => {
    setOpening(appUserId);
    try {
      const res = await apiRequest('POST', '/api/stream/channels', {
        participants: [appUserId],
        channelType: 'messaging',
      });
      if (!res?.channelId) throw new Error('No channel id');
      navigate(`/chat/dm/${encodeURIComponent(res.channelId)}`);
    } catch (error) {
      logger.error('Failed to start conversation:', error);
      toast({ title: "Couldn't start that conversation", variant: 'destructive' });
      setOpening(null);
    }
  };

  return (
    <MobileShell title="New message" showBack onBack={() => navigate('/chat')} showNav={false}>
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Who do you want to message?"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary"
          />
        </div>
      </div>
      {isLoading && (
        <div className="flex justify-center py-8 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      <div className="divide-y divide-slate-100 bg-white">
        {people.map((u) => {
          const isOnline = onlineIds.has(String(u.id));
          return (
            <button
              key={u.id}
              onClick={() => start(String(u.id))}
              disabled={!!opening}
              className="flex w-full items-center gap-3 p-4 text-left active:bg-slate-50 disabled:opacity-60"
            >
              <span className={cn('h-3 w-3 rounded-full', isOnline ? 'bg-green-500' : 'bg-slate-300')} />
              <span className="flex-1 font-medium text-slate-900">{userName(u)}</span>
              {opening === String(u.id) ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : (
                <span className="text-xs text-slate-400">{isOnline ? 'Online' : 'Offline'}</span>
              )}
            </button>
          );
        })}
      </div>
    </MobileShell>
  );
}

export default MobileChatNew;
