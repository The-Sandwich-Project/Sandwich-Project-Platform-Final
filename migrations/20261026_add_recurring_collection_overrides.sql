-- Auto-logged recurring collections (Collective Learning's standing weekly
-- PBJ count). Per-week overrides record "didn't collect" or a different count.
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

-- At most one auto-logged row per rule per collection date, so two servers
-- (or a re-run) can never double-record the same week. Keyed on created_by
-- (the rule's stable system id), not host_name, so renaming the configured
-- host can't create a second row for a week.
CREATE UNIQUE INDEX IF NOT EXISTS sandwich_collections_auto_recurring_rule_week_unique
  ON sandwich_collections (created_by, collection_date)
  WHERE submission_method = 'auto_recurring';
