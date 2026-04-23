import { Request, Response, NextFunction } from 'express'; //Use standard Request
import { PaymentService } from '../services/payment.service';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { PaymentStatus } from '@prisma/client';

const paymentService = new PaymentService();

export class PaymentController {
  async createPaymentOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { bookingId } = req.body;
      const userId = req.user!.id;

      const booking = await (await import('../config/database')).prisma.booking.findFirst({
        where: { id: bookingId, userId }
      });
      if (!booking) {
        throw new ApiError(404, 'Booking not found or does not belong to user');
      }

      const order = await paymentService.createRazorpayOrder(booking.id, booking.totalAmount, booking.currency);
      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }

  async confirmPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { razorpay_payment_id, razorpay_order_id } = req.body;
      logger.info(`Client confirming payment for order ${razorpay_order_id}`, { paymentId: razorpay_payment_id });
      res.json({
        success: true,
        message: 'Payment confirmation received. Awaiting webhook for final status.',
      });
    } catch (error) {
      next(error);
    }
  }

  async getPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user!.id;
      const { prisma } = await import('../config/database');
      const transaction = await prisma.transaction.findFirst({
        where: { bookingId, userId },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      next(error);
    }
  }

  async getPaymentHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { page = 1, limit = 10 } = req.query;
      const { prisma } = await import('../config/database');
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where: { userId },
          include: { booking: { include: { service: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
        }),
        prisma.transaction.count({ where: { userId } })
      ]);
      res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async requestRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { transactionId } = req.params;
      const { amount } = req.body;
      const userId = req.user!.id;
      const { prisma } = await import('../config/database');
      const transaction = await prisma.transaction.findFirst({
        where: { id: transactionId, userId },
      });
      if (!transaction) {
        throw new ApiError(404, 'Transaction not found');
      }
      if (transaction.status !== PaymentStatus.COMPLETED) {
        throw new ApiError(400, 'Cannot refund a non-completed transaction');
      }
      const refund = await paymentService.processRefund(transactionId, amount);
      res.json({
        success: true,
        data: refund,
        message: 'Refund processed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}