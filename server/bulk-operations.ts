import { db } from './db';
import {
  sandwichCollections,
  hosts,
  recipients,
  projects,
  contacts,
  hostContacts,
  type InsertSandwichCollection,
  type InsertHost,
  type InsertRecipient,
  type InsertProject,
  type InsertContact,
} from '@shared/schema';
import { AuditLogger, type AuditContext } from './audit-logger';
import { eq, inArray, sql } from 'drizzle-orm';
import { logger } from './utils/production-safe-logger';

export interface BulkOperationResult {
  success: boolean;
  processed: number;
  errors: string[];
  created?: number;
  updated?: number;
  deleted?: number;
}

export class BulkOperationsManager {
  static async bulkCreateCollections(
    collections: InsertSandwichCollection[],
    context: AuditContext = {}
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      success: true,
      processed: 0,
      errors: [],
      created: 0,
    };

    try {
      for (const collection of collections) {
        try {
          const [created] = await db
            .insert(sandwichCollections)
            .values(collection)
            .returning();

          await AuditLogger.logCreate(
            'sandwich_collections',
            created.id.toString(),
            created,
            context
          );

          result.created!++;
          result.processed++;
        } catch (error) {
          result.errors.push(
            `Failed to create collection for ${collection.hostName}: ${error}`
          );
        }
      }

      if (result.errors.length > 0) {
        result.success = false;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        processed: 0,
        errors: [`Bulk creation failed: ${error}`],
      };
    }
  }

  static async bulkUpdateHosts(
    updates: Array<{ id: number; data: Partial<typeof hosts.$inferSelect> }>,
    context: AuditContext = {}
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      success: true,
      processed: 0,
      errors: [],
      updated: 0,
    };

    try {
      for (const update of updates) {
        try {
          const [oldData] = await db
            .select()
            .from(hosts)
            .where(eq(hosts.id, update.id));

          if (!oldData) {
            result.errors.push(`Host with ID ${update.id} not found`);
            continue;
          }

          const [updated] = await db
            .update(hosts)
            .set({ ...update.data, updatedAt: new Date() })
            .where(eq(hosts.id, update.id))
            .returning();

          await AuditLogger.logUpdate(
            'hosts',
            update.id.toString(),
            oldData,
            updated,
            context
          );

          result.updated!++;
          result.processed++;
        } catch (error) {
          result.errors.push(`Failed to update host ${update.id}: ${error}`);
        }
      }

      if (result.errors.length > 0) {
        result.success = false;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        processed: 0,
        errors: [`Bulk update failed: ${error}`],
      };
    }
  }

  static async bulkDeleteCollections(
    ids: number[],
    context: AuditContext = {}
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      success: true,
      processed: 0,
      errors: [],
      deleted: 0,
    };

    try {
      // Get existing data for audit log
      const existingData = await db
        .select()
        .from(sandwichCollections)
        .where(inArray(sandwichCollections.id, ids));

      // Keep the Collective Learning auto-log from recreating deleted
      // auto entries (lazy import avoids a module cycle)
      try {
        const { markAutoEntriesDeleted } = await import(
          './services/collections/collective-learning-auto-log'
        );
        await markAutoEntriesDeleted(existingData, context.userId);
      } catch (error) {
        logger.error('Failed to sync auto-log overrides before bulk delete', error);
      }

      // Delete records
      const deletedResult = await db
        .delete(sandwichCollections)
        .where(inArray(sandwichCollections.id, ids));

      // Log each deletion
      for (const data of existingData) {
        await AuditLogger.logDelete(
          'sandwich_collections',
          data.id.toString(),
          data,
          context
        );
      }

      result.deleted = existingData.length;
      result.processed = existingData.length;

      return result;
    } catch (error) {
      return {
        success: false,
        processed: 0,
        errors: [`Bulk deletion failed: ${error}`],
      };
    }
  }

  static async deduplicateHosts(
    context: AuditContext = {}
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      success: true,
      processed: 0,
      errors: [],
      deleted: 0,
    };

    try {
      // Find potential duplicates based on name similarity
      const allHosts = await db.select().from(hosts);
      const duplicates: Array<{ keep: number; remove: number[] }> = [];

      // Simple duplicate detection by exact name match
      const nameGroups = new Map<string, number[]>();

      for (const host of allHosts) {
        const normalizedName = host.name.toLowerCase().trim();
        if (!nameGroups.has(normalizedName)) {
          nameGroups.set(normalizedName, []);
        }
        nameGroups.get(normalizedName)!.push(host.id);
      }

      // Identify duplicates (groups with more than one host)
      for (const [name, ids] of nameGroups) {
        if (ids.length > 1) {
          // Keep the first one (oldest), mark others for removal
          duplicates.push({
            keep: ids[0],
            remove: ids.slice(1),
          });
        }
      }

      // Remove duplicates
      for (const duplicate of duplicates) {
        try {
          // Update any collections that reference the duplicate hosts
          for (const removeId of duplicate.remove) {
            const hostToRemove = allHosts.find((h) => h.id === removeId);
            const hostToKeep = allHosts.find((h) => h.id === duplicate.keep);

            if (hostToRemove && hostToKeep) {
              // Update collections to use the kept host
              await db
                .update(sandwichCollections)
                .set({ hostName: hostToKeep.name })
                .where(eq(sandwichCollections.hostName, hostToRemove.name));
            }
          }

          // Delete the duplicate hosts
          await db.delete(hosts).where(inArray(hosts.id, duplicate.remove));

          result.deleted! += duplicate.remove.length;
          result.processed += duplicate.remove.length;

          // Log the deduplication
          await AuditLogger.log(
            'DEDUPLICATE',
            'hosts',
            duplicate.keep.toString(),
            { removedIds: duplicate.remove },
            { keptId: duplicate.keep },
            context
          );
        } catch (error) {
          result.errors.push(
            `Failed to remove duplicates for host group: ${error}`
          );
        }
      }

      if (result.errors.length > 0) {
        result.success = false;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        processed: 0,
        errors: [`Deduplication failed: ${error}`],
      };
    }
  }

  static async validateDataIntegrity(): Promise<{
    issues: Array<{ type: string; description: string; count: number }>;
    summary: { totalIssues: number; criticalIssues: number };
  }> {
    const issues: Array<{ type: string; description: string; count: number }> =
      [];

    try {
      // Check for collections with missing hosts
      const [orphanedCollections] = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM sandwich_collections sc
        WHERE NOT EXISTS (
          SELECT 1 FROM hosts h WHERE h.name = sc.host_name
        )
      `);

      if (Number(orphanedCollections.count) > 0) {
        issues.push({
          type: 'orphaned_collections',
          description: 'Collections referencing non-existent hosts',
          count: Number(orphanedCollections.count),
        });
      }

      // Check for duplicate host names
      const [duplicateHosts] = await db.execute(sql`
        SELECT COUNT(*) - COUNT(DISTINCT LOWER(TRIM(name))) as count
        FROM hosts
      `);

      if (Number(duplicateHosts.count) > 0) {
        issues.push({
          type: 'duplicate_hosts',
          description: 'Hosts with duplicate names',
          count: Number(duplicateHosts.count),
        });
      }

      // Check for invalid dates
      const [invalidDates] = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM sandwich_collections
        WHERE collection_date IS NULL OR collection_date = ''
      `);

      if (Number(invalidDates.count) > 0) {
        issues.push({
          type: 'invalid_dates',
          description: 'Collections with missing or invalid dates',
          count: Number(invalidDates.count),
        });
      }

      // Check for invalid sandwich counts
      const [invalidCounts] = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM sandwich_collections
        WHERE sandwich_count IS NULL OR sandwich_count <= 0
      `);

      if (Number(invalidCounts.count) > 0) {
        issues.push({
          type: 'invalid_counts',
          description: 'Collections with invalid sandwich counts',
          count: Number(invalidCounts.count),
        });
      }

      const totalIssues = issues.reduce((sum, issue) => sum + issue.count, 0);
      const criticalIssues = issues
        .filter(
          (i) =>
            i.type === 'orphaned_collections' || i.type === 'invalid_counts'
        )
        .reduce((sum, issue) => sum + issue.count, 0);

      return {
        issues,
        summary: { totalIssues, criticalIssues },
      };
    } catch (error) {
      logger.error('Data integrity check failed:', error);
      return {
        issues: [
          {
            type: 'check_failed',
            description: 'Could not complete integrity check',
            count: 1,
          },
        ],
        summary: { totalIssues: 1, criticalIssues: 1 },
      };
    }
  }
}
