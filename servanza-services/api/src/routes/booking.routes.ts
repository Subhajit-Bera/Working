import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware'; //authorize
import { validateRequest } from '../middleware/validation.middleware';
import {
  createBookingSchema,
  updateBookingSchema,
  cancelBookingSchema,
  reviewSchema,
} from '../validators/booking.validator';
// import { UserRole } from '@prisma/client';

const router = Router();
const bookingController = new BookingController();

// All routes require authentication
router.use(authenticate);

// Booking CRUD
router.post('/validate-cart', bookingController.validateCart);
router.post('/', validateRequest(createBookingSchema), bookingController.createBooking);
router.get('/', bookingController.getBookings);
router.get('/:id', bookingController.getBookingById);
router.put('/:id', validateRequest(updateBookingSchema), bookingController.updateBooking);
router.delete('/:id', bookingController.cancelBooking);

// Booking actions
router.post(
  '/:id/cancel',
  validateRequest(cancelBookingSchema),
  bookingController.cancelBookingWithReason
);
router.post('/:id/reschedule', bookingController.rescheduleBooking);

// Customer "Try Again" - re-broadcast booking to buddies
router.post('/:id/retry-broadcast', bookingController.retryBroadcast);

// OTP (resend for user)
// The 'verify-otp' route is removed, as verification is done by the Buddy.
router.post('/:id/resend-otp', bookingController.resendCompletionOTP);

// Reviews
router.post('/:id/review', validateRequest(reviewSchema), bookingController.addReview);
router.get('/:id/review', bookingController.getBookingReview);

// Booking status tracking
router.get('/:id/status', bookingController.getBookingStatus);
router.get('/:id/timeline', bookingController.getBookingTimeline);

// Get assigned buddy location
router.get('/:id/buddy-location', bookingController.getBuddyLocation);

export default router;