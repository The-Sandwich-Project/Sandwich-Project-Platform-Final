const whereCalls: unknown[] = [];

jest.mock('../../server/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: (cond: unknown) => {
          whereCalls.push(cond);
          return Promise.resolve();
        },
      }),
    }),
  },
}));
jest.mock('drizzle-orm', () => ({
  and: (...conds: unknown[]) => ({ and: conds }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
}));
jest.mock('@shared/schema', () => ({
  eventRequests: { id: 'id', eventAddress: 'eventAddress' },
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

let inFlight = 0;
let maxInFlight = 0;
const lookups: string[] = [];
jest.mock('../../server/utils/geocoding', () => ({
  geocodeAddress: async (address: string) => {
    lookups.push(address);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight--;
    return { latitude: '33.7', longitude: '-84.4', source: 'google' };
  },
}));

import { geocodeEventsInBackground } from '../../server/utils/geocode-event';

async function flush(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

describe('geocodeEventsInBackground', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    whereCalls.length = 0;
    lookups.length = 0;
    inFlight = 0;
    maxInFlight = 0;
  });
  afterEach(() => jest.useRealTimers());

  it('looks up a batch one at a time instead of all at once', async () => {
    geocodeEventsInBackground([
      { id: 1, eventAddress: '1 A St' },
      { id: 2, eventAddress: '2 B St' },
      { id: 3, eventAddress: '3 C St' },
    ]);
    await flush(5000);

    expect(lookups).toEqual(['1 A St', '2 B St', '3 C St']);
    expect(maxInFlight).toBe(1);
  });

  it('only writes coordinates if the event still has the looked-up address', async () => {
    geocodeEventsInBackground([{ id: 7, eventAddress: ' 9 Peachtree St ' }]);
    await flush(1000);

    expect(lookups).toEqual(['9 Peachtree St']);
    expect(whereCalls).toEqual([
      { and: [{ eq: ['id', 7] }, { eq: ['eventAddress', ' 9 Peachtree St '] }] },
    ]);
  });

  it('skips events without an address', async () => {
    geocodeEventsInBackground([
      { id: 1, eventAddress: null },
      { id: 2, eventAddress: '   ' },
    ]);
    await flush(1000);

    expect(lookups).toEqual([]);
    expect(whereCalls).toEqual([]);
  });
});
