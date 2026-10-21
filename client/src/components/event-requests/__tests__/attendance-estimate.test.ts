jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));

import {
  buildEventDataForServer,
  determineBaselineSandwichMode,
  determineActualSandwichMode,
  resolveEstimatedAttendance,
  normalizeDraftAttendance,
} from '../form-utils';

/**
 * Regression coverage for the duplicate estimated-attendance state.
 *
 * The attendance inputs used to write BOTH `estimatedAttendance` and
 * `volunteerCount` into form state. Any path that touched one without the other
 * (a legacy record, a partial save, a recovered draft) left the two columns
 * disagreeing, and different screens read different columns. Now
 * `estimatedAttendance` is the only attendance value in form state and
 * `volunteerCount` is derived from it in buildEventDataForServer.
 */

const baseFormData: any = {
  eventDate: '2026-06-15',
  backupDates: [],
  sandwichTypes: [],
  totalSandwichCount: 100,
  estimatedSandwichCountMin: 0,
  estimatedSandwichCountMax: 0,
  actualSandwichTypes: [],
  assignedRecipientIds: [],
  speakersNeeded: 0,
  driversNeeded: 0,
  volunteersNeeded: 0,
  estimatedAttendance: 0,
  adultCount: 0,
  childrenCount: 0,
  kidsAgeRange: '',
};

const saveOptions = {
  mode: 'edit' as const,
  hasEventRequest: true,
  eventRequestStatus: 'scheduled',
  sandwichMode: 'total' as const,
  actualSandwichMode: 'total' as const,
};

/**
 * Mirror of buildFormDataFromEventRequest (EventSchedulingForm) for the
 * attendance fields: what form state looks like when an existing event opens.
 */
function initFormDataFromRecord(record: any) {
  return {
    ...baseFormData,
    estimatedAttendance: resolveEstimatedAttendance(record),
    adultCount: record?.adultCount || 0,
    childrenCount: record?.childrenCount || 0,
    kidsAgeRange: record?.kidsAgeRange || '',
  };
}

/**
 * Mirror of the PRE-CHANGE attendance mapping, used to build drafts that were
 * auto-saved before this change shipped: estimatedAttendance initialized to 0
 * with no legacy fallback, and volunteerCount carried alongside it.
 */
function legacyInitFormDataFromRecord(record: any) {
  return {
    ...baseFormData,
    estimatedAttendance: record?.estimatedAttendance || 0,
    volunteerCount: record?.volunteerCount || 0,
    adultCount: record?.adultCount || 0,
    childrenCount: record?.childrenCount || 0,
    kidsAgeRange: record?.kidsAgeRange || '',
  };
}

/**
 * Mirror of intelligentMergeFormData (EventSchedulingForm), which is module-local.
 * Auto-save recovery merges the user's draft against the server snapshot the
 * draft was taken from: when both sides moved, the server wins.
 */
function mergeDraft(
  cachedFormData: Record<string, any>,
  originalServerData: Record<string, any>,
  currentServerData: Record<string, any>,
) {
  const mergedData: Record<string, any> = { ...currentServerData };
  const conflicts: string[] = [];

  const valuesEqual = (a: any, b: any) => {
    const normalize = (v: any) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    };
    return normalize(a) === normalize(b);
  };

  for (const key of Object.keys(cachedFormData)) {
    const userChanged = !valuesEqual(cachedFormData[key], originalServerData[key]);
    const serverChanged = !valuesEqual(currentServerData[key], originalServerData[key]);
    if (userChanged && serverChanged) {
      conflicts.push(key);
      mergedData[key] = currentServerData[key];
    } else if (userChanged) {
      mergedData[key] = cachedFormData[key];
    } else if (serverChanged) {
      mergedData[key] = currentServerData[key];
    }
  }
  return { mergedData, conflicts };
}

/** Recovery as it runs in production: normalize both halves, then merge. */
function recoverDraft(draft: { formData: any; originalServerData: any }, record: any) {
  return mergeDraft(
    normalizeDraftAttendance(draft.formData),
    normalizeDraftAttendance(draft.originalServerData),
    initFormDataFromRecord(record),
  );
}

