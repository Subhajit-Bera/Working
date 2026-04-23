import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  body: z.object({
    bookingId: z.string().cuid(),
    amount: z.number().positive(),
    currency: z.string().length(3).default('INR'),
  }),
});

export const confirmPaymentSchema = z.object({
  body: z.object({
    paymentIntentId: z.string().min(1),
  }),
});
