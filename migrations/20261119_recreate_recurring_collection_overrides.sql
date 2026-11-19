-- Re-create the Collective Learning auto-log tables in databases that are
-- missing them.
--
-- 20261026_add_recurring_collection_overrides.sql is recorded as executed in
-- production (2026-11-02), but the recurring_collection_overrides table is
-- not there, so every nightly auto-log run fails on its first query and no
-- auto entry has ever been created. Because the old file is marked done, it
-- will never run again; this file repeats its statements under a new name.
-- Every statement is IF NOT EXISTS, so it's a no-op where the table exists.
CREATE TABLE IF NOT EXISTS recurring_collection_overrides (
  id SERIAL PRIMARY KEY,
  rule_key VARCHAR(100) NOT NULL,
  week_of TEXT NOT NULL,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  count INTEGER,
  note TEXT,
  created_by VARCHAR,
  created_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS recurring_collection_overrides_rule_week_unique
  ON recurring_collection_overrides (rule_key, week_of);

CREATE UNIQUE INDEX IF NOT EXISTS sandwich_collections_auto_recurring_rule_week_unique
  ON sandwich_collections (created_by, collection_date)
  WHERE submission_method = 'auto_recurring';
