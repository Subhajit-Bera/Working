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

      for (const msg of pendingMessages) {
        socket.emit(msg.event, msg.data);
      }

      // Mark messages as read
      await prisma.offlineMessage.updateMany({
        where: {
          id: { in: pendingMessages.map(m => m.id) },
        },
        data: { isRead: true, readAt: new Date() },
      });

      logger.info(`Marked ${pendingMessages.length} offline messages as read for user ${userId}`);
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