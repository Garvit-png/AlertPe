import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Invoice, Client, BusinessProfile } from '../models/index.js';
import { validateBody, validateQuery, validateParams, createInvoiceSchema, updateInvoiceSchema, invoiceQuerySchema } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { createPaymentLink, isConfigured as isPaymentConfigured, generateUPIPaymentUrl } from '../services/payment-gateway.js';
import { isConfigured as isWhatsAppConfigured } from '../services/whatsapp.js';
import { notifyPaymentReceived } from '../services/sse.js';
import logger from '../utils/logger.js';
import { getOfflineInvoices, addOfflineInvoice, markOfflineInvoicePaid } from '../services/offline-store.js';

const router = express.Router();

/**
 * @route GET /api/invoices/gateway-status
 * @desc Get configuration status of payment gateway and WhatsApp
 */
router.get('/gateway-status', (req, res) => {
  res.json({
    razorpay: {
      configured: isPaymentConfigured(),
      mode: isPaymentConfigured() ? 'live_api' : 'simulated_and_upi'
    },
    whatsapp: {
      configured: isWhatsAppConfigured(),
      mode: isWhatsAppConfigured() ? 'automated_twilio' : 'direct_wa_redirect'
    }
  });
});

/**
 * @route POST /api/invoices/generate-payment-link
 * @desc On-demand payment link generation (e.g. for ₹500 test or preview)
 * @body { amount, description?, customerName?, customerPhone?, upiId? }
 */
router.post('/generate-payment-link', validateBody(z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  upiId: z.string().optional()
})), asyncHandler(async (req, res) => {
  const { amount, description = 'Invoice Payment', customerName = 'Client', customerPhone = '+919876543210', upiId } = req.body;
  const tempRef = `INV-${Date.now().toString().slice(-6)}`;

  let paymentResult;
  try {
    paymentResult = await createPaymentLink({
      amount,
      description,
      customerName,
      customerPhone,
      referenceId: tempRef
    });
  } catch (err) {
    paymentResult = {
      paymentLink: `https://rzp.io/i/mock_${tempRef}`,
      mock: true
    };
  }

  const profile = await BusinessProfile.getActiveProfile();
  const upiUrl = generateUPIPaymentUrl({
    upiId: upiId || profile?.upiId || 'alertpe@okhdfcbank',
    payeeName: profile?.businessName || 'AlertPe Merchant',
    amount,
    note: description
  });

  res.json({
    success: true,
    amount,
    referenceId: tempRef,
    paymentLink: paymentResult.paymentLink,
    upiUrl,
    isLive: isPaymentConfigured()
  });
}));

/**
 * @route GET /api/invoices
 * @desc Get invoices with filters
 * @query status, clientId, fromDate, toDate, page, limit, sort, order
 */
router.get('/', validateQuery(invoiceQuerySchema), asyncHandler(async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const list = getOfflineInvoices({ status: req.query.status });
    return res.json({
      data: list,
      pagination: {
        page: 1,
        limit: list.length,
        total: list.length,
        pages: 1
      }
    });
  }

  const { status, clientId, fromDate, toDate, page = 1, limit = 20, sort = 'dueDate', order = 'asc' } = req.query;
  
  const filter = {};
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;
  if (fromDate || toDate) {
    filter.dueDate = {};
    if (fromDate) filter.dueDate.$gte = new Date(fromDate);
    if (toDate) filter.dueDate.$lte = new Date(toDate);
  }
  
  const sortOrder = order === 'asc' ? 1 : -1;
  const sortObj = { [sort]: sortOrder };
  
  const skip = (page - 1) * limit;
  
  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean()
      .populate('clientId', 'name phone email'),
    Invoice.countDocuments(filter)
  ]);
  
  res.json({
    data: invoices,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

/**
 * @route GET /api/invoices/:id
 * @desc Get single invoice
 */
router.get('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id)
    .lean()
    .populate('clientId', 'name phone email businessCategory');
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  res.json(invoice);
}));

/**
 * @route POST /api/invoices
 * @desc Create invoice and generate payment link
 */
