/**
 * TSP van rules (planning team decisions, batch 6b).
 *
 *  - Time of day (planning sheet column I): worked out from the event's start
 *    and end times, unless someone picked a different preset on the sheet
 *    (van_time_override). The override clears when the times change.
 *  - Under 800: asking for the van with an estimate under 800 (or none)
 *    needs a reason (van_reason).
 *  - Sharing: when another event that day already has the van, the van stays
 *    "pending – discuss with team" until someone ticks "Events team OK'd
 *    sharing the van" (van_team_ok). One OK settles a pair: an event is only
 *    pending while some other same-day van event isn't OK'd either.
 *
 * DHL-van and self-transport events don't use TSP's van, so none of this
 * applies to them (the same rule the existing van conflict checks use).
 */

export const VAN_TIMES = ['AM', 'Mid-day', 'PM', 'All day'] as const;
export type VanTime = (typeof VAN_TIMES)[number];

export const VAN_REASON_THRESHOLD = 800;

/** TanStack Query key prefix for /api/event-requests/van-requests-for-date (badge + edit form). */
export const SAME_DAY_VAN_QUERY_KEY = 'van-requests-for-date';

export function isVanTime(v: unknown): v is VanTime {
  return typeof v === 'string' && (VAN_TIMES as readonly string[]).includes(v);
}

