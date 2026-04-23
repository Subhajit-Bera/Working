import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { FCMService } from '../services/fcm.service';

const authService = new AuthService();
const fcmService = new FCMService();

export class AuthController {
  async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, name, phone, role } = req.body;

      const result = await authService.signup({
        email,
        password,
        name,
        phone,
        role,
      });

      res.status(201).json({
        success: true,
        data: result,
        message: 'User registered successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      const result = await authService.login(email, password);

      res.json({
        success: true,
        data: result,
        message: 'Login successful',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin-only login - Only allows users with role ADMIN
   */
  async adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      const result = await authService.adminLogin(email, password);

      res.json({
        success: true,
        data: result,
        message: 'Admin login successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async sendPhoneOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { phone } = req.body;

      await authService.sendPhoneOTP(phone);

      res.json({
        success: true,
        message: 'OTP sent successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyPhoneOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { phone, otp, name, role } = req.body;

      const result = await authService.verifyPhoneOTP(phone, otp, name, role);

      res.json({
        success: true,
        data: result,
        message: 'Phone verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Firebase Phone Authentication
  async verifyFirebasePhone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken, role } = req.body;

      const result = await authService.verifyFirebasePhoneToken(idToken, role);

      res.json({
        success: true,
        data: result,
        message: 'Phone verified successfully via Firebase',
      });
    } catch (error) {
      next(error);
    }
  }

  // Unified Firebase Authentication (auto-detects provider)
  async verifyFirebaseToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken, role } = req.body;

      const result = await authService.verifyFirebaseToken(idToken, role);

      res.json({
        success: true,
        data: result,
        message: 'Firebase authentication successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async googleSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;

      const result = await authService.googleSignIn(idToken);

      res.json({
        success: true,
        data: result,
        message: 'Google sign-in successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async appleSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;

      const result = await authService.appleSignIn(idToken);

      res.json({
        success: true,
        data: result,
        message: 'Apple sign-in successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async facebookSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;

      const result = await authService.facebookSignIn(idToken);

      res.json({
        success: true,
        data: result,
        message: 'Facebook sign-in successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async twitterSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;

      const result = await authService.twitterSignIn(idToken);

      res.json({
        success: true,
        data: result,
        message: 'Twitter sign-in successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async linkFirebaseAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { firebaseIdToken } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
        return;
      }

      await authService.linkFirebaseAccount(userId, firebaseIdToken);

      res.json({
        success: true,
        message: 'Firebase account linked successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async unlinkFirebaseAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
        return;
      }

      await authService.unlinkFirebaseAccount(userId);

      res.json({
        success: true,
        message: 'Firebase account unlinked successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async registerFCMToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
        return;
      }

      await fcmService.registerDeviceToken(userId, token);

      res.json({
        success: true,
        message: 'FCM token registered successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async removeFCMToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
        return;
      }

      await fcmService.removeDeviceToken(userId, token);

      res.json({
        success: true,
        message: 'FCM token removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      const result = await authService.refreshToken(refreshToken);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.forgotPassword(email);

      res.json({
        success: true,
        message: 'Password reset email sent',
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = req.body;

      await authService.resetPassword(token, newPassword);

      res.json({
        success: true,
        message: 'Password reset successful',
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;

      await authService.verifyEmail(token);

      res.json({
        success: true,
        message: 'Email verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async resendVerificationEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.resendVerificationEmail(email);

      res.json({
        success: true,
        message: 'Verification email sent',
      });
    } catch (error) {
      next(error);
    }
  }

  async checkPhone(req: Request, res: Response): Promise<void> {
    try {
      const { phone, role } = req.body;
      const result = await authService.checkPhone(phone, role || 'BUDDY');

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  };
}