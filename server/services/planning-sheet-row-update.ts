import { createHash } from 'crypto';
import { parseDateOnly, toDateOnlyString } from '@shared/date-utils';
import { getEffectiveEventDate } from '@shared/event-validation-utils';
import { parseSandwichCountInput } from '@shared/sandwich-count-utils';

/**
 * Planning sheet → app UPDATE ("send row to app" on a row that already exists).
 *
 * The app pushes an event to the planning sheet, then the team keeps editing
 * that row on the sheet (times get added, the date moves, sandwich numbers and
 * types change, drivers/speakers/volunteers get assigned). This module works
 * out what the app should change to match the sheet row.
 *
 * It is deliberately MANUAL and field-scoped:
 * - Nothing here runs on a timer. A person clicks "send row to app" on the
 *   sheet, sees the changes, and confirms.
 * - Only the fields below can change. Status, TSP contact, notes and anything
 *   else on the event are never touched.
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
  actualSandwichCount: number | null;
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
}

/** A sheet row as the Apps Script sends it (same keys as /import-from-sheets). */
export interface SheetRowData {
  date: string;
  'Group Name': string;
  'Event Start time (MUST when volunteer needed)'?: string;
  'Event end time (MUST when volunteer needed)'?: string;
  'Pick up time'?: string;
  Staffing?: string;
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

/** Sheet date → "YYYY-MM-DD". Accepts YYYY-MM-DD, M/D/YY and M/D/YYYY. */
export function normalizeSheetDate(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
  driver: { listed: boolean; names: string[]; van: boolean; vanNames: string[]; plainListed: boolean };
  speaker: { listed: boolean; names: string[] };
  volunteer: { listed: boolean; names: string[] };
}

/**
 * Parse the planning-sheet Staffing cell.
 *
 * Handles every format the push writes and people type:
 *   "D, S"                  → driver + speaker needed, nobody assigned
 *   "D: , S: "              → same (this is what the push writes for "needed")
 *   "D: Katie, Kim, S: Ann" → drivers Katie AND Kim, speaker Ann
 *   "VD: Luz"               → van driver Luz
 *
 * A token that isn't a role code continues the previous role's name list,
 * which is how the push writes multiple people ("D: Katie, Kim").
 */
export function parsePlanningStaffing(raw: unknown): ParsedStaffing {
  const out: ParsedStaffing = {
    driver: { listed: false, names: [], van: false, vanNames: [], plainListed: false },
    speaker: { listed: false, names: [] },
    volunteer: { listed: false, names: [] },
  };
  const s = clean(raw);
  if (!s) return out;

  let current: 'driver' | 'speaker' | 'volunteer' | null = null;
  let inVan = false;
  const addName = (role: 'driver' | 'speaker' | 'volunteer', name: string) => {
    const n = name.trim();
    if (!n) return;
    out[role].names.push(n);
    if (role === 'driver' && inVan) out.driver.vanNames.push(n);
  };
  const roleFor = (code: string) => {
    const c = code.trim().toUpperCase();
    if (c === 'D' || c === 'VD') return 'driver' as const;
    if (c === 'S') return 'speaker' as const;
    if (c === 'V') return 'volunteer' as const;
    return null;
  };

  // Names can be separated by commas, semicolons, new lines, "&" or "and"
  // ("D: Katie & Kim", "V: Ann and Bo"). "and" only counts as a whole word, so
  // names like "Anderson" or "Sandy" stay intact.
  for (const token of s.split(/[,;\n&]|\s+and\s+/i).map((t) => t.trim())) {
    if (!token) continue;
    const colon = token.indexOf(':');
    const head = colon >= 0 ? token.slice(0, colon) : token;
    const role = roleFor(head);
    if (role) {
      current = role;
      out[role].listed = true;
      inVan = role === 'driver' && head.trim().toUpperCase() === 'VD';
      if (inVan) out.driver.van = true;
      else if (role === 'driver') out.driver.plainListed = true;
      addName(role, colon >= 0 ? token.slice(colon + 1) : '');
    } else if (current) {
      addName(current, token.replace(/^[:\s]+/, ''));
    }
  }
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
export function resolveSheetName(name: string, users: MatchableUser[]): string {
  const n = lower(name);
  if (!n) return name;
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
  speaker: {
    label: 'Speakers',
    ids: 'assignedSpeakerIds',
    needed: 'speakersNeeded',
    details: 'speakerDetails',
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
      if (parsed.count !== event.estimatedSandwichCount) {
        changes.push({
          field: 'estimatedSandwichCount',
          label: 'Sandwich estimate',
          from: event.estimatedSandwichCount ? String(event.estimatedSandwichCount) : '',
          to: parsed.isRange ? `${parsed.count} (${parsed.min}–${parsed.max})` : String(parsed.count),
          kind: event.estimatedSandwichCount ? 'update' : 'fill',
        });
        set('estimatedSandwichCount', 'estimatedSandwichCount', parsed.count);
        set('estimatedSandwichCount', 'estimatedSandwichCountMin', parsed.min);
        set('estimatedSandwichCount', 'estimatedSandwichCountMax', parsed.max);
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
        (updates.estimatedSandwichCount as number | undefined) ?? event.estimatedSandwichCount ?? 0;
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
  if (clean(staffingCell)) {
    const staffing = parsePlanningStaffing(staffingCell);
    const usersById = new Map(users.map((u) => [u.id, u]));

    for (const role of ['driver', 'speaker', 'volunteer'] as const) {
      const cfg = ROLE_CONFIG[role];
      const sheet = staffing[role];
      const appIds = ((event[cfg.ids] as string[] | null) ?? []).filter(Boolean);
      const appNeeded = (event[cfg.needed] as number | null) ?? 0;
      const appNames = appIds.map((id) => assigneeName(id, usersById));

      let newIds: string[];
      let newNeeded: number;
      if (!sheet.listed) {
        // Role was taken off the sheet.
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
        newNeeded = Math.max(appNeeded, newIds.length, 1);
      }

      const changeField = role === 'driver' ? 'drivers' : role === 'speaker' ? 'speakers' : 'volunteers';
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

  return { changes, updates, updatesByField, notes };
}

/**
 * Build the DB patch for just the changes a person ticked.
 * Throws if a field isn't one of this plan's changes.
 */
export function selectUpdates(
  plan: RowUpdatePlan,
  fields: string[],
  event: Pick<RowUpdateEvent, 'estimatedSandwichCount'>
): { changes: RowChange[]; updates: Record<string, unknown> } {
  const known = new Set(plan.changes.map((c) => c.field));
  const unknown = fields.filter((f) => !known.has(f));
  if (unknown.length) {
    throw new Error(`Not part of this update: ${unknown.join(', ')}`);
  }
  const chosen = new Set(fields);
  const updates: Record<string, unknown> = {};
  for (const f of chosen) Object.assign(updates, plan.updatesByField[f]);

  // Types were split using the NEW estimate. If the estimate was left out,
  // re-split them using the count the app keeps.
  if (chosen.has('sandwichTypes') && !chosen.has('estimatedSandwichCount') && Array.isArray(updates.sandwichTypes)) {
    const types = updates.sandwichTypes as { type: string; quantity: number }[];
    const total = event.estimatedSandwichCount ?? 0;
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
export function planToken(eventId: number, changes: RowChange[]): string {
  const canonical = JSON.stringify([eventId, changes.map((c) => [c.field, c.from, c.to])]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
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
  const need = (listed: boolean, n: number) => (listed ? Math.max(1, n) : 0);
  return {
    driversNeeded: need(s.driver.listed, s.driver.names.length),
    speakersNeeded: need(s.speaker.listed, s.speaker.names.length),
    volunteersNeeded: need(s.volunteer.listed, s.volunteer.names.length),
    vanDriverNeeded: s.driver.van,
    assignedDriverNames: s.driver.names,
    assignedSpeakerNames: s.speaker.names,
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
