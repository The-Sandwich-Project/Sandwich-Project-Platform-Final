/**
 * Schema Drift Verification
 *
 * Runs on server startup to compare the columns defined in shared/schema.ts
 * against the actual columns present in the PostgreSQL database. Logs warnings
 * for any mismatches so missing migrations are caught immediately instead of
 * silently falling back to in-memory storage.
 */
import { createSqlClient } from './sql-client';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { logger } from './utils/production-safe-logger';
import { getDatabaseUrl } from './db-url';

/**
 * Extract all pgTable exports from the schema module.
 * Drizzle tables have a Symbol.for('drizzle:IsDrizzleTable') property.
 */
function getAllTables(): Record<string, PgTable> {
  const tables: Record<string, PgTable> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      value &&
      typeof value === 'object' &&
      (value as any)[Symbol.for('drizzle:IsDrizzleTable')]
    ) {
      tables[key] = value as PgTable;
    }
  }
  return tables;
}

export async function checkSchemaDrift(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return; // No database configured, nothing to check
  }

  try {
    const sql_client = createSqlClient(databaseUrl);

    // Query all columns from all tables in the public schema
    const dbColumns = await sql_client(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);

    // Build a lookup: table_name -> Set of column_names
    const dbColumnMap = new Map<string, Set<string>>();
    for (const row of dbColumns) {
      const tableName = row.table_name as string;
      if (!dbColumnMap.has(tableName)) {
        dbColumnMap.set(tableName, new Set());
      }
      dbColumnMap.get(tableName)!.add(row.column_name as string);
    }

    const tables = getAllTables();
    const missingTables: string[] = [];
    const missingColumns: Array<{ table: string; column: string }> = [];

    for (const [exportName, table] of Object.entries(tables)) {
      const tableName = getTableName(table);
      const columns = getTableColumns(table);

      if (!dbColumnMap.has(tableName)) {
        missingTables.push(tableName);
        continue;
      }

      const dbCols = dbColumnMap.get(tableName)!;
      for (const [_colKey, colDef] of Object.entries(columns)) {
        const colName = (colDef as any).name as string;
        if (!dbCols.has(colName)) {
          missingColumns.push({ table: tableName, column: colName });
        }
      }
    }

    if (missingTables.length > 0) {
      logger.error(
        `SCHEMA DRIFT: ${missingTables.length} table(s) defined in schema but missing from database: ${missingTables.join(', ')}. Add a migration file in migrations/ (it runs on the next deploy). Never run db:push against production: it drops tables that aren't in the schema.`
      );
    }

    if (missingColumns.length > 0) {
      logger.error(
        `SCHEMA DRIFT: ${missingColumns.length} column(s) defined in schema but missing from database:`
      );
      for (const { table, column } of missingColumns) {
        logger.error(`  - ${table}.${column}`);
      }
      logger.error(
        'Add a migration file in migrations/ to create these columns (it runs on the next deploy). Never run db:push against production: it drops tables and data that aren\'t in the schema.'
      );
    }

    if (missingTables.length === 0 && missingColumns.length === 0) {
      logger.log('Schema drift check passed - database matches schema');
    }
  } catch (error) {
    // Don't block startup if the check itself fails
    logger.warn('Schema drift check could not complete:', error);
  }
}
