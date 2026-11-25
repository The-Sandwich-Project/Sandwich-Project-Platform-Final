/**
 * Types shared by the email helper (server/services/email/).
 */

/**
 * Which kind of email this is. Decides which unsubscribe applies.
 * operational: event assignments, volunteer signups/confirmations, reminders,
 *   schedule changes, follow-ups, password resets, direct messages, admin alerts.
 * newsletter: bulk announcements, shout-outs, promotional/newsletter-style mail.
 */
export type EmailStream = 'operational' | 'newsletter';

/** "a@b.org", "Name <a@b.org>", or { email, name }. */
export type EmailAddressInput = string | { email: string; name?: string | null };

/** One or many recipients, in any of the forms above. */
export type EmailRecipients = EmailAddressInput | EmailAddressInput[];

export interface FileAttachment {
  filePath: string;
  originalName?: string;
}

/**
 * An attachment whose content is already base64. Accepts the SendGrid-style
 * `type` (and ignores `disposition`) so existing attachment code keeps working.
 */
export interface Base64Attachment {
  content: string;
  filename: string;
  contentType?: string;
  type?: string;
  disposition?: string;
  /** Content-ID for inline images (`<img src="cid:...">`). */
  cid?: string;
  contentId?: string;
}

export type EmailAttachmentInput = string | FileAttachment | Base64Attachment;

export interface EmailParams {
  to: EmailRecipients;
  /** Defaults to EMAIL_FROM_ADDRESS. Must be on the domain verified in Twilio. */
  from?: EmailAddressInput;
  /**
   * Twilio Email has no Reply-To. When this differs from the From address the
   * helper adds a "To reply, email <name> at <address>" line to the top of the
   * body instead. Prefer sending FROM the person's own address (see
   * server/utils/user-sender.ts) so plain Reply works.
   */
  replyTo?: EmailAddressInput;
  /** Sent as separate copies (Twilio Email has no CC). */
  cc?: EmailRecipients;
  /** Sent as separate copies (Twilio Email has no BCC). */
  bcc?: EmailRecipients;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachmentInput[];
  emailStream: EmailStream;
  /**
   * Also send a monitoring copy to ADMIN_EMAIL. Defaults to true for
   * sendEmail()/sendEmailWithResult() and false for sendEmailOrThrow(),
   * matching what the old SendGrid code did. The admin copy is never
   * suppressed.
   */
  adminCopy?: boolean;
  /**
   * Extra email headers (e.g. List-Unsubscribe). Twilio won't let these set
   * To, From, Subject, Reply-To, CC, BCC or Content-Type.
   */
  headers?: Record<string, string>;
  /** Up to 10 Twilio tags (keys/values: letters, digits, . _ ~ -). */
  tags?: Record<string, string>;
  /** Send later (up to 7 days ahead). */
  sendAt?: Date | string;
}

export interface SendEmailResult {
  success: boolean;
  /** Human-readable reason when success is false. */
  error?: string;
  /** True when the main recipient(s) are on email_suppressions for this stream. */
  suppressed?: boolean;
  /** HTTP status from Twilio for the failing request, if any. */
  status?: number;
  /** Twilio operation ids for the accepted requests (main recipients first). */
  operationIds?: string[];
}
