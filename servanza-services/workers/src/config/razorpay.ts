import Razorpay from 'razorpay';
import { logger } from '../utils/logger';

let razorpayInstance: Razorpay | null = null;

export function initializeRazorpay(): Razorpay | null {
  try {
    if (razorpayInstance) {
      return razorpayInstance;
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      logger.warn('Razorpay credentials not configured. Payment features will be disabled.');
      return null;
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    logger.info('Razorpay initialized successfully');

    return razorpayInstance;
  } catch (error) {
    logger.error('Failed to initialize Razorpay:', error);
    return null;
  }
}

export function getRazorpay(): Razorpay | null{
  // if (!razorpayInstance) {
  //   const rzp = initializeRazorpay();
  //   if (!rzp) {
  //     throw new Error('Razorpay not initialized');
  //   }
  //   return rzp;
  // }
  return razorpayInstance;
}