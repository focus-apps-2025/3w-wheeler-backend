import User from '../models/User.js';
import LoginLog from '../models/LoginLog.js';
const MODULE_PERMISSIONS = [
  'dashboard:view',
  'analytics:view',
  'requests:view',
  'requests:manage'
];

export const createUser = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role, permissions } = req.body;

    if (req.user.role === 'admin' && role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admins cannot create additional admin accounts'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
      ...req.tenantFilter
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this username or email already exists'
      });
    }

    const sanitizedPermissions = Array.isArray(permissions)
      ? Array.from(new Set(permissions.filter((permission) => MODULE_PERMISSIONS.includes(permission))))
      : [];

    // Create new user
    const newUserData = {
      username,
      email,
      password,
      firstName,
      lastName,
      role,
      createdBy: req.user._id,
      tenantId: req.user.role === 'superadmin' ? req.body.tenantId : req.user.tenantId
    };

    if (role === 'subadmin') {
      newUserData.permissions = sanitizedPermissions;
    } else if (sanitizedPermissions.length > 0) {
      newUserData.permissions = sanitizedPermissions;
    }

    const newUser = new User(newUserData);

    await newUser.save();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: newUser
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this username or email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, search } = req.query;
    
    const query = { ...req.tenantFilter };

    // Filter by role if provided
    if (role && role !== 'all') {
      query.role = role;
    }
    
    // Search by username, email, firstName, or lastName
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: {
        path: 'createdBy',
        select: 'username firstName lastName'
      }
    };

    const users = await User.find(query)
      .populate(options.populate.path, options.populate.select)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalUsers: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, ...req.tenantFilter }).populate('createdBy', 'username firstName lastName');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, firstName, lastName, role, isActive, permissions } = req.body;

    const user = await User.findOne({ _id: id, ...req.tenantFilter });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (role && req.user.role !== 'superadmin' && role === 'admin' && req.user._id.toString() !== user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only superadmin can assign admin role'
      });
    }

    // Check if username or email already exists (excluding current user)
    if (username || email) {
      const existingUser = await User.findOne({
        _id: { $ne: id },
        $or: [
          ...(username ? [{ username }] : []),
          ...(email ? [{ email }] : [])
        ],
        ...req.tenantFilter
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this username or email already exists'
        });
      }
    }

    let sanitizedPermissions;
    if (permissions !== undefined) {
      if (!Array.isArray(permissions) || !permissions.every((permission) => typeof permission === 'string')) {
        return res.status(400).json({
          success: false,
          message: 'Permissions must be an array of strings'
        });
      }
      sanitizedPermissions = Array.from(new Set(permissions.filter((permission) => MODULE_PERMISSIONS.includes(permission))));
    }

    // Update user fields
    if (username) user.username = username;
    if (email) user.email = email;
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (sanitizedPermissions !== undefined) user.permissions = sanitizedPermissions;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, ...req.tenantFilter });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deletion of admin/subadmin users
    if (user.role === 'admin' || user.role === 'subadmin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete admin users. Use removeAdminFromTenant endpoint instead.'
      });
    }

    await User.findOneAndDelete({ _id: id, ...req.tenantFilter });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const requestingUser = req.user;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findOne({ _id: id, ...req.tenantFilter });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userEmail = user.email;
    const userRole = user.role;
    const isSuperAdminReset = requestingUser.role === 'superadmin';

    if (isSuperAdminReset) {
      console.log(`🔐 SuperAdmin (${requestingUser.email}) resetting password for ${userRole} (${userEmail})`);
    } else {
      console.log(`🔐 Admin (${requestingUser.email}) resetting password for user (${userEmail})`);
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        userId: user._id,
        email: user.email,
        role: user.role,
        resetBy: isSuperAdminReset ? 'superadmin' : 'admin'
      }
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
export const getAvailableAdmins = async (req, res) => {
  try {
    const { tenantId, role } = req.query;
    
    const query = { 
      ...req.tenantFilter,
      isActive: true 
    };
    
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    if (role) {
      // Handle comma-separated roles like "admin,subadmin"
      const roles = role.split(',');
      query.role = { $in: roles };
    } else {
      query.role = { $in: ['admin', 'subadmin'] };
    }
    
    const users = await User.find(query)
      .select('_id firstName lastName email role')
      .sort({ firstName: 1 });
    
    res.json({
      success: true,
      data: {
        users
      }
    });
  } catch (error) {
    console.error('Get available admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getUserActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, startDate, endDate } = req.query;

    let userQuery = {};
    if (req.user.role === 'admin') {
      // Admin sees their subadmins and themselves
      const subAdmins = await User.find({ createdBy: req.user._id }).select('_id');
      const allowedUserIds = [req.user._id, ...subAdmins.map(u => u._id)];
      userQuery.userId = { $in: allowedUserIds };
    } else if (req.user.role !== 'superadmin') {
      userQuery.userId = req.user._id;
    }
    
    // Default tenant filtering
    if (req.tenantFilter && req.tenantFilter.tenantId) {
      userQuery.tenantId = req.tenantFilter.tenantId;
    }

    if (startDate && endDate) {
      userQuery.loginTime = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { loginTime: -1 }
    };

    const logs = await LoginLog.find(userQuery)
      .populate('userId', 'username firstName lastName email role')
      .populate('tenantId', 'name')
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await LoginLog.countDocuments(userQuery);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalLogs: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get user activity logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getUsersHierarchy = async (req, res) => {
  try {
    const query = { ...req.tenantFilter };
    
    if (req.user.role === 'admin') {
      const subadmins = await User.find({ createdBy: req.user._id })
         .select('-password').sort({ createdAt: -1 });
      return res.json({
        success: true,
        data: { users: subadmins }
      });
    }

    // Superadmin: We want to return Admins and their Subadmins
    // Either a tree structure or list with populated createdBy
    const users = await User.find(query)
      .populate('createdBy', 'username firstName lastName email role')
      .populate('tenantId', 'name')
      .select('-password')
      .sort({ role: 1, createdAt: -1 });

    res.json({
      success: true,
      data: {
        users
      }
    });
  } catch (error) {
    console.error('Get users hierarchy error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};