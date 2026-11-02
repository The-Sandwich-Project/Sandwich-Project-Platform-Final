import { storage } from '../storage-wrapper';
import { db } from '../db';
import { resources, resourceTags, resourceTagAssignments } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Script to add the TSP Host Handbook to the resources section
 */
async function addHostHandbookResource() {
  try {
    console.log('Adding TSP Host Handbook to resources...');

    // Path to the uploaded PDF
    const pdfPath = path.join(
      process.cwd(),
      'attached_assets',
      'TSP-Host-Handbook (8).pdf'
    );

    // Check if file exists
    const fileExists = await fs.access(pdfPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error(`PDF file not found at: ${pdfPath}`);
    }

    // Get file stats
    const stats = await fs.stat(pdfPath);
    const fileSize = stats.size;

    // Read the file
    const fileBuffer = await fs.readFile(pdfPath);

    // Create upload directory if it doesn't exist
    const uploadDir = path.join(process.cwd(), 'server/uploads/documents');
    await fs.mkdir(uploadDir, { recursive: true });

    // Create a unique filename
    const timestamp = Date.now();
    const filename = `tsp-host-handbook-${timestamp}.pdf`;
    const destinationPath = path.join(uploadDir, filename);

    // Copy file to uploads directory
    await fs.writeFile(destinationPath, fileBuffer);
    console.log(`File copied to: ${destinationPath}`);

    // Create document record
    const documentData = {
      title: 'TSP Host Handbook',
      description: 'Complete guide for host collection sites — everything you need to know about hosting a sandwich collection with The Sandwich Project.',
      fileName: filename,
      originalName: 'TSP-Host-Handbook.pdf',
      filePath: destinationPath,
      fileSize: fileSize,
      mimeType: 'application/pdf',
      category: 'operations',
      isActive: true,
      uploadedBy: 'admin_1756853839752',
      uploadedByName: 'System Admin',
    };

    const document = await storage.createDocument(documentData);
    console.log(`Document created: ID ${document.id}`);

    // Check if resource already exists
    const existingResources = await db
      .select()
      .from(resources)
      .where(eq(resources.title, 'TSP Host Handbook'))
      .limit(1);

    if (existingResources.length > 0) {
      console.log(`Resource already exists with ID ${existingResources[0].id}`);
      console.log('Updating existing resource...');

      await db
        .update(resources)
        .set({
          documentId: document.id,
          description: documentData.description,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, existingResources[0].id));

      console.log(`Resource updated: ${existingResources[0].id}`);
      return existingResources[0].id;
    }

    // Create resource record
    const resourceData = {
      title: 'TSP Host Handbook',
      description: documentData.description,
      type: 'file' as const,
      category: 'operations_safety',
      documentId: document.id,
      url: null,
      icon: 'BookOpen',
      iconColor: '#236383',
      isPinnedGlobal: true,
      pinnedOrder: null,
      createdBy: 'admin_1756853839752',
      createdByName: 'System Admin',
    };

    const [newResource] = await db.insert(resources).values(resourceData).returning();
    console.log(`Resource created: ID ${newResource.id}`);

    // Add tags
    console.log('Adding tags to resource...');

    // Check if "host" tag exists, create if not
    let hostTag = await db
      .select()
      .from(resourceTags)
      .where(eq(resourceTags.name, 'host'))
      .limit(1);

    if (hostTag.length === 0) {
      const [newTag] = await db
        .insert(resourceTags)
        .values({
          name: 'host',
          color: '#236383',
          description: 'Resources for host collection sites',
          createdBy: 'admin_1756853839752',
        })
        .returning();
      hostTag = [newTag];
      console.log('Created "host" tag');
    }

    // Assign tag to resource
    await db.insert(resourceTagAssignments).values([
      {
        resourceId: newResource.id,
        tagId: hostTag[0].id,
      },
    ]);
    console.log('Tags assigned to resource');

    console.log('\nTSP Host Handbook successfully added to resources section!');
    console.log(`   - Document ID: ${document.id}`);
    console.log(`   - Resource ID: ${newResource.id}`);
    console.log(`   - Category: Operations & Safety`);
    console.log(`   - Tags: host`);

    return newResource.id;
  } catch (error) {
    console.error('Error adding TSP Host Handbook:', error);
    throw error;
  }
}

// Run the script
addHostHandbookResource()
  .then((resourceId) => {
    console.log(`\nSuccess! Resource ID: ${resourceId}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to add resource:', error);
    process.exit(1);
  });
