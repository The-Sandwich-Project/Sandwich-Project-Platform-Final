/**
 * People admin (people/places rebuild, step 6): list, view, edit, add, merge
 * people and resolve their "needs a decision" flags. Used by
 * server/routes/people.ts. Rules from docs/data-model.md:
 *   - the role flag is the switch; turning one off never deletes anything
 *   - people are deactivated, not deleted (the only delete is the losing
 *     side of a merge, after everything pointing at it has been moved)
 *   - a replaced name is kept as an alias, never thrown away
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  people,
  personNameAliases,
  legacyPersonIds,
  personReviewFlags,
  regions,
  users,
  type Person,
} from '@shared/schema';

export const ROLE_FIELDS = ['isVolunteer', 'isDriver', 'isVanDriver', 'isHost', 'isTeamMember'] as const;

export interface PersonListItem {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
  isDriver: boolean;
  isVanDriver: boolean;
  isHost: boolean;
  isTeamMember: boolean;
  isActive: boolean;
  chapterRegionId: number | null;
  openFlags: number;
  hasLogin: boolean;
}

export async function listPeople(): Promise<PersonListItem[]> {
  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      email: people.email,
      phone: people.phone,
      isVolunteer: people.isVolunteer,
      isDriver: people.isDriver,
      isVanDriver: people.isVanDriver,
      isHost: people.isHost,
      isTeamMember: people.isTeamMember,
      isActive: people.isActive,
      chapterRegionId: people.chapterRegionId,
      // Fully qualified on purpose: Drizzle renders column references in a
      // select list without their table, and both subqueries' tables have an
      // "id" column of their own.
      openFlags: sql<number>`(SELECT COUNT(*)::int FROM person_review_flags f
        WHERE f.person_id = "people"."id" AND f.resolved_at IS NULL)`,
      hasLogin: sql<boolean>`EXISTS (SELECT 1 FROM users u WHERE u.person_id = "people"."id")`,
    })
    .from(people)
    .orderBy(asc(sql`lower(${people.lastName})`), asc(sql`lower(${people.firstName})`));
  return rows.map((r) => ({ ...r, openFlags: Number(r.openFlags), hasLogin: !!r.hasLogin }));
}

export async function listChapters() {
  return db
    .select({ id: regions.id, name: regions.name })
    .from(regions)
    .where(and(eq(regions.kind, 'chapter'), eq(regions.status, 'active')))
    .orderBy(asc(regions.name));
}

export async function getPerson(id: number) {
  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!person) return null;
  const [aliases, legacy, logins, flags] = await Promise.all([
    db.select().from(personNameAliases).where(eq(personNameAliases.personId, id)).orderBy(asc(personNameAliases.alias)),
    db.select().from(legacyPersonIds).where(eq(legacyPersonIds.personId, id)).orderBy(asc(legacyPersonIds.sourceTable)),
    db
      .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.personId, id)),
    db.select().from(personReviewFlags).where(eq(personReviewFlags.personId, id)).orderBy(asc(personReviewFlags.createdAt)),
  ]);
  return { person, aliases, legacy, logins, flags };
}

export class PeopleAdminError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function assertChapter(chapterRegionId: number | null | undefined) {
  if (chapterRegionId == null) return;
  const [r] = await db
    .select({ kind: regions.kind })
    .from(regions)
    .where(eq(regions.id, chapterRegionId))
    .limit(1);
  if (!r || r.kind !== 'chapter') throw new PeopleAdminError('Chapter must be a region of kind "chapter"');
}

async function addAlias(personId: number, alias: string) {
  const a = alias.trim().replace(/\s+/g, ' ');
  if (!a) return;
  await db
    .insert(personNameAliases)
    .values({ personId, alias: a, source: 'manual' })
    .onConflictDoNothing();
}

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

export interface PersonEdit {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  chapterRegionId?: number | null;
  nameConfirmed?: boolean; // the person confirmed this spelling → self_verified
  isVolunteer?: boolean;
  isDriver?: boolean;
  isVanDriver?: boolean;
  isHost?: boolean;
  isTeamMember?: boolean;
  isActive?: boolean;
}

export async function updatePerson(id: number, edit: PersonEdit): Promise<{ before: Person; after: Person }> {
  const [before] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!before) throw new PeopleAdminError('Person not found', 404);
  await assertChapter(edit.chapterRegionId);

  const { nameConfirmed, ...fields } = edit;
  const set: Partial<Person> = { ...fields, updatedAt: new Date() };
  const nameChanged =
    (fields.firstName !== undefined && fields.firstName !== before.firstName) ||
    (fields.lastName !== undefined && fields.lastName !== before.lastName);
  if (nameConfirmed) set.nameSource = 'self_verified';
  // An edited spelling is the admin's call; keep the old one as an alias.
  if (nameChanged) await addAlias(id, fullName(before));

  const [after] = await db.update(people).set(set).where(eq(people.id, id)).returning();
  return { before, after };
}

export async function createPerson(input: PersonEdit & { firstName: string }): Promise<Person> {
  await assertChapter(input.chapterRegionId);
  const { nameConfirmed, ...fields } = input;
  const [created] = await db
    .insert(people)
    .values({ lastName: '', ...fields, nameSource: nameConfirmed ? 'self_verified' : 'legacy_import' })
    .returning();
  return created;
}

/**
 * Merge `dropId` into `keepId`. Keeps keepId's name and contact details,
 * fills blanks from the other record, combines roles (on in either = on),
 * and moves every alias, old-record link, login and flag across. The other
 * name becomes an alias. The emptied record is then deleted.
 *
 * Neon's HTTP driver has no transactions, so the order matters: everything
 * that points at dropId is moved first; the delete runs last and the
 * database refuses it (RESTRICT) if anything was missed.
 */
