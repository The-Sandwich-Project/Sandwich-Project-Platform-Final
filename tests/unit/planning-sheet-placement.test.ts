import {
  computeSheetPlacement,
  parsePlanningSheetDate,
  parsePlanningSheetTime,
  parseVanNeededForCell,
  formatVanNeededForCell,
  planningSheetColumnLetter,
  PLANNING_SHEET_COLUMNS,
  PLANNING_SHEET_COLUMN_COUNT,
  PLANNING_SHEET_LAST_COLUMN,
  PlanningSheetSyncService,
  type PlanningSheetRow,
} from '../../server/planning-sheet-sync-service';

function makeRow(
  rowIndex: number,
  date: string,
  overrides: Partial<PlanningSheetRow> = {}
): PlanningSheetRow {
  return {
    rowIndex,
    date,
    dayOfWeek: '',
    groupName: `Group ${rowIndex}`,
    eventStartTime: '',
    eventEndTime: '',
    pickUpTime: '',
    pickUpNextDay: '',
    allDetails: '',
    vanBooked: '',
    vanNeededFor: '',
    staffing: '',
    staffingParsed: {
      driver: { needed: false, assigned: null, isVanDriver: false },
      speaker: { needed: false, assigned: null },
      volunteer: { needed: false, assigned: null },
    },
    estimateSandwiches: '',
    deliOrPbj: '',
    finalSandwiches: '',
    totalInApp: '',
    followUpEmailSent: '',
    sentToolkit: '',
    contactName: '',
    email: '',
    phone: '',
    tspContact: '',
    address: '',
    recipientHost: '',
    afterEventNotes: '',
    cancelled: '',
    notes: '',
    syncId: '',
    unlabeledAB: '',
    ...overrides,
  };
}

/** A year's worth of events in date order, the way the team keeps the sheet. */
const sortedSheet = [
  makeRow(2, '1/15/26'),
  makeRow(3, '3/14/26'),
  makeRow(4, '6/2/26'),
  makeRow(5, '10/20/26'),
  makeRow(6, '12/5/26'),
];

describe('parsePlanningSheetDate', () => {
  it('reads the formats the sheet actually contains', () => {
    expect(parsePlanningSheetDate('3/14/26')).toEqual(new Date(2026, 2, 14));
    expect(parsePlanningSheetDate('3/14/2026')).toEqual(new Date(2026, 2, 14));
    expect(parsePlanningSheetDate('03/14/2026')).toEqual(new Date(2026, 2, 14));
    expect(parsePlanningSheetDate('Mar 14, 2026')).toEqual(new Date(2026, 2, 14));
  });

  it('applies the sheet year to cells that omit it', () => {
    // Without the hint these resolve to 2001 and sort before every real event.
    expect(parsePlanningSheetDate('3/14', 2026)).toEqual(new Date(2026, 2, 14));
    expect(parsePlanningSheetDate('Mar 14', 2026)).toEqual(new Date(2026, 2, 14));
  });

  it('keeps a written-out year even when it looks mistyped', () => {
    // The whole point is to surface these, not quietly correct them into
    // looking right.
    expect(parsePlanningSheetDate('12/1/2029', 2026)).toEqual(new Date(2029, 11, 1));
    expect(parsePlanningSheetDate('Jan 15, 2020', 2026)).toEqual(new Date(2020, 0, 15));
  });

  it('returns null for cells that are not dates', () => {
    expect(parsePlanningSheetDate('')).toBeNull();
    expect(parsePlanningSheetDate('   ')).toBeNull();
    expect(parsePlanningSheetDate('TBD')).toBeNull();
  });

  it('rejects dates that do not exist instead of rolling them over', () => {
    // new Date(2026, 1, 31) would silently become March 3.
    expect(parsePlanningSheetDate('2/31/26')).toBeNull();
    expect(parsePlanningSheetDate('13/1/26')).toBeNull();
    expect(parsePlanningSheetDate('3/32/26')).toBeNull();
  });

  it('rejects numeric cells that are too mangled to trust', () => {
    // parseInt would read "14x" as 14 and treat the cell as a real date.
    expect(parsePlanningSheetDate('3/14x/26')).toBeNull();
    // The native parser reads this as March 26, 2001 if given the chance.
    expect(parsePlanningSheetDate('3//26')).toBeNull();
    expect(parsePlanningSheetDate('3//26', 2026)).toBeNull();
    expect(parsePlanningSheetDate('//')).toBeNull();
  });

  it('still reads a date the team marked as unconfirmed', () => {
    // "3/14/26?" means the date isn't settled yet. It should still order as
    // March 14 — calling it undated would make the row invisible to placement.
    expect(parsePlanningSheetDate('3/14/26?')).toEqual(new Date(2026, 2, 14));
  });
});

