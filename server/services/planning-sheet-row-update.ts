import { createHash } from 'crypto';
import { parseDateOnly, toDateOnlyString } from '@shared/date-utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { getRangeMidpoint, hasActiveSandwichRange, parseSandwichCountInput } from '@shared/sandwich-count-utils';

/**
 * Planning sheet → app UPDATE ("send row to app" on a row that already exists).
 *
 * The app pushes an event to the planning sheet, then the team keeps editing
 * that row on the sheet (times get added, the date moves, sandwich numbers and
 * types change, drivers/volunteers get assigned, notes get added). This module works
 * out what the app should change to match the sheet row.
 *
 * It is deliberately MANUAL and field-scoped:
 * - Nothing here runs on a timer. A person clicks "send row to app" on the
 *   sheet, sees the changes, and confirms.
 * - Only the fields below can change. Status can only move TO cancelled (when
 *   the sheet's Cancelled column says so); notes are only appended to. TSP
 *   contact, group name and everything else are never touched.
 * - A blank sheet cell never clears an app value. People leave cells empty
 *   because they haven't filled them in yet, not to delete data.
 * - Contact details and address/recipient are FILL-ONLY: they're added when
 *   the app has nothing, and never overwrite an existing app value.
 *
 * Everything here is pure (no DB) so it can be unit tested; the route does the
 * reads and the write.
 */

/** The fields of an event this module reads. */
export interface RowUpdateEvent {
  id: number;
  organizationName: string | null;
  status: string;
  scheduledEventDate: Date | string | null;
  desiredEventDate: Date | string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  pickupTime: string | null;
  estimatedSandwichCount: number | null;
  /** Range-mode events keep their estimate here, with estimatedSandwichCount null. */
  estimatedSandwichCountMin?: number | null;
  estimatedSandwichCountMax?: number | null;
  /** The single type a range-mode estimate is for (e.g. 'deli_turkey'). */
  estimatedSandwichRangeType?: string | null;
  /** Folded into the plan token so any app save after the preview is caught. */
  updatedAt?: Date | string | null;
  actualSandwichCount: number | null;
  /** Reference-only breakdown of the final count, kept adding up to it. */
  actualSandwichTypes?: unknown;
  sandwichTypes: unknown;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  eventAddress: string | null;
  deliveryDestination: string | null;
  driversNeeded: number | null;
  speakersNeeded: number | null;
  volunteersNeeded: number | null;
  vanDriverNeeded: boolean | null;
  assignedVanDriverId?: string | null;
  customVanDriverName?: string | null;
  assignedDriverIds: string[] | null;
  assignedSpeakerIds: string[] | null;
  assignedVolunteerIds: string[] | null;
  driverDetails: unknown;
  speakerDetails: unknown;
  volunteerDetails: unknown;
  planningNotes?: string | null;
  cancelledReason?: string | null;
  /** The original request message. The push writes it into ALL DETAILS. */
  message?: string | null;
  /** The push writes this into the sheet's Waiting On column. */
  nextAction?: string | null;
}

/** A sheet row as the Apps Script sends it (same keys as /import-from-sheets). */
export interface SheetRowData {
  date: string;
  'Group Name': string;
  'Event Start time (MUST when volunteer needed)'?: string;
  'Event end time (MUST when volunteer needed)'?: string;
  'Pick up time'?: string;
  Staffing?: string;
  Cancelled?: string;
  'ALL DETAILS'?: string;
  Notes?: string;
  "Add'l Notes"?: string;
  'Waiting On'?: string;
  /** What the sheet's Apps Script actually sends for the staffing column. */
  'Volunteer/Driver Needed'?: string;
  'Estimate # sandwiches'?: string | number;
  'Deli or PBJ?'?: string;
  'Final # sandwiches made'?: string | number;
  'Contact Name'?: string;
  'Email Address'?: string;
  'Contact Cell Number'?: string;
  Address?: string;
  'Planned Recipient/Host Home'?: string;
}

export interface MatchableUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  /**
   * false = an inactive user, passed in only so an EXISTING assignee keeps
   * their identity (the push writes their name). New names never match one.
   */
  isActive?: boolean;
}

export type ChangeKind = 'fill' | 'update';

export interface RowChange {
  /** Stable key, e.g. "eventStartTime" or "drivers". */
  field: string;
  /** Human label for the confirm dialog. */
  label: string;
  /** What the app shows now ('' when empty). */
  from: string;
  /** What it will show after the update. */
  to: string;
  kind: ChangeKind;
}

