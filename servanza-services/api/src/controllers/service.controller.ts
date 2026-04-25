import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';
import { StorageService } from '../services/storage.service';

const storageService = new StorageService();

export class ServiceController {
  async getCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          services: {
            where: { isActive: true },
            select: { id: true, title: true } // Only include basic service info
          }
        }
      });
      res.json({ success: true, data: categories });
    } catch (error) {
      next(error);
    }
  }

  async getCategoryBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { slug } = req.params;
      const category = await prisma.category.findUnique({
        where: { slug, isActive: true },
        include: {
          services: {
            where: { isActive: true },
            orderBy: { title: 'asc' }
          },
        },
      });

      if (!category) {
        throw new ApiError(404, 'Category not found');
      }

      res.json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  }

  async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await prisma.category.create({
        data: req.body,
      });
      res.status(201).json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  }

  async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const category = await prisma.category.update({
        where: { id },
        data: req.body,
      });
      res.json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  }

  async deleteCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      // Check if services are attached first
      await prisma.category.delete({
        where: { id },
      });
      res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
      next(error);
    }
  }

  async getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { categoryId } = req.query;
      const where: any = { isActive: true };

      if (categoryId) {
        where.categoryId = categoryId as string;
      }

      const services = await prisma.service.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true }
          },
        },
      });

      // Compute average rating and total reviews for each service
      const serviceIds = services.map((s: any) => s.id);
      const reviewStats = await prisma.review.groupBy({
        by: ['bookingId'],
        where: {
          booking: { serviceId: { in: serviceIds } },
        },
        _avg: { rating: true },
        _count: { rating: true },
      });

      // Build a map of serviceId -> { avg, count } via bookings
      const bookingsWithService = await prisma.booking.findMany({
        where: { serviceId: { in: serviceIds } },
        select: { id: true, serviceId: true },
      });
      const bookingToService = new Map(bookingsWithService.map((b: any) => [b.id, b.serviceId]));

      const statsMap: Record<string, { totalRating: number; count: number }> = {};
      for (const stat of reviewStats) {
        const svcId = bookingToService.get(stat.bookingId);
        if (!svcId) continue;
        if (!statsMap[svcId]) statsMap[svcId] = { totalRating: 0, count: 0 };
        statsMap[svcId].totalRating += (stat._avg.rating || 0) * stat._count.rating;
        statsMap[svcId].count += stat._count.rating;
      }

      const enrichedServices = services.map((s: any) => {
        const stats = statsMap[s.id];
        return {
          ...s,
          averageRating: stats ? Math.round((stats.totalRating / stats.count) * 10) / 10 : null,
          totalReviews: stats ? stats.count : 0,
        };
      });

      res.json({ success: true, data: enrichedServices });
    } catch (error) {
      next(error);
    }
  }

  async getTrendingServices(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Find top 4 services by number of bookings (using group by)
      const popularBookings = await prisma.booking.groupBy({
        by: ['serviceId'],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: 'desc',
          },
        },
        take: 4,
      });

      const serviceIds = popularBookings.map((b) => b.serviceId);

      let trendingServices = [];
      if (serviceIds.length > 0) {
        trendingServices = await prisma.service.findMany({
          where: {
            id: { in: serviceIds },
            isActive: true,
          },
          include: {
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        });
      } else {
        // Fallback if no bookings: just return 4 active services
        trendingServices = await prisma.service.findMany({
          where: { isActive: true },
          take: 4,
          include: {
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        });
      }

      res.json({ success: true, data: trendingServices });
    } catch (error) {
      next(error);
    }
  }

  async getServiceById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const service = await prisma.service.findUnique({
        where: { id, isActive: true },
        include: {
          category: true,
        },
      });

      if (!service) {
        throw new ApiError(404, 'Service not found');
      }

      // Compute review stats for this service
      const reviewAgg = await prisma.review.aggregate({
        where: {
          booking: { serviceId: id },
        },
        _avg: { rating: true },
        _count: { rating: true },
      });

      const enrichedService = {
        ...service,
        averageRating: reviewAgg._avg.rating ? Math.round(reviewAgg._avg.rating * 10) / 10 : null,
        totalReviews: reviewAgg._count.rating || 0,
      };

      res.json({ success: true, data: enrichedService });
    } catch (error) {
      next(error);
    }
  }

  async getSimilarServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const service = await prisma.service.findUnique({
        where: { id },
        select: { categoryId: true },
      });

      if (!service) {
        throw new ApiError(404, 'Service not found');
      }

      const similarServices = await prisma.service.findMany({
        where: {
          categoryId: service.categoryId,
          id: { not: id },
          isActive: true,
        },
        take: 4,
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
        },
      });

      res.json({ success: true, data: similarServices });
    } catch (error) {
      next(error);
    }
  }

  async getServiceReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = Number(page);
      const limitNum = Number(limit);

      // Get all bookings for this service, then get reviews
      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where: {
            booking: { serviceId: id },
          },
          include: {
            user: {
              select: { id: true, name: true, profileImage: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.review.count({
          where: {
            booking: { serviceId: id },
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          reviews,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async createService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = await prisma.service.create({
        data: req.body,
      });
      res.status(201).json({ success: true, data: service });
    } catch (error) {
      next(error);
    }
  }

  async updateService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const service = await prisma.service.update({
        where: { id },
        data: req.body,
      });
      res.json({ success: true, data: service });
    } catch (error) {
      next(error);
    }
  }

  async deleteService(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await prisma.service.delete({
        where: { id },
      });
      res.json({ success: true, message: 'Service deleted' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload service image (Single)
   */
  async uploadServiceImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      // Upload to R2
      const imageUrl = await storageService.uploadServiceAsset('service', id, req.file);

      // Update service in database
      const service = await prisma.service.update({
        where: { id },
        data: { imageUrl },
      });

      res.json({
        success: true,
        data: { imageUrl: service.imageUrl },
        message: 'Service image uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload service images (Multiple)
   */
  async uploadServiceImages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        throw new ApiError(400, 'No files uploaded');
      }

      // Get current service to append to existing imageUrls
      const currentService = await prisma.service.findUnique({
        where: { id },
        select: { imageUrls: true },
      });

      if (!currentService) {
        throw new ApiError(404, 'Service not found');
      }

      // Upload all files to R2 in parallel
      const uploadPromises = req.files.map((file: Express.Multer.File) => 
        storageService.uploadServiceAsset('service', id, file)
      );
      const newImageUrls = await Promise.all(uploadPromises);

      // Combine existing and new URLs
      const combinedImageUrls = [...(currentService.imageUrls || []), ...newImageUrls];

      // Update service in database
      const service = await prisma.service.update({
        where: { id },
        data: { imageUrls: combinedImageUrls },
      });

      res.json({
        success: true,
        data: { imageUrls: service.imageUrls },
        message: 'Service images uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }


  /**
   * Upload category icon
   */
  async uploadCategoryIcon(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      // Upload to R2
      const iconUrl = await storageService.uploadServiceAsset('category', id, req.file);

      // Update category in database
      const category = await prisma.category.update({
        where: { id },
        data: { icon: iconUrl },
      });

      res.json({
        success: true,
        data: { icon: category.icon },
        message: 'Category icon uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}