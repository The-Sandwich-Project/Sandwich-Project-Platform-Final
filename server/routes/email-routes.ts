import { Router } from 'express';
import type { RouterDependencies } from '../types';
import { emailService } from '../services/email-service';
import { db } from '../db';
import { kudosTracking, users, emailMessages } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { getLinkedUserIds } from '../lib/linked-accounts';
import { FROM_EMAIL } from '../config/organization';

export function createEmailRouter(deps: RouterDependencies) {
  const router = Router();
  const { storage, isAuthenticated } = deps;

  // Get emails by folder with optional threading
  router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const folder = (req.query.folder as string) || 'inbox';
    const threaded = req.query.threaded === 'true';
    logger.log(
      `[Email API] Getting emails for folder: ${folder}, user: ${user.email}, threaded: ${threaded}`
    );

    // Threading removed - always return flat list
    {
      // Return flat list of emails
      const emails = await emailService.getEmailsByFolder(user.id, folder);

      // Format emails for Gmail interface
      const formattedEmails = emails.map((email) => ({
        id: email.id,
        senderId: email.senderId,
        senderName: email.senderName,
        senderEmail: email.senderEmail,
        recipientId: email.recipientId,
        recipientName: email.recipientName,
        recipientEmail: email.recipientEmail,
        content: email.content,
        subject: email.subject,
        createdAt: email.createdAt,
        threadId: email.id, // No threading - use email ID
        isRead: email.isRead,
        isStarred: email.isStarred,
        folder: folder,
        committee: email.contextType || 'email',
        // Include parent message data for replies
        parentMessageId: email.parentMessageId,
        parentMessage: email.parentMessage,
      }));

      logger.log(
        `[Email API] Found ${formattedEmails.length} emails in ${folder}`
      );
      res.json(formattedEmails);
    }
  } catch (error) {
    logger.error('[Email API] Error fetching emails:', error);
    res.status(500).json({ message: 'Failed to fetch emails' });
  }
});

