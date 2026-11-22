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
    
    if (!accountSid || !authToken) {
      logger.warn('Twilio credentials not configured');
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
 * Check if WhatsApp is configured
 */
export function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
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