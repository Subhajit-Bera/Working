import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as couponController from '../controllers/coupon.controller';

const router = Router();

// Public routes (require auth for customers)
router.post('/validate', authenticate, couponController.validateCoupon);
router.get('/available', authenticate, couponController.getAvailableCoupons);

// Admin routes
router.get('/', authenticate, couponController.getAllCoupons);
router.post('/', authenticate, couponController.createCoupon);
router.put('/:id', authenticate, couponController.updateCoupon);
router.delete('/:id', authenticate, couponController.deleteCoupon);

export default router;
