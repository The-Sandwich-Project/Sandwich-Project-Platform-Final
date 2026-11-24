import { db } from './db';
import {
  sandwichCollections,
  hosts,
  recipients,
  projects,
  auditLogs,
  messages,
  meetingMinutes,
  hostContacts,
  contacts,
} from '@shared/schema';
import { eq, gte, lte, desc, sql, and, isNull } from 'drizzle-orm';
import { logger } from './utils/production-safe-logger';

export interface ExportOptions {
  format: 'csv' | 'json';
  dateRange?: {
    start: string;
    end: string;
  };
  includeInactive?: boolean;
  fields?: string[];
}

export class DataExporter {
  static async exportSandwichCollections(
    options: ExportOptions = { format: 'csv' }
  ) {
    try {
      let query = db.select().from(sandwichCollections).where(isNull(sandwichCollections.deletedAt));

      // Apply date filters
      if (options.dateRange) {
        query = query.where(
          and(
            isNull(sandwichCollections.deletedAt),
            sql`${sandwichCollections.collectionDate} >= ${options.dateRange.start} AND ${sandwichCollections.collectionDate} <= ${options.dateRange.end}`
          )
        );
      }

      const data = await query.orderBy(
        desc(sandwichCollections.collectionDate)
      );

      if (options.format === 'csv') {
        return this.convertToCSV(data, [
          'id',
          'hostName',
          'collectionDate',
          'sandwichCount',
          'notes',
          'createdAt',
        ]);
      }

      return { data, format: 'json' };
    } catch (error) {
      logger.error('Export failed:', error);
      throw new Error('Failed to export sandwich collections');
    }
  }

  static async exportHosts(options: ExportOptions = { format: 'csv' }) {
    try {
      let query = db.select().from(hosts);

      if (!options.includeInactive) {
        query = query.where(eq(hosts.status, 'active'));
      }

      const data = await query.orderBy(hosts.name);

      if (options.format === 'csv') {
        return this.convertToCSV(data, [
          'id',
          'name',
          'address',
          'status',
          'capacity',
          'notes',
          'createdAt',
        ]);
      }

      return { data, format: 'json' };
    } catch (error) {
      logger.error('Export failed:', error);
      throw new Error('Failed to export hosts');
    }
  }

  static async exportProjects(options: ExportOptions = { format: 'csv' }) {
    try {
      const data = await db.select().from(projects).orderBy(desc(projects.id));

      if (options.format === 'csv') {
        return this.convertToCSV(data, [
          'id',
          'title',
          'description',
          'status',
          'priority',
          'category',
          'assigneeName',
          'dueDate',
          'progressPercentage',
          'createdAt',
        ]);
      }

      return { data, format: 'json' };
    } catch (error) {
      logger.error('Export failed:', error);
      throw new Error('Failed to export projects');
    }
  }

  static async exportAuditLogs(options: ExportOptions = { format: 'csv' }) {
    try {
      let query = db.select().from(auditLogs);

      if (options.dateRange) {
        query = query.where(
          sql`${auditLogs.timestamp} >= ${options.dateRange.start} AND ${auditLogs.timestamp} <= ${options.dateRange.end}`
        );
      }

      const data = await query.orderBy(desc(auditLogs.timestamp)).limit(10000); // Limit for performance

      if (options.format === 'csv') {
        return this.convertToCSV(data, [
          'id',
          'action',
          'tableName',
          'recordId',
          'userId',
          'ipAddress',
          'timestamp',
        ]);
      }

      return { data, format: 'json' };
    } catch (error) {
      logger.error('Export failed:', error);
      throw new Error('Failed to export audit logs');
    }
  }

  static async exportFullDataset(options: ExportOptions = { format: 'json' }) {
    try {
      const [
        collectionsData,
        hostsData,
        recipientsData,
        projectsData,
        contactsData,
        messagesData,
      ] = await Promise.all([
        db
          .select()
          .from(sandwichCollections)
          .orderBy(desc(sandwichCollections.collectionDate)),
        db.select().from(hosts).orderBy(hosts.name),
        db.select().from(recipients).orderBy(recipients.name),
        db.select().from(projects).orderBy(desc(projects.id)),
        db.select().from(contacts).orderBy(contacts.name),
        db
          .select()
          .from(messages)
          .orderBy(desc(messages.createdAt))
          .limit(1000),
      ]);

      const fullDataset = {
        exportDate: new Date().toISOString(),
        summary: {
          sandwichCollections: collectionsData.length,
          hosts: hostsData.length,
          recipients: recipientsData.length,
          projects: projectsData.length,
          contacts: contactsData.length,
          messages: messagesData.length,
        },
        data: {
          sandwichCollections: collectionsData,
          hosts: hostsData,
          recipients: recipientsData,
          projects: projectsData,
          contacts: contactsData,
          messages: messagesData,
        },
      };

      return { data: fullDataset, format: 'json' };
    } catch (error) {
      logger.error('Full export failed:', error);
      throw new Error('Failed to export full dataset');
    }
  }

  static async getDataSummary() {
    try {
      const [
        collectionsCount,
        hostsCount,
        recipientsCount,
        projectsCount,
        contactsCount,
        totalSandwiches,
      ] = await Promise.all([
        db.select({ count: sql`count(*)` }).from(sandwichCollections).where(isNull(sandwichCollections.deletedAt)),
        db.select({ count: sql`count(*)` }).from(hosts),
        db.select({ count: sql`count(*)` }).from(recipients),
        db.select({ count: sql`count(*)` }).from(projects),
        db.select({ count: sql`count(*)` }).from(hostContacts),
        db
          .select({
            total: sql`sum(${sandwichCollections.individualSandwiches})`,
          })
          .from(sandwichCollections)
          .where(isNull(sandwichCollections.deletedAt)),
      ]);

      return {
        collections: Number(collectionsCount[0]?.count || 0),
        hosts: Number(hostsCount[0]?.count || 0),
        recipients: Number(recipientsCount[0]?.count || 0),
        projects: Number(projectsCount[0]?.count || 0),
        contacts: Number(contactsCount[0]?.count || 0),
        totalSandwiches: Number(totalSandwiches[0]?.total || 0),
      };
    } catch (error) {
      logger.error('Summary failed:', error);
      return {
        collections: 0,
        hosts: 0,
        recipients: 0,
        projects: 0,
        contacts: 0,
        totalSandwiches: 0,
      };
    }
  }

  private static convertToCSV(
    data: any[],
    fields: string[]
  ): { data: string; format: 'csv' } {
    if (!data.length) {
      return { data: '', format: 'csv' };
    }

    // Create headers
    const headers = fields.join(',');

    // Create rows
    const rows = data.map((item) => {
      return fields
        .map((field) => {
          let value = item[field];

          // Handle null/undefined
          if (value === null || value === undefined) {
            return '';
          }

          // Handle objects/arrays
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }

          // Escape commas and quotes
          value = String(value).replace(/"/g, '""');

          // Wrap in quotes if contains comma, newline, or quote
          if (
            value.includes(',') ||
            value.includes('\n') ||
            value.includes('"')
          ) {
            value = `"${value}"`;
          }

          return value;
        })
        .join(',');
    });

    const csvData = [headers, ...rows].join('\n');
    return { data: csvData, format: 'csv' };
  }
}
