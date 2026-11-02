import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Users, X, MessageCircle, Smartphone, Monitor } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useChatDockOptional } from '@/components/chat/chat-dock-context';
import { useAuth } from '@/hooks/useAuth';

interface OnlineUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  profileImageUrl: string | null;
  lastActiveAt: string | null;
  /**
   * Devices the user is currently active on. The server sniffs each
   * heartbeat's User-Agent and records the user as active on 'mobile' or
   * 'desktop' — when they have the app open on both phone AND laptop, both
   * appear here. Empty array means the device-presence map hasn't seen a
   * heartbeat yet (e.g. just after a server restart) — fall back to no icon.
   */
  devices?: Array<'mobile' | 'desktop'>;
}

/** Render small icons for each device a user is active on. */
function DeviceIcons({ devices }: { devices: Array<'mobile' | 'desktop'> | undefined }) {
  if (!devices || devices.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={devices.join(' + ')}>
      {devices.includes('desktop') && (
        <Monitor className="w-3.5 h-3.5 text-teal-600" aria-label="on a computer" />
      )}
      {devices.includes('mobile') && (
        <Smartphone className="w-3.5 h-3.5 text-teal-600" aria-label="on a phone" />
      )}
    </span>
  );
}

function getInitials(user: OnlineUser): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  }
  if (user.displayName) {
    const parts = user.displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    return user.displayName.substring(0, 2).toUpperCase();
  }
  if (user.firstName) {
    return user.firstName.substring(0, 2).toUpperCase();
  }
  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }
  return 'U';
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-rose-500', 'bg-green-600', 'bg-amber-500',
  'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-600',
  'bg-orange-500', 'bg-cyan-600',
];

function getAvatarColor(userId: string): string {
  const hash = userId.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getDisplayName(user: OnlineUser): string {
  if (user.displayName) return user.displayName;
  if (user.firstName && user.lastName)
    return `${user.firstName} ${user.lastName}`;
  if (user.firstName) return user.firstName;
  if (user.email) return user.email.split('@')[0];
  return 'User';
}

function getTimeAgo(lastActiveAt: string | null): string {
  if (!lastActiveAt) return 'Unknown';
  const now = new Date();
  const lastActive = new Date(lastActiveAt);
  const diffMs = now.getTime() - lastActive.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} mins ago`;
  return 'Over an hour ago';
}

export function OnlineUsers() {
  const [isOpen, setIsOpen] = useState(false);
  const chatDock = useChatDockOptional();
  // Opens the bottom-of-screen chat popup (Team Chat DM) with this person.
  const openChat = (u: { id: string }) => {
    chatDock?.openWithUser(String(u.id));
  };
  const { user: currentUser } = useAuth();

  const { data: onlineUsers = [], isLoading, refetch } = useQuery<OnlineUser[]>({
    queryKey: ['/api/users/online'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/users/online');
      // Ensure we always return an array, even if API returns an object or null
      return Array.isArray(response) ? response : [];
    },
    refetchInterval: isOpen ? 30 * 1000 : 2 * 60 * 1000, // 30s when open, 2min when closed
    refetchOnWindowFocus: true,
  });

  // Force a fresh fetch every time the popover opens so we never show stale data.
  // Without this, there's a race between the WebSocket user-online event (which
  // triggers a background refetch) and the user opening the dropdown — they'd see
  // the old cached list if they open it before the refetch completes.
  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  // Filter out current user for display, but show count including self
  const otherUsers = onlineUsers.filter(
    (user) => String(user.id) !== String(currentUser?.id)
  );
  const count = otherUsers.length;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className="p-2 rounded-lg transition-colors relative z-50 pointer-events-auto touch-manipulation min-w-[44px] text-white/80 hover:bg-white/15 hover:text-white flex items-center gap-1"
          title={`${count} user${count !== 1 ? 's' : ''} online`}
          aria-label={`${count} users online`}
        >
          <Users className="w-4 h-4 sm:w-5 sm:h-5" />
          {count > 0 && (
            <Badge
              variant="secondary"
              className="h-5 min-w-[20px] text-xs bg-green-400 text-white border-green-500"
            >
              {count}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 z-[10000]" align="end" sideOffset={8}>
        <div className="p-3 border-b bg-gradient-to-r from-teal-50 to-cyan-50 flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-teal-800 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Online Now
            </h4>
            <p className="text-xs text-teal-600 mt-0.5">
              {count} team member{count !== 1 ? 's' : ''} active
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded hover:bg-teal-100 text-teal-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-slate-500">
              Loading...
            </div>
          ) : otherUsers.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              No one else is online right now
            </div>
          ) : (
            <ul className="divide-y">
              {otherUsers.map((user) => (
                  <li
                    key={user.id}
                    className="p-3 hover:bg-slate-50 flex items-center gap-3 cursor-pointer group"
                    onClick={() => {
                      openChat(user);
                      setIsOpen(false);
                    }}
                    title={`Message ${getDisplayName(user)}`}
                  >
                    <div className="relative">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.profileImageUrl || undefined} />
                        <AvatarFallback className={`${getAvatarColor(user.id)} text-white text-xs`}>
                          {getInitials(user)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {getDisplayName(user)}
                        </p>
                        <DeviceIcons devices={user.devices} />
                      </div>
                      <p className="text-xs text-slate-500 truncate">
                        {getTimeAgo(user.lastActiveAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        openChat(user);
                        setIsOpen(false);
                      }}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default OnlineUsers;
