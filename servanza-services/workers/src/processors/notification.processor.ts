import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import admin from 'firebase-admin';
import { NotificationType } from '@prisma/client';
import { EmailService } from '../services/email.service';
// import { SMSService } from '../services/sms.service'; // Removed Twilio
import { sendPushNotification, FCMNotificationPayload } from '../services/fcm.service';

// Initialize Firebase Admin
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
  if (!admin.apps.length) { // Prevent re-initialization error
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
}

const emailService = new EmailService();

interface NotificationJobData {
  userId: string;
  data: any;
}

export const notificationProcessor = async (job: Job<NotificationJobData>) => {
  const { userId, data } = job.data;
  const notificationType = job.name;

  // ===== POISON PILL DETECTION =====
  // Validate payload to prevent crash loops from malformed jobs
  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    logger.error(`[Notification] POISON PILL detected - invalid userId: ${JSON.stringify(job.data)}`);
    return { success: false, poisonPill: true, reason: 'Invalid job payload - missing or malformed userId' };
  }
  if (!data || typeof data !== 'object') {
    logger.error(`[Notification] POISON PILL detected - invalid data: ${JSON.stringify(job.data)}`);
    return { success: false, poisonPill: true, reason: 'Invalid job payload - missing or malformed data' };
  }

  logger.info(`Processing notification: ${notificationType} for user ${userId}`);

  try {
    let title = '';
    let body = '';
    let notifType: NotificationType = NotificationType.GENERAL;
    let imageUrl: string | undefined;
    let sound: string | undefined;

    switch (notificationType) {
      // Buddy Notifications
      case 'buddy-assignment':
        title = 'New Job Available';
        body = `New job: ${data.serviceTitle} at ${data.address}`;
        notifType = NotificationType.BOOKING_ASSIGNED;
        sound = 'job_alert';
        break;
      case 'review-received':
        title = 'New Review';
        body = `You received a ${data.rating}-star review!`;
        notifType = NotificationType.RATING_RECEIVED;
        sound = 'review_received';
        break;

      // User Notifications
      case 'user-assignment':
        title = 'Buddy Assigned';
        body = `${data.buddyName} has been assigned to your booking`;
        notifType = NotificationType.BOOKING_ASSIGNED;
        break;
      case 'booking-accepted':
        title = 'Booking Accepted';
        body = 'Your booking has been accepted by the buddy';
        notifType = NotificationType.BOOKING_ACCEPTED;
        break;
      case 'booking-started':
        title = 'Service Started';
        body = 'The buddy has started working on your booking';
        notifType = NotificationType.BOOKING_STARTED;
        break;
      case 'booking-completed':
        title = 'Service Completed';
        body = 'Your booking has been completed. Please rate your experience!';
        notifType = NotificationType.BOOKING_COMPLETED;
        sound = 'completion';
        break;
      case 'booking-cancelled':
        title = 'Booking Cancelled';
        body = 'Your booking has been cancelled';
        notifType = NotificationType.BOOKING_CANCELLED;
        break;
      case 'payment-received':
        title = 'Payment Received';
        body = 'Your payment has been processed successfully';
        notifType = NotificationType.PAYMENT_RECEIVED;
        break;

      // Auth Notifications
      case 'auth-verification-email':
        title = 'Verify your email';
        body = 'Please verify your email address to complete signup.';
        notifType = NotificationType.AUTH_VERIFICATION;
        break;
      case 'auth-password-reset-email':
        title = 'Password Reset Request';
        body = 'You requested a password reset. Check your email.';
        notifType = NotificationType.AUTH_PASSWORD_RESET;
        break;

      // Admin Notifications
      case 'admin-no-buddies':
        title = 'Alert: No Buddies Available';
        body = `No buddies found for booking ${data.bookingId} (${data.serviceTitle})`;
        notifType = NotificationType.GENERAL;
        break;

      default:
        title = 'Notification';
        body = data.message || 'You have a new notification';
    }

    // Create notification in database
    await prisma.notification.create({
      data: {
        userId,
        type: notifType,
        title,
        body,
        data: data,
        bookingId: data.bookingId,
      },
    });

    // Send push notification using FCM service
    // FCM data payload requires ALL values to be strings
    const stringifiedData: Record<string, string> = {
      type: notificationType,
      bookingId: data.bookingId || '',
    };

    // Convert all data values to strings
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value);
    }

    await sendPushNotificationToUser(userId, {
      title,
      body,
      imageUrl,
      sound,
      data: stringifiedData,
    });

    // Send email notification (optional)
    if (shouldSendEmail(notificationType)) {
      await sendEmailNotification(userId, title, body, data, notificationType);
    }

    // SMS Removed

    logger.info(`Notification sent successfully: ${notificationType} to user ${userId}`);

    return { success: true, userId, type: notificationType };
  } catch (error) {
    logger.error(`Notification failed for user ${userId}:`, error);
    throw error;
  }
};

// Send push notification via FCM with circuit breaker protection
async function sendPushNotificationToUser(
  userId: string,
  payload: FCMNotificationPayload
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deviceTokens: true },
    });

    if (!user || !user.deviceTokens || user.deviceTokens.length === 0) {
      logger.warn(`No device tokens found for user ${userId}`);
      return;
    }

    // Use circuit breaker to protect FCM service
    const { fcmCircuitBreaker } = await import('../utils/circuit-breaker');

    try {
      await fcmCircuitBreaker.execute(async () => {
        await sendPushNotification(user.deviceTokens, payload);
      });
    } catch (circuitError: any) {
      if (circuitError.circuitBreakerOpen) {
        // Circuit breaker is open - FCM is down
        // Store notification in database for later delivery via API polling
        logger.warn(`FCM circuit breaker OPEN, notification stored in DB for user ${userId}`);
        await prisma.offlineMessage.create({
          data: {
            userId,
            event: 'push-notification',
            data: JSON.parse(JSON.stringify(payload)), // Convert to plain JSON object
            isRead: false,
          },
        });
      } else {
        throw circuitError;
      }
    }
  } catch (error) {
    logger.error(`Failed to send push notification to user ${userId}:`, error);
  }
}


// Send email notification
async function sendEmailNotification(
  userId: string,
  title: string,
  body: string,
  data: any,
  notificationType: string
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user || !user.email) {
      logger.warn(`No email for user ${userId}, skipping email.`);
      return;
    }

    switch (notificationType) {
      case 'auth-verification-email':
        await emailService.sendVerificationEmail(user.email, data.token);
        break;
      case 'auth-password-reset-email':
        await emailService.sendPasswordReset(user.email, data.token);
        break;
      case 'booking-completed':
        await emailService.sendBookingCompletion(user.email, {
          userName: user.name,
          bookingId: data.bookingId,
          serviceName: data.serviceTitle || "your service",
          ratingUrl: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/booking/${data.bookingId}/review`
        });
        break;
      case 'booking-created':
        // TODO: Need more booking data to make this useful
        // await emailService.sendBookingConfirmation(user.email, data);
        break;
      default:
        // Send generic email
        await emailService.sendEmail({
          to: user.email,
          subject: title,
          text: body,
          html: `<p>${body}</p>`
        });
    }
  } catch (error) {
    logger.error(`Failed to send email to user ${userId}:`, error);
  }
}

// Determine if email should be sent for notification type
function shouldSendEmail(notificationType: string): boolean {
  const emailTypes = [
    'booking-completed',
    'payment-received',
    'booking-cancelled',
    'auth-verification-email',
    'auth-password-reset-email',
  ];
  return emailTypes.includes(notificationType);
}
