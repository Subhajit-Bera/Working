import winston from 'winston';
import path from 'path';
import { TransformableInfo } from 'logform';

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
  // FIX: Use the imported TransformableInfo type
  winston.format.printf(({ timestamp, level, message, stack, ...meta }: TransformableInfo) => {
    let metaStr = '';
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      // Avoid printing large objects
      metaStr = ' ' + JSON.stringify(meta);
    }
    
    const stackStr = stack ? `\n${stack}` : '';
    
    return `${timestamp} [${level}] [API]: ${message}${metaStr}${stackStr}`;
  })
);

// Create transports
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? logFormat : consoleFormat,
    level: logLevel,
  }),
];

// Add file transports in production
if (isProduction) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat, // Default format
  transports,
  exitOnError: false,
});

// Create a stream object for Morgan
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};