// import Razorpay from 'razorpay';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { PaymentStatus, PaymentMethod } from '@prisma/client';
import { logger } from '../utils/logger';
// import { getRazorpay } from '../config/razorpay';
import { ApiError } from '../utils/errors';

export class PaymentService {
  // private rzp: Razorpay;

  // constructor() {
  //   this.rzp = getRazorpay();
  // }

  /**
   * Create Razorpay order for prepaid booking
   */
  async createRazorpayOrder(bookingId: string, amount: number, currency: string = 'INR') {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { user: true, service: true },
      });

      if (!booking) {
        throw new ApiError(404, 'Booking not found');
      }

      // const options = {
      //   amount: Math.round(amount * 100), // Amount in smallest currency unit (paise)
      //   currency: currency.toUpperCase(),
      //   receipt: booking.id,
      //   notes: {
      //     bookingId: booking.id,
      //     userId: booking.userId,
      //     service: booking.service.title,
      //   },
      // };

      // const order = await this.rzp.orders.create(options);

      // Create transaction record
      const razorpayOrderId = `rzp_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
      const transaction = await prisma.transaction.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          amount,
          currency,
          method: PaymentMethod.PREPAID,
          status: PaymentStatus.PENDING,
          razorpayOrderId: razorpayOrderId, //order.id
          metadata: {
            orderId:razorpayOrderId, //order.id
          },
        },
      });

      // logger.info(`Razorpay order created for booking ${bookingId}: ${order.id}`);

      return {
        transactionId: transaction.id,
        orderId: "1", //order.id
        amount: 100, //order.amount
        currency:"INR" , //order.currency
        keyId: process.env.RAZORPAY_KEY_ID, // Send key to client
      };
    } catch (error) {
      logger.error(`Error creating Razorpay order for booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Handle Razorpay webhook events
   */
  async handleWebhook(body: any, signature: string) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error('Razorpay webhook secret not configured');
      throw new ApiError(500, 'Webhook secret not configured');
    }

    // Verify signature
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(JSON.stringify(body));
    const digest = shasum.digest('hex');

    if (digest !== signature) {
      logger.warn('Invalid Razorpay webhook signature');
      throw new ApiError(400, 'Invalid signature');
    }

    // Process event
    const event = body.event;
    const payload = body.payload;

    try {
      switch (event) {
        case 'payment.captured':
          await this.handlePaymentSuccess(payload.payment.entity);
          break;
        case 'payment.failed':
          await this.handlePaymentFailure(payload.payment.entity);
          break;
        case 'order.paid':
          // You can also use this event
          logger.info(`Order paid: ${payload.order.entity.id}`);
          break;
        default:
          logger.info(`Unhandled Razorpay event type: ${event}`);
      }
    } catch (error) {
      logger.error('Error handling Razorpay webhook:', error);
      throw error;
    }
  }

  /**
   * Handle successful payment
   */
  private async handlePaymentSuccess(payment: any) {
    const orderId = payment.order_id;
    const bookingId = payment.notes?.bookingId;

    if (!orderId) {
      logger.error('No order ID in payment entity');
      return;
    }

    // Update transaction
    const transaction = await prisma.transaction.updateMany({
      where: { razorpayOrderId: orderId },
      data: {
        status: PaymentStatus.COMPLETED,
        razorpayPaymentId: payment.id,
        metadata: payment,
      },
    });

    if (transaction.count > 0 && bookingId) {
      // Update booking payment status
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
        },
      });
      logger.info(`Payment successful for booking ${bookingId}`);
    } else {
       logger.warn(`Could not find transaction for order ${orderId} or missing bookingId`);
    }
  }

  /**
   * Handle failed payment
   */
  private async handlePaymentFailure(payment: any) {
    const orderId = payment.order_id;
    const bookingId = payment.notes?.bookingId;

    if (!orderId) {
      return;
    }

    await prisma.transaction.updateMany({
      where: { razorpayOrderId: orderId },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: payment.error_description,
        metadata: payment,
      },
    });

    if (bookingId) {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PaymentStatus.FAILED,
        },
      });
    }

    logger.warn(`Payment failed for order ${orderId}: ${payment.error_description}`);
  }

  /**
   * Process refund
   */
  async processRefund(transactionId: string, amount?: number) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction || !transaction.razorpayPaymentId) {
        throw new ApiError(404,'Transaction not found or not a Razorpay payment');
      }

      // const refundAmount = amount ? Math.round(amount * 100) : undefined; // Amount in paise

      // Create refund in Razorpay
      // const refund = await this.rzp.payments.refund(transaction.razorpayPaymentId, {
      //   amount: refundAmount,
      //   speed: 'normal',
      // });

      // Update transaction
      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAmount: amount || transaction.amount,
          refundedAt: new Date(),
          metadata: {
            ...(transaction.metadata as any),
            refundId: "1" ,//refund.id,
            refundStatus:"processing" , //refund.status
          },
        },
      });

      // logger.info(`Refund processed for transaction ${transactionId}: ${refund.id}`);
      return 100;
    } catch (error) {
      logger.error(`Error processing refund for transaction ${transactionId}:`, error);
      throw error;
    }
  }

  /**
   * Record cash payment (after OTP verification)
   */
  async recordCashPayment(bookingId: string, amount: number) {
    // This logic remains the same as it doesn't involve a payment gateway
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { user: true },
      });

      if (!booking) {
        throw new ApiError(404, 'Booking not found');
      }

      const transaction = await prisma.transaction.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          amount,
          currency: booking.currency,
          method: PaymentMethod.CASH,
          status: PaymentStatus.COMPLETED,
        },
      });

      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
        },
      });

      logger.info(`Cash payment recorded for booking ${bookingId}`);
      return transaction;
    } catch (error) {
      logger.error(`Error recording cash payment for booking ${bookingId}:`, error);
      throw error;
    }
  }
}