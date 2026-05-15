import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';
import { BookingStatus } from '@prisma/client';

import { validateCommunicationAccess } from '../services/communication-access.service';

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

      const access = await validateCommunicationAccess(userId, bookingId);
      if (!access) throw new ApiError(403, 'Chat access denied or window has expired');

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

      const access = await validateCommunicationAccess(userId, bookingId);
      if (!access) throw new ApiError(403, 'Chat access denied or window has expired');

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
