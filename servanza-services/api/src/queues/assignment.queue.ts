import { Queue, QueueOptions } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import { BookingStatus, Prisma, AssignmentStatus } from '@prisma/client';

let assignmentQueue: Queue | null = null;

try {
  const defaultQueueOptions: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        count: 100,
        age: 24 * 3600,
      },
      removeOnFail: {
        count: 500,
        age: 7 * 24 * 3600,
      },
    },
  };

  assignmentQueue = new Queue('assignment-queue', defaultQueueOptions);

  assignmentQueue.on('error', (err: any) => {
    logger.error('Assignment queue error:', err);
  });

  logger.info('Assignment queue initialized.');
} catch (err) {
  assignmentQueue = null;
  logger.error('Assignment queue disabled due to Redis error:', err);
}

/**
 * Add assignment job to queue.
 * 
 * RESILIENCE STRATEGY:
 * 1. Backup job to database FIRST
 * 2. Add to Redis queue
 * 3. Mark backup as completed
 * 
 * If queue fails, backup remains for recovery on worker restart.
 * 
 * FALLBACK STRATEGY:
 * - For IMMEDIATE bookings: Process synchronously (can't wait for dispatch-retry)
 * - For SCHEDULED bookings: Mark as PENDING and let dispatch-retry handle later
 */
export async function addAssignmentJob(
  bookingId: string,
  priority: number = 10,
  delay: number = 0
) {
  // Queue is available - normal flow with backup
  if (assignmentQueue) {
    let backupId: string | null = null;

    try {
      // Step 1: Backup to database FIRST
      const { backupJob, markJobCompleted } = await import('../services/job-backup.service');
      backupId = await backupJob('assignment-queue', 'assign-buddy', { bookingId }, priority);

      // Step 2: Add to Redis queue
      await assignmentQueue.add(
        'assign-buddy',
        { bookingId, backupId }, // Include backupId for tracking
        {
          priority,
          delay,
          jobId: `assignment-${bookingId}-${Date.now()}`,
        }
      );

      // Step 3: Mark backup as completed (job is safely in queue)
      await markJobCompleted(backupId);

      logger.info(`Assignment job added for booking ${bookingId} (backup: ${backupId})`);
      return;
    } catch (error) {
      logger.error(`Failed to add assignment job for booking ${bookingId}:`, error);
      if (backupId) {
        // Backup exists - will be recovered on worker restart
        logger.warn(`Job backup ${backupId} remains for recovery`);
      }
      // Fall through to fallback strategy
    }
  }

  // FALLBACK: Queue is unavailable
  logger.warn(`⚠ Queue unavailable for booking ${bookingId}, using fallback`);

  // Fetch booking to check if immediate
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, address: true },
  });

  if (!booking) {
    logger.error(`Booking ${bookingId} not found for fallback processing`);
    return;
  }

  if (booking.isImmediate) {
    // IMMEDIATE BOOKING: Process synchronously (critical - can't wait)
    logger.warn(`[Fallback] Processing immediate booking ${bookingId} synchronously`);
    await processImmediateBookingFallback(booking);
  } else {
    // SCHEDULED BOOKING: Mark as PENDING for dispatch-retry
    logger.warn(`[Fallback] Marking scheduled booking ${bookingId} for dispatch-retry`);
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.PENDING,
        retryCount: 0,
        lastRetryAt: null,
      },
    });
    // dispatch-retry processor will pick this up on next cycle
  }
}

/**
 * Add job to queue using an existing backup ID (from transaction)
 * 
 * Use this pattern for transactional safety:
 * 1. In transaction: Create booking + create job backup
 * 2. After transaction commits: Call this function
 * 
 * If this fails, backup remains for recovery on worker restart.
 */
export async function addQueueJobWithBackupId(
  bookingId: string,
  backupId: string,
  priority: number = 10,
  delay: number = 0
): Promise<boolean> {
  if (!assignmentQueue) {
    logger.warn(`Queue unavailable for backup ${backupId}, will be recovered on restart`);
    return false;
  }

  try {
    await assignmentQueue.add(
      'assign-buddy',
      { bookingId, backupId },
      {
        priority,
        delay,
        jobId: `assignment-${bookingId}-${Date.now()}`,
      }
    );

    // Mark backup as completed
    const { markJobCompleted } = await import('../services/job-backup.service');
    await markJobCompleted(backupId);

    logger.info(`Assignment job added for booking ${bookingId} (backup: ${backupId})`);
    return true;
  } catch (error) {
    logger.error(`Failed to add queue job for backup ${backupId}:`, error);
    // Backup remains PENDING - will be recovered on worker restart
    return false;
  }
}

/**
 * Synchronous fallback for immediate bookings when queue is down
 * Simplified version of assignment processor
 */
async function processImmediateBookingFallback(booking: any) {
  try {
    // Find ALL available buddies (simplified - no location filter for fallback)
    const availableBuddies = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT b.id
      FROM "buddies" b 
      JOIN "users" u ON b.id = u.id 
      WHERE u."isActive" = true AND b."isVerified" = true 
        AND b."isAvailable" = true AND b."isOnline" = true
      LIMIT 10
    `);

    if (availableBuddies.length === 0) {
      logger.warn(`[Fallback] No available buddies for booking ${booking.id}`);
      return;
    }

    // Create assignments for available buddies
    for (const buddy of availableBuddies) {
      await prisma.assignment.create({
        data: {
          bookingId: booking.id,
          buddyId: buddy.id,
          status: AssignmentStatus.PENDING,
          estimatedEtaMins: 30, // Default estimate
          distanceKm: 0,
        },
      });
    }

    logger.info(`[Fallback] Created ${availableBuddies.length} assignments for immediate booking ${booking.id}`);

    // Note: Push notifications will fail if Redis is down, but database assignments are created
    // When Redis recovers, buddies can see pending jobs via API polling
  } catch (error) {
    logger.error(`[Fallback] Failed to process immediate booking ${booking.id}:`, error);
    // Escalate to admin if even fallback fails
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.ESCALATED,
        escalatedAt: new Date(),
      },
    });
  }
}
