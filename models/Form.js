import mongoose from 'mongoose';

const GridOptionSchema = new mongoose.Schema({
  rows: [String],
  columns: [String]
}, { _id: false });

const ShowWhenSchema = new mongoose.Schema({
  questionId: {
    type: String,
    required: true
  },
  value: mongoose.Schema.Types.Mixed
}, { _id: false });

const SectionBranchingRuleSchema = new mongoose.Schema({
  questionId: {
    type: String,
    required: true
  },
  sectionId: {
    type: String,
    required: true
  },
  optionLabel: {
    type: String,
    required: true
  },
  optionIndex: Number,
  targetSectionId: {
    type: String,
    required: true
  },
  isOtherOption: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const FollowUpQuestionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: [
      'text', 'radio', 'checkbox', 'email', 'url', 'tel', 'date', 'time',
      'file', 'range', 'rating', 'scale', 'radio-grid', 'checkbox-grid',
      'radio-image', 'paragraph', 'search-select', 'number', 'location',
      // Legacy types for backward compatibility (will be migrated)
      'select', 'textarea'
    ],
    required: true
  },
  required: {
    type: Boolean,
    default: false
  },
  options: [String],
  correctAnswer: String, // For quiz evaluation (single correct answer)
  correctAnswers: [String], // For quiz evaluation (multiple correct answers)
  gridOptions: GridOptionSchema,
  min: Number,
  max: Number,
  step: Number,
  showWhen: ShowWhenSchema,
  parentId: String,
  imageUrl: String,
  description: String,
  sectionId: String,
  followUpQuestions: [mongoose.Schema.Types.Mixed], // Support nested follow-up questions
  followUpConfig: mongoose.Schema.Types.Mixed, // Configuration for option-based section branching
  goToSection: String // Target section ID for conditional branching
}, { _id: false });

const SectionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  questions: [FollowUpQuestionSchema]
}, { _id: false });

const FormSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  logoUrl: String,
  imageUrl: String,
  sections: [SectionSchema],
  followUpQuestions: [FollowUpQuestionSchema],
  parentFormId: String,
  parentFormTitle: String,
  childForms: [{
    formId: String,
    formTitle: String,
    order: Number // Order in which child forms should be presented
  }],
  sectionBranching: [SectionBranchingRuleSchema], // Array of section branching rules
  isVisible: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  locationEnabled: {
    type: Boolean,
    default: true // Default to true for backward compatibility
  },
  permissions: {
    canRespond: [String], // Array of role names
    canViewResponses: [String],
    canEdit: [String],
    canAddFollowUp: [String],
    canDelete: [String]
  }
}, {
  timestamps: true
});

// Index for efficient queries
FormSchema.index({ id: 1 });
FormSchema.index({ createdBy: 1 });
FormSchema.index({ isVisible: 1 });
FormSchema.index({ isActive: 1 });
FormSchema.index({ tenantId: 1 });

const Form = mongoose.model('Form', FormSchema);

export default Form;