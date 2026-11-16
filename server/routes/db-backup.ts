import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/auth';
import { logger } from '../utils/production-safe-logger';
import { isDbBackupRunning, runDatabaseBackup } from '../services/db-backup-service';

/**
 * Admin-only manual trigger for the weekly Google Drive database backup.
 * POST /api/admin/db-backup/run — runs a backup now and returns the result.
 * Backs up whichever branch this instance is connected to (dev runs are named
 * tsp-db-backup-dev-YYYY-MM-DD.tar.gz so they can't be mistaken for production).
 */
export function createDbBackupRouter() {
  const router = Router();

  router.post('/run', requireRole('admin', 'super_admin'), async (_req: Request, res: Response) => {
    if (isDbBackupRunning()) {
      return res.status(409).json({ success: false, error: 'A backup is already running' });
    }
    try {
      const result = await runDatabaseBackup('manual');
      res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      logger.error('Error running manual database backup:', error);
      res.status(500).json({ success: false, error: 'Failed to run database backup' });
    }
  });

  return router;
}
