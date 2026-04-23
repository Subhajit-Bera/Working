/**
 * In-memory rate limiter.
 * For production, use a Redis-backed solution (like in rateLimit.middleware.ts).
 */
export function rateLimit(maxCalls: number, windowMs: number) {
  const calls = new Map<string, number[]>();

  return (key: string): boolean => {
    const now = Date.now();
    const timestamps = calls.get(key) || [];

    // Remove timestamps outside the window
    const validTimestamps = timestamps.filter((t) => now - t < windowMs);

    if (validTimestamps.length >= maxCalls) {
      return false; // Rate limit exceeded
    }

    validTimestamps.push(now);
    calls.set(key, validTimestamps);
    return true;
  };
}