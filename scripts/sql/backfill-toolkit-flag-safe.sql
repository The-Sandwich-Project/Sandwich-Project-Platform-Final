-- WRITES DATA. Sets toolkit_sent = true for records that
-- classify-toolkit-conflicts.sql puts in safe_set_flag_true or
-- review_no_history: not soft deleted, status sent/received_confirmed, and
-- either the latest audited toolkit change was a status change or there is no
-- audited toolkit change at all (created already sent, or predates the audit
-- log). Deliberate checkbox unchecks and unclear history are excluded.
--
-- Touches toolkit_sent only. Dates, senders, contact logs, updated_at and
-- statuses are left as they are.
--
-- Deliberately has no COMMIT. Run it, check the returned rows, then:
--   * row count <= safe_set_flag_true + review_no_history from the preview
--     (129 on October 22, 2026) -> COMMIT
--     (fewer is fine: form saves since #528 deployed fix records on their own)
--   * anything else, or any doubt -> ROLLBACK
-- Save the returned IDs before committing; they are the record of this change.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

WITH candidates AS (
  SELECT id
  FROM event_requests
  WHERE deleted_at IS NULL
    AND toolkit_status IN ('sent', 'received_confirmed')
    AND toolkit_sent IS DISTINCT FROM true
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
safe AS (
  SELECT c.id
  FROM candidates c
  LEFT JOIN latest_toolkit_change l ON l.id = c.id
  WHERE l.id IS NULL
     OR ((l.old_flag IS DISTINCT FROM 'true' OR l.new_flag IS DISTINCT FROM 'false')
         AND l.new_status IN ('sent', 'received_confirmed')
         AND l.old_status IS DISTINCT FROM l.new_status)
)
UPDATE event_requests er
SET toolkit_sent = true
FROM safe
WHERE er.id = safe.id
  AND er.deleted_at IS NULL
  AND er.toolkit_status IN ('sent', 'received_confirmed')
  AND er.toolkit_sent IS DISTINCT FROM true
RETURNING er.id, er.toolkit_status, er.toolkit_sent;
