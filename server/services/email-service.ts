import { db } from '../db';
import { emailMessages, users } from '@shared/schema';
import { eq, and, or, desc, isNull, sql, inArray } from 'drizzle-orm';
import { logger } from '../utils/production-safe-logger';
import { getLinkedUserIds } from '../lib/linked-accounts';

export interface EmailMessage {
  id: number;
  senderId: string;
  senderName: string;
  senderEmail: string;
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  content: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  isDraft: boolean;
  parentMessageId: number | null; // Reference to parent message for threading
  // Parent message content (included when fetching replies)
  parentMessage?: {
    id: number;
    senderName: string;
    content: string;
    createdAt: Date | null;
  } | null;
  contextType: string | null;
  contextId: string | null;
  contextTitle: string | null;
  attachments: string[];
  includeSchedulingLink: boolean;
  requestPhoneCall: boolean;
  readAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export class EmailService {
  /**
   * Get unread email count for a user
   */
  async getUnreadEmailCount(userId: string): Promise<number> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailMessages)
        .where(
          and(
            inArray(emailMessages.recipientId, linkedIds),
            eq(emailMessages.isRead, false),
            eq(emailMessages.isDraft, false),
            eq(emailMessages.isTrashed, false)
          )
        );

      return result[0]?.count || 0;
    } catch (error) {
      logger.error('Failed to get unread email count:', error);
      return 0;
    }
  }

  /**
   * Get emails for a specific folder - SIMPLIFIED (No threading)
   */
  async getEmailsByFolder(
    userId: string,
    folder: string
  ): Promise<EmailMessage[]> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      let query;

      switch (folder) {
        case 'inbox':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                inArray(emailMessages.recipientId, linkedIds), // Show emails sent TO this user or a linked account
                eq(emailMessages.isDraft, false),
                eq(emailMessages.isTrashed, false),
                eq(emailMessages.isArchived, false)
              )
            );
          break;

        case 'starred':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                or(
                  eq(emailMessages.senderId, userId),
                  inArray(emailMessages.recipientId, linkedIds)
                ),
                eq(emailMessages.isStarred, true),
                eq(emailMessages.isTrashed, false)
              )
            );
          break;

        case 'sent':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                eq(emailMessages.senderId, userId),
                eq(emailMessages.isDraft, false),
                eq(emailMessages.isTrashed, false),
                eq(emailMessages.isArchived, false)
              )
            );
          break;

        case 'drafts':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                eq(emailMessages.senderId, userId),
                eq(emailMessages.isDraft, true)
              )
            );
          break;

        case 'archived':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                or(
                  eq(emailMessages.senderId, userId),
                  inArray(emailMessages.recipientId, linkedIds)
                ),
                eq(emailMessages.isArchived, true),
                eq(emailMessages.isTrashed, false)
              )
            );
          break;

        case 'trash':
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                or(
                  eq(emailMessages.senderId, userId),
                  inArray(emailMessages.recipientId, linkedIds)
                ),
                eq(emailMessages.isTrashed, true)
              )
            );
          break;

        default:
          // Default to inbox
          query = db
            .select()
            .from(emailMessages)
            .where(
              and(
                or(
                  eq(emailMessages.senderId, userId),
                  inArray(emailMessages.recipientId, linkedIds)
                ),
                eq(emailMessages.isDraft, false),
                eq(emailMessages.isTrashed, false),
                eq(emailMessages.isArchived, false)
              )
            );
      }

      const results = await query
        .orderBy(desc(emailMessages.createdAt))
        .limit(50);

      // Fetch parent messages for any replies
      const parentIds = results
        .map((r: any) => r.parentMessageId)
        .filter((id: number | null): id is number => id !== null);

      let parentMessagesMap: Map<number, { id: number; senderName: string; content: string; createdAt: Date | null }> = new Map();

      if (parentIds.length > 0) {
        const parentMessages = await db
          .select({
            id: emailMessages.id,
            senderName: emailMessages.senderName,
            content: emailMessages.content,
            createdAt: emailMessages.createdAt,
          })
          .from(emailMessages)
          .where(inArray(emailMessages.id, parentIds));

        parentMessages.forEach((pm) => {
          parentMessagesMap.set(pm.id, pm);
        });
      }

      // Attach parent message data to results
      const enrichedResults = results.map((msg: any) => ({
        ...msg,
        parentMessage: msg.parentMessageId ? parentMessagesMap.get(msg.parentMessageId) || null : null,
      }));

      return enrichedResults as EmailMessage[];
    } catch (error) {
      logger.error(`Failed to get emails for folder ${folder}:`, error);
      throw error;
    }
  }

  /**
   * Send a new email
   * Always saves internal message, attempts SendGrid notification but doesn't fail if it's unavailable
   */
  async sendEmail(data: {
    senderId: string;
    senderName: string;
    senderEmail: string;
    senderPreferredEmail?: string | null;
    senderPhoneNumber?: string | null;
    recipientId: string;
    recipientName: string;
    recipientEmail: string;
    subject: string;
    content: string;
    parentMessageId?: number | null; // Reference to parent message for threading/replies
    contextType?: string;
    contextId?: string;
    contextTitle?: string;
    attachments?: string[];
    includeSchedulingLink?: boolean;
    requestPhoneCall?: boolean;
    isDraft?: boolean;
  }): Promise<EmailMessage> {
    try {
      // First, save the internal message - this should always succeed
      const [newEmail] = await db
        .insert(emailMessages)
        .values({
          senderId: data.senderId,
          senderName: data.senderName,
          senderEmail: data.senderEmail,
          recipientId: data.recipientId,
          recipientName: data.recipientName,
          recipientEmail: data.recipientEmail,
          subject: data.subject,
          content: data.content,
          parentMessageId: data.parentMessageId || null, // Store reference to parent message
          contextType: data.contextType || null,
          contextId: data.contextId || null,
          contextTitle: data.contextTitle || null,
          attachments: data.attachments || [],
          includeSchedulingLink: data.includeSchedulingLink || false,
          requestPhoneCall: data.requestPhoneCall || false,
          isDraft: data.isDraft || false,
          isRead: false, // All new messages start as unread for recipient (drafts and sent messages)
          isStarred: false,
          isArchived: false,
          isTrashed: false,
        })
        .returning();

      // Then try to send SendGrid notification (but don't fail if it doesn't work)
      if (!data.isDraft) {
        try {
          const { sendEmail: sendGridEmail } = await import('../sendgrid');
          const { documents } = await import('@shared/schema');
          
          // Use preferred email for Reply-To, fallback to sender email
          const replyToEmail = data.senderPreferredEmail || data.senderEmail;
          
          // Create email signature
          const createSignature = () => {
            const signatureParts = [];
            signatureParts.push(`${data.senderName}`);
            
            // Always include an email address (preferred or fallback to sender email)
            const emailToShow = data.senderPreferredEmail || data.senderEmail;
            signatureParts.push(`Email: ${emailToShow}`);
            
            if (data.senderPhoneNumber) {
              signatureParts.push(`Phone: ${data.senderPhoneNumber}`);
            }
            
            return signatureParts.join('\n');
          };
          
          const signature = createSignature();
          const contentWithSignature = `${data.content}\n\n---\n${signature}`;
          
          // Convert markdown-style bold **text** to HTML <strong>text</strong> and \n to <br>
          const contentHtml = data.content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
          const signatureHtml = signature
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
          
          // Process attachments - handle both document IDs and file paths consistently
          let processedAttachments: { filePath: string; originalName?: string }[] = [];
          if (data.attachments && data.attachments.length > 0) {
            const path = await import('path');
            
            // Separate document IDs from file paths
            const numericIds = data.attachments
              .map(a => typeof a === 'string' ? parseInt(a) : a)
              .filter(id => !isNaN(id));
            
            const documentMap = new Map<number, { filePath: string; originalName?: string }>();
            
            if (numericIds.length > 0) {
              // Fetch document metadata from database
              const docs = await db
                .select({
                  id: documents.id,
                  filePath: documents.filePath,
                  originalName: documents.originalName,
                })
                .from(documents)
                .where(inArray(documents.id, numericIds));
              
              docs.forEach(doc => {
                documentMap.set(doc.id, {
                  filePath: doc.filePath,
                  originalName: doc.originalName || undefined,
                });
              });
            }
            
            // Process each attachment consistently
            for (const attachment of data.attachments) {
              if (typeof attachment === 'string') {
                const trimmed = attachment.trim();
                
                // Check if it's a numeric ID
                if (/^\d+$/.test(trimmed)) {
                  const docId = parseInt(trimmed, 10);
                  const docMeta = documentMap.get(docId);
                  if (docMeta) {
                    processedAttachments.push(docMeta);
                  } else {
                    logger.warn(`[Email Service] Document ID ${docId} not found`);
                  }
                  continue;
                }
                
                // Handle file path strings - convert to object format
                let resolvedPath: string;
                if (trimmed.startsWith('/uploads/')) {
                  resolvedPath = path.join(process.cwd(), trimmed.substring(1));
                } else if (path.isAbsolute(trimmed)) {
                  resolvedPath = trimmed;
                } else {
                  resolvedPath = path.join(process.cwd(), trimmed);
                }
                
                processedAttachments.push({
                  filePath: resolvedPath,
                  originalName: path.basename(resolvedPath)
                });
              }
            }
          }
          
          // Import SendGrid compliance footer
          const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');
          
          await sendGridEmail({
            emailStream: 'operational',
            to: data.recipientEmail,
            from: 'katielong2316@gmail.com', // Your verified sender
            replyTo: replyToEmail, // Use preferred email for Reply-To
            subject: `New message: ${data.subject}`,
            text: `You have a new message from ${data.senderName}.\n\nSubject: ${data.subject}\n\n${contentWithSignature}\n\nPlease log in to your account to view and respond to this message.${EMAIL_FOOTER_TEXT}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #236383;">New Message</h2>
                <p>You have a new message from <strong>${data.senderName}</strong>.</p>
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="margin-top: 0; color: #333;">Subject: ${data.subject}</h3>
                  <p style="white-space: pre-wrap;">${contentHtml}</p>
                  <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em;">
                    <p style="margin: 0; white-space: pre-wrap;">${signatureHtml}</p>
                  </div>
                </div>
                <p>Please log in to your account to view and respond to this message.</p>
                ${EMAIL_FOOTER_HTML}
              </div>
            `,
            attachments: processedAttachments,
          });
          logger.log(
            `[Email Service] SendGrid notification sent successfully to ${data.recipientEmail}`
          );
        } catch (emailError) {
          logger.warn(
            `[Email Service] SendGrid notification failed (but internal message saved): ${
              emailError?.message || 'Unknown error'
            }`
          );
          // Don't throw - the internal message was saved successfully
        }
      }

      return newEmail as EmailMessage;
    } catch (error) {
      logger.error('Failed to save internal email:', error);
      throw error;
    }
  }

  /**
   * Update email status (star, archive, trash, etc.)
   * CRITICAL: Only recipients can mark emails as read to prevent sender read actions affecting recipient status
   */
  async updateEmailStatus(
    emailId: number,
    userId: string,
    updates: {
      isRead?: boolean;
      isStarred?: boolean;
      isArchived?: boolean;
      isTrashed?: boolean;
      isDraft?: boolean;
    }
  ): Promise<boolean> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      // Verify user has access to this email
      const [email] = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.id, emailId),
            or(
              eq(emailMessages.senderId, userId),
              inArray(emailMessages.recipientId, linkedIds)
            )
          )
        );

      if (!email) {
        logger.error('Email not found or user does not have access');
        return false;
      }

      // CRITICAL FIX: Only allow recipients to mark emails as read
      // If the acting account is the sender (and not also a linked recipient),
      // ignore read updates to prevent affecting the recipient's unread status
      const isRecipient = linkedIds.includes(email.recipientId);
      if (updates.isRead !== undefined && !isRecipient) {
        logger.log(
          `Sender ${userId} attempted to mark email ${emailId} as read - ignoring to protect recipient read status`
        );
        // Remove isRead from updates for senders
        const { isRead, ...otherUpdates } = updates;

        // Update only other fields (star, archive, etc.) for senders
        if (Object.keys(otherUpdates).length > 0) {
          await db
            .update(emailMessages)
            .set({
              ...otherUpdates,
              updatedAt: new Date(),
            })
            .where(eq(emailMessages.id, emailId));
        }
        return true;
      }

      // Recipients can mark emails as read normally
      await db
        .update(emailMessages)
        .set({
          ...updates,
          updatedAt: new Date(),
          readAt: updates.isRead ? new Date() : undefined,
        })
        .where(eq(emailMessages.id, emailId));

      return true;
    } catch (error) {
      logger.error('Failed to update email status:', error);
      return false;
    }
  }

  /**
   * Mark email as read
   */
  async markEmailRead(emailId: number, userId: string): Promise<boolean> {
    return this.updateEmailStatus(emailId, userId, { isRead: true });
  }

  /**
   * Delete email permanently
   */
  async deleteEmail(emailId: number, userId: string): Promise<boolean> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      // Verify user has access to this email
      const result = await db
        .delete(emailMessages)
        .where(
          and(
            eq(emailMessages.id, emailId),
            or(
              eq(emailMessages.senderId, userId),
              inArray(emailMessages.recipientId, linkedIds)
            )
          )
        );

      return true;
    } catch (error) {
      logger.error('Failed to delete email:', error);
      return false;
    }
  }

  /**
   * Get email by ID
   */
  async getEmailById(
    emailId: number,
    userId: string
  ): Promise<EmailMessage | null> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      const [email] = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.id, emailId),
            or(
              eq(emailMessages.senderId, userId),
              inArray(emailMessages.recipientId, linkedIds)
            )
          )
        );

      return (email as EmailMessage) || null;
    } catch (error) {
      logger.error('Failed to get email by ID:', error);
      return null;
    }
  }

  /**
   * Get full thread chain for an email (all ancestors and descendants)
   * This walks up the parent chain and down through replies to build the complete thread
   */
  async getEmailThread(
    emailId: number,
    userId: string
  ): Promise<EmailMessage[]> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      // First, find the root of this thread by walking up the parent chain
      let rootId = emailId;
      let currentEmail = await this.getEmailById(emailId, userId);

      if (!currentEmail) {
        return [];
      }

      // Walk up to find the root (oldest message in thread)
      while (currentEmail?.parentMessageId) {
        const parentEmail = await this.getEmailById(currentEmail.parentMessageId, userId);
        if (parentEmail) {
          rootId = parentEmail.id;
          currentEmail = parentEmail;
        } else {
          break;
        }
      }

      // Now collect all messages in the thread starting from root
      const threadMessages: EmailMessage[] = [];
      const processedIds = new Set<number>();

      // Helper function to recursively get all descendants
      const collectThreadMessages = async (messageId: number) => {
        if (processedIds.has(messageId)) return;
        processedIds.add(messageId);

        const message = await this.getEmailById(messageId, userId);
        if (message) {
          threadMessages.push(message);

          // Find all replies to this message
          const replies = await db
            .select()
            .from(emailMessages)
            .where(
              and(
                eq(emailMessages.parentMessageId, messageId),
                or(
                  eq(emailMessages.senderId, userId),
                  inArray(emailMessages.recipientId, linkedIds)
                )
              )
            )
            .orderBy(emailMessages.createdAt);

          for (const reply of replies) {
            await collectThreadMessages(reply.id);
          }
        }
      };

      await collectThreadMessages(rootId);

      // Sort by creation date (oldest first for thread view)
      threadMessages.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });

      return threadMessages;
    } catch (error) {
      logger.error('Failed to get email thread:', error);
      throw error;
    }
  }

  /**
   * Search emails
   */
  async searchEmails(
    userId: string,
    searchTerm: string
  ): Promise<EmailMessage[]> {
    try {
      const linkedIds = await getLinkedUserIds(userId);
      const results = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            or(
              eq(emailMessages.senderId, userId),
              inArray(emailMessages.recipientId, linkedIds)
            ),
            or(
              sql`${emailMessages.subject} ILIKE ${`%${searchTerm}%`}`,
              sql`${emailMessages.content} ILIKE ${`%${searchTerm}%`}`,
              sql`${emailMessages.senderName} ILIKE ${`%${searchTerm}%`}`,
              sql`${emailMessages.recipientName} ILIKE ${`%${searchTerm}%`}`
            )
          )
        )
        .orderBy(desc(emailMessages.createdAt))
        .limit(50);

      return results as EmailMessage[];
    } catch (error) {
      logger.error('Failed to search emails:', error);
      throw error;
    }
  }

  /**
   * Get drafts for a specific context (e.g., event request)
   */
  async getDraftsByContext(
    userId: string,
    contextType: string,
    contextId: string
  ): Promise<EmailMessage[]> {
    try {
      const results = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.senderId, userId), // Only user's own drafts
            eq(emailMessages.isDraft, true),
            eq(emailMessages.contextType, contextType),
            eq(emailMessages.contextId, contextId)
          )
        )
        .orderBy(desc(emailMessages.updatedAt))
        .limit(20); // Limit to most recent 20 drafts

      return results as EmailMessage[];
    } catch (error) {
      logger.error('Failed to get drafts by context:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();
