import { google } from 'googleapis';
import { parsePlanningStaffing } from './services/planning-sheet-row-update';
import { JWT } from 'google-auth-library';
import { db } from './db';
import { eq, desc, inArray, and, gte, sql } from 'drizzle-orm';
import { eventRequests, proposedSheetChanges, users } from '@shared/schema';
import { logger } from './utils/production-safe-logger';
import { getEffectiveEventDate } from '../shared/event-validation-utils';

/**
 * Planning Sheet Column Mapping
 * Maps the Google Sheet columns to app fields
 *
 * If a column is inserted, bump every index after the insertion point and
 * PLANNING_SHEET_COLUMN_COUNT / LAST_COLUMN will follow automatically.
 */
export const PLANNING_SHEET_COLUMNS = {
  DATE: 0,                    // A - Date
  DAY_OF_WEEK: 1,             // B - Day of Week
  GROUP_NAME: 2,              // C - Group Name
  EVENT_START_TIME: 3,        // D - Event Start time
  EVENT_END_TIME: 4,          // E - Event end time
  PICK_UP_TIME: 5,            // F - Pick up time
  PICK_UP_NEXT_DAY: 6,        // G - Pick up next day?
  ALL_DETAILS: 7,             // H - ALL DETAILS
  VAN_BOOKED: 8,              // I - Van Booked?
  VAN_NEEDED_FOR: 9,          // J - Van needed for? (Transport / Refrigeration)
  STAFFING: 10,               // K - Staffing (special format: D: Name, S: Name, V: Name)
  ESTIMATE_SANDWICHES: 11,    // L - Estimate # sandwiches
  DELI_OR_PBJ: 12,            // M - Deli or PBJ?
  FINAL_SANDWICHES: 13,       // N - Final # sandwiches made
  TOTAL_IN_APP: 14,           // O - #'s added to app (sheet-owned)
  FOLLOW_UP_EMAIL_SENT: 15,   // P - Follow-up email sent (sheet-owned; was "Social Post")
  SENT_TOOLKIT: 16,           // Q - Sent toolkit?
  CONTACT_NAME: 17,           // R - Contact Name
  EMAIL: 18,                  // S - Email Address
  PHONE: 19,                  // T - Contact Cell Number
  TSP_CONTACT: 20,            // U - TSP Contact
  ADDRESS: 21,                // V - Address
  RECIPIENT_HOST: 22,         // W - Planned Recipient/Host Home
  AFTER_EVENT_NOTES: 23,      // X - After Event Notes
  CANCELLED: 24,              // Y - Cancelled
  NOTES: 25,                  // Z - Notes
  SYNC_ID: 26,                // AA - sync_id: a per-row ID kept on the sheet (sheet-owned; was "Add'l Notes")
  UNLABELED_AB: 27,           // AB - no header (sheet-owned; was "Waiting On")
} as const;

/**
 * Columns the sheet owns. The app never writes them: new rows get blanks and
 * an existing row keeps whatever the sheet has, whatever merge decision was
 * picked ("use app" included). Matches the live sheet as of Nov 2026:
 * O "#'s added to app", P "Follow-up email sent", AA "sync_id", AB unlabeled.
 */
export const SHEET_OWNED_COLUMNS: readonly number[] = [
  PLANNING_SHEET_COLUMNS.TOTAL_IN_APP,
  PLANNING_SHEET_COLUMNS.FOLLOW_UP_EMAIL_SENT,
  PLANNING_SHEET_COLUMNS.SYNC_ID,
  PLANNING_SHEET_COLUMNS.UNLABELED_AB,
];

/** A copy of a new row with every sheet-owned cell blank (for rows the app creates). */
export function blankSheetOwnedColumns(row: string[]): string[] {
  const out = [...row];
  for (const i of SHEET_OWNED_COLUMNS) if (i < out.length) out[i] = '';
  return out;
}

/** Copy the sheet's own values into the sheet-owned columns of a row about to be written. */
export function keepSheetOwnedColumns(row: string[], existingRaw: string[]): string[] {
  const out = [...row];
  for (const i of SHEET_OWNED_COLUMNS) out[i] = existingRaw[i] ?? '';
  return out;
}

/** Convert a 0-based column index to a spreadsheet letter (0 → A, 26 → AA, 27 → AB). */
export function planningSheetColumnLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export const PLANNING_SHEET_COLUMN_COUNT =
  Math.max(...Object.values(PLANNING_SHEET_COLUMNS)) + 1;

export const PLANNING_SHEET_LAST_COLUMN = planningSheetColumnLetter(
  PLANNING_SHEET_COLUMN_COUNT - 1
);

/** Pre-J layout was A:AA (27 cells). Inserting J made A:AB (28 cells). */
export const LEGACY_PLANNING_SHEET_COLUMN_COUNT = 27;

/**
 * Shift a queued create_row proposal from the pre-J 27-column layout to the
 * current map by inserting an empty "Van needed for?" cell at index 9.
 * Already-migrated (28+) rows are returned unchanged.
 */
export function migrateProposedPlanningRow(
  row: string[] | null | undefined
): string[] | null {
  if (!row || !Array.isArray(row)) return row ?? null;
  if (row.length !== LEGACY_PLANNING_SHEET_COLUMN_COUNT) return row;
  const next = row.slice();
  next.splice(PLANNING_SHEET_COLUMNS.VAN_NEEDED_FOR, 0, '');
  return next;
}

export type VanNeededFor = 'transport' | 'refrigeration';

/** Parse the planning-sheet "Van needed for?" cell into the DB enum. */
export function parseVanNeededForCell(
  cell: string | undefined | null
): VanNeededFor | null {
  const v = (cell || '').trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('refrig')) return 'refrigeration';
  if (v.startsWith('transport')) return 'transport';
  return null;
}

/** Format the DB enum for the planning-sheet "Van needed for?" cell. */
export function formatVanNeededForCell(
  value: string | null | undefined
): string {
  if (value === 'transport') return 'Transport';
  if (value === 'refrigeration') return 'Refrigeration';
  return '';
}

/**
 * Staffing format parser and generator
 *
 * Format specifications:
 * - The staffing column contains role assignments separated by role prefixes
 * - Format: "D: Name1, Name2, S: Name3, V: Name4, VD: Name5"
 * - Each role can have multiple people assigned (comma-separated names)
 * - Each role can be:
 *   - Assigned with name(s): "D: John Doe, Jane Smith" (role needed, assigned to John and Jane)
 *   - Unassigned but needed: "D:" or "D: " (role needed but no one assigned)
 *   - Not needed: role is omitted from the string
 *
 * Roles:
 * - D: Driver (regular)
 * - VD: Van Driver (special type of driver, checked before D)
 * - S: Speaker
 * - V: Volunteer
 *
 * Examples:
 * - "D: John Doe, S: Jane Smith" = Driver assigned to John, Speaker assigned to Jane
 * - "D: John, Jane, S: Bob" = Drivers assigned to John AND Jane, Speaker assigned to Bob
 * - "D:, S:" = Driver and Speaker needed but unassigned
 * - "VD: Bob Jones, V:" = Van Driver assigned to Bob, Volunteer needed but unassigned
 * - "" = No roles needed
 *
 * Note: When parsing, VD must be checked before D to avoid false matches.
 * Note: Unassigned positions may include trailing space after colon (e.g., "D: ").
 * Note: Comma-separated names within a role are preserved as a single string.
 */
export interface StaffingInfo {
  driver: { needed: boolean; assigned: string | null; isVanDriver: boolean };
  speaker: { needed: boolean; assigned: string | null };
  volunteer: { needed: boolean; assigned: string | null };
}

/** user_<ms>_<rand> (current), UUIDs, or bare numbers (legacy) are IDs; anything else is a typed name. */
export function assignmentLabelForUnknownId(idOrName: string): string {
  const v = (idOrName || '').trim();
  const looksLikeId =
    /^user_\d+_[a-z0-9]+$/i.test(v) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
    /^\d+$/.test(v);
  return !v || looksLikeId ? 'Unknown' : v;
}

/**
 * Parse a staffing column string into structured staffing information.
 *
 * Delegates to parsePlanningStaffing (server/services/planning-sheet-row-update.ts)
 * so every place that reads the Staffing cell agrees. Handles "D: " (needed,
 * unassigned), multi-name lists ("D: Katie, Kim", "Katie & Kim"), VD, and the
 * letters-only format ("D, S, V") the old regex parser missed.
 *
 * See StaffingInfo documentation for format details.
 */
export function parseStaffingColumn(staffingStr: string): StaffingInfo {
  const p = parsePlanningStaffing(staffingStr);
  const joined = (names: string[]) => (names.length ? names.join(', ') : null);
  return {
    driver: { needed: p.driver.listed, assigned: joined(p.driver.names), isVanDriver: p.driver.van },
    speaker: { needed: p.speaker.listed, assigned: joined(p.speaker.names) },
    volunteer: { needed: p.volunteer.listed, assigned: joined(p.volunteer.names) },
  };
}

/**
 * Format a StaffingInfo object into the string format for the Planning Sheet.
 * 
 * Trailing space behavior:
 * - When a role is needed but unassigned, the format includes a trailing space after the colon.
 * - Examples: "D: ", "S: ", "V: ", "VD: "
 * - This is intentional to indicate the position is open/needed but not yet filled.
 * - The parser handles both "D:" and "D: " as unassigned positions.
 * 
 * See StaffingInfo documentation for complete format specification.
 */
