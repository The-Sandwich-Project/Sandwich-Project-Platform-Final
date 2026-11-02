-- Bring existing events' sandwich estimates in line with the shared estimate
-- rule (shared/sandwich-estimate.ts), which the server now applies on every
-- save. This fixes only states that are clearly broken today; anything it
-- doesn't touch is reconciled the next time the event is saved.
--
-- 1. sandwich_types stored as a JSON *string* (the full form and the
--    scheduled-card editor sent JSON.stringify(...)) becomes a real array.
-- 2. A range saved without a count gets count = the range midpoint, so every
--    screen and report that only reads the count shows a number instead of
--    nothing ("Missing sandwich count"). A live range is still a range: the
--    app treats count === midpoint as an active range. Reversed bounds
--    (min > max) are swapped.
-- 3. A one-sided range (only a min or only a max) becomes that one number.
--    Before, cards showed "Not specified" while reports counted it.
--    (Before 3 and 4 clear the range type, a type stored only there is
--    copied into the breakdown: step 2b.)
-- 4. Stale range bounds next to a different exact count are cleared. The app
--    already ignores them; they only confused later edits.
-- 5. A single-type breakdown whose quantity no longer matches the count
--    takes the count (e.g. "198 Deli" next to an estimate of 250).
--
-- Every statement only matches rows that still need it, so this is safe to
-- run more than once. Runs automatically on boot via server/migrate.ts.

-- 1. Unwrap JSON-string breakdowns (per-row, so one bad value can't stop the rest).
DO $$
DECLARE
  r record;
  parsed jsonb;
BEGIN
  FOR r IN
    SELECT id, sandwich_types #>> '{}' AS txt
    FROM event_requests
    WHERE jsonb_typeof(sandwich_types) = 'string'
  LOOP
    BEGIN
      parsed := r.txt::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF jsonb_typeof(parsed) = 'array' THEN
      UPDATE event_requests SET sandwich_types = parsed WHERE id = r.id;
    END IF;
  END LOOP;
END
$$;

-- 2. Ranges with no count: count = midpoint (bounds put in order).
UPDATE event_requests
SET estimated_sandwich_count = round((estimated_sandwich_count_min + estimated_sandwich_count_max) / 2.0),
    estimated_sandwich_count_min = LEAST(estimated_sandwich_count_min, estimated_sandwich_count_max),
    estimated_sandwich_count_max = GREATEST(estimated_sandwich_count_min, estimated_sandwich_count_max)
WHERE estimated_sandwich_count IS NULL
  AND estimated_sandwich_count_min > 0
  AND estimated_sandwich_count_max > 0;

-- 2b. Steps 3 and 4 clear the range type. On older events that's the ONLY
--     place the type is stored (no breakdown), so first copy it into the
--     breakdown, with the count those steps will leave. An existing
--     breakdown, in any shape, is never overwritten.
UPDATE event_requests
SET sandwich_types = jsonb_build_array(jsonb_build_object(
      'type', estimated_sandwich_range_type,
      'quantity', CASE
        WHEN (COALESCE(estimated_sandwich_count_min, 0) > 0) <> (COALESCE(estimated_sandwich_count_max, 0) > 0)
          THEN COALESCE(
            NULLIF(estimated_sandwich_count, 0),
            NULLIF(GREATEST(COALESCE(estimated_sandwich_count_min, 0), COALESCE(estimated_sandwich_count_max, 0)), 0),
            0)
        ELSE COALESCE(estimated_sandwich_count, 0)
      END))
WHERE NULLIF(trim(estimated_sandwich_range_type), '') IS NOT NULL
  -- Only a genuinely empty breakdown. Older object shapes ({"pbj": 200},
  -- numeric-keyed lines) and any non-empty value are real data the app still
  -- reads, so they're never replaced.
  AND (sandwich_types IS NULL
       OR jsonb_typeof(sandwich_types) = 'null'
       OR (jsonb_typeof(sandwich_types) = 'array' AND jsonb_array_length(sandwich_types) = 0)
       OR (jsonb_typeof(sandwich_types) = 'object' AND sandwich_types = '{}'::jsonb)
       OR (jsonb_typeof(sandwich_types) = 'string' AND trim(sandwich_types #>> '{}') IN ('', '[]', '{}', 'null')))
  AND (
    -- rows step 3 will touch
    (COALESCE(estimated_sandwich_count_min, 0) > 0) <> (COALESCE(estimated_sandwich_count_max, 0) > 0)
    -- rows step 4 will touch
    OR (estimated_sandwich_count > 0
        AND estimated_sandwich_count_min > 0
        AND estimated_sandwich_count_max > 0
        AND estimated_sandwich_count <> round((estimated_sandwich_count_min + estimated_sandwich_count_max) / 2.0))
  );

-- 3. One-sided ranges: keep the count if there is one, else use the one bound.
UPDATE event_requests
SET estimated_sandwich_count = COALESCE(
      NULLIF(estimated_sandwich_count, 0),
      NULLIF(GREATEST(COALESCE(estimated_sandwich_count_min, 0), COALESCE(estimated_sandwich_count_max, 0)), 0)
    ),
    estimated_sandwich_count_min = NULL,
    estimated_sandwich_count_max = NULL,
    estimated_sandwich_range_type = NULL
WHERE (COALESCE(estimated_sandwich_count_min, 0) > 0) <> (COALESCE(estimated_sandwich_count_max, 0) > 0);

-- 4. Stale bounds next to a different exact count.
UPDATE event_requests
SET estimated_sandwich_count_min = NULL,
    estimated_sandwich_count_max = NULL,
    estimated_sandwich_range_type = NULL
WHERE estimated_sandwich_count > 0
  AND estimated_sandwich_count_min > 0
  AND estimated_sandwich_count_max > 0
  AND estimated_sandwich_count <> round((estimated_sandwich_count_min + estimated_sandwich_count_max) / 2.0);

-- 5. A single-type exact breakdown that no longer matches the count.
UPDATE event_requests
SET sandwich_types = jsonb_set(sandwich_types, '{0,quantity}', to_jsonb(estimated_sandwich_count))
WHERE jsonb_typeof(sandwich_types) = 'array'
  AND jsonb_array_length(sandwich_types) = 1
  AND jsonb_typeof(sandwich_types -> 0 -> 'quantity') = 'number'
  AND NOT (sandwich_types -> 0 ? 'min')
  AND estimated_sandwich_count > 0
  AND (sandwich_types -> 0 ->> 'quantity')::numeric > 0
  AND (sandwich_types -> 0 ->> 'quantity')::numeric <> estimated_sandwich_count;
