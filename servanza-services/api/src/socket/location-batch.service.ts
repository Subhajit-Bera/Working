import { GeoService } from '../services/geospatial.service';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';

/**
 * Redis-based Location Update Service
 * 
 * Stores location updates in Redis HSET and flushes to DB every 10 seconds.
 * 
 * Benefits over in-memory Map:
 * - No OOM crash risk (Redis manages memory separately)
 * - Crash-safe (data survives API restart)
 * - Distributed (works across multiple API instances)
 */

const LOCATION_BUFFER_KEY = 'buddy:locations:pending';
const geoService = new GeoService();
let batchInterval: NodeJS.Timeout | null = null;

/**
 * Queue a location update in Redis for batched processing
 */
export async function queueLocationUpdate(
    buddyId: string,
    latitude: number,
    longitude: number
): Promise<void> {
    try {
        // Store in Redis HSET - key is buddyId, value is JSON payload
        await redis.hset(LOCATION_BUFFER_KEY, buddyId, JSON.stringify({
            latitude,
            longitude,
            timestamp: Date.now(),
        }));
    } catch (error) {
        // Redis down - log but don't crash. Location will be lost but that's acceptable.
        logger.error(`[LocationBatch] Failed to queue location for ${buddyId}:`, error);
    }
}

/**
 * Flush all pending location updates from Redis to database
 */
async function flushLocationUpdates(): Promise<void> {
    try {
        // Get all pending locations from Redis
        const pending = await redis.hgetall(LOCATION_BUFFER_KEY);
        const buddyIds = Object.keys(pending);

        if (buddyIds.length === 0) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        // Process each buddy's location
        for (const buddyId of buddyIds) {
            try {
                const data = JSON.parse(pending[buddyId]);

                await geoService.updateBuddyLocation(buddyId, {
                    latitude: data.latitude,
                    longitude: data.longitude,
                });

                // Remove from Redis after successful write
                await redis.hdel(LOCATION_BUFFER_KEY, buddyId);
                successCount++;
            } catch (error) {
                errorCount++;
                logger.error(`[LocationBatch] Failed to flush location for ${buddyId}:`, error);
                // Don't remove from Redis - will retry on next flush
            }
        }

        if (successCount > 0 || errorCount > 0) {
            logger.debug(`[LocationBatch] Flushed ${successCount} locations, ${errorCount} errors`);
        }
    } catch (error) {
        logger.error('[LocationBatch] Failed to flush locations:', error);
    }
}

/**
 * Start the batch location update interval
 * Call this on server startup
 */
export function startLocationBatching(): void {
    if (batchInterval) {
        return; // Already running
    }

    batchInterval = setInterval(async () => {
        try {
            await flushLocationUpdates();
        } catch (error) {
            logger.error('[LocationBatch] Error in batch interval:', error);
        }
    }, 10000); // Flush every 10 seconds

    logger.info('[LocationBatch] Redis-based location batching started (10s interval)');
}

/**
 * Stop the batch location update interval
 * Call this on server shutdown
 */
export function stopLocationBatching(): void {
    if (batchInterval) {
        clearInterval(batchInterval);
        batchInterval = null;

        // Final flush on shutdown
        flushLocationUpdates().catch((err) => {
            logger.error('[LocationBatch] Error flushing on shutdown:', err);
        });

        logger.info('[LocationBatch] Location batching service stopped');
    }
}

/**
 * Get current buffer size (for monitoring)
 */
export async function getBufferSize(): Promise<number> {
    try {
        return await redis.hlen(LOCATION_BUFFER_KEY);
    } catch {
        return -1; // Redis error
    }
}
