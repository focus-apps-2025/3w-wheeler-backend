import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

// Create a new tenant (SuperAdmin only)
export const createTenant = async (req, res) => {
  try {
    const { 
      name, 
      slug, 
      companyName, 
      adminEmail, 
      adminPassword,
      adminFirstName,
      adminLastName,
      settings,
      subscription
    } = req.body;

    // Validate required fields
    if (!name || !slug || !companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Check if slug already exists
    const existingTenant = await Tenant.findOne({ slug });
    if (existingTenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant slug already exists. Please choose a different slug.'
      });
    }

    // Check if admin email already exists
    const existingUser = await User.findOne({ email: adminEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Admin email already exists'
      });
    }

    // Prepare admin user and tenant documents with linked ids
    const adminUser = new User({
      username: adminEmail.split('@')[0] + '-' + slug,
      email: adminEmail,
      password: adminPassword,
      firstName: adminFirstName,
      lastName: adminLastName,
      role: 'admin',
      isActive: true,
      createdBy: req.user._id
    });

    const tenant = new Tenant({
      name,
      slug,
      companyName,
      adminId: adminUser._id,
      isActive: true,
      settings: settings || {},
      subscription: subscription || {},
      createdBy: req.user._id
    });

    // Assign tenant id to admin before persisting to satisfy schema requirements
    adminUser.tenantId = tenant._id;

    await adminUser.save();

    try {
      await tenant.save();
    } catch (error) {
      // Roll back admin user creation if tenant fails to persist
      await User.findByIdAndDelete(adminUser._id);
      throw error;
    }

    res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      data: {
        tenant,
        admin: {
          id: adminUser._id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName
        }
      }
    });

  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all tenants (SuperAdmin only)
export const getAllTenants = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = 'all' } = req.query;

    const query = { ...req.tenantFilter };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== 'all') {
      query.isActive = status === 'active';
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tenants, total] = await Promise.all([
      Tenant.find(query)
        .populate('adminId', 'firstName lastName email isActive lastLogin')
        .populate('createdBy', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Tenant.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        tenants,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get all tenants error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get tenant by slug
export const getTenantBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const tenant = await Tenant.findOne({ slug })
      .populate('adminId', 'firstName lastName email isActive lastLogin');

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    res.json({
      success: true,
      data: { tenant }
    });

  } catch (error) {
    console.error('Get tenant by slug error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update tenant
export const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Don't allow updating slug or adminId directly
    delete updates.slug;
    delete updates.adminId;
    delete updates.createdBy;

    const tenant = await Tenant.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('adminId', 'firstName lastName email isActive');

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    res.json({
      success: true,
      message: 'Tenant updated successfully',
      data: { tenant }
    });

  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Toggle tenant active status
export const toggleTenantStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    tenant.isActive = !tenant.isActive;
    await tenant.save();

    // Also update admin user status
    await User.findByIdAndUpdate(tenant.adminId, {
      isActive: tenant.isActive
    });

    res.json({
      success: true,
      message: `Tenant ${tenant.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { tenant }
    });

  } catch (error) {
    console.error('Toggle tenant status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete tenant (soft delete - deactivate)
export const deleteTenant = async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Deactivate instead of deleting
    tenant.isActive = false;
    await tenant.save();

    // Deactivate admin user
    await User.findByIdAndUpdate(tenant.adminId, {
      isActive: false
    });

    res.json({
      success: true,
      message: 'Tenant deactivated successfully'
    });

  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get tenant statistics
export const getTenantStats = async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Import models dynamically to avoid circular dependencies
    const Form = (await import('../models/Form.js')).default;
    const Response = (await import('../models/Response.js')).default;

    const [userCount, formCount, responseCount] = await Promise.all([
      User.countDocuments({ tenantId: id }),
      Form.countDocuments({ tenantId: id }),
      Response.countDocuments({ tenantId: id })
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          users: userCount,
          forms: formCount,
          responses: responseCount,
          subscription: tenant.subscription
        }
      }
    });

  } catch (error) {
    console.error('Get tenant stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};