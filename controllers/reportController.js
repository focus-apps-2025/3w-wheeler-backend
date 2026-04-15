import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { processAttendanceForReport, generateAttendanceExcel } from '../services/reportService.js';

/**
 * Generate attendance report with filters
 */
export const getAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate, inspectorId, status, shiftId } = req.query;
    const tenantId = req.user.tenantId;

    console.log('getAttendanceReport - tenantId:', tenantId);
    console.log('getAttendanceReport - startDate:', startDate, 'endDate:', endDate);

    // 1. Build Query
    const query = { tenantId };
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
      console.log('getAttendanceReport - date query:', query.date);
    }

    if (inspectorId) query.inspector = inspectorId;
    if (status) query.status = status;
    if (shiftId) query.shift = shiftId;

    console.log('getAttendanceReport - full query:', query);

    // 2. Fetch Data
    const logs = await Attendance.find(query)
      .populate('inspector', 'firstName lastName username email')
      .populate('shift', 'name displayName startTime endTime')
      .sort({ date: -1 });

    console.log('getAttendanceReport - found logs:', logs.length);

    const inspectors = await User.find({ tenantId, role: 'inspector', isActive: true });
    console.log('getAttendanceReport - inspectors:', inspectors.length);

    // 3. Process Report
    const diffTime = Math.abs(new Date(endDate) - new Date(startDate));
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    console.log('getAttendanceReport - totalDays:', totalDays);

    const reportData = processAttendanceForReport(logs, inspectors, totalDays);
    console.log('getAttendanceReport - reportData:', JSON.stringify(reportData).substring(0, 500));

    res.json({ success: true, data: reportData });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Export attendance report to Excel
 */
export const exportAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate, inspectorId, status, shiftId } = req.query;
    const tenantId = req.user.tenantId;

    // 1. Fetch Tenant info
    const tenant = await Tenant.findById(tenantId);
    
    // 2. Build Query & Fetch Logs
    const query = { tenantId };
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
      console.log('getAttendanceReport - date query:', query.date);
    }
    if (inspectorId) query.inspector = inspectorId;
    if (status) query.status = status;
    if (shiftId) query.shift = shiftId;

    const logs = await Attendance.find(query)
      .populate('inspector', 'firstName lastName username email')
      .populate('shift', 'name displayName startTime endTime')
      .sort({ date: -1 });

    const inspectors = await User.find({ tenantId, role: 'inspector', isActive: true });

    // 3. Process Data
    const diffTime = Math.abs(new Date(endDate) - new Date(startDate));
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const reportData = processAttendanceForReport(logs, inspectors, totalDays);

    // 4. Generate Excel
    const buffer = generateAttendanceExcel(reportData, {
      tenantName: tenant.companyName || tenant.name,
      startDate,
      endDate,
      summary: reportData.summary
    });

    // 5. Send File
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate}_${endDate}.xlsx`);
    res.send(buffer);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get tenant-wide statistics for dashboard
 */
export const getTenantStats = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logsToday = await Attendance.find({
      tenantId,
      date: { $gte: today }
    });

    const totalInspectors = await User.countDocuments({
      tenantId,
      role: 'inspector',
      isActive: true
    });

    const stats = {
      totalInspectors,
      present: logsToday.length,
      absent: Math.max(0, totalInspectors - logsToday.length),
      late: logsToday.filter(l => l.status === 'late').length,
      halfDay: logsToday.filter(l => l.status === 'half-day').length
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
