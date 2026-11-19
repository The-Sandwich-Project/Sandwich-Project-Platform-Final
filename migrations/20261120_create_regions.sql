-- Step 3 of the people/places rebuild (docs/data-model.md): the regions table.
-- Additive only: nothing reads or writes it yet, and no existing table changes.
-- Rows are added by scripts/seed-regions.ts (a script run on purpose, per
-- CLAUDE.md schema rule 8), not here.
CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'region',
  status TEXT NOT NULL DEFAULT 'active',
  rolls_up_into_region_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Same constraint name Drizzle generates, so db:push sees no difference.
  CONSTRAINT regions_rolls_up_into_region_id_regions_id_fk
    FOREIGN KEY (rolls_up_into_region_id) REFERENCES regions(id) ON DELETE RESTRICT,
  CONSTRAINT regions_kind_check CHECK (kind IN ('region', 'site', 'chapter')),
  CONSTRAINT regions_status_check CHECK (status IN ('active', 'historic')),
  CONSTRAINT regions_rollup_check CHECK (
    rolls_up_into_region_id IS NULL
    OR (status = 'historic' AND rolls_up_into_region_id <> id)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS regions_name_lower_unique ON regions (lower(name));
