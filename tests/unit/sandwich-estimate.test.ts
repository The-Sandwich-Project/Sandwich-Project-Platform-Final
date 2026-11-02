import {
  estimateStateFromFields,
  formatEstimate,
  normalizeEstimate,
  parseEstimateLines,
  resolveEstimatePatch,
  totalFromFields,
  touchesEstimate,
} from '../../shared/sandwich-estimate';

const NONE = {
  estimatedSandwichCount: null,
  estimatedSandwichCountMin: null,
  estimatedSandwichCountMax: null,
  estimatedSandwichRangeType: null,
  sandwichTypes: null,
};

describe('the agreed cases (what you enter -> what the card shows)', () => {
  const show = (patch: Record<string, unknown>) => {
    const f = resolveEstimatePatch(NONE, patch);
    return { f, text: formatEstimate(f) };
  };

  it('total 200, Turkey', () => {
    const { f, text } = show({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli_turkey' }] });
    expect(text).toBe('200 Turkey');
    expect(f).toMatchObject({ estimatedSandwichCount: 200, estimatedSandwichCountMin: null, sandwichTypes: [{ type: 'deli_turkey', quantity: 200 }] });
  });

  it('total 200-300, Turkey', () => {
    const { f, text } = show({ estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300, sandwichTypes: [{ type: 'turkey' }] });
    expect(text).toBe('200–300 Turkey');
    expect(f).toEqual({
      estimatedSandwichCount: 250,
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 300,
      estimatedSandwichRangeType: 'deli_turkey',
      sandwichTypes: [{ type: 'deli_turkey', quantity: 250, min: 200, max: 300 }],
    });
  });

  it('Deli 150 + PBJ 50, no total -> total worked out', () => {
    const { f, text } = show({ sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 50 }] });
    expect(text).toBe('200 (150 Deli, 50 PBJ)');
    expect(f.estimatedSandwichCount).toBe(200);
  });

  it('Deli 100-150 + PBJ 200-250, no total -> range total', () => {
    const { f, text } = show({
      sandwichTypes: [
        { type: 'deli', min: 100, max: 150 },
        { type: 'pbj', min: 200, max: 250 },
      ],
    });
    expect(text).toBe('300–400 (100–150 Deli, 200–250 PBJ)');
    expect(f).toMatchObject({ estimatedSandwichCountMin: 300, estimatedSandwichCountMax: 400, estimatedSandwichCount: 350, estimatedSandwichRangeType: null });
  });

  it('total 300-400, Deli & PBJ, split unknown', () => {
    const { f, text } = show({
      estimatedSandwichCountMin: 300,
      estimatedSandwichCountMax: 400,
      sandwichTypes: [{ type: 'deli' }, { type: 'pbj' }],
    });
    expect(text).toBe('300–400, Deli & PBJ (split TBD)');
    expect(f.sandwichTypes).toEqual([
      { type: 'deli', quantity: 0 },
      { type: 'pbj', quantity: 0 },
    ]);
  });

  it('total 200, no types -> type TBD', () => {
    expect(show({ estimatedSandwichCount: 200 }).text).toBe('200, type TBD');
    expect(show({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'unknown', quantity: 200 }] }).text).toBe('200, type TBD');
  });

  it('nothing -> empty', () => {
    expect(formatEstimate(NONE)).toBe('');
  });
});

