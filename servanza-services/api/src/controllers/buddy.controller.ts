import { Request, Response, NextFunction } from 'express'; // Use standard Request
import { BuddyService } from '../services/buddy.service';
import { GeoService } from '../services/geospatial.service';
import { ApiError } from '../utils/errors';
// import { removeUndefined } from '../utils/helpers';

const buddyService = new BuddyService();
const geoService = new GeoService();

export class BuddyController {
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const profile = await buddyService.getProfile(buddyId);
      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const updates = req.body;
      const profile = await buddyService.updateProfile(buddyId, updates);
      res.json({
        success: true,
        data: profile,
        message: 'Profile updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const availability = await buddyService.getAvailability(buddyId);
      res.json({
        success: true,
        data: availability,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { isAvailable, isOnline } = req.body;
      const result = await buddyService.updateAvailability(buddyId, {
        isAvailable,
        isOnline
      });
      res.json({
        success: true,
        data: result,
        message: 'Availability updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const schedule = await buddyService.getSchedule(buddyId);
      res.json({
        success: true,
        data: schedule,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const schedules = req.body.schedules;
      const result = await buddyService.updateSchedule(buddyId, schedules);
      res.json({
        success: true,
        data: result,
        message: 'Schedule updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { latitude, longitude } = req.body;
      if (!latitude || !longitude) {
        throw new ApiError(400, 'Latitude and longitude are required');
      }
      await geoService.updateBuddyLocation(buddyId, { latitude, longitude });
      res.json({
        success: true,
        message: 'Location updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { status, page = 1, limit = 10 } = req.query;
      const jobs = await buddyService.getJobs(buddyId, {
        status: status as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json({
        success: true,
        data: jobs,
      });
    } catch (error) {
      next(error);
    }
  }

  async getActiveJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const job = await buddyService.getActiveJob(buddyId);
      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      next(error);
    }
  }

  async getJobHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { page = 1, limit = 20 } = req.query;
      const history = await buddyService.getJobHistory(buddyId, {
        page: Number(page),
        limit: Number(limit),
      });
      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  async acceptJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      await buddyService.acceptJob(buddyId, assignmentId);
      res.json({
        success: true,
        message: 'Job accepted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async rejectJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      const { reason } = req.body;
      await buddyService.rejectJob(buddyId, assignmentId, reason);
      res.json({
        success: true,
        message: 'Job rejected',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get single job details for tracking screen
  async getJobDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      const job = await buddyService.getJobDetails(buddyId, assignmentId);
      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      next(error);
    }
  }

  // Start tracking - sets status to ON_WAY and notifies user
  async startTracking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      await buddyService.startTracking(buddyId, assignmentId);
      res.json({
        success: true,
        message: 'Tracking started. User notified.',
      });
    } catch (error) {
      next(error);
    }
  }

  async markArrived(req: Request, res: Response, next: NextFunction) {
    try {
      const { assignmentId } = req.params;
      const buddyId = req.user!.id; // Authenticated Buddy ID

      await buddyService.markArrived(buddyId, assignmentId);

      res.status(200).json({
        success: true,
        message: 'Status updated to Arrived',
      });
    } catch (error) {
      next(error);
    }
  }

  async startJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      await buddyService.startJob(buddyId, assignmentId);
      res.json({
        success: true,
        message: 'Job started',
      });
    } catch (error) {
      next(error);
    }
  }

  async completeJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      const { otp } = req.body;
      await buddyService.completeJob(buddyId, assignmentId, otp);
      res.json({
        success: true,
        message: 'Job completed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async sendCompletionOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      await buddyService.sendCompletionOTP(buddyId, assignmentId);
      res.json({
        success: true,
        message: 'OTP sent to customer successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyCompletionOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { assignmentId } = req.params;
      const { otp } = req.body;
      await buddyService.verifyCompletionOTP(buddyId, assignmentId, otp);
      res.json({
        success: true,
        message: 'Job completed and verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { startDate, endDate } = req.query;
      const earnings = await buddyService.getEarnings(buddyId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({
        success: true,
        data: earnings,
      });
    } catch (error) {
      next(error);
    }
  }

  async getEarningsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const summary = await buddyService.getEarningsSummary(buddyId);
      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  async getReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { page = 1, limit = 10 } = req.query;
      const reviews = await buddyService.getReviews(buddyId, {
        page: Number(page),
        limit: Number(limit),
      });
      res.json({
        success: true,
        data: reviews,
      });
    } catch (error) {
      next(error);
    }
  }

  async selectTrainingStartDate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { trainingStartDate } = req.body;
      if (!trainingStartDate) {
        throw new ApiError(400, 'Training start date is required');
      }
      await buddyService.selectTrainingStartDate(buddyId, new Date(trainingStartDate));
      res.json({
        success: true,
        message: 'Training start date selected successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getVerificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { BuddyVerificationService } = await import('../services/buddy-verification.service');
      const verificationService = new BuddyVerificationService();
      const status = await verificationService.getVerificationStatus(buddyId);
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }
}