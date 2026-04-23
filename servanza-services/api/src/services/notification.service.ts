import { prisma } from '../config/database';
import { NotificationType } from '@prisma/client';
import { logger } from '../utils/logger';
import { emitToUser, emitToBuddy, emitToAdmins } from '../utils/realtime';
import { addNotificationJob } from '../queues/notification.queue';
import eventBus from '../utils/event-bus';
import { FCMService, FCMNotificationPayload } from './fcm.service';

const fcmService = new FCMService();

export class NotificationService {
  /**
   * Create notification in database and queue push/email/sms
   */
  private async createAndQueueNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: any,
    bookingId?: string,
    imageUrl?: string
  ): Promise<void> {
    try {
      // Create in DB
      await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          body,
          data,
          bookingId,
        },
      });

      // Queue the job for the worker
      await addNotificationJob(
        type, // Job name
        userId,
        { ...data, title, body, bookingId, imageUrl } // Pass all data to worker
      );
    } catch (error) {
      logger.error(`Failed to create/queue notification ${type} for user ${userId}:`, error);
    }
  }

  /**
   * Send rich push notification directly via FCM
   */
  private async sendRichPushNotification(
    userId: string,
    payload: FCMNotificationPayload
  ): Promise<void> {
    try {
      await fcmService.sendToUser(userId, payload);
    } catch (error) {
      logger.error(`Failed to send rich push notification to user ${userId}:`, error);
    }
  }

  /**
   * Send batch notifications to multiple users
   */
  async sendBatchNotification(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data?: any,
    imageUrl?: string
  ): Promise<void> {
    try {
      // Create notifications in database for all users
      const notifications = userIds.map((userId) => ({
        userId,
        type,
        title,
        body,
        data,
      }));

      await prisma.notification.createMany({
        data: notifications,
      });

      // Send batch push notification via FCM
      await fcmService.sendBatchNotification({
        userIds,
        notification: {
          title,
          body,
          imageUrl,
          data: data ? Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, String(value)])
          ) : undefined,
        },
      });

      logger.info(`Batch notification sent to ${userIds.length} users`);
    } catch (error) {
      logger.error('Failed to send batch notification:', error);
    }
  }

  /**
   * Notify user - booking created
   */
  async notifyUserBookingCreated(userId: string, booking: any): Promise<void> {
    const title = 'Booking Confirmed';
    const body = `Your booking for ${booking.service.title} has been created.`;

    await this.createAndQueueNotification(
      userId,
      NotificationType.BOOKING_CREATED,
      title,
      body,
      { bookingId: booking.id, serviceTitle: booking.service.title },
      booking.id
    );

    // Send rich push notification with image
    await this.sendRichPushNotification(userId, {
      title,
      body,
      imageUrl: booking.service.imageUrl,
      data: {
        type: 'booking_created',
        bookingId: booking.id,
        serviceTitle: booking.service.title,
      },
      clickAction: `/bookings/${booking.id}`,
      sound: 'default',
    });

    emitToUser(userId, 'notification', { type: 'booking_created', booking });
    emitToAdmins('admin:feed', {
      type: 'BOOKING_CREATED',
      title: 'New Booking',
      message: `New booking for ${booking.service.title}`,
      timestamp: new Date(),
      data: { bookingId: booking.id }
    });
  }

  /**
   * Notify buddy - new assignment
   */
  async notifyBuddyAssignment(buddyId: string, booking: any, assignmentDetails?: { assignmentId: string; distance: number; price?: number }): Promise<void> {
    const title = 'New Job Available';
    const body = `New job: ${booking.service.title} at ${booking.address.formattedAddress}`;

    await this.createAndQueueNotification(
      buddyId,
      NotificationType.BOOKING_ASSIGNED,
      title,
      body,
      {
        bookingId: booking.id,
        serviceTitle: booking.service.title,
        address: booking.address.formattedAddress,
        assignmentId: assignmentDetails?.assignmentId,
        distance: assignmentDetails?.distance,
        price: booking.totalAmount,
      },
      booking.id,
      booking.service.imageUrl
    );

    // Send rich push notification with custom sound
    await this.sendRichPushNotification(buddyId, {
      title,
      body,
      imageUrl: booking.service.imageUrl,
      data: {
        type: 'job_assigned',
        bookingId: booking.id,
        assignmentId: assignmentDetails?.assignmentId || booking.id,
        serviceTitle: booking.service.title,
        address: booking.address.formattedAddress,
        distance: String(assignmentDetails?.distance ?? 0),
        price: String(booking.totalAmount || 0),
        isImmediate: String(booking.isImmediate || false),
      },
      clickAction: `/jobs/${booking.id}`,
      sound: 'job_alert',
      badge: 1,
    });

    emitToBuddy(buddyId, 'job:assigned', { booking, assignmentId: assignmentDetails?.assignmentId });
    emitToAdmins('admin:feed', {
      type: 'BOOKING_ASSIGNED',
      title: 'Job Assigned',
      message: `Job assigned to buddy for ${booking.service.title}`,
      timestamp: new Date(),
      data: { bookingId: booking.id, buddyId }
    });
  }

  /**
   * Notify user - booking assigned
   */
  async notifyUserAssignment(userId: string, booking: any, buddy: any): Promise<void> {
    const title = 'Buddy Assigned';
    const body = `${buddy.user.name} has been assigned to your booking.`;

    await this.createAndQueueNotification(
      userId,
      NotificationType.BOOKING_ASSIGNED,
      title,
      body,
      { bookingId: booking.id, buddyId: buddy.id, buddyName: buddy.user.name },
      booking.id,
      buddy.user.profileImage
    );

    // Send rich push notification with buddy profile image
    await this.sendRichPushNotification(userId, {
      title,
      body,
      imageUrl: buddy.user.profileImage,
      data: {
        type: 'booking_assigned',
        bookingId: booking.id,
        buddyId: buddy.id,
        buddyName: buddy.user.name,
      },
      clickAction: `/bookings/${booking.id}`,
    });

    emitToUser(userId, 'booking:assigned', { booking, buddyName: buddy.user.name });
  }

  /**
   * Notify user - booking accepted
   */
  async notifyUserBookingAccepted(userId: string, booking: any): Promise<void> {
    const title = 'Booking Accepted';
    const body = 'Your booking has been accepted by the service buddy.';

    await this.createAndQueueNotification(
      userId,
      NotificationType.BOOKING_ACCEPTED,
      title,
      body,
      { bookingId: booking.id },
      booking.id
    );

    await this.sendRichPushNotification(userId, {
      title,
      body,
      data: {
        type: 'booking_accepted',
        bookingId: booking.id,
      },
      clickAction: `/bookings/${booking.id}`,
    });

    emitToUser(userId, 'booking:accepted', { bookingId: booking.id });
    emitToAdmins('admin:feed', {
      type: 'BOOKING_ACCEPTED',
      title: 'Booking Accepted',
      message: `Booking accepted for ${booking.service.title}`,
      timestamp: new Date(),
      data: { bookingId: booking.id }
    });
  }

  /**
   * Notify user - booking started
   */
  async notifyUserBookingStarted(userId: string, booking: any): Promise<void> {
    const title = 'Service Started';
    const body = 'The service buddy has started working on your booking.';

    await this.createAndQueueNotification(
      userId,
      NotificationType.BOOKING_STARTED,
      title,
      body,
      { bookingId: booking.id },
      booking.id
    );

    await this.sendRichPushNotification(userId, {
      title,
      body,
      data: {
        type: 'booking_started',
        bookingId: booking.id,
      },
      clickAction: `/bookings/${booking.id}`,
      sound: 'service_started',
    });

    emitToUser(userId, 'booking:started', { bookingId: booking.id });
  }

  /**
   * Notify user - booking completed
   */
  async notifyUserBookingCompleted(userId: string, booking: any): Promise<void> {
    const title = 'Service Completed';
    const body = 'Your booking has been completed. Please rate your experience!';

    await this.createAndQueueNotification(
      userId,
      NotificationType.BOOKING_COMPLETED,
      title,
      body,
      { bookingId: booking.id, serviceTitle: booking.service?.title || 'service' },
      booking.id
    );

    await this.sendRichPushNotification(userId, {
      title,
      body,
      data: {
        type: 'booking_completed',
        bookingId: booking.id,
      },
      clickAction: `/bookings/${booking.id}/review`,
      sound: 'completion',
    });

    emitToUser(userId, 'booking:completed', { bookingId: booking.id });
    emitToAdmins('admin:feed', {
      type: 'BOOKING_COMPLETED',
      title: 'Booking Completed',
      message: `Booking completed: ${booking.service.title}`,
      timestamp: new Date(),
      data: { bookingId: booking.id }
    });
  }

  /**
   * Notify buddy - booking cancelled
   */
  async notifyBuddyBookingCancelled(buddyId: string, booking: any): Promise<void> {
    const title = 'Booking Cancelled';
    const body = `The booking for ${booking.service.title} has been cancelled.`;

    await this.createAndQueueNotification(
      buddyId,
      NotificationType.BOOKING_CANCELLED,
      title,
      body,
      { bookingId: booking.id },
      booking.id
    );

    await this.sendRichPushNotification(buddyId, {
      title,
      body,
      data: {
        type: 'job_cancelled',
        bookingId: booking.id,
      },
      clickAction: `/jobs/${booking.id}`,
    });

    emitToBuddy(buddyId, 'job:cancelled', { bookingId: booking.id });
  }

  /**
   * Notify buddy - review received
   */
  async notifyBuddyReviewReceived(buddyId: string, review: any): Promise<void> {
    const title = 'New Review';
    const body = `You received a ${review.rating}-star review!`;

    await this.createAndQueueNotification(
      buddyId,
      NotificationType.RATING_RECEIVED,
      title,
      body,
      { reviewId: review.id, rating: review.rating },
      review.bookingId
    );

    await this.sendRichPushNotification(buddyId, {
      title,
      body,
      data: {
        type: 'review_received',
        reviewId: review.id,
        rating: String(review.rating),
      },
      clickAction: `/reviews/${review.id}`,
      sound: 'review_received',
    });

    emitToBuddy(buddyId, 'review:received', { review });
  }

  /**
   * Notify admin - no available buddies
   */
  async notifyAdminNoAvailableBuddies(booking: any): Promise<void> {
    const title = 'Alert: No Buddies Available';
    const body = `No buddies available for booking ${booking.id} (${booking.service.title})`;

    logger.warn(body);

    // Find admins and queue a job for each
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true }
    });

    for (const admin of admins) {
      await this.createAndQueueNotification(
        admin.id,
        NotificationType.GENERAL,
        title,
        body,
        {
          bookingId: booking.id,
          serviceTitle: booking.service.title,
          address: booking.address.formattedAddress,
        },
        booking.id
      );
    }

    // Send batch push notification to all admins
    if (admins.length > 0) {
      await this.sendBatchNotification(
        admins.map(a => a.id),
        NotificationType.GENERAL,
        title,
        body,
        {
          type: 'admin_alert',
          bookingId: booking.id,
          serviceTitle: booking.service.title,
          address: booking.address.formattedAddress,
        },
        booking.service.imageUrl
      );
    }

    // Also send a real-time socket event to all connected admins
    emitToAdmins('alert:no_buddies', {
      bookingId: booking.id,
      service: booking.service.title,
      address: booking.address.formattedAddress,
    });
  }

  async notifyUserBuddyArrived(userId: string, booking: any): Promise<void> {
    const title = 'Buddy Arrived';
    const body = 'Your service buddy has reached your location.';

    await this.createAndQueueNotification(
      userId,
      // Use GENERAL or create a new enum type BOOKING_ARRIVED if you update schema
      NotificationType.GENERAL,
      title,
      body,
      { bookingId: booking.id },
      booking.id
    );

    // Send rich push notification
    await this.sendRichPushNotification(userId, {
      title,
      body,
      data: {
        type: 'booking_arrived',
        bookingId: booking.id,
      },
      clickAction: `/bookings/${booking.id}`,
      sound: 'default', // You can use a specific sound like 'doorbell' if configured in app
    });
  }
}

