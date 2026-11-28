/**
 * What the app writes into individual planning sheet cells (locked with the
 * planning team). Pure functions, so each rule is unit tested.
 */
import { effectiveNextDayPickup } from '@shared/next-day-pickup';
import { formatAttendance } from '@shared/attendance-estimate';
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
  return [primary, backup]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join('; ');
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
