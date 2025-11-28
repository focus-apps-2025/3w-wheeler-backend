import mongoose from 'mongoose';
import Form from '../models/Form.js';
import Response from '../models/Response.js';
import Parameter from '../models/Parameter.js';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_FILE_TYPES = ['image', 'pdf', 'excel'];

const applyPopulate = (query, populateOptions) => {
  if (!populateOptions) {
    return query;
  }

  let populatedQuery = query;

  if (Array.isArray(populateOptions)) {
    populateOptions.forEach((option) => {
      populatedQuery = populatedQuery.populate(option);
    });
  } else {
    populatedQuery = populatedQuery.populate(populateOptions);
  }

  return populatedQuery;
};

const findFormByIdentifier = async (identifier, populateOptions) => {
  let formQuery = applyPopulate(Form.findOne({ id: identifier }), populateOptions);
  let form = await formQuery;

  if (!form && mongoose.Types.ObjectId.isValid(identifier)) {
    formQuery = applyPopulate(Form.findById(identifier), populateOptions);
    form = await formQuery;
  }

  return form;
};

class SectionWeightageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SectionWeightageError';
  }
}

const WEIGHTAGE_TOLERANCE = 0.01;

const normalizeSectionWeightage = (sections) => {
  if (!Array.isArray(sections)) {
    return 0;
  }

  let total = 0;

  sections.forEach((section, index) => {
    if (!section) {
      return;
    }

    const weightValue = section.weightage ?? 0;
    const weightage = Number(weightValue);

    if (Number.isNaN(weightage)) {
      throw new SectionWeightageError(
        `Section "${section.title || section.id}" has an invalid weightage value: ${weightValue}`
      );
    }

    if (weightage < 0 || weightage > 100) {
      throw new SectionWeightageError(
        `Section "${section.title || section.id}" must have a weightage between 0 and 100. Received: ${weightage}`
      );
    }

    section.weightage = weightage;
    total += weightage;
  });

  if (total > 0 && Math.abs(total - 100) > WEIGHTAGE_TOLERANCE) {
    throw new SectionWeightageError(
      `Section weightage must add up to 100%. Current total: ${total.toFixed(2)}%`
    );
  }

  return total;
};

