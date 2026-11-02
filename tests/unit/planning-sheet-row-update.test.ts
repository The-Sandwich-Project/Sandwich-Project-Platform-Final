import {
  buildRowUpdatePlan,
  normalizeSheetDate,
  normalizeTime,
  parsePlanningStaffing,
  parseSheetSandwichTypes,
  planToken,
  resolveSheetName,
  sandwichTypesForNewEvent,
  sheetNoteParts,
  isRowIdOnly,
  selectUpdates,
  shiftPickupDateTime,
  staffingForNewEvent,
  type MatchableUser,
  type RowUpdateEvent,
  type SheetRowData,
} from '../../server/services/planning-sheet-row-update';
import { resolveEstimatePatch } from '../../shared/sandwich-estimate';

/** What the event's estimate fields end up as after the picked changes are saved. */
function saved(event: RowUpdateEvent, plan: ReturnType<typeof buildRowUpdatePlan>, fields: string[]) {
  return resolveEstimatePatch(event as any, selectUpdates(plan, fields, event).updates);
}

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
    expect(s.driver).toEqual({ listed: true, names: ['Katie Long', 'Kim Lee'], van: false, vanNames: [], plainListed: true, slots: 1 });
    expect(s.volunteer).toEqual({ listed: true, names: [], slots: 1 });
    expect(parsePlanningStaffing('VD: Luz').driver).toEqual({ listed: true, names: ['Luz'], van: true, vanNames: ['Luz'], plainListed: false, slots: 1 });
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
    const event = makeEvent();
    const plan = buildRowUpdatePlan(
      event,
      makeRow({ 'Estimate # sandwiches': '300', 'Deli or PBJ?': 'Deli & PBJ', 'Final # sandwiches made': '310' }),
      USERS
    );
    expect(plan.updates.estimatedSandwichCount).toBe(300);
    // The sheet has no per-type amounts, so none are invented: split TBD.
    expect(plan.updates.sandwichTypes).toEqual([{ type: 'deli' }, { type: 'pbj' }]);
    expect(plan.updates.actualSandwichCount).toBe(310);
    expect(saved(event, plan, ['estimatedSandwichCount', 'sandwichTypes'])).toMatchObject({
      estimatedSandwichCount: 300,
      sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
    });
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
    expect(plan.updates.driverDetails).toEqual({ 'u-katie': { pickup: 'host A' }, 'u-kim': { name: 'Kim Lee' } });
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
    expect(parsePlanningStaffing('S: Ann').volunteer).toEqual({ listed: true, names: ['Ann'], slots: 1 });
    expect(parsePlanningStaffing('S: Ann').speaker).toEqual({ listed: false, names: [], slots: 0 });
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
    const ev = makeEvent();
    expect(planToken(ev, a)).toBe(planToken(ev, a));
    expect(planToken(ev, a)).not.toBe(planToken(ev, b));
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
      driverDetails: { 'u-katie': { name: 'Katie Long' } },
    });
    expect(() => selectUpdates(plan, ['status'], event)).toThrow('Not part of this update: status');
  });

  it('keeps the app estimate when only the types change is picked', () => {
    const event = makeEvent();
    const plan = buildRowUpdatePlan(
      event,
      makeRow({ 'Estimate # sandwiches': '300', 'Deli or PBJ?': 'Deli & PBJ' }),
      USERS
    );
    expect(selectUpdates(plan, ['sandwichTypes'], event).updates).toEqual({
      sandwichTypes: [{ type: 'deli' }, { type: 'pbj' }],
    });
    expect(saved(event, plan, ['sandwichTypes'])).toMatchObject({
      estimatedSandwichCount: 200,
      sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
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
    // An old speaker slot (S) is a volunteer slot now, so S + V = 2 volunteers.
    expect(staffingForNewEvent('D, S, V')).toMatchObject({
      driversNeeded: 1,
      speakersNeeded: 0,
      volunteersNeeded: 2,
    });
  });

  it('stores sandwich types with the app\'s keys, as an array, without inventing amounts', () => {
    expect(sandwichTypesForNewEvent('Turkey & PBJ')).toEqual([{ type: 'deli_turkey' }, { type: 'pbj' }]);
    expect(sandwichTypesForNewEvent('')).toBeNull();
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

describe('Copilot review fixes', () => {
  it('token changes when the event was saved after the preview', () => {
    const row = makeRow({ 'Estimate # sandwiches': '300' });
    const before = makeEvent({ updatedAt: '2026-11-01T10:00:00.000Z' });
    const after = makeEvent({ updatedAt: '2026-11-01T10:05:00.000Z' });
    expect(planToken(before, buildRowUpdatePlan(before, row, USERS))).not.toBe(
      planToken(after, buildRowUpdatePlan(after, row, USERS))
    );
  });

  it('token covers the written values, not just the labels', () => {
    // Same labels, different range bounds written.
    const e = makeEvent();
    const a = buildRowUpdatePlan(e, makeRow({ 'Estimate # sandwiches': '200-300' }), USERS);
    const b = buildRowUpdatePlan(e, makeRow({ 'Estimate # sandwiches': '150-350' }), USERS);
    expect(planToken(e, a)).not.toBe(planToken(e, b));
  });

  it('rejects impossible dates', () => {
    expect(normalizeSheetDate('2026-13-01')).toBeNull();
    expect(normalizeSheetDate('2/31/26')).toBeNull();
    expect(normalizeSheetDate('2/29/28')).toBe('2028-02-29');
  });

  it('catches range-only estimate changes', () => {
    const ranged = makeEvent({ estimatedSandwichCount: 250, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 });
    const narrower = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '225-275' }), USERS);
    expect(narrower.changes.find((c) => c.field === 'estimatedSandwichCount')).toMatchObject({ from: '200–300', to: '225–275' });
    const exact = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '250' }), USERS);
    expect(exact.updatesByField.estimatedSandwichCount).toEqual({
      estimatedSandwichCount: 250,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
    });
    expect(saved(ranged, exact, ['estimatedSandwichCount'])).toMatchObject({
      estimatedSandwichCount: 250,
      estimatedSandwichCountMin: null,
      estimatedSandwichCountMax: null,
      sandwichTypes: [{ type: 'deli', quantity: 250 }],
    });
    // A range-mode event (count null) with the same range: no change.
    const rangeMode = makeEvent({ estimatedSandwichCount: null, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300 });
    expect(buildRowUpdatePlan(rangeMode, makeRow({ 'Estimate # sandwiches': '200-300' }), USERS).changes).toEqual([]);
  });

  it('a types change on a range-mode event keeps the range', () => {
    const rangeMode = makeEvent({ estimatedSandwichCount: null, estimatedSandwichCountMin: 200, estimatedSandwichCountMax: 300, sandwichTypes: null });
    const plan = buildRowUpdatePlan(rangeMode, makeRow({ 'Estimate # sandwiches': '', 'Deli or PBJ?': 'Deli & PBJ' }), USERS);
    expect(saved(rangeMode, plan, ['sandwichTypes'])).toMatchObject({
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 300,
      estimatedSandwichRangeType: null,
      sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
    });
  });

  it('keeps the plan free of wall-clock timestamps so the token is stable', () => {
    const plan = buildRowUpdatePlan(makeEvent(), makeRow({ Cancelled: 'yes' }), USERS);
    expect(plan.updatesByField.status).toEqual({
      status: 'cancelled',
      cancelledReason: 'Marked cancelled on the planning sheet',
    });
  });
});

