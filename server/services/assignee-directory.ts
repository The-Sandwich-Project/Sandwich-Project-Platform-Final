import { inArray, or, eq } from 'drizzle-orm';
import { db } from '../db';
import { users, drivers, volunteers, hostContacts } from '@shared/schema';
import type { MatchableUser } from './planning-sheet-row-update';

/**
 * Everyone the app's assignment picker lists (AssignmentDialog): team members,
 * the Drivers, Volunteers and Host Contacts directories. Each entry's `id` is
 * what the picker saves, so a sheet name matched here is connected exactly as
 * if someone had picked the person in the app:
 *   user        -> users.id
 *   driver      -> "443"            (also seen as "driver-443")
 *   volunteer   -> "volunteer-12"
 *   host contact-> "host-contact-5"
 *
 * Active people only, plus anyone in `keepIds` (already assigned somewhere),
 * so an existing assignee who has since gone inactive still shows by name.
 */
/** Split saved assignment IDs by the directory they point into. */
function splitIds(ids: string[]) {
  const keep = Array.from(new Set(ids.filter(Boolean)));
  const numIds = (prefixes: string[], allowBare: boolean) =>
    Array.from(
      new Set(
        keep
          .map((id) => {
            for (const p of prefixes) if (id.startsWith(p)) return id.slice(p.length);
            return allowBare ? id : '';
          })
          .filter((v) => /^\d+$/.test(v))
          .map(Number)
      )
    );
  return {
    driverIds: numIds(['driver-'], true),
    volunteerIds: numIds(['volunteer-'], false),
    hostContactIds: numIds(['host-contact-'], false),
    // Anything else that isn't a typed/custom name may be a user ID.
    userIds: keep.filter((id) => !/^\d+$/.test(id) && !/^(driver|volunteer|host-contact|custom)[-:]/.test(id) && !/\s/.test(id)),
  };
}

export async function loadAssigneeDirectory(keepIds: string[] = []): Promise<MatchableUser[]> {
  const ids = splitIds(keepIds);
  const keepDriverIds = ids.driverIds;
  const keepVolunteerIds = ids.volunteerIds;
  const keepHostContactIds = ids.hostContactIds;
  const keepUserIds = ids.userIds;

  const [userRows, driverRows, volunteerRows, contactRows] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName, isActive: users.isActive })
      .from(users)
      .where(keepUserIds.length ? or(eq(users.isActive, true), inArray(users.id, keepUserIds)) : eq(users.isActive, true)),
    db
      .select({ id: drivers.id, name: drivers.name, isActive: drivers.isActive })
      .from(drivers)
      .where(keepDriverIds.length ? or(eq(drivers.isActive, true), inArray(drivers.id, keepDriverIds)) : eq(drivers.isActive, true)),
    db
      .select({ id: volunteers.id, name: volunteers.name, isActive: volunteers.isActive })
      .from(volunteers)
      .where(keepVolunteerIds.length ? or(eq(volunteers.isActive, true), inArray(volunteers.id, keepVolunteerIds)) : eq(volunteers.isActive, true)),
    db
      .select({ id: hostContacts.id, name: hostContacts.name, isFormerHost: hostContacts.isFormerHost })
      .from(hostContacts)
      .where(keepHostContactIds.length ? or(eq(hostContacts.isFormerHost, false), inArray(hostContacts.id, keepHostContactIds)) : eq(hostContacts.isFormerHost, false)),
  ]);

  return toPeople(userRows, driverRows, volunteerRows, contactRows);
}

/**
 * Only the people these saved IDs point to (no full directory). For showing
 * names, e.g. writing assignees to the planning sheet; matching typed sheet
 * names needs the full directory (loadAssigneeDirectory).
 */
export async function loadAssigneesByIds(savedIds: string[]): Promise<MatchableUser[]> {
  const ids = splitIds(savedIds);
  const none = Promise.resolve([] as any[]);
  const [userRows, driverRows, volunteerRows, contactRows] = await Promise.all([
    ids.userIds.length
      ? db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName, isActive: users.isActive })
          .from(users)
          .where(inArray(users.id, ids.userIds))
      : none,
    ids.driverIds.length
      ? db.select({ id: drivers.id, name: drivers.name, isActive: drivers.isActive }).from(drivers).where(inArray(drivers.id, ids.driverIds))
      : none,
    ids.volunteerIds.length
      ? db.select({ id: volunteers.id, name: volunteers.name, isActive: volunteers.isActive }).from(volunteers).where(inArray(volunteers.id, ids.volunteerIds))
      : none,
    ids.hostContactIds.length
      ? db
          .select({ id: hostContacts.id, name: hostContacts.name, isFormerHost: hostContacts.isFormerHost })
          .from(hostContacts)
          .where(inArray(hostContacts.id, ids.hostContactIds))
      : none,
  ]);
  return toPeople(userRows, driverRows, volunteerRows, contactRows);
}

function fromName(
  id: string,
  name: string | null,
  isActive: boolean,
  kind: MatchableUser['kind'],
  aliases: string[] = []
): MatchableUser {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  const sp = n.indexOf(' ');
  return {
    id,
    firstName: sp > 0 ? n.slice(0, sp) : n || null,
    lastName: sp > 0 ? n.slice(sp + 1) : null,
    displayName: n || null,
    isActive,
    kind,
    aliases,
  };
}

function toPeople(
  userRows: Array<{ id: string; firstName: string | null; lastName: string | null; displayName: string | null; isActive: boolean | null }>,
  driverRows: Array<{ id: number; name: string; isActive: boolean }>,
  volunteerRows: Array<{ id: number; name: string; isActive: boolean }>,
  contactRows: Array<{ id: number; name: string; isFormerHost: boolean }>
): MatchableUser[] {
  return [
    ...userRows.map((u) => ({ ...u, isActive: u.isActive ?? true, kind: 'user' as const })),
    ...driverRows.map((d) => fromName(String(d.id), d.name, d.isActive, 'driver', [`driver-${d.id}`])),
    ...volunteerRows.map((v) => fromName(`volunteer-${v.id}`, v.name, v.isActive, 'volunteer')),
    ...contactRows.map((c) => fromName(`host-contact-${c.id}`, c.name, !c.isFormerHost, 'host-contact')),
  ];
}
