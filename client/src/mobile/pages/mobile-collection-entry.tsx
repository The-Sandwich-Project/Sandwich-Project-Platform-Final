import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Plus,
  Minus,
  Check,
  X,
  Building2,
  Calendar,
  Loader2,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { usePageSession } from '@/hooks/usePageSession';
interface Host {
  id: number;
  name: string;
  shortName?: string;
  isActive?: boolean;
}

/**
 * Mobile quick collection entry - optimized for one-handed use
 */
export function MobileCollectionEntry() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Collection Entry',
  });

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [sandwichCount, setSandwichCount] = useState(0);
  const [collectionDate, setCollectionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hostSearch, setHostSearch] = useState('');

  // Handle escape key to close modal
  const handleEscapeKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && showHostPicker) {
      setShowHostPicker(false);
    }
  }, [showHostPicker]);

  useEffect(() => {
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [handleEscapeKey]);

  // Fetch hosts
  const { data: hosts = [], isLoading: hostsLoading } = useQuery<Host[]>({
    queryKey: ['/api/hosts'],
    staleTime: 300000, // 5 minutes
  });

  // Filter and sort hosts
  const filteredHosts = hosts
    .filter((h) => h.isActive !== false)
    .filter((h) =>
      hostSearch
        ? h.name.toLowerCase().includes(hostSearch.toLowerCase()) ||
          h.shortName?.toLowerCase().includes(hostSearch.toLowerCase())
        : true
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: {
      hostId: number;
      hostName: string;
      individualSandwiches: number;
      collectionDate: string;
    }) => {
      return apiRequest('POST', '/api/sandwich-collections', data);
    },
    onSuccess: () => {
      toast({
        title: 'Collection logged!',
        description: `${sandwichCount} sandwiches from ${selectedHost?.name}`,
      });
      // The collections list bakes query params into queryKey[0]
      // (e.g. '/api/sandwich-collections?limit=100'), so match by prefix.
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === 'string' &&
          query.queryKey[0].startsWith('/api/sandwich-collections'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      navigate('/collections');
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to log collection',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedHost) {
      toast({
        title: 'Select a host',
        description: 'Please select where you picked up sandwiches',
        variant: 'destructive',
      });
      return;
    }

    if (sandwichCount <= 0) {
      toast({
        title: 'Enter sandwich count',
        description: 'Please enter the number of sandwiches',
        variant: 'destructive',
      });
      return;
    }

    submitMutation.mutate({
      hostId: selectedHost.id,
      hostName: selectedHost.name,
      individualSandwiches: sandwichCount,
      collectionDate,
    });
  };

  const incrementCount = (amount: number) => {
    setSandwichCount((prev) => Math.max(0, prev + amount));
  };

  return (
    <MobileShell title="Log Collection" showBack showNav={false}>
      <div className="flex flex-col h-full">
        {/* Main form area */}
        <div className="flex-1 p-4 space-y-6">
          {/* Host selector */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              Pickup Location
            </label>
            <button
              onClick={() => setShowHostPicker(true)}
              className={cn(
                "w-full flex items-center gap-3 p-4 rounded-xl",
                "bg-white dark:bg-slate-800 border shadow-sm",
                "text-left transition-colors",
                selectedHost
                  ? "border-brand-primary"
                  : "border-slate-200 dark:border-slate-700"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                selectedHost ? "bg-brand-primary/10" : "bg-slate-100 dark:bg-slate-700"
              )}>
                <Building2 className={cn(
                  "w-5 h-5",
                  selectedHost ? "text-brand-primary" : "text-slate-400"
                )} />
              </div>
              <div className="flex-1 min-w-0">
                {selectedHost ? (
                  <>
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {selectedHost.name}
                    </p>
                    {selectedHost.shortName && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {selectedHost.shortName}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400">
                    Select a host location
                  </p>
                )}
              </div>
              <ChevronDown className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Sandwich count - large touch target */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              Number of Sandwiches
            </label>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
              <div className="flex items-center justify-center gap-4">
                {/* Decrement buttons */}
                <button
                  onClick={() => incrementCount(-10)}
                  className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold active:scale-95 transition-transform"
                >
                  -10
                </button>
                <button
                  onClick={() => incrementCount(-1)}
                  className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <Minus className="w-6 h-6 text-slate-600 dark:text-slate-300" />
                </button>

                {/* Count display */}
                <div className="w-24 text-center">
                  <input
                    type="number"
                    value={sandwichCount}
                    onChange={(e) => setSandwichCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full text-center text-4xl font-bold text-slate-900 dark:text-slate-100 bg-transparent border-none focus:outline-none focus:ring-0"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">sandwiches</p>
                </div>

                {/* Increment buttons */}
                <button
                  onClick={() => incrementCount(1)}
                  className="w-14 h-14 rounded-xl bg-brand-primary/10 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <Plus className="w-6 h-6 text-brand-primary" />
                </button>
                <button
                  onClick={() => incrementCount(10)}
                  className="w-14 h-14 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary font-bold active:scale-95 transition-transform"
                >
                  +10
                </button>
              </div>

              {/* Quick presets */}
              <div className="flex gap-2 mt-4 justify-center">
                {[25, 50, 75, 100].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setSandwichCount(preset)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      sandwichCount === preset
                        ? "bg-brand-primary text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Date picker */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              Collection Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="date"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                className={cn(
                  "w-full pl-12 pr-4 py-4 rounded-xl",
                  "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                  "text-slate-900 dark:text-slate-100",
                  "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                )}
              />
            </div>
          </div>
        </div>

        {/* Submit button - fixed at bottom */}
        <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || !selectedHost || sandwichCount <= 0}
            className={cn(
              "w-full py-4 rounded-xl font-semibold text-lg",
              "flex items-center justify-center gap-2",
              "transition-all active:scale-[0.98]",
              submitMutation.isPending || !selectedHost || sandwichCount <= 0
                ? "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
                : "bg-brand-primary text-white shadow-lg shadow-brand-primary/25"
            )}
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Log {sandwichCount} Sandwiches
              </>
            )}
          </button>
        </div>

        {/* Host picker modal */}
        {showHostPicker && (
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowHostPicker(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-800 rounded-t-3xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 pb-3 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100">
                  Select Host
                </h3>
                <button
                  onClick={() => setShowHostPicker(false)}
                  className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {/* Search */}
              <div className="px-4 py-3">
                <input
                  type="text"
                  placeholder="Search hosts..."
                  value={hostSearch}
                  onChange={(e) => setHostSearch(e.target.value)}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl",
                    "bg-slate-100 dark:bg-slate-700",
                    "text-slate-900 dark:text-slate-100 placeholder:text-slate-400",
                    "focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  )}
                  autoFocus
                />
              </div>

              {/* Host list */}
              <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {hostsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : filteredHosts.length === 0 ? (
                  <p className="text-center py-8 text-slate-500 dark:text-slate-400">
                    No hosts found
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredHosts.map((host) => (
                      <button
                        key={host.id}
                        onClick={() => {
                          setSelectedHost(host);
                          setShowHostPicker(false);
                          setHostSearch('');
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl text-left",
                          "transition-colors",
                          selectedHost?.id === host.id
                            ? "bg-brand-primary/10 border-2 border-brand-primary"
                            : "bg-slate-50 dark:bg-slate-700/50 border-2 border-transparent"
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          selectedHost?.id === host.id
                            ? "bg-brand-primary text-white"
                            : "bg-slate-200 dark:bg-slate-600"
                        )}>
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {host.name}
                          </p>
                          {host.shortName && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                              {host.shortName}
                            </p>
                          )}
                        </div>
                        {selectedHost?.id === host.id && (
                          <Check className="w-5 h-5 text-brand-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}

export default MobileCollectionEntry;
