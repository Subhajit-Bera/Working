// Set timezone to IST for all Date operations
process.env.TZ = 'Asia/Kolkata';

import http from 'http';
import createApp from './app';
import { initSocketIO } from './socket/index';
import { logger } from './utils/logger';
import { prisma } from './config/database';
import { redis, redisPub, redisSub } from './config/redis';
import { initializeFirebase } from './config/firebase';
import { initializeRazorpay } from './config/razorpay';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (true) {
    try {
      await prisma.$connect();
      await redis.ping();
      await redisPub.ping();
      await redisSub.ping();
      break;
    } catch (error) {
      logger.error('Startup dependency check failed:', error);
      await wait(3000);
    }
  }

  initializeFirebase();
  initializeRazorpay();

  const app = createApp();
  const server = http.createServer(app);
  initSocketIO(server);

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    // Note: Background workers (assignment, dispatch-retry, queued-activation)
    // are handled by the separate workers service (servanza-services/workers)
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    server.close(async () => {
      logger.info('HTTP server closed');
      await prisma.$disconnect();
      redis.quit();
      redisPub.quit();
      redisSub.quit();
      logger.info('Redis and DB connections closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forcing shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();