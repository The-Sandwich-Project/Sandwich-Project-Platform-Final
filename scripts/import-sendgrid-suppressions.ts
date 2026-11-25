/**
 * One-off: copy SendGrid's suppression lists into email_suppressions, so people
 * who unsubscribed (or whose address bounced) under SendGrid stay that way
 * after the move to Twilio Email. Run it BEFORE cancelling SendGrid.
 *
 *   npm run email:import-sendgrid-suppressions -- --dry-run   # preview, saves nothing
 *   npm run email:import-sendgrid-suppressions -- --apply     # save
 *
 * Where the lists come from (pick one):
 *   default         SendGrid's API, using SENDGRID_API_KEY. The key needs
 *                   "Suppressions" read access (a Mail-Send-only key gets 403;
 *                   make a temporary read-only key in SendGrid).
 *   --from-csv DIR  CSV files exported from the SendGrid dashboard, named:
 *                     global_unsubscribes.csv, group_operational.csv,
 *                     group_newsletter.csv, bounces.csv, spam_reports.csv,
 *                     invalid_emails.csv
 *                   (any missing file is skipped; the column named "email" is used)
 *
 * Options:
 *   --operational-group ID  SendGrid unsubscribe group id for operational mail
 *                           (default SENDGRID_ASM_GROUP_ID_OPERATIONAL)
 *   --newsletter-group ID   ... for newsletter mail (default SENDGRID_ASM_GROUP_ID_NEWSLETTER)
 *   --url DB                database; default TARGET_DATABASE_URL, then
 *                           AUDIT_DATABASE_URL. Never DATABASE_URL (in the
 *                           Replit workspace that's the dev database).
 *
 * How each SendGrid list is imported (keeps today's delivery behaviour):
 *   operational group unsubscribes -> scope 'operational'
 *   newsletter group unsubscribes  -> scope 'newsletter'
 *   any other group's unsubscribes -> scope 'newsletter'
 *   global unsubscribes            -> scope 'newsletter' (operational mail
 *                                     bypassed these under SendGrid; many were
 *                                     caused by email scanners clicking links)
 *   bounces, spam reports, invalid -> scope 'all'
 *   blocks                         -> not imported (SendGrid didn't suppress them)
 *
 * A raw copy of everything read from SendGrid is saved to
 * audit-output/sendgrid-suppressions-<date>.json (gitignored) as a backup.
 * Safe to re-run: rows that already exist are left alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

type Scope = 'newsletter' | 'operational' | 'all';
type Reason = 'unsubscribe' | 'bounce' | 'spam_report' | 'invalid';

interface Row {
  email: string;
  scope: Scope;
  reason: Reason;
  note: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function normalize(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

function day(created: unknown): string {
  const n = typeof created === 'number' ? created : Number(created);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : 'unknown date';
}

// ---------------------------------------------------------------------------
// SendGrid API
// ---------------------------------------------------------------------------

const SENDGRID = 'https://api.sendgrid.com/v3';

async function sg(pathname: string): Promise<any> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is not set (or use --from-csv).');
  const res = await fetch(`${SENDGRID}${pathname}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `SendGrid ${pathname} returned ${res.status}: ${body.slice(0, 300)}${
        res.status === 403 ? '\n  The key needs "Suppressions" read access.' : ''
      }`
    );
  }
  return body ? JSON.parse(body) : null;
}

/** Paginated suppression list (limit/offset, max 500 per page). */
async function sgList(pathname: string): Promise<Array<{ email: string; created?: number; reason?: string }>> {
  const all: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await sg(`${pathname}?limit=500&offset=${offset}`);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 500) break;
  }
  return all;
}

interface RawLists {
  global_unsubscribes: Array<{ email: string; created?: number }>;
  /** stream is set for CSV files, whose name already says which stream they are. */
  groups: Array<{ id: number; name: string; emails: string[]; stream?: 'operational' | 'newsletter' }>;
  bounces: Array<{ email: string; created?: number; reason?: string }>;
  spam_reports: Array<{ email: string; created?: number }>;
  invalid_emails: Array<{ email: string; created?: number; reason?: string }>;
}

