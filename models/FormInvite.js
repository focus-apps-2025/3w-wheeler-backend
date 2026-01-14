// models/FormInvite.js
import mongoose from 'mongoose';

const formInviteSchema = new mongoose.Schema({
  formId: {
    type: String,
    required: true,
    index: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  email: {
    type: String,
    required: false,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    default: '',
    trim: true
  },
  inviteId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['sent', 'responded', 'expired'],
    default: 'sent'
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for formId + email uniqueness
formInviteSchema.index({ formId: 1, email: 1 }, { 
  unique: true, 
  partialFilterExpression: { email: { $type: "string" } } 
});

// Compound index for formId + phone uniqueness
formInviteSchema.index({ formId: 1, phone: 1 }, { 
  unique: true, 
  partialFilterExpression: { phone: { $type: "string", $ne: "" } } 
});

export default mongoose.model('FormInvite', formInviteSchema);