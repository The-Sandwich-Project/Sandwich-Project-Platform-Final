import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle, Link2, Unlink, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { LINKED_COLLECTION_TOTALS_KEY } from './hooks/useLinkedCollectionTotals';
import type { EventRequest, SandwichCollection } from '@shared/schema';
import {
  calculateGroupSandwiches,
  calculateTotalTypeBreakdown,
} from '@/lib/analytics-utils';
import { parseCollectionDate } from '@/lib/date-utils';

// Event Collection Log Component
//
// The sandwich collections linked to a single event request (via
// sandwich_collections.eventRequestId). Admins also see suggested matches —
// unlinked entries dated the event day or the day after with a similar group or
// host name — and can link or unlink entries. The count shown for the event is
// the matching group's share of each entry, not the whole entry, since one
// "Groups" entry can hold several organizations.
interface EventCollectionLogProps {
  eventRequest: EventRequest | null;
  isVisible: boolean;
  onClose: () => void;
}

/** Per-record total: individual sandwiches + all group counts. */
function recordTotal(collection: SandwichCollection): number {
  return (collection.individualSandwiches || 0) + calculateGroupSandwiches(collection);
}

/** Shape returned by GET /api/event-requests/:id/collection-matches. */
interface CollectionMatch {
  collectionId: number;
  collectionDate: string;
  hostName: string;
  entryTotal: number;
  groups: Array<{ name: string; department?: string; count: number }>;
  eventCount: number;
  countBasis: 'matched_groups' | 'host' | 'single_group' | 'all_groups';
  score: number;
  matchedGroupNames: string[];
}

interface CollectionMatchesResponse {
  linked: CollectionMatch[];
  suggestions: CollectionMatch[];
  canLink: boolean;
  searchWindow: { start: string; end: string } | null;
}

function formatShortDate(dateString: string): string {
  const d = parseCollectionDate(dateString);
  return d
    ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : dateString;
}

function matchStrength(score: number): { label: string; className: string } {
  if (score >= 0.99) return { label: 'Exact name', className: 'bg-green-100 text-green-800' };
  if (score >= 0.85) return { label: 'Close name', className: 'bg-teal-100 text-teal-800' };
  return { label: 'Possible', className: 'bg-amber-100 text-amber-800' };
}

const COUNT_BASIS_NOTE: Record<CollectionMatch['countBasis'], string | null> = {
  matched_groups: null,
  host: null,
  single_group: null,
  all_groups: 'No group name matched, so all groups in this entry are counted',
};

const TYPE_LABELS: Array<{ key: 'deli' | 'turkey' | 'ham' | 'pbj'; label: string }> = [
  { key: 'deli', label: 'Deli' },
  { key: 'turkey', label: 'Turkey' },
  { key: 'ham', label: 'Ham' },
  { key: 'pbj', label: 'PB&J' },
];

