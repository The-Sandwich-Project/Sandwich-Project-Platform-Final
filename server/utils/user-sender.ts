/**
 * Sender identity for emails a team member writes to someone outside the app
 * (toolkit emails, scheduled-event emails, template emails to event contacts).
 *
 * thesandwichproject.org is authenticated in SendGrid (domain authentication),
 * so any @thesandwichproject.org address can be the From address. Other
 * addresses (Gmail, Yahoo, etc.) must NOT be: their providers publish DMARC
 * policies that tell inboxes to reject or junk mail sent for them by SendGrid.
 *
 *  - Sender has an @thesandwichproject.org address: From is that address, with
 *    their name.
 *  - Otherwise: From is the org address, shown as "<Name> via The Sandwich
 *    Project".
 *  - Reply-To is always the sender's preferred email (falling back to their
 *    login email), so replies reach them.
 *  - senderCopyBcc is the sender's own address, so they keep a copy of what
 *    they sent. Callers add it to the BCC list; sendEmailWithResult drops
 *    duplicates and the To address.
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
  orgFromEmail: string = process.env.SENDGRID_FROM_EMAIL || FROM_EMAIL
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
    replyTo: personalAddress,
    senderCopyBcc: personalAddress,
  };
}
