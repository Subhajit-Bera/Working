import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '@prisma/client';
import * as couponController from '../controllers/coupon.controller';

const router = Router();

// Public routes (require auth for customers)
router.post('/validate', authenticate, couponController.validateCoupon);
router.get('/available', authenticate, couponController.getAvailableCoupons);

// Admin routes
router.get('/', authenticate, authorize(UserRole.ADMIN), couponController.getAllCoupons);
router.post('/', authenticate, authorize(UserRole.ADMIN), couponController.createCoupon);
router.put('/:id', authenticate, authorize(UserRole.ADMIN), couponController.updateCoupon);
router.delete('/:id', authenticate, authorize(UserRole.ADMIN), couponController.deleteCoupon);

export default router;
