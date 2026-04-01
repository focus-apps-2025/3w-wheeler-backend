import LoginLog from '../models/LoginLog.js';
import User from '../models/User.js';

// Get location info from IP (using request headers or IP API)
const getLocationFromIP = async (ip) => {
    try {
        // In production, you would use an IP geolocation service
        // For now, we'll return a basic structure
        // The frontend can pass browser geolocation data
        return {
            city: 'Unknown',
            country: 'Unknown',
            countryCode: 'XX'
        };
    } catch (error) {
        return {
            city: 'Unknown',
            country: 'Unknown',
            countryCode: 'XX'
        };
    }
};

// Update login with location info (called after login)
export const updateLoginLocation = async (req, res) => {
    try {
        const { sessionLogId, location } = req.body;

        if (!sessionLogId) {
            return res.status(400).json({
                success: false,
                message: 'Session log ID is required'
            });
        }

        const updateData = {};

        if (location) {
            updateData.location = {
                ...location,
                city: location.city || 'Unknown',
                country: location.country || 'Unknown',
                countryCode: location.countryCode || 'XX'
            };
        }

        const loginLog = await LoginLog.findByIdAndUpdate(
            sessionLogId,
            updateData,
            { new: true }
        ).populate('userId', 'firstName lastName username email role');

        if (!loginLog) {
            return res.status(404).json({
                success: false,
                message: 'Login log not found'
            });
        }

        res.json({
            success: true,
            data: loginLog
        });
    } catch (error) {
        console.error('Update login location error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get attendance records based on user role
export const getAttendance = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            userId,
            page = 1,
            limit = 50
        } = req.query;

        const userRole = req.user.role;
        const userTenantId = req.user.tenantId;
        const userIdFilter = req.user._id;

        // Build query based on role
        let query = {};

        // Role-based filtering
        if (userRole === 'superadmin') {
            // Super admin sees all users across all tenants
            // Optionally filter by tenant if provided
            if (req.query.tenantId) {
                query.tenantId = req.query.tenantId;
            }
        } else if (userRole === 'admin') {
            // Admin sees only their tenant's users
            query.tenantId = userTenantId;
        } else if (userRole === 'subadmin') {
            // SubAdmin sees only their own attendance
            query.userId = userIdFilter;
        } else {
            // Regular users see only their own
            query.userId = userIdFilter;
        }

        // If specific userId is requested (for admin/superadmin to view specific user)
        if (userId && (userRole === 'superadmin' || userRole === 'admin')) {
            query.userId = userId;
        }

        // Date filtering
        if (startDate || endDate) {
            query.loginTime = {};
            if (startDate) {
                query.loginTime.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.loginTime.$lte = end;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const logs = await LoginLog.find(query)
            .populate('userId', 'firstName lastName username email role')
            .populate('tenantId', 'name slug companyName')
            .sort({ loginTime: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await LoginLog.countDocuments(query);

        // Calculate working hours for each log
        const logsWithHours = logs.map(log => {
            const workingHours = log.logoutTime && log.loginTime
                ? Math.round((log.logoutTime.getTime() - log.loginTime.getTime()) / (1000 * 60 * 60) * 10) / 10
                : 0;

            // Determine if present (both check-in and check-out recorded)
            const isPresent = log.loginTime && log.logoutTime;

            // Determine live status
            const isActive = !log.logoutTime && log.isActive;
            const lastActiveTime = log.lastActiveTime;

            return {
                _id: log._id,
                userId: log.userId,
                tenantId: log.tenantId,
                loginTime: log.loginTime,
                logoutTime: log.logoutTime,
                workingHours,
                isPresent,
                presentStatus: isPresent ? 'present' : (log.loginTime ? 'half-day' : 'absent'),
                location: log.location,
                ipAddress: log.ipAddress,
                lastActiveTime,
                isActive,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt
            };
        });

        res.json({
            success: true,
            data: {
                logs: logsWithHours,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Get attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get attendance summary for dashboard
export const getAttendanceSummary = async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date ? new Date(date) : new Date();
        targetDate.setHours(0, 0, 0, 0);

        const nextDate = new Date(targetDate);
        nextDate.setDate(nextDate.getDate() + 1);

        const userRole = req.user.role;
        const userTenantId = req.user.tenantId;

        // Build query for the target date
        let query = {
            loginTime: {
                $gte: targetDate,
                $lt: nextDate
            }
        };

        // Role-based filtering
        if (userRole === 'superadmin') {
            // Super admin sees all
        } else if (userRole === 'admin') {
            query.tenantId = userTenantId;
        } else if (userRole === 'subadmin') {
            query.userId = req.user._id;
        }

        const logs = await LoginLog.find(query)
            .populate('userId', 'firstName lastName username email role')
            .populate('tenantId', 'name slug companyName');

        // Group by user and get latest status
        const userMap = new Map();

        logs.forEach(log => {
            const userIdStr = log.userId._id.toString();
            const existing = userMap.get(userIdStr);

            if (!existing || log.loginTime > existing.loginTime) {
                userMap.set(userIdStr, {
                    _id: log._id,
                    userId: log.userId,
                    tenantId: log.tenantId,
                    loginTime: log.loginTime,
                    logoutTime: log.logoutTime,
                    workingHours: log.logoutTime && log.loginTime
                        ? Math.round((log.logoutTime.getTime() - log.loginTime.getTime()) / (1000 * 60 * 60) * 10) / 10
                        : 0,
                    isPresent: !!log.logoutTime,
                    location: log.location,
                    isActive: !log.logoutTime && log.isActive,
                    lastActiveTime: log.lastActiveTime
                });
            }
        });

        // Get all users for the tenant/role to show absent ones
        let users = [];
        if (userRole === 'superadmin') {
            users = await User.find({ role: { $in: ['admin', 'subadmin'] } })
                .populate('tenantId', 'name slug companyName');
        } else if (userRole === 'admin') {
            users = await User.find({
                tenantId: userTenantId,
                role: 'subadmin',
                isActive: true
            });
        }

        // Add absent users
        const presentUserIds = new Set(userMap.keys());
        users.forEach(user => {
            if (!presentUserIds.has(user._id.toString())) {
                userMap.set(user._id.toString(), {
                    _id: null,
                    userId: user,
                    tenantId: user.tenantId,
                    loginTime: null,
                    logoutTime: null,
                    workingHours: 0,
                    isPresent: false,
                    presentStatus: 'absent',
                    location: null,
                    isActive: false,
                    lastActiveTime: null
                });
            }
        });

        const summary = Array.from(userMap.values()).map(item => ({
            ...item,
            presentStatus: item.isPresent ? 'present' : 'absent'
        }));

        res.json({
            success: true,
            data: {
                date: targetDate,
                totalUsers: users.length,
                present: summary.filter(s => s.isPresent).length,
                absent: summary.filter(s => !s.isPresent).length,
                activeNow: summary.filter(s => s.isActive).length,
                users: summary
            }
        });
    } catch (error) {
        console.error('Get attendance summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Update last active time (heartbeat)
export const updateLastActive = async (req, res) => {
    try {
        const { sessionLogId } = req.body;

        if (!sessionLogId) {
            return res.status(400).json({
                success: false,
                message: 'Session log ID is required'
            });
        }

        const loginLog = await LoginLog.findByIdAndUpdate(
            sessionLogId,
            {
                lastActiveTime: new Date(),
                isActive: true
            },
            { new: true }
        );

        if (!loginLog) {
            return res.status(404).json({
                success: false,
                message: 'Login log not found'
            });
        }

        res.json({
            success: true,
            data: { lastActiveTime: loginLog.lastActiveTime }
        });
    } catch (error) {
        console.error('Update last active error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get user's own attendance history
export const getMyAttendance = async (req, res) => {
    try {
        const { startDate, endDate, page = 1, limit = 50 } = req.query;

        let query = {
            userId: req.user._id
        };

        if (startDate || endDate) {
            query.loginTime = {};
            if (startDate) {
                query.loginTime.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.loginTime.$lte = end;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const logs = await LoginLog.find(query)
            .sort({ loginTime: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await LoginLog.countDocuments(query);

        const logsWithHours = logs.map(log => ({
            _id: log._id,
            loginTime: log.loginTime,
            logoutTime: log.logoutTime,
            workingHours: log.logoutTime && log.loginTime
                ? Math.round((log.logoutTime.getTime() - log.loginTime.getTime()) / (1000 * 60 * 60) * 10) / 10
                : 0,
            isPresent: !!log.logoutTime,
            location: log.location,
            isActive: !log.logoutTime && log.isActive,
            lastActiveTime: log.lastActiveTime
        }));

        // Calculate summary
        const allLogs = await LoginLog.find(query);
        const totalHours = allLogs.reduce((sum, log) => {
            if (log.logoutTime && log.loginTime) {
                return sum + (log.logoutTime.getTime() - log.loginTime.getTime()) / (1000 * 60 * 60);
            }
            return sum;
        }, 0);

        res.json({
            success: true,
            data: {
                logs: logsWithHours,
                summary: {
                    totalSessions: allLogs.length,
                    totalHours: Math.round(totalHours * 10) / 10,
                    presentDays: allLogs.filter(l => l.logoutTime).length
                },
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Get my attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Export attendance data (for Excel export)
export const exportAttendance = async (req, res) => {
    try {
        const { startDate, endDate, userId } = req.query;

        const userRole = req.user.role;
        const userTenantId = req.user.tenantId;

        let query = {};

        // Role-based filtering
        if (userRole === 'superadmin') {
            if (req.query.tenantId) {
                query.tenantId = req.query.tenantId;
            }
        } else if (userRole === 'admin') {
            query.tenantId = userTenantId;
        } else if (userRole === 'subadmin') {
            query.userId = req.user._id;
        }

        if (userId && (userRole === 'superadmin' || userRole === 'admin')) {
            query.userId = userId;
        }

        if (startDate || endDate) {
            query.loginTime = {};
            if (startDate) {
                query.loginTime.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.loginTime.$lte = end;
            }
        }

        const logs = await LoginLog.find(query)
            .populate('userId', 'firstName lastName username email role')
            .populate('tenantId', 'name companyName')
            .sort({ loginTime: -1 });

        // Format for export
        const exportData = logs.map(log => {
            const workingHours = log.logoutTime && log.loginTime
                ? Math.round((log.logoutTime.getTime() - log.loginTime.getTime()) / (1000 * 60 * 60) * 10) / 10
                : 0;

            return {
                'User Name': `${log.userId?.firstName || ''} ${log.userId?.lastName || ''}`.trim(),
                'Username': log.userId?.username || '',
                'Role': log.userId?.role || '',
                'Dealer': log.tenantId?.companyName || log.tenantId?.name || 'Super Admin',
                'Login Time': log.loginTime ? log.loginTime.toISOString() : '',
                'Logout Time': log.logoutTime ? log.logoutTime.toISOString() : '',
                'Working Minutes': Math.round(workingHours * 60),
                'Present Status': log.logoutTime ? 'Present' : (log.loginTime ? 'Half Day' : 'Absent'),
                'Location': log.location?.city ? `${log.location.city}, ${log.location.country}` : 'Unknown',
                'IP Address': log.ipAddress || ''
            };
        });

        res.json({
            success: true,
            data: exportData
        });
    } catch (error) {
        console.error('Export attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Get all users for attendance (for superadmin/admin)
export const getAttendanceUsers = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userTenantId = req.user.tenantId;

        let query = { isActive: true };

        if (userRole === 'superadmin') {
            // Get all admins and subadmins
            query.role = { $in: ['admin', 'subadmin'] };
        } else if (userRole === 'admin') {
            // Get only subadmins in this tenant
            query.role = 'subadmin';
            query.tenantId = userTenantId;
        } else {
            // SubAdmin can only see themselves
            query._id = req.user._id;
        }

        const users = await User.find(query)
            .populate('tenantId', 'name slug companyName')
            .select('firstName lastName username email role tenantId')
            .sort({ firstName: 1 });

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Get attendance users error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};