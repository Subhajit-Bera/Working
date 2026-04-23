import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';

/**
 * Dead Letter Queue Recovery Service
 * 
 * Processes offline messages that were pushed to Redis DLQ
 * when the database was unavailable.
 * 
 * Run this as a scheduled job (e.g., every 30 seconds)
 */

const DLQ_KEY = 'dlq:offline_messages';

/**
 * Process a batch of messages from the Dead Letter Queue
 * @returns Number of messages processed
 */
export async function processDLQ(batchSize: number = 50): Promise<number> {
    let processed = 0;


    try {
        // Process up to batchSize messages
        for (let i = 0; i < batchSize; i++) {
            const item = await redis.lpop(DLQ_KEY);

            if (!item) {
                break; // Queue is empty
            }

            try {
                const { userId, event, data, timestamp } = JSON.parse(item);

                // Check if message is too old (> 24 hours)
                const ageMs = Date.now() - timestamp;
                if (ageMs > 24 * 60 * 60 * 1000) {
                    logger.warn(`[DLQ] Dropping stale message for ${userId} (${Math.round(ageMs / 3600000)}h old)`);
                    continue;
                }

                // Try to persist to database
                await prisma.offlineMessage.create({
                    data: {
                        userId,
                        event,
                        data,
                        isRead: false,
                    },
                });

                processed++;
                logger.debug(`[DLQ] Recovered message for ${userId}: ${event}`);
            } catch (parseError) {
                logger.error('[DLQ] Failed to parse or persist message:', parseError);
                // Don't push back - malformed message
            }
        }

        if (processed > 0) {
            logger.info(`[DLQ] Recovered ${processed} offline messages from DLQ`);
        }
    } catch (error) {
        logger.error('[DLQ] Error processing DLQ:', error);
    }

    return processed;
}

/**
 * Get current DLQ size for monitoring
 */
export async function getDLQSize(): Promise<number> {
    try {
        return await redis.llen(DLQ_KEY);
    } catch {
        return -1;
    }
}
