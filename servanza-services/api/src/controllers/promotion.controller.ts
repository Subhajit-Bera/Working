import { Request, Response } from 'express';
import { prisma } from '../config/database';

export const promotionController = {
    /**
     * GET /promotions
     * Returns all active promotions ordered by displayOrder
     */
    async getPromotions(req: Request, res: Response) {
        try {
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
            const { title, subtitle, imageUrl, ctaLabel, ctaLink, displayOrder, startDate, endDate } = req.body;

            if (!title || !imageUrl) {
                return res.status(400).json({ success: false, message: 'title and imageUrl are required' });
            }

            const promotion = await prisma.promotion.create({
                data: {
                    title,
                    subtitle,
                    imageUrl,
                    ctaLabel: ctaLabel || 'Book Now',
                    ctaLink,
                    displayOrder: displayOrder ?? 0,
                    isActive: true,
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
                    startDate: updates.startDate ? new Date(updates.startDate) : undefined,
                    endDate: updates.endDate ? new Date(updates.endDate) : undefined,
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
};