export interface RowUpdatePlan {
  changes: RowChange[];
  /** Column → value patch to write to event_requests. Empty when no changes. */
  updates: Record<string, unknown>;
  /** The same patch, split by RowChange.field, so a person can pick which to apply. */
  updatesByField: Record<string, Record<string, unknown>>;
  /**
   * With a types change: the single type a range-mode estimate should name
   * (null when the sheet lists several). Applied by selectUpdates, which knows
   * whether the event stays in range mode given what was ticked.
   */
  sheetRangeType?: string | null;
  /** Things the person should know that we did NOT change. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const clean = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

/**
 * Normalize a sheet or app time to "HH:MM" (24h). Accepts "2:00 PM", "2pm",
 * "14:00", "14:00:00". Returns null for blank or unreadable input.
 */
export function normalizeTime(raw: unknown): string | null {
  const s = clean(raw).toLowerCase().replace(/\./g, '');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (!m[2]) {
    // A bare number like "2" is too ambiguous to store.
    return null;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Display "HH:MM" as "2:00 PM" (matches how the push writes times). */
function displayTime(raw: unknown): string {
  const t = normalizeTime(raw);
  if (!t) return clean(raw);
  const [hh, mm] = t.split(':').map((x) => parseInt(x, 10));
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}

/** "YYYY-MM-DD" only if it's a real calendar day (rejects 2026-13-01, 2/31/26). */
function realDay(year: number, month: number, day: number): string | null {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return toDateOnlyString(parseDateOnly(iso)) === iso ? iso : null;
}

/** Sheet date → "YYYY-MM-DD". Accepts YYYY-MM-DD, M/D/YY and M/D/YYYY. */
export function normalizeSheetDate(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return realDay(+iso[1], +iso[2], +iso[3]);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return realDay(year, parseInt(m[1], 10), parseInt(m[2], 10));
  }
  // Apps Script can send a full Date string; take its calendar day.
  const d = parseDateOnly(s);
  return d && !isNaN(d.getTime()) ? toDateOnlyString(d) : null;
}

export interface ParsedStaffing {
  /**
   * `names` includes names written under VD. The push writes the event's
   * drivers as "VD: ..." on van events, so VD names ARE drivers.
   * `vanNames` is just the VD ones; `plainListed` is whether a plain "D" appeared.
   */
  driver: { listed: boolean; names: string[]; van: boolean; vanNames: string[]; plainListed: boolean; slots: number };
  /** Always empty: "S" is read as a volunteer. Kept so callers' shapes don't change. */
  speaker: { listed: boolean; names: string[]; slots: number };
  volunteer: { listed: boolean; names: string[]; slots: number };
  /** Parts of the cell that weren't under any role code (shown to the person, never applied). */
  unread: string[];
}

/**
 * Parse the planning-sheet Staffing cell.
 *
 * Handles every format the push writes and people type:
 *   "D, V"                  → driver + volunteer needed, nobody assigned
 *   "D: , S: "              → same (this is what the push writes for "needed")
 *   "D: Katie, Kim, V: Ann" → drivers Katie AND Kim, volunteer Ann
 *   "S: Ann"                → volunteer Ann. The speaker role was retired and
 *                             folded into volunteers (migration
 *                             20260709_convert_event_speakers_to_volunteers),
 *                             so an old "S" on the sheet counts as a volunteer.
 *   "VD: Luz"               → van driver Luz
 *
 * A token that isn't a role code continues the previous role's name list,
 * which is how the push writes multiple people ("D: Katie, Kim").
 */
export function parsePlanningStaffing(raw: unknown): ParsedStaffing {
  const out: ParsedStaffing = {
    driver: { listed: false, names: [], van: false, vanNames: [], plainListed: false, slots: 0 },
    speaker: { listed: false, names: [], slots: 0 },
    volunteer: { listed: false, names: [], slots: 0 },
    unread: [],
  };
  const s = clean(raw);
  if (!s) return out;

  // Role codes, optionally numbered per slot ("D1:", "V2:"), or spelled out
  // ("Driver:", "Volunteers:", "Van driver:"). Speakers were folded into
  // volunteers, so S counts as a volunteer.
  const roleFor = (code: string): { role: 'driver' | 'volunteer'; van: boolean } | null => {
    const c = code.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\d+$/, '').trim();
    if (c === 'VD' || c === 'VAN DRIVER' || c === 'VAN DRIVERS') return { role: 'driver', van: true };
    if (c === 'D' || c === 'DRIVER' || c === 'DRIVERS') return { role: 'driver', van: false };
    if (c === 'V' || c === 'VOLUNTEER' || c === 'VOLUNTEERS') return { role: 'volunteer', van: false };
    if (c === 'S' || c === 'SPEAKER' || c === 'SPEAKERS') return { role: 'volunteer', van: false };
    return null;
  };
  const ROLE_CODE = String.raw`(?:van\s+drivers?|drivers?|volunteers?|speakers?|VD|D|S|V)\d*\s*:`;

  // Formats seen on the live sheet, all handled here:
  //   "D: Katie, Kim"  "D: Katie & Kim"  "V: Ann and Bo"   (name separators)
  //   "D1: Karen V1: Karen  V2: Bev Lowe + Alicia"         (numbered slots, "+")
  //   "V1: Sibet/Bruce"                                    (slash between names)
  //   "D: (VD: Luz for event)"                             (a code in parentheses)
  //   "V/D: Dawn M."                                       (V/D = van driver)
  //   "D: Brigith (9:15 pickup or go for event)"           (a note in parentheses)
  //   "D: Katie V: Kim"                                    (no comma before a code)
  let cell = s
    // "V/D:" is a van-driver code, not two names.
    .replace(/\bV\s*\/\s*D(?=\d*\s*:)/gi, 'VD')
    // A code inside parentheses is just a code: "(VD: Luz)" -> " VD: Luz ".
    .replace(new RegExp(String.raw`\(\s*(${ROLE_CODE}[^)]*)\)`, 'gi'), ' $1 ')
    // Any other parenthetical is a note about the person, not a name.
    .replace(/\([^)]*\)/g, ' ')
    // A slash between two names separates them; inside numbers (11/5) it doesn't.
    .replace(/(?<=[A-Za-z])\s*\/\s*(?=[A-Za-z])/g, ' + ')
    // Break before every role code, even without a comma.
    .replace(new RegExp(String.raw`\s+(?=${ROLE_CODE})`, 'gi'), ',');

