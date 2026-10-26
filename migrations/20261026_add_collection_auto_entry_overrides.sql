-- Backing table for per-week overrides of recurring automatic collection
-- entries (Collective Learning's standing 250 PBJ each Wednesday). Served by
-- /api/collection-auto-entries and read by the nightly reconcile job in
-- server/services/cron-jobs.ts. Matches collectionAutoEntryOverrides in
-- shared/schema.ts. No row for a week means "record the default count".
-- Idempotent: safe to run against both the dev and production branches.

CREATE TABLE IF NOT EXISTS collection_auto_entry_overrides (
  id SERIAL PRIMARY KEY,
  schedule_key TEXT NOT NULL,
  week_date TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER,
  updated_by TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One override per recurring entry per week.
CREATE UNIQUE INDEX IF NOT EXISTS collection_auto_entry_overrides_schedule_week_unique
  ON collection_auto_entry_overrides (schedule_key, week_date);
