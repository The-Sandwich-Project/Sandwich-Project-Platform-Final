/**
 * DEVELOPMENT ONLY: apply migration files that arrive while the dev server is
 * already running (e.g. after a git pull), without needing a restart.
 *
 * Why: migrations otherwise only run at server start (server/migrate.ts via
 * initializeDatabase). Production restarts on every deploy, but the dev server
 * can run for days, so new files reached production and not the dev database.
 * Replit's publish screen makes production match dev, so it then offered to
 * DROP those new tables from production.
 *
 * Checks the migrations folder every `intervalMs`. Only when a new .sql file
 * has appeared does it call `run` (the normal migration runner, which skips
 * anything already recorded in _migrations). Never runs in production.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/production-safe-logger';

function listMigrationFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch {
    return [];
  }
}

export function watchForNewMigrationsInDev(options: {
  run: () => Promise<void>;
  intervalMs?: number;
  dir?: string;
  isProduction?: boolean;
}): (() => void) | undefined {
  const isProd = options.isProduction ?? process.env.NODE_ENV === 'production';
  if (isProd) return undefined;

  // The dev server runs from the repo root (npm run dev).
  const dir = options.dir ?? path.join(process.cwd(), 'migrations');
  const intervalMs = options.intervalMs ?? 60_000;

  const known = new Set(listMigrationFiles(dir));
  let running = false;

  const timer = setInterval(async () => {
    if (running) return;
    const added = listMigrationFiles(dir).filter((f) => !known.has(f));
    if (added.length === 0) return;

    running = true;
    try {
      logger.log(
        `🆕 New migration file(s) detected: ${added.join(', ')}. Applying to the development database...`
      );
      await options.run();
      added.forEach((f) => known.add(f));
    } catch (error) {
      // Leave the files unmarked so the next check tries again.
      logger.error('❌ Applying new migrations in development failed:', error);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
