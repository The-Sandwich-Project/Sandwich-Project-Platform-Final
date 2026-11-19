#!/usr/bin/env tsx
/**
 * Schema integrity gate.
 *
 * Enforces the "Schema rules" in CLAUDE.md so that links between tables are
 * declared, documented, and enforced instead of living only in application
 * code. It loads shared/schema.ts and inspects the real Drizzle table and
 * relations objects (not regexes over the source), then checks:
 *
 *   missing-fk          A column named `*_id` (other than `id`) has no foreign
 *                       key. Every link to another table must be a real FK.
 *                       Columns that hold an EXTERNAL id (Google Sheet row id,
 *                       Twilio SID, ...) go in schema-integrity-exceptions.json
 *                       with a reason instead.
 *   fk-no-ondelete      A foreign key doesn't say what happens when the row it
 *                       points to is deleted. The choice (restrict / cascade /
 *                       set null) must be deliberate. 'no action' (Postgres's
 *                       and Drizzle's default) is rejected because it can't be
 *                       distinguished from omitting onDelete.
 *   missing-relation    A foreign key has no matching `one(...)` entry in a
 *                       `relations()` block for its table. relations() is how
 *                       the schema file documents how tables connect.
 *   undocumented-table  A table isn't mentioned in docs/data-model.md as
 *                       `table_name` (in backticks).
 *
 * Tables that predate these rules are listed in schema-integrity-baseline.json
 * and don't fail the build. The baseline is a debt list that only shrinks:
 *   - a NEW violation fails (fix it; don't add it to the baseline)
 *   - a baselined violation that has been FIXED also fails until the baseline
 *     is regenerated, so fixes are locked in and can't silently regress
 *
 * Usage:
 *   npx tsx scripts/check-schema-integrity.ts            # check (CI)
 *   npx tsx scripts/check-schema-integrity.ts --update   # rewrite the baseline
 *
 * Only run --update after FIXING violations. Running it to make new
 * violations pass defeats the gate; reviewers should reject a PR whose
 * baseline diff adds lines.
 *
 * Not checked here: whether each FK also exists in the live database. The
 * migrations in /migrations are hand-written, so a PR that adds an FK must also
 * add it in that migration's SQL (see CLAUDE.md). That part is reviewed by eye.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is, One, Relations, createTableRelationsHelpers } from 'drizzle-orm';
import * as schema from '../shared/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'schema-integrity-baseline.json');
const EXCEPTIONS = path.join(__dirname, 'schema-integrity-exceptions.json');
const DATA_MODEL_DOC = path.join(ROOT, 'docs', 'data-model.md');

type Exceptions = Record<string, string>; // "table.column" -> reason

function loadJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

export function collectViolations(
  mod: Record<string, unknown>,
  docText: string,
  exceptions: Exceptions
): string[] {
  const tables = Object.values(mod).filter((v): v is PgTable => is(v, PgTable));
  const relationBlocks = Object.values(mod).filter((v): v is Relations => is(v, Relations));

  // table name -> set of local column names covered by a one(...) relation
  const relatedColumns = new Map<string, Set<string>>();
  for (const block of relationBlocks) {
    const tableName = getTableConfig(block.table as PgTable).name;
    const config = block.config(createTableRelationsHelpers(block.table));
    const set = relatedColumns.get(tableName) ?? new Set<string>();
    for (const rel of Object.values(config)) {
      if (!is(rel, One)) continue;
      for (const field of rel.config?.fields ?? []) set.add(field.name);
    }
    relatedColumns.set(tableName, set);
  }

  const violations: string[] = [];
  for (const table of tables) {
    const cfg = getTableConfig(table);
    const t = cfg.name;

    // Must appear as `table_name` in backticks: a bare word match would let
    // ordinary prose ("users", "hosts", "people") count as documentation.
    if (!docText.includes('`' + t + '`')) {
      violations.push(`undocumented-table :: ${t}`);
    }

    const fkColumns = new Set<string>();
    for (const fk of cfg.foreignKeys) {
      const cols = fk.reference().columns.map((c) => c.name);
      cols.forEach((c) => fkColumns.add(c));
      const label = `${t}.${cols.join('+')}`;
      // Drizzle fills in 'no action' when onDelete is omitted, so an explicit
      // 'no action' can't be told apart from forgetting. Require one of the
      // others ('restrict' behaves the same for non-deferred constraints).
      if (!fk.onDelete || fk.onDelete === 'no action') {
        violations.push(`fk-no-ondelete :: ${label}`);
      }
      const covered = relatedColumns.get(t);
      if (!cols.every((c) => covered?.has(c))) violations.push(`missing-relation :: ${label}`);
    }

    for (const col of cfg.columns) {
      if (col.name === 'id' || !col.name.endsWith('_id')) continue;
      if (fkColumns.has(col.name)) continue;
      if (exceptions[`${t}.${col.name}`]) continue;
      violations.push(`missing-fk :: ${t}.${col.name}`);
    }
  }
  return [...new Set(violations)].sort();
}

function main() {
  const update = process.argv.includes('--update');
  const docText = existsSync(DATA_MODEL_DOC) ? readFileSync(DATA_MODEL_DOC, 'utf8') : '';
  const exceptions = loadJson<Exceptions>(EXCEPTIONS, {});

  for (const [key, reason] of Object.entries(exceptions)) {
    if (!reason || !reason.trim()) {
      console.error(`schema-integrity-exceptions.json: "${key}" needs a reason.`);
      process.exit(1);
    }
  }

  const current = collectViolations(schema as Record<string, unknown>, docText, exceptions);

  if (update) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    console.log(`Baseline written: ${current.length} pre-existing violations.`);
    return;
  }

  const baseline = new Set(loadJson<string[]>(BASELINE, []));
  const currentSet = new Set(current);
  const added = current.filter((v) => !baseline.has(v));
  const fixed = [...baseline].filter((v) => !currentSet.has(v));

  if (added.length === 0 && fixed.length === 0) {
    console.log(`Schema integrity OK (${baseline.size} baselined legacy violations remain).`);
    return;
  }

  if (added.length) {
    console.error(`\n${added.length} NEW schema violation(s). Fix these; do not baseline them:\n`);
    for (const v of added) console.error(`  ${v}`);
    console.error(
      '\nSee "Schema rules" in CLAUDE.md. An `_id` column that holds an external id (not a link to' +
        '\nanother table) goes in scripts/schema-integrity-exceptions.json with a reason.'
    );
  }
  if (fixed.length) {
    console.error(`\n${fixed.length} baselined violation(s) are now fixed. Lock that in by running:`);
    console.error('  npx tsx scripts/check-schema-integrity.ts --update\n');
    for (const v of fixed) console.error(`  ${v}`);
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
