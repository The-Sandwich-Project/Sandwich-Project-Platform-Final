import { logger } from './production-safe-logger';
import { ADMIN_EMAIL } from '../config/organization';

/**
 * Send email notification to admin whenever an SMS is sent
 * This allows the admin to monitor all SMS communications from the app
 */
export async function notifyAdminOfSMS(params: {
  to: string;
  message: string;
  messageType?: string;
  success: boolean;
  messageId?: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    const { sendEmail } = await import('../services/email');
    const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('./email-footer');
    
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone: 'America/New_York'
    });
    
    // Redact phone number for privacy (show last 4 digits)
    const redactedPhone = params.to.length > 4 
      ? `***${params.to.slice(-4)}`
      : params.to;
    
    const statusEmoji = params.success ? '✅' : '❌';
    const statusText = params.success ? 'Successfully Sent' : 'Failed';
    const messageType = params.messageType || 'SMS Message';
    
    // Email subject
    const subject = `${statusEmoji} SMS Sent: ${messageType}`;
    
    // Plain text email
    const text = `
SMS Communication Report
========================

Status: ${statusText}
Type: ${messageType}
Sent At: ${timestamp}
Recipient: ${redactedPhone}
${params.messageId ? `Message ID: ${params.messageId}` : ''}
${params.errorMessage ? `Error: ${params.errorMessage}` : ''}

Message Content:
----------------
${params.message}

${EMAIL_FOOTER_TEXT}
    `.trim();
    
    // HTML email
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #236383;">${statusEmoji} SMS Communication Report</h2>
        <p>An SMS message was ${params.success ? 'successfully sent' : 'attempted'} by the app.</p>
        
        <div style="background-color: ${params.success ? '#f0f9ff' : '#fff5f5'}; padding: 20px; border-left: 4px solid ${params.success ? '#236383' : '#e53e3e'}; border-radius: 4px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Message Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 120px;">Status:</td>
              <td style="padding: 8px 0; color: ${params.success ? '#38a169' : '#e53e3e'};">${statusText}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Type:</td>
              <td style="padding: 8px 0;">${messageType}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Sent At:</td>
              <td style="padding: 8px 0;">${timestamp}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Recipient:</td>
              <td style="padding: 8px 0;">${redactedPhone}</td>
            </tr>
            ${params.messageId ? `
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Message ID:</td>
              <td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${params.messageId}</td>
            </tr>
            ` : ''}
            ${params.errorMessage ? `
            <tr>
              <td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Error:</td>
              <td style="padding: 8px 0; color: #e53e3e;">${params.errorMessage}</td>
            </tr>
            ` : ''}
          </table>
        </div>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 4px; margin: 20px 0;">
          <h4 style="margin-top: 0; color: #333;">Message Content:</h4>
          <p style="white-space: pre-wrap; font-family: monospace; background-color: white; padding: 15px; border-radius: 4px; border: 1px solid #e2e8f0;">${params.message}</p>
        </div>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">This is an automated monitoring notification from The Sandwich Project SMS system.</p>
        ${EMAIL_FOOTER_HTML}
      </div>
    `;
    
    // Send the monitoring email
    await sendEmail({
      emailStream: 'operational',
      to: ADMIN_EMAIL,
      from: 'katie@thesandwichproject.org',
      subject,
      text,
      html,
    });
    
    logger.log(`📧 SMS monitoring notification sent to ${ADMIN_EMAIL}`);
  } catch (error) {
    // Don't throw - monitoring should not break SMS functionality
    logger.error('Failed to send SMS monitoring notification:', error);
  }
}
