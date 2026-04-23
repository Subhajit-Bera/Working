import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { JobBackupStatus } from '@prisma/client';

/**
 * Job Backup Service
 * Persists critical jobs to database for recovery when Redis is unavailable
 */

/**
 * Backup a job to database before adding to queue
 * This ensures the job can be recovered if Redis fails
 */
export async function backupJob(
    queueName: string,
    jobName: string,
    jobData: any,
    priority: number = 10
): Promise<string> {
    const backup = await prisma.jobBackup.create({
        data: {
            queueName,
            jobName,
            jobData: JSON.parse(JSON.stringify(jobData)), // Ensure plain JSON
            priority,
            status: JobBackupStatus.PENDING,
        },
    });

    logger.debug(`Job backed up: ${backup.id} (${queueName}/${jobName})`);
    return backup.id;
}

/**
 * Backup a job to database within an existing transaction
 * Use this when you need atomic writes (booking + job backup in same tx)
 * 
 * @param tx - Prisma transaction client
 */
export async function backupJobInTransaction(
    tx: any, // Prisma transaction client
    queueName: string,
    jobName: string,
    jobData: any,
    priority: number = 10
): Promise<string> {
    const backup = await tx.jobBackup.create({
        data: {
            queueName,
            jobName,
            jobData: JSON.parse(JSON.stringify(jobData)),
            priority,
            status: JobBackupStatus.PENDING,
        },
    });

    logger.debug(`Job backed up in tx: ${backup.id} (${queueName}/${jobName})`);
    return backup.id;
}

/**
 * Mark a backed-up job as completed
 */
export async function markJobCompleted(backupId: string): Promise<void> {
    await prisma.jobBackup.update({
        where: { id: backupId },
        data: {
            status: JobBackupStatus.COMPLETED,
            processedAt: new Date(),
        },
    });
}

/**
 * Mark a backed-up job as failed
 */
export async function markJobFailed(backupId: string, error: string): Promise<void> {
    await prisma.jobBackup.update({
        where: { id: backupId },
        data: {
            status: JobBackupStatus.FAILED,
            error,
            processedAt: new Date(),
        },
    });
}

/**
 * Get pending jobs for a queue (for recovery)
 */
export async function getPendingBackups(queueName: string): Promise<any[]> {
    return prisma.jobBackup.findMany({
        where: {
            queueName,
            status: JobBackupStatus.PENDING,
        },
        orderBy: [
            { priority: 'asc' },
            { createdAt: 'asc' },
        ],
    });
}

/**
 * Recover pending jobs and requeue them
 * Call this on worker startup
 */
export async function recoverPendingJobs(
    queueName: string,
    addToQueue: (jobData: any, priority: number) => Promise<void>
): Promise<number> {
    const pendingJobs = await getPendingBackups(queueName);
    let recovered = 0;

    for (const job of pendingJobs) {
        try {
            await addToQueue(job.jobData, job.priority);

            await prisma.jobBackup.update({
                where: { id: job.id },
                data: { status: JobBackupStatus.RECOVERED },
            });

            recovered++;
            logger.info(`Recovered job ${job.id} (${queueName}/${job.jobName})`);
        } catch (error) {
            logger.error(`Failed to recover job ${job.id}:`, error);
        }
    }

    if (recovered > 0) {
        logger.info(`[JobBackup] Recovered ${recovered} jobs for ${queueName}`);
    }

    return recovered;
}

/**
 * Cleanup old completed/failed backups
 * Call this periodically
 */
export async function cleanupOldBackups(daysToKeep: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.jobBackup.deleteMany({
        where: {
            status: { in: [JobBackupStatus.COMPLETED, JobBackupStatus.RECOVERED] },
            processedAt: { lt: cutoffDate },
        },
    });

    if (result.count > 0) {
        logger.info(`[JobBackup] Cleaned up ${result.count} old job backups`);
    }

    return result.count;
}
