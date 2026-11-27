/**
 * Event Status Workflow Definitions
 *
 * Central source of truth for event request status definitions,
 * valid transitions, and descriptions for intake team reference.
 *
 * Used by both server (enforcement) and client (UI display + filtering).
 */

export const EVENT_STATUSES = [
  'new',
  'in_process',
  'scheduled',
  'rescheduled',
  'completed',
  'declined',
  'cancelled',
  'non_event',
  'standby',
  'stalled',
] as const;

export type EventStatus = typeof EVENT_STATUSES[number];

/**
 * Statuses that may still appear on older records but can no longer be
 * chosen. "rescheduled" was retired: an event with a new date is simply
 * Scheduled, and one that loses its date goes back to In Process with a
 * "needs new date" marker (event_requests.needs_new_date_since).
 */
export const RETIRED_STATUSES: readonly EventStatus[] = ['rescheduled'];

/**
 * Return true if a status represents a scheduled event — either freshly
 * scheduled or rescheduled to a new date. `rescheduled` is semantically a
 * scheduled event whose date was moved; everywhere the UI/services care
 * about "is this event on the calendar" should use this helper, not
 * `status === 'scheduled'`.
 *
 * Why a helper: a single safeguard ('rescheduled' should appear alongside
 * 'scheduled') used to live only in the Scheduled tab's list query. Every
 * other callsite (operational dashboard counts, Quick Filter buttons,
 * volunteer opportunities, staffing forecast, reminder cron jobs, AI intake
 * checks) used `status === 'scheduled'` and silently dropped rescheduled
 * events. That caused dashboards to undercount and — worse — reminders to
 * skip rescheduled events entirely.
 *
 * When you SHOULD NOT use this helper:
 *   - When you specifically want to detect the act of rescheduling (e.g.,
 *     audit-log entries that say "rescheduled to ..."). Use the literal
 *     status check there.
 *   - When you're about to WRITE a status value, not read one. Setting a
 *     status of 'scheduled' is different from setting 'rescheduled'.
 *
 * For all other cases — filtering, counting, reminders, capacity planning,
 * conflict detection, calendar/map display — use this helper.
 */
export function isScheduledOrRescheduled(
  status: string | null | undefined
): boolean {
  return status === 'scheduled' || status === 'rescheduled';
}

/**
 * Status definitions with descriptions for intake team.
 * Each status has a label, a short definition, and contextual guidance.
 */
export const STATUS_DEFINITIONS: Record<EventStatus, {
  label: string;
  definition: string;
  guidance: string;
}> = {
  new: {
    label: 'New Request',
    definition: 'A new event request that has not yet been reviewed or contacted.',
    guidance: 'Review details and make initial contact. Move to In Process once the toolkit is sent and first contact is made, or Non-Event if it is not a real event request.',
  },
  in_process: {
    label: 'In Process',
    definition: 'Has received the toolkit and at least one contact attempt has been made. Also where a scheduled event goes back to when it loses its date: it shows a "Needs new date" badge until it is scheduled again.',
    guidance: 'Work with the contact to finalize event details. Can move to Standby, Scheduled, Declined, Stalled, or Non-Event.',
  },
  scheduled: {
    label: 'Scheduled',
    definition: 'Event is on our calendar and the majority of details are nailed down. All details should be finalized at least a few days before the event whenever possible.',
    guidance: 'Assign drivers and volunteers. If the date moves, just change the date. If the event loses its date and the group needs to pick a new one, move it back to In Process (it gets a "Needs new date" badge). Can also move to Completed or Cancelled.',
  },
  rescheduled: {
    label: 'Rescheduled',
    definition: 'Retired. A scheduled event with a new date is simply Scheduled; one that lost its date goes back to In Process with a "Needs new date" badge.',
    guidance: 'No longer used for new changes.',
  },
  completed: {
    label: 'Completed',
    definition: 'The event date has passed and the event was not cancelled.',
    guidance: 'Complete follow-up tasks: 1-day follow-up, 1-month follow-up, and social media post request.',
  },
  declined: {
    label: 'Declined',
    definition: 'The organization was in process but decided not to proceed with hosting an event.',
    guidance: 'Record the reason. Can be reactivated if they come back.',
  },
  cancelled: {
    label: 'Cancelled',
    definition: 'A previously scheduled event that has been cancelled without the intention of rescheduling.',
    guidance: 'Typically used for events that were already Scheduled. Record the reason for cancellation.',
  },
  non_event: {
    label: 'Non-Event',
    definition: 'A request that was never a real event request (e.g., someone dropping off sandwiches they already made, general inquiries that are not event requests).',
    guidance: 'Typically applies to New Requests or In Process events that turn out not to be real event requests.',
  },
  standby: {
    label: 'Standby',
    definition: 'The Group Contact is waiting on something specific before we can move forward: budget, date/time, volunteers, the number of sandwiches, or something else (e.g. permission from someone in their organization). Record what they are waiting on when moving the event to Standby.',
    guidance: 'Every Standby event gets a check-back reminder (a week out unless you pick another date or turn it off). Follow closely. Move to Scheduled, In Process, Declined, or Stalled as appropriate.',
  },
  stalled: {
    label: 'Stalled',
    definition: 'The event was in process but all attempts to reach the contact have failed multiple times. The event is sidelined for the time being.',
    guidance: 'Continue periodic outreach. If they respond, move back to In Process. If they confirm they are no longer interested, move to Declined.',
  },
};

