import {
  getCollectionDateWindow,
  getCollectionGroups,
  matchCollection,
  rankSuggestions,
  type CollectionLike,
} from '../services/event-collection-matching';

function entry(overrides: Partial<CollectionLike>): CollectionLike {
  return {
    id: 1,
    collectionDate: '2026-10-17',
    hostName: 'Groups',
    individualSandwiches: 0,
    groupCollections: [],
    ...overrides,
  };
}

describe('getCollectionGroups', () => {
  it('reads groupCollections, including string-encoded JSON', () => {
    const groups = getCollectionGroups(
      entry({ groupCollections: JSON.stringify([{ name: 'Acme Corp', count: 200 }]) })
    );
    expect(groups).toEqual([{ name: 'Acme Corp', department: undefined, count: 200 }]);
  });

  it('falls back to legacy group1/group2 columns', () => {
    const groups = getCollectionGroups(
      entry({ group1Name: 'Acme Corp', group1Count: 150, group2Name: 'Beta Inc', group2Count: 50 })
    );
    expect(groups.map((g) => g.count)).toEqual([150, 50]);
  });
});

describe('matchCollection', () => {
  it('counts only the matching group in a multi-org Groups entry', () => {
    const match = matchCollection(
      entry({
        groupCollections: [
          { name: 'First Baptist Church', count: 300 },
          { name: 'Allied World Assurance', count: 500 },
        ],
      }),
      'The First Baptist Church'
    );
    expect(match.eventCount).toBe(300);
    expect(match.entryTotal).toBe(800);
    expect(match.countBasis).toBe('matched_groups');
    expect(match.matchedGroupNames).toEqual(['First Baptist Church']);
  });

  it('credits only the exact troop when similar troops share an entry', () => {
    const match = matchCollection(
      entry({
        groupCollections: [
          { name: 'Girl Scout Troop 123', count: 300 },
          { name: 'Girl Scout Troop 456', count: 500 },
        ],
      }),
      'Girl Scout Troop 123'
    );
    expect(match.eventCount).toBe(300);
    expect(match.matchedGroupNames).toEqual(['Girl Scout Troop 123']);
  });

  it('counts only the best near-match when none is exact', () => {
    const match = matchCollection(
      entry({
        groupCollections: [
          { name: 'Northside Hospital Atlanta', count: 100 },
          { name: 'Northside Church', count: 400 },
        ],
      }),
      'Northside Hospital'
    );
    expect(match.matchedGroupNames).toEqual(['Northside Hospital Atlanta']);
    expect(match.eventCount).toBe(100);
  });

  it('counts the whole entry when the host is the organization', () => {
    const match = matchCollection(
      entry({
        hostName: 'Allied World Assurance',
        individualSandwiches: 120,
        groupCollections: [{ name: 'Team A', count: 80 }],
      }),
      'Allied World Assurance'
    );
    expect(match.countBasis).toBe('host');
    expect(match.eventCount).toBe(200);
  });

  it('treats a lone group as the event even if its name differs', () => {
    const match = matchCollection(
      entry({ groupCollections: [{ name: 'FBC youth', count: 90 }] }),
      'First Baptist Church'
    );
    expect(match.countBasis).toBe('single_group');
    expect(match.eventCount).toBe(90);
  });
});

describe('rankSuggestions', () => {
  it('drops unrelated entries and ranks the exact name first', () => {
    const ranked = rankSuggestions(
      [
        entry({ id: 1, groupCollections: [{ name: 'Roswell Rotary', count: 40 }] }),
        entry({ id: 2, groupCollections: [{ name: 'Northside Hospital', count: 100 }] }),
        entry({ id: 3, groupCollections: [{ name: 'Northside Hospital Atlanta', count: 60 }] }),
      ],
      'Northside Hospital'
    );
    expect(ranked.map((m) => m.collectionId)).toEqual([2, 3]);
  });

  it('suggests a near-identical name (troop numbers) — which is why a human confirms', () => {
    const ranked = rankSuggestions(
      [entry({ groupCollections: [{ name: 'Girl Scout Troop 456', count: 75 }] })],
      'Girl Scout Troop 123'
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeLessThan(0.99);
  });
});

describe('getCollectionDateWindow', () => {
  it('covers the event day and the day after', () => {
    // Noon Eastern — same calendar day in UTC and Eastern
    expect(getCollectionDateWindow(new Date('2026-10-17T16:00:00Z'))).toEqual({
      start: '2026-10-17',
      end: '2026-10-18',
    });
  });

  it('covers both readings when a date is stored as UTC midnight', () => {
    // UTC midnight is still the previous evening in Eastern time
    expect(getCollectionDateWindow(new Date('2026-10-17T00:00:00Z'))).toEqual({
      start: '2026-10-16',
      end: '2026-10-18',
    });
  });

  it('returns null without a date', () => {
    expect(getCollectionDateWindow(null)).toBeNull();
  });
});
