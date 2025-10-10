import express from 'express';
import {
  createResponse,
  getAllResponses,
  getResponseById,
  updateResponse,
  assignResponse,
  deleteResponse,
  deleteMultipleResponses,
  getResponsesByForm,
  exportResponses
} from '../controllers/responseController.js';
import { authenticate, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// Public route for form submissions (with optional tenant slug)
router.post('/', createResponse);
router.post('/:tenantSlug', createResponse);

// Protected routes
router.use(authenticate);
router.use(addTenantFilter);

// Form-specific responses (must come before generic /:id routes)
router.get('/form/:formId', getResponsesByForm);
router.get('/form/:formId/export', exportResponses);

// Response management
router.get('/', getAllResponses);
router.get('/:id', getResponseById);
router.put('/:id', updateResponse);
router.patch('/:id/assign', assignResponse);
router.delete('/:id', deleteResponse);
router.delete('/', deleteMultipleResponses);

export default router;