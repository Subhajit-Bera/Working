import { z } from 'zod';

export const createBookingSchema = z.object({
  body: z.object({
    serviceId: z.string().cuid(),
    addressId: z.string().cuid(),
    scheduledStart: z.string().datetime(),
    isImmediate: z.boolean().optional(),
    paymentMethod: z.enum(['PREPAID', 'CASH']),
    specialInstructions: z.string().max(500).optional(),
  }),
});

export const updateBookingSchema = z.object({
  body: z.object({
    scheduledStart: z.string().datetime().optional(),
    specialInstructions: z.string().max(500).optional(),
  }),
});

export const cancelBookingSchema = z.object({
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

export const reviewSchema = z.object({
  body: z.object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().min(10).max(500).optional(),
  }).refine(
    (data) => data.rating !== undefined || (data.comment !== undefined && data.comment.trim().length > 0),
    { message: 'Either a rating or a comment is required' }
  ),
});
