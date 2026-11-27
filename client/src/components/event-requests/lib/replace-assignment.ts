/**
 * "Change person" on an event card: replace one assigned driver or volunteer
 * with whoever is picked in the assignment dialog (for example a typed-in name
 * swapped for the person in the database), and/or move them between the
 * confirmed and tentative lists.
 *
 * The dialog's save handler (event-requests/index.tsx) only knows how to ADD
 * people to the existing lists. These helpers wrap it:
 *   1. `withoutPerson` gives it a copy of the event with the edited person
 *      already removed from both lists (and from the details map unless they
 *      were picked again), so its add logic produces a replacement.
 *   2. `finishReplacement` makes sure the update also writes the list it did
 *      not add to (so the person leaves it) and carries the spot's note over
 *      to a one-for-one replacement.
 */

export type AssignmentKind = 'driver' | 'volunteer';

const KEYS = {
  driver: { assigned: 'assignedDriverIds', tentative: 'tentativeDriverIds', details: 'driverDetails' },
  volunteer: { assigned: 'assignedVolunteerIds', tentative: 'tentativeVolunteerIds', details: 'volunteerDetails' },
} as const;

/** Reads an id list stored as a JS array or a Postgres array string ("{a,b}"). */
export function toIdList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter((s) => s && s.trim());
  if (typeof value === 'string') {
    const cleaned = value.replace(/^{|}$/g, '');
    if (!cleaned) return [];
    const parts = cleaned.match(/"[^"]*"|[^",]+/g) || [];
    return parts.map((s) => s.replace(/"/g, '').trim()).filter(Boolean);
  }
  return [];
}

export interface Replacement {
  /** Event copy to feed the add logic: the edited person is in neither list. */
  event: Record<string, any>;
  /** The edited person's details entry (name, note…), if any. */
  replacedDetails: Record<string, any> | null;
}

export function withoutPerson(
  event: Record<string, any>,
  kind: AssignmentKind,
  personId: string,
  picked: string[]
): Replacement {
  const k = KEYS[kind];
  const copy: Record<string, any> = { ...event };
  copy[k.assigned] = toIdList(event[k.assigned]).filter((id) => id !== personId);
  copy[k.tentative] = toIdList(event[k.tentative]).filter((id) => id !== personId);
  const details = { ...((event[k.details] as Record<string, any>) || {}) };
  const replacedDetails = details[personId] || null;
  if (!picked.includes(personId)) delete details[personId];
  copy[k.details] = details;
  return { event: copy, replacedDetails };
}

export function finishReplacement(
  updateData: Record<string, any>,
  replacement: Replacement,
  kind: AssignmentKind,
  personId: string,
  picked: string[],
  /** Whether the picked people were saved as tentative (else confirmed). */
  asTentative: boolean
): Record<string, any> {
  const k = KEYS[kind];
  const out = { ...updateData };
  for (const key of [k.assigned, k.tentative, k.details]) {
    if (!(key in out)) out[key] = replacement.event[key];
  }
  // A picked person who was already on the event in the other list (e.g.
  // tentative B chosen to replace confirmed A, saved as confirmed) leaves that
  // list, so nobody ends up both confirmed and tentative.
  const otherKey = asTentative ? k.assigned : k.tentative;
  const pickedSet = new Set(picked);
  out[otherKey] = toIdList(out[otherKey]).filter((id) => !pickedSet.has(id));
  const newId = picked.length === 1 ? picked[0] : null;
  const note = replacement.replacedDetails?.notes;
  if (newId && newId !== personId && note) {
    const details = { ...(out[k.details] || {}) };
    // The picked person may already be on the event with their own note
    // (e.g. a typed-in duplicate replaced by the existing database entry):
    // keep both notes rather than overwriting one.
    const existing: string = details[newId]?.notes || '';
    let notes = note;
    if (existing.trim() === String(note).trim()) notes = existing;
    else if (existing.trim()) notes = `${existing}\n${note}`;
    details[newId] = { ...(details[newId] || {}), notes };
    out[k.details] = details;
  }
  return out;
}
