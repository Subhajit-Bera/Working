import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { PaymentJobData } from '../types';
import { getRazorpay } from '../config/razorpay';
import { PaymentStatus } from '@prisma/client';

export const paymentProcessor = async (job: Job<PaymentJobData>) => {
  const paymentType = job.name;

  // ===== POISON PILL DETECTION =====
  // Validate payload to prevent crash loops from malformed jobs
  if (!job.data || typeof job.data !== 'object') {
    logger.error(`[Payment] POISON PILL detected - invalid data: ${JSON.stringify(job.data)}`);
    return { success: false, poisonPill: true, reason: 'Invalid job payload - missing or malformed data' };
  }

  logger.info(`Processing payment job: ${paymentType}`);

  try {
    switch (paymentType) {
      case 'process-refund':
        await processRefund(job.data);
        break;

      case 'verify-payment':
        await verifyPayment(job.data);
        break;

      case 'payout-buddy':
        await processBuddyPayout(job.data);
        break;

      case 'reconcile-payments':
        // This is now handled by the analytics processor, can be removed
        logger.warn('reconcile-payments job should be handled by analytics-queue');
        break;

      default:
        logger.warn(`Unknown payment job type: ${paymentType}`);
    }

    return { success: true, type: paymentType };
  } catch (error) {
    logger.error(`Payment job failed: ${paymentType}`, error);
    throw error;
  }
};

// Process refund
async function processRefund(data: PaymentJobData) {
  const { transactionId, amount } = data;
  const rzp = getRazorpay();
  if (!rzp) throw new Error('Razorpay not configured in worker');

  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction || !transaction.razorpayPaymentId) {
    throw new Error('Transaction not found or not a Razorpay payment');
  }

  const refundAmount = amount ? Math.round(amount * 100) : undefined; // Amount in paise

  const refund = await rzp.payments.refund(transaction.razorpayPaymentId, {
    amount: refundAmount,
    speed: 'normal',
  });

  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status: 'REFUNDED',
      refundedAmount: amount || transaction.amount,
      refundedAt: new Date(),
      metadata: {
        ...(transaction.metadata as any),
        refundId: refund.id,
        refundStatus: refund.status,
      },
    },
  });

  logger.info(`Refund processed for transaction ${transactionId}: ${refund.id}`);
}

// Verify payment status
async function verifyPayment(data: PaymentJobData) {
  const { transactionId } = data;
  const rzp = getRazorpay();
  if (!rzp) throw new Error('Razorpay not configured in worker');

  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction || !transaction.razorpayOrderId) {
    return; // No order to check
  }

  if (transaction.status === PaymentStatus.COMPLETED) {
    logger.info(`Payment ${transactionId} already completed.`);
    return;
  }

  const order = await rzp.orders.fetch(transaction.razorpayOrderId);

  if (order.status === 'paid') {
    const payments = await rzp.orders.fetchPayments(transaction.razorpayOrderId);
    const payment = payments.items?.[0];

    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'COMPLETED',
        razorpayPaymentId: payment?.id,
        metadata: payment as any
      },
    });

    await prisma.booking.update({
      where: { id: transaction.bookingId },
      data: { paymentStatus: 'COMPLETED' }
    });

    logger.info(`Payment verified and updated for order ${transaction.razorpayOrderId}`);
  }
}

// Process buddy payout
async function processBuddyPayout(data: PaymentJobData) {
  const { buddyId } = data;

  if (!buddyId) {
    throw new Error('Buddy ID is required');
  }

  // TODO: Integrate with payout system (Stripe Connect, Razorpay Route, etc.)
  logger.info(`Processing payout for buddy ${buddyId}...`);
}