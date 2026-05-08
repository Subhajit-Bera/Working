import admin from 'firebase-admin';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export interface FCMNotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  sound?: string;
  badge?: number;
  clickAction?: string;
}

/**
 * Send push notification to specific tokens
 */
export async function sendPushNotification(
  tokens: string[],
  payload: FCMNotificationPayload,
  targetApp: 'CUSTOMER_APP' | 'BUDDY_APP' = 'BUDDY_APP'
): Promise<void> {
  try {
    if (!tokens || tokens.length === 0) {
      logger.warn('No tokens provided for push notification');
      return;
    }

    // Prepare message payload
    // IMPORTANT: FCM data payload requires ALL values to be strings
    const stringifiedData: Record<string, string> = {
      clickAction: payload.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
    };

    // Convert all payload data values to strings
    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        stringifiedData[key] = String(value);
      }
    }

    const baseMessage = {
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: stringifiedData,
      android: {
        priority: 'high' as const,
        notification: {
          sound: payload.sound || 'default',
          channelId: 'default',
          clickAction: payload.clickAction,
          imageUrl: payload.imageUrl,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: payload.sound || 'default',
            badge: payload.badge || 1,
            contentAvailable: true,
          },
        },
        fcmOptions: {
          imageUrl: payload.imageUrl,
        },
      },
    };

    // Use sendEachForMulticast instead of sendMulticast to avoid /batch 404 errors
    const message: admin.messaging.MulticastMessage = {
      ...baseMessage,
      tokens: tokens,
    };

    // Resolve target messaging instance
    let messaging = admin.messaging();

    if (targetApp === 'CUSTOMER_APP') {
      const customerApp = admin.apps.find(app => app?.name === 'customer');
      if (customerApp) {
        messaging = admin.messaging(customerApp);
      } else {
        logger.warn('Customer Firebase App not found, falling back to primary messaging');
      }
    }

    const response = await messaging.sendEachForMulticast(message);

    logger.info(
      `Push notification sent to ${targetApp}: ${response.successCount} success, ${response.failureCount} failures`
    );

    // Handle failed tokens
    if (response.failureCount > 0) {
      await handleFailedTokens(tokens, response.responses, targetApp);
    }
  } catch (error) {
    logger.error('Failed to send push notification:', error);
    throw error;
  }
}

/**
 * Handle failed tokens from a multicast response
 */
async function handleFailedTokens(
  tokens: string[],
  responses: admin.messaging.SendResponse[],
  targetApp: 'CUSTOMER_APP' | 'BUDDY_APP'
): Promise<void> {
  const failedTokens: string[] = [];

  responses.forEach((response, index) => {
    if (!response.success) {
      const error = response.error;
      // Log the actual error for debugging
      logger.error(`FCM Error for token ${tokens[index]?.substring(0, 20)}...: ${error?.code} - ${error?.message}`);

      if (
        error?.code === 'messaging/invalid-registration-token' ||
        error?.code === 'messaging/registration-token-not-registered'
      ) {
        failedTokens.push(tokens[index]);
      }
    }
  });

  if (failedTokens.length > 0) {
    const targetColumn = targetApp === 'CUSTOMER_APP' ? 'customerDeviceTokens' : 'buddyDeviceTokens';

    // Remove failed tokens from all users (in the specific column)
    const users = await prisma.user.findMany({
      where: {
        [targetColumn]: {
          hasSome: failedTokens,
        },
      },
      select: { id: true, customerDeviceTokens: true, buddyDeviceTokens: true },
    });

    for (const user of users) {
      const currentTokens = targetApp === 'CUSTOMER_APP' ? user.customerDeviceTokens : user.buddyDeviceTokens;
      const validTokens = currentTokens.filter((token) => !failedTokens.includes(token));

      await prisma.user.update({
        where: { id: user.id },
        data: {
          [targetColumn]: {
            set: validTokens,
          },
        },
      });
    }

    logger.info(`Removed ${failedTokens.length} invalid tokens from ${targetColumn}`);
  }
}