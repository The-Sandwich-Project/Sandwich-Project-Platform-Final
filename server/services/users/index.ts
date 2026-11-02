import { storage } from '../../storage-wrapper';
import { getDefaultPermissionsForRole, PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import { AuditLogger } from '../../audit-logger';
import { logger } from '../../utils/production-safe-logger';
import { authService } from '../auth.service';
import { geocodeAddress } from '../../utils/geocoding';

export interface IUserService {
  // User CRUD operations
  getAllUsers(): Promise<any[]>;
  getUsersForAssignments(): Promise<any[]>;
  createUser(userData: CreateUserData): Promise<any>;
  updateUser(
    id: string,
    updates: UserUpdateData,
    requestUserId?: string
  ): Promise<any>;
  updateUserStatus(id: string, isActive: boolean): Promise<any>;
  updateUserProfile(
    id: string,
    profileData: UserProfileData,
    requestUserId?: string
  ): Promise<any>;
  deleteUser(id: string): Promise<void>;
  setUserPassword(id: string, password: string): Promise<void>;

  // User validation logic
  validateUserData(userData: any): ValidationResult;
  validatePassword(password: string): ValidationResult;

  // User permission management
  getUserPermissions(userId: string): Promise<string[]>;
  checkUserExists(email: string): Promise<boolean>;
}

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  password?: string;
}

export interface UserUpdateData {
  role?: string;
  permissions?: string[];
  metadata?: any;
  permissionsModifiedAt?: Date;
  permissionsModifiedBy?: string | null;
}

