import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createHash } from 'crypto';
import type { IStorage } from './storage';
import { EventRequest, eventRequests } from '@shared/schema';
import { AuditLogger } from './audit-logger';
import { db } from './db';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from './utils/production-safe-logger';
import {
  assertSheetWriteAllowed,
  SheetWriteBlockedError,
} from './sheets-write-guard';
import { geocodeAddress } from './utils/geocoding';
import { detectDateFlexibility } from './utils/date-flexibility-detection';
import { normalizeSheetStatus } from './utils/sheet-status';

export interface EventRequestSheetRow {
  externalId: string;
  organizationName: string;
  contactName: string;
  email: string;
  phone: string;
  department: string;
  eventLocation: string;
  desiredEventDate: string;
  status: string;
  message: string;
  previouslyHosted: string;
  submittedOn: string; // The actual submission date from Squarespace form
  createdDate: string;
  lastUpdated: string;
  duplicateCheck: string;
  notes: string;
  rowIndex?: number;
}

export class EventRequestsGoogleSheetsService {
  private auth!: JWT;
  private sheets: any;
  private spreadsheetId: string;
  private worksheetName: string = 'Sheet1';

  constructor(private storage: IStorage) {
    this.spreadsheetId = process.env.EVENT_REQUESTS_SHEET_ID!;
    // Don't call async initialization in constructor
  }

  private async ensureInitialized() {
    if (!this.sheets) {
      await this.initializeAuth();
    }
  }

