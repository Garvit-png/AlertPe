import mongoose from 'mongoose';

const businessProfileSchema = new mongoose.Schema({
  ownerName: {
    type: String,
    required: [true, 'Owner name is required'],
    trim: true,
    default: 'Ajay Yadav'
  },
  businessName: {
    type: String,
    required: [true, 'Business name is required'],
    trim: true,
    default: 'AlertPe Technologies'
  },
  phone: {
    type: String,
    required: [true, 'Sender WhatsApp phone is required'],
    trim: true,
    default: '+919876543210'
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'owner@alertpe.com'
  },
  upiId: {
    type: String,
    required: [true, 'Business UPI ID is required for payment links'],
    trim: true,
    default: 'alertpe@okhdfcbank'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isSetupCompleted: {
    type: Boolean,
    default: false
  },
  verificationPin: {
    type: String,
    default: '482910'
  },
  sessionToken: {
    type: String,
    default: () => `tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
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

businessProfileSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Helper static: Get or create single active owner profile
businessProfileSchema.statics.getActiveProfile = async function() {
  let profile = await this.findOne();
  if (!profile) {
    profile = await this.create({
      ownerName: 'Ajay Yadav',
      businessName: 'AlertPe Technologies',
      phone: '+919876543210',
      email: 'owner@alertpe.com',
      upiId: 'alertpe@okhdfcbank',
      isVerified: false,
      isSetupCompleted: false
    });
  }
  return profile;
};

export const BusinessProfile = mongoose.model('BusinessProfile', businessProfileSchema);
export default BusinessProfile;
