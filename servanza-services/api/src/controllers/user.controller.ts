import { Response, NextFunction } from 'express';
import { Request } from 'express';
import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';
import { removeUndefined } from '../utils/helpers';

export class UserController {
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          role: true,
          adminRole: true,
          profileImage: true,
          emailVerified: true,
          phoneVerified: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { name, profileImage, email, phone } = req.body;

      const updateData = removeUndefined({
        name,
        profileImage,
        email,
        phone,
      });

      const user = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          role: true,
          profileImage: true,
        },
      });

      res.json({ success: true, data: user, message: 'Profile updated' });
    } catch (error) {
      next(error);
    }
  }

  async deleteAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      // Soft delete by deactivating
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      res.json({ success: true, message: 'Account deactivated' });
    } catch (error) {
      next(error);
    }
  }

  async getAddresses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const addresses = await prisma.address.findMany({
        where: { userId },
        orderBy: { isDefault: 'desc' },
      });
      res.json({ success: true, data: addresses });
    } catch (error) {
      next(error);
    }
  }

  async addAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { isDefault, latitude, longitude, ...addressData } = req.body;

      let newAddress: any;

      await prisma.$transaction(async (tx: any) => {
        if (isDefault) {
          await tx.address.updateMany({
            where: { userId },
            data: { isDefault: false },
          });
        }

        // 1. Create the address without the PostGIS data
        newAddress = await tx.address.create({
          data: {
            userId,
            ...addressData,
            latitude,
            longitude,
            isDefault: isDefault || false,
          },
        });

        // 2. Update the PostGIS data using a raw query
        const locationGeo = `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
        await tx.$executeRawUnsafe(
          `UPDATE "addresses" SET "location" = ${locationGeo} WHERE id = $1`,
          newAddress.id
        );
      });

      res.status(201).json({ success: true, data: newAddress });

    } catch (error) {
      next(error);
    }
  }

  async updateAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const { isDefault, latitude, longitude, ...addressData } = req.body;

      let updatedAddress: any;

      await prisma.$transaction(async (tx: any) => {
        if (isDefault) {
          await tx.address.updateMany({
            where: { userId },
            data: { isDefault: false },
          });
        }

        // 1. Update the normal data
        updatedAddress = await tx.address.update({
          where: { id, userId },
          data: {
            ...addressData,
            latitude,
            longitude,
            isDefault: isDefault,
          },
        });

        // 2. If lat/lng were provided, update the PostGIS data
        if (latitude && longitude) {
          const locationGeo = `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
          await tx.$executeRawUnsafe(
            `UPDATE "addresses" SET "location" = ${locationGeo} WHERE id = $1`,
            id
          );
        }
      });

      res.json({ success: true, data: updatedAddress });

    } catch (error) {
      next(error);
    }
  }

  async deleteAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      await prisma.address.delete({
        where: { id, userId },
      });

      res.json({ success: true, message: 'Address deleted' });
    } catch (error) {
      next(error);
    }
  }

  async setDefaultAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      await prisma.$transaction(async (tx: any) => {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
        await tx.address.update({
          where: { id, userId },
          data: { isDefault: true },
        });
      });

      res.json({ success: true, message: 'Default address updated' });
    } catch (error) {
      next(error);
    }
  }

  async registerDeviceToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { token } = req.body;

      if (!token) {
        throw new ApiError(400, 'Device token is required');
      }

      // Replace all tokens with just the current one
      // This is the simplest approach for mobile apps where each user typically has one device
      // For multi-device support, you'd want to use 'push' and implement token cleanup
      await prisma.user.update({
        where: { id: userId },
        data: {
          deviceTokens: {
            set: [token], // Replace with only the current token
          },
        },
      });

      res.json({ success: true, message: 'Token registered' });
    } catch (error) {
      next(error);
    }
  }

  async unregisterDeviceToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { token } = req.body;
      if (!token) {
        throw new ApiError(400, 'Device token is required');
      }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { deviceTokens: true } });

      const newTokens = user?.deviceTokens.filter((t: any) => t !== token) || [];

      await prisma.user.update({
        where: { id: userId },
        data: {
          deviceTokens: {
            set: newTokens,
          },
        },
      });

      res.json({ success: true, message: 'Token unregistered' });
    } catch (error) {
      next(error);
    }
  }

  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { page = 1, limit = 20 } = req.query;

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
        }),
        prisma.notification.count({ where: { userId } })
      ]);

      res.json({
        success: true, data: {
          notifications,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async markNotificationRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const notification = await prisma.notification.update({
        where: { id, userId },
        data: { isRead: true, readAt: new Date() },
      });

      res.json({ success: true, data: notification });
    } catch (error) {
      next(error);
    }
  }

  async markAllNotificationsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      next(error);
    }
  }

  // Notification Preferences
  async getNotificationPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { metadata: true },
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const prefs = (user.metadata as any)?.notificationPreferences || {
        push: true,
        email: true,
        sms: false,
        marketing: false,
      };

      res.json({ success: true, data: prefs });
    } catch (error) {
      next(error);
    }
  }

  async updateNotificationPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const newPrefs = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { metadata: true },
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const existingMetadata = (user.metadata as Record<string, any>) || {};
      const updatedMetadata = {
        ...existingMetadata,
        notificationPreferences: {
          ...(existingMetadata.notificationPreferences || {}),
          ...newPrefs,
        },
      };

      await prisma.user.update({
        where: { id: userId },
        data: { metadata: updatedMetadata },
      });

      res.json({ success: true, data: updatedMetadata.notificationPreferences, message: 'Preferences updated' });
    } catch (error) {
      next(error);
    }
  }

  // Favorites / Wishlist
  async getFavorites(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;

      const favorites = await prisma.favorite.findMany({
        where: { userId },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: favorites });
    } catch (error) {
      next(error);
    }
  }

  async addFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { serviceId } = req.body;

      if (!serviceId) {
        throw new ApiError(400, 'Service ID is required');
      }

      // Check if service exists
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) {
        throw new ApiError(404, 'Service not found');
      }

      // Upsert to handle duplicate favorites gracefully
      const favorite = await prisma.favorite.upsert({
        where: {
          userId_serviceId: { userId, serviceId },
        },
        update: {}, // Already exists, do nothing
        create: { userId, serviceId },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      });

      res.status(201).json({ success: true, data: favorite });
    } catch (error) {
      next(error);
    }
  }

  async removeFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { serviceId } = req.params;

      await prisma.favorite.deleteMany({
        where: { userId, serviceId },
      });

      res.json({ success: true, message: 'Removed from favorites' });
    } catch (error) {
      next(error);
    }
  }

  async checkFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { serviceId } = req.params;

      const favorite = await prisma.favorite.findUnique({
        where: {
          userId_serviceId: { userId, serviceId },
        },
      });

      res.json({ success: true, data: { isFavorite: !!favorite } });
    } catch (error) {
      next(error);
    }
  }
}