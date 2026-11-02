-- Fold the old Important Documents page into Resources.
--
-- 1. Every document from the Important Documents static list gets a
--    resources row (type 'link') unless one already exists with the same URL
--    or title. seed-resources.ts covered most of them, but not all, and it may
--    never have run against a given database.
-- 2. The Resources page has no 'training' section, so rows seeded with that
--    category were invisible. Move them to sections that exist.
--
-- Files uploaded through Document Management are NOT copied into resources:
-- the Resources page lists them live from /api/documents, so there is no
-- second copy to keep in sync.
--
-- Runs after 20261101_move_documents_to_public_documents.sql, so URLs are
-- already on their /documents/ paths. Idempotent: every step skips rows it
-- has already handled.

INSERT INTO resources (title, description, type, category, url, created_by, created_by_name)
SELECT v.title, v.description, 'link', v.category, v.url, 'system', 'System Administrator'
FROM (VALUES
  ('IRS Tax Exempt Letter', 'IRS Tax Exempt determination letter containing EIN', 'legal_governance', '/attached_assets/IRS Tax Exempt Letter (Contains EIN).pdf'),
  ('Articles of Incorporation', 'Official Articles of Incorporation for The Sandwich Project', 'legal_governance', '/attached_assets/Articles of Incorporation.pdf'),
  ('2020 Georgia Code Title 51', 'Georgia state legal code reference for nonprofit operations', 'legal_governance', '/attached_assets/2020 Georgia Code Title 51.pdf'),
  ('The Sandwich Project Bylaws 2024', 'Official bylaws document outlining organizational structure, governance, and operational procedures', 'legal_governance', '/attached_assets/The Sandwich Project Bylaws 2024(1)_1750871081277.pdf'),
  ('TSP Volunteer Driver Agreement', 'Required agreement form for volunteer drivers', 'forms_templates', '/documents/volunteer-driver-agreement.pdf'),
  ('TSP Community Service Hours', 'Form for tracking and documenting community service hours', 'forms_templates', '/documents/community-service-hours.pdf'),
  ('Sandwich Sign-In Form', 'Simple sign-in form for tracking sandwich collection participants without requiring email addresses', 'forms_templates', '/documents/volunteer-sign-in-sheet.pdf'),
  ('Summer Food Safety Guidelines', 'Updated guidelines for no cooler collections, proper refrigeration temperatures (33-36°F), and summer heat safety protocols for home hosts', 'operations_safety', '/attached_assets/Summer Food Safety Guidelines_1751569876472.pdf'),
  ('Food Safety Volunteers Guide', 'Comprehensive safety protocols for volunteers preparing and delivering sandwiches', 'toolkit', '/documents/food-safety-volunteers.pdf'),
  ('Food Safety Hosts Guide', 'Safety standards and procedures for hosts collecting and storing sandwiches', 'operations_safety', '/attached_assets/20230525-TSP-Food Safety Hosts (1)_1753670644140.pdf'),
  ('Food Safety Recipients Guide', 'Safety standards for recipient organizations handling perishable food donations', 'operations_safety', '/attached_assets/20250205-TSP-Food Safety Recipients_1753670644140.pdf'),
  ('Food Safety Recipients (Alternate)', 'Additional safety guidelines for 501(c)(3) recipient organizations', 'operations_safety', '/attached_assets/Copy of Copy of Food Safety TSP.RECIPIENTS.04042023_1753670644141.pdf'),
  ('Deli Labels', 'Official TSP labels for deli sandwich identification and tracking', 'operations_safety', '/documents/deli-labels.pdf'),
  ('PBJ Labels', 'Labels and guidelines for peanut butter and jelly sandwiches', 'operations_safety', '/documents/pbj-labels.pdf'),
  ('Group Event Reference Guide', 'Complete reference guide for planning and running group sandwich-making events', 'toolkit', '/attached_assets/Group_Event_Reference_Guide Final.pdf'),
  ('Deli Sandwich Making 101', 'Complete guide to preparing deli sandwiches according to TSP standards', 'toolkit', '/documents/deli-sandwich-making-101.pdf'),
  ('PBJ Sandwich Making 101', 'Step-by-step instructions for making peanut butter and jelly sandwiches', 'toolkit', '/documents/pbj-sandwich-making-101.pdf'),
  ('TSP Volunteer Handbook', 'The all-encompassing handbook for every volunteer role — policies, procedures, and reference material', 'toolkit', '/documents/tsp-host-handbook.pdf'),
  ('Inventory Calculator', 'Interactive tool for calculating sandwich inventory and planning quantities for collections', 'toolkit', 'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html'),
  ('Master Congregations List', 'Comprehensive final confirmed list of all congregations including churches, synagogues, and religious organizations', 'master_documents', '/attached_assets/Master_Congregations_List_Final_1759034641771.pdf'),
  ('TSP Company Partners List', 'Complete directory of corporate partners, businesses, and company organizations working with The Sandwich Project', 'master_documents', '/attached_assets/TSP Company List _1759034641773.pdf'),
  ('Unified Schools List', 'Comprehensive list of educational institutions including elementary, middle, high schools, and universities', 'master_documents', '/attached_assets/Unified_Schools_List_1759034641773.pdf'),
  ('Important Document', 'Recently uploaded reference document', 'legal_governance', '/attached_assets/900F2271-08DB-4E61-8E25-03D21F987178_1761090885143.jpeg')
) AS v(title, description, category, url)
WHERE NOT EXISTS (
  SELECT 1 FROM resources r
  WHERE r.url = v.url OR lower(r.title) = lower(v.title)
);

UPDATE resources
SET category = 'master_documents', updated_at = NOW()
WHERE category = 'training'
  AND title IN ('Master Congregations List', 'TSP Company Partners List', 'Unified Schools List');

UPDATE resources
SET category = 'toolkit', updated_at = NOW()
WHERE category = 'training';
