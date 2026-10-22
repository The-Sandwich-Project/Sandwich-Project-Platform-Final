jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));

import {
  findMismatchedSavedFields,
  getDroppedServerFields,
  buildEventDataForServer,
  determineSandwichMode,
  determineBaselineSandwichMode,
  determineActualSandwichMode,
  sumSandwichTypeQuantities,
} from '../form-utils';

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
};

// Full-form save (B5) sends the entire buildEventDataForServer() output every
// time, so these assertions check the builder directly. The schedule-mode
// status/date consistency that used to live in detectChangedFields now lives in
// buildEventDataForServer: the scheduled date is attached only when the resolved
// status is 'scheduled'.
function buildScheduleData(formStatus: string | undefined, eventDate?: string) {
  const formData: any = { ...baseFormData, ...(eventDate ? { eventDate } : {}) };
  if (formStatus === undefined) {
    delete formData.status;
  } else {
    formData.status = formStatus;
  }
  return buildEventDataForServer(formData, {
    mode: 'schedule',
    hasEventRequest: true,
    eventRequestStatus: 'in_process',
    sandwichMode: 'total',
    actualSandwichMode: 'total',
  });
}

describe('Mark Scheduled status handling (full-form save)', () => {
  it('defaults the saved status to "scheduled" and includes the scheduled date', () => {
    const payload = buildScheduleData('scheduled');
    expect(payload.status).toBe('scheduled');
    expect(payload.scheduledEventDate).toBe('2026-06-15');
    expect(payload.desiredEventDate).toBe('2026-06-15');
  });

  it('respects an explicit non-scheduled choice (e.g. Standby) and attaches no scheduled date', () => {
    const payload = buildScheduleData('standby');
    expect(payload.status).toBe('standby');
    // No confirmed scheduled date when the user is not actually scheduling.
    expect(payload.scheduledEventDate).toBeUndefined();
    // The desired date still flows through.
    expect(payload.desiredEventDate).toBe('2026-06-15');
  });

  it('does NOT leak scheduledEventDate when status is non-scheduled AND the date changed', () => {
    // Open "Mark Scheduled", pick Standby, and ALSO change the date. The builder
    // must not stamp a confirmed scheduled date alongside a standby status, but
    // the desired date change must still flow through.
    const payload = buildScheduleData('standby', '2026-07-20');
    expect(payload.status).toBe('standby');
    expect(payload.scheduledEventDate).toBeUndefined();
    expect(payload.desiredEventDate).toBe('2026-07-20');
  });

  it('still sends scheduledEventDate when scheduling AND the date changed', () => {
    const payload = buildScheduleData('scheduled', '2026-07-20');
    expect(payload.status).toBe('scheduled');
    expect(payload.scheduledEventDate).toBe('2026-07-20');
  });

  it('falls back to "scheduled" (and attaches the date) when the form has no status set', () => {
    const payload = buildScheduleData(undefined);
    expect(payload.status).toBe('scheduled');
    expect(payload.scheduledEventDate).toBe('2026-06-15');
  });

  it('always includes the critical van/transport booleans (no longer change-detected)', () => {
    // Previously these relied on ALWAYS_INCLUDE_FIELDS to avoid being dropped.
    // Full-form save sends them unconditionally as part of the built payload.
    const payload = buildScheduleData('scheduled');
    expect(payload).toHaveProperty('vanDriverNeeded');
    expect(payload).toHaveProperty('isDhlVan');
    expect(payload).toHaveProperty('selfTransport');
    expect(payload).toHaveProperty('vanNeededFor');
    expect(payload.vanNeededFor).toBeNull();
  });

  it('sends vanNeededFor only when a van is actually needed', () => {
    const withVan = buildEventDataForServer(
      { ...baseFormData, vanDriverNeeded: true, vanNeededFor: 'refrigeration' },
      {
        mode: 'schedule',
        hasEventRequest: true,
        eventRequestStatus: 'in_process',
        sandwichMode: 'total',
        actualSandwichMode: 'total',
      }
    );
    expect(withVan.vanDriverNeeded).toBe(true);
    expect(withVan.vanNeededFor).toBe('refrigeration');

    const selfTransport = buildEventDataForServer(
      { ...baseFormData, selfTransport: true, vanDriverNeeded: true, vanNeededFor: 'transport' },
      {
        mode: 'schedule',
        hasEventRequest: true,
        eventRequestStatus: 'in_process',
        sandwichMode: 'total',
        actualSandwichMode: 'total',
      }
    );
    expect(selfTransport.vanDriverNeeded).toBe(false);
    expect(selfTransport.vanNeededFor).toBeNull();
  });
});