  private async initializeAuth() {
    // Use JWT authentication (same as other Google Sheets integrations)
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
    if (!rawPrivateKey || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      throw new Error('Google Sheets credentials not configured');
    }

    // **NODE.JS v20 COMPATIBILITY FIX** - Handle all newline format issues
    let cleanPrivateKey = rawPrivateKey;

    // Handle escaped newlines
    if (cleanPrivateKey.includes('\\n')) {
      cleanPrivateKey = cleanPrivateKey.replace(/\\n/g, '\n');
    }

    // Additional newline handling
    cleanPrivateKey = cleanPrivateKey
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // **CRITICAL NODE.JS v20 FIX** - Handle single-line key format
    if (
      !cleanPrivateKey.includes('\n') &&
      cleanPrivateKey.includes('-----BEGIN PRIVATE KEY-----')
    ) {
      const beginMarker = '-----BEGIN PRIVATE KEY-----';
      const endMarker = '-----END PRIVATE KEY-----';
      const beginIndex = cleanPrivateKey.indexOf(beginMarker);
      const endIndex = cleanPrivateKey.indexOf(endMarker);

      if (beginIndex !== -1 && endIndex !== -1) {
        const keyContent = cleanPrivateKey
          .substring(beginIndex + beginMarker.length, endIndex)
          .trim();

        // Rebuild key with proper line breaks every 64 characters
        const lines = [beginMarker];
        for (let i = 0; i < keyContent.length; i += 64) {
          lines.push(keyContent.substring(i, i + 64));
        }
        lines.push(endMarker);

        cleanPrivateKey = lines.join('\n');
      }
    }

    this.auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      undefined,
      cleanPrivateKey,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ]
    );

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * Convert Excel serial number or date string to JavaScript Date
   * Handles both submission dates and event dates properly
   *
   * IMPORTANT: Squarespace form timestamps are in Eastern Time (EST/EDT, UTC-5/UTC-4)
   * We need to convert them properly to UTC to avoid timezone display issues.
   */
  private parseExcelDate(dateValue: string | undefined, fieldName: string = 'date', isSubmissionTimestamp: boolean = false): Date | null {
    if (!dateValue || !dateValue.trim()) return null;

    try {
      const cleaned = dateValue.trim();

      let parsedDate: Date;

      // Check if it's an Excel serial number (numeric string)
      if (/^\d+(\.\d+)?$/.test(cleaned)) {
        const serialNumber = parseFloat(cleaned);

        // Convert Excel serial number to JavaScript Date
        // Excel epoch starts from January 1, 1900 (with a leap year bug adjustment)
        const excelEpoch = new Date(1899, 11, 30); // December 30, 1899 (Excel's day 0)
        const millisecondsPerDay = 24 * 60 * 60 * 1000;

        // Create date from Excel serial number
        // Excel serial numbers represent days since epoch, with fractional part for time
        parsedDate = new Date(excelEpoch.getTime() + serialNumber * millisecondsPerDay);

        if (isNaN(parsedDate.getTime())) {
          logger.error(
            `❌ CRITICAL: Invalid Excel serial number for ${fieldName}: "${dateValue}"`
          );
          return null;
        }
      } else {
        // Try parsing as regular date string
        parsedDate = new Date(cleaned);

        if (isNaN(parsedDate.getTime())) {
          logger.error(
            `❌ CRITICAL: Invalid ${fieldName} format: "${dateValue}"`
          );
          return null;
        }
      }

      // For submission timestamps from Squarespace (which are in Eastern Time),
      // we need to adjust for the timezone offset to get the correct UTC time
      if (isSubmissionTimestamp) {
        // Extract the wall-clock time components (what the user saw: "2:00 PM")
        const year = parsedDate.getUTCFullYear();
        const month = parsedDate.getUTCMonth();
        const day = parsedDate.getUTCDate();
        const hours = parsedDate.getUTCHours();
        const minutes = parsedDate.getUTCMinutes();
        const seconds = parsedDate.getUTCSeconds();

        // Determine if this date falls in DST or Standard Time for Eastern timezone
        // DST in US: Second Sunday in March to First Sunday in November
        // Standard Time: November to March
        // EST = UTC-5, EDT = UTC-4
        const isDST = (date: Date): boolean => {
          const year = date.getUTCFullYear();
          const month = date.getUTCMonth();

          // DST doesn't apply in Nov, Dec, Jan, Feb
          if (month >= 10 || month <= 1) return false;

          // DST always applies in Apr-Oct
          if (month >= 3 && month <= 9) return true;

          // For March and November, need to check which week
          const day = date.getUTCDate();
          const dayOfWeek = date.getUTCDay();

          if (month === 2) { // March - DST starts 2nd Sunday
            const secondSunday = 8 + (7 - new Date(year, 2, 8).getDay());
            return day >= secondSunday;
          } else { // November - DST ends 1st Sunday
            const firstSunday = 1 + (7 - new Date(year, 10, 1).getDay()) % 7;
            return day < firstSunday;
          }
        };

        // Create a temporary date to check DST
        const tempCheckDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
        const offset = isDST(tempCheckDate) ? 4 : 5; // EDT = UTC-4, EST = UTC-5

        // The timestamp in the sheet represents "X PM Eastern Time"
        // To convert to UTC, we ADD the offset (e.g., 2pm EST + 5 hours = 7pm UTC)
        const utcDate = new Date(Date.UTC(year, month, day, hours + offset, minutes, seconds));

        logger.debug(`📅 Converted submission timestamp: Sheet value="${dateValue}" → Local="${hours}:${String(minutes).padStart(2, '0')}" → UTC with ${offset}hr offset → ${utcDate.toISOString()}`);

        return utcDate;
      }

      return parsedDate;
    } catch (error) {
      logger.error(
        `❌ CRITICAL: Error parsing ${fieldName} "${dateValue}":`,
        error
      );
      return null;
    }
  }

  /**
   * Convert EventRequest to Google Sheets row format
   */
  private eventRequestToSheetRow(
    eventRequest: EventRequest
  ): EventRequestSheetRow {
    return {
      externalId: eventRequest.externalId || '',
      submittedOn: eventRequest.createdAt
        ? (() => {
            const date =
              eventRequest.createdAt instanceof Date
                ? eventRequest.createdAt
                : new Date(eventRequest.createdAt);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
          })()
        : '',
      organizationName: eventRequest.organizationName || '',
      contactName:
        `${eventRequest.firstName || ''} ${eventRequest.lastName || ''}`.trim(),
      email: eventRequest.email || '',
      phone: eventRequest.phone || '',
      department: eventRequest.department || '',
      desiredEventDate: eventRequest.desiredEventDate
        ? (() => {
            // Timezone-safe date formatting for Google Sheets
            const date =
              eventRequest.desiredEventDate instanceof Date
                ? eventRequest.desiredEventDate
                : new Date(eventRequest.desiredEventDate);
            return date.toLocaleDateString();
          })()
        : '',
      status: eventRequest.status || 'new',
      message: eventRequest.message || '',
      previouslyHosted: eventRequest.previouslyHosted || '',
      createdDate: eventRequest.createdAt
        ? (() => {
            const date =
              eventRequest.createdAt instanceof Date
                ? eventRequest.createdAt
                : new Date(eventRequest.createdAt);
            return date.toLocaleDateString();
          })()
        : '',
      lastUpdated: eventRequest.updatedAt
        ? (() => {
            const date =
              eventRequest.updatedAt instanceof Date
                ? eventRequest.updatedAt
                : new Date(eventRequest.updatedAt);
            return date.toLocaleDateString();
          })()
        : '',
      duplicateCheck: eventRequest.organizationExists ? 'Yes' : 'No',
      notes: eventRequest.duplicateNotes || '',
    };
  }

  /**
   * Convert Google Sheets row to EventRequest format
   */
  private sheetRowToEventRequest(
    row: EventRequestSheetRow
  ): Partial<EventRequest> {
    const nameParts = row.contactName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Parse the submission date from Google Sheets using proper Excel serial number handling
    // Pass isSubmissionTimestamp=true to preserve Eastern Time interpretation
    const submissionDate = this.parseExcelDate(row.submittedOn, 'submission date', true) || new Date();

    return {
      externalId: row.externalId,
      // Match manual entry: trimmed org name, and null (not '') for a missing
      // email/phone so every origin stores "no value" the same way.
      organizationName: row.organizationName?.trim(),
      firstName: firstName,
      lastName: lastName,
      email: row.email?.trim() || null,
      phone: row.phone?.trim() || null,
      department: row.department,
      eventAddress: row.eventLocation,
      desiredEventDate: this.parseExcelDate(row.desiredEventDate, 'desired event date'),
      status: (() => {
        // CRITICAL FIX: Only assign status for NEW imports, never for existing records
        // This function should only be called for genuinely new records

        // If the sheet has a recognizable status other than "new", use its
        // canonical form ("In Process" -> "in_process"). Unrecognized text is
        // ignored rather than stored, since the app can't filter or display it.
        const sheetStatus = normalizeSheetStatus(row.status);
        if (sheetStatus && sheetStatus !== 'new') {
          return sheetStatus;
        }
        if (row.status && row.status.trim() && !sheetStatus) {
          logger.warn(
            `Unrecognized status "${row.status.trim()}" in sheet row ${row.rowIndex}; using default`
          );
        }

        // For events without status, check if it's a past event
        if (row.desiredEventDate && row.desiredEventDate.trim()) {
          try {
            const eventDate = new Date(row.desiredEventDate.trim());
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (!isNaN(eventDate.getTime()) && eventDate < today) {
              return 'completed'; // Past events are marked as completed
            }
          } catch (error) {
            logger.warn(
              'Error parsing event date for status determination:',
              row.desiredEventDate
            );
          }
        }

        return 'new'; // Default for future events or unclear dates
      })(),
      message: row.message,
      previouslyHosted: row.previouslyHosted,
      organizationExists: row.duplicateCheck === 'Yes',
      duplicateNotes: row.notes,
      createdAt: submissionDate, // Map Google Sheet submission date to createdAt
      // Every creation path records when the current status began. For imports
      // that's the submission time, so a past event imported as 'completed'
      // isn't counted as "completed this week" by the digests.
      statusChangedAt: submissionDate,
    };
  }

  /**
   * DEPRECATED: No longer updating Google Sheets - one-way sync only
   * @deprecated This method is no longer used as we only sync FROM sheets, not TO sheets
   */
  async updateEventRequestStatus(
    organizationName: string,
    contactName: string,
    newStatus: string
  ): Promise<{ success: boolean; message: string }> {
    // DISABLED: One-way sync only - we don't write back to Google Sheets.
    // Belt-and-suspenders: run the central write guard too, so even if this
    // early return is ever removed, the write is still hard-blocked + logged.
    try {
      assertSheetWriteAllowed({
        spreadsheetId: this.spreadsheetId,
        service: 'event-requests-sync',
        operation: 'updateEventRequestStatus',
      });
    } catch (err) {
      if (!(err instanceof SheetWriteBlockedError)) throw err;
    }
    logger.warn('⚠️ updateEventRequestStatus called but is disabled - one-way sync only');
    return {
      success: false,
      message: 'Google Sheets updates are disabled - one-way sync only'
    };

    /* Original implementation commented out:
    try {
      await this.ensureInitialized();

      // Read current sheet to find the row
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A2:K1000`,
      });

      const rows = response.data.values || [];

      // Find the matching row (case-insensitive)
      const rowIndex = rows.findIndex((row: string[]) => {
        const sheetOrgName = row[3] || ''; // Organization Name is column D (index 3)
        const sheetContactName = row[1] || ''; // Contact Name is column B (index 1)

        return (
          sheetOrgName.toLowerCase() === organizationName.toLowerCase() &&
          sheetContactName.toLowerCase() === contactName.toLowerCase()
        );
      });

      if (rowIndex === -1) {
        return {
          success: false,
          message: `Event request not found in Google Sheets: ${organizationName} - ${contactName}`,
        };
      }

      // Update the status in column K (index 10)
      const actualRowNumber = rowIndex + 2; // +2 because: +1 for header row, +1 for 1-based indexing
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!K${actualRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newStatus]] },
      });

      logger.log(
        `✅ Updated Google Sheets status for ${organizationName} - ${contactName} to: ${newStatus}`
      );
      return {
        success: true,
        message: `Updated status to ${newStatus} in Google Sheets`,
      };
    } catch (error) {
      logger.error('Error updating Google Sheets status:', error);
      return {
        success: false,
        message: `Failed to update Google Sheets: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
    */
  }

  /**
   * Sync event requests from database to Google Sheets
   * DISABLED TO PREVENT DATA LOSS - This function was clearing the user's sheet
   */
  async syncToGoogleSheets(): Promise<{
    success: boolean;
    message: string;
    synced?: number;
  }> {
    // Belt-and-suspenders: run the central write guard too, so even if this
    // early return is ever removed, the write is still hard-blocked + logged.
    try {
      assertSheetWriteAllowed({
        spreadsheetId: this.spreadsheetId,
        service: 'event-requests-sync',
        operation: 'syncToGoogleSheets',
      });
    } catch (err) {
      if (!(err instanceof SheetWriteBlockedError)) throw err;
    }
    return {
      success: false,
      message:
        'TO-SHEETS sync is DISABLED to prevent data loss. Use FROM-SHEETS sync only.',
    };
  }

  /**
   * ENHANCED duplicate detection using stable identifiers with fuzzy fallback
   * CRITICAL FIX: Better error handling and comprehensive logging for debugging
   * Prioritizes: googleSheetRowId > submission timestamp + email > fuzzy organization name matching
   */
  /**
   * Sync from Google Sheets to database - INSERT ONLY, never update existing records
   * CRITICAL GUARANTEE: Once a record is imported, it will NEVER be touched again by sync
   * 
   * REQUIREMENTS:
   * 1. Generate external_id from sheet data if not provided
   * 2. INSERT new records only (onConflictDoNothing ensures existing records are skipped)
   * 3. Manual database edits are PRESERVED - sync will never overwrite them
   * 4. Each external_id is imported exactly once
   * 5. Users can safely edit organization names, departments, contact info without fear of sync overwriting
   */
  async syncFromGoogleSheets(): Promise<{
    success: boolean;
    message: string;
    updated?: number;
    created?: number;
  }> {
    try {
      await this.ensureInitialized();

      // Read from Google Sheets
      const sheetRows = await this.readEventRequestsSheet();

      let createdCount = 0;
      let updatedCount = 0;
      let skippedNoExternalId = 0;

      logger.log(`Starting Google Sheets sync: Processing ${sheetRows.length} rows`);
      
      if (sheetRows.length === 0) {
        logger.warn('⚠️ No rows found in Google Sheet - check if sheet is empty or range is correct');
        return {
          success: true,
          message: 'No rows to sync - sheet appears empty',
          created: 0,
          updated: 0,
        };
      }

      let rowsWithExternalId = 0;
      let rowsWithoutExternalId = 0;

      for (const row of sheetRows) {
        // Normalize values for hash generation
        const normalizedEmail = (row.email || 'no-email').trim().toLowerCase();
        const normalizedSubmittedOn = (row.submittedOn || 'no-date').trim();
        const normalizedOrg = (row.organizationName || 'no-org').trim();
        const normalizedName = (row.contactName || 'no-name').trim();
        
        const uniqueParts = [
          normalizedEmail,
          normalizedSubmittedOn,
          normalizedOrg,
          normalizedName
        ].join('|');
        
        // Generate BOTH hash formats to check for existing records
        // Old format: base64 of EMAIL ONLY (broken but existing records have this hash format)
        const oldStyleHash = `auto-${Buffer.from(normalizedEmail).toString('base64').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`;
        // New format: SHA256 (correct - all fields contribute to uniqueness)
        const newStyleHash = `auto-${createHash('sha256').update(uniqueParts).digest('hex').substring(0, 16)}`;
        
        // Use new-style hash for new records, but check for both when detecting duplicates
        if (!row.externalId || !row.externalId.trim()) {
          rowsWithoutExternalId++;
          row.externalId = newStyleHash;
          logger.debug(`Generated externalId for row ${row.rowIndex}: ${row.externalId} (org: ${normalizedOrg})`);
        } else {
          rowsWithExternalId++;
        }

        const externalIdTrimmed = row.externalId.trim();

        // Convert row to event request data
        const eventRequestData = this.sheetRowToEventRequest(row);

        // Detect date flexibility from message text
        const flexibilityResult = detectDateFlexibility(eventRequestData.message);

        // Ensure dates are valid before saving to database
        const safeCreatedAt =
          eventRequestData.createdAt &&
          !isNaN(new Date(eventRequestData.createdAt).getTime())
            ? eventRequestData.createdAt
            : new Date();
        const sanitizedData = {
          ...eventRequestData,
          createdBy: 'google_sheets_sync',
          googleSheetRowId: row.rowIndex?.toString(),
          lastSyncedAt: new Date(),
          // Auto-detect date flexibility from message (null if no clear indicator)
          dateFlexible: flexibilityResult.dateFlexible,
          // Ensure all date fields are either valid Date objects or null
          desiredEventDate:
            eventRequestData.desiredEventDate &&
            !isNaN(new Date(eventRequestData.desiredEventDate).getTime())
              ? eventRequestData.desiredEventDate
              : null,
          createdAt: safeCreatedAt,
          statusChangedAt: safeCreatedAt,
          updatedAt: new Date(),
        };

        // Log when flexibility is detected for visibility
        if (flexibilityResult.dateFlexible !== null) {
          logger.info(`📅 Date flexibility detected for ${eventRequestData.organizationName}: ${flexibilityResult.dateFlexible ? 'FLEXIBLE' : 'FIXED'} (matched: "${flexibilityResult.matchedPhrase}")`);
        }

        try {
          // PRIORITY 0: Google Sheet Row ID — most stable identifier since rows don't move
          // This catches re-imports of the same row even when dates/hashes change
          const rowIdStr = row.rowIndex?.toString();
          if (rowIdStr) {
            const existingByRowId = await db
              .select({
                id: eventRequests.id,
                externalId: eventRequests.externalId,
                organizationName: eventRequests.organizationName,
                message: eventRequests.message,
              })
              .from(eventRequests)
              .where(eq(eventRequests.googleSheetRowId, rowIdStr))
              .limit(1);

            if (existingByRowId.length > 0) {
              const existing = existingByRowId[0];

              // Guard against false matches when a NEW sheet resets row numbers.
              // If the org names differ, this is a brand-new entry that happens to share
              // a row index with an old entry from a previous sheet — fall through to
              // hash-based detection so it gets created rather than silently skipped.
              const incomingOrg = ((sanitizedData as any).organizationName || '').trim().toLowerCase();
              const existingOrg = (existing.organizationName || '').trim().toLowerCase();
              if (incomingOrg && existingOrg && incomingOrg !== existingOrg) {
                logger.info(`⚠️ Row ID ${rowIdStr} matched existing entry "${existing.organizationName}" but incoming org is "${(sanitizedData as any).organizationName}" — treating as new entry`);
                // fall through to hash-based duplicate detection below
              } else {
                // Same org — safe to treat as existing record, backfill message if needed
                const sheetMessage = (sanitizedData as any).message?.trim();
                const dbMessage = existing.message?.trim();
                if ((!dbMessage || dbMessage === '') && sheetMessage && sheetMessage.length > 0) {
                  try {
                    await db
                      .update(eventRequests)
                      .set({ message: sheetMessage, updatedAt: new Date() })
                      .where(eq(eventRequests.id, existing.id));
                    logger.info(`📝 Backfilled message for event ${existing.id} (${existing.organizationName}) via row ID match`);
                  } catch (backfillError) {
                    logger.warn(`Failed to backfill message for event ${existing.id}: ${backfillError}`);
                  }
                }
                updatedCount++;
                continue;
              }
            }
          }

          // Check if record exists by EITHER hash format (old base64 or new SHA256)
          // This ensures we detect existing records regardless of which hash format was used
          // IMPORTANT: Fetch ALL matches, then prioritize new-style hash matches over old-style
          const existingByHashAll = await db
            .select({
              id: eventRequests.id,
              status: eventRequests.status,
              externalId: eventRequests.externalId,
              organizationName: eventRequests.organizationName,
              message: eventRequests.message,  // Include message for backfill check
              desiredEventDate: eventRequests.desiredEventDate  // Include date for old-hash validation
            })
            .from(eventRequests)
            .where(
              sql`${eventRequests.externalId} IN (${externalIdTrimmed}, ${oldStyleHash}, ${newStyleHash})`
            );

          // Prioritize exact match (newStyleHash or externalIdTrimmed) over old-style hash match
          // This ensures we backfill the CORRECT record when same email is used for multiple events
          let existingByHash = existingByHashAll.filter(r => {
            const matchesNewHash = r.externalId === newStyleHash;
            const matchesExternalId = r.externalId === externalIdTrimmed;
            if (!matchesNewHash && !matchesExternalId) return false;

            // GUARD: if the match is via the sheet's explicit externalId column (not the
            // hash we computed ourselves), validate that org names agree before treating
            // it as a duplicate.  When a new sheet is created, column J may carry over
            // stale IDs from the previous sheet that belong to completely different orgs.
            if (matchesExternalId && !matchesNewHash) {
              const existingOrgNorm = (r.organizationName || '').trim().toLowerCase();
              const incomingOrgNorm = normalizedOrg.toLowerCase();
              if (existingOrgNorm && incomingOrgNorm && existingOrgNorm !== incomingOrgNorm) {
                logger.info(`⚠️ ExternalId "${externalIdTrimmed}" matched existing entry "${r.organizationName}" but incoming org is "${(sanitizedData as any).organizationName}" — ignoring stale/mismatched external_id, will treat as new`);
                return false;
              }
            }
            return true;
          });

          // If no new-style match, fall back to old-style match ONLY if the event date also matches.
          // The old-style hash is email-only, so without a date check, repeat contacts (same email,
          // different event) are incorrectly treated as duplicates and their new requests get skipped.
          if (existingByHash.length === 0 && existingByHashAll.length > 0) {
            const incomingDate = (sanitizedData as any).desiredEventDate;
            const oldHashDateMatches = existingByHashAll.filter(r => {
              // CRITICAL FIX: missing dates must NOT be treated as matching dates.
              // The old-style hash is email-only, so the date check is the only thing
              // preventing repeat contacts from being blocked.  null === null is NOT
              // evidence that two requests are for the same event.
              if (!incomingDate || !r.desiredEventDate) return false;
              const existingDateStr = r.desiredEventDate instanceof Date
                ? r.desiredEventDate.toISOString().split('T')[0]
                : String(r.desiredEventDate).split('T')[0];
              const incomingDateStr = incomingDate instanceof Date
                ? incomingDate.toISOString().split('T')[0]
                : String(incomingDate).split('T')[0];
              return existingDateStr === incomingDateStr;
            });
            existingByHash = oldHashDateMatches;
            if (oldHashDateMatches.length === 0 && existingByHashAll.length > 0) {
              logger.info(`🆕 Old-style hash matched existing record(s) but event dates differ — treating as NEW request (email: ${normalizedEmail}, incoming date: ${incomingDate})`);
            }
          }

          // ALSO check by org + date + contact name to catch duplicates when email changes in Google Sheet
          const desiredDate = (sanitizedData as any).desiredEventDate;
          const contactFirst = (sanitizedData as any).firstName?.trim().toLowerCase();
          const contactLast = (sanitizedData as any).lastName?.trim().toLowerCase();
          
          let existingByOrgDateName: { id: number; externalId: string | null; message: string | null }[] = [];
          if (normalizedOrg && desiredDate && (contactFirst || contactLast)) {
            existingByOrgDateName = await db
              .select({ id: eventRequests.id, externalId: eventRequests.externalId, message: eventRequests.message })
              .from(eventRequests)
              .where(
                and(
                  sql`LOWER(TRIM(${eventRequests.organizationName})) = ${normalizedOrg.toLowerCase()}`,
                  eq(eventRequests.desiredEventDate, desiredDate),
                  sql`(LOWER(TRIM(${eventRequests.firstName})) = ${contactFirst || ''} OR LOWER(TRIM(${eventRequests.lastName})) = ${contactLast || ''})`
                )
              )
              .limit(1);
          }

          const recordExisted = (existingByHash && existingByHash.length > 0) ||
                                (existingByOrgDateName && existingByOrgDateName.length > 0);

          // Skip if already exists, BUT check for message backfill opportunity
          if (recordExisted) {
            // Determine which existing record to use for backfill - prioritize exact hash match
            const existingRecord = existingByHash.length > 0 ? existingByHash[0] : existingByOrgDateName[0];
            const sheetMessage = (sanitizedData as any).message?.trim();
            const dbMessage = existingRecord.message?.trim();
            
            // Backfill message if: DB is empty/null but sheet has content
            if ((!dbMessage || dbMessage === '') && sheetMessage && sheetMessage.length > 0) {
              try {
                await db
                  .update(eventRequests)
                  .set({ 
                    message: sheetMessage,
                    updatedAt: new Date()
                  })
                  .where(eq(eventRequests.id, existingRecord.id));
                logger.info(`📝 Backfilled message for event ${existingRecord.id} (${existingRecord.organizationName}): "${sheetMessage.substring(0, 50)}..."`);
              } catch (backfillError) {
                logger.warn(`Failed to backfill message for event ${existingRecord.id}: ${backfillError}`);
              }
            }
            
            updatedCount++;
            continue;
          }

          // Use INSERT ON CONFLICT DO NOTHING - once imported, never touched again
          // This ensures manual edits in the database are NEVER overwritten by Google Sheets sync
          const result = await db
            .insert(eventRequests)
            .values(sanitizedData as any)
            .onConflictDoNothing({
              target: eventRequests.externalId,
            })
            .returning({ 
              id: eventRequests.id, 
              externalId: eventRequests.externalId
            });

          if (result && result.length > 0) {
            // If result has data, it means INSERT succeeded (new record)
            // Add audit logging for Google Sheets sync import
            await AuditLogger.logEventRequestChange(
              result[0].id.toString(),
              null,
              { ...sanitizedData, id: result[0].id },
              {
                userId: 'SYSTEM',
                ipAddress: 'SYSTEM_SYNC',
                userAgent: 'Google Sheets - Automatic Sync',
                sessionId: 'SYNC_SESSION',
              },
              { actionType: 'CREATE', operation: 'GOOGLE_SHEETS_SYNC' }
            );
            
            // Auto-geocode new events with addresses (async, don't block sync)
            const eventAddress = (sanitizedData as any).eventAddress;
            if (eventAddress && eventAddress.trim()) {
              geocodeAddress(eventAddress)
                .then(async (coords) => {
                  if (coords) {
                    await db
                      .update(eventRequests)
                      .set({
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                      })
                      .where(eq(eventRequests.id, result[0].id));
                    logger.info(`✅ Auto-geocoded event ${result[0].id}: ${eventAddress}`);
                  }
                })
                .catch((err) => {
                  logger.warn(`Failed to auto-geocode event ${result[0].id}: ${err.message}`);
                });
            }
            
            createdCount++;
          }
          // Note: If result is empty, external_id conflict detected - already counted in early continue above
        } catch (error) {
          logger.error(`❌ Failed to upsert record for external_id: ${row.externalId} - ${row.organizationName}:`, error);
          logger.error(`❌ Row details:`, {
            rowIndex: row.rowIndex,
            externalId: row.externalId,
            organizationName: row.organizationName,
            email: row.email,
            submittedOn: row.submittedOn
          });
          logger.error(`❌ Error details:`, error);
          // Continue processing other records
        }
      }

      logger.log(`Sync complete: ${createdCount} created, ${updatedCount} skipped`);
      logger.log(`External ID stats: ${rowsWithExternalId} rows had externalId, ${rowsWithoutExternalId} rows had auto-generated externalId`);
      
      if (createdCount === 0 && sheetRows.length > 0) {
        logger.warn(`⚠️ No new records created from ${sheetRows.length} rows - all may already exist in database`);
        logger.warn(`⚠️ This could indicate: 1) All rows already imported, 2) External ID generation issue, or 3) Conflict detection too aggressive`);
      }

      return {
        success: true,
        message: `Successfully synced from Google Sheets: ${createdCount} created, ${updatedCount} skipped (existing)`,
        created: createdCount,
        updated: updatedCount,
      };
    } catch (error) {
      logger.error('Error syncing from Google Sheets:', error);
      return {
        success: false,
        message: `Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * DEPRECATED: No longer updating Google Sheets - one-way sync only
   * @deprecated This method is no longer used as we only sync FROM sheets, not TO sheets
   */
  private async updateEventRequestsSheet(
    eventRequests: EventRequestSheetRow[]
  ): Promise<void> {
    // DISABLED: One-way sync only - we don't write back to Google Sheets
    logger.warn('⚠️ updateEventRequestsSheet called but is disabled - one-way sync only');
    return;

    /* Original implementation commented out:
    if (!this.sheets) {
      throw new Error('Google Sheets service not initialized');
    }

    if (eventRequests.length === 0) {
      logger.log('No event requests to sync');
      return;
    }

    // First, read existing data to preserve manual edits
    let existingData: any[][] = [];
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A:AZ`,
      });
      existingData = response.data.values || [];
    } catch (error) {
      logger.warn(
        'Could not read existing event requests sheet data, proceeding with full overwrite:',
        error
      );
    }

    // Prepare app-managed headers (columns A-M)
    const appManagedHeaders = [
      'Organization Name', // A
      'Contact Name', // B
      'Email', // C
      'Phone', // D
      'Desired Event Date', // E
      'Message', // F
      'Department', // G
      'Previously Hosted', // H
      'Status', // I
      'Created Date', // J
      'Last Updated', // K
      'Duplicate Check', // L
      'Notes', // M
    ];

    // Smart merge: preserve manual columns beyond M (columns N, O, P, etc.)
    const mergedData = this.mergeEventRequestsSheetData(
      eventRequests,
      existingData,
      appManagedHeaders
    );

    // Update the sheet with merged data
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.worksheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: mergedData },
    });

    logger.log(
      `✅ Smart-synced Google Sheets with ${eventRequests.length} event requests (preserving manual columns N+)`
    );
    */
  }

  /**
   * Merge new app data with existing manual edits
   * Preserves columns beyond M (manual tracking columns)
   * Updates columns A-M (app-managed data)
   */
  private mergeEventRequestsSheetData(
    eventRequests: EventRequestSheetRow[],
    existingData: any[][],
    appHeaders: string[]
  ): any[][] {
    const merged: any[][] = [];

    // Handle headers row
    const existingHeaders = existingData[0] || [];
    const mergedHeaders = [...appHeaders];

    // Preserve any manual headers beyond column M (index 12)
    for (let i = appHeaders.length; i < existingHeaders.length; i++) {
      if (existingHeaders[i] && existingHeaders[i].trim()) {
        mergedHeaders[i] = existingHeaders[i];
      }
    }
    merged[0] = mergedHeaders;

    // Create lookup map for existing data by organization + contact name
    const existingRowMap = new Map<string, any[]>();
    for (let i = 1; i < existingData.length; i++) {
      const row = existingData[i] || [];
      const orgName = row[0] || '';
      const contactName = row[1] || '';
      const key = `${orgName.toLowerCase().trim()}|${contactName.toLowerCase().trim()}`;
      if (key !== '|') {
        existingRowMap.set(key, row);
      }
    }

    // Process each new event request
    eventRequests.forEach((request) => {
      const key = `${(request.organizationName || '').toLowerCase().trim()}|${(request.contactName || '').toLowerCase().trim()}`;
      const existingRow = existingRowMap.get(key) || [];

      // Create merged row: app data (A-M) + preserved manual data (N+)
      const newRow = [
        request.organizationName, // A
        request.contactName, // B
        request.email, // C
        request.phone, // D
        request.desiredEventDate, // E
        request.message, // F
        request.department, // G
        request.previouslyHosted, // H
        request.status, // I
        request.createdDate, // J
        request.lastUpdated, // K
        request.duplicateCheck, // L
        request.notes, // M
      ];

      // Preserve manual columns (N, O, P, etc.) from existing data
      for (
        let i = appHeaders.length;
        i < Math.max(mergedHeaders.length, existingRow.length);
        i++
      ) {
        newRow[i] = existingRow[i] || '';
      }

      merged.push(newRow);
      existingRowMap.delete(key); // Mark as processed
    });

    // Add any remaining existing rows that weren't in the new data
    existingRowMap.forEach((existingRow) => {
      if (existingRow.some((cell) => cell && cell.toString().trim())) {
        merged.push(existingRow);
      }
    });

    return merged;
  }

  /**
   * Read event requests from Google Sheets with dynamic header mapping
   */
  private async readEventRequestsSheet(): Promise<EventRequestSheetRow[]> {
    if (!this.sheets) {
      throw new Error('Google Sheets service not initialized');
    }

    // First, read the header row to build dynamic column mapping
    const headerResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.worksheetName}!A1:AZ1`,
    });

    const headers = headerResponse.data.values?.[0] || [];

    // Build header to index mapping (case-insensitive)
    const headerMap = new Map<string, number>();
    headers.forEach((header: string, index: number) => {
      if (header && header.trim()) {
        const normalizedHeader = header.trim().toLowerCase();
        headerMap.set(normalizedHeader, index);
      }
    });

    // Define expected headers and their possible variations
    const getColumnIndex = (possibleHeaders: string[]): number => {
      for (const header of possibleHeaders) {
        const index = headerMap.get(header.toLowerCase());
        if (index !== undefined) {
          return index;
        }
      }
      return -1;
    };

    // Map expected fields to their column indices - Updated for new sheet structure
    const columnMapping = {
      externalId: getColumnIndex(['external_id', 'external id', 'id', 'unique_id', 'unique id', 'record_id', 'record id']),
      submittedOn: getColumnIndex(['submitted on', 'timestamp', 'submission date', 'date submitted', 'created']),
      name: getColumnIndex(['name', 'full name', 'contact name', 'your name']), // Single name field
      firstName: getColumnIndex(['first name', 'fname', 'first']), // Legacy support
      lastName: getColumnIndex(['last name', 'lname', 'last']), // Legacy support
      email: getColumnIndex(['your email', 'email', 'email address', 'e-mail', 'contact email']),
      organizationName: getColumnIndex(['grouporganization name  department', 'grouporganization name', 'group/organization name', 'group organization name', 'grouporganization', 'organization', 'group', 'organization name', 'company', 'org name', 'group / organization name', 'group/organization', 'org']),
      department: getColumnIndex(['department/team if applicable', 'department/team', 'department team', 'departmentteam', 'department', 'team', 'dept', 'division', 'department / team']),
      eventLocation: getColumnIndex(['event location', 'location', 'event site', 'venue', 'sandwich location', 'where will the event take place?', 'event address']),
      phone: getColumnIndex(['phone number', 'phone', 'contact phone', 'telephone', 'mobile', 'cell phone']),
      desiredEventDate: getColumnIndex(['proposed event date', 'desired event date', 'event date', 'date requested', 'preferred date', 'requested date', 'preferred event date', 'date of event', 'event date requested', 'desired date', 'sandwich event date', 'host event date']),
      previouslyHosted: getColumnIndex(['has your organization done an event with us before', 'has your organization done an event with us before?', 'previously hosted', 'previous event', 'hosted before', 'past event']),
      message: getColumnIndex(['message', 'additional details', 'details', 'description', 'comments', 'notes', 'additional information']),
      status: getColumnIndex(['status', 'current status', 'state', 'event status']),
    };

    // Log detected headers and column mapping for debugging (logger.info = visible in production)
    logger.info('📋 Detected sheet headers:', JSON.stringify(headers));
    logger.info('📋 Column mapping result:', JSON.stringify({
      organizationName: columnMapping.organizationName >= 0 ? `Found at column ${columnMapping.organizationName}` : 'NOT FOUND',
      eventLocation: columnMapping.eventLocation >= 0 ? `Found at column ${columnMapping.eventLocation}` : 'NOT FOUND',
      email: columnMapping.email >= 0 ? `Found at column ${columnMapping.email}` : 'NOT FOUND',
      name: columnMapping.name >= 0 ? `Found at column ${columnMapping.name}` : 'NOT FOUND',
      desiredEventDate: columnMapping.desiredEventDate >= 0 ? `Found at column ${columnMapping.desiredEventDate}` : 'NOT FOUND ⚠️',
      message: columnMapping.message >= 0 ? `Found at column ${columnMapping.message}` : 'NOT FOUND',
      previouslyHosted: columnMapping.previouslyHosted >= 0 ? `Found at column ${columnMapping.previouslyHosted}` : 'NOT FOUND',
      department: columnMapping.department >= 0 ? `Found at column ${columnMapping.department}` : 'NOT FOUND',
    }));

    // Check if we failed to detect most headers - might need fallback to fixed positions
    const mappedColumnsCount = Object.values(columnMapping).filter(idx => idx >= 0).length;
    const useFixedPositions = mappedColumnsCount < 5; // If less than 5 columns were found, use fixed positions

    if (useFixedPositions) {
      logger.warn('⚠️ Header detection failed for most columns. Using fallback fixed column positions.');
      logger.warn('⚠️ Detected headers:', headers);
      logger.warn('⚠️ This may indicate the Google Sheet headers have changed.');

      // Common Squarespace form export column order (adjust based on your actual sheet)
      // These are typical positions - you may need to adjust based on your actual sheet
      columnMapping.submittedOn = 0; // Column A - Timestamp/Submitted On
      columnMapping.name = 1; // Column B - Name
      columnMapping.email = 2; // Column C - Email
      columnMapping.phone = 3; // Column D - Phone
      columnMapping.organizationName = 4; // Column E - Organization
      columnMapping.department = 5; // Column F - Department
      columnMapping.desiredEventDate = 6; // Column G - Desired Event Date
      columnMapping.message = 7; // Column H - Message
      columnMapping.previouslyHosted = 8; // Column I - Previously Hosted
      columnMapping.status = 9; // Column J - Status (if exists)

      logger.info('📋 Using FIXED column positions:', JSON.stringify(columnMapping));
    } else if (columnMapping.desiredEventDate < 0) {
      logger.warn('⚠️ desiredEventDate column NOT FOUND in sheet headers — event dates will be null for all rows');
      logger.warn('⚠️ Searched for variations of: desired event date, event date, date requested, preferred date, requested date, preferred event date, date of event, desired date, date');
    }

    // Read data rows
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.worksheetName}!A2:AZ1000`,
    });

    const rows = response.data.values || [];
    logger.info(`📊 Reading ${rows.length} rows from Google Sheets (desiredEventDate at column index ${columnMapping.desiredEventDate})`);
    
    if (rows.length === 0) {
      logger.warn('⚠️ No data rows found in Google Sheet - check if sheet has data or range is correct');
      return [];
    }
    
    // Filter out completely empty rows
    const nonEmptyRows = rows.filter((row: string[]) => {
      return row && row.some((cell: string) => cell && cell.trim().length > 0);
    });
    
    if (nonEmptyRows.length < rows.length) {
      logger.log(`Filtered out ${rows.length - nonEmptyRows.length} empty rows`);
    }
    
    logger.log(`Processing ${nonEmptyRows.length} non-empty rows`);

    // Track original row indices for proper rowIndex calculation
    let originalRowIndex = 1; // Start at 1 (row 2 in sheet, since row 1 is header)
    
    return nonEmptyRows.map((row: string[], index: number) => {
      // Calculate actual row number in sheet (accounting for header row)
      // We need to find which original row this corresponds to
      const actualRowNumber = originalRowIndex + 1; // +1 for header row
      originalRowIndex++;
      
      // ACTUALLY USE the dynamic column mapping computed above!
      const getFieldValue = (colIndex: number, defaultValue = '') => {
        if (colIndex < 0) {
          return defaultValue;
        }

        let value = row[colIndex] || defaultValue;

        // Clean up phone numbers if detected in phone column
        if (colIndex === columnMapping.phone && value) {
          // Remove any non-digit characters except common phone separators
          const originalValue = value;
          // Check if this looks like an Excel serial number (all digits, 5-6 digits long)
          if (/^\d{5,6}$/.test(value)) {
            logger.warn(`⚠️ Phone field contains Excel serial number: "${value}" - likely a date field misplaced`);
            value = ''; // Clear invalid phone numbers
          } else {
            // Clean normal phone numbers
            value = value.replace(/[^\d\s\-\(\)\+\.]/g, '').trim();
          }
        }

        return value;
      };

      // Handle single Name field from new sheet structure or legacy firstName/lastName
      let firstName = '';
      let lastName = '';
      let contactName = '';

      if (columnMapping.name >= 0) {
        // New sheet structure: single Name field
        const fullName = getFieldValue(columnMapping.name);
        contactName = fullName;
        
        // Split name into firstName and lastName
        if (fullName && fullName.trim()) {
          const nameParts = fullName.trim().split(/\s+/);
          firstName = nameParts[0] || '';
          lastName = nameParts.slice(1).join(' ') || '';
        }
      } else {
        // Legacy sheet structure: separate firstName/lastName fields
        firstName = getFieldValue(columnMapping.firstName);
        lastName = getFieldValue(columnMapping.lastName);
        contactName = `${firstName} ${lastName}`.trim();
      }

      // Extract values
      const phoneValue = getFieldValue(columnMapping.phone);
      const messageValue = getFieldValue(columnMapping.message);
      const eventLocationValue = getFieldValue(columnMapping.eventLocation);
      const dateValue = getFieldValue(columnMapping.desiredEventDate);
      
      // Warn on rows that have org/email but no date — helps diagnose column mapping issues
      const orgOrEmail = getFieldValue(columnMapping.organizationName) || getFieldValue(columnMapping.email);
      if (orgOrEmail && !dateValue) {
        const rawDateCell = columnMapping.desiredEventDate >= 0 ? row[columnMapping.desiredEventDate] : '(column not mapped)';
        logger.warn(`⚠️ Row ${actualRowNumber}: org/email present but desiredEventDate is empty. Raw cell value: "${rawDateCell}", column index: ${columnMapping.desiredEventDate}`);
      }

      // Message comes through verbatim from the sheet. Event location is stored
      // separately (mapped to `eventAddress` in sheetRowToEventRequest) and rendered
      // on the card under the date, so appending it to the message produced a
      // visible duplicate in the "Initial Request Notes" block.
      const messageOnly = messageValue ? messageValue.trim() : '';

      const result = {
        externalId: getFieldValue(columnMapping.externalId),
        submittedOn: getFieldValue(columnMapping.submittedOn),
        contactName: contactName || 'Unknown Contact',
        email: getFieldValue(columnMapping.email),
        organizationName: getFieldValue(columnMapping.organizationName),
        eventLocation: eventLocationValue,
        message: messageOnly,
        phone: phoneValue || '', // Will default to '' if not found
        desiredEventDate: dateValue,
        department: getFieldValue(columnMapping.department),
        previouslyHosted: getFieldValue(columnMapping.previouslyHosted, 'i_dont_know'),
        status: (() => {
          // CRITICAL FIX: Only assign status if column exists, otherwise don't default to 'new'
          const statusValue = getFieldValue(columnMapping.status, '');
          if (statusValue && statusValue.trim()) {
            return statusValue.trim();
          }
          // Don't default to 'new' - let the sheetRowToEventRequest logic handle it
          return '';
        })(),
        createdDate: '',
        lastUpdated: new Date().toISOString(),
        duplicateCheck: 'No',
        notes: getFieldValue(columnMapping.previouslyHosted), // Use same as previouslyHosted for notes
        rowIndex: actualRowNumber, // Actual row number in Google Sheet
      };

      return result;
    });
  }

  /**
   * Analyze the sheet structure
   */
  async analyzeSheetStructure(): Promise<{
    headers: string[];
    rowCount: number;
    lastUpdate: string;
  }> {
    try {
      await this.ensureInitialized();

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A1:AZ1`,
      });

      const headers = response.data.values?.[0] || [];

      const dataResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A2:AZ1000`,
      });

      const rowCount = dataResponse.data.values?.length || 0;

      return {
        headers,
        rowCount,
        lastUpdate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error analyzing event requests sheet structure:', error);
      throw error;
    }
  }

  /**
   * DRY-RUN DIAGNOSTIC: Find missing events from Google Sheet that are NOT in database
   * This does NOT insert anything - it only reports what's missing
   */
  async findMissingEvents(): Promise<{
    success: boolean;
    sheetRowCount: number;
    databaseCount: number;
    missingEvents: Array<{
      rowIndex: number;
      organizationName: string;
      contactName: string;
      email: string;
      desiredEventDate: string;
      submittedOn: string;
      oldHash: string;
      newHash: string;
      reason: string;
    }>;
    duplicatesInSheet: Array<{
      organizationName: string;
      desiredEventDate: string;
      count: number;
    }>;
  }> {
    try {
      await this.ensureInitialized();

      // Read all rows from Google Sheet
      const sheetRows = await this.readEventRequestsSheet();
      
      // Get count of database records
      const dbCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(eventRequests);
      const databaseCount = Number(dbCountResult[0]?.count || 0);

      const missingEvents: Array<{
        rowIndex: number;
        organizationName: string;
        contactName: string;
        email: string;
        desiredEventDate: string;
        submittedOn: string;
        oldHash: string;
        newHash: string;
        reason: string;
      }> = [];

      // Track duplicates in sheet
      const sheetOrgDateCounts = new Map<string, number>();

      for (const row of sheetRows) {
        const normalizedEmail = (row.email || 'no-email').trim().toLowerCase();
        const normalizedSubmittedOn = (row.submittedOn || 'no-date').trim();
        const normalizedOrg = (row.organizationName || 'no-org').trim();
        const normalizedName = (row.contactName || 'no-name').trim();
        
        const uniqueParts = [
          normalizedEmail,
          normalizedSubmittedOn,
          normalizedOrg,
          normalizedName
        ].join('|');
        
        // Generate both hash formats
        const oldStyleHash = `auto-${Buffer.from(uniqueParts).toString('base64').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`;
        const newStyleHash = `auto-${createHash('sha256').update(uniqueParts).digest('hex').substring(0, 16)}`;
        
        const externalIdTrimmed = (row.externalId || '').trim();

        // Track org+date combinations in sheet
        const orgDateKey = `${normalizedOrg.toLowerCase()}|${row.desiredEventDate || 'no-date'}`;
        sheetOrgDateCounts.set(orgDateKey, (sheetOrgDateCounts.get(orgDateKey) || 0) + 1);

        // Check if exists by EITHER hash format
        const existingByHash = await db
          .select({ id: eventRequests.id, externalId: eventRequests.externalId })
          .from(eventRequests)
          .where(
            sql`${eventRequests.externalId} IN (${externalIdTrimmed || 'NONE'}, ${oldStyleHash}, ${newStyleHash})`
          )
          .limit(1);

        // Also check by org + date + contact name (fallback)
        const eventRequestData = this.sheetRowToEventRequest(row);
        const desiredDate = eventRequestData.desiredEventDate;
        const contactFirst = (eventRequestData.firstName || '').trim().toLowerCase();
        const contactLast = (eventRequestData.lastName || '').trim().toLowerCase();
        
        let existingByOrgDate: any[] = [];
        if (normalizedOrg && desiredDate && (contactFirst || contactLast)) {
          existingByOrgDate = await db
            .select({ id: eventRequests.id })
            .from(eventRequests)
            .where(
              and(
                sql`LOWER(TRIM(${eventRequests.organizationName})) = ${normalizedOrg.toLowerCase()}`,
                eq(eventRequests.desiredEventDate, desiredDate),
                sql`(LOWER(TRIM(${eventRequests.firstName})) = ${contactFirst || ''} OR LOWER(TRIM(${eventRequests.lastName})) = ${contactLast || ''})`
              )
            )
            .limit(1);
        }

        const foundByHash = existingByHash && existingByHash.length > 0;
        const foundByOrgDate = existingByOrgDate && existingByOrgDate.length > 0;

        if (!foundByHash && !foundByOrgDate) {
          missingEvents.push({
            rowIndex: row.rowIndex || 0,
            organizationName: normalizedOrg,
            contactName: normalizedName,
            email: normalizedEmail,
            desiredEventDate: row.desiredEventDate || 'no-date',
            submittedOn: normalizedSubmittedOn,
            oldHash: oldStyleHash,
            newHash: newStyleHash,
            reason: 'Not found by hash or org+date+contact matching'
          });
        }
      }

      // Find duplicates in sheet
      const duplicatesInSheet = Array.from(sheetOrgDateCounts.entries())
        .filter(([_, count]) => count > 1)
        .map(([key, count]) => {
          const [org, date] = key.split('|');
          return { organizationName: org, desiredEventDate: date, count };
        });

      return {
        success: true,
        sheetRowCount: sheetRows.length,
        databaseCount,
        missingEvents,
        duplicatesInSheet,
      };
    } catch (error) {
      logger.error('Error finding missing events:', error);
      throw error;
    }
  }
}

/**
 * Get the Event Requests Google Sheets service instance
 */
export function getEventRequestsGoogleSheetsService(
  storage: IStorage
): EventRequestsGoogleSheetsService | null {
  try {
    // Validate all required environment variables for Google Sheets authentication
    if (
      !process.env.GOOGLE_PROJECT_ID ||
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      !process.env.GOOGLE_PRIVATE_KEY
    ) {
      logger.warn(
        'Google Sheets authentication not configured - missing GOOGLE_PROJECT_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_PRIVATE_KEY'
      );
      return null;
    }

    if (!process.env.EVENT_REQUESTS_SHEET_ID) {
      logger.warn('EVENT_REQUESTS_SHEET_ID not configured');
      return null;
    }

    logger.log(
      '✅ All Event Requests Google Sheets environment variables validated'
    );
    return new EventRequestsGoogleSheetsService(storage);
  } catch (error) {
    logger.error(
      'Failed to create Event Requests Google Sheets service:',
      error
    );
    return null;
  }
}
