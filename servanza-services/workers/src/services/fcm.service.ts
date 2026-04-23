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
  payload: FCMNotificationPayload
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

    const response = await admin.messaging().sendEachForMulticast(message);

    logger.info(
      `Push notification sent: ${response.successCount} success, ${response.failureCount} failures`
    );

    // Handle failed tokens
    if (response.failureCount > 0) {
      await handleFailedTokens(tokens, response.responses);
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
  responses: admin.messaging.SendResponse[]
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
    // Remove failed tokens from all users
    const users = await prisma.user.findMany({
      where: {
        deviceTokens: {
          hasSome: failedTokens,
        },
      },
      select: { id: true, deviceTokens: true },
    });

    for (const user of users) {
      const validTokens = user.deviceTokens.filter((token) => !failedTokens.includes(token));

      await prisma.user.update({
        where: { id: user.id },
        data: {
          deviceTokens: {
            set: validTokens,
          },
        },
      });
    }

    logger.info(`Removed ${failedTokens.length} invalid tokens from database`);
  }
}