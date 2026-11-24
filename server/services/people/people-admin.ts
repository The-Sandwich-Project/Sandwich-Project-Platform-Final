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
  volunteerProfiles,
  sheetSyncValues,
  sheetFieldConflicts,
  type Person,
} from '@shared/schema';

export const ROLE_FIELDS = ['isVolunteer', 'isDriver', 'isVanDriver', 'isHost', 'isTeamMember', 'isBoardMember', 'isAdvisoryBoardMember', 'isIntakeTeam'] as const;

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
  isBoardMember: boolean;
  isAdvisoryBoardMember: boolean;
  isIntakeTeam: boolean;
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
      isBoardMember: people.isBoardMember,
      isAdvisoryBoardMember: people.isAdvisoryBoardMember,
      isIntakeTeam: people.isIntakeTeam,
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
  const [volunteerProfile] = await db.select().from(volunteerProfiles).where(eq(volunteerProfiles.personId, id));
  const sheetConflicts = await db
    .select()
    .from(sheetFieldConflicts)
    .where(and(eq(sheetFieldConflicts.personId, id), isNull(sheetFieldConflicts.resolvedAt)));
  return { person, aliases, legacy, logins, flags, volunteerProfile: volunteerProfile ?? null, sheetConflicts };
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
  isBoardMember?: boolean;
  isAdvisoryBoardMember?: boolean;
  isIntakeTeam?: boolean;
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
  // Record honestly where the name now comes from: the person confirmed it,
  // or an admin typed it (a respelling no longer carries the old source).
  if (nameConfirmed) set.nameSource = 'self_verified';
  else if (nameChanged) set.nameSource = 'admin_entered';
  // Keep the replaced spelling as an alias.
  if (nameChanged) await addAlias(id, fullName(before));

  const [after] = await db.update(people).set(set).where(eq(people.id, id)).returning();
  return { before, after };
}

/** The backfill (step 5) has run once old records have been linked. */
async function backfillHasRun(): Promise<boolean> {
  const [row] = await db.select({ id: legacyPersonIds.id }).from(legacyPersonIds).limit(1);
  return !!row;
}

export async function createPerson(input: PersonEdit & { firstName: string }): Promise<Person> {
  // The backfill is one-shot and refuses to run once `people` has rows, so a
  // person added by hand first would block it for good.
  if (!(await backfillHasRun())) {
    throw new PeopleAdminError(
      'Run the people backfill (npm run people:backfill) before adding people by hand.',
      409
    );
  }
  await assertChapter(input.chapterRegionId);
  const { nameConfirmed, ...fields } = input;
  const [created] = await db
    .insert(people)
    .values({ lastName: '', ...fields, nameSource: nameConfirmed ? 'self_verified' : 'admin_entered' })
    .returning();
  return created;
}

const NAME_RANK = ['self_verified', 'self_reported', 'admin_entered', 'sheet', 'legacy_import'];
const DECIDED_BY_MERGE = ['possible_duplicate', 'shared_contact'];

/**
 * Merge `dropId` into `keepId`:
 *   - name: the better-sourced name wins (names are never downgraded); the
 *     other spelling becomes an alias
 *   - address + map position move as one unit: the kept record's if it has
 *     an address, otherwise the other record's
 *   - email, phone, chapter: the kept record's, blanks filled from the other
 *   - roles combined (on in either = on); notes appended once
 *   - aliases, old-record links, logins and flags move across, and the
 *     duplicate / shared-contact questions between the two are resolved as
 *     "merged"
 *   - the emptied record is deleted
 *
 * Neon's HTTP driver has no transactions, so the order is chosen to make a
 * failed merge safe to retry: everything pointing at dropId moves first
 * (each step is idempotent), the kept row is updated next, and the delete
 * runs last; the database refuses it (RESTRICT) if anything was missed.
 */
