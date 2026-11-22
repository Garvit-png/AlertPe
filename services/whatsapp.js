import twilio from 'twilio';
import logger from '../utils/logger.js';

/**
 * WhatsApp Service - Abstracts Twilio Conversations API
 * Handles template-based messaging for invoice reminders
 */

let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken || accountSid.includes('xxxx') || authToken.includes('your_')) {
      logger.info('Twilio credentials not configured or placeholder used. WhatsApp running in direct redirect mode.');
      return null;
    }
    
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
}

/**
 * Template SIDs from environment
 */
const TEMPLATES = {
  initial: process.env.TWILIO_TEMPLATE_INVOICE_INITIAL,
  reminder: process.env.TWILIO_TEMPLATE_INVOICE_REMINDER,
  overdue: process.env.TWILIO_TEMPLATE_INVOICE_OVERDUE
};

/**
 * Send WhatsApp message using template
 * @param {Object} params
 * @param {string} params.to - Recipient phone in E.164 format (+919876543210)
 * @param {string} params.template - Template key: 'initial' | 'reminder' | 'overdue'
 * @param {Object} params.variables - Template variables
 * @returns {Promise<Object>} { success, messageSid, error }
 */
export async function sendTemplateMessage({ to, template, variables }) {
  const client = getTwilioClient();
  const templateSid = TEMPLATES[template];
  
  if (!client) {
    // Mock mode for development
    logger.info({ to, template, variables }, 'MOCK: Sending WhatsApp message');
    return {
      success: true,
      messageSid: `SMmock_${Date.now()}`,
      mock: true
    };
  }
  
  if (!templateSid) {
    const error = `Template SID not configured for: ${template}`;
    logger.error({ template }, error);
    return { success: false, error, mock: false };
  }
  
  // Validate phone format
  if (!to || !to.startsWith('+')) {
    return { success: false, error: 'Invalid phone format (must be E.164)', mock: false };
  }
  
  try {
    // Build content variables object for Twilio
    const contentVariables = {};
    Object.entries(variables).forEach(([key, value], index) => {
      contentVariables[`${index + 1}`] = String(value);
    });
    
    const message = await client.messages.create({
      contentSid: templateSid,
      contentVariables: JSON.stringify(contentVariables),
      from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
      to: `whatsapp:${to}`
    });
    
    logger.info({ 
      to, 
      template, 
      messageSid: message.sid,
      status: message.status 
    }, 'WhatsApp message sent');
    
    return {
      success: true,
      messageSid: message.sid,
      status: message.status,
      mock: false
    };
  } catch (error) {
    logger.error({ err: error, to, template }, 'Failed to send WhatsApp message');
    
    // Handle specific Twilio errors
    if (error.code === 63038) {
      return { success: false, error: 'Template not approved', mock: false };
    }
    if (error.code === 21610) {
      return { success: false, error: 'Recipient opted out', mock: false };
    }
    if (error.code === 21211) {
      return { success: false, error: 'Invalid phone number', mock: false };
    }
    
    return { success: false, error: error.message, mock: false };
  }
}

/**
 * Send initial invoice notification
 */
export async function sendInvoiceInitial({ to, clientName, invoiceNumber, amount, dueDate, paymentLink }) {
  return sendTemplateMessage({
    to,
    template: 'initial',
    variables: {
      1: clientName,
      2: invoiceNumber,
      3: `₹${Number(amount).toLocaleString('en-IN')}`,
      4: formatDate(dueDate),
      5: paymentLink
    }
  });
}

/**
 * Send reminder notification
 */
export function sendInvoiceReminder({ to, clientName, invoiceNumber, amount, dueDate, paymentLink }) {
  return sendTemplateMessage({
    to,
    template: 'reminder',
    variables: {
      1: clientName,
      2: invoiceNumber,
      3: `₹${Number(amount).toLocaleString('en-IN')}`,
      4: formatDate(dueDate),
      5: paymentLink
    }
  });
}

/**
 * Send overdue notification
 */
export function sendInvoiceOverdue({ to, clientName, invoiceNumber, amount, daysOverdue, paymentLink }) {
  return sendTemplateMessage({
    to,
    template: 'overdue',
    variables: {
      1: clientName,
      2: invoiceNumber,
      3: `₹${Number(amount).toLocaleString('en-IN')}`,
      4: daysOverdue,
      5: paymentLink
    }
  });
}

/**
 * Format date for WhatsApp messages (DD MMM YYYY)
 */
function formatDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Check if WhatsApp Twilio API is fully configured
 */
export function isConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return !!(sid && token && !sid.includes('xxxx') && !token.includes('your_'));
}

/**
 * Generate a pre-filled direct WhatsApp redirect link (WhatsApp Web / App)
 */
export function buildWhatsAppDirectUrl({ phone, clientName, invoiceNumber, amount, dueDate, paymentLink, isOverdue, daysOverdue, businessName, senderPhone }) {
  if (!phone) return null;
  const cleanPhone = phone.replace(/[^\d]/g, '');
  const formattedDate = formatDate(dueDate);
  const formattedAmount = `₹${Number(amount).toLocaleString('en-IN')}`;
  const link = paymentLink || `https://rzp.io/i/${invoiceNumber}`;
  const bName = businessName || 'AlertPe Finance';
  const contactLine = senderPhone ? `\nWhatsApp: ${senderPhone}` : '';

  let message = '';
  if (isOverdue) {
    message = `*${bName} - Payment Overdue Notice*\n\nHello ${clientName},\nThis is an urgent reminder that invoice *#${invoiceNumber}* for *${formattedAmount}* was due on *${formattedDate}* and is now overdue.\n\nPlease clear the payment immediately using this link:\n${link}\n\nThank you,\n${bName}${contactLine}`;
  } else {
    message = `*${bName} - Invoice Reminder*\n\nHello ${clientName},\nThis is a friendly reminder that invoice *#${invoiceNumber}* for *${formattedAmount}* is due on *${formattedDate}*.\n\nYou can pay quickly and securely via UPI / Cards here:\n${link}\n\nThank you,\n${bName}${contactLine}`;
  }

  return {
    url: `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`,
    text: message,
    phone: cleanPhone
  };
}

/**
 * Get template status (for debugging)
 */
export function getTemplateStatus() {
  return {
    initial: TEMPLATES.initial ? 'configured' : 'missing',
    reminder: TEMPLATES.reminder ? 'configured' : 'missing',
    overdue: TEMPLATES.overdue ? 'configured' : 'missing'
  };
}

export default {
  sendTemplateMessage,
  sendInvoiceInitial,
  sendInvoiceReminder,
  sendInvoiceOverdue,
  isConfigured,
  getTemplateStatus
};