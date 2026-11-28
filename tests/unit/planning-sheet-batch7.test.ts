import {
  APP_WRITTEN_COLUMNS,
  appCellWrites,
  newSheetRow,
  resolvePlanningHeaders,
  toLogicalRow,
} from '../../server/services/planning-sheet-headers';
import {
  attendeeLine,
  formatNextDayCell,
  formatPickupCell,
  formatVanNeededForSheet,
  formatVanTimeCell,
  joinContacts,
  mergeAttendeeLine,
} from '../../server/services/planning-sheet-values';

// The live "2026 Groups" header row (Nov 2026), with TSP shopping moved to K.
const LIVE_HEADERS = [
  'Date', 'Day of the Week', 'Group Name', 'time event starts', 'time event ends',
  ' Pick-up time (type "N/D" if pickup is the next day)', 'Y (yes/planned) \nO (next day is an option)',
  'Details', 'Van Needed (AM/PM/mid-day/All day?)', 'Van Needed For?', 'TSP Shopping', 'Volunteer Needs',
  'Estimated # Of Sandwiches', 'Type of Sandwiches', 'Final # of Sandwiches', "#'s added to app",
  'Follow-up email sent', 'Group Contact Name', 'Group Contact Email', 'Group Contact Phone', 'TSP Contact',
  'Event Location', 'Sandwich Destination', 'Notes on how the event went', 'Cancelled?', 'blank column', '',
  'Planning/Contact Notes', ...new Array(26).fill(''), 'sync_id',
];

