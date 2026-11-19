import { Router } from 'express';
import { z } from 'zod';
import { isAuthenticated } from '../auth';
import { requirePermission } from '../middleware/auth';
import { storage } from '../storage-wrapper';
import { sendEmail } from '../services/sendgrid';
import { logger } from '../utils/production-safe-logger';

const router = Router();

// Test SendGrid configuration endpoint
router.post(
  '/test',
  isAuthenticated,
  requirePermission('USERS_EDIT'),
  async (req, res) => {
    try {
      logger.log('🧪 Testing SendGrid configuration...');

      // Test with user's email
      const testEmail = req.user?.email || 'admin@sandwich.project';

      // Try different "from" addresses to identify the issue
      const fromAddresses = [
        'katielong2316@gmail.com',
        'no-reply@thesandwichproject.org',
        'alerts@thesandwichproject.org',
        'admin@thesandwichproject.org',
      ];

      const results = [];

      for (const fromAddress of fromAddresses) {
        try {
          logger.log(`Testing from address: ${fromAddress}`);
          await sendEmail({
            emailStream: 'newsletter',
            to: testEmail,
            from: fromAddress,
            subject: 'SendGrid Test - TSP Platform',
            text: `This is a test email from ${fromAddress} to verify SendGrid configuration.`,
            html: `<p>This is a test email from <strong>${fromAddress}</strong> to verify SendGrid configuration.</p>`,
          });
          results.push({ from: fromAddress, status: 'success' });
          logger.log(`✅ Success with ${fromAddress}`);
        } catch (error) {
          results.push({
            from: fromAddress,
            status: 'failed',
            error: error.message,
            details: error.response?.body,
          });
          logger.log(`❌ Failed with ${fromAddress}: ${error.message}`);
        }
      }

      res.json({
        success: true,
        message: 'SendGrid test completed',
        results,
        apiKeyConfigured: !!process.env.SENDGRID_API_KEY,
        testRecipient: testEmail,
      });
    } catch (error) {
      logger.error('SendGrid test error:', error);
      res.status(500).json({
        error: 'SendGrid test failed',
        message: error.message,
        apiKeyConfigured: !!process.env.SENDGRID_API_KEY,
      });
    }
  }
);

// Schemas
const sendShoutoutSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  recipientGroup: z.enum([
    'all',
    'super_admins',
    'admins',
    'hosts',
    'volunteers',
    'committee',
    'custom',
  ]),
  templateName: z.string().optional(),
  customRecipients: z.array(z.string()).optional(), // Array of user IDs for custom selection
});

