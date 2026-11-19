-- Step 4 of the people/places rebuild (docs/data-model.md): people, their
-- name spellings, and the map from old person rows to new people.
-- Additive only: three new tables plus a nullable users.person_id column.
-- Nothing reads or writes them yet; the step 5 backfill script fills them.
-- Constraint names match what Drizzle generates, so db:push sees no diff.

CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  name_source TEXT NOT NULL DEFAULT 'legacy_import',
  email TEXT,
  phone TEXT,
  address TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  geocoded_at TIMESTAMP,
  is_volunteer BOOLEAN NOT NULL DEFAULT FALSE,
  is_driver BOOLEAN NOT NULL DEFAULT FALSE,
  is_van_driver BOOLEAN NOT NULL DEFAULT FALSE,
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  chapter_region_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT people_chapter_region_id_regions_id_fk
    FOREIGN KEY (chapter_region_id) REFERENCES regions(id) ON DELETE SET NULL,
  CONSTRAINT people_name_source_check
    CHECK (name_source IN ('self_verified', 'self_reported', 'sheet', 'legacy_import'))
);

CREATE INDEX IF NOT EXISTS people_email_lower_idx ON people (lower(email));

CREATE INDEX IF NOT EXISTS people_name_lower_idx ON people (lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS person_name_aliases (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  source TEXT NOT NULL,
  first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT person_name_aliases_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT person_name_aliases_source_check
    CHECK (source IN ('users', 'volunteers', 'drivers', 'host_contacts', 'contacts', 'volunteer_sheet', 'driver_sheet', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS person_name_aliases_person_alias_unique
  ON person_name_aliases (person_id, lower(alias));

CREATE INDEX IF NOT EXISTS person_name_aliases_alias_lower_idx ON person_name_aliases (lower(alias));

CREATE TABLE IF NOT EXISTS legacy_person_ids (
  id SERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_key TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT legacy_person_ids_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
  CONSTRAINT legacy_person_ids_source_table_check
    CHECK (source_table IN ('users', 'volunteers', 'drivers', 'host_contacts', 'contacts'))
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_person_ids_source_unique
  ON legacy_person_ids (source_table, source_key);

CREATE INDEX IF NOT EXISTS legacy_person_ids_person_idx ON legacy_person_ids (person_id);

-- Nullable link from a login to its person. If the column already exists the
-- whole clause (constraint included) is skipped, so this is safe to re-run.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS person_id INTEGER
  CONSTRAINT users_person_id_people_id_fk REFERENCES people(id) ON DELETE RESTRICT;
