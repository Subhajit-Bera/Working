import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { PaymentService } from '../services/payment.service';
import { logger } from '../utils/logger';

const router = Router();
const paymentService = new PaymentService();

// --- Razorpay Webhook ---
// router.post(
//   '/razorpay',
//   express.json(), // Use express.json for Razorpay
//   async (req: Request, res: Response, next: NextFunction) => {
//     const signature = req.headers['x-razorpay-signature'] as string;
    
//     if (!signature) {
//       logger.warn('Razorpay webhook missing signature');
//       return res.status(400).send('Signature missing');
//     }

//     try {
//       await paymentService.handleWebhook(req.body, signature);
//       res.json({ status: 'ok' });
//     } catch (error) {
//       logger.error('Error processing Razorpay webhook:', error);
//       next(error); // Let error handler deal with it
//     }
//   }
// );

//CGPT
router.post(
  '/razorpay',
  express.json(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!signature) {
      logger.warn('Razorpay webhook missing signature');
      res.status(400).send('Signature missing');
      return;
    }

    try {
      await paymentService.handleWebhook(req.body, signature);
      res.json({ status: 'ok' });
      return;
    } catch (error) {
      logger.error('Error processing Razorpay webhook:', error);
      next(error);
      return;
    }
  }
);

export default router;