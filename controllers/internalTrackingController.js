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

    // ── SuperAdmin: see all tenants ──────────────────────────────────────────
    if (user.role === 'superadmin') {
      const tenants = await Tenant.find({ isActive: true })
        .select('_id name companyName slug internalTrackingEnabled allowedTenantIds')
        .lean();

      const tenantIds = tenants.map(t => t._id);
      const users = await User.find({
        tenantId: { $in: tenantIds },
        role: { $in: ['admin', 'subadmin', 'inspector'] }
      }).select('_id tenantId role performanceScore name email').lean();

      return res.json({
        success: true,
        data: {
          tenants: tenants.map(t => ({
            _id: toStr(t._id),
            name: t.name,
            companyName: t.companyName,
            slug: t.slug,
            internalTrackingEnabled: t.internalTrackingEnabled || false,
          })),
          users: users.map(u => ({
            _id: toStr(u._id),
            tenantId: toStr(u.tenantId),
            role: u.role,
            performanceScore: u.performanceScore || 0,
            name: u.name,
            email: u.email,
          })),
        }
      });
    }

    // ── Tenant admin: only allowed tenants ──────────────────────────────────
    if (!user.tenantId) {
      return res.status(403).json({ success: false, message: 'No tenant associated with this user.' });
    }

    const currentTenant = await Tenant.findById(user.tenantId).lean();

    console.log('[InternalTracking] tenant:', currentTenant?.slug,
      '| enabled:', currentTenant?.internalTrackingEnabled,
      '| allowedIds count:', currentTenant?.allowedTenantIds?.length ?? 0);

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
      // Enabled but no tenants assigned yet — return empty, NOT 403
      return res.json({ success: true, data: { tenants: [], users: [] } });
    }

    // Safely convert every stored id (ObjectId / string / BSON) to ObjectId
    const targetObjectIds = rawAllowedIds.map(id => {
      try {
        const str = toStr(id);
        return str ? new mongoose.Types.ObjectId(str) : null;
      } catch (e) {
        console.warn('[InternalTracking] Bad ObjectId skipped:', id, e.message);
        return null;
      }
    }).filter(Boolean);

    console.log('[InternalTracking] querying tenants:', targetObjectIds.map(toStr));

    const [targetTenants, users] = await Promise.all([
      Tenant.find({ _id: { $in: targetObjectIds }, isActive: true })
        .select('_id name companyName slug')
        .lean(),
      User.find({
        tenantId: { $in: targetObjectIds },
        role: { $in: ['admin', 'subadmin', 'inspector'] },
      }).select('_id tenantId role performanceScore name email').lean(),
    ]);

    console.log('[InternalTracking] found', targetTenants.length, 'tenants,', users.length, 'users');

    res.json({
      success: true,
      data: {
        tenants: targetTenants.map(t => ({
          _id: toStr(t._id),
          name: t.name,
          companyName: t.companyName,
          slug: t.slug,
        })),
        users: users.map(u => ({
          _id: toStr(u._id),
          tenantId: toStr(u.tenantId),   // ← always a plain string now
          role: u.role,
          performanceScore: u.performanceScore || 0,
          name: u.name,
          email: u.email,
        })),
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