describe('Copilot review fixes, round 2', () => {
  it('keeps an inactive existing assignee, but never matches a new name to an inactive user', () => {
    const users = [...USERS, { id: 'u-old', firstName: 'Olga', lastName: 'Old', displayName: null, isActive: false }];
    const keep = buildRowUpdatePlan(
      makeEvent({ driversNeeded: 1, assignedDriverIds: ['u-old'], driverDetails: { 'u-old': { car: 'van' } } }),
      makeRow({ Staffing: 'D: Olga Old' }),
      users
    );
    expect(keep.changes).toEqual([]);
    const fresh = buildRowUpdatePlan(makeEvent({ driversNeeded: 1 }), makeRow({ Staffing: 'D: Olga Old' }), users);
    expect(fresh.updates.assignedDriverIds).toEqual(['Olga Old']);
  });

  it('shifts pickupDateTime with a moved event date', () => {
    expect(shiftPickupDateTime('2026-11-14T13:30:00', '2026-11-14', '2026-11-13')).toBe('2026-11-13T13:30:00');
    // next-day pickup stays next-day
    expect(shiftPickupDateTime('2026-11-15T09:00:00', '2026-11-14', '2026-11-20')).toBe('2026-11-21T09:00:00');
    expect(shiftPickupDateTime('garbage', '2026-11-14', '2026-11-13')).toBeNull();
  });

  it('splits at a role code with no comma before it', () => {
    const s = parsePlanningStaffing('D: Katie V: Kim');
    expect(s.driver.names).toEqual(['Katie']);
    expect(s.volunteer.names).toEqual(['Kim']);
  });

  it('a new estimate drops per-type amounts that no longer add up, keeping the types', () => {
    const event = makeEvent({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 150 }, { type: 'pbj', quantity: 50 }] });
    const plan = buildRowUpdatePlan(event, makeRow({ 'Estimate # sandwiches': '400', 'Deli or PBJ?': 'Deli & PBJ' }), USERS);
    expect(plan.updatesByField.sandwichTypes).toBeUndefined();
    expect(saved(event, plan, ['estimatedSandwichCount'])).toMatchObject({
      estimatedSandwichCount: 400,
      sandwichTypes: [{ type: 'deli', quantity: 0 }, { type: 'pbj', quantity: 0 }],
    });
  });

  it('one type takes the total, whichever changes are picked', () => {
    const event = makeEvent({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'deli', quantity: 200 }] });
    const plan = buildRowUpdatePlan(event, makeRow({ 'Estimate # sandwiches': '300', 'Deli or PBJ?': 'PBJ' }), USERS);
    expect(saved(event, plan, ['estimatedSandwichCount']).sandwichTypes).toEqual([{ type: 'deli', quantity: 300 }]);
    expect(saved(event, plan, ['sandwichTypes', 'estimatedSandwichCount']).sandwichTypes).toEqual([{ type: 'pbj', quantity: 300 }]);
    expect(saved(event, plan, ['sandwichTypes'])).toMatchObject({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'pbj', quantity: 200 }] });
  });

  it('keeps the range type in step with a types change', () => {
    const ranged = makeEvent({
      estimatedSandwichCount: null,
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 300,
      estimatedSandwichRangeType: 'deli_turkey',
      sandwichTypes: [{ type: 'deli_turkey', quantity: 250 }],
    });
    const one = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '', 'Deli or PBJ?': 'PBJ' }), USERS);
    expect(saved(ranged, one, ['sandwichTypes']).estimatedSandwichRangeType).toBe('pbj');
    const two = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '', 'Deli or PBJ?': 'Deli & PBJ' }), USERS);
    expect(saved(ranged, two, ['sandwichTypes']).estimatedSandwichRangeType).toBeNull();
    const exact = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '250', 'Deli or PBJ?': 'PBJ' }), USERS);
    // Exact estimate + types: out of range mode, so no range type.
    expect(saved(ranged, exact, ['estimatedSandwichCount', 'sandwichTypes'])).toMatchObject({
      estimatedSandwichRangeType: null,
      sandwichTypes: [{ type: 'pbj', quantity: 250 }],
    });
    // Only types ticked: the range stays, and the type follows.
    expect(saved(ranged, exact, ['sandwichTypes']).estimatedSandwichRangeType).toBe('pbj');
    // Only the estimate: exact clears the range type.
    expect(saved(ranged, exact, ['estimatedSandwichCount']).estimatedSandwichRangeType).toBeNull();
  });

  it('never leaves per-type amounts that add up to more than the new total', () => {
    const event = makeEvent({
      estimatedSandwichCount: 301,
      sandwichTypes: [
        { type: 'deli', quantity: 100 },
        { type: 'pbj', quantity: 100 },
        { type: 'deli_turkey', quantity: 100 },
        { type: 'deli_ham', quantity: 1 },
      ],
    });
    const plan = buildRowUpdatePlan(event, makeRow({ 'Estimate # sandwiches': '101', 'Deli or PBJ?': 'Deli, PBJ, Turkey, Ham' }), USERS);
    const out = saved(event, plan, ['estimatedSandwichCount']);
    expect(out.estimatedSandwichCount).toBe(101);
    const q = (out.sandwichTypes as { quantity: number }[]).map((t) => t.quantity);
    expect(q.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
  });
});