async function readFromApi(): Promise<RawLists> {
  console.log('Reading from the SendGrid API ...');
  const groupsMeta: Array<{ id: number; name: string }> = (await sg('/asm/groups')) || [];
  const groups = [];
  for (const g of groupsMeta) {
    const emails: string[] = (await sg(`/asm/groups/${g.id}/suppressions`)) || [];
    groups.push({ id: g.id, name: g.name, emails });
  }
  return {
    global_unsubscribes: await sgList('/suppression/unsubscribes'),
    groups,
    bounces: await sgList('/suppression/bounces'),
    spam_reports: await sgList('/suppression/spam_reports'),
    invalid_emails: await sgList('/suppression/invalid_emails'),
  };
}

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function readCsvEmails(file: string): Array<{ email: string; created?: number }> {
  if (!fs.existsSync(file)) {
    console.log(`  (no ${path.basename(file)}, skipped)`);
    return [];
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  let emailCol = header.findIndex((h) => h === 'email' || h === 'email address' || h === 'email_address');
  const createdCol = header.findIndex((h) => h === 'created' || h === 'created_at');
  const rows = emailCol === -1 ? lines : lines.slice(1);
  return rows
    .map((l) => parseCsvLine(l))
    .map((cols) => {
      const email = emailCol === -1 ? cols.find((c) => c.includes('@')) : cols[emailCol];
      const created = createdCol >= 0 ? Number(cols[createdCol]) || Date.parse(cols[createdCol]) / 1000 : undefined;
      return { email: email || '', created };
    })
    .filter((r) => r.email.includes('@'));
}

function readFromCsv(dir: string, opGroup?: number, nlGroup?: number): RawLists {
  console.log(`Reading CSV exports from ${dir} ...`);
  const f = (name: string) => readCsvEmails(path.join(dir, name));
  return {
    global_unsubscribes: f('global_unsubscribes.csv'),
    groups: [
      {
        id: opGroup ?? -1,
        name: 'operational (CSV)',
        stream: 'operational',
        emails: f('group_operational.csv').map((r) => r.email),
      },
      {
        id: nlGroup ?? -2,
        name: 'newsletter (CSV)',
        stream: 'newsletter',
        emails: f('group_newsletter.csv').map((r) => r.email),
      },
    ],
    bounces: f('bounces.csv'),
    spam_reports: f('spam_reports.csv'),
    invalid_emails: f('invalid_emails.csv'),
  };
}

// ---------------------------------------------------------------------------

function toRows(raw: RawLists, opGroup?: number, nlGroup?: number): Row[] {
  const rows: Row[] = [];
  const add = (email: unknown, scope: Scope, reason: Reason, note: string) => {
    const e = normalize(email);
    if (e) rows.push({ email: e, scope, reason, note });
  };
  for (const r of raw.global_unsubscribes) {
    add(r.email, 'newsletter', 'unsubscribe', `SendGrid global unsubscribe, ${day(r.created)}`);
  }
  for (const g of raw.groups) {
    // CSV files say their stream by name; API groups are matched by id.
    const scope: Scope = g.stream ?? (g.id === opGroup ? 'operational' : 'newsletter');
    for (const email of g.emails) add(email, scope, 'unsubscribe', `SendGrid group "${g.name}" (${g.id})`);
  }
  for (const r of raw.bounces) add(r.email, 'all', 'bounce', `SendGrid bounce, ${day(r.created)}`);
  for (const r of raw.spam_reports) add(r.email, 'all', 'spam_report', `SendGrid spam report, ${day(r.created)}`);
  for (const r of raw.invalid_emails) add(r.email, 'all', 'invalid', `SendGrid invalid email, ${day(r.created)}`);

  // One row per (email, scope); keep the first reason seen.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.email}|${r.scope}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
    console.error('Set TARGET_DATABASE_URL or AUDIT_DATABASE_URL (or pass --url).');
    process.exit(1);
  }
  let host = '(unparseable url)';
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep placeholder */
  }

  const num = (v?: string) => (v && Number.isInteger(Number(v)) ? Number(v) : undefined);
  const opGroup = num(arg('--operational-group') || process.env.SENDGRID_ASM_GROUP_ID_OPERATIONAL);
  const nlGroup = num(arg('--newsletter-group') || process.env.SENDGRID_ASM_GROUP_ID_NEWSLETTER);
  const csvDir = arg('--from-csv');
  if (opGroup === undefined && !csvDir) {
    console.warn(
      'No operational group id (SENDGRID_ASM_GROUP_ID_OPERATIONAL / --operational-group): every group will be imported as newsletter.'
    );
  }

  const raw = csvDir ? readFromCsv(csvDir, opGroup, nlGroup) : await readFromApi();

  const outDir = path.join(process.cwd(), 'audit-output');
  fs.mkdirSync(outDir, { recursive: true });
  const backup = path.join(outDir, `sendgrid-suppressions-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backup, JSON.stringify(raw, null, 2));
  console.log(`Raw copy saved to ${backup}\n`);

  const rows = toRows(raw, opGroup, nlGroup);
  console.log('Read from SendGrid:');
  console.log(`  Global unsubscribes:  ${raw.global_unsubscribes.length}`);
  for (const g of raw.groups) {
    const label = g.stream ?? (g.id === opGroup ? 'operational' : g.id === nlGroup ? 'newsletter' : 'other -> newsletter');
    console.log(`  Group "${g.name}" (${g.id}, ${label}): ${g.emails.length}`);
  }
  console.log(`  Bounces:              ${raw.bounces.length}`);
  console.log(`  Spam reports:         ${raw.spam_reports.length}`);
  console.log(`  Invalid emails:       ${raw.invalid_emails.length}`);
  const byScope = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.scope] = (acc[r.scope] || 0) + 1), acc), {});
  console.log(`\nRows to import: ${rows.length} (newsletter ${byScope.newsletter || 0}, operational ${byScope.operational || 0}, all ${byScope.all || 0})`);

  console.log(`\n${dryRun ? 'DRY RUN (nothing will be saved)' : 'APPLYING'} on database host: ${host}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query(`SELECT to_regclass('public.email_suppressions') AS t`);
    if (!exists.rows[0]?.t) {
      throw new Error(
        'email_suppressions does not exist on this database yet. Deploy (or restart the server) so migrations/20261128_email_suppressions.sql runs first.'
      );
    }
    // An existing row is upgraded when it's only an unsubscribe and SendGrid
    // says the address bounced / reported spam / is invalid: otherwise a later
    // "resubscribe" (which deletes unsubscribes) would leave it unblocked.
    const existing = await client.query(`SELECT email, scope, reason FROM email_suppressions`);
    const have = new Map<string, string>(existing.rows.map((r: any) => [`${r.email}|${r.scope}`, r.reason]));
    const fresh = rows.filter((r) => !have.has(`${r.email}|${r.scope}`));
    const upgrades = rows.filter(
      (r) => have.get(`${r.email}|${r.scope}`) === 'unsubscribe' && r.reason !== 'unsubscribe'
    );
    const toWrite = [...fresh, ...upgrades];
    console.log(
      `Already present: ${rows.length - fresh.length} (of which ${upgrades.length} will be upgraded from unsubscribe to bounce/spam/invalid). New: ${fresh.length}.`
    );

    if (apply && toWrite.length > 0) {
      await client.query('BEGIN');
      for (let i = 0; i < toWrite.length; i += 500) {
        const chunk = toWrite.slice(i, i + 500);
        const values: string[] = [];
        const params: string[] = [];
        chunk.forEach((r, j) => {
          const b = j * 4;
          values.push(`($${b + 1}, $${b + 2}, $${b + 3}, 'sendgrid_import', $${b + 4})`);
          params.push(r.email, r.scope, r.reason, r.note);
        });
        await client.query(
          `INSERT INTO email_suppressions (email, scope, reason, source, note) VALUES ${values.join(', ')}
           ON CONFLICT (email, scope) DO UPDATE
             SET reason = EXCLUDED.reason, source = EXCLUDED.source, note = EXCLUDED.note
             WHERE email_suppressions.reason = 'unsubscribe' AND EXCLUDED.reason <> 'unsubscribe'`,
          params
        );
      }
      await client.query('COMMIT');
      console.log(`✅ Imported ${fresh.length} new row(s), upgraded ${upgrades.length}.`);
    } else if (dryRun) {
      console.log('Nothing saved. Re-run with --apply to import.');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
