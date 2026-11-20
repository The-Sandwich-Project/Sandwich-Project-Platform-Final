/**
 * Put back the "needs a decision" review flags and the team-member ticks on
 * `people` after the 2026-11-19 publish removed them (see
 * migrations/20261124_restore_person_review_flags.sql).
 *
 *   npm run people:repair-flags -- --dry-run   # preview: does everything, saves nothing
 *   npm run people:repair-flags -- --apply     # save it
 *
 * Connection: --url, or TARGET_DATABASE_URL, or AUDIT_DATABASE_URL. Never
 * DATABASE_URL (in the Replit workspace that's the dev database).
 *
 * How: it re-reads the old person tables and re-runs the backfill's grouping
 * (the same code, imported from backfill-people.ts), so it arrives at the same
 * flags and the same "has an app login" answer as the original fill-in. Each
 * result is matched to the existing person through legacy_person_ids, so no
 * person is created, renamed or merged. Only two things are written:
 *   - people.is_team_member, for people whose value differs
 *   - person_review_flags rows, skipping any identical flag already there
 * so running it twice changes nothing the second time. One transaction:
 * --dry-run rolls back, and a failed --apply leaves nothing behind.
 *
 * The full report (names, flag details) goes to audit-output/, which is
 * gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadRecords, planPeople, ref } from './backfill-people';

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
  const outPath =
    arg('--out') || path.join('audit-output', `people-repair-flags-${dryRun ? 'preview' : 'applied'}-${today}.md`);
  console.log(`${dryRun ? 'DRY RUN (nothing will be saved)' : 'APPLYING'} on database host: ${host}\n`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows as any[];

  try {
    await client.query('BEGIN');
    const [{ flags_table, team_col }] = await q(
      `SELECT to_regclass('public.person_review_flags') IS NOT NULL AS flags_table,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'people'
                         AND column_name = 'is_team_member') AS team_col`
    );
    if (!flags_table || !team_col) {
      throw new Error(
        'person_review_flags or people.is_team_member is still missing. Publish the app first ' +
          '(migration 20261124 puts them back), then run this again.'
      );
    }

    const legacy = new Map<string, number>();
    for (const r of await q(`SELECT source_table, source_key, person_id FROM legacy_person_ids`)) {
      legacy.set(`${r.source_table}#${r.source_key}`, r.person_id);
    }
    const current = new Map<number, { name: string; isTeamMember: boolean }>();
    for (const r of await q(`SELECT id, first_name, last_name, is_team_member FROM people`)) {
      current.set(r.id, { name: [r.first_name, r.last_name].filter(Boolean).join(' '), isTeamMember: r.is_team_member });
    }
    const existingFlags = new Set(
      (await q(`SELECT person_id, kind, detail FROM person_review_flags`)).map((f) => `${f.person_id}|${f.kind}|${f.detail}`)
    );

    const planned = planPeople(await loadRecords(q));

    // Match each planned person to the person row the backfill made for it.
    const unmatched: string[] = []; // records added since the backfill
    const ambiguous: string[] = []; // records now split across people
    const teamOf = new Map<number, boolean>();
    const flagsOf = new Map<number, Map<string, { kind: string; detail: string }>>();
    for (const p of planned) {
      const ids = new Set(p.members.map((r) => legacy.get(ref(r))).filter((id): id is number => id != null));
      if (ids.size === 0) {
        unmatched.push(`${p.display} (${p.members.map(ref).join(', ')})`);
        continue;
      }
      if (ids.size > 1) {
        ambiguous.push(`${p.display} (${p.members.map(ref).join(', ')}) -> people ${[...ids].join(', ')}`);
        continue;
      }
      const id = [...ids][0];
      teamOf.set(id, (teamOf.get(id) ?? false) || p.isTeamMember);
      const m = flagsOf.get(id) ?? new Map();
      p.flags.forEach((f) => m.set(`${f.kind}|${f.detail}`, f));
      flagsOf.set(id, m);
    }

    const teamChanges: { id: number; name: string; to: boolean }[] = [];
    for (const [id, want] of teamOf) {
      const row = current.get(id);
      if (row && row.isTeamMember !== want) teamChanges.push({ id, name: row.name, to: want });
    }
    for (const c of teamChanges) {
      await q(`UPDATE people SET is_team_member = $1, updated_at = NOW() WHERE id = $2`, [c.to, c.id]);
    }

    const added: { id: number; name: string; kind: string; detail: string }[] = [];
    let alreadyThere = 0;
    for (const [id, m] of flagsOf) {
      for (const f of m.values()) {
        if (existingFlags.has(`${id}|${f.kind}|${f.detail}`)) {
          alreadyThere++;
          continue;
        }
        await q(`INSERT INTO person_review_flags (person_id, kind, detail) VALUES ($1,$2,$3)`, [id, f.kind, f.detail]);
        added.push({ id, name: current.get(id)?.name ?? `#${id}`, kind: f.kind, detail: f.detail });
      }
    }

    const summary = [
      `People in the database:         ${current.size}`,
      `Team members after this:        ${[...current].filter(([id, r]) => teamOf.get(id) ?? r.isTeamMember).length}`,
      `  team-member ticks changed:    ${teamChanges.length}`,
      `Review flags added:             ${added.length} on ${new Set(added.map((a) => a.id)).size} people`,
      `  already there (skipped):      ${alreadyThere}`,
      `Records not in the fill-in (skipped, handled by later sync steps): ${unmatched.length}`,
      `Records now split across people (skipped): ${ambiguous.length}`,
    ];
    const md = [
      `# People flag repair ${dryRun ? 'preview' : 'applied'} (${new Date().toISOString()}, ${host})`,
      '',
      '> Contains names. Keep it out of git and public channels.',
      '',
      '```',
      ...summary,
      '```',
      '',
      '## Review flags added',
      '',
      '| Person | Kind | Detail |',
      '|---|---|---|',
      ...added.map((a) => `| ${a.name} | ${a.kind} | ${a.detail.replace(/\|/g, '/')} |`),
      '',
      '## Team-member ticks changed',
      '',
      ...teamChanges.map((c) => `- ${c.name}: ${c.to ? 'on' : 'off'}`),
      '',
      '## Skipped: not in the fill-in',
      '',
      ...unmatched.map((u) => `- ${u}`),
      '',
      '## Skipped: split across people',
      '',
      ...ambiguous.map((u) => `- ${u}`),
    ];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md.join('\n'));

    console.log(summary.join('\n'));
    console.log('\nFlags:');
    added.forEach((a) => console.log(`  ${a.name}: ${a.kind}`));
    console.log(`\nFull report: ${outPath}`);
    if (apply) {
      await client.query('COMMIT');
      console.log('\nSaved.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run: every change ran and passed the database rules, then was rolled back. Nothing was saved.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nStopped, nothing saved: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
