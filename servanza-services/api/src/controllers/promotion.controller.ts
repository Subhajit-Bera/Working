import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { StorageService } from '../services/storage.service';

const storageService = new StorageService();

export const promotionController = {
    /**
     * GET /promotions
     * Public: returns active promotions within date range
     * Admin (?all=true): returns ALL promotions regardless of status
     */
    async getPromotions(req: Request, res: Response) {
        try {
            const showAll = req.query.all === 'true';
            const user = (req as any).user;
            const isAdmin = user && ['ADMIN', 'SUPER_ADMIN'].includes(user.role);

            if (showAll && isAdmin) {
                // Admin sees everything
                const promotions = await prisma.promotion.findMany({
                    orderBy: { displayOrder: 'asc' },
                });
                return res.json({ success: true, data: promotions });
            }

            // Public: only active + in date range
            const now = new Date();
            const promotions = await prisma.promotion.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { startDate: null },
                        { startDate: { lte: now } },
                    ],
                    AND: [
                        {
                            OR: [
                                { endDate: null },
                                { endDate: { gte: now } },
                            ],
                        },
                    ],
                },
                orderBy: { displayOrder: 'asc' },
            });

            return res.json({
                success: true,
                data: promotions,
            });
        } catch (error: any) {
            console.error('Get promotions error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch promotions',
            });
        }
    },

    /**
     * POST /promotions  (Admin only)
     */
    async createPromotion(req: Request, res: Response) {
        try {
            const { title, subtitle, imageUrl, ctaLabel, ctaLink, displayOrder, isActive, startDate, endDate } = req.body;

            if (!title) {
                return res.status(400).json({ success: false, message: 'title is required' });
            }

            const promotion = await prisma.promotion.create({
                data: {
                    title,
                    subtitle,
                    imageUrl: imageUrl || '',
                    ctaLabel: ctaLabel || 'Book Now',
                    ctaLink,
                    displayOrder: displayOrder ?? 0,
                    isActive: isActive !== undefined ? isActive : true,
                    startDate: startDate ? new Date(startDate) : null,
                    endDate: endDate ? new Date(endDate) : null,
                },
            });

            return res.status(201).json({ success: true, data: promotion });
        } catch (error: any) {
            console.error('Create promotion error:', error);
            return res.status(500).json({ success: false, message: 'Failed to create promotion' });
        }
    },

    /**
     * PUT /promotions/:id  (Admin only)
     */
    async updatePromotion(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const updates = req.body;

            const promotion = await prisma.promotion.update({
                where: { id },
                data: {
                    ...updates,
                    startDate: updates.startDate ? new Date(updates.startDate) : updates.startDate === null ? null : undefined,
                    endDate: updates.endDate ? new Date(updates.endDate) : updates.endDate === null ? null : undefined,
                },
            });

            return res.json({ success: true, data: promotion });
        } catch (error: any) {
            console.error('Update promotion error:', error);
            return res.status(500).json({ success: false, message: 'Failed to update promotion' });
        }
    },

    /**
     * DELETE /promotions/:id  (Admin only)
     */
    async deletePromotion(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await prisma.promotion.delete({ where: { id } });
            return res.json({ success: true, message: 'Promotion deleted' });
        } catch (error: any) {
            console.error('Delete promotion error:', error);
            return res.status(500).json({ success: false, message: 'Failed to delete promotion' });
        }
    },

    /**
     * POST /promotions/:id/image  (Admin only)
     */
    async uploadPromotionImage(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            const imageUrl = await storageService.uploadServiceAsset('promotion', id, req.file);

            const promotion = await prisma.promotion.update({
                where: { id },
                data: { imageUrl },
            });

            return res.json({
                success: true,
                data: { imageUrl: promotion.imageUrl },
                message: 'Promotion image uploaded successfully',
            });
        } catch (error: any) {
            console.error('Upload promotion image error:', error);
            return res.status(500).json({ success: false, message: 'Failed to upload promotion image' });
        }
    },
};