/** Minutes after midnight for "13:30", "13:30:00", "1:30 PM", "1pm", "9 am"; null if unreadable. */
export function timeToMinutes(raw: string | null | undefined): number | null {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.replace(/\./g, '');
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

const ELEVEN_AM = 11 * 60;
const TWO_PM = 14 * 60;

/**
 * The locked rule:
 *   starts before 11am, ends by 2pm      -> AM
 *   starts before 11am, ends after 2pm   -> All day
 *   starts 11am-2pm,    ends by 2pm      -> Mid-day
 *   starts 11am-2pm,    ends after 2pm   -> PM
 *   starts after 2pm                     -> PM
 *   no start time                        -> '' (blank)
 * With no end time, the start alone decides (as if it ended when it started).
 */
export function vanTimeOfDay(start: string | null | undefined, end: string | null | undefined): VanTime | '' {
  const s = timeToMinutes(start);
  if (s === null) return '';
  const e = timeToMinutes(end) ?? s;
  if (s < ELEVEN_AM) return e > TWO_PM ? 'All day' : 'AM';
  if (s <= TWO_PM) return e > TWO_PM ? 'PM' : 'Mid-day';
  return 'PM';
}

/** The van time to show and send: a sheet override when set, else worked out from the times. */
export function effectiveVanTime(event: {
  vanTimeOverride?: string | null;
  eventStartTime?: string | null;
  eventEndTime?: string | null;
} | null | undefined): { value: VanTime | ''; fromSheet: boolean } {
  if (isVanTime(event?.vanTimeOverride)) return { value: event!.vanTimeOverride as VanTime, fromSheet: true };
  return { value: vanTimeOfDay(event?.eventStartTime, event?.eventEndTime), fromSheet: false };
}

/** Whether this event asks for TSP's own van. */
export function usesTspVan(event: {
  vanDriverNeeded?: boolean | null;
  isDhlVan?: boolean | null;
  selfTransport?: boolean | null;
} | null | undefined): boolean {
  return event?.vanDriverNeeded === true && event?.isDhlVan !== true && event?.selfTransport !== true;
}

/**
 * Whether asking for the van needs a reason: TSP's van, and the largest the
 * estimate could be (a range's top) is under 800, or there's no estimate.
 */
export function vanReasonRequired(
  event: { vanDriverNeeded?: boolean | null; isDhlVan?: boolean | null; selfTransport?: boolean | null } | null | undefined,
  estimateMax: number | null | undefined,
): boolean {
  if (!usesTspVan(event)) return false;
  const n = Number(estimateMax) || 0;
  return n < VAN_REASON_THRESHOLD;
}

export interface SameDayVanEvent {
  id: number;
  organizationName: string | null;
  vanDriverNeeded: boolean;
  vanTeamOk?: boolean | null;
  eventStartTime?: string | null;
  eventEndTime?: string | null;
  vanTimeOverride?: string | null;
  vanNeededFor?: string | null;
}

/** Other events that day that actually have the van (not just "possibly"). */
export function vanConflicts(others: SameDayVanEvent[] | null | undefined): SameDayVanEvent[] {
  return (others ?? []).filter((o) => o.vanDriverNeeded === true);
}

/**
 * "Van pending – discuss with team": this event uses TSP's van, it isn't
 * OK'd, and another same-day van event isn't OK'd either (one OK settles it).
 */
export function vanIsPending(
  event: { vanDriverNeeded?: boolean | null; isDhlVan?: boolean | null; selfTransport?: boolean | null; vanTeamOk?: boolean | null },
  others: SameDayVanEvent[] | null | undefined,
): boolean {
  if (!usesTspVan(event) || event.vanTeamOk === true) return false;
  return vanConflicts(others).some((o) => o.vanTeamOk !== true);
}

/** "Lincoln Elementary (AM, refrigeration)" for the conflict notice. */
export function describeVanEvent(o: SameDayVanEvent): string {
  const time = effectiveVanTime(o).value;
  const why = o.vanNeededFor === 'refrigeration' ? 'refrigeration' : o.vanNeededFor === 'transport' ? 'transport' : '';
  const detail = [time, why].filter(Boolean).join(', ');
  return `${o.organizationName || 'Another event'}${detail ? ` (${detail})` : ''}`;
}

/** true / false from a boolean or the strings "true" / "false" (as some clients send); else as-is. */
const asBool = (v: unknown): boolean | null | undefined =>
  v === 'true' ? true : v === 'false' ? false : (v as boolean | null | undefined);

const dayKey = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T12:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/**
 * Keep the van fields consistent on save (PATCH/PUT), given the stored event:
 *  - start or end time changed -> the sheet's time override clears (it was
 *    about the old times), unless the request sets it;
 *  - the saved event stops using TSP's van (van off, self-transport, or the
 *    DHL van) -> the team OK and the reason clear, even if the request sent
 *    them;
 *  - the event date changed -> the team OK clears (it was about that day's
 *    conflict), unless the request sets it.
 */
export function normalizeVanPatch<T extends Record<string, any>>(updates: T, original: Record<string, any> | null | undefined): T {
  if (!updates || typeof updates !== 'object') return updates;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  const out: Record<string, any> = { ...updates };
  const o = original ?? {};

  const timeChanged = ['eventStartTime', 'eventEndTime'].some(
    (k) => has(k) && String(updates[k] ?? '') !== String(o[k] ?? ''),
  );
  if (timeChanged && !has('vanTimeOverride')) out.vanTimeOverride = null;

  // Judge the event as it will be once saved, so this works whichever order
  // it runs in relative to the route's van-purpose cleanup (which turns the
  // van off for self-transport). Self-transport, the DHL van, or no van at
  // all: the reason and the sharing OK were about TSP's van, so they go.
  const vanFieldTouched = ['vanDriverNeeded', 'selfTransport', 'isDhlVan'].some(has);
  if (vanFieldTouched) {
    const merged = { ...o, ...updates };
    const stillTspVan = usesTspVan({
      vanDriverNeeded: asBool(merged.vanDriverNeeded),
      isDhlVan: asBool(merged.isDhlVan),
      selfTransport: asBool(merged.selfTransport),
    });
    if (!stillTspVan) {
      out.vanTeamOk = false;
      out.vanReason = null;
    }
  }

  const dateChanged = ['scheduledEventDate', 'desiredEventDate'].some(
    (k) => has(k) && dayKey(updates[k]) !== dayKey(o[k]),
  );
  if (dateChanged && !has('vanTeamOk')) out.vanTeamOk = false;

  return out as T;
}
