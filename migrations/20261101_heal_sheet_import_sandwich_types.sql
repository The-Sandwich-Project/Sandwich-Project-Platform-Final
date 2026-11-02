-- Heal event sandwich_types written by the old "send row to app" import.
--
-- Background
-- ----------
-- POST /api/event-requests/import-from-sheets (the planning sheet's "send row
-- to app") used to save sandwich types as
--     sandwichTypes: JSON.stringify([{ type: 'Pbj', quantity: 100 }, ...])
-- into a jsonb column. That stores a jsonb STRING containing JSON text, not an
-- array, and the type values were capitalized sheet labels ("Pbj", "Turkey")
-- instead of the app's keys ("pbj", "deli_turkey"). Effects:
--   * Array.isArray(event.sandwichTypes) is false, so e.g. the
--     "Missing sandwich info" gap check doesn't see the types.
--   * The event form's type picker doesn't recognize "Pbj" / "Turkey".
-- The import was fixed to store a real array with the app's keys. This
-- migration fixes rows saved before that.
--
-- What it does
-- ------------
-- Step 1: rows whose sandwich_types is a jsonb string holding a JSON ARRAY get
--         the parsed array. Strings that aren't valid JSON, or aren't an
--         array, are left exactly as they are.
-- Step 2: in any array, an element whose "type" is a known spelling of an app
--         key is rewritten to that key (case-insensitive):
--           pbj, pb&j, pb & j, peanut butter -> pbj
--           deli                             -> deli
--           turkey, deli_turkey              -> deli_turkey
--           ham, deli_ham                    -> deli_ham
--           chicken                          -> chicken
--           unknown                          -> unknown
--         Quantities and any other fields are untouched. Unrecognized types are
--         left alone rather than guessed at.
--
-- Safe to run more than once: both steps only match rows that still need fixing.
-- Runs automatically on boot via server/migrate.ts.
--
-- PREVIEW (read-only), if you want to look first:
--
-- SELECT id, organization_name, created_by, sandwich_types
-- FROM event_requests
-- WHERE jsonb_typeof(sandwich_types) = 'string'
--    OR EXISTS (
--         SELECT 1 FROM jsonb_array_elements(
--           CASE WHEN jsonb_typeof(sandwich_types) = 'array' THEN sandwich_types ELSE '[]'::jsonb END
--         ) x
--         WHERE x ->> 'type' IN ('Pbj','PBJ','Pb&j','PB&J','Deli','Turkey','Ham','Chicken','Unknown')
--       );

-- Step 1: unwrap stringified arrays. Per-row exception handling so one bad
-- value can't stop the rest (or the migration).
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

-- Step 2: normalize type spellings to the app's keys.
UPDATE event_requests e
SET sandwich_types = (
  SELECT jsonb_agg(
           CASE
             WHEN m.app_key IS NOT NULL AND (t.elem ->> 'type') IS DISTINCT FROM m.app_key
               THEN jsonb_set(t.elem, '{type}', to_jsonb(m.app_key))
             ELSE t.elem
           END
           ORDER BY t.ord
         )
  FROM jsonb_array_elements(e.sandwich_types) WITH ORDINALITY AS t(elem, ord)
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN jsonb_typeof(t.elem) <> 'object' THEN NULL
             ELSE CASE lower(trim(t.elem ->> 'type'))
               WHEN 'pbj' THEN 'pbj'
               WHEN 'pb&j' THEN 'pbj'
               WHEN 'pb & j' THEN 'pbj'
               WHEN 'peanut butter' THEN 'pbj'
               WHEN 'deli' THEN 'deli'
               WHEN 'turkey' THEN 'deli_turkey'
               WHEN 'deli_turkey' THEN 'deli_turkey'
               WHEN 'ham' THEN 'deli_ham'
               WHEN 'deli_ham' THEN 'deli_ham'
               WHEN 'chicken' THEN 'chicken'
               WHEN 'unknown' THEN 'unknown'
             END
           END AS app_key
  ) m
)
WHERE jsonb_typeof(e.sandwich_types) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(e.sandwich_types) x
    WHERE jsonb_typeof(x) = 'object'
      AND (x ->> 'type') IS NOT NULL
      AND lower(trim(x ->> 'type')) IN (
        'pbj', 'pb&j', 'pb & j', 'peanut butter', 'deli', 'turkey', 'deli_turkey',
        'ham', 'deli_ham', 'chicken', 'unknown'
      )
      AND (x ->> 'type') NOT IN (
        'pbj', 'deli', 'deli_turkey', 'deli_ham', 'chicken', 'unknown'
      )
  );