// Send shoutout endpoint
router.post(
  '/send',
  isAuthenticated,
  requirePermission('USERS_EDIT'),
  async (req, res) => {
    try {
      const {
        subject,
        message,
        recipientGroup,
        templateName,
        customRecipients,
      } = sendShoutoutSchema.parse(req.body);

      // Get all users and filter to only active/approved users
      const allUsers = await storage.getAllUsers();
      const activeUsers = allUsers.filter((user) => user.isActive === true);

      // Filter recipients based on group selection
      let recipients: any[] = [];
      switch (recipientGroup) {
        case 'all':
          recipients = activeUsers;
          break;
        case 'super_admins':
          recipients = activeUsers.filter((user) => user.role === 'super_admin');
          break;
        case 'admins':
          recipients = activeUsers.filter((user) => user.role === 'admin');
          break;
        case 'hosts':
          recipients = activeUsers.filter((user) => user.role === 'host');
          break;
        case 'volunteers':
          recipients = activeUsers.filter((user) => user.role === 'volunteer');
          break;
        case 'committee':
          recipients = activeUsers.filter(
            (user) => user.role === 'committee_member'
          );
          break;
        case 'custom':
          if (!customRecipients || customRecipients.length === 0) {
            return res.status(400).json({
              error:
                'Custom recipients list is required when using custom selection',
            });
          }
          recipients = activeUsers.filter((user) =>
            customRecipients.includes(user.id)
          );
          break;
        default:
          recipients = [];
      }

      // Filter out users without email addresses
      const validRecipients = recipients.filter(
        (user) => user.email && user.email.includes('@')
      );

      if (validRecipients.length === 0) {
        return res.status(400).json({
          error: 'No valid email recipients found in the selected group',
        });
      }

      // Send emails to all recipients
      let successCount = 0;
      let failureCount = 0;
      const errors = [];

      // Try different verified sender addresses (prioritize Katie's verified email)
      const verifiedSenders = [
        'katielong2316@gmail.com',
        'no-reply@thesandwichproject.org',
        'alerts@thesandwichproject.org',
        'admin@thesandwichproject.org',
      ];

      let workingSender = null;

      // Test first recipient to find working sender
      if (validRecipients.length > 0) {
        for (const sender of verifiedSenders) {
          try {
            await sendEmail({
              emailStream: 'newsletter',
              to: validRecipients[0].email,
              from: sender,
              subject: subject,
              text: message,
              html: message.replace(/\n/g, '<br>'),
            });
            workingSender = sender;
            successCount++;
            logger.log(`✅ Found working sender: ${sender}`);
            break;
          } catch (error) {
            logger.log(`❌ Failed with sender ${sender}: ${error.message}`);
            if (error.response?.body) {
              logger.error(
                'SendGrid error details:',
                JSON.stringify(error.response.body, null, 2)
              );
              errors.push(
                `Failed to send to ${validRecipients[0].email}: ${
                  error.message
                } (Details: ${JSON.stringify(error.response.body)})`
              );
            } else {
              errors.push(
                `Failed to send to ${validRecipients[0].email}: ${error.message}`
              );
            }
          }
        }
      }

      if (!workingSender) {
        return res.status(500).json({
          error: 'Failed to send shoutout to any recipients',
          details: [
            'No verified sender address is working with SendGrid. Please check SendGrid configuration and sender verification.',
          ],
          debugInfo: errors,
        });
      }

      // Send to remaining recipients using working sender
      for (let i = 1; i < validRecipients.length; i++) {
        const recipient = validRecipients[i];
        try {
          await sendEmail({
            emailStream: 'newsletter',
            to: recipient.email,
            from: workingSender,
            subject: subject,
            text: message,
            html: message.replace(/\n/g, '<br>'),
          });
          successCount++;
        } catch (error) {
          failureCount++;
          errors.push(`Failed to send to ${recipient.email}: ${error.message}`);
          logger.error(
            `Failed to send shoutout to ${recipient.email}:`,
            error
          );
        }
      }

      // Log the shoutout for history
      try {
        await storage.createShoutoutLog({
          templateName: templateName || 'Custom Message',
          subject,
          message,
          recipientCount: validRecipients.length,
          sentAt: new Date().toISOString(),
          status:
            failureCount === 0
              ? 'sent'
              : successCount === 0
                ? 'failed'
                : 'partial',
          sentBy: req.user?.email || 'unknown',
          successCount,
          failureCount,
        });
      } catch (logError) {
        logger.error('Failed to log shoutout:', logError);
        // Don't fail the request if logging fails
      }

      // Create notifications for all recipients who received the kudos
      if (successCount > 0) {
        for (const recipient of validRecipients.slice(0, successCount)) {
          try {
            await storage.createNotification({
              userId: recipient.id,
              type: 'kudos',
              priority: 'low',
              title: subject,
              message: message.substring(0, 200) + (message.length > 200 ? '...' : ''),
              category: 'social',
              actionUrl: '/dashboard',
              actionText: 'View Dashboard',
            });
          } catch (notifError) {
            logger.error(`Failed to create notification for ${recipient.id}:`, notifError);
            // Don't fail if notification creation fails
          }
        }
      }

      // Return result
      if (failureCount === 0) {
        res.json({
          success: true,
          message: `Shoutout sent successfully to ${successCount} recipients`,
          recipientCount: successCount,
        });
      } else if (successCount === 0) {
        res.status(500).json({
          error: 'Failed to send shoutout to any recipients',
          details: errors,
        });
      } else {
        res.json({
          success: true,
          message: `Shoutout sent to ${successCount} recipients, ${failureCount} failed`,
          recipientCount: successCount,
          warnings: errors,
        });
      }
    } catch (error) {
      logger.error('Error sending shoutout:', error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid request data',
          details: error.errors,
        });
      }

      res.status(500).json({
        error: 'Failed to send shoutout',
        message: error.message,
      });
    }
  }
);

// Get shoutout history
router.get(
  '/history',
  isAuthenticated,
  requirePermission('USERS_EDIT'),
  async (req, res) => {
    try {
      const history = await storage.getShoutoutHistory();
      res.json(history);
    } catch (error) {
      logger.error('Error fetching shoutout history:', error);
      res.status(500).json({
        error: 'Failed to fetch shoutout history',
        message: error.message,
      });
    }
  }
);

export default router;
