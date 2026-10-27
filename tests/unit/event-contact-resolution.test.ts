import { normalizeEventContactPatch as normalize, resolveEventContact as resolve } from '../../shared/event-contact-resolution';

const users = [
  { id: 'a', firstName: 'Alex', lastName: 'One', email: 'alex@example.org', isActive: true },
  { id: 'b', firstName: 'Blair', lastName: 'Two', email: 'blair@example.org', isActive: true },
  { id: 'j1', firstName: 'Jen', lastName: 'Example', isActive: true },
  { id: 'j2', firstName: 'Jen', lastName: 'Example', isActive: true },
  { id: 'old', firstName: 'Former', lastName: 'User', isActive: false },
];

describe('conservative event contact resolution', () => {
  it('keeps explicit IDs including historical disabled accounts', () => {
    expect(resolve('old', users)).toMatchObject({ kind: 'id', userId: 'old' });
  });
  it.each(['alex@example.org', ' ALEX@EXAMPLE.ORG ', ' Alex One '])('resolves unique full identity %s', value => {
    expect(resolve(value, users)).toMatchObject({ userId: 'a' });
  });
  it('never picks one of two accounts with the same full name', () => {
    expect(resolve('Jen Example', users)).toEqual({ kind: 'review', candidates: ['j1', 'j2'] });
  });
  it('does not turn a unique first name into a confirmed assignment', () => {
    expect(resolve('Alex', users)).toEqual({ kind: 'review', candidates: ['a'] });
  });
  it.each(['Alex/Blair', 'Alex picking up', '9:30-11', 'user_missing'])('preserves ambiguous/unrecognized input %s for review', value => {
    expect(resolve(value, users).kind).toBe('review');
  });
  it('does not map an inactive name to a new assignment', () => {
    expect(resolve('Former User', users).kind).toBe('review');
  });
  it('does not bypass an inactive duplicate account', () => {
    expect(resolve('Alex One', [...users, { id: 'duplicate', firstName: 'Alex', lastName: 'One', isActive: false }]).kind).toBe('review');
  });
});

describe('event contact persistence normalization', () => {
  it('normalizes a legacy import field and preserves the exact source label', () => {
    expect(normalize({ tspContactAssigned: ' Alex One ', planningNotes: 'Keep this' }, users)).toEqual({
      tspContact: 'a', tspContactAssigned: 'a', planningNotes: 'Keep this\n[Imported TSP contact]  Alex One ',
    });
  });
  it('keeps unresolved imported text as custom contact and notes, not a fake ID', () => {
    expect(normalize({ tspContact: 'Alex/Blair' }, users)).toEqual({
      tspContact: null, tspContactAssigned: null, customTspContact: 'Alex/Blair',
      planningNotes: '[Imported TSP contact] Alex/Blair',
    });
  });
  it('preserves an existing custom contact on import', () => {
    expect(normalize({ tspContact: 'Jen', customTspContact: 'Other notes' }, users).customTspContact).toBe('Other notes\nJen');
  });
  it('mirrors an explicit reassignment of a previously consistent record', () => {
    expect(normalize({ tspContact: 'b' }, users, { tspContact: 'a', tspContactAssigned: 'a' }))
      .toEqual({ tspContact: 'b', tspContactAssigned: 'b' });
  });
  it('clears both fields for an explicit removal from a consistent record', () => {
    expect(normalize({ tspContact: null }, users, { tspContact: 'a', tspContactAssigned: 'a' }))
      .toEqual({ tspContact: null, tspContactAssigned: null });
  });
  it('does not collapse historical conflicts during full-form saves', () => {
    expect(normalize({ tspContact: 'a' }, users, { tspContact: 'a', tspContactAssigned: 'b' }))
      .toEqual({ tspContact: 'a' });
  });
  it('does not automatically rewrite either side of a historical conflict', () => {
    expect(normalize({ tspContact: 'old' }, users, { tspContact: 'a', tspContactAssigned: 'b' }))
      .toEqual({ tspContact: 'old' });
  });
  it('leaves unchanged historical text for the reviewed backfill', () => {
    expect(normalize({ tspContact: 'Alex One' }, users, { tspContact: 'Alex One' }))
      .toEqual({ tspContact: 'Alex One' });
  });
  it('keeps explicitly supplied conflicting contacts for review', () => {
    expect(normalize({ tspContact: 'a', tspContactAssigned: 'b' }, users))
      .toEqual({ tspContact: 'a', tspContactAssigned: 'b' });
  });
  it('does not clear assignments for an unrelated partial edit', () => {
    const patch = { planningNotes: 'New notes' };
    expect(normalize(patch, users, { tspContact: 'a' })).toEqual(patch);
  });
  it('does not invent assignment timestamps', () => {
    expect(normalize({ tspContact: 'a' }, users)).not.toHaveProperty('tspContactAssignedDate');
  });
});

it('does not erase a different legacy-only assignment when a new primary is supplied', () => {
  expect(normalize({ tspContact: 'a' }, users, { tspContact: null, tspContactAssigned: 'b' }))
    .toEqual({ tspContact: 'a' });
});
it('uses a supplied legacy import contact when the new primary field is empty', () => {
  expect(normalize({ tspContact: null, tspContactAssigned: 'a' }, users))
    .toEqual({ tspContact: 'a', tspContactAssigned: 'a' });
});
