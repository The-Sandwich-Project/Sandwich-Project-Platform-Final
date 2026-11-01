/**
 * Seed script to populate initial resources from hardcoded important documents
 * Run with: tsx server/scripts/seed-resources.ts
 */

import { db } from '../db';
import { resources, resourceTags, resourceTagAssignments } from '../../shared/schema';

// Category mapping from old to new
const categoryMap: Record<string, string> = {
  'Legal & Tax': 'legal_governance',
  'Governance': 'legal_governance',
  'Forms': 'forms_templates',
  'Safety Guidelines': 'operations_safety',
  'Labels & Printing': 'operations_safety',
  'Sandwich Making': 'training',
  'Tools': 'forms_templates',
  'Reference Lists': 'training',
};

// Initial resources data
const initialResources = [
  // Legal & Governance
  {
    title: 'IRS Tax Exempt Letter',
    description: 'IRS Tax Exempt determination letter containing EIN',
    type: 'link' as const,
    category: 'legal_governance',
    url: '/attached_assets/IRS Tax Exempt Letter (Contains EIN).pdf',
    isPinnedGlobal: true,
    pinnedOrder: 1,
  },
  {
    title: 'Articles of Incorporation',
    description: 'Official Articles of Incorporation for The Sandwich Project',
    type: 'link' as const,
    category: 'legal_governance',
    url: '/attached_assets/Articles of Incorporation.pdf',
    isPinnedGlobal: true,
    pinnedOrder: 2,
  },
  {
    title: 'The Sandwich Project Bylaws 2024',
    description:
      'Official bylaws document outlining organizational structure, governance, and operational procedures',
    type: 'link' as const,
    category: 'legal_governance',
    url: '/attached_assets/The Sandwich Project Bylaws 2024(1)_1750871081277.pdf',
    isPinnedGlobal: true,
    pinnedOrder: 3,
  },

  // Forms & Templates
  {
    title: 'TSP Volunteer Driver Agreement',
    description: 'Required agreement form for volunteer drivers',
    type: 'link' as const,
    category: 'forms_templates',
    url: '/documents/volunteer-driver-agreement.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'TSP Community Service Hours Form',
    description: 'Form for tracking and documenting community service hours',
    type: 'link' as const,
    category: 'forms_templates',
    url: '/documents/community-service-hours.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Sandwich Sign-In Form',
    description:
      'Simple sign-in form for tracking sandwich collection participants without requiring email addresses',
    type: 'link' as const,
    category: 'forms_templates',
    url: '/documents/volunteer-sign-in-sheet.pdf',
    isPinnedGlobal: false,
  },

  // Operations & Safety
  {
    title: 'Summer Food Safety Guidelines',
    description:
      'Updated guidelines for no cooler collections, proper refrigeration temperatures (33-36°F), and summer heat safety protocols for home hosts',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/attached_assets/Summer Food Safety Guidelines_1751569876472.pdf',
    isPinnedGlobal: true,
    pinnedOrder: 4,
  },
  {
    title: 'Food Safety Volunteers Guide',
    description:
      'Comprehensive safety protocols for volunteers preparing and delivering sandwiches',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/documents/food-safety-volunteers.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Food Safety Hosts Guide',
    description:
      'Safety standards and procedures for hosts collecting and storing sandwiches',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/attached_assets/20230525-TSP-Food Safety Hosts (1)_1753670644140.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Food Safety Recipients Guide',
    description:
      'Safety standards for recipient organizations handling perishable food donations',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/attached_assets/20250205-TSP-Food Safety Recipients_1753670644140.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Deli Labels',
    description: 'Official TSP labels for deli sandwich identification and tracking',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/documents/deli-labels.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'PBJ Labels',
    description: 'Labels and guidelines for peanut butter and jelly sandwiches',
    type: 'link' as const,
    category: 'operations_safety',
    url: '/documents/pbj-labels.pdf',
    isPinnedGlobal: false,
  },

  // Training Materials
  {
    title: 'Deli Sandwich Making 101',
    description: 'Complete guide to preparing deli sandwiches according to TSP standards',
    type: 'link' as const,
    category: 'training',
    url: '/documents/deli-sandwich-making-101.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'PBJ Sandwich Making 101',
    description: 'Step-by-step instructions for making peanut butter and jelly sandwiches',
    type: 'link' as const,
    category: 'training',
    url: '/documents/pbj-sandwich-making-101.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Master Congregations List',
    description:
      'Comprehensive final confirmed list of all congregations including churches, synagogues, and religious organizations',
    type: 'link' as const,
    category: 'training',
    url: '/attached_assets/Master_Congregations_List_Final_1759034641771.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'TSP Company Partners List',
    description:
      'Complete directory of corporate partners, businesses, and company organizations working with The Sandwich Project',
    type: 'link' as const,
    category: 'training',
    url: '/attached_assets/TSP Company List _1759034641773.pdf',
    isPinnedGlobal: false,
  },
  {
    title: 'Unified Schools List',
    description:
      'Comprehensive list of educational institutions including elementary, middle, high schools, and universities',
    type: 'link' as const,
    category: 'training',
    url: '/attached_assets/Unified_Schools_List_1759034641773.pdf',
    isPinnedGlobal: false,
  },

  // Forms & Templates (Tools)
  {
    title: 'Inventory Calculator',
    description:
      'Interactive tool for calculating sandwich inventory and planning quantities for collections',
    type: 'link' as const,
    category: 'forms_templates',
    url: 'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html',
    isPinnedGlobal: false,
  },
  {
    title: 'Auto Form Filler',
    description:
      'AI-powered tool to automatically fill out TSP forms by uploading documents. Supports Service Hours Forms, Event Requests, Volunteer Applications, and more.',
    type: 'link' as const,
    category: 'forms_templates',
    url: '/dashboard?section=auto-form-filler',
    isPinnedGlobal: false,
  },
  {
    title: 'Service Hours Form Generator',
    description:
      'Quickly generate filled Community Service Hours verification forms for volunteers with automatic PDF creation.',
    type: 'link' as const,
    category: 'forms_templates',
    url: '/dashboard?section=generate-service-hours',
    isPinnedGlobal: false,
  },
];

