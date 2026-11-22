import { Invoice } from '../models/index.js';

/**
 * Generate a human-readable, unique invoice number
 * Format: INV-YYYYMMDD-XXXX (e.g., INV-20261122-0042)
 * - Date prefix for chronological sorting
 * - 4-digit sequence for same-day uniqueness
 */
export async function generateInvoiceNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${dateStr}-`;
  
  // Find the highest sequence number for today
  const lastInvoice = await Invoice.findOne(
    { invoiceNumber: { $regex: `^${prefix}` } },
    { invoiceNumber: 1 },
    { sort: { invoiceNumber: -1 } }
  ).lean();
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSeq = parseInt(lastInvoice.invoiceNumber.slice(-4), 10);
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }
  
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

/**
 * Validate invoice number format
 */
export function validateInvoiceNumber(invoiceNumber) {
  return /^INV-\d{8}-\d{4}$/.test(invoiceNumber);
}

/**
 * Extract date from invoice number
 */
export function getDateFromInvoiceNumber(invoiceNumber) {
  const match = invoiceNumber.match(/^INV-(\d{4})(\d{2})(\d{2})-/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}`);
}

export default { generateInvoiceNumber, validateInvoiceNumber, getDateFromInvoiceNumber };