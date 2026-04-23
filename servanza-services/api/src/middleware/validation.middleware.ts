import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ApiError } from '../utils/errors';

export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error:any) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err:any) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        next(
          new ApiError(400, 'Validation failed', {
            errors,
          })
        );
      } else {
        next(error);
      }
    }
  };
};

export const validateBody = (schema: ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error:any) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err:any) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        next(
          new ApiError(400, 'Validation failed', {
            errors,
          })
        );
      } else {
        next(error);
      }
    }
  };
};