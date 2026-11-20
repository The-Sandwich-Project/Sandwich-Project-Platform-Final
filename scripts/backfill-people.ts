/**
 * Fill `people` from the legacy person tables (people/places rebuild, step 5).
 *
 *   npm run people:backfill -- --dry-run   # preview: does everything, saves nothing
 *   npm run people:backfill -- --apply     # save it
 *
 * Connection: --url, or TARGET_DATABASE_URL, or AUDIT_DATABASE_URL. Never
 * DATABASE_URL (in the Replit workspace that's the dev database).
 *
 * One-shot: refuses to --apply if `people` already has rows. Everything runs
 * in one transaction, so --dry-run exercises every insert and database rule
 * and then rolls back, and a failed --apply leaves nothing behind.
 *
 * What it does, per the rules in docs/data-model.md:
 *   - groups the records in users, volunteers, drivers, host_contacts and
 *     contacts into people, using the same matching as the step 2 audit:
 *       * identical full name, or
 *       * shared email / real phone AND names that agree (same, nickname,
 *         or an initial), or
 *       * nickname / 1-2 letter first-name typo with the same last name,
 *         only when it's the sole candidate and contact details don't
 *         contradict
 *   - canonical name: a survey driver's name (self_reported), otherwise the
 *     most common full spelling (legacy_import). Other spellings become
 *     person_name_aliases.
 *   - email: a personal address over an @thesandwichproject.org one (that
 *     stays as the login); phone: a real 10-digit number (0000000000 and
 *     similar are dropped). When sources disagree, one is picked by source
 *     priority and a review flag records the alternatives.
 *   - roles from ACTIVE records only: driver (drivers), host (host_contacts
 *     not marked former), volunteer (volunteers not machine-copied from a
 *     host, or hosts marked "Also a volunteer"), van driver (approved in any
 *     record), team member (has an active app login).
 *   - every old row gets a legacy_person_ids entry; every login gets
 *     users.person_id.
 *   - anything it can't settle becomes a person_review_flags row for the
 *     People admin page.
 *
 * The full report (names, emails, phones) is written to audit-output/,
 * which is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  normName,
  normPhone,
  normEmail,
  isAbbreviated,
  isNickname,
  levenshtein,
  namesCompatible,
} from './audit-people-data';

type Source = 'users' | 'volunteers' | 'drivers' | 'host_contacts' | 'contacts';
type ReviewKind = 'contact_conflict' | 'shared_contact' | 'multiple_people' | 'abbreviated_name' | 'possible_duplicate';

export interface Rec {
  source: Source;
  key: string; // the old row's id, as text
  name: string;
  emails: string[]; // normalized, junk removed
  phoneRaw: string;
  phone: string; // normalized 10 digits, or '' if not a real number
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  geocodedAt: Date | null;
  active: boolean; // this record counts as current
  vanApproved: boolean;
  surveySubmitted?: boolean;
  hostVolunteer?: boolean; // host_contacts "Also a volunteer"
  hostContactCopy?: boolean; // volunteers row machine-copied from a host
}

// Most trusted source first, for picking email/phone/address.
const SOURCE_PRIORITY: Source[] = ['drivers', 'host_contacts', 'volunteers', 'users', 'contacts'];
const ORG_EMAIL = /@(thesandwichproject\.org|sandwich\.project)$/;

/** A phone we'd actually dial: 10 digits, no placeholder like 0000000000. */
export function realPhone(raw: string | null | undefined): string {
  const d = normPhone(raw);
  if (d.length !== 10) return '';
  if (/^(\d)\1{9}$/.test(d)) return '';
  if (d[0] === '0' || d[0] === '1') return '';
  return d;
}

/** A usable email: has user@domain.tld and isn't a merged-account marker. */
export function realEmail(raw: string | null | undefined): string {
  const e = normEmail(raw);
  if (!e || e.includes('.merged_into_')) return '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : '';
}

