import { getDriverCount, getDriverIds, getVolunteerCount, getVolunteerIds } from '../assignment-utils';

describe('assignment counts leave out tentative people', () => {
  it('a confirmed driver marked tentative no longer fills the spot', () => {
    const event = {
      driverDetails: { '351': { name: 'Gary', notes: 'Has a van' } },
      assignedDriverIds: [],
      tentativeDriverIds: ['351'],
    };
    expect(getDriverIds(event)).toEqual([]);
    expect(getDriverCount(event)).toBe(0);
  });

  it('a tentative volunteer with a note is not counted as confirmed', () => {
    const event = {
      volunteerDetails: { u3: { name: 'Ana' }, u6: { notes: 'Might be late' } },
      assignedVolunteerIds: ['u3'],
      tentativeVolunteerIds: '{u6}',
    };
    expect(getVolunteerIds(event)).toEqual(['u3']);
    expect(getVolunteerCount(event)).toBe(1);
  });

  it('is unchanged when nobody is tentative', () => {
    const event = { volunteerDetails: { u3: {}, u4: {} }, tentativeVolunteerIds: null };
    expect(getVolunteerCount(event)).toBe(2);
    expect(getDriverIds({ assignedDriverIds: ['1', '2'] })).toEqual(['1', '2']);
  });
});
