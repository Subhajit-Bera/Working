/**
 * RBAC Permissions Configuration
 * Defines roles and their associated permissions for admin users
 */

export type Permission =
    // User permissions
    | 'users.view' | 'users.edit' | 'users.delete'
    // Buddy permissions
    | 'buddies.view' | 'buddies.edit' | 'buddies.delete' | 'buddies.verify' | 'buddies.assign'
    // Booking permissions
    | 'bookings.view' | 'bookings.edit' | 'bookings.cancel' | 'bookings.assign'
    // Service permissions
    | 'services.view' | 'services.create' | 'services.edit' | 'services.delete'
    // Review permissions
    | 'reviews.view' | 'reviews.delete'
    // Payment permissions
    | 'payments.view' | 'payments.refund'
    // Transaction permissions
    | 'transactions.view' | 'transactions.export'
    // Report permissions
    | 'reports.view' | 'reports.financial'
    // Settings permissions
    | 'settings.view' | 'settings.edit'
    // Admin management
    | 'admins.view' | 'admins.create' | 'admins.edit' | 'admins.delete'
    // Support
    | 'support.tickets'
    // Wildcard
    | '*';

export type AdminRole =
    | 'SUPER_ADMIN'
    | 'ADMIN'
    | 'OPERATIONS_MANAGER'
    | 'FINANCE_MANAGER'
    | 'SUPPORT_AGENT';

/**
 * All available permissions (excluding wildcard)
 */
export const ALL_PERMISSIONS: Permission[] = [
    'users.view', 'users.edit', 'users.delete',
    'buddies.view', 'buddies.edit', 'buddies.delete', 'buddies.verify', 'buddies.assign',
    'bookings.view', 'bookings.edit', 'bookings.cancel', 'bookings.assign',
    'services.view', 'services.create', 'services.edit', 'services.delete',
    'reviews.view', 'reviews.delete',
    'payments.view', 'payments.refund',
    'transactions.view', 'transactions.export',
    'reports.view', 'reports.financial',
    'settings.view', 'settings.edit',
    'admins.view', 'admins.create', 'admins.edit', 'admins.delete',
    'support.tickets',
];

/**
 * Permission categories for UI grouping
 */
export const PERMISSION_CATEGORIES: Record<string, { permissions: Permission[]; description: string }> = {
    'User Management': {
        permissions: ['users.view', 'users.edit', 'users.delete'],
        description: 'Manage customer accounts',
    },
    'Buddy Management': {
        permissions: ['buddies.view', 'buddies.edit', 'buddies.delete', 'buddies.verify', 'buddies.assign'],
        description: 'Manage buddy profiles and assignments',
    },
    'Booking Management': {
        permissions: ['bookings.view', 'bookings.edit', 'bookings.cancel', 'bookings.assign'],
        description: 'View and manage service bookings',
    },
    'Service Management': {
        permissions: ['services.view', 'services.create', 'services.edit', 'services.delete'],
        description: 'Manage service offerings',
    },
    'Reviews': {
        permissions: ['reviews.view', 'reviews.delete'],
        description: 'View and moderate customer reviews',
    },
    'Payments': {
        permissions: ['payments.view', 'payments.refund'],
        description: 'View payments and process refunds',
    },
    'Transactions': {
        permissions: ['transactions.view', 'transactions.export'],
        description: 'View and export transaction data',
    },
    'Reports': {
        permissions: ['reports.view', 'reports.financial'],
        description: 'Access analytics and financial reports',
    },
    'Settings': {
        permissions: ['settings.view', 'settings.edit'],
        description: 'View and modify system settings',
    },
    'Admin Management': {
        permissions: ['admins.view', 'admins.create', 'admins.edit', 'admins.delete'],
        description: 'Manage admin user accounts',
    },
    'Support': {
        permissions: ['support.tickets'],
        description: 'Access support tickets',
    },
};

/**
 * Permission display names
 */
