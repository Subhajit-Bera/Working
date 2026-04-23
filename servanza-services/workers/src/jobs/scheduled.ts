import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Initialize queues for different domains
 */
const analyticsQueue = new Queue('analytics-queue', {
  connection: redisConnection,
});

const cleanupQueue = new Queue('cleanup-queue', {
  connection: redisConnection,
});

const paymentQueue = new Queue('payment-queue', {
  connection: redisConnection,
});

const dispatchQueue = new Queue('dispatch-queue', {
  connection: redisConnection,
});

/**
 * Setup recurring (cron) jobs
 */
export async function setupScheduledJobs() {
  try {
    logger.info('Setting up scheduled jobs...');

    // Remove any old repeatable jobs to prevent duplication
    const allQueues = [analyticsQueue, cleanupQueue, paymentQueue, dispatchQueue];
    for (const queue of allQueues) {
      const jobs = await queue.getRepeatableJobs();
      for (const job of jobs) {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    /**
     * ANALYTICS JOBS
     */

    // Daily stats - Run every day at 1 AM
    await analyticsQueue.add(
      'daily-stats',
      {},
      {
        repeat: { pattern: '0 1 * * *' },
        jobId: 'daily-stats-job',
      }
    );

    // Buddy performance calculation - Every 6 hours
    await analyticsQueue.add(
      'buddy-performance',
      {},
      {
        repeat: { pattern: '0 */6 * * *' },
        jobId: 'buddy-performance-job',
      }
    );

    // Service popularity - Daily at 4 AM
    await analyticsQueue.add(
      'service-popularity',
      {},
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'service-popularity-job',
      }
    );

    /**
     * CLEANUP JOBS
     */

    // Cleanup expired OTPs - Every hour
    await cleanupQueue.add(
      'expired-otps',
      {},
      {
        repeat: { pattern: '0 * * * *' },
        jobId: 'cleanup-otps-job',
      }
    );

    // Cleanup old notifications - Daily at 2 AM
    await cleanupQueue.add(
      'old-notifications',
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'cleanup-notifications-job',
      }
    );

    // Cleanup old location events - Daily at 3 AM
    await cleanupQueue.add(
      'old-location-events',
      {},
      {
        repeat: { pattern: '0 3 * * *' },
        jobId: 'cleanup-locations-job',
      }
    );

    // Cleanup old audit logs - Sunday 3:30 AM
    await cleanupQueue.add(
      'audit-logs',
      {},
      {
        repeat: { pattern: '30 3 * * 0' },
        jobId: 'cleanup-audit-logs-job',
      }
    );

    // DLQ recovery - Every 30 seconds (process failed offline messages)
    await cleanupQueue.add(
      'dlq-recovery',
      {},
      {
        repeat: { pattern: '*/1 * * * *' }, // Every minute (30s not supported in cron)
        jobId: 'dlq-recovery-job',
      }
    );

    // Cleanup old job backups - Daily at 5 AM
    await cleanupQueue.add(
      'job-backup-cleanup',
      {},
      {
        repeat: { pattern: '0 5 * * *' },
        jobId: 'job-backup-cleanup-job',
      }
    );

    /**
     * PAYMENT JOBS
     */

    // Payment reconciliation - Daily at 6 AM
    await paymentQueue.add(
      'reconcile-payments',
      {},
      {
        repeat: { pattern: '0 6 * * *' },
        jobId: 'reconcile-payments-job',
      }
    );

    /**
     * DISPATCH JOBS (Retry & Activation)
     */

    // Dispatch retry - Every 5 minutes
    await dispatchQueue.add(
      'dispatch-retry',
      {},
      {
        repeat: { pattern: '*/5 * * * *' },
        jobId: 'dispatch-retry-job',
      }
    );

    // Activate queued bookings - 9 AM IST daily (3:30 AM UTC)
    await dispatchQueue.add(
      'activate-queued',
      {},
      {
        repeat: { pattern: '30 3 * * *' },  // 9:00 AM IST = 3:30 AM UTC
        jobId: 'activate-queued-job',
      }
    );

    logger.info('Scheduled jobs setup completed successfully.');
  } catch (error) {
    logger.error('Failed to setup scheduled jobs:', error);
    throw error;
  }
}

//
// FIX: Removed shutdown listeners from this file.
// The main 'index.ts' already handles the shutdown
// for all Workers and the Prisma client. The Queue objects
// do not need to be closed here, as the Workers that use
// them are closed in 'index.ts'.
//
// const shutdownQueues = async () => { ... };
// process.on('SIGTERM', shutdownQueues);
// process.on('SIGINT', shutdownQueues);