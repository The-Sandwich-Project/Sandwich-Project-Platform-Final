import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { users, eventRequests, eventCollaborationComments } from '@shared/schema';
import { eq, or, like, sql, inArray } from 'drizzle-orm';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { logger } from '../utils/production-safe-logger';
import { getUserMetadata } from '@shared/types';
import { sendChatMentionSMS, sendTSPContactAssignmentSMS, sendTeamBoardAssignmentSMS, sendEventCommentSMS } from '../sms-service';
import { getAppBaseUrl } from '../config/constants';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { getEffectivePrefs } from './notifications/preferences';
import { getEffectiveEventDate } from '../../shared/event-validation-utils';

// Initialize SendGrid
if (!process.env.SENDGRID_API_KEY) {
  logger.warn(
    'SENDGRID_API_KEY not found - email notifications will be disabled'
  );
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export interface ChatMentionNotification {
  mentionedUserId: string;
  mentionedUserEmail: string;
  mentionedUserName: string;
  senderName: string;
  senderEmail: string;
  channel: string;
  messageContent: string;
  messageId: number;
}

export class EmailNotificationService {
  /**
   * Detect @mentions in chat message content
   * Supports formats like @username, @"display name", @email@domain.com
   *
   * Uses a single combined regex to prevent overlapping matches.
   * Priority order: quoted names > email addresses > simple usernames
   */
  static detectMentions(content: string): string[] {
    const mentions: string[] = [];

    // Combined regex with alternation to prevent overlapping matches
    // Priority: 1) Quoted names 2) Email addresses 3) Simple usernames
    const mentionRegex = /@(?:"([^"]+)"|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|([a-zA-Z0-9._-]+))/g;

    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      // Extract the matched mention from whichever group captured it
      const mention = match[1] || match[2] || match[3];
      if (mention) {
        mentions.push(mention);
      }
    }

    return [...new Set(mentions)]; // Remove duplicates
  }

  /**
   * Find users mentioned in a message and return their details
   */
  static async findMentionedUsers(mentions: string[]): Promise<
    Array<{
      id: string;
      email: string;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
    }>
  > {
    if (mentions.length === 0) return [];

    try {
      // Lowercase all mentions for case-insensitive matching
      const lowerMentions = mentions.map(m => m.toLowerCase());

      // Use SQL WHERE clause to filter at database level (not in JavaScript!)
      // This prevents loading all users into memory
      const allMentionedUsers = await db
        .select()
        .from(users)
        .where(
          or(
            sql`LOWER(${users.email}) = ANY(${lowerMentions})`,
            sql`LOWER(${users.displayName}) = ANY(${lowerMentions})`,
            sql`LOWER(${users.firstName}) = ANY(${lowerMentions})`,
            sql`LOWER(${users.lastName}) = ANY(${lowerMentions})`
          )
        );

      // Filter and cast to ensure email is non-null
      return allMentionedUsers.filter((user): user is typeof user & { email: string } => 
        user.email !== null && user.email !== undefined
      );
    } catch (error) {
      logger.error('Error finding mentioned users:', error);
      return [];
    }
  }

  /**
   * Send email notification for chat mentions
   */
  static async sendChatMentionNotification(
    notification: ChatMentionNotification
  ): Promise<boolean> {
    // Respect the user's saved preferences. If both channels are off, skip.
    const prefs = await getEffectivePrefs(
      notification.mentionedUserId,
      ALERT_TYPES.CHAT_MENTION
    );
    if (!prefs.emailEnabled && !prefs.smsEnabled) {
      return false;
    }

    const shouldSendEmail = prefs.emailEnabled && !!process.env.SENDGRID_API_KEY;
    if (prefs.emailEnabled && !process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping chat mention email');
    }

    let anySent = false;

    if (shouldSendEmail) {
      const msg = {
        to: notification.mentionedUserEmail,
        from: 'katie@thesandwichproject.org',
        subject: `You were mentioned in ${notification.channel} chat - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .message-box { background: white; padding: 15px; border-left: 4px solid #236383; margin: 15px 0; }
              .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>💬 You were mentioned in chat!</h1>
              </div>
              <div class="content">
                <p>Hello ${notification.mentionedUserName}!</p>
                <p><strong>${
                  notification.senderName
                }</strong> mentioned you in the <strong>#${
                  notification.channel
                }</strong> chat room:</p>
                
                <div class="message-box">
                  "${notification.messageContent}"
                </div>
                
                <p>Click the button below to join the conversation:</p>
                <a href="${this.getChatUrl(
                  notification.channel
                )}" class="btn">Join Chat Room</a>
                
                <div class="footer">
                  <p>This notification was sent because you were mentioned in a chat message.</p>
                  <p>The Sandwich Project - Building community through food assistance</p>
                  <p style="font-size: 11px; color: #888;">To unsubscribe from these emails, please contact us at <a href="mailto:katie@thesandwichproject.org" style="color: #236383;">katie@thesandwichproject.org</a> or reply STOP.</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Hello ${notification.mentionedUserName}!

${notification.senderName} mentioned you in the #${
          notification.channel
        } chat room:

"${notification.messageContent}"

Join the conversation: ${this.getChatUrl(notification.channel)}

---
The Sandwich Project - Building community through food assistance

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
        `.trim(),
      };

      try {
        await sgMail.send(msg);
        logger.log(
          `Chat mention notification sent to ${notification.mentionedUserEmail}`
        );
        anySent = true;
      } catch (err) {
        logger.error('Error sending chat mention email:', err);
      }
    }

    if (prefs.smsEnabled) {
      try {
        const mentionedUser = await db
          .select()
          .from(users)
          .where(eq(users.id, notification.mentionedUserId))
          .limit(1);
        if (mentionedUser.length > 0) {
          const metadata = getUserMetadata(mentionedUser[0]);
          const smsConsent = metadata.smsConsent;
          if (smsConsent?.status === 'confirmed' && smsConsent.enabled && smsConsent.phoneNumber) {
            const messagePreview = notification.messageContent.length > 50
              ? notification.messageContent.substring(0, 50) + '...'
              : notification.messageContent;
            const chatUrl = this.getChatUrl(notification.channel);
            await sendChatMentionSMS(
              smsConsent.phoneNumber,
              notification.mentionedUserName,
              notification.senderName,
              notification.channel,
              messagePreview,
              chatUrl
            );
            logger.log(`Chat mention SMS sent to ${smsConsent.phoneNumber}`);
            anySent = true;
          }
        }
      } catch (smsError) {
        logger.error('Error sending chat mention SMS:', smsError);
      }
    }

    return anySent;
  }

  /**
   * Send email notification when a user is assigned as TSP contact for an event
   */
  static async sendTspContactAssignmentNotification(
    userId: string,
    eventId: number,
    organizationName: string,
    eventDate: Date | string | null
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping TSP contact assignment notification');
      return false;
    }

    try {
      // Fetch user details from database
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      
      if (!user || user.length === 0 || !user[0].email) {
        logger.warn(`User ${userId} not found or has no email - cannot send TSP contact notification`);
        return false;
      }

      // Use preferred email if available, otherwise use regular email
      const userEmail = user[0].preferredEmail || user[0].email;
      const userName = user[0].displayName || user[0].firstName || userEmail.split('@')[0];
      
      // Format event date
      const formattedEventDate = eventDate 
        ? new Date(eventDate).toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })
        : 'Date to be determined';

      // Generate event URL
      const eventUrl = this.getEventUrl(eventId);

      const msg = {
        to: userEmail,
        from: 'katie@thesandwichproject.org',
        subject: "You've been assigned as TSP Contact - The Sandwich Project",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .event-details { background: white; padding: 15px; border-left: 4px solid #236383; margin: 15px 0; }
              .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎯 You've been assigned as TSP Contact!</h1>
              </div>
              <div class="content">
                <p>Hello ${userName}!</p>
                <p>You have been assigned as the TSP Contact for the following event:</p>
                
                <div class="event-details">
                  <strong>Organization:</strong> ${organizationName}<br>
                  <strong>Event Date:</strong> ${formattedEventDate}
                </div>
                
                <p>As the TSP Contact, you will be the main point of contact for coordinating this sandwich-making event. Please review the event details and reach out to the organization to confirm arrangements.</p>
                
                <p>Click the button below to view the event details:</p>
                <a href="${eventUrl}" class="btn">View Event Details</a>
                
                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Hello ${userName}!

You have been assigned as the TSP Contact for the following event:

Organization: ${organizationName}
Event Date: ${formattedEventDate}

As the TSP Contact, you will be the main point of contact for coordinating this sandwich-making event. Please review the event details and reach out to the organization to confirm arrangements.

View event details: ${eventUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
        `.trim(),
      };

      await sgMail.send(msg);
      logger.log(`TSP contact assignment notification sent to ${userEmail} for event ${eventId}`);

      // Send SMS notification if user has opted in
      try {
        const metadata = getUserMetadata(user[0]);
        const smsConsent = metadata.smsConsent;
        if (smsConsent?.status === 'confirmed' && smsConsent.enabled && smsConsent.phoneNumber) {
          const eventUrl = this.getEventUrl(eventId);
          await sendTSPContactAssignmentSMS(
            smsConsent.phoneNumber,
            userName,
            organizationName,
            formattedEventDate,
            eventUrl
          );
          logger.log(`TSP contact assignment SMS sent to ${smsConsent.phoneNumber} for event ${eventId}`);
        }
      } catch (smsError) {
        logger.error('Error sending TSP contact assignment SMS (email still succeeded):', smsError);
      }

      return true;
    } catch (error) {
      logger.error('Error sending TSP contact assignment notification:', error);
      return false;
    }
  }

  /**
   * Send 24-hour reminder email to volunteers assigned to an event
   */
  static async sendVolunteerReminderNotification(
    volunteerEmail: string,
    volunteerName: string,
    eventId: number,
    organizationName: string,
    eventDate: Date | string,
    role: string,
    instructions?: string | null
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping volunteer reminder notification');
      return false;
    }

    try {
      // Format event date and time in organization's timezone (America/New_York)
      const eventDateTime = new Date(eventDate);
      const formattedDate = eventDateTime.toLocaleDateString('en-US', { 
        timeZone: 'America/New_York',
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      const formattedTime = eventDateTime.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Format role for display
      const roleDisplay = role === 'driver' ? 'Driver' 
                        : role === 'speaker' ? 'Speaker' 
                        : 'Volunteer';

      // Generate event URL
      const eventUrl = this.getEventUrl(eventId);

      const msg = {
        to: volunteerEmail,
        from: 'katie@thesandwichproject.org',
        subject: `Reminder: Event tomorrow at ${organizationName} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .event-details { background: white; padding: 15px; border-left: 4px solid #DE7C3A; margin: 15px 0; }
              .highlight { background: #FFF9E6; padding: 10px; border-radius: 5px; margin: 15px 0; }
              .btn { display: inline-block; background: #DE7C3A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔔 Event Reminder - Tomorrow!</h1>
              </div>
              <div class="content">
                <p>Hello ${volunteerName}!</p>
                <p>This is a friendly reminder that you're scheduled to volunteer tomorrow as a <strong>${roleDisplay}</strong>:</p>
                
                <div class="event-details">
                  <strong>Organization:</strong> ${organizationName}<br>
                  <strong>Date:</strong> ${formattedDate}<br>
                  <strong>Time:</strong> ${formattedTime}<br>
                  <strong>Your Role:</strong> ${roleDisplay}
                </div>
                
                <div class="highlight">
                  <strong>📋 What to bring:</strong><br>
                  ${role === 'driver' ? '• Valid driver\'s license<br>• Your vehicle ready for pickup/delivery' 
                    : role === 'speaker' ? '• Any presentation materials<br>• Your enthusiasm for The Sandwich Project!' 
                    : '• Your enthusiasm and willingness to help!'}
                </div>
                
                ${instructions ? `
                <div style="background: #fff4e6; border-left: 4px solid #FBAD3F; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <strong style="color: #333;">📋 Important Instructions:</strong>
                  <p style="margin: 10px 0 0 0; color: #555;">${instructions}</p>
                </div>
                ` : ''}
                
                <p>If you have any questions or need to make changes to your commitment, please contact us as soon as possible.</p>
                
                <p>Click the button below to view the full event details:</p>
                <a href="${eventUrl}" class="btn">View Event Details</a>
                
                <p style="margin-top: 20px;"><strong>Thank you for your commitment to fighting food insecurity!</strong></p>
                
                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Hello ${volunteerName}!

This is a friendly reminder that you're scheduled to volunteer tomorrow as a ${roleDisplay}:

Organization: ${organizationName}
Date: ${formattedDate}
Time: ${formattedTime}
Your Role: ${roleDisplay}

${role === 'driver' ? 'What to bring:\n• Valid driver\'s license\n• Your vehicle ready for pickup/delivery' 
  : role === 'speaker' ? 'What to bring:\n• Any presentation materials\n• Your enthusiasm for The Sandwich Project!' 
  : 'What to bring:\n• Your enthusiasm and willingness to help!'}

${instructions ? `\n📋 Important Instructions:\n${instructions}\n` : ''}
If you have any questions or need to make changes to your commitment, please contact us as soon as possible.

View event details: ${eventUrl}

Thank you for your commitment to fighting food insecurity!

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
        `.trim(),
      };

      await sgMail.send(msg);
      logger.log(`24-hour volunteer reminder sent to ${volunteerEmail} for event ${eventId}`);
      return true;
    } catch (error) {
      logger.error('Error sending volunteer reminder notification:', error);
      return false;
    }
  }

  /**
   * Process a chat message for mentions and send notifications
   */
  static async processChatMessage(
    content: string,
    senderId: string,
    senderName: string,
    senderEmail: string,
    channel: string,
    messageId: number
  ): Promise<void> {
    try {
      // Detect mentions in the message
      const mentions = this.detectMentions(content);
      if (mentions.length === 0) return;

      // Find users who were mentioned
      const mentionedUsers = await this.findMentionedUsers(mentions);

      // Send notifications to each mentioned user (except the sender)
      for (const user of mentionedUsers) {
        if (user.id === senderId) continue; // Don't notify the sender

        const userName =
          user.displayName ||
          user.firstName ||
          user.email?.split('@')[0] ||
          'User';

        await this.sendChatMentionNotification({
          mentionedUserId: user.id,
          mentionedUserEmail: user.email!,
          mentionedUserName: userName,
          senderName,
          senderEmail,
          channel,
          messageContent: content,
          messageId,
        });
      }
    } catch (error) {
      logger.error('Error processing chat message for mentions:', error);
    }
  }

  /**
   * Generate chat room URL for the notification
   */
  private static getChatUrl(channel: string): string {
    const baseUrl = getAppBaseUrl();

    return `${baseUrl}/dashboard?section=chat&channel=${encodeURIComponent(
      channel
    )}`;
  }

  /**
   * Send email notification when a user is assigned to a Holding Zone item
   */
  static async sendTeamBoardAssignmentNotification(
    assignedUserIds: string[],
    itemId: number,
    itemContent: string,
    itemType: string,
    assignedBy: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping Holding Zone assignment notification');
      return false;
    }

    try {
      // Fetch user details from database for all assigned users
      const assignedUsers = await db
        .select()
        .from(users)
        .where(inArray(users.id, assignedUserIds));

      if (!assignedUsers || assignedUsers.length === 0) {
        logger.warn(`No valid users found for Holding Zone assignment - IDs: ${assignedUserIds.join(', ')}`);
        return false;
      }

      // Resolve each user's prefs once so we don't double-query below
      const prefsByUser = new Map<string, Awaited<ReturnType<typeof getEffectivePrefs>>>();
      for (const user of assignedUsers) {
        prefsByUser.set(
          user.id,
          await getEffectivePrefs(user.id, ALERT_TYPES.HOLDING_ZONE_ASSIGNMENT)
        );
      }

      // Send email to each assigned user (only if they've opted in)
      for (const user of assignedUsers) {
        if (!user.email) {
          logger.warn(`User ${user.id} has no email - cannot send Holding Zone assignment notification`);
          continue;
        }
        const prefs = prefsByUser.get(user.id);
        if (!prefs?.emailEnabled) {
          continue;
        }

        // Use preferred email if available, otherwise use regular email
        const userEmail = user.preferredEmail || user.email;
        const userName = user.displayName || user.firstName || userEmail.split('@')[0];

        // Truncate content if too long for email
        const displayContent = itemContent.length > 200
          ? itemContent.substring(0, 200) + '...'
          : itemContent;

        // Format item type for display
        const itemTypeDisplay = itemType === 'task' ? 'Task'
                              : itemType === 'note' ? 'Note'
                              : itemType === 'idea' ? 'Idea'
                              : itemType === 'reminder' ? 'Reminder'
                              : 'Item';

        // Generate Holding Zone URL
        const holdingZoneUrl = this.getTeamBoardUrl();

        const msg = {
          to: userEmail,
          from: 'katie@thesandwichproject.org',
          subject: `You've been assigned to a Holding Zone ${itemTypeDisplay.toLowerCase()} - The Sandwich Project`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                .item-details { background: white; padding: 15px; border-left: 4px solid #FBAD3F; margin: 15px 0; }
                .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>📋 You've been assigned to a Holding Zone ${itemTypeDisplay.toLowerCase()}!</h1>
                </div>
                <div class="content">
                  <p>Hello ${userName}!</p>
                  <p>You have been assigned to the following Holding Zone ${itemTypeDisplay.toLowerCase()} by <strong>${assignedBy}</strong>:</p>

                  <div class="item-details">
                    <strong>${itemTypeDisplay}:</strong><br>
                    ${displayContent}
                  </div>

                  <p>Please review the ${itemTypeDisplay.toLowerCase()} details and take any necessary action.</p>

                  <p>Click the button below to view the Holding Zone:</p>
                  <a href="${holdingZoneUrl}" class="btn">View Holding Zone</a>

                  ${EMAIL_FOOTER_HTML}
                </div>
              </div>
            </body>
            </html>
          `,
          text: `
Hello ${userName}!

You have been assigned to the following Holding Zone ${itemTypeDisplay.toLowerCase()} by ${assignedBy}:

${itemTypeDisplay}: ${displayContent}

Please review the ${itemTypeDisplay.toLowerCase()} details and take any necessary action.

View Holding Zone: ${holdingZoneUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
          `.trim(),
        };

        await sgMail.send(msg);
        logger.log(`Holding Zone assignment notification sent to ${userEmail} for item ${itemId}`);
      }

      // Send SMS notifications to users who (a) have opted in over SMS in
      // their prefs and (b) have a confirmed phone number on file.
      const holdingZoneUrl = this.getTeamBoardUrl();
      for (const user of assignedUsers) {
        try {
          const prefs = prefsByUser.get(user.id);
          if (!prefs?.smsEnabled) {
            continue;
          }
          const metadata = getUserMetadata(user);
          const smsConsent = metadata.smsConsent;
          if (smsConsent?.status === 'confirmed' && smsConsent.enabled && smsConsent.phoneNumber) {
            const userName = user.displayName || user.firstName || user.email?.split('@')[0] || 'User';
            const displayContent = itemContent.length > 50
              ? itemContent.substring(0, 50) + '...'
              : itemContent;
            await sendTeamBoardAssignmentSMS(
              smsConsent.phoneNumber,
              userName,
              displayContent,
              assignedBy,
              itemType,
              holdingZoneUrl
            );
            logger.log(`Holding Zone assignment SMS sent to ${smsConsent.phoneNumber} for item ${itemId}`);
          }
        } catch (smsError) {
          logger.error(`Error sending Holding Zone assignment SMS to user ${user.id} (emails still succeeded):`, smsError);
        }
      }

      return true;
    } catch (error) {
      logger.error('Error sending Holding Zone assignment notification:', error);
      return false;
    }
  }

  /**
   * Send notification to Christine and Katie when an event is marked as corporate priority
   * Corporate events require immediate attention and core team member assignment
   */
  static async sendCorporatePriorityNotification(
    eventId: number,
    organizationName: string,
    eventDate: Date | string | null,
    markedByEmail: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping corporate priority notification');
      return false;
    }

    try {
      // Send to Katie only
      const recipients = [
        'katie@thesandwichproject.org'
      ];

      const formattedEventDate = eventDate
        ? new Date(eventDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'Date to be determined';

      const eventUrl = this.getEventUrl(eventId);

      const msg = {
        to: recipients,
        from: 'katie@thesandwichproject.org',
        subject: `🏢 NEW CORPORATE PRIORITY: ${organizationName} - Action Required`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #B8860B 0%, #DAA520 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .event-details { background: white; padding: 15px; border-left: 4px solid #B8860B; margin: 15px 0; }
              .priority-box { background: #FFF8DC; padding: 15px; border: 2px solid #B8860B; border-radius: 8px; margin: 15px 0; }
              .action-items { background: #fff4e6; padding: 15px; border-radius: 8px; margin: 15px 0; }
              .btn { display: inline-block; background: #B8860B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🏢 Corporate Priority Event</h1>
                <p style="margin: 0; opacity: 0.9;">Requires Immediate Attention</p>
              </div>
              <div class="content">
                <div class="priority-box">
                  <p style="margin: 0;"><strong>⚡ This event has been marked as CORPORATE PRIORITY</strong></p>
                  <p style="margin: 5px 0 0 0; font-size: 0.9em;">Corporate events require immediate contact and core team member attendance.</p>
                </div>

                <div class="event-details">
                  <strong>Organization:</strong> ${organizationName}<br>
                  <strong>Event Date:</strong> ${formattedEventDate}<br>
                  <strong>Marked By:</strong> ${markedByEmail}
                </div>

                <div class="action-items">
                  <h3 style="margin-top: 0; color: #B8860B;">📋 Required Actions:</h3>
                  <ol style="margin: 0; padding-left: 20px;">
                    <li><strong>Assign TSP Contact immediately</strong> - Corporate events need same-day initial contact</li>
                    <li><strong>Assign a Core Team Member</strong> - This event needs relationship building</li>
                    <li><strong>Follow Corporate Protocol</strong> - Call first day, send toolkit if no answer, follow up daily</li>
                  </ol>
                </div>

                <p>Click below to view and manage this event:</p>
                <a href="${eventUrl}" class="btn">View Corporate Event</a>

                <p style="font-size: 0.85em; color: #666; margin-top: 20px;">
                  <em>Corporate events may use platforms like Deed or Benevity - be sure to note any donation matching opportunities!</em>
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
🏢 CORPORATE PRIORITY EVENT - ACTION REQUIRED

This event has been marked as CORPORATE PRIORITY and requires immediate attention.

Organization: ${organizationName}
Event Date: ${formattedEventDate}
Marked By: ${markedByEmail}

📋 REQUIRED ACTIONS:
1. Assign TSP Contact immediately - Corporate events need same-day initial contact
2. Assign a Core Team Member - This event needs relationship building
3. Follow Corporate Protocol - Call first day, send toolkit if no answer, follow up daily

View event: ${eventUrl}

Note: Corporate events may use platforms like Deed or Benevity - be sure to note any donation matching opportunities!
        `.trim(),
      };

      await sgMail.send(msg);
      logger.log(`Corporate priority notification sent for event ${eventId} (${organizationName})`);

      return true;
    } catch (error) {
      logger.error('Error sending corporate priority notification:', error);
      return false;
    }
  }

  /**
   * Generate event URL for the notification
   */
  private static getEventUrl(eventId: number): string {
    const baseUrl = getAppBaseUrl();

    return `${baseUrl}/dashboard?section=event-requests&tab=all&eventId=${eventId}`;
  }

  /**
   * Generate team board URL for the notification
   */
  private static getTeamBoardUrl(): string {
    const baseUrl = getAppBaseUrl();

    return `${baseUrl}/dashboard?section=team-board`;
  }

  /**
   * Send email notification for Holding Zone comment mentions
   */
  static async sendTeamBoardCommentMentionNotification(
    mentionedUserEmail: string,
    mentionedUserName: string,
    commenterName: string,
    itemContent: string,
    commentContent: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping Holding Zone comment mention notification');
      return false;
    }

    try {
      // Truncate content if too long for email
      const displayItemContent = itemContent.length > 100
        ? itemContent.substring(0, 100) + '...'
        : itemContent;

      const displayCommentContent = commentContent.length > 200
        ? commentContent.substring(0, 200) + '...'
        : commentContent;

      // Generate Holding Zone URL
      const holdingZoneUrl = this.getTeamBoardUrl();

      const msg = {
        to: mentionedUserEmail,
        from: 'katie@thesandwichproject.org',
        subject: `You were mentioned in a Holding Zone comment - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .item-box { background: #e6f7f9; padding: 12px; border-left: 4px solid #47B3CB; margin: 15px 0; font-size: 14px; }
              .comment-box { background: white; padding: 15px; border-left: 4px solid #236383; margin: 15px 0; }
              .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>💬 You were mentioned in a Holding Zone comment!</h1>
              </div>
              <div class="content">
                <p>Hello ${mentionedUserName}!</p>
                <p><strong>${commenterName}</strong> mentioned you in a comment on a Holding Zone item:</p>

                <div class="item-box">
                  <strong>Holding Zone Item:</strong><br>
                  ${displayItemContent}
                </div>

                <div class="comment-box">
                  <strong>${commenterName} commented:</strong><br>
                  "${displayCommentContent}"
                </div>

                <p>Click the button below to view and respond:</p>
                <a href="${holdingZoneUrl}" class="btn">View Holding Zone</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Hello ${mentionedUserName}!

${commenterName} mentioned you in a comment on a Holding Zone item:

Holding Zone Item:
${displayItemContent}

${commenterName} commented:
"${displayCommentContent}"

View Holding Zone: ${holdingZoneUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
        `.trim(),
      };

      await sgMail.send(msg);
      logger.log(`Holding Zone comment mention notification sent to ${mentionedUserEmail}`);
      return true;
    } catch (error) {
      logger.error('Error sending Holding Zone comment mention notification:', error);
      return false;
    }
  }

  /**
   * Process a team board comment for mentions and send notifications
   */
  static async processTeamBoardComment(
    commentContent: string,
    commenterId: string,
    commenterName: string,
    itemId: number,
    itemContent: string
  ): Promise<void> {
    try {
      // Detect mentions in the comment
      const mentions = this.detectMentions(commentContent);
      if (mentions.length === 0) return;

      // Find users who were mentioned
      const mentionedUsers = await this.findMentionedUsers(mentions);

      // Send notifications to each mentioned user (except the commenter)
      for (const user of mentionedUsers) {
        if (user.id === commenterId) continue; // Don't notify the commenter

        if (!user.email) {
          logger.warn(`Skipping mention notification: user ${user.id} has no email.`);
          continue;
        }

        // Respect the user's Alert Preferences for Holding Zone mentions.
        const prefs = await getEffectivePrefs(user.id, ALERT_TYPES.HOLDING_ZONE_MENTION);
        if (!prefs.emailEnabled) continue;

        const userName =
          user.displayName ||
          user.firstName ||
          user.email.split('@')[0] ||
          'User';

        await this.sendTeamBoardCommentMentionNotification(
          user.email,
          userName,
          commenterName,
          itemContent,
          commentContent
        );
      }
    } catch (error) {
      logger.error('Error processing team board comment for mentions:', error);
    }
  }

  /**
   * Send email notification when a comment is left on an event request
   * Notifies the TSP contact(s) assigned to that event
   */
  static async sendEventCommentNotification(
    eventId: number,
    commenterFirstName: string,
    commenterId: string,
    commentContent: string,
    commentCreatedAt: Date,
    parentCommentId?: number
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping event comment notification');
      return false;
    }

    try {
      // Fetch the event request to get TSP contact info and event details
      const [event] = await db
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, eventId))
        .limit(1);

      if (!event) {
        logger.warn(`Event ${eventId} not found - cannot send comment notification`);
        return false;
      }

      // If this is a reply, fetch the original comment (must belong to the same event for security)
      let originalComment: { content: string; userName: string } | null = null;
      if (parentCommentId) {
        const [parent] = await db
          .select({
            content: eventCollaborationComments.content,
            userName: eventCollaborationComments.userName,
          })
          .from(eventCollaborationComments)
          .where(
            and(
              eq(eventCollaborationComments.id, parentCommentId),
              eq(eventCollaborationComments.eventRequestId, eventId)
            )
          )
          .limit(1);
        
        if (parent) {
          originalComment = parent;
        }
      }

      // Collect all TSP contact user IDs (primary + additional contacts)
      const tspContactIds: string[] = [];
      if (event.tspContact) tspContactIds.push(event.tspContact);
      if (event.tspContactAssigned && event.tspContactAssigned !== event.tspContact) {
        tspContactIds.push(event.tspContactAssigned);
      }
      if (event.additionalContact1) tspContactIds.push(event.additionalContact1);
      if (event.additionalContact2) tspContactIds.push(event.additionalContact2);

      // Remove duplicates and filter out the commenter (don't notify yourself)
      const uniqueContactIds = [...new Set(tspContactIds)].filter(id => id !== commenterId);

      if (uniqueContactIds.length === 0) {
        logger.log(`No TSP contacts to notify for event ${eventId} (or commenter is the only contact)`);
        return false;
      }

      // Fetch user details for all TSP contacts
      const tspUsers = await db
        .select()
        .from(users)
        .where(inArray(users.id, uniqueContactIds));

      if (tspUsers.length === 0) {
        logger.warn(`No valid TSP contact users found for event ${eventId}`);
        return false;
      }

      // Format event date
      const eventDate = getEffectiveEventDate(event);
      const formattedEventDate = eventDate
        ? new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'Date to be determined';

      // Format comment timestamp
      const formattedCommentTime = commentCreatedAt.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      // Generate event URL
      const eventUrl = this.getEventUrl(eventId);
      const organizationName = event.organizationName || 'Unknown Organization';

      // Send email to each TSP contact
      for (const user of tspUsers) {
        if (!user.email) {
          logger.warn(`User ${user.id} has no email - cannot send comment notification`);
          continue;
        }

        const userEmail = user.preferredEmail || user.email;
        const userName = user.displayName || user.firstName || userEmail.split('@')[0];

        // Truncate comment if too long
        const displayComment = commentContent.length > 500
          ? commentContent.substring(0, 500) + '...'
          : commentContent;

        // Truncate original comment if it's a reply
        const displayOriginalComment = originalComment && originalComment.content.length > 300
          ? originalComment.content.substring(0, 300) + '...'
          : originalComment?.content;

        // Determine subject and header based on whether it's a reply
        const isReply = !!originalComment;
        const emailSubject = isReply
          ? `${commenterFirstName} replied to a comment on ${organizationName} - The Sandwich Project`
          : `New comment on ${organizationName} event - The Sandwich Project`;
        const emailHeader = isReply ? '↩️ New Reply on Event' : '💬 New Comment on Event';
        const commentAction = isReply ? 'replied' : 'commented';

        // Build original comment HTML section (only shown for replies)
        const originalCommentHtml = isReply ? `
                  <div style="background: #f5f5f5; padding: 12px; border-left: 4px solid #999; margin: 15px 0; font-size: 13px;">
                    <div style="color: #666; font-size: 12px; margin-bottom: 6px;">
                      <strong>${originalComment.userName}</strong> wrote:
                    </div>
                    <div style="color: #555; font-style: italic;">
                      "${displayOriginalComment}"
                    </div>
                  </div>
        ` : '';

        // Build original comment text section (only shown for replies)
        const originalCommentText = isReply ? `
In reply to ${originalComment.userName}'s comment:
"${displayOriginalComment}"

${commenterFirstName} replied on ${formattedCommentTime}:` : `${commenterFirstName} commented on ${formattedCommentTime}:`;

        const msg = {
          to: userEmail,
          from: 'katie@thesandwichproject.org',
          subject: emailSubject,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                .event-details { background: #e6f7f9; padding: 12px; border-left: 4px solid #47B3CB; margin: 15px 0; font-size: 14px; }
                .comment-box { background: white; padding: 15px; border-left: 4px solid #236383; margin: 15px 0; }
                .comment-meta { color: #666; font-size: 13px; margin-bottom: 8px; }
                .btn { display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>${emailHeader}</h1>
                </div>
                <div class="content">
                  <p>Hello ${userName}!</p>
                  <p>${isReply ? `<strong>${commenterFirstName}</strong> replied to a comment on an event you're assigned to:` : 'A new comment has been added to an event you\'re assigned to:'}</p>

                  <div class="event-details">
                    <strong>Organization:</strong> ${organizationName}<br>
                    <strong>Event Date:</strong> ${formattedEventDate}
                  </div>

                  ${originalCommentHtml}

                  <div class="comment-box">
                    <div class="comment-meta">
                      <strong>${commenterFirstName}</strong> ${commentAction} on ${formattedCommentTime}:
                    </div>
                    "${displayComment}"
                  </div>

                  <p>Click the button below to view the event and respond:</p>
                  <a href="${eventUrl}" class="btn">View Event Details</a>

                  ${EMAIL_FOOTER_HTML}
                </div>
              </div>
            </body>
            </html>
          `,
          text: `
Hello ${userName}!

${isReply ? `${commenterFirstName} replied to a comment on an event you're assigned to:` : 'A new comment has been added to an event you\'re assigned to:'}

Organization: ${organizationName}
Event Date: ${formattedEventDate}

${originalCommentText}
"${displayComment}"

View event details and respond: ${eventUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
          `.trim(),
        };

        // Check if user has SMS enabled - if so, send SMS instead of email
        const metadata = getUserMetadata(user);
        const smsConsent = metadata.smsConsent;
        const hasSmsEnabled = smsConsent?.enabled && smsConsent?.phoneNumber;

        if (hasSmsEnabled) {
          // Send SMS notification instead of email
          try {
            await sendEventCommentSMS(
              smsConsent.phoneNumber,
              userName,
              commenterFirstName,
              organizationName,
              commentContent,
              eventUrl,
              originalComment || undefined
            );
            logger.log(`Event comment SMS sent to ${smsConsent.phoneNumber} for event ${eventId} (skipped email)`);
          } catch (smsError) {
            // If SMS fails, fall back to email
            logger.error(`Failed to send event comment SMS to user ${user.id}, falling back to email:`, smsError);
            await sgMail.send(msg);
            logger.log(`Event comment notification sent to ${userEmail} for event ${eventId} (SMS fallback)`);
          }
        } else {
          // Send email notification
          await sgMail.send(msg);
          logger.log(`Event comment notification sent to ${userEmail} for event ${eventId}`);
        }
      }

      return true;
    } catch (error) {
      logger.error('Error sending event comment notification:', error);
      return false;
    }
  }

  /**
   * Process a team board item (task/note/idea) for mentions and send notifications
   */
  static async processTeamBoardItemMentions(
    itemContent: string,
    creatorId: string,
    creatorName: string,
    itemId: number
  ): Promise<void> {
    try {
      // Detect mentions in the item content
      const mentions = this.detectMentions(itemContent);
      if (mentions.length === 0) return;

      // Find users who were mentioned
      const mentionedUsers = await this.findMentionedUsers(mentions);

      // Send notifications to each mentioned user (except the creator)
      for (const user of mentionedUsers) {
        if (user.id === creatorId) continue; // Don't notify the creator

        if (!user.email) {
          logger.warn(`Skipping mention notification: user ${user.id} has no email.`);
          continue;
        }

        // Respect the user's Alert Preferences for Holding Zone mentions.
        const prefs = await getEffectivePrefs(user.id, ALERT_TYPES.HOLDING_ZONE_MENTION);
        if (!prefs.emailEnabled) continue;

        const userName =
          user.displayName ||
          user.firstName ||
          user.email.split('@')[0] ||
          'User';

        await this.sendTeamBoardItemMentionNotification(
          user.email,
          userName,
          creatorName,
          itemContent,
          itemId
        );
      }
    } catch (error) {
      logger.error('Error processing team board item for mentions:', error);
    }
  }

  /**
   * Send email notification for team board item mention
   */
  private static async sendTeamBoardItemMentionNotification(
    recipientEmail: string,
    recipientName: string,
    mentionerName: string,
    itemContent: string,
    itemId: number
  ): Promise<void> {
    try {
      const subject = `${mentionerName} mentioned you in a Holding Zone item`;
      const itemPreview = itemContent.length > 100
        ? itemContent.substring(0, 100) + '...'
        : itemContent;

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #236383;">You've been mentioned!</h2>
          <p>Hi ${recipientName},</p>
          <p><strong>${mentionerName}</strong> mentioned you in a Holding Zone item:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #236383; margin: 20px 0;">
            <p style="margin: 0; white-space: pre-wrap;">${itemPreview}</p>
          </div>
          <p>
            <a href="${getAppBaseUrl()}/dashboard?section=holding-zone"
               style="background-color: #236383; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Holding Zone
            </a>
          </p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This is an automated notification from The Sandwich Project platform.
          </p>
        </div>
      `;

      await sendEmail({
        to: recipientEmail,
        subject,
        text: `${mentionerName} mentioned you in a Holding Zone item:\n\n${itemPreview}\n\nView it in the Holding Zone section.`,
        html: htmlBody,
      });

      logger.info('Holding Zone item mention notification sent', {
        recipientEmail,
        itemId,
      });
    } catch (error) {
      logger.error('Failed to send Holding Zone item mention notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to TSP contact when an in-process event's date has passed
   */
  static async sendPastDateNotification(
    tspContactEmail: string,
    tspContactName: string,
    eventId: number,
    organizationName: string,
    eventDate: Date | string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping past date notification');
      return false;
    }

    try {
      // Format event date
      const eventDateTime = new Date(eventDate);
      const formattedDate = eventDateTime.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // Calculate how many days ago
      const now = new Date();
      const diffTime = now.getTime() - eventDateTime.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const daysAgoText = diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;

      // Generate event URL
      const eventUrl = this.getEventUrl(eventId);

      const msg = {
        to: tspContactEmail,
        from: 'katie@thesandwichproject.org',
        subject: `Action Required: Event date passed for ${organizationName} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #A31C41; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .alert-box { background-color: #FEE2E2; border: 1px solid #EF4444; padding: 15px; border-radius: 6px; margin: 15px 0; }
              .event-details { background-color: #fff; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #A31C41; }
              .btn { display: inline-block; background-color: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
              .actions { background-color: #F0FDF4; padding: 15px; border-radius: 6px; margin: 15px 0; }
              .actions ul { margin: 10px 0; padding-left: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Event Date Has Passed</h1>
              </div>
              <div class="content">
                <p>Hello ${tspContactName},</p>

                <div class="alert-box">
                  <strong>This event's requested date has passed and requires your attention.</strong>
                </div>

                <div class="event-details">
                  <strong>Organization:</strong> ${organizationName}<br>
                  <strong>Requested Date:</strong> ${formattedDate} (${daysAgoText})<br>
                  <strong>Status:</strong> Still In Process
                </div>

                <div class="actions">
                  <strong>📋 Please take one of the following actions:</strong>
                  <ul>
                    <li><strong>Reschedule:</strong> Contact the organization to set a new event date</li>
                    <li><strong>Postpone:</strong> Mark as postponed if they need more time</li>
                    <li><strong>Decline:</strong> Mark as declined if the event is no longer happening</li>
                  </ul>
                </div>

                <p>Click the button below to review the event and update its status:</p>
                <a href="${eventUrl}" class="btn">Review Event</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Hello ${tspContactName},

⚠️ EVENT DATE HAS PASSED - ACTION REQUIRED

This event's requested date has passed and requires your attention:

Organization: ${organizationName}
Requested Date: ${formattedDate} (${daysAgoText})
Status: Still In Process

Please take one of the following actions:
• Reschedule: Contact the organization to set a new event date
• Postpone: Mark as postponed if they need more time
• Decline: Mark as declined if the event is no longer happening

Review event: ${eventUrl}

---
The Sandwich Project - Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org or reply STOP.
        `.trim(),
      };

      await sgMail.send(msg);
      logger.log(`Past date notification sent to ${tspContactEmail} for event ${eventId}`);
      return true;
    } catch (error) {
      logger.error('Error sending past date notification:', error);
      return false;
    }
  }

  /**
   * Send automated TSP follow-up reminder email
   * Used for approaching events still in progress or toolkit-only events needing follow-up
   */
  static async sendTSPFollowupReminderEmail(
    email: string,
    userName: string,
    organizationName: string,
    reminderType: 'approaching_event' | 'toolkit_followup' | 'standby_followup',
    eventDate: Date | null,
    eventId: number
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping TSP follow-up reminder email');
      return false;
    }

    try {
      const appUrl = process.env.REPL_URL || 'https://app.thesandwichproject.org';
      const eventUrl = `${appUrl}/dashboard?section=event-requests&tab=in_process`;
      
      let subject: string;
      let bodyContent: string;
      
      if (reminderType === 'approaching_event') {
        const daysUntil = eventDate
          ? Math.ceil((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : 'a few';
        
        subject = `Friendly Reminder: ${organizationName} Event Coming Up`;
        bodyContent = `
          <p>The event with <strong>${organizationName}</strong> is coming up in <strong>${daysUntil} days</strong> and is still marked as in-progress.</p>
          <p>Let us know if you need any help getting it scheduled, or if you'd like to update the status!</p>
        `;
      } else if (reminderType === 'standby_followup') {
        subject = `Follow-Up Reminder: ${organizationName} (Standby)`;
        bodyContent = `
          <p>This is a reminder to follow up with <strong>${organizationName}</strong>.</p>
          <p>They're currently on standby and requested to be contacted around now. Time to reach out and see if they're ready to schedule!</p>
        `;
      } else {
        subject = `Quick Check-in: ${organizationName} Toolkit Follow-up`;
        bodyContent = `
          <p>You sent the toolkit for <strong>${organizationName}</strong> a couple days ago but haven't heard back yet.</p>
          <p>Would you like to send a follow-up email, or do you need any help moving things along?</p>
        `;
      }

      const msg = {
        to: email,
        from: 'katie@thesandwichproject.org',
        bcc: 'katie@thesandwichproject.org',
        subject: `${subject} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #236383; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .event-details { background-color: #fff; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #236383; }
              .btn { display: inline-block; background-color: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🥪 Quick Reminder</h1>
              </div>
              <div class="content">
                <p>Hi ${userName}!</p>
                
                <div class="event-details">
                  ${bodyContent}
                </div>

                <p>Click below to view the event details:</p>
                <a href="${eventUrl}" class="btn">View Event</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Hi ${userName}!\n\n${
          reminderType === 'approaching_event' 
            ? `The event with ${organizationName} is coming up soon and is still in-progress. Let us know if you need help!` 
            : reminderType === 'standby_followup'
              ? `This is a reminder to follow up with ${organizationName} - they're on standby and requested to be contacted around now. Time to reach out and see if they're ready to schedule!`
              : `You sent the toolkit for ${organizationName} a couple days ago. Would you like to send a follow-up?`
        }\n\nView event: ${eventUrl}\n\n---\nThe Sandwich Project`,
      };

      await sgMail.send(msg);
      logger.log(`TSP follow-up reminder email sent to ${email} for ${reminderType}`);
      return true;
    } catch (error) {
      logger.error('Error sending TSP follow-up reminder email:', error);
      return false;
    }
  }

  /**
   * Send escalation email to admin when TSP contact hasn't responded to reminders
   */
  static async sendEscalationEmail(
    adminEmail: string,
    adminName: string,
    organizationName: string,
    tspContactName: string,
    eventId: number,
    eventLink: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping escalation email');
      return false;
    }

    try {
      const subject = `ESCALATION: Event ${eventId} (${organizationName}) Needs Attention`;

      const msg = {
        to: adminEmail,
        from: 'katie@thesandwichproject.org',
        cc: 'katie@thesandwichproject.org',
        subject: `${subject} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #A31C41; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .alert-box { background-color: #fff; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #A31C41; }
              .btn { display: inline-block; background-color: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚠️ Event Escalation</h1>
              </div>
              <div class="content">
                <p>Hi ${adminName},</p>

                <div class="alert-box">
                  <h3>Event Requires Attention</h3>
                  <p><strong>Event:</strong> ${organizationName} (#${eventId})</p>
                  <p><strong>Assigned TSP Contact:</strong> ${tspContactName}</p>
                  <p><strong>Issue:</strong> No activity for several days despite automated reminders</p>
                </div>

                <p>This event has been sent automated reminders but still hasn't had any contact notes or activity. The TSP contact may need assistance or the event may need to be reassigned.</p>

                <p>Please review the event and follow up as needed:</p>
                <a href="${eventLink}" class="btn">View Event Details</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `ESCALATION NEEDED\n\nEvent: ${organizationName} (#${eventId})\nAssigned to: ${tspContactName}\n\nThis event hasn't had any activity despite automated reminders. Please review and follow up.\n\nView event: ${eventLink}\n\n---\nThe Sandwich Project`,
      };

      await sgMail.send(msg);
      logger.log(`Escalation email sent to ${adminEmail} for event ${eventId}`);
      return true;
    } catch (error) {
      logger.error('Error sending escalation email:', error);
      return false;
    }
  }

  /**
   * Send notification to admins when a user requests permission access
   */
  static async sendPermissionRequestNotification(
    adminEmails: string[],
    request: {
      userName: string;
      userEmail: string;
      requestedAction: string;
      requiredPermission?: string;
      userMessage?: string;
    }
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log('SendGrid not configured - skipping permission request email');
      return false;
    }

    try {
      const appUrl = process.env.PUBLIC_APP_URL ||
        (process.env.REPLIT_DOMAIN ? `https://${process.env.REPLIT_DOMAIN}` : 'https://app.thesandwichproject.org');

      const msg = {
        to: adminEmails,
        from: 'katie@thesandwichproject.org',
        subject: `Permission Request from ${request.userName} - The Sandwich Project`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #FBAD3F; color: #333; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
              .request-box { background-color: #fff; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #FBAD3F; }
              .message-box { background-color: #FFF8E7; padding: 12px; border-radius: 6px; margin: 10px 0; font-style: italic; }
              .btn { display: inline-block; background-color: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔐 Permission Access Request</h1>
              </div>
              <div class="content">
                <p>A user has requested access to a feature or action they currently don't have permission for.</p>

                <div class="request-box">
                  <p><strong>User:</strong> ${request.userName}</p>
                  <p><strong>Email:</strong> ${request.userEmail}</p>
                  <p><strong>Requested Action:</strong> ${request.requestedAction}</p>
                  ${request.requiredPermission ? `<p><strong>Permission Needed:</strong> ${request.requiredPermission}</p>` : ''}
                </div>

                ${request.userMessage ? `
                <div class="message-box">
                  <strong>User's Message:</strong><br>
                  "${request.userMessage}"
                </div>
                ` : ''}

                <p>To grant this permission, go to the user's profile in Admin Settings:</p>
                <a href="${appUrl}/admin-settings?tab=permissions" class="btn">Manage Permissions</a>

                ${EMAIL_FOOTER_HTML}
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Permission Request\n\nUser: ${request.userName} (${request.userEmail})\nRequested Action: ${request.requestedAction}\n${request.requiredPermission ? `Permission Needed: ${request.requiredPermission}\n` : ''}${request.userMessage ? `\nUser's Message: "${request.userMessage}"\n` : ''}\nManage permissions at: ${appUrl}/admin-settings?tab=permissions\n\n---\nThe Sandwich Project`,
      };

      await sgMail.send(msg);
      logger.log(`Permission request email sent to ${adminEmails.length} admin(s) for user ${request.userEmail}`);
      return true;
    } catch (error) {
      logger.error('Error sending permission request email:', error);
      return false;
    }
  }
}
