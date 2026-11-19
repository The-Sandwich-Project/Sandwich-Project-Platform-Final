import { Router } from 'express';
import { isAuthenticated } from '../auth';
import { storage } from '../storage-wrapper';
import { z } from 'zod';
import { generateVerificationCode, sendConfirmationSMS, submitTollFreeVerification, checkTollFreeVerificationStatus } from '../sms-service';
import twilio from 'twilio';
import { logger } from '../utils/production-safe-logger';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { NotificationService } from '../notification-service';
import { getTwilioAuthToken } from '../sms-providers/replit-twilio-connector';
import { db } from '../db';
import { teamBoardItems } from '@shared/schema';
import { parseCollectionSMS, generateConfirmationMessage } from '../services/sms-collection-parser';
import { logApplicationError } from '../services/application-error-logger';
const { validateRequest } = twilio;
// Note: SMS functionality now uses the provider abstraction from sms-service

const router = Router();

// Separate router for Twilio webhooks - NO authentication required
// These endpoints use Twilio signature validation instead of user auth
const webhookRouter = Router();

// Add middleware to log ALL requests to webhook router (for debugging)
// Use logger.info() so it appears in production Winston logs
webhookRouter.use((req, res, next) => {
  logger.info(`📞 WEBHOOK ROUTER: ${req.method} ${req.path}`);
  logger.info(`📞 WEBHOOK ROUTER: Full path ${req.originalUrl}`);
  next();
});

const smsOptInSchema = z.object({
  phoneNumber: z.string().min(1, 'Phone number is required'),
  consent: z.boolean(),
  category: z.enum(['hosts', 'events']).optional().default('hosts'),
});

// Helper to normalize phone numbers for comparison (removes non-digits, handles +1 prefix)
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // Handle US numbers with or without country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+1' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+1' + digits;
  }
  return '+' + digits;
}

// Find user by phone number - checks both smsConsent.phoneNumber AND users.phoneNumber
function findUserByPhone(users: any[], incomingPhone: string): any | undefined {
  const normalizedIncoming = normalizePhone(incomingPhone);
  
  return users.find((user) => {
    // Check SMS consent phone first
    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};
    if (smsConsent.phoneNumber && normalizePhone(smsConsent.phoneNumber) === normalizedIncoming) {
      return true;
    }
    // Fall back to user's direct phoneNumber field
    if (user.phoneNumber && normalizePhone(user.phoneNumber) === normalizedIncoming) {
      return true;
    }
    return false;
  });
}

const smsConfirmationSchema = z.object({
  verificationCode: z.string().min(1, 'Verification code is required'),
});

/**
 * Get user's SMS status
 */
router.get('/users/sms-status', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};
    
    // Determine SMS status based on the new schema
    const status = smsConsent.status || (smsConsent.enabled ? 'confirmed' : 'not_opted_in');
    const hasConfirmedOptIn = status === 'confirmed' && smsConsent.enabled;
    const isPendingConfirmation = status === 'pending_confirmation';
    
    // Get campaign types - support both old single campaignType and new campaignTypes array
    let campaignTypes: string[] = [];
    if (Array.isArray(smsConsent.campaignTypes) && smsConsent.campaignTypes.length > 0) {
      campaignTypes = smsConsent.campaignTypes;
    } else if (smsConsent.campaignType) {
      campaignTypes = [smsConsent.campaignType];
    }
    
    // Check for specific campaign opt-ins
    const hostsOptedIn = hasConfirmedOptIn && campaignTypes.includes('hosts');
    const eventsOptedIn = hasConfirmedOptIn && campaignTypes.includes('events');
    
    // Sync smsAlertsEnabled column if it's out of date
    if (hasConfirmedOptIn && !user.smsAlertsEnabled) {
      storage.updateUser(userId, { smsAlertsEnabled: true }).catch(() => {});
    } else if (!hasConfirmedOptIn && user.smsAlertsEnabled) {
      storage.updateUser(userId, { smsAlertsEnabled: false }).catch(() => {});
    }

    res.json({
      hasOptedIn: hasConfirmedOptIn,
      phoneNumber: smsConsent.phoneNumber || null,
      status: status,
      isPendingConfirmation: isPendingConfirmation,
      hasConfirmedOptIn: hasConfirmedOptIn,
      confirmedAt: smsConsent.confirmedAt || null,
      confirmationMethod: smsConsent.confirmationMethod || null,
      campaignType: smsConsent.campaignType || null, // Legacy single type
      campaignTypes: campaignTypes, // New array format
      hostsOptedIn: hostsOptedIn,
      eventsOptedIn: eventsOptedIn,
    });
  } catch (error) {
    logger.error('Error getting SMS status:', error);
    res.status(500).json({
      error: 'Failed to get SMS status',
      message: (error as Error).message,
    });
  }
});

/**
 * SMS opt-in endpoint
 */
router.post('/users/sms-opt-in', isAuthenticated, async (req, res) => {
  try {
    const { phoneNumber, consent, category } = smsOptInSchema.parse(req.body);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!consent) {
      return res.status(400).json({ error: 'Consent is required for SMS opt-in' });
    }

    // Clean and format phone number
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `+1${cleanPhone}` : cleanPhone;

    // Validate phone number format (basic US phone number validation)
    if (!/^\+1\d{10}$/.test(formattedPhone)) {
      return res.status(400).json({ 
        error: 'Invalid phone number format. Please enter a valid US phone number.' 
      });
    }

    // Get current user
    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate verification code and send confirmation SMS
    const verificationCode = generateVerificationCode();
    const confirmationResult = await sendConfirmationSMS(formattedPhone, verificationCode);

    if (!confirmationResult.success) {
      return res.status(500).json({
        error: 'Failed to send confirmation SMS',
        message: confirmationResult.message,
      });
    }

    // Update user metadata with pending SMS consent
    const updatedMetadata = {
      ...(user.metadata as any || {}),
      smsConsent: {
        status: 'pending_confirmation',
        phoneNumber: formattedPhone,
        verificationCode,
        verificationCodeExpiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
        consentTimestamp: new Date().toISOString(),
        consentVersion: '1.0',
        campaignType: category, // 'hosts' for collection reminders, 'events' for event coordination
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata });

    logger.log(`✅ SMS opt-in successful for user ${user.email} (${formattedPhone}) - campaign: ${category}`);

    res.json({
      success: true,
      message: 'Confirmation SMS sent! Enter the verification code from the text to finish signing up.',
      phoneNumber: formattedPhone,
      status: 'pending_confirmation',
      campaignType: category,
    });
  } catch (error) {
    logger.error('Error processing SMS opt-in:', error);
    
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request data',
        details: (error as any).errors,
      });
    }

    res.status(500).json({
      error: 'Failed to opt in to SMS reminders',
      message: (error as Error).message,
    });
  }
});

/**
 * SMS opt-out endpoint
 */
router.post('/users/sms-opt-out', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get current user
    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get existing smsConsent to preserve campaignType
    const currentMetadata = user.metadata as any || {};
    const existingSmsConsent = currentMetadata.smsConsent || {};

    // Update user metadata to disable SMS consent while preserving campaignType
    const updatedMetadata = {
      ...currentMetadata,
      smsConsent: {
        enabled: false,
        phoneNumber: null,
        optOutTimestamp: new Date().toISOString(),
        campaignType: existingSmsConsent.campaignType,
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata, smsAlertsEnabled: false });

    logger.log(`✅ SMS opt-out successful for user ${user.email}`);

    res.json({
      success: true,
      message: 'Successfully opted out of SMS reminders',
    });
  } catch (error) {
    logger.error('Error processing SMS opt-out:', error);
    res.status(500).json({
      error: 'Failed to opt out of SMS reminders',
      message: (error as Error).message,
    });
  }
});

/**
 * Update SMS campaign types for already confirmed users
 */
const updateCampaignsSchema = z.object({
  campaignTypes: z.array(z.enum(['hosts', 'events'])).min(1, 'At least one campaign type is required'),
});

