import {
  buildRowUpdatePlan,
  normalizeSheetDate,
  normalizeTime,
  parsePlanningStaffing,
  parseSheetSandwichTypes,
  planToken,
  resolveSheetName,
  sandwichTypesForNewEvent,
  selectUpdates,
  staffingForNewEvent,
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
    const s = parsePlanningStaffing('D: Katie Long, Kim Lee, V: ');
    expect(s.driver).toEqual({ listed: true, names: ['Katie Long', 'Kim Lee'], van: false, vanNames: [], plainListed: true });
    expect(s.volunteer).toEqual({ listed: true, names: [] });
    expect(parsePlanningStaffing('VD: Luz').driver).toEqual({ listed: true, names: ['Luz'], van: true, vanNames: ['Luz'], plainListed: false });
    expect(parsePlanningStaffing('').driver.listed).toBe(false);
  });

  it('accepts several names per role with any common separator', () => {
    expect(parsePlanningStaffing('D: Katie & Kim').driver.names).toEqual(['Katie', 'Kim']);
    expect(parsePlanningStaffing('V: Ann and Bo; Cy, D: Dee').volunteer.names).toEqual(['Ann', 'Bo', 'Cy']);
    // "and" only splits as a whole word
    expect(parsePlanningStaffing('D: Sandy Anderson').driver.names).toEqual(['Sandy Anderson']);
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
      makeEvent({ volunteersNeeded: 1, assignedVolunteerIds: ['u-kim'] }),
      makeRow({ Staffing: 'D: ' }),
      USERS
    );
    expect(plan.updates.volunteersNeeded).toBe(0);
    expect(plan.updates.assignedVolunteerIds).toBeNull();
  });

  it('reads an old "S" (speaker) as a volunteer and never touches speaker columns', () => {
    expect(parsePlanningStaffing('S: Ann').volunteer).toEqual({ listed: true, names: ['Ann'] });
    expect(parsePlanningStaffing('S: Ann').speaker).toEqual({ listed: false, names: [] });
    const plan = buildRowUpdatePlan(
      makeEvent({ speakersNeeded: 1, assignedSpeakerIds: ['u-kim'] }),
      makeRow({ Staffing: 'D: , S: Ann Jones' }),
      USERS
    );
    expect(plan.updates.assignedVolunteerIds).toEqual(['u-ann2']);
    expect(plan.updates.speakersNeeded).toBeUndefined();
    expect(plan.updates.assignedSpeakerIds).toBeUndefined();
  });

  it('flags a van driver', () => {
    const plan = buildRowUpdatePlan(makeEvent(), makeRow({ Staffing: 'VD: ' }), USERS);
    expect(plan.updates.vanDriverNeeded).toBe(true);
    expect(plan.updates.customVanDriverName).toBeUndefined();
  });

  it('keeps the free-text van driver in sync, unless a real van driver is linked', () => {
    const row = makeRow({ Staffing: 'VD: Luz' });
    const plan = buildRowUpdatePlan(makeEvent({ vanDriverNeeded: true, customVanDriverName: 'Maria' }), row, USERS);
    expect(plan.updatesByField.vanDriver).toEqual({ customVanDriverName: 'Luz' });
    const linked = buildRowUpdatePlan(
      makeEvent({ vanDriverNeeded: true, assignedVanDriverId: 'u-kim', customVanDriverName: null }),
      row,
      USERS
    );
    expect(linked.updatesByField.vanDriver).toBeUndefined();
  });

  it('produces a token that changes when the plan changes', () => {
    const a = buildRowUpdatePlan(makeEvent(), makeRow({ 'Estimate # sandwiches': '300' }), USERS);
    const b = buildRowUpdatePlan(makeEvent(), makeRow({ 'Estimate # sandwiches': '350' }), USERS);
    expect(planToken(42, a.changes)).toBe(planToken(42, a.changes));
    expect(planToken(42, a.changes)).not.toBe(planToken(42, b.changes));
  });

  it('applies only the changes a person picks', () => {
    const event = makeEvent();
    const plan = buildRowUpdatePlan(
      event,
      makeRow({
        'Event Start time (MUST when volunteer needed)': '11:00 AM',
        'Estimate # sandwiches': '300',
        Staffing: 'D: Katie',
      }),
      USERS
    );
    expect(plan.changes.map((c) => c.field)).toEqual(['eventStartTime', 'estimatedSandwichCount', 'drivers']);

    const picked = selectUpdates(plan, ['eventStartTime', 'drivers'], event);
    expect(picked.changes.map((c) => c.field)).toEqual(['eventStartTime', 'drivers']);
    expect(picked.updates).toEqual({
      eventStartTime: '11:00',
      driversNeeded: 1,
      assignedDriverIds: ['u-katie'],
      driverDetails: { 'u-katie': {} },
    });
    expect(() => selectUpdates(plan, ['status'], event)).toThrow('Not part of this update: status');
  });

  it('re-splits types with the app estimate when the new estimate is skipped', () => {
    const event = makeEvent();
    const plan = buildRowUpdatePlan(
      event,
      makeRow({ 'Estimate # sandwiches': '300', 'Deli or PBJ?': 'Deli & PBJ' }),
      USERS
    );
    const picked = selectUpdates(plan, ['sandwichTypes'], event);
    expect(picked.updates).toEqual({
      sandwichTypes: [
        { type: 'deli', quantity: 100 },
        { type: 'pbj', quantity: 100 },
      ],
    });
  });
});

