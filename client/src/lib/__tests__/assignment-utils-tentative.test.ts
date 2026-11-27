import { getDriverCount, getDriverIds, getVolunteerCount, getVolunteerIds, rebuildDetailsForSelection, hasDriver, hasVolunteer, isPersonAssigned, getTotalDriverCount } from '../assignment-utils';

describe('assignment counts leave out tentative people', () => {
  it('a confirmed driver marked tentative no longer fills the spot', () => {
    const event = {
      driverDetails: { '351': { name: 'Gary', notes: 'Has a van' } },
      assignedDriverIds: [],
      tentativeDriverIds: ['351'],
    };
    expect(getDriverIds(event)).toEqual([]);
    expect(getDriverCount(event)).toBe(0);
    expect(getTotalDriverCount(event)).toBe(0);
    // Driver Planning's Confirm/Confirmed button
    expect(hasDriver(event, '351')).toBe(false);
    // Still on the event, though
    expect(isPersonAssigned(event, '351')).toBe(true);
  });

  it('a tentative volunteer with a note is not counted as confirmed', () => {
    const event = {
      volunteerDetails: { u3: { name: 'Ana' }, u6: { notes: 'Might be late' } },
      assignedVolunteerIds: ['u3'],
      tentativeVolunteerIds: '{u6}',
    };
    expect(getVolunteerIds(event)).toEqual(['u3']);
    expect(getVolunteerCount(event)).toBe(1);
    expect(hasVolunteer(event, 'u6')).toBe(false);
    expect(hasVolunteer(event, 'u3')).toBe(true);
  });

  it('is unchanged when nobody is tentative', () => {
    const event = { volunteerDetails: { u3: {}, u4: {} }, tentativeVolunteerIds: null };
    expect(getVolunteerCount(event)).toBe(2);
    expect(getDriverIds({ assignedDriverIds: ['1', '2'] })).toEqual(['1', '2']);
  });
});

describe('rebuilding details when the confirmed selection changes (Edit dialog)', () => {
  const details = {
    '351': { name: 'Gary' },
    '352': { name: 'Lee', notes: 'Truck' },
    '400': { name: 'Tentative Tia', notes: 'Can only do pickup' },
  };

  it("keeps a tentative driver's note when a confirmed driver is removed", () => {
    const out = rebuildDetailsForSelection(details, ['351'], ['400']);
    expect(out.details).toEqual({ '351': { name: 'Gary' }, '400': { name: 'Tentative Tia', notes: 'Can only do pickup' } });
    expect(out.tentativeIds).toBeNull();
  });

  it('a tentative person picked as confirmed leaves the tentative list and keeps their note', () => {
    const out = rebuildDetailsForSelection(details, ['351', '400'], ['400']);
    expect(out.details['400'].notes).toBe('Can only do pickup');
    expect(out.tentativeIds).toEqual([]);
  });

  it('accepts details stored as a JSON string', () => {
    const out = rebuildDetailsForSelection(JSON.stringify(details), ['999'], ['400']);
    expect(Object.keys(out.details).sort()).toEqual(['400', '999']);
  });
});