describe('Copilot review fixes, round 4', () => {
  it('treats stale bounds next to a different exact count as no range', () => {
    const stale = makeEvent({ estimatedSandwichCount: 500, estimatedSandwichCountMin: 490, estimatedSandwichCountMax: 506 });
    const plan = buildRowUpdatePlan(stale, makeRow({ 'Estimate # sandwiches': '490-506' }), USERS);
    expect(plan.changes.find((c) => c.field === 'estimatedSandwichCount')).toMatchObject({ from: '500', to: '490–506' });
  });

  it('keeps a range-mode event\'s only type when an exact number is applied', () => {
    const ranged = makeEvent({
      estimatedSandwichCount: null,
      estimatedSandwichCountMin: 200,
      estimatedSandwichCountMax: 300,
      estimatedSandwichRangeType: 'deli_turkey',
      sandwichTypes: null,
    });
    const plan = buildRowUpdatePlan(ranged, makeRow({ 'Estimate # sandwiches': '350', 'Deli or PBJ?': '' }), USERS);
    expect(saved(ranged, plan, ['estimatedSandwichCount'])).toMatchObject({
      estimatedSandwichCount: 350,
      estimatedSandwichRangeType: null,
      sandwichTypes: [{ type: 'deli_turkey', quantity: 350 }],
    });
  });

  it('carries the one existing type into range mode; a ticked types change still decides', () => {
    const exact = makeEvent({ estimatedSandwichCount: 200, sandwichTypes: [{ type: 'pbj', quantity: 200 }] });
    const plan = buildRowUpdatePlan(exact, makeRow({ 'Estimate # sandwiches': '200-300', 'Deli or PBJ?': 'PBJ' }), USERS);
    expect(saved(exact, plan, ['estimatedSandwichCount']).estimatedSandwichRangeType).toBe('pbj');
    const swap = buildRowUpdatePlan(exact, makeRow({ 'Estimate # sandwiches': '200-300', 'Deli or PBJ?': 'Deli' }), USERS);
    expect(saved(exact, swap, ['estimatedSandwichCount', 'sandwichTypes']).estimatedSandwichRangeType).toBe('deli');
  });

  it('keeps the final breakdown adding up to a new final count', () => {
    const done = makeEvent({ actualSandwichCount: 200, actualSandwichTypes: [{ type: 'deli', quantity: 200 }] });
    const plan = buildRowUpdatePlan(done, makeRow({ 'Final # sandwiches made': '300' }), USERS);
    expect(plan.updatesByField.actualSandwichCount).toEqual({
      actualSandwichCount: 300,
      actualSandwichTypes: [{ type: 'deli', quantity: 300 }],
    });
  });
});

