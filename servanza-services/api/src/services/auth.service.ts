import { prisma } from '../config/database';
import { UserRole, AuthProvider } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import crypto from 'crypto';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { verifyIdTokenMultiProject } from '../config/firebase';
import { cacheSet, cacheGet, cacheDel } from '../config/redis';
import { addNotificationJob } from '../queues/notification.queue';
import { setFirebaseCustomClaims } from '../middleware/firebase-auth.middleware';

interface SignupData {
  email?: string;
  password?: string;
  name: string;
  phone?: string;
  role?: UserRole;
}

interface AuthResponse {
  user: {
    id: string;
    email?: string;
    phone?: string;
    name: string;
    role: UserRole;
    adminRole?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export class AuthService {
  private readonly JWT_SECRET: Secret = (process.env.JWT_SECRET as Secret) || ('your-secret-key' as Secret);
  private readonly REFRESH_TOKEN_EXPIRES_IN = '30d';

  /**
   * Email/Password signup
   */
  async signup(data: SignupData): Promise<AuthResponse> {
    try {
      if (!data.email && !data.phone) {
        throw new ApiError(400, 'Email or phone is required');
      }

      if (data.email && !data.password) {
        throw new ApiError(400, 'Password is required for email signup');
      }

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            data.email ? { email: data.email } : undefined,
            data.phone ? { phone: data.phone } : undefined,
          ].filter(Boolean) as any,
        },
      });

      if (existingUser) {
        throw new ApiError(409, 'User already exists');
      }

      const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;

