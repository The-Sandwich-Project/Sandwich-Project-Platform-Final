/**
 * Make event_requests.is_tsp_shopped strictly true/false.
 *
 * Only needed if migration 20261201_tsp_shopped_not_null.sql found NULLs and
 * skipped NOT NULL (it logs a notice saying so). A NULL here can only mean
 * "nobody marked TSP shopping", so it becomes false (the group shops), then
 * the NOT NULL rule is applied. Re-running is harmless.
 *
 *   npm run tsp-shopping:not-null -- --dry-run   # counts only, changes nothing
 *   npm run tsp-shopping:not-null -- --apply
 *
 * Database: TARGET_DATABASE_URL (or --url). Dry-run against a Neon branch of
 * production first.
 */
import pg from 'pg';

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
  const url = arg('--url') || process.env.TARGET_DATABASE_URL;
  if (!url) {
    console.error('Set TARGET_DATABASE_URL (or pass --url).');
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
    const nulls = Number((await client.query(`SELECT count(*) FROM event_requests WHERE is_tsp_shopped IS NULL`)).rows[0].count);
    const col = await client.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'event_requests' AND column_name = 'is_tsp_shopped'`,
    );
    const nullable = col.rows[0]?.is_nullable === 'YES';
    console.log(`Events with TSP shopping blank (NULL): ${nulls}  -> will become false (group shops)`);
    console.log(`NOT NULL rule already applied: ${nullable ? 'no' : 'yes'}`);
    if (dryRun) {
      console.log('\nDry run: nothing changed.');
      return;
    }
    await client.query('BEGIN');
    await client.query(`UPDATE event_requests SET is_tsp_shopped = false WHERE is_tsp_shopped IS NULL`);
    await client.query(`ALTER TABLE event_requests ALTER COLUMN is_tsp_shopped SET DEFAULT false`);
    await client.query(`ALTER TABLE event_requests ALTER COLUMN is_tsp_shopped SET NOT NULL`);
    await client.query('COMMIT');
    console.log(`\nSet ${nulls} to false and applied NOT NULL.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
