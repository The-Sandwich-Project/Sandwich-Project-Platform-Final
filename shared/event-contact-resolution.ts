/** Deterministic identity matching. Never pick the first matching account. */
export interface ContactDirectoryUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean | null;
}
export type ContactResolution =
  | { kind: 'empty'; candidates: string[] }
  | { kind: 'id' | 'email' | 'full_name'; userId: string; candidates: string[] }
  | { kind: 'review'; candidates: string[] };
const clean = (value?: string | null) => value?.trim() || '';
const key = (value?: string | null) => clean(value).toLocaleLowerCase('en-US');

export function resolveEventContact(value: string | null | undefined, users: readonly ContactDirectoryUser[]): ContactResolution {
  const raw = clean(value);
  if (!raw) return { kind: 'empty', candidates: [] };
  const idMatch = users.find(user => user.id === raw);
  if (idMatch) return { kind: 'id', userId: idMatch.id, candidates: [idMatch.id] };
  // Include inactive accounts when detecting ambiguity. A duplicate account must
  // not be silently bypassed just because one happens to be disabled.
  const email = users.filter(user => key(user.email) === key(raw));
  const full = users.filter(user => clean(user.firstName) && clean(user.lastName)
    && key(`${clean(user.firstName)} ${clean(user.lastName)}`) === key(raw));
  const matches = email.length ? email : full;
  if (matches.length === 1 && matches[0].isActive !== false) {
    return { kind: email.length ? 'email' : 'full_name', userId: matches[0].id, candidates: [matches[0].id] };
  }
  const suggestions = matches.length ? matches : users.filter(user => key(user.firstName) === key(raw));
  return { kind: 'review', candidates: suggestions.map(user => user.id).sort() };
}

export interface EventContactFields {
  tspContact?: string | null;
  tspContactAssigned?: string | null;
  customTspContact?: string | null;
  planningNotes?: string | null;
}
export const hasEventContactPatch = (patch: EventContactFields) =>
  patch.tspContact !== undefined || patch.tspContactAssigned !== undefined;

/**
 * Canonical contact + compatibility mirror for new assignments. Historical
 * conflicts and unchanged full-form snapshots are intentionally not backfilled.
 * New unresolved assignments retain their source text in custom contact/notes.
 */
export function normalizeEventContactPatch<T extends EventContactFields>(
  patch: T, users: readonly ContactDirectoryUser[], previous?: EventContactFields,
): T & EventContactFields {
  if (!hasEventContactPatch(patch)) return { ...patch };
  const hasPrimary = patch.tspContact !== undefined;
  const hasAssigned = patch.tspContactAssigned !== undefined;
  if (previous) {
    const unchanged = (!hasPrimary || patch.tspContact === previous.tspContact)
      && (!hasAssigned || patch.tspContactAssigned === previous.tspContactAssigned);
    if (unchanged) return { ...patch };
    // Do not collapse two historical people during an unrelated form save.
    if (clean(previous.tspContact) && clean(previous.tspContactAssigned)
      && previous.tspContact !== previous.tspContactAssigned) return { ...patch };
  }
  const primary = resolveEventContact(patch.tspContact, users);
  const assigned = resolveEventContact(patch.tspContactAssigned, users);
  if (hasPrimary && hasAssigned && clean(patch.tspContact) && clean(patch.tspContactAssigned)) {
    const identicalSource = patch.tspContact === patch.tspContactAssigned;
    const sameUser = 'userId' in primary && 'userId' in assigned && primary.userId === assigned.userId;
    if (!identicalSource && !sameUser) {
      return { ...patch }; // An explicit conflict is review work, never last-value-wins.
    }
  }
  // An unchanged empty primary in a full-form save must not erase a newly
  // supplied legacy assignment. Clearing a previously populated primary is
  // still an explicit removal, even when the old mirror is also submitted.
  const removesPrimary = !!previous && !!clean(previous.tspContact) && !clean(patch.tspContact);
  const usePrimary = hasPrimary && (removesPrimary || !!clean(patch.tspContact) || !clean(patch.tspContactAssigned));
  const raw = usePrimary ? patch.tspContact : patch.tspContactAssigned;
  const resolution = usePrimary ? primary : assigned;
  if (previous && 'userId' in resolution) {
    const other = usePrimary ? previous.tspContactAssigned : previous.tspContact;
    const previousChosen = usePrimary ? previous.tspContact : previous.tspContactAssigned;
    if (!clean(previousChosen) && clean(other) && other !== resolution.userId) return { ...patch };
  }
  // Keep unchanged historical labels for the reviewed backfill, but treat a
  // newly entered unresolved label as a custom contact, not a stale user ID.
  const previousChosen = usePrimary ? previous?.tspContact : previous?.tspContactAssigned;
  if (previous && resolution.kind === 'review' && raw === previousChosen) return { ...patch };
  const customContact = patch.customTspContact !== undefined ? patch.customTspContact : previous?.customTspContact;
  const planningNotes = patch.planningNotes !== undefined ? patch.planningNotes : previous?.planningNotes;
  const result: T & EventContactFields = { ...patch };
  if ('userId' in resolution) {
    result.tspContact = resolution.userId;
    result.tspContactAssigned = resolution.userId;
  } else if (resolution.kind === 'empty') {
    result.tspContact = null;
    result.tspContactAssigned = null;
  } else {
    result.tspContact = null;
    result.tspContactAssigned = null;
    result.customTspContact = [customContact, raw].filter(Boolean).join('\n');
  }
  // Both supplied fields may contain useful source text for the same person.
  // Preserve each exact non-ID label once, including the non-selected field.
  const sourceLabels = [...new Set([
    ...(hasPrimary && primary.kind !== 'id' && primary.kind !== 'empty' ? [patch.tspContact!] : []),
    ...(hasAssigned && assigned.kind !== 'id' && assigned.kind !== 'empty' ? [patch.tspContactAssigned!] : []),
  ])];
  if (resolution.kind !== 'empty' && sourceLabels.length) {
    result.planningNotes = [planningNotes, ...sourceLabels.map(label => `[Imported TSP contact] ${label}`)]
      .filter(Boolean).join('\n');
  }
  return result;
}
