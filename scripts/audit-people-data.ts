/**
 * People & places data audit (step 2 of the rebuild in docs/data-model.md).
 *
 * The report is organised around the TARGET model (people + role flags +
 * profiles, regions, name aliases), not around the legacy tables. The legacy
 * tables are only read as the source of today's data; the output is a draft
 * of what the new tables would contain and what has to be decided first.
 *
 * READ-ONLY. Everything runs inside one `BEGIN READ ONLY` transaction that is
 * rolled back at the end, so the database refuses any write even if a query
 * here were wrong.
 *
 * Usage:
 *   AUDIT_DATABASE_URL=postgres://... npx tsx scripts/audit-people-data.ts
 *   npx tsx scripts/audit-people-data.ts --url postgres://... [--out path.md]
 *
 * Point it at a Neon branch of production (or production itself; it can't
 * write). The report contains names, emails and phone numbers: it is written
 * to audit-output/ (gitignored). Don't commit it or paste it anywhere public.
 *
 * Sections:
 *   1. Proposed `people`: how many, which role flags, who has a login
 *   2. People whose details conflict across sources (decide before backfill)
 *   3. Possible same person, different spelling (→ `person_name_aliases`)
 *   4. Names too abbreviated to match
 *   5. `name_source`: survey drivers, and whether their name changed since
 *   6. Proposed `regions` rows, with historic roll-ups
 *   7. Candidate `driver_profiles` columns (what the drivers data actually uses)
 *   8. `is_van_driver`: where approval is recorded today, and disagreements
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Args / connection
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = arg('--url') || process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set AUDIT_DATABASE_URL (or pass --url). Use a Neon branch of production.');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const outPath = arg('--out') || path.join('audit-output', `people-data-audit-${today}.md`);

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function normName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normPhone(s: string | null | undefined): string {
  let d = (s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

export function normEmail(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

/** "Sarah P." / "Sarah P" / single word → abbreviated. */
export function isAbbreviated(name: string): boolean {
  const parts = normName(name).split(' ').filter(Boolean);
  if (parts.length <= 1) return true;
  return /^[\p{L}]$/u.test(parts[parts.length - 1].replace(/[.'-]/g, ''));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Common English nickname groups. Not exhaustive; the audit only uses it to
// *suggest* matches for a person to confirm.
const NICKNAME_GROUPS: string[][] = [
  ['laura', 'laurie', 'lauren', 'lori', 'lorrie'],
  ['william', 'bill', 'billy', 'will', 'willie', 'liam'],
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
  ['richard', 'rick', 'ricky', 'rich', 'dick'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betsy', 'betty', 'eliza', 'libby'],
  ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat', 'kay', 'katy'],
  ['margaret', 'maggie', 'meg', 'peggy', 'marge', 'greta'],
  ['jennifer', 'jen', 'jenny', 'jenn'],
  ['jessica', 'jess', 'jessie'],
  ['rebecca', 'becky', 'becca'],
  ['susan', 'sue', 'susie', 'suzanne', 'suzy'],
  ['patricia', 'pat', 'patty', 'tricia', 'trish'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['christine', 'christina', 'chris', 'christy', 'christie', 'kristy', 'tina'],
  ['christopher', 'chris', 'topher'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jon', 'johnny', 'jack'],
  ['jonathan', 'jon', 'jonny', 'nathan'],
  ['joseph', 'joe', 'joey'],
  ['thomas', 'tom', 'tommy'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['matthew', 'matt', 'matty'],
  ['anthony', 'tony'],
  ['andrew', 'andy', 'drew'],
  ['steven', 'stephen', 'steve'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['samantha', 'sam', 'sammy'],
  ['alexander', 'alex', 'al', 'xander'],
  ['alexandra', 'alex', 'lexi', 'sandra', 'sandy'],
  ['nicholas', 'nick', 'nicky'],
  ['nicole', 'nikki', 'nicky'],
  ['victoria', 'vicky', 'tori'],
  ['abigail', 'abby', 'gail'],
  ['amanda', 'mandy'],
  ['kimberly', 'kim'],
  ['pamela', 'pam'],
  ['cynthia', 'cindy'],
  ['barbara', 'barb', 'barbie'],
  ['dorothy', 'dot', 'dottie'],
  ['gregory', 'greg'],
  ['jeffrey', 'geoffrey', 'jeff', 'geoff'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['timothy', 'tim', 'timmy'],
  ['zachary', 'zach', 'zack'],
  ['allison', 'alison', 'ali', 'allie'],
  ['melissa', 'missy', 'mel'],
  ['stephanie', 'steph'],
  ['theresa', 'teresa', 'terri', 'terry', 'tess'],
  ['frances', 'fran', 'frannie'],
  ['francis', 'frank', 'frankie'],
  ['lawrence', 'larry'],
  ['leonard', 'leo', 'len', 'lenny'],
];
const NICK_INDEX = new Map<string, Set<number>>();
NICKNAME_GROUPS.forEach((g, i) =>
  g.forEach((n) => {
    if (!NICK_INDEX.has(n)) NICK_INDEX.set(n, new Set());
    NICK_INDEX.get(n)!.add(i);
  })
);
export function isNickname(a: string, b: string): boolean {
  const ga = NICK_INDEX.get(a);
  const gb = NICK_INDEX.get(b);
  if (!ga || !gb) return false;
  for (const g of ga) if (gb.has(g)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

const out: string[] = [];
const w = (s = '') => out.push(s);
const cell = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function table(headers: string[], rows: unknown[][]) {
  if (rows.length === 0) {
    w('_None._');
    w();
    return;
  }
  w(`| ${headers.join(' | ')} |`);
  w(`|${headers.map(() => '---').join('|')}|`);
  for (const r of rows) w(`| ${r.map(cell).join(' | ')} |`);
  w();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type PersonRecord = {
  source: 'users' | 'volunteers' | 'drivers' | 'host_contacts' | 'contacts';
  id: string;
  name: string;
  emails: string[];
  phone: string;
  rawPhone: string;
  active: boolean | null;
  vanApproved: boolean | null;
  hostContactId?: number | null; // volunteers only: machine-maintained copy
  surveySubmitted?: boolean; // drivers only
  region?: string | null; // host_contacts only: name of its hosts row
};
const ref = (r: PersonRecord) => `${r.source}#${r.id}`;

async function main() {
  const host = (() => {
    try {
      return new URL(url!).hostname;
    } catch {
      return '(unparseable url)';
    }
  })();
  console.error(`Auditing database at host: ${host}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const q = async <T = any>(sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows as T[];

  try {
    w(`# People & places data audit`);
    w();
    w(`Generated ${new Date().toISOString()} against \`${host}\`. Read-only.`);
    w();
    w('> Contains personal contact details. Keep it out of git and public channels.');
    w();

    // ---- load people records ------------------------------------------------
    const records: PersonRecord[] = [];
    for (const u of await q(
      `SELECT id, email, preferred_email, first_name, last_name, display_name,
              phone_number, is_active, van_approved FROM users`
    )) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.display_name || '';
      records.push({
        source: 'users',
        id: u.id,
        name,
        emails: [normEmail(u.email), normEmail(u.preferred_email)].filter(Boolean),
        phone: normPhone(u.phone_number),
        rawPhone: u.phone_number || '',
        active: u.is_active,
        vanApproved: u.van_approved,
      });
    }
    for (const v of await q(
      `SELECT id, name, email, phone, is_active, van_approved, host_contact_id FROM volunteers`
    )) {
      records.push({
        source: 'volunteers',
        id: String(v.id),
        name: v.name || '',
        emails: [normEmail(v.email)].filter(Boolean),
        phone: normPhone(v.phone),
        rawPhone: v.phone || '',
        active: v.is_active,
        vanApproved: v.van_approved,
        hostContactId: v.host_contact_id,
      });
    }
    for (const d of await q(
      `SELECT id, name, email, phone, is_active, van_approved, survey_submitted FROM drivers`
    )) {
      records.push({
        source: 'drivers',
        id: String(d.id),
        name: d.name || '',
        emails: [normEmail(d.email)].filter(Boolean),
        phone: normPhone(d.phone),
        rawPhone: d.phone || '',
        active: d.is_active,
        vanApproved: d.van_approved,
        surveySubmitted: d.survey_submitted === true,
      });
    }
    for (const h of await q(
      `SELECT hc.id, hc.name, hc.email, hc.phone, hc.is_former_host, hc.van_approved,
              h.name AS region
         FROM host_contacts hc LEFT JOIN hosts h ON h.id = hc.host_id`
    )) {
      records.push({
        source: 'host_contacts',
        id: String(h.id),
        name: h.name || '',
        emails: [normEmail(h.email)].filter(Boolean),
        phone: normPhone(h.phone),
        rawPhone: h.phone || '',
        active: h.is_former_host === null ? null : !h.is_former_host,
        vanApproved: h.van_approved,
        region: h.region,
      });
    }
    for (const c of await q(`SELECT id, name, email, phone, is_active FROM contacts`)) {
      records.push({
        source: 'contacts',
        id: String(c.id),
        name: c.name || '',
        emails: [normEmail(c.email)].filter(Boolean),
        phone: normPhone(c.phone),
        rawPhone: c.phone || '',
        active: c.is_active,
        vanApproved: null,
      });
    }

    // ---- group records into proposed people --------------------------------
    // Records are joined when they share an email, a 10-digit phone, or an
    // identical full name (abbreviated names excluded). One group = one
    // proposed `people` row.
    const sources = ['users', 'volunteers', 'drivers', 'host_contacts', 'contacts'] as const;
    const parent = records.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const byKey = new Map<string, number>();
    const link = (key: string, i: number) => {
      const j = byKey.get(key);
      if (j === undefined) byKey.set(key, i);
      else union(i, j);
    };
    records.forEach((r, i) => {
      r.emails.forEach((e) => link(`e:${e}`, i));
      if (r.phone.length === 10) link(`p:${r.phone}`, i);
      const n = normName(r.name);
      if (n && !isAbbreviated(r.name)) link(`n:${n}`, i);
    });
    const clusters = new Map<number, number[]>();
    records.forEach((_, i) => {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(i);
    });

    type Proposed = {
      members: PersonRecord[];
      name: string;
      nameSource: 'self_reported' | 'legacy_import';
      aliases: string[];
      isVolunteer: boolean;
      isDriver: boolean;
      isHost: boolean;
      isVanDriver: boolean | 'conflict';
      hasLogin: boolean;
      regions: string[];
      conflicts: { kind: string; detail: string }[];
    };
    // Canonical name per the trust order in docs/data-model.md: a survey
    // driver's name is self_reported; otherwise the most common full
    // (non-abbreviated) spelling, ties broken by length, is legacy_import.
    const propose = (rs: PersonRecord[]): Proposed => {
      const survey = rs.find((r) => r.surveySubmitted && r.name);
      const counts = new Map<string, { n: number; display: string }>();
      rs.forEach((r) => {
        const k = normName(r.name);
        if (!k) return;
        const e = counts.get(k) || { n: 0, display: r.name.trim() };
        e.n++;
        counts.set(k, e);
      });
      const ranked = [...counts.entries()].sort(
        (a, b) =>
          Number(isAbbreviated(a[0])) - Number(isAbbreviated(b[0])) || b[1].n - a[1].n || b[0].length - a[0].length
      );
      const name = survey ? survey.name.trim() : ranked[0]?.[1].display || '';
      const aliases = ranked.map(([, v]) => v.display).filter((d) => normName(d) !== normName(name));
      const vans = new Set(rs.filter((r) => r.vanApproved !== null).map((r) => r.vanApproved));
      const conflicts: Proposed['conflicts'] = [];
      if (aliases.length) conflicts.push({ kind: 'name', detail: [name, ...aliases].join(' / ') });
      const phones = new Set(rs.map((r) => r.phone).filter((p) => p.length === 10));
      if (phones.size > 1) conflicts.push({ kind: 'phone', detail: [...phones].join(' / ') });
      const emails = new Set(rs.flatMap((r) => r.emails));
      if (emails.size > 1) conflicts.push({ kind: 'email', detail: [...emails].join(' / ') });
      if (vans.size > 1) conflicts.push({ kind: 'van approval', detail: 'approved in some sources, not others' });
      return {
        members: rs,
        name,
        nameSource: survey ? 'self_reported' : 'legacy_import',
        aliases,
        // A volunteers row that is only a machine copy of a host contact
        // doesn't make someone a volunteer.
        isVolunteer: rs.some((r) => r.source === 'volunteers' && !r.hostContactId),
        isDriver: rs.some((r) => r.source === 'drivers'),
        isHost: rs.some((r) => r.source === 'host_contacts'),
        isVanDriver: vans.size > 1 ? 'conflict' : vans.has(true),
        hasLogin: rs.some((r) => r.source === 'users'),
        regions: [...new Set(rs.map((r) => r.region).filter((x): x is string => !!x))],
        conflicts,
      };
    };
    const people = [...clusters.values()].map((c) => propose(c.map((i) => records[i])));

    // ---- 1. proposed people -------------------------------------------------
    w('## 1. Proposed `people`');
    w();
    w(
      `Today's ${records.length} person records (in \`users\`, \`volunteers\`, \`drivers\`, \`host_contacts\`, \`contacts\`) collapse to about **${people.length} people**. Records are grouped when they share an email, a 10-digit phone, or an identical full name.`
    );
    w();
    const roleCount = (f: (p: Proposed) => boolean) => people.filter(f).length;
    table(
      ['Flag / attribute', 'People'],
      [
        ['`is_volunteer`', roleCount((p) => p.isVolunteer)],
        ['`is_driver`', roleCount((p) => p.isDriver)],
        ['`is_host`', roleCount((p) => p.isHost)],
        ['`is_van_driver`', roleCount((p) => p.isVanDriver === true)],
        ['`is_van_driver` undecided (sources disagree)', roleCount((p) => p.isVanDriver === 'conflict')],
        ['has a login (`users.person_id` would point here)', roleCount((p) => p.hasLogin)],
        ['no role at all (only in `users` or `contacts`)', roleCount((p) => !p.isVolunteer && !p.isDriver && !p.isHost)],
        ['more than one role', roleCount((p) => [p.isVolunteer, p.isDriver, p.isHost].filter(Boolean).length > 1)],
        ['`name_source = self_reported` (survey drivers)', roleCount((p) => p.nameSource === 'self_reported')],
        ['has at least one alias', roleCount((p) => p.aliases.length > 0)],
        ['host in more than one region', roleCount((p) => p.regions.length > 1)],
        ['needs a decision before backfill (section 2)', roleCount((p) => p.conflicts.some((c) => c.kind !== 'name'))],
      ]
    );
    w('Role combinations:');
    w();
    const combos = new Map<string, number>();
    people.forEach((p) => {
      const k =
        [p.isVolunteer && 'volunteer', p.isDriver && 'driver', p.isHost && 'host'].filter(Boolean).join(' + ') ||
        '(none)';
      const key = `${k}${p.hasLogin ? ', with login' : ''}`;
      combos.set(key, (combos.get(key) || 0) + 1);
    });
    table(['Roles', 'People'], [...combos.entries()].sort((a, b) => b[1] - a[1]));
    w('Source data quality (today\'s records):');
    w();
    table(
      ['Source', 'Records', 'No email', 'No usable phone (not 10 digits)'],
      sources.map((s) => {
        const rs = records.filter((r) => r.source === s);
        return [
          `\`${s}\``,
          rs.length,
          rs.filter((r) => r.emails.length === 0).length,
          rs.filter((r) => r.phone.length !== 10).length,
        ];
      })
    );

    // ---- 2. conflicts ---------------------------------------------------------
    w('## 2. People whose details conflict');
    w();
    w(
      'Each row is one proposed person whose sources disagree on phone, email or van approval. A `people` row holds one phone and one email, so each needs a decision before the backfill. Name differences alone are fine: the extra spellings become `person_name_aliases`.'
    );
    w();
    const conflicted = people
      .filter((p) => p.conflicts.some((c) => c.kind !== 'name'))
      .sort((a, b) => b.conflicts.length - a.conflicts.length);
    table(
      ['#', 'Proposed name', 'Conflicts', 'Sources (table#id: name · email · phone)'],
      conflicted.map((p, n) => [
        n + 1,
        p.name,
        p.conflicts.map((k) => `**${k.kind}**: ${k.detail}`).join('<br>'),
        p.members
          .map((r) => `${ref(r)}: ${r.name || '—'} · ${r.emails.join(', ') || '—'} · ${r.rawPhone || '—'}`)
          .join('<br>'),
      ])
    );
    w('### 2a. Proposed aliases');
    w();
    w('Spellings that would be recorded in `person_name_aliases` (canonical name first).');
    w();
    table(
      ['Canonical name', '`name_source`', 'Aliases'],
      people.filter((p) => p.aliases.length).map((p) => [p.name, p.nameSource, p.aliases.join(', ')])
    );

    // ---- 3. near-miss names -------------------------------------------------
    w('## 3. Possible same person, different spelling');
    w();
    w(
      'Pairs of proposed people that were NOT merged but whose names are close. "Result" applies the matching rules in docs/data-model.md: a nickname or 1–2 letter first-name difference merges (recording an alias) only when it is the sole candidate with that last name and email/phone don\'t contradict; anything else is flagged for a person to decide. "Contradicts" means both have an email or phone and none match (e.g. family members).'
    );
    w();
    type G = { first: string; last: string; p: Proposed; emails: Set<string>; phones: Set<string>; refs: string };
    const groups: G[] = [];
    for (const p of people) {
      const parts = normName(p.name).split(' ').filter(Boolean);
      if (parts.length < 2 || isAbbreviated(p.name)) continue;
      groups.push({
        first: parts[0],
        last: parts[parts.length - 1],
        p,
        emails: new Set(p.members.flatMap((r) => r.emails)),
        phones: new Set(p.members.map((r) => r.phone).filter((x) => x.length === 10)),
        refs: p.members.map(ref).join(', '),
      });
    }
    const contradicts = (a: G, b: G) => {
      if (a.emails.size + a.phones.size === 0 || b.emails.size + b.phones.size === 0) return false;
      for (const e of a.emails) if (b.emails.has(e)) return false;
      for (const x of a.phones) if (b.phones.has(x)) return false;
      return true;
    };
    const label = (g: G) => `${g.p.name} (${g.refs})`;
    const nearRows: unknown[][] = [];
    const byLast = new Map<string, G[]>();
    groups.forEach((g) => {
      if (!byLast.has(g.last)) byLast.set(g.last, []);
      byLast.get(g.last)!.push(g);
    });
    for (const [, gs] of byLast) {
      for (let i = 0; i < gs.length; i++)
        for (let j = i + 1; j < gs.length; j++) {
          const a = gs[i];
          const b = gs[j];
          if (a.first === b.first) continue;
          const nick = isNickname(a.first, b.first);
          const dist = levenshtein(a.first, b.first);
          if (!nick && dist > 2) continue;
          const sole = gs.length === 2;
          const contra = contradicts(a, b);
          nearRows.push([
            nick ? 'nickname' : `first name ${dist} letter(s) off`,
            label(a),
            label(b),
            contra ? 'yes' : 'no',
            sole && !contra ? 'merge, record alias' : sole ? 'flag: contact details differ' : `flag: ${gs.length} people share this last name`,
          ]);
        }
    }
    const byFirst = new Map<string, G[]>();
    groups.forEach((g) => {
      if (!byFirst.has(g.first)) byFirst.set(g.first, []);
      byFirst.get(g.first)!.push(g);
    });
    for (const [, gs] of byFirst) {
      for (let i = 0; i < gs.length; i++)
        for (let j = i + 1; j < gs.length; j++) {
          const a = gs[i];
          const b = gs[j];
          if (a.last === b.last) continue;
          const dist = levenshtein(a.last, b.last);
          if (dist > 2 || Math.min(a.last.length, b.last.length) < 4) continue;
          nearRows.push([
            `last name ${dist} letter(s) off`,
            label(a),
            label(b),
            contradicts(a, b) ? 'yes' : 'no',
            'flag: typo or different family?',
          ]);
        }
    }
    table(['Why', 'Person A', 'Person B', 'Contradicts', 'Result'], nearRows);

    // ---- 4. abbreviated names ----------------------------------------------
    w('## 4. Names too abbreviated to match');
    w();
    w(
      'Proposed people whose best available name is abbreviated ("Sarah P.") or a single word. Sheet sync can only match them by email or phone, so each needs a full name from someone who knows them.'
    );
    w();
    table(
      ['Proposed name', 'Sources', 'Email', 'Phone'],
      people
        .filter((p) => p.name && isAbbreviated(p.name))
        .map((p) => [
          p.name,
          p.members.map(ref).join(', '),
          [...new Set(p.members.flatMap((r) => r.emails))].join(', '),
          [...new Set(p.members.map((r) => r.rawPhone).filter(Boolean))].join(', '),
        ])
    );

    // ---- 5. survey drivers --------------------------------------------------
    w('## 5. `name_source = self_reported`: survey drivers');
    w();
    const surveyDrivers = records.filter((r) => r.source === 'drivers' && r.surveySubmitted);
    w(
      `${surveyDrivers.length} drivers have \`survey_submitted = true\`, so their names become \`self_reported\` and outrank every sheet or legacy spelling. The table below lists any whose name was edited after the survey was recorded, from the change history in \`audit_logs\`, so those can be spot-checked.`
    );
    w();
    // The change history is best-effort: if audit_logs has been reshaped or
    // is missing, skip this part instead of failing the whole audit.
    let logs: any[] = [];
    await client.query('SAVEPOINT audit_logs_read');
    try {
      logs = await q(
        `SELECT record_id, old_data, new_data, timestamp FROM audit_logs
          WHERE table_name = 'drivers' AND action = 'UPDATE' ORDER BY timestamp`
      );
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT audit_logs_read');
      w(`_Change history unavailable (${(err as Error).message}). Spot-check survey drivers by hand._`);
      w();
    }
    const parse = (s: string | null) => {
      try {
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    };
    const pick = (o: any, ...keys: string[]) => {
      if (!o) return undefined;
      for (const k of keys) if (k in o) return o[k];
      return undefined;
    };
    const surveyIds = new Set(surveyDrivers.map((d) => String(d.id)));
    const surveyMarkedAt = new Map<string, Date>();
    const nameChanges: unknown[][] = [];
    let logsSeen = 0;
    for (const l of logs) {
      if (!surveyIds.has(String(l.record_id))) continue;
      logsSeen++;
      const o = typeof l.old_data === 'string' ? parse(l.old_data) : l.old_data;
      const n = typeof l.new_data === 'string' ? parse(l.new_data) : l.new_data;
      const oldSurvey = pick(o, 'surveySubmitted', 'survey_submitted');
      const newSurvey = pick(n, 'surveySubmitted', 'survey_submitted');
      if (newSurvey === true && oldSurvey !== true && !surveyMarkedAt.has(String(l.record_id)))
        surveyMarkedAt.set(String(l.record_id), new Date(l.timestamp));
      const oldName = pick(o, 'name');
      const newName = pick(n, 'name');
      if (newName !== undefined && oldName !== undefined && normName(oldName) !== normName(newName)) {
        const marked = surveyMarkedAt.get(String(l.record_id));
        nameChanges.push([
          `drivers#${l.record_id}`,
          oldName,
          newName,
          new Date(l.timestamp).toISOString().slice(0, 10),
          marked ? (new Date(l.timestamp) > marked ? '**after** survey marked' : 'before/at survey') : 'survey date not in log',
        ]);
      }
    }
    w(
      `Audit-log entries found for these drivers: ${logsSeen}. If that's 0, the log doesn't reach back far enough to say; spot-check by hand.`
    );
    w();
    table(['Driver', 'Old name', 'New name', 'Changed on', 'Relative to survey'], nameChanges);

    // ---- 6. regions ---------------------------------------------------------
    w('## 6. Proposed `regions`');
    w();
    const hostRows = await q(`SELECT id, name, status FROM hosts ORDER BY name`);
    const hostByName = new Map(hostRows.map((h) => [normName(h.name), h]));
    const slashParts = new Map<string, string>();
    hostRows
      .filter((h) => h.name.includes('/'))
      .forEach((h) => h.name.split('/').forEach((p: string) => slashParts.set(normName(p), h.name)));
    const regionRows = await q(
      `SELECT host_name, COUNT(*)::int AS n, MIN(collection_date) AS first, MAX(collection_date) AS last
         FROM sandwich_collections WHERE deleted_at IS NULL
        GROUP BY host_name ORDER BY MAX(collection_date) DESC NULLS LAST, COUNT(*) DESC`
    );
    w(
      'One row per name found in the collections log (`sandwich_collections.host_name`, which stays as recorded). `status` is `active` when the name is an active row in today\'s `hosts` table (which really holds regions), otherwise `historic`. `rolls_up_into` is proposed for a part of a slash-named region ("Dunwoody" → "Dunwoody/PTC"); any other historic name needs a person to assign it. Dates are as stored.'
    );
    w();
    table(
      ['`name`', '`status`', '`rolls_up_into`', 'Collections', 'First', 'Last'],
      regionRows.map((r) => {
        const h = hostByName.get(normName(r.host_name));
        const part = slashParts.get(normName(r.host_name));
        const active = h && h.status === 'active';
        return [
          r.host_name,
          active ? 'active' : 'historic',
          active ? '—' : part ? part : '**needs assignment**',
          r.n,
          r.first,
          r.last,
        ];
      })
    );
    w('Regions in today\'s `hosts` table with no collections at all (still need a `regions` row if current):');
    w();
    const usedNames = new Set(regionRows.map((r) => normName(r.host_name)));
    table(
      ['id', 'name', 'status'],
      hostRows.filter((h) => !usedNames.has(normName(h.name))).map((h) => [h.id, h.name, h.status])
    );
    // server/bulk-map-hosts.ts rewrote "Group N" names; see whether its names exist.
    const bulkNames = [
      'Unnamed Group', 'Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5', 'Group 6', 'Group 7', 'Group 8',
      'Metro Atlanta', 'North Fulton', 'East Metro', 'West Metro', 'South Metro', 'Northeast Metro',
      'Northwest Metro', 'Central Atlanta', 'Southeast Metro',
    ];
    const bulk = regionRows.filter((r) => bulkNames.map(normName).includes(normName(r.host_name)));
    w(
      `\`server/bulk-map-hosts.ts\` check: ${bulk.length === 0 ? 'none of its names (old or new) appear in the collections log, so it most likely never ran against this data.' : 'these of its names appear in the collections log:'}`
    );
    w();
    if (bulk.length) table(['Name', 'Records'], bulk.map((r) => [r.host_name, r.n]));

    // ---- 7. drivers column usage -------------------------------------------
    w('## 7. Candidate `driver_profiles` columns');
    w();
    w(
      'What today\'s drivers data actually uses. Identity and contact columns move to `people` and the van flag to `people.is_van_driver`; of the rest, only columns that hold data are worth carrying into `driver_profiles`.'
    );
    w();
    const cols = await q<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'drivers' ORDER BY ordinal_position`
    );
    const [{ total }] = await q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM drivers`);
    const [{ active_total }] = await q<{ active_total: number }>(
      `SELECT COUNT(*)::int AS active_total FROM drivers WHERE is_active IS NOT FALSE`
    );
    w(`${total} driver rows, ${active_total} active. "Has a value" means non-empty text, any date/number, or **true** for yes/no columns (false is the default, so it says nothing).`);
    w();
    const PEOPLE_COLUMNS = new Set([
      'name', 'phone', 'email', 'address', 'home_address', 'notes', 'is_active', 'van_approved',
      'latitude', 'longitude', 'geocoded_at',
    ]);
    const BOOKKEEPING_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
    const colRows: unknown[][] = [];
    for (const c of cols) {
      const ident = `"${c.column_name.replace(/"/g, '""')}"`;
      const has =
        c.data_type === 'boolean'
          ? `${ident} = true`
          : c.data_type === 'text' || c.data_type.startsWith('character')
            ? `NULLIF(TRIM(${ident}), '') IS NOT NULL`
            : `${ident} IS NOT NULL`;
      const [r] = await q(
        `SELECT COUNT(*) FILTER (WHERE ${has})::int AS n,
                COUNT(*) FILTER (WHERE ${has} AND is_active IS NOT FALSE)::int AS n_active,
                MAX(updated_at) FILTER (WHERE ${has}) AS latest
           FROM drivers`
      );
      colRows.push([
        `\`${c.column_name}\``,
        c.data_type,
        r.n,
        total ? `${Math.round((100 * r.n) / total)}%` : '—',
        r.n_active,
        r.latest ? new Date(r.latest).toISOString().slice(0, 10) : '—',
        PEOPLE_COLUMNS.has(c.column_name)
          ? '`people`'
          : BOOKKEEPING_COLUMNS.has(c.column_name)
            ? '(bookkeeping)'
            : r.n === 0
              ? 'unused: drop?'
              : '`driver_profiles`?',
      ]);
    }
    table(['Column', 'Type', 'Rows with a value', '% of rows', 'Active rows with a value', 'Latest row update among them', 'Proposed home'], colRows);

    // ---- 8. van approval -----------------------------------------------------
    w('## 8. `is_van_driver`');
    w();
    w(
      `Van approval becomes one flag on \`people\`. Today it is recorded in four places; ${people.filter((p) => p.isVanDriver === true).length} proposed people are approved everywhere they appear, and ${people.filter((p) => p.isVanDriver === 'conflict').length} are approved in some places and not others.`
    );
    w();
    table(
      ['Recorded in', 'Approved'],
      sources
        .filter((s) => s !== 'contacts')
        .map((s) => [`\`${s}.van_approved\``, records.filter((r) => r.source === s && r.vanApproved === true).length])
    );
    w('Undecided (sources disagree):');
    w();
    table(
      ['Proposed name', 'Approved in', 'Not approved in'],
      people
        .filter((p) => p.isVanDriver === 'conflict')
        .map((p) => [
          p.name,
          p.members.filter((r) => r.vanApproved === true).map(ref).join(', '),
          p.members.filter((r) => r.vanApproved === false).map(ref).join(', '),
        ])
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out.join('\n'));
  console.error(`Report written to ${outPath}`);
}

// Only run when executed directly (lets tests import the helpers).
if (process.argv[1] && /audit-people-data\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
}
