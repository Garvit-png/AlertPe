import cron from 'node-cron';
import { Invoice, Bill } from '../models/index.js';
import { sendInvoiceReminder, sendInvoiceOverdue, isConfigured as isWhatsAppConfigured } from './whatsapp.js';
import { notifyReminderSent, notifyInvoiceOverdue } from './sse.js';
import logger from '../utils/logger.js';

/**
 * Cron Jobs Service
 * Handles scheduled tasks:
 * - Daily reminder sending (9 AM)
 * - Overdue status updates (midnight)
 * - Daily forecast recomputation (6 AM)
 */

let reminderJob = null;
let overdueJob = null;
let forecastJob = null;
let activeIntervalJob = null;

/**
 * Send reminders for invoices due for follow-up
 */
async function sendReminders() {
  logger.info('Starting reminder job');
  
  try {
    // Find invoices needing reminders
    const invoices = await Invoice.getDueForReminder();
    logger.info({ count: invoices.length }, 'Invoices due for reminder');
    
    let sent = 0;
    let failed = 0;
    
    for (const invoice of invoices) {
      if (invoice.clientId?.whatsappOptOut) continue;
      
      const client = invoice.clientId;
      if (!client || !client.phone) continue;
      
      try {
        if (isWhatsAppConfigured()) {
          const result = await sendInvoiceReminder({
            to: client.phone,
            clientName: client.name,
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.amount,
            dueDate: invoice.dueDate,
            paymentLink: invoice.paymentLink
          });
          if (result.success) sent++;
          else failed++;
        } else {
          // Simulated follow-up
          sent++;
          logger.debug({ invoiceId: invoice.invoiceNumber }, 'Simulated WhatsApp reminder scheduled');
        }

        await invoice.scheduleReminder();
        notifyReminderSent(invoice, 'reminder');
      } catch (error) {
        failed++;
        logger.error({ err: error, invoiceId: invoice.invoiceNumber }, 'Error sending reminder');
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info({ sent, failed, total: invoices.length }, 'Reminder job completed');
    return { sent, failed, total: invoices.length };
  } catch (error) {
    logger.error({ err: error }, 'Reminder job failed');
    throw error;
  }
}

/**
 * Check and update overdue invoices
 * Runs daily at 00:30 (after midnight)
 */
async function checkOverdue() {
  logger.info('Starting overdue check job');
  
  try {
    const invoices = await Invoice.getOverdue();
    logger.info({ count: invoices.length }, 'Overdue invoices found');
    
    let updated = 0;
    
    for (const invoice of invoices) {
      try {
        // Update status to OVERDUE if not already
        if (invoice.status !== 'OVERDUE') {
          invoice.status = 'OVERDUE';
          await invoice.save();
          updated++;
          
          // Notify via SSE
          notifyInvoiceOverdue(invoice);
          
          // Send overdue WhatsApp if configured and not already sent today
          if (isWhatsAppConfigured() && invoice.clientId?.phone && !invoice.clientId?.whatsappOptOut) {
            const client = invoice.clientId;
            const daysOverdue = invoice.daysOverdue;
            
            // Only send overdue notification once per day per invoice
            // Check if last reminder was sent more than 24 hours ago
            const lastReminder = invoice.lastReminderSentAt;
            const shouldSendOverdue = !lastReminder || 
              (Date.now() - new Date(lastReminder).getTime()) > 24 * 60 * 60 * 1000;
            
            if (shouldSendOverdue) {
              await sendInvoiceOverdue({
                to: client.phone,
                clientName: client.name,
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.amount,
                daysOverdue,
                paymentLink: invoice.paymentLink
              });
              
              // Update lastReminderSentAt to prevent spam
              invoice.lastReminderSentAt = new Date();
              await invoice.save();
            }
          }
        }
      } catch (error) {
        logger.error({ err: error, invoiceId: invoice.invoiceNumber }, 'Error updating overdue');
      }
    }
    
    logger.info({ updated, total: invoices.length }, 'Overdue check completed');
    return { updated, total: invoices.length };
  } catch (error) {
    logger.error({ err: error }, 'Overdue check job failed');
    throw error;
  }
}

/**
 * Recompute cashflow forecast
 * Runs daily at 6:00 AM
 */
async function recomputeForecast() {
  logger.info('Starting forecast recomputation job');
  
  try {
    // This would typically update a cached forecast in Redis or database
    // For now, just log that it would run
    // In MVP, forecast is computed on-demand
    
    const invoiceCount = await Invoice.countDocuments({ status: { $nin: ['PAID', 'DRAFT'] } });
    const billCount = await Bill.countDocuments({ status: 'PENDING' });
    
    logger.info({ invoiceCount, billCount }, 'Forecast recomputation completed');
    return { invoiceCount, billCount };
  } catch (error) {
    logger.error({ err: error }, 'Forecast recomputation failed');
    throw error;
  }
}

/**
 * Start all cron jobs
 */
export function startCronJobs() {
  if (process.env.NODE_ENV === 'test') {
    logger.info('Skipping cron jobs in test environment');
    return;
  }
  
  // Reminder job: Daily at 9:00 AM
  reminderJob = cron.schedule('0 9 * * *', async () => {
    try {
      await sendReminders();
    } catch (error) {
      logger.error({ err: error }, 'Scheduled reminder job failed');
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Overdue check: Daily at 00:30 AM
  overdueJob = cron.schedule('30 0 * * *', async () => {
    try {
      await checkOverdue();
    } catch (error) {
      logger.error({ err: error }, 'Scheduled overdue job failed');
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Forecast recomputation: Daily at 6:00 AM
  forecastJob = cron.schedule('0 6 * * *', async () => {
    try {
      await recomputeForecast();
    } catch (error) {
      logger.error({ err: error }, 'Scheduled forecast job failed');
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Active payment and overdue reconciliation: Every 10 minutes
  activeIntervalJob = cron.schedule('*/10 * * * *', async () => {
    try {
      await checkOverdue();
      await sendReminders();
    } catch (error) {
      logger.error({ err: error }, 'Active reconciliation check failed');
    }
  });

  logger.info('Cron jobs started:', {
    reminder: '0 9 * * * (9:00 AM IST)',
    overdue: '30 0 * * * (12:30 AM IST)',
    forecast: '0 6 * * * (6:00 AM IST)',
    activeTimer: '*/10 * * * * (Every 10 mins)'
  });
}

/**
 * Stop all cron jobs
 */
export function stopCronJobs() {
  if (reminderJob) reminderJob.stop();
  if (overdueJob) overdueJob.stop();
  if (forecastJob) forecastJob.stop();
  if (activeIntervalJob) activeIntervalJob.stop();
  logger.info('All cron jobs stopped');
}

/**
 * Trigger reminder job manually (for testing)
 */
export async function triggerRemindersNow() {
  return sendReminders();
}

/**
 * Trigger overdue check manually
 */
export async function triggerOverdueCheck() {
  return checkOverdue();
}

export default {
  startCronJobs,
  stopCronJobs,
  sendReminders,
  checkOverdue,
  recomputeForecast,
  triggerRemindersNow,
  triggerOverdueCheck
};