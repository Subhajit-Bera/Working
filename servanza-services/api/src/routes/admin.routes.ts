import { Router, Request, Response } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission, requireAnyPermission, requireSuperAdmin, requireAdmin } from '../middleware/rbac.middleware';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { addAssignmentJob } from '../queues/assignment.queue';

const router = Router();
const adminController = new AdminController();

// All routes require admin authentication
router.use(authenticate);
router.use(requireAdmin); // Base check: must have role=ADMIN

// ============================================
// Dashboard & Analytics
// ============================================
router.get('/dashboard', requireAnyPermission(['users.view', 'bookings.view', 'payments.view']), adminController.getDashboard);
router.get('/analytics', requireAnyPermission(['users.view', 'bookings.view', 'payments.view', 'reports.view']), adminController.getAnalytics);

// ============================================
// User/Customer Management
// ============================================
router.get('/users', requirePermission('users.view'), adminController.getUsers);
router.get('/users/:id', requirePermission('users.view'), adminController.getUserById);
router.put('/users/:id', requirePermission('users.edit'), adminController.updateUser);
router.delete('/users/:id', requirePermission('users.delete'), adminController.deleteUser);
router.patch('/users/:id/activate', requirePermission('users.edit'), adminController.activateUser);
router.patch('/users/:id/deactivate', requirePermission('users.edit'), adminController.deactivateUser);

// ============================================
// Buddy Management
// ============================================
router.get('/buddies', requirePermission('buddies.view'), adminController.getBuddies);
router.get('/buddies/:id', requirePermission('buddies.view'), adminController.getBuddyById);
router.patch('/buddies/:id/verify', requirePermission('buddies.verify'), adminController.verifyBuddy);
router.patch('/buddies/:id/reject', requirePermission('buddies.verify'), adminController.rejectBuddy);
router.post('/buddies/:id/verify-field', requirePermission('buddies.verify'), adminController.verifyField);
router.post('/buddies/:id/reject-field', requirePermission('buddies.verify'), adminController.rejectField);
router.put('/buddies/:id/training', requirePermission('buddies.edit'), adminController.updateTraining);
router.put('/buddies/:id/job-start-date', requirePermission('buddies.edit'), adminController.assignJobStartDate);
router.get('/buddies/locations', requirePermission('buddies.view'), adminController.getBuddyLocations);

// ============================================
// Booking Management
// ============================================
router.get('/bookings', requirePermission('bookings.view'), adminController.getBookings);
router.get('/bookings/:id', requirePermission('bookings.view'), adminController.getBookingById);
router.patch('/bookings/:id/status', requirePermission('bookings.edit'), adminController.updateBookingStatus);
router.post('/bookings/:id/assign', requirePermission('bookings.assign'), adminController.manuallyAssignBuddy);
router.post('/bookings/:id/reassign', requirePermission('bookings.assign'), adminController.reassignBuddy);

// ============================================
// Service Management
// ============================================
router.get('/services', requirePermission('services.view'), adminController.getServices);
router.post('/services', requirePermission('services.create'), adminController.createService);
router.put('/services/:id', requirePermission('services.edit'), adminController.updateService);
router.delete('/services/:id', requirePermission('services.delete'), adminController.deleteService);

// ============================================
// Payment Management
// ============================================
router.get('/payments', requirePermission('payments.view'), adminController.getPayments);
router.post('/payments/:id/refund', requirePermission('payments.refund'), adminController.processRefund);

// ============================================
// Transaction Management
// ============================================
router.get('/transactions', requirePermission('transactions.view'), adminController.getTransactions);
router.get('/transactions/:id', requirePermission('transactions.view'), adminController.getTransactionById);
router.post('/transactions/:id/refund', requirePermission('payments.refund'), adminController.processRefund);

// ============================================
// Reviews Management
// ============================================
router.get('/reviews', requirePermission('reviews.view'), adminController.getReviews);
router.get('/reviews/:id', requirePermission('reviews.view'), adminController.getReviewById);
router.delete('/reviews/:id', requirePermission('reviews.delete'), adminController.deleteReview);

// ============================================
// Configuration/Settings
// ============================================
router.get('/config', requirePermission('settings.view'), adminController.getConfig);
router.put('/config', requirePermission('settings.edit'), adminController.updateConfig);

// ============================================
// Live Tracking
// ============================================
router.get('/tracking/buddies', requirePermission('buddies.view'), adminController.getOnlineBuddies);

// ============================================
// Reports
// ============================================
router.get('/reports/revenue', requirePermission('reports.view'), adminController.getRevenueReport);
router.get('/reports/bookings', requirePermission('reports.view'), adminController.getBookingReport);
router.get('/reports/buddies', requirePermission('reports.view'), adminController.getBuddyReport);
router.get('/reports/export', requireAnyPermission(['reports.view', 'transactions.export']), adminController.exportReport);

// ============================================
// Audit Logs - Admin and above
// ============================================
router.get('/audit-logs', requirePermission('settings.view'), adminController.getAuditLogs);

// ============================================
// Notifications
// ============================================
router.get('/notifications', requireAdmin, adminController.getNotifications);
router.patch('/notifications/:id/read', requireAdmin, adminController.markNotificationRead);

// ============================================
// Manual QUEUED bookings activation (for testing/admin use)
// ============================================
router.post('/bookings/activate-queued', requirePermission('bookings.edit'), async (req: Request, res: Response) => {
    try {
        // Find all QUEUED bookings
        const queuedBookings = await prisma.booking.findMany({
            where: { status: BookingStatus.QUEUED },
            select: { id: true, isImmediate: true }
        });

        // Activate each one
        for (const booking of queuedBookings) {
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.PENDING,
                    retryCount: 0,
                    lastRetryAt: null
                }
            });
            // Queue for assignment
            const priority = booking.isImmediate ? 1 : 5;
            await addAssignmentJob(booking.id, priority);
        }

        res.json({
            success: true,
            message: `Activated ${queuedBookings.length} QUEUED bookings`,
            data: { activatedCount: queuedBookings.length }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Failed to activate QUEUED bookings',
            error: error.message
        });
    }
});

// ============================================
// Admin User Management - SUPER_ADMIN ONLY
// ============================================
router.get('/admins', requireSuperAdmin, adminController.getAdmins);
router.post('/admins', requireSuperAdmin, adminController.createAdmin);
router.put('/admins/:id', requireSuperAdmin, adminController.updateAdmin);
router.delete('/admins/:id', requireSuperAdmin, adminController.deleteAdmin);

// ============================================
// Role Permissions Management (Super Admin only)
// ============================================
router.get('/permissions/config', requireSuperAdmin, adminController.getPermissionsConfig);
router.get('/roles/permissions', requireSuperAdmin, adminController.getAllRolesPermissions);
router.put('/roles/:role/permissions', requireSuperAdmin, adminController.updateRolePermissions);
router.post('/roles/:role/reset', requireSuperAdmin, adminController.resetRolePermissions);
router.post('/permissions/initialize', requireSuperAdmin, adminController.initializeDefaultPermissions);

// ============================================
// Get current user's permissions
// ============================================
router.get('/permissions/me', (req: Request, res: Response) => {
    const { getPermissions, ROLE_DISPLAY_NAMES } = require('../config/permissions');
    const adminRole = (req as any).user?.adminRole;
    const permissions = getPermissions();

    res.json({
        success: true,
        data: {
            adminRole,
            roleName: adminRole ? ROLE_DISPLAY_NAMES[adminRole] : null,
            permissions: adminRole ? permissions[adminRole] : [],
        }
    });
});

export default router;

