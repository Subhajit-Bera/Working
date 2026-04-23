// Set timezone to IST for all Date operations
process.env.TZ = 'Asia/Kolkata';

import { Worker } from 'bullmq';
import { logger } from './utils/logger';
import { redisConnection, redis } from './config/redis';
import { prisma } from './config/database';
import { assignmentProcessor } from './processors/assignment.processor';
import { notificationProcessor } from './processors/notification.processor';
import { analyticsProcessor } from './processors/analytics.processor';
import { cleanupProcessor } from './processors/cleanup.processor';
import { paymentProcessor } from './processors/payment.processor';
import { dispatchRetryProcessor } from './processors/dispatch-retry.processor';
import { queuedActivationProcessor } from './processors/queued-activation.processor';
import { setupScheduledJobs } from './jobs/scheduled';
import { initializeRazorpay } from './config/razorpay';
import express from 'express';
import http from 'http';
import dotenv from "dotenv";
dotenv.config({ path: "../api/.env" });

const workers: Worker[] = [];
let workersEnabled = true;

async function ensureRedisCompatible(): Promise<void> {
  try {
    const info = await redis.info();
    const line = info.split('\n').find((l) => l.toLowerCase().startsWith('redis_version:')) || '';
    const version = line.split(':')[1]?.trim() || '0.0.0';
    const major = parseInt(version.split('.')[0] || '0', 10);
    if (Number.isNaN(major) || major < 5) {
      workersEnabled = false;
      logger.error(`Worker error: Redis version needs to be >= 5.0.0 Current: ${version}`);
    }
  } catch (e: any) {
    workersEnabled = false;
    logger.error('Worker error: Unable to determine Redis version', e);
  }
}

// Initialize external services
initializeRazorpay(); // For payment processing

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down workers gracefully...');

  // Close all workers
  await Promise.all(workers.map((worker) => worker.close()));

  // Disconnect from database
  await prisma.$disconnect();

  logger.info('Workers shut down successfully');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions (like port conflicts)
process.on('uncaughtException', (error: any) => {
  if (error.code === 'EADDRINUSE' && error.syscall === 'listen') {
    const port = error.port || process.env.WORKER_PORT || 3002;
    logger.error(`Port ${port} is already in use. Please free the port or set a different WORKER_PORT.`);
    logger.info('Workers will continue to run, but health check server is unavailable.');
    // Explicitly prevent exit for port conflicts
    return; // Don't exit - let workers continue
  } else {
    logger.error('Uncaught Exception:', error);
    // For other uncaught exceptions, we might want to exit
    // But for now, let's just log it
  }
});

// Also handle unhandled rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  if (reason && reason.code === 'EADDRINUSE' && reason.syscall === 'listen') {
    const port = reason.port || process.env.WORKER_PORT || 3002;
    logger.error(`Port ${port} is already in use (unhandled rejection). Please free the port or set a different WORKER_PORT.`);
    logger.info('Workers will continue to run, but health check server is unavailable.');
    return; // Don't exit
  }
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Health check endpoint
const app = express();
app.get('/health', (req: any, res: any) => {
  const health = {
    status: workersEnabled ? 'healthy' : 'disabled',
    workers: workersEnabled
      ? workers.map((w) => ({ name: w.name, isRunning: w.isRunning(), isPaused: w.isPaused() }))
      : [],
    timestamp: new Date().toISOString(),
  };
  res.json(health);
});

const PORT = process.env.WORKER_PORT || 3002;

// Create HTTP server for better error handling
const server = http.createServer(app);

