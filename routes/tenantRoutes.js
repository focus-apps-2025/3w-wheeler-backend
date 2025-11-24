import express from 'express';
import {
  createTenant,
  getAllTenants,
  getTenantBySlug,
  updateTenant,
  toggleTenantStatus,
  deleteTenant,
  getTenantStats,
  addAdminToTenant,
  removeAdminFromTenant
} from '../controllers/tenantController.js';
import { authenticate, superAdminOnly } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// All routes require authentication and superadmin role
router.use(authenticate);
router.use(addTenantFilter);
router.use(superAdminOnly);

// Tenant CRUD operations
router.post('/', createTenant);
router.get('/', getAllTenants);
router.get('/slug/:slug', getTenantBySlug);
router.get('/:id/stats', getTenantStats);
router.put('/:id', updateTenant);
router.patch('/:id/toggle-status', toggleTenantStatus);
router.delete('/:id', deleteTenant);
router.post('/:tenantId/add-admin', addAdminToTenant);
router.delete('/:tenantId/remove-admin/:adminId', removeAdminFromTenant);


export default router;