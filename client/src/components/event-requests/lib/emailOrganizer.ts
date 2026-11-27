import type { EventRequest } from '@shared/schema';

/**
 * The mailto: link the cards' Email button opens: the group contact as the
 * recipient, a short subject the sender can change, and an empty body so they
 * write their own message.
 */
export function organizerMailtoHref(
  request: Pick<EventRequest, 'email' | 'organizationName'>
): string | null {
  const to = (request.email || '').trim();
  if (!to) return null;
  const org = (request.organizationName || '').trim();
  const subject = org ? `Your Sandwich Project event – ${org}` : 'Your Sandwich Project event';
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Open the sender's mail app addressed to the group contact. With no email
 * on file there's nothing to address, so `fallback` runs instead (the
 * contact details popup, which shows the phone number).
 */
export function emailOrganizer(
  request: Pick<EventRequest, 'email' | 'organizationName'>,
  fallback: () => void
): void {
  const href = organizerMailtoHref(request);
  if (!href) {
    fallback();
    return;
  }
  window.location.href = href;
}
