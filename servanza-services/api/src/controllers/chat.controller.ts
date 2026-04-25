import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';
import { BookingStatus } from '@prisma/client';

const CHAT_POST_COMPLETION_HOURS = 24;

/**
 * Validate that the requesting user can access chat for a booking.
 */
const ensureChatAccess = async (userId: string, bookingId: string) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
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

  if (!booking) throw new ApiError(404, 'Booking not found');

  const assignedBuddyId = booking.assignments[0]?.buddyId;
  const isCustomer = booking.userId === userId;
  const isBuddy = assignedBuddyId === userId;

  if (!isCustomer && !isBuddy) throw new ApiError(403, 'Not authorized for this chat');

  // If completed, check 24h window
  if (booking.status === BookingStatus.COMPLETED && booking.completedAt) {
    const hoursSince = (Date.now() - new Date(booking.completedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > CHAT_POST_COMPLETION_HOURS) {
      throw new ApiError(403, 'Chat window has expired');
    }
  }

  return { isCustomer, assignedBuddyId };
};

export class ChatController {
  /**
   * GET /bookings/:bookingId/messages
   * Returns paginated chat messages for a booking.
   */
  async getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = (req as any).user?.id;
      const { cursor, limit = '50' } = req.query;
      const take = Math.min(parseInt(limit as string) || 50, 100);

      await ensureChatAccess(userId, bookingId);

      const messages = await prisma.chatMessage.findMany({
        where: { bookingId },
        include: {
          sender: {
            select: { id: true, name: true, profileImage: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: take + 1, // Fetch one extra to determine if there are more
        ...(cursor
          ? {
              cursor: { id: cursor as string },
              skip: 1, // Skip the cursor itself
            }
          : {}),
      });

      const hasMore = messages.length > take;
      const results = hasMore ? messages.slice(0, take) : messages;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      res.json({
        success: true,
        data: {
          messages: results.reverse(), // Return in chronological order
          pagination: {
            nextCursor,
            hasMore,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /bookings/:bookingId/messages/unread-count
   * Returns the count of unread messages for the current user.
   */
  async getUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = (req as any).user?.id;

      await ensureChatAccess(userId, bookingId);

      const count = await prisma.chatMessage.count({
        where: {
          bookingId,
          senderId: { not: userId }, // Messages from the other person
          isRead: false,
        },
      });

      res.json({ success: true, data: { unreadCount: count } });
    } catch (error) {
      next(error);
    }
  }
}
