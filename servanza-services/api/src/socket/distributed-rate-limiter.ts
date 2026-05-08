import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import '../utils/rateLimit.lua'; // Ensure the Lua script is loaded

const RATE_LIMIT_PREFIX = 'rl:socket:';

interface RateLimitConfig {
    capacity: number;
    windowMs: number;
}

// Converted from maxRequests/windowSizeSeconds to Token Bucket capacity/windows
const EVENT_LIMITS: Record<string, RateLimitConfig> = {
    'job:accept': { capacity: 10, windowMs: 60 * 1000 },
    'job:reject': { capacity: 10, windowMs: 60 * 1000 },
    'job:start': { capacity: 10, windowMs: 60 * 1000 },
    'job:complete': { capacity: 5, windowMs: 60 * 1000 },
    'location:update': { capacity: 20, windowMs: 60 * 1000 },
    'buddy:location': { capacity: 60, windowMs: 60 * 1000 },
    'default': { capacity: 100, windowMs: 60 * 1000 },
};

// ============ IN-MEMORY FALLBACK ============
interface MemoryBucket {
    microTokens: number;
    lastUpdate: number;
}
const memoryFallback = new Map<string, MemoryBucket>();
let redisAvailable = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 10000; 

// Cleanup interval to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of memoryFallback.entries()) {
        if (now - bucket.lastUpdate > 120000) { 
            memoryFallback.delete(key);
        }
    }
}, 60000).unref();

function checkMemoryRateLimit(key: string, capacity: number, windowMs: number, now: number): boolean {
    const maxMicroTokens = capacity * 1000;
    const costMicroTokens = 1000; // Cost is 1 token

    let bucket = memoryFallback.get(key);
    if (!bucket) {
        bucket = { microTokens: maxMicroTokens, lastUpdate: now };
    }

    const timeDiff = Math.max(0, now - bucket.lastUpdate);
    const addedMicroTokens = Math.floor((timeDiff * capacity * 1000) / windowMs);
    
    bucket.microTokens = Math.min(maxMicroTokens, bucket.microTokens + addedMicroTokens);

    if (bucket.microTokens >= costMicroTokens) {
        bucket.microTokens -= costMicroTokens;
        bucket.lastUpdate = now;
        memoryFallback.set(key, bucket);
        return true;
    }
    
    return false;
}

async function isRedisAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - lastRedisCheck < REDIS_CHECK_INTERVAL) return redisAvailable;

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
 * Executes the Atomic Multi-Key Token Bucket Lua script
 */
export async function checkDistributedRateLimit(
    ipAddress: string, // <-- Added IP parameter
    userId: string,
    eventName: string,
    socket: any
): Promise<boolean> {
    const config = EVENT_LIMITS[eventName] || EVENT_LIMITS['default'];
    
    const ipKey = `${RATE_LIMIT_PREFIX}ip:${ipAddress}`;
    const userKey = `${RATE_LIMIT_PREFIX}user:${userId}:${eventName}`;
    const now = Date.now();

    const useRedis = await isRedisAvailable();

    if (!useRedis) {
        // Fallback checks user key only to simplify in-memory state during outage
        const allowed = checkMemoryRateLimit(userKey, config.capacity, config.windowMs, now);
        if (!allowed) {
            socket.emit('error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down.',
                retryAfter: Math.ceil(config.windowMs / 1000 / config.capacity),
            });
        }
        return allowed;
    }

    try {
        // Using the same Lua script defined in your config!
        // We give the IP slightly higher burst capacity to handle NAT routing
        const result = await redis.rateLimitBucket(
            ipKey,
            userKey,
            1, // cost
            config.capacity * 2, // IP Capacity (generous for NAT)
            config.windowMs,     // IP Window
            config.capacity,     // User Capacity (strict)
            config.windowMs,     // User Window
            now
        );

        const allowed = result[0] === 1;

        if (!allowed) {
            logger.warn(`[RateLimit:Redis] Blocked user ${userId} at IP ${ipAddress} for ${eventName}`);
            socket.emit('error', {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down.',
                retryAfter: Math.ceil(config.windowMs / 1000 / config.capacity),
            });
            return false;
        }

        return true;
    } catch (error) {
        redisAvailable = false;
        logger.error('[RateLimit] Redis Lua error, switching to memory fallback:', error);
        return checkMemoryRateLimit(userKey, config.capacity, config.windowMs, now);
    }
}
