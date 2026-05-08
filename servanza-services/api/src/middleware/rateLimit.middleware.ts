import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import '../utils/rateLimit.lua'; // Ensure the Lua script is loaded

let redisAvailable = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 10000; // 10 seconds

const checkRedis = async () => {
  const now = Date.now();
  if (now - lastRedisCheck < REDIS_CHECK_INTERVAL) return redisAvailable;

  try {
    await redis.ping();
    if (!redisAvailable) {
      logger.info('[RateLimit] Redis recovered, switching back');
    }
    redisAvailable = true;
  } catch {
    if (redisAvailable) {
      logger.warn('[RateLimit] Redis unavailable, using memory fallback');
    }
    redisAvailable = false;
  }
  lastRedisCheck = now;
  return redisAvailable;
};

// --- In-Memory Fallback Implementation ---
interface MemoryBucket {
  microTokens: number;
  lastUpdate: number;
}
const memoryStore = new Map<string, MemoryBucket>();

// Cleanup interval to prevent memory leaks (runs every 5 minutes)
setInterval(() => {
  const now = Date.now();
  // Assume max window is 1 hour (3600000ms), safe to delete anything older
  for (const [key, bucket] of memoryStore.entries()) {
    if (now - bucket.lastUpdate > 3600000) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

const memoryTokenBucket = (
  key: string,
  capacity: number,
  windowMs: number,
  cost: number,
  now: number
): [boolean, number] => {
  const maxMicroTokens = capacity * 1000;
  const costMicroTokens = cost * 1000;

  let bucket = memoryStore.get(key);
  if (!bucket) {
    bucket = { microTokens: maxMicroTokens, lastUpdate: now };
  }

  const timeDiff = Math.max(0, now - bucket.lastUpdate);
  const addedMicroTokens = Math.floor((timeDiff * capacity * 1000) / windowMs);
  
  bucket.microTokens = Math.min(maxMicroTokens, bucket.microTokens + addedMicroTokens);

  if (bucket.microTokens >= costMicroTokens) {
    bucket.microTokens -= costMicroTokens;
    bucket.lastUpdate = now;
    memoryStore.set(key, bucket);
    return [true, Math.floor(bucket.microTokens / 1000)];
  } else {
    // Rejected, but we don't update lastUpdate so they keep earning tokens
    return [false, Math.floor(bucket.microTokens / 1000)];
  }
};
// ----------------------------------------

export interface RateLimitOptions {
  ipCapacity: number;
  ipWindowMs: number;
  userCapacity: number;
  userWindowMs: number;
  message?: string;
  skip?: (req: Request) => boolean;
  getSecondKey?: (req: Request) => string | undefined;
  cost?: (req: Request) => number;
}

export const createTokenBucketLimiter = (options: RateLimitOptions) => {
  const {
    ipCapacity,
    ipWindowMs,
    userCapacity,
    userWindowMs,
    message = 'Too many requests, please try again later.',
    skip,
    getSecondKey,
    cost = () => 1,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (skip && skip(req)) {
        return next();
      }

      const ipKey = `rl:ip:${req.ip || 'unknown'}`;
      
      // Determine second key
      let rawSecondKey = req.user?.id; // If authenticated
      if (!rawSecondKey && getSecondKey) {
        rawSecondKey = getSecondKey(req); // e.g., email or phone from body
      }

      let userKey = 'rl:user:unauthenticated';
      if (rawSecondKey) {
        // Hash PII for pre-auth routes
        const hash = crypto.createHash('sha256').update(rawSecondKey).digest('hex');
        userKey = `rl:user:${hash}`;
      }

      const requestCost = cost(req);
      const now = Date.now();
      
      let allowed = false;
      let remaining = 0;

      await checkRedis();

      if (redisAvailable) {
        // Use Redis Lua script
        // Note: The dummy 'rl:user:unauthenticated' key will use the userCapacity/userWindowMs.
        // To prevent it from restricting global unauthenticated traffic, we could pass infinite capacity, 
        // but it's simpler to pass high enough limits for the unauth key if needed, 
        // or just rely on IP limit if userKey is the dummy key. 
        // Let's pass a huge capacity for the dummy key so it never throttles.
        const effectiveUserCapacity = userKey === 'rl:user:unauthenticated' ? 9999999 : userCapacity;

        const result = await redis.rateLimitBucket(
          ipKey,
          userKey,
          requestCost,
          ipCapacity,
          ipWindowMs,
          effectiveUserCapacity,
          userWindowMs,
          now
        );
        
        allowed = result[0] === 1;
        remaining = result[1];
      } else {
        // Memory fallback
        const [ipAllowed, ipRemaining] = memoryTokenBucket(ipKey, ipCapacity, ipWindowMs, requestCost, now);
        
        let uAllowed = true;
        let uRemaining = ipRemaining;
        
        if (userKey !== 'rl:user:unauthenticated') {
          [uAllowed, uRemaining] = memoryTokenBucket(userKey, userCapacity, userWindowMs, requestCost, now);
        }

        allowed = ipAllowed && uAllowed;
        remaining = Math.min(ipRemaining, uRemaining);
      }

      res.setHeader('X-RateLimit-Limit', ipCapacity);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

      if (!allowed) {
        res.setHeader('Retry-After', Math.ceil(ipWindowMs / 1000));
        return res.status(429).json({
          status: 'error',
          message: message,
        });
      }

      next();
    } catch (error) {
      logger.error('[RateLimit] Middleware error:', error);
      // Fail open on unexpected errors
      next();
    }
  };
};

// General API rate limiter (500 per 15 min for IP, 300 for User)
export const apiLimiter = createTokenBucketLimiter({
  ipCapacity: 500,
  ipWindowMs: 15 * 60 * 1000,
  userCapacity: 300,
  userWindowMs: 15 * 60 * 1000,
  skip: (req: Request) => req.path === '/health' || req.path === '/api/v1/health' || req.path.includes('/metrics'),
});

// Auth rate limiter (10 per 15 min)
export const authLimiter = createTokenBucketLimiter({
  ipCapacity: 20,
  ipWindowMs: 15 * 60 * 1000,
  userCapacity: 10,
  userWindowMs: 15 * 60 * 1000,
  message: 'Too many login attempts, please try again later.',
  getSecondKey: (req: Request) => req.body.email || req.body.phone,
});

// OTP rate limiter (3 per minute)
export const otpLimiter = createTokenBucketLimiter({
  ipCapacity: 10,
  ipWindowMs: 60 * 1000,
  userCapacity: 3,
  userWindowMs: 60 * 1000,
  message: 'Too many OTP requests, please try again later.',
  getSecondKey: (req: Request) => req.body.phone,
});

// Payment rate limiter (10 per hour)
export const paymentLimiter = createTokenBucketLimiter({
  ipCapacity: 20,
  ipWindowMs: 60 * 60 * 1000,
  userCapacity: 10,
  userWindowMs: 60 * 60 * 1000,
  message: 'Too many payment attempts, please try again later.',
});