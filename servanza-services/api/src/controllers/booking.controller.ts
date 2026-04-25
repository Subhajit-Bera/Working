import { Request, Response, NextFunction } from 'express'; // Use standard Request
import { BookingService } from '../services/booking.service';
import { OTPService } from '../services/otp.service';
import { ApiError } from '../utils/errors';
import { prisma } from '../config/database';
// import { AssignmentStatus, BookingStatus } from '@prisma/client';

const bookingService = new BookingService();
const otpService = new OTPService();

export class BookingController {
  async validateCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { items, total } = req.body;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, 'Cart is empty or invalid format');
      }

      // Fetch all services from DB
      const serviceIds = items.map((item: any) => item.serviceId);
      const services = await prisma.service.findMany({
        where: { id: { in: serviceIds } },
      });

      let calculatedSubtotal = 0;
      
      for (const item of items) {
        const dbService = services.find(s => s.id === item.serviceId);
        if (!dbService) {
          throw new ApiError(400, `Service ${item.serviceId} not found`);
        }
        if (!dbService.isActive) {
          throw new ApiError(400, `Service ${dbService.title} is currently unavailable`);
        }
        // Multiply by quantity if applicable (assuming item.quantity exists)
        calculatedSubtotal += dbService.basePrice * (item.quantity || 1);
      }

      // Re-calculate tax and total
      const taxAmount = calculatedSubtotal * 0.18;
      const calculatedTotal = calculatedSubtotal + taxAmount;

      // Allow small floating point variations (e.g., within 1 unit of currency)
      if (Math.abs(calculatedTotal - total) > 1) {
        throw new ApiError(400, 'Cart totals mismatch. Prices may have been updated.');
      }

      res.json({ success: true, message: 'Cart validated successfully', data: { calculatedTotal } });
    } catch (error) {
      next(error);
    }
  }

  async createBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const bookingData = req.body;
      const booking = await bookingService.createBooking(userId, bookingData);
      res.status(201).json({
        success: true,
        data: booking,
        message: 'Booking created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id; 
      const { status, page = 1, limit = 10 } = req.query;
      const bookings = await bookingService.getUserBookings(userId, {
        status: status as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json({
        success: true,
        data: bookings,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBookingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id; 
      const booking = await bookingService.getBookingById(id, userId);
      res.json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id; 
      const updates = req.body;
      const booking = await bookingService.updateBooking(id, userId, updates);
      res.json({
        success: true,
        data: booking,
        message: 'Booking updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id; 
      await bookingService.cancelBooking(id, userId);
      res.json({
        success: true,
        message: 'Booking cancelled successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelBookingWithReason(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user!.id; 
      await bookingService.cancelBookingWithReason(id, userId, reason);
      res.json({
        success: true,
        message: 'Booking cancelled successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async rescheduleBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { scheduledStart, scheduledEnd } = req.body;
      const userId = req.user!.id; 
      const booking = await bookingService.rescheduleBooking(id, userId, {
        scheduledStart: new Date(scheduledStart),
        scheduledEnd: new Date(scheduledEnd),
      });
      res.json({
        success: true,
        data: booking,
        message: 'Booking rescheduled successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async resendCompletionOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id; 
      const booking = await prisma.booking.findFirst({
        where: { id, userId },
        include: { user: { select: { phone: true } } },
      });
      if (!booking || !booking.user.phone) {
        throw new ApiError(404, 'Booking or user phone not found');
      }
      await otpService.resendOTP(id, booking.user.phone);
      res.json({
        success: true,
        message: 'OTP resent successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async addReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { rating, comment } = req.body;
      const userId = req.user!.id;
      const review = await bookingService.addReview(id, userId, { rating, comment });
      res.status(201).json({
        success: true,
        data: review,
        message: 'Review added successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getBookingReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const review = await bookingService.getBookingReview(id);
      res.json({
        success: true,
        data: review,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBookingStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const status = await bookingService.getBookingStatus(id);
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBookingTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const timeline = await bookingService.getBookingTimeline(id);
      res.json({
        success: true,
        data: timeline,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBuddyLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const location = await bookingService.getBuddyLocation(id, userId);
      res.json({
        success: true,
        data: location,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Customer "Try Again" - Re-broadcast booking to buddies
   * For immediate bookings where no buddy accepted initially
   */
  async retryBroadcast(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const result = await bookingService.retryBroadcast(id, userId);
      res.json({
        success: true,
        message: 'Booking re-broadcast to available buddies',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}