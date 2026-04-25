import { Socket, Server } from 'socket.io';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { BookingStatus } from '@prisma/client';

/**
 * Allowed booking statuses for chat access.
 * Chat is open from booking creation through 24h after completion.
 */
const CHAT_ALLOWED_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.QUEUED,
  BookingStatus.ASSIGNED,
  BookingStatus.ACCEPTED,
  BookingStatus.ON_WAY,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
];

const CHAT_POST_COMPLETION_HOURS = 24;

/**
 * Validate that the user has access to chat for a given booking.
 * Returns the booking with the accepted buddy's userId, or null if unauthorized.
 */
const validateChatAccess = async (userId: string, bookingId: string) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      completedAt: true,
      assignments: {
        where: { status: 'ACCEPTED' },
        select: { buddyId: true },
        take: 1,
      },
    },
  });

  if (!booking) return null;

  // Check if user is the customer or the assigned buddy
  const assignedBuddyId = booking.assignments[0]?.buddyId;
  const isCustomer = booking.userId === userId;
  const isBuddy = assignedBuddyId === userId;

  if (!isCustomer && !isBuddy) return null;

  // Check booking status
  if (!CHAT_ALLOWED_STATUSES.includes(booking.status)) return null;

  // If completed, check 24h window
  if (booking.status === BookingStatus.COMPLETED && booking.completedAt) {
    const hoursSinceCompletion =
      (Date.now() - new Date(booking.completedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCompletion > CHAT_POST_COMPLETION_HOURS) return null;
  }

  return {
    booking,
    recipientId: isCustomer ? assignedBuddyId : booking.userId,
    isCustomer,
  };
};

export const handleChatEvents = (socket: Socket, io: Server): void => {
  const userId = socket.data.userId;

  // ─── Join booking chat room ───────────────────────────────────────
  socket.on('chat:join', async (data: { bookingId: string }) => {
    try {
      const access = await validateChatAccess(userId, data.bookingId);
      if (!access) {
        socket.emit('error', { code: 'CHAT_ACCESS_DENIED', message: 'Not authorized for this chat' });
        return;
      }

      const roomName = `chat:${data.bookingId}`;
      socket.join(roomName);
      logger.info(`User ${userId} joined chat room ${roomName}`);

      socket.emit('chat:joined', { bookingId: data.bookingId });
    } catch (error: any) {
      logger.error(`[Chat] Error joining room:`, error.message);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });

  // ─── Send message ─────────────────────────────────────────────────
  socket.on('chat:send', async (data: { bookingId: string; content: string; type?: string }) => {
    try {
      if (!data.content?.trim()) {
        socket.emit('error', { message: 'Message content is required' });
        return;
      }

      const access = await validateChatAccess(userId, data.bookingId);
      if (!access) {
        socket.emit('error', { code: 'CHAT_ACCESS_DENIED', message: 'Chat not available' });
        return;
      }

      // Persist message
      const message = await prisma.chatMessage.create({
        data: {
          bookingId: data.bookingId,
          senderId: userId,
          content: data.content.trim(),
          type: (data.type as any) || 'TEXT',
        },
        include: {
          sender: {
            select: { id: true, name: true, profileImage: true, role: true },
          },
        },
      });

      const payload = {
        id: message.id,
        bookingId: message.bookingId,
        senderId: message.senderId,
        sender: message.sender,
        content: message.content,
        type: message.type,
        isRead: false,
        createdAt: message.createdAt.toISOString(),
      };

      // Emit to the chat room (both parties if they're in it)
      io.to(`chat:${data.bookingId}`).emit('chat:message', payload);

      // Also emit directly to recipient in case they haven't joined the room
      // (e.g., they're on a different screen but should see a badge)
      if (access.recipientId) {
        const { emitToUser } = await import('..');
        await emitToUser(access.recipientId, 'chat:new-message', {
          bookingId: data.bookingId,
          messageId: message.id,
          senderName: message.sender.name,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        });
      }

      logger.debug(`[Chat] Message sent in booking ${data.bookingId} by ${userId}`);
    } catch (error: any) {
      logger.error(`[Chat] Error sending message:`, error.message);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ─── Mark messages as read ────────────────────────────────────────
  socket.on('chat:read', async (data: { bookingId: string }) => {
    try {
      // Mark all unread messages from the OTHER person as read
      const result = await prisma.chatMessage.updateMany({
        where: {
          bookingId: data.bookingId,
          senderId: { not: userId }, // Only mark messages FROM the other person
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (result.count > 0) {
        // Notify the sender that their messages were read
        io.to(`chat:${data.bookingId}`).emit('chat:read-receipt', {
          bookingId: data.bookingId,
          readBy: userId,
          count: result.count,
        });
        logger.debug(`[Chat] ${result.count} messages marked read in booking ${data.bookingId}`);
      }
    } catch (error: any) {
      logger.error(`[Chat] Error marking read:`, error.message);
    }
  });

  // ─── Typing indicator (relay only, no persistence) ────────────────
  socket.on('chat:typing', (data: { bookingId: string; isTyping: boolean }) => {
    socket.to(`chat:${data.bookingId}`).emit('chat:typing', {
      bookingId: data.bookingId,
      userId,
      isTyping: data.isTyping,
    });
  });

  // ─── Leave chat room ──────────────────────────────────────────────
  socket.on('chat:leave', (data: { bookingId: string }) => {
    socket.leave(`chat:${data.bookingId}`);
    logger.debug(`User ${userId} left chat room chat:${data.bookingId}`);
  });
};
