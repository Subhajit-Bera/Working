import { z } from 'zod';

export const signupSchema = z.object({
  body: z.object({
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    name: z.string().min(2).max(100),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
    role: z.enum(['USER', 'BUDDY', 'ADMIN']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const phoneOTPSchema = z.object({
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  }),
});

export const verifyOTPSchema = z.object({
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
    otp: z.string().length(6),
    name: z.string().min(2).max(100).optional(),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
    profileImage: z.string().url().optional(),
  }),
});

export const addAddressSchema = z.object({
  body: z.object({
    label: z.string().min(1).max(50),
    formattedAddress: z.string().min(5).max(500),
    streetAddress: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2).default('IN'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    isDefault: z.boolean().optional(),
  }),
});
