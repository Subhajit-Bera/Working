import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { JobBackupStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

/**
 * Job Backup Recovery Service for Workers
 * Recovers pending jobs from database on worker startup
 */

// Queue reference for adding recovered jobs
let assignmentQueue: Queue | null = null;

try {
    assignmentQueue = new Queue('assignment-queue', { connection: redisConnection });
} catch (error) {
    logger.error('Failed to initialize assignment queue for recovery:', error);
}

/**
 * Recover pending jobs from database and requeue them
 * Called on worker startup
 */
export async function recoverPendingJobs(): Promise<number> {
    let recovered = 0;

    try {
        // Find all pending job backups
        const pendingJobs = await prisma.jobBackup.findMany({
            where: { status: JobBackupStatus.PENDING },
            orderBy: [
                { priority: 'asc' },
                { createdAt: 'asc' },
            ],
            take: 100, // Limit batch size
        });

        if (pendingJobs.length === 0) {
            return 0;
        }

        logger.info(`[JobRecovery] Found ${pendingJobs.length} pending jobs to recover`);

        for (const job of pendingJobs) {
            try {
                // Mark as processing to prevent duplicate recovery
                await prisma.jobBackup.update({
                    where: { id: job.id },
                    data: { status: JobBackupStatus.PROCESSING },
                });

                // Requeue based on queue name
                if (job.queueName === 'assignment-queue' && assignmentQueue) {
                    await assignmentQueue.add(job.jobName, job.jobData, {
                        priority: job.priority,
                        jobId: `recovered-${job.id}-${Date.now()}`,
                    });

                    // Mark as recovered
                    await prisma.jobBackup.update({
                        where: { id: job.id },
                        data: {
                            status: JobBackupStatus.RECOVERED,
                            processedAt: new Date(),
                        },
                    });

                    recovered++;
                    logger.info(`[JobRecovery] Recovered job ${job.id} (${job.queueName}/${job.jobName})`);
                } else {
                    // Unknown queue or queue unavailable
                    logger.warn(`[JobRecovery] Cannot recover job ${job.id} - queue ${job.queueName} unavailable`);

                    // Revert to pending for retry
                    await prisma.jobBackup.update({
                        where: { id: job.id },
                        data: { status: JobBackupStatus.PENDING },
                    });
                }
            } catch (error) {
                logger.error(`[JobRecovery] Failed to recover job ${job.id}:`, error);

                // Mark as failed if too many attempts
                const nextAttempts = job.attempts + 1;
                if (nextAttempts >= job.maxAttempts) {
                    await prisma.jobBackup.update({
                        where: { id: job.id },
                        data: {
                            status: JobBackupStatus.FAILED,
                            attempts: nextAttempts,
                            error: error instanceof Error ? error.message : 'Unknown error',
                            processedAt: new Date(),
                        },
                    });
                } else {
                    await prisma.jobBackup.update({
                        where: { id: job.id },
                        data: {
                            status: JobBackupStatus.PENDING,
                            attempts: nextAttempts,
                        },
                    });
                }
            }
        }
    } catch (error) {
        logger.error('[JobRecovery] Failed to query pending jobs:', error);
    }

    return recovered;
}

/**
 * Cleanup old completed/recovered job backups
 */
export async function cleanupOldBackups(daysToKeep: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    try {
        const result = await prisma.jobBackup.deleteMany({
            where: {
                status: { in: [JobBackupStatus.COMPLETED, JobBackupStatus.RECOVERED] },
                processedAt: { lt: cutoffDate },
            },
        });

        return result.count;
    } catch (error) {
        logger.error('[JobRecovery] Failed to cleanup old backups:', error);
        return 0;
    }
}
