// Static document catalog. Feeds the dashboard document cards and the
// Admin Settings → Dashboard Config picker. These documents also exist as
// rows in the resources table (see migrations/20261102_*), which is what
// the Resources page shows.

export interface AdminDocument {
  id: string;
  name: string;
  description: string;
  category: string;
  path: string;
  type: 'pdf' | 'docx' | 'xlsx' | 'link' | 'image';
  size?: string;
  lastModified?: string;
  importance: 'critical' | 'high' | 'normal';
  /** If set, this document came from the database and can be deleted */
  dbDocumentId?: number;
  uploadedByName?: string;
  createdAt?: string;
}


export const adminDocuments: AdminDocument[] = [
  // Legal & Tax Documents
  {
    id: 'tax-exempt-letter',
    name: 'IRS Tax Exempt Letter',
    description: 'IRS Tax Exempt determination letter containing EIN',
    category: 'Legal & Tax',
    path: '/attached_assets/IRS Tax Exempt Letter (Contains EIN).pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'articles-incorporation',
    name: 'Articles of Incorporation',
    description: 'Official Articles of Incorporation for The Sandwich Project',
    category: 'Legal & Tax',
    path: '/attached_assets/Articles of Incorporation.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'georgia-code',
    name: '2020 Georgia Code Title 51',
    description: 'Georgia state legal code reference for nonprofit operations',
    category: 'Legal & Tax',
    path: '/attached_assets/2020 Georgia Code Title 51.pdf',
    type: 'pdf',
    importance: 'high',
  },
  
  // Governance Documents
  {
    id: 'bylaws-2024',
    name: 'The Sandwich Project Bylaws 2024',
    description: 'Official bylaws document outlining organizational structure, governance, and operational procedures',
    category: 'Governance',
    path: '/attached_assets/The Sandwich Project Bylaws 2024(1)_1750871081277.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  
  // Forms
  {
    id: 'volunteer-driver-agreement',
    name: 'TSP Volunteer Driver Agreement',
    description: 'Required agreement form for volunteer drivers',
    category: 'Forms',
    path: '/documents/volunteer-driver-agreement.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'community-service-hours',
    name: 'TSP Community Service Hours',
    description: 'Form for tracking and documenting community service hours',
    category: 'Forms',
    path: '/documents/community-service-hours.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'sandwich-signin-form',
    name: 'Sandwich Sign-In Form',
    description: 'Simple sign-in form for tracking sandwich collection participants without requiring email addresses',
    category: 'Forms',
    path: '/documents/volunteer-sign-in-sheet.pdf',
    type: 'pdf',
    importance: 'high',
  },
  
  // Safety Guidelines
  {
    id: 'summer-food-safety',
    name: 'Summer Food Safety Guidelines',
    description: 'Updated guidelines for no cooler collections, proper refrigeration temperatures (33-36°F), and summer heat safety protocols for home hosts',
    category: 'Safety Guidelines',
    path: '/attached_assets/Summer Food Safety Guidelines_1751569876472.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'food-safety-volunteers',
    name: 'Food Safety Volunteers Guide',
    description: 'Comprehensive safety protocols for volunteers preparing and delivering sandwiches',
    category: 'Tools',
    path: '/documents/food-safety-volunteers.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'food-safety-hosts',
    name: 'Food Safety Hosts Guide',
    description: 'Safety standards and procedures for hosts collecting and storing sandwiches',
    category: 'Safety Guidelines',
    path: '/attached_assets/20230525-TSP-Food Safety Hosts (1)_1753670644140.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'food-safety-recipients',
    name: 'Food Safety Recipients Guide',
    description: 'Safety standards for recipient organizations handling perishable food donations',
    category: 'Safety Guidelines',
    path: '/attached_assets/20250205-TSP-Food Safety Recipients_1753670644140.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  {
    id: 'food-safety-recipients-alt',
    name: 'Food Safety Recipients (Alternate)',
    description: 'Additional safety guidelines for 501(c)(3) recipient organizations',
    category: 'Safety Guidelines',
    path: '/attached_assets/Copy of Copy of Food Safety TSP.RECIPIENTS.04042023_1753670644141.pdf',
    type: 'pdf',
    importance: 'high',
  },
  
  // Labels & Printing
  {
    id: 'deli-labels',
    name: 'Deli Labels',
    description: 'Official TSP labels for deli sandwich identification and tracking',
    category: 'Labels & Printing',
    path: '/documents/deli-labels.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'pbj-labels',
    name: 'PBJ Labels',
    description: 'Labels and guidelines for peanut butter and jelly sandwiches',
    category: 'Labels & Printing',
    path: '/documents/pbj-labels.pdf',
    type: 'pdf',
    importance: 'high',
  },
  
  // Sandwich Making Guides
  {
    id: 'group-event-reference-guide',
    name: 'Group Event Reference Guide',
    description: 'Complete reference guide for planning and running group sandwich-making events',
    category: 'Sandwich Making',
    path: '/attached_assets/Group_Event_Reference_Guide Final.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'deli-sandwich-guide',
    name: 'Deli Sandwich Making 101',
    description: 'Complete guide to preparing deli sandwiches according to TSP standards',
    category: 'Sandwich Making',
    path: '/documents/deli-sandwich-making-101.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'pbj-sandwich-guide',
    name: 'PBJ Sandwich Making 101',
    description: 'Step-by-step instructions for making peanut butter and jelly sandwiches',
    category: 'Sandwich Making',
    path: '/documents/pbj-sandwich-making-101.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'volunteer-handbook',
    name: 'TSP Volunteer Handbook',
    description:
      'The all-encompassing handbook for every volunteer role — policies, procedures, and reference material',
    category: 'Handbook',
    path: '/documents/tsp-host-handbook.pdf',
    type: 'pdf',
    importance: 'critical',
  },
  
  // Tools
  {
    id: 'inventory-calculator',
    name: 'Inventory Calculator',
    description: 'Interactive tool for calculating sandwich inventory and planning quantities for collections',
    category: 'Tools',
    path: 'https://the-sandwich-project.github.io/sandwichinventory/inventorycalculator.html',
    type: 'link',
    importance: 'high',
  },
  
  // Reference Lists
  {
    id: 'master-congregations-list',
    name: 'Master Congregations List',
    description: 'Comprehensive final confirmed list of all congregations including churches, synagogues, and religious organizations',
    category: 'Reference Lists',
    path: '/attached_assets/Master_Congregations_List_Final_1759034641771.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'tsp-company-partners',
    name: 'TSP Company Partners List',
    description: 'Complete directory of corporate partners, businesses, and company organizations working with The Sandwich Project',
    category: 'Reference Lists',
    path: '/attached_assets/TSP Company List _1759034641773.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'unified-schools-list',
    name: 'Unified Schools List',
    description: 'Comprehensive list of educational institutions including elementary, middle, high schools, and universities',
    category: 'Reference Lists',
    path: '/attached_assets/Unified_Schools_List_1759034641773.pdf',
    type: 'pdf',
    importance: 'high',
  },
  {
    id: 'uploaded-document-oct-22',
    name: 'Important Document',
    description: 'Recently uploaded reference document',
    category: 'Legal & Tax',
    path: '/attached_assets/900F2271-08DB-4E61-8E25-03D21F987178_1761090885143.jpeg',
    type: 'image',
    importance: 'high',
  },
];