const EventCollectionLog: React.FC<EventCollectionLogProps> = ({
  eventRequest,
  isVisible,
  onClose,
}) => {
  // Fetch collections linked to this event request. The default queryFn uses
  // queryKey[0] as the URL, so the event id must live in the string itself.
  const { data: collectionsData } = useQuery<SandwichCollection[]>({
    queryKey: [`/api/sandwich-collections?eventRequestId=${eventRequest?.id}`],
    enabled: isVisible && !!eventRequest?.id,
  });

  const matchesKey = `/api/event-requests/${eventRequest?.id}/collection-matches`;
  const { data: matches, isLoading: matchesLoading } = useQuery<CollectionMatchesResponse>({
    queryKey: [matchesKey],
    enabled: isVisible && !!eventRequest?.id,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refreshAfterLinkChange = () => {
    queryClient.invalidateQueries({ queryKey: [matchesKey] });
    queryClient.invalidateQueries({
      queryKey: [`/api/sandwich-collections?eventRequestId=${eventRequest?.id}`],
    });
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === LINKED_COLLECTION_TOTALS_KEY,
    });
  };

  const linkMutation = useMutation({
    mutationFn: (collectionId: number) =>
      apiRequest('POST', `/api/event-requests/${eventRequest?.id}/collections/${collectionId}/link`),
    onSuccess: () => {
      refreshAfterLinkChange();
      toast({ title: 'Linked', description: 'Collection entry linked to this event.' });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not link',
        description: error?.message || 'Failed to link collection entry.',
        variant: 'destructive',
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (collectionId: number) =>
      apiRequest('DELETE', `/api/event-requests/${eventRequest?.id}/collections/${collectionId}/link`),
    onSuccess: () => {
      refreshAfterLinkChange();
      toast({ title: 'Unlinked', description: 'Collection entry is no longer linked to this event.' });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not unlink',
        description: error?.message || 'Failed to unlink collection entry.',
        variant: 'destructive',
      });
    },
  });

  const collections = Array.isArray(collectionsData) ? collectionsData : [];
  const linkedById = new Map((matches?.linked ?? []).map((m) => [m.collectionId, m]));
  const suggestions = matches?.suggestions ?? [];
  const canLink = !!matches?.canLink;
  const linkBusy = linkMutation.isPending || unlinkMutation.isPending;

  if (!isVisible || !eventRequest) return null;

  // The event's share of each entry (matching group only), falling back to the
  // whole entry while match data is loading.
  const totalSandwiches = collections.reduce(
    (sum, collection) =>
      sum + (linkedById.get(collection.id)?.eventCount ?? recordTotal(collection)),
    0
  );

  return (
    <div
      className="fixed inset-0 bg-[#236383] bg-opacity-50 z-50 flex items-center justify-center p-4"
      style={{
        left: window.innerWidth > 768 ? 240 : 0, // 240px nav bar width on desktop
        width: window.innerWidth > 768 ? `calc(100vw - 240px)` : '100vw',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">
                Collection Log for {eventRequest?.organizationName}
              </h2>
              <p className="text-[#236383]">
                {eventRequest?.firstName} {eventRequest?.lastName}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              data-testid="button-close-collection-log"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">🥪</span>
                  <div>
                    <p className="text-sm text-[#236383]">Sandwiches Logged</p>
                    <p className="text-2xl font-bold text-brand-primary">
                      {totalSandwiches.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">📅</span>
                  <div>
                    <p className="text-sm text-[#236383]">Collection Days</p>
                    <p className="text-2xl font-bold text-brand-teal">
                      {collections.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-sm text-[#236383]">Status</p>
                    <p className="text-sm font-medium text-green-600">
                      {collections.length > 0 ? 'Linked' : 'Not linked'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Collections List */}
          {collections.length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Collection Records</h3>
              {collections.map((collection) => {
                const breakdown = calculateTotalTypeBreakdown(collection);
                // Parse the date-only collectionDate as a LOCAL date so US
                // timezones don't render the previous day (UTC off-by-one).
                const collectionDate = parseCollectionDate(
                  collection.collectionDate
                );
                return (
                  <Card key={collection.id} className="p-4">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-5 h-5 text-brand-primary flex-shrink-0" />
                            <span className="font-medium text-sm sm:text-base">
                              {collectionDate
                                ? collectionDate.toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                  })
                                : 'Unknown date'}
                            </span>
                          </div>
                          <Badge
                            variant="secondary"
                            className="bg-brand-primary text-white self-start sm:self-auto"
                          >
                            {(linkedById.get(collection.id)?.eventCount ?? recordTotal(collection)).toLocaleString()} sandwiches
                          </Badge>
                          {canLink && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-gray-500 hover:text-red-600 sm:ml-auto self-start"
                              disabled={linkBusy}
                              onClick={() => {
                                if (window.confirm('Unlink this collection entry from the event?')) {
                                  unlinkMutation.mutate(collection.id);
                                }
                              }}
                            >
                              <Unlink className="w-3 h-3 mr-1" />
                              Unlink
                            </Button>
                          )}
                        </div>

                        {/* Event's share vs whole entry (a Groups entry can hold several orgs) */}
                        {(() => {
                          const match = linkedById.get(collection.id);
                          if (!match) return null;
                          const note = COUNT_BASIS_NOTE[match.countBasis];
                          if (match.eventCount === match.entryTotal && !note) return null;
                          return (
                            <div className="ml-0 sm:ml-8 pl-7 sm:pl-0">
                              <p className="text-xs text-gray-500">
                                {match.matchedGroupNames.length > 0
                                  ? `Counted: ${match.matchedGroupNames.join(', ')}. `
                                  : ''}
                                Whole entry: {match.entryTotal.toLocaleString()} sandwiches.
                                {note ? ` ${note}.` : ''}
                              </p>
                            </div>
                          );
                        })()}

                        {/* Host */}
                        {collection.hostName && (
                          <div className="ml-0 sm:ml-8 pl-7 sm:pl-0">
                            <p className="text-sm text-[#236383]">
                              <strong>Host:</strong> {collection.hostName}
                            </p>
                          </div>
                        )}

                        {/* Sandwich Types Breakdown (from real type fields) */}
                        {breakdown.total > 0 && (
                          <div className="ml-0 sm:ml-8 pl-7 sm:pl-0">
                            <p className="text-sm text-[#236383]">
                              Types:{' '}
                              {TYPE_LABELS.filter(({ key }) => breakdown[key] > 0)
                                .map(
                                  ({ key, label }) =>
                                    `${label}: ${breakdown[key].toLocaleString()}`
                                )
                                .join(', ')}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[#236383] mb-2">
                No collection log entry is linked to this event yet.
              </p>
              {!matchesLoading && !canLink && (
                <p className="text-sm text-gray-500">An admin can link the matching entry.</p>
              )}
            </div>
          )}

          {/* Suggested matches (admins only) */}
          {canLink && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-semibold">Suggested matches</h3>
              {matches?.searchWindow ? (
                <p className="text-xs text-gray-500">
                  Unlinked entries from {formatShortDate(matches.searchWindow.start)} to{' '}
                  {formatShortDate(matches.searchWindow.end)} with a group or host name similar to{' '}
                  <strong>{eventRequest.organizationName}</strong>. Check the name and date before linking.
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  This event has no date, so there's nothing to match against.
                </p>
              )}
              {suggestions.length === 0 && matches?.searchWindow && (
                <p className="text-sm text-gray-500 italic">No likely matches found.</p>
              )}
              {suggestions.map((s) => {
                const strength = matchStrength(s.score);
                const note = COUNT_BASIS_NOTE[s.countBasis];
                return (
                  <Card key={s.collectionId} className="p-4 border-dashed">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{formatShortDate(s.collectionDate)}</span>
                          <Badge variant="secondary" className={strength.className}>
                            {strength.label}
                          </Badge>
                          <Badge variant="secondary" className="bg-brand-primary text-white">
                            {s.eventCount.toLocaleString()} sandwiches
                          </Badge>
                        </div>
                        <p className="text-sm text-[#236383]">
                          <strong>Host:</strong> {s.hostName}
                        </p>
                        {s.groups.length > 0 && (
                          <p className="text-sm text-gray-600">
                            <strong>Groups:</strong>{' '}
                            {s.groups
                              .map((g) => `${g.name || 'Unnamed'}${g.department ? ` (${g.department})` : ''}: ${g.count.toLocaleString()}`)
                              .join(' · ')}
                          </p>
                        )}
                        {(s.eventCount !== s.entryTotal || note) && (
                          <p className="text-xs text-gray-500">
                            Whole entry: {s.entryTotal.toLocaleString()} sandwiches.{note ? ` ${note}.` : ''}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="bg-[#007e8c] hover:bg-[#236383] text-white self-start"
                        disabled={linkBusy}
                        onClick={() => linkMutation.mutate(s.collectionId)}
                      >
                        <Link2 className="w-4 h-4 mr-1" />
                        Link
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventCollectionLog;
