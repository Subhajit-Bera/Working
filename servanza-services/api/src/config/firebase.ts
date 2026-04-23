import admin from 'firebase-admin';
import { logger } from '../utils/logger';

// Primary Firebase app (for buddy app - servanza-app-test)
let primaryFirebaseApp: admin.app.App | null = null;

// Secondary Firebase app (for customer app - servanza-customer)
let customerFirebaseApp: admin.app.App | null = null;

export function initializeFirebase(): admin.app.App | null {
  try {
    if (primaryFirebaseApp) {
      return primaryFirebaseApp;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      logger.warn('Primary Firebase credentials not configured. Firebase features will be disabled.');
      return null;
    }

    primaryFirebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    }, 'primary');

    logger.info(`Primary Firebase initialized successfully (project: ${projectId})`);

    // Initialize secondary Firebase app for customer if configured
    initializeCustomerFirebase();

    return primaryFirebaseApp;
  } catch (error) {
    logger.error('Failed to initialize Firebase:', error);
    return null;
  }
}

/**
 * Initialize secondary Firebase app for customer
 */
function initializeCustomerFirebase(): admin.app.App | null {
  try {
    if (customerFirebaseApp) {
      return customerFirebaseApp;
    }

    const projectId = process.env.FIREBASE_CUSTOMER_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CUSTOMER_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_CUSTOMER_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      logger.warn('Customer Firebase credentials not configured. Customer app auth will use primary project.');
      return null;
    }

    customerFirebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    }, 'customer');

    logger.info(`Customer Firebase initialized successfully (project: ${projectId})`);
    return customerFirebaseApp;
  } catch (error) {
    logger.error('Failed to initialize Customer Firebase:', error);
    return null;
  }
}

export function getFirebaseApp(): admin.app.App | null {
  if (!primaryFirebaseApp) {
    return initializeFirebase();
  }
  return primaryFirebaseApp;
}

export function getCustomerFirebaseApp(): admin.app.App | null {
  return customerFirebaseApp;
}

export function getFirebaseAuth(): admin.auth.Auth {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase not initialized');
  }
  return admin.auth(app);
}

/**
 * Verify Firebase ID token - tries both primary and customer Firebase projects
 * This allows the backend to accept tokens from both buddy and customer apps
 */
export async function verifyIdTokenMultiProject(idToken: string): Promise<admin.auth.DecodedIdToken> {
  // Try primary Firebase first
  const primaryApp = getFirebaseApp();
  if (primaryApp) {
    try {
      const decodedToken = await admin.auth(primaryApp).verifyIdToken(idToken);
      return decodedToken;
    } catch (primaryError: any) {
      // If primary fails due to audience mismatch, try customer app
      if (primaryError.code === 'auth/argument-error' &&
        primaryError.message?.includes('audience')) {
        logger.info('Token not from primary project, trying customer project...');

        // Try customer Firebase
        if (customerFirebaseApp) {
          try {
            const decodedToken = await admin.auth(customerFirebaseApp).verifyIdToken(idToken);
            return decodedToken;
          } catch (customerError) {
            logger.error('Both Firebase projects failed to verify token');
            throw customerError;
          }
        }
      }
      throw primaryError;
    }
  }
  throw new Error('Firebase not initialized');
}

export function getFirebaseMessaging(): admin.messaging.Messaging {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase not initialized');
  }
  return admin.messaging(app);
}

/**
 * Get messaging for customer app (if needed for customer-specific notifications)
 */
export function getCustomerFirebaseMessaging(): admin.messaging.Messaging | null {
  if (!customerFirebaseApp) {
    return null;
  }
  return admin.messaging(customerFirebaseApp);
}
