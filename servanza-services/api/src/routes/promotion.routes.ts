import { Router, Request, Response, NextFunction } from 'express';
import { promotionController } from '../controllers/promotion.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Inline admin guard
const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    return next();
};

// Public — any user can see active promotions
router.get('/', promotionController.getPromotions);

// Admin only — manage promotions
router.post('/', authenticate, adminOnly, promotionController.createPromotion);
router.put('/:id', authenticate, adminOnly, promotionController.updatePromotion);
router.delete('/:id', authenticate, adminOnly, promotionController.deletePromotion);

export default router;
