import { logger } from '../utils/logger';
import twilio from 'twilio';

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

if (!twilioClient) {
  logger.warn('Twilio not configured. SMS sending will be disabled.');
}

export class SMSService {
  /**
   * Send SMS
   */
  async sendSMS(to: string, message: string): Promise<void> {
    try {
      if (!twilioClient) {
        logger.warn(`Twilio not configured. SMS not sent. To: ${to}, Msg: ${message}`);
        return;
      }

      if (!process.env.TWILIO_PHONE_NUMBER) {
         logger.warn(`Twilio phone number not configured. SMS not sent. To: ${to}, Msg: ${message}`);
         return;
      }

      const result = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
      });

      logger.info(`SMS sent successfully: ${result.sid}`, { to });
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      // Do not throw, as this is a non-critical part of a job
    }
  }

  /**
   * Send booking reminder SMS
   */
  async sendBookingReminder(to: string, bookingData: any): Promise<void> {
    const message = `Reminder: Your service is scheduled for ${bookingData.scheduledTime}. Booking ID: ${bookingData.bookingId}. Servanza Services`;

    await this.sendSMS(to, message);
  }

  /**
   * Send buddy assignment SMS
   */
  async sendBuddyAssignment(to: string, buddyName: string): Promise<void> {
    const message = `Great news! ${buddyName} has been assigned to your booking. They will contact you shortly. Servanza Services`;

    await this.sendSMS(to, message);
  }

  /**
   * Send OTP SMS
   */
  async sendOTP(to: string, otp: string): Promise<void> {
    const message = `Your verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone. Servanza Services`;

    await this.sendSMS(to, message);
  }
}