router.patch('/users/sms-campaigns', isAuthenticated, async (req, res) => {
  try {
    const { campaignTypes } = updateCampaignsSchema.parse(req.body);
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};
    
    // Verify user has confirmed SMS opt-in
    if (smsConsent.status !== 'confirmed' || !smsConsent.enabled) {
      return res.status(400).json({ 
        error: 'You must first confirm SMS opt-in before updating campaign preferences' 
      });
    }

    // Update campaign types
    const updatedMetadata = {
      ...metadata,
      smsConsent: {
        ...smsConsent,
        campaignTypes: campaignTypes,
        campaignType: campaignTypes[0], // Keep legacy field in sync
        campaignsUpdatedAt: new Date().toISOString(),
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata });

    logger.log(`✅ SMS campaign types updated for user ${user.email}: ${campaignTypes.join(', ')}`);

    res.json({
      success: true,
      message: 'SMS campaign preferences updated',
      campaignTypes: campaignTypes,
      hostsOptedIn: campaignTypes.includes('hosts'),
      eventsOptedIn: campaignTypes.includes('events'),
    });
  } catch (error) {
    logger.error('Error updating SMS campaigns:', error);
    
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request',
        details: (error as any).errors,
      });
    }
    
    res.status(500).json({
      error: 'Failed to update SMS campaign preferences',
      message: (error as Error).message,
    });
  }
});

/**
 * Manual SMS confirmation endpoint (for verification codes)
 */
router.post('/users/sms-confirm', isAuthenticated, async (req, res) => {
  try {
    const { verificationCode } = smsConfirmationSchema.parse(req.body);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get current user
    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};

    // Check if user has pending confirmation
    if (smsConsent.status !== 'pending_confirmation') {
      return res.status(400).json({ 
        error: 'No pending SMS confirmation found' 
      });
    }

    // Debug logging for verification code comparison
    logger.log(`🔍 SMS Verification Attempt:`);
    logger.log(`  - User entered: ${verificationCode}`);
    logger.log(`  - Stored code: ${smsConsent.verificationCode}`);
    logger.log(`  - Match: ${smsConsent.verificationCode === verificationCode}`);

    // Check if verification code matches
    if (smsConsent.verificationCode !== verificationCode) {
      logger.error(`❌ Verification code mismatch for ${user.email}`);
      return res.status(400).json({ 
        error: 'Invalid verification code' 
      });
    }

    // Check if verification code has expired
    const expiry = new Date(smsConsent.verificationCodeExpiry);
    if (new Date() > expiry) {
      return res.status(400).json({ 
        error: 'Verification code has expired. Please request a new one.' 
      });
    }

    // Confirm SMS consent and set default notification preferences
    const notificationPreferences = metadata.notificationPreferences || {};

    const updatedMetadata = {
      ...(user.metadata as any || {}),
      smsConsent: {
        ...smsConsent,
        status: 'confirmed',
        enabled: true,
        confirmedAt: new Date().toISOString(),
        confirmationMethod: 'verification_code',
        verificationCode: undefined, // Remove verification code after confirmation
        verificationCodeExpiry: undefined,
        campaignType: smsConsent.campaignType, // Explicitly preserve campaignType
      },
      notificationPreferences: {
        ...notificationPreferences,
        primaryReminderEnabled: true,
        primaryReminderHours: 72,
        primaryReminderType: 'sms',
        secondaryReminderEnabled: notificationPreferences.secondaryReminderEnabled || false,
        secondaryReminderHours: notificationPreferences.secondaryReminderHours || 1,
        secondaryReminderType: notificationPreferences.secondaryReminderType || 'email',
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata, smsAlertsEnabled: true });

    const redactedPhone = smsConsent.phoneNumber ? `***${smsConsent.phoneNumber.slice(-4)}` : 'unknown';
    logger.log(`✅ SMS confirmation successful for user ID: ${userId} (${redactedPhone})`);

    // Re-read user to get fresh data and check if welcome SMS should be sent (prevents race condition)
    const freshUser = await storage.getUserById(userId);
    if (!freshUser) {
      logger.error(`❌ Failed to re-read user ${userId} for welcome SMS check`);
      res.json({
        success: true,
        message: 'SMS notifications confirmed! You will now receive weekly reminders.',
        phoneNumber: smsConsent.phoneNumber,
        status: 'confirmed',
      });
      return;
    }

    const freshMetadata = freshUser.metadata as any || {};
    const freshSmsConsent = freshMetadata.smsConsent || {};
    const hasReceivedWelcome = freshSmsConsent.welcomeSmsSentAt;

    if (!hasReceivedWelcome) {
      try {
        const campaignType = freshSmsConsent.campaignType || 'hosts';
        logger.log(`🔍 Manual confirmation: About to send welcome SMS to ${redactedPhone} for user ID: ${userId} (campaign: ${campaignType})`);

        const { sendWelcomeSMS } = await import('../sms-service');
        const welcomeResult = await sendWelcomeSMS(freshSmsConsent.phoneNumber, campaignType);

        if (welcomeResult.success) {
          logger.log(`✅ Welcome SMS sent to ${redactedPhone} after confirmation`);

          // Mark that welcome SMS has been sent using fresh metadata
          const finalMetadata = {
            ...freshMetadata,
            smsConsent: {
              ...freshSmsConsent,
              welcomeSmsSentAt: new Date().toISOString(),
            },
          };
          await storage.updateUser(userId, { metadata: finalMetadata });
        } else {
          logger.warn(`⚠️ Welcome SMS failed: ${welcomeResult.message}`);
        }
      } catch (smsError) {
        logger.error('Failed to send welcome SMS after confirmation:', smsError);
      }
    } else {
      logger.log(`ℹ️ Skipping welcome SMS - already sent to ${redactedPhone} for user ID: ${userId}`);
    }

    res.json({
      success: true,
      message: 'SMS notifications confirmed! You will now receive weekly reminders.',
      phoneNumber: smsConsent.phoneNumber,
      status: 'confirmed',
    });
  } catch (error) {
    logger.error('Error confirming SMS:', error);
    
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request data',
        details: (error as any).errors,
      });
    }

    res.status(500).json({
      error: 'Failed to confirm SMS',
      message: (error as Error).message,
    });
  }
});

/**
 * Reset SMS opt-in status (clear pending confirmation)
 */
router.post('/users/sms-reset', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};

    // Clear SMS consent data
    const updatedMetadata = {
      ...(user.metadata as any || {}),
      smsConsent: {
        enabled: false,
        status: 'not_opted_in',
        phoneNumber: null,
        verificationCode: undefined,
        verificationCodeExpiry: undefined,
        resetAt: new Date().toISOString(),
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata });

    logger.log(`✅ SMS status reset for user ${user.email}`);

    res.json({
      success: true,
      message: 'SMS opt-in status has been reset. You can now start the opt-in process again.',
    });
  } catch (error) {
    logger.error('Error resetting SMS status:', error);
    res.status(500).json({
      error: 'Failed to reset SMS status',
      message: (error as Error).message,
    });
  }
});

/**
 * Resend SMS verification code
 */
router.post('/users/sms-resend', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = user.metadata as any || {};
    const smsConsent = metadata.smsConsent || {};

    // Check if there's a pending confirmation
    if (smsConsent.status !== 'pending_confirmation') {
      return res.status(400).json({
        error: 'No pending SMS confirmation to resend',
        currentStatus: smsConsent.status || 'not_opted_in'
      });
    }

    const phoneNumber = smsConsent.phoneNumber;
    if (!phoneNumber) {
      return res.status(400).json({
        error: 'No phone number found for pending confirmation'
      });
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();

    // Send new confirmation SMS
    const confirmationResult = await sendConfirmationSMS(phoneNumber, verificationCode);

    if (!confirmationResult.success) {
      return res.status(500).json({
        error: 'Failed to resend confirmation SMS',
        message: confirmationResult.message,
      });
    }

    // Update verification code and expiry
    const updatedMetadata = {
      ...(user.metadata as any || {}),
      smsConsent: {
        ...smsConsent,
        verificationCode,
        verificationCodeExpiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
        lastResendAt: new Date().toISOString(),
      },
    };

    await storage.updateUser(userId, { metadata: updatedMetadata });

    logger.log(`✅ Verification code resent to ${phoneNumber} for user ${user.email}`);

    res.json({
      success: true,
      message: 'New verification code sent! Please check your phone.',
      phoneNumber: phoneNumber,
    });
  } catch (error) {
    logger.error('Error resending verification code:', error);
    res.status(500).json({
      error: 'Failed to resend verification code',
      message: (error as Error).message,
    });
  }
});

