import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { CleanupJobData } from '../types';

export const cleanupProcessor = async (job: Job<CleanupJobData>) => {
  const cleanupType = job.name;

  logger.info(`Processing cleanup job: ${cleanupType}`);

  try {
    switch (cleanupType) {
      case 'expired-otps':
        await cleanupExpiredOTPs();
        break;

      case 'old-notifications':
        await cleanupOldNotifications();
        break;

      case 'old-location-events':
        await cleanupOldLocationEvents();
        break;

      case 'completed-jobs':
        await cleanupCompletedJobs();
        break;

      case 'audit-logs':
        await cleanupOldAuditLogs();
        break;

      case 'dlq-recovery':
        await processDLQRecovery();
        break;

      case 'job-backup-cleanup':
        await cleanupOldJobBackups();
        break;

      default:
        logger.warn(`Unknown cleanup job type: ${cleanupType}`);
    }

    return { success: true, type: cleanupType };
  } catch (error) {
    logger.error(`Cleanup job failed: ${cleanupType}`, error);
    throw error;
  }
};

// Cleanup expired OTPs
async function cleanupExpiredOTPs() {
  const result = await prisma.otpVerification.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isUsed: true, usedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // 1 day ago
      ],
    },
  });

  logger.info(`Cleaned up ${result.count} expired OTPs`);
}

// Cleanup old notifications
async function cleanupOldNotifications() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await prisma.notification.deleteMany({
    where: {
      isRead: true,
      readAt: { lt: thirtyDaysAgo },
    },
  });

  logger.info(`Cleaned up ${result.count} old read notifications`);
}

// Cleanup old location events
async function cleanupOldLocationEvents() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await prisma.locationEvent.deleteMany({
    where: {
      timestamp: { lt: sevenDaysAgo },
    },
  });

  logger.info(`Cleaned up ${result.count} old location events`);
}

// Cleanup old completed job data
async function cleanupCompletedJobs() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // This is a placeholder. In a real app, you would archive this data
  // to a separate table or cold storage, not update it in place.
  const result = await prisma.booking.updateMany({
    where: {
      status: 'COMPLETED',
      completedAt: { lt: sixMonthsAgo },
      metadata: {
        path: ['archived'],
        equals: Prisma.DbNull,
      },
    },
    data: {
      metadata: {
        archived: true,
        archivedAt: new Date(),
      },
    },
  });

  logger.info(`Archived ${result.count} old completed bookings`);
}

// Cleanup old audit logs
async function cleanupOldAuditLogs() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: ninetyDaysAgo },
      action: {
        notIn: ['BOOKING_CREATED', 'BOOKING_COMPLETED', 'PAYMENT_RECEIVED', 'USER_CREATED'],
      },
    },
  });

  logger.info(`Cleaned up ${result.count} old non-critical audit logs`);
}

// Process Dead Letter Queue - recover failed offline messages
async function processDLQRecovery() {
  try {
    const { processDLQ, getDLQSize } = await import('../services/dlq-recovery.service');
    const queueSize = await getDLQSize();

    if (queueSize > 0) {
      const processed = await processDLQ(50);
      logger.info(`[DLQ] Processed ${processed} of ${queueSize} messages`);
    }
  } catch (error) {
    logger.error('[DLQ] Failed to process DLQ:', error);
  }
}

// Cleanup old completed/recovered job backups
async function cleanupOldJobBackups() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await prisma.jobBackup.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'RECOVERED'] },
      processedAt: { lt: sevenDaysAgo },
    },
  });

  logger.info(`Cleaned up ${result.count} old job backups`);
}