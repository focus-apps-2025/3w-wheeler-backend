import mongoose from 'mongoose';
import Form from '../models/Form.js';
import Response from '../models/Response.js';
import User from '../models/User.js';

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

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.json(exportData);

  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};