describe('planning sheet columns are found by header', () => {
  it('maps the live headers, wherever they are', () => {
    const map = resolvePlanningHeaders(LIVE_HEADERS);
    expect(map.columns.get(2)).toBe(2); // Group Name
    expect(map.columns.get(5)).toBe(5); // F pick-up time
    expect(map.columns.get(6)).toBe(6); // G Y/O
    expect(map.columns.get(8)).toBe(8); // I van time
    expect(map.columns.get(9)).toBe(9); // J van needed for
    expect(map.columns.get(28)).toBe(10); // TSP shopping, moved to K
    expect(map.columns.get(10)).toBe(11); // Volunteer Needs, one to the right
    expect(map.columns.get(11)).toBe(12);
    expect(map.columns.get(27)).toBe(27); // AB Planning/Contact Notes
    expect(map.columns.get(26)).toBe(54); // sync_id far right (BC)
    expect(map.columns.has(16)).toBe(false); // no Toolkit Sent column any more
  });

  it('still reads the old headers', () => {
    const map = resolvePlanningHeaders(['Date', 'Day of Week', 'Group Name', 'Event Start time (MUST when volunteer needed)', 'Deli or PBJ?', 'Staffing']);
    expect(map.columns.get(3)).toBe(3);
    expect(map.columns.get(12)).toBe(4);
    expect(map.columns.get(10)).toBe(5);
  });

  it("refuses a sheet without Date or Group Name (wrong tab), so nothing is written", () => {
    expect(() => resolvePlanningHeaders(['Name', 'Email'])).toThrow(/doesn't have "Date" or "Group Name"/);
  });

  it('a new row puts values under their headers and leaves sheet-owned columns blank', () => {
    const map = resolvePlanningHeaders(LIVE_HEADERS);
    const logical = new Array(29).fill('');
    logical[2] = 'Lincoln PTA';
    logical[28] = 'Yes';
    logical[26] = 'should-not-be-written';
    logical[16] = 'Yes'; // old toolkit value
    const row = newSheetRow(logical, map);
    expect(row.length).toBe(LIVE_HEADERS.length);
    expect(row[2]).toBe('Lincoln PTA');
    expect(row[10]).toBe('Yes'); // TSP shopping in K
    expect(row[54]).toBe(''); // sync_id untouched
  });

  it('an update writes only the app\'s changed cells; sheet-owned cells and formulas are never written', () => {
    const map = resolvePlanningHeaders(LIVE_HEADERS);
    const existing = new Array(LIVE_HEADERS.length).fill('');
    existing[2] = 'Lincoln PTA';
    existing[15] = '=COUNTIF(...)'; // "#'s added to app" (sheet-owned)
    existing[27] = 'called Tue';
    const logical = toLogicalRow(existing, map, 29);
    logical[11 - 1] = logical[10]; // no-op, keep staffing as is
    logical[28] = 'Yes';
    logical[14] = 'app value for a sheet-owned column';
    const writes = appCellWrites(logical, map, existing);
    expect(writes).toEqual([{ column: 10, value: 'Yes' }]);
    expect(APP_WRITTEN_COLUMNS.has(27)).toBe(false);
  });
});

describe('planning sheet cell values', () => {
  it('F: N/D (+ next-day time), else the pickup time when it differs from the end time', () => {
    expect(formatPickupCell({ nextDayPickup: 'planned', overnightPickupTime: '09:00' })).toBe('N/D 9:00 AM');
    expect(formatPickupCell({ nextDayPickup: 'planned' })).toBe('N/D');
    expect(formatPickupCell({ pickupTime: '15:30', eventEndTime: '15:00' })).toBe('3:30 PM');
    expect(formatPickupCell({ pickupTime: '15:30' })).toBe('3:30 PM');
    expect(formatPickupCell({ pickupTime: '15:00', eventEndTime: '15:00' })).toBe('');
    expect(formatPickupCell({})).toBe('');
    expect(formatPickupCell({ pickupDateTime: '2026-12-05T16:15:00', eventEndTime: '15:00' })).toBe('4:15 PM');
  });

  it('G: Y / O / blank (older events with an overnight location count as planned)', () => {
    expect(formatNextDayCell({ nextDayPickup: 'planned' })).toBe('Y');
    expect(formatNextDayCell({ nextDayPickup: 'option' })).toBe('O');
    expect(formatNextDayCell({ nextDayPickup: 'no' })).toBe('');
    expect(formatNextDayCell({ overnightHoldingLocation: 'Church' })).toBe('Y');
  });

  it("I and J use the sheet's own dropdown spellings", () => {
    expect(formatVanTimeCell('Mid-day')).toBe('Mid Day');
    expect(formatVanTimeCell('All day')).toBe('All Day');
    expect(formatVanTimeCell('')).toBe('');
    expect(formatVanNeededForSheet('transport')).toBe('Just Transport');
    expect(formatVanNeededForSheet('refrigeration')).toBe('Event Refrigeration');
  });

  it('contacts carry both people: "Primary; Backup"', () => {
    expect(joinContacts('Pat Doe', 'Sam Lee')).toBe('Pat Doe; Sam Lee');
    expect(joinContacts('pat@x.org', '')).toBe('pat@x.org');
    expect(joinContacts('', 'sam@x.org')).toBe('sam@x.org');
  });

  it('Details keeps the planner\'s text and only manages the attendee line', () => {
    const line = attendeeLine({ estimatedAttendance: 50, estimatedAttendanceMin: 40, estimatedAttendanceMax: 60 });
    expect(line).toBe('Expected attendees: ~40–60');
    expect(mergeAttendeeLine('', line)).toBe(line);
    expect(mergeAttendeeLine('Supplies arrive day before', line)).toBe('Supplies arrive day before\nExpected attendees: ~40–60');
    expect(mergeAttendeeLine('Bring labels\nExpected attendees: ~30\nPark in back', line)).toBe('Bring labels\nExpected attendees: ~40–60\nPark in back');
    expect(mergeAttendeeLine('Bring labels\nExpected attendees: ~30', '')).toBe('Bring labels');
    expect(mergeAttendeeLine('Bring labels', '')).toBe('Bring labels');
  });
});

describe('#609 review fixes', () => {
  it("a sheet without a 'TSP Shopping' header can't take TSP shopping (so the preview won't compare it)", () => {
    const map = resolvePlanningHeaders(['Date', 'Day of the Week', 'Group Name', 'Toolkit Sent']);
    const writable = Array.from(map.columns.keys()).filter((l) => APP_WRITTEN_COLUMNS.has(l));
    expect(writable).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(writable).not.toContain(28); // TSP shopping
    expect(writable).not.toContain(16); // Toolkit Sent is the sheet's
  });
});
