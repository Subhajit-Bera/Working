import { logger } from './logger';

/**
 * Circuit Breaker Pattern
 * Protects external services (FCM, SMS, Email) from cascading failures
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 */
export class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private successCount = 0;

    constructor(
        private serviceName: string,
        private threshold = 5,           // Failures before opening
        private resetTimeout = 60000,    // Time before trying again (1 min)
        private halfOpenSuccesses = 2    // Successes needed to close
    ) {
        logger.info(`Circuit breaker initialized for ${serviceName}`);
    }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
                logger.info(`[CircuitBreaker:${this.serviceName}] Transitioning to HALF_OPEN`);
            } else {
                const error = new Error(`Circuit breaker is OPEN for ${this.serviceName}`);
                (error as any).circuitBreakerOpen = true;
                throw error;
            }
        }

        try {
            const result = await operation();

            // Success - update state
            if (this.state === 'HALF_OPEN') {
                this.successCount++;
                if (this.successCount >= this.halfOpenSuccesses) {
                    this.state = 'CLOSED';
                    this.failures = 0;
                    logger.info(`[CircuitBreaker:${this.serviceName}] Service recovered, CLOSED`);
                }
            } else if (this.state === 'CLOSED') {
                // Reset failures on success
                this.failures = 0;
            }

            return result;
        } catch (error) {
            this.failures++;
            this.lastFailureTime = Date.now();

            if (this.state === 'HALF_OPEN') {
                // Failed during half-open, go back to open
                this.state = 'OPEN';
                logger.warn(`[CircuitBreaker:${this.serviceName}] Failed during HALF_OPEN, reopening`);
            } else if (this.failures >= this.threshold) {
                this.state = 'OPEN';
                logger.error(`[CircuitBreaker:${this.serviceName}] Threshold reached (${this.failures}), OPEN`);
            }

            throw error;
        }
    }

    getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        return this.state;
    }

    getStats() {
        return {
            service: this.serviceName,
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
        };
    }

    // Manually reset the circuit breaker
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successCount = 0;
        logger.info(`[CircuitBreaker:${this.serviceName}] Manually reset`);
    }
}

// Pre-configured circuit breakers for common external services
export const fcmCircuitBreaker = new CircuitBreaker('FCM', 5, 60000);
export const smsCircuitBreaker = new CircuitBreaker('SMS', 5, 60000);
export const emailCircuitBreaker = new CircuitBreaker('Email', 5, 60000);
