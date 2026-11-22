import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Invoice, BusinessProfile } from '../models/index.js';
import { sendInvoiceInitial, sendInvoiceReminder, sendInvoiceOverdue, isConfigured, buildWhatsAppDirectUrl } from '../services/whatsapp.js';
import { notifyReminderSent } from '../services/sse.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { findOfflineInvoice } from '../services/offline-store.js';

const router = express.Router();

/**
 * @route POST /api/reminders/trigger-now
 * @desc Trigger WhatsApp reminder for specific invoice (via Twilio and/or direct wa.me link)
 * @body { invoiceId, type?: 'initial' | 'reminder' | 'overdue' }
 */
router.post('/trigger-now', validateBody(z.object({
  invoiceId: z.string().min(1),
  type: z.enum(['initial', 'reminder', 'overdue']).default('reminder')
})), asyncHandler(async (req, res) => {
  const { invoiceId, type } = req.body;
  
  let invoice = null;
  if (mongoose.connection.readyState === 1) {
    invoice = await Invoice.findById(invoiceId).populate('clientId');
  } else {
    invoice = findOfflineInvoice(invoiceId);
  }

  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  const client = invoice.clientId;
  if (!client || !client.phone) {
    return res.status(400).json({
      error: 'Invoice is missing client phone number',
      code: 'MISSING_PHONE'
    });
  }

  const profile = await BusinessProfile.getActiveProfile();

  // Generate direct WhatsApp redirect link
  const direct = buildWhatsAppDirectUrl({
    phone: client.phone,
    clientName: client.name,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoice.amount,
    dueDate: invoice.dueDate,
    dueTime: invoice.dueTime,
    paymentLink: invoice.paymentLink,
    isOverdue: invoice.isOverdue || type === 'overdue',
    daysOverdue: invoice.daysOverdue || 0,
    businessName: profile?.businessName,
    senderPhone: profile?.phone
  });

  let twilioResult = { success: false, mock: true };
  if (isConfigured() && !client.whatsappOptOut) {
    try {
      if (type === 'overdue' || invoice.isOverdue) {
        twilioResult = await sendInvoiceOverdue({
          to: client.phone,
          clientName: client.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          daysOverdue: invoice.daysOverdue || 0,
          paymentLink: invoice.paymentLink
        });
      } else {
        twilioResult = await sendInvoiceReminder({
          to: client.phone,
          clientName: client.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          dueDate: invoice.dueDate,
          paymentLink: invoice.paymentLink
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'Twilio API dispatch skipped/failed');
    }
  }

  // Update invoice reminder tracking
  invoice.lastReminderSentAt = new Date();
  if (invoice.status !== 'PAID') {
    invoice.status = (invoice.isOverdue || type === 'overdue') ? 'OVERDUE' : 'REMINDER_SENT';
  }
  await invoice.save();

  notifyReminderSent(invoice, type);

  res.json({
    success: true,
    messageSent: true,
    whatsappUrl: direct?.url,
    messageText: direct?.text,
    mode: isConfigured() ? 'twilio_and_direct' : 'whatsapp_redirect',
    mock: !isConfigured()
  });
}));

/**
 * @route POST /api/reminders/auto-check
 * @desc AI Automated Follow-up engine: checks payments, reconciles overdue statuses, and triggers follow-up alerts
 */
router.post('/auto-check', asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all active unpaid invoices
  const invoices = await Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } }).populate('clientId');

  let overdueCount = 0;
  let remindersTriggered = 0;
  const updates = [];

  const profile = await BusinessProfile.getActiveProfile();
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  for (const inv of invoices) {
    // Exact deadline check with Due Date + Due Time
    let dueDateTime = new Date(inv.dueDate);
    if (inv.dueTime && inv.dueTime.includes(':')) {
      const [h, m] = inv.dueTime.split(':').map(Number);
      dueDateTime.setHours(h || 0, m || 0, 0, 0);
    }
    const isPastDue = now > dueDateTime;
    let changed = false;

    // Check Overdue status
    if (isPastDue && inv.status !== 'OVERDUE') {
      inv.status = 'OVERDUE';
      overdueCount++;
      changed = true;
    }

    // Check if due for reminder based on interval and specific daily send time
    const intervalMs = (inv.reminderIntervalDays || 2) * 24 * 60 * 60 * 1000;
    const lastSent = inv.lastReminderSentAt ? new Date(inv.lastReminderSentAt).getTime() : 0;
    
    // Check reminder time of day (e.g. '16:00' -> 4:00 PM)
    const [targetHour, targetMinute] = (inv.reminderTime || '16:00').split(':').map(Number);
    const isTimeReached = (currentHour > targetHour) || (currentHour === targetHour && currentMinute >= targetMinute);
    const isIntervalElapsed = (now.getTime() - lastSent) >= intervalMs;

    if (isTimeReached && isIntervalElapsed) {
      inv.lastReminderSentAt = now;
      if (!isPastDue) inv.status = 'REMINDER_SENT';
      remindersTriggered++;
      changed = true;

      const direct = buildWhatsAppDirectUrl({
        phone: inv.clientId?.phone,
        clientName: inv.clientId?.name || 'Client',
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        dueDate: inv.dueDate,
        dueTime: inv.dueTime,
        paymentLink: inv.paymentLink,
        isOverdue: isPastDue,
        daysOverdue: Math.floor((now - dueDateTime) / (1000 * 60 * 60 * 24)),
        businessName: profile?.businessName,
        senderPhone: profile?.phone
      });

      updates.push({
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.clientId?.name,
        amount: inv.amount,
        status: inv.status,
        whatsappUrl: direct?.url
      });
    }

    if (changed) {
      await inv.save();
    }
  }

  res.json({
    success: true,
    message: `Checked ${invoices.length} invoices. ${overdueCount} marked overdue, ${remindersTriggered} follow-ups scheduled.`,
    stats: {
      totalChecked: invoices.length,
      overdueCount,
      remindersTriggered
    },
    updates
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