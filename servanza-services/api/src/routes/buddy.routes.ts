import { Router } from 'express';
import { BuddyController } from '../controllers/buddy.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import {
  updateBuddyProfileSchema,
  updateAvailabilitySchema,
  updateScheduleSchema,
} from '../validators/buddy.validator';
import { UserRole } from '@prisma/client';

const router = Router();
const buddyController = new BuddyController();

// All routes require authentication
router.use(authenticate);

// Buddy profile (must be BUDDY role)
router.get('/profile', authorize(UserRole.BUDDY), buddyController.getProfile);
router.put(
  '/profile',
  authorize(UserRole.BUDDY),
  validateRequest(updateBuddyProfileSchema),
  buddyController.updateProfile
);

// Availability management
router.get('/availability', authorize(UserRole.BUDDY), buddyController.getAvailability);
router.put(
  '/availability',
  authorize(UserRole.BUDDY),
  validateRequest(updateAvailabilitySchema),
  buddyController.updateAvailability
);

// Schedule management
router.get('/schedule', authorize(UserRole.BUDDY), buddyController.getSchedule);
router.post(
  '/schedule',
  authorize(UserRole.BUDDY),
  validateRequest(updateScheduleSchema),
  buddyController.updateSchedule
);

// Location updates
router.post('/location', authorize(UserRole.BUDDY), buddyController.updateLocation);

// Job/Assignment management
router.get('/jobs', authorize(UserRole.BUDDY), buddyController.getJobs);
router.get('/jobs/active', authorize(UserRole.BUDDY), buddyController.getActiveJob);
router.get('/jobs/history', authorize(UserRole.BUDDY), buddyController.getJobHistory);
router.post('/jobs/:assignmentId/accept', authorize(UserRole.BUDDY), buddyController.acceptJob);
router.post('/jobs/:assignmentId/reject', authorize(UserRole.BUDDY), buddyController.rejectJob);
router.get('/jobs/:assignmentId', authorize(UserRole.BUDDY), buddyController.getJobDetails);
router.post('/jobs/:assignmentId/start-tracking', authorize(UserRole.BUDDY), buddyController.startTracking);
router.post('/jobs/:assignmentId/arrived', authorize(UserRole.BUDDY), buddyController.markArrived);
router.post('/jobs/:assignmentId/start', authorize(UserRole.BUDDY), buddyController.startJob);
router.post('/jobs/:assignmentId/complete', authorize(UserRole.BUDDY), buddyController.completeJob);
router.post('/jobs/:assignmentId/send-otp', authorize(UserRole.BUDDY), buddyController.sendCompletionOTP);
router.post('/jobs/:assignmentId/verify-otp', authorize(UserRole.BUDDY), buddyController.verifyCompletionOTP);

// Earnings
router.get('/earnings', authorize(UserRole.BUDDY), buddyController.getEarnings);
router.get('/earnings/summary', authorize(UserRole.BUDDY), buddyController.getEarningsSummary);

// Reviews
router.get('/reviews', authorize(UserRole.BUDDY), buddyController.getReviews);

// Verification status
router.get('/verification-status', authorize(UserRole.BUDDY), buddyController.getVerificationStatus);

// Training
router.post('/training/select-date', authorize(UserRole.BUDDY), buddyController.selectTrainingStartDate);

export default router;
