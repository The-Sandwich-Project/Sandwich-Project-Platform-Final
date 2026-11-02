import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PresenceUser {
  userId: string;
  userName: string;
  joinedAt: Date;
  lastHeartbeat: Date;
  socketId: string;
}

interface CompactPresenceBadgeProps {
  users: PresenceUser[];
  currentUserId: string;
  className?: string;
  maxAvatars?: number;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(userId: string): string {
  const colors = [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-orange-500",
    "bg-teal-500",
    "bg-cyan-500",
  ];
  
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function CompactPresenceBadge({ 
  users, 
  currentUserId, 
  className,
  maxAvatars = 3 
}: CompactPresenceBadgeProps) {
  const otherUsers = users.filter(u => u.userId !== currentUserId);
  const displayUsers = otherUsers.slice(0, maxAvatars);
  const remainingCount = Math.max(0, otherUsers.length - maxAvatars);

  if (otherUsers.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "flex items-center gap-1 px-2 py-1 bg-[#236383]/10 rounded-full border border-[#236383]/20 cursor-pointer hover:bg-[#236383]/20 transition-colors",
              className
            )}
            data-testid="compact-presence-badge"
          >
            <Eye className="h-3 w-3 text-[#236383]" />
            <div className="flex items-center -space-x-1.5">
              {displayUsers.map((user) => (
                <Avatar 
                  key={user.userId}
                  className={cn(
                    "h-5 w-5 border border-white",
                    getAvatarColor(user.userId)
                  )}
                  data-testid={`compact-presence-avatar-${user.userId}`}
                >
                  <AvatarFallback className="text-white text-[8px] font-medium">
                    {getInitials(user.userName)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {remainingCount > 0 && (
                <Avatar 
                  className="h-5 w-5 border border-white bg-gray-400"
                  data-testid="compact-presence-overflow"
                >
                  <AvatarFallback className="text-white text-[8px] font-medium">
                    +{remainingCount}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
            <span className="text-xs font-medium text-[#236383]">
              {otherUsers.length}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#236383]">
              {otherUsers.length} {otherUsers.length === 1 ? 'person' : 'people'} viewing
            </p>
            <ul className="space-y-0.5">
              {otherUsers.map(user => (
                <li key={user.userId} className="text-xs text-muted-foreground flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  {user.userName}
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
