import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Bill, BILL_CATEGORIES } from '../models/index.js';
import { validateBody, validateQuery, validateParams, createBillSchema, updateBillSchema, billQuerySchema } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { getOfflineBills, addOfflineBill, markOfflineBillPaid } from '../services/offline-store.js';

const router = express.Router();

/**
 * @route GET /api/bills
 * @desc Get bills with filters
 * @query status, category, fromDate, toDate, page, limit, sort, order
 */
router.get('/', validateQuery(billQuerySchema), asyncHandler(async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const list = getOfflineBills();
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
  const { status, category, fromDate, toDate, page = 1, limit = 20, sort = 'dueDate', order = 'asc' } = req.query;
  
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (fromDate || toDate) {
    filter.dueDate = {};
    if (fromDate) filter.dueDate.$gte = new Date(fromDate);
    if (toDate) filter.dueDate.$lte = new Date(toDate);
  }
  
  const sortOrder = order === 'asc' ? 1 : -1;
  const sortObj = { [sort]: sortOrder };
  
  const skip = (page - 1) * limit;
  
  const [bills, total] = await Promise.all([
    Bill.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean(),
    Bill.countDocuments(filter)
  ]);
  
  res.json({
    data: bills,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

/**
 * @route GET /api/bills/categories
 * @desc Get available bill categories
 */
router.get('/categories', (req, res) => {
  res.json({ categories: BILL_CATEGORIES });
});

/**
 * @route GET /api/bills/:id
 * @desc Get single bill
 */
router.get('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const bill = await Bill.findById(req.params.id).lean();
  
  if (!bill) {
    throw new NotFoundError('Bill');
  }
  
  res.json(bill);
}));

/**
 * @route POST /api/bills
 * @desc Create new bill
 */
router.post('/', validateBody(createBillSchema), asyncHandler(async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const newBill = addOfflineBill(req.body);
    return res.status(201).json({ success: true, bill: newBill });
  }

  const bill = await Bill.create(req.body);
  
  res.status(201).json({
    success: true,
    bill
  });
}));

/**
 * @route PUT /api/bills/:id
 * @desc Update bill
 */
router.put('/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(updateBillSchema), asyncHandler(async (req, res) => {
  const bill = await Bill.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  ).lean();
  
  if (!bill) {
    throw new NotFoundError('Bill');
  }
  
  res.json({
    success: true,
    bill
  });
}));

/**
 * @route POST /api/bills/:id/mark-paid
 * @desc Mark bill as paid
 */
router.post('/:id/mark-paid', validateParams(z.object({ id: z.string().min(1) })), validateBody(z.object({
  paidAt: z.string().datetime().optional().transform(v => v ? new Date(v) : new Date())
})), asyncHandler(async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const bill = markOfflineBillPaid(req.params.id);
    return res.json({ success: true, bill });
  }

  const bill = await Bill.findById(req.params.id);
  
  if (!bill) {
    throw new NotFoundError('Bill');
  }
  
  if (bill.status === 'PAID') {
    return res.status(400).json({
      error: 'Bill already marked as paid',
      code: 'ALREADY_PAID'
    });
  }
  
  bill.status = 'PAID';
  bill.paidAt = req.body.paidAt;
  await bill.save();
  
  res.json({
    success: true,
    bill: bill.toJSON()
  });
}));

/**
 * @route DELETE /api/bills/:id
 * @desc Delete bill
 */
router.delete('/:id', validateParams(z.object({ id: z.string().min(1) })), asyncHandler(async (req, res) => {
  const bill = await Bill.findByIdAndDelete(req.params.id);
  
  if (!bill) {
    throw new NotFoundError('Bill');
  }
  
  res.json({
    success: true,
    message: 'Bill deleted'
  });
}));

export default router;