  // A person's name is its leading words; trailing lowercase words are a note
  // ("Luz for event" -> "Luz"). A name that is only a role code ("V2: VD")
  // refers to another role, not a person.
  const cleanName = (raw: string): string => {
    const words = raw.replace(/^[:\s]+/, '').trim().split(/\s+/).filter(Boolean);
    const kept: string[] = [];
    for (const w of words) {
      if (kept.length && /^[a-z]/.test(w)) break;
      kept.push(w);
    }
    return kept.join(' ');
  };

  type Segment = { role: 'driver' | 'volunteer'; van: boolean; names: string[]; head: string };
  const segments: Segment[] = [];
  let current: Segment | null = null;
  const addTo = (seg: Segment, raw: string) => {
    const name = cleanName(raw);
    if (!name) return;
    if (roleFor(name)) {
      out.unread.push(`${seg.head}: ${name}`);
      return;
    }
    seg.names.push(name);
  };
  for (const token of cell.split(/[,;\n&+]|\s+and\s+/i).map((t) => t.trim())) {
    if (!token) continue;
    const colon = token.indexOf(':');
    const head = colon >= 0 ? token.slice(0, colon) : token;
    const hit = roleFor(head);
    if (hit) {
      current = { role: hit.role, van: hit.van, names: [], head: head.trim() };
      segments.push(current);
      addTo(current, colon >= 0 ? token.slice(colon + 1) : '');
    } else if (current) {
      addTo(current, token);
    } else {
      out.unread.push(token);
    }
  }

  // "D: (VD: Luz)" = one driver slot, filled by the van driver: a nameless
  // driver code straight before a van-driver code is its label, not a slot.
  const merged = segments.filter(
    (seg, i) =>
      !(seg.role === 'driver' && !seg.van && seg.names.length === 0 && segments[i + 1]?.role === 'driver' && segments[i + 1]?.van)
  );
  for (const seg of merged) {
    const r = out[seg.role];
    r.listed = true;
    r.slots += 1;
    r.names.push(...seg.names);
    if (seg.role === 'driver') {
      if (seg.van) {
        out.driver.van = true;
        out.driver.vanNames.push(...seg.names);
      } else {
        out.driver.plainListed = true;
      }
    }
  }
  // A code with nothing at all (a label merged away) still means the role is listed.
  for (const seg of segments) out[seg.role].listed = true;
  return out;
}

