jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/socket-singleton', () => ({ getSocketInstance: () => null, getOrCreateSocket: () => null }));

import { QueryClient } from '@tanstack/react-query';
import { SAME_DAY_VAN_QUERY_KEY } from '@shared/van-rules';
import { applyEventRequestSaveToCache, invalidateEventRequestQueries } from '../queryClient';

/**
 * Each van badge reads the OTHER events on its day from the same-day van
 * query, so a save to one event (here or from another user's socket update)
 * has to refresh those cached days: ticking "Events team OK'd" on event 1
 * clears "Van pending" on event 2's card.
 */
describe('same-day van lists refresh after event saves', () => {
  const vanKey = [SAME_DAY_VAN_QUERY_KEY, '2026-12-05', 2];
  const isStale = (qc: QueryClient) => qc.getQueryState(vanKey)?.isInvalidated === true;

  function seeded() {
    const qc = new QueryClient();
    qc.setQueryData(vanKey, { otherEvents: [{ id: 1, vanDriverNeeded: true, vanTeamOk: false }] });
    return qc;
  }

  it.each([['vanTeamOk'], ['vanDriverNeeded'], ['selfTransport'], ['isDhlVan'], ['scheduledEventDate'], ['status']])(
    'a save touching %s marks the cached days stale',
    async (field) => {
      const qc = seeded();
      await applyEventRequestSaveToCache(qc, { id: 1, [field]: true } as any, { touchedFields: [field] });
      expect(isStale(qc)).toBe(true);
    },
  );

  it('a save that does not touch van or date fields leaves them alone', async () => {
    const qc = seeded();
    await applyEventRequestSaveToCache(qc, { id: 1, planningNotes: 'x' } as any, { touchedFields: ['planningNotes'] });
    expect(isStale(qc)).toBe(false);
  });

  it("another user's save (no touched list: every returned field counts) refreshes them", async () => {
    const qc = seeded();
    await applyEventRequestSaveToCache(qc, { id: 1, vanTeamOk: true, planningNotes: 'x' } as any);
    expect(isStale(qc)).toBe(true);
  });

  it('the full refresh (creates, deletes) includes them too', async () => {
    const qc = seeded();
    await invalidateEventRequestQueries(qc);
    expect(isStale(qc)).toBe(true);
  });
});
