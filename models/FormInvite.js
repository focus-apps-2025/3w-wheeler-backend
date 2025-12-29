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
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    default: ''
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
formInviteSchema.index({ formId: 1, email: 1 }, { unique: true });

export default mongoose.model('FormInvite', formInviteSchema);