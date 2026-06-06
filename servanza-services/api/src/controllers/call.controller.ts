import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { cacheGet, cacheDel } from '../config/redis';
import { logger } from '../utils/logger';

export const getPendingCall = async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const userId = (req as any).user.id;

    const pendingCall = await cacheGet<any>(`call:pending:${callId}`);

    if (!pendingCall || pendingCall.receiverId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Pending call not found or expired',
      });
    }

    // Also fetch any ICE candidates the caller has already sent
    // (these may have been relayed via socket before the receiver's listener was active)
    const callerIceCandidates = await cacheGet<any[]>(`call:ice:${callId}`) || [];

    return res.status(200).json({
      success: true,
      data: {
        ...pendingCall,
        callerIceCandidates,
      },
    });
  } catch (error) {
    logger.error('Error fetching pending call:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const rejectCall = async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const userId = (req as any).user.id;

    const call = await prisma.callLog.findUnique({ where: { id: callId } });
    if (!call || call.receiverId !== userId) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    if (call.status === 'REJECTED' || call.status === 'ENDED' || call.status === 'MISSED') {
      return res.status(200).json({ success: true, message: 'Call already ended or rejected' });
    }

    if (call.status !== 'RINGING') {
      return res.status(400).json({ success: false, message: 'Call is not ringing' });
    }

    await prisma.callLog.update({
      where: { id: callId },
      data: { status: 'REJECTED', endedAt: new Date() },
    });

    await cacheDel(`call:pending:${callId}`);

    const { getIO } = await import('../socket/index');
    const io = getIO();
    if (io) {
      io.to(`user:${call.callerId}`).emit('call:rejected', { callId });
    }

    return res.status(200).json({ success: true, message: 'Call rejected' });
  } catch (error) {
    logger.error('Error rejecting call via REST:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const endCall = async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const userId = (req as any).user.id;

    const call = await prisma.callLog.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== userId && call.receiverId !== userId)) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    if (call.status === 'ENDED' || call.status === 'REJECTED' || call.status === 'MISSED') {
      return res.status(200).json({ success: true, message: 'Call already ended' });
    }

    let durationSecs: number | undefined;
    if (call.startedAt) {
      durationSecs = Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000);
    }

    await prisma.callLog.update({
      where: { id: callId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        durationSecs,
      },
    });

    await cacheDel(`call:pending:${callId}`);

    const { getIO } = await import('../socket/index');
    const io = getIO();
    if (io) {
      const recipientId = call.callerId === userId ? call.receiverId : call.callerId;
      io.to(`user:${recipientId}`).emit('call:ended', { callId, durationSecs });
    }

    // System message
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

    return res.status(200).json({ success: true, message: 'Call ended' });
  } catch (error) {
    logger.error('Error ending call via REST:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