/**
 * Valid status transitions.
 * Maps each status to the list of statuses it can transition to.
 *
 * TRANSITION RESTRICTIONS DISABLED (July 2026, by user request — the rules were
 * blocking real-world workflows). Every status may now move to every other
 * status; this map is generated as allow-all so the status dropdown, the
 * client-side check, and the server-side enforcement all stay consistent.
 *
 * The previous restricted flow is preserved below for reference / easy
 * restoration (it encoded: Cancelled only from Scheduled; Non-Event only from
 * New/In Process; Completed only from Scheduled/Rescheduled; terminal states
 * reactivate through specific paths):
 *
 *   new:         ['in_process', 'non_event', 'declined', 'standby', 'stalled']
 *   in_process:  ['scheduled', 'declined', 'standby', 'stalled', 'non_event']
 *   scheduled:   ['completed', 'cancelled', 'rescheduled', 'standby', 'in_process']
 *   rescheduled: ['completed', 'cancelled', 'standby', 'in_process']
 *   completed:   ['scheduled']
 *   declined:    ['new', 'in_process']
 *   cancelled:   ['scheduled']
 *   non_event:   ['new', 'in_process']
 *   standby:     ['in_process', 'scheduled', 'declined', 'stalled']
 *   stalled:     ['in_process', 'declined', 'new']
 *
 * NOTE: reason requirements (declined/cancelled/non_event need a recorded
 * reason) and the scheduled-date requirement are SEPARATE rules and remain in
 * force — see STATUS_REASON_FIELD below.
 */
