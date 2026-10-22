-- Read-only. Explains why review_no_history candidates (from
-- classify-toolkit-conflicts.sql) have no audited toolkit change: created
-- before audit logging began, created already marked sent, or edited by a
-- path that skips the audit log.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

WITH candidates AS (
  SELECT id, created_at
  FROM event_requests
  WHERE deleted_at IS NULL
    AND toolkit_status IN ('sent', 'received_confirmed')
    AND toolkit_sent IS DISTINCT FROM true
),
toolkit_changes AS (
  SELECT DISTINCT c.id
  FROM candidates c
  JOIN audit_logs a
    ON a.table_name = 'event_requests' AND a.record_id = c.id::text
  WHERE a.old_data IS NOT NULL AND a.new_data IS NOT NULL
    AND pg_input_is_valid(a.old_data, 'jsonb')
    AND pg_input_is_valid(a.new_data, 'jsonb')
    AND ((a.old_data::jsonb) ->> 'toolkitSent' IS DISTINCT FROM (a.new_data::jsonb) ->> 'toolkitSent'
      OR (a.old_data::jsonb) ->> 'toolkitStatus' IS DISTINCT FROM (a.new_data::jsonb) ->> 'toolkitStatus')
),
no_history AS (
  SELECT c.* FROM candidates c
  WHERE NOT EXISTS (SELECT 1 FROM toolkit_changes t WHERE t.id = c.id)
),
audit_start AS (
  SELECT min(timestamp) AS started FROM audit_logs WHERE table_name = 'event_requests'
)
SELECT
  (SELECT started FROM audit_start) AS audit_log_starts,
  count(*) AS no_history_records,
  count(*) FILTER (WHERE n.created_at < (SELECT started FROM audit_start)) AS created_before_audit_log,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'event_requests' AND a.record_id = n.id::text
      AND a.old_data IS NULL
      AND pg_input_is_valid(a.new_data, 'jsonb')
      AND (a.new_data::jsonb) ->> 'toolkitStatus' IN ('sent', 'received_confirmed')
  )) AS created_already_sent,
  count(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'event_requests' AND a.record_id = n.id::text
  )) AS no_audit_rows_at_all,
  min(n.created_at) AS oldest_created,
  max(n.created_at) AS newest_created
FROM no_history n;

ROLLBACK;