describe('creating an event from a sheet row ("send row to app")', () => {
  it('reads "needed, nobody assigned" as a need, not a blank-named person', () => {
    expect(staffingForNewEvent('D: , V: ')).toMatchObject({
      driversNeeded: 1,
      speakersNeeded: 0,
      volunteersNeeded: 1,
      assignedDriverNames: [],
      assignedVolunteerNames: [],
    });
    // Retired speaker role: "S" becomes a volunteer.
    expect(staffingForNewEvent('S: Ann')).toMatchObject({
      speakersNeeded: 0,
      volunteersNeeded: 1,
      assignedSpeakerNames: [],
      assignedVolunteerNames: ['Ann'],
    });
  });

  it('keeps every name in a role', () => {
    expect(staffingForNewEvent('D: Katie, Kim').assignedDriverNames).toEqual(['Katie', 'Kim']);
    expect(staffingForNewEvent('D: Katie & Kim')).toMatchObject({
      driversNeeded: 2,
      assignedDriverNames: ['Katie', 'Kim'],
    });
  });

  it('treats VD names as drivers on a van event, and fills the van driver name', () => {
    expect(staffingForNewEvent('VD: Luz')).toMatchObject({
      vanDriverNeeded: true,
      driversNeeded: 1,
      assignedDriverNames: ['Luz'],
      customVanDriverName: 'Luz',
    });
    expect(staffingForNewEvent('VD')).toMatchObject({
      vanDriverNeeded: true,
      assignedDriverNames: [],
      customVanDriverName: null,
    });
  });

  it('still reads the bare-letter format', () => {
    expect(staffingForNewEvent('D, S, V')).toMatchObject({
      driversNeeded: 1,
      speakersNeeded: 0,
      volunteersNeeded: 1,
    });
  });

  it('stores sandwich types with the app\'s keys, as an array', () => {
    expect(sandwichTypesForNewEvent('Turkey & PBJ', 301)).toEqual([
      { type: 'deli_turkey', quantity: 150 },
      { type: 'pbj', quantity: 151 },
    ]);
    expect(sandwichTypesForNewEvent('', 100)).toBeNull();
  });

  it('a row created from the sheet then updated from the same row shows no staffing changes', () => {
    const staffing = staffingForNewEvent('D: Katie, Kim, VD: Luz, V: ');
    const event = makeEvent({
      driversNeeded: staffing.driversNeeded,
      volunteersNeeded: staffing.volunteersNeeded,
      vanDriverNeeded: staffing.vanDriverNeeded,
      customVanDriverName: staffing.customVanDriverName,
      // Same name → ID resolution the import does for unambiguous names.
      assignedDriverIds: staffing.assignedDriverNames.map((n) => resolveSheetName(n, USERS)),
    });
    const plan = buildRowUpdatePlan(event, makeRow({ Staffing: 'D: Katie, Kim, VD: Luz, V: ' }), USERS);
    expect(plan.changes).toEqual([]);
  });
});

