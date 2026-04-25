import { prisma } from '../config/database';
import { AssignmentStatus, BookingStatus, PaymentStatus, Prisma, AdminRole } from '@prisma/client';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';

// Type assertion for rolePermission model (regenerate Prisma client to remove this)
const prismaWithRolePermission = prisma as typeof prisma & {
  rolePermission: {
    findMany: (args?: any) => Promise<Array<{ id: string; role: AdminRole; permission: string; createdAt: Date; updatedAt: Date; createdBy: string | null }>>;
    count: (args?: any) => Promise<number>;
    deleteMany: (args?: any) => Promise<{ count: number }>;
    createMany: (args?: any) => Promise<{ count: number }>;
  };
};

export class AdminService {
  /**
   * Get dashboard statistics
   */
  async getDashboardStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalBuddies,
      activeBuddies,
      totalBookings,
      todayBookings,
      monthBookings,
      completedBookings,
      pendingBookings,
      totalRevenue,
      monthRevenue,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.buddy.count(),
      prisma.buddy.count({ where: { isOnline: true, isAvailable: true } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.booking.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.booking.count({ where: { status: BookingStatus.COMPLETED } }),
      prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      prisma.transaction.aggregate({
        where: { status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          status: PaymentStatus.COMPLETED,
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
      },
      buddies: {
        total: totalBuddies,
        active: activeBuddies,
      },
      bookings: {
        total: totalBookings,
        today: todayBookings,
        thisMonth: monthBookings,
        completed: completedBookings,
        pending: pendingBookings,
      },
      revenue: {
        total: totalRevenue._sum.amount || 0,
        thisMonth: monthRevenue._sum.amount || 0,
      },
    };
  }

  /**
   * Get analytics data
   */
  async getAnalytics(filters: any) {
    const { startDate, endDate } = filters;

    const where: any = {};

    if (startDate) {
      where.createdAt = { gte: startDate };
    }

    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: endDate };
    }

    // Bookings by status
    const bookingsByStatus = await prisma.booking.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    // Bookings by service
    const bookingsByService = await prisma.booking.groupBy({
      by: ['serviceId'],
      where,
      _count: true,
      orderBy: { _count: { serviceId: 'desc' } },
      take: 10,
    });

    // Get service names
    const serviceIds = bookingsByService.map((b: any) => b.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, title: true },
    });

    const bookingsByServiceWithNames = bookingsByService.map((b: any) => ({
      service: services.find((s: any) => s.id === b.serviceId)?.title || 'Unknown',
      count: b._count,
    }));

    // Revenue over time (daily)
    const revenueByDay = await prisma.$queryRaw<Array<{ date: Date; revenue: number }>>`
      SELECT 
        "createdAt"::date as date,
        SUM("amount") as revenue
      FROM transactions
      WHERE "status" = 'COMPLETED'
        ${startDate ? Prisma.sql`AND "createdAt" >= ${startDate}` : Prisma.empty}
        ${endDate ? Prisma.sql`AND "createdAt" <= ${endDate}` : Prisma.empty}
      GROUP BY "createdAt"::date
      ORDER BY date ASC
    `;

    // Top performing buddies
    const topBuddies = await prisma.buddy.findMany({
      where: {
        totalJobs: { gt: 0 },
      },
      select: {
        id: true,
        rating: true,
        totalJobs: true,
        totalEarnings: true,
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { totalEarnings: 'desc' },
      take: 10,
    });

    return {
      bookingsByStatus,
      bookingsByService: bookingsByServiceWithNames,
      revenueByDay,
      topBuddies,
    };
  }

  /**
   * Get users with filters
   */
  async getUsers(filters: any) {
    const { page = 1, limit = 20, search, role, sortBy, sortOrder } = filters;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    if (role) {
      where.role = role;
    }

    let orderBy: any = { createdAt: 'desc' };

    if (sortBy === 'bookings') {
      orderBy = { bookings: { _count: sortOrder || 'desc' } };
    } else if (sortBy === 'name') {
      orderBy = { name: sortOrder || 'asc' };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder || 'desc' };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { bookings: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: true,
        bookings: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            service: true,
          },
        },
        buddy: true,
      },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    return user;
  }

  /**
   * Update user
   */
  async updateUser(userId: string, updates: any) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    logger.info(`User updated by admin: ${userId}`);

    return user;
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string) {
    await prisma.user.delete({
      where: { id: userId },
    });

    logger.info(`User deleted by admin: ${userId}`);
  }

  /**
   * Activate user
   */
  async activateUser(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    logger.info(`User activated: ${userId}`);
  }

  /**
   * Deactivate user
   */
  async deactivateUser(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    logger.info(`User deactivated: ${userId}`);
  }

  /**
   * Get buddies
   */
  async getBuddies(filters: any) {
    const { page = 1, limit = 20, search, isVerified, isAvailable } = filters;

    const where: any = {};

    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    if (isVerified !== undefined) {
      where.isVerified = isVerified;
    }

    if (isAvailable !== undefined) {
      where.isAvailable = isAvailable;
    }

    const [buddies, total] = await Promise.all([
      prisma.buddy.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profileImage: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.buddy.count({ where }),
    ]);

    return {
      buddies,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get buddy by ID
   */
  async getBuddyById(buddyId: string) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      include: {
        user: true,
        schedules: true,
        assignments: {
          take: 20,
          orderBy: { assignedAt: 'desc' },
          include: {
            booking: {
              include: {
                service: true,
              },
            },
          },
        },
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    // Get per-field verification status
    const { BuddyVerificationService } = await import('./buddy-verification.service');
    const verificationService = new BuddyVerificationService();
    const verification = await verificationService.getVerificationStatus(buddyId);

    return {
      ...buddy,
      verification,
    };
  }

  /**
   * Verify buddy (legacy - now uses granular verification)
   * This will verify all fields at once
   */
  async verifyBuddy(buddyId: string) {
    const { BuddyVerificationService } = await import('./buddy-verification.service');
    const verificationService = new BuddyVerificationService();

    // Verify all fields
    await verificationService.verifyField(buddyId, 'aadhaarFront');
    await verificationService.verifyField(buddyId, 'aadhaarBack');
    await verificationService.verifyField(buddyId, 'pan');
    await verificationService.verifyField(buddyId, 'bankDetails');
    await verificationService.verifyField(buddyId, 'emergencyContact');

    logger.info(`Buddy verified: ${buddyId}`);
  }

  /**
   * Reject buddy verification (legacy - use rejectField instead)
   */
  async rejectBuddy(buddyId: string, reason: string) {
    await prisma.buddy.update({
      where: { id: buddyId },
      data: {
        isVerified: false,
        documentsJson: {
          rejectionReason: reason,
          rejectedAt: new Date(),
        },
      },
    });

    logger.info(`Buddy verification rejected: ${buddyId}`);
  }

  /**
   * Verify a specific field
   */
  async verifyBuddyField(buddyId: string, field: string, comment?: string) {
    const { BuddyVerificationService } = await import('./buddy-verification.service');
    const verificationService = new BuddyVerificationService();

    const validFields = ['aadhaarFront', 'aadhaarBack', 'pan', 'bankDetails', 'emergencyContact'] as const;
    type VerificationFieldType = typeof validFields[number];

    if (!validFields.includes(field as VerificationFieldType)) {
      throw new ApiError(400, `Invalid verification field: ${field}`);
    }

    await verificationService.verifyField(buddyId, field as VerificationFieldType, comment);
    logger.info(`Field ${field} verified for buddy ${buddyId}`);
  }

  /**
   * Reject a specific field with comment
   */
  async rejectBuddyField(buddyId: string, field: string, comment: string) {
    const { BuddyVerificationService } = await import('./buddy-verification.service');
    const verificationService = new BuddyVerificationService();

    const validFields = ['aadhaarFront', 'aadhaarBack', 'pan', 'bankDetails', 'emergencyContact'] as const;
    type VerificationFieldType = typeof validFields[number];

    if (!validFields.includes(field as VerificationFieldType)) {
      throw new ApiError(400, `Invalid verification field: ${field}`);
    }

    await verificationService.rejectField(buddyId, field as VerificationFieldType, comment);
    logger.info(`Field ${field} rejected for buddy ${buddyId}`);
  }

  /**
   * Update training details
   */
  async updateTraining(
    buddyId: string,
    updates: {
      trainingStartDate?: Date;
      trainingDaysTaken?: number;
      isTrainingCompleted?: boolean;
    }
  ) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    const updateData: any = {};

    if (updates.trainingStartDate !== undefined) {
      updateData.trainingStartDate = updates.trainingStartDate;
    }

    if (updates.trainingDaysTaken !== undefined) {
      if (updates.trainingDaysTaken < 0 || updates.trainingDaysTaken > 5) {
        throw new ApiError(400, 'Training days must be between 0 and 5');
      }
      updateData.trainingDaysTaken = updates.trainingDaysTaken;
    }

    if (updates.isTrainingCompleted !== undefined) {
      updateData.isTrainingCompleted = updates.isTrainingCompleted;
    }

    await prisma.buddy.update({
      where: { id: buddyId },
      data: updateData,
    });

    logger.info(`Training updated for buddy ${buddyId}:`, updateData);
  }

  /**
   * Assign job start date (admin only)
   */
  async assignJobStartDate(buddyId: string, jobStartDate: Date) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: { isTrainingCompleted: true },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    if (!buddy.isTrainingCompleted) {
      throw new ApiError(400, 'Training must be completed before assigning job start date');
    }

    await prisma.buddy.update({
      where: { id: buddyId },
      data: { jobStartDate },
    });

    logger.info(`Job start date assigned for buddy ${buddyId}: ${jobStartDate.toISOString()}`);
  }

  /**
   * Get buddy locations
   */
  async getBuddyLocations() {
    const buddies = await prisma.$queryRaw<Array<{
      id: string;
      latitude: number;
      longitude: number;
      lastLocationTime: Date;
      isAvailable: boolean;
      isOnline: boolean;
      name: string;
    }>>`
      SELECT 
        b.id,
        ST_Y(b."lastKnownLocation"::geometry) as latitude,
        ST_X(b."lastKnownLocation"::geometry) as longitude,
        b."lastLocationTime",
        b."isAvailable",
        b."isOnline",
        u.name
      FROM "buddies" b
      JOIN "users" u ON b.id = u.id
      WHERE 
        b."isOnline" = true
        AND b."lastKnownLocation" IS NOT NULL
    `;

    const buddyIds = buddies.map((b: any) => b.id);

    // FIX: Use correct AssignmentStatus
    const activeAssignments = await prisma.assignment.findMany({
      where: {
        buddyId: { in: buddyIds },
        status: { in: [AssignmentStatus.ACCEPTED] },
      },
      include: {
        booking: {
          include: {
            service: { select: { title: true } },
            address: { select: { formattedAddress: true } },
          }
        }
      }
    });

    return buddies.map((buddy: any) => {
      // Correctly find the assignment from the separate query
      const assignment = activeAssignments.find((a: any) => a.buddyId === buddy.id);
      return {
        buddyId: buddy.id,
        name: buddy.name,
        latitude: buddy.latitude,
        longitude: buddy.longitude,
        lastUpdate: buddy.lastLocationTime,
        isOnline: buddy.isOnline,
        isAvailable: buddy.isAvailable,
        currentBooking: assignment
          ? {
            id: assignment.booking.id,
            service: assignment.booking.service.title,
            customerAddress: assignment.booking.address.formattedAddress,
          }
          : undefined,
      };
    });
  }

  /**
   * Get bookings
   */
  async getBookings(filters: any) {
    const { page = 1, limit = 20, status, startDate, endDate } = filters;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (startDate) {
      where.scheduledStart = { gte: startDate };
    }

    if (endDate) {
      where.scheduledStart = { ...where.scheduledStart, lte: endDate };
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          service: {
            select: {
              id: true,
              title: true,
            },
          },
          address: true,
          assignments: {
            include: {
              buddy: {
                include: {
                  user: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get booking by ID
   */
  async getBookingById(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: true,
        service: true,
        address: true,
        assignments: {
          include: {
            buddy: {
              include: {
                user: true,
              },
            },
          },
        },
        transactions: true,
        reviews: true,
        otpVerification: true,
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    return booking;
  }

  /**
   * Update booking status
   */
  async updateBookingStatus(bookingId: string, status: BookingStatus) {
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { status },
    });

    logger.info(`Booking status updated by admin: ${bookingId} -> ${status}`);

    return booking;
  }

  /**
   * Get services
   */
  async getServices() {
    return await prisma.service.findMany({
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create service
   */
  async createService(data: any) {
    const service = await prisma.service.create({
      data,
      include: {
        category: true,
      },
    });

    logger.info(`Service created: ${service.id}`);

    return service;
  }

  /**
   * Update service
   */
  async updateService(serviceId: string, updates: any) {
    const service = await prisma.service.update({
      where: { id: serviceId },
      data: updates,
    });

    logger.info(`Service updated: ${serviceId}`);

    return service;
  }

  /**
   * Delete service
   */
  async deleteService(serviceId: string) {
    await prisma.service.delete({
      where: { id: serviceId },
    });

    logger.info(`Service deleted: ${serviceId}`);
  }

  /**
   * Get payments
   */
  async getPayments(filters: any) {
    const { page = 1, limit = 20, status } = filters;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          booking: {
            include: {
              service: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get configuration
   */
  async getConfig() {
    const configs = await prisma.config.findMany();

    const configMap: any = {};
    configs.forEach((config: any) => {
      configMap[config.key] = config.value;
    });

    return configMap;
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: any) {
    const promises = Object.entries(updates).map(([key, value]) =>
      prisma.config.upsert({
        where: { key },
        update: { value: value as any },
        create: { key, value: value as any },
      })
    );

    await Promise.all(promises);

    logger.info('Configuration updated');

    return await this.getConfig();
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(filters: any) {
    const { page = 1, limit = 50, action, userId } = filters;

    const where: any = {};

    if (action) {
      where.action = action;
    }

    if (userId) {
      where.userId = userId;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ============================================
  // TRANSACTIONS & PAYMENTS
  // ============================================

  /**
   * Get transactions with advanced filters
   */
  async getTransactions(filters: any) {
    const {
      page = 1,
      limit = 20,
      status,
      method,
      startDate,
      endDate,
      search
    } = filters;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (method) {
      where.method = method;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    if (search) {
      where.OR = [
        { bookingId: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          booking: {
            include: {
              service: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(transactionId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        booking: {
          include: {
            service: true,
            address: true,
            assignments: {
              include: {
                buddy: {
                  include: {
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new ApiError(404, 'Transaction not found');
    }

    return transaction;
  }

  /**
   * Process refund for a transaction
   */
  async processRefund(transactionId: string, amount?: number, reason?: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { booking: true },
    });

    if (!transaction) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (transaction.status === PaymentStatus.REFUNDED) {
      throw new ApiError(400, 'Transaction already refunded');
    }

    if (transaction.status !== PaymentStatus.COMPLETED) {
      throw new ApiError(400, 'Only completed transactions can be refunded');
    }

    const refundAmount = amount || transaction.amount;

    if (refundAmount > transaction.amount) {
      throw new ApiError(400, 'Refund amount cannot exceed original amount');
    }

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAmount: refundAmount,
        refundedAt: new Date(),
        metadata: {
          ...(transaction.metadata as any),
          refundReason: reason,
          refundProcessedBy: 'admin',
        },
      },
    });

    // Update booking payment status
    if (transaction.bookingId) {
      await prisma.booking.update({
        where: { id: transaction.bookingId },
        data: {
          paymentStatus: PaymentStatus.REFUNDED,
        },
      });
    }

    logger.info(`Refund processed for transaction ${transactionId}: ₹${refundAmount}`);

    return updatedTransaction;
  }

  // ============================================
  // REVIEWS
  // ============================================

  /**
   * Get all reviews with filters
   */
  async getReviews(filters: any) {
    const {
      page = 1,
      limit = 20,
      rating,
      buddyId,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = filters;

    const where: any = {};

    if (rating) {
      where.rating = parseInt(rating);
    }

    if (buddyId) {
      where.buddyId = buddyId;
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          buddy: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          booking: {
            include: {
              service: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({ where }),
    ]);

    return {
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get review by ID
   */
  async getReviewById(reviewId: string) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        buddy: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        booking: {
          include: {
            service: true,
          },
        },
      },
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    return review;
  }

  /**
   * Delete a review (moderation)
   */
  async deleteReview(reviewId: string, reason?: string) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        buddy: true,
      },
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Delete the review
    await prisma.review.delete({
      where: { id: reviewId },
    });

    // Recalculate buddy's average rating
    const remainingReviews = await prisma.review.aggregate({
      where: { buddyId: review.buddyId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    // Update buddy's rating
    await prisma.buddy.update({
      where: { id: review.buddyId },
      data: {
        rating: remainingReviews._avg.rating || 0,
      },
    });

    logger.info(`Review ${reviewId} deleted. Reason: ${reason || 'Not specified'}`);

    return { success: true, message: 'Review deleted successfully' };
  }

  // ========================
  // TRACKING & REPORTS
  // ========================

  /**
   * Get all online buddies with their current locations for live tracking map
   */
  async getAllOnlineBuddies() {
    const buddies = await prisma.buddy.findMany({
      where: {
        isOnline: true,
      },
      select: {
        id: true,
        isAvailable: true,
        isOnline: true,
        lastLocationLat: true,
        lastLocationLong: true,
        lastLocationTime: true,
        rating: true,
        totalJobs: true,
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            profileImage: true,
          },
        },
        assignments: {
          where: {
            status: AssignmentStatus.ACCEPTED,
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            booking: {
              select: {
                id: true,
                status: true,
                service: {
                  select: { title: true },
                },
              },
            },
          },
        },
      },
    });

    return buddies.map(buddy => ({
      id: buddy.id,
      name: buddy.user?.name || 'Unknown',
      phone: buddy.user?.phone,
      profileImage: buddy.user?.profileImage,
      isAvailable: buddy.isAvailable,
      isOnline: buddy.isOnline,
      latitude: buddy.lastLocationLat,
      longitude: buddy.lastLocationLong,
      lastLocationTime: buddy.lastLocationTime,
      rating: buddy.rating,
      totalJobs: buddy.totalJobs,
      activeBooking: buddy.assignments[0]?.booking || null,
    }));
  }

  /**
   * Get revenue report with period breakdown
   */
  async getRevenueReport(filters: { startDate?: Date; endDate?: Date; groupBy?: 'day' | 'week' | 'month' }) {
    const { startDate, endDate, groupBy = 'day' } = filters;

    const now = new Date();
    const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 3, 1); // Last 3 months
    const defaultEndDate = endDate || now;

    // Daily revenue - DATE_TRUNC interval is a SQL literal, can't be parameterized.
    // Validated against whitelist to prevent injection.
    const validGroupBy = ['day', 'week', 'month'].includes(groupBy) ? groupBy : 'day';
    const groupByLiteral = Prisma.raw(validGroupBy);

    const revenueByPeriod = await prisma.$queryRaw<Array<{ date: Date; revenue: number; count: number }>>(
      Prisma.sql`SELECT 
        DATE_TRUNC(${groupByLiteral}, "createdAt") as date,
        SUM("amount") as revenue,
        COUNT(*) as count
      FROM transactions
      WHERE "status" = 'COMPLETED'
        AND "createdAt" >= ${defaultStartDate}
        AND "createdAt" <= ${defaultEndDate}
      GROUP BY DATE_TRUNC(${groupByLiteral}, "createdAt")
      ORDER BY date ASC`
    );

    // Revenue by payment method
    const revenueByMethod = await prisma.transaction.groupBy({
      by: ['method'],
      where: {
        status: 'COMPLETED',
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    // Total stats for the period
    const totals = await prisma.transaction.aggregate({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _sum: { amount: true },
      _count: true,
      _avg: { amount: true },
    });

    // Refund stats
    const refunds = await prisma.transaction.aggregate({
      where: {
        status: 'REFUNDED',
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _sum: { refundedAmount: true },
      _count: true,
    });

    return {
      revenueByPeriod: revenueByPeriod.map(r => ({
        date: r.date,
        revenue: Number(r.revenue) || 0,
        count: Number(r.count) || 0,
      })),
      revenueByMethod: revenueByMethod.map(r => ({
        method: r.method,
        revenue: r._sum.amount || 0,
        count: r._count,
      })),
      totals: {
        totalRevenue: totals._sum.amount || 0,
        totalTransactions: totals._count,
        averageTransaction: totals._avg.amount || 0,
        totalRefunds: refunds._sum.refundedAmount || 0,
        refundCount: refunds._count,
      },
      period: { startDate: defaultStartDate, endDate: defaultEndDate },
    };
  }

  /**
   * Get booking trends report
   */
  async getBookingReport(filters: { startDate?: Date; endDate?: Date }) {
    const { startDate, endDate } = filters;

    const now = new Date();
    const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const defaultEndDate = endDate || now;

    // Bookings by day
    const bookingsByDay = await prisma.$queryRaw<Array<{ date: Date; count: number }>>(
      Prisma.sql`SELECT 
        DATE_TRUNC('day', "createdAt") as date,
        COUNT(*) as count
      FROM bookings
      WHERE "createdAt" >= ${defaultStartDate}
        AND "createdAt" <= ${defaultEndDate}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY date ASC`
    );

    // Bookings by status
    const bookingsByStatus = await prisma.booking.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _count: true,
    });

    // Top services
    const topServices = await prisma.booking.groupBy({
      by: ['serviceId'],
      where: {
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _count: true,
      orderBy: { _count: { serviceId: 'desc' } },
      take: 10,
    });

    const serviceIds = topServices.map(s => s.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, title: true },
    });

    // Top buddies by completed jobs
    const topBuddies = await prisma.assignment.groupBy({
      by: ['buddyId'],
      where: {
        status: AssignmentStatus.COMPLETED,
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
      },
      _count: true,
      orderBy: { _count: { buddyId: 'desc' } },
      take: 10,
    });

    const buddyIds = topBuddies.map(b => b.buddyId);
    const buddies = await prisma.buddy.findMany({
      where: { id: { in: buddyIds } },
      select: { id: true, rating: true, user: { select: { name: true } } },
    });

    return {
      bookingsByDay: bookingsByDay.map(b => ({
        date: b.date,
        count: Number(b.count) || 0,
      })),
      bookingsByStatus: bookingsByStatus.map(b => ({
        status: b.status,
        count: b._count,
      })),
      topServices: topServices.map(s => ({
        serviceId: s.serviceId,
        serviceName: services.find(svc => svc.id === s.serviceId)?.title || 'Unknown',
        count: s._count,
      })),
      topBuddies: topBuddies.map(b => {
        const buddy = buddies.find(bud => bud.id === b.buddyId);
        return {
          buddyId: b.buddyId,
          buddyName: buddy?.user?.name || 'Unknown',
          rating: buddy?.rating || 0,
          completedJobs: b._count,
        };
      }),
      period: { startDate: defaultStartDate, endDate: defaultEndDate },
    };
  }

  // Get buddy performance report
  async getBuddyReport(filters: { startDate?: Date; endDate?: Date }) {
    const { startDate, endDate } = filters;

    const now = new Date();
    const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defaultEndDate = endDate || now;

    // Get all buddies with their stats
    const buddies = await prisma.buddy.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    // Get buddy assignment counts for the period
    const assignmentCounts = await prisma.assignment.groupBy({
      by: ['buddyId'],
      where: {
        createdAt: { gte: defaultStartDate, lte: defaultEndDate },
        status: 'COMPLETED',
      },
      _count: true,
    });

    const assignmentMap = new Map(assignmentCounts.map(a => [a.buddyId, a._count]));

    // Build performance data
    const buddyPerformance = buddies.map(buddy => ({
      buddyId: buddy.id,
      name: buddy.user?.name || 'Unknown',
      email: buddy.user?.email || '',
      isVerified: buddy.isVerified,
      isOnline: buddy.isOnline,
      rating: buddy.rating,
      totalJobs: buddy.totalJobs,
      periodJobs: assignmentMap.get(buddy.id) || 0,
      totalEarnings: buddy.totalEarnings,
      completionRate: buddy.completionRate,
    }));

    // Summary stats
    const totalBuddies = buddies.length;
    const verifiedBuddies = buddies.filter(b => b.isVerified).length;
    const onlineBuddies = buddies.filter(b => b.isOnline).length;
    const averageRating = buddies.length > 0
      ? buddies.reduce((sum, b) => sum + b.rating, 0) / buddies.length
      : 0;

    return {
      summary: {
        totalBuddies,
        verifiedBuddies,
        onlineBuddies,
        averageRating: Math.round(averageRating * 10) / 10,
      },
      topPerformers: buddyPerformance
        .sort((a, b) => b.periodJobs - a.periodJobs)
        .slice(0, 10),
      verificationStatus: {
        verified: verifiedBuddies,
        pending: totalBuddies - verifiedBuddies,
      },
      period: { startDate: defaultStartDate, endDate: defaultEndDate },
    };
  }

  /**
   * Export data for reports (returns raw data for CSV generation)
   */
  async exportReportData(type: 'transactions' | 'bookings' | 'buddies', filters: { startDate?: Date; endDate?: Date }) {
    const { startDate, endDate } = filters;

    const now = new Date();
    const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const defaultEndDate = endDate || now;

    if (type === 'transactions') {
      const transactions = await prisma.transaction.findMany({
        where: {
          createdAt: { gte: defaultStartDate, lte: defaultEndDate },
        },
        include: {
          user: { select: { name: true, email: true } },
          booking: { select: { id: true, service: { select: { title: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return transactions.map(t => ({
        id: t.id,
        date: t.createdAt.toISOString(),
        customerName: t.user?.name || '',
        customerEmail: t.user?.email || '',
        service: t.booking?.service?.title || '',
        amount: t.amount,
        method: t.method,
        status: t.status,
        refundedAmount: t.refundedAmount || 0,
      }));
    }

    if (type === 'bookings') {
      const bookings = await prisma.booking.findMany({
        where: {
          createdAt: { gte: defaultStartDate, lte: defaultEndDate },
        },
        include: {
          user: { select: { name: true, email: true } },
          service: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return bookings.map(b => ({
        id: b.id,
        date: b.createdAt.toISOString(),
        scheduledStart: b.scheduledStart?.toISOString() || '',
        customerName: b.user?.name || '',
        customerEmail: b.user?.email || '',
        service: b.service?.title || '',
        status: b.status,
        totalAmount: b.totalAmount,
        paymentStatus: b.paymentStatus,
      }));
    }

    if (type === 'buddies') {
      const buddies = await prisma.buddy.findMany({
        include: {
          user: { select: { name: true, email: true, phone: true } },
        },
        orderBy: { totalEarnings: 'desc' },
      });

      return buddies.map(b => ({
        id: b.id,
        name: b.user?.name || '',
        email: b.user?.email || '',
        phone: b.user?.phone || '',
        isVerified: b.isVerified,
        isOnline: b.isOnline,
        isAvailable: b.isAvailable,
        rating: b.rating,
        totalJobs: b.totalJobs,
        totalEarnings: b.totalEarnings,
      }));
    }

    return [];
  }

  // ============================================
  // ADMIN USER MANAGEMENT (RBAC)
  // ============================================

  /**
   * Get all admin users
   */
  async getAdmins(filters: { page?: number; limit?: number; search?: string }) {
    const { page = 1, limit = 20, search } = filters;
    const skip = (page - 1) * limit;

    const where: any = {
      role: 'ADMIN',
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          adminRole: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          profileImage: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      admins,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a new admin user
   */
  async createAdmin(data: {
    name: string;
    email: string;
    password: string;
    adminRole: string;
    phone?: string;
  }) {
    const { name, email, password, adminRole, phone } = data;

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(400, 'Email already in use');
    }

    // Hash password
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        role: 'ADMIN',
        adminRole: adminRole as any,
        isActive: true,
        emailVerified: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        adminRole: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info(`Admin user created: ${admin.email} with role ${adminRole}`);

    return admin;
  }

  /**
   * Update an admin user
   */
  async updateAdmin(id: string, data: {
    name?: string;
    email?: string;
    adminRole?: string;
    phone?: string;
    isActive?: boolean;
    password?: string;
  }) {
    const admin = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!admin || admin.role !== 'ADMIN') {
      throw new ApiError(404, 'Admin user not found');
    }

    const updateData: any = {};

    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.phone) updateData.phone = data.phone;
    if (data.adminRole) updateData.adminRole = data.adminRole as any;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    if (data.password) {
      const bcrypt = require('bcryptjs');
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        adminRole: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    logger.info(`Admin user updated: ${updated.email}`);

    return updated;
  }

  /**
   * Delete an admin user
   */
  async deleteAdmin(id: string) {
    const admin = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, adminRole: true },
    });

    if (!admin || admin.role !== 'ADMIN') {
      throw new ApiError(404, 'Admin user not found');
    }

    // Prevent deleting super admin if it's the last one
    if (admin.adminRole === 'SUPER_ADMIN') {
      const superAdminCount = await prisma.user.count({
        where: { role: 'ADMIN', adminRole: 'SUPER_ADMIN' },
      });

      if (superAdminCount <= 1) {
        throw new ApiError(400, 'Cannot delete the last Super Admin');
      }
    }

    await prisma.user.delete({ where: { id } });

    logger.info(`Admin user deleted: ${id}`);

    return { success: true };
  }

  // Get admin notifications (escalated bookings, pending verifications, training requests)
  async getAdminNotifications(filters: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const { page = 1, limit = 20 } = filters;
    // Note: unreadOnly filter can be implemented later with a read status tracking table

    // Build the aggregate notification list from different sources
    const notifications: any[] = [];

    // 1. Get escalated bookings
    const escalatedBookings = await prisma.booking.findMany({
      where: { status: 'ESCALATED' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, title: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    escalatedBookings.forEach(booking => {
      notifications.push({
        id: `escalated-${booking.id}`,
        type: 'BOOKING_ESCALATED',
        title: 'Booking Escalated',
        body: `Booking #${booking.id.slice(-8)} needs attention`,
        data: {
          bookingId: booking.id,
          customerName: booking.user.name,
          service: booking.service?.title,
        },
        isRead: false,
        createdAt: booking.updatedAt,
      });
    });

    // 2. Get buddies with pending verification (documents uploaded but not verified)
    const pendingBuddies = await prisma.buddy.findMany({
      where: {
        isVerified: false,
        user: { isActive: true },
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        verification: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    pendingBuddies.forEach(buddy => {
      notifications.push({
        id: `pending-buddy-${buddy.id}`,
        type: 'BUDDY_PENDING_VERIFICATION',
        title: 'Buddy Pending Verification',
        body: `${buddy.user.name} has documents awaiting verification`,
        data: {
          buddyId: buddy.id,
          buddyName: buddy.user.name,
          phone: buddy.user.phone,
        },
        isRead: false,
        createdAt: buddy.createdAt,
      });
    });

    // 3. Get buddies who have selected training date but not completed
    const trainingBuddies = await prisma.buddy.findMany({
      where: {
        trainingStartDate: { not: null },
        isTrainingCompleted: false,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { trainingStartDate: 'desc' },
      take: 50,
    });

    trainingBuddies.forEach(buddy => {
      notifications.push({
        id: `training-${buddy.id}`,
        type: 'BUDDY_TRAINING_SCHEDULED',
        title: 'Training Scheduled',
        body: `${buddy.user.name} has scheduled training`,
        data: {
          buddyId: buddy.id,
          buddyName: buddy.user.name,
          trainingDate: buddy.trainingStartDate,
        },
        isRead: false,
        createdAt: buddy.trainingStartDate || buddy.createdAt,
      });
    });

    // Sort all notifications by date
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Pagination
    const startIndex = (page - 1) * limit;
    const paginatedNotifications = notifications.slice(startIndex, startIndex + limit);

    return {
      notifications: paginatedNotifications,
      pagination: {
        page,
        limit,
        total: notifications.length,
        pages: Math.ceil(notifications.length / limit),
      },
      counts: {
        escalatedBookings: escalatedBookings.length,
        pendingVerifications: pendingBuddies.length,
        trainingScheduled: trainingBuddies.length,
      },
    };
  }

  // Mark notification as read (stored in a simple cache or session)
  async markNotificationRead(notificationId: string) {
    // For now, we don't persist read status since these are aggregated notifications
    // In a full implementation, you'd store read status per admin user
    logger.info(`Admin marked notification as read: ${notificationId}`);
    return { success: true };
  }

  // ============================================
  // DYNAMIC ROLE PERMISSIONS MANAGEMENT
  // ============================================

  /**
   * Get permissions configuration (categories, all permissions, etc.)
   */
  async getPermissionsConfig() {
    const {
      ALL_PERMISSIONS,
      PERMISSION_CATEGORIES,
      PERMISSION_DISPLAY_NAMES,
      ALL_ADMIN_ROLES,
      ROLE_DISPLAY_NAMES,
      ROLE_DESCRIPTIONS,
    } = await import('../config/permissions');

    return {
      permissions: ALL_PERMISSIONS,
      categories: PERMISSION_CATEGORIES,
      displayNames: PERMISSION_DISPLAY_NAMES,
      roles: ALL_ADMIN_ROLES,
      roleDisplayNames: ROLE_DISPLAY_NAMES,
      roleDescriptions: ROLE_DESCRIPTIONS,
    };
  }

  /**
   * Get all roles with their current permissions
   */
  async getAllRolesPermissions() {
    const { ALL_ADMIN_ROLES, DEFAULT_PERMISSIONS, ROLE_DISPLAY_NAMES } = await import('../config/permissions');

    // Get permissions from database
    const dbPermissions = await prismaWithRolePermission.rolePermission.findMany({
      orderBy: [{ role: 'asc' }, { permission: 'asc' }],
    });

    // Build permissions map from database
    const rolePermissionsMap: Record<string, string[]> = {};
    dbPermissions.forEach(rp => {
      if (!rolePermissionsMap[rp.role]) {
        rolePermissionsMap[rp.role] = [];
      }
      rolePermissionsMap[rp.role].push(rp.permission);
    });

    // Build result with fallback to defaults for roles not in DB
    const result = ALL_ADMIN_ROLES.map(role => {
      const permissions = rolePermissionsMap[role] || DEFAULT_PERMISSIONS[role] || [];
      return {
        role,
        displayName: ROLE_DISPLAY_NAMES[role],
        permissions,
        isFromDatabase: !!rolePermissionsMap[role],
      };
    });

    return result;
  }

  /**
   * Update permissions for a specific role
   */
  async updateRolePermissions(role: string, permissions: string[], adminUserId: string) {
    const { ALL_ADMIN_ROLES, ALL_PERMISSIONS, clearPermissionsCache } = await import('../config/permissions');

    // Validate role
    if (!ALL_ADMIN_ROLES.includes(role as any)) {
      throw new Error(`Invalid role: ${role}`);
    }

    // SUPER_ADMIN always has all permissions - cannot be modified
    if (role === 'SUPER_ADMIN') {
      throw new Error('Super Admin permissions cannot be modified');
    }

    // Validate permissions
    const validPermissions = permissions.filter(p => ALL_PERMISSIONS.includes(p as any));
    const invalidPermissions = permissions.filter(p => !ALL_PERMISSIONS.includes(p as any));
    if (invalidPermissions.length > 0) {
      logger.warn(`Invalid permissions ignored: ${invalidPermissions.join(', ')}`);
    }

    // Delete existing permissions for this role
    await prismaWithRolePermission.rolePermission.deleteMany({
      where: { role: role as any },
    });

    // Insert new permissions
    if (validPermissions.length > 0) {
      await prismaWithRolePermission.rolePermission.createMany({
        data: validPermissions.map(permission => ({
          role: role as any,
          permission,
          createdBy: adminUserId,
        })),
      });
    }

    // Clear the permissions cache so changes take effect immediately
    clearPermissionsCache();

    // Reload permissions into cache
    await this.loadPermissionsIntoCache();

    // Log the change
    logger.info(`Role permissions updated: ${role} by admin ${adminUserId}`, {
      role,
      newPermissions: validPermissions,
      adminUserId,
    });

    return {
      role,
      permissions: validPermissions,
      updatedBy: adminUserId,
    };
  }

  /**
   * Initialize default permissions in database (run once on first setup)
   */
  async initializeDefaultPermissions() {
    const { ALL_ADMIN_ROLES, DEFAULT_PERMISSIONS } = await import('../config/permissions');

    // Check if any permissions exist
    const existingCount = await prismaWithRolePermission.rolePermission.count();
    if (existingCount > 0) {
      logger.info('Role permissions already initialized, skipping');
      return { initialized: false, message: 'Permissions already exist' };
    }

    // Insert default permissions (excluding SUPER_ADMIN which has wildcard)
    const permissionsToInsert: { role: any; permission: string }[] = [];

    for (const role of ALL_ADMIN_ROLES) {
      if (role === 'SUPER_ADMIN') continue; // Skip - handled by wildcard

      const rolePermissions = DEFAULT_PERMISSIONS[role];
      if (!rolePermissions) continue;

      for (const permission of rolePermissions) {
        if (permission === '*') continue; // Skip wildcard
        permissionsToInsert.push({ role, permission });
      }
    }

    await prismaWithRolePermission.rolePermission.createMany({
      data: permissionsToInsert,
    });

    logger.info(`Initialized ${permissionsToInsert.length} default role permissions`);

    return {
      initialized: true,
      count: permissionsToInsert.length,
      message: 'Default permissions initialized successfully',
    };
  }

  /**
   * Load permissions from database into runtime cache
   */
  async loadPermissionsIntoCache() {
    const { ALL_ADMIN_ROLES, DEFAULT_PERMISSIONS, setRuntimePermissions } = await import('../config/permissions');

    // Get all permissions from database
    const dbPermissions = await prismaWithRolePermission.rolePermission.findMany();

    if (dbPermissions.length === 0) {
      // No database permissions, use defaults
      logger.info('No database permissions found, using defaults');
      return;
    }

    // Build permissions map
    const rolePermissionsMap: Record<string, string[]> = {};
    dbPermissions.forEach(rp => {
      if (!rolePermissionsMap[rp.role]) {
        rolePermissionsMap[rp.role] = [];
      }
      rolePermissionsMap[rp.role].push(rp.permission);
    });

    // Build full permissions object with fallbacks
    const permissions: Record<string, string[]> = {};
    for (const role of ALL_ADMIN_ROLES) {
      if (role === 'SUPER_ADMIN') {
        permissions[role] = ['*']; // Always wildcard
      } else {
        permissions[role] = rolePermissionsMap[role] || DEFAULT_PERMISSIONS[role] || [];
      }
    }

    // Set runtime permissions
    setRuntimePermissions(permissions as any);
    logger.info('Loaded permissions into cache from database');
  }

  /**
   * Reset role permissions to defaults
   */
  async resetRolePermissions(role: string, adminUserId: string) {
    const { ALL_ADMIN_ROLES, DEFAULT_PERMISSIONS, clearPermissionsCache } = await import('../config/permissions');

    if (!ALL_ADMIN_ROLES.includes(role as any)) {
      throw new Error(`Invalid role: ${role}`);
    }

    if (role === 'SUPER_ADMIN') {
      throw new Error('Super Admin permissions cannot be modified');
    }

    // Delete existing permissions
    await prismaWithRolePermission.rolePermission.deleteMany({
      where: { role: role as any },
    });

    // Insert default permissions
    const defaultPerms = DEFAULT_PERMISSIONS[role as keyof typeof DEFAULT_PERMISSIONS] || [];
    if (defaultPerms.length > 0 && !defaultPerms.includes('*' as any)) {
      await prismaWithRolePermission.rolePermission.createMany({
        data: defaultPerms.map(permission => ({
          role: role as any,
          permission,
          createdBy: adminUserId,
        })),
      });
    }

    clearPermissionsCache();
    await this.loadPermissionsIntoCache();

    logger.info(`Role permissions reset to defaults: ${role} by admin ${adminUserId}`);

    return {
      role,
      permissions: defaultPerms,
      resetBy: adminUserId,
    };
  }
}