import mongoose from 'mongoose';

const BILL_CATEGORIES = ['Rent', 'Salaries', 'Suppliers', 'Utilities', 'Software', 'Other'];

const billSchema = new mongoose.Schema({
  vendorName: {
    type: String,
    required: [true, 'Vendor / Expense name is required'],
    trim: true,
    maxlength: [100, 'Vendor name cannot exceed 100 characters']
  },
  amount: {
    type: Number,
    required: [true, 'Bill amount is required'],
    min: [1, 'Bill amount must be positive'],
    validate: {
      validator: Number.isFinite,
      message: 'Amount must be a valid number'
    }
  },
  category: {
    type: String,
    enum: {
      values: BILL_CATEGORIES,
      message: 'Invalid category: {VALUE}. Must be one of: ' + BILL_CATEGORIES.join(', ')
    },
    default: 'Other',
    index: true
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
    index: true
  },
  status: {
    type: String,
    enum: {
      values: ['PENDING', 'PAID'],
      message: 'Invalid status: {VALUE}'
    },
    default: 'PENDING',
    index: true
  },
  paidAt: {
    type: Date
  },
  notes: {
    type: String,
    maxlength: [300, 'Notes cannot exceed 300 characters']
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
billSchema.index({ status: 1, dueDate: 1 });
billSchema.index({ category: 1, dueDate: 1 });

// Update updatedAt on save
billSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual: Days overdue
billSchema.virtual('daysOverdue').get(function() {
  if (this.status === 'PAID') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(this.dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / (1000 * 60 * 60 * 24));
});

// Virtual: Is overdue
billSchema.virtual('isOverdue').get(function() {
  return this.daysOverdue !== null && this.daysOverdue > 0;
});

// Virtual: Days until due
billSchema.virtual('daysUntilDue').get(function() {
  if (this.status === 'PAID') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(this.dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due - today) / (1000 * 60 * 60 * 24));
});

// Virtual: Status color for UI
billSchema.virtual('statusColor').get(function() {
  switch (this.status) {
    case 'PAID': return 'success';
    case 'PENDING':
      return this.daysUntilDue !== null && this.daysUntilDue <= 2 ? 'warning' : 'pending';
    default: return 'pending';
  }
});

// Methods
billSchema.methods.markPaid = function(paidAt = new Date()) {
  this.status = 'PAID';
  this.paidAt = paidAt;
  return this.save();
};

// Static: Get upcoming bills (next N days)
billSchema.statics.getUpcoming = function(days = 30) {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return this.find({
    status: 'PENDING',
    dueDate: { $gte: now, $lte: future }
  }).sort({ dueDate: 1 });
};

// Static: Get bills by category
billSchema.statics.getByCategory = function(category) {
  return this.find({ category }).sort({ dueDate: 1 });
};

// Transform output
billSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export { BILL_CATEGORIES };
export const Bill = mongoose.model('Bill', billSchema);
export default Bill;