/**
 * Before publishing on Replit: does the dev database have everything the
 * production database has?
 *
 *   npm run db:compare
 *
 * Replit's publish screen makes production's structure match dev. Anything
 * production has that dev lacks (a table, a column, a rule) gets REMOVED from
 * production, with its data. This happened on 2026-10 (recurring collection
 * overrides) and 2026-11-19 (person_review_flags, people.is_team_member).
 * Run this first; if it lists anything under "Production has, dev doesn't",
 * don't publish until dev is fixed.
 *
 * Read-only on both databases.
 *   production: --prod <url>, or AUDIT_DATABASE_URL
 *   dev:        --dev <url>,  or DATABASE_URL (the Replit workspace's dev database)
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Snapshot {
  host: string;
  items: Map<string, string>; // "column people.email" -> "text, nullable"
  migrations: Set<string>;
}

async function snapshot(url: string): Promise<Snapshot> {
  let host = '(unparseable url)';
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep placeholder */
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = async (text: string) => (await client.query(text)).rows as any[];
  try {
    const items = new Map<string, string>();
    for (const r of await q(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )) {
      items.set(`table ${r.table_name}`, '');
    }
    // Type (with length), NOT NULL and default: a publish copies all three.
    for (const r of await q(
      `SELECT c.relname AS table_name, a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
              pg_get_expr(d.adbin, d.adrelid) AS def
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`
    )) {
      items.set(
        `column ${r.table_name}.${r.column_name}`,
        `${r.type}${r.not_null ? ', not null' : ''}${r.def != null ? `, default ${r.def}` : ''}`
      );
    }
    for (const r of await q(
      `SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.contype IN ('f', 'c', 'u', 'p')`
    )) {
      items.set(`rule ${r.tbl}.${r.conname}`, r.def);
    }
    for (const r of await q(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`)) {
      items.set(`index ${r.tablename}.${r.indexname}`, '');
    }
    const [{ ok }] = await q(`SELECT to_regclass('public._migrations') IS NOT NULL AS ok`);
    const migrations = new Set<string>(ok ? (await q(`SELECT name FROM _migrations`)).map((r) => r.name) : []);
    return { host, items, migrations };
  } finally {
    await client.end();
  }
}

async function main() {
  const prodUrl = arg('--prod') || process.env.AUDIT_DATABASE_URL;
  const devUrl = arg('--dev') || process.env.DATABASE_URL;
  if (!prodUrl || !devUrl) {
    console.error('Need both databases: AUDIT_DATABASE_URL (production) and DATABASE_URL (dev), or --prod / --dev.');
    process.exit(1);
  }
  if (prodUrl === devUrl) {
    console.error('Production and dev are the same connection string; nothing to compare.');
    process.exit(1);
  }
  const [prod, dev] = await Promise.all([snapshot(prodUrl), snapshot(devUrl)]);
  console.log(`production: ${prod.host}\ndev:        ${dev.host}\n`);

  // A missing table hides its own columns, rules and indexes from the list.
  const tableOf = (key: string) => key.split(' ')[1].split('.')[0];
  const missingFrom = (a: Snapshot, b: Snapshot) => {
    const lost = [...a.items.keys()].filter((k) => !b.items.has(k));
    const lostTables = new Set(lost.filter((k) => k.startsWith('table ')).map(tableOf));
    return lost.filter((k) => k.startsWith('table ') || !lostTables.has(tableOf(k))).sort();
  };
  // Postgres 16 (dev) and 17 (production) print some rules with the type
  // casts and brackets in different places. Ignore those when comparing rules,
  // so the same rule written two ways doesn't show up as a difference.
  const sameRule = (a: string, b: string) => {
    const norm = (d: string) => d.replace(/::[a-z ]+(\[\])?/gi, '').replace(/[()\s]/g, '');
    return norm(a) === norm(b);
  };
  const differs = [...prod.items.keys()]
    .filter((k) => {
      if (!dev.items.has(k)) return false;
      const a = prod.items.get(k)!;
      const b = dev.items.get(k)!;
      return a !== b && !(k.startsWith('rule ') && sameRule(a, b));
    })
    .sort();

  const danger = missingFrom(prod, dev);
  const devOnly = missingFrom(dev, prod);
  const migProdOnly = [...prod.migrations].filter((m) => !dev.migrations.has(m)).sort();
  const migDevOnly = [...dev.migrations].filter((m) => !prod.migrations.has(m)).sort();

  const section = (title: string, lines: string[]) => {
    console.log(`${title}: ${lines.length}`);
    lines.forEach((l) => console.log(`  ${l}`));
    console.log('');
  };
  section('Production has, dev doesn\'t (a publish would DELETE these from production)', danger);
  section('Different in the two (a publish would change production to dev\'s version)', differs.map(
    (k) => `${k}\n      production: ${prod.items.get(k)}\n      dev:        ${dev.items.get(k)}`
  ));
  section('Dev has, production doesn\'t (a publish would add these; usually fine)', devOnly);
  section('Database updates recorded in production but not dev', migProdOnly);
  section('Database updates recorded in dev but not production (they run on the next publish)', migDevOnly);

  // A difference a pending database update (a migration file dev has run and
  // production hasn't) makes on purpose is expected: the publish carries it.
  // Copying production's version into dev would undo the update, so never
  // suggest db:sync-dev for those.
  const pendingText = migDevOnly
    .map((m) => {
      try {
        return fs.readFileSync(path.join('migrations', m), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const nameOf = (k: string) => k.split(' ')[1].split('.').pop()!;
  const fromPending = (k: string) => pendingText.includes(nameOf(k));
  const unexplained = differs.filter((k) => !fromPending(k));

  if (danger.length) {
    console.log('NOT SAFE TO PUBLISH: production would lose the items listed at the top.\nFix dev with: npm run db:sync-dev -- --dry-run   (then --apply)');
    process.exitCode = 2;
  } else if (unexplained.length) {
    console.log(
      "NOT READY: a publish would change production to dev's version of:\n" +
        unexplained.map((k) => `  ${k}`).join('\n') +
        '\nNo pending database update explains these. Run: npm run db:sync-dev -- --apply   then check again.'
    );
  } else if (differs.length) {
    console.log(
      'Safe to publish. The differences above come from the pending database update(s) listed, which the publish carries.\n' +
        'Do NOT run db:sync-dev for them: it would undo the update in dev.'
    );
  } else {
    console.log('Safe to publish: dev has everything production has.');
  }
}

main().catch((err) => {
  console.error(`Couldn't compare: ${(err as Error).message}`);
  process.exitCode = 1;
});
