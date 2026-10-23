import { dedupeVolunteerHubEvents } from '../../server/utils/volunteer-hub-dedupe';

type Row = Parameters<typeof dedupeVolunteerHubEvents>[0][number];

function makeEvent(overrides: Partial<Row>): Row {
  return {
    id: 1,
    status: 'scheduled',
    organizationName: 'Org A',
    googleSheetRowId: null,
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  } as Row;
}

describe('dedupeVolunteerHubEvents', () => {
  it('collapses two records for the same sheet row and organization', () => {
    const older = makeEvent({ id: 1, googleSheetRowId: '12', status: 'new' });
    const scheduled = makeEvent({ id: 2, googleSheetRowId: '12', status: 'scheduled' });

    const result = dedupeVolunteerHubEvents([older, scheduled]);

    expect(result.map((e) => e.id)).toEqual([2]);
  });

  it('treats organization names case- and whitespace-insensitively', () => {
    const a = makeEvent({ id: 1, googleSheetRowId: '12', organizationName: 'Org A ' });
    const b = makeEvent({ id: 2, googleSheetRowId: '12', organizationName: 'org a' });

    expect(dedupeVolunteerHubEvents([a, b])).toHaveLength(1);
  });

  it('keeps both events when a reused sheet row number belongs to a different organization', () => {
    const first = makeEvent({ id: 1, googleSheetRowId: '12', organizationName: 'Org A' });
    const second = makeEvent({ id: 2, googleSheetRowId: '12', organizationName: 'Org B' });

    const result = dedupeVolunteerHubEvents([first, second]);

    expect(result.map((e) => e.id).sort()).toEqual([1, 2]);
  });

  it('never collapses events without a sheet row number', () => {
    const manualA = makeEvent({ id: 1, googleSheetRowId: null });
    const manualB = makeEvent({ id: 2, googleSheetRowId: null });

    expect(dedupeVolunteerHubEvents([manualA, manualB])).toHaveLength(2);
  });
});