export const PERMISSION_DISPLAY_NAMES: Record<Permission, string> = {
    'users.view': 'View Users',
    'users.edit': 'Edit Users',
    'users.delete': 'Delete Users',
    'buddies.view': 'View Buddies',
    'buddies.edit': 'Edit Buddies',
    'buddies.delete': 'Delete Buddies',
    'buddies.verify': 'Verify Buddies',
    'buddies.assign': 'Assign Buddies',
    'bookings.view': 'View Bookings',
    'bookings.edit': 'Edit Bookings',
    'bookings.cancel': 'Cancel Bookings',
    'bookings.assign': 'Assign Bookings',
    'services.view': 'View Services',
    'services.create': 'Create Services',
    'services.edit': 'Edit Services',
    'services.delete': 'Delete Services',
    'reviews.view': 'View Reviews',
    'reviews.delete': 'Delete Reviews',
    'payments.view': 'View Payments',
    'payments.refund': 'Process Refunds',
    'transactions.view': 'View Transactions',
    'transactions.export': 'Export Transactions',
    'reports.view': 'View Reports',
    'reports.financial': 'Financial Reports',
    'settings.view': 'View Settings',
    'settings.edit': 'Edit Settings',
    'admins.view': 'View Admins',
    'admins.create': 'Create Admins',
    'admins.edit': 'Edit Admins',
    'admins.delete': 'Delete Admins',
    'support.tickets': 'Support Tickets',
    '*': 'All Permissions',
};

/**
 * Default permissions matrix for each admin role (used for initialization)
 */
export const DEFAULT_PERMISSIONS: Record<AdminRole, Permission[]> = {
    SUPER_ADMIN: ['*'], // All permissions

    ADMIN: [
        'users.view', 'users.edit', 'users.delete',
        'buddies.view', 'buddies.edit', 'buddies.delete', 'buddies.verify',
        'bookings.view', 'bookings.edit', 'bookings.cancel',
        'services.view', 'services.create', 'services.edit', 'services.delete',
        'reviews.view', 'reviews.delete',
        'payments.view', 'reports.view',
    ],

    OPERATIONS_MANAGER: [
        'users.view', 'buddies.view', 'buddies.assign', 'buddies.verify',
        'bookings.view', 'bookings.edit', 'bookings.assign',
        'services.view', 'reviews.view', 'reports.view',
    ],

    FINANCE_MANAGER: [
        'payments.view', 'payments.refund',
        'transactions.view', 'transactions.export',
        'reports.view', 'reports.financial',
    ],

    SUPPORT_AGENT: [
        'users.view', 'buddies.view',
        'bookings.view', 'reviews.view',
        'support.tickets',
    ],
};

// Runtime permissions storage (loaded from database)
let runtimePermissions: Record<AdminRole, Permission[]> | null = null;
let permissionsCacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the current permissions matrix (runtime or default)
 */
export function getPermissions(): Record<AdminRole, Permission[]> {
    if (runtimePermissions && Date.now() - permissionsCacheTime < CACHE_TTL) {
        return runtimePermissions;
    }
    return DEFAULT_PERMISSIONS;
}

/**
 * Set runtime permissions (called after loading from database)
 */
export function setRuntimePermissions(permissions: Record<AdminRole, Permission[]>): void {
    runtimePermissions = permissions;
    permissionsCacheTime = Date.now();
}

/**
 * Clear the permissions cache (call after updating permissions)
 */
export function clearPermissionsCache(): void {
    runtimePermissions = null;
    permissionsCacheTime = 0;
}

/**
 * Role display names for UI
 */
export const ROLE_DISPLAY_NAMES: Record<AdminRole, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    OPERATIONS_MANAGER: 'Operations Manager',
    FINANCE_MANAGER: 'Finance Manager',
    SUPPORT_AGENT: 'Support Agent',
};

/**
 * Role descriptions for UI
 */
export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
    SUPER_ADMIN: 'Full access to all features and settings',
    ADMIN: 'Manage users, buddies, bookings, and services',
    OPERATIONS_MANAGER: 'View and manage bookings, assign buddies',
    FINANCE_MANAGER: 'Handle payments, refunds, and financial reports',
    SUPPORT_AGENT: 'View user details and manage support tickets',
};

/**
 * All admin roles
 */
export const ALL_ADMIN_ROLES: AdminRole[] = [
    'SUPER_ADMIN',
    'ADMIN',
    'OPERATIONS_MANAGER',
    'FINANCE_MANAGER',
    'SUPPORT_AGENT',
];

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: AdminRole | null | undefined, permission: Permission): boolean {
    if (!role) return false;

    const permissions = getPermissions();
    const rolePermissions = permissions[role];
    if (!rolePermissions) return false;

    // Super admin has all permissions
    if (rolePermissions.includes('*')) return true;

    return rolePermissions.includes(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: AdminRole | null | undefined, permissions: Permission[]): boolean {
    return permissions.some(permission => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: AdminRole | null | undefined, permissions: Permission[]): boolean {
    return permissions.every(permission => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: AdminRole): Permission[] {
    const permissions = getPermissions();
    const rolePermissions = permissions[role];
    if (rolePermissions.includes('*')) {
        // Return all possible permissions for super admin
        return ALL_PERMISSIONS;
    }
    return rolePermissions;
}

