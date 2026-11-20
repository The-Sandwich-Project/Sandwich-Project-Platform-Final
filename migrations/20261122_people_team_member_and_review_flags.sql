-- People/places rebuild, step 5 support:
--   * people.is_team_member: everyone with an app login, minus the odd guest.
--     Informational only.
--   * person_review_flags: decisions the backfill couldn't make on its own,
--     shown as the "needs a decision" list on the People admin page.
-- Additive only. Constraint names match what Drizzle generates.

ALTER TABLE people ADD COLUMN IF NOT EXISTS is_team_member BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS person_review_flags (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by_user_id VARCHAR,
  resolution TEXT,
  CONSTRAINT person_review_flags_person_id_people_id_fk
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT person_review_flags_resolved_by_user_id_users_id_fk
    FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT person_review_flags_kind_check
    CHECK (kind IN ('contact_conflict', 'shared_contact', 'multiple_people', 'abbreviated_name', 'possible_duplicate'))
);

CREATE INDEX IF NOT EXISTS person_review_flags_open_idx ON person_review_flags (person_id, resolved_at);
