import { Router } from 'express';
import { db } from '../db';
import {
  users,
  drivers,
  volunteers,
  hosts,
  hostContacts,
  recipients,
  recipientTspContacts,
  contacts,
  eventRequests,
  organizations,
} from '@shared/schema';
import { ilike, or, sql } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';

const router = Router();

interface PersonSearchResult {
  id: number | string;
  name: string;
  email: string | null;
  phone: string | null;
  sourceType: 'user' | 'driver' | 'volunteer' | 'host' | 'hostContact' | 'recipient' | 'recipientTspContact' | 'contact';
  sourceLabel: string;
  organization?: string | null;
  role?: string | null;
  link: string;
  /**
   * Which field of the record matched the search term. Used by the
   * client to render a "Matched: <field>" hint so the user can see why
   * a record showed up — critical when the query term (e.g. "marcy")
   * appears in a non-name field like an email or an organization.
   */
  matchedField?: string;
  /**
   * The actual value of the matched field. Rendered underneath the
   * result as a small snippet so the user gets a preview without
   * clicking through.
   */
  matchedText?: string;
}

/**
 * Given a query string and a set of candidate fields, return the first
 * field whose value contains the query (case-insensitive). Fields are
 * checked in the order provided so callers can express priority (e.g.
 * "Name" beats "Email" — if a record matches on both, we surface Name
 * as the more useful reason).
 *
 * Returns { field: <human label>, text: <matched value> } or undefined
 * when no field matched (which shouldn't happen for a returned row but
 * we guard for safety).
 */
function detectMatch(
  query: string,
  candidates: Array<{ label: string; value: string | null | undefined }>,
): { field: string; text: string } | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  for (const c of candidates) {
    const v = c.value?.toString();
    if (v && v.toLowerCase().includes(q)) {
      return { field: c.label, text: v };
    }
  }
  return undefined;
}

