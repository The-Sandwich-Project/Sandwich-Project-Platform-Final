-- Event alerts: daily digest rebuild of the check-in reminders.
-- See server/services/check-in-reminder-service.ts and docs/data-model.md.
-- Additive only; safe to re-run.

-- "Requested date coming up" fires once per checkpoint (14, 7, 2 days out...).
-- Remembers which checkpoint, for which date, was last sent.
ALTER TABLE event_check_in_reminders ADD COLUMN IF NOT EXISTS last_sent_key TEXT;

-- "Remind me again in N days" snoozes ONE alert on an event. NULL keeps the
-- old meaning: every alert for that event.
ALTER TABLE event_reminder_snoozes ADD COLUMN IF NOT EXISTS rule_type VARCHAR;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_reminder_snoozes_rule_type_check') THEN
    ALTER TABLE event_reminder_snoozes ADD CONSTRAINT event_reminder_snoozes_rule_type_check
      CHECK (rule_type IS NULL OR rule_type IN (
        'no_contact', 'stale_event', 'date_approaching_inprocess', 'date_approaching_scheduled'
      ));
  END IF;
END $$;

-- One active snooze per event + person + alert (was: per event + person).
DROP INDEX IF EXISTS idx_reminder_snoozes_active_event_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_snoozes_active_event_user_rule
  ON event_reminder_snoozes (event_request_id, user_id, (coalesce(rule_type, '')))
  WHERE active = true;

-- Last time a person (not the sheet sync or a cron job) changed the event.
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS last_human_update_at TIMESTAMP;

-- Starting point: updated_at is the best estimate available for existing
-- events. Only fills empty values, so a re-run can't overwrite real stamps.
-- (No trigger on event_requests, so this doesn't touch updated_at.)
UPDATE event_requests
   SET last_human_update_at = updated_at
 WHERE last_human_update_at IS NULL;
