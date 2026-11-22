import express from 'express';
import { z } from 'zod';
import { Invoice } from '../models/index.js';
import { sendInvoiceInitial, sendInvoiceReminder, sendInvoiceOverdue, isConfigured } from '../services/whatsapp.js';
import { notifyReminderSent } from '../services/sse.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route POST /api/reminders/trigger-now
 * @desc Manually trigger WhatsApp reminder for specific invoice
 * @body { invoiceId, type?: 'initial' | 'reminder' | 'overdue' }
 */
router.post('/trigger-now', validateBody(z.object({
  invoiceId: z.string().min(1),
  type: z.enum(['initial', 'reminder', 'overdue']).default('reminder')
})), asyncHandler(async (req, res) => {
  const { invoiceId, type } = req.body;
  
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'WhatsApp not configured',
      code: 'WHATSAPP_NOT_CONFIGURED'
    });
  }
  
  const invoice = await Invoice.findById(invoiceId).populate('clientId');
  
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  const client = invoice.clientId;
  if (!client || !client.phone) {
    return res.status(400).json({
      error: 'Invoice missing client phone number',
      code: 'MISSING_PHONE'
    });
  }
  
  if (client.whatsappOptOut) {
    return res.status(400).json({
      error: 'Client has opted out of WhatsApp messages',
      code: 'OPTED_OUT'
    });
  }
  
  let result;
  
  switch (type) {
    case 'initial':
      result = await sendInvoiceInitial({
        to: client.phone,
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        dueDate: invoice.dueDate,
        paymentLink: invoice.paymentLink
      });
      break;
      
    case 'reminder':
      result = await sendInvoiceReminder({
        to: client.phone,
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        dueDate: invoice.dueDate,
        paymentLink: invoice.paymentLink
      });
      break;
      
    case 'overdue':
      result = await sendInvoiceOverdue({
        to: client.phone,
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        daysOverdue: invoice.daysOverdue || 0,
        paymentLink: invoice.paymentLink
      });
      break;
      
    default:
      return res.status(400).json({
        error: 'Invalid reminder type',
        code: 'INVALID_TYPE'
      });
  }
  
  if (result.success) {
    // Update lastReminderSentAt for non-initial reminders
    if (type !== 'initial') {
      invoice.lastReminderSentAt = new Date();
      invoice.status = 'REMINDER_SENT';
      await invoice.save();
    }
    
    notifyReminderSent(invoice, type);
    
    logger.info({ 
      invoiceId: invoice.invoiceNumber, 
      type, 
      messageSid: result.messageSid,
      mock: result.mock
    }, 'Manual reminder sent');
  }
  
  res.json({
    success: result.success,
    messageSent: result.success,
    messageSid: result.messageSid,
    error: result.error,
    mock: result.mock
  });
}));

/**
 * @route POST /api/reminders/trigger-overdue
 * @desc Trigger overdue reminders for all overdue invoices
 */
router.post('/trigger-overdue', asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'WhatsApp not configured',
      code: 'WHATSAPP_NOT_CONFIGURED'
    });
  }
  
  const invoices = await Invoice.getOverdue();
  
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const invoice of invoices) {
    const client = invoice.clientId;
    
    if (!client || !client.phone || client.whatsappOptOut) {
      skipped++;
      continue;
    }
    
    // Check if we sent overdue recently (within 24 hours)
    const lastReminder = invoice.lastReminderSentAt;
    const shouldSend = !lastReminder || 
      (Date.now() - new Date(lastReminder).getTime()) > 24 * 60 * 60 * 1000;
    
    if (!shouldSend) {
      skipped++;
      continue;
    }
    
    const result = await sendInvoiceOverdue({
      to: client.phone,
      clientName: client.name,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: invoice.daysOverdue || 0,
      paymentLink: invoice.paymentLink
    });
    
    if (result.success) {
      invoice.lastReminderSentAt = new Date();
      invoice.status = 'REMINDER_SENT';
      await invoice.save();
      notifyReminderSent(invoice, 'overdue');
      sent++;
    } else {
      failed++;
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  logger.info({ sent, failed, skipped, total: invoices.length }, 'Bulk overdue reminders sent');
  
  res.json({
    success: true,
    sent,
    failed,
    skipped,
    total: invoices.length
  });
}));

/**
 * @route GET /api/reminders/status
 * @desc Get WhatsApp configuration status
 */
router.get('/status', (req, res) => {
  res.json({
    configured: isConfigured(),
    templates: {
      initial: process.env.TWILIO_TEMPLATE_INVOICE_INITIAL ? 'configured' : 'missing',
      reminder: process.env.TWILIO_TEMPLATE_INVOICE_REMINDER ? 'configured' : 'missing',
      overdue: process.env.TWILIO_TEMPLATE_INVOICE_OVERDUE ? 'configured' : 'missing'
    }
  });
});

export default router;