import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

// Queue references for monitoring
let assignmentQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let dispatchQueue: Queue | null = null;
let cleanupQueue: Queue | null = null;

// Initialize queues for monitoring
try {
    assignmentQueue = new Queue('assignment-queue', { connection: redis });
    notificationQueue = new Queue('notification-queue', { connection: redis });
    dispatchQueue = new Queue('dispatch-queue', { connection: redis });
    cleanupQueue = new Queue('cleanup-queue', { connection: redis });
    logger.info('Queue metrics service initialized');
} catch (error) {
    logger.error('Failed to initialize queue metrics:', error);
}

interface QueueMetrics {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
}

interface AllQueueMetrics {
    timestamp: string;
    status: 'healthy' | 'degraded' | 'unavailable';
    queues: QueueMetrics[];
    summary: {
        totalWaiting: number;
        totalActive: number;
        totalFailed: number;
        healthWarnings: string[];
    };
}

/**
 * Get metrics for a single queue
 */
async function getQueueMetrics(queue: Queue | null, name: string): Promise<QueueMetrics> {
    if (!queue) {
        return {
            name,
            waiting: -1,
            active: -1,
            completed: -1,
            failed: -1,
            delayed: -1,
            paused: true,
        };
    }

    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
    ]);

    return {
        name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused,
    };
}

/**
 * Get metrics for all queues
 */
export async function getAllQueueMetrics(): Promise<AllQueueMetrics> {
    const timestamp = new Date().toISOString();
    const healthWarnings: string[] = [];

    try {
        const queues = await Promise.all([
            getQueueMetrics(assignmentQueue, 'assignment-queue'),
            getQueueMetrics(notificationQueue, 'notification-queue'),
            getQueueMetrics(dispatchQueue, 'dispatch-queue'),
            getQueueMetrics(cleanupQueue, 'cleanup-queue'),
        ]);

        // Calculate summary
        const totalWaiting = queues.reduce((sum, q) => sum + (q.waiting >= 0 ? q.waiting : 0), 0);
        const totalActive = queues.reduce((sum, q) => sum + (q.active >= 0 ? q.active : 0), 0);
        const totalFailed = queues.reduce((sum, q) => sum + (q.failed >= 0 ? q.failed : 0), 0);

        // Check for health issues
        for (const queue of queues) {
            if (queue.waiting < 0) {
                healthWarnings.push(`${queue.name}: unavailable`);
            } else if (queue.waiting > 100) {
                healthWarnings.push(`${queue.name}: high backlog (${queue.waiting} waiting)`);
            }
            if (queue.failed > 50) {
                healthWarnings.push(`${queue.name}: high failures (${queue.failed} failed)`);
            }
            if (queue.paused) {
                healthWarnings.push(`${queue.name}: paused`);
            }
        }

        const status = healthWarnings.length === 0 ? 'healthy' :
            healthWarnings.some(w => w.includes('unavailable')) ? 'unavailable' : 'degraded';

        return {
            timestamp,
            status,
            queues,
            summary: {
                totalWaiting,
                totalActive,
                totalFailed,
                healthWarnings,
            },
        };
    } catch (error) {
        logger.error('Failed to get queue metrics:', error);
        return {
            timestamp,
            status: 'unavailable',
            queues: [],
            summary: {
                totalWaiting: 0,
                totalActive: 0,
                totalFailed: 0,
                healthWarnings: ['Failed to connect to queue system'],
            },
        };
    }
}

/**
 * Get failed jobs for a specific queue (for debugging)
 */
export async function getFailedJobs(queueName: string, start = 0, end = 10) {
    let queue: Queue | null = null;

    switch (queueName) {
        case 'assignment-queue': queue = assignmentQueue; break;
        case 'notification-queue': queue = notificationQueue; break;
        case 'dispatch-queue': queue = dispatchQueue; break;
        case 'cleanup-queue': queue = cleanupQueue; break;
    }

    if (!queue) {
        return { error: 'Queue not found or unavailable' };
    }

    const failed = await queue.getFailed(start, end);
    return failed.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
    }));
}
