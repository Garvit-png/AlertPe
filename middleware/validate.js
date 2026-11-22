import { z } from 'zod';

/**
 * Validation Middleware using Zod
 * Shared schemas for client and server validation
 */

// Phone: E.164 format
const phoneSchema = z.string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (e.g., +919876543210)');

// Currency amount in rupees (positive, max 2 decimal places)
const amountSchema = z.number()
  .positive('Amount must be positive')
  .max(999999999, 'Amount too large')
  .refine(val => Number.isFinite(val), 'Amount must be a valid number');

// Date string or Date object
const dateSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  z.date()
]).transform(val => new Date(val));

// Client schemas
export const createClientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
  phone: phoneSchema,
  email: z.string().email('Invalid email').max(100).optional().or(z.literal('')),
  businessCategory: z.string().max(50).optional(),
  notes: z.string().max(500).optional()
});

export const updateClientSchema = createClientSchema.partial();

// Invoice schemas
export const createInvoiceSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  amount: amountSchema,
  description: z.string().min(1, 'Description is required').max(200, 'Description too long').trim(),
  dueDate: dateSchema,
  reminderIntervalDays: z.number().int().positive().max(30).default(2)
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  status: z.enum(['DRAFT', 'PENDING', 'REMINDER_SENT', 'PAID', 'OVERDUE']).optional(),
  paymentLink: z.string().url().optional(),
  paymentGatewayId: z.string().optional(),
  transactionId: z.string().optional()
});

// Bill schemas
export const createBillSchema = z.object({
  vendorName: z.string().min(1, 'Vendor name is required').max(100).trim(),
  amount: amountSchema,
  category: z.enum(['Rent', 'Salaries', 'Suppliers', 'Utilities', 'Software', 'Other']).default('Other'),
  dueDate: dateSchema,
  notes: z.string().max(300).optional()
});

export const updateBillSchema = createBillSchema.partial().extend({
  status: z.enum(['PENDING', 'PAID']).optional()
});

// Simulation schema
export const simulateWhatIfSchema = z.object({
  invoiceId: z.string().optional(),
  clientId: z.string().optional(),
  shiftDays: z.number().int().min(-90).max(90).default(0)
}).refine(data => data.invoiceId || data.clientId, {
  message: 'Either invoiceId or clientId is required',
  path: ['invoiceId']
});

// Query parameter schemas
export const invoiceQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'REMINDER_SENT', 'PAID', 'OVERDUE']).optional(),
  clientId: z.string().optional(),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['dueDate', 'createdAt', 'amount', 'invoiceNumber']).default('dueDate'),
  order: z.enum(['asc', 'desc']).default('asc')
});

export const billQuerySchema = z.object({
  status: z.enum(['PENDING', 'PAID']).optional(),
  category: z.enum(['Rent', 'Salaries', 'Suppliers', 'Utilities', 'Software', 'Other']).optional(),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['dueDate', 'createdAt', 'amount', 'vendorName']).default('dueDate'),
  order: z.enum(['asc', 'desc']).default('asc')
});

export const clientQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['name', 'createdAt', 'totalOwed']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Validation middleware factory
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Request property to validate ('body', 'query', 'params')
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    
    const result = schema.safeParse(data);
    
    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }
    
    // Replace request data with parsed/transformed data
    req[source] = result.data;
    next();
  };
}

/**
 * Validate request body
 */
export const validateBody = (schema) => validate(schema, 'body');

/**
 * Validate query parameters
 */
export const validateQuery = (schema) => validate(schema, 'query');

/**
 * Validate route parameters
 */
export const validateParams = (schema) => validate(schema, 'params');

export default {
  validate,
  validateBody,
  validateQuery,
  validateParams,
  // Schemas
  createClientSchema,
  updateClientSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  createBillSchema,
  updateBillSchema,
  simulateWhatIfSchema,
  invoiceQuerySchema,
  billQuerySchema,
  clientQuerySchema
};