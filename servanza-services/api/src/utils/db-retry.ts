import { logger } from './logger';

/**
 * Database retry wrapper for resilience
 * Retries database operations on transient connection errors
 */
export async function withDbRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
): Promise<T> {
    const retryableCodes = [
        'P1001', // Connection refused
        'P1008', // Operations timed out
        'P1017', // Server closed connection
        'P2024', // Timed out fetching connection from pool
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            const isRetryable = retryableCodes.includes(error.code);
            const isLastAttempt = attempt >= maxRetries - 1;

            if (!isRetryable || isLastAttempt) {
                logger.error(`Database operation failed (attempt ${attempt + 1}/${maxRetries}):`, {
                    code: error.code,
                    message: error.message,
                    isRetryable,
                });
                throw error;
            }

            const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
            logger.warn(`Database error (${error.code}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('Max database retries exceeded');
}

/**
 * Wraps a database transaction with retry logic
 */
export async function withDbTransactionRetry<T>(
    prisma: any,
    operation: (tx: any) => Promise<T>,
    maxRetries = 3
): Promise<T> {
    return withDbRetry(() => prisma.$transaction(operation), maxRetries);
}
