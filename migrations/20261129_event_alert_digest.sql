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
-- Added WITHOUT a default first so existing rows stay NULL (adding it with
-- DEFAULT now() would stamp every old event as "updated today"). Then new
-- rows default to now(): a brand-new event counts from its creation.
-- Existing rows are filled by scripts/backfill-last-human-update.ts, run
-- deliberately with --dry-run first (CLAUDE.md schema rule 8). Until then the
-- alert falls back to updated_at, i.e. the old behavior.
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS last_human_update_at TIMESTAMP;
ALTER TABLE event_requests ALTER COLUMN last_human_update_at SET DEFAULT now();

-- The once-a-day digest limit: one row per person per Eastern day. A run
-- claims the day by inserting (the primary key rejects a second claim).
CREATE TABLE IF NOT EXISTS event_alert_digest_sends (
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_on)
);