/**
 * Unified people search across all contact databases
 * GET /api/people/search?q=searchTerm
 */
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q as string;

    if (!query || query.trim().length < 2) {
      return res.json({ results: [] });
    }

    // Trim once and reuse everywhere. The DB `searchTerm` uses the trimmed
    // form; any post-fetch client-side filter/sort MUST also compare against
    // this trimmed form so a query like " john " doesn't cause the DB to
    // match "John Smith" and then be silently dropped by an untrimmed
    // .includes() check on the returned rows.
    const trimmedQuery = query.trim();
    const searchLower = trimmedQuery.toLowerCase();
    const searchTerm = `%${trimmedQuery}%`;
    const results: PersonSearchResult[] = [];

    // Search users
    const userResults = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        displayName: users.displayName,
        email: users.email,
        phone: users.phoneNumber,
      })
      .from(users)
      .where(
        or(
          ilike(users.firstName, searchTerm),
          ilike(users.lastName, searchTerm),
          ilike(users.displayName, searchTerm),
          ilike(users.email, searchTerm),
          ilike(users.phoneNumber, searchTerm)
        )
      )
      .limit(10);

    for (const user of userResults) {
      const name = user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown';
      const match = detectMatch(query, [
        { label: 'Name', value: name },
        { label: 'First name', value: user.firstName },
        { label: 'Last name', value: user.lastName },
        { label: 'Display name', value: user.displayName },
        { label: 'Email', value: user.email },
        { label: 'Phone', value: user.phone },
      ]);
      results.push({
        id: user.id,
        name,
        email: user.email,
        phone: user.phone,
        sourceType: 'user',
        sourceLabel: 'Team Member',
        link: `/dashboard?section=users&user=${user.id}`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search drivers
    const driverResults = await db
      .select({
        id: drivers.id,
        name: drivers.name,
        email: drivers.email,
        phone: drivers.phone,
      })
      .from(drivers)
      .where(
        or(
          ilike(drivers.name, searchTerm),
          ilike(drivers.email, searchTerm),
          ilike(drivers.phone, searchTerm)
        )
      )
      .limit(10);

    for (const driver of driverResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: driver.name },
        { label: 'Email', value: driver.email },
        { label: 'Phone', value: driver.phone },
      ]);
      results.push({
        id: driver.id,
        name: driver.name || 'Unknown Driver',
        email: driver.email,
        phone: driver.phone,
        sourceType: 'driver',
        sourceLabel: 'Driver',
        link: `/dashboard?section=drivers`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search volunteers
    const volunteerResults = await db
      .select({
        id: volunteers.id,
        name: volunteers.name,
        email: volunteers.email,
        phone: volunteers.phone,
      })
      .from(volunteers)
      .where(
        or(
          ilike(volunteers.name, searchTerm),
          ilike(volunteers.email, searchTerm),
          ilike(volunteers.phone, searchTerm)
        )
      )
      .limit(10);

    for (const volunteer of volunteerResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: volunteer.name },
        { label: 'Email', value: volunteer.email },
        { label: 'Phone', value: volunteer.phone },
      ]);
      results.push({
        id: volunteer.id,
        name: volunteer.name || 'Unknown Volunteer',
        email: volunteer.email,
        phone: volunteer.phone,
        sourceType: 'volunteer',
        sourceLabel: 'Volunteer',
        link: `/dashboard?section=volunteers`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search hosts
    const hostResults = await db
      .select({
        id: hosts.id,
        name: hosts.name,
        email: hosts.email,
        phone: hosts.phone,
      })
      .from(hosts)
      .where(
        or(
          ilike(hosts.name, searchTerm),
          ilike(hosts.email, searchTerm),
          ilike(hosts.phone, searchTerm)
        )
      )
      .limit(10);

    for (const host of hostResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: host.name },
        { label: 'Email', value: host.email },
        { label: 'Phone', value: host.phone },
      ]);
      results.push({
        id: host.id,
        name: host.name || 'Unknown Host',
        email: host.email,
        phone: host.phone,
        sourceType: 'host',
        sourceLabel: 'Host',
        link: `/dashboard?section=hosts`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search host contacts
    const hostContactResults = await db
      .select({
        id: hostContacts.id,
        name: hostContacts.name,
        email: hostContacts.email,
        phone: hostContacts.phone,
        role: hostContacts.role,
        hostId: hostContacts.hostId,
      })
      .from(hostContacts)
      .where(
        or(
          ilike(hostContacts.name, searchTerm),
          ilike(hostContacts.email, searchTerm),
          ilike(hostContacts.phone, searchTerm)
        )
      )
      .limit(10);

    for (const contact of hostContactResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: contact.name },
        { label: 'Email', value: contact.email },
        { label: 'Phone', value: contact.phone },
      ]);
      results.push({
        id: contact.id,
        name: contact.name || 'Unknown Contact',
        email: contact.email,
        phone: contact.phone,
        sourceType: 'hostContact',
        sourceLabel: 'Host Contact',
        role: contact.role,
        link: `/dashboard?section=hosts`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search recipients
    const recipientResults = await db
      .select({
        id: recipients.id,
        name: recipients.name,
        email: recipients.email,
        phone: recipients.phone,
        contactPersonName: recipients.contactPersonName,
        contactPersonEmail: recipients.contactPersonEmail,
        contactPersonPhone: recipients.contactPersonPhone,
      })
      .from(recipients)
      .where(
        or(
          ilike(recipients.name, searchTerm),
          ilike(recipients.email, searchTerm),
          ilike(recipients.phone, searchTerm),
          ilike(recipients.contactPersonName, searchTerm),
          ilike(recipients.contactPersonEmail, searchTerm)
        )
      )
      .limit(10);

    for (const recipient of recipientResults) {
      // Uses the outer `searchLower` (trimmed + lowercased) so this
      // filter matches what the DB actually queried on.
      const mainMatched =
        recipient.name?.toLowerCase().includes(searchLower) ||
        recipient.email?.toLowerCase().includes(searchLower) ||
        recipient.phone?.toLowerCase().includes(searchLower);

      // Only surface the main recipient row when the query hit one of
      // ITS fields (name/email/phone). Previously we always emitted the
      // main row even when only the contact-person fields matched,
      // making it look like the recipient's own name/email contained
      // the query when it didn't.
      if (mainMatched) {
        const match = detectMatch(query, [
          { label: 'Name', value: recipient.name },
          { label: 'Email', value: recipient.email },
          { label: 'Phone', value: recipient.phone },
        ]);
        results.push({
          id: recipient.id,
          name: recipient.name || 'Unknown Recipient',
          email: recipient.email,
          phone: recipient.phone,
          sourceType: 'recipient',
          sourceLabel: 'Recipient',
          link: `/dashboard?section=recipients&highlight=${recipient.id}`,
          matchedField: match?.field,
          matchedText: match?.text,
        });
      }

      if (recipient.contactPersonName?.toLowerCase().includes(searchLower) ||
          recipient.contactPersonEmail?.toLowerCase().includes(searchLower)) {
        const match = detectMatch(query, [
          { label: 'Contact name', value: recipient.contactPersonName },
          { label: 'Contact email', value: recipient.contactPersonEmail },
          { label: 'Contact phone', value: recipient.contactPersonPhone },
        ]);
        results.push({
          id: `${recipient.id}-contact`,
          name: recipient.contactPersonName || 'Contact',
          email: recipient.contactPersonEmail,
          phone: recipient.contactPersonPhone,
          sourceType: 'recipient',
          sourceLabel: 'Recipient Contact',
          organization: recipient.name,
          link: `/dashboard?section=recipients&highlight=${recipient.id}`,
          matchedField: match?.field,
          matchedText: match?.text,
        });
      }
    }

    // Search recipient TSP contacts
    const tspContactResults = await db
      .select({
        id: recipientTspContacts.id,
        contactName: recipientTspContacts.contactName,
        contactEmail: recipientTspContacts.contactEmail,
        contactPhone: recipientTspContacts.contactPhone,
        recipientId: recipientTspContacts.recipientId,
      })
      .from(recipientTspContacts)
      .where(
        or(
          ilike(recipientTspContacts.contactName, searchTerm),
          ilike(recipientTspContacts.contactEmail, searchTerm),
          ilike(recipientTspContacts.contactPhone, searchTerm)
        )
      )
      .limit(10);

    for (const contact of tspContactResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: contact.contactName },
        { label: 'Email', value: contact.contactEmail },
        { label: 'Phone', value: contact.contactPhone },
      ]);
      results.push({
        id: contact.id,
        name: contact.contactName || 'Unknown TSP Contact',
        email: contact.contactEmail,
        phone: contact.contactPhone,
        sourceType: 'recipientTspContact',
        sourceLabel: 'TSP Contact',
        link: `/dashboard?section=recipients&highlight=${contact.recipientId}`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search contacts table
    const contactResults = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        organization: contacts.organization,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.name, searchTerm),
          ilike(contacts.email, searchTerm),
          ilike(contacts.phone, searchTerm),
          ilike(contacts.organization, searchTerm)
        )
      )
      .limit(10);

    for (const contact of contactResults) {
      const match = detectMatch(query, [
        { label: 'Name', value: contact.name },
        { label: 'Email', value: contact.email },
        { label: 'Phone', value: contact.phone },
        { label: 'Organization', value: contact.organization },
      ]);
      results.push({
        id: contact.id,
        name: contact.name || 'Unknown Contact',
        email: contact.email,
        phone: contact.phone,
        sourceType: 'contact',
        sourceLabel: 'Contact',
        organization: contact.organization,
        link: `/dashboard?section=contacts`,
        matchedField: match?.field,
        matchedText: match?.text,
      });
    }

    // Search event requests (organization names and contact names)
    const eventRequestResults = await db
      .select({
        id: eventRequests.id,
        firstName: eventRequests.firstName,
        lastName: eventRequests.lastName,
        email: eventRequests.email,
        phone: eventRequests.phone,
        organizationName: eventRequests.organizationName,
      })
      .from(eventRequests)
      .where(
        or(
          ilike(eventRequests.organizationName, searchTerm),
          ilike(eventRequests.firstName, searchTerm),
          ilike(eventRequests.lastName, searchTerm),
          ilike(eventRequests.email, searchTerm),
          sql`CONCAT(${eventRequests.firstName}, ' ', ${eventRequests.lastName}) ILIKE ${searchTerm}`
        )
      )
      .limit(10);

    for (const er of eventRequestResults) {
      const contactName = `${er.firstName || ''} ${er.lastName || ''}`.trim();
      // Uses the outer `searchLower` (trimmed + lowercased) so this
      // filter matches what the DB actually queried on.
      const orgMatched = er.organizationName?.toLowerCase().includes(searchLower);

      if (orgMatched) {
        results.push({
          id: `er-org-${er.id}`,
          name: er.organizationName || 'Unknown Organization',
          email: er.email,
          phone: er.phone,
          sourceType: 'contact',
          sourceLabel: 'Event Request Org',
          organization: contactName || undefined,
          link: `/dashboard?section=event-requests&tab=all&eventId=${er.id}`,
          matchedField: 'Organization name',
          matchedText: er.organizationName || undefined,
        });
      }
      if (contactName && (!orgMatched || contactName.toLowerCase().includes(searchLower))) {
        const contactMatch = detectMatch(query, [
          { label: 'Contact name', value: contactName },
          { label: 'First name', value: er.firstName },
          { label: 'Last name', value: er.lastName },
          { label: 'Contact email', value: er.email },
          { label: 'Contact phone', value: er.phone },
        ]);
        results.push({
          id: `er-contact-${er.id}`,
          name: contactName,
          email: er.email,
          phone: er.phone,
          sourceType: 'contact',
          sourceLabel: 'Event Request Contact',
          organization: er.organizationName,
          link: `/dashboard?section=event-requests&tab=all&eventId=${er.id}`,
          matchedField: contactMatch?.field,
          matchedText: contactMatch?.text,
        });
      }
    }

    // Search organizations table
    const orgResults = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        category: organizations.category,
      })
      .from(organizations)
      .where(
        ilike(organizations.name, searchTerm)
      )
      .limit(10);

    for (const org of orgResults) {
      results.push({
        id: `org-${org.id}`,
        name: org.name,
        email: null,
        phone: null,
        sourceType: 'contact',
        sourceLabel: 'Organization',
        organization: org.category || undefined,
        link: `/dashboard?section=groups-catalog`,
        matchedField: 'Organization name',
        matchedText: org.name,
      });
    }

    // Sort results: exact matches first, then partial matches.
    // Compare against `searchLower` (trimmed) so " john " and "john"
    // both correctly identify a record named exactly "John" as an
    // exact match rather than treating "john " with a trailing space
    // as unmatched.
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === searchLower;
      const bExact = b.name.toLowerCase() === searchLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });

    // Limit total results
    const limitedResults = results.slice(0, 25);

    res.json({ results: limitedResults });
  } catch (error) {
    logger.error('People search error:', error);
    res.status(500).json({ error: 'Failed to search people' });
  }
});

export default router;
