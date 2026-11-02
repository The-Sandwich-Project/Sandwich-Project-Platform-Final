/**
 * One model for an event's ESTIMATED sandwiches, and the single place that
 * keeps the stored fields consistent.
 *
 * The model (what the team actually knows, in any combination):
 *   - a TOTAL: an exact number ("200") or a range ("300-400"), optional
 *   - TYPE LINES: each a sandwich type, with an amount only if it's known
 *     (exact or range), e.g. "Deli 150", "PBJ 200-250", or just "PBJ"
 *
 * Rules:
 *   - If every line has an amount, the total is worked out from the lines
 *     (unless a given total already agrees with them).
 *   - If any line has no amount, the total is what was entered ("split TBD").
 *   - One line with no amount takes the whole total ("200-300 Turkey").
 *   - No lines = "type TBD".
 *
 * Storage (no schema change; the existing columns become derived outputs):
 *   estimatedSandwichCount     exact total, or the range MIDPOINT for a range
 *                              (so screens/reports that only read the count
 *                              still see a number; hasActiveSandwichRange
 *                              treats count === midpoint as a live range)
 *   estimatedSandwichCountMin/Max   the range bounds, or null when exact
 *   estimatedSandwichRangeType the line's type when there's exactly one line
 *                              and the total is a range, else null
 *   sandwichTypes              the lines as a real array:
 *                                exact    { type, quantity }
 *                                range    { type, quantity: midpoint, min, max }
 *                                no amount{ type, quantity: 0 }
 *
 * resolveEstimatePatch() is called by the storage layer on every create and
 * update that touches any of those fields, from any screen or import, so they
 * can't drift apart again.
 */

export const ESTIMATE_FIELDS = [
  'estimatedSandwichCount',
  'estimatedSandwichCountMin',
  'estimatedSandwichCountMax',
  'estimatedSandwichRangeType',
  'sandwichTypes',
] as const;

export type EstimateFieldName = (typeof ESTIMATE_FIELDS)[number];

export interface EstimateFields {
  estimatedSandwichCount: number | null;
  estimatedSandwichCountMin: number | null;
  estimatedSandwichCountMax: number | null;
  estimatedSandwichRangeType: string | null;
  sandwichTypes: StoredEstimateLine[] | null;
}

export interface StoredEstimateLine {
  type: string;
  quantity: number;
  min?: number;
  max?: number;
}

/** An amount: exact when min === max. */
export interface Amount {
  min: number;
  max: number;
}

export interface EstimateLine {
  type: string;
  amount: Amount | null;
}

