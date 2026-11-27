/**
 * Expected attendees: a single number ("40") or a range ("40-60"). Rough is
 * fine; it's expected to change as planning goes on.
 *
 * Stored as:
 *   estimated_attendance      the number, or the middle of the range (what
 *                             existing reports and screens already read)
 *   estimated_attendance_min  the range's ends; both NULL for a single number
 *   estimated_attendance_max
 */

export interface AttendanceFields {
  estimatedAttendance: number | null;
  estimatedAttendanceMin: number | null;
  estimatedAttendanceMax: number | null;
}

export const EMPTY_ATTENDANCE: AttendanceFields = {
  estimatedAttendance: null,
  estimatedAttendanceMin: null,
  estimatedAttendanceMax: null,
};

const toCount = (s: string) => Number(s.replace(/,/g, ''));

/**
 * "40" | "40-60" | "40 – 60" | "40 to 60" | "1,200" | "" (not known).
 * 0 or blank means not known. A reversed range is put in order.
 */
export function parseAttendanceText(text: string): { fields: AttendanceFields; error: string | null } {
  const t = String(text ?? '').trim();
  if (!t) return { fields: EMPTY_ATTENDANCE, error: null };
  const range = t.match(/^([\d,]+)\s*(?:-|–|—|to)\s*([\d,]+)$/i);
  if (range) {
    let lo = toCount(range[1]);
    let hi = toCount(range[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { fields: EMPTY_ATTENDANCE, error: `"${t}" isn't a number or a range like 40-60` };
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi <= 0) return { fields: EMPTY_ATTENDANCE, error: null };
    if (lo === hi) return { fields: { estimatedAttendance: lo, estimatedAttendanceMin: null, estimatedAttendanceMax: null }, error: null };
    return {
      fields: { estimatedAttendance: Math.round((lo + hi) / 2), estimatedAttendanceMin: lo, estimatedAttendanceMax: hi },
      error: null,
    };
  }
  if (/^[\d,]+$/.test(t)) {
    const n = toCount(t);
    if (!Number.isFinite(n)) return { fields: EMPTY_ATTENDANCE, error: `"${t}" isn't a number or a range like 40-60` };
    if (n <= 0) return { fields: EMPTY_ATTENDANCE, error: null };
    return { fields: { estimatedAttendance: n, estimatedAttendanceMin: null, estimatedAttendanceMax: null }, error: null };
  }
  return { fields: EMPTY_ATTENDANCE, error: `"${t}" isn't a number or a range like 40-60` };
}

/** "40", "40–60", or "" when not known. A stored range wins over the single number. */
export function formatAttendance(f: Partial<AttendanceFields> | null | undefined): string {
  const min = Number(f?.estimatedAttendanceMin) || 0;
  const max = Number(f?.estimatedAttendanceMax) || 0;
  if (min > 0 && max > 0 && max > min) return `${min}–${max}`;
  const n = Number(f?.estimatedAttendance) || 0;
  return n > 0 ? String(n) : '';
}

/**
 * Keep the three columns consistent on save: a request that sets the number
 * but says nothing about the range is a plain number, so any stored range is
 * cleared (otherwise an old "40–60" would outlive a new "100").
 */
export function normalizeAttendancePatch<T extends Record<string, any>>(updates: T): T {
  if (!updates || typeof updates !== 'object') return updates;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  if (has('estimatedAttendance') && !has('estimatedAttendanceMin') && !has('estimatedAttendanceMax')) {
    return { ...updates, estimatedAttendanceMin: null, estimatedAttendanceMax: null };
  }
  return updates;
}
