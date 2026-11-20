import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './server/db-url';

// Used by `npm run db:push` to sync shared/schema.ts directly to the database.
// Migration files are managed manually in migrations/ and run by server/migrate.ts.
//
// db:push makes the database match the schema file exactly: it DROPS tables
// that aren't in the schema (with their data), truncates tables to add unique
// constraints, and empties _migrations (so every migration re-runs on next
// boot). It's a dev-database convenience only. Refuse to point it at Neon
// (production) unless someone deliberately sets ALLOW_DB_PUSH_TO_NEON=yes.
const databaseUrl = getDatabaseUrl() || 'postgresql://placeholder';
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return '';
  }
})();
if (/\.neon\.(tech|build)$/.test(host) && process.env.ALLOW_DB_PUSH_TO_NEON !== 'yes') {
  throw new Error(
    `Refusing to run drizzle-kit against ${host}: that's a Neon (production) database. ` +
      'Schema changes reach production through migration files in migrations/, which run on deploy. ' +
      'See CLAUDE.md, "Schema rules".'
  );
}

export default defineConfig({
  schema: './shared/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});