router.post('/', validateBody(createInvoiceSchema), asyncHandler(async (req, res) => {
  const { clientId, amount, description, dueDate, dueTime, reminderIntervalDays, reminderTime, paymentLink } = req.body;
  
  if (mongoose.connection.readyState !== 1) {
    const newInv = addOfflineInvoice({
      clientId,
      amount,
      description,
      dueDate,
      dueTime: dueTime || '18:00',
      reminderIntervalDays,
      reminderTime: reminderTime || '16:00',
      paymentLink: paymentLink || `https://rzp.io/i/mock_INV-${Date.now().toString().slice(-4)}`
    });
    return res.status(201).json(newInv);
  }

  // Verify client exists
  const client = await Client.findById(clientId);
  if (!client) {
    throw new NotFoundError('Client');
  }
  
  // Create invoice (invoiceNumber auto-generated)
  const invoice = await Invoice.create({
    clientId,
    amount,
    description,
    dueDate,
    dueTime: dueTime || '18:00',
    reminderIntervalDays,
    reminderTime: reminderTime || '16:00',
    status: 'PENDING'
  });
  
  // If user provided custom payment link, use it directly
  if (paymentLink && paymentLink.trim()) {
    invoice.paymentLink = paymentLink.trim();
    invoice.status = 'PENDING';
    await invoice.save();
    
    logger.info({ 
      invoiceNumber: invoice.invoiceNumber, 
      paymentLink: invoice.paymentLink,
      custom: true 
    }, 'Invoice created with user custom payment link');
  } else {
    // Auto-generate payment link via gateway
    try {
      const paymentResult = await createPaymentLink({
        amount,
        description,
        customerName: client.name,
        customerPhone: client.phone,
        customerEmail: client.email,
        referenceId: invoice.invoiceNumber
      });
      
      invoice.paymentLink = paymentResult.paymentLink;
      invoice.paymentGatewayId = paymentResult.paymentId;
      invoice.status = 'PENDING';
      await invoice.save();
      
      logger.info({ 
        invoiceNumber: invoice.invoiceNumber, 
        paymentLink: paymentResult.paymentLink,
        mock: paymentResult.mock 
      }, 'Invoice created with auto-generated payment link');
    } catch (error) {
      logger.error({ err: error, invoiceId: invoice._id }, 'Failed to create payment link');
      invoice.paymentLink = `https://rzp.io/i/${invoice.invoiceNumber}`;
      await invoice.save();
    }
  }
  
  // Populate client for response
  await invoice.populate('clientId', 'name phone email');
  
  res.status(201).json({
    success: true,
    invoice,
    paymentLink: invoice.paymentLink
  });
}));

/**
 * @route PUT /api/invoices/:id
 * @desc Update invoice
 */
router.put('/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(updateInvoiceSchema), asyncHandler(async (req, res) => {
  const invoice = await Invoice.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  ).lean().populate('clientId', 'name phone email');
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  res.json({
    success: true,
    invoice
  });
}));

/**
 * @route POST /api/invoices/:id/regenerate-link
 * @desc Regenerate payment link for invoice
 */
router.post('/:id/regenerate-link', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('clientId');
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  if (invoice.status === 'PAID') {
    return res.status(400).json({
      error: 'Cannot regenerate link for paid invoice',
      code: 'ALREADY_PAID'
    });
  }
  
  const paymentResult = await createPaymentLink({
    amount: invoice.amount,
    description: invoice.description,
    customerName: invoice.clientId.name,
    customerPhone: invoice.clientId.phone,
    customerEmail: invoice.clientId.email,
    referenceId: invoice.invoiceNumber
  });
  
  invoice.paymentLink = paymentResult.paymentLink;
  invoice.paymentGatewayId = paymentResult.paymentId;
  invoice.status = 'PENDING';
  await invoice.save();
  
  await invoice.populate('clientId', 'name phone email');
  
  res.json({
    success: true,
    invoice,
    paymentLink: paymentResult.paymentLink
  });
}));

/**
 * @route POST /api/invoices/:id/mark-paid
 * @desc Manually mark invoice as paid (for cash/offline payments)
 */
router.post('/:id/mark-paid', validateParams(z.object({ id: z.string().min(1) })), validateBody(z.object({
  transactionId: z.string().optional(),
  paidAt: z.string().datetime().optional().transform(v => v ? new Date(v) : new Date())
})), asyncHandler(async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const inv = markOfflineInvoicePaid(req.params.id);
    return res.json({ success: true, invoice: inv });
  }

  const invoice = await Invoice.findById(req.params.id).populate('clientId', 'name');
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  if (invoice.status === 'PAID') {
    return res.status(400).json({
      error: 'Invoice already marked as paid',
      code: 'ALREADY_PAID'
    });
  }
  
  const { transactionId, paidAt } = req.body;
  
  invoice.status = 'PAID';
  invoice.transactionId = transactionId || `manual_${Date.now()}`;
  invoice.paidAt = paidAt;
  invoice.webhookReceivedAt = new Date();
  await invoice.save();
  
  // Notify via SSE
  notifyPaymentReceived(invoice, {
    paymentId: invoice.transactionId,
    amount: invoice.amount,
    method: 'manual',
    paidAt: invoice.paidAt
  });
  
  logger.info({ invoiceNumber: invoice.invoiceNumber }, 'Invoice manually marked as paid');
  
  res.json({
    success: true,
    invoice: invoice.toJSON()
  });
}));

/**
 * @route DELETE /api/invoices/:id
 * @desc Delete invoice (only if DRAFT)
 */
router.delete('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  if (invoice.status !== 'DRAFT') {
    return res.status(409).json({
      error: 'Can only delete draft invoices',
      code: 'INVALID_STATUS',
      status: invoice.status
    });
  }
  
  await Invoice.findByIdAndDelete(req.params.id);
  
  res.json({
    success: true,
    message: 'Invoice deleted'
  });
}));

export default router;