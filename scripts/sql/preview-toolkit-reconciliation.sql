-- Read-only preview. Run on the verified production connection, not dev.
-- No dates, attribution, contact logs, or event lifecycle statuses are changed.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

SELECT current_database(), current_setting('transaction_read_only') AS read_only;

SELECT id, toolkit_status, toolkit_sent AS current_flag,
       CASE WHEN toolkit_status IN ('sent', 'received_confirmed')
            THEN true ELSE toolkit_sent END AS proposed_flag,
       toolkit_sent_date,
       CASE
         WHEN deleted_at IS NOT NULL THEN 'hold_soft_deleted'
         WHEN toolkit_status IN ('sent', 'received_confirmed') THEN 'propose_flag_true'
         ELSE 'review_conflicting_history'
       END AS action
FROM event_requests
WHERE (toolkit_status IN ('sent', 'received_confirmed') AND toolkit_sent IS DISTINCT FROM true)
   OR (toolkit_sent = true AND (toolkit_status IS NULL OR toolkit_status NOT IN ('sent', 'received_confirmed')))
ORDER BY action, id;

COMMIT;