/**
 * Regression coverage for the "Mark Scheduled won't save" bug.
 *
 * A successful (HTTP 200) PATCH used to be treated as a *partial* save — keeping
 * the dialog open and preserving the draft — whenever the heuristic
 * `findMismatchedSavedFields` flagged any field. That heuristic produces false
 * positives for routine server behaviour, so every save looked like it silently
 * failed. The fix: only the server-authoritative `_droppedFields` marker may
 * block save completion.
 */
describe('Mark Scheduled save completion gating', () => {
  it('does NOT block a successful save just because the heuristic comparison flags fields', () => {
    // A realistic PATCH payload sent when marking an event scheduled.
    const sentPayload: Record<string, any> = {
      status: 'scheduled',
      scheduledEventDate: '2026-06-15',
      desiredEventDate: '2026-06-15',
      vanDriverNeeded: false,
      isDhlVan: false,
      selfTransport: false,
      driversNeeded: 0,
      sandwichTypes: JSON.stringify([]),
      assignedRecipientIds: [],
    };

    // A realistic server response: the event WAS saved, but the server transforms
    // / omits some fields (null vs false, auto-bumped counts, join-table arrays,
    // parsed JSON columns). No `_droppedFields` marker => nothing was actually dropped.
    const savedEvent: Record<string, any> = {
      id: 123,
      status: 'scheduled',
      scheduledEventDate: '2026-06-15T12:00:00.000Z',
      desiredEventDate: '2026-06-15T12:00:00.000Z',
      vanDriverNeeded: null, // server stored null, client sent false
      isDhlVan: false,
      selfTransport: false,
      driversNeeded: 2, // server auto-bumped to match assigned drivers
      sandwichTypes: [], // jsonb column returned as a parsed array, not a string
      isConfirmed: true,
      // assignedRecipientIds intentionally absent (stored in a join table)
    };

    // The heuristic comparison flags several fields (this is expected & why it
    // must not be used to block saves)...
    const mismatched = findMismatchedSavedFields(sentPayload, savedEvent);
    expect(mismatched.length).toBeGreaterThan(0);

    // ...but since the server reported no dropped fields, the save must complete.
    expect(getDroppedServerFields(savedEvent)).toEqual([]);
  });

  it('DOES surface a partial save when the server reports dropped fields', () => {
    const savedEvent: Record<string, any> = {
      id: 123,
      status: 'scheduled',
      _droppedFields: [
        { field: 'addedToOfficialSheetAt', reason: 'Database column not available on this branch (migration pending)' },
      ],
    };

    const dropped = getDroppedServerFields(savedEvent);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].field).toBe('addedToOfficialSheetAt');
  });

  it('treats a response with no marker as a clean save', () => {
    expect(getDroppedServerFields({ id: 1, status: 'scheduled' })).toEqual([]);
    expect(getDroppedServerFields(null)).toEqual([]);
    expect(getDroppedServerFields(undefined)).toEqual([]);
  });
});

