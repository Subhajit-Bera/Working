import { UserRole} from '@prisma/client'; // BookingStatus, PaymentStatus, PaymentMethod

export interface JWTPayload {
  userId: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
}

export interface Location {
  latitude: number;
  longitude: number;
}

export interface BookingFilters {
  status?: string;
  serviceId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface AssignmentConstraints {
  maxRadius: number;
  cooldownDays: number;
  minGapMinutes: number;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface SocketData {
  userId: string;
  role: UserRole;
  activeBookingId?: string;
}

export interface PaymentIntentResult {
  transactionId: string;
  clientSecret: string | null;
  paymentIntentId: string;
}

export interface RazorpayOrderResult {
  transactionId: string;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string | undefined;
}

export interface DashboardStats {
  users: {
    total: number;
  };
  buddies: {
    total: number;
    active: number;
  };
  bookings: {
    total: number;
    today: number;
    thisMonth: number;
    completed: number;
    pending: number;
  };
  revenue: {
    total: number;
    thisMonth: number;
  };
}

export interface EarningsSummary {
  totalEarnings: number;
  totalJobs: number;
  today: {
    amount: number;
    count: number;
  };
  thisWeek: {
    amount: number;
    count: number;
  };
  thisMonth: {
    amount: number;
    count: number;
  };
}