import type { EventRequest } from '@shared/schema';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

type SortableEvent = Pick<
  EventRequest,
  'scheduledEventDate' | 'desiredEventDate' | 'eventStartTime' | 'pickupTime'
> & { pickupDateTime?: string | null };

/**
 * Calendar-day sort key for an event's effective date (scheduled, else desired).
 * Normalizes to noon so events on the same day compare equal regardless of
 * the time-of-day the timestamp happened to be stored with. Undated → 0.
 */
export function eventDayKey(event: SortableEvent): number {
  const date = getEffectiveEventDate(event) as string | Date | null;
  if (!date) return 0;
  const dateStr = typeof date === 'string' ? date : date.toISOString();

  const ymd =
    dateStr.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]00:00:00(?:\.\d{3})?Z?)?$/) ||
    dateStr.match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/);
  if (ymd) return new Date(`${ymd[1]}T12:00:00`).getTime();

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return 0;
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const d = String(parsed.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T12:00:00`).getTime();
}

// Accepts "08:30", "08:30:00", "8:30 AM", "4:00PM". Returns null if unparseable.
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Minutes-after-midnight used to order events within a day: start time, else
 * pickup time, else Infinity so events with no times sink to the bottom.
 */
export function eventTimeKey(event: SortableEvent): number {
  const start = timeToMinutes(event.eventStartTime);
  if (start !== null) return start;

  const pickup = timeToMinutes(event.pickupTime);
  if (pickup !== null) return pickup;

  // pickupDateTime is a local "YYYY-MM-DDTHH:MM:SS" string
  const pickupFromDateTime = event.pickupDateTime?.match(/T(\d{2}:\d{2})/)?.[1];
  const pickupDt = timeToMinutes(pickupFromDateTime);
  if (pickupDt !== null) return pickupDt;

  return Number.POSITIVE_INFINITY;
}

/**
 * Order events by date (asc or desc), and within the same date always earliest
 * to latest time, with untimed events last for that date.
 */
export function compareEventsByDateThenTime(
  a: SortableEvent,
  b: SortableEvent,
  dateDirection: 'asc' | 'desc'
): number {
  const dayA = eventDayKey(a);
  const dayB = eventDayKey(b);
  if (dayA !== dayB) return dateDirection === 'asc' ? dayA - dayB : dayB - dayA;

  const timeA = eventTimeKey(a);
  const timeB = eventTimeKey(b);
  if (timeA === timeB) return 0;
  return timeA < timeB ? -1 : 1; // avoids Infinity - Infinity = NaN
}