export interface EstimateState {
  total: Amount | null;
  lines: EstimateLine[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, string> = {
  pbj: 'pbj',
  'pb&j': 'pbj',
  'pb & j': 'pbj',
  'peanut butter': 'pbj',
  deli: 'deli',
  turkey: 'deli_turkey',
  deli_turkey: 'deli_turkey',
  ham: 'deli_ham',
  deli_ham: 'deli_ham',
  chicken: 'chicken',
};

/** Types that mean "not decided yet": stored as no line at all. */
const TBD_TYPES = new Set(['', 'unknown', 'tbd', 'deli_tbd', 'not decided', 'not decided yet']);

/** The app's key for a type, or null when it means "not decided". */
export function normalizeSandwichTypeKey(raw: unknown): string | null {
  const t = String(raw ?? '').trim().toLowerCase();
  if (TBD_TYPES.has(t)) return null;
  return TYPE_ALIASES[t] ?? t.replace(/\s+/g, '_');
}

/** A positive whole number, or null. */
function count(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r > 0 ? r : null;
}

function amountOf(min: number | null, max: number | null): Amount | null {
  if (min !== null && max !== null) return { min: Math.min(min, max), max: Math.max(min, max) };
  const one = min ?? max;
  return one !== null ? { min: one, max: one } : null;
}

const midpoint = (a: Amount) => Math.round((a.min + a.max) / 2);
const isRange = (a: Amount | null): a is Amount => !!a && a.min !== a.max;

/** Parse stored/sent type lines (array, legacy JSON string or legacy object). Drops "not decided" lines without an amount. */
export function parseEstimateLines(raw: unknown): EstimateLine[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      return [];
    }
    // A JSON string holding a JSON array (double-encoded) - unwrap once more.
    if (typeof arr === 'string') return parseEstimateLines(arr);
  }
  // Older object shapes the app still reads (client/src/lib/sandwich-utils.ts):
  // line objects under numeric keys, or { pbj: 200, deli: 0 }.
  if (arr && typeof arr === 'object' && !Array.isArray(arr)) {
    const values = Object.values(arr as Record<string, unknown>);
    if (values.length && values.every((v) => v && typeof v === 'object' && 'type' in (v as any))) {
      arr = values;
    } else if (values.length && values.every((v) => typeof v === 'number')) {
      arr = Object.entries(arr as Record<string, number>)
        .filter(([, n]) => n > 0) // 0 here meant "none of this type"
        .map(([type, quantity]) => ({ type, quantity }));
    }
  }
  if (!Array.isArray(arr)) return [];
  const lines: EstimateLine[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const lo = count((item as any).min);
    const hi = count((item as any).max);
    const rawQ = (item as any).quantity;
    const q = count(rawQ);
    // An amount cleared to 0 is "TBD", even if the line kept its old min/max.
    const clearedToZero = rawQ === 0 || rawQ === '0';
    // A line's range only counts while its quantity is still the range's
    // midpoint; a quantity edited to something else (an editor that kept the
    // old min/max) is an exact amount, the same rule as totalFromFields.
    const lineRange = lo !== null && hi !== null ? amountOf(lo, hi) : null;
    const amount = clearedToZero
      ? null
      : lineRange && (q === null || q === midpoint(lineRange))
        ? lineRange
        : q !== null
          ? { min: q, max: q }
          : lineRange;
    // "Unknown"/TBD type rows are kept as "unknown": an amount still counts
    // toward the total (150 Deli + 50 Unknown = 200), and one without an
    // amount marks the split incomplete (150 Deli + the rest unknown keeps a
    // 300 total). Rows that are ONLY unknown mean "type TBD" and are dropped
    // in normalizeEstimate.
    const named = normalizeSandwichTypeKey((item as any).type);
    const rawType = String((item as any).type ?? '').trim();
    const type = named ?? (amount || rawType ? 'unknown' : null);
    if (!type) continue;
    lines.push({ type, amount });
  }
  return lines;
}

/**
 * The total a set of stored fields describes. A range only counts when it's
 * active: both bounds, and no exact count that disagrees with the midpoint
 * (the same rule as hasActiveSandwichRange). Stale bounds next to a different
 * exact count are ignored; a one-sided range becomes that one number.
 */
export function totalFromFields(f: {
  estimatedSandwichCount?: unknown;
  estimatedSandwichCountMin?: unknown;
  estimatedSandwichCountMax?: unknown;
}): Amount | null {
  const c = count(f.estimatedSandwichCount);
  const lo = count(f.estimatedSandwichCountMin);
  const hi = count(f.estimatedSandwichCountMax);
  if (lo !== null && hi !== null) {
    const range = amountOf(lo, hi)!;
    if (c === null || c === midpoint(range)) return range;
    return { min: c, max: c };
  }
  if (c !== null) return { min: c, max: c };
  const one = lo ?? hi;
  return one !== null ? { min: one, max: one } : null;
}

/** Read an event's current estimate. */
export function estimateStateFromFields(f: Partial<Record<EstimateFieldName, unknown>>): EstimateState {
  let lines = parseEstimateLines(f.sandwichTypes);
  const total = totalFromFields(f);
  if (lines.length === 0) {
    const rt = normalizeSandwichTypeKey(f.estimatedSandwichRangeType);
    if (rt) lines = [{ type: rt, amount: null }];
  }
  // Older saves left a breakdown that no longer adds up to the count the
  // person entered later. The entered total wins; keep the types, drop the
  // stale amounts (one line simply takes the total in normalize).
  if (total && lines.length > 0 && lines.every((l) => l.amount)) {
    const sum = sumAmounts(lines);
    if (!(sum.min >= total.min && sum.max <= total.max)) {
      lines = lines.map((l) => ({ type: l.type, amount: null }));
    }
  }
  return { total, lines };
}

function sumAmounts(lines: EstimateLine[]): Amount {
  return lines.reduce(
    (acc, l) => ({ min: acc.min + (l.amount?.min ?? 0), max: acc.max + (l.amount?.max ?? 0) }),
    { min: 0, max: 0 }
  );
}

// ---------------------------------------------------------------------------
// Normalizing
// ---------------------------------------------------------------------------