// Send new email
  router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const {
      recipientId,
      recipientName,
      recipientEmail,
      subject,
      content,
      isDraft,
      parentMessageId,
      contextType,
      contextId,
      contextTitle,
      attachments,
      includeSchedulingLink,
      requestPhoneCall,
    } = req.body;

    // Subject is required, but content can be empty if there are attachments
    if (!subject) {
      return res
        .status(400)
        .json({ message: 'Subject is required' });
    }

    // Content is required unless there are attachments
    if (!content && (!attachments || attachments.length === 0)) {
      return res
        .status(400)
        .json({ message: 'Content or attachments required' });
    }

    if (!isDraft && (!recipientId || !recipientName || !recipientEmail)) {
      return res
        .status(400)
        .json({ message: 'Recipient information is required' });
    }

    logger.log(
      `[Email API] Sending email from ${user.email} to ${recipientEmail}`
    );

    // Get user's complete profile data including preferred email and phone number
    const fullUserData = await storage.getUser(user.id);
    
    const newEmail = await emailService.sendEmail({
      senderId: user.id,
      senderName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      senderEmail: user.email,
      senderPreferredEmail: fullUserData?.preferredEmail,
      senderPhoneNumber: fullUserData?.phoneNumber,
      recipientId: recipientId || user.id, // For drafts
      recipientName: recipientName || 'Draft',
      recipientEmail: recipientEmail || user.email,
      subject,
      content: content || '', // Default to empty string for attachment-only messages
      parentMessageId: parentMessageId || null, // Reference to parent message for threading
      contextType: contextType || null,
      contextId: contextId || null,
      contextTitle: contextTitle || null,
      attachments: attachments || [],
      includeSchedulingLink: includeSchedulingLink || false,
      requestPhoneCall: requestPhoneCall || false,
      isDraft: isDraft || false,
    });

    res.status(201).json(newEmail);
  } catch (error) {
    logger.error('[Email API] Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});

// Update email status (star, archive, trash, mark read)
  router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const emailId = parseInt(req.params.id);
    const updates = req.body;

    logger.log(`[Email API] Updating email ${emailId} status:`, updates);

    // Check if this is a kudos message by looking up the messageId in kudosTracking
    // Kudos returned to client have id = messages.id (the messageId), not kudosTracking.id
    const kudoCheck = await db
      .select({
        id: kudosTracking.id,
        messageId: kudosTracking.messageId,
        recipientId: kudosTracking.recipientId,
      })
      .from(kudosTracking)
      .where(eq(kudosTracking.messageId, emailId))
      .limit(1);

    let actualEmailId = emailId;
    let isKudos = false;

    if (kudoCheck.length > 0) {
      // This ID corresponds to a kudos message
      isKudos = true;
      actualEmailId = kudoCheck[0].messageId;
      logger.log(
        `[Email API] ID ${emailId} is a kudos message (kudosTracking.id=${kudoCheck[0].id})`
      );

      // Verify user (or a linked account) is the recipient of this kudo
      const kudoLinkedIds = (await getLinkedUserIds(String(user.id))).map(String);
      if (!kudoLinkedIds.includes(String(kudoCheck[0].recipientId))) {
        return res
          .status(403)
          .json({ message: 'Not authorized to update this kudo' });
      }
      
      // For kudos, use the messaging service to mark as read (kudos are in messages table, not emailMessages)
      if (updates.isRead) {
        const { messagingService } = await import('../services/messaging-service');
        // Ensure userId is string as messageRecipients.recipientId is a text field
        const success = await messagingService.markMessageRead(String(user.id), actualEmailId);
        if (!success) {
          return res
            .status(404)
            .json({ message: 'Kudos not found or already read' });
        }
        return res.json({ success: true });
      }
      // For other updates on kudos, we don't support them
      return res.json({ success: true });
    }

    // For regular emails, use the email service
    const success = await emailService.updateEmailStatus(
      actualEmailId,
      user.id,
      updates
    );

    if (!success) {
      return res
        .status(404)
        .json({ message: 'Email not found or access denied' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('[Email API] Error updating email:', error);
    res.status(500).json({ message: 'Failed to update email' });
  }
});

// Delete email
  router.delete('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const emailId = parseInt(req.params.id);
    logger.log(`[Email API] Deleting email ${emailId} for user ${user.email}`);

    const success = await emailService.deleteEmail(emailId, user.id);

    if (!success) {
      return res
        .status(404)
        .json({ message: 'Email not found or access denied' });
    }

    res.status(204).send();
  } catch (error) {
    logger.error('[Email API] Error deleting email:', error);
    res.status(500).json({ message: 'Failed to delete email' });
  }
});

// Get full thread for an email (all messages in conversation)
  router.get('/:id/thread', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const emailId = parseInt(req.params.id);
      if (isNaN(emailId)) {
        return res.status(400).json({ message: 'Invalid email ID' });
      }

      logger.log(`[Email API] Getting thread for email ${emailId}, user: ${user.email}`);

      const threadMessages = await emailService.getEmailThread(emailId, user.id);

      // Format messages for client
      const formattedThread = threadMessages.map((email) => ({
        id: email.id,
        senderId: email.senderId,
        senderName: email.senderName,
        senderEmail: email.senderEmail,
        recipientId: email.recipientId,
        recipientName: email.recipientName,
        recipientEmail: email.recipientEmail,
        content: email.content,
        subject: email.subject,
        createdAt: email.createdAt,
        isRead: email.isRead,
        readAt: email.readAt,
        parentMessageId: email.parentMessageId,
        attachments: email.attachments,
      }));

      logger.log(`[Email API] Found ${formattedThread.length} messages in thread`);
      res.json(formattedThread);
    } catch (error) {
      logger.error('[Email API] Error fetching thread:', error);
      res.status(500).json({ message: 'Failed to fetch thread' });
    }
  });

// Get unread email count
  router.get('/unread-count', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const count = await emailService.getUnreadEmailCount(user.id);
    res.json({ count });
  } catch (error) {
    logger.error('[Email API] Error getting unread count:', error);
    res.status(500).json({ message: 'Failed to get unread count' });
  }
});

// Search emails
  router.get('/search', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const searchTerm = req.query.q as string;
    if (!searchTerm) {
      return res.status(400).json({ message: 'Search term is required' });
    }

    logger.log(`[Email API] Searching emails for "${searchTerm}"`);

    const emails = await emailService.searchEmails(user.id, searchTerm);
    res.json(emails);
  } catch (error) {
    logger.error('[Email API] Error searching emails:', error);
    res.status(500).json({ message: 'Failed to search emails' });
  }
});

