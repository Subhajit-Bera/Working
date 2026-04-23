import { Queue, QueueOptions } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

let notificationQueue: Queue | null = null;

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
        count: 1000,
        age: 24 * 3600,
      },
      removeOnFail: {
        count: 5000,
        age: 7 * 24 * 3600,
      },
    },
  };

  notificationQueue = new Queue('notification-queue', defaultQueueOptions);

  notificationQueue.on('error', (err: any) => {
    logger.error('Notification queue error:', err);
  });

  logger.info('Notification queue initialized.');
} catch (err) {
  notificationQueue = null;
  logger.error('Notification queue disabled due to Redis error:', err);
}

/**
 * Add notification job to queue.
 */
export async function addNotificationJob(
  jobName: string,
  userId: string,
  data: any,
  delay: number = 0
) {
  if (!notificationQueue) {
    logger.warn(
      `⚠ Skipping notification job (queue disabled). job=${jobName}, user=${userId}`
    );
    return;
  }

  try {
    if (!notificationQueue) { logger.warn('Queue notificationQueue unavailable, skipping job'); return; }
    await notificationQueue.add(
      jobName,
      { userId, data },
      {
        delay,
        jobId: `notification-${jobName}-${userId}-${Date.now()}`,
      }
    );
  } catch (error) {
    logger.error(
      `Failed to add notification job for user ${userId}:`,
      error
    );
  }
}
