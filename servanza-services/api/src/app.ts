import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { stream } from './utils/logger'; // logger
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { apiLimiter } from './middleware/rateLimit.middleware';
import routes from './routes';

const createApp = (): Express => {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS?.split(',') || '*',
      credentials: true,
    })
  );

  // Use JSON parser for all non-webhook routes
  app.use(
    express.json({
      limit: '10mb',
      verify: (_req: Request, _res: Response, _buf: Buffer) => {
        // HACK: We need to access req.originalUrl, but Express.json doesn't expose it.
        // We assume that if the 'stripe-signature' header is present, it's a Stripe webhook.
        // A better way is to apply raw body parser only on the webhook route.
        // We will do that in the webhook.routes.ts file.
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression
  app.use(compression());

  // Logging
  app.use(
    morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined', {
      stream: stream,
    })
  );

  // Apply API rate limiter to all API routes
  app.use('/api/v1', apiLimiter);

  // Health check - verifies all dependencies
  app.get('/health', async (_req: Request, res: Response) => {
    const health: any = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        redis: 'unknown',
      },
    };

    // Check database connectivity
    try {
      const { prisma } = await import('./config/database');
      await prisma.$queryRaw`SELECT 1`;
      health.services.database = 'healthy';
    } catch (error) {
      health.services.database = 'unhealthy';
      health.status = 'degraded';
    }

    // Check Redis connectivity
    try {
      const { redis } = await import('./config/redis');
      await redis.ping();
      health.services.redis = 'healthy';
    } catch (error) {
      health.services.redis = 'unhealthy';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // Queue metrics endpoint - for monitoring queue health
  app.get('/metrics/queues', async (_req: Request, res: Response) => {
    try {
      const { getAllQueueMetrics } = await import('./services/queue-metrics.service');
      const metrics = await getAllQueueMetrics();
      const statusCode = metrics.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(metrics);
    } catch (error) {
      res.status(503).json({
        status: 'unavailable',
        error: 'Failed to fetch queue metrics',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // API routes
  app.use('/api/v1', routes);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
};

export default createApp;