/** "Stacey & Jack Guith", "Veronica (and daughter) Kelly-Cash" */
export function looksLikeMultiplePeople(name: string): boolean {
  return /\s&\s|\sand\s|\(\s*and\b|\/|\+/i.test(name);
}

/** First token is the first name; the rest (parentheticals removed) is the last. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const cleaned = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || name.trim();
  const parts = cleaned.split(' ');
  return { firstName: parts[0] || name.trim(), lastName: parts.slice(1).join(' ') };
}

interface Person {
  members: Rec[];
  firstName: string;
  lastName: string;
  display: string;
  nameSource: 'self_reported' | 'legacy_import';
  aliases: { alias: string; source: Source }[];
  email: string | null;
  phone: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  geocodedAt: Date | null;
  isVolunteer: boolean;
  isDriver: boolean;
  isVanDriver: boolean;
  isHost: boolean;
  isTeamMember: boolean;
  isActive: boolean;
  flags: { kind: ReviewKind; detail: string }[];
}

const ref = (r: Rec) => `${r.source}#${r.key}`;
const byPriority = (a: Rec, b: Rec) =>
  Number(!!b.surveySubmitted) - Number(!!a.surveySubmitted) ||
  SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source);

/** Group records into people. Exported for testing. */
export function groupRecords(records: Rec[]): { groups: Rec[][]; shared: { key: string; a: Rec; b: Rec }[]; nearMisses: { why: string; a: Rec[]; b: Rec[] }[] } {
  const parent = records.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // 1. identical full names
  const byName = new Map<string, number>();
  records.forEach((r, i) => {
    const n = normName(r.name);
    if (!n || isAbbreviated(r.name)) return;
    const j = byName.get(n);
    if (j === undefined) byName.set(n, i);
    else union(i, j);
  });

  // 2. shared contact + compatible names
  const byContact = new Map<string, number[]>();
  const sharedRaw: { key: string; a: number; b: number }[] = [];
  const linkContact = (key: string, i: number) => {
    const seen = byContact.get(key) || [];
    for (const j of seen) {
      if (namesCompatible(records[i].name, records[j].name)) union(i, j);
      else sharedRaw.push({ key, a: j, b: i });
    }
    seen.push(i);
    byContact.set(key, seen);
  };
  records.forEach((r, i) => {
    new Set(r.emails).forEach((e) => linkContact(`email ${e}`, i));
    if (r.phone) linkContact(`phone ${r.phone}`, i);
  });

  // 3. nickname / small first-name typo, same last name, sole candidate,
  //    contact details don't contradict
  const groupsOf = () => {
    const m = new Map<number, number[]>();
    records.forEach((_, i) => {
      const root = find(i);
      if (!m.has(root)) m.set(root, []);
      m.get(root)!.push(i);
    });
    return m;
  };
  const nearMisses: { why: string; a: Rec[]; b: Rec[] }[] = [];
  {
    type G = { root: number; first: string; last: string; emails: Set<string>; phones: Set<string> };
    const gs: G[] = [];
    for (const [root, idx] of groupsOf()) {
      const best = idx.map((i) => records[i]).find((r) => !isAbbreviated(r.name));
      if (!best) continue;
      const parts = normName(best.name).split(' ').filter(Boolean);
      if (parts.length < 2) continue;
      gs.push({
        root,
        first: parts[0],
        last: parts[parts.length - 1],
        emails: new Set(idx.flatMap((i) => records[i].emails)),
        phones: new Set(idx.map((i) => records[i].phone).filter(Boolean)),
      });
    }
    const contradicts = (a: G, b: G) => {
      if (a.emails.size + a.phones.size === 0 || b.emails.size + b.phones.size === 0) return false;
      for (const e of a.emails) if (b.emails.has(e)) return false;
      for (const p of a.phones) if (b.phones.has(p)) return false;
      return true;
    };
    const byLast = new Map<string, G[]>();
    gs.forEach((g) => byLast.set(g.last, [...(byLast.get(g.last) || []), g]));
    const members = (root: number) => records.filter((_, i) => find(i) === root);
    for (const [, list] of byLast) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.first === b.first) continue;
          const nick = isNickname(a.first, b.first);
          const dist = levenshtein(a.first, b.first);
          if (!nick && dist > 2) continue;
          const why = nick ? 'nickname' : `first name ${dist} letter(s) off`;
          if (list.length === 2 && !contradicts(a, b)) union(a.root, b.root);
          else nearMisses.push({ why, a: members(a.root), b: members(b.root) });
        }
    }
    const byFirst = new Map<string, G[]>();
    gs.forEach((g) => byFirst.set(g.first, [...(byFirst.get(g.first) || []), g]));
    for (const [, list] of byFirst) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.last === b.last || find(a.root) === find(b.root)) continue;
          const dist = levenshtein(a.last, b.last);
          if (dist > 2 || Math.min(a.last.length, b.last.length) < 4) continue;
          nearMisses.push({ why: `last name ${dist} letter(s) off`, a: members(a.root), b: members(b.root) });
        }
    }
  }

  const groups = [...groupsOf().values()].map((idx) => idx.map((i) => records[i]));
  const seenPairs = new Set<string>();
  const shared: { key: string; a: Rec; b: Rec }[] = [];
  for (const s of sharedRaw) {
    const ra = find(s.a);
    const rb = find(s.b);
    if (ra === rb) continue;
    const k = [ra, rb].sort().join('-');
    if (seenPairs.has(k)) continue;
    seenPairs.add(k);
    shared.push({ key: s.key, a: records[s.a], b: records[s.b] });
  }
  return { groups, shared, nearMisses };
}

