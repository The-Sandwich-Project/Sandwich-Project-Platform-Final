-- Read-only. Run on the verified production connection, not dev.
-- Classifies remaining toolkit status/flag conflicts by their most recent
-- audited toolkit change, so the backfill does not undo deliberate
-- spreadsheet "No" edits (which on pre-#528 code changed only toolkitSent).
-- Returns record IDs only; no contact names or emails. Keep output private.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

SELECT current_database(), current_setting('transaction_read_only') AS read_only;

WITH candidates AS (
  SELECT id, toolkit_status, toolkit_sent, toolkit_sent_date, deleted_at
  FROM event_requests
  WHERE (toolkit_status IN ('sent', 'received_confirmed') AND toolkit_sent IS DISTINCT FROM true)
     OR (toolkit_sent = true AND (toolkit_status IS NULL OR toolkit_status NOT IN ('sent', 'received_confirmed')))
),
history AS (
  SELECT c.id, a.timestamp,
         (a.old_data::jsonb) ->> 'toolkitSent'   AS old_flag,
         (a.new_data::jsonb) ->> 'toolkitSent'   AS new_flag,
         (a.old_data::jsonb) ->> 'toolkitStatus' AS old_status,
         (a.new_data::jsonb) ->> 'toolkitStatus' AS new_status
  FROM candidates c
  JOIN audit_logs a
    ON a.table_name = 'event_requests' AND a.record_id = c.id::text
  WHERE a.old_data IS NOT NULL AND a.new_data IS NOT NULL
    AND pg_input_is_valid(a.old_data, 'jsonb')
    AND pg_input_is_valid(a.new_data, 'jsonb')
),
latest_toolkit_change AS (
  SELECT DISTINCT ON (id) *
  FROM history
  WHERE old_flag IS DISTINCT FROM new_flag OR old_status IS DISTINCT FROM new_status
  ORDER BY id, timestamp DESC
),
classified AS (
  SELECT c.id, c.toolkit_status, c.toolkit_sent,
         c.toolkit_sent_date IS NOT NULL AS has_sent_date,
         l.timestamp AS last_toolkit_change_at,
         l.old_flag, l.new_flag, l.old_status, l.new_status,
         CASE
           WHEN c.deleted_at IS NOT NULL THEN 'hold_soft_deleted'
           WHEN c.toolkit_status IS NULL
             OR c.toolkit_status NOT IN ('sent', 'received_confirmed') THEN 'review_opposite_conflict'
           WHEN l.id IS NULL THEN 'review_no_history'
           WHEN l.old_flag = 'true' AND l.new_flag = 'false' THEN 'hold_deliberate_uncheck'
           WHEN l.new_status IN ('sent', 'received_confirmed')
             AND l.old_status IS DISTINCT FROM l.new_status THEN 'safe_set_flag_true'
           ELSE 'review_unclear'
         END AS action
  FROM candidates c
  LEFT JOIN latest_toolkit_change l ON l.id = c.id
)
SELECT action, count(*) AS records, count(*) FILTER (WHERE has_sent_date) AS with_sent_date
FROM classified GROUP BY action ORDER BY action;

-- Re-running the CTE for the detail list keeps each statement standalone.
WITH candidates AS (
  SELECT id, toolkit_status, toolkit_sent, toolkit_sent_date, deleted_at
  FROM event_requests
  WHERE (toolkit_status IN ('sent', 'received_confirmed') AND toolkit_sent IS DISTINCT FROM true)
     OR (toolkit_sent = true AND (toolkit_status IS NULL OR toolkit_status NOT IN ('sent', 'received_confirmed')))
),
history AS (
  SELECT c.id, a.timestamp,
         (a.old_data::jsonb) ->> 'toolkitSent'   AS old_flag,
         (a.new_data::jsonb) ->> 'toolkitSent'   AS new_flag,
         (a.old_data::jsonb) ->> 'toolkitStatus' AS old_status,
         (a.new_data::jsonb) ->> 'toolkitStatus' AS new_status
  FROM candidates c
  JOIN audit_logs a
    ON a.table_name = 'event_requests' AND a.record_id = c.id::text
  WHERE a.old_data IS NOT NULL AND a.new_data IS NOT NULL
    AND pg_input_is_valid(a.old_data, 'jsonb')
    AND pg_input_is_valid(a.new_data, 'jsonb')
),
latest_toolkit_change AS (
  SELECT DISTINCT ON (id) *
  FROM history
  WHERE old_flag IS DISTINCT FROM new_flag OR old_status IS DISTINCT FROM new_status
  ORDER BY id, timestamp DESC
)
SELECT c.id, c.toolkit_status, c.toolkit_sent,
       c.toolkit_sent_date IS NOT NULL AS has_sent_date,
       l.timestamp AS last_toolkit_change_at,
       l.old_flag, l.new_flag, l.old_status, l.new_status,
       CASE
         WHEN c.deleted_at IS NOT NULL THEN 'hold_soft_deleted'
         WHEN c.toolkit_status IS NULL
           OR c.toolkit_status NOT IN ('sent', 'received_confirmed') THEN 'review_opposite_conflict'
         WHEN l.id IS NULL THEN 'review_no_history'
         WHEN l.old_flag = 'true' AND l.new_flag = 'false' THEN 'hold_deliberate_uncheck'
         WHEN l.new_status IN ('sent', 'received_confirmed')
           AND l.old_status IS DISTINCT FROM l.new_status THEN 'safe_set_flag_true'
         ELSE 'review_unclear'
       END AS action
FROM candidates c
LEFT JOIN latest_toolkit_change l ON l.id = c.id
ORDER BY action, c.id;

COMMIT;