describe('sync_id is never treated as a note', () => {
  const ID = 'c5432e45-9a1c-4ecf-b849-36446f10b604';
  it('recognizes an ID-only cell', () => {
    expect(isRowIdOnly(ID)).toBe(true);
    expect(isRowIdOnly(` ${ID.toUpperCase()} `)).toBe(true);
    expect(isRowIdOnly(`see ${ID}`)).toBe(false);
    expect(isRowIdOnly('bring coolers')).toBe(false);
  });
  it('drops an ID-only note from any notes column, keeps real notes', () => {
    expect(sheetNoteParts({ Notes: 'call first', "Add'l Notes": ID, 'Waiting On': ID })).toEqual(['Notes: call first']);
  });
  it('the update flow adds no ID to planning notes', () => {
    const plan = buildRowUpdatePlan(makeEvent({ planningNotes: null }), makeRow({ "Add'l Notes": ID } as any), USERS);
    expect(plan.updatesByField.planningNotes).toBeUndefined();
  });
});

describe('numbered role codes and unreadable cells (live sheet format)', () => {
  const CELL = 'D1: Karen V1: Karen  V2: Bev Lowe + Alicia Jn Baptiste';

  it('reads numbered codes and "+" between names', () => {
    const p = parsePlanningStaffing(CELL);
    expect(p.driver).toMatchObject({ listed: true, names: ['Karen'], slots: 1 });
    expect(p.volunteer).toMatchObject({ listed: true, names: ['Karen', 'Bev Lowe', 'Alicia Jn Baptiste'], slots: 2 });
    expect(p.unread).toEqual([]);
  });

  it('the update adds them instead of removing them', () => {
    const plan = buildRowUpdatePlan(makeEvent({ driversNeeded: 0 }), makeRow({ Staffing: CELL }), USERS);
    expect(plan.updates.driversNeeded).toBe(1);
    expect(plan.updates.assignedDriverIds).toEqual(['Karen']);
    expect(plan.updates.volunteersNeeded).toBe(3);
    expect(plan.updates.assignedVolunteerIds).toEqual(['Karen', 'Bev Lowe', 'Alicia Jn Baptiste']);
  });

  it('reads the other live formats', () => {
    const a = parsePlanningStaffing('VD: Luz  V1: Sibet/Bruce V2:  James');
    expect(a.driver).toMatchObject({ names: ['Luz'], van: true });
    expect(a.volunteer).toMatchObject({ names: ['Sibet', 'Bruce', 'James'], slots: 2 });
    const b = parsePlanningStaffing('D: Luz, V1: Jeff Gross V2: Laurel Gross');
    expect(b.driver.names).toEqual(['Luz']);
    expect(b.volunteer).toMatchObject({ names: ['Jeff Gross', 'Laurel Gross'], slots: 2 });
    // A slash in a date doesn't split the name; the parenthetical note is dropped.
    expect(parsePlanningStaffing('D: Brigith (pick up 11/5)').driver.names).toEqual(['Brigith']);
    expect(parsePlanningStaffing('D: Ann 11/5').driver.names).toEqual(['Ann 11/5']);
  });

  it('reads codes in parentheses, notes after names, and role references', () => {
    const a = parsePlanningStaffing('D: (VD: Luz for event), V1: Christine V2:  Laura B');
    expect(a.driver).toMatchObject({ names: ['Luz'], van: true, vanNames: ['Luz'], slots: 1 });
    expect(a.volunteer).toMatchObject({ names: ['Christine', 'Laura B'], slots: 2 });
    expect(a.unread).toEqual([]);

    const b = parsePlanningStaffing('V1: Dawn M. V2: VD');
    expect(b.volunteer).toMatchObject({ names: ['Dawn M.'], slots: 2 });
    expect(b.unread).toEqual(['V2: VD']);

    // V/D = volunteer AND driver (VD is van driver).
    const c = parsePlanningStaffing('V/D: Dawn M. D: Jeff Gross');
    expect(c.driver).toMatchObject({ names: ['Dawn M.', 'Jeff Gross'], van: false, vanNames: [], slots: 2 });
    expect(c.volunteer).toMatchObject({ listed: true, names: ['Dawn M.'], slots: 1 });
    expect(parsePlanningStaffing('VD: Luz').driver).toMatchObject({ van: true, names: ['Luz'] });

    const d = parsePlanningStaffing('D: Luz S: Brigith (9:15 pickup or go for event)');
    expect(d.volunteer.names).toEqual(['Brigith']);
  });

  it('empty numbered slots count as needed', () => {
    const p = parsePlanningStaffing('D1: Karen, D2:');
    expect(p.driver).toMatchObject({ names: ['Karen'], slots: 2 });
    expect(staffingForNewEvent('D1: Karen, D2:').driversNeeded).toBe(2);
  });

  it('spelled-out roles work too', () => {
    const p = parsePlanningStaffing('Driver: Katie, Volunteers: Ann');
    expect(p.driver.names).toEqual(['Katie']);
    expect(p.volunteer.names).toEqual(['Ann']);
  });

  it('never removes staffing when the cell can\'t be read', () => {
    const event = makeEvent({ driversNeeded: 1, assignedDriverIds: ['u-katie'], volunteersNeeded: 2, assignedVolunteerIds: ['u-kim'] });
    const plan = buildRowUpdatePlan(event, makeRow({ Staffing: 'Katie driving, Kim helping' }), USERS);
    expect(plan.updatesByField.drivers).toBeUndefined();
    expect(plan.updatesByField.volunteers).toBeUndefined();
    expect(plan.notes.some((n) => n.includes("Couldn't read the staffing cell"))).toBe(true);
  });

  it('doesn\'t remove a role when part of the cell couldn\'t be read', () => {
    const event = makeEvent({ driversNeeded: 1, assignedDriverIds: ['u-katie'], volunteersNeeded: 1, assignedVolunteerIds: ['u-kim'] });
    const plan = buildRowUpdatePlan(event, makeRow({ Staffing: 'mystery text, D: Katie' }), USERS);
    expect(plan.updatesByField.volunteers).toBeUndefined();
    expect(plan.notes.some((n) => n.includes('wasn\'t understood'))).toBe(true);
  });
});

