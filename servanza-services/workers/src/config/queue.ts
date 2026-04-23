import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './redis';
import { logger } from '../utils/logger';

const defaultQueueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // Keep completed jobs for 24 hours
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
};

// Create queues
export const assignmentQueue = new Queue('assignment-queue', defaultQueueOptions);
export const notificationQueue = new Queue('notification-queue', defaultQueueOptions);
export const analyticsQueue = new Queue('analytics-queue', defaultQueueOptions);
export const cleanupQueue = new Queue('cleanup-queue', defaultQueueOptions);
export const paymentQueue = new Queue('payment-queue', defaultQueueOptions);
export const dispatchQueue = new Queue('dispatch-queue', defaultQueueOptions);  // For retry & activation

// Log errors
const queues = [assignmentQueue, notificationQueue, analyticsQueue, cleanupQueue, paymentQueue, dispatchQueue];
queues.forEach(queue => {
  queue.on('error', (err: any) => {
    logger.error(`Queue [${queue.name}] error:`, err);
  });
});

// Helper functions to add jobs (from within the worker)
// Uses backup-first pattern for critical jobs

import { backupJob, markJobCompleted } from '../services/job-backup.service';

/**
 * Add assignment job with backup-first pattern
 * Ensures job is recoverable if Redis fails
 */
export async function addAssignmentJob(bookingId: string, priority?: number) {
  const jobPriority = priority || 10;
  let backupId: string | null = null;

  try {
    // Step 1: Backup to database first
    backupId = await backupJob('assignment-queue', 'assign-buddy', { bookingId }, jobPriority);

    // Step 2: Add to Redis queue
    const job = await assignmentQueue.add(
      'assign-buddy',
      { bookingId, backupId },
      {
        priority: jobPriority,
        jobId: `assignment-${bookingId}-${Date.now()}`,
      }
    );

    // Step 3: Mark backup as completed
    await markJobCompleted(backupId);

    logger.info(`[Worker] Assignment job added for ${bookingId} (backup: ${backupId})`);
    return job;
  } catch (error) {
    logger.error(`Failed to add assignment job from worker for ${bookingId}`, error);
    if (backupId) {
      logger.warn(`[Worker] Job backup ${backupId} remains for recovery`);
    }
    // Don't throw - let scheduled retry handle it
  }
}

/**
 * Add notification job (no backup needed - idempotent)
 */
export async function addNotificationJob(
  type: string,
  userId: string,
  data: any,
  delay?: number
) {
  try {
    return await notificationQueue.add(
      type,
      { userId, data },
      {
        delay,
        jobId: `notification-${userId}-${type}-${Date.now()}`,
      }
    );
  } catch (error) {
    logger.error(`Failed to add notification job from worker for ${userId}`, error);
  }
}

/**
 * Add analytics job (no backup needed - non-critical)
 */
export async function addAnalyticsJob(type: string, data: any) {
  try {
    return await analyticsQueue.add(type, data);
  } catch (error) {
    logger.error(`Failed to add analytics job from worker`, error);
  }
}

/**
 * Add cleanup job (no backup needed - scheduled retry)
 */
export async function addCleanupJob(type: string, data: any) {
  try {
    return await cleanupQueue.add(type, data, {
      jobId: `cleanup-${type}-${Date.now()}`,
    });
  } catch (error) {
    logger.error(`Failed to add cleanup job from worker`, error);
  }
}

/**
 * Add payment job with backup-first pattern (critical)
 */
export async function addPaymentJob(type: string, data: any, priority?: number) {
  const jobPriority = priority || 5;
  let backupId: string | null = null;

  try {
    // Step 1: Backup to database first
    backupId = await backupJob('payment-queue', type, data, jobPriority);

    // Step 2: Add to Redis queue
    const job = await paymentQueue.add(type, { ...data, backupId }, {
      priority: jobPriority,
      jobId: `payment-${type}-${Date.now()}`,
    });

    // Step 3: Mark backup as completed
    await markJobCompleted(backupId);

    logger.info(`[Worker] Payment job added: ${type} (backup: ${backupId})`);
    return job;
  } catch (error) {
    logger.error(`Failed to add payment job from worker: ${type}`, error);
    if (backupId) {
      logger.warn(`[Worker] Job backup ${backupId} remains for recovery`);
    }
  }
}