import { Socket, Server } from 'socket.io';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';


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

import { validateCommunicationAccess } from '../../services/communication-access.service';

export const handleCallEvents = (socket: Socket, io: Server): void => {
  const userId = socket.data.userId;

  // ─── Initiate a call ──────────────────────────────────────────────
  socket.on(
    'call:initiate',
    async (data: { bookingId: string; offer: RTCSessionDescription; clientCallId?: string }) => {
      try {
        const access = await validateCommunicationAccess(userId, data.bookingId, { channel: 'call' });
        if (!access) {
          socket.emit('error', { code: 'CALL_ACCESS_DENIED', message: 'Cannot call for this booking' });
          return;
        }

        // Clean up stale RINGING calls older than 35 seconds to prevent deadlock
        const thirtyFiveSecondsAgo = new Date(Date.now() - 35000);
        await prisma.callLog.updateMany({
          where: {
            bookingId: data.bookingId,
            status: CallStatusEnum.RINGING,
            createdAt: { lt: thirtyFiveSecondsAgo }
          },
          data: { status: CallStatusEnum.MISSED, endedAt: new Date() }
        });

        // Clean up stale CONNECTED calls older than 5 minutes (orphaned from crash/disconnect)
        const fiveMinutesAgo = new Date(Date.now() - 300000);
        await prisma.callLog.updateMany({
          where: {
            bookingId: data.bookingId,
            status: CallStatusEnum.CONNECTED,
            createdAt: { lt: fiveMinutesAgo }
          },
          data: { status: CallStatusEnum.ENDED, endedAt: new Date() }
        });


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

        const { cacheGet, cacheSet } = await import('../../config/redis');

        if (data.clientCallId) {
          const isCancelled = await cacheGet(`call:cancelled:${data.clientCallId}`);
          if (isCancelled) {
            socket.emit('call:cancelled', { clientCallId: data.clientCallId });
            return;
          }
        }

        // Create call log
        const callLog = await prisma.callLog.create({
          data: {
            bookingId: data.bookingId,
            callerId: userId,
            receiverId: access.recipientUserId,
            type: 'VOICE',
            status: CallStatusEnum.RINGING,
          },
        });

        if (data.clientCallId) {
          const isCancelled = await cacheGet(`call:cancelled:${data.clientCallId}`);
          if (isCancelled) {
            await prisma.callLog.update({
              where: { id: callLog.id },
              data: { status: CallStatusEnum.ENDED, endedAt: new Date() },
            });
            socket.emit('call:cancelled', { callId: callLog.id, clientCallId: data.clientCallId });
            return;
          }
        }

        // Store pending call in Redis with 35s TTL
        const initiatedAt = new Date().toISOString();
        const pendingCallData = {
          callId: callLog.id,
          bookingId: data.bookingId,
          callerId: userId,
          receiverId: access.recipientUserId,
          offer: data.offer,
          iceServers: ICE_SERVERS,
          initiatedAt
        };
        await cacheSet(`call:pending:${callLog.id}`, pendingCallData, 35);

        // Send call to recipient via socket (lightweight)
        const { emitToUser } = await import('..');
        await emitToUser(access.recipientUserId, 'call:incoming', {
          callId: callLog.id,
          bookingId: data.bookingId,
          caller: access.callerInfo,
          initiatedAt
        });

        // Send FCM push for background handling
        try {
          const { NotificationService } = await import('../../services/notification.service');
          const notifService = new NotificationService();
          await (notifService as any).sendRichPushNotification(access.recipientUserId, {
            title: 'Incoming Voice Call',
            body: `${access.callerInfo.name || 'Someone'} is calling you`,
            sound: 'ringtone',
            channelId: 'servanza_calls',
            data: {
              type: 'incoming-call',
              callId: callLog.id,
              bookingId: data.bookingId,
              caller: JSON.stringify(access.callerInfo),
              initiatedAt,
              channelId: 'servanza_calls'
            }
          });
        } catch (fcmError) {
          logger.error('[Call] FCM push failed:', fcmError);
        }

        // Confirm to caller
        socket.emit('call:initiated', {
          callId: callLog.id,
          clientCallId: data.clientCallId,
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
              const { cacheDel } = await import('../../config/redis');
              await cacheDel(`call:pending:${callLog.id}`);
              await cacheDel(`call:ice:${callLog.id}`);
              io.to(`user:${userId}`).emit('call:missed', { callId: callLog.id });
              io.to(`user:${access.recipientUserId}`).emit('call:missed', { callId: callLog.id });
              logger.info(`[Call] Call ${callLog.id} missed (timeout)`);
            }
          } catch (e) {
            logger.error('[Call] Timeout cleanup error:', e);
          }
        }, 30000);

        logger.info(`[Call] ${userId} calling ${access.recipientUserId} for booking ${data.bookingId}`);
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

        const { cacheDel } = await import('../../config/redis');
        await cacheDel(`call:pending:${data.callId}`);
        await cacheDel(`call:ice:${data.callId}`);

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
    async (data: { callId?: string; clientCallId?: string; candidate: RTCIceCandidate }) => {
      try {
        if (!data.callId && !data.clientCallId) return;

        let callId = data.callId;

        // Note: For full accuracy, if we only have clientCallId, we'd need a way to look up callId.
        // Usually the client buffers ICE candidates until it gets callId. If it sends clientCallId,
        // it means we should probably drop it if callId isn't known, since client will resend it 
        // once it gets callId (we implemented buffering).
        if (!callId) return;

        const call = await prisma.callLog.findUnique({ where: { id: callId } });
        if (!call) return;

        // Relay to the other party
        const recipientId = call.callerId === userId ? call.receiverId : call.callerId;
        io.to(`user:${recipientId}`).emit('call:ice-candidate', {
          callId: data.callId,
          candidate: data.candidate,
        });

        // If the call is still RINGING and these are the CALLER's candidates,
        // also store them in Redis so the receiver can fetch them alongside
        // the offer when answering (their socket listener might not be active yet).
        if (call.status === CallStatusEnum.RINGING && call.callerId === userId) {
          const { cacheGet, cacheSet } = await import('../../config/redis');
          const cacheKey = `call:ice:${data.callId}`;
          const existing = await cacheGet<RTCIceCandidate[]>(cacheKey) || [];
          existing.push(data.candidate);
          await cacheSet(cacheKey, existing, 60); // 60s TTL
        }
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

      const { cacheDel } = await import('../../config/redis');
      await cacheDel(`call:pending:${data.callId}`);
      await cacheDel(`call:ice:${data.callId}`);

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
      if (!call || call.status === CallStatusEnum.ENDED || call.status === CallStatusEnum.REJECTED || call.status === CallStatusEnum.MISSED) {
        // Idempotent: already ended
        return;
      }

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

      const { cacheDel } = await import('../../config/redis');
      await cacheDel(`call:pending:${data.callId}`);
      await cacheDel(`call:ice:${data.callId}`);

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

  // ─── Cancel a call before answer/initiation ───────────────────────
  socket.on('call:cancel', async (data: { clientCallId: string }) => {
    try {
      const { cacheSet } = await import('../../config/redis');
      await cacheSet(`call:cancelled:${data.clientCallId}`, '1', 60); // 1 min TTL
      logger.info(`[Call] Call cancelled early by client ${data.clientCallId}`);
    } catch (error: any) {
      logger.error(`[Call] Error cancelling call:`, error.message);
    }
  });
};