describe('determineSandwichMode (sandwich count drift)', () => {
  it('prefers Exact Count when stored total disagrees with stale types breakdown', () => {
    expect(
      determineSandwichMode(
        [{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 98 }],
        null,
        null,
        200,
      ),
    ).toBe('total');
  });

  it('uses Specify Types when breakdown matches stored total', () => {
    expect(
      determineSandwichMode(
        [{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 98 }],
        null,
        null,
        198,
      ),
    ).toBe('types');
  });

  it('prefers Exact Count when exact disagrees with stale range midpoint (500 vs 498)', () => {
    expect(
      determineSandwichMode([], 490, 506, 500),
    ).toBe('total');
  });

  it('keeps Range when exact equals the range midpoint (legitimate import)', () => {
    expect(
      determineSandwichMode([], 490, 506, 498),
    ).toBe('range');
  });

  it('keeps Range when there is no exact count', () => {
    expect(
      determineSandwichMode([], 490, 506, null),
    ).toBe('range');
  });

  it('clears types semantics in total-mode full-form save payload', () => {
    const payload = buildEventDataForServer(
      {
        ...baseFormData,
        totalSandwichCount: 200,
        sandwichTypes: [{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 98 }],
      },
      {
        mode: 'edit',
        hasEventRequest: true,
        eventRequestStatus: 'scheduled',
        sandwichMode: 'total',
        actualSandwichMode: 'total',
      },
    );
    expect(payload.estimatedSandwichCount).toBe(200);
    expect(payload.sandwichTypes).toBeNull();
  });

  it('derives estimatedSandwichCount from types in types-mode save', () => {
    const payload = buildEventDataForServer(
      {
        ...baseFormData,
        totalSandwichCount: 200,
        sandwichTypes: [{ type: 'deli', quantity: 100 }, { type: 'pbj', quantity: 98 }],
      },
      {
        mode: 'edit',
        hasEventRequest: true,
        eventRequestStatus: 'scheduled',
        sandwichMode: 'types',
        actualSandwichMode: 'total',
      },
    );
    expect(payload.estimatedSandwichCount).toBe(198);
    expect(sumSandwichTypeQuantities(payload.sandwichTypes)).toBe(198);
  });

  it('total-mode save nulls the range companions too (no stale range survives)', () => {
    const payload = buildEventDataForServer(
      {
        ...baseFormData,
        totalSandwichCount: 500,
        estimatedSandwichCountMin: 490,
        estimatedSandwichCountMax: 506,
        rangeSandwichType: 'deli',
      },
      {
        mode: 'edit',
        hasEventRequest: true,
        eventRequestStatus: 'scheduled',
        sandwichMode: 'total',
        actualSandwichMode: 'total',
      },
    );
    expect(payload.estimatedSandwichCount).toBe(500);
    expect(payload.estimatedSandwichCountMin).toBeNull();
    expect(payload.estimatedSandwichCountMax).toBeNull();
    expect(payload.estimatedSandwichRangeType).toBeNull();
  });

  it('includes cancelledReason when status is cancelled (edit-form MISSING_REASON bug)', () => {
    const payload = buildEventDataForServer(
      {
        ...baseFormData,
        status: 'cancelled',
        cancelledReason: 'Organizer cancelled',
        cancelledNotes: 'Venue fell through',
      },
      {
        mode: 'edit',
        hasEventRequest: true,
        eventRequestStatus: 'scheduled',
        sandwichMode: 'total',
        actualSandwichMode: 'total',
      },
    );
    expect(payload.status).toBe('cancelled');
    expect(payload.cancelledReason).toBe('Organizer cancelled');
    expect(payload.cancelledNotes).toBe('Venue fell through');
  });
});

/**
 * Regression coverage for the "500 saves as 498" bug.
 *
 * A stale estimatedSandwichCountMin/Max left in the DB alongside an exact
 * count used to win on display (range midpoint 498 over exact 500). The
 * diff-based save must therefore SEND the null-out of those range fields when
 * the user switches Range -> Exact Count.
 *
 * The bug was that the diff baseline was serialized in the CURRENT (total) mode,
 * which also nulled min/max — so the diff saw null === null and dropped the
 * clears. The fix serializes the baseline in the ORIGINAL mode. This mirrors the
 * production diff in EventSchedulingForm.performSubmit.
 */