// Attach error handler BEFORE calling listen
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use. Please free the port or set a different WORKER_PORT.`);
    logger.info('Workers will continue to run, but health check server is unavailable.');
    // Don't crash - just log the error
  } else {
    logger.error('Health check server error:', error);
  }
});

// Start the server - errors will be caught by the error handler above
server.listen(PORT, () => {
  logger.info(`Worker health check server running on port ${PORT}`);
});

logger.info('Starting workers...');
async function start() {
  try {
    await ensureRedisCompatible();

    // Assignment worker
    const assignmentWorker = workersEnabled
      ? new Worker('assignment-queue', assignmentProcessor, {
        connection: redisConnection,
        concurrency: 5,
        limiter: { max: 10, duration: 1000 },
      })
      : undefined as unknown as Worker;

    // Notification worker
    const notificationWorker = workersEnabled
      ? new Worker('notification-queue', notificationProcessor, {
        connection: redisConnection,
        concurrency: 10,
        limiter: { max: 50, duration: 1000 },
      })
      : undefined as unknown as Worker;

    // Analytics worker
    const analyticsWorker = workersEnabled
      ? new Worker('analytics-queue', analyticsProcessor, {
        connection: redisConnection,
        concurrency: 3,
      })
      : undefined as unknown as Worker;

    // Cleanup worker
    const cleanupWorker = workersEnabled
      ? new Worker('cleanup-queue', cleanupProcessor, {
        connection: redisConnection,
        concurrency: 2,
      })
      : undefined as unknown as Worker;

    // Payment worker
    const paymentWorker = workersEnabled
      ? new Worker('payment-queue', paymentProcessor, {
        connection: redisConnection,
        concurrency: 5,
      })
      : undefined as unknown as Worker;

    // Dispatch worker (handles retry and activation jobs)
    const dispatchWorker = workersEnabled
      ? new Worker('dispatch-queue', async (job) => {
        // Route to appropriate processor based on job name
        if (job.name === 'dispatch-retry') {
          return dispatchRetryProcessor(job);
        } else if (job.name === 'activate-queued') {
          return queuedActivationProcessor(job);
        }
        logger.warn(`Unknown dispatch job type: ${job.name}`);
      }, {
        connection: redisConnection,
        concurrency: 2,
      })
      : undefined as unknown as Worker;

    if (workersEnabled) {
      workers.push(
        assignmentWorker,
        notificationWorker,
        analyticsWorker,
        cleanupWorker,
        paymentWorker,
        dispatchWorker
      );

      // Event handlers for all workers
      workers.forEach((worker) => {
        worker.on('completed', (job: any) => {
          logger.info(`Job ${job.id} in ${job.queueName} completed`, {
            jobId: job.id,
            queue: job.queueName,
            data: job.data,
          });
        });
        worker.on('failed', (job: any, err: any) => {
          logger.error(`Job ${job?.id} in ${job?.queueName} failed`, {
            jobId: job?.id,
            queue: job?.queueName,
            error: err.message,
            stack: err.stack,
          });
        });
        worker.on('error', (err: any) => {
          logger.error(`Worker error:`, err);
        });
        worker.on('stalled', async (jobId: any) => {
          logger.warn(`Job ${jobId} stalled, attempting recovery`);
          // Stalled jobs are automatically retried by BullMQ
          // Just log for monitoring
        });
      });

      // Setup scheduled (cron) jobs
      setupScheduledJobs().catch((error) => {
        logger.error('Failed to setup scheduled jobs:', error);
      });

      // Recover pending job backups from database
      try {
        const { recoverPendingJobs, cleanupOldBackups } = await import('./services/job-backup-recovery');
        const recovered = await recoverPendingJobs();
        if (recovered > 0) {
          logger.info(`[Startup] Recovered ${recovered} jobs from backup`);
        }

        // Cleanup old completed backups (keep 7 days)
        const cleaned = await cleanupOldBackups(7);
        if (cleaned > 0) {
          logger.info(`[Startup] Cleaned up ${cleaned} old job backups`);
        }
      } catch (error) {
        logger.error('[Startup] Failed to recover job backups:', error);
      }
    }

    // Log startup
    logger.info('Workers started successfully', {
      enabled: workersEnabled,
      workers: workers.map((w) => w.name),
      concurrency: workersEnabled
        ? { assignment: 5, notification: 10, analytics: 3, cleanup: 2, payment: 5 }
        : {},
    });
  } catch (error: any) {
    logger.error('Failed to start workers:', error);
    // Don't exit - health check server should still be available
  }
}

start();
