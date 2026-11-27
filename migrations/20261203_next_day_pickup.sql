-- Next-day pickup, replacing the "This group will hold sandwiches overnight"
-- checkbox with three choices:
--   'no'       same-day pickup
--   'option'   the group CAN hold the sandwiches overnight if needed
--   'planned'  next-day pickup is planned (holding location + pickup time apply)
-- NULL on older events: the app reads them as 'planned' when an overnight
-- holding location was entered, otherwise 'no' (shared/next-day-pickup.ts),
-- so no backfill is needed.
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS next_day_pickup varchar;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_requests_next_day_pickup_check') THEN
    ALTER TABLE event_requests ADD CONSTRAINT event_requests_next_day_pickup_check
      CHECK (next_day_pickup IS NULL OR next_day_pickup IN ('no', 'option', 'planned'));
  END IF;
END $$;