describe('Copilot review on the staffing parser', () => {
  it('keeps "Van driver:" as one code', () => {
    const p = parsePlanningStaffing('Van driver: Luz');
    expect(p.driver).toMatchObject({ van: true, names: ['Luz'] });
    expect(staffingForNewEvent('Van driver: Luz').vanDriverNeeded).toBe(true);
  });

  it('keeps lowercase name parts, cuts only note phrases', () => {
    expect(parsePlanningStaffing('V: Ann de la Cruz').volunteer.names).toEqual(['Ann de la Cruz']);
    expect(parsePlanningStaffing('VD: Luz for event').driver.names).toEqual(['Luz']);
    expect(parsePlanningStaffing('V: Kim maybe, Bo - backup').volunteer.names).toEqual(['Kim', 'Bo']);
  });

  it('treats an unknown label as unread, not as a name', () => {
    const p = parsePlanningStaffing('D: Katie, Helper: Kim');
    expect(p.driver.names).toEqual(['Katie']);
    expect(p.unread).toEqual(['Helper: Kim']);
  });

  it('keeps a separate empty numbered driver slot', () => {
    expect(parsePlanningStaffing('D1: , VD1: Luz').driver).toMatchObject({ names: ['Luz'], slots: 2 });
    expect(parsePlanningStaffing('D: (VD: Luz)').driver).toMatchObject({ names: ['Luz'], slots: 1 });
  });

  it('only adds people when part of the cell is unclear', () => {
    const event = makeEvent({ volunteersNeeded: 2, assignedVolunteerIds: ['u-kim', 'u-ann1'] });
    const a = buildRowUpdatePlan(event, makeRow({ Staffing: 'V1: VD' }), USERS);
    expect(a.updatesByField.volunteers?.assignedVolunteerIds).toBeUndefined();
    const b = buildRowUpdatePlan(event, makeRow({ Staffing: 'V1: Katie V2: VD' }), USERS);
    expect(b.updatesByField.volunteers?.assignedVolunteerIds).toEqual(['u-kim', 'u-ann1', 'u-katie']);
  });
});

