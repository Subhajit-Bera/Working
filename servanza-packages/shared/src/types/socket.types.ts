export enum SocketEvent {
  // Connection events
  CONNECTION = 'connection',
  DISCONNECT = 'disconnect',
  ERROR = 'error',
  CONNECTED = 'connected',

  // Location events
  LOCATION_UPDATE = 'location:update',
  LOCATION_SUBSCRIBE = 'location:subscribe',
  LOCATION_UNSUBSCRIBE = 'location:unsubscribe',
  BUDDY_LOCATION_UPDATE = 'buddy:location:update',

  // Job events
  JOB_ASSIGNED = 'job:assigned',
  JOB_ACCEPT = 'job:accept',
  JOB_REJECT = 'job:reject',
  JOB_START = 'job:start',
  JOB_COMPLETE = 'job:complete',
  JOB_COMPLETE_SUCCESS = 'job:complete:success',
  JOB_COMPLETE_OTP_REQUIRED = 'job:complete:otp_required',
  JOB_CANCELLED = 'job:cancelled',
  JOB_TAKEN = 'job:taken',

  // Booking events
  BOOKING_CREATED = 'booking:created',
  BOOKING_ASSIGNED = 'booking:assigned',
  BOOKING_ACCEPTED = 'booking:accepted',
  BOOKING_STARTED = 'booking:started',
  BOOKING_COMPLETED = 'booking:completed',
  BOOKING_CANCELLED = 'booking:cancelled',
  BOOKING_STATUS_CHANGE = 'booking:status:change',

  // Notification events
  NOTIFICATION = 'notification',
  NOTIFICATION_READ = 'notification:read',

  // Admin events
  ALERT_NO_BUDDIES = 'alert:no_buddies',
}

export interface SocketData {
  userId: string;
  role: string;
  activeBookingId?: string;
}

export interface LocationUpdateData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: string;
}

export interface JobActionData {
  assignmentId: string;
  reason?: string;
  otp?: string;
}

export interface LocationSubscribeData {
  bookingId: string;
}