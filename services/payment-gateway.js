import crypto from 'crypto';
import Razorpay from 'razorpay';
import logger from '../utils/logger.js';

/**
 * Payment Gateway Service - Abstracts Razorpay (and future Stripe)
 * Provides unified interface for payment link creation and webhook verification
 */

let razorpayInstance = null;

function getRazorpay() {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    if (!keyId || !keySecret) {
      logger.warn('Razorpay credentials not configured');
      return null;
    }
    
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
  }
  return razorpayInstance;
}

/**
 * Create a payment link for an invoice
 * @param {Object} params
 * @param {number} params.amount - Amount in paise (INR smallest unit)
 * @param {string} params.currency - Currency code (default: INR)
 * @param {string} params.description - Payment description
 * @param {string} params.customerName - Customer name
 * @param {string} params.customerPhone - Customer phone (E.164)
 * @param {string} params.customerEmail - Customer email (optional)
 * @param {string} params.referenceId - Internal reference (invoiceNumber)
 * @param {number} params.expireDays - Link expiry in days (default: 30)
 * @returns {Promise<Object>} { paymentLink, paymentId, shortUrl }
 */
export async function createPaymentLink({
  amount,
  currency = 'INR',
  description,
  customerName,
  customerPhone,
  customerEmail,
  referenceId,
  expireDays = 30
}) {
  const razorpay = getRazorpay();
  
  if (!razorpay) {
    // Mock mode for development without credentials
    logger.info({ amount, referenceId }, 'MOCK: Creating payment link');
    return {
      paymentLink: `https://rzp.io/i/mock_${referenceId}`,
      paymentId: `pay_mock_${Date.now()}`,
      shortUrl: `https://rzp.io/i/mock_${referenceId}`,
      status: 'created',
      mock: true
    };
  }
  
  try {
    const expireBy = Math.floor(Date.now() / 1000) + (expireDays * 24 * 60 * 60);
    
    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      description,
      customer: {
        name: customerName,
        contact: customerPhone.replace(/^\+/, ''), // Razorpay expects without +
        email: customerEmail
      },
      notify: {
        sms: true,
        whatsapp: true,
        email: !!customerEmail
      },
      reminder_enable: true,
      expire_by: expireBy,
      reference_id: referenceId,
      notes: {
        invoice_number: referenceId,
        source: 'cashpilot'
      },
      callback_url: `${process.env.FRONTEND_URL}/payment/success`,
      callback_method: 'get'
    });
    
    logger.info({ 
      paymentLinkId: paymentLink.id, 
      referenceId,
      shortUrl: paymentLink.short_url 
    }, 'Payment link created');
    
    return {
      paymentLink: paymentLink.short_url,
      paymentId: paymentLink.id,
      shortUrl: paymentLink.short_url,
      status: paymentLink.status,
      expiresAt: new Date(paymentLink.expire_by * 1000),
      mock: false
    };
  } catch (error) {
    logger.error({ err: error, referenceId }, 'Failed to create payment link');
    throw new Error(`Payment link creation failed: ${error.message}`);
  }
}

/**
 * Fetch payment link status
 * @param {string} paymentLinkId - Razorpay payment link ID
 * @returns {Promise<Object>}
 */
export async function getPaymentLinkStatus(paymentLinkId) {
  const razorpay = getRazorpay();
  
  if (!razorpay) {
    return { status: 'mock', mock: true };
  }
  
  try {
    const link = await razorpay.paymentLink.fetch(paymentLinkId);
    return {
      status: link.status,
      amount: link.amount / 100,
      payments: link.payments,
      mock: false
    };
  } catch (error) {
    logger.error({ err: error, paymentLinkId }, 'Failed to fetch payment link');
    throw error;
  }
}

/**
 * Verify webhook signature (Razorpay)
 * @param {Buffer|string} payload - Raw request body
 * @param {string} signature - X-Razorpay-Signature header
 * @returns {boolean}
 */
export function verifyWebhookSignature(payload, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  if (!secret) {
    logger.warn('Razorpay webhook secret not configured');
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}

/**
 * Process webhook payload and extract payment info
 * @param {Object} payload - Parsed webhook JSON
 * @returns {Object|null} { invoiceNumber, paymentId, amount, status } or null
 */
export function processWebhookPayload(payload) {
  // Razorpay webhook structure for payment_link.paid
  if (payload.event === 'payment_link.paid') {
    const payment = payload.payload?.payment?.entity;
    const link = payload.payload?.payment_link?.entity;
    
    if (payment && link) {
      return {
        invoiceNumber: link.reference_id,
        paymentId: payment.id,
        amount: payment.amount / 100,
        status: payment.status,
        paidAt: new Date(payment.created_at * 1000),
        method: payment.method,
        email: payment.email,
        contact: payment.contact
      };
    }
  }
  
  // Also handle payment.captured for direct payments
  if (payload.event === 'payment.captured') {
    const payment = payload.payload?.payment?.entity;
    
    if (payment && payment.notes?.invoice_number) {
      return {
        invoiceNumber: payment.notes.invoice_number,
        paymentId: payment.id,
        amount: payment.amount / 100,
        status: payment.status,
        paidAt: new Date(payment.created_at * 1000),
        method: payment.method
      };
    }
  }
  
  return null;
}

/**
 * Check if payment gateway is configured
 */
export function isConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export default {
  createPaymentLink,
  getPaymentLinkStatus,
  verifyWebhookSignature,
  processWebhookPayload,
  isConfigured
};