export interface UserProfileData {
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  preferredEmail?: string;
  address?: string;
  vanApproved?: boolean;
  speakerApproved?: boolean;
  driverApproved?: boolean;
  role?: string;
  isActive?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class UserService implements IUserService {
  async getAllUsers(): Promise<any[]> {
    try {
      const users = await storage.getAllUsers();
      return users;
    } catch (error) {
      logger.error('Error fetching all users:', error);
      throw new Error('Failed to fetch users');
    }
  }

  async getUsersForAssignments(): Promise<any[]> {
    try {
      const users = await storage.getAllUsers();
      // Return basic user info needed for assignments
      // Only include active, approved users (exclude pending/rejected)
      const assignableUsers = users
        .filter((user) => user.isActive === true)
        .map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          displayName:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.displayName || user.email,
          // Whether this person can see Team Chat (and so receive chat popups/DMs)
          canChat: hasPermission(user as any, PERMISSIONS.NAV_TEAM_CHAT),
        }));
      return assignableUsers;
    } catch (error) {
      logger.error('Error fetching users for assignments:', error);
      throw new Error('Failed to fetch users for assignments');
    }
  }

  async createUser(userData: CreateUserData): Promise<any> {
    try {
      // Validate required fields
      const validation = this.validateUserData(userData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Generate user ID and get default permissions for role
      const userId =
        'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const userRole = userData.role || 'volunteer';
      const defaultPermissions = getDefaultPermissionsForRole(userRole);

      // Handle password - if provided, hash it; otherwise mark for setup
      let hashedPassword: string | null = null;
      let needsPasswordSetup = true;

      if (userData.password && userData.password.trim().length > 0) {
        hashedPassword = await authService.hashPassword(userData.password);
        needsPasswordSetup = false;
      }

      const newUser = await storage.createUser({
        id: userId,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userRole,
        permissions: defaultPermissions,
        isActive: true,
        profileImageUrl: null,
        metadata: {},
        password: hashedPassword,
        needsPasswordSetup,
      });

      return newUser;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(
    id: string,
    updates: UserUpdateData,
    requestUserId?: string
  ): Promise<any> {
    try {
      // Deduplicate permissions to prevent database inconsistencies
      if (updates.permissions) {
        updates.permissions = [...new Set(updates.permissions)];
      }

      // Build update object with only provided fields
      const updateData: any = {};
      if (updates.role !== undefined) updateData.role = updates.role;
      if (updates.permissions !== undefined) {
        updateData.permissions = updates.permissions;
        updateData.permissionsModifiedAt = new Date();
        updateData.permissionsModifiedBy = requestUserId || 'system';
      }
      if (updates.metadata !== undefined)
        updateData.metadata = updates.metadata;

      const updatedUser = await storage.updateUser(id, updateData);
      return updatedUser;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw new Error('Failed to update user');
    }
  }

  async updateUserStatus(id: string, isActive: boolean): Promise<any> {
    try {
      const updatedUser = await storage.updateUser(id, { isActive });
      return updatedUser;
    } catch (error) {
      logger.error('Error updating user status:', error);
      throw new Error('Failed to update user status');
    }
  }

  async updateUserProfile(
    id: string,
    profileData: UserProfileData,
    requestUserId?: string
  ): Promise<any> {
    try {
      // Get old user data before update for audit logging
      const oldUser = await storage.getUserById(id);
      
      // Build update object with only provided fields
      const updateData: any = {};
      if (profileData.email !== undefined) updateData.email = profileData.email;
      if (profileData.firstName !== undefined)
        updateData.firstName = profileData.firstName;
      if (profileData.lastName !== undefined)
        updateData.lastName = profileData.lastName;
      if (profileData.phoneNumber !== undefined)
        updateData.phoneNumber = profileData.phoneNumber;
      if (profileData.preferredEmail !== undefined)
        updateData.preferredEmail = profileData.preferredEmail;
      if (profileData.role !== undefined) updateData.role = profileData.role;
      if (profileData.isActive !== undefined)
        updateData.isActive = profileData.isActive;
      // Coordinator-granted event-role approvals. The user-management dialog
      // sends all three flags on every profile save, so presence alone doesn't
      // mean a change. Compare against the stored values and only re-stamp the
      // audit columns when an approval actually flips — otherwise editing a
      // name would overwrite "who vetted this speaker/driver".
      let eventRoleApprovalChanged = false;
      if (profileData.vanApproved !== undefined) {
        updateData.vanApproved = profileData.vanApproved;
        if (!!oldUser?.vanApproved !== !!profileData.vanApproved) eventRoleApprovalChanged = true;
      }
      if (profileData.speakerApproved !== undefined) {
        updateData.speakerApproved = profileData.speakerApproved;
        if (!!oldUser?.speakerApproved !== !!profileData.speakerApproved) eventRoleApprovalChanged = true;
      }
      if (profileData.driverApproved !== undefined) {
        updateData.driverApproved = profileData.driverApproved;
        if (!!oldUser?.driverApproved !== !!profileData.driverApproved) eventRoleApprovalChanged = true;
      }
      if (eventRoleApprovalChanged) {
        updateData.eventRolesModifiedAt = new Date();
        updateData.eventRolesModifiedBy = requestUserId ?? null;
      }

      // Handle address changes with auto-geocoding
      if (profileData.address !== undefined) {
        updateData.address = profileData.address;
        if (profileData.address && profileData.address.trim() !== '') {
          // Only geocode if address actually changed
          const addressChanged = !oldUser || oldUser.address !== profileData.address;
          if (addressChanged) {
            try {
              const coords = await geocodeAddress(profileData.address);
              if (coords) {
                updateData.latitude = coords.latitude;
                updateData.longitude = coords.longitude;
                updateData.geocodedAt = new Date();
                logger.info(`Geocoded address for user ${id}: ${coords.latitude}, ${coords.longitude}`);
              }
            } catch (geoErr) {
              logger.error(`Failed to geocode address for user ${id}:`, geoErr);
            }
          }
        } else {
          // Address cleared — clear coordinates too
          updateData.latitude = null;
          updateData.longitude = null;
          updateData.geocodedAt = null;
        }
      }

      const updatedUser = await storage.updateUser(id, updateData);

      // Log the user profile update with old and new data for better audit trail
      if (requestUserId) {
        await AuditLogger.logEntityChange(
          'users',
          id,
          oldUser || {},
          updatedUser || {},
          { userId: requestUserId },
          {
            actionType: 'user_profile_updated',
            section: 'user_management'
          }
        );
      }

      return updatedUser;
    } catch (error) {
      logger.error('Error updating user profile:', error);
      throw new Error('Failed to update user profile');
    }
  }

  async deleteUser(id: string): Promise<void> {
    try {
      await storage.deleteUser(id);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw new Error('Failed to delete user');
    }
  }

  async setUserPassword(id: string, password: string): Promise<void> {
    try {
      const passwordValidation = this.validatePassword(password);
      if (!passwordValidation.isValid) {
        throw new Error(passwordValidation.errors.join(', '));
      }

      // Hash the password with bcrypt before storing
      const hashedPassword = await authService.hashPassword(password);
      await storage.setUserPassword(id, hashedPassword);
    } catch (error) {
      logger.error('Error setting user password:', error);
      throw error;
    }
  }

  validateUserData(userData: any): ValidationResult {
    const errors: string[] = [];

    if (!userData.email) {
      errors.push('Email is required');
    }
    if (!userData.firstName) {
      errors.push('First name is required');
    }
    if (!userData.lastName) {
      errors.push('Last name is required');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  validatePassword(password: string): ValidationResult {
    const errors: string[] = [];

    if (!password || password.length < 6) {
      errors.push('Password must be at least 6 characters long');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    try {
      const user = await storage.getUserById(userId);
      return user?.permissions || [];
    } catch (error) {
      logger.error('Error fetching user permissions:', error);
      return [];
    }
  }

  async checkUserExists(email: string): Promise<boolean> {
    try {
      const user = await storage.getUserByEmail(email);
      return !!user;
    } catch (error) {
      logger.error('Error checking if user exists:', error);
      return false;
    }
  }
}

export const userService = new UserService();
