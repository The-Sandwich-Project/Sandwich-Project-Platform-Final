import { getEventRequestSourceIndicator } from '../event-request-source';

describe('getEventRequestSourceIndicator', () => {
  it('labels in-app planning-sheet imports as planning sheet', () => {
    expect(
      getEventRequestSourceIndicator({ externalId: 'planning-sheet:2026-10-01:test-group' })
    ).toEqual({ kind: 'planning_sheet' });
  });

  it('labels Apps Script imports as planning sheet, not website', () => {
    expect(
      getEventRequestSourceIndicator({
        externalId: 'sheets-import-1700000000000-abc123',
        createdBy: 'google-sheets-import',
      })
    ).toEqual({ kind: 'planning_sheet' });
  });

  it('labels Google Sheets intake sync events as website', () => {
    expect(
      getEventRequestSourceIndicator({
        externalId: 'auto-0123456789abcdef',
        googleSheetRowId: '42',
        createdBy: 'google_sheets_sync',
      })
    ).toEqual({ kind: 'website' });
  });

  it('labels manual entries with their channel', () => {
    expect(
      getEventRequestSourceIndicator({ externalId: 'manual-1-x', manualEntrySource: 'phone_call' })
    ).toEqual({ kind: 'manual', channelLabel: 'phone call' });
  });

  it('returns null when the origin is unknown', () => {
    expect(getEventRequestSourceIndicator({ externalId: 'legacy-123' })).toBeNull();
  });
});
