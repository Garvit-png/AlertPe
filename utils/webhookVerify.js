import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Verify Razorpay webhook signature
 * @param {Buffer|string} payload - Raw request body
 * @param {string} signature - X-Razorpay-Signature header
 * @param {string} secret - Webhook secret from Razorpay dashboard
 * @returns {boolean}
 */
export function verifyRazorpaySignature(payload, signature, secret) {
  if (!signature || !secret) {
    logger.warn('Missing signature or secret for Razorpay verification');
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}

/**
 * Verify Stripe webhook signature
 * @param {Buffer|string} payload - Raw request body
 * @param {string} signature - Stripe-Signature header
 * @param {string} secret - Webhook endpoint secret
 * @returns {object|null} Parsed event or null if invalid
 */
export function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) {
    logger.warn('Missing signature or secret for Stripe verification');
    return null;
  }
  
  try {
    // Parse Stripe signature header: "t=timestamp,v1=signature"
    const elements = signature.split(',').reduce((acc, item) => {
      const [key, value] = item.split('=');
      acc[key] = value;
      return acc;
    }, {});
    
    const timestamp = elements.t;
    const signatures = elements.v1.split(' ');
    
    // Check timestamp tolerance (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
      logger.warn('Stripe webhook timestamp outside tolerance');
      return null;
    }
    
    const payloadToVerify = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadToVerify)
      .digest('hex');
    
    const isValid = signatures.some(sig => 
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))
    );
    
    if (!isValid) {
      logger.warn('Stripe signature verification failed');
      return null;
    }
    
    return JSON.parse(payload);
  } catch (error) {
    logger.error({ err: error }, 'Stripe signature verification error');
    return null;
  }
}

/**
 * Generic webhook verification middleware factory
 */
export function createWebhookVerifier(verifyFn, secretKey) {
  return (req, res, next) => {
    const signature = req.headers['x-razorpay-signature'] || req.headers['stripe-signature'];
    const secret = process.env[secretKey];
    
    if (!secret) {
      logger.error({ secretKey }, 'Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }
    
    const payload = req.body; // Raw buffer from express.raw()
    
    if (!verifyFn(payload, signature, secret)) {
      logger.warn({ ip: req.ip }, 'Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    // Attach parsed payload for handlers
    req.webhookPayload = typeof payload === 'string' ? JSON.parse(payload) : JSON.parse(payload.toString());
    next();
  };
}

export default {
  verifyRazorpaySignature,
  verifyStripeSignature,
  createWebhookVerifier
};