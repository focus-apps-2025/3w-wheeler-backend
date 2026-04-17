import mongoose from 'mongoose';

const analyticsInviteSchema = new mongoose.Schema({
  formId: {
    type: String,
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  phone: {
    type: String,
    trim: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  lastLogin: {
    type: Date
  },
  status: {
    type: String,
    enum: ['sent', 'active', 'expired'],
    default: 'sent'
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  }
}, {
  timestamps: true
});

// Ensure uniqueness per form and email
analyticsInviteSchema.index({ formId: 1, email: 1 }, { unique: true });

const AnalyticsInvite = mongoose.model('AnalyticsInvite', analyticsInviteSchema);

export default AnalyticsInvite;
