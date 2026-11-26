/**
 * Deep links into an event, used by the daily event-alert email
 * (server/services/event-alerts/digest-email.ts builds them):
 *
 *   /dashboard?section=event-requests&tab=all&eventId=123                  open the event
 *   ...&action=log-contact                                                  open "Log a contact attempt"
 *   ...&action=toolkit                                                      open "Mark toolkit sent"
 *   ...&action=edit                                                         open the event in edit mode
 *   ...&action=snooze&rule=no_contact,stale_event[&days=3]                  "Remind me again in N days" (confirm first)
 */
export type EventDeepLinkAction = 'log-contact' | 'toolkit' | 'edit' | 'snooze';

const ACTIONS: readonly EventDeepLinkAction[] = ['log-contact', 'toolkit', 'edit', 'snooze'];

export type EventDeepLink = {
  eventId: number;
  action: EventDeepLinkAction | null;
  /** snooze only */
  ruleTypes: string[];
  /** snooze only: preset number of days, if the link carried one */
  days: number | null;
};

export function readEventDeepLink(search: string = window.location.search): EventDeepLink | null {
  const p = new URLSearchParams(search);
  const eventId = Number(p.get('eventId'));
  if (!Number.isInteger(eventId) || eventId <= 0) return null;
  const raw = p.get('action');
  const action = raw && (ACTIONS as readonly string[]).includes(raw) ? (raw as EventDeepLinkAction) : null;
  const ruleTypes = (p.get('rule') || '').split(',').map(s => s.trim()).filter(Boolean);
  const daysNum = Number(p.get('days'));
  return { eventId, action, ruleTypes, days: Number.isInteger(daysNum) && daysNum > 0 ? daysNum : null };
}

/**
 * Drop the one-time action params from the address bar, so a refresh or a
 * shared URL doesn't reopen the dialog (or re-offer the snooze).
 */
export function clearEventDeepLinkAction(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const k of ['action', 'rule', 'days']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}?${url.searchParams.toString()}`);
}
