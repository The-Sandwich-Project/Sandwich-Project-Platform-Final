-- People: board member role. Ticked by hand on the People admin page;
-- informational only. Additive and safe to re-run.
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_board_member BOOLEAN NOT NULL DEFAULT FALSE;
