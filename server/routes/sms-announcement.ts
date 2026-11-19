import { Router } from 'express';
import { isAuthenticated } from '../auth';
import { requirePermission } from '../middleware/auth';
import { sendEmail } from '../sendgrid';
import { storage } from '../storage';
import { z } from 'zod';
import { logger } from '../utils/production-safe-logger';

const router = Router();

const sendAnnouncementSchema = z.object({
  testMode: z.boolean().optional().default(false),
  testEmail: z.string().email().optional(),
});

/**
 * Send SMS capability announcement to all registered users
 */
router.post(
  '/send-sms-announcement',
  isAuthenticated,
  requirePermission('USERS_EDIT'),
  async (req, res) => {
    try {
      const { testMode, testEmail } = sendAnnouncementSchema.parse(req.body);
      const senderUser = req.user;

      if (!senderUser?.email) {
        return res.status(400).json({ error: 'Sender email not found' });
      }

      // Get all active users with email addresses (exclude pending/unapproved users)
      const allUsers = await storage.getAllUsers();
      let recipients = allUsers.filter(
        (user) =>
          user.email && user.email.includes('@') && user.isActive === true
      );

      // In test mode, only send to specified test email or sender
      if (testMode) {
        const targetEmail = testEmail || senderUser.email;
        recipients = recipients.filter((user) => user.email === targetEmail);

        if (recipients.length === 0) {
          return res.status(400).json({
            error: `Test recipient ${targetEmail} not found in user list`,
          });
        }
      }

      if (recipients.length === 0) {
        return res.status(400).json({
          error: 'No valid email recipients found',
        });
      }

      const appUrl = process.env.PUBLIC_APP_URL ||
        (process.env.REPLIT_DOMAIN
          ? `https://${process.env.REPLIT_DOMAIN}`
          : req.headers.origin || 'https://sandwich-project-platform-final-katielong2316.replit.app');

      const smsOptInUrl = `${appUrl}/sms-opt-in`;

      // Email content
      const subject = testMode
        ? `[TEST] 📱 New SMS Reminders Available - The Sandwich Project`
        : `📱 New SMS Reminders Available - The Sandwich Project`;

      const textContent = `
Hi there!

We're excited to announce a new feature that can help you stay connected with The Sandwich Project:

🥪 SMS REMINDERS FOR WEEKLY SUBMISSIONS 🥪

What's new?
• Get friendly text message reminders when weekly sandwich counts are missing
• Direct links to the app for easy submission
• Completely optional - you control your preferences

Want to sign up?
Visit: ${smsOptInUrl}

Or copy and paste this link into your browser:
${smsOptInUrl}

Important: This is completely opt-in. We will only send SMS messages to users who explicitly sign up for this service. Your phone number will only be used for sandwich collection reminders.

Questions? Just reply to this email!

Thanks for all you do,
The Sandwich Project Team

---
This email was sent to registered users of The Sandwich Project app.
${testMode ? '\n[THIS IS A TEST EMAIL - No actual announcement was sent]' : ''}
`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1f7b7b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .highlight { background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #f39c12; margin: 20px 0; }
        .button { display: inline-block; background: #1f7b7b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; font-size: 0.9em; color: #666; }
        .emoji { font-size: 1.2em; }
        .test-notice { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; margin-top: 20px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1><span class="emoji">📱</span> New SMS Reminders Available!</h1>
        <p>Stay connected with The Sandwich Project</p>
    </div>
    
    <div class="content">
        <p>Hi there!</p>
        
        <p>We're excited to announce a new feature that can help you stay connected with The Sandwich Project:</p>
        
        <div class="highlight">
            <h3><span class="emoji">🥪</span> SMS REMINDERS FOR WEEKLY SUBMISSIONS</h3>
            <p><strong>What's new?</strong></p>
            <ul>
                <li>Get friendly text message reminders when weekly sandwich counts are missing</li>
                <li>Direct links to the app for easy submission</li>
                <li>Completely optional - you control your preferences</li>
            </ul>
        </div>
        
        <p><strong>Want to sign up?</strong></p>
        <p style="text-align: center;">
            <a href="${smsOptInUrl}" class="button">Sign Up for SMS Reminders</a>
        </p>
        
        <p><small>Or copy and paste this link: <br><a href="${smsOptInUrl}">${smsOptInUrl}</a></small></p>
        
        <div class="highlight">
            <p><strong>Important:</strong> This is completely opt-in. We will only send SMS messages to users who explicitly sign up for this service. Your phone number will only be used for sandwich collection reminders.</p>
        </div>
        
        <p>Questions? Just reply to this email!</p>
        
        <p>Thanks for all you do,<br>
        <strong>The Sandwich Project Team</strong></p>
        
        ${
          testMode
            ? '<div class="test-notice">[THIS IS A TEST EMAIL - No actual announcement was sent]</div>'
            : ''
        }
    </div>
    
    <div class="footer">
        <p>This email was sent to registered users of The Sandwich Project app.</p>
    </div>
</body>
</html>
`;

      // Send emails
      let successCount = 0;
      let failureCount = 0;
      const errors = [];

      // Use Katie's verified email as sender
      const fromEmail = 'katielong2316@gmail.com';

      for (const user of recipients) {
        try {
          await sendEmail({
            emailStream: 'newsletter',
            to: user.email,
            from: fromEmail,
            subject: subject,
            text: textContent,
            html: htmlContent,
          });
          successCount++;
          logger.log(`✅ SMS announcement sent to ${user.email}`);
        } catch (error) {
          failureCount++;
          errors.push({ email: user.email, error: error.message });
          logger.error(
            `❌ Failed to send SMS announcement to ${user.email}:`,
            error.message
          );
        }
      }

      const result = {
        success: successCount > 0,
        message: testMode
          ? `Test SMS announcement sent: ${successCount}/${recipients.length} successful`
          : `SMS announcement sent: ${successCount}/${recipients.length} successful`,
        successCount,
        failureCount,
        totalRecipients: recipients.length,
        testMode,
        smsOptInUrl,
        errors: errors.length > 0 ? errors : undefined,
      };

      logger.log(`📧 SMS announcement results:`, result);
      res.json(result);
    } catch (error) {
      logger.error('Error sending SMS announcement:', error);
      res.status(500).json({
        error: 'Failed to send SMS announcement',
        message: error.message,
      });
    }
  }
);

export { router as smsAnnouncementRoutes };
