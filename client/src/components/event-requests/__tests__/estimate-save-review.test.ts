jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));

import { dropUnchangedFields } from '../form-utils';
import { sandwichTypeChoiceValue } from '../constants';

describe('changed-fields save keeps the whole estimate together', () => {
  const baseline = {
    estimatedSandwichCount: 300,
    estimatedSandwichCountMin: null,
    estimatedSandwichCountMax: null,
    estimatedSandwichRangeType: null,
    sandwichTypes: JSON.stringify([{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 0 }]),
    planningNotes: 'x',
  };

  it('clearing just the total still sends the unchanged split', () => {
    const data = { ...baseline, estimatedSandwichCount: null };
    dropUnchangedFields(data, baseline);
    expect(data).toHaveProperty('sandwichTypes', baseline.sandwichTypes);
    expect(data).toHaveProperty('estimatedSandwichCount', null);
    expect(data).not.toHaveProperty('planningNotes');
  });

  it('an untouched estimate sends nothing', () => {
    const data = { ...baseline, planningNotes: 'changed' };
    dropUnchangedFields(data, baseline);
    expect(Object.keys(data)).toEqual(['planningNotes']);
  });

  it('keeps explicit overrides even when unchanged', () => {
    const data = { ...baseline, standbyExpectedDate: null };
    dropUnchangedFields(data, { ...baseline, standbyExpectedDate: null }, { standbyExpectedDate: null });
    expect(data).toHaveProperty('standbyExpectedDate', null);
  });
});

describe('older sandwich types in pickers', () => {
  it('shows older meat types as Deli without changing the stored value', () => {
    expect(sandwichTypeChoiceValue('deli_turkey')).toBe('deli');
    expect(sandwichTypeChoiceValue('deli_ham')).toBe('deli');
    expect(sandwichTypeChoiceValue('pbj')).toBe('pbj');
    expect(sandwichTypeChoiceValue('unknown')).toBeUndefined();
    expect(sandwichTypeChoiceValue(undefined)).toBeUndefined();
  });
});
