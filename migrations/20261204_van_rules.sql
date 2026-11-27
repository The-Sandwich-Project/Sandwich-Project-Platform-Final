-- TSP van rules (batch 6b). See shared/van-rules.ts.
--   van_reason         why the van is needed when the estimate is under 800
--   van_team_ok        "Events team OK'd sharing the van" with another event
--                      that day; until then the van shows as pending
--   van_time_override  AM / Mid-day / PM / All day picked on the planning
--                      sheet (column I); NULL = worked out from the event's
--                      times. Cleared when the times change.
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS van_reason text;
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS van_team_ok boolean NOT NULL DEFAULT false;
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS van_time_override varchar;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_requests_van_time_override_check') THEN
    ALTER TABLE event_requests ADD CONSTRAINT event_requests_van_time_override_check
      CHECK (van_time_override IS NULL OR van_time_override IN ('AM', 'Mid-day', 'PM', 'All day'));
  END IF;
END $$;
