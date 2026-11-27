/**
 * One-time move of events off the retired "rescheduled" status.
 *
 * "Rescheduled" was retired (see shared/event-status-workflow.ts):
 *  - a rescheduled event WITH a scheduled date becomes plain "scheduled"
 *    (it already has its new confirmed date);
 *  - one WITHOUT a scheduled date goes back to "in_process" with
 *    needs_new_date_since set, so its card shows "Needs new date".
 * Nothing else about the events changes.
 *
 * Re-running is harmless: moved events no longer have status 'rescheduled'.
 *
 *   npm run statuses:retire-rescheduled -- --dry-run   # preview: counts and every event, changes nothing
 *   npm run statuses:retire-rescheduled -- --apply     # move them
 *
 * Database: TARGET_DATABASE_URL (or --url). Per CLAUDE.md, run --dry-run
 * against a Neon branch of production first, and only after the migration
 * 20261130_needs_new_date_since.sql has been deployed.
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
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'event_requests' AND column_name = 'needs_new_date_since'`,
    );
    if (col.rowCount === 0) {
      console.error('event_requests.needs_new_date_since does not exist yet: deploy the migration first.');
      process.exit(1);
    }

    const rows = (
      await client.query(
        `SELECT id, organization_name, scheduled_event_date
           FROM event_requests
          WHERE status = 'rescheduled' AND deleted_at IS NULL
          ORDER BY scheduled_event_date NULLS LAST, id`,
      )
    ).rows as Array<{ id: number; organization_name: string | null; scheduled_event_date: Date | null }>;

    const toScheduled = rows.filter((r) => r.scheduled_event_date);
    const toInProcess = rows.filter((r) => !r.scheduled_event_date);
    const day = (d: Date) => d.toISOString().slice(0, 10);

    console.log(`Rescheduled events: ${rows.length}`);
    console.log(`  -> Scheduled (they have a date):                ${toScheduled.length}`);
    for (const r of toScheduled) console.log(`     #${r.id}  ${r.organization_name ?? '(no name)'}  ${day(r.scheduled_event_date!)}`);
    console.log(`  -> In Process + "Needs new date" (no date):     ${toInProcess.length}`);
    for (const r of toInProcess) console.log(`     #${r.id}  ${r.organization_name ?? '(no name)'}`);

    if (dryRun || rows.length === 0) {
      console.log(dryRun ? '\nDry run: nothing changed.' : '\nNothing to do.');
      return;
    }

    await client.query('BEGIN');
    const a = await client.query(
      `UPDATE event_requests
          SET status = 'scheduled', status_changed_at = now(), updated_at = now()
        WHERE status = 'rescheduled' AND deleted_at IS NULL AND scheduled_event_date IS NOT NULL`,
    );
    const b = await client.query(
      `UPDATE event_requests
          SET status = 'in_process', needs_new_date_since = now(), status_changed_at = now(), updated_at = now()
        WHERE status = 'rescheduled' AND deleted_at IS NULL AND scheduled_event_date IS NULL`,
    );
    await client.query('COMMIT');
    console.log(`\nMoved ${a.rowCount} to Scheduled and ${b.rowCount} to In Process (needs new date).`);
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
