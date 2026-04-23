export const APP_NAME = 'Service Marketplace';

export const ROLES = {
  USER: 'USER',
  BUDDY: 'BUDDY',
  ADMIN: 'ADMIN',
} as const;

export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export const ASSIGNMENT_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

export const NOTIFICATION_TYPE = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_ASSIGNED: 'BOOKING_ASSIGNED',
  BOOKING_ACCEPTED: 'BOOKING_ACCEPTED',
  BOOKING_STARTED: 'BOOKING_STARTED',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  RATING_RECEIVED: 'RATING_RECEIVED',
  GENERAL: 'GENERAL',
} as const;

export const DEFAULT_CONFIG = {
  MAX_BUDDY_RADIUS: 10, // km
  COOLDOWN_DAYS: 7, // days
  MIN_GAP_MINUTES: 30, // minutes
  OTP_LENGTH: 6,
  OTP_EXPIRY_MINUTES: 10,
  MAX_OTP_ATTEMPTS: 3,
  LOCATION_UPDATE_INTERVAL: 15000, // 15 seconds
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

export const RATE_LIMITS = {
  API: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100,
  },
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 10, // Increased slightly
  },
  OTP: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 3,
  },
  PAYMENT: {
    WINDOW_MS: 60 * 60 * 1000, // 1 hour
    MAX_REQUESTS: 10,
  },
} as const;

export const FILE_UPLOAD = {
  MAX_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
} as const;

export const CURRENCIES = {
  INR: 'INR',
  USD: 'USD',
  EUR: 'EUR',
} as const;

export const TAX_RATE = 0.18; // 18% GST for India

export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  LOCATION_UPDATE: 'location:update',
  LOCATION_SUBSCRIBE: 'location:subscribe',
  LOCATION_UNSUBSCRIBE: 'location:unsubscribe',
  JOB_ACCEPT: 'job:accept',
  JOB_REJECT: 'job:reject',
  JOB_START: 'job:start',
  JOB_COMPLETE: 'job:complete',
  JOB_ASSIGNED: 'job:assigned',
  JOB_CANCELLED: 'job:cancelled',
  BOOKING_ACCEPTED: 'booking:accepted',
  BOOKING_STARTED: 'booking:started',
  BOOKING_COMPLETED: 'booking:completed',
  BUDDY_LOCATION_UPDATE: 'buddy:location:update',
  NOTIFICATION: 'notification',
} as const;