// Get drafts for a specific event request
  router.get('/event/:eventRequestId/drafts', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { eventRequestId } = req.params;
    
    if (!eventRequestId) {
      return res.status(400).json({ message: 'Event request ID is required' });
    }

    logger.log(`[Email API] Getting drafts for event request ${eventRequestId}, user: ${user.email}`);

    const drafts = await emailService.getDraftsByContext(
      user.id,
      'event_request',
      eventRequestId
    );

    // Format drafts for the email composer
    const formattedDrafts = drafts.map((draft) => ({
      id: draft.id,
      subject: draft.subject,
      content: draft.content,
      recipientName: draft.recipientName,
      recipientEmail: draft.recipientEmail,
      contextType: draft.contextType,
      contextId: draft.contextId,
      contextTitle: draft.contextTitle,
      attachments: draft.attachments || [],
      includeSchedulingLink: draft.includeSchedulingLink || false,
      requestPhoneCall: draft.requestPhoneCall || false,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }));

    logger.log(`[Email API] Found ${formattedDrafts.length} drafts for event request ${eventRequestId}`);
    res.json(formattedDrafts);
  } catch (error) {
    logger.error('[Email API] Error fetching event drafts:', error);
    res.status(500).json({ message: 'Failed to fetch event drafts' });
  }
});

// Get kudos for current user - integrates with messaging system
  router.get('/kudos', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    logger.log(`[Email API] Getting kudos for user: ${user.email}`);

    // Import here to avoid circular dependency
    const { messagingService } = await import('../services/messaging-service');
    const kudos = await messagingService.getReceivedKudos(user.id);

    // Format kudos for Gmail interface
    const formattedKudos = kudos.map((kudo: any) => ({
      id: kudo.id,
      sender: kudo.sender,
      senderName: kudo.senderName,
      message: kudo.message,
      content: kudo.message,
      projectTitle: kudo.projectTitle,
      entityName: kudo.entityName,
      contextType: kudo.contextType,
      contextId: kudo.contextId,
      createdAt: kudo.createdAt,
      sentAt: kudo.sentAt,
      isRead: kudo.isRead,
      readAt: kudo.readAt,
    }));

    logger.log(`[Email API] Found ${formattedKudos.length} kudos`);
    res.json(formattedKudos);
  } catch (error) {
    logger.error('[Email API] Error fetching kudos:', error);
    res.status(500).json({ message: 'Failed to fetch kudos' });
  }
});

// Mark message as read - works for both emails and kudos
  router.post('/:messageId/read', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }

    logger.log(
      `[Email API] Marking message ${messageId} as read for user: ${user.email}`
    );

    // Check if this is a kudos message - first try matching by messageId (what client sends)
    // The client receives kudos with id = messages.id from getReceivedKudos
    let kudoCheck = await db
      .select({
        kudosId: kudosTracking.id,
        messageId: kudosTracking.messageId,
        recipientId: kudosTracking.recipientId,
      })
      .from(kudosTracking)
      .where(eq(kudosTracking.messageId, messageId))
      .limit(1);

    // If not found by messageId, try by kudosTracking.id (legacy/fallback)
    if (kudoCheck.length === 0) {
      kudoCheck = await db
        .select({
          kudosId: kudosTracking.id,
          messageId: kudosTracking.messageId,
          recipientId: kudosTracking.recipientId,
        })
        .from(kudosTracking)
        .where(eq(kudosTracking.id, messageId))
        .limit(1);
    }

    let actualMessageId = messageId;

    if (kudoCheck.length > 0) {
      // This is a kudos message, get the actual message ID
      actualMessageId = kudoCheck[0].messageId;
      logger.log(
        `[Email API] Found kudos (kudosTracking.id=${kudoCheck[0].kudosId}) for message ${actualMessageId}`
      );

      // Verify user (or a linked account) is the recipient of this kudo
      const kudoReadLinkedIds = (await getLinkedUserIds(String(user.id))).map(String);
      if (!kudoReadLinkedIds.includes(String(kudoCheck[0].recipientId))) {
        return res
          .status(403)
          .json({ message: 'Not authorized to mark this kudo as read' });
      }
    }

    if (!actualMessageId) {
      return res
        .status(404)
        .json({ message: 'No corresponding message found for this kudo' });
    }

    // Import messaging service dynamically to avoid circular dependency
    const { messagingService } = await import('../services/messaging-service');

    logger.log(`[Email API] Calling markMessageRead with userId=${String(user.id)}, messageId=${actualMessageId}`);

    // Mark the message as read in messageRecipients
    // Use string userId to match messageRecipients.recipientId type
    const success = await messagingService.markMessageRead(
      String(user.id),
      actualMessageId
    );

    logger.log(`[Email API] markMessageRead returned: ${success}`);

    if (!success) {
      return res
        .status(404)
        .json({ message: 'Message not found or already read' });
    }

    res.json({ success: true, message: 'Message marked as read' });
  } catch (error) {
    logger.error('[Email API] Error marking message as read:', error);
    res.status(500).json({ message: 'Failed to mark message as read' });
  }
});

