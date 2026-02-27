import mongoose from 'mongoose';

const ResponseSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  questionId: {
    type: String,
    required: true,
    ref: 'Form'
  },
  answers: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: true
  },
  parentResponseId: String,
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedAt: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  notes: String,
  isSectionSubmit: {
    type: Boolean,
    default: false
  },
  sectionIndex: {
    type: Number,
    default: null
  },
  score: {
    correct: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      default: 0
    }
  },
  submittedBy: String, // Can store name or identifier of the person who submitted
  submitterContact: {
    email: String,
    phone: String
  },
  inviteId: {
  type: String,
  ref: 'FormInvite',
  index: true,
  default: null
},
  // Location and metadata tracking
  submissionMetadata: {
    ipAddress: String,
    userAgent: String,
    browser: String,
    device: String,
    os: String,
    location: {
      country: String,
      countryCode: String,
      region: String,
      city: String,
      latitude: Number,
      longitude: Number,
      timezone: String,
      isp: String
    },
    capturedLocation: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
      source: {
        type: String,
        enum: ['browser', 'ip', 'manual', 'unknown'],
        default: 'unknown'
      },
      city: String,
      region: String,
      country: String,
      capturedAt: {
        type: Date,
        default: Date.now
      }
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      default: 'external'
    }
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
ResponseSchema.index({ questionId: 1 });
ResponseSchema.index({ assignedTo: 1 });
ResponseSchema.index({ status: 1 });
ResponseSchema.index({ createdAt: -1 });
ResponseSchema.index({ tenantId: 1 });

const Response = mongoose.model('Response', ResponseSchema);

export default Response;