import { Router, Response } from 'express';
import { db } from '../db';
import { userEmailTemplates, emailLogs, eventRequests, users, updateUserEmailTemplateSchema } from '@shared/schema';
import { eq, desc, isNull } from 'drizzle-orm';

import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { logger } from '../utils/production-safe-logger';
import { sendEmail } from '../sendgrid';
import { buildUserSender } from '../utils/user-sender';
import type { AuthenticatedRequest } from '../types/express';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Default templates used when user has not customized their own
const DEFAULT_TEMPLATES = {
  new_org: {
    subject: 'Welcome to The Sandwich Project - Your Event Toolkit + Next Steps',
    body: `Hi {{contact_name}},

Thank you so much for reaching out to The Sandwich Project! We're thrilled that {{group_name}} is interested in hosting a sandwich-making event.

I'm {{tsp_contact_name}}, and I'll be your point of contact as we get your event set up.

Here's your Sandwich-Making Event Toolkit to help you prepare:
{{toolkit_link}}

Your requested event date is {{event_date}}. I'd love to chat briefly to go over logistics and answer any questions. What works best for a quick call?

Looking forward to working with you!

Best,
{{tsp_contact_name}}
The Sandwich Project`,
  },
  returning_contact: {
    subject: 'Great to Hear from {{group_name}} Again!',
    body: `Hi {{contact_name}},

So great to hear from you again! We always love working with {{group_name}}.

I'm {{tsp_contact_name}}, and I'll be coordinating your upcoming event.

Just in case you need it, here's the toolkit link for reference:
{{toolkit_link}}

Your requested date is {{event_date}}. Shall we set up a quick call to go over the details?

Talk soon!

Best,
{{tsp_contact_name}}
The Sandwich Project`,
  },
};

// Merge variable processing - replaces {{var}} placeholders with actual values
function processMergeVariables(
  text: string,
  variables: Record<string, string>
): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value);
  }
  return result;
}

/**
 * User Email Templates Router
 * Mounted at /api/user/email-templates
 * Handles CRUD for per-user template customization
 */
export function createUserEmailTemplatesRouter(): Router {
  const router = Router();

  // GET /api/user/email-templates - Returns current user's saved templates (or defaults)
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const [existing] = await db
        .select()
        .from(userEmailTemplates)
        .where(eq(userEmailTemplates.userId, user.id))
        .limit(1);

      const templates = {
        newOrgSubject: existing?.newOrgSubject ?? DEFAULT_TEMPLATES.new_org.subject,
        newOrgBody: existing?.newOrgBody ?? DEFAULT_TEMPLATES.new_org.body,
        returningContactSubject: existing?.returningContactSubject ?? DEFAULT_TEMPLATES.returning_contact.subject,
        returningContactBody: existing?.returningContactBody ?? DEFAULT_TEMPLATES.returning_contact.body,
        updatedAt: existing?.updatedAt ?? null,
        hasCustomized: !!existing,
      };

      res.json(templates);
    } catch (error) {
      logger.error('Failed to fetch user email templates:', error);
      res.status(500).json({ error: 'Failed to fetch email templates' });
    }
  });

  // GET /api/user/email-templates/defaults - Returns default templates (for reset)
  router.get('/defaults', async (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      newOrgSubject: DEFAULT_TEMPLATES.new_org.subject,
      newOrgBody: DEFAULT_TEMPLATES.new_org.body,
      returningContactSubject: DEFAULT_TEMPLATES.returning_contact.subject,
      returningContactBody: DEFAULT_TEMPLATES.returning_contact.body,
    });
  });

  // PUT /api/user/email-templates - Saves/updates both templates
  router.put('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const parseResult = updateUserEmailTemplateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid template data', details: parseResult.error.issues });
      }
      const { newOrgSubject, newOrgBody, returningContactSubject, returningContactBody } = parseResult.data;

      const [existing] = await db
        .select()
        .from(userEmailTemplates)
        .where(eq(userEmailTemplates.userId, user.id))
        .limit(1);

      let result;
      if (existing) {
        [result] = await db
          .update(userEmailTemplates)
          .set({
            newOrgSubject: newOrgSubject ?? null,
            newOrgBody: newOrgBody ?? null,
            returningContactSubject: returningContactSubject ?? null,
            returningContactBody: returningContactBody ?? null,
            updatedAt: new Date(),
          })
          .where(eq(userEmailTemplates.userId, user.id))
          .returning();
      } else {
        [result] = await db
          .insert(userEmailTemplates)
          .values({
            userId: user.id,
            newOrgSubject: newOrgSubject ?? null,
            newOrgBody: newOrgBody ?? null,
            returningContactSubject: returningContactSubject ?? null,
            returningContactBody: returningContactBody ?? null,
          })
          .returning();
      }

      res.json(result);
    } catch (error) {
      logger.error('Failed to save user email templates:', error);
      res.status(500).json({ error: 'Failed to save email templates' });
    }
  });

  // POST /api/user/email-templates/preview - Preview a template with sample merge data
  router.post('/preview', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { subject, body } = req.body;

      if (!subject && !body) {
        return res.status(400).json({ error: 'Subject or body required for preview' });
      }

      const sampleVars: Record<string, string> = {
        contact_name: 'Jane Smith',
        group_name: 'Springfield Elementary PTA',
        event_date: 'Saturday, April 12, 2025',
        toolkit_link: 'https://nicunursekatie.github.io/tsp-toolkit/',
        tsp_contact_name: `${user.firstName} ${user.lastName}`.trim() || 'TSP Team Member',
      };

      res.json({
        subject: subject ? processMergeVariables(subject, sampleVars) : null,
        body: body ? processMergeVariables(body, sampleVars) : null,
        sampleData: sampleVars,
      });
    } catch (error) {
      logger.error('Failed to preview template:', error);
      res.status(500).json({ error: 'Failed to preview template' });
    }
  });

  return router;
}

