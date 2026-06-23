import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { superAdminOnly, adminOnly } from '../middleware/auth.js';

// Helper: safely convert any MongoDB id to string
const toStr = (id) => {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id.$oid) return id.$oid;
  if (id.toString) return id.toString();
  return String(id);
};

// @desc    Update internal tracking settings for a tenant
// @route   PUT /api/internal-tracking/:tenantId
// @access  SuperAdmin only
export const updateInternalTrackingSettings = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { internalTrackingEnabled, allowedTenantIds } = req.body;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const updateData = {};

    if (typeof internalTrackingEnabled === 'boolean') {
      updateData.internalTrackingEnabled = internalTrackingEnabled;
    }

    if (Array.isArray(allowedTenantIds)) {
      const validTenantIds = allowedTenantIds
        .filter(id => typeof id === 'string' && id.length > 0)
        .map(id => {
          try { return new mongoose.Types.ObjectId(id); }
          catch { return null; }
        })
        .filter(Boolean);
      updateData.allowedTenantIds = validTenantIds;
    }

    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenantId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    res.json({
      success: true,
      message: 'Internal tracking settings updated successfully',
      data: {
        tenant: {
          ...updatedTenant,
          _id: toStr(updatedTenant._id),
          allowedTenantIds: (updatedTenant.allowedTenantIds || []).map(toStr).filter(Boolean),
        }
      }
    });
  } catch (error) {
    console.error('Update internal tracking settings error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// @desc    Get internal tracking settings for a tenant
// @route   GET /api/internal-tracking/:tenantId
// @access  Admin and SuperAdmin
export const getInternalTrackingSettings = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const requestingUser = req.user;

    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    if (requestingUser.role !== 'superadmin' && requestingUser.tenantId.toString() !== tenantId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.json({
      success: true,
      data: {
        tenantId: toStr(tenant._id),
        internalTrackingEnabled: tenant.internalTrackingEnabled || false,
        allowedTenantIds: (tenant.allowedTenantIds || []).map(toStr).filter(Boolean),
      }
    });
  } catch (error) {
    console.error('Get internal tracking settings error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Check if current user has internal tracking access
// @route   GET /api/internal-tracking/check-access
// @access  Authenticated users
export const checkInternalTrackingAccess = async (req, res) => {
  try {
    const user = req.user;

    if (user.role === 'superadmin') {
      return res.json({ success: true, data: { hasAccess: true, isSuperAdmin: true } });
    }

    if (!user.tenantId) {
      return res.json({ success: true, data: { hasAccess: false, isSuperAdmin: false } });
    }

    const tenant = await Tenant.findById(user.tenantId).lean();
    if (!tenant) {
      return res.json({ success: true, data: { hasAccess: false, isSuperAdmin: false } });
    }

    const hasAccess =
      tenant.internalTrackingEnabled === true &&
      Array.isArray(tenant.allowedTenantIds) &&
      tenant.allowedTenantIds.length > 0;

    res.json({
      success: true,
      data: {
        hasAccess,
        isSuperAdmin: false,
        allowedTenantIds: (tenant.allowedTenantIds || []).map(toStr).filter(Boolean),
      }
    });
  } catch (error) {
    console.error('Check internal tracking access error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// @desc    Get performance data for allowed tenants (for Internal Tracking page)
// @route   GET /api/internal-tracking/performance
// @access  Authenticated users with internal tracking access
export const getInternalTrackingPerformance = async (req, res) => {
  try {
    const user = req.user;

    // ── PAGINATION PARAMS ──────────────────────────────────────────────────
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50 per page
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;

    // ── SUPERADMIN: see all tenants with pagination ──────────────────────
    if (user.role === 'superadmin') {
      // Build search filter
      const searchFilter = search ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { companyName: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } }
        ]
      } : {};

      // Get total count for pagination
      const totalTenants = await Tenant.countDocuments({
        isActive: true,
        ...searchFilter
      });

      // Get paginated tenants
      const tenants = await Tenant.find({
        isActive: true,
        ...searchFilter
      })
        .select('_id name companyName slug internalTrackingEnabled allowedTenantIds')
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get users for these tenants only (not all tenants!)
      const tenantIds = tenants.map(t => t._id);
      const users = await User.find({
        tenantId: { $in: tenantIds },
        role: { $in: ['admin', 'subadmin', 'inspector'] }
      })
        .select('_id tenantId role performanceScore name email')
        .lean();

      // Calculate performance scores per tenant
      const tenantPerformanceMap = {};
      users.forEach(u => {
        const tenantId = toStr(u.tenantId);
        if (!tenantPerformanceMap[tenantId]) {
          tenantPerformanceMap[tenantId] = { total: 0, count: 0 };
        }
        tenantPerformanceMap[tenantId].total += (u.performanceScore || 0);
        tenantPerformanceMap[tenantId].count += 1;
      });

      const enrichedTenants = tenants.map(t => {
        const tId = toStr(t._id);
        const perf = tenantPerformanceMap[tId] || { total: 0, count: 0 };
        return {
          _id: tId,
          name: t.name,
          companyName: t.companyName,
          slug: t.slug,
          internalTrackingEnabled: t.internalTrackingEnabled || false,
          performanceScore: perf.count > 0 ? Math.round(perf.total / perf.count) : 0,
          userCount: perf.count,
        };
      });

      return res.json({
        success: true,
        data: {
          tenants: enrichedTenants,
          users: users.map(u => ({
            _id: toStr(u._id),
            tenantId: toStr(u.tenantId),
            role: u.role,
            performanceScore: u.performanceScore || 0,
            name: u.name,
            email: u.email,
          })),
          pagination: {
            page,
            limit,
            total: totalTenants,
            totalPages: Math.ceil(totalTenants / limit),
            hasNextPage: page < Math.ceil(totalTenants / limit),
            hasPrevPage: page > 1,
          }
        }
      });
    }

    // ── TENANT ADMIN: only allowed tenants with pagination ────────────────
    if (!user.tenantId) {
      return res.status(403).json({ success: false, message: 'No tenant associated with this user.' });
    }

    const currentTenant = await Tenant.findById(user.tenantId).lean();

    if (!currentTenant) {
      return res.status(403).json({ success: false, message: 'Tenant not found.' });
    }

    if (!currentTenant.internalTrackingEnabled) {
      return res.status(403).json({
        success: false,
        message: 'Internal tracking is not enabled for your tenant.'
      });
    }

    const rawAllowedIds = currentTenant.allowedTenantIds || [];

    if (rawAllowedIds.length === 0) {
      return res.json({
        success: true,
        data: {
          tenants: [],
          users: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          }
        }
      });
    }

    // Convert allowed IDs to ObjectIds
    const targetObjectIds = rawAllowedIds.map(id => {
      try {
        const str = toStr(id);
        return str ? new mongoose.Types.ObjectId(str) : null;
      } catch (e) {
        console.warn('[InternalTracking] Bad ObjectId skipped:', id, e.message);
        return null;
      }
    }).filter(Boolean);

    // Build search filter for allowed tenants
    const searchFilter = search ? {
      _id: { $in: targetObjectIds },
      isActive: true,
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ]
    } : {
      _id: { $in: targetObjectIds },
      isActive: true
    };

    // Get total count for pagination
    const totalAllowedTenants = await Tenant.countDocuments(searchFilter);

    // Get paginated allowed tenants
    const targetTenants = await Tenant.find(searchFilter)
      .select('_id name companyName slug')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean();

    const allowedTenantIds = targetTenants.map(t => t._id);

    const users = await User.find({
      tenantId: { $in: allowedTenantIds },
      role: { $in: ['admin', 'subadmin', 'inspector'] },
    })
      .select('_id tenantId role performanceScore name email')
      .lean();

    // Calculate performance scores per tenant
    const tenantPerfMap = {};
    users.forEach(u => {
      const tenantId = toStr(u.tenantId);
      if (!tenantPerfMap[tenantId]) {
        tenantPerfMap[tenantId] = { total: 0, count: 0 };
      }
      tenantPerfMap[tenantId].total += (u.performanceScore || 0);
      tenantPerfMap[tenantId].count += 1;
    });

    const enrichedAllowedTenants = targetTenants.map(t => {
      const tId = toStr(t._id);
      const perf = tenantPerfMap[tId] || { total: 0, count: 0 };
      return {
        _id: tId,
        name: t.name,
        companyName: t.companyName,
        slug: t.slug,
        performanceScore: perf.count > 0 ? Math.round(perf.total / perf.count) : 0,
        userCount: perf.count,
      };
    });

    res.json({
      success: true,
      data: {
        tenants: enrichedAllowedTenants,
        users: users.map(u => ({
          _id: toStr(u._id),
          tenantId: toStr(u.tenantId),
          role: u.role,
          performanceScore: u.performanceScore || 0,
          name: u.name,
          email: u.email,
        })),
        pagination: {
          page,
          limit,
          total: totalAllowedTenants,
          totalPages: Math.ceil(totalAllowedTenants / limit),
          hasNextPage: page < Math.ceil(totalAllowedTenants / limit),
          hasPrevPage: page > 1,
        }
      }
    });
  } catch (error) {
    console.error('[InternalTracking] getInternalTrackingPerformance crashed:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};