describe('rules', () => {
  it('known amounts can\'t add up to more than the total', () => {
    const f = resolveEstimatePatch(NONE, {
      estimatedSandwichCount: 100,
      sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj' }],
    });
    expect(f.estimatedSandwichCount).toBe(150);
  });

  it('a range total that agrees with exact lines is kept', () => {
    const f = resolveEstimatePatch(NONE, {
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 300,
      sandwichTypes: [{ type: 'deli', quantity: 125 }, { type: 'pbj', quantity: 125 }],
    });
    expect(f).toMatchObject({ estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 });
  });

  it('duplicate types merge', () => {
    const f = normalizeEstimate({
      total: null,
      lines: [
        { type: 'deli', amount: { min: 100, max: 100 } },
        { type: 'deli', amount: { min: 50, max: 50 } },
      ],
    });
    expect(f.sandwichTypes).toEqual([{ type: 'deli', quantity: 150 }]);
  });

  it('parses legacy shapes', () => {
    expect(parseEstimateLines('[{"type":"Pbj","quantity":100}]')).toEqual([{ type: 'pbj', amount: { min: 100, max: 100 } }]);
    expect(parseEstimateLines(JSON.stringify(JSON.stringify([{ type: 'deli', quantity: 5 }])))).toEqual([
      { type: 'deli', amount: { min: 5, max: 5 } },
    ]);
    expect(parseEstimateLines('not json')).toEqual([]);
    expect(parseEstimateLines(null)).toEqual([]);
  });

  it('reads totals like the cards do', () => {
    expect(totalFromFields({ estimatedSandwichCount: 500, estimatedSandwichCountMin: 490, estimatedSandwichCountMax: 506 })).toEqual({ min: 500, max: 500 });
    expect(totalFromFields({ estimatedSandwichCount: 498, estimatedSandwichCountMin: 490, estimatedSandwichCountMax: 506 })).toEqual({ min: 490, max: 506 });
    expect(totalFromFields({ estimatedSandwichCountMin: 300 })).toEqual({ min: 300, max: 300 });
    expect(totalFromFields({ estimatedSandwichCount: 0 })).toBeNull();
  });

  it('touchesEstimate', () => {
    expect(touchesEstimate({ status: 'scheduled' })).toBe(false);
    expect(touchesEstimate({ sandwichTypes: null })).toBe(true);
    expect(touchesEstimate({ estimatedSandwichCount: undefined })).toBe(false);
  });
});

describe('screens that send only part of the estimate', () => {
  it('a count-only edit on a one-type event keeps the type (spreadsheet / intake)', () => {
    const existing = { ...NONE, estimatedSandwichCount: 200, sandwichTypes: [{ type: 'pbj', quantity: 200 }] };
    expect(formatEstimate(resolveEstimatePatch(existing, { estimatedSandwichCount: 300 }))).toBe('300 PBJ');
  });

  it('a count-only edit on a split event keeps the types, drops amounts that no longer add up', () => {
    const existing = { ...NONE, estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 50 }] };
    expect(formatEstimate(resolveEstimatePatch(existing, { estimatedSandwichCount: 300 }))).toBe('300, Deli & PBJ (split TBD)');
  });

  it('a types-only edit with amounts sets the total; without amounts keeps it', () => {
    const existing = { ...NONE, estimatedSandwichCount: 200 };
    expect(formatEstimate(resolveEstimatePatch(existing, { sandwichTypes: [{ type: 'deli', quantity: 120 }, { type: 'pbj', quantity: 120 }] }))).toBe(
      '240 (120 Deli, 120 PBJ)'
    );
    expect(formatEstimate(resolveEstimatePatch(existing, { sandwichTypes: [{ type: 'deli' }, { type: 'pbj' }] }))).toBe('200, Deli & PBJ (split TBD)');
  });

  it('a range-type-only edit names the one line', () => {
    const existing = { ...NONE, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 };
    expect(formatEstimate(resolveEstimatePatch(existing, { estimatedSandwichRangeType: 'pbj' }))).toBe('200–300 PBJ');
  });

  it('a count-only save clears a stale range (intake "500" over a 490-506 range)', () => {
    const existing = { ...NONE, estimatedSandwichCountMin: 490, estimatedSandwichCountMax: 506 };
    const f = resolveEstimatePatch(existing, { estimatedSandwichCount: 500 });
    expect(f).toMatchObject({ estimatedSandwichCount: 500, estimatedSandwichCountMin: null, estimatedSandwichCountMax: null });
  });
});