/**
 * Event Email Router
 * Mounted at /api/events
 * Handles sending template emails and viewing email logs per event
 */
export function createEventEmailRouter(): Router {
  const router = Router();

  // POST /api/events/:eventId/send-email - Send email for an event with merge variables
  router.post('/:eventId/send-email', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!hasPermission(user, PERMISSIONS.EVENT_REQUESTS_SEND_TOOLKIT)) {
        return res.status(403).json({ error: 'Insufficient permissions to send event emails' });
      }

      const eventId = parseInt(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const { subject, body, templateType } = req.body;

      if (!subject || !body) {
        return res.status(400).json({ error: 'Subject and body are required' });
      }

      // Fetch the event to get recipient info and merge variable data
      const [event] = await db
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, eventId))
        .limit(1);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const recipientEmail = event.email;
      if (!recipientEmail) {
        return res.status(400).json({ error: 'Event has no contact email address' });
      }

      // Get the sender's full profile for merge variables and replyTo
      const [senderUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const senderName = senderUser
        ? `${senderUser.firstName || ''} ${senderUser.lastName || ''}`.trim()
        : `${user.firstName} ${user.lastName}`.trim();
      const tspContactEmail = senderUser?.preferredEmail || senderUser?.email || user.email;

      // Build merge variables
      const contactName = `${event.firstName || ''} ${event.lastName || ''}`.trim() || 'there';
      const mergeVars: Record<string, string> = {
        contact_name: contactName,
        group_name: event.organizationName || 'your organization',
        event_date: event.desiredEventDate
          ? new Date(event.desiredEventDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : event.scheduledEventDate
          ? new Date(event.scheduledEventDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'TBD',
        toolkit_link: 'https://nicunursekatie.github.io/tsp-toolkit/',
        tsp_contact_name: senderName || 'The Sandwich Project Team',
      };

      // Process merge variables in the final subject/body
      const processedSubject = processMergeVariables(subject, mergeVars);
      const processedBody = processMergeVariables(body, mergeVars);

      // Escape HTML entities first to prevent XSS, then convert markdown to HTML
      const escapedBody = escapeHtml(processedBody);
      const htmlBody = escapedBody
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      // Import email footer
      const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');

      // From: the sender's own address when it's on our SendGrid-authenticated
      // domain, otherwise the org address (a verified sender) shown as
      // "<Name> via The Sandwich Project". See server/utils/user-sender.ts.
      const sender = buildUserSender(senderUser || user);

      // Build the SendGrid payload with replyTo and BCC
      const emailPayload: any = {
        emailStream: 'operational',
        to: recipientEmail,
        from: sender.from,
        replyTo: tspContactEmail,
        subject: processedSubject,
        text: `${processedBody}\n\n${EMAIL_FOOTER_TEXT}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="white-space: pre-wrap; line-height: 1.6;">
              ${htmlBody}
            </div>
            ${EMAIL_FOOTER_HTML}
          </div>
        `,
      };

      // BCC the sender so they get a copy (only if different from recipient)
      if (tspContactEmail && tspContactEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
        emailPayload.bcc = tspContactEmail;
      }

      // Send via SendGrid
      const sendResult = await sendEmail(emailPayload);

      if (!sendResult) {
        return res.status(500).json({ error: 'Failed to send email - check SendGrid configuration' });
      }

      // Log to email_logs table
      const [logEntry] = await db
        .insert(emailLogs)
        .values({
          eventId,
          sentBy: user.id,
          recipientEmail,
          subject: processedSubject,
          body: processedBody,
          templateType: templateType || null,
        })
        .returning();

      logger.log(`[Event Email] Email sent for event ${eventId} to ${recipientEmail} by ${user.email}`);

      res.json({
        success: true,
        message: 'Email sent successfully',
        emailLog: logEntry,
        sentTo: recipientEmail,
        sentAt: logEntry.sentAt,
        processedSubject,
        processedBody,
      });
    } catch (error) {
      logger.error('Failed to send event email:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });

  // GET /api/events/email-logs/orphaned - Returns email logs where the event was deleted (eventId set to null)
  router.get('/email-logs/orphaned', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!hasPermission(user, PERMISSIONS.EVENT_REQUESTS_VIEW)) {
        return res.status(403).json({ error: 'Insufficient permissions to view email logs' });
      }

      const logs = await db
        .select({
          id: emailLogs.id,
          eventId: emailLogs.eventId,
          sentAt: emailLogs.sentAt,
          sentBy: emailLogs.sentBy,
          recipientEmail: emailLogs.recipientEmail,
          subject: emailLogs.subject,
          body: emailLogs.body,
          templateType: emailLogs.templateType,
          senderFirstName: users.firstName,
          senderLastName: users.lastName,
          senderEmail: users.email,
        })
        .from(emailLogs)
        .leftJoin(users, eq(emailLogs.sentBy, users.id))
        .where(isNull(emailLogs.eventId))
        .orderBy(desc(emailLogs.sentAt));

      const formattedLogs = logs.map((log) => ({
        ...log,
        senderName: `${log.senderFirstName || ''} ${log.senderLastName || ''}`.trim() || log.senderEmail || 'Unknown',
      }));

      res.json(formattedLogs);
    } catch (error) {
      logger.error('Failed to fetch orphaned email logs:', error);
      res.status(500).json({ error: 'Failed to fetch orphaned email logs' });
    }
  });

  // GET /api/events/:eventId/email-logs - Returns all sent emails for an event
  router.get('/:eventId/email-logs', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!hasPermission(user, PERMISSIONS.EVENT_REQUESTS_VIEW)) {
        return res.status(403).json({ error: 'Insufficient permissions to view email logs' });
      }

      const eventId = parseInt(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const logs = await db
        .select({
          id: emailLogs.id,
          eventId: emailLogs.eventId,
          sentAt: emailLogs.sentAt,
          sentBy: emailLogs.sentBy,
          recipientEmail: emailLogs.recipientEmail,
          subject: emailLogs.subject,
          body: emailLogs.body,
          templateType: emailLogs.templateType,
          senderFirstName: users.firstName,
          senderLastName: users.lastName,
          senderEmail: users.email,
        })
        .from(emailLogs)
        .leftJoin(users, eq(emailLogs.sentBy, users.id))
        .where(eq(emailLogs.eventId, eventId))
        .orderBy(desc(emailLogs.sentAt));

      const formattedLogs = logs.map((log) => ({
        ...log,
        senderName: `${log.senderFirstName || ''} ${log.senderLastName || ''}`.trim() || log.senderEmail || 'Unknown',
      }));

      res.json(formattedLogs);
    } catch (error) {
      logger.error('Failed to fetch email logs:', error);
      res.status(500).json({ error: 'Failed to fetch email logs' });
    }
  });

  return router;
}

export default createUserEmailTemplatesRouter;