      const user = await prisma.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          name: data.name,
          passwordHash,
          role: data.role || UserRole.USER,
          authProvider: data.email ? AuthProvider.EMAIL : AuthProvider.PHONE,
          emailVerified: false,
          phoneVerified: data.phone ? false : undefined,
        },
      });

      if (user.role === UserRole.BUDDY) {
        await prisma.buddy.create({
          data: {
            id: user.id,
            isAvailable: false,
            isOnline: false,
            isVerified: false,
          },
        });
      }

      const tokens = this.generateTokens(user.id, user.role);

      if (data.email) {
        await this.sendVerificationEmail(user.email!, user.id);
      }

      logger.info(`User signed up: ${user.id}`);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Signup error:', error);
      throw error;
    }
  }

  /**
   * Email/Password login
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        throw new ApiError(401, 'Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        throw new ApiError(401, 'Invalid credentials');
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = this.generateTokens(user.id, user.role);

      logger.info(`User logged in: ${user.id} (adminRole: ${user.adminRole})`);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
          adminRole: user.adminRole || undefined,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Admin-only login - Validates user has ADMIN role before allowing access
   * Used by the admin dashboard
   */
  async adminLogin(email: string, password: string): Promise<AuthResponse> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        throw new ApiError(401, 'Invalid credentials');
      }

      // Check if user is an ADMIN
      if (user.role !== 'ADMIN') {
        logger.warn(`Non-admin login attempt to admin panel: ${email} (role: ${user.role})`);
        throw new ApiError(403, 'Access denied. Admin account required.');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        throw new ApiError(401, 'Invalid credentials');
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      // Check if adminRole is set
      if (!user.adminRole) {
        logger.warn(`Admin without adminRole attempted login: ${email}`);
        throw new ApiError(403, 'Admin role not configured. Contact system administrator.');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = this.generateTokens(user.id, user.role);

      logger.info(`Admin logged in: ${user.id} (adminRole: ${user.adminRole})`);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
          adminRole: user.adminRole || undefined,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Admin login error:', error);
      throw error;
    }
  }

  /**
   * Send phone OTP via Firebase
   */
  async sendPhoneOTP(phone: string): Promise<void> {
    try {
      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store OTP in Redis with 10 minute expiry
      const otpKey = `otp:${phone}`;
      await cacheSet(otpKey, otp, 600); // 10 minutes

      // In production, Firebase handles OTP sending on client side
      // This is just for development/testing
      logger.info(`OTP for ${phone}: ${otp} (Firebase Auth should handle this on client)`);

      // Note: In production, client app uses Firebase Phone Auth directly
      // and sends the resulting ID token to backend for verification
    } catch (error) {
      logger.error('Send OTP error:', error);
      throw new ApiError(500, 'Failed to send OTP');
    }
  }

  /**
   * Verify phone OTP and login/signup with ROLE support
   */
  async verifyPhoneOTP(phone: string, otp: string, name?: string, role?: UserRole): Promise<AuthResponse> {
    try {
      // Verify OTP from Redis
      const otpKey = `otp:${phone}`;
      const storedOTP = await cacheGet<string>(otpKey);

      if (!storedOTP || storedOTP !== otp) {
        throw new ApiError(400, 'Invalid or expired OTP');
      }

      // Delete OTP after successful verification
      await cacheDel(otpKey);

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { phone },
      });

      if (!user) {
        // Create new user with specified role ->Now supports BUDDY role
        const userRole = role || UserRole.USER;

        user = await prisma.user.create({
          data: {
            phone,
            name: name || `User ${phone.slice(-4)}`,
            authProvider: AuthProvider.PHONE,
            phoneVerified: true,
            role: userRole,
          },
        });

        // Create buddy profile if role is BUDDY 
        if (userRole === UserRole.BUDDY) {
          await prisma.buddy.create({
            data: {
              id: user.id,
              isAvailable: false,
              isOnline: false,
              isVerified: false,
            },
          });
          logger.info(`New buddy created via phone: ${user.id}`);
        } else {
          logger.info(`New user created via phone: ${user.id}`);
        }
      } else {
        // Update existing user
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            phoneVerified: true,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Verify OTP error:', error);
      throw error;
    }
  }

  /**
   * Firebase Phone Authentication
   */

  async verifyFirebasePhoneToken(idToken: string, role?: UserRole): Promise<AuthResponse> {
    try {
      // Verify Firebase ID token (supports multiple projects)
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, phone_number, name } = decodedToken as any;

      if (!phone_number) {
        throw new ApiError(400, 'Phone number not found in token');
      }

      // Find or create user
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { firebaseUid: uid },
            { phone: phone_number },
          ],
        },
        include: { buddy: true }
      });

      const userRole = role || UserRole.USER;

      if (!user) {
        // --- SCENARIO 1: NEW USER ---
        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            phone: phone_number,
            name: name || `User ${phone_number.slice(-4)}`,
            authProvider: AuthProvider.PHONE,
            phoneVerified: true,
            role: userRole,
          },
          include: { buddy: true }
        });

        // Create buddy profile if role is BUDDY
        if (userRole === UserRole.BUDDY) {
          await prisma.buddy.create({
            data: {
              id: user.id,
              isAvailable: false,
              isOnline: false,
              isVerified: false,
            },
          });
          logger.info(`New buddy created via Firebase phone: ${user.id}`);
        }
      } else {
        // --- SCENARIO 2: EXISTING USER ---

        // 1. Update Firebase UID if missing/changed
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            phoneVerified: true,
            lastLoginAt: new Date(),
          },
          include: { buddy: true }
        });

        // 2. CRITICAL: Ensure Buddy Profile Exists
        // If user logged in before as a normal user but now wants to be a Buddy
        if (userRole === UserRole.BUDDY && !user.buddy) {
          await prisma.buddy.create({
            data: {
              id: user.id,
              isAvailable: false,
              isOnline: false,
              isVerified: false,
            },
          });

          // Update role to BUDDY if it wasn't already
          if (user.role !== UserRole.BUDDY) {
            await prisma.user.update({
              where: { id: user.id },
              data: { role: UserRole.BUDDY }
            });
            user.role = UserRole.BUDDY;
          }
          logger.info(`Existing user upgraded to Buddy: ${user.id}`);
        }
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      // Set Firebase custom claims
      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Firebase phone verification error:', error);
      throw new ApiError(401, 'Invalid Firebase token');
    }
  }

  /**
   * Unified Firebase Authentication - Auto-detects provider from token
   * Works with email/password, Google, Apple, Facebook, Twitter, and Phone
   */
  async verifyFirebaseToken(idToken: string, role?: UserRole): Promise<AuthResponse> {
    try {
      // Verify Firebase ID token (supports multiple projects)
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, email, phone_number, name, picture } = decodedToken as any;

      // Detect the sign-in provider from the token
      const provider = decodedToken.firebase?.sign_in_provider || 'unknown';
      logger.info(`Firebase auth with provider: ${provider}`);

      // Route to appropriate handler based on provider
      if (provider === 'phone') {
        return this.verifyFirebasePhoneToken(idToken, role);
      }

      // For email/password and social providers (Google, Apple, Facebook, etc.)
      // Use a unified approach
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { firebaseUid: uid },
            email ? { email } : undefined,
          ].filter(Boolean) as any,
        },
      });

      const userRole = role || UserRole.USER;

      if (!user) {
        // Create new user
        let authProvider: AuthProvider = AuthProvider.EMAIL;
        if (provider === 'google.com') authProvider = AuthProvider.GOOGLE;

        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email || undefined,
            phone: phone_number || undefined,
            name: name || email?.split('@')[0] || 'User',
            authProvider,
            emailVerified: !!email,
            phoneVerified: !!phone_number,
            profileImage: picture || undefined,
            role: userRole,
          },
        });
        logger.info(`New user created via Firebase (${provider}): ${user.id}`);
      } else {
        // Update existing user
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      // Set Firebase custom claims
      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Firebase token verification error:', error);
      throw new ApiError(401, 'Invalid Firebase token');
    }
  }

  /**
   * Google Sign-In
   */
  async googleSignIn(idToken: string): Promise<AuthResponse> {
    try {
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, email, name, picture } = decodedToken as any;

      let user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
      });

      if (!user && email) {
        user = await prisma.user.findUnique({
          where: { email },
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email || undefined,
            name: name || 'Google User',
            authProvider: AuthProvider.GOOGLE,
            emailVerified: true,
            profileImage: picture || undefined,
            role: UserRole.USER,
          },
        });
        logger.info(`New user created via Google: ${user.id}`);
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Google sign-in error:', error);
      throw new ApiError(401, 'Invalid Google token');
    }
  }

  /**
   * Apple Sign-In
   */
  async appleSignIn(idToken: string): Promise<AuthResponse> {
    try {
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, email, name } = decodedToken as any;

      let user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
      });

      if (!user && email) {
        user = await prisma.user.findUnique({
          where: { email },
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email || undefined,
            name: name || 'Apple User',
            authProvider: AuthProvider.EMAIL,
            emailVerified: true,
            role: UserRole.USER,
          },
        });
        logger.info(`New user created via Apple: ${user.id}`);
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Apple sign-in error:', error);
      throw new ApiError(401, 'Invalid Apple token');
    }
  }

  /**
   * Facebook Sign-In
   */
  async facebookSignIn(idToken: string): Promise<AuthResponse> {
    try {
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, email, name, picture } = decodedToken as any;

      let user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
      });

      if (!user && email) {
        user = await prisma.user.findUnique({
          where: { email },
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email || undefined,
            name: name || 'Facebook User',
            authProvider: AuthProvider.EMAIL,
            emailVerified: true,
            profileImage: picture || undefined,
            role: UserRole.USER,
          },
        });
        logger.info(`New user created via Facebook: ${user.id}`);
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Facebook sign-in error:', error);
      throw new ApiError(401, 'Invalid Facebook token');
    }
  }

  /**
   * Twitter Sign-In
   */
  async twitterSignIn(idToken: string): Promise<AuthResponse> {
    try {
      const decodedToken = await verifyIdTokenMultiProject(idToken);
      const { uid, email, name, picture } = decodedToken as any;

      let user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
      });

      if (!user && email) {
        user = await prisma.user.findUnique({
          where: { email },
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: uid,
            email: email || undefined,
            name: name || 'Twitter User',
            authProvider: AuthProvider.EMAIL,
            emailVerified: email ? true : false,
            profileImage: picture || undefined,
            role: UserRole.USER,
          },
        });
        logger.info(`New user created via Twitter: ${user.id}`);
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid: uid,
            lastLoginAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        throw new ApiError(403, 'Account is deactivated');
      }

      await setFirebaseCustomClaims(user.id, {
        role: user.role,
        userId: user.id,
      });

      const tokens = this.generateTokens(user.id, user.role);

      return {
        user: {
          id: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      logger.error('Twitter sign-in error:', error);
      throw new ApiError(401, 'Invalid Twitter token');
    }
  }

  /**
   * Link Firebase account with existing email/phone account
   */
  async linkFirebaseAccount(userId: string, firebaseIdToken: string): Promise<void> {
    try {
      const decodedToken = await verifyIdTokenMultiProject(firebaseIdToken);
      const { uid } = decodedToken;

      const existingUser = await prisma.user.findUnique({
        where: { firebaseUid: uid },
      });

      if (existingUser && existingUser.id !== userId) {
        throw new ApiError(409, 'Firebase account already linked to another user');
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          firebaseUid: uid,
        },
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user) {
        await setFirebaseCustomClaims(userId, {
          role: user.role,
          userId: userId,
        });
      }

      logger.info(`Firebase account linked to user ${userId}`);
    } catch (error) {
      logger.error(`Failed to link Firebase account for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Unlink Firebase account from user
   */
  async unlinkFirebaseAccount(userId: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          firebaseUid: null,
        },
      });

      logger.info(`Firebase account unlinked from user ${userId}`);
    } catch (error) {
      logger.error(`Failed to unlink Firebase account for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update user role and sync with Firebase custom claims
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { role: newRole },
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firebaseUid: true },
      });

      if (user?.firebaseUid) {
        await setFirebaseCustomClaims(userId, {
          role: newRole,
          userId: userId,
        });
      }

      logger.info(`User role updated to ${newRole} for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update role for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = jwt.verify(refreshToken, this.JWT_SECRET) as {
        userId: string;
        role: UserRole;
        type: string;
      };

      if (decoded.type !== 'refresh') {
        throw new ApiError(401, 'Invalid token type');
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        throw new ApiError(401, 'Invalid token');
      }

      const tokens = this.generateTokens(user.id, user.role);

      return tokens;
    } catch (error) {
      logger.error('Refresh token error:', error);
      throw new ApiError(401, 'Invalid refresh token');
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(email: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        logger.warn(`Password reset requested for non-existent email: ${email}`);
        return;
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          metadata: {
            ...(user.metadata as any),
            resetTokenHash,
            resetTokenExpiry: resetTokenExpiry.toISOString(),
          },
        },
      });

      await this.sendPasswordResetEmail(email, user.id, resetToken);

      logger.info(`Password reset email sent to ${email}`);
    } catch (error) {
      logger.error('Forgot password error:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await prisma.user.findFirst({
        where: {
          metadata: {
            path: ['resetTokenHash'],
            equals: tokenHash,
          },
        },
      });

      if (!user) {
        throw new ApiError(400, 'Invalid or expired reset token');
      }

      const metadata = user.metadata as any;
      const resetTokenExpiry = new Date(metadata.resetTokenExpiry);

      if (resetTokenExpiry < new Date()) {
        throw new ApiError(400, 'Reset token has expired');
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          metadata: {
            ...(user.metadata as any),
            resetTokenHash: null,
            resetTokenExpiry: null,
          },
        },
      });

      logger.info(`Password reset successful for user ${user.id}`);
    } catch (error) {
      logger.error('Reset password error:', error);
      throw error;
    }
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string): Promise<void> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await prisma.user.findFirst({
        where: {
          metadata: {
            path: ['emailVerificationToken'],
            equals: tokenHash,
          },
        },
      });

      if (!user) {
        throw new ApiError(400, 'Invalid verification token');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          metadata: {
            ...(user.metadata as any),
            emailVerificationToken: null,
          },
        },
      });

      logger.info(`Email verified for user ${user.id}`);
    } catch (error) {
      logger.error('Verify email error:', error);
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      if (user.emailVerified) {
        throw new ApiError(400, 'Email already verified');
      }

      await this.sendVerificationEmail(email, user.id);

      logger.info(`Verification email resent to ${email}`);
    } catch (error) {
      logger.error('Resend verification email error:', error);
      throw error;
    }
  }

  /**
   * Generate JWT tokens
   */
  private generateTokens(userId: string, role: UserRole): { accessToken: string; refreshToken: string } {
    const signOptions: SignOptions = { expiresIn: '1d' }

    const accessToken = jwt.sign(
      {
        userId,
        role,
        type: 'access',
      },
      this.JWT_SECRET,
      signOptions
    );

    const refreshToken = jwt.sign(
      {
        userId,
        role,
        type: 'refresh',
      },
      this.JWT_SECRET,
      { expiresIn: this.REFRESH_TOKEN_EXPIRES_IN } as SignOptions
    );

    return { accessToken, refreshToken };
  }

  /**
   * Send verification email
   */
  private async sendVerificationEmail(email: string, userId: string): Promise<void> {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: {
        metadata: {
          ...(existing?.metadata as any),
          emailVerificationToken: tokenHash,
        },
      },
    });

    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    await addNotificationJob(
      'auth-verification-email',
      userId,
      {
        email,
        token: verificationToken,
        verificationUrl,
      }
    );
  }

  /**
   * Send password reset email
   */
  private async sendPasswordResetEmail(email: string, userId: string, resetToken: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await addNotificationJob(
      'auth-password-reset-email',
      userId,
      {
        email,
        token: resetToken,
        resetUrl,
      }
    );
  }

  async checkPhone(phone: string, role: string) {
    console.log("Checking phone:", phone, "for role:", role);
    const user = await prisma.user.findUnique({
      where: { phone },
      include: {
        buddy: true,
      }
    });
    console.log("User found:", user);

    if (!user) {
      return { exists: false };
    }

    // If looking for a Buddy, check if they have a buddy profile
    if (role === 'BUDDY' && !user.buddy) {
      // User exists (maybe as a customer) but NOT as a Buddy
      return { exists: false, message: "User exists but not as a Buddy" };
    }

    return { exists: true };
  }
}
