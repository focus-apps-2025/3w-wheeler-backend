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
  getResponseTimeAnalytics
} from '../controllers/analyticsController.js';
import { authenticate, adminOnly, superAdminOnly, inspectorOrAdmin } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(addTenantFilter);

// Analytics routes
router.get('/dashboard', inspectorOrAdmin, getDashboardStats);
router.get('/form/:formId', inspectorOrAdmin, getFormAnalytics);
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

export default router;
