import express from 'express';
import { Invoice } from '../models/index.js';
import { verifyWebhookSignature, processWebhookPayload } from '../services/payment-gateway.js';
import { notifyPaymentReceived } from '../services/sse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route POST /api/webhooks/payment
 * @desc Razorpay payment webhook handler
 * @header X-Razorpay-Signature
 * @body Raw webhook payload from Razorpay
 */
router.post('/payment', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const payload = req.body; // Buffer from express.raw()
  
  // Verify webhook signature
  if (!verifyWebhookSignature(payload, signature)) {
    logger.warn({ ip: req.ip }, 'Invalid webhook signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }
  
  // Parse payload
  let event;
  try {
    event = JSON.parse(payload.toString());
  } catch (error) {
    logger.error({ err: error }, 'Failed to parse webhook payload');
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  
  // Process webhook payload
  const paymentInfo = processWebhookPayload(event);
  
  if (!paymentInfo) {
    // Not a payment event we care about, but acknowledge receipt
    logger.debug({ event: event.event }, 'Webhook received but not processed');
    return res.json({ received: true });
  }
  
  const { invoiceNumber, paymentId, amount, status, paidAt, method } = paymentInfo;
  
  logger.info({ 
    invoiceNumber, 
    paymentId, 
    amount, 
    status,
    event: event.event 
  }, 'Processing payment webhook');
  
  // Find invoice by invoiceNumber
  const invoice = await Invoice.findOne({ invoiceNumber });
  
  if (!invoice) {
    logger.warn({ invoiceNumber }, 'Invoice not found for payment');
    return res.json({ received: true }); // Acknowledge to prevent retries
  }
  
  // Check if already paid (idempotency)
  if (invoice.status === 'PAID') {
    logger.info({ invoiceNumber, existingTransactionId: invoice.transactionId }, 'Invoice already paid, skipping');
    return res.json({ received: true });
  }
  
  // Verify amount matches (within small tolerance for fees)
  const expectedAmount = invoice.amount;
  const tolerance = expectedAmount * 0.02; // 2% tolerance for gateway fees
  
  if (Math.abs(amount - expectedAmount) > tolerance) {
    logger.warn({ 
      invoiceNumber, 
      expected: expectedAmount, 
      received: amount 
    }, 'Payment amount mismatch');
    // Still process but log warning
  }
  
  // Update invoice
  invoice.status = 'PAID';
  invoice.transactionId = paymentId;
  invoice.paidAt = paidAt || new Date();
  invoice.webhookReceivedAt = new Date();
  invoice.webhookPayload = event;
  await invoice.save();
  
  // Populate client for notification
  await invoice.populate('clientId', 'name phone');
  
  // Notify via SSE
  notifyPaymentReceived(invoice, {
    paymentId,
    amount,
    status,
    method,
    paidAt: invoice.paidAt
  });
  
  logger.info({ 
    invoiceNumber, 
    paymentId, 
    amount: invoice.amount 
  }, 'Invoice marked as paid via webhook');
  
  res.json({ received: true });
}));

/**
 * @route GET /api/webhooks/test
 * @desc Test webhook endpoint (for development)
 */
router.get('/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

export default router;