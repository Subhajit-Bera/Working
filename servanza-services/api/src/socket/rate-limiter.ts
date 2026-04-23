/**
 * Distributed Socket Rate Limiter
 * 
 * This file re-exports the distributed rate limiter for backwards compatibility.
 * The actual implementation uses Redis for distributed rate limiting with
 * in-memory fallback when Redis is unavailable.
 */

export { checkDistributedRateLimit as checkRateLimit } from './distributed-rate-limiter';
export { checkDistributedRateLimit, getRateLimitRemaining } from './distributed-rate-limiter';
