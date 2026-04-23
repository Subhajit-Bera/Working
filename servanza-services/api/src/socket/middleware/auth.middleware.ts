import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { UserRole } from '@prisma/client';
import { SocketData } from '..'; // Import from socket/index.ts

export const verifySocketToken = async (socket: Socket, next: (err?: Error) => void) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication token missing'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string;
      role: UserRole;
      type: 'access';
    };
    
    if (decoded.type !== 'access') {
       return next(new Error('Invalid token type'));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return next(new Error('Invalid token or user not found'));
    }

    // Attach user data to socket
    const socketData: SocketData = {
      userId: user.id,
      role: user.role,
    };
    socket.data = socketData;

    // Join user-specific room
    socket.join(`user:${user.id}`);

    // Join role-specific room
    if (user.role === 'BUDDY') {
      socket.join(`buddy:${user.id}`);
      socket.join('buddies');
    } else if (user.role === 'ADMIN') {
      socket.join('admins');
    }

    logger.info(`Socket authenticated: User ${user.id}, Role ${user.role}`);

    next();
  } catch (error) {
    logger.error('Socket authentication error:', error);
    next(new Error('Authentication failed'));
  }
};
