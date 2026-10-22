jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));

import {
  buildEventDataForServer,
  determineSandwichMode,
  determineBaselineSandwichMode,
  determineActualSandwichMode,
  restoreDroppedSandwichClears,
} from '../form-utils';

/**
 * Regression coverage for "the exact count the user typed comes back smaller".
 *
 * The five sandwich columns encode ONE number. Whenever two of them survive
 * together in the DB, some later reader averages the range or sums the
 * breakdown back over the exact count — an entered 500 reappears as 498 (the
 * midpoint of a leftover 490-506, or the sum of a leftover 250 turkey + 248
 * PBJ). These tests pin the rules that keep exactly one representation stored.
 */

const STALE_TYPES = [
  { type: 'turkey', quantity: 250 },
  { type: 'pbj', quantity: 248 },
];

const baseFormData: any = {
  eventDate: '2026-06-15',
  backupDates: [],
  sandwichTypes: [],
  totalSandwichCount: 0,
  estimatedSandwichCountMin: 0,
  estimatedSandwichCountMax: 0,
  actualSandwichTypes: [],
  assignedRecipientIds: [],
  speakersNeeded: 0,
  driversNeeded: 0,
  volunteersNeeded: 0,
};

function build(formData: any, sandwichMode: 'total' | 'range' | 'types') {
  return buildEventDataForServer(
    { ...baseFormData, ...formData },
    {
      mode: 'edit',
      hasEventRequest: true,
      eventRequestStatus: 'scheduled',
      sandwichMode,
      actualSandwichMode: 'total',
    },
  );
}

/** Mirror of the diff-based save in EventSchedulingForm.performSubmit. */
function diffedSave(opts: {
  formData: any;
  sandwichMode: 'total' | 'range' | 'types';
  baselineFormData: any;
  storedEvent: Record<string, any>;
}) {
  const eventData = build(opts.formData, opts.sandwichMode);
  const fullSandwichPayload = { ...eventData };

  const baselineData = build(
    opts.baselineFormData,
    determineBaselineSandwichMode(
      opts.baselineFormData.sandwichTypes,
      opts.baselineFormData.estimatedSandwichCountMin,
      opts.baselineFormData.estimatedSandwichCountMax,
      opts.baselineFormData.totalSandwichCount,
    ),
  );

  for (const key of Object.keys(eventData)) {
    if (
      Object.prototype.hasOwnProperty.call(baselineData, key) &&
      JSON.stringify(eventData[key]) === JSON.stringify(baselineData[key])
    ) {
      delete eventData[key];
    }
  }

  restoreDroppedSandwichClears(eventData, fullSandwichPayload, opts.storedEvent);
  return eventData;
}

describe('determineSandwichMode with a stale breakdown', () => {
  it('opens Exact Count when the breakdown disagrees with the stored count', () => {
    expect(determineSandwichMode(STALE_TYPES, null, null, 500)).toBe('total');
  });

  it('opens Specify Types when the breakdown agrees with the stored count', () => {
    expect(determineSandwichMode(STALE_TYPES, null, null, 498)).toBe('types');
  });

  it('opens Range only for a range that agrees with the stored count', () => {
    expect(determineSandwichMode(null, 490, 506, 498)).toBe('range');
    expect(determineSandwichMode(null, 490, 506, 500)).toBe('total');
  });
});

describe('determineBaselineSandwichMode', () => {
  it('treats a stale breakdown as physically stored so the clear survives the diff', () => {
    // determineSandwichMode says 'total' (the UI opens on the exact count), but
    // the baseline must still serialize the breakdown that is really in the DB.
    expect(determineBaselineSandwichMode(STALE_TYPES, null, null, 500)).toBe('types');
  });

  it('treats a stale range as physically stored', () => {
    expect(determineBaselineSandwichMode(null, 490, 506, 500)).toBe('range');
  });

  it('falls through to the UI mode when nothing stale is stored', () => {
    expect(determineBaselineSandwichMode(null, null, null, 500)).toBe('total');
  });
});

describe('determineActualSandwichMode', () => {
  it('opens the exact actual count when the breakdown disagrees with it', () => {
    expect(determineActualSandwichMode(STALE_TYPES, 500)).toBe('total');
  });

  it('opens types when the breakdown agrees', () => {
    expect(determineActualSandwichMode(STALE_TYPES, 498)).toBe('types');
  });
});

describe('an Exact Count save clears the competing representations', () => {
  it('nulls the breakdown and the range in the payload', () => {
    const payload = build({ totalSandwichCount: 500 }, 'total');
    expect(payload.estimatedSandwichCount).toBe(500);
    expect(payload.sandwichTypes).toBeNull();
    expect(payload.estimatedSandwichCountMin).toBeNull();
    expect(payload.estimatedSandwichCountMax).toBeNull();
    expect(payload.estimatedSandwichRangeType).toBeNull();
  });
});

