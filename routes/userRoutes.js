import express from 'express';
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  resetUserPassword
} from '../controllers/userController.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';
import { validateUserCreation } from '../middleware/validation.js';

const router = express.Router();

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(addTenantFilter);
router.use(adminOnly);

// @route   POST /api/users
// @desc    Create a new user
// @access  Private (Admin only)
router.post('/', validateUserCreation, createUser);

// @route   GET /api/users
// @desc    Get all users with pagination and filtering
// @access  Private (Admin only)
router.get('/', getAllUsers);

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (Admin only)
router.get('/:id', getUserById);

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (Admin only)
router.put('/:id', updateUser);

// @route   DELETE /api/users/:id
// @desc    Delete user
// @access  Private (Admin only)
router.delete('/:id', deleteUser);

// @route   PUT /api/users/:id/reset-password
// @desc    Reset user password
// @access  Private (Admin only)
router.put('/:id/reset-password', resetUserPassword);

export default router;