import { MailService } from '@sendgrid/mail';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/production-safe-logger';
import { ADMIN_EMAIL } from './config/organization';
import { withUnsubscribeSettings, type EmailStream } from './utils/sendgrid-unsubscribe';

const mailService = new MailService();

if (process.env.SENDGRID_API_KEY) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  logger.warn('⚠️ SENDGRID_API_KEY not set - email functionality will be disabled');
}

interface EmailAttachment {
  filePath: string;
  originalName?: string;
}

interface Base64Attachment {
  content: string;
  filename: string;
  type: string;
  disposition: string;
}

interface EmailParams {
  to: string;
  from: string;
  replyTo?: string;
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: (string | EmailAttachment | Base64Attachment)[];
  /**
   * Which SendGrid unsubscribe group this email belongs to. 'operational'
   * (assignments, reminders, schedule changes, alerts) also bypasses the global
   * unsubscribe list; 'newsletter' (bulk announcements) does not.
   */
  emailStream: EmailStream;
}

/**
 * Result of an email send attempt. `error` carries the specific SendGrid
 * rejection reason (e.g. "from address does not match a verified Sender
 * Identity") so callers can surface something actionable. Returned per-call so
 * there's no shared/global state that could leak one request's reason into
 * another under concurrent sends.
 */
export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send an email and return the outcome together with the failure reason.
 * Prefer this over sendEmail() when you need to report why a send failed.
 */
export async function sendEmailWithResult(params: EmailParams): Promise<SendEmailResult> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('Email sending skipped - SENDGRID_API_KEY not configured');
    return { success: false, error: 'SENDGRID_API_KEY is not configured' };
  }

  try {
    logger.log(
      `Attempting to send email to ${params.to} from ${params.from} with subject: ${params.subject}`
    );
    const emailData: any = {
      to: params.to,
      from: params.from,
      subject: params.subject,
    };
    
    // Only include HTML if provided
    if (params.html) {
      emailData.html = params.html;
      // Only include plain text as fallback if HTML is not provided
      // or if specifically provided along with HTML
      if (params.text && params.text !== params.html) {
        emailData.text = params.text;
      }
    } else if (params.text) {
      // If only text is provided (no HTML), use it
      emailData.text = params.text;
    }
    
    // Add Reply-To header if provided
    if (params.replyTo) {
      emailData.replyTo = params.replyTo;
    }
    
    // MONITORING: Always BCC admin on all outgoing emails
    const adminMonitoringEmail = ADMIN_EMAIL;
    const bccList: string[] = [];
    
    // Add admin monitoring email
    bccList.push(adminMonitoringEmail);
    
    // Add any additional BCC emails provided
    if (params.bcc) {
      if (Array.isArray(params.bcc)) {
        bccList.push(...params.bcc);
      } else {
        bccList.push(params.bcc);
      }
    }
    
    // Set BCC with all recipients, deduplicated (case-insensitively) AND
    // excluding any address that is already in `to` (or `cc`). SendGrid rejects
    // the ENTIRE send with a 400 if the same address appears in both `to` and
    // `bcc` — and since we always force-BCC the admin (katie@), every email sent
    // *to* that same admin address would otherwise fail. (See SendGrid error:
    // "Each email address ... should be unique between to, cc, and bcc".)
    const excludeAddresses = new Set(
      [params.to, (params as any).cc]
        .flat()
        .filter((addr): addr is string => typeof addr === 'string')
        .map((addr) => addr.trim().toLowerCase())
    );
    const seenBcc = new Set<string>();
    const finalBcc = bccList.filter((addr) => {
      const key = (addr || '').trim().toLowerCase();
      if (!key || excludeAddresses.has(key) || seenBcc.has(key)) return false;
      seenBcc.add(key);
      return true;
    });
    // SendGrid rejects an empty bcc array — only attach when there's something left
    if (finalBcc.length > 0) {
      emailData.bcc = finalBcc;
    }
    
    // Process attachments if provided
    if (params.attachments && params.attachments.length > 0) {
      const processedAttachments = [];
      
      for (const attachment of params.attachments) {
        try {
          // Handle base64 attachments (already processed from GCS)
          if (attachment && typeof attachment === 'object' && 'content' in attachment && 'filename' in attachment) {
            processedAttachments.push(attachment);
            logger.log(`Added base64 attachment: ${attachment.filename}`);
            continue;
          }
          
          // Handle both string paths and attachment objects
          const filePath = typeof attachment === 'string' ? attachment : attachment.filePath;
          const originalName = typeof attachment === 'string' ? undefined : attachment.originalName;
          
          // Check if file exists
          if (!fs.existsSync(filePath)) {
            logger.warn(`Attachment file not found: ${filePath}`);
            continue;
          }
          
          // Read file from disk
          const fileContent = fs.readFileSync(filePath);
          const base64Content = fileContent.toString('base64');
          
          // Use original name if provided, otherwise extract from path
          const filename = originalName || path.basename(filePath);
          
          // Determine content type based on file extension
          const ext = path.extname(filename).toLowerCase();
          const contentTypeMap: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.txt': 'text/plain',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
          };
          
          const contentType = contentTypeMap[ext] || 'application/octet-stream';
          
          processedAttachments.push({
            content: base64Content,
            filename: filename,
            type: contentType,
            disposition: 'attachment',
          });
          
          logger.log(`Processed attachment: ${filename} (${contentType})`);
        } catch (attachmentError) {
          logger.error(`Failed to process attachment ${filePath}:`, attachmentError);
          // Continue processing other attachments even if one fails
        }
      }
      
      if (processedAttachments.length > 0) {
        emailData.attachments = processedAttachments;
        logger.log(`Added ${processedAttachments.length} attachment(s) to email`);
      }
    }
    
    await mailService.send(withUnsubscribeSettings(emailData, params.emailStream));
    logger.log(`Email sent successfully to ${params.to}`);
    return { success: true };
  } catch (error) {
    logger.error('SendGrid email error:', error);
    // Surface the real SendGrid rejection reason (e.g. "from address does not
    // match a verified Sender Identity") so callers can report something
    // actionable instead of a generic "check API key configuration".
    const sendGridErrors = error?.response?.body?.errors;
    let reason: string;
    if (Array.isArray(sendGridErrors) && sendGridErrors.length > 0) {
      logger.error(
        'SendGrid error details:',
        JSON.stringify(error.response.body, null, 2)
      );
      reason = sendGridErrors
        .map((e: { message?: string }) => e?.message)
        .filter(Boolean)
        .join('; ');
    } else {
      reason = error instanceof Error ? error.message : 'Unknown SendGrid error';
    }
    return { success: false, error: reason };
  }
}

