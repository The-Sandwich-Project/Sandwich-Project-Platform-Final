import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { hostContacts, hosts, volunteers, type HostContact, type Volunteer } from '@shared/schema';
import { logger } from '../utils/production-safe-logger';

/**
 * Hosts who also volunteer at events.
 *
 * A host contact with `isVolunteer = true` gets a linked row in `volunteers`
 * (`volunteers.host_contact_id`), so the person shows up anywhere the app lists
 * volunteers — assignment pickers, driver planning, route map, people search,
 * the assignee directory — with a real volunteer id. Keeping a real row (rather
 * than splicing host contacts into each volunteer query) means existing
 * `volunteer-<id>` assignments keep working and nothing else needs to know.
 *
 * - Checked: reuse the linked row (reactivating it if needed) or, failing that,
 *   adopt an existing unlinked volunteer that matches on name+email or
 *   name+phone (the same rules the host-contact duplicate check uses), or
 *   create a new one. Name/phone/email/host are refreshed from the contact.
 * - Unchecked: the linked row is deactivated, not deleted, so past event
 *   assignments still resolve and re-checking restores the same record.
 * - Host contact deleted: the volunteer row is unlinked and left as-is — the
 *   person stopped hosting, which doesn't mean they stopped volunteering.
 */

const UNCHECKED_REASON = 'Unmarked as volunteer on their host contact';

const digitsOnly = (s?: string | null) => (s || '').replace(/\D/g, '');

async function findLinkedVolunteer(contactId: number): Promise<Volunteer | undefined> {
  const [row] = await db
    .select()
    .from(volunteers)
    .where(eq(volunteers.hostContactId, contactId))
    .limit(1);
  return row;
}

async function findMatchingUnlinkedVolunteer(contact: HostContact): Promise<Volunteer | undefined> {
  const name = contact.name?.trim();
  if (!name) return undefined;

  const email = contact.email?.trim().toLowerCase();
  const phone = digitsOnly(contact.phone);

  const matchers = [];
  if (email) matchers.push(sql`LOWER(TRIM(${volunteers.email})) = ${email}`);
  if (phone) matchers.push(sql`REGEXP_REPLACE(${volunteers.phone}, '[^0-9]', '', 'g') = ${phone}`);
  if (matchers.length === 0) return undefined;

  const [row] = await db
    .select()
    .from(volunteers)
    .where(
      and(
        isNull(volunteers.hostContactId),
        sql`LOWER(TRIM(${volunteers.name})) = ${name.toLowerCase()}`,
        or(...matchers)
      )
    )
    .limit(1);
  return row;
}

async function getHostName(hostId: number): Promise<string | null> {
  const [host] = await db.select({ name: hosts.name }).from(hosts).where(eq(hosts.id, hostId)).limit(1);
  return host?.name ?? null;
}

/** Fields owned by the host contact and copied onto the volunteer record. */
async function contactFields(contact: HostContact) {
  const fields: Partial<Volunteer> = {
    name: contact.name,
    phone: contact.phone || null,
    hostId: contact.hostId,
    // The Hosts page edits a contact's area via hostLocation (hostId stays put),
    // so prefer it and use the parent host's name only as a fallback.
    hostLocation: contact.hostLocation?.trim() || (await getHostName(contact.hostId)) || null,
  };
  // Only overwrite email/address when the contact actually has one, so a
  // volunteer record with richer info isn't blanked by a sparse contact.
  if (contact.email) fields.email = contact.email;
  if (contact.address) {
    fields.address = contact.address;
    // Coordinates must describe the address we just copied: take the
    // contact's pair, or clear any old pair so the map doesn't pin the
    // volunteer at a previous address.
    const hasCoords = !!(contact.latitude && contact.longitude);
    fields.latitude = hasCoords ? contact.latitude : null;
    fields.longitude = hasCoords ? contact.longitude : null;
    fields.geocodedAt = hasCoords ? contact.geocodedAt ?? new Date() : null;
  }
  return fields;
}

/**
 * Bring the linked volunteer record in line with the host contact's
 * `isVolunteer` flag. Safe to call after every create/update. Never throws —
 * a sync failure is logged and must not fail the host contact save.
 */
export async function syncHostContactVolunteer(contact: HostContact): Promise<void> {
  try {
    const linked = await findLinkedVolunteer(contact.id);

    if (!contact.isVolunteer) {
      if (linked && linked.isActive) {
        await db
          .update(volunteers)
          .set({ isActive: false, inactiveReason: UNCHECKED_REASON, updatedAt: new Date() })
          .where(eq(volunteers.id, linked.id));
        logger.info(`Host contact ${contact.id} unmarked as volunteer; deactivated volunteer ${linked.id}`);
      }
      return;
    }

    const fields = await contactFields(contact);

    if (linked) {
      const reactivate =
        !linked.isActive ? { isActive: true, inactiveReason: null } : {};
      await db
        .update(volunteers)
        .set({ ...fields, ...reactivate, updatedAt: new Date() })
        .where(eq(volunteers.id, linked.id));
      return;
    }

    const existing = await findMatchingUnlinkedVolunteer(contact);
    if (existing) {
      // Claim only if still unlinked: two concurrent saves can both match the
      // same volunteer, and the loser must not steal the winner's link.
      const claimed = await db
        .update(volunteers)
        .set({
          ...fields,
          hostContactId: contact.id,
          isActive: true,
          inactiveReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(volunteers.id, existing.id), isNull(volunteers.hostContactId)))
        .returning({ id: volunteers.id });
      if (claimed.length > 0) {
        logger.info(`Linked host contact ${contact.id} to existing volunteer ${existing.id}`);
        return;
      }
      // Lost the race: fall through and give this contact its own record.
    }

    const [created] = await db
      .insert(volunteers)
      .values({
        ...fields,
        name: contact.name,
        hostContactId: contact.id,
        isActive: true,
        notes: `Host contact${fields.hostLocation ? ` at ${fields.hostLocation}` : ''} who also volunteers at events.`,
      })
      .returning({ id: volunteers.id });
    logger.info(`Created volunteer ${created.id} for host contact ${contact.id}`);
  } catch (error) {
    logger.error(`Failed to sync volunteer record for host contact ${contact.id}`, error);
  }
}

/**
 * Called before a whole host location (and with it, all of its contacts) is
 * deleted: detach every volunteer linked to one of those contacts.
 */
export async function unlinkVolunteersForHost(hostId: number): Promise<void> {
  await db
    .update(volunteers)
    .set({ hostContactId: null, updatedAt: new Date() })
    .where(
      sql`${volunteers.hostContactId} IN (SELECT ${hostContacts.id} FROM ${hostContacts} WHERE ${hostContacts.hostId} = ${hostId})`
    );
}

/**
 * Called when a host contact is deleted: detach the volunteer record so it
 * stands on its own. Never throws.
 */
export async function unlinkHostContactVolunteer(contactId: number): Promise<void> {
  try {
    await db
      .update(volunteers)
      .set({ hostContactId: null, updatedAt: new Date() })
      .where(eq(volunteers.hostContactId, contactId));
  } catch (error) {
    logger.error(`Failed to unlink volunteer record for host contact ${contactId}`, error);
  }
}

