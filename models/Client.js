import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Client name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required for WhatsApp follow-ups'],
    trim: true,
    validate: {
      validator: function(v) {
        // E.164 format: +[country code][number], e.g., +919876543210
        return /^\+[1-9]\d{1,14}$/.test(v);
      },
      message: 'Phone must be in E.164 format (e.g., +919876543210)'
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  businessCategory: {
    type: String,
    default: 'General',
    trim: true,
    maxlength: [50, 'Category cannot exceed 50 characters']
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  whatsappOptOut: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt on save
clientSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual: Total amount owed by this client (unpaid invoices)
clientSchema.virtual('totalOwed', {
  ref: 'Invoice',
  localField: '_id',
  foreignField: 'clientId',
  match: { status: { $nin: ['PAID', 'DRAFT'] } },
  justOne: false,
  options: { select: 'amount' }
});

// Virtual: Count of pending invoices
clientSchema.virtual('pendingCount', {
  ref: 'Invoice',
  localField: '_id',
  foreignField: 'clientId',
  match: { status: { $nin: ['PAID', 'DRAFT'] } },
  count: true
});

// Indexes
clientSchema.index({ phone: 1 }, { unique: true });
clientSchema.index({ name: 'text', phone: 'text', email: 'text' });
clientSchema.index({ createdAt: -1 });

// Transform output
clientSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export const Client = mongoose.model('Client', clientSchema);
export default Client;