// Event-specific email endpoint with attachment support
  router.post('/event', isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const {
      eventRequestId,
      recipientEmail,
      recipientName,
      subject,
      content,
      isDraft,
      attachments = [],
      contextType,
      contextId,
      contextTitle,
    } = req.body;

    // Subject is required, but content can be empty if there are attachments
    if (!subject) {
      return res
        .status(400)
        .json({ message: 'Subject is required' });
    }

    // Content is required unless there are attachments
    if (!content && (!attachments || attachments.length === 0)) {
      return res
        .status(400)
        .json({ message: 'Content or attachments required' });
    }

    if (!isDraft && !recipientEmail) {
      return res.status(400).json({ message: 'Recipient email is required' });
    }

    logger.log(
      `[Event Email API] Sending event email from ${user.email} to ${recipientEmail}`
    );
    if (attachments.length > 0) {
      logger.log(
        `[Event Email API] Attachments payload received: ${attachments
          .map(att =>
            typeof att === 'object' ? JSON.stringify(att) : String(att)
          )
          .join(', ')}`
      );
    }

    // Get user's complete profile data
    const fullUserData = await storage.getUser(user.id);
    const senderName = `${fullUserData?.firstName} ${fullUserData?.lastName}`.trim() || user.email;
    const replyToEmail = fullUserData?.preferredEmail || user.email;

    // For drafts, save to internal email system
    if (isDraft) {
      const newEmail = await emailService.sendEmail({
        senderId: user.id,
        senderName,
        senderEmail: user.email,
        senderPreferredEmail: fullUserData?.preferredEmail,
        senderPhoneNumber: fullUserData?.phoneNumber,
        recipientId: 'external',
        recipientName: recipientName || 'Event Contact',
        recipientEmail: recipientEmail || user.email,
        subject,
        content: content || '', // Default to empty string for attachment-only messages
        isDraft: true,
        contextType: contextType || 'event_request',
        contextId: contextId || eventRequestId?.toString(),
        contextTitle: contextTitle || `Event Communication`,
        attachments,
      });

      logger.log('[Event Email API] Draft saved successfully');
      return res.json({
        success: true,
        message: 'Draft saved successfully',
        emailId: newEmail.id,
      });
    }

    // For actual emails, send directly via SendGrid without wrapper
    const { sendEmailWithResult } = await import('../sendgrid');
    const { documents } = await import('@shared/schema');
    const { inArray } = await import('drizzle-orm');
    const path = await import('path');

    // Check if content is already full HTML (starts with <!DOCTYPE html>)
    const isFullHtml = content.trim().startsWith('<!DOCTYPE html>');
    
    // Convert content line breaks and markdown only if not already HTML
    let htmlContent;
    let textContent;
    
    if (isFullHtml) {
      // Content is already formatted HTML - use as-is
      htmlContent = content;
      // Extract text from HTML for plain text version (simple extraction)
      textContent = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      // Convert markdown-style content to HTML
      htmlContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      textContent = content;
    }

    // Process attachments - fetch document metadata if attachments are document IDs
    let processedAttachments: (string | { filePath: string; originalName?: string })[] = [];
    if (attachments && attachments.length > 0) {
      const numericIds = attachments
        .map((attachment) => {
          if (typeof attachment === 'number') {
            return attachment;
          }

          if (typeof attachment === 'string') {
            const trimmed = attachment.trim();
            return /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
          }

          return NaN;
        })
        .filter((id): id is number => !isNaN(id));

      const documentMap = new Map<number, { filePath: string; originalName?: string }>();

      if (numericIds.length > 0) {
        const docs = await db
          .select({
            id: documents.id,
            filePath: documents.filePath,
            originalName: documents.originalName,
          })
          .from(documents)
          .where(inArray(documents.id, numericIds));

        docs.forEach((doc) => {
          documentMap.set(doc.id, {
            filePath: doc.filePath,
            originalName: doc.originalName || undefined,
          });
        });
      }

      for (const attachment of attachments) {
        if (typeof attachment === 'number') {
          const docMeta = documentMap.get(attachment);
          if (docMeta) {
            processedAttachments.push(docMeta);
          } else {
            logger.warn(
              `[Event Email API] Attachment document ID ${attachment} not found`
            );
          }
          continue;
        }

        if (typeof attachment === 'string') {
          const trimmed = attachment.trim();

          if (/^\d+$/.test(trimmed)) {
            const docId = parseInt(trimmed, 10);
            const docMeta = documentMap.get(docId);
            if (docMeta) {
              processedAttachments.push(docMeta);
            } else {
              logger.warn(
                `[Event Email API] Attachment document ID ${docId} not found`
              );
            }
            continue;
          }

          // Check if it's a document hash pattern (uploads/documents/[hash])
          if (trimmed.startsWith('uploads/documents/')) {
            const hash = trimmed.split('/').pop();
            if (hash) {
              // Map document hashes to attached_assets files
              const hashToFileMap: Record<string, { file: string; name: string }> = {
                '015b0f68ddb511633e7696caab59bfa7': {
                  file: 'attached_assets/20260506-TSP-Food+Safety+Volunteers.pdf',
                  name: 'Food Safety Guide for Volunteers.pdf'
                },
                '3e375509b08b20265abdfa6afe632982': {
                  file: 'attached_assets/PBJ Sandwich Making 2 101 11012026.pdf',
                  name: 'PBJ Sandwich Making 101.pdf'
                },
                '56687eca96492549ba09d1bda0e5e6e0': {
                  file: 'attached_assets/Deli Sandwich Making 101 03172026.pdf',
                  name: 'Deli Sandwich Making 101.pdf'
                },
                '075839360400adce8b79a6a58a96dcfc': {
                  file: 'attached_assets/Deli Labels_1756865384146.pdf',
                  name: 'Deli Sandwich Labels.pdf'
                },
                'a9458021b23fca8d76e674597c691876': {
                  file: 'attached_assets/PBJ Labels_1756865384146.pdf',
                  name: 'PBJ Sandwich Labels.pdf'
                }
              };
              
              const fileInfo = hashToFileMap[hash];
              if (fileInfo) {
                processedAttachments.push({
                  filePath: path.join(process.cwd(), fileInfo.file),
                  originalName: fileInfo.name
                });
                logger.log(`[Event Email API] Mapped hash ${hash} to ${fileInfo.name}`);
              } else {
                logger.warn(`[Event Email API] Document hash not found in mapping: ${hash}`);
              }
            }
            continue;
          }

          let resolvedPath: string;
          if (trimmed.startsWith('/uploads/')) {
            resolvedPath = path.join(process.cwd(), trimmed.substring(1));
          } else if (path.isAbsolute(trimmed)) {
            resolvedPath = trimmed;
          } else {
            resolvedPath = path.join(process.cwd(), trimmed);
          }
          
          // Convert string path to object with filePath and originalName
          processedAttachments.push({
            filePath: resolvedPath,
            originalName: path.basename(resolvedPath)
          });
          continue;
        }

        if (attachment && typeof attachment === 'object' && 'filePath' in attachment) {
          const filePath = (attachment as { filePath: string }).filePath;
          if (typeof filePath === 'string') {
            let resolvedPath = filePath;

            if (filePath.startsWith('/uploads/')) {
              resolvedPath = path.join(process.cwd(), filePath);
            } else if (!path.isAbsolute(filePath)) {
              resolvedPath = path.join(process.cwd(), filePath);
            }

            processedAttachments.push({
              ...attachment,
              filePath: resolvedPath,
            } as { filePath: string; originalName?: string });
          }
        }
      }
    }

    const attachmentsForSendgrid = processedAttachments;

    // Send clean professional email via SendGrid
    const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');

    // For full HTML documents, inject footer before closing tags
    let finalHtml;
    if (isFullHtml) {
      // Insert footer before </body></html>
      finalHtml = htmlContent.replace(
        /<\/body>\s*<\/html>/i,
        `${EMAIL_FOOTER_HTML}</body></html>`
      );
    } else {
      finalHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="white-space: pre-wrap; line-height: 1.6;">
            ${htmlContent}
          </div>
          ${EMAIL_FOOTER_HTML}
        </div>
      `;
    }

    // Use the organization's VERIFIED SendGrid sender identity
    // (katie@thesandwichproject.org). The previous fallback of
    // katielong2316@gmail.com is NOT a verified sender, so SendGrid rejected
    // every send with a `field: null` sender-identity error — surfacing to the
    // user as an opaque 500 "can't send toolkit". Match every other email
    // sender in the app (event-notification-dispatcher, email-notification-service,
    // etc.) which all send from the org address.
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || FROM_EMAIL;
    const bccEmail = process.env.SENDGRID_TOOLKIT_BCC || FROM_EMAIL;

    const emailPayload: {
      to: string;
      from: string;
      replyTo: string;
      subject: string;
      text?: string;
      html: string;
      bcc?: string;
      attachments?: (string | { filePath: string; originalName?: string })[];
    } = {
      to: recipientEmail,
      from: fromEmail,
      replyTo: replyToEmail,
      subject,
      html: finalHtml,
    };

    // Only include plain text fallback for non-HTML emails
    if (!isFullHtml) {
      emailPayload.text = `${textContent}\n\n${EMAIL_FOOTER_TEXT}`;
    }

    // Only add BCC if it's different from the recipient email to avoid SendGrid duplicate error
    if (bccEmail && bccEmail.toLowerCase() !== recipientEmail.toLowerCase()) {
      emailPayload.bcc = bccEmail;
    }

    if (attachmentsForSendgrid.length > 0) {
      emailPayload.attachments = attachmentsForSendgrid;
    }

    logger.log('[Event Email API] Sending email via SendGrid:', {
      to: recipientEmail,
      from: fromEmail,
      replyTo: replyToEmail,
      subject,
      attachmentsCount: attachmentsForSendgrid.length,
      isFullHtml,
      hasApiKey: !!process.env.SENDGRID_API_KEY,
    });

    const sendResult = await sendEmailWithResult(emailPayload);

    if (!sendResult.success) {
      // Report the ACTUAL SendGrid rejection reason (e.g. sender-identity not
      // verified) carried back with this specific send, instead of a misleading
      // generic "check API key configuration".
      logger.error(
        `[Event Email API] SendGrid send failed - email not sent. Reason: ${sendResult.error || 'unknown'}`
      );
      throw new Error(sendResult.error || 'SendGrid rejected the email. Please try again or contact support.');
    }

    // Save a record in internal email system (without sending duplicate)
    const newEmail = await db.insert(emailMessages).values({
      senderId: user.id,
      senderName,
      senderEmail: user.email,
      recipientId: 'external',
      recipientName: recipientName || 'Event Contact',
      recipientEmail,
      subject,
      content: content || '', // Default to empty string for attachment-only messages
      contextType: contextType || 'event_request',
      contextId: contextId || eventRequestId?.toString(),
      contextTitle: contextTitle || `Event Communication`,
      attachments,
      isDraft: false,
      isRead: true,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      includeSchedulingLink: false,
      requestPhoneCall: false,
    }).returning();

    logger.log('[Event Email API] Email sent successfully');
    res.json({
      success: true,
      message: 'Email sent successfully',
      emailId: newEmail[0].id,
    });
  } catch (error) {
    logger.error('[Event Email API] Error:', error);
    res.status(500).json({
      message: 'Failed to send email',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

  return router;
}
