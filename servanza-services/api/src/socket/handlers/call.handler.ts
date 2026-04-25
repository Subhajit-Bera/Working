import { Socket, Server } from 'socket.io';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { BookingStatus } from '@prisma/client';

// ─── Server-side type aliases for WebRTC signaling payloads ─────────
// These are opaque on the server — we just relay them between clients.
interface RTCSessionDescription { type: string; sdp: string; }
interface RTCIceCandidate { candidate: string; sdpMid?: string; sdpMLineIndex?: number; }

// CallStatus values (mirrors Prisma enum, defined inline so TS
// doesn't depend on the generated client being freshly cached)
const CallStatusEnum = {
  RINGING: 'RINGING' as const,
  CONNECTED: 'CONNECTED' as const,
  ENDED: 'ENDED' as const,
  MISSED: 'MISSED' as const,
  REJECTED: 'REJECTED' as const,
};

/**
 * ICE server configuration for WebRTC.
 * Google STUN (free) + Metered TURN (free tier, 50GB/month).
 */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Metered TURN — replace credentials with your Metered.ca free-tier keys
  // Sign up at https://www.metered.ca/turn-server and get your API key
  ...(process.env.METERED_TURN_URL
    ? [
        {
          urls: process.env.METERED_TURN_URL,
          username: process.env.METERED_TURN_USERNAME || '',
          credential: process.env.METERED_TURN_CREDENTIAL || '',
        },
      ]
    : []),
];

/**
 * Validate that the user can initiate/receive calls for this booking.
 */
const validateCallAccess = async (userId: string, bookingId: string) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      assignments: {
        where: { status: 'ACCEPTED' },
        select: {
          buddyId: true,
          buddy: {
            select: {
              user: { select: { id: true, name: true, profileImage: true } },
            },
          },
        },
        take: 1,
      },
      user: {
        select: { id: true, name: true, profileImage: true },
      },
    },
  });

  if (!booking) return null;

  const assignedBuddyId = booking.assignments[0]?.buddyId;
  const isCustomer = booking.userId === userId;
  const isBuddy = assignedBuddyId === userId;

  if (!isCustomer && !isBuddy) return null;

  // Calls only during active booking (not pending, not completed)
  const callAllowed: BookingStatus[] = [
    BookingStatus.ACCEPTED,
    BookingStatus.ON_WAY,
    BookingStatus.ARRIVED,
    BookingStatus.IN_PROGRESS,
  ];
  if (!callAllowed.includes(booking.status)) return null;

  return {
    booking,
    recipientId: isCustomer ? assignedBuddyId! : booking.userId,
    callerInfo: isCustomer ? booking.user : booking.assignments[0]?.buddy?.user,
    isCustomer,
  };
};

