-- Point stored resource links at the updated PBJ Sandwich Making 101 guide
-- (11/01/2026). The old 03/17/2026 file was removed from attached_assets, so
-- rows still holding its path would 404. seed-resources.ts only inserts, so
-- existing rows need this update.
-- Idempotent: rows already on the new path no longer match the WHERE.

UPDATE resources
SET url = '/attached_assets/PBJ Sandwich Making 2 101 11012026.pdf',
    updated_at = NOW()
WHERE url = '/attached_assets/PBJ Sandwich Making 2 101 03172026.pdf';