const SANDWICH_TYPE_KEYS: Record<string, string> = {
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

/** Split "Deli & PBJ" / "Turkey, Ham" / "Deli/PBJ" into normalized type keys. */
export function parseSheetSandwichTypes(raw: unknown): string[] {
  const s = clean(raw).toLowerCase();
  if (!s) return [];
  // "pb&j" contains "&", so protect it before splitting on "&".
  const protectedStr = s.replace(/pb\s*&\s*j/g, 'pbj');
  const parts = protectedStr
    .split(/[,&/+]|\band\b/)
    .map((p) => p.trim())
    .filter(Boolean);
  const keys = parts.map((p) => SANDWICH_TYPE_KEYS[p] ?? p.replace(/\s+/g, '_'));
  return Array.from(new Set(keys));
}

function appSandwichTypeKeys(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const keys = arr
    .map((t: any) => clean(t?.type).toLowerCase())
    .filter((t) => t && t !== 'unknown')
    .map((t) => SANDWICH_TYPE_KEYS[t] ?? t.replace(/\s+/g, '_'));
  return Array.from(new Set(keys));
}

const TYPE_LABELS: Record<string, string> = {
  pbj: 'PBJ',
  deli: 'Deli',
  deli_turkey: 'Turkey',
  deli_ham: 'Ham',
  chicken: 'Chicken',
};
const typeLabel = (k: string) =>
  TYPE_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// People matching
// ---------------------------------------------------------------------------

const lower = (s: string) => s.trim().toLowerCase();

function userFullName(u: MatchableUser): string {
  return clean(u.displayName) || `${clean(u.firstName)} ${clean(u.lastName)}`.trim();
}

/**
 * Does a name typed on the sheet refer to this app assignee?
 * The push writes full names, but people type first names ("Katie").
 */
function nameMatchesAssignee(sheetName: string, assigneeName: string): boolean {
  const a = lower(sheetName);
  const b = lower(assigneeName);
  if (!a || !b) return false;
  if (a === b) return true;
  // Single-word sheet name matches the assignee's first word.
  if (!a.includes(' ') && b.split(/\s+/)[0] === a) return true;
  return false;
}

/**
 * Resolve a new sheet name to a user ID. Only returns an ID when exactly one
 * active user matches; otherwise keeps the typed name as text (the assignment
 * columns accept free-text names, same as the existing sheet import).
 */
export function resolveSheetName(name: string, allUsers: MatchableUser[]): string {
  const n = lower(name);
  if (!n) return name;
  const users = allUsers.filter((u) => u.isActive !== false);
  const full = users.filter(
    (u) =>
      (u.displayName && lower(u.displayName) === n) ||
      lower(`${clean(u.firstName)} ${clean(u.lastName)}`) === n
  );
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return name.trim();
  const first = users.filter((u) => u.firstName && lower(u.firstName) === n);
  return first.length === 1 ? first[0].id : name.trim();
}

/** Name the app would show for an assignment entry (user ID or free text). */
function assigneeName(idOrName: string, usersById: Map<string, MatchableUser>): string {
  const u = usersById.get(idOrName);
  return u ? userFullName(u) : idOrName;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const ROLE_CONFIG = {
  driver: {
    label: 'Drivers',
    ids: 'assignedDriverIds',
    needed: 'driversNeeded',
    details: 'driverDetails',
  },
  volunteer: {
    label: 'Volunteers',
    ids: 'assignedVolunteerIds',
    needed: 'volunteersNeeded',
    details: 'volunteerDetails',
  },
} as const;

function describeStaff(needed: number, names: string[]): string {
  if (needed <= 0 && names.length === 0) return 'not needed';
  if (names.length === 0) return `needed (${needed}), nobody assigned`;
  const open = Math.max(0, needed - names.length);
  return open > 0 ? `${names.join(', ')} (+${open} open)` : names.join(', ');
}

function asDetailsObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function buildRowUpdatePlan(
  event: RowUpdateEvent,
  row: SheetRowData,
  users: MatchableUser[]
): RowUpdatePlan {
  const changes: RowChange[] = [];
  const notes: string[] = [];
  let sheetRangeType: string | null | undefined;
  const updates: Record<string, unknown> = {};
  // Every DB write is recorded under the change it belongs to, so a person
  // can apply some changes and skip others.
  const updatesByField: Record<string, Record<string, unknown>> = {};
  const set = (field: string, key: string, value: unknown) => {
    updates[key] = value;
    (updatesByField[field] ??= {})[key] = value;
  };

  // --- Date (update) ---------------------------------------------------------
  const sheetDate = normalizeSheetDate(row.date);
  const appDate = toDateOnlyString(getEffectiveEventDate(event) as any);
  if (sheetDate && sheetDate !== appDate) {
    changes.push({ field: 'scheduledEventDate', label: 'Date', from: appDate, to: sheetDate, kind: appDate ? 'update' : 'fill' });
    set('scheduledEventDate', 'scheduledEventDate', parseDateOnly(sheetDate));
  } else if (!sheetDate && clean(row.date)) {
    notes.push(`Couldn't read the date "${clean(row.date)}", so the date was left alone.`);
  }

  // --- Times (update; blank never clears) ------------------------------------
  const timeFields: [keyof RowUpdateEvent, keyof SheetRowData, string][] = [
    ['eventStartTime', 'Event Start time (MUST when volunteer needed)', 'Start time'],
    ['eventEndTime', 'Event end time (MUST when volunteer needed)', 'End time'],
    ['pickupTime', 'Pick up time', 'Pick-up time'],
  ];
  for (const [field, col, label] of timeFields) {
    const rawSheet = clean(row[col]);
    if (!rawSheet) continue;
    const sheetT = normalizeTime(rawSheet);
    if (!sheetT) {
      notes.push(`${label} "${rawSheet}" isn't a time the app can read, so it was left alone.`);
      continue;
    }
    const appRaw = event[field] as string | null;
    if (normalizeTime(appRaw) === sheetT) continue;
    changes.push({ field, label, from: appRaw ? displayTime(appRaw) : '', to: displayTime(sheetT), kind: appRaw ? 'update' : 'fill' });
    set(field, field, sheetT);
  }

  // --- Sandwich estimate (update) --------------------------------------------
  const estRaw = row['Estimate # sandwiches'];
  if (clean(estRaw)) {
    const parsed = parseSandwichCountInput(estRaw as any);
    if (parsed.count && parsed.count > 0) {
      const appMin = event.estimatedSandwichCountMin ?? null;
      const appMax = event.estimatedSandwichCountMax ?? null;
      const appHasRange = appMin !== null || appMax !== null;
      // Read the app's estimate the way the app shows it: a range only counts
      // when it's ACTIVE (both bounds, and no exact count that disagrees with
      // the midpoint). Stale bounds next to an exact count are ignored there,
      // so they're ignored here too.
      const appRangeActive = hasActiveSandwichRange(appMin, appMax, event.estimatedSandwichCount);
      const same = parsed.isRange
        ? appRangeActive && appMin === parsed.min && appMax === parsed.max
        : event.estimatedSandwichCount === parsed.count && !appHasRange;
      if (!same) {
        const appShown = appRangeActive
          ? `${appMin}–${appMax}`
          : event.estimatedSandwichCount ? String(event.estimatedSandwichCount) : '';
        changes.push({
          field: 'estimatedSandwichCount',
          label: 'Sandwich estimate',
          from: appShown,
          to: parsed.isRange ? `${parsed.min}–${parsed.max}` : String(parsed.count),
          kind: appShown ? 'update' : 'fill',
        });
        set('estimatedSandwichCount', 'estimatedSandwichCount', parsed.count);
        set('estimatedSandwichCount', 'estimatedSandwichCountMin', parsed.min);
        set('estimatedSandwichCount', 'estimatedSandwichCountMax', parsed.max);
        // An exact number takes the event out of range mode (as the form does).
        if (!parsed.isRange && event.estimatedSandwichRangeType) {
          set('estimatedSandwichCount', 'estimatedSandwichRangeType', null);
        }
        // Keep the per-type breakdown adding up to the new total, so cards
        // don't keep showing the old quantities. A types change, if picked
        // too, replaces this (selectUpdates).
        const existing = appSandwichTypeArray(event.sandwichTypes);
        if (existing.length) {
          set('estimatedSandwichCount', 'sandwichTypes', rescaleTypes(existing, parsed.count));
        } else if (!parsed.isRange && event.estimatedSandwichRangeType) {
          // A range-mode event keeps its only type in the range type, which an
          // exact number clears. Carry it into the breakdown so the type isn't lost.
          set('estimatedSandwichCount', 'sandwichTypes', [
            { type: event.estimatedSandwichRangeType, quantity: parsed.count },
          ]);
        }
        // Going into range mode: name the event's one existing type, if it has
        // exactly one (a ticked types change still decides, in selectUpdates).
        if (parsed.isRange && !event.estimatedSandwichRangeType) {
          const keys = appSandwichTypeKeys(event.sandwichTypes);
          if (keys.length === 1) set('estimatedSandwichCount', 'estimatedSandwichRangeType', keys[0]);
        }
      }
    } else {
      notes.push(`Sandwich estimate "${clean(estRaw)}" isn't a number, so it was left alone.`);
    }
  }

  // --- Sandwich types (update when the SET of types differs) -----------------
  const sheetTypes = parseSheetSandwichTypes(row['Deli or PBJ?']);
  if (sheetTypes.length > 0) {
    const appTypes = appSandwichTypeKeys(event.sandwichTypes);
    const same =
      sheetTypes.length === appTypes.length && sheetTypes.every((t) => appTypes.includes(t));
    if (!same) {
      const total =
        (updates.estimatedSandwichCount as number | undefined) ?? appEstimateTotal(event);
      const per = Math.floor(total / sheetTypes.length);
      set('sandwichTypes', 'sandwichTypes', sheetTypes.map((type, i) => ({
        type,
        quantity: i === sheetTypes.length - 1 ? total - per * (sheetTypes.length - 1) : per,
      })));
      changes.push({
        field: 'sandwichTypes',
        label: 'Sandwich types',
        from: appTypes.map(typeLabel).join(', '),
        to: sheetTypes.map(typeLabel).join(', '),
        kind: appTypes.length ? 'update' : 'fill',
      });
      // Range-mode estimates name ONE type: the sheet's type when it lists one,
      // none when it lists several (the breakdown carries them). Whether the
      // event ends up in range mode depends on which changes are ticked, so
      // selectUpdates applies this.
      sheetRangeType = sheetTypes.length === 1 ? sheetTypes[0] : null;
      if (sheetTypes.length > 1 && total > 0) {
        notes.push('Sandwich types changed, so the count was split evenly between them. Adjust per-type numbers in the app if needed.');
      }
    }
  }

  // --- Final count (update; reference-only field) ----------------------------
  const finalRaw = row['Final # sandwiches made'];
  if (clean(finalRaw)) {
    const parsed = parseSandwichCountInput(finalRaw as any);
    if (parsed.count && parsed.count > 0 && parsed.count !== event.actualSandwichCount) {
      changes.push({
        field: 'actualSandwichCount',
        label: 'Final # sandwiches (reference only)',
        from: event.actualSandwichCount ? String(event.actualSandwichCount) : '',
        to: String(parsed.count),
        kind: event.actualSandwichCount ? 'update' : 'fill',
      });
      set('actualSandwichCount', 'actualSandwichCount', parsed.count);
      // Cards show the final breakdown before the count, so keep it adding up.
      const actualTypes = appSandwichTypeArray(event.actualSandwichTypes);
      if (actualTypes.length) {
        set('actualSandwichCount', 'actualSandwichTypes', rescaleTypes(actualTypes, parsed.count));
      }
    }
  }

  // --- Contact + location (FILL-ONLY) ----------------------------------------
  const fill = (field: keyof RowUpdateEvent, label: string, sheetVal: string) => {
    const appVal = clean(event[field]);
    if (!sheetVal) return;
    if (!appVal) {
      changes.push({ field, label, from: '', to: sheetVal, kind: 'fill' });
      set(field, field, sheetVal);
    } else if (lower(appVal) !== lower(sheetVal)) {
      notes.push(`${label} differs (app: "${appVal}", sheet: "${sheetVal}"). The app keeps its value. Change it in the app if the sheet is right.`);
    }
  };
  const contact = clean(row['Contact Name']);
  if (contact) {
    const [first, ...rest] = contact.split(/\s+/);
    fill('firstName', 'Contact first name', first);
    if (rest.length) fill('lastName', 'Contact last name', rest.join(' '));
  }
  fill('email', 'Contact email', clean(row['Email Address']));
  fill('phone', 'Contact phone', clean(row['Contact Cell Number']));
  fill('eventAddress', 'Address', clean(row.Address));
  fill('deliveryDestination', 'Recipient / host home', clean(row['Planned Recipient/Host Home']));

  // --- Staffing (update) -----------------------------------------------------
  // A blank Staffing cell means "not filled in", so leave staffing alone.
  const staffingCell = staffingCellOf(row);
  const staffingRead = clean(staffingCell) ? parsePlanningStaffing(staffingCell) : null;
  if (staffingRead && !staffingRead.driver.listed && !staffingRead.volunteer.listed) {
    // Something is in the cell but no role code could be read from it. Never
    // treat that as "roles removed": leave staffing alone and say so.
    notes.push(
      `Couldn't read the staffing cell ("${clean(staffingCell)}"), so drivers and volunteers were left alone. Use codes like D: / V: (numbered D1: / V2: is fine).`
    );
  } else if (staffingRead) {
    const staffing = staffingRead;
    const usersById = new Map(users.map((u) => [u.id, u]));
    // Part of the cell couldn't be read: show it, and don't remove a role that
    // might be hiding in it.
    const partlyUnread = staffing.unread.length > 0;
    if (partlyUnread) {
      notes.push(`Part of the staffing cell wasn't understood and was ignored: "${staffing.unread.join('", "')}".`);
    }

    // Speakers were retired (folded into volunteers), so the speaker columns
    // are never touched here.
    for (const role of ['driver', 'volunteer'] as const) {
      const cfg = ROLE_CONFIG[role];
      const sheet = staffing[role];
      const appIds = ((event[cfg.ids] as string[] | null) ?? []).filter(Boolean);
      const appNeeded = (event[cfg.needed] as number | null) ?? 0;
      const appNames = appIds.map((id) => assigneeName(id, usersById));

      let newIds: string[];
      let newNeeded: number;
      if (!sheet.listed) {
        // Role was taken off the sheet (only trusted when the whole cell was read).
        if (partlyUnread) continue;
        newIds = [];
        newNeeded = 0;
      } else {
        // Keep existing assignees the sheet still lists (by name), add new ones.
        const kept = new Set<string>();
        newIds = sheet.names.map((name) => {
          const idx = appIds.findIndex((id, i) => !kept.has(id) && nameMatchesAssignee(name, appNames[i]));
          if (idx >= 0) {
            kept.add(appIds[idx]);
            return appIds[idx];
          }
          return resolveSheetName(name, users);
        });
        newIds = Array.from(new Set(newIds));
        // Numbered slots count too ("D1: Karen, D2:" = 2 drivers, 1 assigned).
        newNeeded = Math.max(appNeeded, sheet.slots, newIds.length, 1);
      }

      const changeField = role === 'driver' ? 'drivers' : 'volunteers';
      const sameIds =
        newIds.length === appIds.length && newIds.every((id) => appIds.includes(id));
      if (sameIds && newNeeded === appNeeded) continue;

      changes.push({
        field: changeField,
        label: cfg.label,
        from: describeStaff(appNeeded, appNames),
        to: describeStaff(newNeeded, newIds.map((id) => assigneeName(id, usersById))),
        kind: appIds.length === 0 && appNeeded === 0 ? 'fill' : 'update',
      });
      set(changeField, cfg.needed, newNeeded);
      if (!sameIds) {
        set(changeField, cfg.ids, newIds.length ? newIds : null);
        // Keep per-person details for people who stay; new people start empty.
        const oldDetails = asDetailsObject(event[cfg.details]);
        set(changeField, cfg.details, newIds.length
          ? Object.fromEntries(newIds.map((id) => [id, oldDetails[id] ?? {}]))
          : null);
        const unmatched = newIds.filter((id) => !usersById.has(id) && !appIds.includes(id));
        if (unmatched.length) {
          notes.push(`${cfg.label}: couldn't match ${unmatched.map((n) => `"${n}"`).join(', ')} to one app user, so they're saved as typed names.`);
        }
      }
    }

    if (staffing.driver.van && !event.vanDriverNeeded) {
      changes.push({ field: 'vanDriverNeeded', label: 'Van driver needed', from: 'No', to: 'Yes', kind: 'update' });
      set('vanDriverNeeded', 'vanDriverNeeded', true);
    }

    // Names under VD also fill the app's free-text van driver, unless a real
    // van driver (user) is linked in the app, which the sheet can't express.
    const vanName = staffing.driver.vanNames.join(', ');
    const appVanName = clean(event.customVanDriverName);
    if (vanName && !event.assignedVanDriverId && lower(vanName) !== lower(appVanName)) {
      changes.push({ field: 'vanDriver', label: 'Van driver', from: appVanName, to: vanName, kind: appVanName ? 'update' : 'fill' });
      set('vanDriver', 'customVanDriverName', vanName);
    }
  }

  // --- Cancelled (one-way) --------------------------------------------------
  // Events sometimes get marked cancelled only on the sheet. A "yes" in the
  // Cancelled column cancels the app event. It never un-cancels (a blank or
  // "no" cell changes nothing), and a completed event is left for a person.
  const cancelCell = lower(clean(row.Cancelled));
  const sheetCancelled = ['yes', 'y', 'cancelled', 'canceled', 'true', 'x'].includes(cancelCell);
  if (sheetCancelled && event.status !== 'cancelled') {
    if (event.status === 'completed') {
      notes.push('The sheet says cancelled, but the app has this event as completed. Change it in the app if the sheet is right.');
    } else {
      const from = STATUS_LABELS[event.status] ?? event.status;
      changes.push({ field: 'status', label: 'Status', from, to: 'Cancelled', kind: 'update' });
      set('status', 'status', 'cancelled');
      // statusChangedAt / cancelledAt are stamped by the route at apply time,
      // so the plan (and its token) stays the same between preview and apply.
      // Cancelling needs a recorded reason (shared/event-status-workflow.ts).
      if (!clean(event.cancelledReason)) {
        set('status', 'cancelledReason', 'Marked cancelled on the planning sheet');
      }
    }
  } else if (event.status === 'cancelled' && ['no', 'n', 'false'].includes(cancelCell)) {
    notes.push('The sheet says not cancelled, but the app has this event as cancelled. Change it in the app if the event is back on.');
  }

  // --- Planning notes (APPEND-ONLY) -----------------------------------------
  // Sheet notes are added to the end of planning notes, never replacing them.
  // Only text the event doesn't already have is added, and text the app itself
  // pushed to the sheet (the request message in ALL DETAILS, the next action in
  // Waiting On) is skipped so it doesn't echo back.
  const already = squash(
    [event.planningNotes, event.message, event.nextAction].filter(Boolean).join('\n')
  );
  const newParts = sheetNoteParts(row).filter((part) => {
    const body = squash(part.replace(/^(Notes|Additional Notes|Waiting On): /, ''));
    return body && !already.includes(body);
  });
  if (newParts.length) {
    const appNotes = clean(event.planningNotes);
    const added = newParts.join('\n\n');
    changes.push({
      field: 'planningNotes',
      label: appNotes ? 'Planning notes (added to the end)' : 'Planning notes',
      from: '',
      to: added,
      kind: appNotes ? 'update' : 'fill',
    });
    set('planningNotes', 'planningNotes', appNotes ? `${appNotes}\n\n${added}` : added);
  }

  return { changes, updates, updatesByField, notes, sheetRangeType };
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  in_process: 'In process',
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  non_event: 'Non-event',
  standby: 'Standby',
  stalled: 'Stalled',
};

const squash = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when a cell is only a row ID (UUID), like the planning sheet's sync_id column. */
export function isRowIdOnly(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * The sheet's note columns as planning-notes paragraphs. Same format the
 * "send row to app" create path has always used, so both paths agree.
 */
export function sheetNoteParts(row: {
  'ALL DETAILS'?: string;
  Notes?: string;
  "Add'l Notes"?: string;
  'Waiting On'?: string;
}): string[] {
  const parts: string[] = [];
  // A cell holding nothing but a row ID is the sheet's sync_id (column AA,
  // which older scripts sent as "Add'l Notes"), not a note. Skip it.
  const note = (v: unknown) => {
    const t = clean(v);
    return isRowIdOnly(t) ? '' : t;
  };
  const details = note(row['ALL DETAILS']);
  const notesCell = note(row.Notes);
  const addl = note(row["Add'l Notes"]);
  const waiting = note(row['Waiting On']);
  if (details) parts.push(details);
  if (notesCell) parts.push(`Notes: ${notesCell}`);
  if (addl) parts.push(`Additional Notes: ${addl}`);
  if (waiting) parts.push(`Waiting On: ${waiting}`);
  return parts;
}

/**
 * Build the DB patch for just the changes a person ticked.
 * Throws if a field isn't one of this plan's changes.
 */
export function selectUpdates(
  plan: RowUpdatePlan,
  fields: string[],
  event: Pick<
    RowUpdateEvent,
    'estimatedSandwichCount' | 'estimatedSandwichCountMin' | 'estimatedSandwichCountMax' | 'estimatedSandwichRangeType'
  >
): { changes: RowChange[]; updates: Record<string, unknown> } {
  const known = new Set(plan.changes.map((c) => c.field));
  const unknown = fields.filter((f) => !known.has(f));
  if (unknown.length) {
    throw new Error(`Not part of this update: ${unknown.join(', ')}`);
  }
  const chosen = new Set(fields);
  const updates: Record<string, unknown> = {};
  // A picked types change is applied last so its breakdown wins over the
  // estimate's rescaled one.
  for (const f of chosen) if (f !== 'sandwichTypes') Object.assign(updates, plan.updatesByField[f]);
  if (chosen.has('sandwichTypes')) Object.assign(updates, plan.updatesByField.sandwichTypes);
  // Range type, decided from what was actually ticked:
  // - the event's range state after this apply (the ticked estimate's, else the current one)
  // - an exact estimate means no range mode, so no range type
  // - in range mode with a ticked types change, the sheet's single type (or none)
  const endsInRange = chosen.has('estimatedSandwichCount')
    ? updates.estimatedSandwichCountMin != null || updates.estimatedSandwichCountMax != null
    : (event.estimatedSandwichCountMin ?? null) !== null || (event.estimatedSandwichCountMax ?? null) !== null;
  if (!endsInRange) {
    if (chosen.has('estimatedSandwichCount') && event.estimatedSandwichRangeType) {
      updates.estimatedSandwichRangeType = null;
    }
  } else if (chosen.has('sandwichTypes') && plan.sheetRangeType !== undefined) {
    if (plan.sheetRangeType !== (event.estimatedSandwichRangeType ?? null)) {
      updates.estimatedSandwichRangeType = plan.sheetRangeType;
    }
  }

  // Types were split using the NEW estimate. If the estimate was left out,
  // re-split them using the count the app keeps.
  if (chosen.has('sandwichTypes') && !chosen.has('estimatedSandwichCount') && Array.isArray(updates.sandwichTypes)) {
    const types = updates.sandwichTypes as { type: string; quantity: number }[];
    const total = appEstimateTotal(event);
    const per = Math.floor(total / types.length);
    updates.sandwichTypes = types.map((t, i) => ({
      type: t.type,
      quantity: i === types.length - 1 ? total - per * (types.length - 1) : per,
    }));
  }
  return { changes: plan.changes.filter((c) => chosen.has(c.field)), updates };
}

/**
 * Fingerprint of a plan. The preview returns it and the apply must send it
 * back: if the app or the sheet row changed in between, the recomputed plan
 * won't match and the apply is refused instead of writing something the
 * person never saw.
 */
export function planToken(
  event: Pick<RowUpdateEvent, 'id' | 'updatedAt'>,
  plan: Pick<RowUpdatePlan, 'changes' | 'updatesByField'>
): string {
  const revision = event.updatedAt ? new Date(event.updatedAt as any).getTime() : null;
  // The labels AND the exact values that would be written, plus the event's
  // revision: an app save after the preview, or a change in what would be
  // written (e.g. per-type quantities), produces a different token.
  const canonical = JSON.stringify([
    event.id,
    revision,
    plan.changes.map((c) => [c.field, c.from, c.to]),
    plan.updatesByField,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** The event's stored per-type breakdown (array or legacy JSON string). */
function appSandwichTypeArray(raw: unknown): { type: string; quantity: number }[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((t: any) => t && typeof t === 'object' && clean(t.type))
    .map((t: any) => ({ ...t, type: String(t.type), quantity: Number(t.quantity) || 0 }));
}

/** Scale a breakdown to a new total, keeping its proportions (even split if it had none). */
function rescaleTypes(types: { type: string; quantity: number }[], total: number) {
  const sum = types.reduce((n, t) => n + (t.quantity > 0 ? t.quantity : 0), 0);
  // Round the running total, not each share, so the parts always add up to
  // exactly `total` and none goes negative (100/100/100/1 -> 101 = 34/33/34/0).
  let cumShare = 0;
  let given = 0;
  return types.map((t, i) => {
    cumShare += sum > 0 ? (t.quantity > 0 ? t.quantity : 0) / sum : 1 / types.length;
    const upTo = i === types.length - 1 ? total : Math.round(total * cumShare);
    const quantity = upTo - given;
    given = upTo;
    return { ...t, quantity };
  });
}

/** The app's current planned total: exact count, else the range midpoint. */
function appEstimateTotal(
  event: Pick<RowUpdateEvent, 'estimatedSandwichCount' | 'estimatedSandwichCountMin' | 'estimatedSandwichCountMax'>
): number {
  return (
    event.estimatedSandwichCount ??
    getRangeMidpoint(event.estimatedSandwichCountMin, event.estimatedSandwichCountMax) ??
    0
  );
}

/**
 * The staffing cell from a sheet payload. The planning sheet's Apps Script
 * sends it as 'Volunteer/Driver Needed' (the sheet header); 'Staffing' is
 * accepted too.
 */
export function staffingCellOf(row: {
  Staffing?: string;
  'Volunteer/Driver Needed'?: string;
}): string {
  return clean(row['Volunteer/Driver Needed']) || clean(row.Staffing);
}

/**
 * Staffing fields for a NEW event created from a planning-sheet row
 * (the "send row to app" create path). Same reading as the update flow, so
 * an event created from a row and then updated from the same row shows no
 * staffing changes.
 */
export function staffingForNewEvent(raw: unknown) {
  const s = parsePlanningStaffing(raw);
  const need = (r: { listed: boolean; slots: number; names: string[] }) =>
    r.listed ? Math.max(1, r.slots, r.names.length) : 0;
  return {
    driversNeeded: need(s.driver),
    speakersNeeded: 0, // retired role; "S" is counted under volunteers
    volunteersNeeded: need(s.volunteer),
    vanDriverNeeded: s.driver.van,
    assignedDriverNames: s.driver.names,
    assignedSpeakerNames: [] as string[],
    assignedVolunteerNames: s.volunteer.names,
    customVanDriverName: s.driver.vanNames.length ? s.driver.vanNames.join(', ') : null,
  };
}

/**
 * Sandwich types for a NEW event: the app's own type keys ("pbj",
 * "deli_turkey", ...) as a real array, with the count split evenly.
 */
export function sandwichTypesForNewEvent(
  raw: unknown,
  total: number | null | undefined
): { type: string; quantity: number }[] | null {
  const types = parseSheetSandwichTypes(raw);
  if (types.length === 0) return null;
  const count = total ?? 0;
  const per = Math.floor(count / types.length);
  return types.map((type, i) => ({
    type,
    quantity: i === types.length - 1 ? count - per * (types.length - 1) : per,
  }));
}

/** Lowercase, trim, collapse whitespace — for matching group names. */
export function normalizeGroupName(name: string | null | undefined): string {
  return clean(name).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * pickupDateTime is a local "YYYY-MM-DDTHH:MM:SS" string. When the event date
 * moves, move the pick-up date by the same number of days so a same-day (or
 * next-day) pickup stays that way.
 */
export const shiftPickupDateTime = (pickup: string, fromDay: string, toDay: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(pickup);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return null;
  const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const shifted = new Date(utc(m[1]) + (utc(toDay) - utc(fromDay)));
  return shifted.toISOString().slice(0, 10) + m[2];
};

