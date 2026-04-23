// import winston from 'winston';
// import path from 'path';

// const logLevel = process.env.LOG_LEVEL || 'info';

// // Define log format
// const logFormat = winston.format.combine(
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   winston.format.errors({ stack: true }),
//   winston.format.splat(),
//   winston.format.json()
// );

// // Console format for development
// const consoleFormat = winston.format.combine(
//   winston.format.colorize(),
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   winston.format.printf(({ timestamp, level, message, ...meta }) => {
//     let metaStr = '';
//     if (Object.keys(meta).length > 0) {
//       metaStr = '\n' + JSON.stringify(meta, null, 2);
//     }
//     return `${timestamp} [${level}] [WORKER]: ${message}${metaStr}`;
//   })
// );

// // Create transports
// const transports: winston.transport[] = [
//   new winston.transports.Console({
//     format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
//   }),
// ];

// // Add file transports in production
// if (process.env.NODE_ENV === 'production') {
//   transports.push(
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-error.log'),
//       level: 'error',
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     }),
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-combined.log'),
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     })
//   );
// }

// // Create logger instance
// export const logger = winston.createLogger({
//   level: logLevel,
//   format: logFormat,
//   transports,
//   exitOnError: false,
// });

// // Handle unhandled rejections
// process.on('unhandledRejection', (reason, promise) => {
//   logger.error('Unhandled Rejection at:', { promise, reason });
// });

// // Handle uncaught exceptions
// process.on('uncaughtException', (error) => {
//   logger.error('Uncaught Exception:', error);
//   process.exit(1);
// });


// import winston from 'winston';
// import path from 'path';

// const logLevel = process.env.LOG_LEVEL || 'info';
// const isProduction = process.env.NODE_ENV === 'production';

// // Define log format
// const logFormat = winston.format.combine(
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   winston.format.errors({ stack: true }),
//   winston.format.splat(),
//   winston.format.json()
// );

// // Console format for development
// const consoleFormat = winston.format.combine(
//   winston.format.colorize(),
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
//     let metaStr = '';
//     const metaKeys = Object.keys(meta);
//     if (metaKeys.length > 0) {
//       metaStr = ' ' + JSON.stringify(meta);
//     }
//     const stackStr = stack ? `\n${stack}` : '';
//     return `${timestamp} [${level}] [WORKER]: ${message}${metaStr}${stackStr}`;
//   })
// );

// // Create transports
// const transports: winston.transport[] = [
//   new winston.transports.Console({
//     format: isProduction ? logFormat : consoleFormat,
//   }),
// ];

// // Add file transports in production
// if (isProduction) {
//   transports.push(
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-error.log'),
//       level: 'error',
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     }),
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-combined.log'),
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     })
//   );
// }

// // Create logger instance
// export const logger = winston.createLogger({
//   level: logLevel,
//   format: logFormat,
//   transports,
//   exitOnError: false,
// });

// // Handle unhandled rejections
// process.on('unhandledRejection', (reason, promise) => {
//   logger.error('Unhandled Rejection at:', { promise, reason });
// });

// // Handle uncaught exceptions
// process.on('uncaughtException', (error) => {
//   logger.error('Uncaught Exception:', error);
//   process.exit(1); // Workers should exit on uncaught exceptions
// });



// import winston from 'winston';
// import path from 'path';

// const logLevel = process.env.LOG_LEVEL || 'info';
// const isProduction = process.env.NODE_ENV === 'production';

// // Define log format
// const logFormat = winston.format.combine(
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   winston.format.errors({ stack: true }),
//   winston.format.splat(),
//   winston.format.json()
// );

// // FIX: Define types for the printf arguments
// interface LogInfo {
//   timestamp: string;
//   level: string;
//   message: string;
//   stack?: string;
//   [key: string]: any;
// }

// // Console format for development
// const consoleFormat = winston.format.combine(
//   winston.format.colorize(),
//   winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//   // FIX: Apply the types to the destructured arguments
//   winston.format.printf(({ timestamp, level, message, stack, ...meta }: LogInfo) => {
//     let metaStr = '';
//     const metaKeys = Object.keys(meta);
//     if (metaKeys.length > 0) {
//       metaStr = ' ' + JSON.stringify(meta);
//     }
//     const stackStr = stack ? `\n${stack}` : '';
//     return `${timestamp} [${level}] [WORKER]: ${message}${metaStr}${stackStr}`;
//   })
// );

// // Create transports
// const transports: winston.transport[] = [
//   new winston.transports.Console({
//     format: isProduction ? logFormat : consoleFormat,
//   }),
// ];

// // Add file transports in production
// if (isProduction) {
//   transports.push(
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-error.log'),
//       level: 'error',
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     }),
//     new winston.transports.File({
//       filename: path.join('logs', 'worker-combined.log'),
//       maxsize: 5242880, // 5MB
//       maxFiles: 5,
//     })
//   );
// }

// // Create logger instance
// export const logger = winston.createLogger({
//   level: logLevel,
//   format: logFormat,
//   transports,
//   exitOnError: false,
// });

// // Handle unhandled rejections
// process.on('unhandledRejection', (reason:any, promise:any) => {
//   logger.error('Unhandled Rejection at:', { promise, reason });
// });

// // Handle uncaught exceptions
// process.on('uncaughtException', (error:any) => {
//   logger.error('Uncaught Exception:', error);
//   process.exit(1); // Workers should exit on uncaught exceptions
// });

import winston from 'winston';
import path from 'path';
import { TransformableInfo } from 'logform'; // <-- IMPORT THIS

const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  // FIX: Apply the types to the destructured arguments
  winston.format.printf(({ timestamp, level, message, stack, ...meta }: TransformableInfo) => {
    let metaStr = '';
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      metaStr = ' ' + JSON.stringify(meta);
    }
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level}] [WORKER]: ${message}${metaStr}${stackStr}`;
  })
);

// Create transports
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? logFormat : consoleFormat,
  }),
];

// Add file transports in production
if (isProduction) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'worker-error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'worker-combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports,
  exitOnError: false,
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1); // Workers should exit on uncaught exceptions
});