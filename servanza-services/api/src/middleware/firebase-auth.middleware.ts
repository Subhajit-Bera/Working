import { Request, Response, NextFunction } from 'express';
import { getFirebaseAuth } from '../config/firebase';
import { prisma } from '../config/database';
import { UserRole } from '@prisma/client';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Middleware to authenticate requests using Firebase ID tokens
 * This can be used as an alternative to JWT authentication
 */
export const authenticateFirebase = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No token provided');
    }

    const idToken = authHeader.substring(7);

    // Verify Firebase ID token
    const firebaseAuth = getFirebaseAuth();
    const decodedToken = await firebaseAuth.verifyIdToken(idToken);

    const { uid, email } = decodedToken;

    // Find user by Firebase UID
    let user = await prisma.user.findUnique({
      where: { firebaseUid: uid },
      select: {
        id: true,
        role: true,
        email: true,
        isActive: true,
      },
    });

    // If user not found by UID, try to find by email
    if (!user && email) {
      user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
          email: true,
          isActive: true,
        },
      });

      // Link Firebase UID to existing user
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { firebaseUid: uid },
        });
        logger.info(`Linked Firebase UID ${uid} to user ${user.id}`);
      }
    }

    if (!user || !user.isActive) {
      throw new AuthenticationError('User not found or deactivated');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      role: user.role,
      email: user.email || undefined,
    };

    next();
  } catch (error: any) {
    if (error.code === 'auth/id-token-expired') {
      next(new AuthenticationError('Token expired'));
    } else if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-id-token') {
      next(new AuthenticationError('Invalid token'));
    } else {
      next(error);
    }
  }
};

/**
 * Middleware to accept both JWT and Firebase tokens
 * Tries JWT first, then Firebase if JWT fails
 */
export const authenticateFlexible = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AuthenticationError('No token provided'));
  }

  const token = authHeader.substring(7);

  // Try JWT authentication first
  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string;
      role: UserRole;
      type: string;
    };

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        role: true,
        email: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new Error('User not found or deactivated');
    }

    req.user = {
      id: user.id,
      role: user.role,
      email: user.email || undefined,
    };

    return next();
  } catch (jwtError) {
    // JWT failed, try Firebase authentication
    try {
      const firebaseAuth = getFirebaseAuth();
      const decodedToken = await firebaseAuth.verifyIdToken(token);

      const { uid, email } = decodedToken;

      let user = await prisma.user.findUnique({
        where: { firebaseUid: uid },
        select: {
          id: true,
          role: true,
          email: true,
          isActive: true,
        },
      });

      if (!user && email) {
        user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            role: true,
            email: true,
            isActive: true,
          },
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { firebaseUid: uid },
          });
        }
      }

      if (!user || !user.isActive) {
        throw new Error('User not found or deactivated');
      }

      req.user = {
        id: user.id,
        role: user.role,
        email: user.email || undefined,
      };

      return next();
    } catch (firebaseError) {
      return next(new AuthenticationError('Invalid token'));
    }
  }
};

/**
 * Set custom claims for a user in Firebase
 * Tries both primary and customer Firebase apps since user may exist in either
 */
export async function setFirebaseCustomClaims(
  userId: string,
  claims: Record<string, any>
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firebaseUid: true },
    });

    if (!user || !user.firebaseUid) {
      // User doesn't have Firebase UID - this is OK for some auth methods
      logger.info(`User ${userId} does not have a Firebase UID, skipping custom claims`);
      return;
    }

    const firebaseAuth = getFirebaseAuth();
    let claimsSet = false;

    // Try primary Firebase app first
    try {
      await firebaseAuth.setCustomUserClaims(user.firebaseUid, claims);
      logger.info(`Custom claims set for user ${userId} (primary project)`);
      claimsSet = true;
    } catch (primaryError: any) {
      // If user not found in primary, try customer Firebase
      if (primaryError.code === 'auth/user-not-found') {
        logger.info(`User ${userId} not found in primary Firebase, trying customer project`);

        // Import customer Firebase app
        const { getCustomerFirebaseApp } = await import('../config/firebase');
        const customerApp = getCustomerFirebaseApp();

        if (customerApp) {
          try {
            const admin = await import('firebase-admin');
            await admin.auth(customerApp).setCustomUserClaims(user.firebaseUid, claims);
            logger.info(`Custom claims set for user ${userId} (customer project)`);
            claimsSet = true;
          } catch (customerError: any) {
            if (customerError.code === 'auth/user-not-found') {
              // User not found in either project - log and continue
              logger.warn(`User ${userId} (Firebase UID: ${user.firebaseUid}) not found in any Firebase project, skipping custom claims`);
              return; // Don't throw, just skip
            }
            throw customerError;
          }
        } else {
          // Customer Firebase not configured, log and continue
          logger.warn(`Customer Firebase not configured, cannot set claims for user ${userId}`);
          return; // Don't throw, just skip
        }
      } else {
        throw primaryError;
      }
    }

    if (!claimsSet) {
      logger.warn(`Could not set custom claims for user ${userId}`);
    }
  } catch (error) {
    logger.error(`Failed to set custom claims for user ${userId}:`, error);
    // Don't throw - setting custom claims shouldn't break authentication
    // throw error;
  }
}

/**
 * Revoke all refresh tokens for a Firebase user
 */
export async function revokeFirebaseTokens(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firebaseUid: true },
    });

    if (!user || !user.firebaseUid) {
      throw new Error('User does not have a Firebase UID');
    }

    const firebaseAuth = getFirebaseAuth();
    await firebaseAuth.revokeRefreshTokens(user.firebaseUid);

    logger.info(`Revoked all refresh tokens for user ${userId}`);
  } catch (error) {
    logger.error(`Failed to revoke tokens for user ${userId}:`, error);
    throw error;
  }
}