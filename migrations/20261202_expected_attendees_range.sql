-- Expected attendees can be a single number ("40") or a range ("40-60").
-- estimated_attendance keeps the number (or the middle of the range), which
-- existing reports already read; these two hold the range's ends and are both
-- NULL for a single number. See shared/attendance-estimate.ts.
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS estimated_attendance_min integer;
ALTER TABLE event_requests ADD COLUMN IF NOT EXISTS estimated_attendance_max integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_requests_attendance_range_check') THEN
    ALTER TABLE event_requests ADD CONSTRAINT event_requests_attendance_range_check
      CHECK (
        (estimated_attendance_min IS NULL AND estimated_attendance_max IS NULL)
        OR (estimated_attendance_min IS NOT NULL AND estimated_attendance_max IS NOT NULL
            AND estimated_attendance_min >= 0 AND estimated_attendance_min <= estimated_attendance_max)
      );
  END IF;
END $$;