export const handleCallEvents = (socket: Socket, io: Server): void => {
  const userId = socket.data.userId;

  // ─── Initiate a call ──────────────────────────────────────────────
  socket.on(
    'call:initiate',
    async (data: { bookingId: string; offer: RTCSessionDescription }) => {
      try {
        const access = await validateCallAccess(userId, data.bookingId);
        if (!access) {
          socket.emit('error', { code: 'CALL_ACCESS_DENIED', message: 'Cannot call for this booking' });
          return;
        }

        // Check if there's already an active call for this booking
        const activeCall = await prisma.callLog.findFirst({
          where: {
            bookingId: data.bookingId,
            status: { in: [CallStatusEnum.RINGING, CallStatusEnum.CONNECTED] },
          },
        });

        if (activeCall) {
          socket.emit('error', { code: 'CALL_IN_PROGRESS', message: 'A call is already active for this booking' });
          return;
        }

        // Create call log
        const callLog = await prisma.callLog.create({
          data: {
            bookingId: data.bookingId,
            callerId: userId,
            receiverId: access.recipientId,
            type: 'VOICE',
            status: CallStatusEnum.RINGING,
          },
        });

        // Send call to recipient
        const { emitToUser } = await import('..');
        await emitToUser(access.recipientId, 'call:incoming', {
          callId: callLog.id,
          bookingId: data.bookingId,
          caller: access.callerInfo,
          offer: data.offer,
          iceServers: ICE_SERVERS,
        });

        // Confirm to caller
        socket.emit('call:initiated', {
          callId: callLog.id,
          iceServers: ICE_SERVERS,
        });

        // Auto-timeout: if not answered in 30s, mark as MISSED
        setTimeout(async () => {
          try {
            const call = await prisma.callLog.findUnique({ where: { id: callLog.id } });
            if (call && call.status === CallStatusEnum.RINGING) {
              await prisma.callLog.update({
                where: { id: callLog.id },
                data: { status: CallStatusEnum.MISSED, endedAt: new Date() },
              });
              io.to(`user:${userId}`).emit('call:missed', { callId: callLog.id });
              io.to(`user:${access.recipientId}`).emit('call:missed', { callId: callLog.id });
              logger.info(`[Call] Call ${callLog.id} missed (timeout)`);
            }
          } catch (e) {
            logger.error('[Call] Timeout cleanup error:', e);
          }
        }, 30000);

        logger.info(`[Call] ${userId} calling ${access.recipientId} for booking ${data.bookingId}`);
      } catch (error: any) {
        logger.error(`[Call] Error initiating call:`, error.message);
        socket.emit('error', { message: 'Failed to initiate call' });
      }
    }
  );

  // ─── Answer a call ────────────────────────────────────────────────
  socket.on(
    'call:answer',
    async (data: { callId: string; answer: RTCSessionDescription }) => {
      try {
        const call = await prisma.callLog.findUnique({ where: { id: data.callId } });
        if (!call || call.receiverId !== userId) {
          socket.emit('error', { message: 'Invalid call' });
          return;
        }

        if (call.status !== CallStatusEnum.RINGING) {
          socket.emit('error', { message: 'Call is no longer ringing' });
          return;
        }

        await prisma.callLog.update({
          where: { id: data.callId },
          data: { status: CallStatusEnum.CONNECTED, startedAt: new Date() },
        });

        // Send answer to caller
        io.to(`user:${call.callerId}`).emit('call:answered', {
          callId: data.callId,
          answer: data.answer,
        });

        logger.info(`[Call] Call ${data.callId} answered`);
      } catch (error: any) {
        logger.error(`[Call] Error answering call:`, error.message);
        socket.emit('error', { message: 'Failed to answer call' });
      }
    }
  );

  // ─── Relay ICE candidates ────────────────────────────────────────
  socket.on(
    'call:ice-candidate',
    async (data: { callId: string; candidate: RTCIceCandidate }) => {
      try {
        const call = await prisma.callLog.findUnique({ where: { id: data.callId } });
        if (!call) return;

        // Relay to the other party
        const recipientId = call.callerId === userId ? call.receiverId : call.callerId;
        io.to(`user:${recipientId}`).emit('call:ice-candidate', {
          callId: data.callId,
          candidate: data.candidate,
        });
      } catch (error: any) {
        logger.error(`[Call] ICE candidate relay error:`, error.message);
      }
    }
  );

  // ─── Reject a call ────────────────────────────────────────────────
  socket.on('call:reject', async (data: { callId: string }) => {
    try {
      const call = await prisma.callLog.findUnique({ where: { id: data.callId } });
      if (!call || call.receiverId !== userId) return;

      await prisma.callLog.update({
        where: { id: data.callId },
        data: { status: CallStatusEnum.REJECTED, endedAt: new Date() },
      });

      io.to(`user:${call.callerId}`).emit('call:rejected', { callId: data.callId });
      logger.info(`[Call] Call ${data.callId} rejected by ${userId}`);
    } catch (error: any) {
      logger.error(`[Call] Error rejecting call:`, error.message);
    }
  });

  // ─── End a call ───────────────────────────────────────────────────
  socket.on('call:end', async (data: { callId: string }) => {
    try {
      const call = await prisma.callLog.findUnique({ where: { id: data.callId } });
      if (!call) return;

      // Calculate duration if call was connected
      let durationSecs: number | undefined;
      if (call.startedAt) {
        durationSecs = Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000);
      }

      await prisma.callLog.update({
        where: { id: data.callId },
        data: {
          status: CallStatusEnum.ENDED,
          endedAt: new Date(),
          durationSecs,
        },
      });

      // Notify the other party
      const recipientId = call.callerId === userId ? call.receiverId : call.callerId;
      io.to(`user:${recipientId}`).emit('call:ended', {
        callId: data.callId,
        durationSecs,
      });

      // Insert a system message into chat
      await prisma.chatMessage.create({
        data: {
          bookingId: call.bookingId,
          senderId: userId,
          content: durationSecs
            ? `Voice call ended (${Math.floor(durationSecs / 60)}:${String(durationSecs % 60).padStart(2, '0')})`
            : 'Missed voice call',
          type: 'SYSTEM',
        },
      });

      logger.info(`[Call] Call ${data.callId} ended, duration: ${durationSecs}s`);
    } catch (error: any) {
      logger.error(`[Call] Error ending call:`, error.message);
    }
  });
};
