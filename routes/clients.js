import express from 'express';
import { z } from 'zod';
import { Client, Invoice } from '../models/index.js';
import { validateBody, validateQuery, validateParams, createClientSchema, updateClientSchema, clientQuerySchema } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * @route GET /api/clients
 * @desc Get all clients with metrics
 * @query search, page, limit, sort, order
 */
router.get('/', validateQuery(clientQuerySchema), asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20, sort = 'createdAt', order = 'desc' } = req.query;
  
  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }
  
  const sortOrder = order === 'asc' ? 1 : -1;
  const sortObj = { [sort]: sortOrder };
  
  const skip = (page - 1) * limit;
  
  const [clients, total] = await Promise.all([
    Client.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean()
      .populate({
        path: 'totalOwed',
        match: { status: { $nin: ['PAID', 'DRAFT'] } },
        select: 'amount'
      }),
    Client.countDocuments(filter)
  ]);
  
  // Calculate metrics for each client
  const clientsWithMetrics = clients.map(client => ({
    ...client,
    totalOwed: client.totalOwed?.reduce((sum, inv) => sum + inv.amount, 0) || 0,
    pendingCount: client.totalOwed?.length || 0
  }));
  
  res.json({
    data: clientsWithMetrics,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

/**
 * @route GET /api/clients/:id
 * @desc Get single client with invoices
 */
router.get('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id).lean();
  
  if (!client) {
    throw new NotFoundError('Client');
  }
  
  // Get client's invoices
  const invoices = await Invoice.find({ clientId: client._id })
    .sort({ dueDate: 1 })
    .lean();
  
  res.json({
    ...client,
    invoices
  });
}));

/**
 * @route POST /api/clients
 * @desc Create new client
 */
router.post('/', validateBody(createClientSchema), asyncHandler(async (req, res) => {
  const client = await Client.create(req.body);
  
  res.status(201).json({
    success: true,
    client
  });
}));

/**
 * @route PUT /api/clients/:id
 * @desc Update client
 */
router.put('/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(updateClientSchema), asyncHandler(async (req, res) => {
  const client = await Client.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  ).lean();
  
  if (!client) {
    throw new NotFoundError('Client');
  }
  
  res.json({
    success: true,
    client
  });
}));

/**
 * @route DELETE /api/clients/:id
 * @desc Delete client (only if no invoices)
 */
router.delete('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  // Check for associated invoices
  const invoiceCount = await Invoice.countDocuments({ clientId: req.params.id });
  
  if (invoiceCount > 0) {
    return res.status(409).json({
      error: 'Cannot delete client with associated invoices',
      code: 'HAS_INVOICES',
      invoiceCount
    });
  }
  
  const client = await Client.findByIdAndDelete(req.params.id);
  
  if (!client) {
    throw new NotFoundError('Client');
  }
  
  res.json({
    success: true,
    message: 'Client deleted'
  });
}));

export default router;