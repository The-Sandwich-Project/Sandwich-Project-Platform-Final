import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { MentionTextarea, MessageWithMentions } from '@/components/mention-input';
import {
  Loader2,
  Plus,
  Circle,
  CheckCircle2,
  AlertTriangle,
  User,
  MessageSquare,
  Send,
  ChevronDown,
  ChevronUp,
  Settings,
  X,
  Calendar,
  Filter,
  Heart,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  ArrowRight,
  Edit2,
  Trash2,
  Check,
  FolderKanban,
  ListTodo,
  StickyNote,
  Lightbulb,
  Clock,
  RefreshCw,
  Link,
  Unlink,
  ChevronRight,
  Copy,
  LayoutTemplate,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useCollaboration } from '@/hooks/use-collaboration';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FloatingAIChat } from '@/components/floating-ai-chat';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionDenied } from '@/components/permission-denied';

// Types
interface HoldingZoneCategory {
  id: number;
  name: string;
  color: string;
  createdBy: string;
  createdAt: Date;
  isActive: boolean;
}

interface HoldingZoneItem {
  id: number;
  content: string;
  type: 'task' | 'note' | 'idea' | 'canvas';
  status: 'open' | 'todo' | 'done';
  createdBy: string;
  createdByName: string;
  assignedTo: string[] | null;
  assignedToNames: string[] | null;
  completedAt: Date | null;
  createdAt: Date;
  commentCount: number;
  category: HoldingZoneCategory | null; // Legacy single category
  categoryId: number | null; // Legacy single category ID
  categories: Array<{ id: number; name: string; color: string }>; // Multiple categories
  isUrgent: boolean;
  isPrivate: boolean;
  sharedWithUserId?: string | null;
  details: string | null;
  dueDate: Date | string | null;
  likeCount?: number;
  userHasLiked?: boolean;
  parentItemId?: number | null; // Parent item for nesting
  childCount?: number; // Number of items nested under this item
  isCanvas?: boolean;
  canvasSections?: CanvasSection[] | null;
  canvasStatus?: 'draft' | 'in_review' | 'published' | 'archived' | null;
  canvasPublishedSnapshot?: CanvasSection[] | null;
  canvasPublishedAt?: Date | string | null;
  canvasPublishedBy?: string | null;
}

type CanvasCard = {
  id: string;
  type: 'text';
  content: string;
};

type CanvasSection = {
  id: string;
  title: string;
  cards: CanvasCard[];
};

interface Comment {
  id: number;
  itemId: number;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
}