export function formatStaffingColumn(staffing: StaffingInfo): string {
  const parts: string[] = [];

  // Driver or Van Driver
  if (staffing.driver.needed) {
    const prefix = staffing.driver.isVanDriver ? 'VD' : 'D';
    if (staffing.driver.assigned) {
      parts.push(`${prefix}: ${staffing.driver.assigned}`);
    } else {
      parts.push(`${prefix}: `); // Unassigned but needed
    }
  }

  // Speaker
  if (staffing.speaker.needed) {
    if (staffing.speaker.assigned) {
      parts.push(`S: ${staffing.speaker.assigned}`);
    } else {
      parts.push(`S: `); // Unassigned but needed
    }
  }

  // Volunteer
  if (staffing.volunteer.needed) {
    if (staffing.volunteer.assigned) {
      parts.push(`V: ${staffing.volunteer.assigned}`);
    } else {
      parts.push(`V: `); // Unassigned but needed
    }
  }

  return parts.join(', ');
}

/**
 * Planning Sheet row data - represents one row in the Planning Sheet
 */
export interface PlanningSheetRow {
  rowIndex: number;
  date: string;
  dayOfWeek: string;
  groupName: string;
  eventStartTime: string;
  eventEndTime: string;
  pickUpTime: string;
  pickUpNextDay: string;
  allDetails: string;
  vanBooked: string;
  vanNeededFor: string;
  staffing: string;
  staffingParsed: StaffingInfo;
  estimateSandwiches: string;
  deliOrPbj: string;
  finalSandwiches: string;
  totalInApp: string;
  followUpEmailSent: string;
  sentToolkit: string;
  contactName: string;
  email: string;
  phone: string;
  tspContact: string;
  address: string;
  recipientHost: string;
  afterEventNotes: string;
  cancelled: string;
  notes: string;
  /** AA: the sheet's per-row ID. Not notes. */
  syncId: string;
  /** AB: unlabeled column, read only so an update can write it back unchanged. */
  unlabeledAB: string;
}

/**
 * Parse a date cell from the planning sheet.
 *
 * Handles the formats the team actually types: "1/15/26", "1/15/2026",
 * "01/15/2026" — and, because the year lives in the tab name ("2026 Groups")
 * rather than the cell, bare month/day values like "1/15" or "Jan 15".
 *
 * That last case matters: JS's native parser resolves a year-less date to
 * 2001. A row that parses as 2001 sorts before every real event, so if the
 * later-dated rows in the sheet are written that way, nothing looks "after"
 * the event being placed and ordered insertion silently degrades into
 * appending at the bottom of the sheet. `fallbackYear` supplies the year
 * those cells omit.
 */
export function parsePlanningSheetDate(
  dateStr: string,
  fallbackYear?: number
): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const trimmed = dateStr.trim();

  // A trailing "?" or "*" marks a date the team hasn't confirmed yet. The date
  // itself still counts for ordering — treating the row as undated would hide
  // it from placement entirely.
  const cleaned = trimmed.replace(/[?*.\s]+$/, '');

  // ISO, in case a cell was pasted in from elsewhere.
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return calendarDate(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10));
  }

  // M/D/YY, M/D/YYYY, or M/D with the year left off — the formats this sheet
  // uses. Matched as a whole rather than split on "/", because parseInt reads
  // "31x" as 31 and would let a mistyped cell pass as a real date.
  const numeric = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (numeric) {
    const [, monthStr, dayStr, yearStr] = numeric;
    let year: number | null = null;
    if (yearStr) {
      year = parseInt(yearStr, 10);
      if (yearStr.length === 2) year += 2000; // "26" -> 2026
    } else if (fallbackYear) {
      year = fallbackYear; // "1/15" on the "2026 Groups" tab
    }
    if (year === null) return null;
    return calendarDate(year, parseInt(monthStr, 10), parseInt(dayStr, 10));
  }

  // Month-name formats ("Jan 15, 2026", "Jan 15") go through the native
  // parser. It is only trusted with text that names a month, because given
  // anything else it invents an answer — it reads "3//26" as March 26, 2001,
  // which would put a fabricated date into the ordering.
  if (!/[a-z]{3}/i.test(cleaned)) return null;

  const parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) return null;

  // The native parser rolls overflow forward too ("Feb 31, 2026" comes back as
  // March 3), so check the day it landed on is the day that was written.
  const writtenDay = cleaned.match(/\b(\d{1,2})\b/);
  if (writtenDay && parseInt(writtenDay[1], 10) !== parsed.getDate()) return null;

  // "Jan 15" with no year resolves to 2001, so use the sheet's year instead.
  // A year that IS written out is left exactly as typed even when it looks
  // wrong: a mistyped year has to show up as an outlier, not be quietly
  // corrected into looking correct.
  if (fallbackYear && !/\d{4}/.test(cleaned)) {
    return calendarDate(fallbackYear, parsed.getMonth() + 1, parsed.getDate());
  }

  return parsed;
}

/**
 * Build a date, rejecting day/month combinations that don't exist. The Date
 * constructor rolls overflow forward instead of complaining, so a typo like
 * "2/31/26" would otherwise sort as March 3 rather than being reported.
 */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Parse a time string like "2:00 PM" or "14:00" to minutes since midnight.
 * Returns null if the time string can't be parsed.
 */
