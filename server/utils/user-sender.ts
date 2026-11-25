/**
 * Sender identity for emails a team member writes to someone outside the app
 * (toolkit emails, scheduled-event emails, template emails to event contacts,
 * in-app message notifications).
 *
 * thesandwichproject.org is the domain authenticated in Twilio Email, so any
 * @thesandwichproject.org address can be the From address. Other addresses
 * (Gmail, Yahoo, etc.) must NOT be: Twilio only sends from the verified
 * domain, and those providers' DMARC policies would junk it anyway.
 *
 * Twilio Email has no Reply-To, so:
 *  - Sender has an @thesandwichproject.org address: From is that address, with
 *    their name, and replies go straight to them. replyTo is the same address,
 *    so the email helper adds nothing to the body.
 *  - Otherwise: From is the org address, shown as "<Name> via The Sandwich
 *    Project", and replyTo is their personal address. The email helper turns
 *    that into a "To reply, email <name> at <address>" line in the body.
 *  - senderCopyBcc is the sender's own address, so they keep a copy of what
 *    they sent. The helper sends it as a separate copy and drops duplicates.
 */

import { FROM_EMAIL, ORG_NAME, SENDER_DOMAIN } from '../config/organization';

export interface SenderUser {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  preferredEmail?: string | null;
}

export interface UserSender {
  from: { email: string; name?: string };
  replyTo?: string;
  /** Display name for the "To reply, email <name> at <address>" line. */
  replyToName?: string;
  senderCopyBcc?: string;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isSenderDomainAddress(address: string): boolean {
  return address.toLowerCase().endsWith(`@${SENDER_DOMAIN.toLowerCase()}`);
}

export function buildUserSender(
  user: SenderUser | null | undefined,
  orgFromEmail: string = process.env.EMAIL_FROM_ADDRESS || FROM_EMAIL
): UserSender {
  const name = [clean(user?.firstName), clean(user?.lastName)]
    .filter(Boolean)
    .join(' ');
  const preferred = clean(user?.preferredEmail);
  const login = clean(user?.email);
  const personalAddress = preferred || login;

  // Prefer the preferred email, but use the login email for From when only
  // that one is on the authenticated domain.
  const domainAddress = [preferred, login].find(
    (addr): addr is string => !!addr && isSenderDomainAddress(addr)
  );

  const from = domainAddress
    ? { email: domainAddress, ...(name ? { name } : {}) }
    : { email: orgFromEmail, name: name ? `${name} via ${ORG_NAME}` : ORG_NAME };

  return {
    from,
    // Same as From when it's their own TSP address: no "To reply" line needed.
    replyTo: domainAddress ? from.email : personalAddress,
    ...(name ? { replyToName: name } : {}),
    senderCopyBcc: personalAddress,
  };
}
