/**
 * Fill the `regions` table with the agreed list (docs/data-model.md,
 * "Collection sites and regions"). Step 3 of the people/places rebuild.
 *
 *   npx tsx scripts/seed-regions.ts --dry-run   # show what would change
 *   npx tsx scripts/seed-regions.ts --apply     # make the changes
 *
 * Connection: --url, or TARGET_DATABASE_URL, or AUDIT_DATABASE_URL (the
 * secret set up for the data audit). DATABASE_URL is deliberately NOT used:
 * in the Replit workspace that's the dev database.
 *
 * Safe to run more than once:
 *   - adds regions that are missing (matched by name, ignoring case)
 *   - fills in a missing roll-up for a historic name
 *   - never overwrites or deletes anything already there; differences are
 *     reported so a person can decide
 * Everything happens in one transaction: --dry-run rolls it back, --apply
 * commits it. It also reports any name in the collections log that still has
 * no region row, so nothing is silently left out.
 */
import pg from 'pg';

type Kind = 'region' | 'site' | 'chapter';
interface SeedRegion {
  name: string;
  kind: Kind;
  status: 'active' | 'historic';
  rollsUpInto?: string;
  notes?: string;
}

// Names are exactly as they appear in sandwich_collections.host_name.
export const SEED: SeedRegion[] = [
  // Active
  { name: 'Alpharetta', kind: 'region', status: 'active' },
  { name: 'Dunwoody/PTC', kind: 'region', status: 'active', notes: 'PTC = Peachtree Corners' },
  { name: 'East Cobb/Roswell', kind: 'region', status: 'active' },
  { name: 'Sandy Springs/Chastain', kind: 'region', status: 'active' },
  { name: 'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead', kind: 'region', status: 'active' },
  { name: 'Flowery Branch', kind: 'region', status: 'active' },
  { name: 'Collective Learning', kind: 'site', status: 'active', notes: 'Standing weekly PBJ count, auto-logged' },
  { name: 'UGA', kind: 'chapter', status: 'active', notes: 'TSP chapter in Athens; also a collection site' },
  { name: 'Unassigned', kind: 'region', status: 'active', notes: 'Placeholder for hosts not yet given a region' },

  // Historic, rolled up into a current region
  { name: 'Sandy Springs', kind: 'region', status: 'historic', rollsUpInto: 'Sandy Springs/Chastain' },
  { name: 'Buckhead', kind: 'region', status: 'historic', rollsUpInto: 'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead' },
  { name: 'Oak Grove', kind: 'region', status: 'historic', rollsUpInto: 'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead' },
  { name: 'Decatur', kind: 'region', status: 'historic', rollsUpInto: 'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead' },
  { name: 'Glenwood Park', kind: 'region', status: 'historic', rollsUpInto: 'Intown/Druid Hills/Oak Grove/Chamblee/Brookhaven/Buckhead' },
  { name: 'Peachtree Corners', kind: 'region', status: 'historic', rollsUpInto: 'Dunwoody/PTC' },

  // Historic, retired (no current home)
  { name: 'Dacula', kind: 'region', status: 'historic', notes: 'Closed' },
  { name: 'Snellville', kind: 'region', status: 'historic' },
  { name: 'Woodstock', kind: 'region', status: 'historic', notes: 'Never opened' },
  { name: 'Intown/Druid Hills', kind: 'region', status: 'historic' },
  { name: 'Lenox/Brookhaven', kind: 'region', status: 'historic' },
  { name: 'New Chastain', kind: 'region', status: 'historic' },
  { name: 'Chamblee/N Brookhaven', kind: 'region', status: 'historic' },
  { name: 'Lilburn', kind: 'region', status: 'historic' },
  { name: 'Roswell', kind: 'region', status: 'historic' },
  { name: 'College Park', kind: 'region', status: 'historic' },
  { name: 'Suwanee/JC/Duluth', kind: 'region', status: 'historic' },
  { name: 'OG Sandwich Project', kind: 'region', status: 'historic', notes: 'Collections recorded before locations were tracked (2020–21)' },
];

// Collection-log names that are deliberately NOT regions.
export const NOT_REGIONS = ['Groups'];

