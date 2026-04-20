import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

/**
 * Generate Excel report for attendance
 * @param {Array} data - Processed attendance data
 * @param {Object} options - { tenantName, startDate, endDate }
 * @returns {Buffer} - Excel file buffer
 */
export const generateAttendanceExcel = (data, options) => {
  const { tenantName, startDate, endDate } = options;

  // 1. Create workbook
  const wb = XLSX.utils.book_new();

  // 2. Summary Sheet
  const summaryData = [
    ['Attendance Summary Report'],
    ['Tenant:', tenantName],
    ['Period:', `${startDate} to ${endDate}`],
    ['Generated Date:', new Date().toLocaleString()],
    [],
    ['Total Working Days', options.summary.totalWorkingDays],
    ['Total Present Days', options.summary.totalPresentDays],
    ['Total Absent Days', options.summary.totalAbsentDays],
    ['Total Late Arrivals', options.summary.totalLateArrivals],
    ['Avg Attendance Rate (%)', options.summary.avgAttendanceRate + '%']
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // 3. Inspector-wise Statistics Sheet
  const inspectorStatsData = [
    ['Inspector Name', 'Present Days', 'Late Days', 'Half-days', 'Absent Days', 'Total Working Hours', 'Attendance Rate (%)']
  ];
  
  data.inspectorStats.forEach(stat => {
    inspectorStatsData.push([
      stat.name,
      stat.present,
      stat.late,
      stat.halfDay,
      stat.absent,
      stat.totalHours,
      stat.rate
    ]);
  });
  const statsWs = XLSX.utils.aoa_to_sheet(inspectorStatsData);
  XLSX.utils.book_append_sheet(wb, statsWs, 'Inspector Statistics');

  // 4. Detailed Daily Log Sheet
  const detailedLogData = [
    ['Date', 'Inspector', 'Shift', 'Check-in', 'Check-out', 'Hours', 'Status', 'Location']
  ];

  data.detailedLogs.forEach(log => {
    detailedLogData.push([
      log.date,
      log.inspector,
      log.shift,
      log.checkIn || '-',
      log.checkOut || '-',
      log.hours,
      log.status,
      log.location || '-'
    ]);
  });
  const logsWs = XLSX.utils.aoa_to_sheet(detailedLogData);
  XLSX.utils.book_append_sheet(wb, logsWs, 'Daily Logs');

  // 5. Generate Buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
};

/**
 * Process attendance logs into statistics for reporting
 * @param {Array} logs - Raw attendance logs
 * @param {Array} inspectors - List of inspectors in the tenant
 * @param {number} totalDays - Total days in period
 */
export const processAttendanceForReport = (logs, inspectors, totalDays) => {
  const inspectorMap = new Map();
  
  // Initialize map for all inspectors
  inspectors.forEach(ins => {
    inspectorMap.set(ins._id.toString(), {
      name: `${ins.firstName} ${ins.lastName}`,
      present: 0,
      late: 0,
      halfDay: 0,
      absent: 0,
      totalHours: 0,
      logs: []
    });
  });

  // Track present logs
  logs.forEach(log => {
    const insId = log.inspector._id.toString();
    const stats = inspectorMap.get(insId);
    if (!stats) return;

    if (log.status === 'present') stats.present++;
    else if (log.status === 'late') stats.late++;
    else if (log.status === 'half-day') stats.halfDay++;
    
    stats.totalHours += log.workingHours;
    stats.logs.push(log);
  });

  // Calculate absent days for each inspector
  inspectorMap.forEach(stats => {
    const recordedDays = stats.present + stats.late + stats.halfDay;
    stats.absent = Math.max(0, totalDays - recordedDays);
  });

  // Format statistics
  const inspectorStats = Array.from(inspectorMap.values()).map(s => ({
    name: s.name,
    present: s.present,
    late: s.late,
    halfDay: s.halfDay,
    absent: s.absent,
    totalHours: Math.round(s.totalHours * 100) / 100,
    rate: totalDays > 0 ? Math.round(((s.present + s.late + s.halfDay) / totalDays) * 100) : 0
  }));

  // Format detailed logs
  const detailedLogs = logs.map(log => {
    // Format date as local date string (YYYY-MM-DD) - subtract timezone offset to convert UTC to local
    const localDate = new Date(log.date.getTime() - log.date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    
    // Get tenant info if available
    const tenantName = log.tenantId?.companyName || log.tenantId?.name || null;
    
    return {
      date: localDate,
      inspector: `${log.inspector.firstName} ${log.inspector.lastName}`,
      inspectorId: log.inspector._id,
      tenant: tenantName,
      shift: log.shift.displayName || log.shift.name,
      checkIn: log.checkInTime ? new Date(log.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : null,
      checkOut: log.checkOutTime ? new Date(log.checkOutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : null,
      hours: log.workingHours,
      status: log.status,
      location: log.checkInPlace || log.checkOutPlace
    };
  });

  // Overall summary
  const summary = {
    totalWorkingDays: totalDays,
    totalPresentDays: inspectorStats.reduce((sum, s) => sum + s.present, 0),
    totalAbsentDays: inspectorStats.reduce((sum, s) => sum + s.absent, 0),
    totalLateArrivals: inspectorStats.reduce((sum, s) => sum + s.late, 0),
    avgAttendanceRate: inspectorStats.length > 0 
      ? Math.round(inspectorStats.reduce((sum, s) => sum + s.rate, 0) / inspectorStats.length)
      : 0
  };

  return { summary, inspectorStats, detailedLogs };
};
