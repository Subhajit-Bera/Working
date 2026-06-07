import { prisma } from '../config/database';
import { AssignmentStatus, BookingStatus } from '@prisma/client'; //Buddy,
import { logger } from '../utils/logger';
import { GeoService } from './geospatial.service';
import { NotificationService } from './notification.service';
import { addAssignmentJob } from '../queues/assignment.queue';
import { ApiError } from '../utils/errors';
import { Location } from '../types';

export class AssignmentService {
  private geoService: GeoService;
  private notificationService: NotificationService;

  constructor() {
    this.geoService = new GeoService();
    this.notificationService = new NotificationService();
  }

  /**
   * Main assignment function - now just adds a job to the queue.
   */
  async assignBuddyForBooking(bookingId: string): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { isImmediate: true, status: true }
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    if (booking.status !== BookingStatus.PENDING) {
      logger.warn(`Booking ${bookingId} is not in PENDING status, skipping assignment.`);
      return;
    }

    const priority = booking.isImmediate ? 1 : 5;
    await addAssignmentJob(bookingId, priority);
  }

  /**
   * Admin reassign booking
   */
  async reassignBooking(bookingId: string): Promise<void> {
    logger.info(`Admin initiated reassignment for booking ${bookingId}`);

    // ===== ATOMIC TRANSACTION: DB updates + Job Backup =====
    const { backupJobInTransaction } = await import('./job-backup.service');
    const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

    let backupId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // 1. Cancel existing pending/accepted assignments
      await tx.assignment.updateMany({
        where: {
          bookingId,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] }
        },
        data: {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: new Date(),
          notes: 'Admin triggered reassignment'
        }
      });

      // 2. Set booking back to PENDING
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.PENDING }
      });

      // 3. Create job backup in same transaction
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
      await addQueueJobWithBackupId(bookingId, backupId, 1, 1000);
    }
  }

  /**
   * Handle buddy rejection and reassign
   */
  async handleBuddyRejection(assignmentId: string, reason?: string): Promise<void> {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { booking: true },
    });

    if (!assignment) {
      throw new ApiError(404, `Assignment ${assignmentId} not found`);
    }

    if (assignment.status !== AssignmentStatus.PENDING) {
      logger.warn(`Assignment ${assignmentId} already processed, skipping rejection.`);
      return;
    }

    // ===== ATOMIC TRANSACTION: DB updates + Job Backup =====
    const { backupJobInTransaction } = await import('./job-backup.service');
    const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

    let backupId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // Update assignment status
      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // Reset booking to PENDING
      await tx.booking.update({
        where: { id: assignment.bookingId },
        data: { status: BookingStatus.PENDING },
      });

      // Create job backup in same transaction
      backupId = await backupJobInTransaction(
        tx,
        'assignment-queue',
        'assign-buddy',
        { bookingId: assignment.bookingId },
        2  // High priority
      );
    });

    logger.info(`Buddy rejected assignment ${assignmentId}. Retrying...`);

    // Add to queue after transaction commits
    if (backupId) {
      await addQueueJobWithBackupId(assignment.bookingId, backupId, 2, 1000);
    }
  }

  /**
   * Admin override - manually assign specific buddy
   */
  async adminOverrideAssignment(bookingId: string, buddyId: string, adminUserId: string): Promise<any> {
    const { randomUUID } = await import('crypto');
    const { Queue } = await import('bullmq');
    const { redis } = await import('../config/redis');

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { address: true, user: true, service: true },
    });

    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      include: { user: true }
    });

    if (!booking || !buddy) {
      throw new ApiError(404, 'Booking or Buddy not found');
    }

    const eligibleStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.ASSIGNED, BookingStatus.ESCALATED];
    if (!eligibleStatuses.includes(booking.status)) {
      throw new ApiError(409, `Booking cannot be overridden from status ${booking.status}`);
    }

    if (!buddy.user?.isActive || !buddy.isVerified || !buddy.isAvailable) {
      throw new ApiError(409, 'Buddy is not active, verified, or available');
    }

    const overlappingAssignment = await prisma.assignment.findFirst({
      where: {
        buddyId,
        status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.ON_WAY, AssignmentStatus.ARRIVED, AssignmentStatus.IN_PROGRESS] }
      }
    });

    if (overlappingAssignment) {
      throw new ApiError(409, 'Buddy has an overlapping committed assignment');
    }

    if (!booking.address.latitude) {
      throw new ApiError(400, 'Booking address is incomplete');
    }

    // Calculate ETA
    const buddyLocation = { latitude: buddy.lastLocationLat, longitude: buddy.lastLocationLong };
    const bookingLocation = { latitude: booking.address.latitude, longitude: booking.address.longitude };

    let eta = 0;
    let distance = 0;

    if (buddyLocation.latitude && bookingLocation.latitude) {
      eta = await this.geoService.getETA(buddyLocation as Location, bookingLocation as Location);
      distance = this.geoService.calculateDistance(buddyLocation as Location, bookingLocation as Location);
    } else {
      logger.warn(`Missing location for buddy or booking, setting ETA/distance to 0`);
    }

    let finalAssignment: any;
    let finalBooking: any;
    let withdrawnBuddyIds: string[] = [];
    const eventId = randomUUID();

    await prisma.$transaction(async (tx) => {
      // 9. Atomically claim the booking using a guarded update
      const claimResult = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: { in: eligibleStatuses }
        },
        data: {
          status: BookingStatus.ACCEPTED,
          escalatedAt: null // Clear stale escalation state
        }
      });

      if (claimResult.count === 0) {
        throw new ApiError(409, 'Booking state changed concurrently, cannot override');
      }

      // 11. Capture pending assignments belonging to other buddies
      const otherPendingAssignments = await tx.assignment.findMany({
        where: {
          bookingId,
          buddyId: { not: buddyId },
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.ON_WAY, AssignmentStatus.ARRIVED] }
        },
        select: { buddyId: true }
      });
      withdrawnBuddyIds = otherPendingAssignments.map(a => a.buddyId);

      // 12. Cancel exactly those pending assignments
      if (withdrawnBuddyIds.length > 0) {
        await tx.assignment.updateMany({
          where: {
            bookingId,
            buddyId: { in: withdrawnBuddyIds }
          },
          data: {
            status: AssignmentStatus.CANCELLED,
            cancelledAt: new Date(),
            notes: 'Admin override'
          }
        });
      }

      // 13-16. Upsert the selected assignment
      finalAssignment = await tx.assignment.upsert({
        where: { bookingId_buddyId: { bookingId, buddyId } },
        update: {
          status: AssignmentStatus.ACCEPTED,
          estimatedEtaMins: Math.ceil(eta),
          distanceKm: distance,
          notes: 'Admin override assignment',
          acceptedAt: new Date(),
          rejectedAt: null,
          rejectionReason: null,
          cancelledAt: null
        },
        create: {
          bookingId,
          buddyId,
          status: AssignmentStatus.ACCEPTED,
          estimatedEtaMins: Math.ceil(eta),
          distanceKm: distance,
          notes: 'Admin override assignment',
          acceptedAt: new Date()
        }
      });

      // 17. Remove buddy from excludedBuddyIds via raw SQL
      await tx.$executeRaw`
        UPDATE "bookings" 
        SET "excludedBuddyIds" = array_remove("excludedBuddyIds", ${buddyId})
        WHERE "id" = ${bookingId} AND ${buddyId} = ANY("excludedBuddyIds")
      `;

      finalBooking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          address: true,
          user: true,
          service: true,
          assignments: {
            include: {
              buddy: {
                include: { user: true }
              }
            }
          }
        }
      });

      // 20. Create the audit log
      await tx.auditLog.create({
        data: {
          action: 'ADMIN_OVERRIDE_ASSIGNMENT',
          entity: 'Booking',
          entityId: bookingId,
          userId: adminUserId,
          changes: {
            previousBookingStatus: booking.status,
            newBookingStatus: BookingStatus.ACCEPTED,
            selectedBuddyId: buddyId,
            withdrawnBuddyIds,
            removedFromExcludedBuddyIds: true,
            assignedByAdmin: true
          }
        }
      });
    });

    // 5. Safe BullMQ Cleanup
    try {
      const assignmentQueue = new Queue('assignment-queue', { connection: redis });
      const activeJobs = await assignmentQueue.getJobs(['wait', 'delayed', 'active', 'prioritized']);
      const matchingJobs = activeJobs.filter(j => j?.data?.bookingId === bookingId);

      let removedCount = 0;
      for (const job of matchingJobs) {
        try {
          await job.remove();
          removedCount++;
        } catch (e) {
          logger.warn(`Failed to remove job ${job.id}: ${e}`);
        }
      }
      logger.info(`[AdminOverride] Removed ${removedCount} matching jobs from assignment-queue`);

      const { cancelObsoleteBackups } = await import('./job-backup.service');
      await cancelObsoleteBackups(bookingId);
    } catch (cleanupError) {
      logger.error('Failed to cleanup BullMQ/Backups after admin assignment:', cleanupError);
    }

    // 6. Notify
    const { emitToBuddy, emitToUser } = await import('../utils/realtime');

    emitToBuddy(buddyId, 'job:assigned', {
      eventId,
      bookingId,
      assignmentId: finalAssignment.id,
      status: 'ACCEPTED',
      serviceTitle: booking.service.title,
      address: booking.address.formattedAddress,
      price: booking.totalAmount,
      distance,
      estimatedEtaMins: Math.ceil(eta),
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      assignedByAdmin: true
    });

    await this.notificationService.sendBatchNotification(
      [buddy.user.id],
      'BOOKING_ASSIGNED' as any, // or NotificationType.BOOKING_ASSIGNED if imported
      'Job Assigned by Admin',
      `You have been manually assigned to a job: ${booking.service.title}`,
      { bookingId, assignmentId: finalAssignment.id, type: 'ADMIN_ASSIGNMENT' },
      undefined,
      'BUDDY_APP'
    );

    for (const withdrawnBuddyId of withdrawnBuddyIds) {
      emitToBuddy(withdrawnBuddyId, 'job:withdrawn', {
        eventId,
        bookingId,
        reason: 'ADMIN_OVERRIDE'
      });
    }

    emitToUser(booking.userId, 'booking:updated', {
      eventId,
      bookingId,
      assignmentId: finalAssignment.id,
      buddyId,
      status: 'ACCEPTED'
    });

    logger.info(`Admin override: assigned buddy ${buddyId} to booking ${bookingId}`);
    return { booking: finalBooking, assignment: finalAssignment, withdrawnBuddyIds };
  }
}