/** Turn a state into consistent stored fields. */
export function normalizeEstimate(state: EstimateState): EstimateFields {
  // Merge duplicate types (first one wins its position): amounts add up, and
  // repeated TBD lines become one. A known amount and a TBD line of the same
  // type stay separate, so "150 Deli + more Deli TBD" doesn't read as a
  // complete 150.
  let lines: EstimateLine[] = [];
  for (const l of state.lines) {
    const prev = lines.find((p) => p.type === l.type && !!p.amount === !!l.amount);
    if (!prev) lines.push({ ...l });
    else if (prev.amount && l.amount) {
      prev.amount = { min: prev.amount.min + l.amount.min, max: prev.amount.max + l.amount.max };
    }
  }
  let total = state.total;

  // One line with no amount takes the whole total.
  if (lines.length === 1 && !lines[0].amount && total) {
    lines = [{ type: lines[0].type, amount: { ...total } }];
  }

  const allAmounts = lines.length > 0 && lines.every((l) => l.amount);
  if (allAmounts) {
    const sum = sumAmounts(lines);
    const agrees = total && sum.min >= total.min && sum.max <= total.max;
    if (!agrees) total = sum;
  } else if (total) {
    // Known amounts can't add up to more than the total.
    const known = sumAmounts(lines.filter((l) => l.amount));
    if (known.min > total.min || known.max > total.max) {
      total = { min: Math.max(total.min, known.min), max: Math.max(total.max, known.max) };
    }
  }

  // Only "unknown" lines: the type isn't decided at all. The total (worked
  // out above, from them if need be) carries the amount; no lines.
  if (lines.length > 0 && lines.every((l) => l.type === 'unknown')) lines = [];

  const stored: StoredEstimateLine[] = lines.map((l) => {
    if (!l.amount) return { type: l.type, quantity: 0 };
    if (isRange(l.amount)) return { type: l.type, quantity: midpoint(l.amount), min: l.amount.min, max: l.amount.max };
    return { type: l.type, quantity: l.amount.min };
  });

  return {
    estimatedSandwichCount: total ? midpoint(total) : null,
    estimatedSandwichCountMin: isRange(total) ? total.min : null,
    estimatedSandwichCountMax: isRange(total) ? total.max : null,
    estimatedSandwichRangeType: isRange(total) && lines.length === 1 ? lines[0].type : null,
    sandwichTypes: stored.length ? stored : null,
  };
}

/** True when an update touches any estimate field. */
export function touchesEstimate(patch: Record<string, unknown>): boolean {
  return ESTIMATE_FIELDS.some((k) => k in patch && (patch as any)[k] !== undefined);
}

/**
 * The consistent estimate fields after applying `patch` to `existing`.
 * Reads the patch by intent, because screens send different subsets:
 *   - a total only (intake, spreadsheet, a count edit): the total changes; one
 *     line follows it; several lines keep their types but drop amounts that no
 *     longer add up ("split TBD") instead of showing stale numbers
 *   - lines only (a types edit): totals follow lines that all have amounts;
 *     otherwise the existing total stays
 *   - a range type only: becomes the single line's type
 *   - both: the lines and total as sent (lines win when they disagree)
 * A total given as a range ignores the stored count, and a total given as a
 * count ignores the stored bounds, so a save that omits the other field
 * (e.g. a form that drops "unchanged" nulls) still means what it says.
 */
