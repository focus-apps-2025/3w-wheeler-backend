import mongoose from 'mongoose';
import Form from '../models/Form.js';
import Response from '../models/Response.js';
import User from '../models/User.js';
import FormSession from '../models/FormSession.js';
import ActivityLog from '../models/ActivityLog.js';
import { calculateUserActiveMinutes } from './activityController.js';

// ─── Date Parser Helper ──────────────────────────────────────────────────────
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  // Try DD-MM-YYYY or DD/MM/YYYY
  const parts = dateStr.split(/[-/]/);
  if (parts.length === 3) {
    // If year is the first part (YYYY-MM-DD), it would have been caught by new Date() 
    // unless it's a weird format. Let's assume DD is parts[0] or parts[2].
    let y, m, d_part;
    if (parts[2].length === 4) { // DD-MM-YYYY
      y = parts[2]; m = parts[1]; d_part = parts[0];
    } else if (parts[0].length === 4) { // YYYY-MM-DD (already tried but just in case)
      y = parts[0]; m = parts[1]; d_part = parts[2];
    }
    
    if (y) {
      const isoStr = `${y}-${m.padStart(2, '0')}-${d_part.padStart(2, '0')}`;
      const d2 = new Date(isoStr);
      if (!isNaN(d2.getTime())) return d2;
    }
  }
  return null;
};

// ─── Active Hours Calculator - Session Based (Server Side) ───────────────────
const calculateActiveMinutes = (activities, adminData = null, dateRange = {}) => {
  const { start, end } = dateRange;
  // Standardize timestamps
  const startTime = start instanceof Date ? start.getTime() : (parseDate(start)?.getTime() || 0);
  let inclusiveEndTime = end instanceof Date ? end.getTime() : (parseDate(end)?.getTime() || Infinity);
  
  if (inclusiveEndTime !== Infinity) {
    const e = new Date(inclusiveEndTime);
    if (e.getUTCHours() === 0 && e.getUTCMinutes() === 0) {
      e.setHours(23, 59, 59, 999);
      inclusiveEndTime = e.getTime();
    }
  }

  // Filter timestamps to the requested range
  const allTimestamps = activities
    .map(a => new Date(a.verifiedAt || a.updatedAt || a.createdAt).getTime())
    .filter(t => !isNaN(t) && t >= startTime && t <= inclusiveEndTime)
    .sort((a, b) => a - b);

  if (allTimestamps.length === 0) return 0;

  // Split into daily sessions
  let totalMinutes = 0;
  const days = {};
  
  allTimestamps.forEach(t => {
    try {
      const dayStr = new Date(t).toISOString().split('T')[0];
      if (!days[dayStr]) days[dayStr] = [];
      days[dayStr].push(t);
    } catch (e) { /* ignore invalid dates */ }
  });

  for (const day in days) {
    const ts = days[day];
    if (ts.length === 1) {
      totalMinutes += 2; // Fixed small interaction credit for single action
    } else {
      // Span between first and last activity of the day
      const spanMs = ts[ts.length - 1] - ts[0];
      totalMinutes += Math.floor(spanMs / 60000) + 2; // Add 2 mins buffer
    }
  }

  return totalMinutes;
};

