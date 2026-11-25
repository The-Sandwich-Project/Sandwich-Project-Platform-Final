-- Email suppressions for the move from SendGrid to Twilio Email.
-- Addresses the app must not email, checked by the email helper before every
-- send (server/services/email/). Filled by:
--   * scripts/import-sendgrid-suppressions.ts (one-off, SendGrid history)
--   * the public email preferences page (/api/email-preferences)
--   * one-click List-Unsubscribe on newsletter mail
-- Keyed by address (not a person id): most recipients have no users/people row.
-- Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_scope_unique
  ON email_suppressions (email, scope);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_suppressions_email_lower_check') THEN
    ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_email_lower_check
      CHECK (email = lower(btrim(email)) AND email <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_suppressions_scope_check') THEN
    ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_scope_check
      CHECK (scope IN ('newsletter', 'operational', 'all'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_suppressions_reason_check') THEN
    ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_reason_check
      CHECK (reason IN ('unsubscribe', 'bounce', 'spam_report', 'invalid', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_suppressions_source_check') THEN
    ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_source_check
      CHECK (source IN ('sendgrid_import', 'unsubscribe_link', 'one_click', 'admin'));
  END IF;
END $$;
