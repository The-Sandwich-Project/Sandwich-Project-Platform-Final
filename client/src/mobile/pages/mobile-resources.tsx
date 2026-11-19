import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  FileText,
  Link as LinkIcon,
  ExternalLink,
  Star,
  StarOff,
  FolderOpen,
  Eye,
  Copy,
  Check,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { PullToRefresh } from '../components/pull-to-refresh';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { copyToClipboard, openExternalUrl } from '../lib/native-actions';

interface Resource {
  id: number;
  title: string;
  description?: string;
  type: 'file' | 'link' | 'google_drive';
  category: string;
  url?: string;
  documentId?: string;
  icon?: string;
  isPinnedGlobal?: boolean;
  accessCount?: number;
  tags?: { id: number; name: string; color?: string }[];
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'Legal & Governance', label: 'Legal' },
  { id: 'Brand & Marketing', label: 'Marketing' },
  { id: 'Operations & Safety', label: 'Operations' },
  { id: 'Forms & Templates', label: 'Forms' },
  { id: 'Toolkit', label: 'Toolkit' },
];

/**
 * Mobile resources screen
 */
export function MobileResources() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Fetch resources
  const { data: resources = [], isLoading, refetch } = useQuery<Resource[]>({
    queryKey: ['/api/resources', { sort: 'smart', category: selectedCategory !== 'all' ? selectedCategory : undefined }],
    staleTime: 60000,
  });

  // Fetch favorites
  const { data: favorites = [] } = useQuery<number[]>({
    queryKey: ['/api/resources/user/favorites'],
    staleTime: 60000,
    select: (data: any) => data?.map((f: any) => f.resourceId || f.id) || [],
  });

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (resourceId: number) => {
      return apiRequest('POST', `/api/resources/${resourceId}/favorite`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/resources/user/favorites'] });
    },
  });

  // Track access mutation
  const trackAccessMutation = useMutation({
    mutationFn: async (resourceId: number) => {
      return apiRequest('POST', `/api/resources/${resourceId}/access`);
    },
  });

  // Filter resources
  const filteredResources = resources.filter((resource) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        resource.title.toLowerCase().includes(query) ||
        resource.description?.toLowerCase().includes(query) ||
        resource.tags?.some((t) => t.name.toLowerCase().includes(query))
      );
    }
    return true;
  });

  // Open resource
  const openResource = (resource: Resource) => {
    trackAccessMutation.mutate(resource.id);

    let url = resource.url;
    if (resource.type === 'google_drive' && resource.documentId) {
      url = `https://docs.google.com/document/d/${resource.documentId}/view`;
    }

    if (url) {
      openExternalUrl(url);
    }
  };

  // Copy link
  const copyLink = (resource: Resource) => {
    let url = resource.url;
    if (resource.type === 'google_drive' && resource.documentId) {
      url = `https://docs.google.com/document/d/${resource.documentId}/view`;
    }

    if (url) {
      copyToClipboard(url)
        .then(() => {
          setCopiedId(resource.id);
          toast({ title: 'Link copied' });
          setTimeout(() => setCopiedId(null), 2000);
        })
        .catch(() => {
          toast({ title: 'Failed to copy link', variant: 'destructive' });
        });
    }
  };

  const isFavorite = (id: number) => favorites.includes(id);

  return (
    <MobileShell title="Resources" showBack showNav>
      <div className="flex flex-col h-full">
        {/* Search and filters */}
        <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 p-4 space-y-3 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search resources..."
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

          {/* Category filters */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap",
                  "transition-colors",
                  selectedCategory === cat.id
                    ? "bg-brand-primary text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Resources list */}
        <PullToRefresh onRefresh={async () => { await refetch(); }} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              ))
            ) : filteredResources.length === 0 ? (
              <div className="text-center py-12">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-500 dark:text-slate-400">No resources found</p>
              </div>
            ) : (
              filteredResources.map((resource) => (
                <div
                  key={resource.id}
                  className={cn(
                    "bg-white dark:bg-slate-800 rounded-xl shadow-sm",
                    "border border-slate-200 dark:border-slate-700"
                  )}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                        resource.type === 'google_drive' ? "bg-blue-50 dark:bg-blue-900/20" :
                        resource.type === 'link' ? "bg-green-50 dark:bg-green-900/20" :
                        "bg-slate-50 dark:bg-slate-700"
                      )}>
                        {resource.type === 'link' ? (
                          <LinkIcon className="w-5 h-5 text-green-500" />
                        ) : (
                          <FileText className={cn(
                            "w-5 h-5",
                            resource.type === 'google_drive' ? "text-blue-500" : "text-slate-500"
                          )} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-slate-900 dark:text-slate-100 line-clamp-1">
                          {resource.title}
                        </h3>
                        {resource.description && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                            {resource.description}
                          </p>
                        )}

                        {/* Tags */}
                        {resource.tags && resource.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {resource.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag.id}
                                className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Stats */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {resource.accessCount || 0}
                          </span>
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">
                            {resource.category}
                          </span>
                        </div>
                      </div>

                      {/* Favorite button */}
                      <button
                        onClick={() => toggleFavoriteMutation.mutate(resource.id)}
                        className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {isFavorite(resource.id) ? (
                          <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                        ) : (
                          <StarOff className="w-5 h-5 text-slate-400" />
                        )}
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                      <button
                        onClick={() => openResource(resource)}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg",
                          "bg-brand-primary text-white text-sm font-medium"
                        )}
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open
                      </button>
                      <button
                        onClick={() => copyLink(resource)}
                        className={cn(
                          "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg",
                          "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium"
                        )}
                      >
                        {copiedId === resource.id ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </PullToRefresh>
      </div>
    </MobileShell>
  );
}

export default MobileResources;