describe('diff-based save clears stale range on Range -> Exact Count (500 -> 498 bug)', () => {
  // Mirror of the production diff: keep only keys whose value differs from the
  // baseline serialized in its ORIGINAL sandwich mode.
  function diffSave(originalFormData: any, currentFormData: any, currentSandwichMode: 'total' | 'range' | 'types') {
    const opts = {
      mode: 'edit' as const,
      hasEventRequest: true,
      eventRequestStatus: 'scheduled',
      actualSandwichMode: 'total' as const,
    };
    const eventData = buildEventDataForServer(currentFormData, { ...opts, sandwichMode: currentSandwichMode });

    const baselineSandwichMode = determineBaselineSandwichMode(
      originalFormData.sandwichTypes,
      originalFormData.estimatedSandwichCountMin,
      originalFormData.estimatedSandwichCountMax,
      originalFormData.totalSandwichCount,
    );
    const baselineActualSandwichMode = determineActualSandwichMode(originalFormData.actualSandwichTypes);
    const baselineData = buildEventDataForServer(originalFormData, {
      ...opts,
      sandwichMode: baselineSandwichMode,
      actualSandwichMode: baselineActualSandwichMode,
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

  it('sends the exact count AND clears the leftover range (midpoint was 498)', () => {
    // Event was originally saved as a 490-506 range (midpoint 498).
    const original = {
      ...baseFormData,
      totalSandwichCount: 0,
      estimatedSandwichCountMin: 490,
      estimatedSandwichCountMax: 506,
      rangeSandwichType: 'deli',
    };
    // User switched to Exact Count and typed 500.
    const current = {
      ...baseFormData,
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
      rangeSandwichType: '',
    };

    const payload = diffSave(original, current, 'total');

    // The exact count is sent...
    expect(payload.estimatedSandwichCount).toBe(500);
    // ...and — the crux of the bug — the stale range is explicitly cleared,
    // instead of being diffed away and left to win on display as 498.
    expect(payload).toHaveProperty('estimatedSandwichCountMin');
    expect(payload.estimatedSandwichCountMin).toBeNull();
    expect(payload).toHaveProperty('estimatedSandwichCountMax');
    expect(payload.estimatedSandwichCountMax).toBeNull();
  });

  it('does not send sandwich fields when nothing changed (no needless clobber)', () => {
    const original = {
      ...baseFormData,
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
    };
    const current = { ...original };

    const payload = diffSave(original, current, 'total');

    expect(payload).not.toHaveProperty('estimatedSandwichCount');
    expect(payload).not.toHaveProperty('estimatedSandwichCountMin');
    expect(payload).not.toHaveProperty('estimatedSandwichCountMax');
  });

  it('heals already-corrupted rows (exact 500 + stale 490-506) on the next Exact Count save', () => {
    // Server still has BOTH from before the client fix. UI opens Exact Count
    // (determineSandwichMode), but the baseline must still serialize as range
    // so the companion clears are not diffed away.
    const original = {
      ...baseFormData,
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 490,
      estimatedSandwichCountMax: 506,
      rangeSandwichType: 'deli',
    };
    const current = {
      ...baseFormData,
      totalSandwichCount: 500,
      estimatedSandwichCountMin: 0,
      estimatedSandwichCountMax: 0,
      rangeSandwichType: '',
    };

    expect(determineSandwichMode(
      original.sandwichTypes,
      original.estimatedSandwichCountMin,
      original.estimatedSandwichCountMax,
      original.totalSandwichCount,
    )).toBe('total');
    expect(determineBaselineSandwichMode(
      original.sandwichTypes,
      original.estimatedSandwichCountMin,
      original.estimatedSandwichCountMax,
      original.totalSandwichCount,
    )).toBe('range');

    const payload = diffSave(original, current, 'total');
    expect(payload.estimatedSandwichCount).toBe(500);
    expect(payload.estimatedSandwichCountMin).toBeNull();
    expect(payload.estimatedSandwichCountMax).toBeNull();
  });
});


describe('Toolkit full-form saves', () => {
  it.each([
    ['sent', false, true], ['received_confirmed', false, true],
    ['not_sent', true, false], ['not_needed', true, false],
  ])('synchronizes %s with the mirrored checkbox', (status, staleFlag, expected) => {
    const payload = buildEventDataForServer({
      ...baseFormData, toolkitStatus: status, toolkitSent: staleFlag,
    }, {
      mode: 'schedule', hasEventRequest: true, eventRequestStatus: 'in_process',
      sandwichMode: 'total', actualSandwichMode: 'total',
    });
    expect(payload.toolkitStatus).toBe(status);
    expect(payload.toolkitSent).toBe(expected);
    expect(payload.toolkitSentDate).toBeNull();
  });
});