export async function mergePeople(keepId: number, dropId: number) {
  if (keepId === dropId) throw new PeopleAdminError('Choose two different people');
  const [keep] = await db.select().from(people).where(eq(people.id, keepId)).limit(1);
  const [drop] = await db.select().from(people).where(eq(people.id, dropId)).limit(1);
  if (!keep || !drop) throw new PeopleAdminError('Person not found', 404);

  const fill = <K extends keyof Person>(k: K) => (keep[k] == null || keep[k] === '' ? drop[k] : keep[k]);
  await db
    .update(people)
    .set({
      email: fill('email'),
      phone: fill('phone'),
      address: fill('address'),
      latitude: fill('latitude'),
      longitude: fill('longitude'),
      geocodedAt: fill('geocodedAt'),
      chapterRegionId: fill('chapterRegionId'),
      notes: [keep.notes, drop.notes].filter(Boolean).join('\n') || null,
      isVolunteer: keep.isVolunteer || drop.isVolunteer,
      isDriver: keep.isDriver || drop.isDriver,
      isVanDriver: keep.isVanDriver || drop.isVanDriver,
      isHost: keep.isHost || drop.isHost,
      isTeamMember: keep.isTeamMember || drop.isTeamMember,
      isActive: keep.isActive || drop.isActive,
      updatedAt: new Date(),
    })
    .where(eq(people.id, keepId));

  // The kept record's name (and its name_source) stays. Aliases: copy over
  // (skipping ones keep already has), plus the other record's name.
  const dropAliases = await db.select().from(personNameAliases).where(eq(personNameAliases.personId, dropId));
  for (const a of dropAliases) {
    await db
      .insert(personNameAliases)
      .values({ personId: keepId, alias: a.alias, source: a.source, firstSeen: a.firstSeen })
      .onConflictDoNothing();
  }
  if (fullName(drop).toLowerCase() !== fullName(keep).toLowerCase()) await addAlias(keepId, fullName(drop));

  await db.update(legacyPersonIds).set({ personId: keepId }).where(eq(legacyPersonIds.personId, dropId));
  await db.update(users).set({ personId: keepId }).where(eq(users.personId, dropId));
  await db.update(personReviewFlags).set({ personId: keepId }).where(eq(personReviewFlags.personId, dropId));

  await db.delete(people).where(eq(people.id, dropId)); // aliases cascade
  const [after] = await db.select().from(people).where(eq(people.id, keepId)).limit(1);
  return { kept: after, dropped: drop };
}

export async function resolveFlag(flagId: number, userId: string | null, resolution: string) {
  const [flag] = await db
    .update(personReviewFlags)
    .set({ resolvedAt: new Date(), resolvedByUserId: userId, resolution })
    .where(and(eq(personReviewFlags.id, flagId), isNull(personReviewFlags.resolvedAt)))
    .returning();
  if (!flag) throw new PeopleAdminError('Flag not found or already resolved', 404);
  return flag;
}

/** For the merge picker: people other than `exceptId` matching a name. */
export async function searchPeople(term: string, exceptId: number) {
  const like = `%${term.trim().toLowerCase()}%`;
  const rows = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, email: people.email })
    .from(people)
    .where(
      sql`${people.id} <> ${exceptId} AND (lower(${people.firstName} || ' ' || ${people.lastName}) LIKE ${like}
          OR lower(coalesce(${people.email}, '')) LIKE ${like})`
    )
    .orderBy(asc(people.lastName))
    .limit(20);
  return rows;
}
