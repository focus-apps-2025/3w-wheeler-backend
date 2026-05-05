import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  responseId: {
    type: String,
    required: true,
    index: true
  },
  reviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewerName: {
    type: String,
    required: true
  },
  reviewerEmail: {
    type: String,
    required: true
  },
  submitterId: {
    type: String,  // ← CHANGE THIS from ObjectId to String
    required: true
  },
  reviewOption: {
    type: String,
    enum: ['Accepted', 'Rejected', 'Rework'],
    required: true
  },
  scoreChange: {
    type: Number,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  }
}, {
  timestamps: true
});

// Compound index to ensure one review per reviewer-response pair
reviewSchema.index({ responseId: 1, reviewerId: 1 }, { unique: true });

const Review = mongoose.model('Review', reviewSchema);
export default Review;