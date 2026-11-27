/**
 * Next-day pickup: whether the group holds the sandwiches overnight.
 *   'no'       same-day pickup
 *   'option'   the group CAN hold them overnight if needed (sheet column G "O")
 *   'planned'  next-day pickup is planned (sheet column G "Y"); the overnight
 *              holding location and pickup time apply
 * Stored in event_requests.next_day_pickup. Older events have it NULL; they
 * read as 'planned' when an overnight holding location was entered (that's
 * what the old "will hold overnight" checkbox recorded), otherwise 'no'.
 */
export const NEXT_DAY_PICKUP_VALUES = ['no', 'option', 'planned'] as const;
export type NextDayPickup = (typeof NEXT_DAY_PICKUP_VALUES)[number];

export const NEXT_DAY_PICKUP_LABELS: Record<NextDayPickup, string> = {
  no: 'No',
  option: "It's an option",
  planned: 'Yes, planned',
};

export function isNextDayPickup(v: unknown): v is NextDayPickup {
  return typeof v === 'string' && (NEXT_DAY_PICKUP_VALUES as readonly string[]).includes(v);
}

export function effectiveNextDayPickup(event: {
  nextDayPickup?: string | null;
  overnightHoldingLocation?: string | null;
} | null | undefined): NextDayPickup {
  if (isNextDayPickup(event?.nextDayPickup)) return event!.nextDayPickup as NextDayPickup;
  return String(event?.overnightHoldingLocation ?? '').trim() ? 'planned' : 'no';
}

/**
 * Keep the choice in sync on save: a request that sets an overnight holding
 * location but says nothing about nextDayPickup (the Scheduled card's
 * Recipient Logistics editor, the inline location edit, older clients) means
 * the group is holding overnight, so the choice becomes 'planned'. Without
 * this, a stored 'no' / 'option' would hide the saved location.
 */
export function normalizeNextDayPickupPatch<T extends Record<string, any>>(updates: T): T {
  if (!updates || typeof updates !== 'object') return updates;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  if (has('overnightHoldingLocation') && !has('nextDayPickup') && String(updates.overnightHoldingLocation ?? '').trim()) {
    return { ...updates, nextDayPickup: 'planned' };
  }
  return updates;
}