/**
 * Mirror of performSubmit's diff-based save: re-serialize the baseline (server)
 * snapshot through the same builder and drop every key whose value is unchanged.
 */
function diffSave(originalFormData: any, currentFormData: any) {
  const eventData = buildEventDataForServer(currentFormData, saveOptions);
  const baselineData = buildEventDataForServer(originalFormData, {
    ...saveOptions,
    sandwichMode: determineBaselineSandwichMode(
      originalFormData.sandwichTypes,
      originalFormData.estimatedSandwichCountMin,
      originalFormData.estimatedSandwichCountMax,
      originalFormData.totalSandwichCount,
    ),
    actualSandwichMode: determineActualSandwichMode(originalFormData.actualSandwichTypes),
  });

  for (const key of Object.keys(eventData)) {
    if (
      Object.prototype.hasOwnProperty.call(baselineData, key) &&
      JSON.stringify(eventData[key]) === JSON.stringify(baselineData[key])
    ) {
      delete eventData[key];
    }
  }
  return eventData;
}

describe('resolveEstimatedAttendance (reading existing records)', () => {
  it('uses estimatedAttendance when it is populated', () => {
    expect(resolveEstimatedAttendance({ estimatedAttendance: 45, volunteerCount: 45 })).toBe(45);
  });

  it('falls back to volunteerCount for legacy records that only populated it', () => {
    expect(resolveEstimatedAttendance({ estimatedAttendance: null, volunteerCount: 30 })).toBe(30);
    expect(resolveEstimatedAttendance({ volunteerCount: 30 })).toBe(30);
  });

  it('prefers estimatedAttendance when the two columns disagree', () => {
    expect(resolveEstimatedAttendance({ estimatedAttendance: 50, volunteerCount: 15 })).toBe(50);
    expect(resolveEstimatedAttendance({ estimatedAttendance: 15, volunteerCount: 50 })).toBe(15);
  });

  it('treats a zeroed estimatedAttendance as unset and still finds a legacy count', () => {
    expect(resolveEstimatedAttendance({ estimatedAttendance: 0, volunteerCount: 12 })).toBe(12);
  });

  it('returns 0 when neither column has a count', () => {
    expect(resolveEstimatedAttendance({ estimatedAttendance: null, volunteerCount: null })).toBe(0);
    expect(resolveEstimatedAttendance({})).toBe(0);
    expect(resolveEstimatedAttendance(null)).toBe(0);
    expect(resolveEstimatedAttendance(undefined)).toBe(0);
  });
});

describe('creating an attendance estimate', () => {
  it('writes the typed total to estimatedAttendance and mirrors it to volunteerCount', () => {
    const payload = buildEventDataForServer(
      { ...baseFormData, estimatedAttendance: 40 },
      { ...saveOptions, mode: 'create', hasEventRequest: false },
    );
    expect(payload.estimatedAttendance).toBe(40);
    expect(payload.volunteerCount).toBe(40);
  });

  it('sends no attendance count when the field was never filled in', () => {
    const payload = buildEventDataForServer(baseFormData, {
      ...saveOptions,
      mode: 'create',
      hasEventRequest: false,
    });
    expect(payload.estimatedAttendance).toBeNull();
    expect(payload.volunteerCount).toBeNull();
  });

  it('mirrors the adults + children total from breakdown mode', () => {
    // Breakdown inputs set estimatedAttendance to the sum; volunteerCount follows.
    const payload = buildEventDataForServer(
      { ...baseFormData, adultCount: 12, childrenCount: 8, estimatedAttendance: 20, kidsAgeRange: '5-12' },
      { ...saveOptions, mode: 'create', hasEventRequest: false },
    );
    expect(payload.estimatedAttendance).toBe(20);
    expect(payload.volunteerCount).toBe(20);
    expect(payload.adultCount).toBe(12);
    expect(payload.childrenCount).toBe(8);
    expect(payload.kidsAgeRange).toBe('5-12');
  });

  it('never derives volunteerCount from anything but estimatedAttendance', () => {
    // A stale volunteerCount left in a recovered draft must not influence the save.
    const payload = buildEventDataForServer(
      { ...baseFormData, estimatedAttendance: 25, volunteerCount: 999 },
      { ...saveOptions, mode: 'create', hasEventRequest: false },
    );
    expect(payload.volunteerCount).toBe(25);
  });
});

