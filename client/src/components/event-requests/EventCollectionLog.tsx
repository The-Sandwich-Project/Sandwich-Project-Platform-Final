import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle, X } from 'lucide-react';
import type { EventRequest, SandwichCollection } from '@shared/schema';
import {
  calculateGroupSandwiches,
  calculateTotalTypeBreakdown,
} from '@/lib/analytics-utils';
import { parseCollectionDate } from '@/lib/date-utils';

// Event Collection Log Component
//
// Read-only view of the sandwich collections linked to a single event request
// (via sandwich_collections.eventRequestId). Counts use the centralized
// analytics-utils formula — the single source of truth for sandwich totals.
interface EventCollectionLogProps {
  eventRequest: EventRequest | null;
  isVisible: boolean;
  onClose: () => void;
}

/** Per-record total: individual sandwiches + all group counts. */
function recordTotal(collection: SandwichCollection): number {
  return (collection.individualSandwiches || 0) + calculateGroupSandwiches(collection);
}

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

  const collections = Array.isArray(collectionsData) ? collectionsData : [];

  if (!isVisible || !eventRequest) return null;

  const totalSandwiches = collections.reduce(
    (sum, collection) => sum + recordTotal(collection),
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
                    <p className="text-sm text-[#236383]">Total Sandwiches</p>
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
                  <CheckCircle className="w-8 h-8 text-tsp-teal" />
                  <div>
                    <p className="text-sm text-[#236383]">Status</p>
                    <p className="text-sm font-medium text-tsp-teal">
                      {collections.length > 0 ? 'Active' : 'No Collections'}
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
                            {recordTotal(collection).toLocaleString()} sandwiches
                          </Badge>
                        </div>

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
              <p className="text-[#236383] mb-4">
                No collections recorded for this event yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventCollectionLog;
