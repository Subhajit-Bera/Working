import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '../utils/errors';

const prisma = new PrismaClient();

// Validate a coupon code (public - for customers)
export const validateCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code } = req.body;

        if (!code) {
            throw new ApiError(400, 'Coupon code is required');
        }

        const coupon = await prisma.coupon.findUnique({
            where: { code: code.toUpperCase() },
        });

        if (!coupon) {
            throw new ApiError(404, 'Invalid coupon code');
        }

        if (!coupon.isActive) {
            throw new ApiError(400, 'This coupon is no longer active');
        }

        if (new Date() > coupon.expiresAt) {
            throw new ApiError(400, 'This coupon has expired');
        }

        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            throw new ApiError(400, 'This coupon has reached its usage limit');
        }

        res.json({
            success: true,
            data: {
                code: coupon.code,
                name: coupon.name,
                description: coupon.description,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
                minOrderAmount: coupon.minOrderAmount,
                maxDiscount: coupon.maxDiscount,
                isActive: true,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Get available coupons (public - for customers)
export const getAvailableCoupons = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const coupons = await prisma.coupon.findMany({
            where: {
                isActive: true,
                expiresAt: { gt: new Date() },
            },
            select: {
                id: true,
                code: true,
                name: true,
                description: true,
                discountType: true,
                discountValue: true,
                minOrderAmount: true,
                maxDiscount: true,
                expiresAt: true,
                usageLimit: true,
                usedCount: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Filter out coupons that have exceeded their usage limit
        const availableCoupons = coupons.filter(c =>
            c.usageLimit === null || c.usedCount < c.usageLimit
        );

        res.json({ success: true, data: availableCoupons });
    } catch (error) {
        next(error);
    }
};

// Admin: Create a coupon
export const createCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code, name, description, discountType, discountValue, minOrderAmount, maxDiscount, expiresAt, usageLimit } = req.body;

        if (!code || !name || !discountValue || !expiresAt) {
            throw new ApiError(400, 'Code, name, discount value, and expiry date are required');
        }

        // Check for duplicate code
        const existing = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
        if (existing) {
            throw new ApiError(409, 'A coupon with this code already exists');
        }

        const coupon = await prisma.coupon.create({
            data: {
                code: code.toUpperCase(),
                name,
                description,
                discountType: discountType || 'PERCENTAGE',
                discountValue: parseFloat(discountValue),
                minOrderAmount: minOrderAmount ? parseFloat(minOrderAmount) : null,
                maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
                expiresAt: new Date(expiresAt),
                usageLimit: usageLimit ? parseInt(usageLimit) : null,
            },
        });

        res.status(201).json({ success: true, data: coupon });
    } catch (error) {
        next(error);
    }
};

// Admin: Update a coupon
export const updateCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, description, discountType, discountValue, minOrderAmount, maxDiscount, expiresAt, isActive, usageLimit } = req.body;

        const coupon = await prisma.coupon.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(discountType !== undefined && { discountType }),
                ...(discountValue !== undefined && { discountValue: parseFloat(discountValue) }),
                ...(minOrderAmount !== undefined && { minOrderAmount: minOrderAmount ? parseFloat(minOrderAmount) : null }),
                ...(maxDiscount !== undefined && { maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null }),
                ...(expiresAt !== undefined && { expiresAt: new Date(expiresAt) }),
                ...(isActive !== undefined && { isActive }),
                ...(usageLimit !== undefined && { usageLimit: usageLimit ? parseInt(usageLimit) : null }),
            },
        });

        res.json({ success: true, data: coupon });
    } catch (error) {
        next(error);
    }
};

// Admin: Delete a coupon
export const deleteCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        await prisma.coupon.delete({ where: { id } });
        res.json({ success: true, message: 'Coupon deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// Admin: Get all coupons
export const getAllCoupons = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: coupons });
    } catch (error) {
        next(error);
    }
};
