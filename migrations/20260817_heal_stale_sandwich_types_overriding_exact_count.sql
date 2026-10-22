-- Heal events whose planned sandwich count reverts to a stale TYPES breakdown.
--
-- Background
-- ----------
-- Companion to 20260709_heal_stale_sandwich_range_overriding_exact_count.sql.
-- That migration healed the range half of the "entered 500, shows 498" bug
-- (a leftover 490-506 whose midpoint won over the exact count). The same defect
-- existed in the sandwich_types half and is what kept the bug coming back:
--
--   * The Scheduled tab's inline sandwich editor opened in "Specify Types" mode
--     whenever ANY breakdown was stored, with no check that it agreed with the
--     exact count. Saving re-summed the leftover breakdown over the count the
--     user had typed (exact 500 + stale [250 turkey, 248 PBJ] -> saved as 498).
--   * The edit form's diff-based save dropped its own `sandwichTypes = NULL`
--     clear whenever the baseline resolved to the same mode being saved, so the
--     stale breakdown was never cleaned up and the cycle repeated.
--   * Card/list displays rendered the breakdown in place of the exact count.
--
-- The client fixes stop NEW saves from leaving a disagreeing breakdown behind
-- and stop existing ones from being summed back over the exact count, but the
-- rows themselves stay double-valued until someone reopens and re-saves them.
-- This migration heals them in place.
--
-- Two storage shapes (why an earlier draft of this query errored)
-- --------------------------------------------------------------
-- sandwich_types is JSONB, but the column holds TWO different shapes:
--
--   * a real JSON array  -> [{"type": "turkey", "quantity": 250}, ...]
--   * a JSON scalar STRING containing an array, i.e. double-encoded:
--     "[{\"type\": \"turkey\", \"quantity\": 250}]"
--
-- The second shape exists because the client JSON.stringify()s the breakdown
-- before sending it and the save routes wrote that string straight into the
-- jsonb column. The app never noticed (its parsers accept both), but SQL cannot
-- read the scalar form — jsonb_array_length()/jsonb_array_elements() fail with
-- "cannot get array length of a scalar". The server now normalizes on write, so
-- new saves only produce the array shape; this migration handles both so the
-- rows written before that fix are healed too.
--
-- Postgres also does not guarantee WHERE-clause evaluation order, so a
-- jsonb_typeof() guard sitting next to jsonb_array_elements() in the same WHERE
-- does NOT reliably protect it. The MATERIALIZED CTEs below are optimization
-- fences that force the filtering to happen before the array functions run.
--
-- What we heal (the bug signature)
-- --------------------------------
-- Rows that carry BOTH an exact estimated_sandwich_count AND a sandwich_types
-- breakdown whose quantities sum to a DIFFERENT number. When they differ, the
-- exact count is the value the user entered, so we clear the breakdown and let
-- the exact count win.
--
-- What we intentionally leave alone
-- ---------------------------------
--   * Pure breakdown events (exact count is NULL) — legitimately types-mode.
--   * Breakdowns that already sum to estimated_sandwich_count (e.g. 250 turkey
--     + 250 PBJ stored alongside count 500). Those agree, so the displayed
--     number wouldn't change and the type labels are worth keeping.
--   * Rows with no breakdown at all.
--
-- NOTE: clearing sandwich_types discards the per-type labels on those rows
-- (which type the leftover quantities were assigned to). That breakdown is
-- already contradicted by the exact count, so it is not trustworthy — but run
-- the PREVIEW first and export it if you want a record of what was dropped.
--
-- RUN THIS ON BOTH the dev and production Neon branches (verify you are on the
-- intended branch first — see CLAUDE.md "Database branch confusion"). Run the
-- PREVIEW query first and eyeball the rows before running the UPDATE.
--
-- Neon SQL Console note: the console auto-wraps whatever you select-and-run in a
-- single transaction, so there is no explicit BEGIN/COMMIT below (the console
-- rejects manual transaction control). Run the PREVIEW on its own first; when
-- the rows look right, select and run the UPDATE.

