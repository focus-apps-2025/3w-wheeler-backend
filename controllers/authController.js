import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { generateToken } from '../middleware/auth.js';

export const login = async (req, res) => {
  try {
    const { username, email, password, tenantSlug } = req.body;

    // Find user by username or email
    let user;
    if (username) {
      user = await User.findOne({ username });
    } else if (email) {
      user = await User.findOne({ email });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Username or email is required'
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated. Please contact administrator.'
      });
    }

    // For non-superadmin users (including admin), validate tenant
    let tenant = null;
    if (user.role !== 'superadmin') {
      // If tenantSlug is provided, validate it matches user's tenant
      if (tenantSlug) {
        tenant = await Tenant.findOne({ slug: tenantSlug });
        if (!tenant) {
          return res.status(401).json({
            success: false,
            message: 'Invalid tenant'
          });
        }

        if (tenant._id.toString() !== user.tenantId.toString()) {
          return res.status(401).json({
            success: false,
            message: 'User does not belong to this tenant'
          });
        }

        if (!tenant.isActive) {
          return res.status(401).json({
            success: false,
            message: 'Tenant has been deactivated. Please contact support.'
          });
        }
      } else {
        // Load user's tenant
        tenant = await Tenant.findById(user.tenantId);
        if (!tenant || !tenant.isActive) {
          return res.status(401).json({
            success: false,
            message: 'Tenant has been deactivated. Please contact support.'
          });
        }
      }
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    const responseData = {
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        lastLogin: user.lastLogin
      }
    };

    // Add tenant info for non-superadmin users (including admin)
    if (tenant) {
      responseData.tenant = {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        companyName: tenant.companyName,
        settings: tenant.settings
      };
      responseData.user.tenantId = tenant._id;
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: responseData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user._id);
    
    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};