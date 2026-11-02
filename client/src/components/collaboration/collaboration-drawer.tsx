import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Users, 
  MessageSquare, 
  History, 
  Eye, 
  Clock,
  Calendar,
  User,
  MapPin,
  FileText,
  Edit,
  CheckCircle,
  AlertCircle,
  X,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { CommentThread } from './comment-thread';
import { cn } from '@/lib/utils';
import type { EventCollaborationComment, EventEditRevision } from '@shared/schema';

export interface PresenceUser {
  userId: string;
  userName: string;
  joinedAt: Date;
  lastHeartbeat: Date;
  socketId: string;
}

export interface ActivityItem {
  id: string;
  type: 'status_change' | 'field_update' | 'comment' | 'assignment' | 'join' | 'leave';
  userId: string;
  userName: string;
  description: string;
  details?: string;
  timestamp: Date;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
}

interface CollaborationDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  eventTitle?: string;
  presentUsers: PresenceUser[];
  currentUserId: string;
  currentUserName: string;
  comments: EventCollaborationComment[];
  commentsLoading: boolean;
  onAddComment: (content: string, parentId?: number) => Promise<void>;
  onEditComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => Promise<void>;
  revisions: EventEditRevision[];
  revisionsLoading: boolean;
  onLoadRevisions: () => Promise<EventEditRevision[]>;
  activities?: ActivityItem[];
  isConnected: boolean;
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
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-orange-500',
    'bg-teal-500',
    'bg-cyan-500',
  ];
  
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString();
}

function getActivityIcon(type: ActivityItem['type']) {
  switch (type) {
    case 'status_change':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'field_update':
      return <Edit className="w-4 h-4 text-blue-500" />;
    case 'comment':
      return <MessageSquare className="w-4 h-4 text-purple-500" />;
    case 'assignment':
      return <User className="w-4 h-4 text-orange-500" />;
    case 'join':
      return <Eye className="w-4 h-4 text-teal-500" />;
    case 'leave':
      return <X className="w-4 h-4 text-gray-400" />;
    default:
      return <Clock className="w-4 h-4 text-gray-400" />;
  }
}

