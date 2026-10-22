/**
 * Event request intake source — mutually exclusive:
 * - Planning sheet (imported from the official planning sheet, either via the
 *   in-app Planning Sheet Import or the Apps Script push)
 * - Website submission (Google Sheets sync from public form)
 * - Manual entry by an app user (optional channel: phone, email, etc.)
 */

const MANUAL_ENTRY_CHANNELS: Record<string, string> = {
  phone_call: 'phone call',
  text_message: 'text message',
  email: 'email',
  social_media: 'social media',
  in_person: 'in person',
  referral: 'referral',
  other: 'other channel',
};

export type EventRequestSourceIndicator =
  | { kind: 'planning_sheet' }
  | { kind: 'website' }
  | { kind: 'manual'; channelLabel?: string };

export function getEventRequestSourceIndicator(
  request: {
    externalId?: string | null;
    manualEntrySource?: string | null;
    googleSheetRowId?: string | null;
    createdBy?: string | null;
    lastSyncedAt?: string | Date | null;
  },
): EventRequestSourceIndicator | null {
  const externalId = request.externalId ?? undefined;
  const manualSource = request.manualEntrySource ?? undefined;
  const sheetId = request.googleSheetRowId ?? undefined;
  const createdBy = request.createdBy ?? undefined;

  // Checked first: Apps Script imports (sheets-import-*) come from the
  // planning sheet, not the public website form.
  const isFromPlanningSheet =
    externalId?.startsWith('planning-sheet:') === true ||
    externalId?.startsWith('sheets-import-') === true ||
    createdBy === 'google-sheets-import';

  if (isFromPlanningSheet) {
    return { kind: 'planning_sheet' };
  }

  const isFromWebsite =
    !!sheetId ||
    !!request.lastSyncedAt ||
    externalId?.startsWith('auto-') === true ||
    createdBy === 'google_sheets_sync';

  if (isFromWebsite) {
    return { kind: 'website' };
  }

  const isManual =
    externalId?.startsWith('manual-') === true ||
    (!!manualSource && manualSource !== 'website_form');

  if (!isManual) {
    return null;
  }

  const channelLabel =
    manualSource && manualSource !== 'website_form'
      ? MANUAL_ENTRY_CHANNELS[manualSource] || manualSource.replace(/_/g, ' ')
      : undefined;

  return { kind: 'manual', channelLabel };
}
