/**
 * Make the dev database's STRUCTURE match production, so a Replit publish
 * has nothing to delete. Run it when `npm run db:compare` says NOT SAFE.
 *
 *   npm run db:sync-dev -- --dry-run   # list what it would do
 *   npm run db:sync-dev -- --apply     # do it (dev only)
 *
 * Reads production (AUDIT_DATABASE_URL or --prod), writes ONLY to dev
 * (DATABASE_URL or --dev). It refuses to write to a Neon host or to the same
 * database as production. No rows are copied: missing tables come over
 * empty.
 *
 * What it does on dev, in order:
 *   1. creates tables production has and dev lacks (columns, defaults,
 *      sequences)
 *   2. renames dev constraints/indexes that match a production one exactly
 *      except for the name (db:push names them *_unique / *_fk; hand-written
 *      migrations got Postgres's *_key / *_fkey)
 *   3. adds production's missing constraints (foreign keys last) and indexes
 *   4. matches production's NOT NULL settings
 *   5. records production's applied migration files in dev's _migrations,
 *      so dev doesn't re-run them (their structure arrives through 1-4)
 * Each statement runs on its own; one that fails is reported and the rest
 * carry on. Re-running is safe: it only acts on what still differs.
 */
import pg from 'pg';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Q = (text: string, params?: unknown[]) => Promise<any[]>;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

interface Con { table: string; name: string; type: string; def: string }
interface Idx { table: string; name: string; def: string; backsConstraint: boolean }
interface Col { table: string; name: string; type: string; notNull: boolean; def: string | null; identity: string; generated: string }

async function read(q: Q) {
  const tables = new Set<string>(
    (await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`)).map((r) => r.relname)
  );
  const cols: Col[] = (
    await q(`SELECT c.relname AS table, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
                    a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS def,
                    a.attidentity AS identity, a.attgenerated AS generated
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY c.relname, a.attnum`)
  ).map((r) => ({ table: r.table, name: r.name, type: r.type, notNull: r.not_null, def: r.def, identity: r.identity, generated: r.generated }));
  const cons: Con[] = (
    await q(`SELECT cl.relname AS table, c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid) AS def
               FROM pg_constraint c
               JOIN pg_class cl ON cl.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = c.connamespace
              WHERE n.nspname = 'public' AND c.contype IN ('p', 'u', 'c', 'f')`)
  ).map((r) => ({ table: r.table, name: r.name, type: r.type, def: r.def }));
  const idxs: Idx[] = (
    await q(`SELECT t.relname AS table, i.relname AS name, pg_get_indexdef(i.oid) AS def,
                    EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid) AS backs
               FROM pg_index x
               JOIN pg_class i ON i.oid = x.indexrelid
               JOIN pg_class t ON t.oid = x.indrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'`)
  ).map((r) => ({ table: r.table, name: r.name, def: r.def, backsConstraint: r.backs }));
  const [{ ok }] = await q(`SELECT to_regclass('public._migrations') IS NOT NULL AS ok`);
  const migrations: string[] = ok ? (await q(`SELECT name FROM _migrations`)).map((r) => r.name) : [];
  return { tables, cols, cons, idxs, migrations };
}

