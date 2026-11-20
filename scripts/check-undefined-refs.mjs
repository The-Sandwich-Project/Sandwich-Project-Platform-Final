#!/usr/bin/env node
/**
 * Undefined-reference gate.
 *
 * Catches the bug class that took down event-requests in production: an
 * identifier used but never imported/defined. The Vite build does NOT typecheck,
 * so these ship silently and throw `ReferenceError` at runtime (often tripping an
 * ErrorBoundary). `tsc` *does* flag them, but its output is buried under ~1500
 * pre-existing, non-fatal type errors.
 *
 * This gate runs `tsc --noEmit`, keeps only the runtime-fatal "name doesn't
 * exist" diagnostics in code that ships or runs (client, shared, server), and fails when a NEW one
 * appears — either a brand-new offender or an additional occurrence of an
 * already-baselined one. It deliberately does NOT try to fix the pre-existing
 * type-error noise.
 *
 * Usage:
 *   node scripts/check-undefined-refs.mjs            # check (CI)
 *   node scripts/check-undefined-refs.mjs --update    # rewrite the baseline
 *
 * Drive the baseline toward empty by fixing the listed offenders, then
 * re-running with --update.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, 'undefined-refs-baseline.json');

// Runtime-fatal "this name/binding doesn't exist" diagnostics:
//   TS2304 Cannot find name 'X'
//   TS2552 Cannot find name 'X'. Did you mean 'Y'?
//   TS2305 Module '...' has no exported member 'X'
//   TS2724 '...' has no exported member named 'X'
const FATAL_CODES = new Set(['TS2304', 'TS2552', 'TS2305', 'TS2724']);

// Code that runs in production: client/src and the shared modules it imports
// via the @shared alias (these crash users' browsers), plus server/ (tsx and
// esbuild don't typecheck either, so a missing name there throws inside a
// route, cron job or email send and is usually caught and logged, so the
// feature fails silently). Skip tests.
const isShipped = (p) =>
  (p.startsWith('client/src/') || p.startsWith('shared/') || p.startsWith('server/')) &&
  !/\.(test|spec)\.|\/__tests__\/|\/test\//.test(p);

// Canonicalize so the baseline survives environment differences. TS reports the
// SAME missing name as TS2304 or TS2552 ("Did you mean 'Y'?") depending on which
// lib/global suggestions are available (this differs between CI and local), and
// the suggestion text itself varies. Collapse the code and strip the suggestion
// so a given offender hashes to one stable key everywhere. (Line/column are also
// dropped — they shift on unrelated edits — so occurrences are tracked by count.)
function canonicalKey(rel, code, message) {
  // Key by the offending IDENTIFIER only — never the full message — so a given
  // offender hashes identically regardless of TS's environment-dependent phrasing
  // (TS2304 vs TS2552 "...Did you mean 'Y'?", and TS2305 "Module '...' has no
  // exported member 'Y'" vs TS2724 "'...' has no exported member named 'Y'").
  if (code === 'TS2304' || code === 'TS2552') {
    const name = (message.match(/Cannot find name '([^']+)'/) || [, message])[1];
    return `${rel} :: cannot-find-name :: ${name}`;
  }
  if (code === 'TS2305' || code === 'TS2724') {
    const member = (message.match(/no exported member (?:named )?'([^']+)'/) || [, message])[1];
    return `${rel} :: no-exported-member :: ${member}`;
  }
  return `${rel} :: ${code} :: ${message}`;
}

/** @returns {Map<string, number>} canonical key -> occurrence count */
function collect() {
  let out = '';
  let threw = false;
  try {
    out = execSync('npx tsc --noEmit', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024, // tsc emits a lot; never truncate to <1MB
    });
  } catch (e) {
    // tsc exits non-zero whenever there are any errors (expected here); its
    // diagnostics are on stdout.
    threw = true;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }

  // If tsc exited non-zero but produced no parseable diagnostics, the run itself
  // failed (spawn error, OOM, maxBuffer overflow, bad flags). Fail loudly —
  // never treat "couldn't read diagnostics" as "no problems".
  if (threw && !/error TS\d+/.test(out)) {
    console.error('❌ Could not obtain TypeScript diagnostics — tsc did not run cleanly.');
    console.error(out.slice(0, 4000) || '(no output captured)');
    process.exit(2);
  }

  const re = /^(.+?\.tsx?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
  const counts = new Map();
  for (const line of out.split('\n')) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const [, file, , , code, message] = m;
    const rel = file.replaceAll(path.sep, '/');
    if (!FATAL_CODES.has(code) || !isShipped(rel)) continue;
    const key = canonicalKey(rel, code, message);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return {};
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
  // Back-compat: an older baseline was a plain array of keys.
  if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((k) => [k, 1]));
  return parsed;
}

const current = collect();

if (process.argv.includes('--update')) {
  const obj = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify(obj, null, 2)}\n`);
  const total = [...current.values()].reduce((a, b) => a + b, 0);
  console.log(`✅ Wrote baseline: ${current.size} offender key(s), ${total} occurrence(s) → ${path.relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}

const baseline = loadBaseline();
const introduced = [];
for (const [key, count] of [...current.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const base = baseline[key] || 0;
  if (count > base) {
    introduced.push(base > 0 ? `${key}  (baselined ${base}, now ${count})` : key);
  }
}

if (introduced.length > 0) {
  console.error('\n❌ New undefined-reference error(s) — these throw at runtime (the Vite build does not catch them):\n');
  for (const k of introduced) console.error(`   ${k}`);
  console.error(
    '\nFix the missing import / undefined identifier. If this is intentional and ' +
      'truly safe, run `npm run check:undefined-refs -- --update` to re-baseline.\n'
  );
  process.exit(1);
}

const shrunk = Object.keys(baseline).filter((k) => (current.get(k) || 0) < baseline[k]);
const knownTotal = [...current.values()].reduce((a, b) => a + b, 0);
console.log(`✅ No new undefined-reference errors (${current.size} known key(s), ${knownTotal} occurrence(s)).`);
if (shrunk.length > 0) {
  console.log(`👍 ${shrunk.length} baseline offender(s) reduced/fixed — run with --update to shrink the baseline.`);
}
process.exit(0);
