import { neon } from '@neondatabase/serverless';
import { Pool, type PoolConfig } from 'pg';

/**
 * DATABASE DRIVER SELECTION
 *
 * The app was built on Neon's HTTP driver, which only talks to Neon
 * endpoints (it POSTs to https://<host>/sql). The dev environment now uses
 * Replit's built-in Postgres (host "helium"), which is ordinary Postgres and
 * rejects those requests — every query failed with an empty NeonDbError and
 * the app silently fell back to in-memory storage.
 *
 * Rule: Neon hosts keep the Neon HTTP driver (production is unchanged);
 * anything else uses node-postgres over the normal wire protocol.
 */
export function isNeonDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.neon.tech') || host.endsWith('.neon.build');
  } catch {
    return false;
  }
}

const pools = new Map<string, Pool>();

/** One shared node-postgres pool per connection string. */
export function getPgPool(url: string, overrides: PoolConfig = {}): Pool {
  const existing = pools.get(url);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    ...overrides,
  });
  // Without a listener, an idle client dying (DB restart, network blip)
  // is an unhandled 'error' event that crashes the process.
  pool.on('error', (err) => {
    console.error('🔌 [pg pool] idle client error — pool will recover:', err.message);
  });
  pools.set(url, pool);
  return pool;
}

/**
 * The subset of Neon's `sql` client this codebase uses:
 *   sql`SELECT ... ${value}`   (tagged template, parameterized)
 *   sql('SELECT ... $1', [v])  (plain text + params)
 * Both resolve to an array of row objects.
 */
export type SqlClient = (
  stringsOrText: TemplateStringsArray | string,
  ...params: any[]
) => Promise<any[]>;

function createPgSqlClient(url: string): SqlClient {
  const pool = getPgPool(url);
  return async (stringsOrText, ...rest) => {
    let text: string;
    let values: unknown[];
    if (typeof stringsOrText === 'string') {
      text = stringsOrText;
      values = Array.isArray(rest[0]) ? rest[0] : [];
    } else {
      text = stringsOrText.reduce(
        (acc, part, i) => acc + part + (i < rest.length ? `$${i + 1}` : ''),
        ''
      );
      values = rest;
    }
    const result = await pool.query(text, values as any[]);
    return result.rows;
  };
}

/** Drop-in replacement for `neon(url)` that also works on plain Postgres. */
export function createSqlClient(url: string): SqlClient {
  if (isNeonDatabaseUrl(url)) {
    return neon(url) as unknown as SqlClient;
  }
  return createPgSqlClient(url);
}
