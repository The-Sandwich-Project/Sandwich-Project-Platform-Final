import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Filter,
  ChevronRight,
  Sandwich,
  MapPin,
  User,
  Check,
  Calendar,
  Camera,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format, isToday, isThisWeek, isThisMonth, parseISO } from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
type DateFilter = 'today' | 'week' | 'month' | 'all';

/**
 * Mobile collections screen - view and log collections
 */
export function MobileCollections() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Collections',
  });

  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');

  // Fetch recent collections - API returns { collections: [...], pagination: {...} }
  const { data: collectionsResponse, isLoading } = useQuery<{ collections: any[], pagination: any }>({
    queryKey: ['/api/sandwich-collections?limit=100'],
    staleTime: 30000,
  });

  // Filter collections based on search and date filter
  const filteredCollections = (collectionsResponse?.collections || []).filter((c: any) => {
    // Search filter - use actual field names from API
    const matchesSearch = !searchQuery ||
      c.hostName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.createdByName?.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    // Date filter - use collectionDate field
    if (dateFilter === 'all') return true;
    if (!c.collectionDate) return false;

    const collectionDate = typeof c.collectionDate === 'string' ? parseISO(c.collectionDate) : new Date(c.collectionDate);

    switch (dateFilter) {
      case 'today':
        return isToday(collectionDate);
      case 'week':
        return isThisWeek(collectionDate);
      case 'month':
        return isThisMonth(collectionDate);
      default:
        return true;
    }
  });

  return (
    <MobileShell title="Collections" showNav>
      <div className="flex flex-col h-full">
        {/* Search and filter bar */}
        <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 p-4 space-y-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search collections..."
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
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "p-3 rounded-xl border",
                showFilters
                  ? "bg-brand-primary border-brand-primary text-white"
                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              )}
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>

          {/* Quick date filters */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {([
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
              { id: 'all', label: 'All Time' },
            ] as const).map((filter) => (
              <button
                key={filter.id}
                onClick={() => setDateFilter(filter.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap",
                  "transition-colors",
                  dateFilter === filter.id
                    ? "bg-brand-primary text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Collections list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            // Loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
              </div>
            ))
          ) : filteredCollections.length === 0 ? (
            <div className="text-center py-12">
              <Sandwich className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 dark:text-slate-400">No collections found</p>
              <button
                onClick={() => navigate('/collections/new')}
                className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-full font-medium"
              >
                Log a Collection
              </button>
            </div>
          ) : (
            filteredCollections.map((collection: any) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                onClick={() => navigate(`/collections/${collection.id}`)}
              />
            ))
          )}
        </div>

        {/* Floating action buttons */}
        <div className="fixed right-4 bottom-20 z-40 flex flex-col gap-3" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          {/* Photo scanner button */}
          <button
            onClick={() => navigate('/m/photo-scanner')}
            className={cn(
              "w-12 h-12 rounded-full",
              "bg-white border-2 border-brand-primary text-brand-primary shadow-lg",
              "flex items-center justify-center",
              "active:scale-95 transition-transform"
            )}
            aria-label="Scan sign-in sheet"
          >
            <Camera className="w-5 h-5" />
          </button>
          {/* Add collection button */}
          <button
            onClick={() => navigate('/collections/new')}
            className={cn(
              "w-14 h-14 rounded-full",
              "bg-brand-primary text-white shadow-lg",
              "flex items-center justify-center",
              "active:scale-95 transition-transform"
            )}
            aria-label="Log new collection"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>
    </MobileShell>
  );
}

function CollectionCard({
  collection,
  onClick,
}: {
  collection: any;
  onClick: () => void;
}) {
  // Calculate total sandwiches including groups
  const individualCount = collection.individualSandwiches || 0;
  let groupCount = 0;
  if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
    groupCount = collection.groupCollections.reduce((sum: number, g: any) => sum + (g.count || 0), 0);
  } else {
    groupCount = (collection.group1Count || 0) + (collection.group2Count || 0);
  }
  const totalCount = individualCount + groupCount;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full bg-white dark:bg-slate-800 rounded-xl p-4",
        "border border-slate-200 dark:border-slate-700 shadow-sm",
        "text-left active:scale-[0.99] transition-transform"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Host name */}
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
              {collection.hostName || 'Unknown Host'}
            </span>
          </div>

          {/* Submitted by and count */}
          <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              <span>{collection.createdByName || 'Unknown'}</span>
            </div>
            <div className="flex items-center gap-1">
              <Sandwich className="w-3.5 h-3.5" />
              <span>{totalCount.toLocaleString()} sandwiches</span>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
            <Calendar className="w-3 h-3" />
            <span>
              {collection.collectionDate
                ? format(parseISO(collection.collectionDate), 'MMM d, yyyy')
                : 'No date'}
            </span>
          </div>
        </div>

        {/* Arrow indicator */}
        <div className="flex items-center gap-2">
          <ChevronRight className="w-5 h-5 text-slate-400" />
        </div>
      </div>
    </button>
  );
}

export default MobileCollections;
