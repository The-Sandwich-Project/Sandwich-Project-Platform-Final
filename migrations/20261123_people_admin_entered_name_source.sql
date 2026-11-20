-- Allow name_source = 'admin_entered' (a name typed or corrected by an admin
-- on the People page). Ranked between self_reported and sheet; see
-- docs/data-model.md rule 3. Drop-then-add so re-running is safe; every
-- existing value is still allowed, so the add can't fail.
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_name_source_check;

ALTER TABLE people ADD CONSTRAINT people_name_source_check
  CHECK (name_source IN ('self_verified', 'self_reported', 'admin_entered', 'sheet', 'legacy_import'));
