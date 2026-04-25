import Redis from 'ioredis';
import { ConnectionOptions } from 'bullmq';
import { logger } from '../utils/logger';

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD, // Enable in production
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: null, // REQUIRED by BullMQ — numeric values crash workers on Redis blips
  enableReadyCheck: true,
  retryStrategy: (times: number) => {
    // Infinite retry with capped delay for self-healing
    // Workers will automatically reconnect when Redis comes back
    const delay = Math.min(times * 100, 30000); // Max 30s delay
    if (times % 10 === 0) {
      logger.warn(`Redis connection retry attempt ${times}, delay ${delay}ms`);
    }
    return delay;
  },
};

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  // password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: null, // Must match BullMQ requirement
  enableReadyCheck: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    logger.warn(`Retrying Redis connection (attempt ${times}, delay ${delay}ms)`);
    return delay;
  },
};

// Main Redis client for caching and rate limiting
export const redis = new Redis(redisConfig);

// Separate clients for pub/sub (Socket.IO)
export const redisPub = new Redis(redisConfig);
export const redisSub = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: any) => {
  logger.error('Redis error:', err);
});

redis.on('ready', () => {
  logger.info('Redis ready');
});

// Helper functions
export const cacheGet = async <T>(key: string): Promise<T | null> => {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error(`Cache get error for key ${key}:`, error);
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: any,
  ttlSeconds: number = 3600
): Promise<void> => {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.error(`Cache set error for key ${key}:`, error);
  }
};

export const cacheDel = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
  } catch (error) {
    logger.error(`Cache delete error for key ${key}:`, error);
  }
};

export const cacheDelPattern = async (pattern: string): Promise<void> => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    logger.error(`Cache delete pattern error for ${pattern}:`, error);
  }
};