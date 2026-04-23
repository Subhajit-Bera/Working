import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { createPaymentIntentSchema } from '../validators/payment.validator'; //confirmPaymentSchema

const router = Router();
const paymentController = new PaymentController();

// All routes require authentication
router.use(authenticate);

// Payment order creation (for prepaid bookings)
router.post(
  '/order',
  validateRequest(createPaymentIntentSchema),
  paymentController.createPaymentOrder
);

// Confirm payment (client-side confirmation)
router.post(
  '/confirm',
  //validator for Razorpay's response
  // validateRequest(confirmPaymentSchema), 
  paymentController.confirmPayment
);

// Get payment status
router.get('/booking/:bookingId', paymentController.getPaymentStatus);

// Payment history
router.get('/history', paymentController.getPaymentHistory);

// Refund request (user can request, admin approves)
router.post('/refund/:transactionId', paymentController.requestRefund);

export default router;