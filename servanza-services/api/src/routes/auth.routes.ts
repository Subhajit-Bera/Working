import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import {
  signupSchema,
  loginSchema,
  phoneOTPSchema,
  verifyOTPSchema,
  refreshTokenSchema,
} from '../validators/user.validator';
import { checkPhoneSchema } from '../validators/buddy.validator';
import { z } from 'zod';

const router = Router();
const authController = new AuthController();


//Phone number exist : only for checking during buddy account creation
router.post('/check-phone', validateRequest(checkPhoneSchema), authController.checkPhone);

// Email/Password authentication
router.post('/signup', validateRequest(signupSchema), authController.signup);
router.post('/login', validateRequest(loginSchema), authController.login);

// Admin-only login (used by admin dashboard)
router.post('/admin/login', validateRequest(loginSchema), authController.adminLogin);

// Phone OTP authentication (Legacy - for backward compatibility)
router.post('/phone/send-otp', validateRequest(phoneOTPSchema), authController.sendPhoneOTP);
router.post('/phone/verify-otp', validateRequest(verifyOTPSchema), authController.verifyPhoneOTP);

// Firebase Phone Authentication (NEW - Recommended)
const firebasePhoneSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Firebase ID token is required'),
    role: z.enum(['USER', 'BUDDY', 'ADMIN']).optional(),
  }),
});

router.post('/phone/firebase', validateRequest(firebasePhoneSchema), authController.verifyFirebasePhone);

// Unified Firebase Authentication (auto-detects provider: email, Google, Apple, phone, etc.)
const unifiedFirebaseSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Firebase ID token is required'),
    role: z.enum(['USER', 'BUDDY', 'ADMIN']).optional(),
  }),
});

router.post('/firebase', validateRequest(unifiedFirebaseSchema), authController.verifyFirebaseToken);

// Firebase Auth Providers
const firebaseIdTokenSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'ID token is required'),
  }),
});

router.post('/google', validateRequest(firebaseIdTokenSchema), authController.googleSignIn);
router.post('/apple', validateRequest(firebaseIdTokenSchema), authController.appleSignIn);
router.post('/facebook', validateRequest(firebaseIdTokenSchema), authController.facebookSignIn);
router.post('/twitter', validateRequest(firebaseIdTokenSchema), authController.twitterSignIn);

// Account Linking
const linkAccountSchema = z.object({
  body: z.object({
    firebaseIdToken: z.string().min(1, 'Firebase ID token is required'),
  }),
});

router.post('/link-firebase', authenticate, validateRequest(linkAccountSchema), authController.linkFirebaseAccount);
router.post('/unlink-firebase', authenticate, authController.unlinkFirebaseAccount);

// FCM Token Management
const fcmTokenSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'FCM token is required'),
  }),
});

router.post('/fcm/register', authenticate, validateRequest(fcmTokenSchema), authController.registerFCMToken);
router.post('/fcm/remove', authenticate, validateRequest(fcmTokenSchema), authController.removeFCMToken);

// Token refresh
router.post('/refresh-token', validateRequest(refreshTokenSchema), authController.refreshToken);

// Password reset
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Email verification
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

export default router;
