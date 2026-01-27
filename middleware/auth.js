import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Role from '../models/Permission.js';

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('⚠️ JWT_SECRET not found in process.env, using default');
  }
  return secret || 'your-secret-key-change-in-production';
};

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const token = authHeader.substring(7);
    
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.userId)
      .select('-password')
      .populate('customRole');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. User not found.' 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account has been deactivated.' 
      });
    }

    user.lastLogin = new Date();
    await user.save();

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

export const authenticateOptional = async (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.userId)
      .select('-password')
      .populate('customRole');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated.'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. Please authenticate first.' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

export const superAdminOnly = authorize('superadmin');
export const adminOnly = authorize('admin', 'superadmin');
export const teacherOrAdmin = authorize('teacher', 'admin', 'superadmin');
export const staffOrAdmin = authorize('staff', 'admin', 'superadmin');

export const generateToken = (userId) => {
  return jwt.sign({ userId }, getJwtSecret(), { 
    expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
  });
};

export const hasPermission = (permission) => {
  return (req, res, next) => {
    const user = req.user;
    
    // SuperAdmin and Admin always have all permissions
    if (user.role === 'superadmin' || user.role === 'admin') {
      return next();
    }

    // Check custom role permissions
    if (user.customRole && user.customRole.permissions.includes(permission)) {
      return next();
    }

    // Check user-specific permissions
    if (user.permissions && user.permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied. Required permission: ${permission}`
    });
  };
};

export const canAccessForm = async (req, res, next) => {
  try {
    const { id: formId } = req.params;
    const user = req.user;

    // SuperAdmin can access all forms
    if (user.role === 'superadmin') {
      return next();
    }

    // Check if user created the form
    const Form = (await import('../models/Form.js')).default;
    const form = await Form.findOne({ id: formId });

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Admin can access forms within their tenant
    if (user.role === 'admin' && form.tenantId.toString() === user.tenantId.toString()) {
      return next();
    }

    if (form.createdBy.toString() === user._id.toString()) {
      return next();
    }

    // Check role-based permissions for this form
    if (user.customRole && user.customRole.formPermissions) {
      const formPermission = user.customRole.formPermissions.find(
        fp => fp.formId === formId
      );
      
      if (formPermission) {
        req.formPermissions = formPermission.permissions;
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. You do not have permission to access this form.'
    });

  } catch (error) {
    console.error('Form access check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};