/** Turn one group of records into a proposed person. Exported for testing. */
export function buildPerson(rs: Rec[]): Person {
  const sorted = [...rs].sort(byPriority);
  const flags: Person['flags'] = [];

  // Name
  const survey = sorted.find((r) => r.source === 'drivers' && r.surveySubmitted && r.name.trim());
  const counts = new Map<string, { n: number; display: string; source: Source }>();
  sorted.forEach((r) => {
    const k = normName(r.name);
    if (!k) return;
    const e = counts.get(k) || { n: 0, display: r.name.trim().replace(/\s+/g, ' '), source: r.source };
    e.n++;
    counts.set(k, e);
  });
  const ranked = [...counts.entries()].sort(
    (a, b) => Number(isAbbreviated(a[0])) - Number(isAbbreviated(b[0])) || b[1].n - a[1].n || b[0].length - a[0].length
  );
  const display = survey ? survey.name.trim().replace(/\s+/g, ' ') : ranked[0]?.[1].display || '(no name)';
  const { firstName, lastName } = splitName(display);
  const aliases = ranked
    .filter(([k]) => k !== normName(display))
    .map(([, v]) => ({ alias: v.display, source: v.source }));
  if (looksLikeMultiplePeople(display)) {
    flags.push({ kind: 'multiple_people', detail: `"${display}" may be more than one person. Split into separate people if so.` });
  }
  if (isAbbreviated(display)) {
    flags.push({ kind: 'abbreviated_name', detail: `Only "${display}" is known. Add the full name.` });
  }

  // Email: personal over org; report disagreement
  const allEmails = sorted.flatMap((r) => r.emails.map((e) => ({ e, r })));
  const personal = [...new Set(allEmails.filter((x) => !ORG_EMAIL.test(x.e)).map((x) => x.e))];
  const org = [...new Set(allEmails.filter((x) => ORG_EMAIL.test(x.e)).map((x) => x.e))];
  const email = personal[0] ?? org[0] ?? null;
  if (personal.length > 1) {
    flags.push({ kind: 'contact_conflict', detail: `Emails differ: using ${personal[0]}; also seen ${personal.slice(1).join(', ')}` });
  }

  // Phone
  const phones = [...new Set(sorted.map((r) => r.phone).filter(Boolean))];
  // Stored in one format: (404) 555-1234
  const phone = phones[0] ? `(${phones[0].slice(0, 3)}) ${phones[0].slice(3, 6)}-${phones[0].slice(6)}` : null;
  if (phones.length > 1) {
    const oneOff = phones.slice(1).some((p) => levenshtein(p, phones[0]) === 1);
    flags.push({
      kind: 'contact_conflict',
      detail: `Phones differ${oneOff ? ' (one digit apart: likely a typo)' : ''}: using ${phones[0]}; also seen ${phones.slice(1).join(', ')}`,
    });
  }

  // Address and map position: hosts first (their address is where they host)
  const addrOrder: Source[] = ['host_contacts', 'drivers', 'volunteers', 'users', 'contacts'];
  const withAddr = [...rs]
    .filter((r) => r.address && r.address.trim())
    .sort((a, b) => addrOrder.indexOf(a.source) - addrOrder.indexOf(b.source));
  const addrRec = withAddr[0];

  const active = rs.filter((r) => r.active);
  const isVolunteerRec = (r: Rec) =>
    (r.source === 'volunteers' && !r.hostContactCopy) || (r.source === 'host_contacts' && !!r.hostVolunteer);

  return {
    members: rs,
    firstName,
    lastName,
    display,
    nameSource: survey ? 'self_reported' : 'legacy_import',
    aliases,
    email,
    phone,
    address: addrRec?.address?.trim() ?? null,
    latitude: addrRec?.latitude ?? null,
    longitude: addrRec?.longitude ?? null,
    geocodedAt: addrRec?.geocodedAt ?? null,
    isVolunteer: active.some(isVolunteerRec),
    isDriver: active.some((r) => r.source === 'drivers'),
    isHost: active.some((r) => r.source === 'host_contacts'),
    // van_approved defaults to false everywhere: approved anywhere = approved
    isVanDriver: rs.some((r) => r.vanApproved),
    isTeamMember: active.some((r) => r.source === 'users'),
    isActive: active.length > 0,
    flags,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run (preview) or --apply (save).');
    process.exit(1);
  }
  const url = arg('--url') || process.env.TARGET_DATABASE_URL || process.env.AUDIT_DATABASE_URL;
  if (!url) {
    console.error(
      'Set TARGET_DATABASE_URL or AUDIT_DATABASE_URL (or pass --url).\n' +
        'DATABASE_URL is not used on purpose: in the Replit workspace it is the dev database.'
    );
    process.exit(1);
  }
  let host = '(unparseable url)';
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep placeholder */
  }
  const today = new Date().toISOString().slice(0, 10);
  const outPath = arg('--out') || path.join('audit-output', `people-backfill-${dryRun ? 'preview' : 'applied'}-${today}.md`);
  console.log(`${dryRun ? 'DRY RUN (nothing will be saved)' : 'APPLYING'} on database host: ${host}\n`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows as any[];

  try {
    await client.query('BEGIN');
    for (const t of ['people', 'person_name_aliases', 'legacy_person_ids', 'person_review_flags']) {
      const [{ ok }] = await q(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
      if (!ok) throw new Error(`Table ${t} doesn't exist yet. Deploy the app first (its migrations create it).`);
    }
    const [{ n: existing }] = await q(`SELECT COUNT(*)::int AS n FROM people`);
    if (existing > 0 && apply) {
      throw new Error(`people already has ${existing} rows. This backfill is one-shot and won't run twice.`);
    }

    // ---- load ----
    const records: Rec[] = [];
    const emailsOf = (...xs: (string | null)[]) => [...new Set(xs.map(realEmail).filter(Boolean))];
    for (const u of await q(
      `SELECT id, email, preferred_email, first_name, last_name, display_name, phone_number, address,
              latitude, longitude, geocoded_at, is_active, van_approved FROM users`
    )) {
      records.push({
        source: 'users',
        key: String(u.id),
        name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.display_name || '',
        emails: emailsOf(u.email, u.preferred_email),
        phoneRaw: u.phone_number || '',
        phone: realPhone(u.phone_number),
        address: u.address,
        latitude: u.latitude,
        longitude: u.longitude,
        geocodedAt: u.geocoded_at,
        active: u.is_active !== false,
        vanApproved: u.van_approved === true,
      });
    }
    for (const v of await q(
      `SELECT id, name, email, phone, address, latitude, longitude, geocoded_at, is_active, van_approved, host_contact_id
         FROM volunteers`
    )) {
      records.push({
        source: 'volunteers',
        key: String(v.id),
        name: v.name || '',
        emails: emailsOf(v.email),
        phoneRaw: v.phone || '',
        phone: realPhone(v.phone),
        address: v.address,
        latitude: v.latitude,
        longitude: v.longitude,
        geocodedAt: v.geocoded_at,
        active: v.is_active !== false,
        vanApproved: v.van_approved === true,
        hostContactCopy: v.host_contact_id != null,
      });
    }
    for (const d of await q(
      `SELECT id, name, email, phone, address, latitude, longitude, geocoded_at, is_active, van_approved, survey_submitted
         FROM drivers`
    )) {
      records.push({
        source: 'drivers',
        key: String(d.id),
        name: d.name || '',
        emails: emailsOf(d.email),
        phoneRaw: d.phone || '',
        phone: realPhone(d.phone),
        address: d.address,
        latitude: d.latitude,
        longitude: d.longitude,
        geocodedAt: d.geocoded_at,
        active: d.is_active !== false,
        vanApproved: d.van_approved === true,
        surveySubmitted: d.survey_submitted === true,
      });
    }
    for (const h of await q(
      `SELECT id, name, email, phone, address, latitude, longitude, geocoded_at, is_former_host, van_approved, is_volunteer
         FROM host_contacts`
    )) {
      records.push({
        source: 'host_contacts',
        key: String(h.id),
        name: h.name || '',
        emails: emailsOf(h.email),
        phoneRaw: h.phone || '',
        phone: realPhone(h.phone),
        address: h.address,
        latitude: h.latitude,
        longitude: h.longitude,
        geocodedAt: h.geocoded_at,
        active: h.is_former_host !== true,
        vanApproved: h.van_approved === true,
        hostVolunteer: h.is_volunteer === true,
      });
    }
    for (const c of await q(`SELECT id, name, email, phone, address, is_active FROM contacts`)) {
      records.push({
        source: 'contacts',
        key: String(c.id),
        name: c.name || '',
        emails: emailsOf(c.email),
        phoneRaw: c.phone || '',
        phone: realPhone(c.phone),
        address: c.address,
        latitude: null,
        longitude: null,
        geocodedAt: null,
        active: c.is_active !== false,
        vanApproved: false,
      });
    }

    // ---- group and build ----
    const { groups, shared, nearMisses } = groupRecords(records);
    const people = groups.map(buildPerson);
    const personOf = new Map<Rec, Person>();
    people.forEach((p) => p.members.forEach((r) => personOf.set(r, p)));
    for (const s of shared) {
      const pa = personOf.get(s.a)!;
      const pb = personOf.get(s.b)!;
      pa.flags.push({ kind: 'shared_contact', detail: `Shares ${s.key} with ${pb.display}. Same person under another name, or two people?` });
      pb.flags.push({ kind: 'shared_contact', detail: `Shares ${s.key} with ${pa.display}. Same person under another name, or two people?` });
    }
    for (const m of nearMisses) {
      const pa = personOf.get(m.a[0])!;
      const pb = personOf.get(m.b[0])!;
      pa.flags.push({ kind: 'possible_duplicate', detail: `${m.why}: ${pb.display}. Kept separate; merge if they're the same person.` });
      pb.flags.push({ kind: 'possible_duplicate', detail: `${m.why}: ${pa.display}. Kept separate; merge if they're the same person.` });
    }

    // ---- write (inside the transaction, even for --dry-run) ----
    let aliasCount = 0;
    let legacyCount = 0;
    let loginLinks = 0;
    let flagCount = 0;
    for (const p of people) {
      const [{ id }] = await q(
        `INSERT INTO people (first_name, last_name, name_source, email, phone, address, latitude, longitude,
                             geocoded_at, is_volunteer, is_driver, is_van_driver, is_host, is_team_member, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [
          p.firstName, p.lastName, p.nameSource, p.email, p.phone, p.address, p.latitude, p.longitude,
          p.geocodedAt, p.isVolunteer, p.isDriver, p.isVanDriver, p.isHost, p.isTeamMember, p.isActive,
        ]
      );
      for (const a of p.aliases) {
        const r = await q(
          `INSERT INTO person_name_aliases (person_id, alias, source) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING RETURNING id`,
          [id, a.alias, a.source]
        );
        aliasCount += r.length;
      }
      for (const r of p.members) {
        await q(`INSERT INTO legacy_person_ids (source_table, source_key, person_id) VALUES ($1,$2,$3)`, [r.source, r.key, id]);
        legacyCount++;
        if (r.source === 'users') {
          await q(`UPDATE users SET person_id = $1 WHERE id = $2`, [id, r.key]);
          loginLinks++;
        }
      }
      const uniqueFlags = [...new Map(p.flags.map((f) => [`${f.kind}|${f.detail}`, f])).values()];
      for (const f of uniqueFlags) {
        await q(`INSERT INTO person_review_flags (person_id, kind, detail) VALUES ($1,$2,$3)`, [id, f.kind, f.detail]);
        flagCount++;
      }
    }

    // ---- report ----
    const count = (f: (p: Person) => boolean) => people.filter(f).length;
    const summary = [
      `Old person records read:      ${records.length}`,
      `People created:               ${people.length}`,
      `  drivers:                    ${count((p) => p.isDriver)}`,
      `  hosts:                      ${count((p) => p.isHost)}`,
      `  volunteers:                 ${count((p) => p.isVolunteer)} (the volunteer sheet sync adds the rest later)`,
      `  van drivers:                ${count((p) => p.isVanDriver)}`,
      `  team members (app login):   ${count((p) => p.isTeamMember)}`,
      `  inactive (no current role): ${count((p) => !p.isActive)}`,
      `  self_reported names:        ${count((p) => p.nameSource === 'self_reported')}`,
      `Other spellings saved:        ${aliasCount}`,
      `Old-record links:             ${legacyCount}`,
      `Logins linked to a person:    ${loginLinks}`,
      `Review flags ("needs a decision"): ${flagCount} on ${count((p) => p.flags.length > 0)} people`,
    ];
    const kinds = new Map<string, number>();
    people.forEach((p) => p.flags.forEach((f) => kinds.set(f.kind, (kinds.get(f.kind) || 0) + 1)));
    summary.push(...[...kinds.entries()].map(([k, n]) => `  ${k}: ${n}`));

    const md: string[] = [
      `# People backfill ${dryRun ? 'preview' : 'applied'} (${new Date().toISOString()}, ${host})`,
      '',
      '> Contains personal contact details. Keep it out of git and public channels.',
      '',
      '```',
      ...summary,
      '```',
      '',
      '## Needs a decision',
      '',
      '| Person | Kind | Detail | Old records |',
      '|---|---|---|---|',
      ...people
        .filter((p) => p.flags.length)
        .flatMap((p) =>
          [...new Map(p.flags.map((f) => [`${f.kind}|${f.detail}`, f])).values()].map(
            (f) => `| ${p.display} | ${f.kind} | ${f.detail.replace(/\|/g, '/')} | ${p.members.map(ref).join(', ')} |`
          )
        ),
      '',
      '## Team members (have an app login)',
      '',
      'Switch off any guests on the People admin page.',
      '',
      ...people.filter((p) => p.isTeamMember).map((p) => `- ${p.display}`),
      '',
      '## Everyone',
      '',
      '| Name | Source | Roles | Email | Phone | Active | Old records |',
      '|---|---|---|---|---|---|---|',
      ...people
        .slice()
        .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName))
        .map((p) => {
          const roles = [
            p.isDriver && 'driver',
            p.isHost && 'host',
            p.isVolunteer && 'volunteer',
            p.isVanDriver && 'van',
            p.isTeamMember && 'team',
          ].filter(Boolean).join(', ') || '—';
          return `| ${p.display} | ${p.nameSource} | ${roles} | ${p.email ?? '—'} | ${p.phone ?? '—'} | ${p.isActive ? 'yes' : 'no'} | ${p.members.map(ref).join(', ')} |`;
        }),
    ];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md.join('\n'));

    console.log(summary.join('\n'));
    console.log(`\nFull report (names and contact details): ${outPath}`);
    if (apply) {
      await client.query('COMMIT');
      console.log('\nSaved.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run: every insert ran and passed the database rules, then was rolled back. Nothing was saved.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nStopped, nothing saved: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /backfill-people\.ts$/.test(process.argv[1])) {
  main();
}