/**
 * Test endpoint to verify webhook routing is working
 * This helps debug if Twilio can reach the server
 */
webhookRouter.get('/sms/webhook/test', async (req, res) => {
  logger.log('✅ SMS Webhook test endpoint hit');
  res.json({ 
    status: 'ok', 
    message: 'SMS webhook endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

/**
 * Twilio webhook endpoint for incoming SMS messages
 * SECURITY: Validates Twilio request signature to prevent spoofing
 * NOTE: This is on webhookRouter (not router) - NO auth middleware, just Twilio signature validation
 * 
 * Twilio sends webhooks as application/x-www-form-urlencoded
 * The webhook URL should be: https://your-domain.com/api/sms/webhook
 */
webhookRouter.post('/sms/webhook', async (req, res) => {
  // CRITICAL: Use logger.info() so it appears in production logs (Winston)
  // logger.log() is development-only and won't show in Replit production logs
  logger.info('🔔🔔🔔 SMS WEBHOOK POST REQUEST RECEIVED 🔔🔔🔔');
  logger.info('🔔 SMS WEBHOOK HIT - Request received');
  logger.info(`🔔 Method: ${req.method}`);
  logger.info(`🔔 Path: ${req.path}`);
  logger.info(`🔔 Original URL: ${req.originalUrl}`);
  logger.info(`🔔 Base URL: ${req.baseUrl}`);
  logger.info(`🔔 Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  logger.info(`🔔 Headers: host=${req.get('host')}, x-forwarded-proto=${req.get('x-forwarded-proto')}`);
  logger.info(`🔔 Content-Type: ${req.get('content-type')}`);
  logger.info(`🔔 User-Agent: ${req.get('user-agent')}`);
  logger.info(`🔔 IP: ${req.ip}`);
  logger.info(`🔔 Body keys: ${Object.keys(req.body || {}).join(', ')}`);
  if (req.body && Object.keys(req.body).length > 0) {
    logger.info(`🔔 Body sample: ${JSON.stringify(req.body).substring(0, 500)}`);
  } else {
    logger.info(`🔔 Body is empty or not parsed`);
  }
  
  try {
    // SECURITY VALIDATION: Verify Twilio request signature
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    
    if (!twilioSignature) {
      logger.warn('⚠️ SECURITY VIOLATION: SMS webhook request missing X-Twilio-Signature header');
      return res.status(403).json({ error: 'Forbidden: Missing signature' });
    }

    // Get auth token from environment or Replit connector
    const authToken = await getTwilioAuthToken();
    if (!authToken) {
      logger.error('❌ SECURITY ERROR: No Twilio auth token available for webhook validation');
      logger.error('   Set TWILIO_AUTH_TOKEN in environment/secrets, or ensure Replit Twilio connection provides auth_token');
      return res.status(500).json({ error: 'Server configuration error: Missing auth token for webhook validation' });
    }

    // DEBUG: Log auth token info (first 4 chars only for security)
    logger.log(`🔔 Auth token configured: ${authToken.substring(0, 4)}...${authToken.substring(authToken.length - 4)}`);
    
    // Construct the full webhook URL that matches Twilio console configuration
    // Use x-forwarded-proto header for proxy environments (Replit, Heroku, etc.)
    // SSL terminates at the proxy level, so req.secure is false even for HTTPS connections
    // Handle comma-separated values in x-forwarded-proto (e.g., "https, http")
    const forwardedProto = req.get('x-forwarded-proto');
    const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : (req.secure ? 'https' : 'http');
    const host = req.get('host');
    // Use only the path portion (originalUrl may include query string which should be included)
    const webhookUrl = `${protocol}://${host}${req.originalUrl}`;

    // DEBUG: Log the URL being used for validation
    logger.log(`🔔 Validating signature with URL: ${webhookUrl}`);
    logger.log(`🔔 Expected Twilio webhook URL should be: https://sandwich-project-platform-final-katielong2316.replit.app/api/sms/webhook`);
    
    // Validate the Twilio request signature
    const isValidRequest = validateRequest(
      authToken,
      twilioSignature,
      webhookUrl,
      req.body
    );
    
    if (!isValidRequest) {
      logger.warn(`⚠️ SECURITY VIOLATION: Invalid Twilio signature for webhook request from ${req.ip}`);
      logger.warn(`Attempted URL: ${webhookUrl}`);
      logger.warn(`Signature: ${twilioSignature}`);
      logger.warn(`Auth token prefix: ${authToken.substring(0, 4)}...`);
      logger.warn(`x-forwarded-proto: ${forwardedProto}`);
      logger.warn(`host header: ${host}`);
      logger.warn(`originalUrl: ${req.originalUrl}`);
      logger.warn(`Body keys: ${Object.keys(req.body || {}).join(', ')}`);
      logger.warn(`🔧 TROUBLESHOOTING: Ensure TWILIO_AUTH_TOKEN is set to your Twilio Auth Token (not API Key Secret)`);
      logger.warn(`   You can find your Auth Token in Twilio Console > Account > API keys and tokens`);
      return res.status(403).json({ error: 'Forbidden: Invalid signature' });
    }
    
    logger.log('✅ SECURITY: Twilio webhook signature validated successfully');
    
    const { Body, From, NumMedia, MediaUrl0, MediaContentType0 } = req.body;
    
    if (!From) {
      return res.status(400).send('Missing required parameters');
    }

    const phoneNumber = From;
    const redactedPhone = phoneNumber ? `***${phoneNumber.slice(-4)}` : 'unknown';

    // Check if this is an MMS with an image (sign-in sheet photo)
    const numMedia = parseInt(NumMedia || '0', 10);
    if (numMedia > 0 && MediaUrl0) {
      logger.info(`📷 Received MMS image from ${redactedPhone} (${numMedia} media item(s))`);
      
      try {
        // Download the image from Twilio's MediaUrl
        const mediaResponse = await fetch(MediaUrl0, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${await getTwilioAuthToken()}`).toString('base64')}`,
          },
        });

        if (!mediaResponse.ok) {
          throw new Error(`Failed to download image: ${mediaResponse.status} ${mediaResponse.statusText}`);
        }

        const imageBuffer = await mediaResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const mimeType = MediaContentType0 || 'image/jpeg';

        logger.info(`✅ Downloaded image from Twilio (${imageBuffer.byteLength} bytes, type: ${mimeType})`);

        // Parse location and date from text message if provided
        let textLocation: string | null = null;
        let textDate: string | null = null;
        
        if (Body && Body.trim()) {
          // Import date parsing function from collection parser
          const { parseDateFromText } = await import('../services/sms-collection-parser');
          const dateParseResult = parseDateFromText(Body.trim());
          textDate = dateParseResult.date;
          
          // Extract location from remaining text (everything that's not a date)
          const locationText = dateParseResult.remainingText
            .replace(/^(log|logged|made|collected|we made|we collected|just made|just collected)\s*/i, '')
            .replace(/\s*(sandwiches?|sammies|sammiches)\s*/gi, ' ')
            .replace(/\s*(today|this morning|this afternoon|tonight)\s*/gi, ' ')
            .trim();
          
          if (locationText.length > 0 && !/^\d+$/.test(locationText)) {
            // Only use as location if it's not just a number
            textLocation = locationText;
            logger.info(`📍 Extracted location from text: "${textLocation}", date: "${textDate}"`);
          }
        }

        // Parse the sign-in sheet using the existing parser (use text as context hint)
        const { parseSignInSheetBase64 } = await import('../services/signin-sheet-parser');
        const contextHint = Body && Body.trim() ? Body.trim() : undefined;
        const parseResult = await parseSignInSheetBase64(base64Image, mimeType, contextHint);

        if (!parseResult.success || parseResult.entries.length === 0) {
          logger.warn(`⚠️ Failed to parse sign-in sheet image from ${redactedPhone}`);
          res.type('text/xml');
          return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, I couldn't read the sign-in sheet. Please make sure the photo is clear and shows the full sheet. Try again or log in to upload it.</Message></Response>`);
        }

        logger.info(`✅ Parsed sign-in sheet: ${parseResult.entries.length} entries, ${parseResult.totalSandwiches} total sandwiches`);

        // Find user by phone number
        const allUsers = await storage.getAllUsers();
        const senderUser = findUserByPhone(allUsers, phoneNumber);

        // Get all hosts for matching
        const allHosts = await storage.getAllHosts();

        // Create collections for each parsed entry
        const createdCollections = [];
        for (const entry of parseResult.entries) {
          // Use text-provided location if available, otherwise use image-extracted location
          const locationToUse = textLocation || entry.location;
          
          // Use text-provided date if available, otherwise use entry date, then suggested date
          const dateToUse = textDate || entry.date || parseResult.suggestedDate || new Date().toISOString().split('T')[0];
          
          // Try to match host location
          let matchedHostId: number | null = null;
          let matchedHostName = locationToUse;

          if (allHosts.length > 0) {
            const inputLower = entry.location.toLowerCase().trim();
            const getSegments = (text: string) => text.toLowerCase().split(/[\s\/\-]+/).filter(w => w.length > 2);
            const inputSegments = getSegments(entry.location);
            let bestMatch: { host: any; score: number } | null = null;

            for (const host of allHosts) {
              const hostLower = host.name.toLowerCase().trim();
              const hostSegments = getSegments(host.name);

              if (hostLower === inputLower) {
                bestMatch = { host, score: 1.0 };
                break;
              }

              if (hostSegments.some(seg => seg === inputLower || inputLower.includes(seg))) {
                const score = 0.95;
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
                continue;
              }

              if (hostLower.includes(inputLower) || inputLower.includes(hostLower)) {
                const score = Math.min(inputLower.length, hostLower.length) / Math.max(inputLower.length, hostLower.length);
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
              }

              const commonSegments = inputSegments.filter(seg =>
                hostSegments.some(hs => hs.includes(seg) || seg.includes(hs))
              );
              if (commonSegments.length > 0) {
                const score = commonSegments.length / Math.max(inputSegments.length, hostSegments.length) * 0.9;
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
              }
            }

            if (bestMatch && bestMatch.score >= 0.5) {
              matchedHostId = bestMatch.host.id;
              matchedHostName = bestMatch.host.name;
            }
          }

          // Build collection data
          const collectionData: any = {
            collectionDate: dateToUse,
            hostName: matchedHostName,
            hostId: matchedHostId,
            individualSandwiches: entry.sandwichCount,
            createdBy: senderUser?.id || 'sms-system',
            createdByName: senderUser
              ? (senderUser.firstName && senderUser.lastName
                  ? `${senderUser.firstName} ${senderUser.lastName} (via SMS photo)`
                  : senderUser.firstName
                    ? `${senderUser.firstName} (via SMS photo)`
                    : senderUser.email
                      ? `${senderUser.email} (via SMS photo)`
                      : `SMS: ${redactedPhone}`)
              : `SMS: ${redactedPhone}`,
            submissionMethod: 'sms-photo',
          };

          const collection = await storage.createSandwichCollection(collectionData);
          createdCollections.push(collection);
          logger.info(`✅ Collection created from SMS photo: ID ${collection.id}, ${entry.sandwichCount} sandwiches at ${matchedHostName}`);
        }

        // Send confirmation message
        const totalSandwiches = parseResult.totalSandwiches;
        const entryCount = parseResult.entries.length;
        const locationDisplay = textLocation || (entryCount === 1 ? parseResult.entries[0].location : 'multiple locations');
        const confirmationMsg = entryCount === 1
          ? `✅ Logged ${totalSandwiches} sandwiches at ${locationDisplay} from your photo!`
          : `✅ Logged ${entryCount} entries (${totalSandwiches} total sandwiches) at ${locationDisplay} from your photo!`;

        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${confirmationMsg}</Message></Response>`);
      } catch (imageError) {
        logger.error('❌ Error processing MMS image:', imageError);
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, I couldn't process the photo. Please make sure it's a clear image of a sign-in sheet, or try logging in to upload it.</Message></Response>`);
      }
    }

    // Handle text-only messages (existing logic)
    if (!Body) {
      return res.status(400).send('Missing required parameters');
    }

    const messageBody = Body.trim().toUpperCase();

    logger.log(`📱 Received SMS from ${redactedPhone}: "${Body}"`);

    // Check if message is "YES" confirmation
    if (messageBody === 'YES') {
      // Redact phone number for logging (show last 4 digits only)
      const redactedPhone = phoneNumber ? `***${phoneNumber.slice(-4)}` : 'unknown';
      logger.log(`🔍 YES confirmation received from ${redactedPhone}`);

      // Find user with this phone number and pending confirmation
      const allUsers = await storage.getAllUsers();

      // Check for duplicate phone numbers (potential bug)
      const usersWithThisPhone = allUsers.filter((user) => {
        const metadata = user.metadata as any || {};
        const smsConsent = metadata.smsConsent || {};
        return smsConsent.phoneNumber === phoneNumber;
      });

      if (usersWithThisPhone.length > 1) {
        logger.warn(`⚠️ POTENTIAL BUG: Found ${usersWithThisPhone.length} users with phone ${redactedPhone}`);
        logger.warn(`  User IDs: ${usersWithThisPhone.map(u => u.id).join(', ')}`);
      }

      const userWithPendingConfirmation = allUsers.find((user) => {
        const metadata = user.metadata as any || {};
        const smsConsent = metadata.smsConsent || {};
        return (
          smsConsent.status === 'pending_confirmation' &&
          smsConsent.phoneNumber === phoneNumber
        );
      });

      if (!userWithPendingConfirmation) {
        logger.log(`❌ No pending confirmation found for ${redactedPhone}`);
        // Return TwiML response with no message (empty response)
        res.type('text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      logger.log(`✅ Matched user ID: ${userWithPendingConfirmation.id} with phone: ${redactedPhone}`);

      // Confirm SMS consent via YES reply
      const metadata = userWithPendingConfirmation.metadata as any || {};
      const smsConsent = metadata.smsConsent || {};
      const notificationPreferences = metadata.notificationPreferences || {};
      
      // Set default notification preferences: 72 hours before event with SMS
      const updatedMetadata = {
        ...(userWithPendingConfirmation.metadata as any || {}),
        smsConsent: {
          ...smsConsent,
          status: 'confirmed',
          enabled: true,
          confirmedAt: new Date().toISOString(),
          confirmationMethod: 'sms_reply',
          verificationCode: undefined,
          verificationCodeExpiry: undefined,
        },
        notificationPreferences: {
          ...notificationPreferences,
          primaryReminderEnabled: true,
          primaryReminderHours: 72,
          primaryReminderType: 'sms',
          secondaryReminderEnabled: notificationPreferences.secondaryReminderEnabled || false,
          secondaryReminderHours: notificationPreferences.secondaryReminderHours || 1,
          secondaryReminderType: notificationPreferences.secondaryReminderType || 'email',
        },
      };

      await storage.updateUser(userWithPendingConfirmation.id, { metadata: updatedMetadata, smsAlertsEnabled: true });

      logger.log(`✅ SMS confirmation via YES reply successful for user ID: ${userWithPendingConfirmation.id} (${redactedPhone})`);

      // Re-read user to get fresh data and check if welcome SMS should be sent (prevents race condition)
      const freshUser = await storage.getUserById(userWithPendingConfirmation.id);
      if (!freshUser) {
        logger.error(`❌ Failed to re-read user ${userWithPendingConfirmation.id} for welcome SMS check`);
        res.type('text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      const freshMetadata = freshUser.metadata as any || {};
      const freshSmsConsent = freshMetadata.smsConsent || {};
      const hasReceivedWelcome = freshSmsConsent.welcomeSmsSentAt;

      if (!hasReceivedWelcome) {
        try {
          const campaignType = freshSmsConsent.campaignType || 'hosts';
          const { sendWelcomeSMS } = await import('../sms-service');
          const welcomeResult = await sendWelcomeSMS(freshSmsConsent.phoneNumber, campaignType);

          if (welcomeResult.success) {
            logger.log(`✅ Welcome SMS sent to ${redactedPhone} after YES confirmation (campaign: ${campaignType})`);

            // Mark that welcome SMS has been sent using fresh metadata
            const finalMetadata = {
              ...freshMetadata,
              smsConsent: {
                ...freshSmsConsent,
                welcomeSmsSentAt: new Date().toISOString(),
              },
            };
            await storage.updateUser(userWithPendingConfirmation.id, { metadata: finalMetadata });
          } else {
            logger.warn(`⚠️ Welcome SMS failed: ${welcomeResult.message}`);
          }
        } catch (smsError) {
          logger.error('Failed to send welcome SMS after YES confirmation:', smsError);
        }
      } else {
        logger.log(`ℹ️ Skipping welcome SMS - already sent to ${redactedPhone} for user ID: ${userWithPendingConfirmation.id}`);
      }
      
      // Return empty TwiML response (don't send duplicate message)
      res.type('text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } 
    // Check if message is a verification code
    else if (/^\d{6}$/.test(messageBody)) {
      // Redact phone number for logging (show last 4 digits only)
      const redactedPhone = phoneNumber ? `***${phoneNumber.slice(-4)}` : 'unknown';
      logger.log(`🔍 Verification code received from ${redactedPhone}`);

      // Find user with this phone number and matching verification code
      const allUsers = await storage.getAllUsers();

      // Check for duplicate phone numbers (potential bug)
      const usersWithThisPhone = allUsers.filter((user) => {
        const metadata = user.metadata as any || {};
        const smsConsent = metadata.smsConsent || {};
        return smsConsent.phoneNumber === phoneNumber;
      });

      if (usersWithThisPhone.length > 1) {
        logger.warn(`⚠️ POTENTIAL BUG: Found ${usersWithThisPhone.length} users with phone ${redactedPhone}`);
        logger.warn(`  User IDs: ${usersWithThisPhone.map(u => u.id).join(', ')}`);
      }

      const userWithMatchingCode = allUsers.find((user) => {
        const metadata = user.metadata as any || {};
        const smsConsent = metadata.smsConsent || {};
        return (
          smsConsent.status === 'pending_confirmation' &&
          smsConsent.phoneNumber === phoneNumber &&
          smsConsent.verificationCode === messageBody
        );
      });

      if (!userWithMatchingCode) {
        logger.log(`❌ No matching verification code found for ${redactedPhone}`);
        res.type('text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      logger.log(`✅ Matched user ID: ${userWithMatchingCode.id} with phone: ${redactedPhone}`);

      // Check expiry
      const metadata = userWithMatchingCode.metadata as any || {};
      const smsConsent = metadata.smsConsent || {};
      const expiry = new Date(smsConsent.verificationCodeExpiry);
      
      if (new Date() > expiry) {
        logger.log(`❌ Verification code expired for ${phoneNumber}`);
        res.type('text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      // Confirm SMS consent via verification code
      const metadata2 = userWithMatchingCode.metadata as any || {};
      const notificationPreferences2 = metadata2.notificationPreferences || {};
      
      // Set default notification preferences: 72 hours before event with SMS
      const updatedMetadata = {
        ...(userWithMatchingCode.metadata as any || {}),
        smsConsent: {
          ...smsConsent,
          status: 'confirmed',
          enabled: true,
          confirmedAt: new Date().toISOString(),
          confirmationMethod: 'verification_code',
          verificationCode: undefined,
          verificationCodeExpiry: undefined,
        },
        notificationPreferences: {
          ...notificationPreferences2,
          primaryReminderEnabled: true,
          primaryReminderHours: 72,
          primaryReminderType: 'sms',
          secondaryReminderEnabled: notificationPreferences2.secondaryReminderEnabled || false,
          secondaryReminderHours: notificationPreferences2.secondaryReminderHours || 1,
          secondaryReminderType: notificationPreferences2.secondaryReminderType || 'email',
        },
      };

      await storage.updateUser(userWithMatchingCode.id, { metadata: updatedMetadata, smsAlertsEnabled: true });

      logger.log(`✅ SMS confirmation via verification code successful for user ID: ${userWithMatchingCode.id} (${redactedPhone})`);

      // Re-read user to get fresh data and check if welcome SMS should be sent (prevents race condition)
      const freshUser = await storage.getUserById(userWithMatchingCode.id);
      if (!freshUser) {
        logger.error(`❌ Failed to re-read user ${userWithMatchingCode.id} for welcome SMS check`);
        res.type('text/xml');
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      const freshMetadata = freshUser.metadata as any || {};
      const freshSmsConsent = freshMetadata.smsConsent || {};
      const hasReceivedWelcome = freshSmsConsent.welcomeSmsSentAt;

      if (!hasReceivedWelcome) {
        try {
          const campaignType = freshSmsConsent.campaignType || 'hosts';
          const { sendWelcomeSMS } = await import('../sms-service');
          const welcomeResult = await sendWelcomeSMS(freshSmsConsent.phoneNumber, campaignType);

          if (welcomeResult.success) {
            logger.log(`✅ Welcome SMS sent to ${redactedPhone} after code confirmation (campaign: ${campaignType})`);

            // Mark that welcome SMS has been sent using fresh metadata
            const finalMetadata = {
              ...freshMetadata,
              smsConsent: {
                ...freshSmsConsent,
                welcomeSmsSentAt: new Date().toISOString(),
              },
            };
            await storage.updateUser(userWithMatchingCode.id, { metadata: finalMetadata });
          } else {
            logger.warn(`⚠️ Welcome SMS failed: ${welcomeResult.message}`);
          }
        } catch (smsError) {
          logger.error('Failed to send welcome SMS after code confirmation:', smsError);
        }
      } else {
        logger.log(`ℹ️ Skipping welcome SMS - already sent to ${redactedPhone} for user ID: ${userWithMatchingCode.id}`);
      }
      
      // Return empty TwiML response
      res.type('text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    // Handle STOP/UNSUBSCRIBE messages
    else if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(messageBody)) {
      logger.log(`🛑 STOP request received from ${redactedPhone}`);
      // Twilio handles STOP automatically, just log it
      res.type('text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    // Handle IDEA submissions for Holding Zone
    else if (messageBody.startsWith('IDEA ') || messageBody.startsWith('IDEA:')) {
      logger.info(`💡 Holding Zone idea received from ${redactedPhone}`);

      // Extract the idea content (remove "IDEA " or "IDEA:" prefix)
      const ideaContent = Body.trim().replace(/^IDEA[:\s]+/i, '').trim();

      if (ideaContent.length < 3) {
        logger.info(`❌ Idea too short from ${redactedPhone}`);
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Your idea is too short. Please text: IDEA followed by your suggestion (at least 3 characters).</Message></Response>`);
      }

      try {
        // Find user by phone number to attribute the idea
        const allUsers = await storage.getAllUsers();
        // Find user by phone - checks both SMS consent phone AND user's stored phone number
        const senderUser = findUserByPhone(allUsers, phoneNumber);

        // Ensure createdByName is never empty (required field)
        // Format: "Name (via SMS)" or "SMS: ***1234" if no user found
        let createdByName = `SMS: ${redactedPhone}`;
        if (senderUser) {
          if (senderUser.firstName && senderUser.lastName) {
            createdByName = `${senderUser.firstName} ${senderUser.lastName} (via SMS)`;
          } else if (senderUser.firstName) {
            createdByName = `${senderUser.firstName} (via SMS)`;
          } else if (senderUser.email) {
            createdByName = `${senderUser.email} (via SMS)`;
          }
        }

        // Use a valid user ID or generate a system ID
        // The database requires createdBy to be a string, so we'll use a system identifier
        const createdBy = senderUser?.id || 'sms-system';

        logger.info(`📝 Creating Holding Zone item from SMS:`, {
          phone: redactedPhone,
          createdBy,
          createdByName,
          contentLength: ideaContent.length,
        });

        // Create holding zone item using the correct schema
        // Don't store JSON in details - details is for user-visible information
        // The SMS source info is already in createdByName, so details can be null
        const [holdingZoneItem] = await db
          .insert(teamBoardItems)
          .values({
            content: ideaContent,
            type: 'idea',
            createdBy: createdBy,
            createdByName: createdByName, // This will show "Name (via SMS)" or "SMS: ***1234"
            status: 'open',
            assignedTo: null,
            assignedToNames: null,
            completedAt: null,
            categoryId: null,
            isUrgent: false,
            isPrivate: false,
            details: null, // Leave details empty - SMS metadata is in createdByName
            dueDate: null,
          })
          .returning();

        logger.info(`✅ Holding Zone item created from SMS: ${holdingZoneItem.id}`);

        // Send confirmation
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks! Your idea has been added to the TSP Holding Zone. 🥪</Message></Response>`);
      } catch (createError) {
        logger.error('❌ Failed to create Holding Zone item from SMS');
        logger.error('Error type:', createError instanceof Error ? createError.constructor.name : typeof createError);
        logger.error('Error message:', createError instanceof Error ? createError.message : String(createError));
        if (createError instanceof Error && createError.stack) {
          logger.error('Error stack:', createError.stack);
        }
        // Log the full error object if it has additional properties
        if (createError && typeof createError === 'object') {
          logger.error('Error object:', JSON.stringify(createError, Object.getOwnPropertyNames(createError)));
        }
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, we couldn't save your idea right now. Please try again later or submit through the app.</Message></Response>`);
      }
    }
    // Handle LOG submissions for Collection Log
    else if (messageBody.startsWith('LOG ') || messageBody.startsWith('LOG:')) {
      logger.info(`📊 Collection log received from ${redactedPhone}`);

      try {
        // Parse the collection message using AI-powered parser
        const parseResult = await parseCollectionSMS(Body.trim());

        if (!parseResult.success || !parseResult.data) {
          logger.info(`❌ Failed to parse collection from ${redactedPhone}: ${parseResult.error}`);
          res.type('text/xml');
          return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${parseResult.error || 'Could not parse message. Try: LOG [count] [location name]'}</Message></Response>`);
        }

        const parsedData = parseResult.data;
        logger.info(`✅ Parsed collection: ${parsedData.individualSandwiches} sandwiches at ${parsedData.hostName} for ${parsedData.collectionDate}`);

        // Default collection date to the most recent Wednesday (including today if Wednesday) when message looks like a weekly count
        const computeMostRecentWednesday = (date: Date) => {
          const d = new Date(date);
          const day = d.getDay(); // 0=Sun, 3=Wed
          const diff = day >= 3 ? day - 3 : day + 4; // days to subtract
          d.setDate(d.getDate() - diff);
          return d.toISOString().split('T')[0];
        };
        const isWeeklyCount = /weekly\s+count/i.test(Body);
        const fallbackWednesday = computeMostRecentWednesday(new Date());

        // Find user by phone number to attribute the collection
        const allUsers = await storage.getAllUsers();
        // Find user by phone - checks both SMS consent phone AND user's stored phone number
        const senderUser = findUserByPhone(allUsers, phoneNumber);

        // Try to match host to existing host in database (fuzzy matching)
        const allHosts = await storage.getAllHosts();
        let matchedHostId: number | null = null;
        let matchedHostName = parsedData.hostName;
        
        // Helper to split text into segments (by whitespace, slashes, dashes)
        const getSegments = (text: string) => text.toLowerCase().split(/[\s\/\-]+/).filter(w => w.length > 2);
        
        if (allHosts.length > 0) {
          const inputLower = parsedData.hostName.toLowerCase().trim();
          const inputSegments = getSegments(parsedData.hostName);
          let bestMatch: { host: any; score: number } | null = null;
          
          for (const host of allHosts) {
            const hostLower = host.name.toLowerCase().trim();
            const hostSegments = getSegments(host.name);
            
            // Exact match
            if (hostLower === inputLower) {
              bestMatch = { host, score: 1.0 };
              break;
            }
            
            // Check if input matches any segment exactly (e.g., "dunwoody" matches "Dunwoody/PTC")
            if (hostSegments.some(seg => seg === inputLower || inputLower.includes(seg))) {
              const score = 0.95;
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { host, score };
              }
              continue;
            }
            
            // Contains match
            if (hostLower.includes(inputLower) || inputLower.includes(hostLower)) {
              const score = Math.min(inputLower.length, hostLower.length) / Math.max(inputLower.length, hostLower.length);
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { host, score };
              }
            }
            
            // Segment overlap match (handles "dunwoody/PTC", "Intown/Kirkwood", etc.)
            const commonSegments = inputSegments.filter(seg => 
              hostSegments.some(hs => hs.includes(seg) || seg.includes(hs))
            );
            if (commonSegments.length > 0) {
              const score = commonSegments.length / Math.max(inputSegments.length, hostSegments.length) * 0.9;
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { host, score };
              }
            }
          }
          
          // Use match if confidence is reasonable (> 0.5)
          if (bestMatch && bestMatch.score >= 0.5) {
            matchedHostId = bestMatch.host.id;
            matchedHostName = bestMatch.host.name; // Use canonical host name
            logger.info(`📍 Matched host "${parsedData.hostName}" to existing host: "${matchedHostName}" (ID: ${matchedHostId}, score: ${bestMatch.score.toFixed(2)})`);
          } else {
            logger.info(`📍 No close host match found for "${parsedData.hostName}" - will use as-is`);
          }
        }

        // Build collection data
        const collectionData: any = {
          collectionDate: parsedData.collectionDate || (isWeeklyCount ? fallbackWednesday : new Date().toISOString().split('T')[0]),
          hostName: matchedHostName,
          hostId: matchedHostId,
          individualSandwiches: parsedData.individualSandwiches,
          createdBy: senderUser?.id || 'sms-system',
          createdByName: senderUser
            ? (senderUser.firstName && senderUser.lastName
                ? `${senderUser.firstName} ${senderUser.lastName} (via SMS)`
                : senderUser.firstName
                  ? `${senderUser.firstName} (via SMS)`
                  : senderUser.email
                    ? `${senderUser.email} (via SMS)`
                    : `SMS: ${redactedPhone}`)
            : `SMS: ${redactedPhone}`,
        };

        // Add sandwich type breakdowns if provided
        if (parsedData.individualDeli) collectionData.individualDeli = parsedData.individualDeli;
        if (parsedData.individualTurkey) collectionData.individualTurkey = parsedData.individualTurkey;
        if (parsedData.individualHam) collectionData.individualHam = parsedData.individualHam;
        if (parsedData.individualPbj) collectionData.individualPbj = parsedData.individualPbj;
        if (parsedData.individualGeneric) collectionData.individualGeneric = parsedData.individualGeneric;

        // Add group collections if provided
        if (parsedData.groupCollections && parsedData.groupCollections.length > 0) {
          collectionData.groupCollections = parsedData.groupCollections;
          // Set legacy fields for first two groups
          if (parsedData.groupCollections[0]) {
            collectionData.group1Name = parsedData.groupCollections[0].name;
            collectionData.group1Count = parsedData.groupCollections[0].count;
          }
          if (parsedData.groupCollections[1]) {
            collectionData.group2Name = parsedData.groupCollections[1].name;
            collectionData.group2Count = parsedData.groupCollections[1].count;
          }
        }

        // Create the collection
        const collection = await storage.createSandwichCollection(collectionData);
        logger.info(`✅ Collection created from SMS: ID ${collection.id}, ${parsedData.individualSandwiches} sandwiches at ${matchedHostName} for ${collectionData.collectionDate}`);

        // Generate and send confirmation message (include matched host name if different)
        const confirmationMsg = generateConfirmationMessage(parsedData, matchedHostId ? matchedHostName : undefined);
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${confirmationMsg}</Message></Response>`);
      } catch (createError) {
        logger.error('❌ Failed to create collection from SMS');
        logger.error('Error:', createError instanceof Error ? createError.message : String(createError));
        logApplicationError({
          source: 'sms_webhook',
          severity: 'error',
          category: 'collection_save',
          message: createError instanceof Error ? createError.message : 'Failed to save SMS collection',
          details: { bodyPreview: Body?.slice(0, 200) },
          phoneNumber: redactedPhone,
          requestPath: '/api/sms/webhook',
          notifyAdmin: true,
        });
        res.type('text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, we couldn't save your collection right now. Please try again or log in to the app.</Message></Response>`);
      }
    }
    // Handle natural language collection messages (AI-powered parsing)
    // Check if message looks like it might be a sandwich collection log:
    // - Contains a number (count)
    // - Has some text (location name)
    // - Or contains keywords like "sandwiches", "made", location names
    else if (
      (/\d+/.test(Body.trim()) && Body.trim().length >= 5) || // Has a number and some content
      /\b(dunwoody|intown|kirkwood|ptc|downtown|first baptist|made|sandwiches?|pbj|deli|ham|turkey)\b/i.test(Body.trim()) // Contains collection keywords
    ) {
      logger.info(`📊 Potential collection log (natural language) from ${redactedPhone}: "${Body}"`);

      try {
        // Parse the collection message using AI-powered parser
        const parseResult = await parseCollectionSMS(Body.trim());

        // Only process if high confidence parse
        if (parseResult.success && parseResult.data && parseResult.data.confidence >= 0.7) {
          const parsedData = parseResult.data;
          logger.info(`✅ AI parsed collection (confidence: ${parsedData.confidence}): ${parsedData.individualSandwiches} sandwiches at ${parsedData.hostName} for ${parsedData.collectionDate}`);

          // Find user by phone number - checks both SMS consent phone AND user's stored phone number
          const allUsers = await storage.getAllUsers();
          const senderUser = findUserByPhone(allUsers, phoneNumber);

          // Try to match host to existing host in database (fuzzy matching)
          const allHosts = await storage.getAllHosts();
          let matchedHostId: number | null = null;
          let matchedHostName = parsedData.hostName;
          
          // Helper to split text into segments (by whitespace, slashes, dashes)
          const getSegments = (text: string) => text.toLowerCase().split(/[\s\/\-]+/).filter(w => w.length > 2);
          
          if (allHosts.length > 0) {
            const inputLower = parsedData.hostName.toLowerCase().trim();
            const inputSegments = getSegments(parsedData.hostName);
            let bestMatch: { host: any; score: number } | null = null;
            
            for (const host of allHosts) {
              const hostLower = host.name.toLowerCase().trim();
              const hostSegments = getSegments(host.name);
              
              // Exact match
              if (hostLower === inputLower) {
                bestMatch = { host, score: 1.0 };
                break;
              }
              
              // Check if input matches any segment exactly (e.g., "dunwoody" matches "Dunwoody/PTC")
              if (hostSegments.some(seg => seg === inputLower || inputLower.includes(seg))) {
                const score = 0.95;
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
                continue;
              }
              
              // Contains match
              if (hostLower.includes(inputLower) || inputLower.includes(hostLower)) {
                const score = Math.min(inputLower.length, hostLower.length) / Math.max(inputLower.length, hostLower.length);
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
              }
              
              // Segment overlap match (handles "dunwoody/PTC", "Intown/Kirkwood", etc.)
              const commonSegments = inputSegments.filter(seg => 
                hostSegments.some(hs => hs.includes(seg) || seg.includes(hs))
              );
              if (commonSegments.length > 0) {
                const score = commonSegments.length / Math.max(inputSegments.length, hostSegments.length) * 0.9;
                if (!bestMatch || score > bestMatch.score) {
                  bestMatch = { host, score };
                }
              }
            }
            
            if (bestMatch && bestMatch.score >= 0.5) {
              matchedHostId = bestMatch.host.id;
              matchedHostName = bestMatch.host.name;
              logger.info(`📍 Matched host "${parsedData.hostName}" to existing host: "${matchedHostName}" (ID: ${matchedHostId})`);
            }
          }

          // Build collection data
          const collectionData: any = {
            collectionDate: parsedData.collectionDate,
            hostName: matchedHostName,
            hostId: matchedHostId,
            individualSandwiches: parsedData.individualSandwiches,
            createdBy: senderUser?.id || 'sms-system',
            createdByName: senderUser
              ? (senderUser.firstName && senderUser.lastName
                  ? `${senderUser.firstName} ${senderUser.lastName} (via SMS)`
                  : senderUser.firstName
                    ? `${senderUser.firstName} (via SMS)`
                    : senderUser.email
                      ? `${senderUser.email} (via SMS)`
                      : `SMS: ${redactedPhone}`)
              : `SMS: ${redactedPhone}`,
          };

          // Add sandwich type breakdowns if provided
          if (parsedData.individualDeli) collectionData.individualDeli = parsedData.individualDeli;
          if (parsedData.individualTurkey) collectionData.individualTurkey = parsedData.individualTurkey;
          if (parsedData.individualHam) collectionData.individualHam = parsedData.individualHam;
          if (parsedData.individualPbj) collectionData.individualPbj = parsedData.individualPbj;
          if (parsedData.individualGeneric) collectionData.individualGeneric = parsedData.individualGeneric;

          // Add group collections if provided
          if (parsedData.groupCollections && parsedData.groupCollections.length > 0) {
            collectionData.groupCollections = parsedData.groupCollections;
            if (parsedData.groupCollections[0]) {
              collectionData.group1Name = parsedData.groupCollections[0].name;
              collectionData.group1Count = parsedData.groupCollections[0].count;
            }
            if (parsedData.groupCollections[1]) {
              collectionData.group2Name = parsedData.groupCollections[1].name;
              collectionData.group2Count = parsedData.groupCollections[1].count;
            }
          }

          // Create the collection
          const collection = await storage.createSandwichCollection(collectionData);
          logger.info(`✅ Collection created from SMS (AI): ID ${collection.id}, ${parsedData.individualSandwiches} sandwiches at ${matchedHostName}`);

          // Generate and send confirmation message
          const confirmationMsg = generateConfirmationMessage(parsedData, matchedHostId ? matchedHostName : undefined);
          res.type('text/xml');
          return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${confirmationMsg}</Message></Response>`);
        } else {
          // Low confidence or failed parse - send helpful message
          logger.info(`ℹ️ Low confidence or failed parse from ${redactedPhone}, showing help`);
          logApplicationError({
            source: 'sms_webhook',
            severity: 'warning',
            category: 'parse_failure',
            message: parseResult.error || 'SMS collection message could not be parsed',
            details: {
              bodyPreview: Body.trim().slice(0, 300),
              confidence: parseResult.data?.confidence,
              parseSuccess: parseResult.success,
            },
            phoneNumber: redactedPhone,
            requestPath: '/api/sms/webhook',
            notifyAdmin: false,
          });
          res.type('text/xml');
          return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Couldn't understand that. Just text:\n• 500 Dunwoody\n• 100 pbj 200 deli Intown\n\nOr add groups:\n• 500 Dunwoody, Acme 200\n\nText HELP for more.</Message></Response>`);
        }
      } catch (parseError) {
        logger.error('❌ Error parsing potential collection:', parseError);
        logApplicationError({
          source: 'sms_webhook',
          severity: 'error',
          category: 'parse_exception',
          message: parseError instanceof Error ? parseError.message : 'SMS parse exception',
          details: { bodyPreview: Body?.slice(0, 200) },
          phoneNumber: redactedPhone,
          requestPath: '/api/sms/webhook',
          notifyAdmin: true,
        });
        // Fall through to unrecognized message handler
      }
    }
    // Handle HELP requests
    else if (messageBody === 'HELP' || messageBody === '?') {
      logger.log(`❓ Help request from ${redactedPhone}`);
      res.type('text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>TSP - How to Log Sandwiches:\n\nSimple: 500 Dunwoody\nWith types: 100 pbj 200 deli Intown\nWith date: 500 Dunwoody 12/10\nWith groups: 500 Dunwoody, Acme 200\n\nIDEA [text] - Submit idea\nSTOP - Unsubscribe</Message></Response>`);
    }
    else {
      logger.log(`ℹ️ Unrecognized SMS message from ${redactedPhone}: "${Body}"`);

      // Send helpful response for unrecognized messages
      res.type('text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>TSP - Just text the count and location!\n\nExample: 500 Dunwoody\nOr: 100 pbj 200 deli Intown\n\nText HELP for more options.</Message></Response>`);
    }

    // Always respond with TwiML (empty response for unrecognized messages)
    res.type('text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    logger.error('Error processing SMS webhook:', error);
    logApplicationError({
      source: 'sms_webhook',
      severity: 'critical',
      category: 'webhook',
      message: error instanceof Error ? error.message : 'SMS webhook processing failed',
      requestPath: '/api/sms/webhook',
      notifyAdmin: true,
    });
    // Always respond with TwiML even on errors
    res.type('text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * Twilio status webhook endpoint for message delivery status
 * This endpoint tracks delivery status of outbound SMS messages
 * NOTE: This is on webhookRouter (not router) - NO auth middleware, Twilio callback
 */
webhookRouter.post('/sms-webhook/status', async (req, res) => {
  try {
    logger.log('📱 Received Twilio status webhook:', req.body);

    const { MessageSid, MessageStatus, ErrorCode, To, From } = req.body;

    if (MessageStatus === 'undelivered' || MessageStatus === 'failed') {
      logger.error(`❌ SMS delivery failed:`, {
        sid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        to: To,
        from: From,
      });

      logApplicationError({
        source: 'sms_webhook',
        severity: 'warning',
        category: 'delivery_failed',
        message: `SMS delivery ${MessageStatus} (error ${ErrorCode || 'unknown'})`,
        details: { messageSid: MessageSid, errorCode: ErrorCode, to: To, from: From },
        phoneNumber: To ? `***${String(To).slice(-4)}` : undefined,
        requestPath: '/api/sms/webhook/status',
        notifyAdmin: false,
      });

      // Log specific error code details
      if (ErrorCode === '30032') {
        logger.error('⚠️ Error 30032: Carrier unreachable. This may be due to:');
        logger.error('- The number may be a landline');
        logger.error('- Carrier-specific filtering (AT&T/Verizon may block unregistered numbers)');
        logger.error('- The number needs to be registered with A2P 10DLC');
        logger.error('- Try texting "START" to the Twilio number from the recipient phone first');
      } else if (ErrorCode === '30005') {
        logger.error('⚠️ Error 30005: Unknown destination handset');
        logger.error('- The phone number format may be incorrect');
        logger.error('- The number may not exist or be deactivated');
      } else if (ErrorCode === '30003') {
        logger.error('⚠️ Error 30003: Unreachable destination handset');
        logger.error('- The phone is likely turned off or out of service area');
      } else if (ErrorCode === '30006') {
        logger.error('⚠️ Error 30006: Landline or unreachable carrier');
        logger.error('- The number is likely a landline that cannot receive SMS');
      } else if (ErrorCode === '30007') {
        logger.error('⚠️ Error 30007: Carrier violation');
        logger.error('- Message content was blocked by the carrier');
        logger.error('- May need to register for A2P 10DLC');
      } else if (ErrorCode === '30008') {
        logger.error('⚠️ Error 30008: Unknown error');
        logger.error('- Carrier returned an unknown error');
      }

      // Update user's SMS status if delivery fails with certain error codes
      if (['30032', '30005', '30006'].includes(ErrorCode)) {
        // These errors indicate the number cannot receive SMS
        const allUsers = await storage.getAllUsers();
        const affectedUser = allUsers.find((user) => {
          const metadata = user.metadata as any || {};
          const smsConsent = metadata.smsConsent || {};
          return smsConsent.phoneNumber === To;
        });

        if (affectedUser) {
          const metadata = affectedUser.metadata as any || {};
          const updatedMetadata = {
            ...metadata,
            smsConsent: {
              ...metadata.smsConsent,
              lastDeliveryError: {
                errorCode: ErrorCode,
                errorTime: new Date().toISOString(),
                messageSid: MessageSid,
              },
            },
          };

          await storage.updateUser(affectedUser.id, { metadata: updatedMetadata });
          logger.log(`📝 Updated user ${affectedUser.email} with delivery error information`);
        }
      }
    } else if (MessageStatus === 'delivered') {
      logger.log(`✅ SMS delivered successfully:`, {
        sid: MessageSid,
        to: To,
      });
    }

    // Always respond with 200 OK to Twilio
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error processing SMS status webhook:', error);
    // Always respond with 200 OK to Twilio even on errors
    res.status(200).send('OK');
  }
});

/**
 * Submit toll-free verification request
 */
router.post('/users/toll-free-verification/submit', isAuthenticated, async (req, res) => {
  try {
    // Only admin users can submit toll-free verification
    if (!req.user || !hasPermission(req.user, PERMISSIONS.ADMIN_ACCESS)) {
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    const result = await submitTollFreeVerification();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        verificationSid: result.verificationSid,
        status: result.status
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Error submitting toll-free verification:', error);
    res.status(500).json({
      error: 'Failed to submit toll-free verification',
      message: (error as Error).message,
    });
  }
});

/**
 * Check toll-free verification status
 */
router.get('/users/toll-free-verification/status', isAuthenticated, async (req, res) => {
  try {
    // Only admin users can check toll-free verification
    if (!req.user || !hasPermission(req.user, PERMISSIONS.ADMIN_ACCESS)) {
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    const verificationSid = req.query.verificationSid as string;
    const result = await checkTollFreeVerificationStatus(verificationSid);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        verificationSid: result.verificationSid,
        status: result.status
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Error checking toll-free verification status:', error);
    res.status(500).json({
      error: 'Failed to check toll-free verification status',
      message: (error as Error).message,
    });
  }
});

/**
 * Send SMS opt-in instructions email to selected users
 */
router.post('/users/send-sms-instructions', isAuthenticated, async (req, res) => {
  try {
    // Check for admin permissions
    if (!req.user || !hasPermission(req.user, PERMISSIONS.ADMIN_ACCESS)) {
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    const { userIds } = z.object({
      userIds: z.array(z.string()).min(1, 'At least one user must be selected'),
    }).parse(req.body);

    logger.log(`📧 Sending SMS opt-in instructions to ${userIds.length} users...`);

    // Get all selected users
    const selectedUsers = await Promise.all(
      userIds.map(id => storage.getUserById(id))
    );

    const validUsers = selectedUsers.filter(user => user !== null && user.email);
    
    if (validUsers.length === 0) {
      return res.status(400).json({
        error: 'No valid users found',
        message: 'None of the selected users have valid email addresses',
      });
    }

    // Send emails to all users
    const results = await Promise.allSettled(
      validUsers.map(user => 
        NotificationService.sendSMSOptInInstructions(
          user!.email,
          user!.name || undefined
        )
      )
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failCount = results.length - successCount;

    logger.log(`✅ SMS opt-in emails sent: ${successCount} successful, ${failCount} failed`);

    res.json({
      success: true,
      message: `SMS opt-in instructions sent to ${successCount} user(s)`,
      details: {
        total: validUsers.length,
        successful: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    logger.error('Error sending SMS opt-in instructions:', error);
    
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request data',
        details: (error as any).errors,
      });
    }

    res.status(500).json({
      error: 'Failed to send SMS opt-in instructions',
      message: (error as Error).message,
    });
  }
});

// Export both routers:
// - smsUserRoutes: authenticated routes for user-facing SMS settings
// - smsWebhookRoutes: unauthenticated Twilio webhook callbacks (signature-validated)
export { router as smsUserRoutes, webhookRouter as smsWebhookRoutes };
