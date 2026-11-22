import mongoose from 'mongoose';
import { generateInvoiceNumber } from '../utils/invoiceNumber.js';

const invoiceSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client is required'],
    index: true
  },
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  amount: {
    type: Number,
    required: [true, 'Invoice amount is required'],
    min: [1, 'Amount must be greater than 0'],
    validate: {
      validator: Number.isFinite,
      message: 'Amount must be a valid number'
    }
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
    index: true
  },
  dueTime: {
    type: String,
    default: '18:00', // HH:mm format, e.g. 18:00 (6:00 PM) deadline
    trim: true
  },
  reminderIntervalDays: {
    type: Number,
    default: 2,
    min: [1, 'Reminder interval must be at least 1 day'],
    max: [30, 'Reminder interval cannot exceed 30 days']
  },
  reminderTime: {
    type: String,
    default: '16:00', // HH:mm format, e.g. 16:00 (4:00 PM) daily/interval reminder send time
    trim: true
  },
  lastReminderSentAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: {
      values: ['DRAFT', 'PENDING', 'REMINDER_SENT', 'PAID', 'OVERDUE'],
      message: 'Invalid status: {VALUE}'
    },
    default: 'PENDING',
    index: true
  },
  paymentLink: {
    type: String,
    trim: true
  },
  paymentGatewayId: {
    type: String,
    trim: true
  },
  transactionId: {
    type: String,
    trim: true
  },
  paidAt: {
    type: Date
  },
  // Webhook tracking
  webhookReceivedAt: {
    type: Date
  },
  webhookPayload: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for dashboard queries
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ createdAt: -1 });

// Update updatedAt on save
invoiceSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Auto-generate invoice number for new documents
invoiceSchema.pre('validate', async function(next) {
  if (this.isNew && !this.invoiceNumber) {
    try {
      this.invoiceNumber = await generateInvoiceNumber();
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Method: Get exact due Date + Time object
invoiceSchema.methods.getExactDueDateTime = function() {
  const due = new Date(this.dueDate);
  if (this.dueTime && this.dueTime.includes(':')) {
    const [h, m] = this.dueTime.split(':').map(Number);
    due.setHours(h || 0, m || 0, 0, 0);
  }
  return due;
};

// Virtual: Days overdue (negative if not yet due)
invoiceSchema.virtual('daysOverdue').get(function() {
  if (this.status === 'PAID' || this.status === 'DRAFT') return null;
  const now = new Date();
  const due = new Date(this.dueDate);
  if (this.dueTime && this.dueTime.includes(':')) {
    const [h, m] = this.dueTime.split(':').map(Number);
    due.setHours(h || 0, m || 0, 0, 0);
  }
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
});

// Virtual: Is overdue (considers exact due date + due time)
invoiceSchema.virtual('isOverdue').get(function() {
  if (this.status === 'PAID' || this.status === 'DRAFT') return false;
  const now = new Date();
  const due = new Date(this.dueDate);
  if (this.dueTime && this.dueTime.includes(':')) {
    const [h, m] = this.dueTime.split(':').map(Number);
    due.setHours(h || 0, m || 0, 0, 0);
  }
  return now > due;
});

// Virtual: Days until due (positive if future)
invoiceSchema.virtual('daysUntilDue').get(function() {
  if (this.status === 'PAID' || this.status === 'DRAFT') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(this.dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due - today) / (1000 * 60 * 60 * 24));
});

// Virtual: Status color for UI
invoiceSchema.virtual('statusColor').get(function() {
  switch (this.status) {
    case 'PAID': return 'success';
    case 'OVERDUE': return 'danger';
    case 'REMINDER_SENT':
    case 'PENDING':
      return this.daysUntilDue !== null && this.daysUntilDue <= 2 ? 'warning' : 'pending';
    default: return 'pending';
  }
});

// Methods
invoiceSchema.methods.markPaid = function(transactionId, paidAt = new Date()) {
  this.status = 'PAID';
  this.transactionId = transactionId;
  this.paidAt = paidAt;
  this.webhookReceivedAt = new Date();
  return this.save();
};

invoiceSchema.methods.scheduleReminder = function() {
  this.lastReminderSentAt = new Date();
  this.status = 'REMINDER_SENT';
  return this.save();
};

invoiceSchema.methods.checkOverdue = function() {
  if (this.status !== 'PAID' && this.status !== 'DRAFT' && this.isOverdue) {
    this.status = 'OVERDUE';
    return this.save();
  }
  return Promise.resolve(this);
};

// Static: Get invoices needing reminders
invoiceSchema.statics.getDueForReminder = function() {
  const now = new Date();
  return this.find({
    status: { $in: ['PENDING', 'REMINDER_SENT'] },
    $or: [
      { lastReminderSentAt: null },
      {
        $expr: {
          $gte: [
            { $subtract: [now, '$lastReminderSentAt'] },
            { $multiply: ['$reminderIntervalDays', 24, 60, 60, 1000] }
          ]
        }
      }
    ]
  }).populate('clientId', 'name phone whatsappOptOut');
};

// Static: Get overdue invoices
invoiceSchema.statics.getOverdue = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return this.find({
    status: { $in: ['PENDING', 'REMINDER_SENT'] },
    dueDate: { $lt: today }
  }).populate('clientId', 'name phone');
};

// Transform output
invoiceSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.webhookPayload; // Don't expose raw webhook data
    return ret;
  }
});

export const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;