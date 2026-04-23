import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middleware/auth.middleware'; //authorize
import { validateRequest } from '../middleware/validation.middleware';
import { updateProfileSchema, addAddressSchema } from '../validators/user.validator';
// import { UserRole } from '@prisma/client';

const router = Router();
const userController = new UserController();
const reviewController = new ReviewController();

// All routes require authentication
router.use(authenticate);

// Profile management
router.get('/me', userController.getProfile);
router.put('/me', validateRequest(updateProfileSchema), userController.updateProfile);
router.delete('/me', userController.deleteAccount);

// Address management
router.get('/addresses', userController.getAddresses);
router.post('/addresses', validateRequest(addAddressSchema), userController.addAddress);
router.put('/addresses/:id', validateRequest(addAddressSchema), userController.updateAddress);
router.delete('/addresses/:id', userController.deleteAddress);
router.patch('/addresses/:id/default', userController.setDefaultAddress);

// Device tokens (for push notifications)
router.post('/device-token', userController.registerDeviceToken);
router.delete('/device-token', userController.unregisterDeviceToken);

// Notifications
router.get('/notifications', userController.getNotifications);
router.patch('/notifications/:id/read', userController.markNotificationRead);
router.patch('/notifications/read-all', userController.markAllNotificationsRead);

// Favorites / Wishlist
router.get('/favorites', userController.getFavorites);
router.post('/favorites', userController.addFavorite);
router.delete('/favorites/:serviceId', userController.removeFavorite);
router.get('/favorites/:serviceId/check', userController.checkFavorite);

// My reviews (alias for /reviews/my)
router.get('/reviews', reviewController.getMyReviews.bind(reviewController));

export default router;

