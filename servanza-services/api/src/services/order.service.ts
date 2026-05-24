import { PrismaClient, PaymentMethod, PaymentStatus, BookingStatus } from '@prisma/client';
import { ApiError } from '../utils/errors';
import { BookingService } from './booking.service';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface CreateOrderData {
  items: { serviceId: string; quantity: number; variantId?: string }[];
  addressId: string;
  scheduledStart: Date | string;
  isImmediate?: boolean;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
  contactPhone?: string;
  couponCode?: string;
}

export class OrderService {
  private bookingService: BookingService;

  constructor() {
    this.bookingService = new BookingService();
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }

  /**
   * Resolve price, duration, and payouts for an item.
   * If variantId is present and found in service.metadata.variants, use variant values.
   * Otherwise, fall back to base service values.
   */
  private resolveItemValues(service: any, variantId?: string) {
    const base = {
      price: service.basePrice,
      durationMins: service.durationMins,
      employeePayout: service.employeePayout,
      cmpPayout: service.cmpPayout,
      variantLabel: null as string | null,
    };

    if (!variantId) return base;

    const metadata = service.metadata as any;
    const variants = metadata?.variants as Record<string, any> | undefined;
    if (!variants || !variants[variantId]) return base;

    const variant = variants[variantId];
    return {
      price: variant.price ?? base.price,
      durationMins: variant.durationMins ?? base.durationMins,
      employeePayout: variant.employeePayout ?? base.employeePayout,
      cmpPayout: variant.cmpPayout ?? base.cmpPayout,
      variantLabel: variant.label ?? variantId,
    };
  }

  async createOrder(userId: string, data: CreateOrderData) {
    if (!data.items || data.items.length === 0) {
      throw new ApiError(400, 'Order must contain at least one item');
    }

    // 1. Fetch services
    const serviceIds = data.items.map(item => item.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
    });

    if (services.length !== serviceIds.length) {
      throw new ApiError(400, 'One or more services not found');
    }

    // 2. Address verification
    const address = await prisma.address.findFirst({
      where: { id: data.addressId, userId },
    });

    if (!address) {
      throw new ApiError(400, 'Address not found');
    }

    // 3. Calculate Totals (variant-aware)
    let subtotal = 0;
    let totalEmployeePayout = 0;
    let totalCmpPayout = 0;
    let totalDurationMins = 0;

    for (const item of data.items) {
      const service = services.find(s => s.id === item.serviceId);
      if (!service || !service.isActive) {
        throw new ApiError(400, `Service ${service?.title || item.serviceId} is unavailable`);
      }
      const resolved = this.resolveItemValues(service, item.variantId);
      const qty = item.quantity || 1;
      subtotal += resolved.price * qty;
      totalEmployeePayout += resolved.employeePayout * qty;
      totalCmpPayout += resolved.cmpPayout * qty;
      totalDurationMins += resolved.durationMins * qty;
    }

    let discountAmount = 0;
    if (data.couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: data.couponCode.toUpperCase() },
      });

      if (coupon && coupon.isActive && new Date() <= coupon.expiresAt) {
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = Math.round(subtotal * (coupon.discountValue / 100));
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
        } else {
          discountAmount = coupon.discountValue;
        }
        discountAmount = Math.min(discountAmount, subtotal);
      }
    }

    const discountedSubtotal = subtotal - discountAmount;
    const taxAmount = Math.round(discountedSubtotal * 0.18);
    const totalAmount = discountedSubtotal + taxAmount;

    const scheduledStart = new Date(data.scheduledStart);
    const scheduledEnd = new Date(scheduledStart.getTime() + totalDurationMins * 60000);

    // 4. Create Order record
    const orderNumber = this.generateOrderNumber();
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        addressId: data.addressId,
        scheduledStart,
        scheduledEnd,
        isImmediate: data.isImmediate || false,
        subtotal,
        taxAmount,
        discountAmount,
        totalAmount,
        couponCode: data.couponCode,
        contactPhone: data.contactPhone,
        specialInstructions: data.specialInstructions,
        paymentMethod: data.paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
      },
    });

    // 5. Create Single Master Booking
    const primaryServiceId = data.items[0].serviceId;

    const bookingData = {
      serviceId: primaryServiceId,
      addressId: data.addressId,
      scheduledStart: data.scheduledStart,
      isImmediate: data.isImmediate,
      paymentMethod: data.paymentMethod,
      specialInstructions: data.specialInstructions || undefined,
      orderId: order.id,
      contactPhone: data.contactPhone,
      couponCode: data.couponCode,
      overridePrice: discountedSubtotal,
      overrideTaxAmount: taxAmount,
      overrideTotalAmount: totalAmount,
      overrideEmployeePayout: totalEmployeePayout,
      overrideCmpPayout: totalCmpPayout,
      overrideDurationMins: totalDurationMins,
      metadata: {
        items: data.items.map((item: any) => {
          const service = services.find(s => s.id === item.serviceId);
          const resolved = this.resolveItemValues(service, item.variantId);
          return {
            serviceId: item.serviceId,
            quantity: item.quantity || 1,
            variantId: item.variantId || null,
            title: service?.title,
            imageUrl: (service?.imageUrls as string[])?.[0] || service?.imageUrl,
            price: resolved.price,
            durationMins: resolved.durationMins,
            variantLabel: resolved.variantLabel,
          };
        })
      }
    };

    const booking = await this.bookingService.createBooking(userId, bookingData);
    const createdBookings = [booking];

    return {
      ...order,
      bookings: createdBookings,
    };
  }

  async getUserOrders(userId: string, options: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    // Filter by order bookings status if provided
    let whereClause: any = { userId };

    if (status && status !== 'ALL') {
      whereClause.bookings = {
        some: { status: status as BookingStatus }
      };
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.findMany({
        where: whereClause,
        include: {
          address: true,
          bookings: {
            include: {
              service: true,
              assignments: {
                where: {
                  status: { in: ['ACCEPTED', 'ON_WAY', 'ARRIVED', 'IN_PROGRESS'] }
                },
                include: {
                  buddy: {
                    include: {
                      user: { select: { id: true, name: true, phone: true, profileImage: true } }
                    }
                  }
                },
                orderBy: { createdAt: 'desc' },
                take: 1
              }
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      orders,
    };
  }
}
