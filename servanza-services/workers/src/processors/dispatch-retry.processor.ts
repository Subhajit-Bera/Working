import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { BookingStatus, AssignmentStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { addAssignmentJob } from '../config/queue';
import { emitToAdmins } from '../utils/socket-emitter';

// Configuration
const RETRY_INTERVAL_MINS = 5;       // Check every 5 minutes
const WORK_START_HOUR = 9;           // 9:00 AM IST
const WORK_END_HOUR = 19;            // 7:00 PM IST  
const WORK_END_MINUTE = 30;          // 7:30 PM IST
const CUTOFF_HOUR = 18;              // 6:00 PM IST cutoff hour
const CUTOFF_MINUTE = 30;            // 6:30 PM IST cutoff

interface DispatchRetryJobData {
    // Empty - runs on schedule
}

/**
 * Check if current time is within working hours (9 AM - 7:30 PM IST)
 * Assumes process.env.TZ = 'Asia/Kolkata' is set
 */
function isWithinWorkingHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (hour < WORK_START_HOUR) return false;
    if (hour > WORK_END_HOUR) return false;
    if (hour === WORK_END_HOUR && minute > WORK_END_MINUTE) return false;
    return true;
}

/**
 * Check if two dates are the same day
 */
function isSameDay(d1: Date, d2: Date): boolean {
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
}

/**
 * Calculate max retries based on scheduled date (compared to TODAY)
 * - Same day (scheduledStart = today): 3 retries
 * - Future (scheduledStart > today): 6 retries
 * 
 * This logic applies to:
 * - Bookings created during working hours (8 AM - 6:30 PM)
 * - Bookings activated at 9 AM after being QUEUED overnight
 */
function getMaxRetries(scheduledStart: Date): number {
    const today = new Date();

    // Same day = 3 retries
    if (isSameDay(scheduledStart, today)) return 3;

    // Future (> today) = 6 retries
    return 6;
}

/**
 * Dispatch Retry Processor
 * 
 * Runs every 5 minutes to find PENDING non-immediate bookings that haven't been accepted.
 * Re-broadcasts to buddies up to MAX_RETRIES times, then escalates to admin.
 * 
 * IMPORTANT: Only processes NON-IMMEDIATE bookings. Immediate bookings are handled separately.
 */
export const dispatchRetryProcessor = async (job: Job<DispatchRetryJobData>) => {
    logger.info('[DispatchRetry] Starting retry cycle...');

    // Check if within working hours (9 AM - 7:30 PM IST)
    if (!isWithinWorkingHours()) {
        logger.info('[DispatchRetry] Outside working hours, skipping retry cycle');
        return { success: true, processed: 0, reason: 'Outside working hours' };
    }

    try {
        const retryIntervalMs = RETRY_INTERVAL_MINS * 60 * 1000;
        const cutoffTime = new Date(Date.now() - retryIntervalMs);

        // Find PENDING non-immediate bookings older than retry interval
        const staleBookings = await prisma.booking.findMany({
            where: {
                status: BookingStatus.PENDING,
                isImmediate: false,  // Skip immediate bookings - they don't use dispatch/retry
                OR: [
                    // Never retried and old enough
                    { lastRetryAt: null, createdAt: { lt: cutoffTime } },
                    // Was retried but enough time has passed
                    { lastRetryAt: { lt: cutoffTime } }
                ]
            },
            include: {
                service: true,
                address: true,
            }
        });

        logger.info(`[DispatchRetry] Found ${staleBookings.length} stale non-immediate bookings to process`);

        let processed = 0;
        let escalated = 0;

        for (const booking of staleBookings) {
            // Calculate max retries based on scheduled date
            const maxRetries = getMaxRetries(new Date(booking.scheduledStart));

            // Check if already exceeded max retries
            if (booking.retryCount >= maxRetries) {
                logger.info(`[DispatchRetry] Booking ${booking.id} reached max retries (${maxRetries}), escalating`);
                await escalateToAdmin(booking, maxRetries);
                escalated++;
                continue;
            }

            const newRetryCount = booking.retryCount + 1;

            // Cancel old PENDING assignments (they didn't respond)
            await prisma.assignment.updateMany({
                where: {
                    bookingId: booking.id,
                    status: AssignmentStatus.PENDING
                },
                data: {
                    status: AssignmentStatus.CANCELLED,
                    cancelledAt: new Date()
                }
            });

            // Update booking retry tracking
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    retryCount: newRetryCount,
                    lastRetryAt: new Date()
                }
            });

            // Check if max retries now reached
            if (newRetryCount >= maxRetries) {
                logger.info(`[DispatchRetry] Booking ${booking.id} now reached max retries (${maxRetries}), escalating`);
                await escalateToAdmin(booking, maxRetries);
                escalated++;
            } else {
                // Re-queue for assignment broadcast
                logger.info(`[DispatchRetry] Re-broadcasting booking ${booking.id} (retry ${newRetryCount}/${maxRetries})`);
                await addAssignmentJob(booking.id, 5); // Priority 5 for scheduled bookings
                processed++;
            }
        }

        return { success: true, processed, escalated, total: staleBookings.length };

    } catch (error) {
        logger.error('[DispatchRetry] Error in retry processor:', error);
        throw error;
    }
};

/**
 * Escalate booking to admin when max retries exhausted
 */
async function escalateToAdmin(booking: any, maxRetries: number) {
    try {
        // Update booking status to ESCALATED
        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: BookingStatus.ESCALATED,
                escalatedAt: new Date()
            }
        });

        // Emit socket event to all admins
        emitToAdmins('booking:escalated', {
            bookingId: booking.id,
            serviceTitle: booking.service?.title,
            address: booking.address?.formattedAddress,
            scheduledStart: booking.scheduledStart,
            reason: `No buddy accepted after ${maxRetries} retry attempts`,
            retryCount: booking.retryCount,
            escalatedAt: new Date().toISOString(),
            isImmediate: booking.isImmediate
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                bookingId: booking.id,
                action: 'BOOKING_ESCALATED',
                entity: 'Booking',
                entityId: booking.id,
                changes: {
                    reason: 'Max retries exceeded',
                    retryCount: booking.retryCount,
                    maxRetries: maxRetries
                }
            }
        });

        logger.info(`[DispatchRetry] Booking ${booking.id} escalated to admin after ${maxRetries} retries`);

    } catch (error) {
        logger.error(`[DispatchRetry] Failed to escalate booking ${booking.id}:`, error);
    }
}

export default dispatchRetryProcessor;
