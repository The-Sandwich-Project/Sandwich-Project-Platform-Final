import { SMSProviderFactory } from './sms-providers/provider-factory';
import { SMSProvider } from './sms-providers/types';
import { db } from './db';
import { hosts } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { getUserMetadata } from '../shared/types';
import { logger } from './utils/production-safe-logger';
import { ALERT_TYPES } from '@shared/alert-catalog';
import { getEffectivePrefs } from './services/notifications/preferences';

/**
 * Resolve the SMS provider asynchronously
 * This ensures we always get the initialized provider instance (with Replit integration if available)
 * Awaits factory initialization to guarantee connector credentials are loaded
 */
async function resolveProvider(): Promise<SMSProvider | null> {
  try {
    const factory = SMSProviderFactory.getInstance();
    return await factory.getProviderAsync();
  } catch (error) {
    logger.error('Failed to resolve SMS provider:', error);
    return null;
  }
}

interface SMSReminderResult {
  success: boolean;
  message: string;
  sentTo?: string;
}

interface SMSConfirmationResult {
  success: boolean;
  message: string;
  verificationCode?: string;
}

interface TollFreeVerificationResult {
  success: boolean;
  message: string;
  verificationSid?: string;
  status?: string;
}

/**
 * Send SMS reminder to a specific host location using opted-in users
 */
