export const ERROR_MESSAGES = {
  // Authentication
  INVALID_CREDENTIALS: 'Invalid email or password',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have permission to perform this action',
  TOKEN_EXPIRED: 'Your session has expired. Please login again',
  INVALID_TOKEN: 'Invalid authentication token',

  // User
  USER_NOT_FOUND: 'User not found',
  USER_ALREADY_EXISTS: 'User with this email/phone already exists',
  EMAIL_NOT_VERIFIED: 'Please verify your email address',
  PHONE_NOT_VERIFIED: 'Please verify your phone number',

  // Booking
  BOOKING_NOT_FOUND: 'Booking not found',
  CANNOT_CANCEL_BOOKING: 'Cannot cancel booking in current status',
  CANNOT_UPDATE_BOOKING: 'Cannot update booking in current status',
  NO_AVAILABLE_BUDDIES: 'No service buddies available at the moment',

  // Assignment
  ASSIGNMENT_NOT_FOUND: 'Assignment not found',
  ASSIGNMENT_ALREADY_PROCESSED: 'This assignment has already been processed',
  OVERLAPPING_ASSIGNMENT: 'You have an overlapping assignment',

  // Payment
  PAYMENT_FAILED: 'Payment processing failed',
  INVALID_PAYMENT_METHOD: 'Invalid payment method',
  REFUND_FAILED: 'Refund processing failed',

  // OTP
  INVALID_OTP: 'Invalid OTP code',
  OTP_EXPIRED: 'OTP has expired. Please request a new one',
  MAX_OTP_ATTEMPTS: 'Maximum OTP attempts exceeded',

  // General
  VALIDATION_ERROR: 'Validation failed',
  INTERNAL_ERROR: 'An internal error occurred',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please try again later',
  NOT_FOUND: 'Resource not found',
} as const;

export const SUCCESS_MESSAGES = {
  // Authentication
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful',
  SIGNUP_SUCCESS: 'Account created successfully',
  PASSWORD_RESET: 'Password reset successful',
  EMAIL_VERIFIED: 'Email verified successfully',
  PHONE_VERIFIED: 'Phone verified successfully',

  // User
  PROFILE_UPDATED: 'Profile updated successfully',
  ADDRESS_ADDED: 'Address added successfully',
  ADDRESS_UPDATED: 'Address updated successfully',
  ADDRESS_DELETED: 'Address deleted successfully',

  // Booking
  BOOKING_CREATED: 'Booking created successfully',
  BOOKING_UPDATED: 'Booking updated successfully',
  BOOKING_CANCELLED: 'Booking cancelled successfully',
  BOOKING_COMPLETED: 'Service completed successfully',

  // Assignment
  JOB_ACCEPTED: 'Job accepted successfully',
  JOB_REJECTED: 'Job rejected',
  JOB_STARTED: 'Job started',
  JOB_COMPLETED: 'Job completed successfully',

  // Payment
  PAYMENT_SUCCESS: 'Payment processed successfully',
  REFUND_SUCCESS: 'Refund processed successfully',

  // Review
  REVIEW_SUBMITTED: 'Review submitted successfully',

  // OTP
  OTP_SENT: 'OTP sent successfully',
  OTP_VERIFIED: 'OTP verified successfully',

  // General
  UPDATE_SUCCESS: 'Updated successfully',
  DELETE_SUCCESS: 'Deleted successfully',
  CREATE_SUCCESS: 'Created successfully',
} as const;