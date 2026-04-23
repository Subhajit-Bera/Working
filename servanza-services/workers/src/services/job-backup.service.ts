import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { JobBackupStatus } from '@prisma/client';

/**
 * Job Backup Service for Workers
 * Mirrors the API version for consistency
 */

/**
 * Backup a job to database before adding to queue
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
            jobData: JSON.parse(JSON.stringify(jobData)),
            priority,
            status: JobBackupStatus.PENDING,
        },
    });

    logger.debug(`[Worker] Job backed up: ${backup.id} (${queueName}/${jobName})`);
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
