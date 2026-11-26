/**
 * One-time backfill for event_requests.last_human_update_at (event alerts).
 *
 * The column was added by migrations/20261129_event_alert_digest.sql with no
 * value for existing events (new events default to now()). Until this runs,
 * the "no updates" alert falls back to updated_at for those events, which the
 * Google Sheet sync keeps bumping. This fills them with updated_at, the best
 * estimate of the last real change, ONCE, so the sync can't move it again.
 *
 * Only fills empty values, so re-running is harmless.
 *
 *   npm run alerts:backfill -- --dry-run   # preview: counts and samples, changes nothing
 *   npm run alerts:backfill -- --apply     # fill them
 *
 * Database: TARGET_DATABASE_URL (or --url). Per CLAUDE.md, run --dry-run
 * against a Neon branch of production first, then --apply on production
 * BEFORE removing CHECK_IN_REMINDERS_DRY_RUN.
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
    const col = await client.query(
      `select 1 from information_schema.columns where table_name = 'event_requests' and column_name = 'last_human_update_at'`,
    );
    if (col.rowCount === 0) {
      console.error('event_requests.last_human_update_at does not exist yet: deploy the migration first.');
      process.exit(1);
    }

    const counts = await client.query(`
      select count(*)::int as empty,
             count(*) filter (where status in ('new', 'in_process', 'scheduled', 'rescheduled') and deleted_at is null)::int as active_empty
        from event_requests
       where last_human_update_at is null`);
    const { empty, active_empty } = counts.rows[0];
    console.log(`Events with no last_human_update_at:  ${empty}`);
    console.log(`  of which active (get alerts):       ${active_empty}`);

    const sample = await client.query(`
      select id, status, updated_at, created_at
        from event_requests
       where last_human_update_at is null and deleted_at is null
         and status in ('new', 'in_process', 'scheduled', 'rescheduled')
       order by updated_at desc nulls last
       limit 10`);
    if (sample.rowCount) {
      console.log('\nSample (active events; will be set to updated_at):');
      for (const r of sample.rows) {
        console.log(`  #${r.id}  ${String(r.status).padEnd(11)}  updated_at=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
      }
    }

    if (dryRun) {
      console.log(`\nNothing changed. Re-run with --apply to fill ${empty} event(s).`);
      return;
    }

    const res = await client.query(
      `update event_requests
          set last_human_update_at = coalesce(updated_at, created_at)
        where last_human_update_at is null`,
    );
    console.log(`\nFilled ${res.rowCount} event(s).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
