-- Links between event requests and the collection-log groups that came from
-- them, managed from the Collection Log dialog on completed event cards
-- (server/routes/event-requests/collections.ts). Matches eventCollectionLinks
-- in shared/schema.ts.
--
-- One collection entry can hold several groups that each had their own event
-- request, so links are per group: group_index points into the entry's
-- group_collections array (or the legacy group1/group2 columns), and -1 means
-- the whole entry (the host is the organization). group_name is a snapshot
-- used to re-find the group if the entry is later edited and reordered.
--
-- The older sandwich_collections.event_request_id column is left as-is; any
-- links there are still read as whole-entry links.
-- Idempotent: safe to run against both the dev and production branches.

CREATE TABLE IF NOT EXISTS event_collection_links (
  id SERIAL PRIMARY KEY,
  event_request_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,
  group_index INTEGER NOT NULL,
  group_name TEXT,
  created_by VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Each group (or the whole entry) belongs to at most one event.
CREATE UNIQUE INDEX IF NOT EXISTS event_collection_links_collection_group_unique
  ON event_collection_links (collection_id, group_index);

CREATE INDEX IF NOT EXISTS idx_event_collection_links_event
  ON event_collection_links (event_request_id);
