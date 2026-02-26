import express from 'express';
import { login, signup, getProfile, changePassword } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateLogin } from '../middleware/validation.js';

const router = express.Router();

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', validateLogin, login);

// @route   POST /api/auth/signup
// @desc    Signup new tenant (Free Trial)
// @access  Public
router.post('/signup', signup);

// @route   GET /api/auth/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', authenticate, getProfile);

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', authenticate, changePassword);

export default router;