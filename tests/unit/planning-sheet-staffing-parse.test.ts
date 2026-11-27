// Stub the DB and logger: importing the sheet service must never open a real
// database connection from a test.
jest.mock('../../server/db', () => ({ db: {} }));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

import {
  PLANNING_SHEET_COLUMNS,
  PLANNING_SHEET_COLUMN_COUNT,
  SHEET_OWNED_COLUMNS,
  keepSheetOwnedColumns,
  blankSheetOwnedColumns,
  assignmentLabelForUnknownId,
  formatStaffingColumn,
  parseStaffingColumn,
} from '../../server/planning-sheet-sync-service';

describe('parseStaffingColumn (reading the sheet)', () => {
  it('reads the letters-only format the old parser missed', () => {
    expect(parseStaffingColumn('D, V')).toEqual({
      driver: { needed: true, assigned: null, isVanDriver: false },
      speaker: { needed: false, assigned: null },
      volunteer: { needed: true, assigned: null },
    });
  });

  it('reads an old "S" (retired speaker role) as a volunteer', () => {
    expect(parseStaffingColumn('S: Ann').volunteer).toEqual({ needed: true, assigned: 'Ann' });
    expect(parseStaffingColumn('S: Ann').speaker).toEqual({ needed: false, assigned: null });
  });

  it('round-trips what the push writes', () => {
    const info = {
      driver: { needed: true, assigned: 'Katie Long, Kim Lee', isVanDriver: true },
      speaker: { needed: false, assigned: null },
      volunteer: { needed: true, assigned: null },
    };
    expect(parseStaffingColumn(formatStaffingColumn(info))).toEqual(info);
  });

  it('reads "&" name lists and blank cells', () => {
    expect(parseStaffingColumn('V: Ann & Bo').volunteer).toEqual({ needed: true, assigned: 'Ann, Bo' });
    expect(parseStaffingColumn('').driver).toEqual({ needed: false, assigned: null, isVanDriver: false });
  });
});

describe('formatStaffingColumn (app -> sheet push)', () => {
  const role = (needed: boolean, names: string[], count: number) => ({
    needed,
    assigned: names.length ? names.join(', ') : null,
    count,
    names,
  });

  it("writes names with a colon and open spots as a colon-less count (the sheet's convention)", () => {
    expect(
      formatStaffingColumn({
        driver: { ...role(true, ['Karen'], 2), isVanDriver: false },
        speaker: { needed: false, assigned: null },
        volunteer: role(true, ['Jane'], 3),
      })
    ).toBe('D: Karen, D1, V: Jane, V2');
  });

  it('writes an open need with no names as a count, and a full role as just the names', () => {
    expect(
      formatStaffingColumn({
        driver: { ...role(true, [], 1), isVanDriver: false },
        speaker: { needed: false, assigned: null },
        volunteer: role(true, ['Jane'], 1),
      })
    ).toBe('D1, V: Jane');
  });

  it('lists every assigned person, even past the count, with no open spots', () => {
    expect(
      formatStaffingColumn({
        driver: { ...role(true, ['Luz', 'Bo'], 1), isVanDriver: true },
        speaker: { needed: false, assigned: null },
        volunteer: role(false, [], 0),
      })
    ).toBe('VD: Luz, Bo');
  });
});

