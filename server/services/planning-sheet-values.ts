/**
 * What the app writes into individual planning sheet cells (locked with the
 * planning team). Pure functions, so each rule is unit tested.
 */
import { effectiveNextDayPickup } from '@shared/next-day-pickup';
import { formatAttendance, parseAttendanceText } from '@shared/attendance-estimate';
import { timeToMinutes, type VanTime } from '@shared/van-rules';

/** "14:00" / "14:00:00" -> "2:00 PM"; anything else as-is; blank -> ''. */
export function formatSheetTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return String(timeStr);
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${hours}:${minutes} ${ampm}`;
}

/** The time part of a pickupDateTime ("2026-12-05T15:30:00" -> "15:30"). */
function pickupTimeOf(e: { pickupTime?: string | null; pickupDateTime?: string | null }): string | null {
  if (e.pickupTime) return e.pickupTime;
  const m = String(e.pickupDateTime ?? '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

/**
 * Column F, pick-up time:
 *   next-day pickup, with a next-day time   -> "N/D 9:00 AM"
 *   next-day pickup, no time yet            -> "N/D"
 *   same day, pickup differs from end time  -> the pickup time
 *   same day, no end time                   -> the pickup time
 *   same day, pickup equals end time        -> blank
 *   no pickup time                          -> blank
 */
export function formatPickupCell(e: {
  nextDayPickup?: string | null;
  overnightHoldingLocation?: string | null;
  overnightPickupTime?: string | null;
  pickupTime?: string | null;
  pickupDateTime?: string | null;
  eventEndTime?: string | null;
}): string {
  if (effectiveNextDayPickup(e) === 'planned') {
    const t = formatSheetTime(e.overnightPickupTime);
    return t ? `N/D ${t}` : 'N/D';
  }
  const pickup = pickupTimeOf(e);
  if (!pickup) return '';
  const end = e.eventEndTime;
  if (end && timeToMinutes(end) !== null && timeToMinutes(end) === timeToMinutes(pickup)) return '';
  return formatSheetTime(pickup);
}

/** Column G: Y (next day planned), O (next day is an option), blank. */
export function formatNextDayCell(e: { nextDayPickup?: string | null; overnightHoldingLocation?: string | null }): string {
  const v = effectiveNextDayPickup(e);
  return v === 'planned' ? 'Y' : v === 'option' ? 'O' : '';
}

/** Column I: the sheet's own dropdown spelling of the van time. */
export const VAN_TIME_SHEET_LABELS: Record<VanTime, string> = {
  AM: 'AM',
  'Mid-day': 'Mid Day',
  PM: 'PM',
  'All day': 'All Day',
};

export function formatVanTimeCell(value: VanTime | '' | null | undefined): string {
  return value ? VAN_TIME_SHEET_LABELS[value] : '';
}

/** Column J: the sheet's dropdown values. */
export function formatVanNeededForSheet(value: string | null | undefined): string {
  if (value === 'transport') return 'Just Transport';
  if (value === 'refrigeration') return 'Event Refrigeration';
  return '';
}

/** Contact columns carry both contacts: "Primary; Backup" (blank parts dropped). */
export function joinContacts(primary: string | null | undefined, backup: string | null | undefined): string {
  const p = String(primary ?? '').trim();
  const b = String(backup ?? '').trim();
  if (p && b) return `${p}; ${b}`;
  // Only the backup has this value: keep the separator ("; sam@x.org"), so
  // reading the row back doesn't give the backup's value to the primary.
  if (b) return `; ${b}`;
  return p;
}

/** The app's own line in the Details column. */
export const ATTENDEE_LINE_PREFIX = 'Expected attendees:';
const ATTENDEE_LINE_RE = /^[ \t]*Expected attendees:.*$/im;

/** "Expected attendees: ~40" / "~40–60", or '' when unknown. */
export function attendeeLine(e: {
  estimatedAttendance?: number | null;
  estimatedAttendanceMin?: number | null;
  estimatedAttendanceMax?: number | null;
}): string {
  const t = formatAttendance(e);
  return t ? `${ATTENDEE_LINE_PREFIX} ~${t}` : '';
}

/**
 * Details is the planner's column; the app only manages its one attendee
 * line. Replace that line in place, add it at the end, or remove it when the
 * app has no estimate. Everything the planner typed stays as it was.
 */
export function mergeAttendeeLine(existing: string | null | undefined, line: string): string {
  const text = String(existing ?? '');
  if (ATTENDEE_LINE_RE.test(text)) {
    const replaced = line ? text.replace(ATTENDEE_LINE_RE, line) : text.replace(ATTENDEE_LINE_RE, '');
    return replaced.replace(/\n{3,}/g, '\n\n').replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  }
  if (!line) return text;
  return text.trim() ? `${text.replace(/\s+$/, '')}\n${line}` : line;
}

// ---------------------------------------------------------------------------
// Reading the sheet back (batch 7b)
// ---------------------------------------------------------------------------

/** Column G: "Y" -> planned, "O" -> option, blank -> null (not filled in), anything else -> 'unreadable'. */
export function parseNextDayCell(cell: unknown): 'planned' | 'option' | null | 'unreadable' {
  const v = String(cell ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'y' || v === 'yes' || v.startsWith('y ')) return 'planned';
  if (v === 'o' || v.startsWith('o ') || v.includes('option')) return 'option';
  return 'unreadable';
}

/** Column F: "N/D 9am" / "N/D" -> next-day pickup (with the time text, if any); otherwise null. */
export function parseNextDayPickupCell(cell: unknown): { nextDay: true; timeText: string } | null {
  const m = String(cell ?? '').trim().match(/^n\s*\/?\s*d\b[\s,:-]*(.*)$/i);
  return m ? { nextDay: true, timeText: m[1].trim() } : null;
}

/** Column I: AM / Mid Day / PM / All Day (any case, spacing or hyphen) -> the app's value; else null. */
export function parseVanTimeCell(cell: unknown): VanTime | null {
  const v = String(cell ?? '').toLowerCase().replace(/[\s-]+/g, '');
  if (v === 'am') return 'AM';
  if (v === 'midday') return 'Mid-day';
  if (v === 'pm') return 'PM';
  if (v === 'allday') return 'All day';
  return null;
}

/** "Pat Doe; Sam Lee" -> ['Pat Doe', 'Sam Lee']; one value -> [value, '']. */
export function splitContacts(cell: unknown): [string, string] {
  const parts = String(cell ?? '').split(';').map((p) => p.trim());
  return [parts[0] ?? '', parts.slice(1).filter(Boolean).join('; ')];
}

/** The attendance in the Details column's "Expected attendees:" line, or null when there's no line. */
export function attendanceFromDetails(details: unknown): { text: string } | null {
  const m = String(details ?? '').match(/^[ \t]*Expected attendees:[ \t]*~?[ \t]*(.*)$/im);
  return m ? { text: m[1].trim() } : null;
}

/**
 * Details without the app's attendee line, but only when its value could be
 * read (it's then stored as attendance). An unreadable line ("about 40") stays,
 * so the planner's text isn't lost.
 */
export function stripAttendeeLine(details: unknown): string {
  const text = String(details ?? '');
  const line = attendanceFromDetails(text);
  if (!line) return text;
  const parsed = parseAttendanceText(line.text);
  if (parsed.error || !parsed.fields.estimatedAttendance) return text;
  return mergeAttendeeLine(text, '');
}
