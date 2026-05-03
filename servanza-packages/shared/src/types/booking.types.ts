import { User } from './user.types';
import { Address } from './user.types';
import { Buddy } from './buddy.types';

export enum BookingStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum PaymentMethod {
  PREPAID = 'PREPAID',
  CASH = 'CASH',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum AssignmentStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export interface Service {
  id: string;
  categoryId: string;
  title: string;
  description?: string;
  durationMins: number;
  basePrice: number;
  employeePayout: number;
  cmpPayout: number;
  isInstant: boolean;
  currency: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: Category;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  slug: string;
  icon?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  id: string;
  userId: string;
  serviceId: string;
  addressId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  isImmediate: boolean;
  status: BookingStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  price: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  employeePayout: number;
  cmpPayout: number;
  currency: string;
  specialInstructions?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: User;
  service?: Service;
  address?: Address;
  assignments?: Assignment[];
}

export interface Assignment {
  id: string;
  bookingId: string;
  buddyId: string;
  status: AssignmentStatus;
  estimatedEtaMins?: number;
  distanceKm?: number;
  assignedAt: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  rejectionReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  booking?: Booking;
  buddy?: Buddy;
}

export interface Review {
  id: string;
  bookingId: string;
  userId: string;
  buddyId: string;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookingDto {
  serviceId: string;
  addressId: string;
  scheduledStart: string | Date;
  isImmediate?: boolean;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
}

export interface UpdateBookingDto {
  scheduledStart?: string | Date;
  specialInstructions?: string;
}

export interface CancelBookingDto {
  reason: string;
}

export interface CreateReviewDto {
  rating: number;
  comment?: string;
}

export interface BookingTimeline {
  event: string;
  timestamp: Date;
  description: string;
}