describe('push -> sheet -> app round trip keeps staffing counts', () => {
  // Imported lazily so this file's DB mock is in place first.
  const { buildRowUpdatePlan } = require('../../server/services/planning-sheet-row-update');
  const USERS = [
    { id: 'u-karen', firstName: 'Karen', lastName: 'Ray', displayName: null },
    { id: 'u-jane', firstName: 'Jane', lastName: 'Doe', displayName: null },
  ];
  const event = {
    id: 1, organizationName: 'G', status: 'scheduled', scheduledEventDate: '2026-11-14T12:00:00',
    desiredEventDate: null, eventStartTime: null, eventEndTime: null, pickupTime: null,
    estimatedSandwichCount: null, actualSandwichCount: null, sandwichTypes: null,
    firstName: null, lastName: null, email: null, phone: null, eventAddress: null, deliveryDestination: null,
    driversNeeded: 2, speakersNeeded: 0, volunteersNeeded: 3, vanDriverNeeded: false,
    assignedDriverIds: ['u-karen'], assignedSpeakerIds: null, assignedVolunteerIds: ['u-jane'],
    driverDetails: null, speakerDetails: null, volunteerDetails: null,
  };

  it('reading back what the push wrote changes nothing', () => {
    const cell = formatStaffingColumn({
      driver: { needed: true, assigned: 'Karen Ray', isVanDriver: false, count: 2, names: ['Karen Ray'] },
      speaker: { needed: false, assigned: null },
      volunteer: { needed: true, assigned: 'Jane Doe', count: 3, names: ['Jane Doe'] },
    });
    const plan = buildRowUpdatePlan(event, { date: '2026-11-14', 'Group Name': 'G', Staffing: cell }, USERS);
    expect(plan.updates.driversNeeded).toBeUndefined();
    expect(plan.updates.volunteersNeeded).toBeUndefined();
    expect(plan.updates.assignedDriverIds).toBeUndefined();
    expect(plan.updates.assignedVolunteerIds).toBeUndefined();
  });
});

describe('assignmentLabelForUnknownId (app -> sheet push)', () => {
  it('writes free-text assignee names back as typed, not "Unknown"', () => {
    expect(assignmentLabelForUnknownId('Stranger')).toBe('Stranger');
    expect(assignmentLabelForUnknownId('Ann Jones')).toBe('Ann Jones');
  });
  it('keeps "Unknown" for an ID with no matching user', () => {
    expect(assignmentLabelForUnknownId('user_1714000000000_ab12cd3ef')).toBe('Unknown');
    expect(assignmentLabelForUnknownId('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90')).toBe('Unknown');
    expect(assignmentLabelForUnknownId('42')).toBe('Unknown');
    expect(assignmentLabelForUnknownId('')).toBe('Unknown');
  });
});

describe('sheet-owned columns (live layout, Nov 2026)', () => {
  it('maps O/P/AA/AB to the live headers and marks them sheet-owned', () => {
    expect(PLANNING_SHEET_COLUMNS.TOTAL_IN_APP).toBe(14);
    expect(PLANNING_SHEET_COLUMNS.FOLLOW_UP_EMAIL_SENT).toBe(15);
    expect(PLANNING_SHEET_COLUMNS.SYNC_ID).toBe(26);
    expect(PLANNING_SHEET_COLUMNS.UNLABELED_AB).toBe(27);
    expect([...SHEET_OWNED_COLUMNS].sort((a, b) => a - b)).toEqual([14, 15, 26, 27]);
  });

  it('a push never overwrites sync_id or the other sheet-owned cells', () => {
    const appRow = new Array(PLANNING_SHEET_COLUMN_COUNT).fill('app');
    const sheetRow = new Array(PLANNING_SHEET_COLUMN_COUNT).fill('sheet');
    sheetRow[26] = 'c5432e45-9a1c-4ecf-b849-36446f10b604';
    const out = keepSheetOwnedColumns(appRow, sheetRow);
    expect(out[26]).toBe('c5432e45-9a1c-4ecf-b849-36446f10b604');
    expect(out[14]).toBe('sheet');
    expect(out[15]).toBe('sheet');
    expect(out[27]).toBe('sheet');
    expect(out[2]).toBe('app'); // everything else is the app's row
    expect(appRow[26]).toBe('app'); // input not mutated
  });
});

describe('queued proposals never write sheet-owned columns', () => {
  it('blanks O/P/AA/AB on a row the app creates, leaving the rest', () => {
    const queued = new Array(PLANNING_SHEET_COLUMN_COUNT).fill('x');
    queued[15] = 'Yes'; // old Social Post value
    queued[27] = 'Confirm time'; // old Waiting On value
    const out = blankSheetOwnedColumns(queued);
    expect([out[14], out[15], out[26], out[27]]).toEqual(['', '', '', '']);
    expect(out[2]).toBe('x');
    expect(queued[15]).toBe('Yes'); // input not mutated
  });
});
