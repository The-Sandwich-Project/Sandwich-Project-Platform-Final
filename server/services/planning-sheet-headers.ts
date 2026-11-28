/**
 * Planning sheet columns found by HEADER, not by position.
 *
 * The app works with a fixed "logical" column list (PLANNING_SHEET_COLUMNS in
 * planning-sheet-sync-service.ts: proposals, merge choices and the push
 * preview all use it). On every read and write, row 1 of the sheet is mapped
 * onto that list here, so the sheet's columns can be renamed (old and new
 * header texts are both recognized), moved or have columns inserted without
 * the app writing into the wrong one.
 *
 * Writing is limited to the app's own columns (APP_WRITTEN_COLUMNS). On an
 * existing row only those cells are written, one by one, so every other cell,
 * formulas included, is never touched.
 */

/** Logical column index -> header texts that mean that column (any of them). */
export const PLANNING_HEADER_ALIASES: Record<number, { exact?: string[]; startsWith?: string[] }> = {
  0: { exact: ['date'] }, // A Date
  1: { exact: ['day of the week', 'day of week'] },
  2: { exact: ['group name'] },
  3: { startsWith: ['time event starts', 'event start time'] },
  4: { startsWith: ['time event ends', 'event end time'] },
  5: { startsWith: ['pick-up time', 'pick up time', 'pickup time'] }, // F
  6: { startsWith: ['y yes/planned', 'pick up next day', 'pickup next day'] }, // G "Y (yes/planned) O (next day is an option)"
  7: { exact: ['details', 'all details'] }, // H
  8: { startsWith: ['van needed am', 'van booked'] }, // I "Van Needed (AM/PM/mid-day/All day?)"
  9: { exact: ['van needed for'] }, // J
  10: { exact: ['volunteer needs', 'staffing', 'volunteer/driver needed'] },
  11: { exact: ['estimated # of sandwiches', 'estimate # sandwiches'] },
  12: { exact: ['type of sandwiches', 'deli or pbj'] },
  13: { exact: ['final # of sandwiches', 'final # sandwiches made'] },
  14: { exact: ["#'s added to app"] },
  15: { exact: ['follow-up email sent', 'follow up email sent'] },
  16: { exact: ['toolkit sent', 'sent toolkit'] },
  17: { exact: ['group contact name', 'contact name'] },
  18: { exact: ['group contact email', 'email address', 'email'] },
  19: { exact: ['group contact phone', 'contact cell number', 'phone'] },
  20: { exact: ['tsp contact'] },
  21: { exact: ['event location', 'address'] },
  22: { exact: ['sandwich destination', 'planned recipient/host home'] },
  23: { exact: ['notes on how the event went', 'after event notes'] },
  24: { exact: ['cancelled'] },
  25: { exact: ['blank column', 'notes'] }, // Z
  26: { exact: ['sync_id'] },
  27: { exact: ['planning/contact notes', 'ab: planning/contact notes', 'waiting on'] }, // AB
  28: { exact: ['tsp shopping'] },
};

/** The logical columns the app writes. Everything else belongs to the sheet. */
export const APP_WRITTEN_COLUMNS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21, 22, 23, 24, 28,
]);

/** The logical columns that must be found before anything is read or written. */
export const REQUIRED_LOGICAL_COLUMNS = [0, 2] as const;

/** Lowercase, single spaces, no quotes, '?', ':' or parentheses. */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/["“”()?:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PlanningHeaderMap {
  /** logical index -> 0-based sheet column */
  columns: Map<number, number>;
  /** Number of columns in the header row (the width to read/write). */
  width: number;
}

/**
 * Map row 1 onto the logical columns. The first matching header wins, and a
 * sheet column is only used once. Throws when Date or Group Name can't be
 * found, so a wrong sheet or tab is never written to.
 */
export function resolvePlanningHeaders(headers: unknown[]): PlanningHeaderMap {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const columns = new Map<number, number>();
  for (const [logicalStr, rule] of Object.entries(PLANNING_HEADER_ALIASES)) {
    const logical = Number(logicalStr);
    const exact = (rule.exact ?? []).map(normalizeHeader);
    const starts = (rule.startsWith ?? []).map(normalizeHeader);
    const idx = normalized.findIndex(
      (h, i) => !used.has(i) && h !== '' && (exact.includes(h) || starts.some((s) => h.startsWith(s))),
    );
    if (idx >= 0) {
      columns.set(logical, idx);
      used.add(idx);
    }
  }
  const missing = REQUIRED_LOGICAL_COLUMNS.filter((c) => !columns.has(c));
  if (missing.length) {
    throw new Error(
      `The planning sheet's header row doesn't have ${missing.map((c) => (c === 0 ? '"Date"' : '"Group Name"')).join(' or ')}, so nothing was read or written. Check the sheet and tab.`,
    );
  }
  return { columns, width: headers.length };
}

/** A sheet row (actual layout) as the logical column list. */
export function toLogicalRow(actual: unknown[], map: PlanningHeaderMap, logicalCount: number): string[] {
  const out = new Array<string>(logicalCount).fill('');
  for (const [logical, col] of map.columns) {
    if (logical < logicalCount) out[logical] = String(actual[col] ?? '');
  }
  return out;
}

/** A NEW sheet row (actual layout): only the app's columns filled, the rest blank. */
export function newSheetRow(logical: string[], map: PlanningHeaderMap): string[] {
  const out = new Array<string>(map.width).fill('');
  for (const [l, col] of map.columns) {
    if (APP_WRITTEN_COLUMNS.has(l)) out[col] = logical[l] ?? '';
  }
  return out;
}

/** The cells to write on an EXISTING row: the app's columns only, and only those that changed. */
export function appCellWrites(
  logical: string[],
  map: PlanningHeaderMap,
  existingActual?: unknown[],
): Array<{ column: number; value: string }> {
  const writes: Array<{ column: number; value: string }> = [];
  for (const [l, col] of map.columns) {
    if (!APP_WRITTEN_COLUMNS.has(l)) continue;
    const value = logical[l] ?? '';
    if (existingActual && String(existingActual[col] ?? '') === value) continue;
    writes.push({ column: col, value });
  }
  return writes.sort((a, b) => a.column - b.column);
}
