// Stub the DB and logger: importing the sheet service must never open a real
// database connection from a test.
jest.mock('../../server/db', () => ({ db: {} }));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

import {
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
