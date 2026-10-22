import { EVENT_STATUSES, type EventStatus } from '@shared/event-status-workflow';

/**
 * Display labels and common spellings that people type into the intake sheet's
 * status column, mapped to the canonical status values the app understands.
 */
const STATUS_ALIASES: Record<string, EventStatus> = {
  new_request: 'new',
  in_progress: 'in_process',
  canceled: 'cancelled',
  nonevent: 'non_event',
  not_an_event: 'non_event',
};

/**
 * Convert free-text status from a Google Sheet cell into a canonical
 * EventStatus ("In Process" -> "in_process", "Canceled" -> "cancelled").
 * Returns null when the text isn't a recognizable status, so the caller can
 * fall back to its default instead of storing an unknown value.
 */
export function normalizeSheetStatus(raw: string | null | undefined): EventStatus | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if ((EVENT_STATUSES as readonly string[]).includes(key)) return key as EventStatus;
  return STATUS_ALIASES[key] ?? null;
}
