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

      if (!bookingId) {
        throw new ApiError(400, 'bookingId is required');
      }
      // At least one of rating or comment must be provided
      if (rating === undefined && (!comment || !comment.trim())) {
        throw new ApiError(400, 'Either a rating or a comment is required');
      }
      if (rating !== undefined && (rating < 1 || rating > 5)) {
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
          rating: rating ?? null,
          comment: comment?.trim() || null,
        },
        include: {
          user: { select: { id: true, name: true } },
          service: { select: { id: true, title: true } },
        },
      });

      // Update booking's service averageRating and totalReviews
      // Only include reviews with a rating in the average calculation
      const aggr = await prisma.review.aggregate({
        where: { serviceId: booking.serviceId, rating: { not: null } },
        _avg: { rating: true },
        _count: { id: true },
      });
      const totalReviews = await prisma.review.count({
        where: { serviceId: booking.serviceId },
      });

      await prisma.service.update({
        where: { id: booking.serviceId },
        data: {
          averageRating: Math.round((aggr._avg?.rating ?? 0) * 10) / 10,
          totalReviews,
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

      if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
        throw new ApiError(400, 'Rating must be between 1 and 5');
      }

      const updated = await prisma.review.update({
        where: { id },
        data: {
          ...(rating !== undefined ? { rating } : {}),
          ...(comment !== undefined ? { comment: comment?.trim() || null } : {}),
        },
      });

      // Recalculate service averageRating (only reviews with a rating)
      const aggr = await prisma.review.aggregate({
        where: { serviceId: review.serviceId, rating: { not: null } },
        _avg: { rating: true },
        _count: { id: true },
      });
      const totalReviews = await prisma.review.count({
        where: { serviceId: review.serviceId },
      });

      await prisma.service.update({
        where: { id: review.serviceId },
        data: {
          averageRating: Math.round((aggr._avg?.rating ?? 0) * 10) / 10,
          totalReviews,
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
