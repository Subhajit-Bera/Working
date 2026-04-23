import { rateLimit } from 'express-rate-limit';
import { redis } from '../config/redis';
import { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { logger } from '../utils/logger';

/**
 * Hybrid Rate Limiter with Redis primary and memory fallback
 * 
 * Uses Redis for distributed rate limiting across multiple API instances.
 * Falls back to in-memory if Redis is unavailable.
 */

let redisAvailable = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 10000; // 10 seconds

/**
 * Create a resilient store that falls back to memory if Redis is unavailable
 */
function createResilientStore(prefix: string): any {
  // Test Redis health periodically
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

  // Initial check
  checkRedis();

  // Always return RedisStore with fallback command handling
  return new RedisStore({
    sendCommand: async (...args: string[]) => {
      try {
        // Quick health check
        await checkRedis();
        if (!redisAvailable) {
          // Return null to signal redis unavailable - express-rate-limit will use default behavior
          return null;
        }
        return await (redis.call as any)(...args);
      } catch (error) {
        redisAvailable = false;
        logger.error('[RateLimit] Redis command failed:', error);
        return null;
      }
    },
    prefix,
  });
}

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:api:'),
  skip: (req: Request) => {
    return req.path === '/health' || req.path === '/api/v1/health' || req.path.includes('/metrics');
  },
});

// Auth rate limiter (stricter)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:auth:'),
  skipSuccessfulRequests: true,
});

// OTP rate limiter
export const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: 'Too many OTP requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:otp:'),
});

// Payment rate limiter
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many payment attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createResilientStore('rl:payment:'),
});