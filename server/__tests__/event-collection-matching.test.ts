import {
  WHOLE_ENTRY,
  countForLinks,
  describeEntry,
  getCollectionDateWindow,
  getCollectionGroups,
  rankSuggestions,
  resolveLinkedGroup,
  suggestGroups,
  type CollectionLike,
  type LinkLike,
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

function link(eventRequestId: number, groupIndex: number, groupName: string | null = null): LinkLike {
  return { eventRequestId, collectionId: 1, groupIndex, groupName };
}

const twoTroops = entry({
  groupCollections: [
    { name: 'Girl Scout Troop 123', count: 300 },
    { name: 'Girl Scout Troop 456', count: 500 },
  ],
});

describe('getCollectionGroups', () => {
  it('reads groupCollections with indexes, including string-encoded JSON', () => {
    const groups = getCollectionGroups(
      entry({ groupCollections: JSON.stringify([{ name: 'Acme Corp', count: 200 }]) })
    );
    expect(groups).toEqual([{ index: 0, name: 'Acme Corp', department: undefined, count: 200 }]);
  });

  it('falls back to legacy group1/group2 columns', () => {
    const groups = getCollectionGroups(
      entry({ group1Name: 'Acme Corp', group1Count: 150, group2Name: 'Beta Inc', group2Count: 50 })
    );
    expect(groups.map((g) => [g.index, g.count])).toEqual([[0, 150], [1, 50]]);
  });
});

describe('suggestGroups', () => {
  it('pre-picks only the exact troop when similar troops share an entry', () => {
    expect(suggestGroups(twoTroops, 'Girl Scout Troop 123').suggestedGroupIndexes).toEqual([0]);
  });

  it('pre-picks only the best near-match when none is exact', () => {
    const s = suggestGroups(
      entry({
        groupCollections: [
          { name: 'Northside Hospital Atlanta', count: 100 },
          { name: 'Northside Church', count: 400 },
        ],
      }),
      'Northside Hospital'
    );
    expect(s.suggestedGroupIndexes).toEqual([0]);
  });

  it('suggests the whole entry when the host is the organization', () => {
    const s = suggestGroups(
      entry({ hostName: 'Allied World Assurance', groupCollections: [{ name: 'Team A', count: 80 }] }),
      'Allied World Assurance'
    );
    expect(s).toMatchObject({ suggestWholeEntry: true, suggestedGroupIndexes: [] });
  });
});

describe('countForLinks', () => {
  it('counts only the picked groups', () => {
    expect(countForLinks(twoTroops, [link(10, 0, 'Girl Scout Troop 123')]).count).toBe(300);
  });

  it('counts the whole entry, individual sandwiches included', () => {
    const e = entry({ individualSandwiches: 120, groupCollections: [{ name: 'Team A', count: 80 }] });
    expect(countForLinks(e, [link(10, WHOLE_ENTRY)])).toMatchObject({ count: 200, wholeEntry: true });
  });

  it('finds a linked group by name after the entry is reordered', () => {
    const reordered = entry({
      groupCollections: [
        { name: 'Girl Scout Troop 456', count: 500 },
        { name: 'Girl Scout Troop 123', count: 300 },
      ],
    });
    const group = resolveLinkedGroup(getCollectionGroups(reordered), { groupIndex: 0, groupName: 'Girl Scout Troop 123' });
    expect(group?.count).toBe(300);
  });

  it('flags a linked group that no longer exists instead of counting a stranger', () => {
    const edited = entry({ groupCollections: [{ name: 'Roswell Rotary', count: 40 }] });
    expect(countForLinks(edited, [link(10, 0, 'Girl Scout Troop 123')])).toMatchObject({
      count: 0,
      hasMissingGroup: true,
    });
  });
});

describe('describeEntry', () => {
  it('lets two events each link their own group in one entry', () => {
    const links = [link(10, 0, 'Girl Scout Troop 123'), link(20, 1, 'Girl Scout Troop 456')];
    const forTroop123 = describeEntry(twoTroops, 'Girl Scout Troop 123', links, 10);
    const forTroop456 = describeEntry(twoTroops, 'Girl Scout Troop 456', links, 20);
    expect(forTroop123.count).toBe(300);
    expect(forTroop456.count).toBe(500);
    expect(forTroop123.groups.map((g) => g.linkedEventId)).toEqual([10, 20]);
  });

  it('reads the older eventRequestId column as a whole-entry link', () => {
    const legacy = { ...twoTroops, eventRequestId: 10 };
    const view = describeEntry(legacy, 'Girl Scout Troop 123', [], 10);
    expect(view).toMatchObject({ wholeEntry: true, count: 800, legacyLink: true });
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
      new Map(),
      'Northside Hospital',
      10
    );
    expect(ranked.map((m) => m.collectionId)).toEqual([2, 3]);
  });

  it('still suggests a shared entry when another event has linked a different group', () => {
    const ranked = rankSuggestions(
      [twoTroops],
      new Map([[1, [link(20, 1, 'Girl Scout Troop 456')]]]),
      'Girl Scout Troop 123',
      10
    );
    expect(ranked).toHaveLength(1);
  });

  it('hides entries already linked to this event', () => {
    const ranked = rankSuggestions(
      [twoTroops],
      new Map([[1, [link(10, 0, 'Girl Scout Troop 123')]]]),
      'Girl Scout Troop 123',
      10
    );
    expect(ranked).toHaveLength(0);
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
