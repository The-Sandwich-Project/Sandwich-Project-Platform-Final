/**
 * The dev server applies migration files that arrive while it is running, so
 * the dev database can't fall behind production (which made Replit's publish
 * step offer to DROP production tables).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
import { watchForNewMigrationsInDev } from '../../server/dev-migration-watcher';

describe('watchForNewMigrationsInDev', () => {
  let dir: string;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    fs.writeFileSync(path.join(dir, '001_existing.sql'), 'SELECT 1;');
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    jest.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function tick(ms: number) {
    await jest.advanceTimersByTimeAsync(ms);
  }

  it('runs migrations when a new .sql file appears, and only then', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    stop = watchForNewMigrationsInDev({ dir, run, intervalMs: 1000, isProduction: false });
    expect(stop).toBeDefined();

    await tick(3000);
    expect(run).not.toHaveBeenCalled(); // nothing new yet

    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a migration');
    await tick(1000);
    expect(run).not.toHaveBeenCalled(); // non-.sql files ignored

    fs.writeFileSync(path.join(dir, '002_new_table.sql'), 'CREATE TABLE IF NOT EXISTS x (id int);');
    await tick(1000);
    expect(run).toHaveBeenCalledTimes(1);

    await tick(3000);
    expect(run).toHaveBeenCalledTimes(1); // same file isn't applied twice
  });

  it('does nothing in production', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    stop = watchForNewMigrationsInDev({ dir, run, intervalMs: 1000, isProduction: true });
    expect(stop).toBeUndefined();

    fs.writeFileSync(path.join(dir, '002_new_table.sql'), 'SELECT 1;');
    await tick(5000);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps watching after a failed run', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    stop = watchForNewMigrationsInDev({ dir, run, intervalMs: 1000, isProduction: false });

    fs.writeFileSync(path.join(dir, '002_a.sql'), 'SELECT 1;');
    await tick(1000);
    expect(run).toHaveBeenCalledTimes(1);

    // The failed file is retried on the next check
    await tick(1000);
    expect(run).toHaveBeenCalledTimes(2);

    fs.writeFileSync(path.join(dir, '003_b.sql'), 'SELECT 1;');
    await tick(1000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