export async function sendSMSReminder(
  hostLocation: string,
  appUrl: string = process.env.PUBLIC_APP_URL ||
    (process.env.REPLIT_DOMAIN
      ? `https://${process.env.REPLIT_DOMAIN}`
      : 'https://sandwich-project-platform-final-katielong2316.replit.app')
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  if (!provider) {
    return {
      success: false,
      message: 'SMS service not configured - no provider available',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: `SMS service not configured - ${provider.name} provider missing configuration`,
    };
  }

  try {
    // Import storage to get users who have opted in to SMS
    const { storage } = await import('./storage');

    // Get all users who have confirmed SMS opt-in for the 'hosts' campaign (collection reminders)
    // Users are manually marked/approved for host reminders when they opt in for 'hosts' campaign
    const allUsers = await storage.getAllUsers();
    const optedInUsers = allUsers.filter((user) => {
      const metadata = getUserMetadata(user);
      const smsConsent = metadata.smsConsent;
      // Only include users with confirmed status, enabled flag, and 'hosts' campaign type
      // Users without a campaignType are included for backwards compatibility (they opted in before campaign types were added)
      const isConfirmedAndEnabled = 
        smsConsent?.status === 'confirmed' &&
        smsConsent.enabled &&
        smsConsent.phoneNumber;
      
      // Only send collection reminders to users who opted in for 'hosts' campaign
      // or users who opted in before campaign types existed (no campaignType field)
      // Users are manually approved when they opt in for the 'hosts' campaign
      const isHostsCampaign = !smsConsent?.campaignType || smsConsent.campaignType === 'hosts';
      
      return isConfirmedAndEnabled && isHostsCampaign;
    });

    if (optedInUsers.length === 0) {
      // No users opted in for collection reminders - this is a normal condition, not an error
      // Return success to prevent unnecessary monitoring alerts when all opt-ins are for 'events' only
      logger.info(`ℹ️ No users opted in to SMS collection reminders (hosts campaign) for ${hostLocation} - skipping`);
      return {
        success: true,
        message: `No users have opted in to SMS collection reminders (hosts campaign) - no reminders sent`,
      };
    }

    // Send SMS to each opted-in user
    const results = [];
    for (const user of optedInUsers) {
      try {
        // Respect the user's notification preference for weekly collection
        // reminders over SMS. Users who have turned this alert off shouldn't
        // get SMS even if they're opted into the 'hosts' campaign.
        const prefs = await getEffectivePrefs(user.id, ALERT_TYPES.WEEKLY_COLLECTION_REMINDER);
        if (!prefs.smsEnabled) {
          continue;
        }

        const metadata = getUserMetadata(user);
        const smsConsent = metadata.smsConsent;
        const phoneNumber = smsConsent?.phoneNumber;

        // Validate phone number exists before sending
        if (!phoneNumber) {
          logger.warn(`⚠️ Skipping SMS for ${user.email}: No phone number found`);
          results.push({
            user: user.email,
            phone: 'none',
            error: 'No phone number in SMS consent',
            success: false,
          });
          continue;
        }

        const message = `Hi! 🥪 Friendly reminder: The Sandwich Project weekly numbers haven't been submitted yet for ${hostLocation}. Please submit at: ${appUrl} - Thanks for all you do!`;

        const result = await provider.sendSMS({
          to: phoneNumber,
          body: message,
        });

        results.push({
          user: user.email,
          phone: phoneNumber,
          messageSid: result.messageId || 'unknown',
          success: result.success,
        });

        logger.log(
          `✅ Collection reminder SMS sent to ${user.email} (${phoneNumber}) for ${hostLocation} [hosts campaign]`
        );

        // MONITORING: Notify admin of SMS send
        const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
        await notifyAdminOfSMS({
          to: phoneNumber,
          message,
          messageType: `Weekly Reminder - ${hostLocation}`,
          success: result.success,
          messageId: result.messageId,
        });
      } catch (error) {
        logger.error(`❌ Failed to send SMS to ${user.email}:`, error);
        const metadata = getUserMetadata(user);
        const errorPhone = metadata.smsConsent?.phoneNumber || 'unknown';
        results.push({
          user: user.email,
          phone: errorPhone,
          error: (error as Error).message,
          success: false,
        });

        // MONITORING: Notify admin of SMS failure
        if (errorPhone !== 'unknown') {
          // Reconstruct message since it's out of scope
          const failedMessage = `Hi! 🥪 Friendly reminder: The Sandwich Project weekly numbers haven't been submitted yet for ${hostLocation}. Please submit at: ${appUrl} - Thanks for all you do!`;
          const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
          await notifyAdminOfSMS({
            to: errorPhone,
            message: failedMessage,
            messageType: `Weekly Reminder - ${hostLocation}`,
            success: false,
            errorMessage: (error as Error).message,
          });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const totalCount = results.length;

    return {
      success: successCount > 0,
      message: `SMS reminders sent: ${successCount}/${totalCount} opted-in users contacted`,
      sentTo: results
        .filter((r) => r.success)
        .map((r) => r.user)
        .join(', '),
    };
  } catch (error) {
    logger.error('Error sending SMS reminder:', error);

    // MONITORING: Notify admin of system-level SMS failure
    try {
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: 'system',
        message: `Weekly reminder system failed for ${hostLocation}`,
        messageType: `Weekly Reminder System Error - ${hostLocation}`,
        success: false,
        errorMessage: `System error: ${(error as Error).message}`,
      });
    } catch (monitorError) {
      logger.error('Failed to send monitoring notification:', monitorError);
    }

    return {
      success: false,
      message: `Failed to send SMS reminder: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS reminders to all missing locations from weekly monitoring
 */
export async function sendWeeklyReminderSMS(
  missingLocations: string[],
  appUrl?: string
): Promise<{ [location: string]: SMSReminderResult }> {
  const results: { [location: string]: SMSReminderResult } = {};

  for (const location of missingLocations) {
    results[location] = await sendSMSReminder(location, appUrl);

    // Add small delay between SMS sends to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * Test SMS functionality
 */
export async function sendTestSMS(
  toPhoneNumber: string,
  appUrl?: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  // Define message early so it's accessible in catch blocks
  const testMessage = `🧪 Test SMS from The Sandwich Project! This is a test of the SMS reminder system. App link: ${
    appUrl || 'https://sandwich-project-platform-final-katielong2316.replit.app'
  }`;
  
  if (!provider) {
    return {
      success: false,
      message: 'SMS service not configured - no provider available',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: `SMS service not configured - ${provider.name} provider missing configuration`,
    };
  }

  try {
    // Clean and format phone number with improved handling for AT&T
    let formattedPhone = toPhoneNumber.replace(/[^\d+]/g, '');

    // Ensure proper E.164 format for US numbers
    if (formattedPhone.startsWith('1') && formattedPhone.length === 11) {
      formattedPhone = `+${formattedPhone}`;
    } else if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    logger.log(`📱 Formatting phone number: ${toPhoneNumber} -> ${formattedPhone}`);

    const result = await provider.sendSMS({
      to: formattedPhone,
      body: testMessage,
    });

    if (result.success) {
      logger.log(`✅ Test SMS sent to ${formattedPhone}`);

      // MONITORING: Notify admin of SMS send
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: formattedPhone,
        message: testMessage,
        messageType: 'Test SMS',
        success: true,
        messageId: result.messageId,
      });

      return {
        success: true,
        message: `Test SMS sent successfully to ${formattedPhone}`,
        sentTo: formattedPhone,
      };
    } else {
      // MONITORING: Notify admin of failed SMS
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: formattedPhone,
        message: testMessage,
        messageType: 'Test SMS',
        success: false,
        errorMessage: result.message,
      });

      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending test SMS:', error);

    // MONITORING: Notify admin of SMS failure exception
    try {
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: toPhoneNumber,
        message: testMessage || 'Test SMS',
        messageType: 'Test SMS',
        success: false,
        errorMessage: (error as Error).message,
      });
    } catch (monitorError) {
      logger.error('Failed to send monitoring notification:', monitorError);
    }

    return {
      success: false,
      message: `Failed to send test SMS: ${(error as Error).message}`,
    };
  }
}

/**
 * Generate secure verification code for SMS confirmation
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * SMS Campaign types
 */
export type SMSCampaignType = 'hosts' | 'events';

/**
 * Get provider-specific welcome message configuration
 * @param provider - The SMS provider
 * @param campaignType - The campaign type: 'hosts' for weekly collection reminders, 'events' for event coordination
 */
function getWelcomeMessages(provider: SMSProvider, campaignType: SMSCampaignType = 'hosts') {
  const providerName = provider.name;
  const fromNumber = provider.getFromNumber();
  
  // Campaign-specific welcome messages (Twilio-compliant)
  const campaignWelcomeMessages = {
    hosts: `The Sandwich Project: You're now opted in to receive SMS reminders about weekly sandwich collection submissions. Reply STOP to unsubscribe, HELP for assistance. Msg&Data rates may apply.`,
    events: `The Sandwich Project: You're now opted in to receive SMS notifications about volunteer event reminders, event updates, and assignment notifications for events you are organizing or supporting. Reply STOP to unsubscribe, HELP for assistance. Msg&Data rates may apply.`
  };
  
  // Campaign-specific confirmation messages
  const campaignConfirmationMessages = {
    hosts: (verificationCode: string) => 
      `The Sandwich Project: Your verification code is ${verificationCode}. Reply with this code to confirm your SMS signup for collection reminders. Reply STOP to cancel, HELP for assistance.`,
    events: (verificationCode: string) => 
      `The Sandwich Project: Your verification code is ${verificationCode}. Reply with this code to confirm your SMS signup for event notifications. Reply STOP to cancel, HELP for assistance.`
  };
  
  if (providerName === 'phone_gateway') {
    return {
      confirmation: (verificationCode: string) => 
        `Welcome to The Sandwich Project! 🥪\n\nTo complete SMS signup, reply with this code:\n\n${verificationCode}\n\nYou'll receive helpful reminders and updates as needed.${fromNumber ? `\n\nFrom: ${fromNumber}` : ''}`,
      
      welcome: () => campaignWelcomeMessages[campaignType]
    };
  } else {
    // Twilio or other providers - use campaign-specific TCPA-compliant messages
    return {
      confirmation: campaignConfirmationMessages[campaignType],
      welcome: () => campaignWelcomeMessages[campaignType]
    };
  }
}

/**
 * Send SMS confirmation message with verification code
 */
export async function sendConfirmationSMS(
  phoneNumber: string,
  verificationCode: string,
  retryCount: number = 0
): Promise<SMSConfirmationResult> {
  const provider = await resolveProvider();
  
  logger.log('📱 Attempting to send confirmation SMS...');
  logger.log('Phone number:', phoneNumber);
  logger.log('Verification code:', verificationCode);
  logger.log('Retry attempt:', retryCount);
  logger.log('SMS Provider configured:', !!provider);

  if (!provider) {
    logger.error('❌ SMS provider not initialized');
    return {
      success: false,
      message: 'SMS service not configured - no provider available',
    };
  }

  // Check if provider is configured using the provider's own validation
  const validation = provider.validateConfig();
  if (!validation.isValid) {
    logger.error(`❌ ${provider.name} provider missing configuration:`, validation.missingItems);
    return {
      success: false,
      message: `SMS service not configured - ${provider.name} provider missing configuration`,
    };
  }

  try {
    // Validate phone number
    if (!phoneNumber || phoneNumber.trim() === '') {
      logger.error('❌ Invalid phone number provided');
      return {
        success: false,
        message: 'Invalid phone number provided',
      };
    }

    const messages = getWelcomeMessages(provider);
    const confirmationMessage = messages.confirmation(verificationCode);

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: confirmationMessage,
    });

    if (result.success) {
      logger.log(`✅ SMS confirmation sent via ${provider.name} to ${phoneNumber} (${result.messageId})`);

      // MONITORING: Notify admin of SMS send
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: confirmationMessage,
        messageType: 'SMS Verification Code',
        success: true,
        messageId: result.messageId,
      });

      return {
        success: true,
        message: `Confirmation SMS sent successfully to ${phoneNumber}`,
        verificationCode,
      };
    } else {
      // MONITORING: Notify admin of failed SMS
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: confirmationMessage,
        messageType: 'SMS Verification Code',
        success: false,
        errorMessage: result.message,
      });

      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error: any) {
    logger.error('Error sending confirmation SMS via provider:', error);

    // Fallback to direct Twilio if provider fails
    logger.log('🔄 Falling back to direct Twilio...');

    try {
      // Get the Twilio client from the provider
      const { TwilioProvider } = await import('./sms-providers/twilio-provider');
      const twilioProvider = provider as InstanceType<typeof TwilioProvider>;
      const twilioClient = twilioProvider.getClientSync();

      if (!twilioClient) {
        throw new Error('Twilio client not available');
      }

      // Format phone number with improved AT&T compatibility
      let formattedPhone = phoneNumber.replace(/[^\d+]/g, '');
      if (formattedPhone.startsWith('1') && formattedPhone.length === 11) {
        formattedPhone = `+${formattedPhone}`;
      } else if (formattedPhone.length === 10) {
        formattedPhone = `+1${formattedPhone}`;
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = `+${formattedPhone}`;
      }

      logger.log(`📱 Phone number formatting: ${phoneNumber} -> ${formattedPhone}`);

      // Simplified message to avoid carrier filtering
      const confirmationMessage = `Sandwich Project: Your verification code is ${verificationCode}. Enter it in the app to finish turning on text alerts.`;

      logger.log('📤 Sending SMS via Twilio...');
      logger.log('Message length:', confirmationMessage.length, 'characters');

      const result = await twilioClient.messages.create({
        body: confirmationMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
        // Add status callback to track delivery
        statusCallback: process.env.REPLIT_DOMAIN
          ? `https://${process.env.REPLIT_DOMAIN}/api/sms-webhook/status`
          : undefined,
      });

      logger.log(`✅ SMS confirmation sent to ${phoneNumber} (${result.sid})`);
      logger.log('Message status:', result.status);
      logger.log('Message price:', result.price);

      // MONITORING: Notify admin of SMS send (Twilio fallback)
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: confirmationMessage,
        messageType: 'SMS Verification Code (Twilio Fallback)',
        success: true,
        messageId: result.sid,
      });

      return {
        success: true,
        message: `Confirmation SMS sent successfully to ${phoneNumber}`,
        verificationCode,
      };
    } catch (twilioError: any) {
      logger.error('❌ Error sending confirmation SMS:', twilioError);
      logger.error('Error code:', twilioError.code);
      logger.error('Error message:', twilioError.message);
      logger.error('More info:', twilioError.moreInfo);

      // MONITORING: Notify admin of Twilio fallback failure
      const errorMessage = twilioError.message || 'Unknown Twilio error';
      try {
        const confirmationMessage = `Sandwich Project: Your verification code is ${verificationCode}. Enter it in the app to finish turning on text alerts.`;
        const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
        await notifyAdminOfSMS({
          to: phoneNumber,
          message: confirmationMessage,
          messageType: 'SMS Verification Code (Twilio Fallback Failed)',
          success: false,
          errorMessage: `Twilio Error ${twilioError.code || 'UNKNOWN'}: ${errorMessage}`,
        });
      } catch (monitorError) {
        logger.error('Failed to send monitoring notification:', monitorError);
      }

      // Check for specific Twilio error codes
      if (twilioError.code === 21211) {
        return {
          success: false,
          message: `Invalid phone number format: ${phoneNumber}. Please use format: +1XXXXXXXXXX`,
        };
      } else if (twilioError.code === 21608) {
        return {
          success: false,
          message: `The phone number ${phoneNumber} is not verified with your Twilio trial account. Add it as a verified number in Twilio console.`,
        };
      } else if (twilioError.code === 21610) {
        return {
          success: false,
          message: `The phone number ${phoneNumber} has opted out of receiving messages. Reply START to opt back in.`,
        };
      } else if (twilioError.code === 30032 || twilioError.code === 30005) {
        // Error 30032: Unknown destination handset (carrier issue)
        // Error 30005: Unknown destination handset (number unreachable)
        logger.log(`⚠️ Carrier delivery issue (${twilioError.code}), attempting retry...`);

        if (retryCount < 2) {
          // Wait before retry (exponential backoff)
          const delay = (retryCount + 1) * 2000;
          logger.log(`⏱️ Waiting ${delay}ms before retry ${retryCount + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delay));

          // Retry with incremented count
          return sendConfirmationSMS(phoneNumber, verificationCode, retryCount + 1);
        }

        return {
          success: false,
          message: `Unable to deliver SMS to ${phoneNumber}. This may be due to carrier restrictions. Please ensure the number can receive SMS messages and try again.`,
        };
      }
      return {
        success: false,
        message: `Failed to send SMS: ${twilioError.message}`,
      };
    }
  }
}

/**
 * Send provider-appropriate welcome SMS
 * @param phoneNumber - The phone number to send to
 * @param campaignType - The campaign type: 'hosts' for collection reminders, 'events' for event coordination
 */
export async function sendWelcomeSMS(
  phoneNumber: string,
  campaignType: SMSCampaignType = 'hosts'
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  // Redact phone number for logging (show last 4 digits only)
  const redactedPhone = phoneNumber ? `***${phoneNumber.slice(-4)}` : 'unknown';

  // Only log stack traces in development
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`🔍 [DEBUG] sendWelcomeSMS called with phone: ${redactedPhone}, campaign: ${campaignType}`);
  }

  if (!provider) {
    return {
      success: false,
      message: 'SMS service not configured - no provider available',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: `SMS service not configured - ${provider.name} provider missing configuration`,
    };
  }

  try {
    // Validate phone number
    if (!phoneNumber || phoneNumber.trim() === '') {
      logger.error('❌ Invalid phone number provided');
      return {
        success: false,
        message: 'Invalid phone number provided',
      };
    }

    logger.log(`📱 About to send welcome SMS to: ${redactedPhone} (campaign: ${campaignType})`);

    const messages = getWelcomeMessages(provider, campaignType);
    const welcomeMessage = messages.welcome();

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: welcomeMessage,
    });

    if (result.success) {
      logger.log(`✅ Welcome SMS sent via ${provider.name} to ${redactedPhone} (${result.messageId})`);

      // MONITORING: Notify admin of SMS send
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: welcomeMessage,
        messageType: 'Welcome SMS',
        success: true,
        messageId: result.messageId,
      });

      return {
        success: true,
        message: `Welcome SMS sent successfully to ${phoneNumber}`,
        sentTo: phoneNumber,
      };
    } else {
      // MONITORING: Notify admin of failed SMS
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: welcomeMessage,
        messageType: 'Welcome SMS',
        success: false,
        errorMessage: result.message,
      });

      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending welcome SMS:', error);

    // MONITORING: Notify admin of SMS failure exception
    try {
      const messages = getWelcomeMessages(provider!);
      const welcomeMessage = messages.welcome();
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message: welcomeMessage,
        messageType: 'Welcome SMS',
        success: false,
        errorMessage: (error as Error).message,
      });
    } catch (monitorError) {
      logger.error('Failed to send monitoring notification:', monitorError);
    }

    return {
      success: false,
      message: `Failed to send welcome SMS: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS notification for TSP contact assignment
 */
export async function sendTspContactAssignmentSMS(
  phoneNumber: string,
  organizationName: string,
  eventId: number,
  eventDate: Date | string | null
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  if (!provider) {
    return {
      success: false,
      message: 'SMS service not configured - no provider available',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: `SMS service not configured - ${provider.name} provider missing configuration`,
    };
  }

  try {
    // Validate phone number
    if (!phoneNumber || phoneNumber.trim() === '') {
      logger.error('❌ Invalid phone number provided');
      return {
        success: false,
        message: 'Invalid phone number provided',
      };
    }

    // Format event date
    const formattedDate = eventDate 
      ? new Date(eventDate).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric'
        })
      : 'TBD';

    // Create app URL with event link
    const appUrl = process.env.PUBLIC_APP_URL ||
      (process.env.REPLIT_DOMAIN
        ? `https://${process.env.REPLIT_DOMAIN}`
        : 'https://sandwich-project-platform-final-katielong2316.replit.app');
    const eventUrl = `${appUrl}/event-requests`;

    // Craft message (Twilio-compliant with STOP/HELP)
    const message = `The Sandwich Project: You've been assigned as TSP contact for ${organizationName} (${formattedDate}). View details: ${eventUrl}. Reply STOP to opt out, HELP for help.`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ TSP contact assignment SMS sent to ${phoneNumber} (${result.messageId})`);

      // MONITORING: Notify admin of SMS send
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message,
        messageType: `TSP Contact Assignment - ${organizationName}`,
        success: true,
        messageId: result.messageId,
      });

      return {
        success: true,
        message: `TSP contact assignment SMS sent successfully to ${phoneNumber}`,
        sentTo: phoneNumber,
      };
    } else {
      // MONITORING: Notify admin of failed SMS
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message,
        messageType: `TSP Contact Assignment - ${organizationName}`,
        success: false,
        errorMessage: result.message,
      });

      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending TSP contact assignment SMS:', error);

    // MONITORING: Notify admin of SMS failure exception
    try {
      const message = `The Sandwich Project: You've been assigned as TSP contact for ${organizationName}.`;
      const { notifyAdminOfSMS } = await import('./utils/sms-monitoring');
      await notifyAdminOfSMS({
        to: phoneNumber,
        message,
        messageType: `TSP Contact Assignment - ${organizationName}`,
        success: false,
        errorMessage: (error as Error).message,
      });
    } catch (monitorError) {
      logger.error('Failed to send monitoring notification:', monitorError);
    }

    return {
      success: false,
      message: `Failed to send TSP contact assignment SMS: ${(error as Error).message}`,
    };
  }
}

/**
 * Validate SMS configuration for current provider
 */
export function validateSMSConfig(): {
  isConfigured: boolean;
  missingItems: string[];
  provider?: string;
  providersStatus?: { [key: string]: { configured: boolean; missingItems: string[] } };
} {
  const factory = SMSProviderFactory.getInstance();
  
  try {
    const provider = factory.getProvider();
    const validation = provider.validateConfig();
    const providersStatus = factory.getProvidersStatus();
    
    return {
      isConfigured: validation.isValid,
      missingItems: validation.missingItems,
      provider: provider.name,
      providersStatus,
    };
  } catch (error) {
    return {
      isConfigured: false,
      missingItems: ['PROVIDER_INITIALIZATION_ERROR'],
      provider: 'none',
      providersStatus: factory.getProvidersStatus(),
    };
  }
}

/**
 * Submit toll-free verification request to Twilio
 * Note: This function is Twilio-specific and only works with Twilio provider
 */
export async function submitTollFreeVerification(): Promise<TollFreeVerificationResult> {
  const provider = await resolveProvider();
  
  if (!provider || provider.name !== 'twilio') {
    return {
      success: false,
      message: 'Toll-free verification is only available with Twilio provider',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: 'Twilio SMS service not configured - missing credentials',
    };
  }

  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!twilioPhoneNumber) {
    return {
      success: false,
      message: 'Twilio phone number not configured',
    };
  }

  try {
    // First, look up the phone number SID
    logger.log(`🔍 Looking up phone number SID for: ${twilioPhoneNumber}`);
    const phoneNumberResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(twilioPhoneNumber)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      }
    );

    if (!phoneNumberResponse.ok) {
      const errorText = await phoneNumberResponse.text();
      throw new Error(`Failed to lookup phone number: ${phoneNumberResponse.status} ${errorText}`);
    }

    const phoneNumberData = await phoneNumberResponse.json();
    if (!phoneNumberData.incoming_phone_numbers || phoneNumberData.incoming_phone_numbers.length === 0) {
      throw new Error(`Phone number ${twilioPhoneNumber} not found in your Twilio account`);
    }

    const num = phoneNumberData.incoming_phone_numbers[0];
    const phoneNumberSid = num.sid;

    // Validate that this is actually a toll-free number (8XX)
    if (!/^\+1(800|833|844|855|866|877|888)\d{7}$/.test(num.phone_number)) {
      throw new Error(`Number ${num.phone_number} is not toll-free; TFV requires an 8XX number (800, 833, 844, 855, 866, 877, or 888).`);
    }

    logger.log(`📱 Using toll-free phone number SID: ${phoneNumberSid}`);
    logger.log(`📞 Number: ${num.phone_number}`);
    logger.log(`🔍 Submitting toll-free verification with PascalCase fields`);

    // Build form data with PascalCase field names (Twilio REST API format)
    const form = new URLSearchParams();
    const baseUrl = process.env.PUBLIC_APP_URL ||
      (process.env.REPLIT_DOMAIN
        ? `https://${process.env.REPLIT_DOMAIN}`
        : 'https://sandwich-project-platform-final-katielong2316.replit.app');

    // Required IDs
    form.append('TollfreePhoneNumberSid', phoneNumberSid);

    // Business + contacts
    form.append('BusinessName', 'The Sandwich Project');
    form.append('BusinessWebsite', 'https://www.thesandwichproject.org');
    form.append('NotificationEmail', 'katie@thesandwichproject.org');

    // Use case (array) - repeat key for each category
    ['ACCOUNT_NOTIFICATION'].forEach(v =>
      form.append('UseCaseCategories', v)
    );
    form.append('UseCaseSummary', 'Volunteer-powered nonprofit sending weekly reminders to volunteers about sandwich collection submissions and outreach events.');

    // Message volume (string tier)
    form.append('MessageVolume', '1000');

    // Opt-in - repeat key for each URL
    form.append('OptInType', 'WEB_FORM');
    [`${baseUrl}/profile-notifications-signup.png`].forEach(url =>
      form.append('OptInImageUrls', url)
    );

    // Sample message
    form.append('ProductionMessageSample', 'Reminder: Please submit your sandwich collection data for this week. Visit our app to log your donations. Reply STOP to opt out.');

    // Business address
    form.append('BusinessStreetAddress', '2870 Peachtree Rd NW, PMB 915-2217');
    form.append('BusinessCity', 'Atlanta');
    form.append('BusinessStateProvinceRegion', 'GA');
    form.append('BusinessPostalCode', '30305');
    form.append('BusinessCountry', 'US');

    // Contact + registration
    form.append('BusinessContactFirstName', 'Christine');
    form.append('BusinessContactLastName', 'Cooper Nowicki');
    form.append('BusinessContactEmail', 'christine@thesandwichproject.org');
    form.append('BusinessContactPhone', '+14047868116');
    form.append('BusinessRegistrationNumber', '87-0939484');
    form.append('BusinessType', 'NON_PROFIT');

    logger.log(`📤 Submitting TFV with MessageVolume: 1000, UseCaseCategories: ACCOUNT_NOTIFICATION`);
    logger.log(`📷 Opt-in image URL: ${baseUrl}/profile-notifications-signup.png`);

    // Submit toll-free verification using REST API with correct snake_case fields
    const response = await fetch('https://messaging.twilio.com/v1/Tollfree/Verifications', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    const responseText = await response.text();

    if (!response.ok) {
      // Try to parse JSON error for better debugging
      try {
        const errorJson = JSON.parse(responseText);
        logger.error('❌ Twilio TFV error details:', errorJson);
        throw new Error(`Twilio API error: ${response.status} [${errorJson.code || 'NO_CODE'}] ${errorJson.message || responseText}`);
      } catch (parseError) {
        // If not JSON, throw the raw text
        throw new Error(`Twilio API error: ${response.status} ${responseText}`);
      }
    }

    const verification = JSON.parse(responseText);
    logger.log(`✅ Toll-free verification submitted: ${verification.sid}`);

    return {
      success: true,
      message: `Toll-free verification submitted successfully. SID: ${verification.sid}`,
      verificationSid: verification.sid,
      status: verification.status
    };

  } catch (error) {
    logger.error('Error submitting toll-free verification:', error);
    return {
      success: false,
      message: `Failed to submit toll-free verification: ${(error as Error).message}`,
    };
  }
}