export function parsePlanningSheetTime(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.trim()) return null;

  // 12-hour format: "2:00 PM", "10:30 AM"
  const match12 = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    // These cells are hand-typed, so "13:00 PM" and "9:99" turn up. Reading
    // them as real times would quietly reorder same-day events.
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    const ampm = match12[3].toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour format: "14:00", "09:30", "14:00:00"
  const match24 = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    const seconds = match24[3] ? parseInt(match24[3], 10) : 0;
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
    return hours * 60 + minutes;
  }

  // Local datetime string ("2026-01-15T14:00:00") — the shape pickupDateTime
  // is stored in, which is used as a last resort when ordering same-day rows.
  const matchDateTime = timeStr
    .trim()
    .match(/^\d{4}-\d{2}-\d{2}T(\d{1,2}):(\d{2})/);
  if (matchDateTime) {
    const hours = parseInt(matchDateTime[1], 10);
    const minutes = parseInt(matchDateTime[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
}

export type SheetPlacementReason =
  /** Placed inside the "week of ..." block its date belongs to. */
  | 'insert_in_week_block'
  /** Dated before the first week the sheet covers. */
  | 'insert_before_first_week_block'
  /** Sheets with no week headers fall back to plain date order. */
  | 'insert_after_previous_event'
  | 'insert_before_later_event'
  | 'append_event_is_latest'
  | 'append_no_dated_rows';

export interface SheetPlacement {
  /** 1-based sheet row to insert at (existing rows shift down), or null to append. */
  insertBeforeRow: number | null;
  reason: SheetPlacementReason;
  /** One-line explanation, shown in the push preview/result and written to the logs. */
  note: string;
  totalRows: number;
  datedRows: number;
  /** Rows whose date cell has text in it that could not be read as a date. */
  unreadableDates: { rowIndex: number; value: string }[];
  /**
   * Rows sitting on the wrong side of the chosen position — the sheet says one
   * thing and their date says another. Usually a mistyped year.
   */
  outOfOrderRows: { rowIndex: number; date: string }[];
  /** The week block the row is going into, when the sheet is grouped by week. */
  weekBlock: { headerRow: number; label: string } | null;
  /**
   * Row whose formatting a newly inserted row should be given. Google can only
   * inherit formatting from a neighbour, and a new row frequently sits right
   * above or below a "week of" header — which is how a pushed event ended up
   * looking like a week header instead of an event.
   */
  formatFromRow: number | null;
  lastDatedRow: { rowIndex: number; date: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The sheet opens each week with a row reading "Week of Sep 7" and no date. */
const WEEK_HEADER_PATTERN = /^\s*week of\s+(.+?)\s*$/i;

interface WeekBlock {
  /** Row the "Week of ..." header itself sits on. */
  headerRow: number;
  label: string;
  start: Date;
  /** The week's rows: its events, plus any spare slots kept beneath them. */
  rows: PlanningSheetRow[];
}

/**
 * Split the sheet into the week blocks it is actually organised into.
 *
 * This grouping is what makes the sheet readable as a calendar, and it is the
 * sheet's own statement of which events belong to which week — much safer to
 * follow than inferring week boundaries from dates.
 */
function parseWeekBlocks(
  rows: PlanningSheetRow[],
  fallbackYear?: number
): WeekBlock[] {
  const blocks: WeekBlock[] = [];

  for (const row of rows) {
    const header = (row.dayOfWeek || '').match(WEEK_HEADER_PATTERN);
    const start = header ? parsePlanningSheetDate(header[1], fallbackYear) : null;
    if (header && start) {
      blocks.push({ headerRow: row.rowIndex, label: header[1], start, rows: [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].rows.push(row);
    }
  }

  // Week labels carry no year, so a tab covering one season starts with weeks
  // belonging to the previous year ("Week of Dec 29" above "Week of Jan 5") and
  // can end with weeks belonging to the next. Roll those so the blocks read in
  // the ascending order the sheet is kept in. Only a jump of half a year or
  // more is treated as a year boundary, so a merely mistyped header is left
  // alone rather than being thrown a year off.
  for (let i = 0; i < blocks.length; i++) {
    const neighbour = i === 0 ? blocks[1] : blocks[i - 1];
    if (!neighbour) continue;
    const backwards =
      i === 0
        ? blocks[0].start.getTime() - neighbour.start.getTime()
        : neighbour.start.getTime() - blocks[i].start.getTime();
    if (backwards > 180 * DAY_MS) {
      const shift = i === 0 ? -1 : 1;
      blocks[i].start = new Date(
        blocks[i].start.getFullYear() + shift,
        blocks[i].start.getMonth(),
        blocks[i].start.getDate()
      );
    }
  }

  return blocks;
}

interface DatedRow {
  row: PlanningSheetRow;
  /** True when this row belongs below the event being placed. */
  sortsAfter: boolean;
}

/** Read the rows that carry a usable date, and note the ones that don't. */
function readDatedRows(
  rows: PlanningSheetRow[],
  eventDate: Date,
  eventTimeMinutes: number | null,
  fallbackYear?: number
): { dated: DatedRow[]; unreadableDates: { rowIndex: number; value: string }[] } {
  const unreadableDates: { rowIndex: number; value: string }[] = [];
  const dated: DatedRow[] = [];

  for (const row of rows) {
    const rowDate = parsePlanningSheetDate(row.date, fallbackYear);
    if (!rowDate) {
      // No date means structure — a week header or a spare slot. Text that
      // isn't a readable date is different, and worth reporting.
      if (row.date && row.date.trim()) {
        unreadableDates.push({ rowIndex: row.rowIndex, value: row.date });
      }
      continue;
    }

    // Same-day rows are ordered by start time, falling back to pickup time; a
    // row with no readable time stays above.
    let sortsAfter = rowDate.getTime() > eventDate.getTime();
    if (
      !sortsAfter &&
      rowDate.getTime() === eventDate.getTime() &&
      eventTimeMinutes !== null
    ) {
      const rowTime =
        parsePlanningSheetTime(row.eventStartTime) ??
        parsePlanningSheetTime(row.pickUpTime);
      sortsAfter = rowTime !== null && eventTimeMinutes < rowTime;
    }

    dated.push({ row, sortsAfter });
  }

  return { dated, unreadableDates };
}

/**
 * Choose the split point that the fewest rows argue against: every row above it
 * that belongs below, plus every row below it that belongs above.
 *
 * Trusting one row instead is what made a single mistyped year so damaging — a
 * row typed as 2029 is "later" than everything, so scanning from the top for
 * the first later row stopped there on every push. Counting disagreements lets
 * hundreds of correct rows outvote one bad one.
 */
function chooseSplit(dated: DatedRow[]): { splitAfter: number; conflicts: number } {
  const totalEarlier = dated.filter((d) => !d.sortsAfter).length;
  let laterAbove = 0;
  let earlierAbove = 0;
  let best = { splitAfter: 0, conflicts: totalEarlier };

  for (let i = 0; i < dated.length; i++) {
    if (dated[i].sortsAfter) laterAbove++;
    else earlierAbove++;
    const conflicts = laterAbove + (totalEarlier - earlierAbove);
    // <= so that a tie resolves downward, below the rows it ties with.
    if (conflicts <= best.conflicts) best = { splitAfter: i + 1, conflicts };
  }

  return best;
}

/** The rows that disagree with the chosen split — usually a mistyped year. */
function conflictingRows(dated: DatedRow[], splitAfter: number) {
  return dated
    .filter((d, i) => (i < splitAfter ? d.sortsAfter : !d.sortsAfter))
    .map((d) => ({ rowIndex: d.row.rowIndex, date: d.row.date }));
}

/**
 * The nearest real event row to copy formatting from: the closest one above the
 * insertion point, or the closest below when the row is going in at the top.
 */
function formatModelRow(dated: DatedRow[], target: number): number | null {
  let above: number | null = null;
  let below: number | null = null;
  for (const { row } of dated) {
    if (row.rowIndex < target) above = row.rowIndex;
    else if (below === null) below = row.rowIndex;
  }
  return above ?? below;
}

function describeRow(row: PlanningSheetRow) {
  return `${row.date} ${row.groupName}`.trim();
}

/**
 * Work out where a new row belongs so the sheet stays readable as a calendar.
 *
 * The sheet is grouped into weeks: a row reading "Week of Sep 7" opens each
 * week, its events follow in date order, and spare slots sit beneath them. So
 * the job is to find the week the event belongs to and order it within that
 * week — not to scan the whole sheet for a neighbouring date. Scanning is what
 * puts the first event of a week above its own header, at the foot of the
 * previous week, and the last event of a week below the next header.
 *
 * Sheets with no week headers fall back to plain date order.
 */
export function computeSheetPlacement(
  rows: PlanningSheetRow[],
  eventDate: Date,
  options: { eventTime?: string | null; fallbackYear?: number } = {}
): SheetPlacement {
  const { eventTime = null, fallbackYear } = options;
  const eventTimeMinutes =
    typeof eventTime === 'string' ? parsePlanningSheetTime(eventTime) : null;

  // Reported sheet-wide, so a bad cell anywhere still gets surfaced even when
  // placement only needed to look at one week.
  const { dated: allDated, unreadableDates } = readDatedRows(
    rows,
    eventDate,
    eventTimeMinutes,
    fallbackYear
  );

  const lastDated = allDated[allDated.length - 1]?.row ?? null;
  const shared = {
    totalRows: rows.length,
    datedRows: allDated.length,
    unreadableDates,
    lastDatedRow: lastDated
      ? { rowIndex: lastDated.rowIndex, date: lastDated.date }
      : null,
  };

  // Only used where unreadable cells actually explain the outcome. Reporting
  // them on every push was noise: the sheet repeats its column headings
  // part-way down, and dates that aren't settled yet are written as "TBD".
  const unreadableSuffix = unreadableDates.length
    ? ` ${unreadableDates.length} row(s) have a date cell that could not be read (e.g. row ${unreadableDates[0].rowIndex}: "${unreadableDates[0].value}").`
    : '';

  const blocks = parseWeekBlocks(rows, fallbackYear);
  const lastSheetRow = rows[rows.length - 1]?.rowIndex ?? 0;

  if (blocks.length > 0) {
    // The week the event belongs to: the last one starting on or before it.
    let block: WeekBlock | null = null;
    for (const candidate of blocks) {
      if (
        candidate.start.getTime() <= eventDate.getTime() &&
        (!block || candidate.start.getTime() >= block.start.getTime())
      ) {
        block = candidate;
      }
    }

    if (!block) {
      const first = blocks[0];
      return {
        ...shared,
        insertBeforeRow: first.headerRow,
        reason: 'insert_before_first_week_block',
        formatFromRow: formatModelRow(allDated, first.headerRow),
        note: `Inserting at row ${first.headerRow}, above "Week of ${first.label}" — this event is dated before the first week in the sheet.`,
        outOfOrderRows: [],
        weekBlock: null,
      };
    }

    const weekBlock = { headerRow: block.headerRow, label: block.label };
    const following = blocks.find((b) => b.headerRow > block!.headerRow) ?? null;

    const { dated } = readDatedRows(
      block.rows,
      eventDate,
      eventTimeMinutes,
      fallbackYear
    );
    const { splitAfter } = chooseSplit(dated);
    const outOfOrderRows = conflictingRows(dated, splitAfter);
    const disorderSuffix = outOfOrderRows.length
      ? ` Heads up: ${outOfOrderRows.length} row(s) in this week are dated on the wrong side of this position — check row ${outOfOrderRows[0].rowIndex} ("${outOfOrderRows[0].date}"). A mistyped year there pulls events out of place.`
      : '';

    const anchor = splitAfter > 0 ? dated[splitAfter - 1].row : null;
    let target: number;
    let position: string;

    if (anchor) {
      target = anchor.rowIndex + 1;
      position = `directly after "${describeRow(anchor)}"`;
    } else if (dated.length > 0) {
      target = dated[0].row.rowIndex;
      position = `at the top of that week, ahead of "${describeRow(dated[0].row)}"`;
    } else {
      target = block.headerRow + 1;
      position = 'as the first event of that week';
    }

    if (!following && target > lastSheetRow) {
      return {
        ...shared,
        insertBeforeRow: null,
        reason: 'append_event_is_latest',
        formatFromRow: formatModelRow(allDated, lastSheetRow + 1),
        note: `Appending to the end: this event is later than every row in the sheet, in the last week it covers ("Week of ${block.label}").${disorderSuffix}`,
        outOfOrderRows,
        weekBlock,
      };
    }

    return {
      ...shared,
      insertBeforeRow: target,
      reason: 'insert_in_week_block',
      // Prefer a row from this same week, so anything the team formats per
      // week carries over; otherwise the nearest event row anywhere.
      formatFromRow: formatModelRow(dated, target) ?? formatModelRow(allDated, target),
      note: `Inserting at row ${target}, in the "Week of ${block.label}" block, ${position}.${disorderSuffix}`,
      outOfOrderRows,
      weekBlock,
    };
  }

  // ---- No week headers: fall back to plain date order across the sheet. ----

  if (allDated.length === 0) {
    return {
      ...shared,
      insertBeforeRow: null,
      reason: 'append_no_dated_rows',
      formatFromRow: null,
      note: `Appending to the end: none of the ${rows.length} rows read back with a usable date.${unreadableSuffix}`,
      outOfOrderRows: [],
      weekBlock: null,
    };
  }

  const { splitAfter } = chooseSplit(allDated);
  const outOfOrderRows = conflictingRows(allDated, splitAfter);
  const disorderSuffix = outOfOrderRows.length
    ? ` Heads up: ${outOfOrderRows.length} row(s) are dated on the wrong side of this position — check row ${outOfOrderRows[0].rowIndex} ("${outOfOrderRows[0].date}"). A mistyped year there pulls pushed events out of place.`
    : '';

  const anchor = splitAfter > 0 ? allDated[splitAfter - 1].row : null;
  const following = splitAfter < allDated.length ? allDated[splitAfter].row : null;

  if (!anchor) {
    return {
      ...shared,
      insertBeforeRow: following!.rowIndex,
      reason: 'insert_before_later_event',
      formatFromRow: formatModelRow(allDated, following!.rowIndex),
      note: `Inserting at row ${following!.rowIndex}, ahead of "${describeRow(following!)}" — nothing in the sheet is dated earlier.${disorderSuffix}${unreadableSuffix}`,
      outOfOrderRows,
      weekBlock: null,
    };
  }

  if (!following && anchor.rowIndex === lastSheetRow) {
    return {
      ...shared,
      insertBeforeRow: null,
      reason: 'append_event_is_latest',
      formatFromRow: formatModelRow(allDated, lastSheetRow + 1),
      note: `Appending to the end: this event is later than every row in the sheet (the last one is ${anchor.date}, row ${anchor.rowIndex}).${disorderSuffix}${unreadableSuffix}`,
      outOfOrderRows,
      weekBlock: null,
    };
  }

  const target = anchor.rowIndex + 1;
  const closingRows = following ? following.rowIndex - target : 0;

  return {
    ...shared,
    insertBeforeRow: target,
    reason: 'insert_after_previous_event',
    formatFromRow: formatModelRow(allDated, target),
    note: `Inserting at row ${target}, directly after "${describeRow(anchor)}".${
      closingRows > 0
        ? ` That keeps it above the ${closingRows} row(s) that follow before the next event.`
        : ''
    }${disorderSuffix}${unreadableSuffix}`,
    outOfOrderRows,
    weekBlock: null,
  };
}

/**
 * Planning Sheet Sync Service
 * Handles reading from and proposing changes to the Planning/Schedule Google Sheet
 *
 * IMPORTANT: This is SEPARATE from the Squarespace form responses sync.
 * This syncs with the team's planning sheet where scheduled events are tracked.
 */
export class PlanningSheetSyncService {
  private auth!: JWT;
  private sheets: any;
  private spreadsheetId: string;
  private worksheetName: string;

  constructor(spreadsheetId: string, worksheetName: string = 'Schedule') {
    this.spreadsheetId = spreadsheetId;
    this.worksheetName = worksheetName;
  }

  private getSheetRange(a1Range: string) {
    const safeSheetName = this.worksheetName.replace(/'/g, "''");
    return `'${safeSheetName}'!${a1Range}`;
  }

  private async ensureInitialized() {
    if (!this.sheets) {
      await this.initializeAuth();
    }
  }

  private async initializeAuth() {
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
    if (!rawPrivateKey || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      throw new Error('Google Sheets credentials not configured');
    }

    // Handle escaped newlines in private key
    let cleanPrivateKey = rawPrivateKey;
    if (cleanPrivateKey.includes('\\n')) {
      cleanPrivateKey = cleanPrivateKey.replace(/\\n/g, '\n');
    }
    cleanPrivateKey = cleanPrivateKey
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Handle single-line key format
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
   * Read all rows from the Planning Sheet
   */
  async readPlanningSheet(): Promise<PlanningSheetRow[]> {
    await this.ensureInitialized();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: this.getSheetRange(`A2:${PLANNING_SHEET_LAST_COLUMN}`), // Skip header row
    });

    const rows = response.data.values || [];
    logger.log(`Read ${rows.length} rows from Planning Sheet`);

    return rows.map((row: string[], index: number) => {
      const staffingStr = row[PLANNING_SHEET_COLUMNS.STAFFING] || '';
      return {
        rowIndex: index + 2, // +2 because we start at A2 and arrays are 0-indexed
        date: row[PLANNING_SHEET_COLUMNS.DATE] || '',
        dayOfWeek: row[PLANNING_SHEET_COLUMNS.DAY_OF_WEEK] || '',
        groupName: row[PLANNING_SHEET_COLUMNS.GROUP_NAME] || '',
        eventStartTime: row[PLANNING_SHEET_COLUMNS.EVENT_START_TIME] || '',
        eventEndTime: row[PLANNING_SHEET_COLUMNS.EVENT_END_TIME] || '',
        pickUpTime: row[PLANNING_SHEET_COLUMNS.PICK_UP_TIME] || '',
        pickUpNextDay: row[PLANNING_SHEET_COLUMNS.PICK_UP_NEXT_DAY] || '',
        allDetails: row[PLANNING_SHEET_COLUMNS.ALL_DETAILS] || '',
        vanBooked: row[PLANNING_SHEET_COLUMNS.VAN_BOOKED] || '',
        vanNeededFor: row[PLANNING_SHEET_COLUMNS.VAN_NEEDED_FOR] || '',
        staffing: staffingStr,
        staffingParsed: parseStaffingColumn(staffingStr),
        estimateSandwiches: row[PLANNING_SHEET_COLUMNS.ESTIMATE_SANDWICHES] || '',
        deliOrPbj: row[PLANNING_SHEET_COLUMNS.DELI_OR_PBJ] || '',
        finalSandwiches: row[PLANNING_SHEET_COLUMNS.FINAL_SANDWICHES] || '',
        totalInApp: row[PLANNING_SHEET_COLUMNS.TOTAL_IN_APP] || '',
        followUpEmailSent: row[PLANNING_SHEET_COLUMNS.FOLLOW_UP_EMAIL_SENT] || '',
        sentToolkit: row[PLANNING_SHEET_COLUMNS.SENT_TOOLKIT] || '',
        contactName: row[PLANNING_SHEET_COLUMNS.CONTACT_NAME] || '',
        email: row[PLANNING_SHEET_COLUMNS.EMAIL] || '',
        phone: row[PLANNING_SHEET_COLUMNS.PHONE] || '',
        tspContact: row[PLANNING_SHEET_COLUMNS.TSP_CONTACT] || '',
        address: row[PLANNING_SHEET_COLUMNS.ADDRESS] || '',
        recipientHost: row[PLANNING_SHEET_COLUMNS.RECIPIENT_HOST] || '',
        afterEventNotes: row[PLANNING_SHEET_COLUMNS.AFTER_EVENT_NOTES] || '',
        cancelled: row[PLANNING_SHEET_COLUMNS.CANCELLED] || '',
        notes: row[PLANNING_SHEET_COLUMNS.NOTES] || '',
        syncId: row[PLANNING_SHEET_COLUMNS.SYNC_ID] || '',
        unlabeledAB: row[PLANNING_SHEET_COLUMNS.UNLABELED_AB] || '',
      };
    });
  }

  /**
   * Convert an EventRequest from the app into Planning Sheet row format
   */
  async eventToSheetRow(eventId: number): Promise<string[] | null> {
    const event = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event || event.length === 0) {
      return null;
    }

    const e = event[0];

    // Get assigned driver/speaker/volunteer names
    const driverNames = await this.getAssignedNames(e.assignedDriverIds || []);
    const speakerNames = await this.getAssignedNames(e.assignedSpeakerIds || []);
    const volunteerNames = await this.getAssignedNames(e.assignedVolunteerIds || []);

    // Resolve TSP contact - either customTspContact (free text) or
    // tspContact (user ID). The planning sheet TSP Contact column only
    // holds first names by convention (the team recognizes Katie/Kim/
    // Christine etc.), so strip everything after the first whitespace.
    // This is intentionally simple: "Kim Long" → "Kim", "Katie" → "Katie",
    // "Kim L." → "Kim". If someone has a two-word first name we'd lose
    // the second word, but that hasn't come up and the sheet convention
    // is single token.
    const toFirstName = (raw: string): string => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return '';
      return trimmed.split(/\s+/)[0];
    };
    let tspContactName = '';
    if (e.customTspContact) {
      tspContactName = toFirstName(e.customTspContact);
    } else if (e.tspContact) {
      const names = await this.getAssignedNames([e.tspContact]);
      tspContactName = toFirstName(names[0] || e.tspContact);
    }

    // Build staffing string
    const staffing: StaffingInfo = {
      driver: {
        needed: (e.driversNeeded || 0) > 0 || driverNames.length > 0,
        assigned: driverNames.length > 0 ? driverNames.join(', ') : null,
        isVanDriver: e.vanDriverNeeded || false,
      },
      speaker: {
        needed: (e.speakersNeeded || 0) > 0 || speakerNames.length > 0,
        assigned: speakerNames.length > 0 ? speakerNames.join(', ') : null,
      },
      volunteer: {
        needed: (e.volunteersNeeded || 0) > 0 || volunteerNames.length > 0,
        assigned: volunteerNames.length > 0 ? volunteerNames.join(', ') : null,
      },
    };

    // Format date with 2-digit year (M/D/YY)
    const eventDate = getEffectiveEventDate(e);
    const eventDateObj = eventDate ? new Date(eventDate) : null;
    const dateStr = eventDateObj ? eventDateObj.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    }) : '';

    const dayOfWeek = eventDateObj ? eventDateObj.toLocaleDateString('en-US', {
      weekday: 'long'
    }) : '';

    // Convert military time (e.g., "14:00" or "14:00:00") to 12-hour format (e.g., "2:00 PM")
    const formatTime12Hour = (timeStr: string | null | undefined): string => {
      if (!timeStr) return '';
      // Handle HH:MM or HH:MM:SS format
      const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (!match) return timeStr; // Return as-is if not recognized format

      let hours = parseInt(match[1], 10);
      const minutes = match[2];
      const ampm = hours >= 12 ? 'PM' : 'AM';

      if (hours === 0) {
        hours = 12;
      } else if (hours > 12) {
        hours -= 12;
      }

      return `${hours}:${minutes} ${ampm}`;
    };

    // Format sandwich types for the planning sheet using the canonical
    // user-facing label from constants.ts SANDWICH_TYPES. The raw stored
    // values include "deli_turkey" and "deli_ham" (because turkey/ham
    // are deli sub-types in our taxonomy), but the planning sheet
    // column has conditional formatting that expects the bare label —
    // "Turkey", "Ham", "Deli", "PBJ" — not "Deli_turkey" or "Deli,
    // Turkey". Map raw → label explicitly.
    const sandwichTypes = e.sandwichTypes as Array<{ type: string; quantity?: number }> | null;
    const SANDWICH_TYPE_LABELS: Record<string, string> = {
      pbj: 'PBJ',
      'pb&j': 'PBJ',
      deli: 'Deli',
      deli_turkey: 'Turkey',
      turkey: 'Turkey',
      deli_ham: 'Ham',
      ham: 'Ham',
      chicken: 'Chicken',
      unknown: '',
    };
    const formatSandwichType = (type: string): string => {
      const lower = (type || '').toLowerCase();
      if (lower in SANDWICH_TYPE_LABELS) return SANDWICH_TYPE_LABELS[lower];
      // Fallback for any unknown future type: capitalize first letter.
      return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    };
    // Dedupe so an event tagged with both "deli" and "deli_turkey"
    // doesn't render "Deli, Turkey" — pick the more specific label and
    // drop the empties.
    const deliOrPbj = sandwichTypes
      ? Array.from(
          new Set(
            sandwichTypes
              .map((st) => formatSandwichType(st.type))
              .filter((label) => label.length > 0),
          ),
        ).join(', ')
      : '';

    // Build the row array matching column order
    const row: string[] = new Array(PLANNING_SHEET_COLUMN_COUNT).fill('');
    row[PLANNING_SHEET_COLUMNS.DATE] = dateStr;
    row[PLANNING_SHEET_COLUMNS.DAY_OF_WEEK] = dayOfWeek;
    row[PLANNING_SHEET_COLUMNS.GROUP_NAME] = e.organizationName || '';
    row[PLANNING_SHEET_COLUMNS.EVENT_START_TIME] = formatTime12Hour(e.eventStartTime);
    row[PLANNING_SHEET_COLUMNS.EVENT_END_TIME] = formatTime12Hour(e.eventEndTime);
    row[PLANNING_SHEET_COLUMNS.PICK_UP_TIME] = formatTime12Hour(e.pickupTime);
    row[PLANNING_SHEET_COLUMNS.PICK_UP_NEXT_DAY] = e.overnightHoldingLocation ? 'Yes' : '';
    row[PLANNING_SHEET_COLUMNS.ALL_DETAILS] = e.message || '';
    row[PLANNING_SHEET_COLUMNS.VAN_BOOKED] = e.vanDriverNeeded ? 'Yes' : '';
    row[PLANNING_SHEET_COLUMNS.VAN_NEEDED_FOR] = formatVanNeededForCell(e.vanNeededFor);
    row[PLANNING_SHEET_COLUMNS.STAFFING] = formatStaffingColumn(staffing);
    row[PLANNING_SHEET_COLUMNS.ESTIMATE_SANDWICHES] = e.estimatedSandwichCount?.toString() || '';
    row[PLANNING_SHEET_COLUMNS.DELI_OR_PBJ] = deliOrPbj;
    // Final sandwich count written to the sheet is intentionally the event's
    // own actualSandwichCount reference field — NOT a total derived from the
    // sandwich_collections log. In this org's workflow that field is a manual,
    // for-reference-only number that does NOT feed the official sandwich count;
    // official totals live solely in sandwich_collections. Whatever number is
    // in the app here is meant to overrule the sheet on push. Do not "fix" this
    // to compute from sandwich_collections — that would risk corrupting the
    // official count records. Only show it if it's a positive number.
    row[PLANNING_SHEET_COLUMNS.FINAL_SANDWICHES] = (e.actualSandwichCount && e.actualSandwichCount > 0) ? e.actualSandwichCount.toString() : '';
    // P is now "Follow-up email sent" (sheet-owned), so the app writes nothing there.
    row[PLANNING_SHEET_COLUMNS.SENT_TOOLKIT] = e.toolkitSent ? 'Yes' : '';
    row[PLANNING_SHEET_COLUMNS.CONTACT_NAME] = `${e.firstName || ''} ${e.lastName || ''}`.trim();
    row[PLANNING_SHEET_COLUMNS.EMAIL] = e.email || '';
    row[PLANNING_SHEET_COLUMNS.PHONE] = e.phone || '';
    row[PLANNING_SHEET_COLUMNS.TSP_CONTACT] = tspContactName;
    row[PLANNING_SHEET_COLUMNS.ADDRESS] = e.eventAddress || '';
    row[PLANNING_SHEET_COLUMNS.RECIPIENT_HOST] = e.deliveryDestination || '';
    row[PLANNING_SHEET_COLUMNS.AFTER_EVENT_NOTES] = e.followUpNotes || '';
    row[PLANNING_SHEET_COLUMNS.CANCELLED] = e.status === 'cancelled' ? 'Yes' : '';
    row[PLANNING_SHEET_COLUMNS.NOTES] = '';
    // AA (sync_id) and AB (unlabeled) are sheet-owned: left blank here, and
    // an existing row keeps the sheet's values (pushEventDirectly).

    return row;
  }

  /**
   * Get display names for assigned user IDs
   */
  private async getAssignedNames(userIds: string[]): Promise<string[]> {
    if (!userIds || userIds.length === 0) return [];

    const userList = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));

    // Create a map of user IDs to names
    const userMap = new Map(
      userList.map(u => [
        u.id,
        u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown'
      ])
    );

    // Return names in the same order as userIds. Assignment columns also hold
    // free-text names (people typed on the sheet who don't match one app user);
    // write those back as typed so they survive the round trip. Only something
    // that looks like a user ID with no matching user becomes "Unknown".
    return userIds.map(id => userMap.get(id) || assignmentLabelForUnknownId(id));
  }

  /**
   * Propose adding a new row to the Planning Sheet
   * Does NOT write to the sheet - creates a proposal for human review
   */
  async proposeNewRow(
    eventId: number,
    proposedBy: string,
    reason: string = 'Event scheduled'
  ): Promise<{ success: boolean; proposalId?: number; message: string }> {
    try {
      const rowData = await this.eventToSheetRow(eventId);
      if (!rowData) {
        return { success: false, message: 'Event not found' };
      }

      // Create the proposal
      const [proposal] = await db
        .insert(proposedSheetChanges)
        .values({
          eventRequestId: eventId,
          targetSheetId: this.spreadsheetId,
          targetSheetName: this.worksheetName,
          targetRowIndex: null, // New row, no existing index
          changeType: 'create_row',
          proposedRowData: rowData,
          proposedBy,
          proposalReason: reason,
          status: 'pending',
          columnMapping: PLANNING_SHEET_COLUMNS,
        })
        .returning({ id: proposedSheetChanges.id });

      logger.log(`Created proposal ${proposal.id} for new row in Planning Sheet`);
      return {
        success: true,
        proposalId: proposal.id,
        message: 'Proposed new row for review'
      };
    } catch (error) {
      logger.error('Error creating new row proposal:', error);
      return {
        success: false,
        message: `Failed to create proposal: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Propose updating a specific cell in the Planning Sheet
   * Does NOT write to the sheet - creates a proposal for human review
   */
  async proposeCellUpdate(
    eventId: number,
    rowIndex: number,
    fieldName: string,
    currentValue: string,
    proposedValue: string,
    proposedBy: string,
    reason: string
  ): Promise<{ success: boolean; proposalId?: number; message: string }> {
    try {
      const [proposal] = await db
        .insert(proposedSheetChanges)
        .values({
          eventRequestId: eventId,
          targetSheetId: this.spreadsheetId,
          targetSheetName: this.worksheetName,
          targetRowIndex: rowIndex,
          changeType: 'update_cell',
          fieldName,
          currentValue,
          proposedValue,
          proposedBy,
          proposalReason: reason,
          status: 'pending',
          columnMapping: PLANNING_SHEET_COLUMNS,
        })
        .returning({ id: proposedSheetChanges.id });

      logger.log(`Created proposal ${proposal.id} for cell update at row ${rowIndex}, field ${fieldName}`);
      return {
        success: true,
        proposalId: proposal.id,
        message: 'Proposed cell update for review'
      };
    } catch (error) {
      logger.error('Error creating cell update proposal:', error);
      return {
        success: false,
        message: `Failed to create proposal: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get all pending proposals
   */
  async getPendingProposals(): Promise<any[]> {
    return db
      .select()
      .from(proposedSheetChanges)
      .where(eq(proposedSheetChanges.status, 'pending'))
      .orderBy(desc(proposedSheetChanges.proposedAt));
  }

  /**
   * Apply an approved proposal to the sheet
   * This is the ONLY function that actually writes to Google Sheets
   */
  async applyApprovedProposal(
    proposalId: number,
    reviewedBy: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.ensureInitialized();

      // Get the proposal
      const [proposal] = await db
        .select()
        .from(proposedSheetChanges)
        .where(eq(proposedSheetChanges.id, proposalId))
        .limit(1);

      if (!proposal) {
        return { success: false, message: 'Proposal not found' };
      }

      if (proposal.status !== 'pending' && proposal.status !== 'approved') {
        return { success: false, message: `Cannot apply proposal with status: ${proposal.status}` };
      }

      // Mark as approved first
      await db
        .update(proposedSheetChanges)
        .set({
          status: 'approved',
          reviewedBy,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(proposedSheetChanges.id, proposalId));

      // Apply the change based on type
      let result: { success: boolean; message: string };

      if (proposal.changeType === 'create_row') {
        result = await this.applyNewRow(proposal);
      } else if (proposal.changeType === 'update_cell') {
        result = await this.applyCellUpdate(proposal);
      } else {
        result = { success: false, message: `Unknown change type: ${proposal.changeType}` };
      }

      // Update proposal status based on result
      await db
        .update(proposedSheetChanges)
        .set({
          status: result.success ? 'applied' : 'failed',
          appliedAt: result.success ? new Date() : null,
          applyError: result.success ? null : result.message,
          updatedAt: new Date(),
        })
        .where(eq(proposedSheetChanges.id, proposalId));

      return result;
    } catch (error) {
      logger.error('Error applying approved proposal:', error);

      // Mark as failed
      await db
        .update(proposedSheetChanges)
        .set({
          status: 'failed',
          applyError: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(proposedSheetChanges.id, proposalId));

      return {
        success: false,
        message: `Failed to apply: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Apply a new row to the sheet, in date order like the manual push does.
   * (This path used to append unconditionally, which dropped every approved
   * proposal at the bottom of the sheet regardless of its date.)
   */
  private async applyNewRow(proposal: any): Promise<{ success: boolean; message: string }> {
    const originalRow = proposal.proposedRowData as string[];
    const migrated = migrateProposedPlanningRow(originalRow);
    if (!migrated || !Array.isArray(migrated)) {
      return { success: false, message: 'Invalid row data in proposal' };
    }
    // Proposals queued before the sheet-owned columns existed still carry the
    // old Social Post (P) / Waiting On (AB) values. A new row never writes
    // sheet-owned cells, whenever the proposal was made.
    const rowData = blankSheetOwnedColumns(migrated);
    if (originalRow && rowData.length !== originalRow.length) {
      try {
        await db
          .update(proposedSheetChanges)
          .set({ proposedRowData: rowData, updatedAt: new Date() })
          .where(eq(proposedSheetChanges.id, proposal.id));
      } catch (error) {
        logger.warn(
          `Could not persist migrated proposal row for ${proposal.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const rowDate = this.parseSheetDate(rowData[PLANNING_SHEET_COLUMNS.DATE] || '');
    const placement = rowDate
      ? await this.findPlacement(
          rowDate,
          // Same fallback the direct push uses, so both paths order same-day
          // rows the same way.
          rowData[PLANNING_SHEET_COLUMNS.EVENT_START_TIME] ||
            rowData[PLANNING_SHEET_COLUMNS.PICK_UP_TIME] ||
            null
        )
      : null;

    if (
      placement?.insertBeforeRow != null &&
      (await this.insertRowAt(
        placement.insertBeforeRow,
        rowData,
        placement.formatFromRow
      ))
    ) {
      logger.info(
        `Applied new row to Planning Sheet for proposal ${proposal.id} at row ${placement.insertBeforeRow}`
      );
      return {
        success: true,
        message: `Row added at row ${placement.insertBeforeRow} (sorted by date)`,
      };
    }

    const newRowIndex = await this.appendRow(rowData, placement?.formatFromRow ?? null);
    logger.info(
      `Applied new row to Planning Sheet for proposal ${proposal.id} at row ${newRowIndex} (appended)`
    );
    return { success: true, message: 'Row added successfully' };
  }

  /**
   * Inserting a row pushes everything below it down by one, which leaves any
   * proposal still waiting to be applied pointing at the row above the one it
   * meant. Nudge those stored indexes along with the sheet.
   *
   * This only matters because new rows are inserted in date order — appending
   * to the bottom never moved an existing row.
   */
  private async shiftPendingProposalRows(insertedAt: number): Promise<void> {
    try {
      const shifted = await db
        .update(proposedSheetChanges)
        .set({
          targetRowIndex: sql`${proposedSheetChanges.targetRowIndex} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(proposedSheetChanges.targetSheetId, this.spreadsheetId),
            eq(proposedSheetChanges.targetSheetName, this.worksheetName),
            inArray(proposedSheetChanges.status, ['pending', 'approved']),
            gte(proposedSheetChanges.targetRowIndex, insertedAt)
          )
        )
        .returning({ id: proposedSheetChanges.id });

      if (shifted.length > 0) {
        logger.info(
          `[PlanningSheet] Inserting at row ${insertedAt} moved ${shifted.length} pending proposal(s) down a row: ${shifted
            .map((s) => s.id)
            .join(', ')}`
        );
      }
    } catch (error) {
      // The row is already in the sheet at this point, so a bookkeeping failure
      // must not fail the apply — but it does need to be visible, because the
      // affected proposals now point one row too high.
      logger.error(
        `[PlanningSheet] Could not re-point pending proposals after inserting at row ${insertedAt}. Any pending cell update below that row now targets the wrong row.`,
        error
      );
    }
  }

  /**
   * Apply a cell update to the sheet
   */
  private async applyCellUpdate(proposal: any): Promise<{ success: boolean; message: string }> {
    if (!proposal.targetRowIndex || !proposal.fieldName) {
      return { success: false, message: 'Missing row index or field name' };
    }

    // Get column letter from field name
    const columnIndex = PLANNING_SHEET_COLUMNS[proposal.fieldName as keyof typeof PLANNING_SHEET_COLUMNS];
    if (columnIndex === undefined) {
      return { success: false, message: `Unknown field: ${proposal.fieldName}` };
    }
    if (SHEET_OWNED_COLUMNS.includes(columnIndex)) {
      return { success: false, message: `${proposal.fieldName} is maintained on the sheet; the app doesn't write it` };
    }

    // Convert 0-based column index → spreadsheet letter (A, B, ..., Z, AA, AB, ...).
    const columnLetter = planningSheetColumnLetter(columnIndex);
    const range = this.getSheetRange(`${columnLetter}${proposal.targetRowIndex}`);

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[proposal.proposedValue]] },
    });

    logger.log(`Applied cell update to ${range} for proposal ${proposal.id}`);
    return { success: true, message: `Updated ${proposal.fieldName} at row ${proposal.targetRowIndex}` };
  }

  /**
   * Reject a proposal
   */
  async rejectProposal(
    proposalId: number,
    reviewedBy: string,
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await db
        .update(proposedSheetChanges)
        .set({
          status: 'rejected',
          reviewedBy,
          reviewedAt: new Date(),
          reviewNotes: notes,
          updatedAt: new Date(),
        })
        .where(eq(proposedSheetChanges.id, proposalId));

      return { success: true, message: 'Proposal rejected' };
    } catch (error) {
      return {
        success: false,
        message: `Failed to reject: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * The year this worksheet covers, taken from its name ("2026 Groups").
   * Date cells in the sheet often omit the year because the tab carries it.
   */
  private sheetYearHint(): number | undefined {
    const match = this.worksheetName.match(/(20\d{2})/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private parseSheetDate(dateStr: string): Date | null {
    return parsePlanningSheetDate(dateStr, this.sheetYearHint());
  }

  private parseTimeToMinutes(timeStr: string): number | null {
    return parsePlanningSheetTime(timeStr);
  }

  /**
   * Work out where a new row for this event belongs in the sheet.
   *
   * The outcome is logged at a level that survives production (the debug
   * `logger.log` used previously is compiled out when NODE_ENV=production, so
   * a wrong placement left no trace at all), and returned to the caller so the
   * push preview and result can say where the row went and why.
   */
  async findPlacement(
    eventDate: Date,
    eventTimeStr?: string | null,
    /** Rows already read by the caller, to avoid re-reading the sheet. */
    knownRows?: PlanningSheetRow[]
  ): Promise<SheetPlacement> {
    const sheetRows = knownRows ?? (await this.readPlanningSheet());
    const placement = computeSheetPlacement(sheetRows, eventDate, {
      eventTime: eventTimeStr,
      fallbackYear: this.sheetYearHint(),
    });

    const context = `[PlanningSheet] Placing event dated ${eventDate.toDateString()}${
      eventTimeStr ? ` at ${eventTimeStr}` : ''
    } among ${placement.totalRows} rows (${placement.datedRows} dated): ${placement.note}`;

    if (placement.insertBeforeRow === null) {
      logger.warn(context);
    } else {
      logger.info(context);
    }

    // Logged separately rather than in the note, which is shown to whoever is
    // pushing. Repeated column headings and "TBD" dates are normal here, so
    // they are noise in the UI but still worth keeping for diagnostics.
    if (placement.unreadableDates.length > 0) {
      logger.info(
        `[PlanningSheet] ${placement.unreadableDates.length} date cell(s) could not be read: ${placement.unreadableDates
          .map((u) => `row ${u.rowIndex} "${u.value}"`)
          .join(', ')}`
      );
    }

    if (placement.outOfOrderRows.length > 0) {
      logger.warn(
        `[PlanningSheet] ${placement.outOfOrderRows.length} row(s) are dated on the wrong side of row ${placement.insertBeforeRow ?? 'the end'}: ${placement.outOfOrderRows
          .map((o) => `row ${o.rowIndex} "${o.date}"`)
          .join(', ')}`
      );
    }

    return placement;
  }

  /**
   * The date and time an event should be sorted by in the sheet. The date is
   * normalized to midnight so it compares against the sheet's date-only cells.
   */
  private placementInputsFor(event: { scheduledEventDate?: Date | null; desiredEventDate?: Date | null; eventStartTime?: string | null; pickupTime?: string | null; pickupDateTime?: string | null }): { date: Date; time: string | null } {
    const eventDate = getEffectiveEventDate(event);
    const raw = eventDate ? new Date(eventDate) : new Date();
    return {
      date: new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()),
      // pickupTime first, since that is what gets written to the sheet's pickup
      // column and therefore what same-day rows are compared against.
      time: event.eventStartTime || event.pickupTime || event.pickupDateTime || null,
    };
  }

  /**
   * Where a push would place this event, without writing anything. Used by the
   * push preview so the team can see the target row before committing.
   */
  async previewPlacement(
    eventId: number,
    knownRows?: PlanningSheetRow[]
  ): Promise<SheetPlacement | null> {
    await this.ensureInitialized();

    const [event] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);
    if (!event) return null;

    const { date, time } = this.placementInputsFor(event);
    return this.findPlacement(date, time, knownRows);
  }

  /**
   * Get the worksheet/sheet ID (gid) for the current worksheet name
   */
  private async getWorksheetId(): Promise<number | null> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheets = response.data.sheets || [];
      for (const sheet of sheets) {
        if (sheet.properties?.title === this.worksheetName) {
          return sheet.properties.sheetId ?? null;
        }
      }
      return null;
    } catch (error) {
      logger.error('[PlanningSheet] Error getting worksheet ID:', error);
      return null;
    }
  }

  /**
   * Append a row after the last row of the sheet. Returns the row number it
   * landed on, when the API reports one.
   */
  private async appendRow(
    rowData: string[],
    formatFromRow?: number | null
  ): Promise<number | undefined> {
    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: this.getSheetRange(`A:${PLANNING_SHEET_LAST_COLUMN}`),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [rowData] },
    });

    const updatedRange = response.data.updates?.updatedRange || '';
    const rowMatch = updatedRange.match(/(\d+)$/);
    const newRowIndex = rowMatch ? parseInt(rowMatch[1], 10) : undefined;

    // The bottom of the sheet can be a trailing week header with no events
    // under it yet, and an appended row takes on whatever formatting is already
    // there. Give it an event row's look instead.
    //
    // Best-effort on purpose: the row is already committed by the append above,
    // so a transient failure here must not be reported as a failed push. That
    // would leave the event unmarked in the app — inviting a duplicate row on
    // retry — or strand an approved proposal as 'failed' after it had applied.
    // Wrong formatting on one row is a far smaller problem than either.
    if (newRowIndex && formatFromRow && formatFromRow !== newRowIndex) {
      try {
        await this.copyRowFormat(formatFromRow, newRowIndex);
      } catch (error) {
        logger.warn(
          `[PlanningSheet] Row ${newRowIndex} was appended but could not be given event-row formatting from row ${formatFromRow}. The row is in the sheet and may need restyling by hand.`,
          error
        );
      }
    }

    return newRowIndex;
  }

  /** Copy one row's formatting onto another, leaving its values alone. */
  private async copyRowFormat(sourceRow: number, destinationRow: number): Promise<void> {
    const sheetId = await this.getWorksheetId();
    if (sheetId === null) return;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        requests: [
          {
            copyPaste: {
              source: {
                sheetId,
                startRowIndex: sourceRow - 1,
                endRowIndex: sourceRow,
                startColumnIndex: 0,
                endColumnIndex: PLANNING_SHEET_COLUMN_COUNT,
              },
              destination: {
                sheetId,
                startRowIndex: destinationRow - 1,
                endRowIndex: destinationRow,
                startColumnIndex: 0,
                endColumnIndex: PLANNING_SHEET_COLUMN_COUNT,
              },
              pasteType: 'PASTE_FORMAT',
            },
          },
        ],
      },
    });
  }

  /**
   * Insert a blank row at `rowIndex` (pushing everything below it down) and
   * write the row data into it. Returns false when the worksheet can't be
   * identified, in which case nothing was written.
   */
  private async insertRowAt(
    rowIndex: number,
    rowData: string[],
    formatFromRow?: number | null
  ): Promise<boolean> {
    const sheetId = await this.getWorksheetId();
    if (sheetId === null) return false;

    const requests: any[] = [
      {
        insertDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // 0-indexed
            endIndex: rowIndex, // Insert 1 row
          },
          // Of the two neighbours Google can inherit from, the row above is the
          // better guess. Either can be a week header though, so the formatting
          // is set explicitly below.
          inheritFromBefore: rowIndex > 1,
        },
      },
    ];

    // Give the new row the look of a real event row. Inheriting from a
    // neighbour is not enough: a new row often lands directly above or below a
    // "week of" header — the last event of a week sits above the next header,
    // the first event of a week sits below its own — and would otherwise take
    // on that header's formatting.
    if (formatFromRow) {
      // Anything at or below the insertion point has just shifted down one.
      const source = formatFromRow >= rowIndex ? formatFromRow + 1 : formatFromRow;
      requests.push({
        copyPaste: {
          source: {
            sheetId,
            startRowIndex: source - 1,
            endRowIndex: source,
            startColumnIndex: 0,
            endColumnIndex: PLANNING_SHEET_COLUMN_COUNT,
          },
          destination: {
            sheetId,
            startRowIndex: rowIndex - 1,
            endRowIndex: rowIndex,
            startColumnIndex: 0,
            endColumnIndex: PLANNING_SHEET_COLUMN_COUNT,
          },
          pasteType: 'PASTE_FORMAT',
        },
      });
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: { requests },
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: this.getSheetRange(`A${rowIndex}:${PLANNING_SHEET_LAST_COLUMN}${rowIndex}`),
      valueInputOption: 'USER_ENTERED',
      resource: { values: [rowData] },
    });

    // Everything below just moved down a row, including whatever rows pending
    // proposals are pointing at.
    await this.shiftPendingProposalRows(rowIndex);

    return true;
  }

  /**
   * Convert a PlanningSheetRow object back to a raw string array sized to match
   * PLANNING_SHEET_COLUMNS. Used for per-column merge comparisons.
   * Indices are read from PLANNING_SHEET_COLUMNS so a future column insertion
   * only requires updating the column map.
   */
  planningSheetRowToRawArray(row: PlanningSheetRow): string[] {
    const C = PLANNING_SHEET_COLUMNS;
    const size = Math.max(...Object.values(C)) + 1;
    const raw = new Array(size).fill('');
    raw[C.DATE] = row.date;
    raw[C.DAY_OF_WEEK] = row.dayOfWeek;
    raw[C.GROUP_NAME] = row.groupName;
    raw[C.EVENT_START_TIME] = row.eventStartTime;
    raw[C.EVENT_END_TIME] = row.eventEndTime;
    raw[C.PICK_UP_TIME] = row.pickUpTime;
    raw[C.PICK_UP_NEXT_DAY] = row.pickUpNextDay;
    raw[C.ALL_DETAILS] = row.allDetails;
    raw[C.VAN_BOOKED] = row.vanBooked;
    raw[C.VAN_NEEDED_FOR] = row.vanNeededFor;
    raw[C.STAFFING] = row.staffing;
    raw[C.ESTIMATE_SANDWICHES] = row.estimateSandwiches;
    raw[C.DELI_OR_PBJ] = row.deliOrPbj;
    raw[C.FINAL_SANDWICHES] = row.finalSandwiches;
    raw[C.TOTAL_IN_APP] = row.totalInApp;
    raw[C.FOLLOW_UP_EMAIL_SENT] = row.followUpEmailSent;
    raw[C.SENT_TOOLKIT] = row.sentToolkit;
    raw[C.CONTACT_NAME] = row.contactName;
    raw[C.EMAIL] = row.email;
    raw[C.PHONE] = row.phone;
    raw[C.TSP_CONTACT] = row.tspContact;
    raw[C.ADDRESS] = row.address;
    raw[C.RECIPIENT_HOST] = row.recipientHost;
    raw[C.AFTER_EVENT_NOTES] = row.afterEventNotes;
    raw[C.CANCELLED] = row.cancelled;
    raw[C.NOTES] = row.notes;
    raw[C.SYNC_ID] = row.syncId;
    raw[C.UNLABELED_AB] = row.unlabeledAB;
    return raw;
  }

  /**
   * Push an event directly to the Planning Sheet (no proposal workflow)
   * This is a direct write - user sees preview first, then pushes immediately
   * New rows are inserted in chronological order based on event date.
   *
   * When mergeDecisions is provided, applies per-column merge strategy:
   * - 'use_app': use the app's value (default)
   * - 'keep_sheet': keep the existing sheet value
   * - 'append': combine as "sheet value | app value"
   */
  async pushEventDirectly(
    eventId: number,
    userId: string,
    mergeDecisions?: Record<string, 'use_app' | 'keep_sheet' | 'append'>
  ): Promise<{
    success: boolean;
    message: string;
    rowIndex?: number;
    isUpdate?: boolean;
    /** Why the row landed where it did — surfaced in the UI so a wrong placement is visible. */
    placementNote?: string;
  }> {
    try {
      await this.ensureInitialized();

      // Get the row data for this event
      const rowData = await this.eventToSheetRow(eventId);
      if (!rowData) {
        return { success: false, message: 'Could not generate row data for this event' };
      }

      // Check if row already exists for this event
      const existingRow = await this.findMatchingRow(eventId);

      if (existingRow) {
        // Build the final row data, applying merge decisions if provided
        let finalRow: string[];

        if (mergeDecisions && Object.keys(mergeDecisions).length > 0) {
          const existingRaw = this.planningSheetRowToRawArray(existingRow);
          finalRow = [...rowData];

          // Iterate every mapped column (0..27, A..AB). A hard-coded count here
          // previously skipped the last column and silently ignored its decision.
          for (let i = 0; i < finalRow.length; i++) {
            const decision = mergeDecisions[String(i)];
            if (decision === 'keep_sheet') {
              finalRow[i] = existingRaw[i] ?? '';
            } else if (decision === 'append') {
              const existingVal = (existingRaw[i] || '').trim();
              const appVal = (rowData[i] || '').trim();
              if (existingVal && appVal && existingVal !== appVal) {
                finalRow[i] = `${existingVal} | ${appVal}`;
              } else if (existingVal) {
                finalRow[i] = existingVal;
              }
              // If only app value exists, finalRow[i] already has it
            }
            // 'use_app' or no decision = keep finalRow[i] as rowData[i] (default)
          }

          logger.log(`[PlanningSheet] Applied merge decisions for ${Object.keys(mergeDecisions).length} columns`);
        } else {
          // No merge decisions = full overwrite (backward compatible)
          finalRow = [...rowData];
        }

        // Sheet-owned columns (sync_id, follow-up email, ...) always keep the
        // sheet's value, whatever was decided, so a "use app" can't blank them.
        finalRow = keepSheetOwnedColumns(finalRow, this.planningSheetRowToRawArray(existingRow));

        // Update existing row
        const range = this.getSheetRange(`A${existingRow.rowIndex}:${PLANNING_SHEET_LAST_COLUMN}${existingRow.rowIndex}`);
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [finalRow] },
        });

        logger.log(`[PlanningSheet] User ${userId} updated row ${existingRow.rowIndex} for event ${eventId}`);
        return {
          success: true,
          message: `Updated row ${existingRow.rowIndex} in Planning Sheet`,
          rowIndex: existingRow.rowIndex,
          isUpdate: true
        };
      } else {
        // Get event date for insertion point calculation
        const event = await db
          .select()
          .from(eventRequests)
          .where(eq(eventRequests.id, eventId))
          .limit(1);

        if (!event || event.length === 0) {
          return { success: false, message: 'Event not found' };
        }

        // Find the correct insertion point based on date and time
        const { date: eventDateObj, time: eventTime } = this.placementInputsFor(event[0]);
        const placement = await this.findPlacement(eventDateObj, eventTime);
        const insertBeforeRow = placement.insertBeforeRow;
        let placementNote = placement.note;

        if (insertBeforeRow !== null) {
          const inserted = await this.insertRowAt(
            insertBeforeRow,
            rowData,
            placement.formatFromRow
          );

          if (!inserted) {
            placementNote = `Appended to the end: the worksheet "${this.worksheetName}" could not be identified, so the row could not be inserted at row ${insertBeforeRow} where it belongs.`;
            logger.warn(`[PlanningSheet] ${placementNote}`);
          } else {
            logger.info(`[PlanningSheet] User ${userId} inserted new row at position ${insertBeforeRow} for event ${eventId} (chronological order)`);
            return {
              success: true,
              message: `Inserted new row at position ${insertBeforeRow} in Planning Sheet (sorted by date)`,
              rowIndex: insertBeforeRow,
              isUpdate: false,
              placementNote,
            };
          }
        }

        // Fallback: Append to end if no insertion point found or worksheet ID unavailable
        const newRowIndex = await this.appendRow(rowData, placement.formatFromRow);

        logger.info(`[PlanningSheet] User ${userId} appended new row ${newRowIndex} for event ${eventId}. ${placementNote}`);
        return {
          success: true,
          message: `Added new row ${newRowIndex || ''} to Planning Sheet`,
          rowIndex: newRowIndex,
          isUpdate: false,
          placementNote,
        };
      }
    } catch (error) {
      logger.error(`[PlanningSheet] Error pushing event ${eventId}:`, error);
      return {
        success: false,
        message: `Failed to push to sheet: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Find a row in the Planning Sheet that matches an event
   * Used to determine if we should create a new row or update existing
   */
  async findMatchingRow(
    eventId: number,
    knownRows?: PlanningSheetRow[]
  ): Promise<PlanningSheetRow | null> {
    const event = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1);

    if (!event || event.length === 0) {
      return null;
    }

    const e = event[0];
    const sheetRows = knownRows ?? (await this.readPlanningSheet());

    // Try to match by organization name + date
    const eventDate = getEffectiveEventDate(e);
    const eventDateObj = eventDate ? new Date(eventDate) : null;
    // Format with 2-digit year to match what eventToSheetRow writes (M/D/YY)
    const eventDateStr2Digit = eventDateObj ? eventDateObj.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    }) : '';
    // Also format with 4-digit year as fallback (M/D/YYYY)
    const eventDateStr4Digit = eventDateObj ? eventDateObj.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    }) : '';

    // Match by organization name (case-insensitive) + date. Match the date in
    // either format (2-digit or 4-digit year), with a parsed-date fallback.
    const matchesOrgAndDate = (row: PlanningSheetRow): boolean => {
      const orgMatch =
        row.groupName.toLowerCase().trim() ===
        (e.organizationName || '').toLowerCase().trim();
      if (!orgMatch) return false;
      if (row.date === eventDateStr2Digit || row.date === eventDateStr4Digit) {
        return true;
      }
      if (eventDateObj) {
        const rowDate = this.parseSheetDate(row.date);
        if (
          rowDate &&
          rowDate.getFullYear() === eventDateObj.getFullYear() &&
          rowDate.getMonth() === eventDateObj.getMonth() &&
          rowDate.getDate() === eventDateObj.getDate()
        ) {
          return true;
        }
      }
      return false;
    };

    // Normally exactly one row matches an org on a given date. But a group can
    // (in principle) have more than one event on the same day. If we blindly
    // returned the first match, pushEventDirectly would overwrite that first
    // event's row with the second event's data. So only treat it as "the same
    // event" when the match is unambiguous.
    const sameOrgDate = sheetRows.filter(matchesOrgAndDate);
    if (sameOrgDate.length === 0) return null;
    if (sameOrgDate.length === 1) return sameOrgDate[0];

    // Multiple rows for this org on this date: disambiguate by event start time
    // (the sheet is also ordered by time within a date). If the start time
    // can't single out exactly one row, return null so the caller inserts a
    // NEW row instead of overwriting the wrong event.
    const eventStartMinutes = this.parseTimeToMinutes(String(e.eventStartTime || ''));
    if (eventStartMinutes === null) return null;
    const timeMatches = sameOrgDate.filter(
      (row) => this.parseTimeToMinutes(row.eventStartTime) === eventStartMinutes
    );
    return timeMatches.length === 1 ? timeMatches[0] : null;
  }
}

/**
 * Get the Planning Sheet service instance for the test sheet
 * Uses environment variable for sheet ID
 */
export function getPlanningSheetService(): PlanningSheetSyncService | null {
  const sheetId = process.env.PLANNING_SHEET_ID;
  const worksheetName = process.env.PLANNING_SHEET_WORKSHEET_NAME || '2026 Groups';
  if (!sheetId) {
    logger.warn('PLANNING_SHEET_ID not configured');
    return null;
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    logger.warn('Google Sheets credentials not configured');
    return null;
  }

  return new PlanningSheetSyncService(sheetId, worksheetName);
}
