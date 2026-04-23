export class ApiError extends Error {
  statusCode: number;
  data?: any;

  constructor(statusCode: number, message: string, data?: any) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.name = 'ApiError';

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, errors?: any) {
    super(400, message, { errors });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed') {
    super(401, message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Insufficient permissions') {
    super(403, message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string = 'Resource already exists') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Too many requests') {
    super(429, message);
    this.name = 'RateLimitError';
  }
}

export class InternalError extends ApiError {
  constructor(message: string = 'Internal server error') {
    super(500, message);
    this.name = 'InternalError';
  }
}