describe('editing an attendance estimate', () => {
  it('sends both columns when the estimate changes', () => {
    const record = { estimatedAttendance: 20, volunteerCount: 20 };
    const original = initFormDataFromRecord(record);
    const payload = diffSave(original, { ...original, estimatedAttendance: 35 });

    expect(payload.estimatedAttendance).toBe(35);
    expect(payload.volunteerCount).toBe(35);
  });

  it('backfills estimatedAttendance on a legacy record once the estimate is edited', () => {
    // Legacy row: the count only ever landed in volunteerCount.
    const record = { estimatedAttendance: null, volunteerCount: 30 };
    const original = initFormDataFromRecord(record);
    expect(original.estimatedAttendance).toBe(30);

    const payload = diffSave(original, { ...original, estimatedAttendance: 32 });
    expect(payload.estimatedAttendance).toBe(32);
    expect(payload.volunteerCount).toBe(32);
  });

  it('does not touch a legacy record that the user opened but did not edit', () => {
    // No silent migration: opening a legacy row must not rewrite its columns.
    const original = initFormDataFromRecord({ estimatedAttendance: null, volunteerCount: 30 });
    const payload = diffSave(original, { ...original });

    expect(payload).not.toHaveProperty('estimatedAttendance');
    expect(payload).not.toHaveProperty('volunteerCount');
  });

  it('heals a record whose two columns disagree when the estimate is edited', () => {
    const original = initFormDataFromRecord({ estimatedAttendance: 50, volunteerCount: 15 });
    // The form opened on the authoritative value, not the legacy one.
    expect(original.estimatedAttendance).toBe(50);

    const payload = diffSave(original, { ...original, estimatedAttendance: 60 });
    expect(payload.estimatedAttendance).toBe(60);
    expect(payload.volunteerCount).toBe(60);
  });

  it('leaves a disagreeing record alone until someone edits the estimate', () => {
    const original = initFormDataFromRecord({ estimatedAttendance: 50, volunteerCount: 15 });
    const payload = diffSave(original, { ...original });

    expect(payload).not.toHaveProperty('estimatedAttendance');
    expect(payload).not.toHaveProperty('volunteerCount');
  });

  it('keeps the breakdown and kids age range when only the breakdown changes', () => {
    const original = initFormDataFromRecord({
      estimatedAttendance: 20,
      volunteerCount: 20,
      adultCount: 12,
      childrenCount: 8,
      kidsAgeRange: '5-12',
    });
    // User bumps children 8 -> 10; the inputs recompute the total.
    const payload = diffSave(original, { ...original, childrenCount: 10, estimatedAttendance: 22 });

    expect(payload.estimatedAttendance).toBe(22);
    expect(payload.volunteerCount).toBe(22);
    expect(payload.childrenCount).toBe(10);
    expect(payload).not.toHaveProperty('adultCount');
    expect(payload).not.toHaveProperty('kidsAgeRange');

    // The untouched fields still serialize to their historical values.
    const full = buildEventDataForServer({ ...original, childrenCount: 10, estimatedAttendance: 22 }, saveOptions);
    expect(full.adultCount).toBe(12);
    expect(full.kidsAgeRange).toBe('5-12');
  });
});

describe('clearing an attendance estimate', () => {
  it('clears both columns, and the diff actually sends the clears', () => {
    const original = initFormDataFromRecord({ estimatedAttendance: 50, volunteerCount: 50 });
    // Emptying the number input parses to 0 in form state.
    const payload = diffSave(original, { ...original, estimatedAttendance: 0, adultCount: 0, childrenCount: 0 });

    expect(payload).toHaveProperty('estimatedAttendance');
    expect(payload.estimatedAttendance).toBeNull();
    expect(payload).toHaveProperty('volunteerCount');
    expect(payload.volunteerCount).toBeNull();
  });

  it('clears the legacy column too when only it had a count', () => {
    const original = initFormDataFromRecord({ estimatedAttendance: null, volunteerCount: 30 });
    const payload = diffSave(original, { ...original, estimatedAttendance: 0 });

    expect(payload.estimatedAttendance).toBeNull();
    expect(payload.volunteerCount).toBeNull();
  });

  it('preserves the kids age range when the attendance estimate is cleared', () => {
    const original = initFormDataFromRecord({
      estimatedAttendance: 20,
      volunteerCount: 20,
      adultCount: 12,
      childrenCount: 8,
      kidsAgeRange: '5-12',
    });
    const payload = buildEventDataForServer(
      { ...original, estimatedAttendance: 0, adultCount: 0, childrenCount: 0 },
      saveOptions,
    );
    expect(payload.estimatedAttendance).toBeNull();
    expect(payload.volunteerCount).toBeNull();
    expect(payload.kidsAgeRange).toBe('5-12');
  });
});

