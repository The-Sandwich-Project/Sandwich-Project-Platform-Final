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


describe('contact update regressions from PR review', () => {
  const previous = {
    tspContact: 'a', tspContactAssigned: 'a',
    customTspContact: 'Existing custom contact', planningNotes: 'Existing planning notes',
  };

  it.each([null, '', undefined])('accepts a legacy assignment with an unchanged empty primary (%s)', empty => {
    expect(normalize({ tspContact: empty, tspContactAssigned: 'a' }, users,
      { tspContact: empty, tspContactAssigned: null }))
      .toEqual({ tspContact: 'a', tspContactAssigned: 'a' });
  });

  it('keeps primary removal authoritative when the old mirror is included', () => {
    expect(normalize({ tspContact: null, tspContactAssigned: 'a' }, users, previous))
      .toEqual({ tspContact: null, tspContactAssigned: null });
  });

  it.each(['tspContact', 'tspContactAssigned'] as const)('moves newly unresolved %s text out of assignment fields', field => {
    expect(normalize({ [field]: 'Alex/Blair' }, users, previous)).toEqual({
      tspContact: null, tspContactAssigned: null,
      customTspContact: 'Existing custom contact\nAlex/Blair',
      planningNotes: 'Existing planning notes\n[Imported TSP contact] Alex/Blair',
    });
  });

  it('retains notes supplied in the same unresolved-contact edit', () => {
    expect(normalize({ tspContact: 'Alex/Blair', customTspContact: 'Updated custom', planningNotes: 'Updated notes' }, users, previous))
      .toMatchObject({ customTspContact: 'Updated custom\nAlex/Blair', planningNotes: 'Updated notes\n[Imported TSP contact] Alex/Blair' });
  });

  it('honors explicitly cleared notes instead of restoring previous text', () => {
    expect(normalize({ tspContact: 'Alex/Blair', customTspContact: null, planningNotes: null }, users, previous))
      .toMatchObject({ customTspContact: 'Alex/Blair', planningNotes: '[Imported TSP contact] Alex/Blair' });
  });

  it.each([' Blair Two ', 'BLAIR@EXAMPLE.ORG'])('preserves the exact resolved update label %s and previous notes', label => {
    expect(normalize({ tspContact: label }, users, previous)).toEqual({
      tspContact: 'b', tspContactAssigned: 'b',
      planningNotes: `Existing planning notes\n[Imported TSP contact] ${label}`,
    });
  });

  it('preserves a resolved legacy-field update label with replacement notes', () => {
    expect(normalize({ tspContactAssigned: 'Blair Two', planningNotes: 'Replacement' }, users, previous))
      .toEqual({ tspContact: 'b', tspContactAssigned: 'b', planningNotes: 'Replacement\n[Imported TSP contact] Blair Two' });
  });

  it('does not add source notes for an explicit user-ID reassignment', () => {
    expect(normalize({ tspContact: 'b' }, users, previous)).toEqual({ tspContact: 'b', tspContactAssigned: 'b' });
  });

  it('leaves an unchanged historical label alone when the empty mirror is submitted', () => {
    expect(normalize({ tspContact: 'Alex/Blair', tspContactAssigned: null }, users,
      { tspContact: 'Alex/Blair' })).toEqual({ tspContact: 'Alex/Blair', tspContactAssigned: null });
  });
});

describe('matching dual-field source labels', () => {
  it.each([undefined, { tspContact: 'a', tspContactAssigned: 'a', planningNotes: 'Keep notes' }])(
    'moves identical unresolved labels to one custom contact on create/update', previous => {
      const result = normalize({ tspContact: 'Alex/Blair', tspContactAssigned: 'Alex/Blair' }, users, previous);
      expect(result).toEqual({
        tspContact: null, tspContactAssigned: null, customTspContact: 'Alex/Blair',
        planningNotes: [previous?.planningNotes, '[Imported TSP contact] Alex/Blair'].filter(Boolean).join('\n'),
      });
    },
  );
  it.each([' Alex One ', 'ALEX@EXAMPLE.ORG'])('preserves the legacy source %s alongside a primary ID', label => {
    expect(normalize({ tspContact: 'a', tspContactAssigned: label }, users)).toEqual({
      tspContact: 'a', tspContactAssigned: 'a', planningNotes: `[Imported TSP contact] ${label}`,
    });
  });
  it('preserves both different labels for the same person on updates', () => {
    expect(normalize({ tspContact: ' Alex One ', tspContactAssigned: 'alex@example.org' }, users,
      { tspContact: 'b', tspContactAssigned: 'b', planningNotes: 'Keep notes' })).toEqual({
      tspContact: 'a', tspContactAssigned: 'a',
      planningNotes: 'Keep notes\n[Imported TSP contact]  Alex One \n[Imported TSP contact] alex@example.org',
    });
  });
  it('preserves an identical resolved source only once', () => {
    expect(normalize({ tspContact: 'Alex One', tspContactAssigned: 'Alex One' }, users).planningNotes)
      .toBe('[Imported TSP contact] Alex One');
  });
  it('continues to preserve genuinely different unresolved contacts for review', () => {
    const patch = { tspContact: 'Alex/Blair', tspContactAssigned: 'Jen picking up' };
    expect(normalize(patch, users)).toEqual(patch);
  });
});
