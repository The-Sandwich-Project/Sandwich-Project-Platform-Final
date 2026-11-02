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
