import { Router } from 'express';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const reviewController = new ReviewController();

// All routes require authentication
router.use(authenticate);

// Create a review for a completed booking
router.post('/', reviewController.createReview.bind(reviewController));

// Edit own review
router.put('/:id', reviewController.updateReview.bind(reviewController));

// Get all my reviews
router.get('/my', reviewController.getMyReviews.bind(reviewController));

// Check if user has reviewed a booking
router.get('/check/:bookingId', reviewController.checkReview.bind(reviewController));

export default router;
