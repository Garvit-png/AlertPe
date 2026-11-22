import logger from '../utils/logger.js';

/**
 * Server-Sent Events (SSE) Manager
 * Handles real-time server-to-client updates for:
 * - Payment received notifications
 * - Reminder sent confirmations
 * - Overdue status changes
 * - Dashboard stat updates
 */

const clients = new Map(); // clientId -> Set of response objects
const MAX_CLIENTS = 1000;

/**
 * Add a new SSE client connection
 * @param {string} clientId - Unique client identifier
 * @param {object} res - Express response object
 */
export function addClient(clientId, res) {
  if (clients.size >= MAX_CLIENTS) {
    logger.warn('Max SSE clients reached, rejecting new connection');
    return false;
  }
  
  if (!clients.has(clientId)) {
    clients.set(clientId, new Set());
  }
  
  const clientSet = clients.get(clientId);
  clientSet.add(res);
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();
  
  // Send initial connection event
  sendEvent(res, 'connected', { clientId, timestamp: new Date().toISOString() });
  
  // Heartbeat interval (30 seconds)
  const heartbeat = setInterval(() => {
    sendEvent(res, 'heartbeat', { timestamp: new Date().toISOString() });
  }, 30000);
  
  // Cleanup on disconnect
  res.on('close', () => {
    clearInterval(heartbeat);
    removeClient(clientId, res);
  });
  
  logger.debug({ clientId, totalClients: getClientCount() }, 'SSE client connected');
  return true;
}

/**
 * Remove a client connection
 * @param {string} clientId
 * @param {object} res
 */
export function removeClient(clientId, res) {
  const clientSet = clients.get(clientId);
  if (clientSet) {
    clientSet.delete(res);
    if (clientSet.size === 0) {
      clients.delete(clientId);
    }
  }
  logger.debug({ clientId, totalClients: getClientCount() }, 'SSE client disconnected');
}

/**
 * Get total connected clients count
 */
export function getClientCount() {
  let count = 0;
  for (const set of clients.values()) {
    count += set.size;
  }
  return count;
}

/**
 * Send event to a specific response object
 */
function sendEvent(res, event, data) {
  try {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
  } catch (error) {
    // Connection likely closed
  }
}

/**
 * Broadcast event to all connected clients
 * @param {string} event - Event name
 * @param {object} data - Event data
 * @param {string} [excludeClientId] - Optional client ID to exclude
 */
export function broadcast(event, data, excludeClientId = null) {
  let sent = 0;
  
  for (const [clientId, clientSet] of clients.entries()) {
    if (clientId === excludeClientId) continue;
    
    for (const res of clientSet) {
      sendEvent(res, event, data);
      sent++;
    }
  }
  
  if (sent > 0) {
    logger.debug({ event, sent, dataKeys: Object.keys(data) }, 'SSE broadcast sent');
  }
}

/**
 * Send event to specific client ID (all their connections)
 * @param {string} clientId
 * @param {string} event
 * @param {object} data
 */
export function sendToClient(clientId, event, data) {
  const clientSet = clients.get(clientId);
  if (!clientSet) return 0;
  
  let sent = 0;
  for (const res of clientSet) {
    sendEvent(res, event, data);
    sent++;
  }
  return sent;
}

/**
 * Predefined event types for CashPilot
 */
export const EVENTS = {
  PAYMENT_RECEIVED: 'payment_received',
  REMINDER_SENT: 'reminder_sent',
  INVOICE_OVERDUE: 'invoice_overdue',
  INVOICE_CREATED: 'invoice_created',
  INVOICE_UPDATED: 'invoice_updated',
  BILL_CREATED: 'bill_created',
  BILL_UPDATED: 'bill_updated',
  STATS_UPDATED: 'stats_updated',
  FORECAST_UPDATED: 'forecast_updated',
  ERROR: 'error'
};

/**
 * Helper: Send payment received notification
 */
export function notifyPaymentReceived(invoice, payment) {
  broadcast(EVENTS.PAYMENT_RECEIVED, {
    invoice: {
      id: invoice._id?.toString() || invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      clientName: invoice.clientId?.name || invoice.clientName
    },
    payment: {
      id: payment.paymentId,
      amount: payment.amount,
      method: payment.method,
      paidAt: payment.paidAt
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper: Send reminder sent notification
 */
export function notifyReminderSent(invoice, reminderType) {
  broadcast(EVENTS.REMINDER_SENT, {
    invoice: {
      id: invoice._id?.toString() || invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientId?.name || invoice.clientName
    },
    reminderType, // 'initial' | 'reminder' | 'overdue'
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper: Send invoice overdue notification
 */
export function notifyInvoiceOverdue(invoice) {
  broadcast(EVENTS.INVOICE_OVERDUE, {
    invoice: {
      id: invoice._id?.toString() || invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      clientName: invoice.clientId?.name || invoice.clientName,
      daysOverdue: invoice.daysOverdue
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper: Send stats update (trigger dashboard refresh)
 */
export function notifyStatsUpdated(stats) {
  broadcast(EVENTS.STATS_UPDATED, {
    stats,
    timestamp: new Date().toISOString()
  });
}

export default {
  addClient,
  removeClient,
  getClientCount,
  broadcast,
  sendToClient,
  EVENTS,
  notifyPaymentReceived,
  notifyReminderSent,
  notifyInvoiceOverdue,
  notifyStatsUpdated
};