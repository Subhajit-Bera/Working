import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';

export class ReviewController {
  /**
   * POST /reviews
   * Create a new review. Only allowed once per booking. Only for completed bookings.
   */
  async createReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const { bookingId, rating, comment } = req.body;

      if (!bookingId || !rating) {
        throw new ApiError(400, 'bookingId and rating are required');
      }
      if (rating < 1 || rating > 5) {
        throw new ApiError(400, 'Rating must be between 1 and 5');
      }

      // Verify the booking belongs to the user and is completed
      const booking = await prisma.booking.findFirst({
        where: { id: bookingId, userId },
        include: { assignments: { orderBy: { assignedAt: 'desc' }, take: 1 } },
      });

      if (!booking) {
        throw new ApiError(404, 'Booking not found');
      }
      if (booking.status !== 'COMPLETED') {
        throw new ApiError(400, 'You can only review a completed booking');
      }

      // Check if review already exists for this booking
      const existing = await prisma.review.findUnique({ where: { bookingId } });
      if (existing) {
        throw new ApiError(409, 'You have already reviewed this booking');
      }

      // Get buddyId from the latest completed assignment
      const buddyId = booking.assignments[0]?.buddyId;
      if (!buddyId) {
        throw new ApiError(400, 'No buddy assigned to this booking');
      }

      const review = await prisma.review.create({
        data: {
          bookingId,
          userId,
          serviceId: booking.serviceId,
          buddyId,
          rating,
          comment: comment?.trim() || null,
        },
        include: {
          user: { select: { id: true, name: true } },
          service: { select: { id: true, title: true } },
        },
      });

      // Update booking's service averageRating and totalReviews
      const aggr = await prisma.review.aggregate({
        where: { serviceId: booking.serviceId },
        _avg: { rating: true },
        _count: { id: true },
      });

      await prisma.service.update({
        where: { id: booking.serviceId },
        data: {
          averageRating: Math.round((aggr._avg.rating || 0) * 10) / 10,
          totalReviews: aggr._count.id,
        },
      });

      res.status(201).json({ success: true, data: review });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /reviews/:id
   * Edit own review (rating + comment).
   */
  async updateReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;
      const { rating, comment } = req.body;

      const review = await prisma.review.findFirst({ where: { id, userId } });
      if (!review) throw new ApiError(404, 'Review not found');

      if (rating !== undefined && (rating < 1 || rating > 5)) {
        throw new ApiError(400, 'Rating must be between 1 and 5');
      }

      const updated = await prisma.review.update({
        where: { id },
        data: {
          ...(rating !== undefined ? { rating } : {}),
          ...(comment !== undefined ? { comment: comment?.trim() || null } : {}),
        },
      });

      // Recalculate service averageRating
      const aggr = await prisma.review.aggregate({
        where: { serviceId: review.serviceId },
        _avg: { rating: true },
        _count: { id: true },
      });

      await prisma.service.update({
        where: { id: review.serviceId },
        data: {
          averageRating: Math.round((aggr._avg.rating || 0) * 10) / 10,
          totalReviews: aggr._count.id,
        },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /reviews/my
   * Get all reviews written by the logged-in user.
   */
  async getMyReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.id;

      const reviews = await prisma.review.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          service: { select: { id: true, title: true, imageUrl: true } },
        },
      });

      res.json({ success: true, data: reviews });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /reviews/check/:bookingId
   * Returns whether the user has already reviewed this booking.
   */
  async checkReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const { bookingId } = req.params;

      const review = await prisma.review.findFirst({ where: { bookingId, userId } });
      res.json({ success: true, data: { reviewed: !!review, review: review || null } });
    } catch (error) {
      next(error);
    }
  }
}
