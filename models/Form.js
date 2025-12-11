import mongoose from 'mongoose';

const ALLOWED_FILE_TYPES = ['image', 'pdf', 'excel'];

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
    trim: true,
    required: [
      function () {
        return !this.imageUrl;
      },
      'Question must include text when no image is provided'
    ]
  },
  type: {
    type: String,
    enum: [
      'text', 'radio', 'checkbox', 'email', 'url', 'tel', 'date', 'time',
      'file', 'range', 'rating', 'scale', 'radio-grid', 'checkbox-grid',
      'radio-image', 'paragraph', 'search-select', 'number', 'location', 'boolean',
      'yesNoNA',
      // Feedback types
      'slider-feedback', 'emoji-star-feedback', 'emoji-reaction-feedback',
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
  allowedFileTypes: [{
    type: String,
    enum: ALLOWED_FILE_TYPES
  }],
  correctAnswer: String, // For quiz evaluation (single correct answer)
  correctAnswers: [String], // For quiz evaluation (multiple correct answers)
  gridOptions: GridOptionSchema,
  min: Number,
  max: Number,
  step: Number,
  showWhen: ShowWhenSchema,
  parentId: String,
  imageUrl: {
    type: String,
    validate: {
      validator: function (value) {
        if (!value) {
          return true;
        }
        try {
          const base64Data = value.includes(',') ? value.split(',')[1] : value;
          const buffer = Buffer.from(base64Data, 'base64');
          return buffer.length <= 50 * 1024;
        } catch (error) {
          return false;
        }
      },
      message: 'Question image must be 50KB or smaller and valid base64'
    }
  },
  description: String,
  suggestion: String,
  subParam1: String,
  subParam2: String,
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
  weightage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
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

/**
 * Pre-save middleware to normalize question types from legacy/frontend names to backend enum values
 * Handles case-insensitive input and human-readable names with spaces/slashes
 */
const normalizeQuestionType = (type) => {
  if (!type) return type;
  
  // Normalize: lowercase, trim, remove extra spaces, replace slashes with nothing
  let normalizedType = String(type)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // normalize multiple spaces to single space
    .replace(/\s*\/\s*/g, ''); // remove slashes and surrounding spaces
  
  const typeMap = {
    // Legacy/UI type names - without spaces/slashes
    'shorttext': 'text',
    'shortint': 'text',
    'multiplechoice': 'radio',
    'longtext': 'paragraph',
    'longinput': 'paragraph',
    'dropdown': 'select',
    'checkboxes': 'checkbox',
    'fileupload': 'file',
    'file upload': 'file',
    
    // Yes/No variations
    'yesnona': 'yesNoNA',
    'yesno': 'yesNoNA',
    
    // Core types - pass through
    'text': 'text',
    'radio': 'radio',
    'paragraph': 'paragraph',
    'select': 'select',
    'checkbox': 'checkbox',
    'yesnona': 'yesNoNA',  // lowercase pass-through
    
    // Extended types - supported by schema
    'email': 'email',
    'url': 'url',
    'tel': 'tel',
    'date': 'date',
    'time': 'time',
    'file': 'file',
    'range': 'range',
    'rating': 'rating',
    'scale': 'scale',
    'radio-grid': 'radio-grid',
    'radiogrid': 'radio-grid',
    'checkbox-grid': 'checkbox-grid',
    'checkboxgrid': 'checkbox-grid',
    'radio-image': 'radio-image',
    'radioimage': 'radio-image',
    'search-select': 'search-select',
    'searchselect': 'search-select',
    'number': 'number',
    'location': 'location',
    'boolean': 'boolean',
    'textarea': 'textarea',
    
    // Feedback types
    'slider-feedback': 'slider-feedback',
    'sliderfeedback': 'slider-feedback',
    'emoji-star-feedback': 'emoji-star-feedback',
    'emojistarfeedback': 'emoji-star-feedback',
    'emoji-reaction-feedback': 'emoji-reaction-feedback',
    'emojireactionfeedback': 'emoji-reaction-feedback'
  };
  
  // First try exact match after normalization
  if (typeMap[normalizedType]) {
    return typeMap[normalizedType];
  }
  
  // If not found, try with spaces removed entirely
  const noSpaces = normalizedType.replace(/\s/g, '');
  if (typeMap[noSpaces]) {
    return typeMap[noSpaces];
  }
  
  return type; // Return original if no match found
};

const normalizeQuestionTypes = (question) => {
  if (question && typeof question === 'object') {
    if (question.type) {
      question.type = normalizeQuestionType(question.type);
    }
    
    // Recursively normalize follow-up questions
    if (Array.isArray(question.followUpQuestions)) {
      question.followUpQuestions = question.followUpQuestions.map(fq => normalizeQuestionTypes(fq));
    }
  }
  
  return question;
};

FormSchema.pre('save', function(next) {
  try {
    // Normalize question types in sections
    if (Array.isArray(this.sections)) {
      let modified = false;
      this.sections.forEach(section => {
        if (Array.isArray(section.questions)) {
          section.questions.forEach(question => {
            const originalType = question.type;
            const normalizedType = normalizeQuestionType(question.type);
            if (originalType !== normalizedType) {
              question.type = normalizedType;
              modified = true;
            }
            
            // Recursively normalize follow-up questions
            if (Array.isArray(question.followUpQuestions)) {
              question.followUpQuestions.forEach(fq => {
                const fqOriginalType = fq.type;
                const fqNormalizedType = normalizeQuestionType(fq.type);
                if (fqOriginalType !== fqNormalizedType) {
                  fq.type = fqNormalizedType;
                  modified = true;
                }
              });
            }
          });
        }
      });
      if (modified) {
        this.markModified('sections');
      }
    }
    
    // Normalize top-level follow-up questions
    if (Array.isArray(this.followUpQuestions)) {
      let modified = false;
      this.followUpQuestions.forEach(q => {
        const originalType = q.type;
        const normalizedType = normalizeQuestionType(q.type);
        if (originalType !== normalizedType) {
          q.type = normalizedType;
          modified = true;
        }
      });
      if (modified) {
        this.markModified('followUpQuestions');
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Index for efficient queries
FormSchema.index({ id: 1 });
FormSchema.index({ createdBy: 1 });
FormSchema.index({ isVisible: 1 });
FormSchema.index({ isActive: 1 });
FormSchema.index({ tenantId: 1 });

const Form = mongoose.model('Form', FormSchema);

export default Form;