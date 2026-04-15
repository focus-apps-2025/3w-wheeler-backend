import Attendance from '../models/Attendance.js';
import Shift from '../models/Shift.js';
import { reverseGeocode } from '../utils/geocode.js';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

// Helper to get current date in IST (UTC+5:30)
const getISTDate = () => {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
};

// Helper to get today's date in IST as UTC Date for MongoDB storage
const getISTToday = () => {
  const ist = getISTDate();
  // Create UTC date from IST date components to avoid timezone conversion
  const year = ist.getFullYear();
  const month = ist.getMonth();
  const date = ist.getDate();
  return new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
};

/**
 * Check-in process for inspectors (HRM Logic)
 */
export const checkIn = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;
    const inspectorId = req.user._id;
    const tenantId = req.user.tenantId;

    // 2. Check for existing attendance today
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let existingAttendance = await Attendance.findOne({
      inspector: inspectorId,
      date: { $gte: today }
    });

    if (existingAttendance && existingAttendance.checkInTime) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    // 3. Validate timing against shift
    const currentTimeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    const timeToMins = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const currentMins = timeToMins(currentTimeStr);
    const shiftStartMins = timeToMins(shift.startTime);
    
    let status = 'present';
    let isLate = false;
    let isHalfDay = false;

    const diff = currentMins - shiftStartMins;

    if (diff < -shift.gracePeriod && !shift.isNightShift) {
       return res.status(400).json({ success: false, message: 'Too early to check-in' });
    } else if (diff <= shift.gracePeriod) {
       status = 'present';
    } else if (diff <= shift.lateMarkingAfter) {
       status = 'late';
       isLate = true;
    } else if (diff <= shift.halfDayMarkingAfter) {
       status = 'half-day';
       isHalfDay = true;
    } else if (!shift.isNightShift) {
       return res.status(400).json({ success: false, message: 'Check-in window closed' });
    }

    const place = await reverseGeocode(lat, lng);

    const attendanceData = {
      inspector: inspectorId,
      tenantId,
      shift: shift._id,
      date: today,
      checkInTime: now,
      checkInLat: lat,
      checkInLng: lng,
      checkInPlace: place || 'Position Captured',
      checkInAccuracy: accuracy,
      status,
      isLate,
      isHalfDay
    };

    console.log('checkIn - creating attendance:', attendanceData);

    if (existingAttendance) {
       Object.assign(existingAttendance, attendanceData);
       await existingAttendance.save();
       console.log('checkIn - updated existing attendance:', existingAttendance);
    } else {
       existingAttendance = await Attendance.create(attendanceData);
       console.log('checkIn - created new attendance:', existingAttendance);
    }

    res.status(201).json({ success: true, data: existingAttendance });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Check-out process for inspectors (HRM Logic)
 */
export const checkOut = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;
    const inspectorId = req.user._id;
    const tenantId = req.user.tenantId;
    const now = getISTDate();
    const today = getISTToday();

    const attendance = await Attendance.findOne({
      inspector: inspectorId,
      date: { $gte: today },
      checkInTime: { $exists: true },
      checkOutTime: null
    }).populate('shift');

    if (!attendance) {
      return res.status(400).json({ success: false, message: 'No active check-in found for today' });
    }

    const place = await reverseGeocode(lat, lng);

    attendance.checkOutTime = new Date();
    attendance.checkOutLat = lat;
    attendance.checkOutLng = lng;
    attendance.checkOutPlace = place || 'Position Captured';
    attendance.checkOutAccuracy = accuracy;

    const shiftEndStr = attendance.shift.endTime;
    const currentTimeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    
    const timeToMins = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    if (timeToMins(currentTimeStr) < timeToMins(shiftEndStr) && !attendance.shift.isNightShift) {
      attendance.isEarlyCheckout = true;
    }

    await attendance.save();

    if (attendance.workingHours < 4) {
      attendance.status = 'half-day';
      attendance.isHalfDay = true;
      await attendance.save();
    }

    res.json({ success: true, data: attendance });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get today's status for the inspector
 */
