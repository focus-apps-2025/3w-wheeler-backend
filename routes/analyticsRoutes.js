import express from 'express';
import {
  getDashboardStats,
  getFormAnalytics,
  getUserAnalytics,
  getAdminPerformance,
  getAdminActivity,
  getAdminResponseDetails,
  getTenantResponseDetails,
  getTenantSubmissionStats,
  exportAnalytics,
  getResponseTimeAnalytics,
  getInspectorSummary
} from '../controllers/analyticsController.js';
import { authenticate, adminOnly, superAdminOnly, inspectorOrAdmin, authenticateGuest } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// Middleware
const accessControl = (req, res, next) => {
  // If it's a guest, they can only access their assigned formId
  if (req.user.isGuest) {
    const { formId } = req.params;
    if (formId && req.user.accessibleFormId !== formId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view analytics for your assigned form.'
      });
    }
    return next();
  }
  
  // Standard user roles
  return inspectorOrAdmin(req, res, next);
};

// Routes requiring guest or standard authentication
router.get('/form/:formId', authenticateGuest, accessControl, getFormAnalytics);

// All other routes require standard authentication
router.use(authenticate);
router.use(addTenantFilter);

// Analytics routes
router.get('/dashboard', inspectorOrAdmin, getDashboardStats);
// router.get('/form/:formId', inspectorOrAdmin, getFormAnalytics); // Moved above
router.get('/users', adminOnly, getUserAnalytics);
router.get('/admin/:adminId/performance', getAdminPerformance);
router.get('/admin/:adminId/activity', getAdminActivity);
router.get('/admin/:adminId/response-details', getAdminResponseDetails);
// Superadmin route - bypasses tenant filter to get any tenant's data
router.get('/superadmin/tenant/:tenantId/response-details', authenticate, superAdminOnly, getTenantResponseDetails);
router.get('/tenant/stats', inspectorOrAdmin, getTenantSubmissionStats);
router.get('/export', inspectorOrAdmin, exportAnalytics);
// Add this new route
router.get('/forms/:formId/response-times', inspectorOrAdmin, getResponseTimeAnalytics);
router.get('/inspector-summary', inspectorOrAdmin, getInspectorSummary);

export default router;
