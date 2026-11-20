-- Put back what a Replit publish removed from production on 2026-11-19.
--
-- Replit's publish screen makes the live database's structure match the dev
-- database. Dev hadn't picked up 20261122 / 20261123 yet, so the publish
-- dropped person_review_flags and people.is_team_member from production even
-- though _migrations says 20261122 ran. This file repeats that work under a
-- new name so it runs again. Everything is IF NOT EXISTS / drop-then-add, so
-- it changes nothing where these already exist (dev, fresh databases).
--
-- The rows themselves (the 13 review flags, the team-member ticks) come back
-- with scripts/repair-people-flags.ts, run by hand.

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

-- The same publish may have taken the 20261123 version of this rule with it.
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_name_source_check;

ALTER TABLE people ADD CONSTRAINT people_name_source_check
  CHECK (name_source IN ('self_verified', 'self_reported', 'admin_entered', 'sheet', 'legacy_import'));
