import { prisma } from '../config/database';
import { BookingStatus, PaymentStatus, PaymentMethod, AssignmentStatus } from '@prisma/client';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
// import { NotificationService } from './notification.service'; ///needed****
import { PaymentService } from './payment.service';
import { BuddyService } from './buddy.service';
import { OTPService } from './otp.service';
import { emitToUser } from '../utils/realtime';

// const notificationService = new NotificationService();
const paymentService = new PaymentService();
const otpService = new OTPService();

interface CreateBookingData {
  serviceId: string;
  addressId: string;
  scheduledStart: Date | string;
  isImmediate?: boolean;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
}

interface BookingFilters {
  status?: string;
  page?: number;
  limit?: number;
}

export class BookingService {
  private buddyService: BuddyService;

  constructor() {
    this.buddyService = new BuddyService();
  }

  /**
   * Create new booking
   */
  async createBooking(userId: string, data: CreateBookingData) {
    try {
      const service = await prisma.service.findUnique({
        where: { id: data.serviceId },
      });

      if (!service || !service.isActive) {
        throw new ApiError(400, 'Service not found or inactive');
      }

      const address = await prisma.address.findFirst({
        where: {
          id: data.addressId,
          userId,
        },
      });

      if (!address) {
        throw new ApiError(400, 'Address not found');
      }

      const scheduledStart = new Date(data.scheduledStart);
      const scheduledEnd = new Date(scheduledStart.getTime() + service.durationMins * 60000);

      const price = service.basePrice;
      const taxAmount = price * 0.18;
      const totalAmount = price + taxAmount;

      // Check if booking is within service hours (9 AM - 10 PM IST)
      // Uses explicit IST conversion — does NOT rely on process.env.TZ
      const isWithinServiceHours = (): boolean => {
        const now = new Date();
        // Convert UTC to IST using Intl (always available in Node 14+)
        const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        const istDate = new Date(istString);
        const hour = istDate.getHours();
        const minute = istDate.getMinutes();
        const currentTimeInHours = hour + minute / 60;

        const SERVICE_START = 9;    // 9:00 AM IST
        const SERVICE_END = 22;     // 10:00 PM IST

        const isWithin = currentTimeInHours >= SERVICE_START && currentTimeInHours < SERVICE_END;

        logger.info(`[ServiceHours] IST time: ${hour}:${minute.toString().padStart(2, '0')} (${currentTimeInHours.toFixed(2)}). Within hours: ${isWithin}`);

        return isWithin;
      };

      // Determine initial status - QUEUED for any booking created after service hours
      // Note: Frontend blocks immediate bookings after hours, so only scheduled bookings will be QUEUED
      const isAfterHours = !isWithinServiceHours();
      const initialStatus = isAfterHours ? BookingStatus.QUEUED : BookingStatus.PENDING;

      // ===== ATOMIC TRANSACTION: Booking + Job Backup =====
      // This ensures no orphaned bookings if queue fails
      const { withDbRetry } = await import('../utils/db-retry');
      const { backupJobInTransaction } = await import('./job-backup.service');
      const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

      let backupId: string | null = null;
      const isImmediateBooking = data.isImmediate || service.isInstant || false;
      const priority = isImmediateBooking ? 1 : 5;

      const booking = await withDbRetry(() => prisma.$transaction(async (tx) => {
        // Step 1: Create booking
        const newBooking = await tx.booking.create({
          data: {
            userId,
            serviceId: data.serviceId,
            addressId: data.addressId,
            scheduledStart,
            scheduledEnd,
            isImmediate: isImmediateBooking,
            paymentMethod: data.paymentMethod,
            paymentStatus:
              data.paymentMethod === PaymentMethod.PREPAID
                ? PaymentStatus.PENDING
                : PaymentStatus.PENDING,
            price,
            taxAmount,
            discountAmount: 0,
            totalAmount,
            employeePayout: service.employeePayout,
            cmpPayout: service.cmpPayout,
            specialInstructions: data.specialInstructions,
            status: initialStatus,
            retryCount: 0,
            lastRetryAt: null,
            escalatedAt: null,
            excludedBuddyIds: [],
          },
          include: {
            service: true,
            address: true,
            user: true,
          },
        });

        // Step 2: Create audit log in same transaction
        await tx.auditLog.create({
          data: {
            userId,
            bookingId: newBooking.id,
            action: isAfterHours ? 'BOOKING_QUEUED' : 'BOOKING_CREATED',
            entity: 'Booking',
            entityId: newBooking.id,
            changes: { reason: isAfterHours ? 'After service hours' : undefined },
          },
        });

        // Step 3: Create job backup in same transaction (if dispatching)
        if (!isAfterHours) {
          backupId = await backupJobInTransaction(
            tx,
            'assignment-queue',
            'assign-buddy',
            { bookingId: newBooking.id },
            priority
          );
        }

        return newBooking;
      }));

      // ===== AFTER TRANSACTION COMMITS =====
      // Payment order (safe - can be retried)
      if (data.paymentMethod === PaymentMethod.PREPAID) {
        await paymentService.createRazorpayOrder(booking.id, totalAmount, booking.currency);
      }

      // Add to queue using the backup ID from transaction
      // If this fails, backup remains PENDING for recovery on worker restart
      if (!isAfterHours && backupId) {
        await addQueueJobWithBackupId(booking.id, backupId, priority);
      } else if (isAfterHours) {
        logger.info(`Booking ${booking.id} QUEUED for 9 AM activation (created after service hours)`);
      }

      logger.info(`Booking created: ${booking.id}`);

      return booking;
    } catch (error) {
      logger.error('Create booking error:', error);
      throw error;
    }
  }