describe('the staffing column key the Apps Script sends', () => {
  it('reads staffing from "Volunteer/Driver Needed"', () => {
    const row = makeRow({ Staffing: undefined, 'Volunteer/Driver Needed': 'D: Katie, V: ' });
    const plan = buildRowUpdatePlan(makeEvent({ driversNeeded: 0 }), row, USERS);
    expect(plan.updates.assignedDriverIds).toEqual(['u-katie']);
    expect(plan.updates.volunteersNeeded).toBe(1);
  });

  it('is what the create path reads too', () => {
    const { staffingCellOf } = require('../../server/services/planning-sheet-row-update');
    expect(staffingCellOf({ 'Volunteer/Driver Needed': 'V: Ann' })).toBe('V: Ann');
    expect(staffingCellOf({ Staffing: 'D' })).toBe('D');
    expect(staffingCellOf({})).toBe('');
  });
});

describe('notes from the sheet', () => {
  it('fills empty planning notes in the create-path format', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ planningNotes: null }),
      makeRow({ Notes: 'Bring gloves', 'Waiting On': 'Headcount' }),
      USERS
    );
    expect(plan.updates.planningNotes).toBe('Notes: Bring gloves\n\nWaiting On: Headcount');
    expect(plan.changes.find((c) => c.field === 'planningNotes')?.kind).toBe('fill');
  });

  it('appends only what is new and never replaces', () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ planningNotes: 'Called Pat.\n\nNotes: Bring gloves' }),
      makeRow({ Notes: 'bring   gloves', "Add'l Notes": 'Parking in back' }),
      USERS
    );
    expect(plan.updates.planningNotes).toBe('Called Pat.\n\nNotes: Bring gloves\n\nAdditional Notes: Parking in back');
  });

  it("doesn't echo back what the app pushed (request message, next action)", () => {
    const plan = buildRowUpdatePlan(
      makeEvent({ message: 'We have 20 kids.', nextAction: 'Confirm time' }),
      makeRow({ 'ALL DETAILS': 'We have 20 kids.', 'Waiting On': 'Confirm time' }),
      USERS
    );
    expect(plan.updatesByField.planningNotes).toBeUndefined();
  });
});

describe('cancelled on the sheet', () => {
  it('cancels the app event and records a reason', () => {
    const plan = buildRowUpdatePlan(makeEvent(), makeRow({ Cancelled: 'Yes' }), USERS);
    const change = plan.changes.find((c) => c.field === 'status');
    expect(change).toMatchObject({ from: 'Scheduled', to: 'Cancelled' });
    expect(plan.updatesByField.status).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Marked cancelled on the planning sheet',
    });
  });

  it('keeps an existing cancellation reason', () => {
    const plan = buildRowUpdatePlan(makeEvent({ cancelledReason: 'Rain' }), makeRow({ Cancelled: 'TRUE' }), USERS);
    expect(plan.updatesByField.status?.cancelledReason).toBeUndefined();
  });

  it('never un-cancels, and leaves completed events to a person', () => {
    expect(buildRowUpdatePlan(makeEvent({ status: 'cancelled' }), makeRow({ Cancelled: '' }), USERS).changes).toEqual([]);
    const back = buildRowUpdatePlan(makeEvent({ status: 'cancelled' }), makeRow({ Cancelled: 'No' }), USERS);
    expect(back.changes).toEqual([]);
    expect(back.notes.some((n) => n.includes('not cancelled'))).toBe(true);
    const done = buildRowUpdatePlan(makeEvent({ status: 'completed' }), makeRow({ Cancelled: 'yes' }), USERS);
    expect(done.updatesByField.status).toBeUndefined();
    expect(done.notes.some((n) => n.includes('completed'))).toBe(true);
  });
});
