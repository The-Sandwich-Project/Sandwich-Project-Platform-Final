export interface SandwichCountParseResult {
  count: number | null;
  min: number | null;
  max: number | null;
  isRange: boolean;
}

export interface SandwichCountFields {
  actualSandwichCount?: number | string | null;
  estimatedSandwichCount?: number | string | null;
  estimatedSandwichCountMin?: number | string | null;
  estimatedSandwichCountMax?: number | string | null;
}

export interface ReportableSandwichCountOptions {
  ignoreSuspiciousEstimatedCounts?: boolean;
  suspiciousEstimatedThreshold?: number;
}

function toFiniteCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

export function parseSandwichCountInput(value: number | string | null | undefined): SandwichCountParseResult {
  if (typeof value === 'number') {
    return { count: toFiniteCount(value), min: null, max: null, isRange: false };
  }

  if (!value) {
    return { count: null, min: null, max: null, isRange: false };
  }

  const text = String(value).trim();
  const numberPattern = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
  const rangePattern = new RegExp(`(${numberPattern})\\s*(?:-|–|—|to|through|thru)\\s*(${numberPattern})`, 'i');
  const rangeMatch = text.match(rangePattern);

  if (rangeMatch) {
    const first = toFiniteCount(rangeMatch[1]);
    const second = toFiniteCount(rangeMatch[2]);

    if (first !== null && second !== null) {
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      return {
        count: Math.round((min + max) / 2),
        min,
        max,
        isRange: true,
      };
    }
  }

  const singleMatch = text.match(new RegExp(numberPattern));
  const count = singleMatch ? toFiniteCount(singleMatch[0]) : null;
  return { count, min: null, max: null, isRange: false };
}

export interface SandwichTypeEntry {
  type?: string;
  quantity?: number | string | null;
}

/**
 * Parse a sandwichTypes value into an array of entries. Never throws —
 * unrecognizable input yields [].
 *
 * Accepts every shape the column has held over time, matching the client's
 * parseSandwichTypes() so the two can't disagree about whether a row has a
 * breakdown:
 *   * a real array                    -> [{type, quantity}, ...]
 *   * a double-encoded JSON string    -> "[{\"type\": ...}]"
 *   * an object keyed by index        -> {"0": {type, quantity}, ...}
 *   * the legacy type->quantity map   -> {deli: 0, turkey: 250, pbj: 248}
 */
export function parseSandwichTypeEntries(sandwichTypes: unknown): SandwichTypeEntry[] {
  if (!sandwichTypes) return [];
  try {
    const parsed = typeof sandwichTypes === 'string' ? JSON.parse(sandwichTypes) : sandwichTypes;
    if (Array.isArray(parsed)) return parsed as SandwichTypeEntry[];
    if (!parsed || typeof parsed !== 'object') return [];

    const values = Object.values(parsed as Record<string, unknown>);
    if (values.length === 0) return [];

    // Object keyed by index, holding real entries.
    if (values.every((item) => !!item && typeof item === 'object' && 'type' in (item as object) && 'quantity' in (item as object))) {
      return values as SandwichTypeEntry[];
    }

    // Legacy {deli: 0, turkey: 250} map. Zero quantities carry no information
    // in this shape, so they are dropped (same rule as the client parser).
    if (values.every((value) => typeof value === 'number')) {
      return Object.entries(parsed as Record<string, number>)
        .map(([type, quantity]) => ({ type, quantity }))
        .filter((entry) => entry.quantity > 0);
    }

    return [];
  } catch {
    return [];
  }
}

/** Sum quantities from a sandwichTypes value (array or JSON string). */
export function sumSandwichTypeQuantities(sandwichTypes: unknown): number {
  return parseSandwichTypeEntries(sandwichTypes).reduce(
    (sum, item) => sum + (Number(item?.quantity) || 0),
    0,
  );
}

