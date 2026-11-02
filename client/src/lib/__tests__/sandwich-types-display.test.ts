jest.mock('@/lib/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { formatSandwichTypesDisplay } from '@/lib/sandwich-utils';

describe('formatSandwichTypesDisplay with amounts TBD', () => {
  it('keeps type names when the split is TBD, next to the known total', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }], 300))
      .toBe('300 total: Deli, PB&J (split TBD)');
  });
  it('shows the known total with a partial split', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 0 }], 300))
      .toBe('300 total: 150 Deli, PB&J TBD');
  });
  it('one type with no amount is all of the total', () => {
    expect(formatSandwichTypesDisplay([{ type: 'pbj', quantity: 0 }], 250)).toBe('250 PB&J');
  });
  it('complete breakdowns show as before', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 50 }], 200))
      .toBe('150 Deli, 50 PB&J');
  });
  it('actual counts can opt out: a 0 line just means none', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 200 }, { type: 'pbj', quantity: 0 }], 200, { unknownAmounts: false }))
      .toBe('200 Deli');
  });
});

describe('formatSandwichTypesDisplay with an Unknown amount', () => {
  it('does not give the whole total to the one TBD type', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 0 }, { type: 'unknown', quantity: 50 }], 300))
      .toBe('300 total: 50 type TBD, Deli TBD');
  });
});

describe('formatSandwichTypesDisplay with Unknown rows (round 5)', () => {
  it('shows an Unknown amount even when every type has an amount', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 50 }], 200))
      .toBe('200 total: 150 Deli, 50 type TBD');
  });
  it('an Unknown row with no amount means the rest is untyped', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 0 }], 300))
      .toBe('300 total: 150 Deli, rest type TBD');
  });
  it('Unknown alone is still just the total', () => {
    expect(formatSandwichTypesDisplay([{ type: 'unknown', quantity: 200 }], 200)).toBe('200 total');
  });
  it('actual counts are unchanged', () => {
    expect(formatSandwichTypesDisplay([{ type: 'deli', quantity: 150 }, { type: 'unknown', quantity: 50 }], 200, { unknownAmounts: false }))
      .toBe('150 Deli');
  });
});
