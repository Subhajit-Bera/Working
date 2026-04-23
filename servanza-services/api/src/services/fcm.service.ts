import admin from 'firebase-admin';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { getFirebaseMessaging, getCustomerFirebaseMessaging } from '../config/firebase';

export interface FCMNotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  sound?: string;
  badge?: number;
  clickAction?: string;
}

export interface FCMBatchNotification {
  userIds: string[];
  notification: FCMNotificationPayload;
}

export class FCMService {
  /**
   * Register a new FCM device token for a user
   */
  async registerDeviceToken(userId: string, token: string): Promise<void> {
    try {
      // Validate token with Firebase
      const isValid = await this.validateToken(token);
      if (!isValid) {
        throw new Error('Invalid FCM token');
      }

      // Get current user tokens
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { deviceTokens: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Add token if not already present
      const tokens = user.deviceTokens || [];
      if (!tokens.includes(token)) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            deviceTokens: {
              push: token,
            },
          },
        });
        logger.info(`FCM token registered for user ${userId}`);
      }
    } catch (error) {
      logger.error(`Failed to register FCM token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a device token from a user
   */
  async removeDeviceToken(userId: string, token: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { deviceTokens: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const tokens = user.deviceTokens || [];
      const updatedTokens = tokens.filter((t) => t !== token);

      await prisma.user.update({
        where: { id: userId },
        data: {
          deviceTokens: {
            set: updatedTokens,
          },
        },
      });

      logger.info(`FCM token removed for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to remove FCM token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send a push notification to a single user
   */
  async sendToUser(userId: string, payload: FCMNotificationPayload): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { deviceTokens: true },
      });

      if (!user || !user.deviceTokens || user.deviceTokens.length === 0) {
        logger.warn(`No device tokens found for user ${userId}`);
        return;
      }

      await this.sendToTokens(user.deviceTokens, payload);
    } catch (error) {
      logger.error(`Failed to send notification to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send push notifications to multiple users (batch)
   */
  async sendBatchNotification(batch: FCMBatchNotification): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        where: {
          id: { in: batch.userIds },
        },
        select: { id: true, deviceTokens: true },
      });

      const allTokens: string[] = [];
      users.forEach((user) => {
        if (user.deviceTokens && user.deviceTokens.length > 0) {
          allTokens.push(...user.deviceTokens);
        }
      });

      if (allTokens.length === 0) {
        logger.warn('No device tokens found for batch notification');
        return;
      }

      await this.sendToTokens(allTokens, batch.notification);
      logger.info(`Batch notification sent to ${allTokens.length} devices`);
    } catch (error) {
      logger.error('Failed to send batch notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to specific tokens
   */
  async sendToTokens(tokens: string[], payload: FCMNotificationPayload): Promise<void> {
    try {
      const messaging = getFirebaseMessaging();

      // Prepare the message
      const message: admin.messaging.MulticastMessage = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: {
          ...(payload.data || {}),
          clickAction: payload.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
        },
        tokens,
        android: {
          priority: 'high',
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
        webpush: {
          notification: {
            icon: payload.imageUrl,
            badge: payload.imageUrl,
            image: payload.imageUrl,
          },
          fcmOptions: {
            link: payload.clickAction,
          },
        },
      };

      const response = await messaging.sendMulticast(message);

      logger.info(
        `Push notification sent: ${response.successCount} success, ${response.failureCount} failures`
      );

      // Handle failed tokens
      if (response.failureCount > 0) {
        await this.handleFailedTokens(tokens, response.responses);
      }
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      throw error;
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(tokens: string[], topic: string): Promise<void> {
    try {
      const messaging = getFirebaseMessaging();
      const response = await messaging.subscribeToTopic(tokens, topic);

      logger.info(
        `Subscribed to topic ${topic}: ${response.successCount} success, ${response.failureCount} failures`
      );

      if (response.failureCount > 0) {
        logger.warn(`Failed to subscribe ${response.failureCount} tokens to topic ${topic}`);
      }
    } catch (error) {
      logger.error(`Failed to subscribe to topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<void> {
    try {
      const messaging = getFirebaseMessaging();
      const response = await messaging.unsubscribeFromTopic(tokens, topic);

      logger.info(
        `Unsubscribed from topic ${topic}: ${response.successCount} success, ${response.failureCount} failures`
      );
    } catch (error) {
      logger.error(`Failed to unsubscribe from topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Send notification to a topic
   */
  async sendToTopic(topic: string, payload: FCMNotificationPayload): Promise<void> {
    try {
      const messaging = getFirebaseMessaging();

      const message: admin.messaging.Message = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: {
          ...(payload.data || {}),
          clickAction: payload.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
        },
        topic,
        android: {
          priority: 'high',
          notification: {
            sound: payload.sound || 'default',
            channelId: 'default',
            imageUrl: payload.imageUrl,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: payload.sound || 'default',
              badge: payload.badge || 1,
            },
          },
          fcmOptions: {
            imageUrl: payload.imageUrl,
          },
        },
      };

      await messaging.send(message);
      logger.info(`Notification sent to topic: ${topic}`);
    } catch (error) {
      logger.error(`Failed to send notification to topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Validate an FCM token - tries both primary and customer Firebase projects
   * Returns the messaging instance that works or false if neither works
   */
  async validateToken(token: string): Promise<boolean> {
    try {
      const messaging = getFirebaseMessaging();

      // Try to send a dry-run message to validate the token with primary project
      await messaging.send(
        {
          token,
          data: { test: 'validation' },
        },
        true // dry run
      );

      return true;
    } catch (error: any) {
      // Token might belong to a different Firebase project (e.g., customer app)
      if (
        error.code === 'messaging/mismatched-credential' ||
        error.message?.includes('SenderId mismatch')
      ) {
        logger.info('Token validation failed with primary project, trying customer project...');

        // Try customer Firebase project
        const customerMessaging = getCustomerFirebaseMessaging();
        if (customerMessaging) {
          try {
            await customerMessaging.send(
              {
                token,
                data: { test: 'validation' },
              },
              true // dry run
            );
            return true;
          } catch (customerError: any) {
            if (
              customerError.code === 'messaging/invalid-registration-token' ||
              customerError.code === 'messaging/registration-token-not-registered'
            ) {
              return false;
            }
            logger.error('Error validating FCM token with customer project:', customerError);
            return false;
          }
        }
      }

      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        return false;
      }
      logger.error('Error validating FCM token:', error);
      return false;
    }
  }

  /**
   * Clean up invalid tokens for a user
   */
  async cleanupInvalidTokens(userId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { deviceTokens: true },
      });

      if (!user || !user.deviceTokens || user.deviceTokens.length === 0) {
        return;
      }

      const validTokens: string[] = [];

      for (const token of user.deviceTokens) {
        const isValid = await this.validateToken(token);
        if (isValid) {
          validTokens.push(token);
        }
      }

      if (validTokens.length !== user.deviceTokens.length) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            deviceTokens: {
              set: validTokens,
            },
          },
        });

        logger.info(
          `Cleaned up ${user.deviceTokens.length - validTokens.length} invalid tokens for user ${userId}`
        );
      }
    } catch (error) {
      logger.error(`Failed to cleanup tokens for user ${userId}:`, error);
    }
  }

  /**
   * Handle failed tokens from a multicast response
   */
  private async handleFailedTokens(
    tokens: string[],
    responses: admin.messaging.SendResponse[]
  ): Promise<void> {
    const failedTokens: string[] = [];

    responses.forEach((response, index) => {
      if (!response.success) {
        const error = response.error;
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
}