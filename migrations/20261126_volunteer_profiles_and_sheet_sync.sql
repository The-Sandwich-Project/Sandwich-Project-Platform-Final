-- People/places rebuild, step 7: volunteer details and the volunteer sheet
-- sync (docs/data-model.md). Additive only: four new tables and two more
-- review-flag kinds. Safe to re-run. Constraint names match what Drizzle
-- generates.

-- Two new "needs a decision" kinds for sheet syncs.
ALTER TABLE person_review_flags DROP CONSTRAINT IF EXISTS person_review_flags_kind_check;

ALTER TABLE person_review_flags ADD CONSTRAINT person_review_flags_kind_check
  CHECK (kind IN ('contact_conflict', 'shared_contact', 'multiple_people', 'abbreviated_name',
                  'possible_duplicate', 'not_on_sheet', 'new_from_sheet'));

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL,
  availability_status TEXT NOT NULL DEFAULT 'active',
  on_recruitment_list BOOLEAN NOT NULL DEFAULT TRUE,
  location TEXT,
  sheet_notes TEXT,
  experience_level TEXT NOT NULL DEFAULT 'new',
  training_completed BOOLEAN NOT NULL DEFAULT FALSE,
  on_sheet BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_on_sheet_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT volunteer_profiles_person_id_unique UNIQUE (person_id),
  CONSTRAINT volunteer_profiles_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT volunteer_profiles_availability_status_check
    CHECK (availability_status IN ('active', 'temporarily_unavailable', 'inactive')),
  CONSTRAINT volunteer_profiles_experience_level_check
    CHECK (experience_level IN ('new', 'experienced'))
);

CREATE TABLE IF NOT EXISTS sheet_sync_runs (
  id SERIAL PRIMARY KEY,
  sheet TEXT NOT NULL,
  trigger TEXT NOT NULL,
  triggered_by_user_id VARCHAR,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  summary JSONB,
  error TEXT,
  CONSTRAINT sheet_sync_runs_triggered_by_user_id_users_id_fk
    FOREIGN KEY (triggered_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT sheet_sync_runs_sheet_check CHECK (sheet IN ('volunteer')),
  CONSTRAINT sheet_sync_runs_trigger_check CHECK (trigger IN ('scheduled', 'manual', 'script')),
  CONSTRAINT sheet_sync_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE TABLE IF NOT EXISTS sheet_sync_values (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL,
  sheet TEXT NOT NULL,
  field TEXT NOT NULL,
  last_synced_value TEXT,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT sheet_sync_values_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT sheet_sync_values_person_sheet_field_unique UNIQUE (person_id, sheet, field),
  CONSTRAINT sheet_sync_values_sheet_check CHECK (sheet IN ('volunteer')),
  CONSTRAINT sheet_sync_values_field_check CHECK (field IN ('name', 'email', 'phone'))
);

CREATE TABLE IF NOT EXISTS sheet_field_conflicts (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL,
  sheet TEXT NOT NULL,
  field TEXT NOT NULL,
  kind TEXT NOT NULL,
  sheet_value TEXT,
  app_value TEXT,
  sync_run_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by_user_id VARCHAR,
  resolution TEXT,
  CONSTRAINT sheet_field_conflicts_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT sheet_field_conflicts_sync_run_id_sheet_sync_runs_id_fk
    FOREIGN KEY (sync_run_id) REFERENCES sheet_sync_runs(id) ON DELETE SET NULL,
  CONSTRAINT sheet_field_conflicts_resolved_by_user_id_users_id_fk
    FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT sheet_field_conflicts_sheet_check CHECK (sheet IN ('volunteer')),
  CONSTRAINT sheet_field_conflicts_field_check CHECK (field IN ('name', 'email', 'phone')),
  CONSTRAINT sheet_field_conflicts_kind_check
    CHECK (kind IN ('conflict', 'invalid_sheet_value', 'possible_typo')),
  CONSTRAINT sheet_field_conflicts_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('used_sheet', 'kept_app', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS sheet_field_conflicts_open_idx ON sheet_field_conflicts (person_id, resolved_at);
