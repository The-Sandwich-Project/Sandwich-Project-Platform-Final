/**
 * What has to happen alongside an event request's status change, wherever the
 * change comes from: the edit form's PATCH and PUT routes and the admin
 * status endpoint. Keeping it in one place stops the routes drifting apart
 * (the standby check-back date used to be set only by the edit form's popup).
 */

/**
 * "Rescheduled" was retired: an event with a new date is simply Scheduled,
 * and one that loses its date goes back to In Process with a "needs new date"
 * marker. Old clients or scripts that still send "rescheduled" are treated as
 * "scheduled".
 */
export function normalizeIncomingStatus<T extends string | null | undefined>(status: T): T {
  return (status === 'rescheduled' ? 'scheduled' : status) as T;
}

/**
 * Fields recording a date move when an old client still sends "rescheduled"
 * (the status itself is normalized to "scheduled"). The card's "Rescheduled"
 * history badge reads wasPostponed; originalScheduledDate keeps the FIRST
 * date, so it's only filled when neither the request nor the event has one.
 */
export function rescheduleMoveFields(
  incomingStatus: string | null | undefined,
  original: { scheduledEventDate?: unknown; originalScheduledDate?: unknown },
  updates: Record<string, unknown>,
): Record<string, unknown> {
  if (incomingStatus !== 'rescheduled') return {};
  const out: Record<string, unknown> = { wasPostponed: true };
  if (!updates.originalScheduledDate && !original.originalScheduledDate && original.scheduledEventDate) {
    out.originalScheduledDate = original.scheduledEventDate;
  }
  return out;
}

const dayKeyOf = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T12:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/**
 * A Scheduled event moved to a different day (from Edit or anywhere else; the
 * card's Reschedule button is gone): record the move, so the card's
 * "Rescheduled" history badge and "originally scheduled for" keep working.
 * Skipped when the request records it itself (wasPostponed /
 * postponementCount), when the event wasn't scheduled with a date, or when it
 * stops being Scheduled (losing its date is "needs new date" instead).
 */
export function scheduledDateMoveFields(
  original: { status?: string | null; scheduledEventDate?: unknown; originalScheduledDate?: unknown; postponementCount?: number | null },
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  if (!SCHEDULED_STATUSES.has(String(original.status)) || !original.scheduledEventDate) return {};
  if (!has('scheduledEventDate') || !updates.scheduledEventDate) return {};
  if (has('wasPostponed') || has('postponementCount')) return {};
  const nextStatus = normalizeIncomingStatus((updates.status as string | undefined) ?? original.status ?? '');
  if (nextStatus !== 'scheduled') return {};
  if (dayKeyOf(updates.scheduledEventDate) === dayKeyOf(original.scheduledEventDate)) return {};
  const out: Record<string, unknown> = {
    wasPostponed: true,
    postponementCount: (Number(original.postponementCount) || 0) + 1,
  };
  if (!updates.originalScheduledDate && !original.originalScheduledDate) {
    out.originalScheduledDate = original.scheduledEventDate;
  }
  return out;
}

/** Days until the default standby check-back reminder. */
export const DEFAULT_STANDBY_CHECK_BACK_DAYS = 7;

/**
 * Today's date in Eastern time plus `days`, as noon UTC on that date, so
 * every date-only comparison (the standby reminder compares ::date) sees the
 * intended day.
 */
export function easternDatePlusDays(now: Date, days: number): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days, 12, 0, 0));
}

const SCHEDULED_STATUSES = new Set(['scheduled', 'rescheduled']);

/**
 * Extra fields to save with a status change from `fromStatus` to `toStatus`.
 * `updates` is what the request already sends; a field it sets explicitly is
 * never overridden here (e.g. standbyExpectedDate: null = "no reminder").
 */
export function statusTransitionEffects(args: {
  fromStatus: string | null | undefined;
  toStatus: string;
  updates: Record<string, unknown>;
  now?: Date;
}): Record<string, unknown> {
  const { fromStatus, toStatus, updates } = args;
  const now = args.now ?? new Date();
  const out: Record<string, unknown> = {};
  if (!toStatus || toStatus === fromStatus) return out;

  // A scheduled event that goes back to In Process has lost its date: mark it
  // so the In Process card shows "needs new date" (its old date stays on the
  // event for reference). The marker clears once it's scheduled again or done.
  if (toStatus === 'in_process' && SCHEDULED_STATUSES.has(String(fromStatus))) {
    out.needsNewDateSince = now;
  } else if (toStatus === 'scheduled' || toStatus === 'completed') {
    out.needsNewDateSince = null;
  }

  // Entering standby: stamp when (drives the "since ..." badge and per-episode
  // reminder dedup) and make sure a check-back reminder date is set, a week
  // out by default, unless the request chose one or chose none (null).
  if (toStatus === 'standby') {
    out.standbyMarkedAt = now;
    if (updates.standbyExpectedDate === undefined) {
      out.standbyExpectedDate = easternDatePlusDays(now, DEFAULT_STANDBY_CHECK_BACK_DAYS);
    }
  }

  for (const key of Object.keys(out)) {
    if (updates[key] !== undefined && key !== 'standbyMarkedAt') delete out[key];
  }
  return out;
}