-- ── STEP 0 — DIAGNOSTIC: which storage shapes are present ────────────────────
-- Safe on any data (jsonb_typeof works on every jsonb value).
--
-- SELECT jsonb_typeof(sandwich_types) AS shape, count(*)
-- FROM event_requests
-- WHERE sandwich_types IS NOT NULL
-- GROUP BY 1
-- ORDER BY 2 DESC;
--
-- Measured on production 2026-08-17: string 336, array 37, object 2 — i.e. ~90%
-- of stored breakdowns were double-encoded by the pre-fix save path.
--
-- Inspect the handful of 'object' rows before deciding anything about them:
--
-- SELECT id, organization_name, estimated_sandwich_count, sandwich_types
-- FROM event_requests
-- WHERE jsonb_typeof(sandwich_types) = 'object';

-- ── STEP 1 — NORMALIZE SHAPE (string -> array) ───────────────────────────────
-- Independent of the stale-count heal: this only changes HOW the breakdown is
-- stored, never what it says. The server now writes arrays, but rows written
-- before that fix stay double-encoded, and SQL (exports, reporting, the heal
-- below) cannot read them. Run this first so the column holds one shape.
--
-- Only touches strings that actually look like a JSON array, so a plain text
-- value (e.g. "Deli & PBJ") is left alone rather than failing the cast.
--
-- PREVIEW:
--
-- SELECT id, organization_name, sandwich_types AS stored_now,
--        (sandwich_types #>> '{}')::jsonb AS would_become
-- FROM (
--   SELECT id, organization_name, sandwich_types
--   FROM event_requests
--   WHERE jsonb_typeof(sandwich_types) = 'string'
--     AND left(btrim(sandwich_types #>> '{}'), 1) = '['
--     AND right(btrim(sandwich_types #>> '{}'), 1) = ']'
-- ) s
-- ORDER BY id;
--
-- APPLY:
WITH decodable AS MATERIALIZED (
  SELECT id
  FROM event_requests
  WHERE jsonb_typeof(sandwich_types) = 'string'
    AND left(btrim(sandwich_types #>> '{}'), 1) = '['
    AND right(btrim(sandwich_types #>> '{}'), 1) = ']'
)
UPDATE event_requests e
SET sandwich_types = (e.sandwich_types #>> '{}')::jsonb
FROM decodable d
WHERE e.id = d.id;

-- If the statement above fails on a malformed value, isolate the offenders with
-- this (Postgres 16+ only) and exclude them:
--
-- SELECT id, sandwich_types
-- FROM event_requests
-- WHERE jsonb_typeof(sandwich_types) = 'string'
--   AND NOT pg_input_is_valid(sandwich_types #>> '{}', 'jsonb');

-- ── STEP 2 — the stale-count heal ────────────────────────────────────────────
-- The queries below still handle the string shape, so they work whether or not
-- Step 1 has been run.

-- ── PREVIEW (safe, read-only) ────────────────────────────────────────────────
-- Shows exactly which rows the UPDATE below will touch and how the displayed
-- number will change (types_total_now -> exact count).
--
-- WITH candidates AS MATERIALIZED (
--   SELECT
--     id,
--     organization_name,
--     status,
--     estimated_sandwich_count,
--     sandwich_types,
--     CASE
--       WHEN jsonb_typeof(sandwich_types) = 'array' THEN sandwich_types
--       WHEN jsonb_typeof(sandwich_types) = 'string'
--            AND left(btrim(sandwich_types #>> '{}'), 1) = '['
--         THEN (sandwich_types #>> '{}')::jsonb
--     END AS types_array
--   FROM event_requests
--   WHERE estimated_sandwich_count IS NOT NULL
--     AND estimated_sandwich_count > 0
--     AND sandwich_types IS NOT NULL
-- ),
-- arrays AS MATERIALIZED (
--   SELECT *
--   FROM candidates
--   WHERE types_array IS NOT NULL
--     AND jsonb_typeof(types_array) = 'array'
-- ),
-- summed AS MATERIALIZED (
--   SELECT
--     a.*,
--     (
--       SELECT COALESCE(SUM(
--         CASE
--           WHEN elem->>'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
--           THEN (elem->>'quantity')::numeric
--           ELSE 0
--         END
--       ), 0)
--       FROM jsonb_array_elements(a.types_array) AS elem
--     )::int AS types_total_now
--   FROM arrays a
--   WHERE jsonb_array_length(a.types_array) > 0
-- )
-- SELECT
--   id,
--   organization_name,
--   status,
--   estimated_sandwich_count AS exact_count,
--   types_total_now,
--   jsonb_typeof(sandwich_types) AS stored_shape,
--   sandwich_types
-- FROM summed
-- WHERE estimated_sandwich_count <> types_total_now
-- ORDER BY id;

-- ── HEAL ─────────────────────────────────────────────────────────────────────
WITH candidates AS MATERIALIZED (
  SELECT
    id,
    estimated_sandwich_count,
    CASE
      WHEN jsonb_typeof(sandwich_types) = 'array' THEN sandwich_types
      WHEN jsonb_typeof(sandwich_types) = 'string'
           AND left(btrim(sandwich_types #>> '{}'), 1) = '['
        THEN (sandwich_types #>> '{}')::jsonb
    END AS types_array
  FROM event_requests
  WHERE estimated_sandwich_count IS NOT NULL
    AND estimated_sandwich_count > 0
    AND sandwich_types IS NOT NULL
),
arrays AS MATERIALIZED (
  SELECT *
  FROM candidates
  WHERE types_array IS NOT NULL
    AND jsonb_typeof(types_array) = 'array'
),
stale AS MATERIALIZED (
  SELECT a.id
  FROM arrays a
  WHERE jsonb_array_length(a.types_array) > 0
    AND a.estimated_sandwich_count <> (
      SELECT COALESCE(SUM(
        CASE
          WHEN elem->>'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (elem->>'quantity')::numeric
          ELSE 0
        END
      ), 0)
      FROM jsonb_array_elements(a.types_array) AS elem
    )::int
)
UPDATE event_requests e
SET sandwich_types = NULL
FROM stale s
WHERE e.id = s.id;

-- ── OPTIONAL: the same heal for the ACTUAL (post-event) count ────────────────
-- actual_sandwich_types / actual_sandwich_count have the identical defect. Per
-- CLAUDE.md, actual_sandwich_count is a manual for-reference field and official
-- totals live in sandwich_collections, so this is lower stakes — but a stale
-- actual breakdown will misreport the same way on completed-event cards.
-- Preview it by adapting the PREVIEW query above before running.
--
-- WITH candidates AS MATERIALIZED (
--   SELECT
--     id,
--     actual_sandwich_count,
--     CASE
--       WHEN jsonb_typeof(actual_sandwich_types) = 'array' THEN actual_sandwich_types
--       WHEN jsonb_typeof(actual_sandwich_types) = 'string'
--            AND left(btrim(actual_sandwich_types #>> '{}'), 1) = '['
--         THEN (actual_sandwich_types #>> '{}')::jsonb
--     END AS types_array
--   FROM event_requests
--   WHERE actual_sandwich_count IS NOT NULL
--     AND actual_sandwich_count > 0
--     AND actual_sandwich_types IS NOT NULL
-- ),
-- arrays AS MATERIALIZED (
--   SELECT * FROM candidates
--   WHERE types_array IS NOT NULL AND jsonb_typeof(types_array) = 'array'
-- ),
-- stale AS MATERIALIZED (
--   SELECT a.id
--   FROM arrays a
--   WHERE jsonb_array_length(a.types_array) > 0
--     AND a.actual_sandwich_count <> (
--       SELECT COALESCE(SUM(
--         CASE
--           WHEN elem->>'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
--           THEN (elem->>'quantity')::numeric
--           ELSE 0
--         END
--       ), 0)
--       FROM jsonb_array_elements(a.types_array) AS elem
--     )::int
-- )
-- UPDATE event_requests e
-- SET actual_sandwich_types = NULL
-- FROM stale s
-- WHERE e.id = s.id;
