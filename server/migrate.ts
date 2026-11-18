import { createSqlClient } from './sql-client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/production-safe-logger';
import { getDatabaseUrl, getDatabaseBranch } from './db-url';

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Neon's HTTP driver cannot execute multiple commands in a single call
// ("cannot insert multiple commands into a prepared statement"). Migration
// files often contain several statements, so we split them into individual
// statements before executing. This splitter respects single-quoted strings
// and dollar-quoted blocks so semicolons inside them are not treated as
// statement separators.
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingleQuote = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const char = sql[i];
    const rest = sql.slice(i);

    // Inside a dollar-quoted block ($$ ... $$ or $tag$ ... $tag$)
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += char;
      i++;
      continue;
    }

    // Inside a single-quoted string literal
    if (inSingleQuote) {
      if (char === "'") {
        // Handle escaped quote ('')
        if (sql[i + 1] === "'") {
          current += "''";
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      current += char;
      i++;
      continue;
    }

    // Line comment -- ... (skip to end of line)
    if (char === '-' && sql[i + 1] === '-') {
      const newlineIdx = sql.indexOf('\n', i);
      if (newlineIdx === -1) {
        i = sql.length;
      } else {
        current += '\n';
        i = newlineIdx + 1;
      }
      continue;
    }

    // Block comment /* ... */
    if (char === '/' && sql[i + 1] === '*') {
      const endIdx = sql.indexOf('*/', i + 2);
      i = endIdx === -1 ? sql.length : endIdx + 2;
      continue;
    }

    // Start of dollar-quoted block
    if (char === '$') {
      const match = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      i++;
      continue;
    }

    // Statement terminator at top level
    if (char === ';') {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export async function runMigrationsAutomatically() {
  const DATABASE_URL = getDatabaseUrl();

  if (!DATABASE_URL) {
    logger.log('⚠️  No database URL set, skipping migrations');
    return;
  }

  logger.log('🔄 Checking for pending database migrations...');

  // Neon HTTP on Neon hosts, node-postgres elsewhere (see sql-client.ts)
  const sql = createSqlClient(DATABASE_URL);

  try {
    // Create migrations tracking table if it doesn't exist
    await sql(`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get list of migration files from the migrations directory
    const migrationsDir = path.join(__dirname, '..', 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      logger.log('⚠️  No migrations directory found, skipping migrations');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Sort to ensure migrations run in order

    let executedCount = 0;
    let failedCount = 0;

    for (const file of files) {
      // Check if migration has already been executed
      const result = await sql`
        SELECT * FROM "_migrations" WHERE name = ${file}
      `;

      if (result.length > 0) {
        continue; // Skip already executed migrations
      }

      // Read and execute the migration. Each file is isolated in its own
      // try/catch so a single failing migration (e.g. a pre-existing broken
      // file) cannot halt the entire chain and silently leave the database
      // drifting from shared/schema.ts. Note: Neon's HTTP driver has no
      // transaction support, so a mid-file failure may apply some statements;
      // migrations should therefore be written idempotently (IF [NOT] EXISTS).
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

      logger.log(`📝 Executing migration: ${file}...`);

      // Migration files may contain multiple statements (optionally separated
      // by the drizzle "--> statement-breakpoint" marker). Neon's HTTP driver
      // only accepts one command per call, so split into individual statements.
      const normalizedSQL = migrationSQL.split('--> statement-breakpoint').join('\n');
      const statements = splitSqlStatements(normalizedSQL);

      try {
        for (let idx = 0; idx < statements.length; idx++) {
          try {
            await sql(statements[idx]);
          } catch (statementError) {
            const snippet = statements[idx].slice(0, 200);
            logger.error(
              `❌ Migration ${file} failed at statement ${idx + 1}/${statements.length}: ${snippet}`,
              statementError,
            );
            throw statementError;
          }
        }

        // Mark migration as executed (only after all statements succeed)
        await sql`
          INSERT INTO "_migrations" (name) VALUES (${file})
        `;

        logger.log(`✅ Migration ${file} completed`);
        executedCount++;
      } catch (fileError) {
        // Isolate the failure to this file and continue with the rest so a
        // single broken migration does not block later ones.
        failedCount++;
        logger.error(`❌ Skipping migration ${file} after failure:`, fileError);
      }
    }

    if (failedCount > 0) {
      logger.error(
        `⚠️  Migrations completed with ${failedCount} failed file(s); ${executedCount} applied. Database may not match shared/schema.ts.`,
      );
    } else if (executedCount > 0) {
      logger.log(`✅ Applied ${executedCount} database migration(s)`);
    } else {
      logger.log('✅ All migrations already applied');
    }
  } catch (error) {
    logger.error('❌ Migration runner failed:', error);
    // Don't throw - allow app to continue (migrations might fail in dev environments)
  }
}
