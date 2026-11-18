import { neon } from '@neondatabase/serverless';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@shared/schema';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { createSqlClient, getPgPool, isNeonDatabaseUrl } from './sql-client';
import { logger } from './utils/production-safe-logger';
import {
  getDatabaseUrl,
  getDatabaseBranch,
  isProduction,
  databaseInfo,
} from './db-url';

/**
 * DATABASE CONNECTION
 *
 * Uses centralized database URL configuration from server/db-url.ts.
 * All database URL selection logic is in one place.
 */

const databaseUrl = getDatabaseUrl();
const dbBranch = getDatabaseBranch();

if (!databaseUrl) {
  throw new Error(
    'Database URL not configured. Please set DEV_DATABASE_URL for development or DATABASE_URL for production in Replit Secrets.'
  );
}
const configuredDatabaseUrl: string = databaseUrl;

// Fix TypeScript union type issue by using a single concrete type
// This prevents "expression is not callable" errors when using db.select/insert/update/delete
type DB = NeonHttpDatabase<typeof schema>;

// Clear startup log showing environment AND database branch
logger.log(
  `🗄️ Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode, connected to ${dbBranch} database`
);

// Re-export databaseInfo for backward compatibility
export { databaseInfo };

/**
 * Creates an isolated HTTP client for callers that need request-specific fetch
 * behavior, such as cancellation. Normal application queries use `db` below.
 */
export function createDbWithFetchOptions(
  fetchOptions: Record<string, unknown>
): DB {
  if (!useNeonDriver) {
    // node-postgres has no fetch to abort; callers still enforce their own
    // timeout around the promise, so the shared pool-backed db is fine here.
    return db;
  }
  const client = neon(configuredDatabaseUrl, { fetchOptions });
  return drizzle(client, {
    schema,
    logger: false,
  }) as DB;
}

// Neon hosts (production) use the Neon HTTP driver. Anything else — e.g.
// Replit's built-in dev Postgres ("helium") — can't speak that protocol,
// so it gets a regular node-postgres pool. See server/sql-client.ts.
const useNeonDriver = isNeonDatabaseUrl(configuredDatabaseUrl);
logger.log(
  `🔌 Database driver: ${useNeonDriver ? 'Neon HTTP' : 'node-postgres'}`
);

const sqlClient = createSqlClient(configuredDatabaseUrl);
const pgDialect = new PgDialect();
const db: DB = useNeonDriver
  ? (drizzle(neon(configuredDatabaseUrl), { schema, logger: false }) as DB)
  : (drizzlePg(getPgPool(configuredDatabaseUrl), {
      schema,
      logger: false,
    }) as unknown as DB);

if (useNeonDriver) {
  // Preserve the legacy raw-query helper used by existing callers.
  (db as any).execute = async (query: any) => {
    return await (sqlClient as any)(query);
  };
} else {
  // node-postgres returns a QueryResult ({ rows, rowCount }). Some callers
  // read `.rows`, others treat the result as an array — support both.
  const pgExecute = (db as any).execute.bind(db);
  (db as any).execute = async (query: any) => {
    const result =
      typeof query === 'string'
        ? await getPgPool(configuredDatabaseUrl).query(query)
        : await pgExecute(query);
    const rows: any = [...result.rows];
    rows.rows = result.rows;
    rows.rowCount = result.rowCount;
    return rows;
  };
}

/**
 * Execute a Drizzle SQL expression through Neon's parameterized query API.
 * The Neon client does not accept Drizzle SQL objects directly.
 */
export async function executeRawSql<T extends Record<string, unknown>>(
  query: SQL
): Promise<T[]> {
  const compiled = pgDialect.sqlToQuery(query);
  return sqlClient(compiled.sql, compiled.params) as Promise<T[]>;
}

export { db };
