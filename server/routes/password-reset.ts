import { Router } from 'express';
import type { RouterDependencies } from '../types';
import { z } from 'zod';
import crypto from 'crypto';
import sgMail from '@sendgrid/mail';
import { withUnsubscribeSettings } from '../utils/sendgrid-unsubscribe';
import { authService } from '../services/auth.service';
import { logger } from '../utils/production-safe-logger';
import { passwordResetRateLimiter } from '../middleware/rate-limiter';
import { db } from '../db';
import { passwordResetTokens } from '@shared/schema';
import { eq, and, gt, isNull, lt } from 'drizzle-orm';
import { getAppBaseUrl, PASSWORD_RESET_EXPIRY_MS } from '../config/constants';

// Clean up expired tokens periodically (database-based)
setInterval(async () => {
  try {
    const result = await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
    logger.log(`[Token Cleanup] Cleaned up expired password reset tokens`);
  } catch (error) {
    logger.error('[Token Cleanup] Failed to clean up expired tokens:', error);
  }
}, 60000 * 60); // Clean up every hour

export function createPasswordResetRouter(deps: RouterDependencies) {
  const router = Router();
  const { storage } = deps;

// Request password reset
  router.post('/forgot-password', passwordResetRateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email('Please enter a valid email address'),
    });

    const { email } = schema.parse(req.body);

    // Check if user exists
    const user = await storage.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists for security reasons
      return res.json({
        success: true,
        message:
          'If an account with this email exists, you will receive a password reset link.',
      });
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);

    // Store token in database (delete any existing tokens for this user first)
    await db.delete(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.userId, user.id!),
        eq(passwordResetTokens.tokenType, 'password_reset')
      ));

    await db.insert(passwordResetTokens).values({
      token: resetToken,
      userId: user.id!,
      email: user.email,
      tokenType: 'password_reset',
      expiresAt,
    });

    // Send password reset email
    try {
      // Use centralized URL function for reset links
      const baseUrl = getAppBaseUrl(req);
      const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

      // Use SendGrid directly for password reset emails
      if (!process.env.SENDGRID_API_KEY) {
        throw new Error('SendGrid API key not configured');
      }

      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send(withUnsubscribeSettings({
        to: email,
        from: 'katie@thesandwichproject.org',
        subject: 'Password Reset - The Sandwich Project',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #236383; margin: 0; font-size: 28px;">The Sandwich Project</h1>
                <p style="color: #666; margin: 10px 0 0 0;">Volunteer Management Platform</p>
              </div>
              
              <h2 style="color: #333; margin-bottom: 20px;">Password Reset Request</h2>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
                We received a request to reset the password for your account. If you made this request, 
                click the button below to set a new password:
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" 
                   style="background-color: #236383; color: white; padding: 15px 30px; text-decoration: none; 
                          border-radius: 8px; font-weight: bold; display: inline-block; 
                          transition: background-color 0.3s;">
                  Reset Your Password
                </a>
              </div>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">
                This link will expire in 1 hour for security reasons.
              </p>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
                If you didn't request this password reset, please ignore this email. 
                Your account remains secure and no changes have been made.
              </p>
              
              <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
                <p style="color: #888; font-size: 14px; margin: 0;">
                  If the button doesn't work, copy and paste this link into your browser:<br>
                  <a href="${resetLink}" style="color: #236383; word-break: break-all;">${resetLink}</a>
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="color: #888; font-size: 12px; margin: 0 0 10px 0;">
                  The Sandwich Project<br>
                  Fighting food insecurity one sandwich at a time
                </p>
                <p style="color: #888; font-size: 11px; margin: 0;">
                  This is a password reset email sent at your request. If you did not request this, please ignore it.<br>
                  To unsubscribe from system notifications, please contact us at katie@thesandwichproject.org
                </p>
              </div>
            </div>
          </div>
        `,
        text: `
Password Reset Request - The Sandwich Project

We received a request to reset the password for your account.

To reset your password, visit this link:
${resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email. Your account remains secure and no changes have been made.

The Sandwich Project
Fighting food insecurity one sandwich at a time

This is a password reset email sent at your request. If you did not request this, please ignore it.
To unsubscribe from system notifications, please contact us at katie@thesandwichproject.org
        `,
      }, 'operational'));

      logger.log(`✅ Password reset email sent successfully to: ${email}`);
    } catch (emailError) {
      logger.error('❌ Failed to send password reset email:', emailError);
      // For development, log the reset link as fallback
      if (process.env.NODE_ENV === 'development') {
        logger.log(`
🔧 DEVELOPMENT FALLBACK - Email failed, but reset link available:
📧 Email: ${email}
🔗 Reset Link: ${getAppBaseUrl(req)}/reset-password?token=${resetToken}
⏰ Expires: ${expiresAt.toLocaleString()}
        `);
      }
    }

    res.json({
      success: true,
      message:
        'If an account with this email exists, you will receive a password reset link.',
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address',
      });
    }
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.',
    });
  }
});

// Reset password with token
  router.post('/reset-password', async (req, res) => {
  try {
    const schema = z.object({
      token: z.string().min(1, 'Reset token is required'),
      newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
          'Password must contain at least one lowercase letter, one uppercase letter, and one number'
        ),
    });

    const { token, newPassword } = schema.parse(req.body);

    // Check if token exists and is valid (not expired, not used, correct type)
    const [tokenData] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, token),
        eq(passwordResetTokens.tokenType, 'password_reset'),
        gt(passwordResetTokens.expiresAt, new Date()),
        isNull(passwordResetTokens.usedAt)
      ))
      .limit(1);

    if (!tokenData) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid or expired reset token. Please request a new password reset.',
      });
    }

    // Get user and update password
    const user = await storage.getUserById(tokenData.userId);
    if (!user) {
      // Mark token as used even if user not found
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, tokenData.id));
      return res.status(400).json({
        success: false,
        message: 'User not found',
      });
    }

    // Hash password using centralized auth service (handles trimming and consistent salt rounds)
    const hashedPassword = await authService.hashPassword(newPassword);
    await storage.updateUser(user.id!, {
      password: hashedPassword,
      needsPasswordSetup: false,
    });

    // Mark token as used
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, tokenData.id));

    logger.log(`Password reset successful for user: ${user.email}`);

    res.json({
      success: true,
      message:
        'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0].message,
      });
    }
    res.status(500).json({
      success: false,
      message:
        'An error occurred while resetting your password. Please try again.',
    });
  }
});

// Verify reset token (for frontend to check if token is valid)
  router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const [tokenData] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, token),
        eq(passwordResetTokens.tokenType, 'password_reset'),
        gt(passwordResetTokens.expiresAt, new Date()),
        isNull(passwordResetTokens.usedAt)
      ))
      .limit(1);

    if (!tokenData) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid or expired reset token',
      });
    }

    res.json({
      valid: true,
      email: tokenData.email,
    });
  } catch (error) {
    logger.error('Verify reset token error:', error);
    res.status(500).json({
      valid: false,
      message: 'Error verifying token',
    });
  }
});

  return router;
}