describe('diff-based save keeps the stale-clearing writes', () => {
  it('clears a stale breakdown even when the count itself did not change', () => {
    // DB: exact 500 with a leftover breakdown summing 498. The user edits
    // something else entirely and saves. Both sides of the diff serialize in
    // 'total' mode, so sandwichTypes is null === null and the clear used to be
    // dropped — leaving the 498 breakdown behind for the next reader.
    const stored = {
      estimatedSandwichCount: 500,
      sandwichTypes: STALE_TYPES,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
      estimatedSandwichRangeType: null,
    };
    const formData = { totalSandwichCount: 500, sandwichTypes: [] };

    const payload = diffedSave({
      formData,
      sandwichMode: 'total',
      baselineFormData: { ...formData, sandwichTypes: STALE_TYPES },
      storedEvent: stored,
    });

    expect(payload).toHaveProperty('sandwichTypes', null);
  });

  it('clears a stale range even when the count itself did not change', () => {
    const stored = {
      estimatedSandwichCount: 500,
      sandwichTypes: null,
      estimatedSandwichCountMin: 490,
      estimatedSandwichCountMax: 506,
      estimatedSandwichRangeType: null,
    };
    const formData = {
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
    };

    const payload = diffedSave({
      formData,
      sandwichMode: 'total',
      baselineFormData: {
        ...formData,
        estimatedSandwichCountMin: 490,
        estimatedSandwichCountMax: 506,
      },
      storedEvent: stored,
    });

    expect(payload).toHaveProperty('estimatedSandwichCountMin', null);
    expect(payload).toHaveProperty('estimatedSandwichCountMax', null);
  });

  it('clears a lone leftover bound that no mode inference treats as a range', () => {
    // Only min persisted: hasActiveSandwichRange needs both bounds, so every
    // mode inference calls this 'total' and the diff dropped the clear.
    const stored = {
      estimatedSandwichCount: 500,
      sandwichTypes: null,
      estimatedSandwichCountMin: 490,
      estimatedSandwichCountMax: null,
      estimatedSandwichRangeType: null,
    };
    const formData = {
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
    };

    const payload = diffedSave({
      formData,
      sandwichMode: 'total',
      baselineFormData: { ...formData, estimatedSandwichCountMin: 490 },
      storedEvent: stored,
    });

    expect(payload).toHaveProperty('estimatedSandwichCountMin', null);
  });

  it('clears a stale range AND breakdown stored together', () => {
    // A baseline mode can only describe one representation, so this case is
    // only reachable via the comparison against the stored record.
    const stored = {
      estimatedSandwichCount: 500,
      sandwichTypes: STALE_TYPES,
      estimatedSandwichCountMin: 490,
      estimatedSandwichCountMax: 506,
      estimatedSandwichRangeType: 'turkey',
    };
    const formData = {
      totalSandwichCount: 500,
      sandwichTypes: [],
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
      rangeSandwichType: '',
    };

    const payload = diffedSave({
      formData,
      sandwichMode: 'total',
      baselineFormData: {
        ...formData,
        sandwichTypes: STALE_TYPES,
        estimatedSandwichCountMin: 490,
        estimatedSandwichCountMax: 506,
        rangeSandwichType: 'turkey',
      },
      storedEvent: stored,
    });

    expect(payload).toHaveProperty('sandwichTypes', null);
    expect(payload).toHaveProperty('estimatedSandwichCountMin', null);
    expect(payload).toHaveProperty('estimatedSandwichCountMax', null);
    expect(payload).toHaveProperty('estimatedSandwichRangeType', null);
  });

  it('does not resurrect sandwich writes for an event that is already clean', () => {
    const stored = {
      estimatedSandwichCount: 500,
      sandwichTypes: null,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
      estimatedSandwichRangeType: null,
    };
    const formData = { totalSandwichCount: 500 };

    const payload = diffedSave({
      formData,
      sandwichMode: 'total',
      baselineFormData: formData,
      storedEvent: stored,
    });

    expect(payload).not.toHaveProperty('estimatedSandwichCount');
    expect(payload).not.toHaveProperty('sandwichTypes');
    expect(payload).not.toHaveProperty('estimatedSandwichCountMin');
    expect(payload).not.toHaveProperty('estimatedSandwichCountMax');
    expect(payload).not.toHaveProperty('estimatedSandwichRangeType');
  });

  it('still sends a genuine count change', () => {
    const stored = {
      estimatedSandwichCount: 400,
      sandwichTypes: null,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
      estimatedSandwichRangeType: null,
    };

    const payload = diffedSave({
      formData: { totalSandwichCount: 500 },
      sandwichMode: 'total',
      baselineFormData: { totalSandwichCount: 400 },
      storedEvent: stored,
    });

    expect(payload).toHaveProperty('estimatedSandwichCount', 500);
  });

  it('leaves a legitimate range save intact', () => {
    const stored = {
      estimatedSandwichCount: null,
      sandwichTypes: null,
      estimatedSandwichCountMin: 400,
      estimatedSandwichCountMax: 600,
      estimatedSandwichRangeType: null,
    };
    const formData = {
      totalSandwichCount: 0,
      estimatedSandwichCountMin: 400,
      estimatedSandwichCountMax: 600,
    };

    const payload = diffedSave({
      formData,
      sandwichMode: 'range',
      baselineFormData: formData,
      storedEvent: stored,
    });

    expect(payload).not.toHaveProperty('estimatedSandwichCountMin');
    expect(payload).not.toHaveProperty('estimatedSandwichCountMax');
  });
});
