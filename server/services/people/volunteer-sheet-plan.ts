/**
 * Volunteer sheet sync, planning half (people/places rebuild, step 7).
 *
 * Pure: takes the sheet rows and the current state of the database and
 * returns what should change, without touching anything. The apply half
 * (volunteer-sheet-sync.ts) writes the plan; `--dry-run` just prints it.
 *
 * Rules (docs/data-model.md, section 1):
 *   - matching: the email or name a row last synced, then email, then exact
 *     name or known spelling, then phone with a compatible name, then a
 *     nickname / 1-2 letter typo when it's the only candidate. Anything
 *     ambiguous is reported, never guessed.
 *   - name, email, phone: the three-way rule (rule 8). Blank sheet cells never
 *     clear app values. Malformed values and one-digit phone differences are
 *     sent for review, never applied. A name never overwrites a better-sourced
 *     one (rule 3); the sheet's spelling is kept as another spelling.
 *   - Status, Event Volunteer Email List, Location, Notes belong to the sheet
 *     and are copied to volunteer_profiles. is_volunteer is on unless Status
 *     is Inactive. An unrecognised Status or list value is reported and the
 *     old value kept.
 *   - Rows that match nobody become new people, flagged `new_from_sheet`.
 *     People who were on the sheet and aren't any more are flagged
 *     `not_on_sheet`; nothing about them changes.
 */
import {
  normName,
  normPhone,
  normEmail,
  levenshtein,
  isNickname,
  namesCompatible,
} from '@shared/person-matching';
import type { VolunteerAvailability, SheetSharedField, SheetConflictKind } from '@shared/schema';

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export const REQUIRED_COLUMNS = ['Name', 'Email', 'Phone', 'Status', 'Event Volunteer Email List'] as const;

export interface SheetRow {
  rowNumber: number; // 1-based row in the sheet, for messages
  name: string;
  email: string; // as typed
  phone: string; // as typed
  status: string;
  emailList: string;
  location: string;
  notes: string;
}

export interface PersonState {
  id: number;
  firstName: string;
  lastName: string;
  nameSource: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
}

export interface ProfileState {
  personId: number;
  availabilityStatus: VolunteerAvailability;
  onRecruitmentList: boolean;
  location: string | null;
  sheetNotes: string | null;
  onSheet: boolean;
}

