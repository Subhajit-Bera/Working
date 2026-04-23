import { z } from 'zod';

const serviceDescriptionSchema = z.object({
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  whatsIncluded: z.array(z.string()).optional(),
  whatsNotIncluded: z.array(z.string()).optional(),
  productsWeUse: z.array(z.string()).optional(),
  productsNeededFromCustomer: z.array(z.string()).optional(),
});

export const createServiceSchema = z.object({
  body: z.object({
    categoryId: z.string().cuid(),
    title: z.string().min(3).max(200),
    description: z.union([z.string(), serviceDescriptionSchema]).optional(),
    durationMins: z.number().int().min(15).max(480),
    basePrice: z.number().positive(),
    currency: z.string().length(3).default('INR'),
    imageUrl: z.string().url().optional(),
    isActive: z.boolean().default(true),
    metadata: z.any().optional(),
  }),
});

export const updateServiceSchema = z.object({
  body: z.object({
    categoryId: z.string().cuid().optional(),
    title: z.string().min(3).max(200).optional(),
    description: z.union([z.string(), serviceDescriptionSchema]).optional(),
    durationMins: z.number().int().min(15).max(480).optional(),
    basePrice: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    imageUrl: z.string().url().optional(),
    isActive: z.boolean().optional(),
    metadata: z.any().optional(),
  }),
});
