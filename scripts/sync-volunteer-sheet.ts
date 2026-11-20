/**
 * Read the volunteer Google Sheet into `people` / `volunteer_profiles`
 * (people/places rebuild, step 7). The same sync the app runs daily and from
 * the People page's "Sync now" button.
 *
 *   npm run volunteers:sync -- --dry-run   # preview: reads everything, saves nothing
 *   npm run volunteers:sync -- --apply     # save it
 *
 * Options:
 *   --allow-many-missing   let more than a third of the volunteers go missing
 *                          from the sheet in one run (normally refused)
 *   --url <db>             database; default TARGET_DATABASE_URL, then
 *                          AUDIT_DATABASE_URL. Never DATABASE_URL (in the
 *                          Replit workspace that's the dev database).
 *
 * The full report (names and what changed) is written to audit-output/,
 * which is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runVolunteerSheetSync, VolunteerSyncError } from '../server/services/people/volunteer-sheet-sync';

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
    console.error('Set TARGET_DATABASE_URL or AUDIT_DATABASE_URL (or pass --url).');
    process.exit(1);
  }
  let host = '(unparseable url)';
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep placeholder */
  }
  console.log(`${dryRun ? 'DRY RUN (nothing will be saved)' : 'APPLYING'} on database host: ${host}\n`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await runVolunteerSheetSync({
      q: async (text, params = []) => (await client.query(text, params as any[])).rows,
      trigger: 'script',
      dryRun,
      allowManyMissing: process.argv.includes('--allow-many-missing'),
    });
    const { plan, summary } = result;
    const lines = [
      `Rows on the sheet:            ${summary.rowsRead}`,
      `Matched to people:            ${summary.matched}`,
      `  with changes:               ${summary.changed}`,
      `New people from the sheet:    ${summary.added}`,
      `No longer on the sheet:       ${summary.missing}`,
      `Need a decision (conflicts):  ${summary.conflicts}`,
      `Rows/values it couldn't use:  ${summary.problems}`,
    ];
    console.log(lines.join('\n'));
    if (plan.problems.length) {
      console.log("\nCouldn't use:");
      plan.problems.forEach((p) => console.log(`  - ${p}`));
    }

    const today = new Date().toISOString().slice(0, 10);
    const out = path.join('audit-output', `volunteer-sync-${dryRun ? 'preview' : 'applied'}-${today}.md`);
    const md = [
      `# Volunteer sheet sync ${dryRun ? 'preview' : 'applied'} (${new Date().toISOString()}, ${host})`,
      '',
      '> Contains names and contact details. Keep it out of git and public channels.',
      '',
      '```',
      ...lines,
      '```',
      '',
      '## Changes',
      '',
      ...plan.updates.filter((u) => u.changes.length).map((u) => `- **${u.display}**: ${u.changes.join('; ')}`),
      '',
      '## Need a decision',
      '',
      '| Person | Field | Kind | Sheet | App |',
      '|---|---|---|---|---|',
      ...plan.updates.flatMap((u) =>
        u.conflicts.map((c) => `| ${u.display} | ${c.field} | ${c.kind} | ${c.sheetValue} | ${c.appValue ?? '—'} |`)
      ),
      ...plan.newPeople.flatMap((n) =>
        n.conflicts.map((c) => `| ${n.firstName} ${n.lastName} (new) | ${c.field} | ${c.kind} | ${c.sheetValue} | — |`)
      ),
      '',
      '## New people (flagged to check for duplicates)',
      '',
      ...plan.newPeople.map((n) => `- Row ${n.rowNumber}: ${n.firstName} ${n.lastName}`),
      '',
      '## No longer on the sheet (flagged, nothing changed)',
      '',
      ...plan.missing.map((m) => `- ${m.display}${m.alreadyFlagged ? ' (already flagged)' : ''}`),
      '',
      "## Couldn't use",
      '',
      ...plan.problems.map((p) => `- ${p}`),
    ];
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md.join('\n'));
    console.log(`\nFull report (names and changes): ${out}`);
    console.log(dryRun ? '\nDry run: nothing was saved.' : `\nSaved (sync run #${result.runId}).`);
  } catch (err) {
    const msg = err instanceof VolunteerSyncError ? err.message : `Unexpected error: ${(err as Error).message}`;
    console.error(`\nStopped: ${msg}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
