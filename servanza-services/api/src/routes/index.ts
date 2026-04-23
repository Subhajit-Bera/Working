import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import buddyRoutes from './buddy.routes';
import bookingRoutes from './booking.routes';
import serviceRoutes from './service.routes';
import paymentRoutes from './payment.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';
import buddyDocumentsRoutes from './buddy-documents.routes';
import couponRoutes from './coupon.routes';
import promotionRoutes from './promotion.routes';
import reviewRoutes from './review.routes';


const router = Router();

// Public routes
router.use('/auth', authRoutes);
router.use('/services', serviceRoutes);
router.use('/promotions', promotionRoutes);

// Webhook routes (should not have auth)
router.use('/webhooks', webhookRoutes);

// Protected routes (will be handled by middleware in each file)
router.use('/users', userRoutes);
router.use('/buddies', buddyRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/admin', adminRoutes);
router.use('/buddy-documents', buddyDocumentsRoutes);
router.use('/coupons', couponRoutes);
router.use('/reviews', reviewRoutes);

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;