describe('parsePlanningSheetTime', () => {
  it('reads the formats the sheet and the app produce', () => {
    expect(parsePlanningSheetTime('2:00 PM')).toBe(14 * 60);
    expect(parsePlanningSheetTime('10:30 AM')).toBe(10 * 60 + 30);
    expect(parsePlanningSheetTime('12:00 AM')).toBe(0);
    expect(parsePlanningSheetTime('14:00')).toBe(14 * 60);
    expect(parsePlanningSheetTime('09:30:00')).toBe(9 * 60 + 30);
  });

  it('reads the local datetime string pickupDateTime is stored in', () => {
    expect(parsePlanningSheetTime('2026-01-15T14:00:00')).toBe(14 * 60);
  });

  it('returns null for anything it cannot read', () => {
    expect(parsePlanningSheetTime('')).toBeNull();
    expect(parsePlanningSheetTime('afternoon')).toBeNull();
  });
});

/**
 * The sheet as the team actually keeps it: each week opens with an undated
 * "Week of ..." header row, its events follow in date order, and spare slots
 * sit beneath them before the next header.
 */
const weekHeader = (rowIndex: number, label: string) =>
  makeRow(rowIndex, '', { dayOfWeek: `Week of ${label}`, groupName: '' });

const blankSlot = (rowIndex: number) =>
  makeRow(rowIndex, '', { dayOfWeek: '', groupName: '' });

const weeklySheet = [
  weekHeader(362, 'Aug 31'),
  makeRow(363, '9/2/26', { dayOfWeek: 'Wednesday' }),
  makeRow(364, '9/2/26', { dayOfWeek: 'Wednesday' }),
  makeRow(365, '9/6/26', { dayOfWeek: 'Sunday' }),
  weekHeader(366, 'Sep 7'),
  makeRow(367, '9/8/26', { dayOfWeek: 'Tuesday' }),
  makeRow(368, '9/9/26', { dayOfWeek: 'Wednesday' }),
  blankSlot(369),
  weekHeader(370, 'Sep 14'),
  makeRow(371, '9/14/26', { dayOfWeek: 'Monday' }),
];