describe('audit bugs the server now prevents', () => {
  it('B2: full-form exact save that drops the "clear types" leaves no stale breakdown', () => {
    const existing = { ...NONE, estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 198 }] };
    const f = resolveEstimatePatch(existing, { estimatedSandwichCount: 250 });
    expect(formatEstimate(f)).toBe('250 Deli');
    expect(f.sandwichTypes).toEqual([{ type: 'deli', quantity: 250 }]);
  });

  it('B3: editing an imported range when the form drops the count/types clears', () => {
    const existing = {
      ...NONE,
      estimatedSandwichCount: 300,
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 400,
      sandwichTypes: [{ type: 'pbj', quantity: 300 }],
    };
    const f = resolveEstimatePatch(existing, { estimatedSandwichCountMin: 400, estimatedSandwichCountMax: 600 });
    expect(f).toMatchObject({ estimatedSandwichCount: 500, estimatedSandwichCountMin: 400, estimatedSandwichCountMax: 600, estimatedSandwichRangeType: 'pbj' });
    expect(formatEstimate(f)).toBe('400–600 PBJ');
  });

  it('B9: a one-sided range becomes that number instead of an orphan', () => {
    const f = resolveEstimatePatch(NONE, { estimatedSandwichCount: null, estimatedSandwichCountMin: 300, estimatedSandwichCountMax: null });
    expect(f).toMatchObject({ estimatedSandwichCount: 300, estimatedSandwichCountMin: null, estimatedSandwichCountMax: null });
  });

  it('B14: a JSON-string breakdown is stored as a real array', () => {
    const f = resolveEstimatePatch(NONE, { sandwichTypes: '[{"type":"pbj","quantity":100}]', estimatedSandwichCount: 100 });
    expect(Array.isArray(f.sandwichTypes)).toBe(true);
  });

  it('every resolved estimate reads back as itself', () => {
    const cases = [
      { estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli' }] },
      { estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300, sandwichTypes: [{ type: 'deli' }, { type: 'pbj' }] },
      { sandwichTypes: [{ type: 'deli', min: 100, max: 150 }, { type: 'pbj', quantity: 50 }] },
    ];
    for (const c of cases) {
      const once = resolveEstimatePatch(NONE, c);
      expect(normalizeEstimate(estimateStateFromFields(once))).toEqual(once);
    }
  });
});

describe('Copilot review: a new total is never undone by old amounts', () => {
  it('a smaller total drops a partial split that no longer fits', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300, sandwichTypes: [{ type: 'deli', quantity: 200 }, { type: 'pbj', quantity: 0 }] },
      { estimatedSandwichCount: 100 }
    );
    expect(out.estimatedSandwichCount).toBe(100);
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }]);
  });

  it('a partial split that still fits is kept', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300, sandwichTypes: [{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 0 }] },
      { estimatedSandwichCount: 250 }
    );
    expect(out.estimatedSandwichCount).toBe(250);
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 0 }]);
  });

  it('clearing the total clears a complete split instead of re-adding it', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 50 }] },
      { estimatedSandwichCount: null, estimatedSandwichCountMin: null, estimatedSandwichCountMax: null }
    );
    expect(out.estimatedSandwichCount).toBeNull();
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }]);
  });

  it('the inline editor saving a total keeps the event\'s types', () => {
    // What buildInlineSandwichPatch sends in total mode.
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300, sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }] },
      { estimatedSandwichCount: 300, estimatedSandwichCountMin: null, estimatedSandwichCountMax: null }
    );
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }]);
  });

  it('a types-only edit with amounts TBD keeps the known total', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300 },
      { sandwichTypes: [{ type: 'deli', quantity: 50 }, { type: 'pbj', quantity: 0 }] }
    );
    expect(out.estimatedSandwichCount).toBe(300);
  });
});

describe('Copilot review round 2', () => {
  it('a line quantity edited away from its range midpoint is an exact amount', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 250, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300,
        sandwichTypes: [{ type: 'deli', quantity: 250, min: 200, max: 300 }] },
      { sandwichTypes: [{ type: 'deli', quantity: 400, min: 200, max: 300 }] }
    );
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 400 }]);
    expect(out.estimatedSandwichCount).toBe(400);
  });

  it('an untouched range line still reads as a range', () => {
    const out = resolveEstimatePatch(
      {},
      { sandwichTypes: [{ type: 'deli', quantity: 250, min: 200, max: 300 }] }
    );
    expect(out).toMatchObject({ estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 });
  });

  it('"No specific type" on a range clears the one type', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 250, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300,
        estimatedSandwichRangeType: 'pbj', sandwichTypes: [{ type: 'pbj', quantity: 250, min: 200, max: 300 }] },
      { estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300, estimatedSandwichRangeType: null }
    );
    expect(out.estimatedSandwichRangeType).toBeNull();
    expect(out.sandwichTypes).toBeNull();
    expect(out).toMatchObject({ estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 });
  });

  it('a null range type with an exact total leaves the types alone', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 200, sandwichTypes: [{ type: 'pbj', quantity: 200 }] },
      { estimatedSandwichCount: 300, estimatedSandwichRangeType: null }
    );
    expect(out.sandwichTypes).toEqual([{ type: 'pbj', quantity: 300 }]);
  });

  it('a picked range type replaces several existing types (what the inline editor sends)', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300, sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }] },
      { estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300, estimatedSandwichCount: null,
        estimatedSandwichRangeType: 'deli_turkey', sandwichTypes: [{ type: 'deli_turkey' }] }
    );
    expect(out.estimatedSandwichRangeType).toBe('deli_turkey');
    expect(out.sandwichTypes).toEqual([{ type: 'deli_turkey', quantity: 250, min: 200, max: 300 }]);
  });
});