export const VALID_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> =
  Object.fromEntries(
    EVENT_STATUSES.map((from) => [
      from,
      // Retired statuses can't be chosen, but an old record can still move out of one.
      EVENT_STATUSES.filter((to) => to !== from && !RETIRED_STATUSES.includes(to)),
    ])
  ) as Record<EventStatus, EventStatus[]>;

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(from: EventStatus, to: EventStatus): boolean {
  if (from === to) return true; // No change is always valid
  const allowed = VALID_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Get a human-readable error message for an invalid transition.
 */
export function getTransitionError(from: EventStatus, to: EventStatus): string {
  const fromDef = STATUS_DEFINITIONS[from];
  const toDef = STATUS_DEFINITIONS[to];
  const fromLabel = fromDef?.label || from;
  const toLabel = toDef?.label || to;

  // Provide specific guidance for common mistakes
  if (to === 'cancelled' && from !== 'scheduled' && from !== 'rescheduled' && from !== 'cancelled') {
    return `Cannot cancel an event that is "${fromLabel}". Only Scheduled or Rescheduled events can be cancelled. If this event won't proceed, mark it as Declined instead.`;
  }

  if (to === 'completed' && from !== 'scheduled' && from !== 'rescheduled' && from !== 'completed') {
    return `Cannot mark a "${fromLabel}" event as Completed. The event must be Scheduled or Rescheduled first.`;
  }

  if (to === 'rescheduled' && from !== 'scheduled' && from !== 'standby') {
    return `Cannot reschedule a "${fromLabel}" event. Only Scheduled or Standby events can be rescheduled.`;
  }

  if (to === 'non_event' && from !== 'new' && from !== 'in_process') {
    return `Cannot mark a "${fromLabel}" event as Non-Event. Only New Requests and In Process events can be marked as Non-Event.`;
  }

  const allowedLabels = (VALID_STATUS_TRANSITIONS[from] || [])
    .map(s => STATUS_DEFINITIONS[s]?.label || s);

  return `Cannot move from "${fromLabel}" to "${toLabel}". Valid next statuses are: ${allowedLabels.join(', ')}.`;
}

/**
 * Statuses that require a reason, and the field that carries it.
 *
 * Single source of truth for the "needs a reason" rule — consumed by BOTH the
 * client (to open the reason dialog) and the server (to enforce that a reason is
 * actually recorded). Previously this list was hardcoded only on the client and
 * the server enforced nothing, so a non-dialog path could record a declined /
 * cancelled / non-event with no reason.
 *
 * NOTE: `rescheduled` is intentionally NOT here — it requires a new *date*
 * (collected by RescheduleDialog), not a reason. `standby` / `stalled` have
 * reason columns in the schema but reasons remain optional for them by design.
 */
export const STATUS_REASON_FIELD: Partial<Record<EventStatus, string>> = {
  declined: 'declinedReason',
  cancelled: 'cancelledReason',
  non_event: 'nonEventReason',
};

/** Whether moving an event to `status` requires a reason to be recorded. */
export function requiresReason(status: EventStatus): boolean {
  // Own-property check (not `in`) so prototype keys like "toString" never match,
  // even if called with an untrusted string at runtime.
  return Object.prototype.hasOwnProperty.call(STATUS_REASON_FIELD, status);
}

/** The field name that carries the required reason for `status`, if any. */
export function getReasonField(status: EventStatus): string | undefined {
  return requiresReason(status) ? STATUS_REASON_FIELD[status] : undefined;
}

/**
 * Fields whose presence satisfies the reason requirement, in priority order.
 *
 * The structured reason column is preferred (the card-action reason dialogs fill
 * it), but the matching notes column AND the general planning/scheduling notes
 * are also accepted — the full-form scheduling path records the reason in those
 * free-text notes rather than the structured column. Accepting notes is a
 * deliberate product choice: it keeps that form working, with the tradeoff that
 * the structured reason column may stay empty for form-driven transitions.
 */
export const STATUS_REASON_SATISFYING_FIELDS: Partial<Record<EventStatus, string[]>> = {
  declined: ['declinedReason', 'declinedNotes', 'planningNotes', 'schedulingNotes'],
  cancelled: ['cancelledReason', 'cancelledNotes', 'planningNotes', 'schedulingNotes'],
  non_event: ['nonEventReason', 'nonEventNotes', 'planningNotes', 'schedulingNotes'],
};

/** Fields that can satisfy the reason requirement for `status` (any non-empty one). */
export function getReasonSatisfyingFields(status: EventStatus): string[] {
  // Own-property check guards against prototype keys returning a function.
  return Object.prototype.hasOwnProperty.call(STATUS_REASON_SATISFYING_FIELDS, status)
    ? STATUS_REASON_SATISFYING_FIELDS[status]!
    : [];
}

/**
 * Pure transition side-effect: when an event becomes Scheduled with no scheduled
 * date set yet, fall back to its desired date.
 *
 * Centralized here so EVERY scheduling path obeys the same rule. Previously this
 * lived only in the client status handler, so other paths (e.g. QuickSchedule)
 * could schedule an event without carrying a date forward. Returns the date to
 * use, or undefined when no default applies. Impure side-effects (timestamps,
 * acting user, auto-confirm) stay in the server handler.
 */
export function getScheduledDateDefault<T extends string | Date>(
  toStatus: EventStatus,
  currentScheduledDate: T | null | undefined,
  desiredDate: T | null | undefined,
): T | undefined {
  if (toStatus !== 'scheduled') return undefined;
  if (currentScheduledDate) return undefined;
  return desiredDate ?? undefined;
}