export function resolveEstimatePatch(
  existing: Partial<Record<EstimateFieldName, unknown>> | null | undefined,
  patch: Record<string, unknown>
): EstimateFields {
  const prev = existing ?? {};
  const cur = estimateStateFromFields(prev);
  const has = (k: EstimateFieldName) => k in patch && patch[k] !== undefined;

  const touchedTotal = has('estimatedSandwichCount') || has('estimatedSandwichCountMin') || has('estimatedSandwichCountMax');
  const touchedLines = has('sandwichTypes');
  const touchedRangeType = has('estimatedSandwichRangeType');

  // --- total
  let total = cur.total;
  if (touchedTotal) {
    const rangeSent = has('estimatedSandwichCountMin') || has('estimatedSandwichCountMax');
    if (rangeSent) {
      const min = has('estimatedSandwichCountMin') ? patch.estimatedSandwichCountMin : prev.estimatedSandwichCountMin;
      const max = has('estimatedSandwichCountMax') ? patch.estimatedSandwichCountMax : prev.estimatedSandwichCountMax;
      const c = has('estimatedSandwichCount') ? patch.estimatedSandwichCount : null;
      total = totalFromFields({ estimatedSandwichCount: c, estimatedSandwichCountMin: min, estimatedSandwichCountMax: max });
      // The patch cleared the range and sent no count: keep a stored exact count.
      if (!total && !has('estimatedSandwichCount')) {
        total = totalFromFields({ estimatedSandwichCount: prev.estimatedSandwichCount });
      }
    } else {
      total = totalFromFields({ estimatedSandwichCount: patch.estimatedSandwichCount });
    }
  }

  // --- lines
  let lines = touchedLines ? parseEstimateLines(patch.sandwichTypes) : cur.lines;
  if (touchedRangeType) {
    const rt = normalizeSandwichTypeKey(patch.estimatedSandwichRangeType);
    if (rt && lines.length <= 1) {
      lines = [{ type: rt, amount: lines[0]?.amount ?? null }];
    } else if (rt && !touchedLines && isRange(total)) {
      // A range type picked for a range (no new lines sent) names THE type,
      // replacing several old ones (a form that only sends what changed).
      lines = [{ type: rt, amount: null }];
    } else if (!rt && !touchedLines && isRange(total) && lines.length === 1) {
      // "No specific type" chosen for a range (and no new lines sent): the
      // one type the range named goes. For an exact total a null range type
      // means nothing and leaves the types alone.
      lines = [];
    }
  }

  // A new total with the old lines: lines that no longer fit lose their
  // amounts (types kept), so old amounts can never undo the total just
  // entered; a single line just takes the new total.
  if (touchedTotal && !touchedLines && lines.length > 0) {
    const drop = () => lines.map((l) => ({ type: l.type, amount: null }));
    const known = lines.filter((l) => l.amount);
    if (lines.length === 1 || !total) {
      // One line follows the total; a cleared total clears the split too
      // (otherwise the old amounts would add back up to the old total).
      lines = drop();
    } else if (known.length > 0) {
      const sum = sumAmounts(known);
      const fits =
        known.length === lines.length
          ? sum.min >= total.min && sum.max <= total.max // complete split must add up
          : sum.min <= total.min && sum.max <= total.max; // partial split must not exceed it
      if (!fits) lines = drop();
    }
  }

  // New lines that all have amounts and disagree with the old total: the
  // lines win (normalize derives the total from them).
  return normalizeEstimate({ total, lines });
}

// ---------------------------------------------------------------------------
// Display (shared so every screen says the same thing)
// ---------------------------------------------------------------------------

const DISPLAY_LABELS: Record<string, string> = {
  pbj: 'PBJ',
  deli: 'Deli',
  deli_turkey: 'Turkey',
  deli_ham: 'Ham',
  chicken: 'Chicken',
};

export function sandwichTypeLabel(key: string): string {
  return DISPLAY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

const fmtAmount = (a: Amount) => (a.min === a.max ? `${a.min}` : `${a.min}–${a.max}`);

/**
 * One line for cards and lists, e.g. "200 Turkey", "200–300 Turkey",
 * "200 (150 Deli, 50 PBJ)", "300–400, Deli & PBJ (split TBD)", "200, type TBD",
 * or "" when there's no estimate at all.
 */
export function formatEstimate(f: Partial<Record<EstimateFieldName, unknown>>): string {
  const s = normalizeEstimate(estimateStateFromFields(f));
  const state = estimateStateFromFields(s);
  const total = state.total;
  const lines = state.lines;
  if (!total && lines.length === 0) return '';
  if (!total) return `${lines.map((l) => sandwichTypeLabel(l.type)).join(' & ')}, amount TBD`;
  if (lines.length === 0) return `${fmtAmount(total)}, type TBD`;
  if (lines.length === 1) return `${fmtAmount(total)} ${sandwichTypeLabel(lines[0].type)}`;
  if (lines.every((l) => l.amount)) {
    return `${fmtAmount(total)} (${lines.map((l) => `${fmtAmount(l.amount!)} ${sandwichTypeLabel(l.type)}`).join(', ')})`;
  }
  const names = lines.map((l) => sandwichTypeLabel(l.type));
  const joined = names.length === 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
  return `${fmtAmount(total)}, ${joined} (split TBD)`;
}
