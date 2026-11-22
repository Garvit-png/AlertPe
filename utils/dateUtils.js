import { 
  format, 
  parseISO, 
  startOfDay, 
  endOfDay, 
  addDays, 
  differenceInDays, 
  isValid 
} from 'date-fns';

// Re-export for convenience
export { addDays };
import { format as formatTz } from 'date-fns-tz';

// Default timezone for Indian users (IST = UTC+5:30)
const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Get current date in user's timezone (start of day)
 * For MVP: Use system local time which should be IST for Indian users
 */
export function getTodayStart(timezone = DEFAULT_TZ) {
  return startOfDay(new Date());
}

/**
 * Get current date in user's timezone (end of day)
 */
export function getTodayEnd(timezone = DEFAULT_TZ) {
  return endOfDay(new Date());
}

/**
 * Format date for display (DD MMM YYYY)
 */
export function formatDate(date, timezone = DEFAULT_TZ) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return 'Invalid date';
  try {
    return formatTz(d, 'dd MMM yyyy', { timeZone: timezone });
  } catch {
    return format(d, 'dd MMM yyyy');
  }
}

/**
 * Format date for input (YYYY-MM-DD)
 */
export function formatDateInput(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return '';
  return format(d, 'yyyy-MM-dd');
}

/**
 * Format date and time for display
 */
export function formatDateTime(date, timezone = DEFAULT_TZ) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return 'Invalid date';
  try {
    return formatTz(d, 'dd MMM yyyy, HH:mm', { timeZone: timezone });
  } catch {
    return format(d, 'dd MMM yyyy, HH:mm');
  }
}

/**
 * Format relative time (e.g., "2 days ago", "in 3 days")
 */
export function formatRelative(date, timezone = DEFAULT_TZ) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (!isValid(d)) return 'Invalid date';
  
  const now = new Date();
  const diffDays = differenceInDays(startOfDay(d), startOfDay(now));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 0) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

/**
 * Check if date is overdue (past due date)
 */
export function isOverdue(dueDate, timezone = DEFAULT_TZ) {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const today = getTodayStart(timezone);
  return due < today;
}

/**
 * Check if date is due soon (within N days)
 */
export function isDueSoon(dueDate, days = 2, timezone = DEFAULT_TZ) {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const today = getTodayStart(timezone);
  const soon = addDays(today, days);
  return due >= today && due <= soon;
}

/**
 * Get days until due (negative if overdue)
 */
export function getDaysUntilDue(dueDate, timezone = DEFAULT_TZ) {
  if (!dueDate) return null;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const today = getTodayStart(timezone);
  return differenceInDays(startOfDay(due), today);
}

/**
 * Parse date from various formats safely
 */
export function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    // Try ISO first
    const iso = parseISO(input);
    if (isValid(iso)) return iso;
    // Try YYYY-MM-DD
    const parts = input.split('-');
    if (parts.length === 3) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      if (isValid(d)) return d;
    }
  }
  return null;
}

/**
 * Get start of day in UTC for a given date
 */
export function startOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Get end of day in UTC for a given date
 */
export function endOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export default {
  getTodayStart,
  getTodayEnd,
  formatDate,
  formatDateInput,
  formatDateTime,
  formatRelative,
  isOverdue,
  isDueSoon,
  getDaysUntilDue,
  parseDate,
  startOfDayUTC,
  endOfDayUTC
};