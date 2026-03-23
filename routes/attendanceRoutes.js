import express from 'express';
import {
    getAttendance,
    getAttendanceSummary,
    updateLastActive,
    getMyAttendance,
    exportAttendance,
    getAttendanceUsers,
    updateLoginLocation
} from '../controllers/attendanceController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// @route   GET /api/attendance
// @desc    Get attendance records (filtered by role)
// @access  Private
router.get('/', getAttendance);

// @route   GET /api/attendance/summary
// @desc    Get attendance summary for dashboard
// @access  Private
router.get('/summary', getAttendanceSummary);

// @route   GET /api/attendance/my
// @desc    Get current user's attendance history
// @access  Private
router.get('/my', getMyAttendance);

// @route   GET /api/attendance/users
// @desc    Get all users for attendance management
// @access  Private (Superadmin, Admin)
router.get('/users', getAttendanceUsers);

// @route   GET /api/attendance/export
// @desc    Export attendance data for Excel
// @access  Private
router.get('/export', exportAttendance);

// @route   POST /api/attendance/heartbeat
// @desc    Update last active time (heartbeat)
// @access  Private
router.post('/heartbeat', updateLastActive);

// @route   PUT /api/attendance/login-location
// @desc    Update login location info
// @access  Private
router.put('/login-location', updateLoginLocation);

export default router;