export async function mergePeople(keepId: number, dropId: number, userId: string | null = null) {
  if (keepId === dropId) throw new PeopleAdminError('Choose two different people');
  const [keep] = await db.select().from(people).where(eq(people.id, keepId)).limit(1);
  const [drop] = await db.select().from(people).where(eq(people.id, dropId)).limit(1);
  if (!keep || !drop) throw new PeopleAdminError('Person not found', 404);

  const dropWinsName = NAME_RANK.indexOf(drop.nameSource) < NAME_RANK.indexOf(keep.nameSource);
  const winner = dropWinsName ? drop : keep;
  const loser = dropWinsName ? keep : drop;

  // Questions the two records had about each other, settled by this merge.
  const mentions = (detail: string, p: Person) => detail.toLowerCase().includes(fullName(p).toLowerCase());
  const openFlags = await db
    .select()
    .from(personReviewFlags)
    .where(
      and(
        sql`${personReviewFlags.personId} IN (${keepId}, ${dropId})`,
        isNull(personReviewFlags.resolvedAt)
      )
    );
  const settled = openFlags
    .filter((f) => DECIDED_BY_MERGE.includes(f.kind))
    .filter((f) => (f.personId === keepId ? mentions(f.detail, drop) : mentions(f.detail, keep)))
    .map((f) => f.id);

  // 1. Move everything that points at dropId (each step safe to repeat)
  const dropAliases = await db.select().from(personNameAliases).where(eq(personNameAliases.personId, dropId));
  for (const a of dropAliases) {
    await db
      .insert(personNameAliases)
      .values({ personId: keepId, alias: a.alias, source: a.source, firstSeen: a.firstSeen })
      .onConflictDoNothing();
  }
  if (fullName(loser).toLowerCase() !== fullName(winner).toLowerCase()) await addAlias(keepId, fullName(loser));
  await db.update(legacyPersonIds).set({ personId: keepId }).where(eq(legacyPersonIds.personId, dropId));
  await db.update(users).set({ personId: keepId }).where(eq(users.personId, dropId));
  await db.update(personReviewFlags).set({ personId: keepId }).where(eq(personReviewFlags.personId, dropId));
  // Volunteer details: the kept person's profile wins; otherwise the dropped
  // one's moves across. Sheet bookkeeping moves where the kept person has none
  // for that sheet field, so the next sync still recognises the row.
  const [keepProfile] = await db.select({ id: volunteerProfiles.id }).from(volunteerProfiles).where(eq(volunteerProfiles.personId, keepId));
  if (!keepProfile) {
    await db.update(volunteerProfiles).set({ personId: keepId }).where(eq(volunteerProfiles.personId, dropId));
  }
  const keepValues = await db.select().from(sheetSyncValues).where(eq(sheetSyncValues.personId, keepId));
  const dropValues = await db.select().from(sheetSyncValues).where(eq(sheetSyncValues.personId, dropId));
  for (const v of dropValues) {
    if (!keepValues.some((k) => k.sheet === v.sheet && k.field === v.field)) {
      await db.update(sheetSyncValues).set({ personId: keepId }).where(eq(sheetSyncValues.id, v.id));
    }
  }
  await db.update(sheetFieldConflicts).set({ personId: keepId }).where(eq(sheetFieldConflicts.personId, dropId));
  for (const flagId of settled) {
    await db
      .update(personReviewFlags)
      .set({ resolvedAt: new Date(), resolvedByUserId: userId, resolution: 'Same person: merged' })
      .where(and(eq(personReviewFlags.id, flagId), isNull(personReviewFlags.resolvedAt)));
  }

  // 2. Update the kept row
  const fill = <K extends keyof Person>(k: K) => (keep[k] == null || keep[k] === '' ? drop[k] : keep[k]);
  const place = keep.address && keep.address.trim() ? keep : drop;
  const notes =
    drop.notes && !(keep.notes ?? '').includes(drop.notes)
      ? [keep.notes, drop.notes].filter(Boolean).join('\n')
      : keep.notes;
  await db
    .update(people)
    .set({
      firstName: winner.firstName,
      lastName: winner.lastName,
      nameSource: winner.nameSource,
      email: fill('email'),
      phone: fill('phone'),
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      geocodedAt: place.geocodedAt,
      chapterRegionId: fill('chapterRegionId'),
      notes,
      isVolunteer: keep.isVolunteer || drop.isVolunteer,
      isDriver: keep.isDriver || drop.isDriver,
      isVanDriver: keep.isVanDriver || drop.isVanDriver,
      isHost: keep.isHost || drop.isHost,
      isTeamMember: keep.isTeamMember || drop.isTeamMember,
      isBoardMember: keep.isBoardMember || drop.isBoardMember,
      isAdvisoryBoardMember: keep.isAdvisoryBoardMember || drop.isAdvisoryBoardMember,
      isIntakeTeam: keep.isIntakeTeam || drop.isIntakeTeam,
      isActive: keep.isActive || drop.isActive,
      updatedAt: new Date(),
    })
    .where(eq(people.id, keepId));

  // 3. Delete the emptied record (its aliases, and a volunteer profile or
  //    sheet values the kept person already had, cascade)
  await db.delete(people).where(eq(people.id, dropId));
  const [after] = await db.select().from(people).where(eq(people.id, keepId)).limit(1);
  return { kept: after, dropped: drop, resolvedFlags: settled.length };
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
