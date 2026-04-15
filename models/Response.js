// In Response.js - Update the submissionMetadata object
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
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
}, // Location and metadata tracking
  submissionMetadata: {
    ipAddress: String,
    formSessionId: String,
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
    },
        },
    // ========== ADD THESE NEW TIMING FIELDS ==========
    // Total time spent on the form (in seconds)
    timeSpent: {
      type: Number,
      default: 0,
      min: 0
    },
    // Session ID from FormSession
    sessionId: {
      type: String,
      default: null
    },
    // When the user started the form
    startedAt: {
      type: Date,
      default: null
    },
    // When the user completed/submitted
    completedAt: {
      type: Date,
      default: null

  },
  
  // ========== ADD NEW TOP-LEVEL TIMING FIELDS (for easier querying) ==========
  // These make it easier to query and aggregate time data
  timeSpent: {
    type: Number, // in seconds
    default: 0,
    index: true
  },
  sessionId: {
    type: String,
    index: true,
    default: null
  },
  startedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  
  // Question-level timings (if you want per-question data)
  questionTimings: [{
    questionId: String,
    questionText: String,
    questionType: String,
    timeSpent: Number, // seconds spent on this question
    order: Number,
    startedAt: Date,
    completedAt: Date
  }],
  
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  }
}, {
  timestamps: true
});

// ========== ADD NEW INDEXES FOR TIME QUERIES ==========
ResponseSchema.index({ questionId: 1 });
ResponseSchema.index({ assignedTo: 1 });
ResponseSchema.index({ status: 1 });
ResponseSchema.index({ createdAt: -1 });
ResponseSchema.index({ tenantId: 1 });
ResponseSchema.index({ startedAt: -1 }); // NEW - for time range queries
ResponseSchema.index({ timeSpent: 1 }); // NEW - for time-based queries
ResponseSchema.index({ sessionId: 1 });  // NEW - for session lookups

const Response = mongoose.model('Response', ResponseSchema);

export default Response;