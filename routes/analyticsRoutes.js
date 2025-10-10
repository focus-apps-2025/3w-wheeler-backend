import express from 'express';
import {
  getDashboardStats,
  getFormAnalytics,
  getUserAnalytics,
  exportAnalytics
} from '../controllers/analyticsController.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(addTenantFilter);

// Analytics routes
router.get('/dashboard', getDashboardStats);
router.get('/form/:formId', getFormAnalytics);
router.get('/users', adminOnly, getUserAnalytics);
router.get('/export', exportAnalytics);

export default router;