export const createForm = async (req, res) => {
  try {
    console.log('=== Create Form Request ===');
    console.log('User:', req.user?.email, 'Role:', req.user?.role);
    console.log('Request body keys:', Object.keys(req.body));
    
    // Determine tenantId based on user role
    let tenantId;
    if (req.user.role === 'superadmin') {
      // SuperAdmin must provide tenantId in request body
      tenantId = req.body.tenantId;
      console.log('SuperAdmin - tenantId from body:', tenantId);
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'tenantId is required for superadmin to create forms'
        });
      }
    } else {
      // Other users use their own tenantId
      tenantId = req.user.tenantId;
      console.log('Regular user - tenantId from user:', tenantId);
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'User does not have a tenantId assigned'
        });
      }
    }

    // Validate tenantId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      console.error('Invalid tenantId format:', tenantId);
      return res.status(400).json({
        success: false,
        message: 'Invalid tenantId format. Must be a valid MongoDB ObjectId.'
      });
    }

    const formData = {
      ...req.body,
      id: req.body.id || uuidv4(),
      createdBy: req.user._id,
      tenantId: tenantId
    };

    try {
      normalizeSectionWeightage(formData.sections);
    } catch (error) {
      if (error instanceof SectionWeightageError) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      throw error;
    }

    console.log('Form data to save:', {
      id: formData.id,
      title: formData.title,
      description: formData.description?.substring(0, 50),
      sectionsCount: formData.sections?.length,
      tenantId: formData.tenantId,
      createdBy: formData.createdBy
    });

    // Normalize question types before form creation (handles spaces/slashes)
    const normalizeQuestionTypes = (question) => {
      const typeMap = {
        // Legacy/UI type names - without spaces/slashes
        'shorttext': 'text', 'shortint': 'text', 
        'multiplechoice': 'radio', 
        'longtext': 'paragraph', 'longinput': 'paragraph',
        'dropdown': 'select', 'checkboxes': 'checkbox', 
        'fileupload': 'file', 'file upload': 'file',
        
        // Yes/No variations
        'yesnona': 'yesNoNA', 'yesno': 'yesNoNA',
        
        // Core types - pass through
        'email': 'email', 'url': 'url', 'tel': 'tel',
        'date': 'date', 'time': 'time', 'file': 'file', 'range': 'range',
        'rating': 'rating', 'scale': 'scale', 'radio-grid': 'radio-grid',
        'radiogrid': 'radio-grid', 'checkbox-grid': 'checkbox-grid', 'checkboxgrid': 'checkbox-grid',
        'radio-image': 'radio-image', 'radioimage': 'radio-image',
        'search-select': 'search-select', 'searchselect': 'search-select',
        'number': 'number', 'location': 'location',
        'boolean': 'boolean', 'textarea': 'textarea', 
        'text': 'text', 'radio': 'radio', 'paragraph': 'paragraph', 
        'select': 'select', 'checkbox': 'checkbox',
        'yesnona': 'yesNoNA'  // Pass-through for already-correct yesNoNA
      };
      
      if (question?.type) {
        let normalizedType = String(question.type)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*\/\s*/g, '');
        
        const mappedType = typeMap[normalizedType] || typeMap[normalizedType.replace(/\s/g, '')] || question.type;
        if (question.type !== mappedType) {
          console.log(`Normalizing question type: "${question.type}" → "${mappedType}"`);
        }
        question.type = mappedType;
      }

      if (question?.type === 'file') {
        if (Array.isArray(question.allowedFileTypes)) {
          question.allowedFileTypes = question.allowedFileTypes.filter((type) =>
            ALLOWED_FILE_TYPES.includes(type)
          );
          if (question.allowedFileTypes.length === 0) {
            delete question.allowedFileTypes;
          }
        } else if (question?.allowedFileTypes !== undefined) {
          delete question.allowedFileTypes;
        }
      } else if (question?.allowedFileTypes !== undefined) {
        delete question.allowedFileTypes;
      }

      if (Array.isArray(question?.followUpQuestions)) {
        question.followUpQuestions = question.followUpQuestions.map(fq => normalizeQuestionTypes(fq));
      }
      return question;
    };

    // Normalize all sections
    if (Array.isArray(formData.sections)) {
      formData.sections.forEach(section => {
        if (Array.isArray(section.questions)) {
          section.questions = section.questions.map(q => normalizeQuestionTypes(q));
        }
      });
    }

    // Normalize top-level follow-up questions
    if (Array.isArray(formData.followUpQuestions)) {
      formData.followUpQuestions = formData.followUpQuestions.map(q => normalizeQuestionTypes(q));
    }

    const form = new Form(formData);
    await form.save();

    console.log('Form created successfully with ID:', form.id);

    res.status(201).json({
      success: true,
      message: 'Form created successfully',
      data: { form }
    });

  } catch (error) {
    console.error('=== Create form error ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error.code === 11000) {
      console.error('Duplicate key error:', error.keyValue);
      return res.status(400).json({
        success: false,
        message: 'Form with this ID already exists'
      });
    }

    // Log the full error for debugging
    if (error.name === 'ValidationError') {
      console.error('Validation error details:', JSON.stringify(error.errors, null, 2));
      const errorDetails = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value
      }));
      console.error('Formatted errors:', errorDetails);
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errorDetails
      });
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAllForms = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, isVisible, isActive, createdBy } = req.query;

    const query = { ...req.tenantFilter };

    // Search by title or description
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by visibility
    if (isVisible !== undefined) {
      query.isVisible = isVisible === 'true';
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Filter by creator
    if (createdBy) {
      query.createdBy = createdBy;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: {
        path: 'createdBy',
        select: 'username firstName lastName email'
      }
    };

    const forms = await Form.find(query)
      .populate(options.populate.path, options.populate.select)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await Form.countDocuments(query);

    const formIdsForCounts = forms
      .map((form) => form.id || (form._id ? form._id.toString() : null))
      .filter((id) => Boolean(id));

    let responseCountsMap = new Map();
    if (formIdsForCounts.length > 0) {
      const responseCounts = await Response.aggregate([
        {
          $match: {
            ...req.tenantFilter,
            questionId: { $in: formIdsForCounts }
          }
        },
        {
          $group: {
            _id: "$questionId",
            count: { $sum: 1 }
          }
        }
      ]);

      responseCountsMap = new Map(
        responseCounts.map((item) => [item._id, item.count])
      );
    }

    const formsWithCounts = forms.map((form) => {
      const plain = form.toObject({ virtuals: true });
      const lookupId = form.id || (form._id ? form._id.toString() : "");
      return {
        ...plain,
        responseCount: responseCountsMap.get(lookupId) || 0
      };
    });

    res.json({
      success: true,
      data: {
        forms: formsWithCounts,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalForms: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get all forms error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getPublicForms = async (req, res) => {
  try {
    const { tenantSlug } = req.params;
    
    // If tenantSlug is provided (public customer access), find tenant by slug
    let query = { isActive: true, isVisible: true };
    
    if (tenantSlug) {
      // Import Tenant model
      const Tenant = mongoose.model('Tenant');
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      
      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or inactive'
        });
      }
      
      query.tenantId = tenant._id;
    } else if (req.tenantFilter) {
      // Authenticated user - apply tenant filter
      query = { ...query, ...req.tenantFilter };
    }
    
    const forms = await Form.find(query)
      .select('id title description logoUrl imageUrl createdAt tenantId isActive isVisible sections parentFormId')
      .populate('sections.questions')
      .sort({ createdAt: -1 });

    const parentForms = forms.filter((form) => !form.parentFormId);
    const publicForms = parentForms.filter((form) => form.isVisible === true);

    res.json({
      success: true,
      data: { forms: publicForms }
    });

  } catch (error) {
    console.error('Get public forms error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFormById = async (req, res) => {
  try {
    const { id, tenantSlug } = req.params;

    const populateOptions = req.populateOptions || {
      path: 'createdBy',
      select: 'username firstName lastName email'
    };

    let form = await findFormByIdentifier(id, populateOptions);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // For public access with tenant slug, verify tenant and form visibility
    if (tenantSlug) {
      const Tenant = mongoose.model('Tenant');
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      
      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or inactive'
        });
      }
      
      // Verify form belongs to this tenant
      if (form.tenantId.toString() !== tenant._id.toString()) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }
      
      // Check if form is visible
      if (!form.isVisible) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }
    } else if (req.user && req.user.role !== 'superadmin') {
      // For authenticated user (non-superadmin), enforce tenant isolation
      if (form.tenantId.toString() !== req.user.tenantId.toString()) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }
    }
    
    // For public access (no req.user and no tenantSlug), check if form is visible
    if (!req.user && !tenantSlug && !form.isVisible) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Debug logging
    console.log('=== Returning form ===');
    console.log('Form ID:', form.id);
    console.log('Sections:', form.sections?.length || 0);
    if (form.sections && form.sections.length > 0) {
      form.sections.forEach((section, idx) => {
        console.log(`Section ${idx}: ${section.title}, Questions: ${section.questions?.length || 0}`);
        if (section.questions) {
          section.questions.forEach((q, qIdx) => {
            console.log(`  Q${qIdx}: ${q.text}, subParam1: ${q.subParam1 || 'none'}, followUpQuestions: ${q.followUpQuestions?.length || 0}, showWhen:`, q.showWhen ? `${q.showWhen.questionId} = ${q.showWhen.value}` : 'none');
            if (q.followUpQuestions && q.followUpQuestions.length > 0) {
              q.followUpQuestions.forEach((fq, fqIdx) => {
                console.log(`    FQ${fqIdx}: ${fq.text}, subParam1: ${fq.subParam1 || 'none'}, subParam2: ${fq.subParam2 || 'none'}`);
              });
            }
          });
        }
      });
    }
    if (form.followUpQuestions && form.followUpQuestions.length > 0) {
      console.log('Form-level followUpQuestions:', form.followUpQuestions.length);
      form.followUpQuestions.forEach((fq, idx) => {
        console.log(`  FQ${idx}: ${fq.text}, parentId: ${fq.parentId || 'none'}, subParam1: ${fq.subParam1 || 'none'}`);
      });
    }

    res.json({
      success: true,
      data: { form }
    });

  } catch (error) {
    console.error('Get form by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateForm = async (req, res) => {
  try {
    const { id } = req.params;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only edit your own forms.'
      });
    }

    // For admin, ensure they can only edit forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only edit forms in your organization.'
      });
    }

    // Update form
    Object.assign(form, req.body);

    try {
      normalizeSectionWeightage(form.sections);
    } catch (error) {
      if (error instanceof SectionWeightageError) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      throw error;
    }

    // Normalize question types before saving (handles spaces/slashes)
    const normalizeQuestionTypes = (question) => {
      const typeMap = {
        // Legacy/UI type names - without spaces/slashes
        'shorttext': 'text', 'shortint': 'text', 
        'multiplechoice': 'radio', 
        'longtext': 'paragraph', 'longinput': 'paragraph',
        'dropdown': 'select', 'checkboxes': 'checkbox', 
        'fileupload': 'file', 'file upload': 'file',
        
        // Yes/No variations
        'yesnona': 'yesNoNA', 'yesno': 'yesNoNA',
        
        // Core types - pass through
        'email': 'email', 'url': 'url', 'tel': 'tel',
        'date': 'date', 'time': 'time', 'file': 'file', 'range': 'range',
        'rating': 'rating', 'scale': 'scale', 'radio-grid': 'radio-grid',
        'radiogrid': 'radio-grid', 'checkbox-grid': 'checkbox-grid', 'checkboxgrid': 'checkbox-grid',
        'radio-image': 'radio-image', 'radioimage': 'radio-image',
        'search-select': 'search-select', 'searchselect': 'search-select',
        'number': 'number', 'location': 'location',
        'boolean': 'boolean', 'textarea': 'textarea', 
        'text': 'text', 'radio': 'radio', 'paragraph': 'paragraph', 
        'select': 'select', 'checkbox': 'checkbox'
      };
      
      if (question?.type) {
        let normalizedType = String(question.type)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*\/\s*/g, '');
        
        question.type = typeMap[normalizedType] || typeMap[normalizedType.replace(/\s/g, '')] || question.type;
      }

      if (question?.type === 'file') {
        if (Array.isArray(question.allowedFileTypes)) {
          question.allowedFileTypes = question.allowedFileTypes.filter((type) =>
            ALLOWED_FILE_TYPES.includes(type)
          );
          if (question.allowedFileTypes.length === 0) {
            delete question.allowedFileTypes;
          }
        } else if (question?.allowedFileTypes !== undefined) {
          delete question.allowedFileTypes;
        }
      } else if (question?.allowedFileTypes !== undefined) {
        delete question.allowedFileTypes;
      }
      if (Array.isArray(question?.followUpQuestions)) {
        question.followUpQuestions = question.followUpQuestions.map(fq => normalizeQuestionTypes(fq));
      }
      return question;
    };

    if (Array.isArray(form.sections)) {
      form.sections.forEach(section => {
        if (Array.isArray(section.questions)) {
          section.questions = section.questions.map(q => normalizeQuestionTypes(q));
        }
      });
    }

    if (Array.isArray(form.followUpQuestions)) {
      form.followUpQuestions = form.followUpQuestions.map(q => normalizeQuestionTypes(q));
    }

    await form.save();

    res.json({
      success: true,
      message: 'Form updated successfully',
      data: { form }
    });

  } catch (error) {
    console.error('Update form error:', error);

    if (error instanceof mongoose.Error.ValidationError) {
      const formattedErrors = Object.values(error.errors || {}).map((err) => ({
        field: err.path,
        message: err.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: formattedErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteForm = async (req, res) => {
  try {
    const { id } = req.params;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own forms.'
      });
    }

    // For admin, ensure they can only delete forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete forms in your organization.'
      });
    }

    // Delete related responses
    await Response.deleteMany({ questionId: id });

    // Delete form using the form's _id (MongoDB ObjectId)
    await Form.findByIdAndDelete(form._id);

    res.json({
      success: true,
      message: 'Form and related responses deleted successfully'
    });

  } catch (error) {
    console.error('Delete form error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateFormVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVisible } = req.body;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    // For admin, ensure they can only modify forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify forms in your organization.'
      });
    }

    form.isVisible = isVisible;
    await form.save();

    res.json({
      success: true,
      message: `Form ${isVisible ? 'published' : 'unpublished'} successfully`,
      data: { form }
    });

  } catch (error) {
    console.error('Update form visibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateFormLocationEnabled = async (req, res) => {
  try {
    const { id } = req.params;
    const { locationEnabled } = req.body;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (typeof locationEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. locationEnabled must be a boolean.'
      });
    }

    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify forms in your organization.'
      });
    }

    form.locationEnabled = locationEnabled;
    await form.save();

    res.json({
      success: true,
      message: `Form location ${locationEnabled ? 'enabled' : 'disabled'} successfully`,
      data: { form }
    });

  } catch (error) {
    console.error('Update form location toggle error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFormLocationEnabled = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own forms.'
      });
    }

    // For admin, ensure they can only view forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view forms in your organization.'
      });
    }

    res.json({
      success: true,
      data: {
        locationEnabled: form.locationEnabled || false
      }
    });

  } catch (error) {
    console.error('Get form location status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateFormActiveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    // For admin, ensure they can only modify forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify forms in your organization.'
      });
    }

    form.isActive = isActive;
    await form.save();

    res.json({
      success: true,
      message: `Form ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { form }
    });

  } catch (error) {
    console.error('Update form active status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const duplicateForm = async (req, res) => {
  try {
    const { id } = req.params;

    // Use the helper function to find form by either custom id or MongoDB _id
    const originalForm = await findFormByIdentifier(id);

    if (!originalForm) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Create duplicate
    const duplicateData = originalForm.toObject();
    delete duplicateData._id;
    delete duplicateData.__v;
    
    duplicateData.id = uuidv4();
    duplicateData.title = `${duplicateData.title} (Copy)`;
    duplicateData.isVisible = false;
    duplicateData.createdBy = req.user._id;
    // Keep the same tenantId as the original form (admin can only duplicate their own tenant's forms)
    duplicateData.tenantId = originalForm.tenantId;
    duplicateData.createdAt = new Date();
    duplicateData.updatedAt = new Date();

    const duplicateForm = new Form(duplicateData);
    await duplicateForm.save();

    res.status(201).json({
      success: true,
      message: 'Form duplicated successfully',
      data: { form: duplicateForm }
    });

  } catch (error) {
    console.error('Duplicate form error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFormAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { period = '30d' } = req.query;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get responses for analytics
    const responses = await Response.find({
      questionId: id,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: 1 });

    // Calculate analytics
    const totalResponses = responses.length;
    const averageResponseTime = responses.length > 0 
      ? responses.reduce((acc, curr, index) => {
          if (index === 0) return 0;
          return acc + (new Date(curr.createdAt) - new Date(responses[index - 1].createdAt));
        }, 0) / (responses.length - 1) 
      : 0;

    // Group responses by day
    const dailyResponses = responses.reduce((acc, response) => {
      const date = new Date(response.createdAt).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});

    // Status distribution
    const statusDistribution = responses.reduce((acc, response) => {
      acc[response.status] = (acc[response.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        totalResponses,
        averageResponseTime: Math.round(averageResponseTime / (1000 * 60)), // in minutes
        dailyResponses,
        statusDistribution,
        period,
        form: {
          id: form.id,
          title: form.title,
          createdAt: form.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Get form analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// New endpoint for creating forms with follow-up question configuration
export const createFormWithFollowUp = async (req, res) => {
  try {
    const {
      title,
      description,
      logoUrl,
      imageUrl,
      options = ['Option A', 'Option B', 'Option C', 'Option D'],
      followUpConfig = {
        'Option A': { hasFollowUp: true, required: true },
        'Option B': { hasFollowUp: false, required: false },
        'Option C': { hasFollowUp: false, required: false },
        'Option D': { hasFollowUp: true, required: true }
      }
    } = req.body;

    const formId = uuidv4();

    // Create main question with 4 options
    const mainQuestion = {
      id: `main-${uuidv4()}`,
      text: title,
      type: 'radio',
      required: true,
      options: options,
      description: description
    };

    // Create follow-up questions for options that need them
    const followUpQuestions = [];
    
    options.forEach((option, index) => {
      const config = followUpConfig[option];
      if (config && config.hasFollowUp) {
        followUpQuestions.push({
          id: `followup-${option.toLowerCase().replace(/\s+/g, '-')}-${uuidv4()}`,
          text: `Please provide additional details for ${option}:`,
          type: 'paragraph',
          required: config.required,
          showWhen: {
            questionId: mainQuestion.id,
            value: option
          },
          parentId: mainQuestion.id,
          description: `This follow-up question is ${config.required ? 'mandatory' : 'optional'} for ${option}`
        });
      }
    });

    const formData = {
      id: formId,
      title,
      description,
      logoUrl,
      imageUrl,
      sections: [{
        id: `section-${uuidv4()}`,
        title: 'Main Section',
        description: 'Please select one option and provide follow-up details if required',
        questions: [mainQuestion, ...followUpQuestions]
      }],
      followUpQuestions,
      isVisible: false,
      createdBy: req.user._id,
      permissions: {
        canRespond: ['all'],
        canViewResponses: [req.user.role],
        canEdit: [req.user.role],
        canAddFollowUp: [req.user.role],
        canDelete: [req.user.role]
      }
    };

    const form = new Form(formData);
    await form.save();

    res.status(201).json({
      success: true,
      message: 'Form with follow-up questions created successfully',
      data: { 
        form,
        followUpConfig
      }
    });

  } catch (error) {
    console.error('Create form with follow-up error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Form with this ID already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update follow-up question configuration
export const updateFollowUpConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpConfig } = req.body;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check permissions
    if (form.createdBy && req.user._id && form.createdBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    // For admin, ensure they can only modify forms in their tenant
    if (req.user.role === 'admin' && form.tenantId && req.user.tenantId && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify forms in your organization.'
      });
    }

    // Update follow-up questions based on new configuration
    const updatedFollowUpQuestions = [];
    
    if (form.sections.length > 0 && form.sections[0].questions.length > 0) {
      const mainQuestion = form.sections[0].questions[0];
      
      if (mainQuestion.options) {
        mainQuestion.options.forEach(option => {
          const config = followUpConfig[option];
          if (config && config.hasFollowUp) {
            // Find existing follow-up question or create new one
            const existingFollowUp = form.followUpQuestions.find(
              fq => fq.showWhen && fq.showWhen.value === option
            );
            
            if (existingFollowUp) {
              existingFollowUp.required = config.required;
              existingFollowUp.description = `This follow-up question is ${config.required ? 'mandatory' : 'optional'} for ${option}`;
              updatedFollowUpQuestions.push(existingFollowUp);
            } else {
              updatedFollowUpQuestions.push({
                id: `followup-${option.toLowerCase().replace(/\s+/g, '-')}-${uuidv4()}`,
                text: `Please provide additional details for ${option}:`,
                type: 'paragraph',
                required: config.required,
                showWhen: {
                  questionId: mainQuestion.id,
                  value: option
                },
                parentId: mainQuestion.id,
                description: `This follow-up question is ${config.required ? 'mandatory' : 'optional'} for ${option}`
              });
            }
          }
        });
      }
    }

    form.followUpQuestions = updatedFollowUpQuestions;
    if (form.sections.length > 0) {
      form.sections[0].questions = [
        form.sections[0].questions[0], // Keep main question
        ...updatedFollowUpQuestions
      ];
    }

    await form.save();

    res.json({
      success: true,
      message: 'Follow-up configuration updated successfully',
      data: { 
        form,
        followUpConfig
      }
    });

  } catch (error) {
    console.error('Update follow-up config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get follow-up configuration for a form
export const getFollowUpConfig = async (req, res) => {
  try {
    const { id } = req.params;

    // Use the helper function to find form by either custom id or MongoDB _id
    const form = await findFormByIdentifier(id);

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    const followUpConfig = {};
    
    if (form.sections.length > 0 && form.sections[0].questions.length > 0) {
      const mainQuestion = form.sections[0].questions[0];
      
      if (mainQuestion.options) {
        mainQuestion.options.forEach(option => {
          const followUpQuestion = form.followUpQuestions.find(
            fq => fq.showWhen && fq.showWhen.value === option
          );
          
          followUpConfig[option] = {
            hasFollowUp: !!followUpQuestion,
            required: followUpQuestion ? followUpQuestion.required : false
          };
        });
      }
    }

    res.json({
      success: true,
      data: {
        formId: form.id,
        title: form.title,
        followUpConfig
      }
    });

  } catch (error) {
    console.error('Get follow-up config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Link child form to parent form
export const linkChildForm = async (req, res) => {
  try {
    const { id } = req.params; // Parent form ID
    const { childFormId } = req.body;

    if (!childFormId) {
      return res.status(400).json({
        success: false,
        message: 'childFormId is required'
      });
    }

    // Find parent form
    const parentForm = await findFormByIdentifier(id);
    if (!parentForm) {
      return res.status(404).json({
        success: false,
        message: 'Parent form not found'
      });
    }

    // Find child form
    const childForm = await findFormByIdentifier(childFormId);
    if (!childForm) {
      return res.status(404).json({
        success: false,
        message: 'Child form not found'
      });
    }

    // Check if forms belong to the same tenant
    if (parentForm.tenantId.toString() !== childForm.tenantId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Parent and child forms must belong to the same organization'
      });
    }

    // Check permissions
    if (parentForm.createdBy.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    // Initialize childForms array if it doesn't exist
    if (!parentForm.childForms) {
      parentForm.childForms = [];
    }

    // Check if child form is already linked
    const existingLink = parentForm.childForms.find(
      cf => cf.formId === childForm.id
    );

    if (existingLink) {
      return res.status(400).json({
        success: false,
        message: 'This form is already linked as a child form'
      });
    }

    // Add child form
    const order = parentForm.childForms.length;
    parentForm.childForms.push({
      formId: childForm.id,
      formTitle: childForm.title,
      order
    });

    await parentForm.save();

    res.json({
      success: true,
      message: 'Child form linked successfully',
      data: { 
        parentForm,
        childForm: {
          formId: childForm.id,
          formTitle: childForm.title,
          order
        }
      }
    });

  } catch (error) {
    console.error('Link child form error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Unlink child form from parent form
export const unlinkChildForm = async (req, res) => {
  try {
    const { id, childFormId } = req.params;

    const parentForm = await findFormByIdentifier(id);
    if (!parentForm) {
      return res.status(404).json({
        success: false,
        message: 'Parent form not found'
      });
    }

    // Check permissions
    if (parentForm.createdBy.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    if (!parentForm.childForms || parentForm.childForms.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No child forms linked to this parent form'
      });
    }

    const initialLength = parentForm.childForms.length;
    parentForm.childForms = parentForm.childForms.filter(
      cf => cf.formId !== childFormId
    );

    if (parentForm.childForms.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Child form not found in parent form'
      });
    }

    // Reorder remaining child forms
    parentForm.childForms.forEach((cf, index) => {
      cf.order = index;
    });

    await parentForm.save();

    res.json({
      success: true,
      message: 'Child form unlinked successfully',
      data: { parentForm }
    });

  } catch (error) {
    console.error('Unlink child form error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get child forms for a parent form
export const getChildForms = async (req, res) => {
  try {
    const { id } = req.params;

    const parentForm = await findFormByIdentifier(id);
    if (!parentForm) {
      return res.status(404).json({
        success: false,
        message: 'Parent form not found'
      });
    }

    // Get full details of child forms
    const childFormDetails = [];
    if (parentForm.childForms && parentForm.childForms.length > 0) {
      for (const childRef of parentForm.childForms) {
        const childForm = await findFormByIdentifier(childRef.formId);
        if (childForm) {
          childFormDetails.push({
            id: childForm.id,
            _id: childForm._id,
            title: childForm.title,
            description: childForm.description,
            isVisible: childForm.isVisible,
            isActive: childForm.isActive,
            order: childRef.order
          });
        }
      }
    }

    // Sort by order
    childFormDetails.sort((a, b) => a.order - b.order);

    res.json({
      success: true,
      data: {
        parentFormId: parentForm.id,
        parentFormTitle: parentForm.title,
        childForms: childFormDetails
      }
    });

  } catch (error) {
    console.error('Get child forms error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reorder child forms
export const reorderChildForms = async (req, res) => {
  try {
    const { id } = req.params;
    const { childFormOrder } = req.body; // Array of formIds in desired order

    if (!Array.isArray(childFormOrder)) {
      return res.status(400).json({
        success: false,
        message: 'childFormOrder must be an array'
      });
    }

    const parentForm = await findFormByIdentifier(id);
    if (!parentForm) {
      return res.status(404).json({
        success: false,
        message: 'Parent form not found'
      });
    }

    // Check permissions
    if (parentForm.createdBy.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify your own forms.'
      });
    }

    if (!parentForm.childForms || parentForm.childForms.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No child forms linked to this parent form'
      });
    }

    // Create a map of formId to child form data
    const childFormsMap = new Map();
    parentForm.childForms.forEach(cf => {
      childFormsMap.set(cf.formId, cf);
    });

    // Reorder based on provided array
    const reorderedChildForms = [];
    childFormOrder.forEach((formId, index) => {
      const childForm = childFormsMap.get(formId);
      if (childForm) {
        childForm.order = index;
        reorderedChildForms.push(childForm);
      }
    });

    parentForm.childForms = reorderedChildForms;
    await parentForm.save();

    res.json({
      success: true,
      message: 'Child forms reordered successfully',
      data: { parentForm }
    });

  } catch (error) {
    console.error('Reorder child forms error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const setSectionBranching = async (req, res) => {
  try {
    const { id } = req.params;
    const { rules } = req.body;

    if (!Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Rules must be an array'
      });
    }

    const form = await findFormByIdentifier(id);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Validate tenant access (allow superadmin access to all)
    if (req.user.role !== 'superadmin' && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const validatedRules = rules.map(rule => ({
      questionId: rule.questionId,
      sectionId: rule.sectionId,
      optionLabel: rule.optionLabel,
      optionIndex: rule.optionIndex,
      targetSectionId: rule.targetSectionId,
      isOtherOption: rule.isOtherOption || false
    }));

    form.sectionBranching = validatedRules;
    await form.save();

    res.status(200).json({
      success: true,
      message: 'Section branching rules saved successfully',
      data: { sectionBranching: form.sectionBranching }
    });
  } catch (error) {
    console.error('Set section branching error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSectionBranching = async (req, res) => {
  try {
    const { id } = req.params;

    const form = await findFormByIdentifier(id);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Validate tenant access (allow superadmin access to all)
    if (req.user.role !== 'superadmin' && form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      data: { sectionBranching: form.sectionBranching || [] }
    });
  } catch (error) {
    console.error('Get section branching error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSectionBranchingPublic = async (req, res) => {
  try {
    const { id, tenantSlug } = req.params;

    // Fetch tenant by slug
    const Tenant = mongoose.model('Tenant');
    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const form = await findFormByIdentifier(id);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Check if form is visible and belongs to correct tenant
    if (!form.isVisible || form.tenantId.toString() !== tenant._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Form not accessible'
      });
    }

    res.status(200).json({
      success: true,
      data: { sectionBranching: form.sectionBranching || [] }
    });
  } catch (error) {
    console.error('Get section branching public error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Import form from simplified CSV template
export const importFormFromCSV = async (req, res) => {
  try {
    console.log('=== Import Form from CSV ===');
    console.log('User:', req.user?.email, 'Role:', req.user?.role);

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No CSV file provided'
      });
    }

    // Determine tenantId based on user role
    let tenantId;
    if (req.user.role === 'superadmin') {
      tenantId = req.body.tenantId;
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'tenantId is required for superadmin'
        });
      }
    } else {
      tenantId = req.user.tenantId;
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'User does not have a tenantId assigned'
        });
      }
    }

    // Validate tenantId
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tenantId format'
      });
    }

    // Convert buffer to string
    const csvData = req.file.buffer.toString('utf-8');

    // Import the parser
    const { parseSimplifiedCSVForm, validateSubmitButtons } = await import('../utils/csvFormParser.js');

    // Parse CSV
    const formData = parseSimplifiedCSVForm(csvData, {
      id: uuidv4(),
      createdBy: req.user._id,
      tenantId: tenantId,
      isVisible: false  // Default to private
    });

    // Validate submit buttons
    const validation = validateSubmitButtons(formData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        issues: validation.issues
      });
    }

    // Normalize all question types before form creation (handles spaces/slashes)
    const normalizeQuestionTypes = (question) => {
      const typeMap = {
        // Legacy/UI type names - without spaces/slashes
        'shorttext': 'text', 'shortint': 'text', 
        'multiplechoice': 'radio', 
        'longtext': 'paragraph', 'longinput': 'paragraph',
        'dropdown': 'select', 'checkboxes': 'checkbox', 
        'fileupload': 'file', 'file upload': 'file',
        
        // Yes/No variations
        'yesnona': 'yesNoNA', 'yesno': 'yesNoNA',
        
        // Core types - pass through
        'email': 'email', 'url': 'url', 'tel': 'tel',
        'date': 'date', 'time': 'time', 'file': 'file', 'range': 'range',
        'rating': 'rating', 'scale': 'scale', 'radio-grid': 'radio-grid',
        'radiogrid': 'radio-grid', 'checkbox-grid': 'checkbox-grid', 'checkboxgrid': 'checkbox-grid',
        'radio-image': 'radio-image', 'radioimage': 'radio-image',
        'search-select': 'search-select', 'searchselect': 'search-select',
        'number': 'number', 'location': 'location',
        'boolean': 'boolean', 'textarea': 'textarea', 
        'text': 'text', 'radio': 'radio', 'paragraph': 'paragraph', 
        'select': 'select', 'checkbox': 'checkbox'
      };
      
      if (question?.type) {
        let normalizedType = String(question.type)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*\/\s*/g, '');
        
        question.type = typeMap[normalizedType] || typeMap[normalizedType.replace(/\s/g, '')] || question.type;
      }

      if (question?.type === 'file') {
        if (Array.isArray(question.allowedFileTypes)) {
          question.allowedFileTypes = question.allowedFileTypes.filter((type) =>
            ALLOWED_FILE_TYPES.includes(type)
          );
          if (question.allowedFileTypes.length === 0) {
            delete question.allowedFileTypes;
          }
        } else if (question?.allowedFileTypes !== undefined) {
          delete question.allowedFileTypes;
        }
      } else if (question?.allowedFileTypes !== undefined) {
        delete question.allowedFileTypes;
      }
      if (Array.isArray(question?.followUpQuestions)) {
        question.followUpQuestions = question.followUpQuestions.map(fq => normalizeQuestionTypes(fq));
      }
      return question;
    };

    // Normalize all sections
    if (Array.isArray(formData.sections)) {
      formData.sections.forEach(section => {
        if (Array.isArray(section.questions)) {
          section.questions = section.questions.map(q => normalizeQuestionTypes(q));
        }
      });
    }

    // Normalize top-level follow-up questions
    if (Array.isArray(formData.followUpQuestions)) {
      formData.followUpQuestions = formData.followUpQuestions.map(q => normalizeQuestionTypes(q));
    }

    // Create form
    const form = new Form(formData);
    await form.save();

    console.log('Form imported successfully from CSV with ID:', form.id);

    // Extract unique parameters from questions (SubParam1, SubParam2)
    const parametersToCreate = new Set();
    const extractParameters = (question) => {
      if (question.subParam1) parametersToCreate.add(question.subParam1);
      if (question.subParam2) parametersToCreate.add(question.subParam2);
      if (Array.isArray(question.followUpQuestions)) {
        question.followUpQuestions.forEach(extractParameters);
      }
    };

    if (Array.isArray(formData.sections)) {
      formData.sections.forEach(section => {
        if (Array.isArray(section.questions)) {
          section.questions.forEach(extractParameters);
        }
      });
    }

    // Create parameters for this form
    const parameterPromises = Array.from(parametersToCreate).map(paramName =>
      Parameter.create({
        name: paramName,
        type: 'main',
        formId: form._id,
        tenantId: tenantId,
        createdBy: req.user._id
      }).catch(err => {
        console.warn(`Failed to create parameter "${paramName}":`, err.message);
        return null;
      })
    );

    await Promise.all(parameterPromises);
    console.log(`Created ${parametersToCreate.size} parameters for form`);

    res.status(201).json({
      success: true,
      message: 'Form imported successfully from CSV',
      data: { form }
    });

  } catch (error) {
    console.error('CSV import error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'CSV import failed'
    });
  }
};