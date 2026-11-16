/**
 * Pure filter/sort logic for the In Process tab (no React, so it's testable).
 */
import { getLastContactTimestamp } from '@shared/contact-age';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

export type InProcessSort = 'default' | 'event_date' | 'last_contact' | 'created' | 'updated';

export interface InProcessFilters {
  noContactDays: number | null;
  noUpdateDays: number | null;
  dateWithinDays: number | null;
  sort: InProcessSort;
}

export const EMPTY_IN_PROCESS_FILTERS: InProcessFilters = {
  noContactDays: null,
  noUpdateDays: null,
  dateWithinDays: null,
  sort: 'default',
};

export function hasActiveInProcessFilters(f: InProcessFilters): boolean {
  return f.noContactDays !== null || f.noUpdateDays !== null || f.dateWithinDays !== null || f.sort !== 'default';
}

export const FIXED_OPTIONS = {
  noContact: [3, 5, 7, 14],
  noUpdate: [3, 7, 14, 30],
  dateWithin: [7, 14],
};

const DAY_MS = 24 * 60 * 60 * 1000;

function time(value: unknown): number | null {
  if (!value) return null;
  const t = new Date(value as any).getTime();
  return Number.isNaN(t) ? null : t;
}

function lastContactTime(request: any): number | null {
  const ts = getLastContactTimestamp(request);
  return ts ? ts.getTime() : null;
}

function eventDateTime(request: any): number | null {
  return time(getEffectiveEventDate(request));
}

/** Apply filters and sort. Pure: safe to call inside useMemo. */
export function applyInProcessFilters<T>(requests: T[], f: InProcessFilters): T[] {
  const now = Date.now();
  let result = requests.filter((r: any) => {
    if (f.noContactDays !== null) {
      // Never contacted counts from when the request came in
      const last = lastContactTime(r) ?? time(r.createdAt);
      if (last !== null && now - last < f.noContactDays * DAY_MS) return false;
    }
    if (f.noUpdateDays !== null) {
      const updated = time(r.updatedAt) ?? time(r.createdAt);
      if (updated !== null && now - updated < f.noUpdateDays * DAY_MS) return false;
    }
    if (f.dateWithinDays !== null) {
      const d = eventDateTime(r);
      if (d === null) return false;
      const until = d - now;
      if (until < -DAY_MS || until > f.dateWithinDays * DAY_MS) return false;
    }
    return true;
  });

  const missingLast = (v: number | null, fallback: number) => (v === null ? fallback : v);
  switch (f.sort) {
    case 'event_date': // soonest first; no date at the end
      result = [...result].sort(
        (a, b) => missingLast(eventDateTime(a), Infinity) - missingLast(eventDateTime(b), Infinity),
      );
      break;
    case 'last_contact': // longest since contact first; never contacted at the top
      result = [...result].sort(
        (a, b) => missingLast(lastContactTime(a), -Infinity) - missingLast(lastContactTime(b), -Infinity),
      );
      break;
    case 'created': // oldest request first
      result = [...result].sort(
        (a: any, b: any) => missingLast(time(a.createdAt), Infinity) - missingLast(time(b.createdAt), Infinity),
      );
      break;
    case 'updated': // least recently updated first
      result = [...result].sort(
        (a: any, b: any) => missingLast(time(a.updatedAt), -Infinity) - missingLast(time(b.updatedAt), -Infinity),
      );
      break;
  }
  return result;
}