describe('Copilot review fixes, round 6', () => {
  it('keeps a labelled parenthetical as unread so assigned volunteers are not cleared', () => {
    expect(parsePlanningStaffing('D: Katie, (Helper: Kim)').unread).toEqual(['Helper: Kim']);
    // A time in a note is not a label.
    expect(parsePlanningStaffing('D: Brigith (9:15 pickup)').unread).toEqual([]);
    const plan = buildRowUpdatePlan(
      makeEvent({ driversNeeded: 1, volunteersNeeded: 1, assignedVolunteerIds: ['u-kim'] }),
      makeRow({ Staffing: 'D: Katie, (Helper: Kim)' }),
      USERS
    );
    expect(plan.updates.assignedVolunteerIds).toBeUndefined();
    expect(plan.updates.volunteersNeeded).toBeUndefined();
  });

  it('a partial read never overwrites a van driver name already in the app', () => {
    const event = makeEvent({ vanDriverNeeded: true, customVanDriverName: 'Luz, Maria' });
    const partial = buildRowUpdatePlan(event, makeRow({ Staffing: 'VD1: Luz VD2: V' }), USERS);
    expect(partial.updatesByField.vanDriver).toBeUndefined();
    // A full read still updates it.
    const full = buildRowUpdatePlan(event, makeRow({ Staffing: 'VD: Luz' }), USERS);
    expect(full.updatesByField.vanDriver).toEqual({ customVanDriverName: 'Luz' });
  });
});