/**
 * Normalize a sandwichTypes value into what the JSONB column should hold: a
 * real array, or NULL when there is no breakdown.
 *
 * The client serializes breakdowns with JSON.stringify() before sending them,
 * so the save routes receive a STRING. Writing that string into a jsonb column
 * stores a JSON scalar string ("[{\"type\":...}]") rather than a JSON array —
 * double-encoded. The client hides this because its parsers accept both, but
 * SQL cannot: jsonb_array_length()/jsonb_array_elements() error with "cannot
 * get array length of a scalar" on those rows, so reporting and heal queries
 * skip or break on them. Normalizing on write keeps the column one shape.
 */
export function normalizeSandwichTypesForStorage(value: unknown): SandwichTypeEntry[] | null {
  if (value === null || value === undefined) return null;
  const entries = parseSandwichTypeEntries(value);
  return entries.length > 0 ? entries : null;
}

/**
 * True when a sandwichTypes breakdown should drive UI/display as the live
 * representation of the count.
 *
 * The types-mode twin of hasActiveSandwichRange, and it exists for the same
 * reason: a breakdown that DISAGREES with an explicit exact count is stale
 * leftover data, not the user's intent. Whoever wrote the exact count wrote it
 * last, so a disagreeing breakdown must not be shown, must not seed an editor
 * in "Specify Types" mode, and must not be summed back over the exact count
 * (the "500 saves as 498" bug — 250 turkey + 248 PBJ left behind by an earlier
 * types entry). A breakdown with no exact count, or one that sums to exactly
 * the stored count, is legitimate and stays active.
 */
export function hasActiveSandwichTypes(
  sandwichTypes: unknown,
  exactCount?: number | string | null,
): boolean {
  const entries = parseSandwichTypeEntries(sandwichTypes);
  if (entries.length === 0) return false;

  const exact = toFiniteCount(exactCount);
  if (exact === null) return true;

  return sumSandwichTypeQuantities(entries) === exact;
}

export function getRangeMidpoint(minValue: number | string | null | undefined, maxValue: number | string | null | undefined): number | null {
  const min = toFiniteCount(minValue);
  const max = toFiniteCount(maxValue);

  if (min !== null && max !== null) {
    return Math.round((Math.min(min, max) + Math.max(min, max)) / 2);
  }

  return min ?? max;
}

/**
 * True when min/max should drive UI as a complete active range.
 *
 * Requires BOTH bounds so call sites can safely render `${min}-${max}` without
 * producing strings like "490-null". Also returns false when an exact
 * estimatedSandwichCount is present AND disagrees with the range midpoint —
 * that signature is the "500 saves as 498" bug (a leftover range whose
 * midpoint overrides the exact count the user entered). Legitimate imports
 * store count === midpoint and stay treated as a range.
 */
export function hasActiveSandwichRange(
  estimatedSandwichCountMin: number | string | null | undefined,
  estimatedSandwichCountMax: number | string | null | undefined,
  estimatedSandwichCount?: number | string | null,
): boolean {
  const min = toFiniteCount(estimatedSandwichCountMin);
  const max = toFiniteCount(estimatedSandwichCountMax);
  if (min === null || max === null) return false;

  const midpoint = Math.round((Math.min(min, max) + Math.max(min, max)) / 2);
  const exact = toFiniteCount(estimatedSandwichCount);
  return exact === null || exact === midpoint;
}

export function getReportableSandwichCount(
  event: SandwichCountFields,
  options: ReportableSandwichCountOptions = {},
): number {
  const actualCount = toFiniteCount(event.actualSandwichCount);
  if (actualCount !== null) return actualCount;

  // Prefer an explicit exact count over a range midpoint. Clean range-mode
  // saves null estimatedSandwichCount, so they still fall through to the
  // midpoint. Corrupted rows that keep BOTH (exact 500 + stale 490-506 →
  // midpoint 498) must show what the user typed, not the leftover range.
  const estimatedCount = toFiniteCount(event.estimatedSandwichCount);
  if (estimatedCount !== null) {
    if (
      options.ignoreSuspiciousEstimatedCounts &&
      estimatedCount >= (options.suspiciousEstimatedThreshold ?? 50000)
    ) {
      return 0;
    }
    return estimatedCount;
  }

  const rangeMidpoint = getRangeMidpoint(event.estimatedSandwichCountMin, event.estimatedSandwichCountMax);
  if (rangeMidpoint !== null) return rangeMidpoint;

  return 0;
}