const key = (s: string) => s.trim().toLowerCase();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run (preview) or --apply (make the changes).');
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
  console.log(`${dryRun ? 'DRY RUN (nothing will be saved)' : 'APPLYING CHANGES'} on database host: ${host}\n`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows;

  const added: string[] = [];
  const linked: string[] = [];
  const differs: string[] = [];
  try {
    await client.query('BEGIN');
    const [{ exists }] = await q(`SELECT to_regclass('public.regions') IS NOT NULL AS exists`);
    if (!exists) {
      throw new Error(
        'The regions table does not exist yet. Deploy the app (its migration creates the table), then run this again.'
      );
    }

    const load = async () => {
      const rows = await q(`SELECT id, name, kind, status, rolls_up_into_region_id FROM regions`);
      return new Map(rows.map((r: any) => [key(r.name), r]));
    };

    // Pass 1: add missing regions; report ones that differ.
    let existing = await load();
    for (const r of SEED) {
      const cur = existing.get(key(r.name));
      if (!cur) {
        await q(
          `INSERT INTO regions (name, kind, status, notes) VALUES ($1, $2, $3, $4)
           ON CONFLICT ((lower(name))) DO NOTHING`,
          [r.name, r.kind, r.status, r.notes ?? null]
        );
        added.push(`${r.name} (${r.kind}, ${r.status})`);
      } else if (cur.kind !== r.kind || cur.status !== r.status) {
        differs.push(
          `${r.name}: database has ${cur.kind}/${cur.status}, agreed list says ${r.kind}/${r.status} (left as is)`
        );
      }
    }

    // Pass 2: roll-ups (needs every target to exist first).
    existing = await load();
    for (const r of SEED.filter((s) => s.rollsUpInto)) {
      const cur = existing.get(key(r.name));
      const target = existing.get(key(r.rollsUpInto!));
      if (!cur || !target) continue;
      if (cur.rolls_up_into_region_id == null) {
        if (cur.status !== 'historic') {
          differs.push(`${r.name}: can't roll up into ${r.rollsUpInto} while it's ${cur.status} (left as is)`);
          continue;
        }
        await q(`UPDATE regions SET rolls_up_into_region_id = $1, updated_at = NOW() WHERE id = $2`, [
          target.id,
          cur.id,
        ]);
        linked.push(`${r.name} → ${r.rollsUpInto}`);
      } else if (cur.rolls_up_into_region_id !== target.id) {
        differs.push(`${r.name}: already rolls up into region #${cur.rolls_up_into_region_id}, not ${r.rollsUpInto} (left as is)`);
      }
    }

    // Coverage: every name in the collections log should now have a row.
    existing = await load();
    const logNames = await q(
      `SELECT host_name, COUNT(*)::int AS n FROM sandwich_collections
        WHERE deleted_at IS NULL AND host_name IS NOT NULL AND TRIM(host_name) <> ''
        GROUP BY host_name ORDER BY COUNT(*) DESC`
    );
    const skip = new Set(NOT_REGIONS.map(key));
    const uncovered = logNames.filter((r: any) => !existing.has(key(r.host_name)) && !skip.has(key(r.host_name)));

    console.log(`Added (${added.length}):`);
    added.forEach((x) => console.log(`  + ${x}`));
    console.log(`\nRoll-ups set (${linked.length}):`);
    linked.forEach((x) => console.log(`  → ${x}`));
    console.log(`\nDifferences left for a person to decide (${differs.length}):`);
    differs.forEach((x) => console.log(`  ! ${x}`));
    console.log(`\nNames in the collections log with no region row (${uncovered.length}):`);
    uncovered.forEach((r: any) => console.log(`  ? "${r.host_name}" (${r.n} collections)`));
    console.log(`\n"${NOT_REGIONS.join('", "')}" is deliberately not a region.`);

    if (apply) {
      await client.query('COMMIT');
      console.log('\nSaved.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run: nothing was saved. Run again with --apply to make these changes.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nStopped, nothing saved: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /seed-regions\.ts$/.test(process.argv[1])) {
  main();
}
