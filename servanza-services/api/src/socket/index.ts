import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPub, redisSub } from '../config/redis';
import { logger } from '../utils/logger';
import { verifySocketToken } from './middleware/auth.middleware';
import { handleConnection } from './handlers/connection.handler';
import { handleLocationEvents } from './handlers/location.handler';
import { handleJobEvents } from './handlers/job.handler';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/database';

let io: Server;

export interface SocketData {
  userId: string;
  role: UserRole;
  activeBookingId?: string;
}

export const initSocketIO = (httpServer: HTTPServer): Server => {
  io = new Server<any, any, any, SocketData>(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGINS?.split(',') || '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Redis adapter for scaling across multiple instances
  io.adapter(createAdapter(redisPub, redisSub));

  // Authentication middleware
  io.use(verifySocketToken);

  // Connection handler
  io.on('connection', (socket: Socket) => {
    logger.info(`Client connected: ${socket.id}, User: ${socket.data.userId}`);

    handleConnection(socket);
    handleLocationEvents(socket, io);
    handleJobEvents(socket, io);

    socket.on('disconnect', (reason: any) => {
      logger.info(`Client disconnected: ${socket.id}, User: ${socket.data.userId}, Reason: ${reason}`);
    });

    socket.on('error', (error: any) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  logger.info('Socket.IO initialized with Redis adapter');

  // Start location update batching (10s interval to reduce DB writes)
  import('./location-batch.service').then(({ startLocationBatching }) => {
    startLocationBatching();
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

/**
 * Emit to specific user - with offline message persistence
 * If user is offline, message is stored in database for later delivery
 */
export const emitToUser = async (userId: string, event: string, data: any): Promise<void> => {
  if (!io) return;

  try {
    const sockets = await io.in(`user:${userId}`).allSockets();

    if (sockets.size > 0) {
      // User is online - emit immediately
      io.to(`user:${userId}`).emit(event, data);
      logger.debug(`Emitted ${event} to user ${userId} (online)`);
    } else {
      // User is offline - persist message for later
      await prisma.offlineMessage.create({
        data: {
          userId,
          event,
          data,
          isRead: false,
        },
      });
      logger.info(`User ${userId} offline, ${event} persisted to database`);
    }
  } catch (error) {
    // DB is down - use Redis Dead Letter Queue as fallback
    try {
      const { redis } = await import('../config/redis');
      await redis.rpush('dlq:offline_messages', JSON.stringify({
        userId,
        event,
        data: JSON.parse(JSON.stringify(data)), // Ensure serializable
        timestamp: Date.now(),
      }));
      logger.warn(`[DLQ] DB down, message queued in Redis for ${userId}`);
    } catch (redisError) {
      // Both DB and Redis down - message will be lost
      logger.error(`[CRITICAL] Both DB and Redis down, message lost for ${userId}`);
    }

    // Still emit - if user is online they'll get it
    io.to(`user:${userId}`).emit(event, data);
  }
};

/**
 * Emit to specific buddy - with offline message persistence
 */
export const emitToBuddy = async (buddyId: string, event: string, data: any): Promise<void> => {
  if (!io) return;

  try {
    const sockets = await io.in(`buddy:${buddyId}`).allSockets();

    if (sockets.size > 0) {
      io.to(`buddy:${buddyId}`).emit(event, data);
      logger.debug(`Emitted ${event} to buddy ${buddyId} (online)`);
    } else {
      // Buddy is offline - persist for later
      await prisma.offlineMessage.create({
        data: {
          userId: buddyId, // Buddy is also a user
          event,
          data,
          isRead: false,
        },
      });
      logger.info(`Buddy ${buddyId} offline, ${event} persisted to database`);
    }
  } catch (error) {
    // DB is down - use Redis Dead Letter Queue as fallback
    try {
      const { redis } = await import('../config/redis');
      await redis.rpush('dlq:offline_messages', JSON.stringify({
        userId: buddyId,
        event,
        data: JSON.parse(JSON.stringify(data)),
        timestamp: Date.now(),
      }));
      logger.warn(`[DLQ] DB down, message queued in Redis for buddy ${buddyId}`);
    } catch (redisError) {
      logger.error(`[CRITICAL] Both DB and Redis down, message lost for buddy ${buddyId}`);
    }

    io.to(`buddy:${buddyId}`).emit(event, data);
  }
};

// Emit to all admins
export const emitToAdmins = (event: string, data: any): void => {
  if (io) {
    io.to('admins').emit(event, data);
  }
};

// Broadcast to all connected clients
export const broadcast = (event: string, data: any): void => {
  if (io) {
    io.emit(event, data);
  }
};

/**
 * Get unread offline messages for a user
 * Call this when user connects to deliver pending messages
 */
export const getUnreadOfflineMessages = async (userId: string) => {
  return prisma.offlineMessage.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: 'asc' },
  });
};

/**
 * Mark offline messages as read
 */
export const markOfflineMessagesRead = async (messageIds: string[]) => {
  return prisma.offlineMessage.updateMany({
    where: { id: { in: messageIds } },
    data: { isRead: true, readAt: new Date() },
  });
};