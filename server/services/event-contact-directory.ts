import { db } from '../db';
import { users } from '@shared/schema';
import { hasEventContactPatch, normalizeEventContactPatch, type EventContactFields } from '@shared/event-contact-resolution';

export async function normalizeEventContacts<T extends EventContactFields>(patch: T, previous?: EventContactFields) {
  if (!hasEventContactPatch(patch)) return patch;
  if (previous && (patch.tspContact === undefined || patch.tspContact === previous.tspContact)
    && (patch.tspContactAssigned === undefined || patch.tspContactAssigned === previous.tspContactAssigned)) return patch;
  // Fetch only identity fields, never credentials or the full user profile.
  const directory = await db.select({ id: users.id, email: users.email,
    firstName: users.firstName, lastName: users.lastName, isActive: users.isActive }).from(users);
  return normalizeEventContactPatch(patch, directory, previous);
}
