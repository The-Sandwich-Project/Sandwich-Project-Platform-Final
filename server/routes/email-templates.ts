import { Router, Response } from 'express';
import { storage } from '../storage-wrapper';
import { updateEmailTemplateSectionSchema } from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { isAuthenticated } from '../auth';
import { logger } from '../middleware/logger';
import type { AuthenticatedRequest } from '../types/express';
import { db } from '../db';
import { emailTemplateSections } from '@shared/schema';
import { sql } from 'drizzle-orm';
import {
  TOOLKIT_EMAIL_SECTIONS,
  TOOLKIT_EMAIL_TEMPLATE_TYPE,
} from '@shared/toolkit-email-template';

/**
 * Make sure every toolkit email section has a row, so admins can edit it on
 * the Email Templates page. Labels, descriptions and default text follow
 * shared/toolkit-email-template.ts; a saved customization (current_content)
 * is never touched. Runs once per server process, on the first list request.
 */
let toolkitSectionsEnsured = false;
async function ensureToolkitEmailSections(): Promise<void> {
  if (toolkitSectionsEnsured) return;
  for (const section of TOOLKIT_EMAIL_SECTIONS) {
    await db
      .insert(emailTemplateSections)
      .values({
        templateType: TOOLKIT_EMAIL_TEMPLATE_TYPE,
        sectionKey: section.key,
        sectionLabel: section.label,
        defaultContent: section.content,
        description: section.description,
        placeholderHints: section.placeholderHints ?? null,
      })
      .onConflictDoUpdate({
        target: [emailTemplateSections.templateType, emailTemplateSections.sectionKey],
        set: {
          sectionLabel: sql`excluded.section_label`,
          defaultContent: sql`excluded.default_content`,
          description: sql`excluded.description`,
          placeholderHints: sql`excluded.placeholder_hints`,
        },
      });
  }
  toolkitSectionsEnsured = true;
}

export function createEmailTemplatesRouter(): Router {
  const router = Router();

  // GET /api/email-templates/sections - List all sections (optionally ?templateType=follow_up_email)
  router.get('/sections', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { templateType } = req.query;
      // Optional: a failure here (e.g. table not migrated yet) must not block
      // the list; the composer falls back to the built-in wording.
      try {
        await ensureToolkitEmailSections();
      } catch (ensureError) {
        logger.warn(
          `Could not ensure toolkit email template sections: ${(ensureError as Error)?.message ?? String(ensureError)}`
        );
      }
      const sections = await storage.getEmailTemplateSections(
        templateType ? String(templateType) : undefined
      );
      res.json(sections);
    } catch (error) {
      // Template sections are OPTIONAL customizations — every consumer (the
      // event email composer, etc.) falls back to hardcoded defaults when the
      // list is empty. ONLY the specific "table doesn't exist" case (unmigrated
      // environment) is swallowed into an empty list so the composer (and "Send
      // Toolkit") keep working and the console isn't flooded. Any OTHER failure
      // (DB outage, permission error, bug) still returns 500 so real
      // operational problems aren't silently masked.
      const code = (error as { code?: string })?.code;
      const isUndefinedTable =
        code === '42P01' ||
        /relation ".*" does not exist/i.test((error as Error)?.message || '');
      if (isUndefinedTable) {
        logger.warn('email_template_sections table unavailable, returning empty list:', error);
        return res.json([]);
      }
      logger.error('Failed to fetch email template sections:', error);
      res.status(500).json({ error: 'Failed to fetch email template sections' });
    }
  });

  // GET /api/email-templates/sections/:templateType/:sectionKey - Get specific section
  router.get('/sections/:templateType/:sectionKey', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { templateType, sectionKey } = req.params;
      const section = await storage.getEmailTemplateSection(templateType, sectionKey);
      
      if (!section) {
        return res.status(404).json({ error: 'Email template section not found' });
      }
      
      res.json(section);
    } catch (error) {
      logger.error('Failed to fetch email template section:', error);
      res.status(500).json({ error: 'Failed to fetch email template section' });
    }
  });

  // PATCH /api/email-templates/sections/:id - Update section (require admin auth)
  router.patch('/sections/:id', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check admin permission
      const isAdmin = user.role === 'admin' || 
                      user.role === 'admin_coordinator' || 
                      hasPermission(user, PERMISSIONS.ADMIN_ACCESS);
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required to update email template sections' });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid section ID' });
      }

      // Check if section exists
      const existingSection = await storage.getEmailTemplateSectionById(id);
      if (!existingSection) {
        return res.status(404).json({ error: 'Email template section not found' });
      }

      // Validate request body
      const parseResult = updateEmailTemplateSectionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: 'Invalid request body', 
          details: parseResult.error.issues 
        });
      }

      const updates = {
        ...parseResult.data,
        lastUpdatedBy: user.id,
      };

      const updatedSection = await storage.updateEmailTemplateSection(id, updates);
      res.json(updatedSection);
    } catch (error) {
      logger.error('Failed to update email template section:', error);
      res.status(500).json({ error: 'Failed to update email template section' });
    }
  });

  // POST /api/email-templates/sections/:id/reset - Reset section to default (require admin auth)
  router.post('/sections/:id/reset', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check admin permission
      const isAdmin = user.role === 'admin' || 
                      user.role === 'admin_coordinator' || 
                      hasPermission(user, PERMISSIONS.ADMIN_ACCESS);
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required to reset email template sections' });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid section ID' });
      }

      // Check if section exists
      const existingSection = await storage.getEmailTemplateSectionById(id);
      if (!existingSection) {
        return res.status(404).json({ error: 'Email template section not found' });
      }

      const resetSection = await storage.resetEmailTemplateSectionToDefault(id);
      res.json(resetSection);
    } catch (error) {
      logger.error('Failed to reset email template section:', error);
      res.status(500).json({ error: 'Failed to reset email template section' });
    }
  });

  return router;
}

export default createEmailTemplatesRouter;
