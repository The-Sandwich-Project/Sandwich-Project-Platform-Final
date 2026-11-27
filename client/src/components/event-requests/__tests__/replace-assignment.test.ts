import { withoutPerson, finishReplacement, toIdList, type AssignmentKind } from '../lib/replace-assignment';

/**
 * Mirrors what the assignment dialog's save handler (event-requests/index.tsx)
 * does with the event it is given: merge the picked people into the confirmed
 * or tentative list, and add a details entry for new confirmed people.
 */
function addLikeSaveHandler(event: Record<string, any>, kind: AssignmentKind, picked: string[], tentative: boolean) {
  const assignedKey = kind === 'driver' ? 'assignedDriverIds' : 'assignedVolunteerIds';
  const tentativeKey = kind === 'driver' ? 'tentativeDriverIds' : 'tentativeVolunteerIds';
  const detailsKey = kind === 'driver' ? 'driverDetails' : 'volunteerDetails';
  const update: Record<string, any> = {};
  if (tentative) {
    update[tentativeKey] = [...new Set([...(event[tentativeKey] || []), ...picked])];
  } else {
    const ids = [...new Set([...(event[assignedKey] || []), ...picked])];
    update[assignedKey] = ids;
    const details = { ...(event[detailsKey] || {}) };
    for (const id of ids) if (!details[id]) details[id] = { name: `name of ${id}` };
    update[detailsKey] = details;
  }
  return update;
}

function change(event: Record<string, any>, kind: AssignmentKind, personId: string, picked: string[], tentative: boolean) {
  const replacement = withoutPerson(event, kind, personId, picked);
  const update = addLikeSaveHandler(replacement.event, kind, picked, tentative);
  return finishReplacement(update, replacement, kind, personId, picked);
}

describe('Change person on an event card', () => {
  const event = {
    assignedVolunteerIds: ['u3', 'custom-1-Irv-G', 'u5'],
    tentativeVolunteerIds: ['u6'],
    volunteerDetails: {
      u3: { name: 'Ana' },
      'custom-1-Irv-G': { name: 'Irv G', notes: 'Bringing gloves' },
      u5: { name: 'Nhuvi' },
      u6: { name: 'Brigith', notes: 'Might be late' },
    },
  };

  it('swaps a typed-in name for the database person and keeps their note', () => {
    const update = change(event, 'volunteer', 'custom-1-Irv-G', ['u42'], false);
    expect(update.assignedVolunteerIds).toEqual(['u3', 'u5', 'u42']);
    expect(update.tentativeVolunteerIds).toEqual(['u6']);
    expect(update.volunteerDetails['custom-1-Irv-G']).toBeUndefined();
    expect(update.volunteerDetails.u42).toEqual({ name: 'name of u42', notes: 'Bringing gloves' });
  });

  it('confirms a tentative person (same person, checkbox unticked)', () => {
    const update = change(event, 'volunteer', 'u6', ['u6'], false);
    expect(update.tentativeVolunteerIds).toEqual([]);
    expect(update.assignedVolunteerIds).toEqual(['u3', 'custom-1-Irv-G', 'u5', 'u6']);
    expect(update.volunteerDetails.u6).toEqual({ name: 'Brigith', notes: 'Might be late' });
  });

  it('marks a confirmed person tentative', () => {
    const update = change(event, 'volunteer', 'u3', ['u3'], true);
    expect(update.assignedVolunteerIds).toEqual(['custom-1-Irv-G', 'u5']);
    expect(update.tentativeVolunteerIds).toEqual(['u6', 'u3']);
    expect(update.volunteerDetails.u3).toEqual({ name: 'Ana' });
  });

  it('works for drivers stored as Postgres array strings', () => {
    const drivers = {
      assignedDriverIds: '{"custom-9-Pat-Lee",350}',
      tentativeDriverIds: '{}',
      driverDetails: { 'custom-9-Pat-Lee': { name: 'Pat Lee', notes: 'Has a truck' } },
    };
    const update = change(drivers, 'driver', 'custom-9-Pat-Lee', ['351'], false);
    expect(update.assignedDriverIds).toEqual(['350', '351']);
    expect(update.tentativeDriverIds).toEqual([]);
    expect(update.driverDetails['351'].notes).toBe('Has a truck');
    expect(update.driverDetails['custom-9-Pat-Lee']).toBeUndefined();
  });

  it('does not copy the note when one spot is replaced by several people', () => {
    const update = change(event, 'volunteer', 'custom-1-Irv-G', ['u42', 'u43'], false);
    expect(update.volunteerDetails.u42.notes).toBeUndefined();
    expect(update.volunteerDetails.u43.notes).toBeUndefined();
  });

  it('reads id lists in either storage format', () => {
    expect(toIdList(['a', 'b'])).toEqual(['a', 'b']);
    expect(toIdList('{a,"b c"}')).toEqual(['a', 'b c']);
    expect(toIdList('{}')).toEqual([]);
    expect(toIdList(null)).toEqual([]);
  });
});
