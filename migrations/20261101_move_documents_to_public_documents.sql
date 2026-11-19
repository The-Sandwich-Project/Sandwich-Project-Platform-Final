-- Documents moved from attached_assets/ (gitignored, served at
-- /attached_assets/...) to client/public/documents/ (tracked, served at
-- /documents/...). The old files were removed, so stored resource links to
-- them would 404. seed-resources.ts only inserts, so existing rows need this.
--
-- Also covers the 03/17/2026 PBJ guide, replaced by the 11/01/2026 version.
-- Idempotent: rows already on the new paths no longer match the WHERE.

UPDATE resources
SET url = m.new_url,
    updated_at = NOW()
FROM (VALUES
  ('/attached_assets/20260506-TSP-Food+Safety+Volunteers.pdf',           '/documents/food-safety-volunteers.pdf'),
  ('/attached_assets/Deli Labels_1756865384146.pdf',                     '/documents/deli-labels.pdf'),
  ('/attached_assets/Deli Sandwich Making 101 03172026.pdf',             '/documents/deli-sandwich-making-101.pdf'),
  ('/attached_assets/PBJ Labels_1756865384146.pdf',                      '/documents/pbj-labels.pdf'),
  ('/attached_assets/PBJ Sandwich Making 2 101 03172026.pdf',            '/documents/pbj-sandwich-making-101.pdf'),
  ('/attached_assets/PBJ Sandwich Making 2 101 11012026.pdf',            '/documents/pbj-sandwich-making-101.pdf'),
  ('/attached_assets/Sandwich Project - Sign In Sheet correct qrs.pdf',  '/documents/volunteer-sign-in-sheet.pdf'),
  ('/attached_assets/TSP COMMUNITY SERVICE HOURS (1) (1) (1).pdf',       '/documents/community-service-hours.pdf'),
  ('/attached_assets/TSP Volunteer Driver Agreement (1).pdf',            '/documents/volunteer-driver-agreement.pdf')
) AS m(old_url, new_url)
WHERE resources.url = m.old_url;
