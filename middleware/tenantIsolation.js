import mongoose from 'mongoose';

// Middleware to ensure tenant data isolation
export const ensureTenantIsolation = (req, res, next) => {
  const user = req.user;

  // Only SuperAdmin can access all tenants
  if (user.role === 'superadmin') {
    return next();
  }

  // All other users (including admin) must have a tenantId
  if (!user.tenantId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. No tenant associated with this user.'
    });
  }

  // Add tenantId to request for easy access
  req.tenantId = user.tenantId;
  next();
};

// Middleware to add tenant filter to queries
export const addTenantFilter = (req, res, next) => {
  const user = req.user;

  // Only SuperAdmin doesn't need tenant filter
  if (user.role === 'superadmin') {
    req.tenantFilter = {};
  } else {
    // All other users (including admin) are filtered by their tenantId
    // Ensure tenantId is an ObjectId for aggregation pipelines
    req.tenantFilter = { 
      tenantId: user.tenantId instanceof mongoose.Types.ObjectId 
        ? user.tenantId 
        : new mongoose.Types.ObjectId(user.tenantId) 
    };
  }

  next();
};

// Middleware to validate tenant access for specific resource
export const validateTenantAccess = (Model) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const resourceId = req.params.id;

      // Only SuperAdmin can access everything
      if (user.role === 'superadmin') {
        return next();
      }

      // Find the resource
      const resource = await Model.findById(resourceId);

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      // Check if resource belongs to user's tenant (applies to admin and all other roles)
      if (resource.tenantId && resource.tenantId.toString() !== user.tenantId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This resource belongs to a different tenant.'
        });
      }

      next();
    } catch (error) {
      console.error('Tenant access validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  };
};