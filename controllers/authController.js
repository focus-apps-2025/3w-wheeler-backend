import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import LoginLog from '../models/LoginLog.js';
import { generateToken } from '../middleware/auth.js';
import axios from 'axios';

// Helper function to get location from IP address
const getLocationFromIP = async (ip) => {
  try {
    // Skip private/local IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return null;
    }

    const response = await axios.get(`http://ip-api.com/json/${ip}`, {
      timeout: 3000
    });

    if (response.data && response.data.status === 'success') {
      return {
        city: response.data.city,
        country: response.data.country,
        countryCode: response.data.countryCode,
        latitude: response.data.lat,
        longitude: response.data.lon,
        status: 'ip-based'
      };
    }
  } catch (error) {
    console.error('IP location lookup failed:', error.message);
  }
  return null;
};

// Helper to combine browser geolocation with IP-based location
const enhanceLocationData = async (browserLocation, ipAddress) => {
  let locationData = {
    status: 'unknown',
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    countryCode: null
  };

  // Use browser coordinates if available
  if (browserLocation && browserLocation.status === 'granted' && browserLocation.latitude) {
    locationData.latitude = browserLocation.latitude;
    locationData.longitude = browserLocation.longitude;
    locationData.status = 'browser';

    // Try to get city/country from IP (reverse geocode)
    const ipLocation = await getLocationFromIP(ipAddress);
    if (ipLocation) {
      locationData.city = ipLocation.city;
      locationData.country = ipLocation.country;
      locationData.countryCode = ipLocation.countryCode;
    }
  } else {
    // Fallback to IP-based location
    const ipLocation = await getLocationFromIP(ipAddress);
    if (ipLocation) {
      locationData = ipLocation;
    }
  }

  return locationData;
};

export const login = async (req, res) => {
  try {
    const { username, email, password, tenantSlug, location } = req.body;
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    // Find user by username or email
    let user;
    if (normalizedUsername) {
      user = await User.findOne({ username: normalizedUsername });
    } else if (normalizedEmail) {
      user = await User.findOne({ email: normalizedEmail });
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

      // Check trial expiration for free plan
      if (tenant.subscription && tenant.subscription.plan === 'free') {
        const now = new Date();
        if (tenant.subscription.endDate && now > tenant.subscription.endDate) {
          return res.status(403).json({
            success: false,
            message: 'Your 30-day free trial has expired. please contact admin to get more details choose our upgrade plan',
            trialExpired: true
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

    // Get IP address for location lookup
    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'];

    // Enhance location data with IP-based lookup
    const enhancedLocation = await enhanceLocationData(location, ipAddress);

    // Create LoginLog entry
    const newLog = new LoginLog({
      userId: user._id,
      tenantId: user.tenantId,
      location: enhancedLocation,
      ipAddress: ipAddress,
      userAgent: req.headers['user-agent']
    });
    let sessionLogId = null;
    try {
      await newLog.save();
      sessionLogId = newLog._id;
    } catch (logErr) {
      console.error('Failed to save login log:', logErr);
    }

    const responseData = {
      token,
      sessionLogId,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        lastLogin: user.lastLogin,
        permissions: user.permissions || []
      }
    };

    // Add tenant info for non-superadmin users (including admin)
    if (tenant) {
      responseData.tenant = {
        id: tenant._id,
        _id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        companyName: tenant.companyName,
        settings: tenant.settings,
        subscription: tenant.subscription
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

export const signup = async (req, res) => {
  try {
    const {
      name,
      slug,
      companyName,
      adminEmail,
      adminPassword,
      adminFirstName,
      adminLastName
    } = req.body;

    // Validate required fields
    if (!name || !slug || !companyName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Check if slug already exists
    const existingTenant = await Tenant.findOne({ slug: slug.toLowerCase() });
    if (existingTenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant slug already exists. Please choose a different slug.'
      });
    }

    // Check if admin email already exists
    const existingUser = await User.findOne({ email: adminEmail.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Calculate trial end date (30 days from now)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 30);

    // Create admin user
    const adminUser = new User({
      username: adminEmail.split('@')[0] + '-' + slug,
      email: adminEmail.toLowerCase(),
      password: adminPassword,
      firstName: adminFirstName,
      lastName: adminLastName,
      role: 'admin',
      isActive: true
    });

    // Create tenant
    const tenant = new Tenant({
      name,
      slug: slug.toLowerCase(),
      companyName,
      adminId: [adminUser._id],
      isActive: true,
      subscription: {
        plan: 'free',
        startDate,
        endDate,
        maxUsers: 10,
        maxForms: 5
      }
    });

    adminUser.tenantId = tenant._id;
    await adminUser.save();

    try {
      await tenant.save();
    } catch (error) {
      await User.findByIdAndDelete(adminUser._id);
      throw error;
    }

    res.status(201).json({
      success: true,
      message: 'Signup successful! Your 30-day free trial has started.',
      data: {
        tenant: {
          id: tenant._id,
          name: tenant.name,
          slug: tenant.slug,
          endDate: tenant.subscription.endDate
        }
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

export const logout = async (req, res) => {
  try {
    const { sessionLogId } = req.body;

    if (sessionLogId) {
      await LoginLog.findByIdAndUpdate(sessionLogId, {
        logoutTime: new Date()
      });
    } else if (req.user) {
      // Fallback: update latest open session for user
      await LoginLog.findOneAndUpdate(
        { userId: req.user._id, logoutTime: null },
        { logoutTime: new Date() },
        { sort: { loginTime: -1 } }
      );
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};