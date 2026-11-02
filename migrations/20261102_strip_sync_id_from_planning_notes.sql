-- Remove planning-sheet row IDs that were saved into planning notes as if
-- they were notes.
--
-- Background
-- ----------
-- The planning sheet's column AA used to be "Add'l Notes". It is now
-- "sync_id", a per-row ID like c5432e45-9a1c-4ecf-b849-36446f10b604. Two
-- import paths kept reading AA as notes, so events picked up a line that is
-- nothing but that ID:
--   * "Send row to app" (/api/event-requests/import-from-sheets) saved a
--     paragraph "Additional Notes: <id>" (paragraphs separated by a blank line).
--   * The planning-sheet bulk import saved a line "Additional notes: <id>"
--     (lines separated by a single newline).
-- Both paths now ignore AA. This removes the lines already saved.
--
-- What it touches
-- ---------------
-- Only a line that is exactly "Additional Notes: <uuid>" / "Additional notes:
-- <uuid>" (optionally followed by spaces). The newline(s) before it go too, so
-- no blank gap is left. Leading newlines left behind are trimmed, and notes
-- that end up empty become NULL. Any other text, including "Additional
-- Notes:" lines that hold real notes, is left exactly as it is.
--
-- Safe to run more than once: after it runs nothing matches.
-- Runs automatically on boot via server/migrate.ts.
--
-- PREVIEW (read-only):
--
-- SELECT id, organization_name, planning_notes
-- FROM event_requests
-- WHERE planning_notes ~* 'additional notes: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[ \t]*(\n|$)';

UPDATE event_requests
SET planning_notes = NULLIF(
  regexp_replace(
    regexp_replace(
      planning_notes,
      E'\\n*additional notes: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[ \\t]*(?=\\n|$)',
      '',
      'gi'
    ),
    E'^\\n+',
    ''
  ),
  ''
)
WHERE planning_notes ~* E'additional notes: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[ \\t]*(\\n|$)';
