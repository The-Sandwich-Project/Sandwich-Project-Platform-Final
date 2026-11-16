import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Check,
  Clock,
  AlertCircle,
  MessageSquare,
  Heart,
  StickyNote,
  ListTodo,
  Lightbulb,
  MoreVertical,
  Trash2,
  Edit2,
  ArrowUpCircle,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { PullToRefresh } from '../components/pull-to-refresh';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { usePageSession } from '@/hooks/usePageSession';
type ItemType = 'task' | 'note' | 'idea';
type TabFilter = 'all' | 'tasks' | 'notes';

interface HoldingZoneItem {
  id: number;
  content: string;
  type: ItemType;
  status: string;
  category?: string;
  urgent?: boolean;
  details?: string;
  dueDate?: string;
  assignedTo?: { id: number; name: string }[];
  likeCount?: number;
  commentCount?: number;
  createdAt: string;
  createdBy?: { id: number; name: string };
}

/**
 * Mobile holding zone screen - task drafts, notes, and ideas
 */
export function MobileHoldingZone() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Holding Zone',
  });

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showActions, setShowActions] = useState<number | null>(null);

  // Close actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowActions(null);
      }
    };

    if (showActions !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showActions]);

  // Fetch holding zone items
  const { data: items = [], isLoading, refetch } = useQuery<HoldingZoneItem[]>({
    queryKey: ['/api/team-board'],
    staleTime: 30000,
  });

  // Mark item as done mutation
  const markDoneMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('PATCH', `/api/team-board/${id}`, { status: 'done' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({ title: 'Item marked as done' });
    },
  });

  // Delete item mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/team-board/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team-board'] });
      toast({ title: 'Item deleted' });
    },
  });

  // Filter items
  const filteredItems = items
    .filter((item) => {
      // Tab filter
      if (activeTab === 'tasks' && item.type !== 'task') return false;
      if (activeTab === 'notes' && item.type === 'task') return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.content.toLowerCase().includes(query) ||
          item.details?.toLowerCase().includes(query) ||
          item.category?.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .filter((item) => item.status !== 'done') // Hide completed items
    .sort((a, b) => {
      // Urgent first, then by date
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const getTypeIcon = (type: ItemType) => {
    switch (type) {
      case 'task': return ListTodo;
      case 'note': return StickyNote;
      case 'idea': return Lightbulb;
      default: return StickyNote;
    }
  };

  const getTypeColor = (type: ItemType) => {
    switch (type) {
      case 'task': return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'note': return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
      case 'idea': return 'text-purple-500 bg-purple-50 dark:bg-purple-900/20';
      default: return 'text-slate-500 bg-slate-50 dark:bg-slate-900/20';
    }
  };

  return (
    <MobileShell title="Holding Zone" showNav>
      <div className="flex flex-col h-full">
        {/* Search bar */}
        <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 p-4 space-y-3 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full pl-10 pr-4 py-3 rounded-xl",
                "bg-white dark:bg-slate-800",
                "border border-slate-200 dark:border-slate-700",
                "text-slate-900 dark:text-slate-100",
                "placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              )}
            />
          </div>

          {/* Tab filters */}
          <div className="flex gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'tasks', label: 'Tasks' },
              { id: 'notes', label: 'Notes & Ideas' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabFilter)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium",
                  "transition-colors",
                  activeTab === tab.id
                    ? "bg-brand-primary text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Items list */}
        <PullToRefresh onRefresh={async () => { await refetch(); }} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              ))
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12">
                <StickyNote className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-500 dark:text-slate-400">No items found</p>
                <button
                  onClick={() => navigate('/holding-zone/new')}
                  className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-full font-medium"
                >
                  Add an Item
                </button>
              </div>
            ) : (
              filteredItems.map((item) => {
                const TypeIcon = getTypeIcon(item.type);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-white dark:bg-slate-800 rounded-xl shadow-sm",
                      "border",
                      item.urgent
                        ? "border-red-300 dark:border-red-700"
                        : "border-slate-200 dark:border-slate-700"
                    )}
                  >
                    <div className="p-4">
                      {/* Header */}
                      <div className="flex items-start gap-3">
                        {/* Type icon */}
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", getTypeColor(item.type))}>
                          <TypeIcon className="w-4 h-4" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-slate-900 dark:text-slate-100 line-clamp-2">
                              {item.content}
                            </p>
                            {item.urgent && (
                              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                            )}
                          </div>

                          {/* Category and due date */}
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {item.category && (
                              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">
                                {item.category}
                              </span>
                            )}
                            {item.dueDate && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(item.dueDate), { addSuffix: true })}
                              </span>
                            )}
                          </div>

                          {/* Details preview */}
                          {item.details && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">
                              {item.details}
                            </p>
                          )}

                          {/* Stats and assignees */}
                          <div className="flex items-center gap-4 mt-3 text-sm text-slate-500 dark:text-slate-400">
                            {(item.likeCount ?? 0) > 0 && (
                              <span className="flex items-center gap-1">
                                <Heart className="w-3.5 h-3.5" />
                                {item.likeCount}
                              </span>
                            )}
                            {(item.commentCount ?? 0) > 0 && (
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3.5 h-3.5" />
                                {item.commentCount}
                              </span>
                            )}
                            {item.assignedTo && item.assignedTo.length > 0 && (
                              <span className="text-xs">
                                {item.assignedTo.map(a => a.name.split(' ')[0]).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions menu */}
                        <div className="relative" ref={showActions === item.id ? actionsMenuRef : null}>
                          <button
                            onClick={() => setShowActions(showActions === item.id ? null : item.id)}
                            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <MoreVertical className="w-4 h-4 text-slate-400" />
                          </button>

                          {showActions === item.id && (
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-10 overflow-hidden">
                              <button
                                onClick={() => {
                                  markDoneMutation.mutate(item.id);
                                  setShowActions(null);
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                              >
                                <Check className="w-4 h-4" />
                                Mark Done
                              </button>
                              <button
                                onClick={() => {
                                  navigate(`/holding-zone/${item.id}/edit`);
                                  setShowActions(null);
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                              >
                                <Edit2 className="w-4 h-4" />
                                Edit
                              </button>
                              {item.type === 'task' && (
                                <button
                                  onClick={() => {
                                    // Promote to project logic would go here
                                    toast({ title: 'Promote to project coming soon' });
                                    setShowActions(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                  <ArrowUpCircle className="w-4 h-4" />
                                  Promote
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  deleteMutation.mutate(item.id);
                                  setShowActions(null);
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </PullToRefresh>

        {/* Floating action button */}
        <button
          onClick={() => navigate('/holding-zone/new')}
          className={cn(
            "fixed right-4 bottom-20 z-40",
            "w-14 h-14 rounded-full",
            "bg-brand-primary text-white shadow-lg",
            "flex items-center justify-center",
            "active:scale-95 transition-transform"
          )}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Add new item"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>
    </MobileShell>
  );
}

export default MobileHoldingZone;
