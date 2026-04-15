import Shift from '../models/Shift.js';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';

/**
 * Create a new shift
 */
export const createShift = async (req, res) => {
  try {
    const { name, displayName, startTime, endTime, gracePeriod, lateMarkingAfter, halfDayMarkingAfter, assignedInspectors, isNightShift } = req.body;
    const tenantId = req.user.tenantId;

    // Validate duplicate name
    const existingShift = await Shift.findOne({ tenantId, name });
    if (existingShift) {
      return res.status(400).json({ success: false, message: 'Shift name already exists' });
    }

    const shift = await Shift.create({
      name,
      displayName,
      startTime,
      endTime,
      gracePeriod,
      lateMarkingAfter,
      halfDayMarkingAfter,
      assignedInspectors: assignedInspectors || [],
      isNightShift: isNightShift || false,
      tenantId,
      createdBy: req.user._id
    });

    res.status(201).json({ success: true, data: shift });
  } catch (error) {
    console.error('Create shift error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get all shifts for a tenant
 */
export const getShifts = async (req, res) => {
  try {
    const shifts = await Shift.find({ tenantId: req.user.tenantId, isActive: true })
      .populate('assignedInspectors', 'firstName lastName username email');
    res.json({ success: true, data: shifts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update a shift
 */
export const updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const tenantId = req.user.tenantId;

    const shift = await Shift.findOne({ _id: id, tenantId });
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    // If timing changed, we might need special handling
    const timingChanged = 
      (updateData.startTime && updateData.startTime !== shift.startTime) || 
      (updateData.endTime && updateData.endTime !== shift.endTime);

    Object.assign(shift, updateData);
    await shift.save();

    // If timing changed, the plan says reset all attendance records for this shift
    if (timingChanged) {
      // NOTE: This is a destructive operation as per plan Phase 2.2
      await Attendance.updateMany(
        { shift: id, tenantId },
        { 
          status: 'absent',
          checkInTime: null,
          checkOutTime: null,
          workingHours: 0,
          isLate: false,
          isHalfDay: false
        }
      );
    }

    res.json({ success: true, data: shift });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a shift (Soft delete)
 */
export const deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;

    const shift = await Shift.findOne({ _id: id, tenantId });
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    // Check if attendance records exist
    const attendanceExists = await Attendance.exists({ shift: id, tenantId });
    if (attendanceExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete shift with existing attendance records' 
      });
    }

    shift.isActive = false;
    await shift.save();

    res.json({ success: true, message: 'Shift deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Assign inspectors to shift
 */
export const assignInspectors = async (req, res) => {
  try {
    const { id } = req.params;
    const { inspectorIds } = req.body; // Array of user IDs
    const tenantId = req.user.tenantId;

    const shift = await Shift.findOne({ _id: id, tenantId });
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    // Validate inspectors exist and belong to tenant
    const users = await User.find({ _id: { $in: inspectorIds }, tenantId, role: 'inspector' });
    if (users.length !== inspectorIds.length) {
      return res.status(400).json({ success: false, message: 'Invalid inspectors selected' });
    }

    // Merge without duplicates
    const currentAssignments = shift.assignedInspectors.map(id => id.toString());
    const newAssignments = [...new Set([...currentAssignments, ...inspectorIds])];
    
    shift.assignedInspectors = newAssignments;
    await shift.save();

    res.json({ success: true, data: shift });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Remove inspectors from shift
 */
export const removeInspectors = async (req, res) => {
  try {
    const { id } = req.params;
    const { inspectorIds } = req.body;
    const tenantId = req.user.tenantId;

    const shift = await Shift.findOne({ _id: id, tenantId });
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    shift.assignedInspectors = shift.assignedInspectors.filter(
      insId => !inspectorIds.includes(insId.toString())
    );
    
    await shift.save();
    res.json({ success: true, data: shift });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get available (unassigned) inspectors for the tenant
 */
export const getAvailableInspectors = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    // Get all assigned inspector IDs from ALL shifts in this tenant
    const shifts = await Shift.find({ tenantId, isActive: true });
    const assignedIds = shifts.reduce((acc, s) => {
      return acc.concat(s.assignedInspectors.map(id => id.toString()));
    }, []);

    const unassignedInspectors = await User.find({
      tenantId,
      role: 'inspector',
      isActive: true,
      _id: { $nin: assignedIds }
    }).select('firstName lastName username email');

    res.json({ success: true, data: unassignedInspectors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get inspector's assigned shift
 */
export const getMyShift = async (req, res) => {
  try {
    const shift = await Shift.findOne({
      tenantId: req.user.tenantId,
      assignedInspectors: req.user._id,
      isActive: true
    });

    res.json({ success: true, data: shift });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