export const getMyStatus = async (req, res) => {
  try {
    const inspectorId = req.user._id;
    const tenantId = req.user.tenantId;

    console.log('getMyStatus - inspectorId:', inspectorId, 'tenantId:', tenantId);

    // First check if there's any shift with this inspector in assignedInspectors
    const allShifts = await Shift.find({ tenantId, isActive: true });
    console.log('getMyStatus - all shifts:', allShifts.map(s => ({
      _id: s._id,
      name: s.name,
      assignedInspectors: s.assignedInspectors,
      inspectorIdType: typeof inspectorId
    })));

    const shift = await Shift.findOne({
      tenantId,
      assignedInspectors: inspectorId,
      isActive: true
    });

    console.log('getMyStatus - found shift:', shift);

    const today = getISTToday();

    const attendance = await Attendance.findOne({
      inspector: inspectorId,
      date: { $gte: today }
    });

    let canCheckIn = !!shift && !attendance?.checkInTime;
    let canCheckOut = !!attendance && !!attendance.checkInTime && !attendance.checkOutTime;

    res.json({
      success: true,
      data: {
        shift,
        attendance,
        canCheckIn,
        canCheckOut
      }
    });
  } catch (error) {
    console.error('getMyStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get personal attendance history (Renamed to fulfill getMyHistory requests)
 */
export const getMyHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const history = await Attendance.find({ inspector: req.user._id })
      .populate('shift', 'name displayName startTime endTime')
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Attendance.countDocuments({ inspector: req.user._id });

    res.json({
      success: true,
      data: {
        history,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Legacy Compatibility: getMyAttendance (requested by attendanceRoutes.js)
 */
export const getMyAttendance = getMyHistory;

/**
 * Legacy Compatibility: Export attendance report (requested by attendanceRoutes.js)
 */
export const exportAttendance = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const tenantId = req.user.tenantId;

    const query = { tenantId };
    if (startDate && endDate) {
      query.date = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    const logs = await Attendance.find(query)
      .populate('inspector', 'firstName lastName email')
      .populate('shift', 'name displayName startTime endTime')
      .sort({ date: 1 });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(logs.map(att => ({
      Date: att.date.toISOString().split('T')[0],
      Inspector: `${att.inspector?.firstName || ''} ${att.inspector?.lastName || ''}`,
      Email: att.inspector?.email || 'N/A',
      Shift: att.shift?.displayName || 'N/A',
      CheckIn: att.checkInTime ? att.checkInTime.toLocaleTimeString() : 'N/A',
      CheckOut: att.checkOutTime ? att.checkOutTime.toLocaleTimeString() : 'N/A',
      WorkingHours: att.workingHours,
      Status: att.status,
      Late: att.isLate ? 'Yes' : 'No'
    })));

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Legacy Compatibility: getAttendance (requested by attendanceRoutes.js)
 */
export const getAttendance = async (req, res) => {
  try {
    const { startDate, endDate, inspectorId, status } = req.query;
    const tenantId = req.user.tenantId;

    console.log('getAttendance - startDate:', startDate, 'endDate:', endDate, 'tenantId:', tenantId);

    const query = { tenantId };

    // Always include a date range for current month as fallback (IST)
    const istNow = getISTDate();
    let start = startDate ? new Date(startDate) : new Date(istNow.getFullYear(), istNow.getMonth(), 1);
    let end = endDate ? new Date(endDate) : new Date(istNow.getFullYear(), istNow.getMonth() + 1, 0);
    
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    query.date = { $gte: start, $lte: end };
    
    console.log('getAttendance - date range:', start, 'to', end);
    console.log('getAttendance - full query:', JSON.stringify(query));

    const logs = await Attendance.find(query)
      .populate('inspector', 'firstName lastName username email')
      .populate('shift', 'name displayName')
      .sort({ date: -1 });

    console.log('getAttendance - found logs:', logs.length);
    if (logs.length > 0) {
      console.log('getAttendance - first log date:', logs[0].date);
      console.log('getAttendance - first log inspector:', logs[0].inspector);
    }

    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Legacy Compatibility: getAttendanceSummary (requested by attendanceRoutes.js)
 */
export const getAttendanceSummary = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const query = { tenantId: req.user.tenantId, date: { $gte: today } };

    const [totalUsers, present, late, halfDay] = await Promise.all([
      Attendance.countDocuments({ tenantId: req.user.tenantId, date: { $gte: today } }), // Approximation
      Attendance.countDocuments({ ...query, status: 'present' }),
      Attendance.countDocuments({ ...query, status: 'late' }),
      Attendance.countDocuments({ ...query, status: 'half-day' })
    ]);

    res.json({
      success: true,
      data: { totalUsers, present, late, halfDay, absent: totalUsers - present }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Legacy Compatibility: getAttendanceUsers (requested by attendanceRoutes.js)
 */
export const getAttendanceUsers = async (req, res) => {
  try {
    const logs = await Attendance.find({ tenantId: req.user.tenantId })
      .populate('inspector', 'firstName lastName email')
      .sort({ date: -1 });
    res.json({ success: true, users: logs }); // Old logic returned logs here
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Heartbeat (requested by attendanceRoutes.js)
 */
export const updateLastActive = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attendance = await Attendance.findOne({ 
      inspector: req.user._id, 
      date: { $gte: today }, 
      checkOutTime: null 
    });
    
    if (attendance) {
      await attendance.save(); // Just trigger timestamps update or implement lastActive field
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Login Location (requested by attendanceRoutes.js)
 */
export const updateLoginLocation = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attendance = await Attendance.findOne({ 
      inspector: req.user._id, 
      date: { $gte: today }, 
      checkOutTime: null 
    });

    if (attendance) {
      attendance.checkInLat = lat;
      attendance.checkInLng = lng;
      attendance.checkInAccuracy = accuracy;
      await attendance.save();
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};