export const getDashboardStats = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get basic counts with tenant filter
    // For forms, we also include global forms shared with this tenant
    let effectiveFormFilter = { ...req.tenantFilter };
    if (req.user.role !== 'superadmin' && req.user.tenantId) {
      const tenantId = req.user.tenantId instanceof mongoose.Types.ObjectId
        ? req.user.tenantId
        : new mongoose.Types.ObjectId(req.user.tenantId);

      effectiveFormFilter = {
        $or: [
          { tenantId: tenantId },
          { sharedWithTenants: tenantId }
        ]
      };
    }

    const totalForms = await Form.countDocuments(effectiveFormFilter);
    const totalResponses = await Response.countDocuments(req.tenantFilter);
    const totalUsers = await User.countDocuments({ ...req.tenantFilter, role: { $ne: 'admin' } });
    const publicForms = await Form.countDocuments({ ...effectiveFormFilter, isVisible: true });

    // Get period-specific data
    const formsInPeriod = await Form.countDocuments({
      ...effectiveFormFilter,
      createdAt: { $gte: startDate }
    });

    const responsesInPeriod = await Response.countDocuments({
      ...req.tenantFilter,
      createdAt: { $gte: startDate }
    });

    // Get response status distribution
    const statusDistribution = await Response.aggregate([
      { $match: req.tenantFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get top forms by responses
    const topForms = await Response.aggregate([
      { $match: req.tenantFilter },
      {
        $group: {
          _id: '$questionId',
          responseCount: { $sum: 1 }
        }
      },
      {
        $sort: { responseCount: -1 }
      },
      {
        $limit: 5
      },
      {
        $lookup: {
          from: 'forms',
          localField: '_id',
          foreignField: 'id',
          as: 'form'
        }
      },
      {
        $unwind: '$form'
      },
      {
        $project: {
          formId: '$_id',
          title: '$form.title',
          responseCount: 1
        }
      }
    ]);

    // Get daily response counts for the period
    const dailyResponses = await Response.aggregate([
      {
        $match: {
          ...req.tenantFilter,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Get recent activity
    const recentForms = await Form.find(effectiveFormFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'username firstName lastName')
      .select('id title description createdAt createdBy');

    const recentResponses = await Response.find(req.tenantFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('assignedTo', 'username firstName lastName')
      .select('id questionId submittedBy status createdAt assignedTo');

    res.json({
      success: true,
      data: {
        overview: {
          totalForms,
          totalResponses,
          totalUsers,
          publicForms,
          formsInPeriod,
          responsesInPeriod
        },
        statusDistribution: statusDistribution.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        topForms,
        dailyResponses: dailyResponses.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        recentActivity: {
          forms: recentForms,
          responses: recentResponses.map(response => ({
            ...response.toObject(),
            answers: response.answers ? Object.fromEntries(response.answers) : {}
          }))
        },
        period
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFormAnalytics = async (req, res) => {
  try {
    const { formId } = req.params;
    const { period = '30d' } = req.query;

    // Verify form exists (support both id and _id)
    let form;
    if (mongoose.Types.ObjectId.isValid(formId)) {
      form = await Form.findById(formId);
    } else {
      form = await Form.findOne({ id: formId });
    }

    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Tenant check: Ensure user has access to this form
    if (req.user.role !== 'superadmin') {
      const userTenantId = req.user.tenantId instanceof mongoose.Types.ObjectId
        ? req.user.tenantId
        : new mongoose.Types.ObjectId(req.user.tenantId);

      const isOwner = form.tenantId && form.tenantId.toString() === userTenantId.toString();
      const isShared = form.sharedWithTenants && form.sharedWithTenants.some(t => t.toString() === userTenantId.toString());

      if (!isOwner && !isShared) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view analytics for this form.'
        });
      }
    }

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all responses for this form (not just period) with tenant filter
    const allResponses = await Response.find({
      ...req.tenantFilter,
      $or: [{ questionId: formId }, { questionId: form._id?.toString() }]
    })
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'firstName lastName email')
      .lean();

    // Filter responses for timeline (within period)
    const periodResponses = allResponses.filter(r => new Date(r.createdAt) >= startDate);

    // Basic metrics
    const totalResponses = allResponses.length;

    // Status distribution
    const statusDistribution = allResponses.reduce((acc, response) => {
      acc[response.status] = (acc[response.status] || 0) + 1;
      return acc;
    }, {});

    // Map status to frontend expected format
    const responseStats = {
      completed: statusDistribution.verified || 0,
      pending: statusDistribution.pending || 0,
      inProgress: statusDistribution.inProgress || 0
    };

    // Create timeline data (daily grouping within period)
    const timelineMap = periodResponses.reduce((acc, response) => {
      const date = new Date(response.createdAt).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, count: 0, status: response.status };
      }
      acc[date].count++;
      return acc;
    }, {});

    const timeline = Object.values(timelineMap).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Recent responses (last 10)
    const recentResponses = allResponses.slice(0, 10).map(response => ({
      _id: response._id,
      status: response.status === 'verified' ? 'completed' :
        response.status === 'pending' ? 'pending' :
          response.status === 'inProgress' ? 'in-progress' : response.status,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      assignedTo: response.assignedTo ? {
        name: `${response.assignedTo.firstName} ${response.assignedTo.lastName}`,
        email: response.assignedTo.email
      } : null,
      data: response.answers instanceof Map ? Object.fromEntries(response.answers) : response.answers
    }));

    res.json({
      success: true,
      data: {
        form: {
          _id: form._id,
          title: form.title,
          description: form.description,
          createdAt: form.createdAt
        },
        totalResponses,
        responseStats,
        responses: recentResponses,
        timeline,
        questionInsights: {
          sections: form.sections || [],
          followUpQuestions: form.followUpQuestions || [],
          responses: allResponses.map((response) => ({
            id: response.id,
            questionId: response.questionId,
            answers:
              response.answers instanceof Map
                ? Object.fromEntries(response.answers)
                : response.answers,
            status: response.status,
            createdAt: response.createdAt,
          })),
        },
      },
    });

  } catch (error) {
    console.error('Get form analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getUserAnalytics = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // User role distribution with tenant filter
    const roleDistribution = await User.aggregate([
      ...(req.tenantFilter.tenantId ? [{ $match: req.tenantFilter }] : []),
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // New users in period
    const newUsers = await User.countDocuments({
      ...req.tenantFilter,
      createdAt: { $gte: startDate }
    });

    // Active users (users who logged in recently)
    const activeUsers = await User.countDocuments({
      ...req.tenantFilter,
      lastLogin: { $gte: startDate }
    });

    // User activity by day
    const dailyActivity = await User.aggregate([
      {
        $match: {
          ...req.tenantFilter,
          lastLogin: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$lastLogin'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        metrics: {
          totalUsers: await User.countDocuments(req.tenantFilter),
          newUsers,
          activeUsers,
          period
        },
        roleDistribution: roleDistribution.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        dailyActivity: dailyActivity.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const exportAnalytics = async (req, res) => {
  try {
    const { type = 'dashboard', period = '30d', formId } = req.query;

    let data;

    switch (type) {
      case 'dashboard':
        // Get dashboard analytics
        await getDashboardStats(req, {
          json: (result) => { data = result.data; }
        });
        break;

      case 'form':
        if (!formId) {
          return res.status(400).json({
            success: false,
            message: 'Form ID is required for form analytics export'
          });
        }
        // Get form analytics
        // We need to merge query formId into params for getFormAnalytics
        const originalParams = req.params;
        req.params = { ...req.params, formId };
        await getFormAnalytics(req, {
          json: (result) => { data = result.data; }
        });
        req.params = originalParams; // Restore params
        break;

      case 'users':
        // Get user analytics
        await getUserAnalytics(req, {
          json: (result) => { data = result.data; }
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid analytics type'
        });
    }

    const exportData = {
      type,
      period,
      exportedAt: new Date().toISOString(),
      data
    };

    const filename = `analytics_${type}_${period}.json`;
    const safeFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const encodedFilename = encodeURIComponent(filename);

    res.json(exportData);

  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAdminPerformance = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { startDate, endDate } = req.query;

    const pipeline = [];

    // Base match for the user's tenant
    const match = { ...req.tenantFilter };

    // Standardized date objects for matching and range mapping
    const startD = parseDate(startDate);
    const endD = parseDate(endDate);

    if (startD || endD) {
      match.createdAt = {};
      if (startD) match.createdAt.$gte = startD;
      if (endD) {
        const d = new Date(endD);
        d.setHours(23, 59, 59, 999);
        match.createdAt.$lte = d;
      }
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      match.createdAt = { $gte: thirtyDaysAgo };
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    // 1. Get process metrics (forms they verified/rejected)
    // Here we consider "processed" as forms assigned to them and verified/rejected by them.
    const assignmentsMatch = {
      ...match,
      assignedTo: new mongoose.Types.ObjectId(adminId)
    };

    const processStats = await Response.aggregate([
      { $match: assignmentsMatch },
      {
        $group: {
          _id: null,
          totalFormsProcessed: { $sum: { $cond: [{ $in: ['$status', ['verified', 'rejected']] }, 1, 0] } },
          formsApproved: { $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] } },
          formsRejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          pendingForms: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          // Response time in MINUTES
          totalResponseTime: {
            $sum: {
              $cond: [
                { $and: [{ $in: ['$status', ['verified', 'rejected']] }, { $not: [{ $eq: ['$verifiedAt', null] }] }] },
                { $divide: [{ $subtract: ['$verifiedAt', { $ifNull: ['$assignedAt', '$createdAt'] }] }, 60000] },
                0
              ]
            }
          }
        }
      }
    ]);

    // 2. Count all responses this admin has touched:
    //    - Responses currently assigned to them (their active workload)
    //    - Responses they verified/processed (their completed work)
    const adminObjectId = mongoose.Types.ObjectId.isValid(adminId) 
                         ? new mongoose.Types.ObjectId(adminId) 
                         : null;
    
    if (!adminObjectId && adminId.length === 24) {
      // Fallback if it's 24 chars but not 'valid' ObjectId for some reason
      try {
        new mongoose.Types.ObjectId(adminId);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid admin ID format' });
      }
    }

    // Reuse the 'admin' variable fetched at line 607
    const adminName = admin ? `${admin.firstName} ${admin.lastName}` : null;
    const adminEmail = admin ? admin.email : null;

    const allAssignedForms = await Response.countDocuments({
      ...match,
      $or: [
        { assignedTo: adminObjectId },
        { verifiedBy: adminObjectId },
        { submittedBy: adminName },
        { "submitterContact.email": adminEmail }
      ].filter(cond => Object.values(cond)[0] !== null)
    });

    const stats = processStats[0] || {
      totalFormsProcessed: 0,
      formsApproved: 0,
      formsRejected: 0,
      pendingForms: 0,
      totalResponseTime: 0
    };

    const avgResponseTime = stats.totalFormsProcessed > 0 ? stats.totalResponseTime / stats.totalFormsProcessed : 0;

    // 3. New: Calculate active minutes server-side for the given period (High-Fidelity)
    const startDateObj = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const endDateObj = endDate ? new Date(endDate) : new Date();
    if (endDate) endDateObj.setHours(23, 59, 59, 999);

    // Use the official helper for consistency
    const activeMinutes = await calculateUserActiveMinutes(
      adminId,
      req.user.tenantId,
      startDateObj,
      endDateObj
    );

    // Calculate session-based stats (Secondary metrics)
    const allLogs = await ActivityLog.find({
      userId: new mongoose.Types.ObjectId(adminId),
      tenantId: req.user.tenantId,
      createdAt: { $gte: startDateObj, $lte: endDateObj }
    }).sort({ createdAt: 1 }).lean();

    let sessionCount = 0;
    let totalSessionDurationMs = 0;
    const SESSION_TIMEOUT = 30 * 60 * 1000;

    if (allLogs.length > 0) {
      sessionCount = 1;
      let sessionStart = allLogs[0].createdAt;
      let lastActivity = allLogs[0].createdAt;

      for (let i = 1; i < allLogs.length; i++) {
        const current = allLogs[i].createdAt;
        if (current - lastActivity > SESSION_TIMEOUT) {
          totalSessionDurationMs += (lastActivity - sessionStart);
          sessionCount++;
          sessionStart = current;
        }
        lastActivity = current;
      }
      totalSessionDurationMs += (lastActivity - sessionStart);
    }

    const avgSessionDuration = sessionCount > 0 
      ? Math.round((totalSessionDurationMs / 60000) / sessionCount) 
      : 0;

    res.json({
      success: true,
      data: {
        totalFormsProcessed: stats.totalFormsProcessed,
        formsApproved: stats.formsApproved,
        formsRejected: stats.formsRejected,
        pendingForms: stats.pendingForms,
        formsSubmitted: allAssignedForms,
        averageResponseTime: avgResponseTime,
        lastActive: (allLogs.length > 0 ? allLogs[allLogs.length - 1].createdAt : admin.lastLogin) || admin.updatedAt,
        totalCustomersAssigned: stats.totalFormsProcessed + stats.pendingForms,
        activeDurationMinutes: activeMinutes, 
        activeHours: activeMinutes / 60,
        sessionCount,
        avgSessionDuration
      }
    });

  } catch (error) {
    console.error('getAdminPerformance error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdminActivity = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { startDate, endDate, limit = 10 } = req.query;

    // Fetch admin email to track their direct submissions
    const adminUser = await User.findById(adminId).select('email').lean();
    const adminEmail = adminUser?.email;

    // Find responses where the admin ACTED (verified/rejected) OR SUBMITTED OR ASSIGNED
    const match = { 
      ...req.tenantFilter, 
      $or: [
        { verifiedBy: new mongoose.Types.ObjectId(adminId) }, // Reviews they performed
        { assignedTo: new mongoose.Types.ObjectId(adminId) }, // Assigned to them
      ]
    };

    if (adminEmail) {
      match.$or.push({ "submitterContact.email": adminEmail }); // Direct submissions
    }

    if (startDate || endDate) {
      match.$or = match.$or.map(cond => {
        // Apply date filter to the specific timestamp of each activity type
        return { ...cond };
      });
      
      // We'll filter the whole query by updatedAt/verifiedAt range for simplicity
      match.$or = match.$or.map(cond => {
        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          dateFilter.$lte = end;
        }
        
        // Use a generic updatedAt check for date range since verifiedAt/createdAt 
        // will both be reflected in updatedAt
        return { ...cond, updatedAt: dateFilter };
      });
    }

    const recentResponses = await Response.find(match)
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Get form titles
    const formIds = [...new Set(recentResponses.map(r => r.questionId))];
    const forms = await Form.find(
      { $or: formIds.map(id => ({ id: id })) },
      { id: 1, title: 1 }
    ).lean();

    const formTitleMap = {};
    forms.forEach(form => {
      formTitleMap[form.id] = form.title;
    });

    // Enrich activities with FormSession data for precise timing
    const recentActivity = await Promise.all(recentResponses.map(async (r) => {
      let durationMinutes = 0;
      
      // NEW: Improved matching logic
      let session = null;
      const metaSessionId = r.submissionMetadata?.formSessionId;
      
      if (metaSessionId) {
        session = await FormSession.findOne({ sessionId: metaSessionId }).lean();
      }
      
      if (!session) {
        // Fallback to existing timestamp-based logic
        session = await FormSession.findOne({
          userId: new mongoose.Types.ObjectId(adminId),
          formId: r.questionId,
          // Match approximate time (within 1 hour of response creation)
          startedAt: { 
            $lte: new Date(r.createdAt),
            $gte: new Date(new Date(r.createdAt).getTime() - 60 * 60 * 1000) 
          }
        }).lean();
      }

      if (session) {
        let timeSpent = session.timeSpent;
        if (!timeSpent && session.startedAt) {
          const end = new Date(session.completedAt || session.lastActivityAt || session.updatedAt || r.createdAt);
          const start = new Date(session.startedAt);
          timeSpent = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
        }
        if (timeSpent) durationMinutes = Math.floor(timeSpent / 60);
      } else if (r.status !== 'pending') {
        // Fallback to estimation
        const end = new Date(r.verifiedAt || r.updatedAt);
        const start = new Date(r.assignedAt || r.createdAt);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs > 0) durationMinutes = Math.floor(diffMs / 60000);
      }

      return {
        id: r.id || r._id.toString(),
        type: r.status === 'verified' ? 'approve' : r.status === 'rejected' ? 'reject' : 'review',
        formId: r.questionId,
        formName: formTitleMap[r.questionId] || 'Unknown Form',
        customerName: r.submittedBy || r.submitterContact?.email || 'Unknown Customer',
        timestamp: r.verifiedAt || r.updatedAt || r.createdAt,
        durationMinutes
      };
    }));

    res.json({
      success: true,
      data: {
        recent: recentActivity
      }
    });
  } catch (error) {
    console.error('getAdminActivity error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getTenantSubmissionStats = async (req, res) => {
  try {
    const match = { ...req.tenantFilter };

    const totalForms = await Form.countDocuments(match);
    const totalSubmissions = await Response.countDocuments(match);

    // Group by WHO ACTUALLY SUBMITTED (submittedBy or submitterContact.email)
    const userWiseSubmissions = await Response.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            // Use submittedBy field if available, otherwise use email from submitterContact
            submittedBy: "$submittedBy",
            email: "$submitterContact.email"
          },
          count: { $sum: 1 },
          responses: { 
            $push: {
              id: "$id",
              formId: "$questionId",
              submittedAt: "$createdAt",
              status: "$status"
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          userId: "$_id.submittedBy", // This is the submitter's name/ID
          userEmail: "$_id.email",
          userName: {
            $cond: {
              if: { $and: [
                { $ne: ["$_id.submittedBy", null] },
                { $ne: ["$_id.submittedBy", ""] },
                { $ne: ["$_id.submittedBy", "undefined"] }
              ]},
              then: "$_id.submittedBy",
              else: {
                $cond: {
                  if: { $ne: ["$_id.email", null] },
                  then: "$_id.email",
                  else: "Anonymous"
                }
              }
            }
          },
          count: 1,
          forms: { $slice: ["$responses", 10] } // Last 10 responses
        }
      },
      { $sort: { count: -1 } }
    ]);


    res.json({
      success: true,
      data: {
        totalForms,
        totalSubmissions,
        userWiseSubmissions
      }
    });
  } catch (error) {
    console.error('getTenantSubmissionStats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdminResponseDetails = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({ success: false, message: 'Invalid admin ID' });
    }
    
    const adminObjectId = new mongoose.Types.ObjectId(adminId);
    const admin = await User.findById(adminId).select('firstName lastName email');
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    const adminName = `${admin.firstName} ${admin.lastName}`;
    const adminEmail = admin.email;
    const { startDate, endDate } = req.query;
    const match = { ...req.tenantFilter };

    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    } else {
      // Default to last 30 days IF no range is provided, matching getAdminPerformance
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      match.createdAt = { $gte: thirtyDaysAgo };
    }

    // Fetch all responses this admin has touched 
    // (assigned, verified, OR submitted by them)
    const responses = await Response.find({
      ...match,
      $or: [
        { assignedTo: adminObjectId },
        { verifiedBy: adminObjectId },
        { submittedBy: adminName },
        { "submitterContact.email": adminEmail }
      ]
    }).sort({ createdAt: -1 }).lean();

    const totalResponses = responses.length;

    // Status breakdown
    const statusBreakdown = { pending: 0, verified: 0, rejected: 0 };
    responses.forEach(r => {
      if (r.status === 'pending') statusBreakdown.pending++;
      else if (r.status === 'verified') statusBreakdown.verified++;
      else if (r.status === 'rejected') statusBreakdown.rejected++;
    });

    // Yes / No / N/A answer counts — scan every answer value in each response
    const yesNoNA = { yes: 0, no: 0, na: 0 };
    const formMap = {}; // formId -> { formId, formTitle, yes, no, na, total, avgTimeSpent, sessionCount }

    // Group sessions by formId for all users in the tenant
    // Include both completed and in-progress sessions to recover from previous tracking bug
    const sessions = await FormSession.find({
      tenantId: req.user.tenantId,
      status: { $in: ['completed', 'in-progress'] },
      // Use startDate if provided, else fallback to 30 days ago for performance
      // Add a 1-hour buffer (3600000ms) to startDate to catch sessions that started just before the window
      startedAt: { $gte: startDate ? new Date(new Date(startDate).getTime() - 60 * 60 * 1000) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }).lean();

    const sessionMap = {};
    sessions.forEach(s => {
      if (!sessionMap[s.formId]) sessionMap[s.formId] = [];
      
      // For in-progress sessions, calculate timeSpent if not set
      if (s.status === 'in-progress' && (!s.timeSpent || s.timeSpent === 0)) {
        const end = s.completedAt || s.lastActivityAt || s.updatedAt || new Date();
        const start = s.startedAt;
        s.timeSpent = Math.max(1, Math.floor((new Date(end) - new Date(start)) / 1000));
      }
      
      sessionMap[s.formId].push(s);
    });

    responses.forEach(r => {
      const formId = r.questionId;
      if (!formMap[formId]) {
        formMap[formId] = { 
          formId, 
          formTitle: formId, 
          yes: 0, 
          no: 0, 
          na: 0, 
          responseCount: 0,
          totalDuration: 0,
          durationCount: 0,
          avgTimeSpent: 0
        };
      }

      formMap[formId].responseCount++;

      // Try to find the specific submission session for this response
      const formSessions = sessionMap[formId] || [];
      
      // NEW: Improved matching logic
      let matchingSession = null;
      
      // 1. Try explicit sessionId match from metadata
      const metaSessionId = r.submissionMetadata?.formSessionId;
      if (metaSessionId) {
        matchingSession = formSessions.find(s => s.sessionId === metaSessionId);
      }
      
      // 2. Fallback to existing timestamp-based logic
      if (!matchingSession) {
        matchingSession = formSessions.find(s => {
          const sessionTime = new Date(s.completedAt || s.lastActivityAt || s.updatedAt).getTime();
          const responseTime = new Date(r.createdAt || r.timestamp).getTime();
          const timeDiff = Math.abs(sessionTime - responseTime);
          
          // Original logic for threshold
          const isSameUser = s.userId && adminObjectId && s.userId.toString() === adminObjectId.toString();
          const isAdminSubmission = r.submittedBy === adminName || r.submitterContact?.email === adminEmail;
          
          if (isSameUser || isAdminSubmission) {
             return timeDiff < 60 * 1000; // 60s for direct/admin match
          }
          return timeDiff < 10 * 1000; // 10s for anonymous match
        });
      }

      if (matchingSession && matchingSession.timeSpent > 0) {
        formMap[formId].totalDuration += matchingSession.timeSpent;
        formMap[formId].durationCount++;
      } else {
        // Log individual response duration for reviews if it's an admin review
        if (r.status !== 'pending' && r.verifiedBy && r.verifiedBy.toString() === adminObjectId.toString() && r.verifiedAt) {
          const start = r.assignedAt || r.createdAt;
          const diffSeconds = Math.floor((new Date(r.verifiedAt) - new Date(start)) / 1000);
          if (diffSeconds > 0) {
            // We'll track this as a secondary metric or combined for now
            // The user asked for "submitting the form", but if no session exists, 
            // the review time is better than nothing in an admin dashboard.
            formMap[formId].totalDuration += Math.min(diffSeconds, 1800); // capped at 30m
            formMap[formId].durationCount++;
          }
        }
      }

      // answers processing (same as before)
      const answers = r.answers instanceof Map ? Object.fromEntries(r.answers) : (r.answers || {});
      Object.values(answers).forEach(val => {
        if (val === null || val === undefined) return;
        const strVal = String(val).toLowerCase().trim();
        if (strVal === 'yes') { yesNoNA.yes++; formMap[formId].yes++; } 
        else if (strVal === 'no') { yesNoNA.no++; formMap[formId].no++; } 
        else if (strVal === 'n/a' || strVal === 'na' || strVal === 'n or na') { yesNoNA.na++; formMap[formId].na++; }
      });
    });

    // Calculate average and total time for each form
    Object.keys(formMap).forEach(id => {
      const f = formMap[id];
      f.totalTimeSpent = f.totalDuration;
      
      // If we still have no duration count, try to use the global average for this form in the tenant
      if (f.durationCount === 0) {
        const globalSessions = sessionMap[id] || [];
        const completedSessions = globalSessions.filter(s => s.timeSpent > 0);
        if (completedSessions.length > 0) {
          const total = completedSessions.reduce((sum, s) => sum + s.timeSpent, 0);
          f.avgTimeSpent = Math.round(total / completedSessions.length);
        }
      } else {
        f.avgTimeSpent = Math.round(f.totalDuration / f.durationCount);
      }
    });

    // Enrich form titles by looking up form documents
    const formIds = Object.keys(formMap);
    if (formIds.length > 0) {
      const forms = await Form.find(
        { $or: [{ id: { $in: formIds } }, { _id: { $in: formIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } }] },
        { id: 1, _id: 1, title: 1 }
      ).lean();

      forms.forEach(f => {
        const key = f.id || f._id.toString();
        if (formMap[key]) {
          formMap[key].formTitle = f.title || key;
        }
      });
    }

    // Sort by response count descending
    const formBreakdown = Object.values(formMap).sort((a, b) => b.responseCount - a.responseCount);

    const personalSubmissions = responses
      .filter(r => r.submittedBy === adminName || r.submitterContact?.email === adminEmail)
      .slice(0, 10) // Top 10 recent
      .map(r => ({
        id: r._id.toString(),
        formTitle: formMap[r.questionId]?.formTitle || r.questionId,
        submittedAt: r.createdAt,
        status: r.status
      }));

    res.json({
      success: true,
      data: {
        totalResponses,
        statusBreakdown,
        yesNoNA,
        formBreakdown,
        personalSubmissions
      }
    });
  } catch (error) {
    console.error('getAdminResponseDetails error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const getResponseTimeAnalytics = async (req, res) => {
  try {
    const { formId } = req.params;
    const { startDate, endDate, groupBy = 'day' } = req.query;

    // Build match conditions
    const match = {
      questionId: formId,
      ...req.tenantFilter,
      isSectionSubmit: { $ne: true }
    };

    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    }

    // Get responses with timing data
    const responses = await Response.find(match)
      .populate('assignedTo', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    // Calculate time statistics
    const times = responses
      .map(r => r.submissionMetadata?.timeSpent)
      .filter(t => t > 0);

    const stats = {
      totalResponses: responses.length,
      responsesWithTiming: times.length,
      averageTime: times.length > 0 
        ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
        : 0,
      medianTime: times.length > 0 
        ? calculateMedian(times)
        : 0,
      minTime: times.length > 0 ? Math.min(...times) : 0,
      maxTime: times.length > 0 ? Math.max(...times) : 0,
      timeDistribution: calculateTimeDistribution(times),
      byDay: groupResponsesByDay(responses, groupBy),
      byHour: groupResponsesByHour(responses)
    };

    // Get question-level timings from FormSession
    const sessions = await FormSession.find({
      formId: formId,
      status: 'completed',
      questionTimings: { $exists: true, $ne: [] }
    }).lean();

    const questionTimings = {};
    sessions.forEach(session => {
      if (session.questionTimings) {
        session.questionTimings.forEach(q => {
          if (!questionTimings[q.questionId]) {
            questionTimings[q.questionId] = {
              questionId: q.questionId,
              questionText: q.questionText,
              questionType: q.questionType,
              times: [],
              averageTime: 0,
              totalTime: 0,
              responseCount: 0
            };
          }
          if (q.timeSpent) {
            questionTimings[q.questionId].times.push(q.timeSpent);
            questionTimings[q.questionId].totalTime += q.timeSpent;
            questionTimings[q.questionId].responseCount++;
          }
        });
      }
    });

    // Calculate averages for questions
    Object.values(questionTimings).forEach(q => {
      q.averageTime = q.responseCount > 0 
        ? Math.round(q.totalTime / q.responseCount)
        : 0;
      q.timeSpentSeconds = q.averageTime;
      q.timeSpentFormatted = formatTimeDuration(q.averageTime);
    });

    // Get fastest and slowest submissions
    const fastestSubmissions = [...responses]
      .filter(r => r.submissionMetadata?.timeSpent > 0)
      .sort((a, b) => (a.submissionMetadata?.timeSpent || 0) - (b.submissionMetadata?.timeSpent || 0))
      .slice(0, 5)
      .map(r => ({
        id: r.id,
        submittedBy: r.submittedBy,
        timeSpent: r.submissionMetadata?.timeSpent,
        timeSpentFormatted: formatTimeDuration(r.submissionMetadata?.timeSpent),
        createdAt: r.createdAt
      }));

    const slowestSubmissions = [...responses]
      .filter(r => r.submissionMetadata?.timeSpent > 0)
      .sort((a, b) => (b.submissionMetadata?.timeSpent || 0) - (a.submissionMetadata?.timeSpent || 0))
      .slice(0, 5)
      .map(r => ({
        id: r.id,
        submittedBy: r.submittedBy,
        timeSpent: r.submissionMetadata?.timeSpent,
        timeSpentFormatted: formatTimeDuration(r.submissionMetadata?.timeSpent),
        createdAt: r.createdAt
      }));

    res.json({
      success: true,
      data: {
        summary: stats,
        questionTimings: Object.values(questionTimings).sort((a, b) => b.averageTime - a.averageTime),
        fastestSubmissions,
        slowestSubmissions,
        recentResponses: responses.slice(0, 20).map(r => ({
          id: r.id,
          submittedBy: r.submittedBy,
          timeSpent: r.submissionMetadata?.timeSpent,
          timeSpentFormatted: formatTimeDuration(r.submissionMetadata?.timeSpent),
          createdAt: r.createdAt,
          status: r.status
        }))
      }
    });

  } catch (error) {
    console.error('Get response time analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
function calculateMedian(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function calculateTimeDistribution(times) {
  if (times.length === 0) return {};
  
  const buckets = {
    '0-30s': 0,
    '30s-1m': 0,
    '1-2m': 0,
    '2-5m': 0,
    '5-10m': 0,
    '10-20m': 0,
    '20-30m': 0,
    '30m+': 0
  };
  
  times.forEach(time => {
    if (time <= 30) buckets['0-30s']++;
    else if (time <= 60) buckets['30s-1m']++;
    else if (time <= 120) buckets['1-2m']++;
    else if (time <= 300) buckets['2-5m']++;
    else if (time <= 600) buckets['5-10m']++;
    else if (time <= 1200) buckets['10-20m']++;
    else if (time <= 1800) buckets['20-30m']++;
    else buckets['30m+']++;
  });
  
  return buckets;
}

function groupResponsesByDay(responses, groupBy) {
  const grouped = {};
  
  responses.forEach(response => {
    const date = new Date(response.createdAt);
    let key;
    
    if (groupBy === 'hour') {
      key = `${date.toISOString().split('T')[0]} ${date.getHours()}:00`;
    } else if (groupBy === 'week') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().split('T')[0];
    } else {
      key = date.toISOString().split('T')[0];
    }
    
    if (!grouped[key]) {
      grouped[key] = {
        date: key,
        count: 0,
        totalTime: 0,
        averageTime: 0,
        responses: []
      };
    }
    
    const timeSpent = response.submissionMetadata?.timeSpent || 0;
    grouped[key].count++;
    grouped[key].totalTime += timeSpent;
    grouped[key].responses.push(timeSpent);
  });
  
  // Calculate averages
  Object.values(grouped).forEach(day => {
    day.averageTime = day.count > 0 ? Math.round(day.totalTime / day.count) : 0;
    day.averageTimeFormatted = formatTimeDuration(day.averageTime);
    delete day.responses;
  });
  
  return Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function groupResponsesByHour(responses) {
  const hourly = {};
  
  for (let i = 0; i < 24; i++) {
    hourly[i] = { hour: i, count: 0, totalTime: 0, averageTime: 0 };
  }
  
  responses.forEach(response => {
    const hour = new Date(response.createdAt).getHours();
    const timeSpent = response.submissionMetadata?.timeSpent || 0;
    
    hourly[hour].count++;
    hourly[hour].totalTime += timeSpent;
  });
  
  // Calculate averages
  Object.values(hourly).forEach(h => {
    h.averageTime = h.count > 0 ? Math.round(h.totalTime / h.count) : 0;
    h.averageTimeFormatted = formatTimeDuration(h.averageTime);
  });
  
  return Object.values(hourly);
}