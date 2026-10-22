import type { eventRequests } from '@shared/schema';

type VolunteerHubEventRow = typeof eventRequests.$inferSelect;

/** Prefer active scheduled records when sheet sync created duplicate rows. */
export function pickVolunteerHubDuplicate(a: VolunteerHubEventRow, b: VolunteerHubEventRow): VolunteerHubEventRow {
  const activeStatuses = new Set(['scheduled', 'rescheduled']);
  const aActive = activeStatuses.has(a.status);
  const bActive = activeStatuses.has(b.status);
  if (aActive !== bActive) return aActive ? a : b;
  const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return a.id > b.id ? a : b;
}

/**
 * Collapse duplicate hub rows (same googleSheetRowId AND same organization) so
 * calendar days don't list one event twice. The org is part of the key because
 * the Sheets sync deliberately creates a NEW event when a row number is reused
 * for a different organization; keying on the row number alone silently hid
 * one of two genuinely different events from the hub.
 */
export function dedupeVolunteerHubEvents(events: VolunteerHubEventRow[]): VolunteerHubEventRow[] {
  const byId = new Map<number, VolunteerHubEventRow>();
  const bySheetRow = new Map<string, VolunteerHubEventRow>();

  for (const event of events) {
    const rowId = event.googleSheetRowId?.trim();
    const sheetKey = rowId
      ? `${rowId}|${(event.organizationName || '').trim().toLowerCase()}`
      : undefined;
    if (sheetKey) {
      const existing = bySheetRow.get(sheetKey);
      if (existing) {
        const keep = pickVolunteerHubDuplicate(existing, event);
        byId.delete(existing.id);
        byId.set(keep.id, keep);
        bySheetRow.set(sheetKey, keep);
        continue;
      }
      bySheetRow.set(sheetKey, event);
    }
    if (!byId.has(event.id)) {
      byId.set(event.id, event);
    }
  }

  return Array.from(byId.values());
}
