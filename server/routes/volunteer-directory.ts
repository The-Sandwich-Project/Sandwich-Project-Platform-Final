/**
 * GET /api/volunteer-directory: the Volunteers directory from `people`
 * (people/places rebuild, step 7c-1). Same access as the old Volunteers
 * Directory (VOLUNTEERS_VIEW); notes only for the roles that can see
 * volunteer notes today (see server/routes/volunteers.ts).
 */
import { Router } from 'express';
import { requirePermission } from '../middleware/auth';
import { PERMISSIONS } from '@shared/auth-utils';
import { logger } from '../utils/production-safe-logger';
import { listDirectoryVolunteers } from '../services/people/volunteer-directory';

const NOTES_ROLES = new Set(['super_admin', 'admin', 'admin_coordinator', 'admin_viewer']);

export function createVolunteerDirectoryRouter() {
  const router = Router();
  router.get('/', requirePermission(PERMISSIONS.VOLUNTEERS_VIEW), async (req: any, res) => {
    try {
      const role = (req.user ?? req.session?.user)?.role;
      res.json(await listDirectoryVolunteers({ includeNotes: !!role && NOTES_ROLES.has(role) }));
    } catch (error) {
      logger.error('Volunteer directory error:', error);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });
  return router;
}
