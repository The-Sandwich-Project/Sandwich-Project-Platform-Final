-- Controlled historical correction: exact unique full name/email only; no first-name guesses.
-- Production target: rough-sun-94036773 / br-patient-star-adio9hkz / neondb.
-- Retains original contact values in audit_logs. Excludes soft-deleted and conflicting assignments.
-- Manual execution only, not an automatic migration. Expected candidate count: 8.
BEGIN;
SET LOCAL statement_timeout = '30s';

SET LOCAL lock_timeout = '3s';

DO $guard$ BEGIN
IF EXISTS(SELECT 1 FROM audit_logs WHERE session_id='contact-reconcile-20261026-v1') THEN RAISE EXCEPTION 'This reconciliation is already recorded'; END IF;
END $guard$;

CREATE TEMP TABLE contact_reconcile_before ON COMMIT DROP AS WITH labels AS (
 SELECT DISTINCT tsp_contact AS raw FROM event_requests
 WHERE deleted_at IS NULL AND nullif(trim(tsp_contact),'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM users WHERE users.id=event_requests.tsp_contact)
), matches AS (
 SELECT l.raw,u.id,u.is_active,
 CASE WHEN lower(trim(l.raw))=lower(trim(u.email)) THEN 1 ELSE 2 END AS rank
 FROM labels l JOIN users u ON lower(trim(l.raw))=lower(trim(u.email))
 OR (nullif(trim(u.first_name),'') IS NOT NULL AND nullif(trim(u.last_name),'') IS NOT NULL
 AND lower(trim(l.raw))=lower(trim(concat_ws(' ',u.first_name,u.last_name))))
), best AS(SELECT raw,min(rank) AS rank FROM matches GROUP BY raw),
resolved AS (
 SELECT m.raw,min(m.id) AS user_id FROM matches m JOIN best b USING(raw,rank)
 GROUP BY m.raw HAVING count(*)=1 AND bool_and(m.is_active IS DISTINCT FROM false)
)
SELECT e.*,r.user_id AS resolved_user_id FROM event_requests e JOIN resolved r ON r.raw=e.tsp_contact
WHERE e.deleted_at IS NULL AND (nullif(trim(e.tsp_contact_assigned),'') IS NULL OR e.tsp_contact_assigned=r.user_id) FOR UPDATE OF e;

DO $guard$ BEGIN IF (SELECT count(*) FROM contact_reconcile_before) <> 8 THEN RAISE EXCEPTION 'Expected 8 unambiguous records; review changed candidates'; END IF; END $guard$;

WITH changed AS(
 UPDATE event_requests e SET tsp_contact=b.resolved_user_id,tsp_contact_assigned=b.resolved_user_id,updated_at=CURRENT_TIMESTAMP
 FROM contact_reconcile_before b WHERE e.id=b.id RETURNING e.id,e.tsp_contact,e.tsp_contact_assigned,e.updated_at
)
INSERT INTO audit_logs(action,table_name,record_id,old_data,new_data,user_agent,session_id)
SELECT 'UPDATE','event_requests',c.id::text,
jsonb_build_object('tspContact',b.tsp_contact,'tspContactAssigned',b.tsp_contact_assigned,'updatedAt',b.updated_at)::text,
jsonb_build_object('tspContact',c.tsp_contact,'tspContactAssigned',c.tsp_contact_assigned,'updatedAt',c.updated_at,
'_auditMetadata',jsonb_build_object('summary','Resolve unique full-name contact to user ID and compatibility mirror',
'operation','contact-reconcile-20261026-v1','originalContactText',b.tsp_contact))::text,
'Codex contact reconciliation','contact-reconcile-20261026-v1'
FROM changed c JOIN contact_reconcile_before b USING(id);

DO $verify$ BEGIN
IF (SELECT count(*) FROM audit_logs WHERE session_id='contact-reconcile-20261026-v1')<>8 THEN RAISE EXCEPTION 'Audit count mismatch'; END IF;
IF EXISTS(SELECT 1 FROM event_requests e JOIN contact_reconcile_before b USING(id)
 WHERE e.tsp_contact IS DISTINCT FROM b.resolved_user_id OR e.tsp_contact_assigned IS DISTINCT FROM b.resolved_user_id
 OR (to_jsonb(e)-'tsp_contact'-'tsp_contact_assigned'-'updated_at') IS DISTINCT FROM (to_jsonb(b)-'tsp_contact'-'tsp_contact_assigned'-'updated_at'-'resolved_user_id'))
THEN RAISE EXCEPTION 'Unexpected event changes'; END IF;
END $verify$;

SELECT count(*)::int AS corrected_and_audited FROM audit_logs WHERE session_id='contact-reconcile-20261026-v1';
COMMIT;