// Register event-bus listeners to handle notifications emitted by other services
const _notificationServiceInstance = new NotificationService();

eventBus.on('notify:user:created', async (payload: any) => {
  const [userId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyUserBookingCreated(userId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:user:accepted', async (payload: any) => {
  const [userId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyUserBookingAccepted(userId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:user:started', async (payload: any) => {
  const [userId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyUserBookingStarted(userId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:user:completed', async (payload: any) => {
  const [userId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyUserBookingCompleted(userId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:buddy:cancelled', async (payload: any) => {
  const [buddyId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyBuddyBookingCancelled(buddyId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:buddy:assigned', async (payload: any) => {
  const [buddyId, booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyBuddyAssignment(buddyId, booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:buddy:review', async (payload: any) => {
  const [buddyId, review] = payload?.args || [];
  try { await _notificationServiceInstance.notifyBuddyReviewReceived(buddyId, review); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:admins:no_buddies', async (payload: any) => {
  const [booking] = payload?.args || [];
  try { await _notificationServiceInstance.notifyAdminNoAvailableBuddies(booking); } catch (err) { logger.error('Event handler error', err); }
});

eventBus.on('notify:user:arrived', async (payload: any) => {
  const [userId, booking] = payload?.args || [];
  try {
    await _notificationServiceInstance.notifyUserBuddyArrived(userId, booking);
  } catch (err) {
    logger.error('Event handler error', err);
  }
});
