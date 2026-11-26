/**
 * One-time backfill for event_requests.last_human_update_at (event alerts).
 *
 * "No updates" measures last_human_update_at: the last time a PERSON changed
 * the event (the Google Sheet sync and cron jobs bump updated_at instead).
 * Events that existed before the column have no real value for it. This fills
 * them with updated_at, the best estimate of their last real change, ONCE, so
 * the sync can't move it later.
 *
 * Two shapes of "no real value" are handled:
 *  1. NULL: the column was added without a default (how the migration file
 *     does it).
 *  2. The publish moment: Replit's publish screen applied the change as a
 *     single `ADD COLUMN ... DEFAULT now()`, which stamped EVERY existing
 *     event with the same timestamp. That stamp is detected from the data:
 *     the one timestamp shared by many events, all created before it. Real
 *     edits made since publishing have their own, later timestamps and are
 *     left alone. If no clear stamp is found, nothing in shape 2 is touched.
 *
 * Re-running is harmless: filled rows no longer match either shape.
 *
 *   npm run alerts:backfill -- --dry-run   # preview: counts and samples, changes nothing
 *   npm run alerts:backfill -- --apply     # fill them
 *
 * Database: TARGET_DATABASE_URL (or --url). Per CLAUDE.md, run --dry-run
 * against a Neon branch of production first (made AFTER the publish), then
 * --apply on production BEFORE removing CHECK_IN_REMINDERS_DRY_RUN.
 */
import pg from 'pg';

/** A shared timestamp counts as the publish stamp only if this many events carry it... */
const MIN_STAMPED = 10;
/**
 * ...and they're at least this share of all events created before it. People
 * keep editing events after the publish (each edit gives that event its own
 * new timestamp), so the share shrinks over time; a microsecond-exact
 * timestamp shared by most older events only comes from one bulk statement.
 */
const MIN_SHARE = 0.5;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// `at` is kept as the exact text Postgres gives (microseconds, no time zone): a JS Date
// would be re-read in the shell's local time zone and could miss the exact match.
type Stamp = { at: string; count: number; olderEvents: number; updatedAfter: number };

/**
 * The publish-moment stamp, if the data clearly shows one (see header).
 *
 * Every timestamp group is a candidate, not just the largest: other bulk
 * inserts also share one timestamp (the planning-sheet import adds a whole
 * batch in one statement, so those events share created_at AND
 * last_human_update_at). Such a batch is never the stamp (its rows weren't
 * created before it) but it can outnumber the remaining stamped events, so
 * candidates whose rows weren't all created earlier are skipped, not fatal.
 */
async function findPublishStamp(client: pg.Client): Promise<Stamp | null> {
  const candidates = await client.query(
    `SELECT last_human_update_at::text AS at,
            count(*)::int AS count,
            count(*) FILTER (WHERE updated_at > last_human_update_at)::int AS updated_after
       FROM event_requests
      WHERE last_human_update_at IS NOT NULL
      GROUP BY last_human_update_at
     HAVING count(*) >= $1 AND bool_and(created_at < last_human_update_at)
      ORDER BY count(*) DESC
      LIMIT 20`,
    [MIN_STAMPED],
  );
  for (const row of candidates.rows as { at: string; count: number; updated_after: number }[]) {
    const older = await client.query(
      `SELECT count(*)::int AS n FROM event_requests WHERE created_at < $1::timestamp`,
      [row.at],
    );
    const olderEvents = older.rows[0].n as number;
    if (olderEvents > 0 && row.count / olderEvents >= MIN_SHARE) {
      return { at: row.at, count: row.count, olderEvents, updatedAfter: row.updated_after };
    }
  }
  return null;
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
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'event_requests' AND column_name = 'last_human_update_at'`,
    );
    if (col.rowCount === 0) {
      console.error('event_requests.last_human_update_at does not exist yet: deploy the migration first.');
      process.exit(1);
    }

    // Shape 1: empty values
    const nulls = (await client.query(`SELECT count(*)::int AS n FROM event_requests WHERE last_human_update_at IS NULL`)).rows[0].n as number;
    console.log(`Empty (NULL) values:                 ${nulls}`);

    // Shape 2: the publish-moment stamp
    const stamp = await findPublishStamp(client);
    if (stamp) {
      console.log(`Stamped at the publish moment:       ${stamp.count}  (all at ${stamp.at}; ${stamp.olderEvents} events existed then)`);
      if (stamp.updatedAfter > 0) {
        console.log(
          `  of which ${stamp.updatedAfter} had updated_at bumped since (sheet sync); their earlier updated_at is gone,\n` +
            `  so they keep the publish moment itself, the latest they could have been changed by a person\n` +
            `  (already their final value, so they aren't counted below).`,
        );
      }
    } else {
      console.log('Stamped at the publish moment:       none detected (no single timestamp shared by most older events)');
    }

    // What each row would become: updated_at, capped at the publish moment
    // (a later updated_at was the sync, not a person), falling back to created_at.
    const target = stamp
      ? `least(coalesce(updated_at, created_at), $1::timestamp)`
      : `coalesce(updated_at, created_at)`;
    // Rows already holding their final value are skipped: a sync-bumped event
    // is set to the publish moment itself, which still equals the stamp, and
    // would otherwise be re-counted (and rewritten to the same value) on every
    // re-run.
    const needsFix = stamp
      ? `(last_human_update_at IS NULL OR (last_human_update_at = $1::timestamp AND created_at < $1::timestamp))`
      : `last_human_update_at IS NULL`;
    const where = `${needsFix} AND last_human_update_at IS DISTINCT FROM ${target}`;
    const params = stamp ? [stamp.at] : [];

    const total = (await client.query(`SELECT count(*)::int AS n FROM event_requests WHERE ${where}`, params)).rows[0].n as number;
    const active = (await client.query(
      `SELECT count(*)::int AS n FROM event_requests
        WHERE ${where} AND deleted_at IS NULL AND status IN ('new', 'in_process', 'scheduled', 'rescheduled')`,
      params,
    )).rows[0].n as number;
    console.log(`\nWill fill:                           ${total}`);
    console.log(`  of which active (get alerts):      ${active}`);

    const sample = await client.query(
      `SELECT id, status, last_human_update_at::text AS now_value, (${target})::text AS new_value
         FROM event_requests
        WHERE ${where} AND deleted_at IS NULL AND status IN ('new', 'in_process', 'scheduled', 'rescheduled')
        ORDER BY ${target} ASC NULLS LAST
        LIMIT 10`,
      params,
    );
    if (sample.rowCount) {
      console.log('\nSample (active events, longest without a real update first):');
      for (const r of sample.rows) {
        const fmt = (d: string | null) => (d ? d.slice(0, 16) : 'empty');
        console.log(`  #${r.id}  ${String(r.status).padEnd(11)}  ${fmt(r.now_value)}  ->  ${fmt(r.new_value)}`);
      }
    }

    if (dryRun) {
      console.log(`\nNothing changed. Re-run with --apply to fill ${total} event(s).`);
      return;
    }
    const res = await client.query(`UPDATE event_requests SET last_human_update_at = ${target} WHERE ${where}`, params);
    console.log(`\nFilled ${res.rowCount} event(s).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