describe('computeSheetPlacement in a sheet grouped by week', () => {
  // The regression that started this round: anchoring on the previous event
  // put the first event of a week onto its own header row, which reads as the
  // last row of the week before.
  it('puts the first event of a week under that week header, not above it', () => {
    const placement = computeSheetPlacement(weeklySheet, new Date(2026, 8, 7), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(367); // below the "Week of Sep 7" header
    expect(placement.reason).toBe('insert_in_week_block');
    expect(placement.weekBlock).toEqual({ headerRow: 366, label: 'Sep 7' });
  });

  it('keeps the last event of a week above the next week header', () => {
    // 9/13 is still the week of Sep 7, so it must not cross into Sep 14.
    const placement = computeSheetPlacement(weeklySheet, new Date(2026, 8, 13), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(369); // the spare slot in its own week
    expect(placement.weekBlock?.label).toBe('Sep 7');
  });

  it('orders within the week it belongs to', () => {
    const placement = computeSheetPlacement(weeklySheet, new Date(2026, 8, 9), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(369); // after the existing 9/9 row
    expect(placement.weekBlock?.label).toBe('Sep 7');
  });

  it('places an event into an earlier week without disturbing later ones', () => {
    const placement = computeSheetPlacement(weeklySheet, new Date(2026, 8, 3), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(365); // between 9/2 and 9/6
    expect(placement.weekBlock?.label).toBe('Aug 31');
  });

  // The team does not keep a header for every calendar week — a block simply
  // owns every row from its header to the next one, however many weeks that
  // spans. The live sheet has a "Week of Oct 18" block holding events through
  // 10/30 because no Oct 25 header was ever added.
  it('orders within a block that spans more than one week', () => {
    const spanning = [
      weekHeader(418, 'Oct 18'),
      makeRow(419, '10/19/26'),
      makeRow(421, '10/24/26'),
      makeRow(426, '10/30/26'),
      weekHeader(427, 'Nov 1'),
      makeRow(428, '11/4/26'),
    ];

    const placement = computeSheetPlacement(spanning, new Date(2026, 9, 31), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(427); // after 10/30, above the Nov 1 header
    expect(placement.reason).toBe('insert_in_week_block');
    expect(placement.weekBlock?.label).toBe('Oct 18');
    // Nothing alarming to say: this is simply where the sheet puts it.
    expect(placement.note).not.toContain('no "week of" header');
  });

  // A pushed event came out styled as a week header, because Google can only
  // inherit formatting from a neighbouring row and a new row routinely lands
  // next to a header. Placement names an event row to copy instead.
  it('names an event row to copy formatting from, never a week header', () => {
    // Last event of a week: the row below is the next week's header.
    const endOfWeek = computeSheetPlacement(weeklySheet, new Date(2026, 8, 13), {
      fallbackYear: 2026,
    });
    expect(endOfWeek.insertBeforeRow).toBe(369);
    expect(endOfWeek.formatFromRow).toBe(368); // the 9/9 event, not header 370

    // First event of a week: the row above is that week's own header.
    const startOfWeek = computeSheetPlacement(weeklySheet, new Date(2026, 8, 7), {
      fallbackYear: 2026,
    });
    expect(startOfWeek.insertBeforeRow).toBe(367);
    // The 9/8 event in its own week, not header 366 directly above it. Being
    // at the insertion point, it shifts down one when the row goes in, which
    // insertRowAt accounts for.
    expect(startOfWeek.formatFromRow).toBe(367);
  });

  it('orders correctly whatever day the week labels start on', () => {
    // The labels were switched from Saturday-start to Sunday-start, so the
    // placement must not assume either.
    const sundayStart = [
      weekHeader(2, 'Oct 18'), // a Sunday
      makeRow(3, '10/19/26'),
      weekHeader(4, 'Oct 25'), // a Sunday
      makeRow(5, '10/26/26'),
    ];
    expect(
      computeSheetPlacement(sundayStart, new Date(2026, 9, 24), { fallbackYear: 2026 })
        .weekBlock?.label
    ).toBe('Oct 18');

    const saturdayStart = [
      weekHeader(2, 'Oct 17'), // a Saturday
      makeRow(3, '10/19/26'),
      weekHeader(4, 'Oct 24'), // a Saturday
      makeRow(5, '10/26/26'),
    ];
    expect(
      computeSheetPlacement(saturdayStart, new Date(2026, 9, 24), { fallbackYear: 2026 })
        .weekBlock?.label
    ).toBe('Oct 24');
  });

  it('starts a week that has a header but no events yet', () => {
    const emptyWeek = [
      weekHeader(436, 'Nov 23'),
      makeRow(437, '11/23/26'),
      blankSlot(438),
      weekHeader(440, 'Nov 30'),
      blankSlot(441),
    ];
    const placement = computeSheetPlacement(emptyWeek, new Date(2026, 11, 2), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(441); // directly under the Nov 30 header
    expect(placement.weekBlock?.label).toBe('Nov 30');
  });

  it('reads a December header at the top of the sheet as the previous year', () => {
    // A "2026 Groups" tab opens with the tail of 2025.
    const yearBoundary = [
      weekHeader(2, 'Dec 29'),
      makeRow(3, '12/30/25'),
      weekHeader(4, 'Jan 5'),
      makeRow(5, '1/5/26'),
    ];
    const placement = computeSheetPlacement(yearBoundary, new Date(2025, 11, 31), {
      fallbackYear: 2026,
    });
    // Inside the Dec 29 week rather than pushed into the Jan 5 one, which is
    // where it would land if the header were read as Dec 29 2026.
    expect(placement.insertBeforeRow).toBe(4);
    expect(placement.weekBlock?.label).toBe('Dec 29');
  });

  it('is still not hijacked by a mistyped year in another week', () => {
    const withTypo = weeklySheet.map(r =>
      r.rowIndex === 363 ? makeRow(363, '12/1/2029') : r
    );
    const placement = computeSheetPlacement(withTypo, new Date(2026, 8, 7), {
      fallbackYear: 2026,
    });
    expect(placement.insertBeforeRow).toBe(367);
    expect(placement.weekBlock?.label).toBe('Sep 7');
  });
});

describe('computeSheetPlacement', () => {
  it('inserts directly below the event it follows', () => {
    const placement = computeSheetPlacement(sortedSheet, new Date(2026, 6, 4));
    expect(placement.insertBeforeRow).toBe(5); // after 6/2/26 (row 4), before 10/20/26
    expect(placement.reason).toBe('insert_after_previous_event');
  });

  it('inserts at the top when the event precedes everything', () => {
    const placement = computeSheetPlacement(sortedSheet, new Date(2026, 0, 1));
    expect(placement.insertBeforeRow).toBe(2);
    expect(placement.reason).toBe('insert_before_later_event');
  });

  // Without week headers there is nothing to anchor to but the neighbouring
  // dates, so the row is tucked directly beneath the event it follows and
  // above any undated rows that come after it.
  it('sits directly beneath the previous event, above any undated rows', () => {
    const undatedGap = [
      makeRow(363, '9/2/26'),
      makeRow(365, '9/6/26'),
      makeRow(366, '', { groupName: '' }),
      makeRow(367, '9/8/26'),
      makeRow(368, '9/9/26'),
    ];

    const placement = computeSheetPlacement(undatedGap, new Date(2026, 8, 7));
    expect(placement.insertBeforeRow).toBe(366);
    expect(placement.reason).toBe('insert_after_previous_event');
    expect(placement.note).toContain('follow before the next event');
  });

  it('fills undated slots left between two events', () => {
    const withSlots = [
      makeRow(419, '10/24/26'),
      makeRow(420, ''),
      makeRow(421, ''),
      makeRow(425, '11/4/26'),
    ];

    expect(
      computeSheetPlacement(withSlots, new Date(2026, 9, 25)).insertBeforeRow
    ).toBe(420);
  });

  // The bug that started all this: one row mistyped as 2029 is "later" than
  // every event, so scanning from the top for the first later-dated row stopped
  // there every single time and every push landed on that one row.
  it('is not hijacked by a single mistyped year', () => {
    const withTypo = [
      makeRow(2, '1/15/26'),
      makeRow(3, '2/10/26'),
      makeRow(4, '3/14/26'),
      makeRow(5, '12/1/2029'), // typo — should have been 2026
      makeRow(6, '4/2/26'),
      makeRow(7, '5/8/26'),
      makeRow(8, '6/2/26'),
      makeRow(9, '7/4/26'),
    ];

    const placement = computeSheetPlacement(withTypo, new Date(2026, 5, 20));
    expect(placement.insertBeforeRow).toBe(9); // after 6/2, before 7/4
    expect(placement.outOfOrderRows).toEqual([{ rowIndex: 5, date: '12/1/2029' }]);
    expect(placement.note).toContain('row 5');
  });

  it('is not dragged to the bottom by a stray past date either', () => {
    const withStrayPast = [
      makeRow(2, '1/15/26'),
      makeRow(3, '2/10/26'),
      makeRow(4, '3/14/26'),
      makeRow(5, '4/2/26'),
      makeRow(6, '5/8/26'),
      makeRow(7, '4/18/25'), // typo — should have been 2026
      makeRow(8, '7/4/26'),
      makeRow(9, '8/1/26'),
    ];

    const placement = computeSheetPlacement(withStrayPast, new Date(2026, 5, 20));
    expect(placement.insertBeforeRow).toBe(8); // after 5/8, before 7/4
    // The stray sits above the chosen position and is dated before the event,
    // so it doesn't argue with this placement — nothing to warn about here.
    expect(placement.outOfOrderRows).toEqual([]);
  });

  it('orders by start time within the same date', () => {
    const sameDay = [
      makeRow(2, '3/14/26', { eventStartTime: '9:00 AM' }),
      makeRow(3, '3/14/26', { eventStartTime: '2:00 PM' }),
      makeRow(4, '4/1/26'),
    ];

    expect(
      computeSheetPlacement(sameDay, new Date(2026, 2, 14), { eventTime: '11:00' })
        .insertBeforeRow
    ).toBe(3);
    expect(
      computeSheetPlacement(sameDay, new Date(2026, 2, 14), { eventTime: '8:00' })
        .insertBeforeRow
    ).toBe(2);
    // Later than every event that day: sits below the last of them.
    expect(
      computeSheetPlacement(sameDay, new Date(2026, 2, 14), { eventTime: '18:00' })
        .insertBeforeRow
    ).toBe(4);
  });

  it('falls back to pickup time when a row has no start time', () => {
    const sameDay = [
      makeRow(2, '3/14/26', { pickUpTime: '4:00 PM' }),
      makeRow(3, '4/1/26'),
    ];
    expect(
      computeSheetPlacement(sameDay, new Date(2026, 2, 14), { eventTime: '10:00' })
        .insertBeforeRow
    ).toBe(2);
  });

  it('treats a blank date cell as structure, not as a bad value', () => {
    const withGaps = [
      makeRow(2, '1/15/26'),
      makeRow(3, ''),
      makeRow(4, '10/20/26'),
    ];
    const placement = computeSheetPlacement(withGaps, new Date(2026, 5, 2));
    expect(placement.insertBeforeRow).toBe(3);
    expect(placement.unreadableDates).toHaveLength(0);
  });

  it('appends only when nothing in the sheet is dated later', () => {
    const placement = computeSheetPlacement(sortedSheet, new Date(2026, 11, 31));
    expect(placement.insertBeforeRow).toBeNull();
    expect(placement.reason).toBe('append_event_is_latest');
    expect(placement.lastDatedRow).toEqual({ rowIndex: 6, date: '12/5/26' });
  });

  it('places against year-less date cells using the sheet year', () => {
    // The regression this guards: "10/20" reads as the year 2001, so nothing
    // looks later than the event and every push lands at the bottom.
    const yearless = [makeRow(2, '1/15'), makeRow(3, '10/20'), makeRow(4, '12/5')];

    expect(computeSheetPlacement(yearless, new Date(2026, 5, 2)).insertBeforeRow).toBeNull();
    expect(
      computeSheetPlacement(yearless, new Date(2026, 5, 2), { fallbackYear: 2026 })
        .insertBeforeRow
    ).toBe(3);
  });

  it('reports date cells it could not read when it gives up and appends', () => {
    const unreadable = [
      makeRow(2, 'Nov 3rd?'),
      makeRow(3, 'date TBD'),
      makeRow(4, '1/15/26'),
    ];
    const placement = computeSheetPlacement(unreadable, new Date(2026, 5, 2));

    expect(placement.insertBeforeRow).toBeNull();
    expect(placement.unreadableDates).toEqual([
      { rowIndex: 2, value: 'Nov 3rd?' },
      { rowIndex: 3, value: 'date TBD' },
    ]);
    expect(placement.note).toContain('could not be read');
  });

  it('appends on an empty sheet', () => {
    const placement = computeSheetPlacement([], new Date(2026, 5, 2));
    expect(placement.insertBeforeRow).toBeNull();
    expect(placement.reason).toBe('append_no_dated_rows');
  });
});

/**
 * The formatting copy is the whole point of this change — a pushed row must not
 * come out looking like a week header — and the one bit of arithmetic that can
 * silently get it wrong is the source row shifting down when the insert happens
 * at or above it. So these drive the real Sheets requests through a fake client.
 */
describe('writing a row into the sheet', () => {
  const SHEET_ID = 7;
  const WORKSHEET = '2026 Groups';

  function fakeService(options: { onBatchUpdate?: () => void } = {}) {
    const service = new PlanningSheetSyncService('spreadsheet-1', WORKSHEET) as any;
    const batches: any[][] = [];
    const written: { range: string; values: string[][] }[] = [];

    service.sheets = {
      spreadsheets: {
        get: async () => ({
          data: { sheets: [{ properties: { title: WORKSHEET, sheetId: SHEET_ID } }] },
        }),
        batchUpdate: async ({ resource }: any) => {
          options.onBatchUpdate?.();
          batches.push(resource.requests);
          return {};
        },
        values: {
          update: async ({ range, resource }: any) => {
            written.push({ range, values: resource.values });
            return {};
          },
          append: async () => ({
            data: { updates: { updatedRange: `'${WORKSHEET}'!A480:AB480` } },
          }),
        },
      },
    };
    // Re-pointing pending proposals is exercised separately; it needs a database.
    service.shiftPendingProposalRows = async () => {};

    return { service, batches, written };
  }

  const row = ['10/31/26', 'Saturday', 'Some Group'];

  it('copies formatting from a source row above the insertion point', () => {
    const { service, batches, written } = fakeService();

    return service.insertRowAt(427, row, 426).then((ok: boolean) => {
      expect(ok).toBe(true);

      const [insert, copy] = batches[0];
      expect(insert.insertDimension.range).toMatchObject({
        sheetId: SHEET_ID,
        dimension: 'ROWS',
        startIndex: 426, // 0-indexed row 427
        endIndex: 427,
      });
      expect(insert.insertDimension.inheritFromBefore).toBe(true);

      // Row 426 is above the insert, so it does not move.
      expect(copy.copyPaste.pasteType).toBe('PASTE_FORMAT');
      expect(copy.copyPaste.source).toMatchObject({ startRowIndex: 425, endRowIndex: 426 });
      expect(copy.copyPaste.destination).toMatchObject({ startRowIndex: 426, endRowIndex: 427 });

      expect(written[0].values).toEqual([row]);
    });
  });

  it('follows a source row that the insert pushes down', async () => {
    const { service, batches } = fakeService();
    // Inserting at 367 and copying from 367: that row becomes 368.
    await service.insertRowAt(367, row, 367);

    const copy = batches[0][1];
    expect(copy.copyPaste.source).toMatchObject({ startRowIndex: 367, endRowIndex: 368 });
    expect(copy.copyPaste.destination).toMatchObject({ startRowIndex: 366, endRowIndex: 367 });
  });

  it('does the insert and the formatting in one batch, so neither lands alone', async () => {
    const { service, batches } = fakeService();
    await service.insertRowAt(427, row, 426);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('formats an appended row from the source row', async () => {
    const { service, batches } = fakeService();
    const appendedAt = await service.appendRow(row, 446);

    expect(appendedAt).toBe(480);
    const copy = batches[0][0];
    expect(copy.copyPaste.pasteType).toBe('PASTE_FORMAT');
    expect(copy.copyPaste.source).toMatchObject({ startRowIndex: 445, endRowIndex: 446 });
    expect(copy.copyPaste.destination).toMatchObject({ startRowIndex: 479, endRowIndex: 480 });
  });

  it('still reports the appended row when formatting it fails', async () => {
    // The append has already committed the row, so a failure to restyle it must
    // not surface as a failed push — that would leave the event unmarked and
    // invite a duplicate, or strand an approved proposal as failed.
    const { service } = fakeService({
      onBatchUpdate: () => {
        throw new Error('Google API unavailable');
      },
    });

    await expect(service.appendRow(row, 446)).resolves.toBe(480);
  });
});

describe('planning sheet column map (van needed for insertion)', () => {
  it('puts Van needed for? at J and shifts Staffing through Waiting On one column right', () => {
    expect(PLANNING_SHEET_COLUMNS.VAN_BOOKED).toBe(8);
    expect(PLANNING_SHEET_COLUMNS.VAN_NEEDED_FOR).toBe(9);
    expect(PLANNING_SHEET_COLUMNS.STAFFING).toBe(10);
    expect(PLANNING_SHEET_COLUMNS.UNLABELED_AB).toBe(27);
    expect(PLANNING_SHEET_COLUMNS.SYNC_ID).toBe(26);
    expect(PLANNING_SHEET_COLUMN_COUNT).toBe(28);
    expect(PLANNING_SHEET_LAST_COLUMN).toBe('AB');
    expect(planningSheetColumnLetter(9)).toBe('J');
    expect(planningSheetColumnLetter(27)).toBe('AB');
  });

  it('round-trips Transport / Refrigeration cell values', () => {
    expect(parseVanNeededForCell('Transport')).toBe('transport');
    expect(parseVanNeededForCell('refrigeration during event')).toBe('refrigeration');
    expect(parseVanNeededForCell('')).toBeNull();
    expect(formatVanNeededForCell('transport')).toBe('Transport');
    expect(formatVanNeededForCell('refrigeration')).toBe('Refrigeration');
    expect(formatVanNeededForCell(null)).toBe('');
  });
});