export function CollaborationDrawer({
  isOpen,
  onOpenChange,
  eventId,
  eventTitle,
  presentUsers,
  currentUserId,
  currentUserName,
  comments,
  commentsLoading,
  onAddComment,
  onEditComment,
  onDeleteComment,
  revisions,
  revisionsLoading,
  onLoadRevisions,
  activities = [],
  isConnected,
}: CollaborationDrawerProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('team');
  const [hasLoadedRevisions, setHasLoadedRevisions] = useState(false);

  const otherUsers = presentUsers.filter(u => u.userId !== currentUserId);

  useEffect(() => {
    if (activeTab === 'history' && !hasLoadedRevisions && !revisionsLoading) {
      setHasLoadedRevisions(true);
      onLoadRevisions();
    }
  }, [activeTab, hasLoadedRevisions, revisionsLoading, onLoadRevisions]);

  const drawerContent = (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-4 py-3 border-b bg-[#236383]/5">
        <div className="flex items-center justify-between">
          <SheetTitle className="text-lg font-semibold text-[#236383]">
            Team Collaboration
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs",
                isConnected 
                  ? "border-green-500 text-green-700 bg-green-50" 
                  : "border-red-500 text-red-700 bg-red-50"
              )}
            >
              <div className={cn(
                "w-1.5 h-1.5 rounded-full mr-1.5",
                isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
              )} />
              {isConnected ? 'Live' : 'Offline'}
            </Badge>
          </div>
        </div>
        {eventTitle && (
          <p className="text-sm text-gray-600 mt-1 truncate">
            {eventTitle}
          </p>
        )}
      </SheetHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 p-1 bg-gray-100">
          <TabsTrigger value="team" className="text-xs sm:text-sm data-[state=active]:bg-white">
            <Users className="w-4 h-4 mr-1 sm:mr-1.5" />
            <span className="hidden sm:inline">Team</span>
            {otherUsers.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {otherUsers.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="discussion" className="text-xs sm:text-sm data-[state=active]:bg-white">
            <MessageSquare className="w-4 h-4 mr-1 sm:mr-1.5" />
            <span className="hidden sm:inline">Chat</span>
            {comments.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {comments.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm data-[state=active]:bg-white">
            <History className="w-4 h-4 mr-1 sm:mr-1.5" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="flex-1 m-0 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#236383]" />
                  Currently Viewing
                </h4>
                
                {presentUsers.length > 0 ? (
                  <div className="space-y-2">
                    {presentUsers.map((user) => (
                      <div 
                        key={user.userId}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                          user.userId === currentUserId 
                            ? "bg-[#236383]/10 border-[#236383]/30" 
                            : "bg-white border-gray-200 hover:border-[#236383]/30"
                        )}
                        data-testid={`drawer-presence-user-${user.userId}`}
                      >
                        <Avatar className={cn("h-10 w-10", getAvatarColor(user.userId))}>
                          <AvatarFallback className="text-white text-sm font-medium">
                            {getInitials(user.userName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {user.userName}
                            {user.userId === currentUserId && (
                              <span className="text-[#236383] ml-1">(You)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Joined {formatRelativeTime(user.joinedAt)}
                          </p>
                        </div>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No one else is viewing this event</p>
                  </div>
                )}
              </div>

              {activities.length > 0 && (
                <div className="mt-6 pt-4 border-t">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#FBAD3F]" />
                    Recent Activity
                  </h4>
                  <div className="space-y-2">
                    {activities.slice(0, 5).map((activity) => (
                      <div 
                        key={activity.id}
                        className="flex items-start gap-3 p-2 rounded-lg bg-gray-50"
                      >
                        <div className="mt-0.5">
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">{activity.userName}</span>{' '}
                            {activity.description}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatRelativeTime(activity.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="discussion" className="flex-1 m-0 p-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <CommentThread
              comments={comments}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onAddComment={onAddComment}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              isLoading={commentsLoading}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <History className="w-4 h-4 text-[#236383]" />
                Edit History
              </h4>
              
              {revisionsLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-[#236383] border-t-transparent rounded-full mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Loading history...</p>
                </div>
              ) : revisions.length > 0 ? (
                <div className="space-y-3">
                  {revisions.slice(0, 20).map((revision) => (
                    <div 
                      key={revision.id}
                      className="p-3 rounded-lg border border-gray-200 bg-white"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Avatar className={cn("h-6 w-6", getAvatarColor(revision.editedBy))}>
                            <AvatarFallback className="text-white text-xs">
                              {getInitials(revision.editedByName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium text-gray-900">
                            {revision.editedByName}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatRelativeTime(revision.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-gray-600">Changed </span>
                        <span className="font-medium text-[#236383]">
                          {revision.fieldName.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {revision.newValue && (
                        <div className="mt-1 text-xs text-gray-500 truncate">
                          → {String(revision.newValue).substring(0, 50)}
                          {String(revision.newValue).length > 50 && '...'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No edit history yet</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent 
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 flex flex-col",
          isMobile ? "h-[85vh] rounded-t-xl" : "w-[400px] sm:w-[450px]"
        )}
      >
        {drawerContent}
      </SheetContent>
    </Sheet>
  );
}

export function CollaborationTriggerButton({
  presentUsers,
  currentUserId,
  commentsCount,
  isConnected,
  onClick,
}: {
  presentUsers: PresenceUser[];
  currentUserId: string;
  commentsCount: number;
  isConnected: boolean;
  onClick: () => void;
}) {
  const otherUsers = presentUsers.filter(u => u.userId !== currentUserId);
  
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onClick}
            className={cn(
              "gap-2 border-[#236383]/30 hover:bg-[#236383]/10 hover:border-[#236383]/50",
              otherUsers.length > 0 && "border-[#236383] bg-[#236383]/5"
            )}
            data-testid="collaboration-trigger-button"
          >
            <div className="relative">
              <Users className="w-4 h-4 text-[#236383]" />
              {isConnected && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
              )}
            </div>
            {otherUsers.length > 0 && (
              <span className="text-[#236383] font-medium">{otherUsers.length}</span>
            )}
            {commentsCount > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <MessageSquare className="w-4 h-4 text-[#FBAD3F]" />
                <span className="text-[#FBAD3F] font-medium">{commentsCount}</span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            {otherUsers.length > 0 
              ? `${otherUsers.length} teammate${otherUsers.length > 1 ? 's' : ''} viewing`
              : 'Open collaboration panel'
            }
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