describe('matching sheet names to every app directory', () => {
  // Same shapes loadAssigneeDirectory returns.
  const PEOPLE: MatchableUser[] = [
    { id: 'user_1_karen', firstName: 'Karen', lastName: 'Smith', displayName: null, kind: 'user' },
    { id: '443', firstName: 'Karen', lastName: 'Smith', displayName: 'Karen Smith', kind: 'driver', aliases: ['driver-443'] },
    { id: 'volunteer-12', firstName: 'Karen', lastName: 'Smith', displayName: 'Karen Smith', kind: 'volunteer' },
    { id: 'volunteer-30', firstName: 'Bev', lastName: 'Lowe', displayName: 'Bev Lowe', kind: 'volunteer' },
    { id: '501', firstName: 'Luz', lastName: 'Garcia', displayName: 'Luz Garcia', kind: 'driver', aliases: ['driver-501'] },
    { id: 'host-contact-7', firstName: 'Dawn', lastName: 'Martin', displayName: 'Dawn Martin', kind: 'host-contact' },
    { id: 'volunteer-40', firstName: 'Ann', lastName: 'Lee', displayName: 'Ann Lee', kind: 'volunteer' },
    { id: '600', firstName: 'Ann', lastName: 'Park', displayName: 'Ann Park', kind: 'driver' },
    { id: '700', firstName: 'Old', lastName: 'Driver', displayName: 'Old Driver', kind: 'driver', isActive: false },
  ];

  it('finds people in the Drivers and Volunteers directories, not just team members', () => {
    expect(resolveSheetName('Bev Lowe', PEOPLE, 'volunteer')).toBe('volunteer-30');
    expect(resolveSheetName('Luz', PEOPLE, 'driver')).toBe('501');
    expect(resolveSheetName('Dawn Martin', PEOPLE, 'volunteer')).toBe('host-contact-7');
  });

  it('searches every directory whatever the role (drivers volunteer, volunteers drive)', () => {
    expect(resolveSheetName('Luz', PEOPLE, 'volunteer')).toBe('501');
    expect(resolveSheetName('Bev Lowe', PEOPLE, 'driver')).toBe('volunteer-30');
  });

  it('one person in several directories: the role picks the record', () => {
    expect(resolveSheetName('Karen', PEOPLE, 'driver')).toBe('443');
    expect(resolveSheetName('Karen', PEOPLE, 'volunteer')).toBe('volunteer-12');
  });

  it('first name + initial ("Dawn M.") matches', () => {
    expect(resolveSheetName('Dawn M.', PEOPLE, 'volunteer')).toBe('host-contact-7');
  });

  it('two different people keep the typed name; the full name links', () => {
    expect(resolveSheetName('Ann', PEOPLE, 'volunteer')).toBe('Ann');
    expect(resolveSheetName('Ann Park', PEOPLE, 'volunteer')).toBe('600');
  });

  it('never links a new name to an inactive record', () => {
    expect(resolveSheetName('Old Driver', PEOPLE, 'driver')).toBe('Old Driver');
  });

  it('the live Karen row links everyone it can and keeps existing directory assignees', () => {
    const fresh = buildRowUpdatePlan(
      makeEvent({ driversNeeded: 1, volunteersNeeded: 1 }),
      makeRow({ Staffing: 'D1: Karen V1: Karen  V2: Bev Lowe + Alicia Jn Baptiste' }),
      PEOPLE
    );
    expect(fresh.updates.assignedDriverIds).toEqual(['443']);
    expect(fresh.updates.assignedVolunteerIds).toEqual(['volunteer-12', 'volunteer-30', 'Alicia Jn Baptiste']);
    expect(fresh.updates.volunteerDetails).toEqual({
      'volunteer-12': { name: 'Karen Smith' },
      'volunteer-30': { name: 'Bev Lowe' },
      'Alicia Jn Baptiste': { name: 'Alicia Jn Baptiste' },
    });
    // Assigned in the app as "driver-443" (the edit dialog's format): no change.
    const same = buildRowUpdatePlan(
      makeEvent({ driversNeeded: 1, assignedDriverIds: ['driver-443'] }),
      makeRow({ Staffing: 'D: Karen' }),
      PEOPLE
    );
    expect(same.changes).toEqual([]);
    // A custom entry made in the app keeps matching its typed name.
    const custom = buildRowUpdatePlan(
      makeEvent({ driversNeeded: 1, assignedDriverIds: ['custom-1763183106406-Chef-Hank'] }),
      makeRow({ Staffing: 'D: Chef Hank' }),
      PEOPLE
    );
    expect(custom.changes).toEqual([]);
  });
});

describe('Copilot review: a first-name-only record does not hide others', () => {
  it('"Ann" with a user named just Ann plus Ann Lee and Ann Park stays typed', () => {
    const people: MatchableUser[] = [
      { id: 'user_ann', firstName: 'Ann', lastName: null, displayName: null, kind: 'user' },
      { id: 'volunteer-40', firstName: 'Ann', lastName: 'Lee', displayName: 'Ann Lee', kind: 'volunteer' },
      { id: '600', firstName: 'Ann', lastName: 'Park', displayName: 'Ann Park', kind: 'driver' },
    ];
    expect(resolveSheetName('Ann', people, 'volunteer')).toBe('Ann');
  });

  it('"Karen" with a user named just Karen and driver Karen Smith: one person, driver record', () => {
    const people: MatchableUser[] = [
      { id: 'user_karen', firstName: 'Karen', lastName: null, displayName: 'Karen', kind: 'user' },
      { id: '443', firstName: 'Karen', lastName: 'Smith', displayName: 'Karen Smith', kind: 'driver' },
    ];
    expect(resolveSheetName('Karen', people, 'driver')).toBe('443');
  });
});
