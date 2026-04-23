import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
  }>;
}

export class EmailService {
  /**
   * Send email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || '"Servanza" <noreply@servanza.com>',
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      };

      if (!process.env.SMTP_USER) {
        logger.warn(`SMTP not configured. Skipping email to ${options.to}: ${options.subject}`);
        logger.info(`Email body (text): ${options.text}`);
        return;
      }

      const info = await transporter.sendMail(mailOptions);

      logger.info(`Email sent successfully: ${info.messageId}`, {
        to: options.to,
        subject: options.subject,
      });
    } catch (error) {
      logger.error('Failed to send email:', error);
      throw error;
    }
  }

  /**
   * Send booking confirmation email
   */
  async sendBookingConfirmation(to: string, bookingData: any): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .booking-details { background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmed!</h1>
          </div>
          <div class="content">
            <p>Hello ${bookingData.userName},</p>
            <p>Your booking has been confirmed. Here are the details:</p>
            
            <div class="booking-details">
              <div class="detail-row">
                <span class="label">Booking ID:</span> ${bookingData.bookingId}
              </div>
              <div class="detail-row">
                <span class="label">Service:</span> ${bookingData.serviceName}
              </div>
              <div class="detail-row">
                <span class="label">Scheduled Time:</span> ${bookingData.scheduledTime}
              </div>
              <div class="detail-row">
                <span class="label">Address:</span> ${bookingData.address}
              </div>
              <div class="detail-row">
                <span class="label">Total Amount:</span> ₹${bookingData.totalAmount}
              </div>
            </div>
            
            <p>We'll notify you when a service buddy is assigned to your booking.</p>
            <p>Thank you for choosing our service!</p>
          </div>
          <div class="footer">
            <p>If you have any questions, please contact us at support@servicemarketplace.com</p>
            <p>&copy; 2025 Service Marketplace. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Booking Confirmation - Service Marketplace',
      html,
    });
  }

  /**
   * Send booking completion email
   */
  async sendBookingCompletion(to: string, bookingData: any): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .rating { text-align: center; margin: 30px 0; }
          .button { display: inline-block; padding: 12px 30px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Service Completed!</h1>
          </div>
          <div class="content">
            <p>Hello ${bookingData.userName},</p>
            <p>Your service has been completed successfully.</p>
            <p><strong>Booking ID:</strong> ${bookingData.bookingId}</p>
            <p><strong>Service:</strong> ${bookingData.serviceName}</p>
            
            <div class="rating">
              <h3>How was your experience?</h3>
              <p>Please take a moment to rate your service buddy</p>
              <a href="${bookingData.ratingUrl}" class="button">Rate Now</a>
            </div>
            
            <p>Thank you for using our service!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Service Completed - Service Marketplace',
      html,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password. Click the button below to reset it:</p>
          <p style="margin: 30px 0; text-align: center;">
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 30px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">
              Reset Password
            </a>
          </p>
          <p>Or copy and paste this link in your browser:</p>
          <p style="color: #666; word-break: break-all;">${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, please ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Password Reset - Service Marketplace',
      html,
      text: `Reset your password here: ${resetUrl}`,
    });
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(to: string, verificationToken: string): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify-email?token=${verificationToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Verify Your Email Address</h2>
          <p>Welcome to Servanza! Please click the button below to verify your email address:</p>
          <p style="margin: 30px 0; text-align: center;">
            <a href="${verificationUrl}" style="display: inline-block; padding: 12px 30px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 5px;">
              Verify Email
            </a>
          </p>
          <p>Or copy and paste this link in your browser:</p>
          <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
          <p>If you didn't create an account, please ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Verify Your Email - Service Marketplace',
      html,
      text: `Verify your email here: ${verificationUrl}`,
    });
  }
}