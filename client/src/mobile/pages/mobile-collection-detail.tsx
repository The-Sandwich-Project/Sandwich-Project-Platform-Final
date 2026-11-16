import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  MapPin,
  Clock,
  User,
  Sandwich,
  Check,
  X,
  Edit,
  Phone,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
/**
 * Mobile collection detail screen - view collection details
 */
export function MobileCollectionDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute('/collections/:id');
  const collectionId = params?.id;

  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Collection Detail',
    itemDescription: collectionId ? `Collection #${collectionId}` : undefined,
    itemId: collectionId,
  });

  // Fetch collection details
  const { data: collection, isLoading, error } = useQuery({
    queryKey: [`/api/sandwich-collections/${collectionId}`],
    enabled: !!collectionId,
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <MobileShell title="Collection" showBack onBack={() => navigate('/collections')}>
        <div className="p-4 space-y-4 animate-pulse">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
          <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </MobileShell>
    );
  }

  if (error || !collection) {
    return (
      <MobileShell title="Collection" showBack onBack={() => navigate('/collections')}>
        <div className="p-4 text-center py-12">
          <p className="text-slate-500 dark:text-slate-400">Collection not found</p>
          <button
            onClick={() => navigate('/collections')}
            className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-full font-medium"
          >
            Back to Collections
          </button>
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell
      title="Collection Details"
      showBack
      onBack={() => navigate('/collections')}
      headerActions={
        <button
          onClick={() => navigate(`/collections/${collectionId}/edit`)}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
        >
          <Edit className="w-5 h-5" />
        </button>
      }
    >
      <div className="p-4 space-y-4">
        {/* Header with count */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center">
                <Sandwich className="w-6 h-6 text-brand-primary" />
              </div>
              <div>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {(() => {
                    const individual = collection.individualSandwiches || 0;
                    let group = 0;
                    if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
                      group = collection.groupCollections.reduce((sum: number, g: any) => sum + (g.count || 0), 0);
                    } else {
                      group = (collection.group1Count || 0) + (collection.group2Count || 0);
                    }
                    return (individual + group).toLocaleString();
                  })()}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">sandwiches</p>
              </div>
            </div>
          </div>

          {/* Date */}
          {collection.collectionDate && (
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Calendar className="w-4 h-4" />
              <span>
                {format(new Date(collection.collectionDate), 'EEEE, MMMM d, yyyy')}
              </span>
            </div>
          )}

          {/* Submitted by */}
          {collection.createdByName && (
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mt-1">
              <User className="w-4 h-4" />
              <span>Submitted by {collection.createdByName}</span>
            </div>
          )}
        </div>

        {/* Host Info */}
        {(collection.hostName || collection.hostAddress) && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Host
            </h3>
            <div className="space-y-2">
              {collection.hostName && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-900 dark:text-slate-100 font-medium">
                    {collection.hostName}
                  </span>
                </div>
              )}
              {collection.hostAddress && (
                <p className="text-slate-600 dark:text-slate-400 ml-6">
                  {collection.hostAddress}
                </p>
              )}
              {collection.hostPhone && (
                <a
                  href={`tel:${collection.hostPhone}`}
                  className="flex items-center gap-2 text-brand-primary ml-6"
                >
                  <Phone className="w-4 h-4" />
                  <span>{collection.hostPhone}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Group Collections */}
        {collection.groupCollections && Array.isArray(collection.groupCollections) && collection.groupCollections.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Group Collections
            </h3>
            <div className="space-y-2">
              {collection.groupCollections.map((group: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-slate-900 dark:text-slate-100">
                    {group.name || `Group ${idx + 1}`}
                  </span>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    {group.count?.toLocaleString() || 0} sandwiches
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recipient Info */}
        {(collection.recipientName || collection.recipientAddress) && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Recipient
            </h3>
            <div className="space-y-2">
              {collection.recipientName && (
                <p className="text-slate-900 dark:text-slate-100 font-medium">
                  {collection.recipientName}
                </p>
              )}
              {collection.recipientAddress && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-600 dark:text-slate-400">
                    {collection.recipientAddress}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {collection.notes && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
              Notes
            </h3>
            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {collection.notes}
            </p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}

export default MobileCollectionDetail;
