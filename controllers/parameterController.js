import Parameter from '../models/Parameter.js';

// @desc    Create a new parameter
// @route   POST /api/parameters
// @access  Private
export const createParameter = async (req, res) => {
  try {
    const { name, type, formId } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Parameter name is required'
      });
    }

    if (!type || !['main', 'followup'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter type must be either "main" or "followup"'
      });
    }

    if (!formId) {
      return res.status(400).json({
        success: false,
        message: 'Form ID is required'
      });
    }

    // Check if parameter already exists for this form, tenant and type
    const existingParameter = await Parameter.findOne({
      name: name.trim(),
      type,
      formId,
      ...req.tenantFilter
    });

    if (existingParameter) {
      return res.status(400).json({
        success: false,
        message: `A ${type} parameter with this name already exists for this form`
      });
    }

    // Create new parameter
    const parameter = new Parameter({
      name: name.trim(),
      type,
      formId,
      tenantId: req.user.role === 'superadmin' ? req.body.tenantId : req.user.tenantId,
      createdBy: req.user._id
    });

    await parameter.save();

    res.status(201).json({
      success: true,
      message: 'Parameter created successfully',
      data: {
        parameter: {
          id: parameter._id,
          name: parameter.name,
          type: parameter.type,
          formId: parameter.formId,
          tenantId: parameter.tenantId,
          createdBy: parameter.createdBy,
          createdAt: parameter.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Error creating parameter:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating parameter'
    });
  }
};

// @desc    Get all parameters
// @route   GET /api/parameters
// @access  Private
export const getAllParameters = async (req, res) => {
  try {
    const { type, search, formId } = req.query;

    let filter = { ...req.tenantFilter };

    if (formId) {
      filter.formId = formId;
    }

    if (type && ['main', 'followup'].includes(type)) {
      filter.type = type;
    }

    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const parameters = await Parameter.find(filter)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        parameters: parameters.map(param => ({
          id: param._id,
          name: param.name,
          type: param.type,
          formId: param.formId,
          tenantId: param.tenantId,
          createdBy: param.createdBy,
          createdAt: param.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching parameters:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching parameters'
    });
  }
};

// @desc    Get parameter by ID
// @route   GET /api/parameters/:id
// @access  Private
export const getParameterById = async (req, res) => {
  try {
    const parameter = await Parameter.findOne({
      _id: req.params.id,
      ...req.tenantFilter
    }).populate('createdBy', 'firstName lastName email');

    if (!parameter) {
      return res.status(404).json({
        success: false,
        message: 'Parameter not found'
      });
    }

    res.json({
      success: true,
      data: {
        parameter: {
          id: parameter._id,
          name: parameter.name,
          type: parameter.type,
          formId: parameter.formId,
          tenantId: parameter.tenantId,
          createdBy: parameter.createdBy,
          createdAt: parameter.createdAt,
          updatedAt: parameter.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Error fetching parameter:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching parameter'
    });
  }
};

// @desc    Update parameter
// @route   PUT /api/parameters/:id
// @access  Private
export const updateParameter = async (req, res) => {
  try {
    const { name, type, formId } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Parameter name is required'
      });
    }

    if (!type || !['main', 'followup'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter type must be either "main" or "followup"'
      });
    }

    if (!formId) {
      return res.status(400).json({
        success: false,
        message: 'Form ID is required'
      });
    }

    const parameter = await Parameter.findOne({
      _id: req.params.id,
      ...req.tenantFilter
    });

    if (!parameter) {
      return res.status(404).json({
        success: false,
        message: 'Parameter not found'
      });
    }

    // Check if another parameter with same name and type exists for this form
    const existingParameter = await Parameter.findOne({
      name: name.trim(),
      type,
      formId,
      _id: { $ne: req.params.id },
      ...req.tenantFilter
    });

    if (existingParameter) {
      return res.status(400).json({
        success: false,
        message: `A ${type} parameter with this name already exists for this form`
      });
    }

    // Update parameter
    parameter.name = name.trim();
    parameter.type = type;
    parameter.formId = formId;

    await parameter.save();

    res.json({
      success: true,
      message: 'Parameter updated successfully',
      data: {
        parameter: {
          id: parameter._id,
          name: parameter.name,
          type: parameter.type,
          formId: parameter.formId,
          tenantId: parameter.tenantId,
          createdBy: parameter.createdBy,
          createdAt: parameter.createdAt,
          updatedAt: parameter.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Error updating parameter:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating parameter'
    });
  }
};

// @desc    Delete parameter
// @route   DELETE /api/parameters/:id
// @access  Private
export const deleteParameter = async (req, res) => {
  try {
    const parameter = await Parameter.findOneAndDelete({
      _id: req.params.id,
      ...req.tenantFilter
    });

    if (!parameter) {
      return res.status(404).json({
        success: false,
        message: 'Parameter not found'
      });
    }

    res.json({
      success: true,
      message: 'Parameter deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting parameter:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting parameter'
    });
  }
};