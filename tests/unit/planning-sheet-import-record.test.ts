import {
  buildImportedEventRecord,
  type ImportCandidate,
} from '../../server/routes/planning-sheet-import';
import type { PlanningSheetRow } from '../../server/planning-sheet-sync-service';

function makeRow(overrides: Partial<PlanningSheetRow> = {}): PlanningSheetRow {
  return {
    rowIndex: 5,
    date: '3/14/26',
    dayOfWeek: 'Saturday',
    groupName: 'Test Group',
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
    estimateSandwiches: '200',
    deliOrPbj: '',
    finalSandwiches: '',
    totalInApp: '',
    socialPost: '',
    sentToolkit: '',
    contactName: 'Jane Doe',
    email: '',
    phone: '',
    tspContact: '',
    address: '',
    recipientHost: '',
    afterEventNotes: '',
    cancelled: '',
    notes: '',
    addlNotes: '',
    waitingOn: '',
    ...overrides,
  };
}

function makeCandidate(
  status: ImportCandidate['status'] = 'scheduled'
): ImportCandidate {
  return {
    row: makeRow(),
    iso: '2026-03-14',
    date: new Date(Date.UTC(2026, 2, 14, 12, 0, 0)),
    fingerprint: 'planning-sheet:2026-03-14:test group',
    status,
  };
}

describe('buildImportedEventRecord', () => {
  it('marks imported events as already on the official sheet', () => {
    const record = buildImportedEventRecord(makeCandidate());
    expect(record.addedToOfficialSheet).toBe(true);
    expect(record.addedToOfficialSheetAt).toBeInstanceOf(Date);
  });

  it('flags on-sheet for every import status', () => {
    for (const status of ['scheduled', 'completed', 'cancelled', 'in_process'] as const) {
      const record = buildImportedEventRecord(makeCandidate(status));
      expect(record.addedToOfficialSheet).toBe(true);
    }
  });

  it('keeps googleSheetRowId deliberately unset', () => {
    const record = buildImportedEventRecord(makeCandidate());
    expect(record.googleSheetRowId).toBeNull();
  });

  it('stores the fingerprint as externalId', () => {
    const record = buildImportedEventRecord(makeCandidate());
    expect(record.externalId).toBe('planning-sheet:2026-03-14:test group');
  });

  it('maps Van needed for? into vanNeededFor and marks the van as needed', () => {
    const record = buildImportedEventRecord({
      ...makeCandidate(),
      row: makeRow({ vanNeededFor: 'Refrigeration' }),
    });
    expect(record.vanNeededFor).toBe('refrigeration');
    expect(record.vanDriverNeeded).toBe(true);
  });

  it('leaves van fields unset when the new column is blank', () => {
    const record = buildImportedEventRecord(makeCandidate());
    expect(record.vanNeededFor).toBeNull();
    expect(record.vanDriverNeeded).toBeUndefined();
  });

  it('records the importing user as createdBy, like manual entry', () => {
    expect(buildImportedEventRecord(makeCandidate(), '42').createdBy).toBe('42');
    expect(buildImportedEventRecord(makeCandidate()).createdBy).toBeNull();
  });

  it('records when the starting status began', () => {
    expect(buildImportedEventRecord(makeCandidate()).statusChangedAt).toBeInstanceOf(Date);
  });
});