/**
 * Backwards-compatible boolean wrapper around sendEmailWithResult() for the
 * many callers that only care whether the send succeeded.
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  const result = await sendEmailWithResult(params);
  return result.success;
}

export async function sendSuggestionNotification(suggestion: {
  title: string;
  description: string;
  category: string;
  priority: string;
  submittedBy: string;
  submittedAt: Date;
}): Promise<boolean> {
  // Import SendGrid compliance footer
  const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('./utils/email-footer');
  
  const emailContent = `
New Suggestion Submitted to The Sandwich Project

Title: ${suggestion.title}
Category: ${suggestion.category}
Priority: ${suggestion.priority}
Submitted by: ${suggestion.submittedBy}
Submitted at: ${suggestion.submittedAt.toLocaleString()}

Description:
${suggestion.description}

---
This is an automated notification from The Sandwich Project suggestions portal.${EMAIL_FOOTER_TEXT}
  `.trim();

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #236383;">New Suggestion Submitted</h2>
      <p>A new suggestion has been submitted to The Sandwich Project suggestions portal.</p>
      
      <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #333;">${suggestion.title}</h3>
        <p><strong>Category:</strong> ${suggestion.category}</p>
        <p><strong>Priority:</strong> ${suggestion.priority}</p>
        <p><strong>Submitted by:</strong> ${suggestion.submittedBy}</p>
        <p><strong>Submitted at:</strong> ${suggestion.submittedAt.toLocaleString()}</p>
      </div>
      
      <div style="margin: 20px 0;">
        <h4>Description:</h4>
        <p style="white-space: pre-wrap; background-color: #f9f9f9; padding: 15px; border-radius: 4px;">${
          suggestion.description
        }</p>
      </div>
      
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
      <p style="color: #666; font-size: 12px;">This is an automated notification from The Sandwich Project suggestions portal.</p>
      ${EMAIL_FOOTER_HTML}
    </div>
  `;

  return sendEmail({
    to: 'katielong2316@gmail.com', // Your email for development notifications
    from: 'katielong2316@gmail.com', // Using your verified email as sender
    subject: `New Suggestion: ${suggestion.title}`,
    text: emailContent,
    html: htmlContent,
    emailStream: 'operational',
  });
}

export async function sendWeeklyMonitoringReminder(location: string): Promise<{success: boolean; message?: string}> {
  try {
    // Import the proper email reminder function from weekly-monitoring
    const { sendEmailReminder } = await import('./weekly-monitoring');
    
    // Use the updated function with proper location-to-contact mapping
    const result = await sendEmailReminder(location);
    
    return {
      success: result.success,
      message: result.message
    };
  } catch (error) {
    logger.error('Error sending weekly monitoring reminder:', error);
    return {
      success: false,
      message: error.message || 'Failed to send email'
    };
  }
}
