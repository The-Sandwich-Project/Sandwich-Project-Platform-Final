-- Hosts who also volunteer at events. Checking "Also a volunteer" on a host
-- contact creates (or reuses) a linked row in volunteers so the person shows
-- up wherever volunteers are listed.
ALTER TABLE host_contacts
  ADD COLUMN IF NOT EXISTS is_volunteer BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS host_contact_id INTEGER;

-- At most one volunteer record per host contact.
CREATE UNIQUE INDEX IF NOT EXISTS volunteers_host_contact_id_unique
  ON volunteers (host_contact_id)
  WHERE host_contact_id IS NOT NULL;
