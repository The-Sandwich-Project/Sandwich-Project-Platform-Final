import {
  buildRowUpdatePlan,
  normalizeSheetDate,
  normalizeTime,
  parsePlanningStaffing,
  parseSheetSandwichTypes,
  planToken,
  resolveSheetName,
  type MatchableUser,
  type RowUpdateEvent,
  type SheetRowData,
} from '../../server/services/planning-sheet-row-update';

const USERS: MatchableUser[] = [
  { id: 'u-katie', firstName: 'Katie', lastName: 'Long', displayName: null },
  { id: 'u-kim', firstName: 'Kim', lastName: 'Lee', displayName: null },
  { id: 'u-ann1', firstName: 'Ann', lastName: 'Smith', displayName: null },
  { id: 'u-ann2', firstName: 'Ann', lastName: 'Jones', displayName: null },
];

function makeEvent(overrides: Partial<RowUpdateEvent> = {}): RowUpdateEvent {
  return {
    id: 42,
    organizationName: 'Test Group',
    status: 'scheduled',
    scheduledEventDate: '2026-11-14T12:00:00',
    desiredEventDate: null,
    eventStartTime: null,
    eventEndTime: null,
    pickupTime: null,
    estimatedSandwichCount: 200,
    actualSandwichCount: null,
    sandwichTypes: [{ type: 'deli', quantity: 200 }],
    firstName: 'Pat',
    lastName: 'Doe',
    email: 'pat@example.com',
    phone: null,
    eventAddress: '1 Main St',
    deliveryDestination: null,
    driversNeeded: 1,
    speakersNeeded: 0,
    volunteersNeeded: 0,
    vanDriverNeeded: false,
    assignedDriverIds: null,
    assignedSpeakerIds: null,
    assignedVolunteerIds: null,
    driverDetails: null,
    speakerDetails: null,
    volunteerDetails: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<SheetRowData> = {}): SheetRowData {
  return {
    date: '2026-11-14',
    'Group Name': 'Test Group',
    'Estimate # sandwiches': '200',
    'Deli or PBJ?': 'Deli',
    Staffing: 'D: ',
    'Contact Name': 'Pat Doe',
    'Email Address': 'pat@example.com',
    Address: '1 Main St',
    ...overrides,
  };
}

describe('parsing helpers', () => {
  it('normalizes times', () => {
    expect(normalizeTime('2:00 PM')).toBe('14:00');
    expect(normalizeTime('2pm')).toBe('14:00');
    expect(normalizeTime('12:30 am')).toBe('00:30');
    expect(normalizeTime('14:00:00')).toBe('14:00');
    expect(normalizeTime('2')).toBeNull();
    expect(normalizeTime('TBD')).toBeNull();
  });

  it('normalizes sheet dates', () => {
    expect(normalizeSheetDate('2026-11-14')).toBe('2026-11-14');
    expect(normalizeSheetDate('11/14/26')).toBe('2026-11-14');
    expect(normalizeSheetDate('11/14/2026')).toBe('2026-11-14');
    expect(normalizeSheetDate('')).toBeNull();
  });

  it('parses staffing the way the push writes it', () => {
    const s = parsePlanningStaffing('D: Katie Long, Kim Lee, S: , V');
    expect(s.driver).toEqual({ listed: true, names: ['Katie Long', 'Kim Lee'], van: false });
    expect(s.speaker).toEqual({ listed: true, names: [] });
    expect(s.volunteer).toEqual({ listed: true, names: [] });
    expect(parsePlanningStaffing('VD: Luz').driver).toEqual({ listed: true, names: ['Luz'], van: true });
    expect(parsePlanningStaffing('').driver.listed).toBe(false);
  });

  it('parses sandwich types', () => {
    expect(parseSheetSandwichTypes('Deli & PBJ')).toEqual(['deli', 'pbj']);
    expect(parseSheetSandwichTypes('PB&J')).toEqual(['pbj']);
    expect(parseSheetSandwichTypes('Turkey, Ham')).toEqual(['deli_turkey', 'deli_ham']);
  });

  it('only resolves a name to a user when it is unambiguous', () => {
    expect(resolveSheetName('Katie', USERS)).toBe('u-katie');
    expect(resolveSheetName('Ann', USERS)).toBe('Ann');
    expect(resolveSheetName('Ann Jones', USERS)).toBe('u-ann2');
    expect(resolveSheetName('Stranger', USERS)).toBe('Stranger');
  });
});

describe('buildRowUpdatePlan', () => {
  it('reports no changes when the sheet matches the app', () => {
    const plan = buildRowUpdatePlan(makeEvent(), makeRow(), USERS);
    expect(plan.changes).toEqual([]);
    expect(plan.updates).toEqual({});
  });

  it('picks up a moved date and newly added times', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ eventStartTime: '10:00' }),
      makeRow({
        date: '11/21/26',
        'Event Start time (MUST when volunteer needed)': '11:00 AM',
        'Pick up time': '1:30 PM',
      }),
      USERS
    );
    const fields = plan.changes.map((c) => c.field);
    expect(fields).toEqual(['scheduledEventDate', 'eventStartTime', 'pickupTime']);
    expect(plan.updates.eventStartTime).toBe('11:00');
    expect(plan.updates.pickupTime).toBe('13:30');
    expect(plan.changes.find((c) => c.field === 'pickupTime')?.kind).toBe('fill');
  });

  it('never clears app values from blank sheet cells', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ eventStartTime: '10:00', phone: '555-1234' }),
      makeRow({ 'Estimate # sandwiches': '', 'Deli or PBJ?': '', Staffing: '' }),
      USERS
    );
    expect(plan.changes).toEqual([]);
  });

  it('fills missing contact details but never overwrites existing ones', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ phone: null, email: 'old@example.com' }),
      makeRow({ 'Contact Cell Number': '404-555-0000', 'Email Address': 'new@example.com' }),
      USERS
    );
    expect(plan.updates.phone).toBe('404-555-0000');
    expect(plan.updates.email).toBeUndefined();
    expect(plan.notes.some((n) => n.includes('Contact email differs'))).toBe(true);
  });

  it('updates sandwich count and types', () => {
    const plan = buildRowUpdatePlan(
      makeEvent(),
      makeRow({ 'Estimate # sandwiches': '300', 'Deli or PBJ?': 'Deli & PBJ', 'Final # sandwiches made': '310' }),
      USERS
    );
    expect(plan.updates.estimatedSandwichCount).toBe(300);
    expect(plan.updates.sandwichTypes).toEqual([
      { type: 'deli', quantity: 150 },
      { type: 'pbj', quantity: 150 },
    ]);
    expect(plan.updates.actualSandwichCount).toBe(310);
  });

  it('leaves types alone when only the label spelling differs', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ sandwichTypes: [{ type: 'deli_turkey', quantity: 200 }] }),
      makeRow({ 'Deli or PBJ?': 'Turkey' }),
      USERS
    );
    expect(plan.changes).toEqual([]);
  });

  it('assigns drivers, keeping existing assignees matched by first name', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({
        assignedDriverIds: ['u-katie'],
        driverDetails: { 'u-katie': { pickup: 'host A' } },
      }),
      makeRow({ Staffing: 'D: Katie, Kim, V: Stranger' }),
      USERS
    );
    expect(plan.updates.assignedDriverIds).toEqual(['u-katie', 'u-kim']);
    expect(plan.updates.driversNeeded).toBe(2);
    expect(plan.updates.driverDetails).toEqual({ 'u-katie': { pickup: 'host A' }, 'u-kim': {} });
    expect(plan.updates.assignedVolunteerIds).toEqual(['Stranger']);
    expect(plan.notes.some((n) => n.includes('"Stranger"'))).toBe(true);
  });

  it('removes a role taken off the sheet', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ speakersNeeded: 1, assignedSpeakerIds: ['u-kim'] }),
      makeRow({ Staffing: 'D: ' }),
      USERS
    );
    expect(plan.updates.speakersNeeded).toBe(0);
    expect(plan.updates.assignedSpeakerIds).toBeNull();
  });

  it('flags a van driver', () => {
    const plan = buildRowUpdatePlan(makeEvent(), makeRow({ Staffing: 'VD: ' }), USERS);
    expect(plan.updates.vanDriverNeeded).toBe(true);
  });

  it('produces a token that changes when the plan changes', () => {
    const a = buildRowUpdatePlan(makeEvent(), makeRow({ 'Estimate # sandwiches': '300' }), USERS);
    const b = buildRowUpdatePlan(makeEvent(), makeRow({ 'Estimate # sandwiches': '350' }), USERS);
    expect(planToken(42, a.changes)).toBe(planToken(42, a.changes));
    expect(planToken(42, a.changes)).not.toBe(planToken(42, b.changes));
  });
});
