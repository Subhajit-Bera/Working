import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { promotionController } from '../controllers/promotion.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Multer config for promotion images
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: PNG, JPEG, JPG, WEBP'));
        }
    },
});

// Inline admin guard
const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    return next();
};

// Public — any user can see active promotions
// Admin can pass ?all=true to see all (requires auth)
router.get('/', promotionController.getPromotions);

// Admin only — manage promotions
router.post('/', authenticate, adminOnly, promotionController.createPromotion);
router.put('/:id', authenticate, adminOnly, promotionController.updatePromotion);
router.delete('/:id', authenticate, adminOnly, promotionController.deletePromotion);

// Admin only — upload promotion image
router.post('/:id/image', authenticate, adminOnly, upload.single('image'), promotionController.uploadPromotionImage);

export default router;
