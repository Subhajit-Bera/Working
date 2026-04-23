import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { BookingStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { addAssignmentJob } from '../config/queue';
import { emitToUser } from '../utils/socket-emitter';

interface QueuedActivationJobData {
    // Empty - runs on schedule at 9 AM IST
}

/**
 * Queued Activation Processor
 * 
 * Runs every day at 9 AM IST to activate bookings created outside service hours.
 * Changes status from QUEUED to PENDING and triggers assignment broadcast.
 */
export const queuedActivationProcessor = async (job: Job<QueuedActivationJobData>) => {
    logger.info('[QueuedActivation] Starting 9 AM activation...');

    try {
        // Find all QUEUED non-immediate bookings
        // Note: Immediate bookings should never be QUEUED (frontend blocks them after hours)
        const queuedBookings = await prisma.booking.findMany({
            where: {
                status: BookingStatus.QUEUED,
                isImmediate: false // Safety: only activate scheduled bookings
            },
            include: {
                service: true,
                user: true
            }
        });

        logger.info(`[QueuedActivation] Found ${queuedBookings.length} queued bookings to activate`);

        for (const booking of queuedBookings) {
            // Reset to PENDING with retryCount: 0
            // The dispatch-retry processor will calculate the correct maxRetries dynamically:
            // - 3 retries if scheduledStart is today or tomorrow
            // - 6 retries if scheduledStart is > tomorrow
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.PENDING,
                    retryCount: 0,
                    lastRetryAt: null
                }
            });

            // Queue for assignment (priority 5 for scheduled bookings)
            await addAssignmentJob(booking.id, 5);

            // Notify customer their booking is now active
            emitToUser(booking.userId, 'booking:activated', {
                bookingId: booking.id,
                serviceTitle: booking.service?.title,
                message: 'Your booking is now being processed!'
            });

            // Create audit log
            await prisma.auditLog.create({
                data: {
                    userId: booking.userId,
                    bookingId: booking.id,
                    action: 'BOOKING_ACTIVATED',
                    entity: 'Booking',
                    entityId: booking.id,
                    changes: {
                        previousStatus: 'QUEUED',
                        newStatus: 'PENDING',
                        activatedAt: new Date().toISOString()
                    }
                }
            });

            logger.info(`[QueuedActivation] Activated booking ${booking.id}`);
        }

        return { success: true, activated: queuedBookings.length };

    } catch (error) {
        logger.error('[QueuedActivation] Error in activation processor:', error);
        throw error;
    }
};

export default queuedActivationProcessor;
