
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log basic error info
  const error = err as Error;
  logger.error('Error:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  // Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json({
      success: false,
      error: { message: 'Validation failed', errors },
    });
    return;
  }

  // Known ApiError
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        ...err.data,
      },
    });
    return;
  }

  // Prisma known request errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          message: 'A record with this value already exists',
          field: err.meta?.target,
        },
      });
      return;
    }

    if (err.code === 'P2003') {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid reference to related record' },
      });
      return;
    }

    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: { message: 'Record not found' },
      });
      return;
    }
  }

  // Prisma validation errors
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      error: { message: 'Invalid data provided' },
    });
    return;
  }

  // JWT errors
  if ((err as any).name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      error: { message: 'Invalid token' },
    });
    return;
  }

  if ((err as any).name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: { message: 'Token expired' },
    });
    return;
  }

  //Multer (file upload) errors
  if ((err as any).name === 'MulterError') {
    res.status(400).json({
      success: false,
      error: { message: (err as any).message },
    });
    return;
  }

  // Default fallback
  const statusCode = 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (error.message || 'Unexpected error');

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      path: req.originalUrl,
    },
  });
};

// Async wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
