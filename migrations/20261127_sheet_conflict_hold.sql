-- "Keep both, ask later" for sheet-vs-app questions (people/places rebuild,
-- step 7). A question can be put on hold with a note (who to ask, what to
-- check). It stays open: both values are kept on the row, the app keeps
-- using its own value, and it can still be decided either way later.
-- Additive only; safe to re-run.

ALTER TABLE sheet_field_conflicts ADD COLUMN IF NOT EXISTS on_hold_at TIMESTAMP;
ALTER TABLE sheet_field_conflicts ADD COLUMN IF NOT EXISTS on_hold_note TEXT;
ALTER TABLE sheet_field_conflicts ADD COLUMN IF NOT EXISTS on_hold_by_user_id VARCHAR;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sheet_field_conflicts_on_hold_by_user_id_users_id_fk'
       AND conrelid = 'sheet_field_conflicts'::regclass
  ) THEN
    ALTER TABLE sheet_field_conflicts
      ADD CONSTRAINT sheet_field_conflicts_on_hold_by_user_id_users_id_fk
      FOREIGN KEY (on_hold_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