// Initial tags
const initialTags = [
  { name: 'Safety', color: '#EF4444' },
  { name: 'Legal', color: '#8B5CF6' },
  { name: 'Training', color: '#3B82F6' },
  { name: 'Forms', color: '#F59E0B' },
  { name: 'Quick Reference', color: '#10B981' },
];

async function seed() {
  console.log('🌱 Starting resource seeding...');

  try {
    // Create admin user reference (using 'system' as creator)
    const systemUser = {
      id: 'system',
      name: 'System Administrator',
    };

    // Create tags first
    console.log('Creating tags...');
    const createdTags: Record<string, number> = {};

    for (const tag of initialTags) {
      const [created] = await db
        .insert(resourceTags)
        .values({
          name: tag.name,
          color: tag.color,
          createdBy: systemUser.id,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        createdTags[tag.name] = created.id;
        console.log(`  ✓ Created tag: ${tag.name}`);
      }
    }

    // Create resources
    console.log('\nCreating resources...');
    let createdCount = 0;

    for (const resource of initialResources) {
      const [created] = await db
        .insert(resources)
        .values({
          ...resource,
          createdBy: systemUser.id,
          createdByName: systemUser.name,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        createdCount++;
        console.log(`  ✓ Created: ${resource.title}`);

        // Assign relevant tags
        const tagsToAssign: string[] = [];

        if (resource.category === 'operations_safety') {
          tagsToAssign.push('Safety');
        }
        if (resource.category === 'legal_governance') {
          tagsToAssign.push('Legal');
        }
        if (resource.category === 'training') {
          tagsToAssign.push('Training');
        }
        if (resource.category === 'forms_templates') {
          tagsToAssign.push('Forms');
        }
        if (resource.title.includes('List') || resource.title.includes('Labels')) {
          tagsToAssign.push('Quick Reference');
        }

        // Assign tags
        for (const tagName of tagsToAssign) {
          const tagId = createdTags[tagName];
          if (tagId) {
            await db.insert(resourceTagAssignments).values({
              resourceId: created.id,
              tagId,
            });
          }
        }
      }
    }

    console.log(`\n✅ Successfully created ${createdCount} resources!`);
    console.log(`✅ Created ${Object.keys(createdTags).length} tags!`);
    console.log('\n🎉 Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding resources:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the seed
seed();