/** An index definition without its own name, for spotting renamed twins. */
const idxShape = (i: Idx) => i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, 'CREATE $1INDEX ON ');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run (preview) or --apply (change dev).');
    process.exit(1);
  }
  const prodUrl = arg('--prod') || process.env.AUDIT_DATABASE_URL;
  const devUrl = arg('--dev') || process.env.DATABASE_URL;
  if (!prodUrl || !devUrl) {
    console.error('Need AUDIT_DATABASE_URL (production) and DATABASE_URL (dev), or --prod / --dev.');
    process.exit(1);
  }
  const devHost = new URL(devUrl).hostname;
  if (prodUrl === devUrl || /\.neon\.(tech|build)$/.test(devHost)) {
    console.error(`Refusing: the "dev" database (${devHost}) looks like production. This script only writes to dev.`);
    process.exit(1);
  }
  console.log(`${dryRun ? 'DRY RUN (dev is not changed)' : 'APPLYING to dev'}\nproduction (read only): ${new URL(prodUrl).hostname}\ndev:                    ${devHost}\n`);

  const prodC = new pg.Client({ connectionString: prodUrl });
  const devC = new pg.Client({ connectionString: devUrl });
  await Promise.all([prodC.connect(), devC.connect()]);
  const pq: Q = async (t, p = []) => (await prodC.query(t, p)).rows;
  const dq: Q = async (t, p = []) => (await devC.query(t, p)).rows;

  try {
    const prod = await read(pq);
    const dev = await read(dq);
    const steps: { why: string; sql: string; params?: unknown[] }[] = [];

    // 1. missing tables
    for (const t of [...prod.tables].filter((t) => !dev.tables.has(t)).sort()) {
      const cols = prod.cols.filter((c) => c.table === t);
      const seqs = new Set<string>();
      const lines = cols.map((c) => {
        const seq = c.def?.match(/^nextval\('([^']+)'::regclass\)$/)?.[1];
        if (seq) seqs.add(seq);
        let line = `${ident(c.name)} ${c.type}`;
        if (c.generated === 's') line += ` GENERATED ALWAYS AS ${c.def} STORED`;
        else if (c.identity) line += ` GENERATED ${c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
        else if (c.def) line += ` DEFAULT ${c.def}`;
        if (c.notNull) line += ' NOT NULL';
        return line;
      });
      for (const s of seqs) steps.push({ why: `sequence for new table ${t}`, sql: `CREATE SEQUENCE IF NOT EXISTS ${s}` });
      steps.push({ why: `missing table ${t} (empty)`, sql: `CREATE TABLE IF NOT EXISTS ${ident(t)} (\n  ${lines.join(',\n  ')}\n)` });
      for (const c of cols) {
        const seq = c.def?.match(/^nextval\('([^']+)'::regclass\)$/)?.[1];
        if (seq) steps.push({ why: `sequence belongs to ${t}.${c.name}`, sql: `ALTER SEQUENCE ${seq} OWNED BY ${ident(t)}.${ident(c.name)}` });
      }
    }

    // 2. same thing, different name: rename dev's to production's
    const devConNames = new Set(dev.cons.map((c) => `${c.table}.${c.name}`));
    const prodConNames = new Set(prod.cons.map((c) => `${c.table}.${c.name}`));
    const renamedCon = new Set<string>();
    for (const p of prod.cons.filter((c) => !devConNames.has(`${c.table}.${c.name}`))) {
      const twin = dev.cons.find(
        (d) => d.table === p.table && d.type === p.type && d.def === p.def &&
          !prodConNames.has(`${d.table}.${d.name}`) && !renamedCon.has(`${d.table}.${d.name}`)
      );
      if (twin) {
        renamedCon.add(`${twin.table}.${twin.name}`);
        renamedCon.add(`${p.table}.${p.name}`);
        steps.push({ why: `same rule, production's name`, sql: `ALTER TABLE ${ident(p.table)} RENAME CONSTRAINT ${ident(twin.name)} TO ${ident(p.name)}` });
      }
    }
    const devIdxNames = new Set(dev.idxs.map((i) => i.name));
    const prodIdxNames = new Set(prod.idxs.map((i) => i.name));
    const renamedIdx = new Set<string>();
    for (const p of prod.idxs.filter((i) => !i.backsConstraint && !devIdxNames.has(i.name))) {
      const twin = dev.idxs.find(
        (d) => !d.backsConstraint && d.table === p.table && idxShape(d) === idxShape(p) &&
          !prodIdxNames.has(d.name) && !renamedIdx.has(d.name)
      );
      if (twin) {
        renamedIdx.add(twin.name);
        renamedIdx.add(p.name);
        steps.push({ why: `same index, production's name`, sql: `ALTER INDEX ${ident(twin.name)} RENAME TO ${ident(p.name)}` });
      }
    }

    // 3. missing constraints (keys and checks before foreign keys), then indexes
    const order = { p: 0, u: 1, c: 2, f: 3 } as Record<string, number>;
    for (const c of prod.cons
      .filter((c) => !devConNames.has(`${c.table}.${c.name}`) && !renamedCon.has(`${c.table}.${c.name}`))
      .sort((a, b) => order[a.type] - order[b.type])) {
      steps.push({ why: `missing rule on ${c.table}`, sql: `ALTER TABLE ${ident(c.table)} ADD CONSTRAINT ${ident(c.name)} ${c.def}` });
    }
    for (const i of prod.idxs.filter((i) => !i.backsConstraint && !devIdxNames.has(i.name) && !renamedIdx.has(i.name))) {
      steps.push({ why: `missing index on ${i.table}`, sql: i.def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') });
    }

    // 4. NOT NULL to match production (tables both have)
    const devCol = new Map(dev.cols.map((c) => [`${c.table}.${c.name}`, c]));
    const otherDiffs: string[] = [];
    for (const p of prod.cols) {
      const d = devCol.get(`${p.table}.${p.name}`);
      if (!d) {
        if (dev.tables.has(p.table)) otherDiffs.push(`column ${p.table}.${p.name} is missing in dev (add it with a migration)`);
        continue;
      }
      if (d.type !== p.type) otherDiffs.push(`column ${p.table}.${p.name}: production ${p.type}, dev ${d.type}`);
      if (d.notNull !== p.notNull) {
        steps.push({
          why: `match production's NOT NULL`,
          sql: `ALTER TABLE ${ident(p.table)} ALTER COLUMN ${ident(p.name)} ${p.notNull ? 'SET' : 'DROP'} NOT NULL`,
        });
      }
    }

    // 5. migration records
    const devMig = new Set(dev.migrations);
    const missingMig = prod.migrations.filter((m) => !devMig.has(m)).sort();
    if (missingMig.length) {
      steps.push({
        why: `record ${missingMig.length} migration file(s) production already ran`,
        sql: `INSERT INTO _migrations (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`,
        params: [missingMig],
      });
    }

    let ok = 0;
    const failed: string[] = [];
    for (const s of steps) {
      const shown = s.sql.split('\n')[0] + (s.sql.includes('\n') ? ' …' : '');
      if (dryRun) {
        console.log(`would: ${shown}\n       (${s.why})`);
        continue;
      }
      try {
        await dq(s.sql, s.params);
        ok++;
        console.log(`done:   ${shown}`);
      } catch (err) {
        failed.push(`${shown}\n        -> ${(err as Error).message}`);
        console.log(`FAILED: ${shown}\n        -> ${(err as Error).message}`);
      }
    }

    console.log('');
    if (otherDiffs.length) {
      console.log(`Not handled here (tell Claude): ${otherDiffs.length}`);
      otherDiffs.forEach((d) => console.log(`  ${d}`));
      console.log('');
    }
    if (dryRun) {
      console.log(`${steps.length} change(s) planned for dev. Nothing was changed. Run with --apply to do them.`);
    } else {
      console.log(`${ok} of ${steps.length} change(s) made on dev${failed.length ? `; ${failed.length} failed (listed above)` : ''}.`);
      console.log('Now run: npm run db:compare');
    }
  } finally {
    await Promise.all([prodC.end(), devC.end()]);
  }
}

main().catch((err) => {
  console.error(`Stopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
