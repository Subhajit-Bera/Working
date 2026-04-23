import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { AnalyticsJobData } from '../types';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { getRazorpay } from '../config/razorpay';

export const analyticsProcessor = async (job: Job<AnalyticsJobData>) => {
  const { type } = job.data;

  logger.info(`Processing analytics job: ${type || job.name}`);

  try {
    switch (type || job.name) {
      case 'daily-stats':
        await generateDailyStats();
        break;

      case 'buddy-performance':
        await calculateBuddyPerformance();
        break;

      case 'revenue-report':
        await generateRevenueReport(job.data);
        break;

      case 'user-engagement':
        await calculateUserEngagement();
        break;

      case 'service-popularity':
        await analyzeServicePopularity();
        break;

      case 'reconcile-payments':
        await reconcilePayments(job.data);
        break;

      default:
        logger.warn(`Unknown analytics job type: ${type}`);
    }

    return { success: true, type };
  } catch (error) {
    logger.error(`Analytics job failed: ${type}`, error);
    throw error;
  }
};

// Generate daily statistics
async function generateDailyStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalBookings,
    completedBookings,
    cancelledBookings,
    totalRevenue,
    newUsers,
    activeBuddies,
  ] = await Promise.all([
    prisma.booking.count({
      where: { createdAt: { gte: today, lt: tomorrow } },
    }),
    prisma.booking.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: today, lt: tomorrow },
      },
    }),
    prisma.booking.count({
      where: {
        status: 'CANCELLED',
        cancelledAt: { gte: today, lt: tomorrow },
      },
    }),
    prisma.transaction.aggregate({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: today, lt: tomorrow },
      },
      _sum: { amount: true },
    }),
    prisma.user.count({
      where: {
        role: 'USER',
        createdAt: { gte: today, lt: tomorrow },
      },
    }),
    prisma.buddy.count({
      where: {
        isOnline: true,
        isAvailable: true,
      },
    }),
  ]);

  const stats = {
    date: today,
    totalBookings,
    completedBookings,
    cancelledBookings,
    totalRevenue: totalRevenue._sum.amount || 0,
    newUsers,
    activeBuddies,
  };

  logger.info('Daily stats generated:', stats);

  // Store in database
  await prisma.dailyStats.upsert({
    where: { date: today },
    update: stats,
    create: stats,
  });
}

// Calculate buddy performance metrics
async function calculateBuddyPerformance() {
  // This is a heavy job, might be better to do incrementally
  // For now, it recalculates all
  const buddies = await prisma.buddy.findMany({
    include: {
      assignments: {
        where: { status: { in: ['COMPLETED', 'CANCELLED', 'REJECTED'] } },
        select: { status: true }
      },
      reviews: {
        select: { rating: true },
      },
    },
  });

  for (const buddy of buddies) {
    const totalJobs = buddy.assignments.length;
    const completedJobs = buddy.assignments.filter((a:any) => a.status === 'COMPLETED').length;
    
    const completionRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;
    
    const avgRating =
      buddy.reviews.length > 0
        ? buddy.reviews.reduce((sum:any, r:any) => sum + r.rating, 0) / buddy.reviews.length
        : 0;

    await prisma.buddy.update({
      where: { id: buddy.id },
      data: {
        totalJobs: completedJobs, // Store only completed jobs count
        completionRate,
        rating: avgRating,
        totalRatings: buddy.reviews.length,
      },
    });
  }

  logger.info(`Updated performance metrics for ${buddies.length} buddies`);
}

// Generate revenue report
async function generateRevenueReport(data: AnalyticsJobData) {
  const { startDate, endDate } = data;

  const transactions = await prisma.transaction.groupBy({
    by: ['method', 'status'],
    where: {
      createdAt: {
        gte: startDate ? new Date(startDate) : undefined,
        lte: endDate ? new Date(endDate) : undefined,
      },
    },
    _sum: { amount: true },
    _count: true,
  });

  logger.info('Revenue report generated:', transactions);
  return transactions;
}

// Calculate user engagement metrics
async function calculateUserEngagement() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [activeUsers, usersWithBookings, totalUsers] = await Promise.all([
    prisma.user.count({
      where: {
        role: 'USER',
        lastLoginAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.user.count({
      where: {
        role: 'USER',
        bookings: {
          some: {
            createdAt: { gte: thirtyDaysAgo },
          },
        },
      },
    }),
    prisma.user.count({ where: { role: 'USER' }})
  ]);

  const engagementRate = activeUsers > 0 ? (usersWithBookings / activeUsers) * 100 : 0;

  logger.info('User engagement metrics:', {
    totalUsers,
    activeUsers,
    usersWithBookings,
    engagementRate,
  });
}

// Analyze service popularity
async function analyzeServicePopularity() {
  const popularServices = await prisma.booking.groupBy({
    by: ['serviceId'],
    _count: true,
    orderBy: { _count: { serviceId: 'desc' } },
    take: 10,
  });

  const services = await prisma.service.findMany({
    where: {
      id: { in: popularServices.map((s:any) => s.serviceId) },
    },
  });

  const serviceMap = new Map(services.map((s:any) => [s.id, s.title]));

  const report = popularServices.map((s:any) => ({
    serviceId: s.serviceId,
    title: serviceMap.get(s.serviceId) || 'Unknown Service',
    bookings: s._count,
  }));

  logger.info('Service popularity report:', report);
  return report;
}

// Reconcile payments
async function reconcilePayments(data: AnalyticsJobData) {
  logger.info('Starting payment reconciliation...');
  const rzp = getRazorpay();
  if (!rzp) {
    logger.warn('Razorpay not configured, skipping reconciliation.');
    return;
  }

  const { startDate, endDate } = data;

  // Default to yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const from = startDate ? new Date(startDate) : new Date(yesterday.setHours(0, 0, 0, 0));
  const to = endDate ? new Date(endDate) : new Date(yesterday.setHours(23, 59, 59, 999));

  // 1. Get payments from Razorpay
  const rzpPayments = await rzp.payments.all({
    from: Math.floor(from.getTime() / 1000),
    to: Math.floor(to.getTime() / 1000),
    count: 100,
  });

  // 2. Get completed transactions from DB
  const dbTransactions = await prisma.transaction.findMany({
    where: {
      status: PaymentStatus.COMPLETED,
      createdAt: { gte: from, lte: to },
      method: PaymentMethod.PREPAID,
    },
  });

  let discrepancies = 0;
  const dbPaymentIds = new Set(dbTransactions.map((t:any) => t.razorpayPaymentId));

  // 3. Check if all captured RZP payments are in our DB
  for (const payment of rzpPayments.items) {
    if (payment.status === 'captured' && !dbPaymentIds.has(payment.id)) {
      logger.error(`DISCREPANCY: Razorpay payment ${payment.id} (Order: ${payment.order_id}) is 'captured' but not found as 'COMPLETED' in DB.`);
      
      const orderId = payment.order_id;
      if (orderId) {
         await prisma.transaction.updateMany({
           where: { razorpayOrderId: orderId, status: { not: PaymentStatus.COMPLETED } },
           data: {
             status: PaymentStatus.COMPLETED,
             razorpayPaymentId: payment.id,
             metadata: payment as any,
           }
         });
         logger.info(`Discrepancy for ${payment.id} auto-corrected.`);
      }
      discrepancies++;
    }
  }
  
  logger.info(`Payment reconciliation complete for ${from.toDateString()}. Found ${discrepancies} discrepancies.`);
}