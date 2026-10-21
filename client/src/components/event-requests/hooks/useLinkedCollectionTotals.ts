import { useQuery } from '@tanstack/react-query';

export interface LinkedCollectionTotal {
  /** Sandwiches attributed to the event across its linked collection entries. */
  count: number;
  /** Number of linked collection entries. */
  entries: number;
}

export type LinkedCollectionTotals = Record<number, LinkedCollectionTotal>;

/** Query-key prefix; invalidate with a predicate on key[0] after linking. */
export const LINKED_COLLECTION_TOTALS_KEY = '/api/event-requests/linked-collection-totals';

// Keep each request's URL short; the server caps ids per request too.
const CHUNK_SIZE = 200;

/**
 * Sandwich counts from the collections log for a list of events, fetched in a
 * few batched requests instead of one per card.
 */
export function useLinkedCollectionTotals(eventIds: number[]) {
  const sortedIds = [...eventIds].sort((a, b) => a - b);

  return useQuery<LinkedCollectionTotals>({
    queryKey: [LINKED_COLLECTION_TOTALS_KEY, sortedIds],
    enabled: sortedIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const chunks: number[][] = [];
      for (let i = 0; i < sortedIds.length; i += CHUNK_SIZE) {
        chunks.push(sortedIds.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await fetch(`${LINKED_COLLECTION_TOTALS_KEY}?ids=${chunk.join(',')}`, {
            credentials: 'include',
          });
          if (!res.ok) throw new Error(`Failed to load collection totals (${res.status})`);
          return (await res.json()) as LinkedCollectionTotals;
        })
      );
      return Object.assign({}, ...results);
    },
  });
}
