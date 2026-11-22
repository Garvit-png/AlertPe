import express from 'express';
import { z } from 'zod';
import { Invoice, Client } from '../models/index.js';
import { validateBody, validateQuery, validateParams, createInvoiceSchema, updateInvoiceSchema, invoiceQuerySchema } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { createPaymentLink, isConfigured as isPaymentConfigured } from '../services/payment-gateway.js';
import { notifyPaymentReceived } from '../services/sse.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route GET /api/invoices
 * @desc Get invoices with filters
 * @query status, clientId, fromDate, toDate, page, limit, sort, order
 */
router.get('/', validateQuery(invoiceQuerySchema), asyncHandler(async (req, res) => {
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
  const { clientId, amount, description, dueDate, reminderIntervalDays } = req.body;
  
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
    reminderIntervalDays,
    status: 'DRAFT' // Will become PENDING after payment link created
  });
  
  // Generate payment link
  let paymentResult;
  try {
    paymentResult = await createPaymentLink({
      amount,
      description,
      customerName: client.name,
      customerPhone: client.phone,
      customerEmail: client.email,
      referenceId: invoice.invoiceNumber
    });
    
    // Update invoice with payment link
    invoice.paymentLink = paymentResult.paymentLink;
    invoice.paymentGatewayId = paymentResult.paymentId;
    invoice.status = 'PENDING';
    await invoice.save();
    
    logger.info({ 
      invoiceNumber: invoice.invoiceNumber, 
      paymentLink: paymentResult.paymentLink,
      mock: paymentResult.mock 
    }, 'Invoice created with payment link');
  } catch (error) {
    logger.error({ err: error, invoiceId: invoice._id }, 'Failed to create payment link');
    // Keep invoice as DRAFT so user can retry
    return res.status(500).json({
      error: 'Invoice created but payment link generation failed',
      code: 'PAYMENT_LINK_FAILED',
      invoice: invoice.toJSON()
    });
  }
  
  // Populate client for response
  await invoice.populate('clientId', 'name phone email');
  
  res.status(201).json({
    success: true,
    invoice,
    paymentLink: paymentResult.paymentLink
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