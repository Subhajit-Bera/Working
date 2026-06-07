import { Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { prisma } from '../../config/database';
import { SocketData } from '..'; // Import from socket/index.ts

export const handleConnection = async (socket: Socket): Promise<void> => {
  const { userId, role } = socket.data as SocketData;

  // Update user online status
  if (role === 'BUDDY') {
    try {
      await prisma.buddy.update({
        where: { id: userId },
        data: { isOnline: true },
      });
      logger.info(`Buddy ${userId} set to ONLINE`);
    } catch (error: any) {
      logger.error(`Failed to update buddy online status: ${error.message}`);
    }
  }

  // Deliver pending offline messages
  try {
    const pendingMessages = await prisma.offlineMessage.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingMessages.length > 0) {
      logger.info(`Delivering ${pendingMessages.length} offline messages to user ${userId}`);

      const supportsAck = socket.handshake.query.supportsAck === 'true';

      for (const msg of pendingMessages) {
        if (msg.event.startsWith('call:')) {
          // Delete stale call message
          await prisma.offlineMessage.delete({ where: { id: msg.id } }).catch(() => {});
          continue;
        }
        
        if (supportsAck) {
          // New explicit acknowledgement flow
          socket.timeout(10000).emit(msg.event, { ...(msg.data as Record<string, unknown>), offlineMsgId: msg.id }, async (err: any, ack: any) => {
            if (!err && ack?.success) {
              await prisma.offlineMessage.update({
                where: { id: msg.id },
                data: { isRead: true, readAt: new Date() }
              });
              logger.debug(`Offline message ${msg.id} acknowledged by ${userId}`);
            } else if (err) {
              logger.warn(`Offline message ${msg.id} unacknowledged by ${userId} (timeout)`);
            }
          });
        } else {
          // Legacy fire-and-forget flow
          socket.emit(msg.event, msg.data);
          
          await prisma.offlineMessage.update({
            where: { id: msg.id },
            data: { isRead: true, readAt: new Date() }
          });
        }
      }

      if (!supportsAck) {
        logger.info(`Marked ${pendingMessages.length} offline messages as read for user ${userId} (legacy)`);
      }
    }
  } catch (error: any) {
    logger.error(`Failed to deliver offline messages for ${userId}:`, error.message);
  }

  // Handle disconnect
  socket.on('disconnect', async () => {
    logger.info(`User disconnected: ${userId}`);

    if (role === 'BUDDY') {
      try {
        // Check if the buddy has other active sockets
        const sockets = await socket.in(`buddy:${userId}`).allSockets();
        if (sockets.size === 0) {
          await prisma.buddy.update({
            where: { id: userId },
            data: { isOnline: false, lastLocationTime: new Date() },
          });
          logger.info(`Buddy ${userId} set to OFFLINE`);
        } else {
          logger.info(`Buddy ${userId} still has ${sockets.size} connections open.`);
        }
      } catch (error: any) {
        logger.error(`Failed to update buddy offline status for ${userId}: ${error.message}`);
      }
    }
  });

  // Send welcome message with pending message count
  const pendingCount = await prisma.offlineMessage.count({
    where: { userId, isRead: false },
  }).catch(() => 0);

  socket.emit('connected', {
    message: 'Successfully connected to server',
    userId,
    role,
    pendingMessagesDelivered: pendingCount,
  });
};