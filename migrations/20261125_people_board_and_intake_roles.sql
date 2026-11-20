-- People: board member, advisory board member and event intake team roles.
-- Ticked by hand on the People admin page; informational only (app access
-- still comes from the login's permissions). Additive and safe to re-run.
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_board_member BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_advisory_board_member BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_intake_team BOOLEAN NOT NULL DEFAULT FALSE;
