/**
 * Authentication Routes
 *
 * Single source of truth for all authentication endpoints
 * - POST /api/auth/login - User login
 * - POST /api/auth/logout - User logout
 * - GET /api/auth/me - Get current user (new endpoint)
 * - GET /api/auth/user - Get current user (legacy compatibility)
 * - GET /api/auth/profile - Get current user's profile
 * - PUT /api/auth/profile - Update current user's profile
 * - PUT /api/auth/change-password - Change user's password
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../../storage-wrapper';
import { authService, AuthError } from '../../services/auth.service';
import { applyPermissionDependencies, getDefaultPermissionsForRole } from '../../../shared/auth-utils';
import { logger } from '../../utils/production-safe-logger';
import { isAuthenticated } from '../../middleware/auth';
import { loginRateLimiter } from '../../middleware/rate-limiter';
import type { AuthenticatedRequest, MaybeAuthenticatedRequest } from '../../types/express';
import { db } from '../../db';
import { passwordResetTokens } from '@shared/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { getAppBaseUrl, DEFAULT_HOST } from '../../config/constants';
import { geocodeAddress } from '../../utils/geocoding';

export function createAuthRouter() {
  const router = Router();

  /**
   * POST /api/auth/login
   * Authenticate user and create session
   */
  router.post('/login', loginRateLimiter, async (req: MaybeAuthenticatedRequest, res: Response) => {
    try {
      const { email, password } = req.body;

      // Email is always required
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required',
        });
      }

      // Find user by email first (to check if they need password setup)
      const user = await storage.getUserByEmail(email);
      if (!user) {
        logger.warn(`Failed login attempt for non-existent user: ${email}`);
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      // Check if user is active
      try {
        authService.validateUserActive(user);
      } catch (error) {
        if (error instanceof AuthError) {
          logger.log(`❌ Inactive user attempted login: ${email}`);
          return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }

      // Check if user needs to set up their password (manually created without password)
      // This check happens BEFORE password validation so users can login with blank password
      if (user.needsPasswordSetup) {
        logger.log(`🔐 User ${email} needs to set up password`);
        return res.status(403).json({
          success: false,
          code: 'PASSWORD_SETUP_REQUIRED',
          message: 'Please set up your password to complete your account.',
          needsPasswordSetup: true,
          email: user.email,
        });
      }

      // Now validate that password was provided (only for users who already have a password)
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required',
        });
      }

      // Verify password (bcrypt only - no plaintext)
      let isValidPassword = false;
      try {
        isValidPassword = await authService.verifyPassword(password, user.password);
      } catch (error) {
        if (error instanceof AuthError) {
          logger.error(`Password verification error for ${email}: ${error.code}`);
          return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }

      if (!isValidPassword) {
        logger.warn(`Failed login attempt for ${email} - invalid password`);
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      // Get user permissions (prefer stored permissions, fall back to role defaults)
      const basePermissions = Array.isArray(user.permissions)
        ? user.permissions // Honor explicitly-set permissions, even empty
        : getDefaultPermissionsForRole(user.role); // Fallback only when not set
      const permissions = applyPermissionDependencies(basePermissions);

      // Create session user object
      const sessionUser = authService.createSessionUser(user, permissions);

      // Save to session
      try {
        await authService.saveSession(req, sessionUser);
      } catch (error) {
        if (error instanceof AuthError) {
          return res.status(error.statusCode).json({
            success: false,
            message: error.message,
          });
        }
        throw error;
      }

      logger.info(`✅ Successful login: ${email} (${user.role})`);

      return res.json({
        success: true,
        user: sessionUser,
      });
    } catch (error) {
      logger.error('Login error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred during login',
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Destroy session and log out user
   */
  router.post('/logout', async (req: MaybeAuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.session.user?.email || 'unknown';

      await authService.destroySession(req);

      logger.log(`👋 User logged out: ${userEmail}`);

      return res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      logger.error('Logout error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred during logout',
      });
    }
  });

  /**
   * GET /api/auth/me
   * Get currently authenticated user
   */
  router.get('/me', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated',
        });
      }

      return res.json({
        success: true,
        user: req.user,
      });
    } catch (error) {
      logger.error('Get current user error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred',
      });
    }
  });

  /**
   * GET /api/auth/user
   * Legacy endpoint for backward compatibility
   * Redirects to /me internally
   */
  router.get('/user', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      // In development mode, if user is a dev admin, return the injected user directly
      const isDevMode = process.env.APP_ENV === 'development' && process.env.NODE_ENV !== 'production' && process.env.REPLIT_DEPLOYMENT !== '1';
      if (isDevMode && (req.user.email?.includes('dev@') || req.user.email?.includes('thesandwichproject.org'))) {
        // Try database lookup first, but fall back to injected user
        const freshUser = await storage.getUserByEmail(req.user.email);
        if (freshUser) {
          const userRole = freshUser.role ?? req.user.role;
          const basePermissions = Array.isArray(freshUser.permissions)
            ? freshUser.permissions
            : getDefaultPermissionsForRole(userRole);
          const permissions = applyPermissionDependencies(basePermissions);
          return res.json({
            ...freshUser,
            role: userRole,
            permissions,
          });
        }
        // Return injected dev user if not in database
        const permissions = applyPermissionDependencies(getDefaultPermissionsForRole('super_admin'));
        return res.json({
          ...req.user,
          permissions,
        });
      }

      // Fetch fresh user data from database
      const freshUser = await storage.getUserByEmail(req.user.email);

      if (!freshUser) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Ensure role is always present - fallback to session user's role if storage doesn't return it
      // This fixes the super_admin bypass not working when role is stripped by storage layer
      const userRole = freshUser.role ?? req.user.role;

      // Get permissions (prefer stored permissions, fall back to role defaults)
      const basePermissions = Array.isArray(freshUser.permissions)
        ? freshUser.permissions
        : getDefaultPermissionsForRole(userRole);
      const permissions = applyPermissionDependencies(basePermissions);

      return res.json({
        ...freshUser,
        role: userRole, // Explicitly include role to ensure super_admin bypass works
        permissions,
      });
    } catch (error) {
      logger.error('Get user error:', error);
      return res.status(500).json({ message: 'An error occurred' });
    }
  });

  /**
   * GET /api/auth/profile
   * Get current user's profile data
   */
  router.get('/profile', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      // Fetch fresh user data from database
      const freshUser = await storage.getUserByEmail(req.user.email);

      if (!freshUser) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Return profile data (exclude sensitive fields like password)
      return res.json({
        id: freshUser.id,
        email: freshUser.email,
        firstName: freshUser.firstName,
        lastName: freshUser.lastName,
        displayName: freshUser.displayName,
        preferredEmail: freshUser.preferredEmail,
        phoneNumber: freshUser.phoneNumber,
        address: freshUser.address,
        profileImageUrl: freshUser.profileImageUrl,
        role: freshUser.role,
        isActive: freshUser.isActive,
        // Self-declared event-role willingness (editable below). Approval flags
        // (speakerApproved/driverApproved/vanApproved) are intentionally not
        // editable here — only coordinators set those via user management.
        willingToVolunteer: freshUser.willingToVolunteer ?? true,
        willingToSpeak: freshUser.willingToSpeak ?? false,
        willingToDrive: freshUser.willingToDrive ?? false,
        speakerApproved: freshUser.speakerApproved ?? false,
        driverApproved: freshUser.driverApproved ?? false,
        vanApproved: freshUser.vanApproved ?? false,
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      return res.status(500).json({ message: 'An error occurred' });
    }
  });

  /**
   * PUT /api/auth/profile
   * Update current user's profile
   */
  router.put('/profile', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const {
        firstName, lastName, displayName, preferredEmail, phoneNumber, address,
        willingToVolunteer, willingToSpeak, willingToDrive,
      } = req.body;

      // Build update object with only provided fields
      const updateData: any = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (displayName !== undefined) updateData.displayName = displayName;
      if (preferredEmail !== undefined) updateData.preferredEmail = preferredEmail;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
      // Self-declared willingness only. Users can say what they want to do; they
      // cannot grant themselves the approval flags (speaker/driver/van) — those
      // are coordinator-controlled in user management.
      // Only a literal boolean true counts as "willing" — coerce strictly so a
      // crafted body like { willingToSpeak: 'false' } can't flip the flag on.
      if (willingToVolunteer !== undefined) updateData.willingToVolunteer = willingToVolunteer === true;
      if (willingToSpeak !== undefined) updateData.willingToSpeak = willingToSpeak === true;
      if (willingToDrive !== undefined) updateData.willingToDrive = willingToDrive === true;
      if (address !== undefined) {
        updateData.address = address;
        // Auto-geocode when address changes
        const existingUser = await storage.getUserById(req.user.id);
        const addressChanged = address !== existingUser?.address;
        if (address && address.trim() && addressChanged) {
          const result = await geocodeAddress(address.trim());
          if (result) {
            updateData.latitude = result.latitude;
            updateData.longitude = result.longitude;
            updateData.geocodedAt = new Date();
            logger.log(`Geocoded user ${req.user.id} address: ${address} -> (${result.latitude}, ${result.longitude})`);
          } else {
            logger.warn(`Failed to geocode user ${req.user.id} address: ${address}`);
          }
        } else if (!address || !address.trim()) {
          // Clear coordinates when address is removed
          updateData.latitude = null;
          updateData.longitude = null;
          updateData.geocodedAt = null;
        }
      }

      // Update user profile
      const updatedUser = await storage.updateUser(req.user.id, updateData);

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Update session with fresh data
      if (req.session?.user) {
        req.session.user = {
          ...req.session.user,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
        };
      }

      // Return updated profile (exclude sensitive fields)
      return res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        displayName: updatedUser.displayName,
        preferredEmail: updatedUser.preferredEmail,
        phoneNumber: updatedUser.phoneNumber,
        address: updatedUser.address,
        profileImageUrl: updatedUser.profileImageUrl,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        willingToVolunteer: updatedUser.willingToVolunteer ?? true,
        willingToSpeak: updatedUser.willingToSpeak ?? false,
        willingToDrive: updatedUser.willingToDrive ?? false,
        // Mirror GET /profile's shape — include the (read-only) approval flags so
        // clients can rely on a consistent payload after a save.
        speakerApproved: updatedUser.speakerApproved ?? false,
        driverApproved: updatedUser.driverApproved ?? false,
        vanApproved: updatedUser.vanApproved ?? false,
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      return res.status(500).json({ message: 'An error occurred' });
    }
  });

  /**
   * PUT /api/auth/change-password
   * Change current user's password (requires current password verification)
   */
  router.put('/change-password', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          message: 'Current password and new password are required',
        });
      }

      // Fetch user to get current password hash
      const user = await storage.getUserByEmail(req.user.email);
      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Verify current password
      const isValidPassword = await authService.verifyPassword(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({
          message: 'Current password is incorrect',
        });
      }

      // Validate new password strength - must match frontend requirements
      // Frontend requires: 8+ characters, lowercase, uppercase, and digit
      if (newPassword.length < 8) {
        return res.status(400).json({
          message: 'New password must be at least 8 characters long',
        });
      }

      // Validate password contains lowercase, uppercase, and digit
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
      if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({
          message: 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
        });
      }

      // Hash and update password
      const hashedPassword = await authService.hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashedPassword });

      logger.log(`Password changed successfully for user: ${user.email}`);

      return res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return res.status(error.statusCode).json({
          message: error.message,
        });
      }

      logger.error('Change password error:', error);
      return res.status(500).json({ message: 'An error occurred' });
    }
  });

  // Token storage is now handled by the passwordResetTokens database table
  // Cleanup is handled by the periodic job in password-reset.ts

  /**
   * POST /api/auth/request-initial-password
   * Request initial password setup token for users who were created without one
   * Sends an email with a secure token that must be used to set the password
   */
  router.post('/request-initial-password', async (req: MaybeAuthenticatedRequest, res: Response) => {
    try {
      const { email } = req.body;

      // Validate input
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required',
        });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists for security reasons
        return res.json({
          success: true,
          message: 'If an account with this email exists and requires password setup, you will receive an email.',
        });
      }

      // Verify that this user actually needs password setup
      if (!user.needsPasswordSetup) {
        // Don't reveal if email exists - return same message
        return res.json({
          success: true,
          message: 'If an account with this email exists and requires password setup, you will receive an email.',
        });
      }

      // Generate secure token
      const crypto = await import('crypto');
      const setupToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store token in database (delete any existing tokens for this user first)
      await db.delete(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          eq(passwordResetTokens.tokenType, 'initial_password')
        ));

      await db.insert(passwordResetTokens).values({
        token: setupToken,
        userId: user.id,
        email: user.email,
        tokenType: 'initial_password',
        expiresAt,
      });

      // Send password setup email
      try {
        // Use centralized URL function for setup links
        const baseUrl = getAppBaseUrl(req);
        const setupLink = `${baseUrl}/set-password?token=${setupToken}`;

        const { sendEmailOrThrow, isEmailConfigured } = await import('../../services/email');
        if (!isEmailConfigured()) {
          throw new Error('Twilio Email is not configured');
        }

        await sendEmailOrThrow({
          to: email,
          from: 'katie@thesandwichproject.org',
          subject: 'Set Up Your Password - The Sandwich Project',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
              <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #236383; margin: 0; font-size: 28px;">The Sandwich Project</h1>
                  <p style="color: #666; margin: 10px 0 0 0;">Volunteer Management Platform</p>
                </div>
                
                <h2 style="color: #333; margin-bottom: 20px;">Set Up Your Password</h2>
                
                <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
                  Your account has been created! To complete your account setup, please set a password by clicking the button below:
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${setupLink}" 
                     style="background-color: #236383; color: white; padding: 15px 30px; text-decoration: none; 
                            border-radius: 8px; font-weight: bold; display: inline-block; 
                            transition: background-color 0.3s;">
                    Set Your Password
                  </a>
                </div>
                
                <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">
                  This link will expire in 1 hour for security reasons.
                </p>
                
                <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
                  If you didn't expect this email, please contact support immediately.
                </p>
                
                <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
                  <p style="color: #888; font-size: 14px; margin: 0;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${setupLink}" style="color: #236383; word-break: break-all;">${setupLink}</a>
                  </p>
                </div>
              </div>
            </div>
          `,
          text: `
Set Up Your Password - The Sandwich Project

Your account has been created! To complete your account setup, please set a password by visiting this link:

${setupLink}

This link will expire in 1 hour for security reasons.

If you didn't expect this email, please contact support immediately.

The Sandwich Project
Fighting food insecurity one sandwich at a time
          `,
          emailStream: 'operational',
        });

        logger.log(`✅ Initial password setup email sent successfully to: ${email}`);
      } catch (emailError) {
        logger.error('❌ Failed to send initial password setup email:', emailError);
        // For development, log the setup link as fallback
        if (process.env.NODE_ENV === 'development') {
          logger.log(`
🔧 DEVELOPMENT FALLBACK - Email failed, but setup link available:
📧 Email: ${email}
🔗 Setup Link: ${getAppBaseUrl(req)}/set-password?token=${setupToken}
⏰ Expires: ${expiresAt.toLocaleString()}
          `);
        }
      }

      // Always return success message (don't reveal if email exists)
      return res.json({
        success: true,
        message: 'If an account with this email exists and requires password setup, you will receive an email.',
      });
    } catch (error) {
      logger.error('Request initial password error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred. Please try again later.',
      });
    }
  });

  /**
   * POST /api/auth/set-initial-password
   * Set password for users who were created without one (needsPasswordSetup = true)
   * REQUIRES a valid token from the request-initial-password endpoint
   */
  router.post('/set-initial-password', async (req: MaybeAuthenticatedRequest, res: Response) => {
    try {
      const { token, password } = req.body;

      // Validate input
      if (!token || !password) {
        return res.status(400).json({
          success: false,
          message: 'Token and password are required',
        });
      }

      // Validate password strength - must match frontend requirements
      // Frontend requires: 8+ characters, lowercase, uppercase, and digit
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long',
        });
      }

      // Validate password contains lowercase, uppercase, and digit
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          success: false,
          message: 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
        });
      }

      // Check if token exists and is valid (not expired, not used)
      const [tokenData] = await db
        .select()
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.tokenType, 'initial_password'),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt)
        ))
        .limit(1);

      if (!tokenData) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired setup token. Please request a new password setup link.',
        });
      }

      // Get user and verify they still need password setup
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

      // Verify that this user still needs password setup (may have been set already)
      if (!user.needsPasswordSetup) {
        // Mark token as used
        await db.update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.id, tokenData.id));
        return res.status(400).json({
          success: false,
          message: 'This account already has a password. Use forgot password to reset it.',
        });
      }

      // Hash the new password
      const hashedPassword = await authService.hashPassword(password);

      // Update user with new password and clear the needsPasswordSetup flag
      await storage.updateUser(user.id, {
        password: hashedPassword,
        needsPasswordSetup: false,
      });

      // Mark token as used
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, tokenData.id));

      logger.log(`✅ Initial password set for user: ${user.email}`);

      return res.json({
        success: true,
        message: 'Password set successfully! You can now log in.',
      });
    } catch (error) {
      logger.error('Set initial password error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred while setting password',
      });
    }
  });

  /**
   * GET /api/auth/verify-initial-password-token/:token
   * Verify if an initial password setup token is valid (for frontend to check)
   */
  router.get('/verify-initial-password-token/:token', async (req: MaybeAuthenticatedRequest, res: Response) => {
    try {
      const { token } = req.params;

      const [tokenData] = await db
        .select()
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.tokenType, 'initial_password'),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt)
        ))
        .limit(1);

      if (!tokenData) {
        return res.status(400).json({
          valid: false,
          message: 'Invalid or expired setup token',
        });
      }

      return res.json({
        valid: true,
        email: tokenData.email,
      });
    } catch (error) {
      logger.error('Verify initial password token error:', error);
      return res.status(500).json({
        valid: false,
        message: 'An error occurred while verifying token',
      });
    }
  });

  return router;
}

export default createAuthRouter;
