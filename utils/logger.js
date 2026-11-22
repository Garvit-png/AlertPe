import pino from 'pino';
import pinoPretty from 'pino-pretty';

/**
 * Shared Logger Utility
 * Used by both server.js and scripts (seed, cron, etc.)
 */

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const logger = pino(
  isProduction
    ? { level: logLevel }
    : {
        level: logLevel,
        transport: {
          target: 'pino-pretty',
          options: { 
            colorize: true, 
            translateTime: 'HH:MM:ss Z', 
            ignore: 'pid,hostname' 
          }
        }
      }
);

export default logger;