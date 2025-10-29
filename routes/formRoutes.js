import express from 'express';
import {
  createForm,
  getAllForms,
  getPublicForms,
  getFormById,
  updateForm,
  deleteForm,
  updateFormVisibility,
  updateFormActiveStatus,
  duplicateForm,
  getFormAnalytics,
  createFormWithFollowUp,
  updateFollowUpConfig,
  getFollowUpConfig,
  linkChildForm,
  unlinkChildForm,
  getChildForms,
  reorderChildForms,
  setSectionBranching,
  getSectionBranching,
  getSectionBranchingPublic
} from '../controllers/formController.js';
import { authenticate, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

// Public routes (no authentication required)
router.get('/public/:tenantSlug', getPublicForms);  // Get all public forms for a tenant
router.get('/:id/public/:tenantSlug', getFormById);  // Get specific form for a tenant
router.get('/:id/section-branching/public/:tenantSlug', getSectionBranchingPublic);

// Protected routes
router.use(authenticate);
router.use(addTenantFilter);

// Form CRUD operations
router.post('/', createForm);
router.get('/', getAllForms);
router.get('/public', getPublicForms);  // Moved here for tenant isolation
router.get('/:id', getFormById);
router.put('/:id', updateForm);
router.delete('/:id', deleteForm);

// Form management
router.patch('/:id/visibility', updateFormVisibility);
router.patch('/:id/active', updateFormActiveStatus);
router.post('/:id/duplicate', duplicateForm);

// Analytics
router.get('/:id/analytics', getFormAnalytics);

// Follow-up question management
router.post('/with-followup', createFormWithFollowUp);
router.put('/:id/followup-config', updateFollowUpConfig);
router.get('/:id/followup-config', getFollowUpConfig);

// Child form management (parent-child form relationships)
router.post('/:id/child-forms', linkChildForm);
router.delete('/:id/child-forms/:childFormId', unlinkChildForm);
router.get('/:id/child-forms', getChildForms);
router.put('/:id/child-forms/reorder', reorderChildForms);

// Section branching management
router.post('/:id/section-branching', setSectionBranching);
router.get('/:id/section-branching', getSectionBranching);
router.get('/:id/section-branching/public/:tenantSlug', getSectionBranchingPublic);

export default router;