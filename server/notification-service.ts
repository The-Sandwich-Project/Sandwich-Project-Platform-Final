import { MailService } from '@sendgrid/mail';
import { withUnsubscribeSettings } from './utils/sendgrid-unsubscribe';
import {
  NotificationTypes,
  type NotificationType,
  type ProjectNotificationData,
  type EmailNotificationTemplate,
} from '@shared/notification-types';
import { db } from './database-storage';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from './utils/production-safe-logger';
import { FROM_EMAIL as ORG_FROM_EMAIL } from './config/organization';

if (!process.env.SENDGRID_API_KEY) {
  logger.warn(
    'SENDGRID_API_KEY environment variable not set. Email notifications will be disabled.'
  );
}

const mailService = new MailService();
if (process.env.SENDGRID_API_KEY) {
  mailService.setApiKey(process.env.SENDGRID_API_KEY);
}

export class NotificationService {
  private static readonly FROM_EMAIL = ORG_FROM_EMAIL;

  /**
   * Send email notification for direct messages
   */
  static async sendDirectMessageNotification(
    recipientEmail: string,
    senderName: string,
    messageContent: string,
    contextType?: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log(
        'Direct message email notification skipped - no SendGrid API key configured'
      );
      return false;
    }

    try {
      const subject = `New message from ${senderName}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #236383;">New Message from ${senderName}</h2>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 16px; line-height: 1.5;">${messageContent}</p>
          </div>
          <p>
            <a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/messages" 
               style="background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Message
            </a>
          </p>
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated message from The Sandwich Project. Please do not reply to this email.
          </p>
        </div>
      `;

      const emailData = {
        to: recipientEmail,
        from: this.FROM_EMAIL,
        subject,
        html: htmlContent,
        text: `New message from ${senderName}: ${messageContent}\n\nView the message at: ${process.env.REPL_URL || 'https://your-platform-url.com'}/messages`,
      };

      await mailService.send(withUnsubscribeSettings(emailData, 'operational'));
      logger.log(
        `Direct message email notification sent to ${recipientEmail}`
      );
      return true;
    } catch (error) {
      logger.error('Failed to send direct message email notification:', error);
      return false;
    }
  }

  /**
   * Send email notification for new chat messages (Stream Chat)
   */
  static async sendChatNotification(
    recipientEmail: string,
    recipientName: string,
    senderName: string,
    channelName: string,
    messageContent: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log(
        'Chat email notification skipped - no SendGrid API key configured'
      );
      return false;
    }

    try {
      const appUrl = process.env.PUBLIC_APP_URL ||
        (process.env.REPLIT_DOMAIN
          ? `https://${process.env.REPLIT_DOMAIN}`
          : 'https://your-platform-url.com');

      const subject = `New message from ${senderName} in ${channelName}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #236383;">New Message in ${channelName}</h2>
          <p style="font-size: 16px; line-height: 1.5;">
            Hi ${recipientName},
          </p>
          <p style="font-size: 16px; line-height: 1.5;">
            <strong>${senderName}</strong> sent a message in <strong>${channelName}</strong>:
          </p>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #47B3CB;">
            <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #374151;">${messageContent}</p>
          </div>
          <p>
            <a href="${appUrl}/dashboard?section=chat"
               style="display: inline-block; background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
              View in Team Chat
            </a>
          </p>
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated message from The Sandwich Project. Please do not reply to this email.
          </p>
        </div>
      `;

      const emailData = {
        to: recipientEmail,
        from: this.FROM_EMAIL,
        subject,
        html: htmlContent,
        text: `New message from ${senderName} in ${channelName}:\n\n"${messageContent}"\n\nView the conversation at: ${appUrl}/dashboard?section=chat`,
      };

      await mailService.send(withUnsubscribeSettings(emailData, 'operational'));
      logger.log(
        `Chat notification email sent to ${recipientEmail}`
      );
      return true;
    } catch (error) {
      logger.error('Failed to send chat notification email:', error);
      return false;
    }
  }

  /**
   * Send email notification for project assignments
   */
  static async sendProjectAssignmentNotification(
    projectId: string,
    projectTitle: string,
    assigneeEmails: string[],
    assignedBy: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log(
        'Project assignment email notification skipped - no SendGrid API key configured'
      );
      return false;
    }

    try {
      const subject = `You've been assigned to project: ${projectTitle}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #236383;">New Project Assignment</h2>
          <p style="font-size: 16px; line-height: 1.5;">
            You have been assigned to work on the project <strong>${projectTitle}</strong>.
          </p>
          ${assignedBy ? `<p style="color: #64748b;">Assigned by: ${assignedBy}</p>` : ''}
          <p style="font-size: 16px; line-height: 1.5;">
            Please log into the Sandwich Project platform to view project details and get started.
          </p>
          <p>
            <a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${projectId}" 
               style="background: #236383; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Project
            </a>
          </p>
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            This is an automated message from The Sandwich Project. Please do not reply to this email.
          </p>
        </div>
      `;

      const emailData = {
        to: assigneeEmails,
        from: this.FROM_EMAIL,
        subject,
        html: htmlContent,
        text: `You've been assigned to project: ${projectTitle}\n\n${assignedBy ? `Assigned by: ${assignedBy}\n\n` : ''}Please log into the platform to view project details.\n\nView project at: ${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${projectId}`,
      };

      await mailService.send(withUnsubscribeSettings(emailData, 'operational'));
      logger.log(
        `Project assignment email notification sent to ${assigneeEmails.length} recipients`
      );
      return true;
    } catch (error) {
      logger.error(
        'Failed to send project assignment email notification:',
        error
      );
      return false;
    }
  }

  static async sendProjectNotification(
    type: NotificationType,
    data: ProjectNotificationData,
    recipientEmails: string[]
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log(
        'Email notification skipped - no SendGrid API key configured'
      );
      return false;
    }

    try {
      const template = this.getEmailTemplate(type, data);

      const emailData = {
        to: recipientEmails,
        from: this.FROM_EMAIL,
        subject: template.subject,
        html: template.body,
        text: template.body.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      };

      await mailService.send(withUnsubscribeSettings(emailData, 'operational'));
      logger.log(
        `Email notification sent: ${type} to ${recipientEmails.length} recipients`
      );
      return true;
    } catch (error) {
      logger.error('Failed to send email notification:', error);
      return false;
    }
  }

  /**
   * Send SMS opt-in instructions email
   */
  static async sendSMSOptInInstructions(
    recipientEmail: string,
    recipientName?: string
  ): Promise<boolean> {
    if (!process.env.SENDGRID_API_KEY) {
      logger.log(
        'SMS opt-in instructions email skipped - no SendGrid API key configured'
      );
      return false;
    }

    try {
      const subject = 'Get Text Notifications from The Sandwich Project 📱';
      const displayName = recipientName || 'there';
      const settingsUrl = `${process.env.REPL_URL || 'https://your-platform-url.com'}/profile`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #236383; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
            .section { margin: 25px 0; }
            .highlight-box { background: #f0f9ff; border-left: 4px solid #236383; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .steps { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .step { margin: 15px 0; padding-left: 10px; }
            .step-number { display: inline-block; background: #236383; color: white; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 50%; margin-right: 10px; font-weight: bold; }
            .button { display: inline-block; background: #236383; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
            .footer { color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
            ul { padding-left: 25px; }
            li { margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📱 Get SMS Notifications from The Sandwich Project</h1>
            </div>
            <div class="content">
              <div class="section">
                <p>Hi ${displayName},</p>
                <p>Stay informed about your event assignments! Sign up to receive instant text notifications when you're assigned as TSP contact for events.</p>
              </div>

              <div class="highlight-box">
                <strong>What you'll receive:</strong>
                <ul>
                  <li>Helpful reminders and updates when you need them</li>
                  <li>Direct links to the app for easy access</li>
                  <li>Important notifications to help you stay on track</li>
                  <li>Simple, friendly messages – no spam!</li>
                </ul>
              </div>

              <div class="section">
                <h3 style="color: #236383;">📋 How to Sign Up (Takes 2 minutes)</h3>
              </div>

              <div class="steps">
                <div class="step">
                  <span class="step-number">1</span>
                  <strong>Go to your profile settings</strong><br>
                  <span style="color: #64748b;">Click the button below or log in and navigate to your profile</span>
                </div>
                
                <div class="step">
                  <span class="step-number">2</span>
                  <strong>Find the "SMS Notifications" section</strong><br>
                  <span style="color: #64748b;">Scroll down to the SMS alerts section</span>
                </div>
                
                <div class="step">
                  <span class="step-number">3</span>
                  <strong>Enter your mobile phone number</strong><br>
                  <span style="color: #64748b;">Use the number where you want to receive texts</span>
                </div>
                
                <div class="step">
                  <span class="step-number">4</span>
                  <strong>Check the consent box and click "Enable SMS Notifications"</strong><br>
                  <span style="color: #64748b;">You'll instantly receive a confirmation text with a verification code</span>
                </div>
                
                <div class="step">
                  <span class="step-number">5</span>
                  <strong>Reply to the text with your code (or "YES")</strong><br>
                  <span style="color: #64748b;">Once confirmed, you'll get a welcome message and you're all set!</span>
                </div>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${settingsUrl}" class="button">Go to Profile Settings →</a>
              </div>

              <div class="section">
                <p style="color: #64748b; font-size: 14px;">
                  <strong>Note:</strong> Standard text messaging rates may apply from your carrier. You can opt out anytime by replying "STOP" to any text or updating your profile settings.
                </p>
              </div>

              <div class="footer">
                <p>Thanks for helping us fight hunger, one sandwich at a time! 🥪</p>
                <p>— The Sandwich Project Team</p>
                <p style="margin-top: 20px; font-size: 12px;">
                  This is an automated message from The Sandwich Project. Questions? Contact us through the platform.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Get SMS Notifications from The Sandwich Project

Hi ${displayName},

Stay informed about your event assignments! Sign up to receive instant text notifications when you're assigned as TSP contact for events.

WHAT YOU'LL RECEIVE:
• Helpful reminders and updates when you need them
• Direct links to the app for easy access
• Important notifications to help you stay on track
• Simple, friendly messages – no spam!

HOW TO SIGN UP (Takes 2 minutes):

1. Go to your profile settings
   Visit: ${settingsUrl}

2. Find the "SMS Notifications" section
   Scroll down to the SMS alerts section

3. Enter your mobile phone number
   Use the number where you want to receive texts

4. Check the consent box and click "Enable SMS Notifications"
   You'll instantly receive a confirmation text with a verification code

5. Reply to the text with your code (or "YES")
   Once confirmed, you'll get a welcome message and you're all set!

Note: Standard text messaging rates may apply from your carrier. You can opt out anytime by replying "STOP" to any text or updating your profile settings.

Thanks for helping us fight hunger, one sandwich at a time! 🥪

— The Sandwich Project Team
      `.trim();

      const emailData = {
        to: recipientEmail,
        from: this.FROM_EMAIL,
        subject,
        html: htmlContent,
        text: textContent,
      };

      await mailService.send(withUnsubscribeSettings(emailData, 'operational'));
      logger.log(`SMS opt-in instructions email sent to ${recipientEmail}`);
      return true;
    } catch (error) {
      logger.error('Failed to send SMS opt-in instructions email:', error);
      return false;
    }
  }

  private static getEmailTemplate(
    type: NotificationType,
    data: ProjectNotificationData
  ): EmailNotificationTemplate {
    switch (type) {
      case NotificationTypes.PROJECT_ASSIGNED:
        return {
          subject: `You've been assigned to project: ${data.projectTitle}`,
          body: `
            <h2>New Project Assignment</h2>
            <p>You have been assigned to work on the project <strong>${data.projectTitle}</strong>.</p>
            ${data.assignedBy ? `<p>Assigned by: ${data.assignedBy}</p>` : ''}
            <p>Please log into the Sandwich Project platform to view project details and get started.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      case NotificationTypes.PROJECT_UPDATED:
        return {
          subject: `Project updated: ${data.projectTitle}`,
          body: `
            <h2>Project Update</h2>
            <p>The project <strong>${data.projectTitle}</strong> has been updated.</p>
            <p>Please check the project page for the latest information.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      case NotificationTypes.TASK_ADDED:
        return {
          subject: `New task added to ${data.projectTitle}`,
          body: `
            <h2>New Task Added</h2>
            <p>A new task <strong>${data.taskTitle}</strong> has been added to project <strong>${data.projectTitle}</strong>.</p>
            <p>Please check the project page to view task details.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      case NotificationTypes.TASK_ASSIGNED:
        return {
          subject: `You've been assigned a task: ${data.taskTitle}`,
          body: `
            <h2>New Task Assignment</h2>
            <p>You have been assigned the task <strong>${data.taskTitle}</strong> in project <strong>${data.projectTitle}</strong>.</p>
            ${data.assignedBy ? `<p>Assigned by: ${data.assignedBy}</p>` : ''}
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      case NotificationTypes.PROJECT_STATUS_CHANGED:
        return {
          subject: `Project status changed: ${data.projectTitle}`,
          body: `
            <h2>Project Status Update</h2>
            <p>The status of project <strong>${data.projectTitle}</strong> has changed from <strong>${data.oldStatus}</strong> to <strong>${data.newStatus}</strong>.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      case NotificationTypes.PROJECT_DUE_REMINDER:
        return {
          subject: `Reminder: ${data.projectTitle} due soon`,
          body: `
            <h2>Project Due Date Reminder</h2>
            <p>The project <strong>${data.projectTitle}</strong> is due on <strong>${data.dueDate}</strong>.</p>
            <p>Please ensure all tasks are completed on time.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };

      default:
        return {
          subject: `Update on project: ${data.projectTitle}`,
          body: `
            <h2>Project Update</h2>
            <p>There has been an update to project <strong>${data.projectTitle}</strong>.</p>
            <p><a href="${process.env.REPL_URL || 'https://your-platform-url.com'}/projects/${data.projectId}">View Project</a></p>
          `,
          recipients: data.assignedTo || [],
        };
    }
  }
}
