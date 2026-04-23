import { Request, Response, NextFunction } from 'express'; // Use standard Request
import { AdminService } from '../services/admin.service';
import { AssignmentService } from '../services/assignment.service';
import { PaymentService } from '../services/payment.service';
import { ApiError } from '../utils/errors';
import { BookingStatus } from '@prisma/client';

const adminService = new AdminService();
const assignmentService = new AssignmentService();
const paymentService = new PaymentService();

export class AdminController {
  async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dashboard = await adminService.getDashboardStats();
      res.json({ success: true, data: dashboard });
    } catch (error) {
      next(error);
    }
  }

  async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      const analytics = await adminService.getAnalytics({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  }

  async getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, search, role, sortBy, sortOrder } = req.query;
      const users = await adminService.getUsers({
        page: Number(page),
        limit: Number(limit),
        search: search as string,
        role: role as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string,
      });
      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = await adminService.getUserById(id);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const updates = req.body;
      const user = await adminService.updateUser(id, updates);
      res.json({ success: true, data: user, message: 'User updated' });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await adminService.deleteUser(id);
      res.json({ success: true, message: 'User deleted' });
    } catch (error) {
      next(error);
    }
  }

  async activateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await adminService.activateUser(id);
      res.json({ success: true, message: 'User activated' });
    } catch (error) {
      next(error);
    }
  }

  async deactivateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await adminService.deactivateUser(id);
      res.json({ success: true, message: 'User deactivated' });
    } catch (error) {
      next(error);
    }
  }

  async getBuddies(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, search, isVerified, isAvailable } = req.query;
      const buddies = await adminService.getBuddies({
        page: Number(page),
        limit: Number(limit),
        search: search as string,
        isVerified: isVerified ? isVerified === 'true' : undefined,
        isAvailable: isAvailable ? isAvailable === 'true' : undefined,
      });
      res.json({ success: true, data: buddies });
    } catch (error) {
      next(error);
    }
  }

  async getBuddyById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const buddy = await adminService.getBuddyById(id);
      res.json({ success: true, data: buddy });
    } catch (error) {
      next(error);
    }
  }

  async verifyBuddy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await adminService.verifyBuddy(id);
      res.json({ success: true, message: 'Buddy verified' });
    } catch (error) {
      next(error);
    }
  }

  async rejectBuddy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      if (!reason) throw new ApiError(400, 'Reason is required');
      await adminService.rejectBuddy(id, reason);
      res.json({ success: true, message: 'Buddy verification rejected' });
    } catch (error) {
      next(error);
    }
  }

  async verifyField(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { field, comment } = req.body;
      if (!field) throw new ApiError(400, 'Field is required');
      await adminService.verifyBuddyField(id, field, comment);
      res.json({ success: true, message: `Field ${field} verified` });
    } catch (error) {
      next(error);
    }
  }

  async rejectField(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { field, comment } = req.body;
      if (!field) throw new ApiError(400, 'Field is required');
      if (!comment) throw new ApiError(400, 'Comment is required when rejecting a field');
      await adminService.rejectBuddyField(id, field, comment);
      res.json({ success: true, message: `Field ${field} rejected` });
    } catch (error) {
      next(error);
    }
  }

  async updateTraining(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { trainingStartDate, trainingDaysTaken, isTrainingCompleted } = req.body;

      const updates: any = {};
      if (trainingStartDate) updates.trainingStartDate = new Date(trainingStartDate);
      if (trainingDaysTaken !== undefined) updates.trainingDaysTaken = Number(trainingDaysTaken);
      if (isTrainingCompleted !== undefined) updates.isTrainingCompleted = Boolean(isTrainingCompleted);

      await adminService.updateTraining(id, updates);
      res.json({ success: true, message: 'Training updated' });
    } catch (error) {
      next(error);
    }
  }

  async assignJobStartDate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { jobStartDate } = req.body;
      if (!jobStartDate) throw new ApiError(400, 'Job start date is required');
      await adminService.assignJobStartDate(id, new Date(jobStartDate));
      res.json({ success: true, message: 'Job start date assigned' });
    } catch (error) {
      next(error);
    }
  }

  async getBuddyLocations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const locations = await adminService.getBuddyLocations();
      res.json({ success: true, data: locations });
    } catch (error) {
      next(error);
    }
  }

  async getBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, status, startDate, endDate } = req.query;
      const bookings = await adminService.getBookings({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data: bookings });
    } catch (error) {
      next(error);
    }
  }

  async getBookingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const booking = await adminService.getBookingById(id);
      res.json({ success: true, data: booking });
    } catch (error) {
      next(error);
    }
  }

  async updateBookingStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !Object.values(BookingStatus).includes(status)) {
        throw new ApiError(400, 'Invalid status');
      }
      const booking = await adminService.updateBookingStatus(id, status);
      res.json({ success: true, data: booking, message: 'Status updated' });
    } catch (error) {
      next(error);
    }
  }

  async manuallyAssignBuddy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params; // bookingId
      const { buddyId } = req.body;
      if (!buddyId) throw new ApiError(400, 'buddyId is required');
      await assignmentService.adminOverrideAssignment(id, buddyId);
      res.json({ success: true, message: 'Buddy assigned successfully' });
    } catch (error) {
      next(error);
    }
  }

  async reassignBuddy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params; // bookingId
      await assignmentService.reassignBooking(id);
      res.json({ success: true, message: 'Booking reassignment triggered' });
    } catch (error) {
      next(error);
    }
  }

  async getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const services = await adminService.getServices();
      res.json({ success: true, data: services });
    } catch (error) {
      next(error);
    }
  }

  async createService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = await adminService.createService(req.body);
      res.status(201).json({ success: true, data: service, message: 'Service created' });
    } catch (error) {
      next(error);
    }
  }

  async updateService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const service = await adminService.updateService(id, req.body);
      res.json({ success: true, data: service, message: 'Service updated' });
    } catch (error) {
      next(error);
    }
  }

  async deleteService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await adminService.deleteService(id);
      res.json({ success: true, message: 'Service deleted' });
    } catch (error) {
      next(error);
    }
  }

  async getPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const payments = await adminService.getPayments({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
      });
      res.json({ success: true, data: payments });
    } catch (error) {
      next(error);
    }
  }

  async processRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params; // transactionId
      const { amount } = req.body;
      const refund = await paymentService.processRefund(id, amount);
      res.json({ success: true, data: refund, message: 'Refund processed' });
    } catch (error) {
      next(error);
    }
  }

  async getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = await adminService.getConfig();
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  async updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = await adminService.updateConfig(req.body);
      res.json({ success: true, data: config, message: 'Config updated' });
    } catch (error) {
      next(error);
    }
  }

  async getRevenueReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate, groupBy } = req.query;
      const report = await adminService.getRevenueReport({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        groupBy: groupBy as 'day' | 'week' | 'month' | undefined,
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }

  async getBookingReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      const report = await adminService.getBookingReport({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }

  async getBuddyReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      const report = await adminService.getBuddyReport({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }

  async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 50, action, userId } = req.query;
      const logs = await adminService.getAuditLogs({
        page: Number(page),
        limit: Number(limit),
        action: action as string,
        userId: userId as string,
      });
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  }

  async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, status, startDate, endDate } = req.query;
      const transactions = await adminService.getTransactions({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json({ success: true, data: transactions });
    } catch (error) {
      next(error);
    }
  }

  async getTransactionById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const transaction = await adminService.getTransactionById(id);
      res.json({ success: true, data: transaction });
    } catch (error) {
      next(error);
    }
  }

  async getReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, buddyId, rating } = req.query;
      const reviews = await adminService.getReviews({
        page: Number(page),
        limit: Number(limit),
        buddyId: buddyId as string,
        minRating: rating ? Number(rating) : undefined,
      });
      res.json({ success: true, data: reviews });
    } catch (error) {
      next(error);
    }
  }

  async getReviewById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const review = await adminService.getReviewById(id);
      res.json({ success: true, data: review });
    } catch (error) {
      next(error);
    }
  }

  async deleteReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const result = await adminService.deleteReview(id, reason);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getOnlineBuddies(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddies = await adminService.getAllOnlineBuddies();
      res.json({ success: true, data: buddies });
    } catch (error) {
      next(error);
    }
  }

  async exportReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { type, startDate, endDate } = req.query;
      const data = await adminService.exportReportData(
        type as 'transactions' | 'bookings' | 'buddies',
        {
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        }
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getAdmins(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, search } = req.query;
      const admins = await adminService.getAdmins({
        page: Number(page),
        limit: Number(limit),
        search: search as string,
      });
      res.json({ success: true, data: admins });
    } catch (error) {
      next(error);
    }
  }

  async createAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const admin = await adminService.createAdmin(req.body);
      res.status(201).json({ success: true, data: admin });
    } catch (error) {
      next(error);
    }
  }

  async updateAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const admin = await adminService.updateAdmin(id, req.body);
      res.json({ success: true, data: admin });
    } catch (error) {
      next(error);
    }
  }

  async deleteAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await adminService.deleteAdmin(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = 20, unreadOnly } = req.query;
      const result = await adminService.getAdminNotifications({
        page: Number(page),
        limit: Number(limit),
        unreadOnly: unreadOnly === 'true',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async markNotificationRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await adminService.markNotificationRead(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ============================================
  // DYNAMIC ROLE PERMISSIONS MANAGEMENT
  // ============================================

  async getPermissionsConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = await adminService.getPermissionsConfig();
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  async getAllRolesPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roles = await adminService.getAllRolesPermissions();
      res.json({ success: true, data: roles });
    } catch (error) {
      next(error);
    }
  }

  async updateRolePermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role } = req.params;
      const { permissions } = req.body;

      if (!permissions || !Array.isArray(permissions)) {
        throw new ApiError(400, 'Permissions array is required');
      }

      const adminUserId = req.user?.id || 'unknown';
      const result = await adminService.updateRolePermissions(role, permissions, adminUserId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async resetRolePermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role } = req.params;
      const adminUserId = req.user?.id || 'unknown';
      const result = await adminService.resetRolePermissions(role, adminUserId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async initializeDefaultPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.initializeDefaultPermissions();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}