export interface CurrentState {
  people: PersonState[];
  aliases: { personId: number; alias: string }[];
  profiles: ProfileState[];
  /** last synced values from this sheet */
  syncValues: { personId: number; field: SheetSharedField; value: string | null }[];
  /** open conflicts from this sheet, so the same one isn't raised twice */
  openConflicts: { personId: number; field: SheetSharedField; sheetValue: string | null }[];
  /** open not_on_sheet / new_from_sheet flags */
  openFlags: { id: number; personId: number; kind: 'not_on_sheet' | 'new_from_sheet' }[];
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface PersonUpdate {
  personId: number;
  display: string;
  set: Partial<{ firstName: string; lastName: string; nameSource: 'sheet'; email: string; phone: string; isVolunteer: boolean }>;
  addAlias?: string;
  profile: { availabilityStatus: VolunteerAvailability; onRecruitmentList: boolean; location: string | null; sheetNotes: string | null };
  profileChanged: boolean;
  isNewProfile: boolean;
  syncValues: { field: SheetSharedField; value: string }[];
  conflicts: { field: SheetSharedField; kind: SheetConflictKind; sheetValue: string; appValue: string | null }[];
  resolveNotOnSheetFlagIds: number[];
  changes: string[]; // plain-language list for the report
}

export interface NewPerson {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
  profile: { availabilityStatus: VolunteerAvailability; onRecruitmentList: boolean; location: string | null; sheetNotes: string | null };
  conflicts: { field: SheetSharedField; kind: SheetConflictKind; sheetValue: string }[];
}

export interface SyncPlan {
  rowsRead: number;
  updates: PersonUpdate[]; // matched people (including ones with nothing to change)
  newPeople: NewPerson[];
  missing: { personId: number; display: string; alreadyFlagged: boolean }[];
  problems: string[]; // rows or values the sync couldn't use
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanEmail(raw: string): { value: string | null; invalid: boolean } {
  const e = normEmail(raw);
  if (!e) return { value: null, invalid: false };
  return EMAIL_RE.test(e) ? { value: e, invalid: false } : { value: null, invalid: true };
}

/** A phone we'd actually dial: 10 digits, not a placeholder. Stored as digits. */
export function cleanPhone(raw: string): { value: string | null; invalid: boolean } {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { value: null, invalid: false };
  const d = normPhone(trimmed);
  const ok = d.length === 10 && !/^(\d)\1{9}$/.test(d) && d[0] !== '0' && d[0] !== '1';
  return ok ? { value: d, invalid: false } : { value: null, invalid: true };
}

export function parseStatus(raw: string): VolunteerAvailability | null {
  const s = (raw || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (s === 'active') return 'active';
  if (s === 'temporarily unavailable') return 'temporarily_unavailable';
  if (s === 'inactive') return 'inactive';
  return null;
}

export function parseYesNo(raw: string): boolean | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'yes' || s === 'y') return true;
  if (s === 'no' || s === 'n') return false;
  return null;
}

/** First token is the first name; the rest (parentheticals removed) is the last. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const cleaned = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || name.trim();
  const parts = cleaned.split(' ');
  return { firstName: parts[0] || name.trim(), lastName: parts.slice(1).join(' ') };
}

const fullName = (p: { firstName: string; lastName: string }) => [p.firstName, p.lastName].filter(Boolean).join(' ');

/** Phones that differ in exactly one digit: a likely typo, never auto-applied. */
export function oneDigitApart(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff === 1;
}

const NAME_RANK = ['self_verified', 'self_reported', 'admin_entered', 'sheet', 'legacy_import'];
/** May a sheet spelling replace this person's current name? (rule 3) */
const sheetMayRename = (nameSource: string) => NAME_RANK.indexOf(nameSource) >= NAME_RANK.indexOf('sheet');

const norm: Record<SheetSharedField, (v: string | null | undefined) => string> = {
  name: (v) => normName(v),
  email: (v) => normEmail(v),
  phone: (v) => normPhone(v),
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function planVolunteerSync(rows: SheetRow[], state: CurrentState): SyncPlan {
  const plan: SyncPlan = { rowsRead: rows.length, updates: [], newPeople: [], missing: [], problems: [] };

  const byId = new Map(state.people.map((p) => [p.id, p]));
  const profileOf = new Map(state.profiles.map((p) => [p.personId, p]));
  const lastOf = new Map<string, string | null>();
  state.syncValues.forEach((v) => lastOf.set(`${v.personId}|${v.field}`, v.value));
  const openConflict = new Set(state.openConflicts.map((c) => `${c.personId}|${c.field}|${norm[c.field](c.sheetValue)}`));
  const aliasesOf = new Map<number, string[]>();
  state.aliases.forEach((a) => aliasesOf.set(a.personId, [...(aliasesOf.get(a.personId) || []), normName(a.alias)]));
  const namesOf = (p: PersonState) => [normName(fullName(p)), ...(aliasesOf.get(p.id) || [])];

  const claimed = new Map<number, number>(); // personId -> rowNumber

  for (const row of rows) {
    const name = row.name.trim().replace(/\s+/g, ' ');
    if (!name) {
      if (row.email.trim() || row.phone.trim()) plan.problems.push(`Row ${row.rowNumber}: has contact details but no name; skipped.`);
      continue;
    }
    const email = cleanEmail(row.email);
    const phone = cleanPhone(row.phone);
    const status = parseStatus(row.status);
    const onList = parseYesNo(row.emailList);
    if (row.status.trim() && !status) {
      plan.problems.push(
        `Row ${row.rowNumber} (${name}): Status "${row.status.trim()}" isn't Active, Temporarily unavailable or Inactive; kept the previous status.`
      );
    }
    if (!row.status.trim()) plan.problems.push(`Row ${row.rowNumber} (${name}): Status is blank; kept the previous status.`);
    if (row.emailList.trim() && onList === null) {
      plan.problems.push(
        `Row ${row.rowNumber} (${name}): Event Volunteer Email List "${row.emailList.trim()}" isn't Yes or No; kept the previous value.`
      );
    }

    // ---- match ----
    const nName = normName(name);
    const candidates = (pred: (p: PersonState) => boolean) => state.people.filter(pred);
    let match: PersonState | undefined;
    let ambiguous: string | null = null;

    const byLastSynced = candidates((p) =>
      email.value ? lastOf.get(`${p.id}|email`) === email.value : normName(lastOf.get(`${p.id}|name`)) === nName
    );
    if (byLastSynced.length === 1) match = byLastSynced[0];

    if (!match && email.value) {
      const same = candidates((p) => normEmail(p.email) === email.value);
      const compatible = same.filter((p) => namesCompatible(fullName(p), name));
      if (same.length === 1 && compatible.length === 1) match = same[0];
      else if (compatible.length === 1) match = compatible[0];
      else if (same.length > 1) ambiguous = `${same.length} people share the email on this row`;
      else if (same.length === 1) {
        // Email matches, name doesn't: auto-match and keep the spelling (rule 4).
        match = same[0];
      }
    }
    if (!match && !ambiguous) {
      const exact = candidates((p) => namesOf(p).includes(nName));
      if (exact.length === 1) match = exact[0];
      else if (exact.length > 1) ambiguous = `${exact.length} people are named "${name}"`;
    }
    if (!match && !ambiguous && phone.value) {
      const same = candidates((p) => normPhone(p.phone) === phone.value && namesCompatible(fullName(p), name));
      if (same.length === 1) match = same[0];
    }
    if (!match && !ambiguous) {
      const { firstName, lastName } = splitName(name);
      const f = normName(firstName);
      const l = normName(lastName);
      if (l) {
        const close = candidates((p) => {
          const pf = normName(p.firstName);
          if (normName(p.lastName) !== l || pf === f) return false;
          if (!(isNickname(pf, f) || levenshtein(pf, f) <= 2)) return false;
          // Contact details must not contradict.
          if (email.value && p.email && normEmail(p.email) !== email.value) return false;
          if (phone.value && p.phone && normPhone(p.phone) !== phone.value) return false;
          return true;
        });
        if (close.length === 1) match = close[0];
        else if (close.length > 1) ambiguous = `${close.length} people have a close name`;
      }
    }

    if (ambiguous) {
      plan.problems.push(`Row ${row.rowNumber} (${name}): ${ambiguous}; not synced. Fix it on the People page, then sync again.`);
      continue;
    }
    if (match && claimed.has(match.id)) {
      plan.problems.push(
        `Row ${row.rowNumber} (${name}): matches the same person as row ${claimed.get(match.id)}; not synced. Is this a duplicate row?`
      );
      continue;
    }

    const sheetProfile = (prev?: ProfileState) => ({
      availabilityStatus: status ?? prev?.availabilityStatus ?? 'active',
      onRecruitmentList: onList ?? prev?.onRecruitmentList ?? true,
      location: row.location.trim() || null,
      sheetNotes: row.notes.trim() || null,
    });

    // ---- new person ----
    if (!match) {
      const { firstName, lastName } = splitName(name);
      const profile = sheetProfile();
      const conflicts: NewPerson['conflicts'] = [];
      if (email.invalid) conflicts.push({ field: 'email', kind: 'invalid_sheet_value', sheetValue: row.email.trim() });
      if (phone.invalid) conflicts.push({ field: 'phone', kind: 'invalid_sheet_value', sheetValue: row.phone.trim() });
      plan.newPeople.push({
        rowNumber: row.rowNumber,
        firstName,
        lastName,
        email: email.value,
        phone: phone.value,
        isVolunteer: profile.availabilityStatus !== 'inactive',
        profile,
        conflicts,
      });
      continue;
    }

    // ---- matched person ----
    claimed.set(match.id, row.rowNumber);
    const prev = profileOf.get(match.id);
    const profile = sheetProfile(prev);
    const u: PersonUpdate = {
      personId: match.id,
      display: fullName(match),
      set: {},
      profile,
      profileChanged:
        !prev ||
        !prev.onSheet ||
        prev.availabilityStatus !== profile.availabilityStatus ||
        prev.onRecruitmentList !== profile.onRecruitmentList ||
        (prev.location ?? null) !== profile.location ||
        (prev.sheetNotes ?? null) !== profile.sheetNotes,
      isNewProfile: !prev,
      syncValues: [],
      conflicts: [],
      resolveNotOnSheetFlagIds: state.openFlags
        .filter((f) => f.personId === match!.id && f.kind === 'not_on_sheet')
        .map((f) => f.id),
      changes: [],
    };
    if (!prev) u.changes.push('volunteer details added');
    else if (u.profileChanged) {
      if (prev.availabilityStatus !== profile.availabilityStatus) u.changes.push(`status ${prev.availabilityStatus} → ${profile.availabilityStatus}`);
      if (prev.onRecruitmentList !== profile.onRecruitmentList) u.changes.push(profile.onRecruitmentList ? 'added to recruitment emails' : 'removed from recruitment emails');
      if (!prev.onSheet) u.changes.push('back on the sheet');
    }
    const wantVolunteer = profile.availabilityStatus !== 'inactive';
    if (match.isVolunteer !== wantVolunteer) {
      u.set.isVolunteer = wantVolunteer;
      u.changes.push(wantVolunteer ? 'volunteer role on' : 'volunteer role off (Inactive on the sheet)');
    }

    // Shared fields: the three-way rule.
    const shared: { field: SheetSharedField; sheet: string | null; invalidRaw: string | null; app: string | null }[] = [
      { field: 'name', sheet: name, invalidRaw: null, app: fullName(match) },
      { field: 'email', sheet: email.value, invalidRaw: email.invalid ? row.email.trim() : null, app: match.email },
      { field: 'phone', sheet: phone.value, invalidRaw: phone.invalid ? row.phone.trim() : null, app: match.phone },
    ];
    for (const s of shared) {
      const n = norm[s.field];
      const raise = (kind: SheetConflictKind, sheetValue: string) => {
        if (!openConflict.has(`${match!.id}|${s.field}|${n(sheetValue)}`)) {
          u.conflicts.push({ field: s.field, kind, sheetValue, appValue: s.app });
          u.changes.push(`${s.field}: needs a decision (${kind.replace(/_/g, ' ')})`);
        }
      };
      if (s.invalidRaw) {
        raise('invalid_sheet_value', s.invalidRaw);
        continue;
      }
      if (!s.sheet) continue; // a blank cell never clears the app's value
      const key = `${match.id}|${s.field}`;
      const hasLast = lastOf.has(key);
      const last = lastOf.get(key) ?? null;
      const sheetEqApp = n(s.sheet) === n(s.app);
      const record = () => u.syncValues.push({ field: s.field, value: s.sheet! });

      if (sheetEqApp) {
        if (!hasLast || n(last) !== n(s.sheet)) record();
        continue;
      }
      const sheetChanged = !hasLast || n(s.sheet) !== n(last);
      const appChanged = hasLast && n(s.app) !== n(last);
      if (!sheetChanged) continue; // app edit since the last sync: keep it

      if (s.field === 'name') {
        if (!sheetMayRename(match.nameSource) && (!hasLast || appChanged)) {
          // A better-sourced name wins; keep the sheet's spelling as an alias.
          u.addAlias = s.sheet;
          u.changes.push(`sheet spelling "${s.sheet}" kept as another spelling`);
          record();
          continue;
        }
        if (hasLast && appChanged) {
          raise('conflict', s.sheet);
          continue;
        }
        const { firstName, lastName } = splitName(s.sheet);
        u.set.firstName = firstName;
        u.set.lastName = lastName;
        u.set.nameSource = 'sheet';
        u.addAlias = fullName(match);
        u.changes.push(`name "${fullName(match)}" → "${s.sheet}"`);
        record();
        continue;
      }

      if (!s.app) {
        // App has nothing: fill it in.
        u.set[s.field] = s.sheet;
        u.changes.push(`${s.field} added`);
        record();
        continue;
      }
      if (s.field === 'phone' && oneDigitApart(n(s.sheet), n(s.app))) {
        raise('possible_typo', s.sheet);
        continue;
      }
      if (!hasLast || appChanged) {
        // First sync and they disagree, or both changed differently.
        raise('conflict', s.sheet);
        continue;
      }
      u.set[s.field] = s.sheet;
      u.changes.push(`${s.field} updated from the sheet`);
      record();
    }

    plan.updates.push(u);
  }

  // People who were on the sheet and aren't now.
  for (const p of state.profiles) {
    if (!p.onSheet || claimed.has(p.personId)) continue;
    const person = byId.get(p.personId);
    plan.missing.push({
      personId: p.personId,
      display: person ? fullName(person) : `#${p.personId}`,
      alreadyFlagged: state.openFlags.some((f) => f.personId === p.personId && f.kind === 'not_on_sheet'),
    });
  }

  return plan;
}

/** Plain-language summary for the sync report and the run record. */
export function summarizePlan(plan: SyncPlan) {
  const changed = plan.updates.filter((u) => u.changes.length > 0);
  return {
    rowsRead: plan.rowsRead,
    matched: plan.updates.length,
    changed: changed.length,
    added: plan.newPeople.length,
    missing: plan.missing.length,
    conflicts:
      plan.updates.reduce((n, u) => n + u.conflicts.length, 0) +
      plan.newPeople.reduce((n, p) => n + p.conflicts.length, 0),
    problems: plan.problems.length,
  };
}
