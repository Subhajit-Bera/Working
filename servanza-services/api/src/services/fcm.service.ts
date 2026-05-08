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
  async registerDeviceToken(userId: string, token: string, appSource?: string, role?: string): Promise<void> {
    try {
      // Validate token with Firebase
      const isValid = await this.validateToken(token, appSource, role);
      if (!isValid) {
        throw new Error('Invalid FCM token');
      }

      let targetColumn = 'customerDeviceTokens';
      if (appSource) {
        targetColumn = appSource === 'BUDDY_APP' ? 'buddyDeviceTokens' : 'customerDeviceTokens';
      } else {
        logger.warn(`Legacy token registration used for user ${userId}. Missing appSource.`);
        targetColumn = role === 'BUDDY' ? 'buddyDeviceTokens' : 'customerDeviceTokens';
      }

      // Get current user tokens
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { [targetColumn]: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Add token if not already present
      const tokens = (user as any)[targetColumn] || [];
      if (!tokens.includes(token)) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            [targetColumn]: {
              push: token,
            },
          },
        });
        logger.info(`FCM token registered for user ${userId} in ${targetColumn}`);
      }
    } catch (error) {
      logger.error(`Failed to register FCM token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a device token from a user
   */
  async removeDeviceToken(userId: string, token: string, appSource?: string, role?: string): Promise<void> {
    try {
      let targetColumn = 'customerDeviceTokens';
      if (appSource) {
        targetColumn = appSource === 'BUDDY_APP' ? 'buddyDeviceTokens' : 'customerDeviceTokens';
      } else {
        logger.warn(`Legacy token removal used for user ${userId}. Missing appSource.`);
        targetColumn = role === 'BUDDY' ? 'buddyDeviceTokens' : 'customerDeviceTokens';
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { [targetColumn]: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const tokens = (user as any)[targetColumn] || [];
      const updatedTokens = tokens.filter((t: string) => t !== token);

      await prisma.user.update({
        where: { id: userId },
        data: {
          [targetColumn]: {
            set: updatedTokens,
          },
        },
      });

      logger.info(`FCM token removed for user ${userId} from ${targetColumn}`);
    } catch (error) {
      logger.error(`Failed to remove FCM token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send a push notification to a single user
   */
  async sendToUser(userId: string, payload: FCMNotificationPayload, targetApp?: 'CUSTOMER_APP' | 'BUDDY_APP'): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { customerDeviceTokens: true, buddyDeviceTokens: true },
      });

      let tokens: string[] = [];
      if (targetApp === 'BUDDY_APP') {
        tokens = user?.buddyDeviceTokens || [];
      } else {
        tokens = user?.customerDeviceTokens || [];
      }

      if (tokens.length === 0) {
        logger.warn(`No device tokens found for user ${userId} in ${targetApp || 'CUSTOMER_APP'}`);
        return;
      }

      await this.sendToTokens(tokens, payload, targetApp);
    } catch (error) {
      logger.error(`Failed to send notification to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send push notifications to multiple users (batch)
   */
  async sendBatchNotification(batch: FCMBatchNotification, targetApp?: 'CUSTOMER_APP' | 'BUDDY_APP'): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        where: {
          id: { in: batch.userIds },
        },
        select: { id: true, customerDeviceTokens: true, buddyDeviceTokens: true },
      });

      const allTokens: string[] = [];
      users.forEach((user) => {
        const tokens = targetApp === 'BUDDY_APP' ? user.buddyDeviceTokens : user.customerDeviceTokens;
        if (tokens && tokens.length > 0) {
          allTokens.push(...tokens);
        }
      });

      if (allTokens.length === 0) {
        logger.warn('No device tokens found for batch notification');
        return;
      }

      await this.sendToTokens(allTokens, batch.notification, targetApp);
      logger.info(`Batch notification sent to ${allTokens.length} devices via ${targetApp || 'CUSTOMER_APP'}`);
    } catch (error) {
      logger.error('Failed to send batch notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to specific tokens
   */
  async sendToTokens(tokens: string[], payload: FCMNotificationPayload, targetApp?: 'CUSTOMER_APP' | 'BUDDY_APP'): Promise<void> {
    try {
      const isCustomer = targetApp === 'CUSTOMER_APP' || !targetApp;
      const messaging = isCustomer ? (getCustomerFirebaseMessaging() || getFirebaseMessaging()) : getFirebaseMessaging();

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

      const response = await messaging.sendEachForMulticast(message);

      logger.info(
        `Push notification sent: ${response.successCount} success, ${response.failureCount} failures`
      );

      // Handle failed tokens
      if (response.failureCount > 0) {
        await this.handleFailedTokens(tokens, response.responses, targetApp);
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
   * Validate an FCM token - strictly uses the correct Firebase project
   */
  async validateToken(token: string, appSource?: string, role?: string): Promise<boolean> {
    try {
      let isCustomer = true;
      if (appSource) {
        isCustomer = appSource === 'CUSTOMER_APP';
      } else {
        isCustomer = role !== 'BUDDY';
      }

      const messaging = isCustomer ? (getCustomerFirebaseMessaging() || getFirebaseMessaging()) : getFirebaseMessaging();

      // Try to send a dry-run message to validate the token
      await messaging.send(
        {
          token,
          data: { test: 'validation' },
        },
        true // dry run
      );

      return true;
    } catch (error: any) {
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/mismatched-credential' ||
        error.message?.includes('SenderId mismatch')
      ) {
        return false;
      }

      logger.error('Error validating FCM token:', error);
      // Return true for other errors to prevent blocking token registration due to temporary network issues
      return true;
    }
  }

  /**
   * Periodically clean up invalid tokens for a user
   */
  async cleanupTokens(userId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { customerDeviceTokens: true, buddyDeviceTokens: true },
      });

      if (!user) return;

      const checkAndClean = async (tokens: string[] | undefined, targetColumn: string, appSource: string) => {
        if (!tokens || tokens.length === 0) return;
        
        const validTokens: string[] = [];
        for (const token of tokens) {
          const isValid = await this.validateToken(token, appSource);
          if (isValid) {
            validTokens.push(token);
          }
        }

        if (validTokens.length !== tokens.length) {
          await prisma.user.update({
            where: { id: userId },
            data: { [targetColumn]: { set: validTokens } },
          });
          logger.info(`Cleaned up ${tokens.length - validTokens.length} invalid tokens for user ${userId} in ${targetColumn}`);
        }
      };

      await checkAndClean(user.customerDeviceTokens, 'customerDeviceTokens', 'CUSTOMER_APP');
      await checkAndClean(user.buddyDeviceTokens, 'buddyDeviceTokens', 'BUDDY_APP');

    } catch (error) {
      logger.error(`Failed to cleanup tokens for user ${userId}:`, error);
    }
  }

  /**
   * Handle failed tokens from a multicast response
   */
  private async handleFailedTokens(
    tokens: string[],
    responses: admin.messaging.SendResponse[],
    targetApp?: 'CUSTOMER_APP' | 'BUDDY_APP'
  ): Promise<void> {
    const failedTokens: string[] = [];

    responses.forEach((response, index) => {
      if (!response.success) {
        const error = response.error;
        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered' ||
          error?.code === 'messaging/mismatched-credential'
        ) {
          failedTokens.push(tokens[index]);
        }
      }
    });

    if (failedTokens.length > 0) {
      let targetColumn = 'customerDeviceTokens';
      if (targetApp) {
        targetColumn = targetApp === 'BUDDY_APP' ? 'buddyDeviceTokens' : 'customerDeviceTokens';
      }

      // Remove failed tokens from all users
      const users = await prisma.user.findMany({
        where: {
          [targetColumn]: {
            hasSome: failedTokens,
          },
        },
        select: { id: true, customerDeviceTokens: true, buddyDeviceTokens: true },
      });

      for (const user of users) {
        if (targetColumn === 'buddyDeviceTokens') {
          const validTokens = (user.buddyDeviceTokens || []).filter((token: string) => !failedTokens.includes(token));
          await prisma.user.update({
            where: { id: user.id },
            data: { buddyDeviceTokens: validTokens },
          });
        } else {
          const validTokens = (user.customerDeviceTokens || []).filter((token: string) => !failedTokens.includes(token));
          await prisma.user.update({
            where: { id: user.id },
            data: { customerDeviceTokens: validTokens },
          });
        }
      }

      logger.info(`Removed ${failedTokens.length} invalid tokens from database column ${targetColumn}`);
    }
  }
}