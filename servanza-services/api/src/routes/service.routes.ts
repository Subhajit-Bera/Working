import { Router } from 'express';
import multer from 'multer';
import { ServiceController } from '../controllers/service.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { createServiceSchema, updateServiceSchema } from '../validators/service.validator';
import { UserRole } from '@prisma/client';

const router = Router();
const serviceController = new ServiceController();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PNG, JPEG, JPG, WEBP'));
    }
  },
});

// Public routes - order matters! More specific routes first
router.get('/trending', serviceController.getTrendingServices);
router.get('/', serviceController.getServices);
router.get('/categories', serviceController.getCategories);
router.get('/categories/:slug', serviceController.getCategoryBySlug);

// Category management (Admin only) - MUST come before /:id routes
router.post(
  '/categories',
  authenticate,
  authorize(UserRole.ADMIN),
  serviceController.createCategory
);
router.post(
  '/categories/:id/icon',
  authenticate,
  authorize(UserRole.ADMIN),
  upload.single('icon'),
  serviceController.uploadCategoryIcon
);
router.put(
  '/categories/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  serviceController.updateCategory
);
router.delete(
  '/categories/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  serviceController.deleteCategory
);

// Service CRUD - more specific routes first
router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN),
  validateRequest(createServiceSchema),
  serviceController.createService
);

// Image upload MUST come before generic /:id routes
router.post(
  '/:id/image',
  authenticate,
  authorize(UserRole.ADMIN),
  upload.single('image'),
  serviceController.uploadServiceImage
);

router.post(
  '/:id/images',
  authenticate,
  authorize(UserRole.ADMIN),
  upload.array('images', 10), // Allow up to 10 images at once
  serviceController.uploadServiceImages
);

// Service reviews (public)
router.get('/:id/reviews', serviceController.getServiceReviews);

router.get('/:id/similar', serviceController.getSimilarServices);
router.get('/:id', serviceController.getServiceById);
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  validateRequest(updateServiceSchema),
  serviceController.updateService
);
router.delete('/:id', authenticate, authorize(UserRole.ADMIN), serviceController.deleteService);

export default router;
