import { logger } from '../utils/logger';
import { redis } from '../config/redis';

/**
 * Hybrid Rate Limiter - Redis primary with in-memory fallback
 * 
 * Uses Redis for distributed rate limiting across multiple API instances.
 * Falls back to in-memory limiting if Redis is unavailable.
 * 
 * Implements sliding window algorithm with Redis sorted sets.
 */

const RATE_LIMIT_PREFIX = 'ratelimit:socket:';

interface RateLimitConfig {
    maxRequests: number;
    windowSizeSeconds: number;
}

// Pre-configured limits for different event types
const EVENT_LIMITS: Record<string, RateLimitConfig> = {
    'job:accept': { maxRequests: 10, windowSizeSeconds: 60 },
    'job:reject': { maxRequests: 10, windowSizeSeconds: 60 },
    'job:start': { maxRequests: 10, windowSizeSeconds: 60 },
    'job:complete': { maxRequests: 5, windowSizeSeconds: 60 },
    'location:update': { maxRequests: 20, windowSizeSeconds: 60 },
    'default': { maxRequests: 100, windowSizeSeconds: 60 },
};

// ============ IN-MEMORY FALLBACK ============
interface MemoryRateLimitEntry {
    count: number;
    windowStart: number;
}

const memoryFallback = new Map<string, MemoryRateLimitEntry>();
let redisAvailable = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 10000; // Check Redis health every 10 seconds

// Cleanup old memory entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryFallback.entries()) {
        if (now - entry.windowStart > 120000) { // 2 minutes
            memoryFallback.delete(key);
        }
    }
}, 60000);

/**
 * In-memory rate limit check (fallback when Redis unavailable)
 */
function checkMemoryRateLimit(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const entry = memoryFallback.get(key);

    if (!entry || now - entry.windowStart >= config.windowSizeSeconds * 1000) {
        // New window
        memoryFallback.set(key, { count: 1, windowStart: now });
        return true;
    }

    if (entry.count >= config.maxRequests) {
        return false; // Rate limited
    }

    entry.count++;
    return true;
}

/**
 * Check if Redis is available (with caching to avoid hammering)
 */
async function isRedisAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - lastRedisCheck < REDIS_CHECK_INTERVAL) {
        return redisAvailable;
    }

    try {
        await redis.ping();
        redisAvailable = true;
    } catch {
        redisAvailable = false;
        logger.warn('[RateLimit] Redis unavailable, using memory fallback');
    }
    lastRedisCheck = now;
    return redisAvailable;
}

/**
 * Check if a request is allowed using Redis-based distributed rate limiting
 * Falls back to in-memory if Redis is unavailable.
 * 
 * @returns true if allowed, false if rate limited
 */
export async function checkDistributedRateLimit(
    userId: string,
    eventName: string,
    socket: any
): Promise<boolean> {
    const config = EVENT_LIMITS[eventName] || EVENT_LIMITS['default'];
    const key = `${RATE_LIMIT_PREFIX}${userId}:${eventName}`;
    const now = Date.now();
    const windowStart = now - (config.windowSizeSeconds * 1000);

    // Check Redis availability
    const useRedis = await isRedisAvailable();

    if (!useRedis) {
        // Use in-memory fallback
        const allowed = checkMemoryRateLimit(key, config);
        if (!allowed) {
            logger.warn(`[RateLimit:Memory] User ${userId} rate limited for ${eventName}`);
            socket.emit('error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down.',
                retryAfter: config.windowSizeSeconds,
            });
        }
        return allowed;
    }

    try {
        // Use Redis pipeline for atomic operations
        const pipeline = redis.pipeline();

        // Remove old entries outside the window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count current entries
        pipeline.zcard(key);

        const results = await pipeline.exec();

        if (!results) {
            return true; // Redis error - fail open
        }

        const currentCount = results[1]?.[1] as number || 0;

        if (currentCount >= config.maxRequests) {
            logger.warn(`[RateLimit:Redis] User ${userId} rate limited for ${eventName} (${currentCount}/${config.maxRequests})`);
            socket.emit('error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down.',
                retryAfter: config.windowSizeSeconds,
            });
            return false;
        }

        // Add new entry with current timestamp as score
        const addPipeline = redis.pipeline();
        addPipeline.zadd(key, now, `${now}`);
        addPipeline.expire(key, config.windowSizeSeconds + 1);
        await addPipeline.exec();

        return true;
    } catch (error) {
        // Redis error - mark as unavailable and use memory fallback
        redisAvailable = false;
        logger.error('[RateLimit] Redis error, switching to memory fallback:', error);

        const allowed = checkMemoryRateLimit(key, config);
        if (!allowed) {
            socket.emit('error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down.',
                retryAfter: config.windowSizeSeconds,
            });
        }
        return allowed;
    }
}

/**
 * Get remaining requests for a user/event combination
 */
export async function getRateLimitRemaining(
    userId: string,
    eventName: string
): Promise<number> {
    const config = EVENT_LIMITS[eventName] || EVENT_LIMITS['default'];
    const key = `${RATE_LIMIT_PREFIX}${userId}:${eventName}`;
    const windowStart = Date.now() - (config.windowSizeSeconds * 1000);

    try {
        await redis.zremrangebyscore(key, 0, windowStart);
        const count = await redis.zcard(key);
        return Math.max(0, config.maxRequests - count);
    } catch {
        return -1;
    }
}
