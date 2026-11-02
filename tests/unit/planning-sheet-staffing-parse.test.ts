// Stub the DB and logger: importing the sheet service must never open a real
// database connection from a test.
jest.mock('../../server/db', () => ({ db: {} }));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

import {
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
