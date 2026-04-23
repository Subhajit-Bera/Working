import { prisma } from '../config/database';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import twilio from 'twilio';
import { ApiError } from '../utils/errors';

export class OTPService {
  private twilioClient: twilio.Twilio | null = null;

  constructor() {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }
  }

  /**
   * Generate and send OTP for booking completion
   */
  async generateOTPForBooking(bookingId: string, phone: string): Promise<void> {
    // Generate 6-digit OTP
    const otp = this.generateOTP(6);
    const otpHash = this.hashOTP(otp);

    // Store in database
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiry

    await prisma.otpVerification.upsert({
      where: { bookingId },
      update: {
        phone,
        otpHash,
        otp: process.env.NODE_ENV === 'development' ? otp : undefined,
        expiresAt,
        isUsed: false,
        usedAt: null,
        attempts: 0,
      },
      create: {
        bookingId,
        phone,
        otpHash,
        otp: process.env.NODE_ENV === 'development' ? otp : undefined, // Store plaintext only in dev
        expiresAt,
        maxAttempts: 3,
      },
    });

    // Send OTP via SMS
    if (this.twilioClient) {
      try {
        await this.twilioClient.messages.create({
          body: `Your OTP for service completion is: ${otp}. Valid for 10 minutes.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone,
        });
        logger.info(`OTP sent to ${phone} for booking ${bookingId}`);
      } catch (error) {
        logger.error(`Failed to send OTP via Twilio:`, error);
        throw new ApiError(500, 'Failed to send OTP');
      }
    } else {
      logger.warn(`OTP generated but not sent (Twilio not configured): ${otp}`);
    }
  }

  /**
   * Verify OTP for booking completion
   */
  async verifyOTP(bookingId: string, otpInput: string): Promise<boolean> {
    const otpRecord = await prisma.otpVerification.findUnique({
      where: { bookingId },
    });

    if (!otpRecord) {
      throw new ApiError(404, 'OTP not found for this booking. Please resend.');
    }

    if (otpRecord.isUsed) {
      throw new ApiError(400, 'OTP already used');
    }

    if (new Date() > otpRecord.expiresAt) {
      throw new ApiError(400, 'OTP expired. Please resend.');
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      throw new ApiError(400, 'Maximum OTP attempts exceeded. Please resend.');
    }

    // Increment attempts
    await prisma.otpVerification.update({
      where: { bookingId },
      data: { attempts: { increment: 1 } },
    });

    // Verify OTP
    const otpHash = this.hashOTP(otpInput);
    const isValid = otpHash === otpRecord.otpHash;

    if (isValid) {
      // Mark as used
      await prisma.otpVerification.update({
        where: { bookingId },
        data: {
          isUsed: true,
          usedAt: new Date(),
        },
      });
    }

    return isValid;
  }

  /**
   * Generate random OTP
   */
  private generateOTP(length: number): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return '123456'; // For testing, override later
    // return otp;
  }

  /**
   * Hash OTP for secure storage
   */
  private hashOTP(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Resend OTP
   */
  async resendOTP(bookingId: string, phone: string): Promise<void> {
    const existingOTP = await prisma.otpVerification.findUnique({
      where: { bookingId },
    });

    if (existingOTP) {
       if (existingOTP.isUsed) {
        throw new ApiError(400, 'OTP already used');
      }
      // Check for rate limiting (e.g., allow resend only after 1 min)
    }

    // Generate and send a new OTP
    await this.generateOTPForBooking(bookingId, phone);
  }
}