  /**
   * Get user bookings
   */
  async getUserBookings(userId: string, filters: BookingFilters) {
    const { status, page = 1, limit = 10 } = filters;

    const where: any = { userId };
    let assignmentStatusFilter: AssignmentStatus[] = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED];

    if (status) {
      // Status may come as string; keep it flexible
      where.status = status as any;

      // If the status is one of the final booking statuses, filter assignments accordingly
      if (([BookingStatus.COMPLETED, BookingStatus.CANCELLED] as BookingStatus[]).includes(status as BookingStatus)) {
        assignmentStatusFilter = [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED];
      }
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          service: {
            include: {
              category: true,
            },
          },
          address: true,
          assignments: {
            where: {
              status: { in: assignmentStatusFilter },
            },
            include: {
              buddy: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      profileImage: true,
                    },
                  },
                },
              },
            },
          },
          reviews: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  /**
   * Get booking by ID
   */
  async getBookingById(bookingId: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        service: {
          include: {
            category: true,
          },
        },
        address: true,
        assignments: {
          include: {
            buddy: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    profileImage: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        transactions: true,
        reviews: true,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    return booking;
  }

  /**
   * Update booking
   */
  async updateBooking(bookingId: string, userId: string, updates: any) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new ApiError(400, 'Cannot update booking in current status');
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: updates,
      include: {
        service: true,
        address: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        bookingId,
        action: 'BOOKING_UPDATED',
        entity: 'Booking',
        entityId: bookingId,
        changes: { old: booking, new: updatedBooking },
      },
    });

    return updatedBooking;
  }

  /**
   * Cancel booking
   */
  async cancelBooking(bookingId: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    if (([BookingStatus.COMPLETED, BookingStatus.CANCELLED] as BookingStatus[]).includes(booking.status)) {
      throw new ApiError(400, 'Cannot cancel booking in current status');
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    // Use enums for assignment status checks/updates
    await prisma.assignment.updateMany({
      where: {
        bookingId,
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },
      data: {
        status: AssignmentStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    // Process refund if prepaid and already paid
    if (booking.paymentMethod === PaymentMethod.PREPAID && booking.paymentStatus === PaymentStatus.COMPLETED) {
      const transaction = await prisma.transaction.findFirst({
        where: { bookingId, status: PaymentStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
      });

      if (transaction) {
        await paymentService.processRefund(transaction.id);
      }

      // Notify buddy if assigned
      const assignment = await prisma.assignment.findFirst({
        where: {
          bookingId,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
        },
      });

      if (assignment) {
        // eventBus.emit('notify:buddy:cancelled', { args: [assignment.buddyId, booking] });

        console.log(`Notify buddy ${assignment.buddyId} about booking cancellation.`)
      }

      logger.info(`Booking cancelled: ${bookingId}`);
    }
  }

  /**
   * Cancel booking with reason
   */
  async cancelBookingWithReason(bookingId: string, userId: string, reason: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    await this.cancelBooking(bookingId, userId);
  }

  /**
   * Reschedule booking
   */
  async rescheduleBooking(
    bookingId: string,
    userId: string,
    newSchedule: { scheduledStart: Date; scheduledEnd: Date }
  ) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    if (!([BookingStatus.PENDING, BookingStatus.ASSIGNED] as BookingStatus[]).includes(booking.status)) {
      throw new ApiError(400, 'Cannot reschedule booking in current status');
    }

    // ===== ATOMIC TRANSACTION: DB updates + Job Backup =====
    const { backupJobInTransaction } = await import('./job-backup.service');
    const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

    let backupId: string | null = null;

    const updatedBooking = await prisma.$transaction(async (tx) => {
      // Update booking schedule
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          scheduledStart: newSchedule.scheduledStart,
          scheduledEnd: newSchedule.scheduledEnd,
          status: BookingStatus.PENDING,
        },
      });

      // Cancel existing assignments
      await tx.assignment.updateMany({
        where: {
          bookingId,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
        },
        data: { status: AssignmentStatus.CANCELLED },
      });

      // Create job backup in same transaction
      backupId = await backupJobInTransaction(
        tx,
        'assignment-queue',
        'assign-buddy',
        { bookingId },
        5
      );

      return updated;
    });

    // Add to queue after transaction commits
    if (backupId) {
      await addQueueJobWithBackupId(bookingId, backupId, 5, 1000);
    }

    return updatedBooking;
  }

  /**
   * CENTRALIZED FUNCTION
   */
  async completeBookingAndAssignment(
    assignmentId: string,
    actorBuddyId: string,
    otp?: string
  ) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: {
          include: { user: { select: { phone: true, id: true } } }
        },
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }
    if (assignment.buddyId !== actorBuddyId) {
      throw new ApiError(403, 'Unauthorized');
    }
    if (assignment.status === AssignmentStatus.COMPLETED) {
      throw new ApiError(400, 'Assignment already completed');
    }

    const { booking } = assignment;

    if (booking.paymentMethod === PaymentMethod.CASH) {
      if (!otp) {
        const userPhone = booking.user.phone;
        if (!userPhone) {
          throw new ApiError(400, 'Cannot send OTP, user has no phone number.');
        }
        await otpService.generateOTPForBooking(booking.id, userPhone);
        logger.warn(`OTP not provided for cash booking ${booking.id}. Sending new OTP.`);
        throw new ApiError(400, 'OTP required for cash payment. An OTP has been sent to the customer.');
      }

      const isValidOTP = await otpService.verifyOTP(booking.id, otp);
      if (!isValidOTP) {
        throw new ApiError(400, 'Invalid OTP');
      }
    }

    // Use callback form of $transaction
    const [updatedAssignment, updatedBooking] = await prisma.$transaction(async (tx: any) => {
      const updatedAsgmt = await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      const updatedBk = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.COMPLETED,
          completedAt: new Date(),
          paymentStatus: PaymentStatus.COMPLETED,
        },
      });

      return [updatedAsgmt, updatedBk] as const;
    });

    if (booking.paymentMethod === PaymentMethod.CASH) {
      await paymentService.recordCashPayment(booking.id, booking.totalAmount);
    }

    await this.buddyService.updateBuddyStatsOnCompletion(
      assignment.buddyId,
      booking.employeePayout
    );

    // eventBus.emit('notify:user:completed', { args: [booking.userId, booking] });

    emitToUser(booking.userId, 'booking:completed', {
      bookingId: booking.id,
    });

    logger.info(`Job completed: ${assignmentId} by buddy ${actorBuddyId}`);
    return { booking: updatedBooking, assignment: updatedAssignment };
  }

  /**
   * Add review
   */
  async addReview(bookingId: string, userId: string, reviewData: { rating: number; comment?: string }) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        assignments: {
          where: { status: AssignmentStatus.COMPLETED },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new ApiError(400, 'Can only review completed bookings');
    }

    const assignment = booking.assignments[0];
    if (!assignment) {
      throw new ApiError(400, 'No completed assignment found');
    }

    // Upsert: create or update the review
    const existingReview = await prisma.review.findUnique({
      where: { bookingId },
    });

    let review;
    if (existingReview) {
      // Update existing review
      const oldRating = existingReview.rating;

      review = await prisma.review.update({
        where: { id: existingReview.id },
        data: {
          rating: reviewData.rating,
          comment: reviewData.comment,
        },
      });

      // Adjust buddy rating (remove old, add new)
      const buddy = await prisma.buddy.findUnique({
        where: { id: assignment.buddyId },
      });
      if (buddy && buddy.totalRatings > 0) {
        const newRating = (buddy.rating * buddy.totalRatings - oldRating + reviewData.rating) / buddy.totalRatings;
        await prisma.buddy.update({
          where: { id: assignment.buddyId },
          data: { rating: newRating },
        });
      }
    } else {
      // Create new review
      review = await prisma.review.create({
        data: {
          bookingId,
          userId,
          buddyId: assignment.buddyId,
          serviceId: booking.serviceId,
          rating: reviewData.rating,
          comment: reviewData.comment,
        },
      });

      // Update buddy rating
      const buddy = await prisma.buddy.findUnique({
        where: { id: assignment.buddyId },
      });
      if (buddy) {
        const newTotalRatings = buddy.totalRatings + 1;
        const newRating = (buddy.rating * buddy.totalRatings + reviewData.rating) / newTotalRatings;
        await prisma.buddy.update({
          where: { id: assignment.buddyId },
          data: {
            rating: newRating,
            totalRatings: newTotalRatings,
          },
        });
      }
    }

    return review;
  }

  /**
   * Get booking review
   */
  async getBookingReview(bookingId: string) {
    return await prisma.review.findFirst({
      where: { bookingId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            profileImage: true,
          },
        },
      },
    });
  }

  /**
   * Get booking status
   */
  async getBookingStatus(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        scheduledStart: true,
        scheduledEnd: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    return booking;
  }

  /**
   * Get booking timeline
   */
  async getBookingTimeline(bookingId: string) {
    const [booking] = await Promise.all([
      prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          assignments: {
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.auditLog.findMany({
        where: { bookingId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    const timeline = [
      {
        event: 'BOOKING_CREATED',
        timestamp: booking.createdAt,
        description: 'Booking created',
      },
    ];

    booking.assignments.forEach((assignment: any) => {
      if (assignment.assignedAt) {
        timeline.push({
          event: 'BUDDY_ASSIGNED',
          timestamp: assignment.assignedAt,
          description: 'Buddy assigned',
        });
      }
      if (assignment.acceptedAt) {
        timeline.push({
          event: 'BUDDY_ACCEPTED',
          timestamp: assignment.acceptedAt,
          description: 'Buddy accepted job',
        });
      }
      if (assignment.startedAt) {
        timeline.push({
          event: 'JOB_STARTED',
          timestamp: assignment.startedAt,
          description: 'Job started',
        });
      }
      if (assignment.completedAt) {
        timeline.push({
          event: 'JOB_COMPLETED',
          timestamp: assignment.completedAt,
          description: 'Job completed',
        });
      }
    });

    if (booking.completedAt) {
      timeline.push({
        event: 'BOOKING_COMPLETED',
        timestamp: booking.completedAt,
        description: 'Booking completed',
      });
    }

    if (booking.cancelledAt) {
      timeline.push({
        event: 'BOOKING_CANCELLED',
        timestamp: booking.cancelledAt,
        description: 'Booking cancelled',
      });
    }

    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return timeline;
  }

  /**
   * Get buddy location for booking
   */
  async getBuddyLocation(bookingId: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        assignments: {
          where: {
            status: { in: [AssignmentStatus.ACCEPTED] },
          },
          include: {
            buddy: {
              select: {
                lastLocationLat: true,
                lastLocationLong: true,
                lastLocationTime: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    const assignment = booking.assignments ? booking.assignments[0] : null;
    if (!assignment) {
      throw new ApiError(404, 'No active assignment found');
    }

    return {
      latitude: assignment.buddy.lastLocationLat,
      longitude: assignment.buddy.lastLocationLong,
      lastUpdate: assignment.buddy.lastLocationTime,
    };
  }

  /**
   * Customer "Try Again" - Re-broadcast booking to available buddies
   * Resets retry count and triggers new assignment broadcast
   */
  async retryBroadcast(bookingId: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    // Only allow retry on PENDING or ESCALATED bookings
    if (!['PENDING', 'ESCALATED'].includes(booking.status)) {
      throw new ApiError(400, `Cannot retry broadcast for booking with status ${booking.status}`);
    }

    // ===== ATOMIC TRANSACTION: DB updates + Job Backup =====
    const { backupJobInTransaction } = await import('./job-backup.service');
    const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

    let backupId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // Cancel any existing PENDING assignments
      await tx.assignment.updateMany({
        where: {
          bookingId,
          status: AssignmentStatus.PENDING,
        },
        data: {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      // Reset booking for fresh retry
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.PENDING,
          retryCount: 0,
          lastRetryAt: null,
          escalatedAt: null,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId,
          bookingId,
          action: 'BOOKING_RETRY_REQUESTED',
          entity: 'Booking',
          entityId: bookingId,
          changes: { triggeredBy: 'customer' },
        },
      });

      // Create job backup in same transaction
      backupId = await backupJobInTransaction(
        tx,
        'assignment-queue',
        'assign-buddy',
        { bookingId },
        1  // High priority
      );
    });

    // Add to queue after transaction commits
    if (backupId) {
      await addQueueJobWithBackupId(bookingId, backupId, 1);
    }

    logger.info(`Customer-initiated retry broadcast for booking ${bookingId}`);

    return { bookingId, message: 'Retry broadcast initiated' };
  }
}