// Helper functions
const getInitials = (name: string | null | undefined) => {
  if (!name || typeof name !== 'string') return '??';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const getAvatarColor = (name: string | null | undefined) => {
  const colors = [
    'bg-[#236383]', 'bg-[#236383]', 'bg-[#47B3CB]', 'bg-[#FBAD3F]',
    'bg-[#A31C41]', 'bg-[#2E7D32]',
  ];
  if (!name || typeof name !== 'string') return colors[0];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  return colors[index];
};

const formatDate = (date: Date | string) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Check if an item is overdue (has a due date in the past and is not completed)
const isItemOverdue = (item: { dueDate: Date | string | null; status: string }) => {
  if (!item.dueDate || item.status === 'done') return false;
  const dueDate = typeof item.dueDate === 'string' ? new Date(item.dueDate) : item.dueDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
};

// Category badges component - supports multiple categories
function CategoryBadges({ categories }: { categories: Array<{ id: number; name: string; color: string }> }) {
  if (!categories || categories.length === 0) return null;

  return (
    <>
      {categories.map(category => (
        <Badge
          key={category.id}
          className="font-medium text-white border-0"
          style={{ backgroundColor: category.color }}
          data-testid={`badge-category-${category.id}`}
        >
          {category.name}
        </Badge>
      ))}
    </>
  );
}

// Item comments component
function ItemComments({ itemId, initialCommentCount, canView, canSubmit }: { itemId: number; initialCommentCount: number; canView: boolean; canSubmit: boolean }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ['/api/team-board', itemId, 'comments'],
    queryFn: async () => {
      return await apiRequest('GET', `/api/team-board/${itemId}/comments`);
    },
    enabled: isExpanded && canView,
  });

  const createCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      return await apiRequest('POST', `/api/team-board/${itemId}/comments`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board', itemId, 'comments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setNewComment('');
      toast({
        title: 'Comment posted',
        description: 'Your comment has been added',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to post comment',
        variant: 'destructive',
      });
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: number; content: string }) => {
      return await apiRequest('PATCH', `/api/team-board/comments/${commentId}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board', itemId, 'comments'] });
      setEditingCommentId(null);
      setEditContent('');
      toast({
        title: 'Comment updated',
        description: 'Your comment has been updated',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update comment',
        variant: 'destructive',
      });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      return await apiRequest('DELETE', `/api/team-board/comments/${commentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board', itemId, 'comments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({
        title: 'Comment deleted',
        description: 'Your comment has been deleted',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to delete comment',
        variant: 'destructive',
      });
    },
  });

  const handleSubmitComment = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newComment.trim()) return;
    createCommentMutation.mutate(newComment.trim());
  };

  const handleEditComment = (commentId: number) => {
    editCommentMutation.mutate({ commentId, content: editContent.trim() });
  };

  const handleDeleteComment = (commentId: number) => {
    if (window.confirm('Are you sure you want to delete this comment?')) {
      deleteCommentMutation.mutate(commentId);
    }
  };

  // If user doesn't have VIEW permission, don't show comment section at all
  if (!canView) {
    return null;
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-sm text-[#236383] dark:text-[#47B3CB] hover:text-[#236383] dark:hover:text-[#FBAD3F] transition-colors font-medium"
        data-testid={`button-comments-toggle-${itemId}`}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span>
            {initialCommentCount} {initialCommentCount === 1 ? 'Comment' : 'Comments'}
          </span>
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : comments.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {comments.map((comment) => {
                const isOwner = user?.id === comment.userId;
                const commentUserPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
                const canEdit = isOwner && (commentUserPermissions.includes('EDIT_OWN_COMMENTS_HOLDING_ZONE') || commentUserPermissions.includes('MANAGE_HOLDING_ZONE') || user?.role === 'admin' || user?.role === 'super_admin');
                const canDelete = isOwner && (commentUserPermissions.includes('DELETE_OWN_COMMENTS_HOLDING_ZONE') || commentUserPermissions.includes('MANAGE_HOLDING_ZONE') || user?.role === 'admin' || user?.role === 'super_admin');
                const isEditing = editingCommentId === comment.id;

                return (
                  <div
                    key={comment.id}
                    className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
                    data-testid={`comment-${comment.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Avatar className={`h-5 w-5 ${getAvatarColor(comment.userName)}`}>
                          <AvatarFallback className="text-white text-xs">
                            {getInitials(comment.userName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {comment.userName}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      {(canEdit || canDelete) && !isEditing && (
                        <div className="flex gap-1">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setEditingCommentId(comment.id);
                                setEditContent(comment.content);
                              }}
                              data-testid={`button-edit-comment-${comment.id}`}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteComment(comment.id)}
                              disabled={deleteCommentMutation.isPending}
                              data-testid={`button-delete-comment-${comment.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <MentionTextarea
                          value={editContent}
                          onChange={setEditContent}
                          placeholder="Edit comment..."
                          className="min-h-[60px] text-sm"
                          data-testid={`textarea-edit-comment-${comment.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleEditComment(comment.id)}
                            disabled={editCommentMutation.isPending || !editContent.trim()}
                            className="bg-[#236383] hover:bg-[#236383] h-7"
                            data-testid={`button-save-edit-${comment.id}`}
                          >
                            {editCommentMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <><Check className="h-3 w-3 mr-1" /> Save</>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditContent('');
                            }}
                            className="h-7"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        <MessageWithMentions content={comment.content} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-2">No comments yet</p>
          )}

          {canSubmit ? (
            <form onSubmit={handleSubmitComment} className="flex gap-2">
              <MentionTextarea
                value={newComment}
                onChange={setNewComment}
                placeholder="Add a comment... Use @ to mention team members"
                className="flex-1 min-h-[60px] text-sm"
                data-testid={`textarea-comment-${itemId}`}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newComment.trim() || createCommentMutation.isPending}
                className="self-end"
                data-testid={`button-submit-comment-${itemId}`}
              >
                {createCommentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          ) : (
            <div className="text-sm text-gray-500 text-center py-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              You need Submit permission to comment
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Presence Indicators Component
function PresenceIndicators({ 
  presentUsers, 
  isConnected 
}: { 
  presentUsers: Array<{ userId: string; userName: string }>;
  isConnected: boolean;
}) {
  const { user } = useAuth();
  
  // Filter out current user from the list
  const otherUsers = presentUsers.filter(u => u.userId !== user?.id);
  const totalViewers = presentUsers.length;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        {/* Connection Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" data-testid="icon-connected" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-500" data-testid="icon-disconnected" />
              )}
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isConnected ? 'Connected' : 'Disconnected'}</p>
          </TooltipContent>
        </Tooltip>

        {/* User Count and Avatars */}
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {totalViewers} {totalViewers === 1 ? 'person' : 'people'} viewing
          </span>
        </div>

        {/* Avatar Stack */}
        {otherUsers.length > 0 && (
          <div className="flex -space-x-2">
            {otherUsers.slice(0, 5).map((u, index) => (
              <Tooltip key={u.userId}>
                <TooltipTrigger asChild>
                  <Avatar 
                    className={`h-8 w-8 border-2 border-white dark:border-gray-800 ${getAvatarColor(u.userName)}`}
                    data-testid={`avatar-presence-${index}`}
                  >
                    <AvatarFallback className="text-white text-xs">
                      {getInitials(u.userName)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{u.userName}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {otherUsers.length > 5 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar className="h-8 w-8 border-2 border-white dark:border-gray-800 bg-gray-500">
                    <AvatarFallback className="text-white text-xs">
                      +{otherUsers.length - 5}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{otherUsers.slice(5).map(u => u.userName).join(', ')}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// Main Holding Zone component
export default function HoldingZone() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [isCategoryManageOpen, setIsCategoryManageOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showAssignedToMe, setShowAssignedToMe] = useState(false);
  const [newItemContent, setNewItemContent] = useState('');
  const [newItemType, setNewItemType] = useState<'task' | 'note' | 'idea' | 'canvas'>('task');
  const [newItemCategoryIds, setNewItemCategoryIds] = useState<number[]>([]);
  const [newItemIsUrgent, setNewItemIsUrgent] = useState(false);
  const [newItemIsPrivate, setNewItemIsPrivate] = useState(false);
  const [newItemSharedWithUserId, setNewItemSharedWithUserId] = useState<string | null>(null);
  const [newItemDetails, setNewItemDetails] = useState('');
  const [newCanvasSections, setNewCanvasSections] = useState<CanvasSection[]>([
    { id: 'context', title: 'Context', cards: [{ id: 'context-1', type: 'text', content: '' }] },
    { id: 'working-notes', title: 'Working Notes', cards: [] },
  ]);
  const [newItemDueDate, setNewItemDueDate] = useState('');
  const [newItemAssignedTo, setNewItemAssignedTo] = useState<string[]>([]);
  const [newItemAssignedToNames, setNewItemAssignedToNames] = useState<string[]>([]);
  const [isCreatingNewCategory, setIsCreatingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#236383');
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [itemToPromote, setItemToPromote] = useState<HoldingZoneItem | null>(null);
  const [promotePriority, setPromotePriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [promoteAssignedTo, setPromoteAssignedTo] = useState<string[]>([]);
  const [promoteAssignedToNames, setPromoteAssignedToNames] = useState<string[]>([]);
  const [promoteDueDate, setPromoteDueDate] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<HoldingZoneItem | null>(null);
  const [editItemContent, setEditItemContent] = useState('');
  const [editItemType, setEditItemType] = useState<'task' | 'note' | 'idea' | 'canvas'>('task');
  const [editItemCategoryIds, setEditItemCategoryIds] = useState<number[]>([]);
  const [editItemIsUrgent, setEditItemIsUrgent] = useState(false);
  const [editItemIsPrivate, setEditItemIsPrivate] = useState(false);
  const [editItemSharedWithUserId, setEditItemSharedWithUserId] = useState<string | null>(null);
  const [editItemDetails, setEditItemDetails] = useState('');
  const [editCanvasSections, setEditCanvasSections] = useState<CanvasSection[]>([]);
  const [editItemDueDate, setEditItemDueDate] = useState('');
  const [isEditCreatingNewCategory, setIsEditCreatingNewCategory] = useState(false);
  const [editNewCategoryName, setEditNewCategoryName] = useState('');
  const [editNewCategoryColor, setEditNewCategoryColor] = useState('#236383');
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [itemToAssign, setItemToAssign] = useState<HoldingZoneItem | null>(null);
  const [editingDetailsItemId, setEditingDetailsItemId] = useState<number | null>(null);
  const [editingDetailsContent, setEditingDetailsContent] = useState('');
  const [activeTab, setActiveTab] = useState<'tasks' | 'todo' | 'notes' | 'canvas'>('tasks');
  const [upgradeToProjectDialogOpen, setUpgradeToProjectDialogOpen] = useState(false);
  const [itemToUpgrade, setItemToUpgrade] = useState<HoldingZoneItem | null>(null);
  const [upgradeProjectTitle, setUpgradeProjectTitle] = useState('');
  const [upgradeProjectPriority, setUpgradeProjectPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [upgradeProjectCategory, setUpgradeProjectCategory] = useState('technology');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [itemToLink, setItemToLink] = useState<HoldingZoneItem | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);

  // Overdue item action dialog state
  const [overdueActionDialogOpen, setOverdueActionDialogOpen] = useState(false);
  const [overdueItem, setOverdueItem] = useState<HoldingZoneItem | null>(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [transformContent, setTransformContent] = useState('');

  // Permission checks
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const canView = userPermissions.includes('VIEW_HOLDING_ZONE') || user?.role === 'admin' || user?.role === 'super_admin';
  const canSubmit = userPermissions.includes('SUBMIT_HOLDING_ZONE') || user?.role === 'admin' || user?.role === 'super_admin';
  const canManage = userPermissions.includes('MANAGE_HOLDING_ZONE') || user?.role === 'admin' || user?.role === 'super_admin';
  // Granular edit/delete permissions for items
  const canEditOwn = userPermissions.includes('HOLDING_ZONE_EDIT_OWN') || canManage;
  const canEditAll = userPermissions.includes('HOLDING_ZONE_EDIT_ALL') || canManage;
  const canDeleteOwn = userPermissions.includes('HOLDING_ZONE_DELETE_OWN') || canManage;
  const canDeleteAll = userPermissions.includes('HOLDING_ZONE_DELETE_ALL') || canManage;

  // Real-time collaboration hook - called unconditionally (hook rules)
  const collaboration = useCollaboration({
    resourceType: 'holding-zone',
    resourceId: 'main',
  });
  
  // Only use collaboration if user can view
  const isConnected = user && canView && collaboration ? collaboration.isConnected : false;
  const presentUsers = user && canView && collaboration ? collaboration.presentUsers : [];
  const onFieldUpdate = user && canView && collaboration ? collaboration.onFieldUpdate : () => () => {};

  // Listen for real-time updates and refresh the items list
  useEffect(() => {
    if (!canView) return;

    const unsubscribe = onFieldUpdate(() => {
      // Invalidate queries to refresh items when any field is updated
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      
      // Show a subtle toast notification
      toast({
        title: 'Updates available',
        description: 'The holding zone has been updated by another team member',
        duration: 3000,
      });
    });

    return unsubscribe;
  }, [canView, onFieldUpdate, toast]);

  // Fetch categories
  const { data: categories = [] } = useQuery<HoldingZoneCategory[]>({
    queryKey: ['/api/holding-zone/categories'],
    enabled: canView,
  });

  // Fetch holding zone items
  const { data: items = [], isLoading } = useQuery<HoldingZoneItem[]>({
    queryKey: ['/api/team-board'],
    enabled: canView,
  });

  // Fetch promoted subtasks (from project tasks)
  interface PromotedSubtask {
    id: number;
    parentTaskId: number | null;
    projectId: number | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    promotedToTodo: boolean;
    dueDate: string | null;
    assigneeIds: string[] | null;
    assigneeNames: string[] | null;
    createdAt: string;
  }

  const { data: promotedSubtasks = [] } = useQuery<PromotedSubtask[]>({
    queryKey: ['/api/tasks/promoted-to-todo'],
    enabled: canView,
  });

  // Helper function to sort items so children appear right after their parents
  const sortItemsWithChildren = (items: HoldingZoneItem[]): HoldingZoneItem[] => {
    const itemMap = new Map<number, HoldingZoneItem>();
    const rootItems: HoldingZoneItem[] = [];
    const childrenByParent = new Map<number, HoldingZoneItem[]>();

    // Build maps
    items.forEach(item => {
      itemMap.set(item.id, item);
      if (item.parentItemId) {
        if (!childrenByParent.has(item.parentItemId)) {
          childrenByParent.set(item.parentItemId, []);
        }
        childrenByParent.get(item.parentItemId)!.push(item);
      } else {
        rootItems.push(item);
      }
    });

    // Sort root items (by createdAt descending)
    rootItems.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    // Recursively build sorted list: parent, then its children, then next parent
    const result: HoldingZoneItem[] = [];
    const processed = new Set<number>();

    const addItemAndChildren = (item: HoldingZoneItem) => {
      if (processed.has(item.id)) return;
      processed.add(item.id);
      
      result.push(item);
      
      // Add children right after parent
      const children = childrenByParent.get(item.id) || [];
      children.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });
      children.forEach(child => addItemAndChildren(child));
    };

    rootItems.forEach(item => addItemAndChildren(item));

    return result;
  };

  // Filter items - split by type and status
  const { filteredTasks, filteredTodo, filteredNotes, filteredCanvases } = useMemo(() => {
    let filtered = items;

    // Filter by active/archived status
    if (selectedStatus === 'active') {
      filtered = filtered.filter(item => item.status !== 'done' && !item.completedAt);
    } else if (selectedStatus === 'archived') {
      filtered = filtered.filter(item => item.status === 'done' || item.completedAt);
    } else if (selectedStatus !== 'all') {
      filtered = filtered.filter(item => item.status === selectedStatus);
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(item => String(item.categoryId) === selectedCategory);
    }

    if (showUrgentOnly) {
      filtered = filtered.filter(item => item.isUrgent);
    }

    if (showAssignedToMe && user?.id) {
      filtered = filtered.filter(item =>
        item.assignedTo && item.assignedTo.includes(user.id)
      );
    }

    // Split into tasks, todo list, and notes/ideas
    const tasks = filtered.filter(item => item.type === 'task' && item.status !== 'todo');
    const todo = filtered.filter(item => item.status === 'todo'); // To-Do List items (any type)
    const notes = filtered.filter(item => (item.type === 'note' || item.type === 'idea') && item.status !== 'todo');
    const canvases = filtered.filter(item => (item.isCanvas || item.type === 'canvas') && item.status !== 'todo');

    // Sort each array so children appear right after their parents
    return { 
      filteredTasks: sortItemsWithChildren(tasks), 
      filteredTodo: sortItemsWithChildren(todo), 
      filteredNotes: sortItemsWithChildren(notes),
      filteredCanvases: sortItemsWithChildren(canvases),
    };
  }, [items, selectedCategory, selectedStatus, showUrgentOnly, showAssignedToMe, user?.id]);

  // Get current items based on active tab
  const currentItems = activeTab === 'tasks'
    ? filteredTasks
    : activeTab === 'todo'
      ? filteredTodo
      : activeTab === 'canvas'
        ? filteredCanvases
        : filteredNotes;

  // Filter promoted subtasks for "Assigned to Me"
  const filteredPromotedSubtasks = useMemo(() => {
    if (!showAssignedToMe || !user?.id) return promotedSubtasks;
    return promotedSubtasks.filter(st =>
      st.assigneeIds && st.assigneeIds.includes(user.id)
    );
  }, [promotedSubtasks, showAssignedToMe, user?.id]);

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      return await apiRequest('POST', '/api/holding-zone/categories', data);
    },
    onSuccess: (newCategory: HoldingZoneCategory) => {
      queryClient.invalidateQueries({ queryKey: ['/api/holding-zone/categories'] });
      setNewItemCategoryIds(prev => [...prev, newCategory.id]);
      setIsCreatingNewCategory(false);
      setNewCategoryName('');
      setNewCategoryColor('#236383');
      toast({
        title: 'Category created',
        description: 'Your new category has been created',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create category',
        variant: 'destructive',
      });
    },
  });

  // Create item mutation
  const createItemMutation = useMutation({
    mutationFn: async (data: {
      content: string;
      type: 'task' | 'note' | 'idea' | 'canvas';
      categoryIds: number[] | null;
      isUrgent: boolean;
      isPrivate: boolean;
      sharedWithUserId?: string | null;
      details: string | null;
      dueDate: string | null;
      assignedTo: string[] | null;
      assignedToNames: string[] | null;
      isCanvas?: boolean;
      canvasStatus?: 'draft' | 'in_review' | 'published' | 'archived';
      canvasSections?: CanvasSection[] | null;
    }) => {
      return await apiRequest('POST', '/api/team-board', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setIsSubmitDialogOpen(false);
      setNewItemContent('');
      setNewItemType('task');
      setNewItemCategoryIds([]);
      setNewItemIsUrgent(false);
      setNewItemIsPrivate(false);
      setNewItemSharedWithUserId(null);
      setNewItemDetails('');
      setNewItemDueDate('');
      setNewItemAssignedTo([]);
      setNewItemAssignedToNames([]);
      setNewCanvasSections([
        { id: 'context', title: 'Context', cards: [{ id: 'context-1', type: 'text', content: '' }] },
        { id: 'working-notes', title: 'Working Notes', cards: [] },
      ]);
      setIsCreatingNewCategory(false);
      setNewCategoryName('');
      setNewCategoryColor('#236383');
      toast({
        title: 'Item submitted',
        description: 'Your item has been added to the holding zone',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to submit item',
        variant: 'destructive',
      });
    },
  });

  // Update item status mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'open' | 'done' }) => {
      return await apiRequest('PATCH', `/api/team-board/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({
        title: 'Status updated',
        description: 'Item status has been changed',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update status',
        variant: 'destructive',
      });
    },
  });

  // Edit item mutation
  const editItemMutation = useMutation({
    mutationFn: async ({ id, content, type, categoryIds, isUrgent, isPrivate, sharedWithUserId, details, dueDate, canvasSections, canvasStatus, isCanvas }: {
      id: number;
      content: string;
      type: 'task' | 'note' | 'idea' | 'canvas';
      categoryIds: number[];
      isUrgent: boolean;
      isPrivate: boolean;
      sharedWithUserId?: string | null;
      details?: string | null;
      dueDate?: string | null;
      canvasSections?: CanvasSection[] | null;
      canvasStatus?: 'draft' | 'in_review' | 'published' | 'archived';
      isCanvas?: boolean;
    }) => {
      return await apiRequest('PATCH', `/api/team-board/${id}`, { content, type, categoryIds, isUrgent, isPrivate, sharedWithUserId, details, dueDate, canvasSections, canvasStatus, isCanvas });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setEditDialogOpen(false);
      setItemToEdit(null);
      setEditItemContent('');
      setEditItemType('task');
      setEditItemCategoryIds([]);
      setEditItemIsUrgent(false);
      setEditItemIsPrivate(false);
      setEditItemSharedWithUserId(null);
      setEditItemDetails('');
      setEditItemDueDate('');
      setEditCanvasSections([]);
      toast({
        title: 'Item updated',
        description: 'Your item has been updated successfully',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update item',
        variant: 'destructive',
      });
    },
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/team-board/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({
        title: 'Item deleted',
        description: 'Your item has been deleted',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to delete item',
        variant: 'destructive',
      });
    },
  });

  // Update item assignments mutation
  const updateAssignmentsMutation = useMutation({
    mutationFn: async ({ id, assignedTo, assignedToNames }: { 
      id: number; 
      assignedTo: string[] | null; 
      assignedToNames: string[] | null; 
    }) => {
      return await apiRequest('PATCH', `/api/team-board/${id}`, { assignedTo, assignedToNames });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({
        title: 'Assignment updated',
        description: 'Team member assignments have been updated',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update assignments',
        variant: 'destructive',
      });
    },
  });

  // Promote to To-Do List mutation
  const promoteToTaskMutation = useMutation({
    mutationFn: async ({ 
      id, 
      assignedTo, 
      assignedToNames, 
      dueDate 
    }: { 
      id: number; 
      assignedTo?: string[]; 
      assignedToNames?: string[]; 
      dueDate?: string | null;
    }) => {
      return await apiRequest('POST', `/api/team-board/${id}/promote`, {
        assignedTo: assignedTo || null,
        assignedToNames: assignedToNames || null,
        dueDate: dueDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setPromoteDialogOpen(false);
      setItemToPromote(null);
      setPromotePriority('medium');
      setPromoteAssignedTo([]);
      setPromoteAssignedToNames([]);
      setPromoteDueDate('');
      toast({
        title: 'Moved to To-Do List',
        description: 'The item has been moved to the To-Do List',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to move item to To-Do List',
        variant: 'destructive',
      });
    },
  });

  // Link/unlink item mutation
  const linkItemMutation = useMutation({
    mutationFn: async ({ 
      id, 
      parentItemId 
    }: { 
      id: number; 
      parentItemId: number | null;
    }) => {
      return await apiRequest('PATCH', `/api/team-board/${id}/link`, {
        parentItemId: parentItemId,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setLinkDialogOpen(false);
      setItemToLink(null);
      setSelectedParentId(null);
      toast({
        title: variables.parentItemId ? 'Item linked' : 'Item unlinked',
        description: variables.parentItemId ? 'Item has been linked to parent' : 'Item has been unlinked',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error?.response?.data?.message || 'Failed to link/unlink item',
        variant: 'destructive',
      });
    },
  });

  // Upgrade to project mutation
  const upgradeToProjectMutation = useMutation({
    mutationFn: async ({ 
      holdingZoneItemId, 
      title, 
      priority, 
      category,
      description,
      dueDate 
    }: { 
      holdingZoneItemId: number; 
      title: string;
      priority: string;
      category: string;
      description?: string;
      dueDate?: string | null;
    }) => {
      // Create the project
      const project = await apiRequest('POST', '/api/projects', {
        title,
        description: description || '',
        status: 'waiting',
        priority,
        category,
        dueDate,
        notes: `Upgraded from Holding Zone item #${holdingZoneItemId}`,
      });

      // Mark the holding zone item as done
      await apiRequest('PATCH', `/api/team-board/${holdingZoneItemId}`, { 
        status: 'done' 
      });

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      setUpgradeToProjectDialogOpen(false);
      setItemToUpgrade(null);
      setUpgradeProjectTitle('');
      setUpgradeProjectPriority('medium');
      setUpgradeProjectCategory('technology');
      toast({
        title: 'Upgraded to Project',
        description: 'The task-draft has been upgraded to a project. You can find it in the Projects section.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to upgrade task-draft to project',
        variant: 'destructive',
      });
    },
  });

  // Like/Unlike mutation - optimized to only invalidate main query since likes are now included
  const toggleLikeMutation = useMutation({
    mutationFn: async ({ itemId, isLiked }: { itemId: number; isLiked: boolean }) => {
      if (isLiked) {
        return await apiRequest('DELETE', `/api/team-board/items/${itemId}/like`);
      } else {
        return await apiRequest('POST', `/api/team-board/items/${itemId}/like`);
      }
    },
    onSuccess: () => {
      // Likes are now included in main query, so only need to invalidate that
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update like',
        variant: 'destructive',
      });
    },
  });

  // Update details mutation (for inline editing)
  const updateDetailsMutation = useMutation({
    mutationFn: async ({ id, details }: { id: number; details: string | null }) => {
      return await apiRequest('PATCH', `/api/team-board/${id}`, { details });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      setEditingDetailsItemId(null);
      setEditingDetailsContent('');
      toast({
        title: 'Details updated',
        description: 'Item details have been updated',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update details',
        variant: 'destructive',
      });
    },
  });

  // Fetch team members for assignment
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['/api/team-board/users'],
    enabled: canSubmit || canManage,
  });

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      toast({
        title: 'Category name required',
        description: 'Please enter a category name',
        variant: 'destructive',
      });
      return;
    }

    createCategoryMutation.mutate({
      name: newCategoryName.trim(),
      color: newCategoryColor,
    });
  };

  const addCanvasSection = (setter: React.Dispatch<React.SetStateAction<CanvasSection[]>>) => {
    setter(prev => [
      ...prev,
      {
        id: `section-${Date.now()}`,
        title: `Section ${prev.length + 1}`,
        cards: [],
      },
    ]);
  };

  const updateCanvasSectionTitle = (
    setter: React.Dispatch<React.SetStateAction<CanvasSection[]>>,
    sectionId: string,
    title: string
  ) => {
    setter(prev =>
      prev.map(section => (section.id === sectionId ? { ...section, title } : section))
    );
  };

  const updateCanvasSectionContent = (
    setter: React.Dispatch<React.SetStateAction<CanvasSection[]>>,
    sectionId: string,
    content: string
  ) => {
    setter(prev =>
      prev.map(section => {
        if (section.id !== sectionId) return section;
        const cards = section.cards && section.cards.length > 0
          ? section.cards.map((card, idx) =>
              idx === 0 ? { ...card, type: 'text', content } : card
            )
          : [{ id: `${sectionId}-card-1`, type: 'text' as const, content }];
        return { ...section, cards };
      })
    );
  };

  const handleSubmitItem = () => {
    if (!newItemContent.trim()) {
      toast({
        title: 'Content required',
        description: 'Please enter item content',
        variant: 'destructive',
      });
      return;
    }

    const isCanvas = newItemType === 'canvas';

    createItemMutation.mutate({
      content: newItemContent.trim(),
      type: newItemType,
      categoryIds: newItemCategoryIds.length > 0 ? newItemCategoryIds : null,
      isUrgent: newItemIsUrgent,
      isPrivate: newItemIsPrivate,
      sharedWithUserId: newItemIsPrivate ? newItemSharedWithUserId : null,
      details: newItemDetails.trim() || null,
      dueDate: newItemDueDate ? new Date(newItemDueDate).toISOString() : null,
      assignedTo: newItemAssignedTo.length > 0 ? newItemAssignedTo : null,
      assignedToNames: newItemAssignedToNames.length > 0 ? newItemAssignedToNames : null,
      isCanvas,
      canvasStatus: isCanvas ? 'draft' : undefined,
      canvasSections: isCanvas ? newCanvasSections : null,
    });
  };

  // Assignment helpers
  const handleAssignToUser = (item: HoldingZoneItem, userId: string) => {
    const member = teamMembers.find(m => m.id === userId);
    if (!member) return;

    const currentAssignedTo = item.assignedTo || [];
    const currentAssignedToNames = item.assignedToNames || [];

    if (currentAssignedTo.includes(member.id)) {
      toast({
        title: 'Already assigned',
        description: `${member.name} is already assigned to this item`,
      });
      return;
    }

    updateAssignmentsMutation.mutate({
      id: item.id,
      assignedTo: [...currentAssignedTo, member.id],
      assignedToNames: [...currentAssignedToNames, member.name],
    });
  };

  const handleUnassign = (item: HoldingZoneItem, userId: string) => {
    const currentAssignedTo = item.assignedTo || [];
    const currentAssignedToNames = item.assignedToNames || [];
    
    const userIndex = currentAssignedTo.indexOf(userId);
    if (userIndex === -1) return;

    const newAssignedTo = currentAssignedTo.filter((_, i) => i !== userIndex);
    const newAssignedToNames = currentAssignedToNames.filter((_, i) => i !== userIndex);

    updateAssignmentsMutation.mutate({
      id: item.id,
      assignedTo: newAssignedTo.length === 0 ? null : newAssignedTo,
      assignedToNames: newAssignedToNames.length === 0 ? null : newAssignedToNames,
    });
  };

  const handleOpenAssignDialog = (item: HoldingZoneItem) => {
    setItemToAssign(item);
    setAssignDialogOpen(true);
  };

  const handleAssignFromDialog = (userId: string) => {
    if (!itemToAssign) return;
    handleAssignToUser(itemToAssign, userId);
    setAssignDialogOpen(false);
    setItemToAssign(null);
  };

  const handleStartEditingDetails = (item: HoldingZoneItem) => {
    setEditingDetailsItemId(item.id);
    setEditingDetailsContent(item.details || '');
  };

  const handleSaveDetails = (itemId: number) => {
    updateDetailsMutation.mutate({
      id: itemId,
      details: editingDetailsContent.trim() || null,
    });
  };

  const handleCancelEditingDetails = () => {
    setEditingDetailsItemId(null);
    setEditingDetailsContent('');
  };

  // Like Button Component - uses data from main items query instead of individual API calls
  const LikeButton = ({ itemId, likeCount = 0, isLiked = false }: { itemId: number; likeCount?: number; isLiked?: boolean }) => {
    if (!canSubmit) return null;

    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => toggleLikeMutation.mutate({ itemId, isLiked })}
        className={`h-7 px-2 gap-1 ${isLiked ? 'text-red-500 hover:text-red-600' : 'text-gray-400 hover:text-red-500'}`}
        data-testid={`button-like-${itemId}`}
      >
        <Heart className={`h-3.5 w-3.5 ${isLiked ? 'fill-current' : ''}`} />
        {likeCount > 0 && <span className="text-xs">{likeCount}</span>}
      </Button>
    );
  };

  if (!canView) {
    return (
      <div className="container mx-auto p-6">
        <PermissionDenied
          action="view the Holding Zone"
          requiredPermission="TEAM_BOARD_VIEW"
          variant="card"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Holding Zone</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Submit and track tasks, notes, and ideas for the team
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCategoryManageOpen(true)}
              data-testid="button-manage-categories"
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage Categories
            </Button>
          )}
          {canSubmit && (
            <Button
              onClick={() => setIsSubmitDialogOpen(true)}
              size="lg"
              className="bg-[#236383] hover:bg-[#236383] text-white"
              data-testid="button-submit-item"
            >
              <Plus className="h-5 w-5 mr-2" />
              Submit Item
            </Button>
          )}
        </div>
      </div>

      {/* Presence and Filters Row */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        {/* Presence Indicators */}
        <PresenceIndicators presentUsers={presentUsers} isConnected={isConnected} />
        
        {/* Filters */}
        <Card className="flex-1">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters:</span>
              </div>

              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Active Items" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All Items</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="urgent-only"
                  checked={showUrgentOnly}
                  onCheckedChange={(checked) => setShowUrgentOnly(checked as boolean)}
                  data-testid="checkbox-urgent-only"
                />
                <Label htmlFor="urgent-only" className="text-sm font-medium cursor-pointer">
                  Show Urgent Only
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="assigned-to-me"
                  checked={showAssignedToMe}
                  onCheckedChange={(checked) => setShowAssignedToMe(checked as boolean)}
                  data-testid="checkbox-assigned-to-me"
                />
                <Label htmlFor="assigned-to-me" className="text-sm font-medium cursor-pointer flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  Assigned to Me
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Tasks, To-Do List, Notes, and Canvases */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'tasks' | 'todo' | 'notes' | 'canvas')} className="mb-6">
        <TabsList className="grid w-full grid-cols-4 max-w-3xl">
          <TabsTrigger value="tasks" className="flex items-center gap-2" data-testid="tab-tasks">
            <ListTodo className="h-4 w-4" />
            Task-Drafts
            {filteredTasks.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {filteredTasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="todo" className="flex items-center gap-2" data-testid="tab-todo">
            <CheckCircle2 className="h-4 w-4" />
            To-Do List
            {(filteredTodo.length + filteredPromotedSubtasks.length) > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {filteredTodo.length + filteredPromotedSubtasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-2" data-testid="tab-notes">
            <StickyNote className="h-4 w-4" />
            Notes & Ideas
            {filteredNotes.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {filteredNotes.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="canvas" className="flex items-center gap-2" data-testid="tab-canvas">
            <LayoutTemplate className="h-4 w-4" />
            Canvases
            {filteredCanvases.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {filteredCanvases.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Items List */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#236383]" />
        </div>
      ) : currentItems.length === 0 && !(activeTab === 'todo' && filteredPromotedSubtasks.length > 0) ? (
        <Card>
          <CardContent className="p-12 text-center">
            {activeTab === 'tasks' ? (
              <>
                <ListTodo className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 dark:text-gray-400 text-lg">
                  No task-drafts found. {canSubmit && "Click 'Submit Item' to add one!"}
                </p>
              </>
            ) : activeTab === 'todo' ? (
              <>
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 dark:text-gray-400 text-lg">
                  No items in To-Do List. Promote task-drafts or subtasks to add them here!
                </p>
              </>
            ) : activeTab === 'canvas' ? (
              <>
                <LayoutTemplate className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 dark:text-gray-400 text-lg">
                  No canvases yet. {canSubmit && "Click 'Submit Item' and choose Canvas to start one."}
                </p>
              </>
            ) : (
              <>
                <StickyNote className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 dark:text-gray-400 text-lg">
                  No notes or ideas found. {canSubmit && "Click 'Submit Item' to add one!"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {currentItems.map((item) => {
            const isChildItem = !!item.parentItemId;
            const parentItem = items.find(i => i.id === item.parentItemId);
            return (
            <Card
              key={item.id}
              className={`transition-all hover:shadow-md border-l-4 ${
                item.isUrgent ? 'border-l-red-500' : ''
              } ${isChildItem ? 'ml-8 border-l-2 opacity-95' : ''} ${
                // Workflow-status background tint. The left border is
                // reserved for category color / urgency, so status is
                // signaled by a soft card-wide tint instead. This makes
                // workflow stage scannable at a glance without rebuilding
                // the layout into Kanban columns.
                item.status === 'done'
                  ? 'bg-gray-50/70 dark:bg-gray-900/40'
                  : item.status === 'todo'
                    ? 'bg-blue-50/40 dark:bg-blue-950/20'
                    : ''
              }`}
              style={!item.isUrgent && item.categories?.length > 0 ? { borderLeftColor: item.categories[0].color } : undefined}
              data-testid={`card-item-${item.id}`}
            >
              <CardContent className="p-4">
                {/* Header: Title, Badges, Actions */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    {isChildItem && parentItem && (
                      <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <ChevronRight className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate max-w-[400px]">{parentItem.content}</span>
                      </div>
                    )}
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                      {item.content}
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <CategoryBadges categories={item.categories || []} />
                      {item.isUrgent && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Urgent
                        </Badge>
                      )}
                      <Badge variant="outline" className="capitalize">
                        {item.type}
                      </Badge>
                      {item.isPrivate && (
                        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 bg-amber-50">
                          {item.sharedWithUserId
                            ? `Private (you + ${teamMembers.find(m => m.id === item.sharedWithUserId)?.name ?? 'other'})`
                            : 'Private (only you)'}
                        </Badge>
                      )}
                      {/* Workflow status badge — every item now carries
                          one (Open / To-Do / Done) so the workflow state
                          is explicit instead of inferred from the
                          presence of a To-Do or Done badge. Open is the
                          default "in the holding zone" state; To-Do
                          means actively being worked; Done is complete. */}
                      {item.status === 'open' && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-slate-400 text-slate-700 bg-white"
                        >
                          <Circle className="h-3 w-3" />
                          Open
                        </Badge>
                      )}
                      {item.status === 'todo' && (
                        <Badge variant="default" className="gap-1 bg-blue-600 hover:bg-blue-700">
                          <Clock className="h-3 w-3" />
                          To-Do
                        </Badge>
                      )}
                      {item.status === 'done' && (
                        <Badge
                          variant="default"
                          className="gap-1 bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Done
                        </Badge>
                      )}
                      {isItemOverdue(item) && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-orange-500 text-orange-600 bg-orange-50 cursor-pointer hover:bg-orange-100"
                          onClick={() => {
                            setOverdueItem(item);
                            setTransformContent(item.content);
                            setPostponeDate('');
                            setOverdueActionDialogOpen(true);
                          }}
                        >
                          <Clock className="h-3 w-3" />
                          Overdue
                        </Badge>
                      )}
                    </div>
                  </div>

                  {(() => {
                    // Check edit/delete permissions per item
                    const isOwner = item.createdBy === user?.id;
                    const itemCanEdit = canEditAll || (isOwner && canEditOwn);
                    const itemCanDelete = canDeleteAll || (isOwner && canDeleteOwn);
                    const showActions = (itemCanEdit || itemCanDelete) && item.status !== 'done' && !item.completedAt;

                    return showActions && (
                      <div className="flex gap-1 flex-shrink-0">
                        {itemCanEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setItemToEdit(item);
                              setEditItemContent(item.content);
                              setEditItemType(item.type);
                              setEditItemCategoryIds(item.categories?.map(c => c.id) || []);
                              setEditItemIsUrgent(item.isUrgent);
                              setEditItemIsPrivate(item.isPrivate);
                              setEditItemSharedWithUserId(item.sharedWithUserId ?? null);
                              setEditItemDetails(item.details || '');
                              setEditCanvasSections((item.canvasSections as CanvasSection[] | null) || []);
                              setEditItemDueDate(item.dueDate ? (typeof item.dueDate === 'string' ? item.dueDate : new Date(item.dueDate).toISOString().split('T')[0]) : '');
                              setEditDialogOpen(true);
                            }}
                            className="h-8 w-8 p-0"
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                        {itemCanDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm('Are you sure you want to delete this item?')) {
                                deleteItemMutation.mutate(item.id);
                              }
                            }}
                            disabled={deleteItemMutation.isPending}
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {(item.isCanvas || item.type === 'canvas') && (
                  <div className="mb-3 space-y-2">
                    <p className="text-sm font-semibold text-[#236383]">Canvas</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {((item.canvasSections as CanvasSection[] | null) || []).length === 0 ? (
                        <p className="text-sm text-gray-500">No sections yet</p>
                      ) : (
                        ((item.canvasSections as CanvasSection[] | null) || []).map((section) => (
                          <div key={section.id} className="rounded-lg border border-gray-200 p-3 bg-[#F9FBFC]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-bold text-gray-800 truncate">{section.title}</span>
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {item.canvasStatus || 'draft'}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                              {section.cards?.[0]?.content || 'No content yet'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Details Section with Inline Editing */}
                <div className="mb-3">
                  {editingDetailsItemId === item.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingDetailsContent}
                        onChange={(e) => setEditingDetailsContent(e.target.value)}
                        placeholder="Add details..."
                        className="min-h-[80px] text-sm"
                        data-testid={`textarea-details-${item.id}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleSaveDetails(item.id)}
                          disabled={updateDetailsMutation.isPending}
                          className="h-7 text-xs"
                        >
                          {updateDetailsMutation.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEditingDetails}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Details</span>
                        {(canSubmit || canManage) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStartEditingDetails(item)}
                            className="h-6 px-2 text-xs"
                            data-testid={`button-edit-details-${item.id}`}
                          >
                            {item.details ? <Edit2 className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                            {item.details ? 'Edit' : 'Add'}
                          </Button>
                        )}
                      </div>
                      {item.details ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {item.details}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No details added</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Dates */}
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="font-medium">Created:</span>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  {item.dueDate && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      <span className="font-medium">Due:</span>
                      <span>{formatDate(typeof item.dueDate === 'string' ? new Date(item.dueDate) : item.dueDate)}</span>
                    </div>
                  )}
                </div>

                {/* Assignment Section */}
                {(canSubmit || canManage) && (
                  <div className="mb-3">
                    {item.assignedTo && item.assignedToNames && item.assignedTo.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.assignedToNames.map((name, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md text-xs"
                              data-testid={`assigned-user-${item.id}-${index}`}
                            >
                              <Avatar className={`h-4 w-4 ${getAvatarColor(name)}`}>
                                <AvatarFallback className="text-white text-[8px]">
                                  {getInitials(name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-gray-700 dark:text-gray-300">{name}</span>
                              {canManage && (
                                <button
                                  onClick={() => handleUnassign(item, item.assignedTo![index])}
                                  className="ml-1 text-gray-400 hover:text-red-500"
                                  data-testid={`button-unassign-${item.id}-${index}`}
                                  title="Remove assignee"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenAssignDialog(item)}
                      className="h-8 text-xs"
                      data-testid={`button-assign-${item.id}`}
                    >
                      <UserPlus className="h-3 w-3 mr-1" />
                      Assign to team member
                    </Button>
                  </div>
                )}

                {/* Like and Comments */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                  {canSubmit && (
                    <div className="flex items-center gap-2">
                      <LikeButton itemId={item.id} likeCount={item.likeCount} isLiked={item.userHasLiked} />
                      {item.commentCount > 0 && (
                        <span className="text-xs text-gray-500">
                          {item.commentCount} {item.commentCount === 1 ? 'comment' : 'comments'}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    Creator: <span className="font-medium">{item.createdByName}</span>
                  </div>
                </div>

                {/* Comments Section */}
                {canView && (
                  <div className="mt-3">
                    <ItemComments itemId={item.id} initialCommentCount={item.commentCount} canView={canView} canSubmit={canSubmit} />
                  </div>
                )}

                {/* Action Buttons for Manage */}
                {canManage && item.status !== 'done' && !item.completedAt && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    {item.type === 'task' && item.status !== 'todo' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setItemToPromote(item);
                            setPromoteAssignedTo(item.assignedTo || []);
                            setPromoteAssignedToNames(item.assignedToNames || []);
                            setPromoteDueDate(item.dueDate ? (typeof item.dueDate === 'string' ? item.dueDate.split('T')[0] : new Date(item.dueDate).toISOString().split('T')[0]) : '');
                            setPromoteDialogOpen(true);
                          }}
                          disabled={promoteToTaskMutation.isPending}
                          className="text-xs"
                          data-testid={`button-promote-${item.id}`}
                        >
                          <ArrowRight className="h-3 w-3 mr-1" />
                          Move to To-Do List
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => {
                            setItemToUpgrade(item);
                            setUpgradeProjectTitle(item.content);
                            setUpgradeToProjectDialogOpen(true);
                          }}
                          disabled={upgradeToProjectMutation.isPending}
                          className="text-xs bg-[#236383] hover:bg-[#236383]"
                          data-testid={`button-upgrade-to-project-${item.id}`}
                        >
                          <FolderKanban className="h-3 w-3 mr-1" />
                          Upgrade to Project
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setItemToLink(item);
                        setSelectedParentId(item.parentItemId || null);
                        setLinkDialogOpen(true);
                      }}
                      className="text-xs"
                      data-testid={`button-link-${item.id}`}
                    >
                      {item.parentItemId ? (
                        <>
                          <Unlink className="h-3 w-3 mr-1" />
                          Unlink
                        </>
                      ) : (
                        <>
                          <Link className="h-3 w-3 mr-1" />
                          Link to Item
                        </>
                      )}
                    </Button>
                    {item.childCount != null && item.childCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {item.childCount} linked {item.childCount === 1 ? 'item' : 'items'}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateItemMutation.mutate({ id: item.id, status: 'done' })}
                      disabled={updateItemMutation.isPending}
                      className="text-xs"
                      data-testid={`button-mark-done-${item.id}`}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Mark Done
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
          })}

          {/* Promoted Subtasks Section - only show in todo tab */}
          {activeTab === 'todo' && filteredPromotedSubtasks.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-teal-600" />
                Project Subtasks
              </h3>
              <div className="space-y-3">
                {filteredPromotedSubtasks.map((subtask) => (
                  <Card
                    key={`subtask-${subtask.id}`}
                    className="transition-all hover:shadow-md border-l-4 border-l-teal-500"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {subtask.title}
                          </h3>
                          {subtask.description && (
                            <p className="text-sm text-gray-600 mb-2">{subtask.description}</p>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="capitalize bg-teal-50 text-teal-700 border-teal-200">
                              Subtask
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                subtask.priority === 'high'
                                  ? 'bg-red-100 text-red-800 border-red-200'
                                  : subtask.priority === 'medium'
                                  ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                                  : 'bg-green-100 text-green-800 border-green-200'
                              }
                            >
                              {subtask.priority}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                subtask.status === 'completed'
                                  ? 'bg-green-100 text-green-800 border-green-200'
                                  : subtask.status === 'in_progress'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200'
                                  : 'bg-gray-100 text-gray-800 border-gray-200'
                              }
                            >
                              {subtask.status.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await apiRequest('DELETE', `/api/tasks/${subtask.id}/promote-to-todo`);
                                queryClient.invalidateQueries({ queryKey: ['/api/tasks/promoted-to-todo'] });
                                toast({
                                  title: 'Removed from To-Do List',
                                  description: 'The subtask has been removed from your to-do list.',
                                });
                              } catch (error) {
                                toast({
                                  title: 'Error',
                                  description: 'Failed to remove from to-do list.',
                                  variant: 'destructive',
                                });
                              }
                            }}
                            className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                            title="Remove from To-Do List"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        {subtask.assigneeNames && subtask.assigneeNames.length > 0 && (
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            <span>{subtask.assigneeNames.join(', ')}</span>
                          </div>
                        )}
                        {subtask.dueDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(subtask.dueDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submit Item Dialog */}
      <Dialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Submit to Holding Zone</DialogTitle>
            <DialogDescription>
              Add a task, note, or idea for the team to review and track
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="item-type">Type</Label>
              <Select value={newItemType} onValueChange={(v) => setNewItemType(v as any)}>
                <SelectTrigger id="item-type" data-testid="select-new-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task-Draft</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="idea">Idea</SelectItem>
                  <SelectItem value="canvas">Canvas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Categories (Optional)</Label>
              {!isCreatingNewCategory ? (
                <div className="space-y-2">
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {categories.length === 0 ? (
                      <p className="text-sm text-gray-500">No categories yet</p>
                    ) : (
                      categories.map(cat => (
                        <div key={cat.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`new-item-cat-${cat.id}`}
                            checked={newItemCategoryIds.includes(cat.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setNewItemCategoryIds(prev => [...prev, cat.id]);
                              } else {
                                setNewItemCategoryIds(prev => prev.filter(id => id !== cat.id));
                              }
                            }}
                          />
                          <Label htmlFor={`new-item-cat-${cat.id}`} className="flex items-center gap-2 cursor-pointer text-sm">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.name}
                          </Label>
                        </div>
                      ))
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCreatingNewCategory(true)}
                    className="w-full text-[#236383] border-[#236383]"
                    type="button"
                  >
                    + Create New Category
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 p-4 border border-[#236383] rounded-lg bg-[#E6F4F6]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#236383]">Create New Category</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsCreatingNewCategory(false);
                        setNewCategoryName('');
                        setNewCategoryColor('#236383');
                      }}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-category-name" className="text-xs">Category Name</Label>
                    <Input
                      id="new-category-name"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Enter category name..."
                      className="text-sm"
                      data-testid="input-new-category-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-category-color" className="text-xs">Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="new-category-color"
                        type="color"
                        value={newCategoryColor}
                        onChange={(e) => setNewCategoryColor(e.target.value)}
                        className="w-20 h-9 cursor-pointer"
                        data-testid="input-new-category-color"
                      />
                      <Input
                        type="text"
                        value={newCategoryColor}
                        onChange={(e) => setNewCategoryColor(e.target.value)}
                        className="flex-1 text-sm"
                        placeholder="#236383"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleCreateCategory}
                    disabled={createCategoryMutation.isPending || !newCategoryName.trim()}
                    className="w-full bg-[#236383] hover:bg-[#236383] text-sm"
                    size="sm"
                    data-testid="button-create-category"
                  >
                    {createCategoryMutation.isPending ? (
                      <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Creating...</>
                    ) : (
                      'Create Category'
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="item-urgent"
                checked={newItemIsUrgent}
                onCheckedChange={(checked) => setNewItemIsUrgent(checked as boolean)}
                data-testid="checkbox-new-item-urgent"
              />
              <Label htmlFor="item-urgent" className="cursor-pointer">
                Mark as urgent
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="item-private"
                checked={newItemIsPrivate}
                onCheckedChange={(checked) => {
                  setNewItemIsPrivate(checked as boolean);
                  if (!checked) setNewItemSharedWithUserId(null);
                }}
                data-testid="checkbox-new-item-private"
              />
              <Label htmlFor="item-private" className="cursor-pointer">
                Private (only visible to you and admins)
              </Label>
            </div>
            {newItemIsPrivate && (
              <div className="space-y-1.5 pl-6">
                <Label className="text-sm text-muted-foreground">Also visible to (optional)</Label>
                <Select
                  value={newItemSharedWithUserId ?? '__none__'}
                  onValueChange={(v) => setNewItemSharedWithUserId(v === '__none__' ? null : v)}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Only me" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Only me</SelectItem>
                    {teamMembers.filter(m => m.id !== user?.id).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose one person (e.g. Christine) to also see this item. Only you and they will see it.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="item-content">Content</Label>
              <MentionTextarea
                value={newItemContent}
                onChange={setNewItemContent}
                placeholder="Describe the task, note, or idea in detail... Use @ to mention team members"
                className="min-h-[150px] text-base"
                data-testid="textarea-new-item-content"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-details">Details (Optional)</Label>
              <Textarea
                id="item-details"
                value={newItemDetails}
                onChange={(e) => setNewItemDetails(e.target.value)}
                placeholder="Add additional details..."
                className="min-h-[100px]"
                data-testid="textarea-new-item-details"
              />
            </div>

            {newItemType === 'canvas' && (
              <div className="space-y-3 rounded-lg border p-3 bg-[#F9FBFC]">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Canvas Sections</Label>
                    <p className="text-xs text-gray-500">Keep it light: Context + Working Notes by default.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addCanvasSection(setNewCanvasSections)}
                  >
                    + Add Section
                  </Button>
                </div>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {newCanvasSections.map((section, idx) => (
                    <div key={section.id} className="rounded border border-gray-200 p-3 space-y-2 bg-white">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-gray-600">Section {idx + 1}</Label>
                        <Input
                          value={section.title}
                          onChange={(e) => updateCanvasSectionTitle(setNewCanvasSections, section.id, e.target.value)}
                          placeholder="Section title"
                          className="text-sm"
                        />
                      </div>
                      <Textarea
                        value={section.cards?.[0]?.content || ''}
                        onChange={(e) => updateCanvasSectionContent(setNewCanvasSections, section.id, e.target.value)}
                        placeholder="Add notes, ideas, or context..."
                        className="min-h-[80px] text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="item-due-date">Due Date (Optional)</Label>
              <Input
                id="item-due-date"
                type="date"
                value={newItemDueDate}
                onChange={(e) => setNewItemDueDate(e.target.value)}
                data-testid="input-new-item-due-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Assign to Team Members (Optional)</Label>
              <Popover modal={true}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="button-select-assignees"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    {newItemAssignedToNames.length === 0
                      ? 'Select team members...'
                      : `${newItemAssignedToNames.length} member${newItemAssignedToNames.length > 1 ? 's' : ''} selected`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search team members..." />
                    <CommandList>
                      <CommandEmpty>No team members found.</CommandEmpty>
                      <CommandGroup>
                        {teamMembers.map((member) => {
                          const isSelected = newItemAssignedTo.includes(member.id);
                          return (
                            <CommandItem
                              key={member.id}
                              onSelect={() => {
                                if (isSelected) {
                                  // Remove from selection
                                  setNewItemAssignedTo(newItemAssignedTo.filter(id => id !== member.id));
                                  setNewItemAssignedToNames(
                                    newItemAssignedToNames.filter((_, idx) => newItemAssignedTo[idx] !== member.id)
                                  );
                                } else {
                                  // Add to selection
                                  setNewItemAssignedTo([...newItemAssignedTo, member.id]);
                                  setNewItemAssignedToNames([...newItemAssignedToNames, member.name]);
                                }
                              }}
                            >
                              <div className="flex items-center w-full">
                                <div
                                  className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary ${
                                    isSelected
                                      ? 'bg-primary text-primary-foreground'
                                      : 'opacity-50 [&_svg]:invisible'
                                  }`}
                                >
                                  <Check className="h-4 w-4" />
                                </div>
                                <User className="h-4 w-4 mr-2 text-gray-500" />
                                <span>{member.name}</span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {newItemAssignedToNames.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {newItemAssignedToNames.map((name, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => {
                          const newAssignedTo = [...newItemAssignedTo];
                          const newAssignedToNames = [...newItemAssignedToNames];
                          newAssignedTo.splice(index, 1);
                          newAssignedToNames.splice(index, 1);
                          setNewItemAssignedTo(newAssignedTo);
                          setNewItemAssignedToNames(newAssignedToNames);
                        }}
                        className="ml-1 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSubmitDialogOpen(false)}
              data-testid="button-cancel-submit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitItem}
              disabled={createItemMutation.isPending || !newItemContent.trim()}
              className="bg-[#236383] hover:bg-[#236383]"
              data-testid="button-confirm-submit"
            >
              {createItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
              ) : (
                <>Submit</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Management Dialog - Placeholder */}
      <Dialog open={isCategoryManageOpen} onOpenChange={setIsCategoryManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>
              Create and edit holding zone categories
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Category management interface coming soon...
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsCategoryManageOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Holding Zone Item</DialogTitle>
            <DialogDescription>
              Update the content and settings for this item
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-item-type">Type</Label>
              <Select value={editItemType} onValueChange={(v) => setEditItemType(v as any)}>
                <SelectTrigger id="edit-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task-Draft</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="idea">Idea</SelectItem>
                  <SelectItem value="canvas">Canvas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="edit-item-urgent"
                checked={editItemIsUrgent}
                onCheckedChange={setEditItemIsUrgent}
              />
              <Label htmlFor="edit-item-urgent" className="font-normal cursor-pointer">
                Mark as urgent
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="edit-item-private"
                checked={editItemIsPrivate}
                onCheckedChange={(checked) => {
                  setEditItemIsPrivate(checked);
                  if (!checked) setEditItemSharedWithUserId(null);
                }}
              />
              <Label htmlFor="edit-item-private" className="font-normal cursor-pointer">
                Private (only visible to you and admins)
              </Label>
            </div>
            {editItemIsPrivate && (
              <div className="space-y-1.5 pl-6">
                <Label className="text-sm text-muted-foreground">Also visible to (optional)</Label>
                <Select
                  value={editItemSharedWithUserId ?? '__none__'}
                  onValueChange={(v) => setEditItemSharedWithUserId(v === '__none__' ? null : v)}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Only me" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Only me</SelectItem>
                    {teamMembers.filter(m => m.id !== user?.id).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only you and the selected person can see this item.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="edit-item-content">Content</Label>
              <MentionTextarea
                value={editItemContent}
                onChange={setEditItemContent}
                placeholder="Describe the task, note, or idea in detail... Use @ to mention team members"
                className="min-h-[150px] text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-item-details">Details (Optional)</Label>
              <Textarea
                id="edit-item-details"
                value={editItemDetails}
                onChange={(e) => setEditItemDetails(e.target.value)}
                placeholder="Add additional details..."
                className="min-h-[100px]"
              />
            </div>

            {editItemType === 'canvas' && (
              <div className="space-y-3 rounded-lg border p-3 bg-[#F9FBFC]">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Canvas Sections</Label>
                    <p className="text-xs text-gray-500">Light structure the team can collaborate on.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addCanvasSection(setEditCanvasSections)}
                  >
                    + Add Section
                  </Button>
                </div>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {editCanvasSections.map((section, idx) => (
                    <div key={section.id} className="rounded border border-gray-200 p-3 space-y-2 bg-white">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-gray-600">Section {idx + 1}</Label>
                        <Input
                          value={section.title}
                          onChange={(e) => updateCanvasSectionTitle(setEditCanvasSections, section.id, e.target.value)}
                          placeholder="Section title"
                          className="text-sm"
                        />
                      </div>
                      <Textarea
                        value={section.cards?.[0]?.content || ''}
                        onChange={(e) => updateCanvasSectionContent(setEditCanvasSections, section.id, e.target.value)}
                        placeholder="Add notes, ideas, or context..."
                        className="min-h-[80px] text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="edit-item-due-date">Due Date (Optional)</Label>
              <Input
                id="edit-item-due-date"
                type="date"
                value={editItemDueDate}
                onChange={(e) => setEditItemDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Categories (Optional)</Label>
              {isEditCreatingNewCategory ? (
                <div className="space-y-3 p-3 border rounded-lg bg-gray-50">
                  <div className="space-y-2">
                    <Label htmlFor="edit-new-category-name">New Category Name</Label>
                    <Input
                      id="edit-new-category-name"
                      value={editNewCategoryName}
                      onChange={(e) => setEditNewCategoryName(e.target.value)}
                      placeholder="Enter category name..."
                      data-testid="input-edit-new-category-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-new-category-color">Category Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="edit-new-category-color"
                        type="color"
                        value={editNewCategoryColor}
                        onChange={(e) => setEditNewCategoryColor(e.target.value)}
                        className="w-16 h-10 p-1 cursor-pointer"
                        data-testid="input-edit-new-category-color"
                      />
                      <Input
                        value={editNewCategoryColor}
                        onChange={(e) => setEditNewCategoryColor(e.target.value)}
                        placeholder="#236383"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditCreatingNewCategory(false);
                        setEditNewCategoryName('');
                        setEditNewCategoryColor('#236383');
                      }}
                      data-testid="button-edit-cancel-new-category"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (editNewCategoryName.trim()) {
                          createCategoryMutation.mutate(
                            { name: editNewCategoryName.trim(), color: editNewCategoryColor },
                            {
                              onSuccess: (newCategory: HoldingZoneCategory) => {
                                setEditItemCategoryIds(prev => [...prev, newCategory.id]);
                                setIsEditCreatingNewCategory(false);
                                setEditNewCategoryName('');
                                setEditNewCategoryColor('#236383');
                              }
                            }
                          );
                        }
                      }}
                      disabled={!editNewCategoryName.trim() || createCategoryMutation.isPending}
                      className="bg-[#236383] hover:bg-[#236383]"
                      data-testid="button-edit-create-category"
                    >
                      {createCategoryMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Creating...</>
                      ) : (
                        'Create Category'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {categories.length === 0 ? (
                      <p className="text-sm text-gray-500">No categories yet</p>
                    ) : (
                      categories.map(cat => (
                        <div key={cat.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`edit-item-cat-${cat.id}`}
                            checked={editItemCategoryIds.includes(cat.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setEditItemCategoryIds(prev => [...prev, cat.id]);
                              } else {
                                setEditItemCategoryIds(prev => prev.filter(id => id !== cat.id));
                              }
                            }}
                          />
                          <Label htmlFor={`edit-item-cat-${cat.id}`} className="flex items-center gap-2 cursor-pointer text-sm">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.name}
                          </Label>
                        </div>
                      ))
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditCreatingNewCategory(true)}
                    className="w-full text-[#236383] border-[#236383]"
                    type="button"
                  >
                    + Create New Category
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setItemToEdit(null);
                setEditItemContent('');
                setEditItemType('task');
                setEditItemCategoryIds([]);
                setEditItemIsUrgent(false);
                setEditItemIsPrivate(false);
                setEditItemSharedWithUserId(null);
                setEditItemDetails('');
                setEditItemDueDate('');
                setEditCanvasSections([]);
                setIsEditCreatingNewCategory(false);
                setEditNewCategoryName('');
                setEditNewCategoryColor('#236383');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (itemToEdit) {
                  editItemMutation.mutate({
                    id: itemToEdit.id,
                    content: editItemContent.trim(),
                    type: editItemType,
                    categoryIds: editItemCategoryIds,
                    isUrgent: editItemIsUrgent,
                    isPrivate: editItemIsPrivate,
                    sharedWithUserId: editItemIsPrivate ? editItemSharedWithUserId : null,
                    details: editItemDetails.trim() || null,
                    dueDate: editItemDueDate ? new Date(editItemDueDate).toISOString() : null,
                    isCanvas: editItemType === 'canvas',
                    canvasSections: editItemType === 'canvas' ? editCanvasSections : null,
                    canvasStatus: editItemType === 'canvas'
                      ? (itemToEdit.canvasStatus as 'draft' | 'in_review' | 'published' | 'archived' | undefined) || 'draft'
                      : undefined,
                  });
                }
              }}
              disabled={editItemMutation.isPending || !editItemContent.trim()}
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {editItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                <>Save Changes</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign to Team Member Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Assign to Team Member</DialogTitle>
            <DialogDescription>
              Select a team member to assign this item to
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {teamMembers.map(member => (
                <Button
                  key={member.id}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleAssignFromDialog(member.id)}
                >
                  <User className="h-4 w-4 mr-2" />
                  {member.name}
                </Button>
              ))}
              {teamMembers.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No team members available</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setAssignDialogOpen(false);
              setItemToAssign(null);
            }}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to To-Do List Dialog */}
      <Dialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Move to To-Do List</DialogTitle>
            <DialogDescription>
              Move this item to the To-Do List where you can assign it to team members and set a due date
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {itemToPromote && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Item Content:
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                  {itemToPromote.content}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="promote-assignees">Assign to Team Members (Optional)</Label>
              <Popover modal={true}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    id="promote-assignees"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    {promoteAssignedToNames.length > 0
                      ? `${promoteAssignedToNames.length} member${promoteAssignedToNames.length > 1 ? 's' : ''} selected`
                      : 'Select team members...'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search team members..." />
                    <CommandList>
                      <CommandEmpty>No team members found.</CommandEmpty>
                      <CommandGroup>
                        {teamMembers.map((member) => {
                          const isSelected = promoteAssignedTo.includes(member.id);
                          return (
                            <CommandItem
                              key={member.id}
                              onSelect={() => {
                                if (isSelected) {
                                  setPromoteAssignedTo(promoteAssignedTo.filter(id => id !== member.id));
                                  setPromoteAssignedToNames(promoteAssignedToNames.filter(name => name !== member.name));
                                } else {
                                  setPromoteAssignedTo([...promoteAssignedTo, member.id]);
                                  setPromoteAssignedToNames([...promoteAssignedToNames, member.name]);
                                }
                              }}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <Checkbox checked={isSelected} />
                                <User className="h-4 w-4 mr-2" />
                                <span>{member.name}</span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {promoteAssignedToNames.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {promoteAssignedToNames.map((name, idx) => (
                    <Badge key={idx} variant="secondary" className="gap-1">
                      {name}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => {
                          const member = teamMembers.find(m => m.name === name);
                          if (member) {
                            setPromoteAssignedTo(promoteAssignedTo.filter(id => id !== member.id));
                            setPromoteAssignedToNames(promoteAssignedToNames.filter(n => n !== name));
                          }
                        }}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="promote-due-date">Due Date (Optional)</Label>
              <Input
                id="promote-due-date"
                type="date"
                value={promoteDueDate}
                onChange={(e) => setPromoteDueDate(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> This will move the item to the To-Do List section where it can be assigned to team members and tracked with due dates.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPromoteDialogOpen(false);
                setItemToPromote(null);
                setPromotePriority('medium');
                setPromoteAssignedTo([]);
                setPromoteAssignedToNames([]);
                setPromoteDueDate('');
              }}
              data-testid="button-cancel-promote"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (itemToPromote) {
                  promoteToTaskMutation.mutate({
                    id: itemToPromote.id,
                    assignedTo: promoteAssignedTo.length > 0 ? promoteAssignedTo : undefined,
                    assignedToNames: promoteAssignedToNames.length > 0 ? promoteAssignedToNames : undefined,
                    dueDate: promoteDueDate || null,
                  });
                }
              }}
              disabled={promoteToTaskMutation.isPending || !itemToPromote}
              className="bg-[#236383] hover:bg-[#236383]"
              data-testid="button-confirm-promote"
            >
              {promoteToTaskMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Moving...</>
              ) : (
                <>Move to To-Do List</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade to Project Dialog */}
      <Dialog open={upgradeToProjectDialogOpen} onOpenChange={setUpgradeToProjectDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-[#236383]" />
              Upgrade to Project
            </DialogTitle>
            <DialogDescription>
              Convert this task-draft into a full project with tracking and milestones
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {itemToUpgrade && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Original Task-Draft:
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                  {itemToUpgrade.content}
                </p>
                {itemToUpgrade.details && (
                  <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Details:</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                      {itemToUpgrade.details}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="upgrade-title">Project Title</Label>
              <Input
                id="upgrade-title"
                value={upgradeProjectTitle}
                onChange={(e) => setUpgradeProjectTitle(e.target.value)}
                placeholder="Enter project title..."
                data-testid="input-upgrade-title"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="upgrade-priority">Priority</Label>
                <Select value={upgradeProjectPriority} onValueChange={(v) => setUpgradeProjectPriority(v as any)}>
                  <SelectTrigger id="upgrade-priority" data-testid="select-upgrade-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="upgrade-category">Category</Label>
                <Select value={upgradeProjectCategory} onValueChange={setUpgradeProjectCategory}>
                  <SelectTrigger id="upgrade-category" data-testid="select-upgrade-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technology">💻 Technology</SelectItem>
                    <SelectItem value="events">📅 Events</SelectItem>
                    <SelectItem value="grants">💰 Grants</SelectItem>
                    <SelectItem value="outreach">🤝 Outreach</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-800 dark:text-green-200">
                <strong>What happens next:</strong> A new project will be created with full tracking capabilities. 
                The task-draft will be marked as done, and you can manage the project from the Projects section.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUpgradeToProjectDialogOpen(false);
                setItemToUpgrade(null);
                setUpgradeProjectTitle('');
                setUpgradeProjectPriority('medium');
                setUpgradeProjectCategory('technology');
              }}
              data-testid="button-cancel-upgrade"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (itemToUpgrade && upgradeProjectTitle.trim()) {
                  upgradeToProjectMutation.mutate({
                    holdingZoneItemId: itemToUpgrade.id,
                    title: upgradeProjectTitle.trim(),
                    priority: upgradeProjectPriority,
                    category: upgradeProjectCategory,
                    description: itemToUpgrade.details || '',
                    dueDate: itemToUpgrade.dueDate ? (typeof itemToUpgrade.dueDate === 'string' ? itemToUpgrade.dueDate : new Date(itemToUpgrade.dueDate).toISOString()) : null,
                  });
                }
              }}
              disabled={upgradeToProjectMutation.isPending || !itemToUpgrade || !upgradeProjectTitle.trim()}
              className="bg-[#236383] hover:bg-[#236383]"
              data-testid="button-confirm-upgrade"
            >
              {upgradeToProjectMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating Project...</>
              ) : (
                <>
                  <FolderKanban className="h-4 w-4 mr-2" />
                  Upgrade to Project
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to Parent Item Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="h-5 w-5 text-[#236383]" />
              {itemToLink?.parentItemId ? 'Change or Remove Link' : 'Link to Parent Item'}
            </DialogTitle>
            <DialogDescription>
              {itemToLink?.parentItemId
                ? 'Change the parent item or remove the link entirely.'
                : 'Select a parent item to nest this item under. This helps organize related items together.'}
            </DialogDescription>
          </DialogHeader>

          {itemToLink && (
            <div className="space-y-4 py-4">
              {/* Current Item Preview */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">This item:</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 line-clamp-2">
                  {itemToLink.content}
                </p>
              </div>

              {/* Parent Selection */}
              <div className="space-y-2">
                <Label>Select Parent Item</Label>
                <div className="max-h-[250px] overflow-y-auto space-y-2 border rounded-lg p-2">
                  {/* Option to remove link */}
                  {itemToLink.parentItemId && (
                    <Button
                      variant={selectedParentId === null ? 'default' : 'outline'}
                      className={`w-full justify-start text-left h-auto py-2 px-3 ${
                        selectedParentId === null ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : ''
                      }`}
                      onClick={() => setSelectedParentId(null)}
                    >
                      <Unlink className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span className="truncate">Remove link (make standalone)</span>
                    </Button>
                  )}

                  {/* Available parent items - exclude current item and its children */}
                  {items
                    .filter(item =>
                      item.id !== itemToLink.id && // Can't link to self
                      item.parentItemId !== itemToLink.id && // Can't link to own children
                      item.status !== 'done' // Don't show completed items
                    )
                    .map(item => (
                      <Button
                        key={item.id}
                        variant={selectedParentId === item.id ? 'default' : 'outline'}
                        className={`w-full justify-start text-left h-auto py-2 px-3 ${
                          selectedParentId === item.id ? 'bg-[#236383] text-white' : ''
                        }`}
                        onClick={() => setSelectedParentId(item.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {item.type === 'task' && <ListTodo className="h-4 w-4 flex-shrink-0" />}
                          {item.type === 'note' && <StickyNote className="h-4 w-4 flex-shrink-0" />}
                          {item.type === 'idea' && <Lightbulb className="h-4 w-4 flex-shrink-0" />}
                          {item.type === 'canvas' && <LayoutTemplate className="h-4 w-4 flex-shrink-0" />}
                          <span className="truncate">{item.content}</span>
                          {item.childCount != null && item.childCount > 0 && (
                            <Badge variant="secondary" className="ml-auto text-xs flex-shrink-0">
                              {item.childCount} linked
                            </Badge>
                          )}
                        </div>
                      </Button>
                    ))}

                  {items.filter(item =>
                    item.id !== itemToLink.id &&
                    item.parentItemId !== itemToLink.id &&
                    item.status !== 'done'
                  ).length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No available items to link to
                    </p>
                  )}
                </div>
              </div>

              {/* Selection indicator */}
              {selectedParentId !== null && selectedParentId !== itemToLink.parentItemId && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    <strong>Will link to:</strong>{' '}
                    {items.find(i => i.id === selectedParentId)?.content || 'Unknown'}
                  </p>
                </div>
              )}

              {selectedParentId === null && itemToLink.parentItemId && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    <strong>Will remove link</strong> - Item will become standalone
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLinkDialogOpen(false);
                setItemToLink(null);
                setSelectedParentId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (itemToLink) {
                  linkItemMutation.mutate({
                    id: itemToLink.id,
                    parentItemId: selectedParentId,
                  });
                }
              }}
              disabled={
                linkItemMutation.isPending ||
                (selectedParentId === itemToLink?.parentItemId) // No change
              }
              className="bg-[#236383] hover:bg-[#236383]"
            >
              {linkItemMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
              ) : itemToLink?.parentItemId && selectedParentId === null ? (
                <>
                  <Unlink className="h-4 w-4 mr-2" />
                  Remove Link
                </>
              ) : (
                <>
                  <Link className="h-4 w-4 mr-2" />
                  Link Item
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overdue Item Action Dialog */}
      <Dialog open={overdueActionDialogOpen} onOpenChange={setOverdueActionDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              Overdue Item
            </DialogTitle>
            <DialogDescription>
              This item's due date has passed. What would you like to do with it?
            </DialogDescription>
          </DialogHeader>

          {overdueItem && (
            <div className="space-y-4 py-4">
              {/* Item Preview */}
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Item Content:
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap mb-3">
                  {overdueItem.content}
                </p>
                <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
                  <Calendar className="h-3 w-3" />
                  <span>
                    Due: {overdueItem.dueDate ? formatDate(overdueItem.dueDate) : 'No date'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                {/* Mark Complete */}
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 h-auto py-3 px-4"
                  onClick={() => {
                    if (overdueItem) {
                      updateItemMutation.mutate(
                        { id: overdueItem.id, status: 'done', completedAt: new Date().toISOString() },
                        {
                          onSuccess: () => {
                            setOverdueActionDialogOpen(false);
                            setOverdueItem(null);
                            toast({
                              title: 'Item completed',
                              description: 'The item has been marked as done',
                            });
                          },
                        }
                      );
                    }
                  }}
                  disabled={updateItemMutation.isPending}
                >
                  <div className="bg-green-100 dark:bg-green-900 rounded-full p-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Mark as Complete</p>
                    <p className="text-xs text-gray-500">The task was finished, just past due</p>
                  </div>
                </Button>

                {/* Postpone */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-100 dark:bg-blue-900 rounded-full p-2">
                      <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Postpone</p>
                      <p className="text-xs text-gray-500">Set a new due date</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={postponeDate}
                      onChange={(e) => setPostponeDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="flex-1"
                    />
                    <Button
                      variant="default"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        if (overdueItem && postponeDate) {
                          editItemMutation.mutate(
                            {
                              id: overdueItem.id,
                              content: overdueItem.content,
                              type: overdueItem.type,
                              categoryIds: overdueItem.categories?.map(c => c.id) || [],
                              isUrgent: overdueItem.isUrgent,
                              isPrivate: overdueItem.isPrivate,
                              sharedWithUserId: overdueItem.sharedWithUserId ?? null,
                              details: overdueItem.details,
                              dueDate: new Date(postponeDate).toISOString(),
                            },
                            {
                              onSuccess: () => {
                                setOverdueActionDialogOpen(false);
                                setOverdueItem(null);
                                setPostponeDate('');
                                toast({
                                  title: 'Due date updated',
                                  description: `New due date: ${formatDate(postponeDate)}`,
                                });
                              },
                            }
                          );
                        }
                      }}
                      disabled={!postponeDate || editItemMutation.isPending}
                    >
                      {editItemMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Update'
                      )}
                    </Button>
                  </div>
                </div>

                {/* Transform into New Task */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-100 dark:bg-purple-900 rounded-full p-2">
                      <Copy className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Transform into New Task</p>
                      <p className="text-xs text-gray-500">Create a new task if requirements changed, then archive this one</p>
                    </div>
                  </div>
                  <Textarea
                    value={transformContent}
                    onChange={(e) => setTransformContent(e.target.value)}
                    placeholder="Updated task description..."
                    className="min-h-[80px]"
                  />
                  <Button
                    variant="default"
                    className="w-full bg-purple-600 hover:bg-purple-700"
                    onClick={() => {
                      if (overdueItem && transformContent.trim()) {
                        // Create new task
                        createItemMutation.mutate(
                          {
                            content: transformContent.trim(),
                            type: overdueItem.type,
                            categoryIds: overdueItem.categories?.map(c => c.id) || null,
                            isUrgent: overdueItem.isUrgent,
                            isPrivate: overdueItem.isPrivate,
                            sharedWithUserId: overdueItem.sharedWithUserId ?? null,
                            details: overdueItem.details,
                            dueDate: null, // New task starts without a due date
                            assignedTo: overdueItem.assignedTo,
                            assignedToNames: overdueItem.assignedToNames,
                          },
                          {
                            onSuccess: () => {
                              // Mark old item as done
                              updateItemMutation.mutate(
                                { id: overdueItem.id, status: 'done', completedAt: new Date().toISOString() },
                                {
                                  onSuccess: () => {
                                    setOverdueActionDialogOpen(false);
                                    setOverdueItem(null);
                                    setTransformContent('');
                                    toast({
                                      title: 'Task transformed',
                                      description: 'New task created and old task archived',
                                    });
                                  },
                                }
                              );
                            },
                          }
                        );
                      }
                    }}
                    disabled={!transformContent.trim() || createItemMutation.isPending || updateItemMutation.isPending}
                  >
                    {createItemMutation.isPending || updateItemMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Create New Task & Archive Old
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOverdueActionDialogOpen(false);
                setOverdueItem(null);
                setPostponeDate('');
                setTransformContent('');
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assistant */}
      <FloatingAIChat
        contextType="holding-zone"
        title="Holding Zone Assistant"
        subtitle="Ask about your ideas and tasks"
        contextData={{
          currentView: activeTab,
          summaryStats: {
            totalItems: items.length,
            openItems: items.filter(i => i.status === 'open').length,
            claimedItems: items.filter(i => i.status === 'claimed').length,
            doneItems: items.filter(i => i.status === 'done').length,
            urgentItems: items.filter(i => i.isUrgent).length,
            tasks: items.filter(i => i.type === 'task').length,
            notes: items.filter(i => i.type === 'note').length,
            ideas: items.filter(i => i.type === 'idea').length,
          },
        }}
        getFullContext={() => ({
          rawData: items.map(item => ({
            id: item.id,
            content: item.content,
            type: item.type,
            status: item.status,
            isUrgent: item.isUrgent,
            categoryId: item.categoryId,
            category: item.category?.name || null,
            createdByName: item.createdByName,
            assignedToNames: item.assignedToNames,
            dueDate: item.dueDate,
            commentCount: item.commentCount,
          })),
          selectedItem: itemToEdit ? {
            content: itemToEdit.content,
            type: itemToEdit.type,
            status: itemToEdit.status,
            isUrgent: itemToEdit.isUrgent,
            categoryId: itemToEdit.categoryId,
          } : undefined,
        })}
        suggestedQuestions={[
          "What items need attention?",
          "How many urgent items are there?",
          "Show me items by category",
          "What tasks are open?",
          "What ideas have been submitted?",
          "What items are due soon?",
        ]}
      />
    </div>
  );
}
