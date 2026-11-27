-- "TSP shopping" (is_tsp_shopped): strictly true or false.
--   true  = TSP is buying the food for this event
--   false = the group does its own shopping
-- The column was added on 2026-06-19 with DEFAULT false, so existing rows
-- should already be false. NOT NULL is only applied when no NULLs exist, so
-- this can never fail a deploy; if any are found, it logs a notice and
-- scripts/tsp-shopped-not-null.ts (--dry-run, then --apply) fixes them and
-- applies the rule. Backfills are scripts, not migrations (CLAUDE.md rule 8).
ALTER TABLE event_requests ALTER COLUMN is_tsp_shopped SET DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM event_requests WHERE is_tsp_shopped IS NULL) THEN
    RAISE NOTICE 'event_requests.is_tsp_shopped has NULLs; NOT NULL not applied. Run: npm run tsp-shopping:not-null -- --dry-run';
  ELSE
    ALTER TABLE event_requests ALTER COLUMN is_tsp_shopped SET NOT NULL;
  END IF;
END $$;
