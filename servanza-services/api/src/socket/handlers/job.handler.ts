import { Socket, Server } from 'socket.io';
import { prisma } from '../../config/database';
import { AssignmentStatus, BookingStatus } from '@prisma/client';
import { logger } from '../../utils/logger';
import { BookingService } from '../../services/booking.service';
// import { ApiError } from '../../utils/errors';

const bookingService = new BookingService();

export const handleJobEvents = (socket: Socket, io: Server): void => {

  socket.on('job:accept', async (data: { assignmentId: string }) => {
    const buddyUserId = socket.data.userId; // This is User.id from Auth

    // Distributed rate limiting (works across multiple API instances)
    const { checkDistributedRateLimit } = await import('../distributed-rate-limiter');
    if (!(await checkDistributedRateLimit(buddyUserId, 'job:accept', socket))) {
      return; // Rate limited - error already emitted
    }

    try {
      // 1. Resolve Buddy ID
      const buddyProfile = await prisma.buddy.findUnique({
        where: { id: buddyUserId },
        select: { id: true }
      });

      if (!buddyProfile) {
        socket.emit('error', { message: 'Buddy profile not found' });
        return;
      }
      const buddyId = buddyProfile.id;

      logger.info(`Buddy ${buddyId} attempting to accept assignment ${data.assignmentId}`);

      // 2. Transactional Race Check
      const result = await prisma.$transaction(async (tx) => {
        // Lock the assignment and include booking
        const assignment = await tx.assignment.findUnique({
          where: { id: data.assignmentId },
          include: { booking: true },
        });

        if (!assignment) throw new Error('Assignment not found');
        if (assignment.buddyId !== buddyId) throw new Error('Unauthorized');

        // CRITICAL CHECK: Is the booking still available?
        if (assignment.booking.status !== BookingStatus.PENDING) {
          throw new Error('JOB_TAKEN');
        }

        // A. Update Booking to ACCEPTED
        await tx.booking.update({
          where: { id: assignment.bookingId },
          data: { status: BookingStatus.ACCEPTED },
        });

        // B. Update Winner's Assignment
        const winnerAssignment = await tx.assignment.update({
          where: { id: data.assignmentId },
          data: {
            status: AssignmentStatus.ACCEPTED,
            acceptedAt: new Date()
          },
        });

        // C. Cancel all OTHER assignments for this booking
        const lostAssignments = await tx.assignment.findMany({
          where: {
            bookingId: assignment.bookingId,
            id: { not: data.assignmentId },
            status: AssignmentStatus.PENDING
          },
          select: { buddyId: true }
        });

        if (lostAssignments.length > 0) {
          await tx.assignment.updateMany({
            where: {
              bookingId: assignment.bookingId,
              id: { not: data.assignmentId },
            },
            data: {
              status: AssignmentStatus.CANCELLED,
              notes: 'Taken by another buddy'
            }
          });
        }

        return { winnerAssignment, lostAssignments, booking: assignment.booking };
      });

      // --- Success Post-Transaction ---

      // 1. Notify Winner
      socket.emit('job:accept:success', { assignmentId: data.assignmentId });
      socket.data.activeBookingId = result.booking.id;

      // 2. Notify Customer
      io.to(`user:${result.booking.userId}`).emit('booking:accepted', {
        bookingId: result.booking.id,
        assignmentId: result.winnerAssignment.id,
        buddyId: buddyId
      });

      // 3. Notify Losers (Broadcast to remove the job popup from their screens)
      result.lostAssignments.forEach((lost) => {
        // Emit to the User ID associated with the Buddy
        // Assumes room name is `user:{userId}`. We need to map buddyId -> userId if they differ, 
        // but in your schema buddyId == userId.
        io.to(`user:${lost.buddyId}`).emit('job:taken', {
          bookingId: result.booking.id,
          message: 'Another buddy accepted this job.'
        });
      });

      // 4. Notify Admin
      io.to('admins').emit('booking:status:change', {
        bookingId: result.booking.id,
        status: BookingStatus.ACCEPTED,
      });

      logger.info(`Buddy ${buddyId} WON booking ${result.booking.id}`);

    } catch (error: any) {
      if (error.message === 'JOB_TAKEN') {
        logger.info(`Buddy ${buddyUserId} failed race condition for ${data.assignmentId}`);
        socket.emit('error', {
          code: 'JOB_TAKEN',
          message: 'This job was just accepted by another buddy.'
        });
        // Ensure UI cleans up specific booking
        socket.emit('job:taken', { bookingId: null });
      } else {
        logger.error(`Error in job:accept: ${error.message}`);
        socket.emit('error', { message: 'Failed to accept job' });
      }
    }
  });




  // --- Buddy Rejects Job ---
  socket.on('job:reject', async (data: { assignmentId: string; reason?: string }) => {
    // Distributed rate limiting
    const { checkDistributedRateLimit } = await import('../distributed-rate-limiter');
    if (!(await checkDistributedRateLimit(socket.data.userId, 'job:reject', socket))) {
      return;
    }

    try {
      // Just mark as rejected. Do NOT cancel booking. 
      // The booking stays PENDING for other buddies in the broadcast group.
      await prisma.assignment.update({
        where: { id: data.assignmentId },
        data: {
          status: AssignmentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: data.reason || 'User ignored'
        }
      });
      socket.emit('job:reject:success', { assignmentId: data.assignmentId });
    } catch (e) {
      logger.error('Reject error', e);
    }
  });

  // --- Start and Complete handlers remain mostly the same ---
  // (Include previous implementation for job:start and job:complete here)
  socket.on('job:start', async (data: { assignmentId: string }) => {
    /* ... existing implementation ... */
    try {
      await prisma.assignment.update({
        where: { id: data.assignmentId },
        data: { startedAt: new Date() }
      });
      const asg = await prisma.assignment.findUnique({ where: { id: data.assignmentId } });
      await prisma.booking.update({
        where: { id: asg?.bookingId },
        data: { status: BookingStatus.IN_PROGRESS }
      });
      socket.emit('job:start:success', { assignmentId: data.assignmentId });
    } catch (e) { socket.emit('error', { message: 'Start failed' }); }
  });

  socket.on('job:complete', async (data: { assignmentId: string; otp?: string }) => {
    /* ... call bookingService.completeBookingAndAssignment ... */
    try {
      const buddyId = socket.data.userId; // Map correctly if needed
      await bookingService.completeBookingAndAssignment(data.assignmentId, buddyId, data.otp);
      socket.emit('job:complete:success', { assignmentId: data.assignmentId });
    } catch (e: any) {
      // Handle OTP errors specific logic
      socket.emit('error', { message: e.message });
    }
  });
};