/**
 * Check status of toll-free verification
 * Note: This function is Twilio-specific and only works with Twilio provider
 */
export async function checkTollFreeVerificationStatus(verificationSid?: string): Promise<TollFreeVerificationResult> {
  const provider = await resolveProvider();
  
  if (!provider || provider.name !== 'twilio') {
    return {
      success: false,
      message: 'Toll-free verification status is only available with Twilio provider',
    };
  }

  if (!provider.isConfigured()) {
    return {
      success: false,
      message: 'Twilio SMS service not configured - missing credentials',
    };
  }

  try {
    if (verificationSid) {
      // Check specific verification using REST API
      const response = await fetch(`https://messaging.twilio.com/v1/Tollfree/Verifications/${verificationSid}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio API error: ${response.status} ${errorText}`);
      }

      const verification = await response.json();
      
      return {
        success: true,
        message: `Verification status: ${verification.status}`,
        verificationSid: verification.sid,
        status: verification.status
      };
    } else {
      // Get all verifications for this account using REST API
      const response = await fetch('https://messaging.twilio.com/v1/Tollfree/Verifications?PageSize=20', {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const verifications = data.verifications || [];
      
      const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
      const phoneVerifications = verifications.filter((v: any) => 
        v.tollfree_phone_number === twilioPhoneNumber
      );

      if (phoneVerifications.length === 0) {
        return {
          success: false,
          message: 'No toll-free verifications found for this phone number',
        };
      }

      const latest = phoneVerifications[0]; // Most recent
      return {
        success: true,
        message: `Latest verification status: ${latest.status}`,
        verificationSid: latest.sid,
        status: latest.status
      };
    }

  } catch (error) {
    logger.error('Error checking toll-free verification status:', error);
    return {
      success: false,
      message: `Failed to check verification status: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS reminder for an upcoming event to a specific volunteer or TSP contact
 */
export async function sendEventReminderSMS(
  phoneNumber: string,
  volunteerName: string,
  organizationName: string,
  eventDate: Date,
  role?: string,
  appUrl?: string,
  instructions?: string | null,
  eventContactDetails?: {
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  } | null
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();

  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const eventDateStr = eventDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
    });

    const roleText = role && role !== 'general' ? ` as ${role}` : '';
    const instructionsText = instructions && instructions.length < 100
      ? ` Note: ${instructions}`
      : instructions
        ? ' Check your email for detailed instructions.'
        : '';

    // Build contact details section for corporate/detailed reminders
    let contactSection = '';
    if (eventContactDetails) {
      const contactParts: string[] = [];
      if (eventContactDetails.contactName) {
        contactParts.push(`Contact: ${eventContactDetails.contactName}`);
      }
      if (eventContactDetails.contactPhone) {
        contactParts.push(`📞 ${eventContactDetails.contactPhone}`);
      }
      if (eventContactDetails.contactEmail) {
        contactParts.push(`✉️ ${eventContactDetails.contactEmail}`);
      }
      if (contactParts.length > 0) {
        contactSection = ` ${contactParts.join(' | ')}`;
      }
    }

    const message = `Hi ${volunteerName}! 🥪 Reminder: You're scheduled${roleText} for The Sandwich Project event at ${organizationName} on ${eventDateStr}.${contactSection}${instructionsText} ${appUrl ? `View details: ${appUrl}` : ''} Thanks for making a difference!`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ Event reminder SMS sent to ${phoneNumber} for ${organizationName}`);
      return {
        success: true,
        message: 'Event reminder sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending event reminder SMS:', error);
    return {
      success: false,
      message: `Failed to send event reminder: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS notification when a user is mentioned in a chat channel
 */
export async function sendChatMentionSMS(
  phoneNumber: string,
  recipientName: string,
  senderName: string,
  channelName: string,
  messagePreview: string,
  appUrl?: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const message = `Hi ${recipientName}! 💬 ${senderName} mentioned you in #${channelName}: "${messagePreview}". ${appUrl ? `View: ${appUrl}` : ''}`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ Chat mention SMS sent to ${phoneNumber} for mention by ${senderName}`);
      return {
        success: true,
        message: 'Chat mention notification sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending chat mention SMS:', error);
    return {
      success: false,
      message: `Failed to send chat mention notification: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS notification when a user is assigned to a Holding Zone item
 */
export async function sendTeamBoardAssignmentSMS(
  phoneNumber: string,
  recipientName: string,
  itemTitle: string,
  assignedByName: string,
  itemType: string,
  appUrl?: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();

  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const message = `Hi ${recipientName}! 📋 You've been assigned to a ${itemType}: "${itemTitle}" by ${assignedByName}. ${appUrl ? `View: ${appUrl}` : ''}`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ Holding Zone assignment SMS sent to ${phoneNumber} for ${itemType}: ${itemTitle}`);
      return {
        success: true,
        message: 'Holding Zone assignment notification sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending Holding Zone assignment SMS:', error);
    return {
      success: false,
      message: `Failed to send Holding Zone assignment notification: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS notification when a user is assigned as TSP contact for an event
 */
export async function sendTSPContactAssignmentSMS(
  phoneNumber: string,
  recipientName: string,
  organizationName: string,
  eventDate: string,
  appUrl?: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const message = `Hi ${recipientName}! 🥪 You've been assigned as TSP contact for ${organizationName} on ${eventDate}. ${appUrl ? `View details: ${appUrl}` : ''}`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ TSP contact assignment SMS sent to ${phoneNumber} for ${organizationName}`);
      return {
        success: true,
        message: 'TSP contact assignment notification sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending TSP contact assignment SMS:', error);
    return {
      success: false,
      message: `Failed to send TSP contact assignment notification: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS reminder for collection submission
 */
export async function sendCollectionReminderSMS(
  phoneNumber: string,
  recipientName: string,
  hostLocation: string,
  weekEnding: string,
  appUrl?: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();
  
  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const message = `Hi ${recipientName}! 🥪 Reminder: Weekly sandwich count for ${hostLocation} (week ending ${weekEnding}) hasn't been submitted yet. ${appUrl ? `Submit: ${appUrl}` : ''}`;

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ Collection reminder SMS sent to ${phoneNumber} for ${hostLocation}`);
      return {
        success: true,
        message: 'Collection reminder notification sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending collection reminder SMS:', error);
    return {
      success: false,
      message: `Failed to send collection reminder notification: ${(error as Error).message}`,
    };
  }
}

/**
 * Send SMS notification when someone comments on an event where user is TSP contact
 */
export async function sendEventCommentSMS(
  phoneNumber: string,
  recipientName: string,
  commenterName: string,
  organizationName: string,
  commentPreview: string,
  appUrl?: string,
  originalComment?: { userName: string; content: string }
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();

  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    // Truncate comment preview if too long (keep SMS under 160 chars ideally)
    const maxPreviewLength = originalComment ? 40 : 50;
    const truncatedPreview = commentPreview.length > maxPreviewLength
      ? commentPreview.substring(0, maxPreviewLength) + '...'
      : commentPreview;

    let message: string;
    if (originalComment) {
      // This is a reply - include context about original comment
      const originalPreview = originalComment.content.length > 30
        ? originalComment.content.substring(0, 30) + '...'
        : originalComment.content;
      message = `Hi ${recipientName}! ↩️ ${commenterName} replied to "${originalPreview}": "${truncatedPreview}" ${appUrl ? `View: ${appUrl}` : ''}`;
    } else {
      message = `Hi ${recipientName}! 💬 ${commenterName} commented on ${organizationName}: "${truncatedPreview}" ${appUrl ? `View: ${appUrl}` : ''}`;
    }

    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ Event comment SMS sent to ${phoneNumber} for comment by ${commenterName}`);
      return {
        success: true,
        message: 'Event comment notification sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending event comment SMS:', error);
    return {
      success: false,
      message: `Failed to send event comment notification: ${(error as Error).message}`,
    };
  }
}

/**
 * Send automated TSP follow-up reminder SMS
 * Used for approaching events still in progress or toolkit-only events needing follow-up
 */
export async function sendTSPFollowupReminderSMS(
  phoneNumber: string,
  message: string
): Promise<SMSReminderResult> {
  const provider = await resolveProvider();

  if (!provider || !provider.isConfigured()) {
    return {
      success: false,
      message: 'SMS service not configured',
    };
  }

  try {
    const result = await provider.sendSMS({
      to: phoneNumber,
      body: message,
    });

    if (result.success) {
      logger.log(`✅ TSP follow-up reminder SMS sent to ${phoneNumber}`);
      return {
        success: true,
        message: 'TSP follow-up reminder sent successfully',
        sentTo: phoneNumber,
      };
    } else {
      return {
        success: false,
        message: result.message,
      };
    }
  } catch (error) {
    logger.error('Error sending TSP follow-up reminder SMS:', error);
    return {
      success: false,
      message: `Failed to send TSP follow-up reminder: ${(error as Error).message}`,
    };
  }
}