describe('Copilot review round 3 (previously missed)', () => {
  it('keeps legacy object-shaped breakdowns on a count-only edit', () => {
    const map = resolveEstimatePatch({ estimatedSandwichCount: 200, sandwichTypes: { pbj: 200, deli: 0 } as any }, { estimatedSandwichCount: 300 });
    expect(map.sandwichTypes).toEqual([{ type: 'pbj', quantity: 300 }]);
    const keyed = resolveEstimatePatch(
      { estimatedSandwichCount: 200, sandwichTypes: { 0: { type: 'deli', quantity: 200 } } as any },
      { estimatedSandwichCount: 300 }
    );
    expect(keyed.sandwichTypes).toEqual([{ type: 'deli', quantity: 300 }]);
  });

  it('an Unknown-type amount still counts toward the total', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 200 },
      { sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'Unknown', quantity: 50 }] }
    );
    expect(out.estimatedSandwichCount).toBe(200);
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 50 }]);
    // Only Unknown rows with no amount: still no type at all.
    expect(resolveEstimatePatch({ estimatedSandwichCount: 200 }, { sandwichTypes: [{ type: 'unknown', quantity: 0 }] }).sandwichTypes).toBeNull();
  });

  it('clearing a ranged amount to 0 makes it TBD instead of restoring the range', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 350, estimatedSandwichCountMin: 300, estimatedSandwichCountMax: 400 },
      { sandwichTypes: [
        { type: 'deli', quantity: 0, min: 100, max: 150 },
        { type: 'pbj', quantity: 225, min: 200, max: 250 },
      ] }
    );
    expect(out.sandwichTypes).toEqual([
      { type: 'deli', quantity: 0 },
      { type: 'pbj', quantity: 225, min: 200, max: 250 },
    ]);
    expect(out).toMatchObject({ estimatedSandwichCountMin: 300, estimatedSandwichCountMax: 400 });
  });

  it('a known amount and a TBD duplicate of the same type stay incomplete', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300 },
      { sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'deli', quantity: 0 }] }
    );
    expect(out.estimatedSandwichCount).toBe(300);
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 150 }, { type: 'deli', quantity: 0 }]);
    // Two known amounts of one type still add up.
    const sum = resolveEstimatePatch({}, { sandwichTypes: [{ type: 'deli', quantity: 100 }, { type: 'deli', quantity: 50 }] });
    expect(sum.sandwichTypes).toEqual([{ type: 'deli', quantity: 150 }]);
  });
});

describe('Copilot review round 4', () => {
  it('a range type picked with no lines sent replaces several types', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 250, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300,
        sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }] },
      { estimatedSandwichRangeType: 'deli_turkey' }
    );
    expect(out.sandwichTypes).toEqual([{ type: 'deli_turkey', quantity: 250, min: 200, max: 300 }]);
    expect(out.estimatedSandwichRangeType).toBe('deli_turkey');
  });
});

describe('Copilot review round 5: an untyped remainder', () => {
  it('150 Deli + Unknown (no amount) keeps a known 300 total', () => {
    const out = resolveEstimatePatch(
      { estimatedSandwichCount: 300 },
      { sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'Unknown', quantity: 0 }] }
    );
    expect(out.estimatedSandwichCount).toBe(300);
    expect(out.sandwichTypes).toEqual([{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 0 }]);
  });

  it('a total-only edit keeps the remainder untyped on the next read', () => {
    const first = resolveEstimatePatch(
      { estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 50 }] },
      { estimatedSandwichCount: 100 }
    );
    expect(first.sandwichTypes).toEqual([{ type: 'deli', quantity: 0 }, { type: 'unknown', quantity: 0 }]);
    // Read back and saved again unchanged: Deli is NOT given the whole total.
    const again = resolveEstimatePatch(first, { estimatedSandwichCount: 100 });
    expect(again.sandwichTypes).toEqual([{ type: 'deli', quantity: 0 }, { type: 'unknown', quantity: 0 }]);
  });
});