describe('reopening an event after an attendance estimate was saved', () => {
  it('round-trips the saved estimate and sends nothing on an untouched save', () => {
    const firstSave = buildEventDataForServer({ ...baseFormData, estimatedAttendance: 40 }, saveOptions);

    // Reopen from what the server now holds.
    const reopened = initFormDataFromRecord(firstSave);
    expect(reopened.estimatedAttendance).toBe(40);

    expect(diffSave(reopened, { ...reopened })).not.toHaveProperty('estimatedAttendance');
    expect(diffSave(reopened, { ...reopened })).not.toHaveProperty('volunteerCount');
  });

  it('reopens a cleared estimate as empty, not as the old legacy count', () => {
    const cleared = buildEventDataForServer({ ...baseFormData, estimatedAttendance: 0 }, saveOptions);
    expect(cleared.estimatedAttendance).toBeNull();
    expect(cleared.volunteerCount).toBeNull();

    const reopened = initFormDataFromRecord(cleared);
    expect(reopened.estimatedAttendance).toBe(0);
  });

  it('round-trips a breakdown estimate, including historical kids age range', () => {
    const saved = buildEventDataForServer(
      { ...baseFormData, adultCount: 12, childrenCount: 8, estimatedAttendance: 20, kidsAgeRange: 'Elementary school' },
      saveOptions,
    );
    const reopened = initFormDataFromRecord(saved);

    expect(reopened.estimatedAttendance).toBe(20);
    expect(reopened.adultCount).toBe(12);
    expect(reopened.childrenCount).toBe(8);
    expect(reopened.kidsAgeRange).toBe('Elementary school');
    expect(diffSave(reopened, { ...reopened })).not.toHaveProperty('volunteerCount');
  });

  it('reopens a legacy breakdown record (volunteerCount only) with its total and breakdown intact', () => {
    const reopened = initFormDataFromRecord({
      estimatedAttendance: null,
      volunteerCount: 15,
      adultCount: 10,
      childrenCount: 5,
      kidsAgeRange: '6-10',
    });

    expect(reopened.estimatedAttendance).toBe(15);
    expect(reopened.adultCount).toBe(10);
    expect(reopened.childrenCount).toBe(5);
    expect(reopened.kidsAgeRange).toBe('6-10');
  });
});

describe('normalizeDraftAttendance', () => {
  it('applies the legacy fallback to a pre-change draft snapshot', () => {
    const normalized = normalizeDraftAttendance({ estimatedAttendance: 0, volunteerCount: 30 });
    expect(normalized.estimatedAttendance).toBe(30);
    expect(normalized).not.toHaveProperty('volunteerCount');
  });

  it('keeps the authoritative value when a pre-change draft has both', () => {
    expect(normalizeDraftAttendance({ estimatedAttendance: 50, volunteerCount: 15 }).estimatedAttendance).toBe(50);
  });

  it('is a no-op for drafts saved after the change', () => {
    const draft = { estimatedAttendance: 40, adultCount: 0 };
    expect(normalizeDraftAttendance(draft)).toBe(draft);
  });

  it('passes through a missing snapshot', () => {
    expect(normalizeDraftAttendance(null)).toBeNull();
    expect(normalizeDraftAttendance(undefined)).toBeUndefined();
  });
});

/**
 * Recovering an auto-saved draft written BEFORE this change.
 *
 * Such a draft recorded its original server snapshot under the old mapping
 * (estimatedAttendance: 0 for a legacy record). Against the new fallback the
 * merge would see the server as having changed attendance 0 -> 30, call the
 * user's unsaved edit a conflict, and resolve it in the server's favour —
 * silently discarding the edit. Drafts live for 24 hours, so this is reachable
 * for a day after deploy.
 */
