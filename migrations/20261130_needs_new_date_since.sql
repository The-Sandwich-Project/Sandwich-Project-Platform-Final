-- "Rescheduled" status retired: a scheduled event that loses its date goes back
-- to In Process with this marker set, and the In Process card shows "needs new
-- date". Cleared when the event is scheduled again or completed.
-- Existing 'rescheduled' rows are moved by the script
-- scripts/retire-rescheduled-status.ts (run on purpose, with --dry-run first).
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS needs_new_date_since timestamp;
