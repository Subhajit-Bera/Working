/**
 * RBAC Middleware
 * Middleware for checking user permissions on routes
 */

import { Request, Response, NextFunction } from 'express';
import { Permission, hasPermission, hasAnyPermission, AdminRole } from '../config/permissions';
import { logger } from '../utils/logger';

/**
 * Middleware to require a specific permission
 * Usage: router.get('/users', requirePermission('users.view'), controller.getUsers)
 */
export const requirePermission = (permission: Permission) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const user = req.user;

        if (!user) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        // Only admin users can have specific permissions
        if (user.role !== 'ADMIN') {
            res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
            return;
        }

        const adminRole = user.adminRole as AdminRole | undefined;

        if (!hasPermission(adminRole, permission)) {
            logger.warn(`Permission denied: User ${user.id} (${adminRole}) tried to access ${permission}`);
            res.status(403).json({
                success: false,
                message: `Permission denied: ${permission}`
            });
            return;
        }

        next();
    };
};

/**
 * Middleware to require any of the specified permissions
 * Usage: router.get('/data', requireAnyPermission(['users.view', 'buddies.view']), controller.getData)
 */
export const requireAnyPermission = (permissions: Permission[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const user = req.user;

        if (!user) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        if (user.role !== 'ADMIN') {
            res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
            return;
        }

        const adminRole = user.adminRole as AdminRole | undefined;

        if (!hasAnyPermission(adminRole, permissions)) {
            logger.warn(`Permission denied: User ${user.id} (${adminRole}) lacks any of: ${permissions.join(', ')}`);
            res.status(403).json({
                success: false,
                message: `Permission denied. Required: one of ${permissions.join(', ')}`
            });
            return;
        }

        next();
    };
};

/**
 * Middleware to require admin role (any admin role is acceptable)
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
        return;
    }

    if (user.role !== 'ADMIN') {
        res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
        return;
    }

    next();
};

/**
 * Middleware to require super admin role specifically
 */
export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
        return;
    }

    if (user.role !== 'ADMIN' || user.adminRole !== 'SUPER_ADMIN') {
        res.status(403).json({
            success: false,
            message: 'Super Admin access required'
        });
        return;
    }

    next();
};

