import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';

/**
 * Rate Limiting Middleware Configurations
 * Different limits for different endpoint types
 */

// General API limiter (applied to all /api/* routes in server.js)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window
  message: { 
    error: 'Too many requests', 
    code: 'RATE_LIMITED',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, url: req.originalUrl }, 'Rate limit exceeded');
    res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: '15 minutes'
    });
  }
});

// Strict limiter for write operations (POST, PUT, DELETE)
export const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 mutations per window
  message: { 
    error: 'Too many write requests', 
    code: 'RATE_LIMITED',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skip: (req) => req.method === 'GET'
});

// Very strict limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { 
    error: 'Too many authentication attempts', 
    code: 'RATE_LIMITED',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

// Webhook limiter (higher limit for legitimate webhook retries)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhooks per minute
  message: { 
    error: 'Too many webhook requests', 
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

// Reminder trigger limiter (manual trigger)
export const reminderTriggerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 manual triggers per minute
  message: { 
    error: 'Too many reminder triggers', 
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

// Simulation limiter (computationally expensive)
export const simulationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 simulations per minute
  message: { 
    error: 'Too many simulation requests', 
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

/**
 * Create custom limiter
 */
export function createLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || ((req) => req.ip),
    skip: options.skip
  });
}

export default {
  apiLimiter,
  mutationLimiter,
  authLimiter,
  webhookLimiter,
  reminderTriggerLimiter,
  simulationLimiter,
  createLimiter
};