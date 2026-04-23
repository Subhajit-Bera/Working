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
  async adminOverrideAssignment(bookingId: string, buddyId: string): Promise<void> {
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

    if (!booking.address.latitude || !buddy.user) {
      throw new ApiError(400, 'Booking address or buddy data is incomplete');
    }

    // Calculate ETA
    const buddyLocation = { latitude: buddy.lastLocationLat, longitude: buddy.lastLocationLong };
    const bookingLocation = { latitude: booking.address.latitude, longitude: booking.address.longitude };

    let eta = 0;
    let distance = 0;

    if (buddyLocation.latitude && bookingLocation.latitude) {
      // Cast to the imported Location type
      eta = await this.geoService.getETA(buddyLocation as Location, bookingLocation as Location);
      distance = this.geoService.calculateDistance(buddyLocation as Location, bookingLocation as Location);
    } else {
      logger.warn(`Missing location for buddy or booking, setting ETA/distance to 0`);
    }

    // Cancel existing assignments
    await prisma.assignment.updateMany({
      where: {
        bookingId,
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },
      data: { status: AssignmentStatus.CANCELLED, notes: "Admin override" },
    });

    // Create new assignment
    const assignment = await prisma.assignment.create({
      data: {
        bookingId,
        buddyId,
        status: AssignmentStatus.PENDING,
        estimatedEtaMins: Math.ceil(eta),
        distanceKm: distance,
        notes: 'Admin override assignment',
      },
    });

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ASSIGNED },
    });

    // Log admin action
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_OVERRIDE_ASSIGNMENT',
        entity: 'Assignment',
        entityId: assignment.id,
        bookingId,
        changes: { buddyId, type: 'manual_override' },
      },
    });

    // Notify buddy and user
    await this.notificationService.notifyBuddyAssignment(buddyId, booking);
    await this.notificationService.notifyUserAssignment(booking.userId, booking, buddy);

    logger.info(`Admin override: assigned buddy ${buddyId} to booking ${bookingId}`);
  }
}