describe('recovering a pre-change draft (24-hour window)', () => {
  const legacyRecord = { estimatedAttendance: null, volunteerCount: 30 };

  function preChangeDraft(record: any, userEdits: Record<string, any> = {}) {
    const original = legacyInitFormDataFromRecord(record);
    return { formData: { ...original, ...userEdits }, originalServerData: original };
  }

  it('preserves an unsaved attendance edit on a legacy record', () => {
    // Pre-change inputs wrote both fields, so the draft carries 40 twice.
    const draft = preChangeDraft(legacyRecord, { estimatedAttendance: 40, volunteerCount: 40 });
    const { mergedData, conflicts } = recoverDraft(draft, legacyRecord);

    expect(mergedData.estimatedAttendance).toBe(40);
    expect(conflicts).not.toContain('estimatedAttendance');
  });

  it('would have lost that edit without normalization (the bug being fixed)', () => {
    const draft = preChangeDraft(legacyRecord, { estimatedAttendance: 40, volunteerCount: 40 });
    const { mergedData, conflicts } = mergeDraft(
      draft.formData,
      draft.originalServerData,
      initFormDataFromRecord(legacyRecord),
    );

    expect(conflicts).toContain('estimatedAttendance');
    expect(mergedData.estimatedAttendance).toBe(30);
  });

  it('shows the legacy count for an untouched draft, with no false conflict', () => {
    const draft = preChangeDraft(legacyRecord);
    const { mergedData, conflicts } = recoverDraft(draft, legacyRecord);

    expect(mergedData.estimatedAttendance).toBe(30);
    expect(conflicts).toEqual([]);
  });

  it('preserves an unsaved clear rather than restoring the legacy count', () => {
    // Clearing the input under the old code zeroed both fields.
    const draft = preChangeDraft(legacyRecord, { estimatedAttendance: 0, volunteerCount: 0 });
    const { mergedData, conflicts } = recoverDraft(draft, legacyRecord);

    expect(mergedData.estimatedAttendance).toBe(0);
    expect(conflicts).toEqual([]);
  });

  it('preserves an unsaved breakdown edit on a legacy record', () => {
    const record = { estimatedAttendance: null, volunteerCount: 15, adultCount: 10, childrenCount: 5, kidsAgeRange: '6-10' };
    const draft = preChangeDraft(record, { childrenCount: 7, estimatedAttendance: 17, volunteerCount: 17 });
    const { mergedData, conflicts } = recoverDraft(draft, record);

    expect(mergedData.estimatedAttendance).toBe(17);
    expect(mergedData.childrenCount).toBe(7);
    expect(mergedData.adultCount).toBe(10);
    expect(mergedData.kidsAgeRange).toBe('6-10');
    expect(conflicts).toEqual([]);
  });

  it('still defers to the server when attendance really did change elsewhere', () => {
    const draft = preChangeDraft(legacyRecord, { estimatedAttendance: 40, volunteerCount: 40 });
    // Someone else set the estimate to 55 while the draft sat unsaved.
    const { mergedData, conflicts } = recoverDraft(draft, { estimatedAttendance: 55, volunteerCount: 55 });

    expect(conflicts).toContain('estimatedAttendance');
    expect(mergedData.estimatedAttendance).toBe(55);
  });

  it('never carries the legacy key into recovered form state', () => {
    const draft = preChangeDraft(legacyRecord, { estimatedAttendance: 40, volunteerCount: 40 });
    expect(recoverDraft(draft, legacyRecord).mergedData).not.toHaveProperty('volunteerCount');
  });

  it('leaves post-change drafts working unchanged', () => {
    const original = initFormDataFromRecord({ estimatedAttendance: 20, volunteerCount: 20 });
    const draft = { formData: { ...original, estimatedAttendance: 25 }, originalServerData: original };
    const { mergedData, conflicts } = recoverDraft(draft, { estimatedAttendance: 20, volunteerCount: 20 });

    expect(mergedData.estimatedAttendance).toBe(25);
    expect(conflicts).toEqual([]);
  });
});
