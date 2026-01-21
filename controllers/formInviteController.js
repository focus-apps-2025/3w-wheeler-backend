import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import Form from '../models/Form.js';
import FormInvite from '../models/FormInvite.js';
import Tenant from '../models/Tenant.js';
import { v4 as uuidv4 } from 'uuid';

// Helper: Validate email format
// Helper: Validate email format (supports Outlook, Gmail, corporate emails)
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  
  const trimmedEmail = email.trim().toLowerCase();
  
  // Basic format check
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  // Additional checks for common issues
  if (!emailRegex.test(trimmedEmail)) return false;
  
  // Check for consecutive dots
  if (trimmedEmail.includes('..')) return false;
  
  // Check for spaces
  if (trimmedEmail.includes(' ')) return false;
  
  // Split email into local and domain parts
  const parts = trimmedEmail.split('@');
  if (parts.length !== 2) return false;
  
  const [localPart, domainPart] = parts;
  
  // Local part validation
  if (localPart.length === 0 || localPart.length > 64) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  
  // Domain part validation
  if (domainPart.length === 0 || domainPart.length > 255) return false;
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return false;
  
  // Check for valid domain format
  const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!domainRegex.test(domainPart)) return false;
  
  return true;
};


// Helper: Validate phone format (basic)
const isValidPhone = (phone) => {
  if (!phone || phone.trim() === '') {
    return true; // Phone is optional, empty is OK
  }
  
  const phoneStr = phone.toString().trim();
  
  // Remove all non-digit characters (keep + for international)
  const digitsOnly = phoneStr.replace(/[^\d+]/g, '');
  
  // If it starts with +, it's international
  if (phoneStr.startsWith('+')) {
    // International number: + followed by 10-15 digits
    const withoutPlus = phoneStr.substring(1);
    const digitCount = withoutPlus.replace(/\D/g, '').length;
    return digitCount >= 10 && digitCount <= 15;
  }
  
  // Local number: accept 7-15 digits (most countries)
  const digitCount = digitsOnly.length;
  return digitCount >= 7 && digitCount <= 15;
};

// Helper: Parse Excel file
// Helper: Parse Excel file
const parseExcelFile = (buffer) => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with proper headers
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length < 2) {
      throw new Error('Excel file must have at least one data row');
    }
    
    // Get headers (first row)
    const headers = data[0].map(h => h ? h.toString().toLowerCase().trim() : '');
    
    console.log('Excel headers found:', headers);
    
    // Find email and phone columns (more flexible matching)
    const emailIndex = headers.findIndex(h => {
      const header = h.toLowerCase();
      return header.includes('email') || 
             header.includes('e-mail') || 
             header.includes('mail') ||
             header.includes('email address') ||
             header.includes('email id') ||
             header === 'email';
    });
    
    const phoneIndex = headers.findIndex(h => {
      const header = h.toLowerCase();
      return header.includes('phone') || 
             header.includes('mobile') || 
             header.includes('contact') ||
             header.includes('phone number') ||
             header.includes('telephone') ||
             header === 'phone' || header === 'mobile';
    });
    
    console.log(`Email column index: ${emailIndex}, Phone column index: ${phoneIndex}`);
    
    if (emailIndex === -1) {
      throw new Error('Excel must contain an "Email" column (could be named: Email, E-mail, Mail, Email Address)');
    }
    
    // Extract emails and phones with better cleaning
    const records = [];
    const seenEmails = new Set();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      // Extract email with better cleaning
      let email = '';
      if (row[emailIndex] !== undefined && row[emailIndex] !== null) {
        email = row[emailIndex].toString().trim();
        // Remove any whitespace, quotes, or brackets
        email = email.replace(/["'\[\]()]/g, '');
      }
      
      // Extract phone with cleaning
      let phone = '';
      if (phoneIndex !== -1 && row[phoneIndex] !== undefined && row[phoneIndex] !== null) {
        phone = row[phoneIndex].toString().trim();
        // Remove any non-numeric characters except + for international numbers
        phone = phone.replace(/[^\d\+]/g, '');
      }
      
      // Only add if we have a valid-looking email
      if (email) {
        const cleanEmail = email.toLowerCase();
        
        if (!seenEmails.has(cleanEmail)) {
          seenEmails.add(cleanEmail);
          records.push({
            email: cleanEmail,
            phone,
            originalEmail: email // Keep original for debugging
          });
        }
      }
    }
    
    console.log(`Parsed ${records.length} unique email records from Excel`);
    
    return records;
  } catch (error) {
    throw new Error(`Failed to parse Excel file: ${error.message}`);
  }
};

// 1. UPLOAD EXCEL + PREVIEW
export const uploadInvites = async (req, res) => {
  try {
    const { formId } = req.params;
    
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No Excel file provided'
      });
    }
    
    // Find form
    const form = await Form.findOne({ id: formId });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }
    
    // Check permissions
    if (req.user.role !== 'superadmin' && 
        form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Parse Excel
    const records = parseExcelFile(req.file.buffer);
    
    // Validate emails and remove duplicates
  const seenEmails = new Set();
const validRecords = [];
const invalidRecords = [];

console.log('=== EMAIL VALIDATION DEBUG ==='); // Add this
records.forEach(record => {
  const email = record.email.toLowerCase().trim();
  const originalEmail = record.originalEmail || email;
  
  console.log(`Processing email: ${email}`); // Debug
  
  if (!seenEmails.has(email)) {
    seenEmails.add(email);
    
    const emailValid = isValidEmail(email);
    const phoneValid = isValidPhone(record.phone);
    
    console.log(`Email validation result for ${email}: ${emailValid}`); // Debug
    console.log(`Phone validation result: ${phoneValid}`); // Debug
    
    if (emailValid && phoneValid) {
      validRecords.push({
        email,
        originalEmail,
        phone: record.phone || '',
        status: 'valid'
      });
      console.log(`✅ Email ${email} marked as VALID`); // Debug
    } else {
      const issues = [];
      if (!emailValid) {
        // More detailed email validation
        if (!email.includes('@')) {
          issues.push('Missing @ symbol');
        } else if (email.split('@')[0].length === 0) {
          issues.push('Missing local part (before @)');
        } else if (email.split('@')[1].length === 0) {
          issues.push('Missing domain part (after @)');
        } else {
          issues.push('Invalid email format');
        }
      }
      if (!phoneValid && record.phone) {
        issues.push('Invalid phone format');
      }
      
      invalidRecords.push({
        email: originalEmail,
        phone: record.phone || '',
        issues
      });
      console.log(`❌ Email ${email} marked as INVALID. Issues: ${issues.join(', ')}`); // Debug
    }
  }
});

console.log(`=== VALIDATION SUMMARY ===`);
console.log(`Total records: ${records.length}`);
console.log(`Valid emails: ${validRecords.length}`);
console.log(`Invalid emails: ${invalidRecords.length}`);
console.log(`Valid records:`, validRecords); // Show valid emails
console.log(`Invalid records:`, invalidRecords); 
    
    // Check existing invites
    const existingEmails = await FormInvite.find({
      formId,
      email: { $in: validRecords.map(r => r.email) }
    }).select('email status');
    
    const existingMap = new Map();
    existingEmails.forEach(invite => {
      existingMap.set(invite.email, invite.status);
    });
    
    // Add existing status to preview
    const preview = validRecords.map(record => ({
      ...record,
      existingStatus: existingMap.get(record.email) || null
    }));
    
    // Get tenant slug for link generation
    const tenant = await Tenant.findById(form.tenantId);
    const tenantSlug = tenant?.slug || 'public';
    
    res.json({
      success: true,
      message: 'Excel processed successfully',
      data: {
        totalRecords: records.length,
        valid: validRecords.length,
        invalid: invalidRecords.length,
        duplicateEmails: records.length - seenEmails.size,
        preview: preview.slice(0, 10), // First 10 for preview
        sampleLink: `https://forms.focusengineeringapp.com/${tenantSlug}/forms/${formId}?inviteId=SAMPLE_INVITE_ID`,
        form: {
          id: form.id,
          title: form.title,
          inviteOnlyTracking: form.inviteOnlyTracking || false
        }
      }
    });
    
  } catch (error) {
    console.error('Upload invites error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process Excel file'
    });
  }
};

// 2. SEND INVITES (SendGrid integration placeholder)
export const sendInvites = async (req, res) => {
  try {
    const { formId } = req.params;
    const { emails } = req.body; // Array of emails from frontend
    
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Emails array is required'
      });
    }
    
    // Find form
    const form = await Form.findOne({ id: formId });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }
    
    // Check if invite tracking is enabled
    if (!form.inviteOnlyTracking) {
      return res.status(400).json({
        success: false,
        message: 'Invite tracking is not enabled for this form'
      });
    }
    
    // Get tenant for slug
    const tenant = await Tenant.findById(form.tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }
    
    // Process each email
    const results = [];
    const failed = [];
    
    for (const emailData of emails) {
      try {
        const email = emailData.email.toLowerCase().trim();
        
        // Check existing invite
        const existingInvite = await FormInvite.findOne({
          formId,
          email
        });
        
        if (existingInvite) {
          if (existingInvite.status === 'responded') {
            failed.push({
              email,
              reason: 'Already responded, cannot resend'
            });
            continue;
          }
          
          // Resend existing invite
          const emailResult = await sendInviteEmail({
            email,
            inviteId: existingInvite.inviteId,
            formId,
            formTitle: form.title,
            tenantSlug: tenant.slug
          });

          if (!emailResult.success) {
            failed.push({
              email,
              reason: emailResult.error || 'Email sending failed'
            });
            continue;
          }
          
          // Update sentAt
          existingInvite.sentAt = new Date();
          await existingInvite.save();
          
          results.push({
            email,
            action: 'resent',
            inviteId: existingInvite.inviteId
          });
          
        } else {
          // Create new invite
          const inviteId = uuidv4();
          
          const newInvite = new FormInvite({
            formId,
            tenantId: form.tenantId,
            email,
            phone: emailData.phone || '',
            inviteId,
            status: 'sent',
            createdBy: req.user._id
          });
          
          // Send email first
          const emailResult = await sendInviteEmail({
            email,
            inviteId,
            formId,
            formTitle: form.title,
            tenantSlug: tenant.slug
          });

          if (!emailResult.success) {
            failed.push({
              email,
              reason: emailResult.error || 'Email sending failed'
            });
            continue;
          }

          await newInvite.save();
          
          results.push({
            email,
            action: 'sent',
            inviteId
          });
        }
        
      } catch (error) {
        console.error(`Failed to process ${emailData.email}:`, error);
        failed.push({
          email: emailData.email,
          reason: error.message || 'Processing failed'
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Invites processed',
      data: {
        total: emails.length,
        successful: results.length,
        failed: failed.length,
        results,
        failures: failed
      }
    });
    
  } catch (error) {
    console.error('Send invites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send invites'
    });
  }
};

// 3. GET INVITE STATS
export const getInviteStats = async (req, res) => {
  try {
    const { formId } = req.params;
    
    // Find form
    const form = await Form.findOne({ id: formId });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }
    
    // Check permissions
    if (req.user.role !== 'superadmin' && 
        form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Get invite statistics
    const stats = await FormInvite.aggregate([
      { $match: { formId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Convert to object
    const statusCounts = {
      sent: 0,
      responded: 0,
      expired: 0
    };
    
    stats.forEach(stat => {
      statusCounts[stat._id] = stat.count;
    });
    
    // Get total invites
    const totalInvites = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    
    // Get response count for this form (from Response model)
    const Response = mongoose.model('Response');
    const totalResponses = await Response.countDocuments({ formId });
    const invitedResponses = await Response.countDocuments({ 
      formId, 
      inviteId: { $ne: null } 
    });
    const publicResponses = totalResponses - invitedResponses;
    
    res.json({
      success: true,
      data: {
        form: {
          id: form.id,
          title: form.title,
          inviteOnlyTracking: form.inviteOnlyTracking || false
        },
        invites: {
          total: totalInvites,
          sent: statusCounts.sent,
          responded: statusCounts.responded,
          expired: statusCounts.expired,
          responseRate: totalInvites > 0 ? 
            Math.round((statusCounts.responded / totalInvites) * 100) : 0
        },
        responses: {
          total: totalResponses,
          invited: invitedResponses,
          public: publicResponses
        }
      }
    });
    
  } catch (error) {
    console.error('Get invite stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invite statistics'
    });
  }
};

export const getInviteList = async (req, res) => {
  try {
    const { formId } = req.params;
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      dateFilter = 'all',
      startDate,
      endDate,
      sortBy = 'sentAt',
      sortOrder = 'desc'
    } = req.query;
    
    console.log('🔍 getInviteList called with params:', {
      formId,
      page,
      limit,
      search,
      status,
      dateFilter,
      startDate,
      endDate,
      sortBy,
      sortOrder
    });
    
    // Find form
    const form = await Form.findOne({ id: formId });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }
    
    // Check permissions
    if (req.user.role !== 'superadmin' && 
        form.tenantId.toString() !== req.user.tenantId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Build query
    const query = { formId };
    
    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // Apply search filter
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { email: searchRegex },
        { phone: { $regex: searchRegex } }
      ];
    }
    
    // Apply date filter
    if (dateFilter !== 'all' && (startDate || endDate)) {
      const dateField = dateFilter === 'respondedAt' ? 'respondedAt' : 'sentAt';
      const dateQuery = {};
      
      if (startDate) {
        dateQuery.$gte = new Date(startDate);
      }
      if (endDate) {
        // Add time to end date to include the entire day
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        dateQuery.$lte = endDateObj;
      }
      
      // Only add if we have valid dates
      if (Object.keys(dateQuery).length > 0) {
        query[dateField] = dateQuery;
      }
    }
     // MODIFIED: Apply date filter with status consideration
/*if (dateFilter !== 'all' && (startDate || endDate)) {
  const dateField = dateFilter === 'respondedAt' ? 'respondedAt' : 'sentAt';
  const dateQuery = {};
  
  if (startDate) {
    dateQuery.$gte = new Date(startDate);
  }
  if (endDate) {
    const endDateObj = new Date(endDate);
    endDateObj.setHours(23, 59, 59, 999);
    dateQuery.$lte = endDateObj;
  }
  
  // Only add if we have valid dates
  if (Object.keys(dateQuery).length > 0) {
    query[dateField] = dateQuery;
    
    // 🔥 NEW: If filtering by sentAt, automatically filter to "sent" status
    // unless user explicitly chose another status
    if (dateField === 'sentAt' && status === 'all') {
      query.status = 'sent';
      console.log('📝 Auto-adding status=sent for sentAt date filter');
    }
    
    // 🔥 NEW: If filtering by respondedAt, automatically filter to "responded" status
    if (dateField === 'respondedAt' && status === 'all') {
      query.status = 'responded';
      console.log('📝 Auto-adding status=responded for respondedAt date filter');
    }
  }
}*/


    
    console.log('🔍 MongoDB query:', JSON.stringify(query, null, 2));
    
    // Calculate skip for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort object
    const sortOptions = {};
    if (sortBy === 'email') {
      sortOptions.email = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'status') {
      sortOptions.status = sortOrder === 'asc' ? 1 : -1;
    } else {
      // Default: sort by sentAt
      sortOptions.sentAt = sortOrder === 'asc' ? 1 : -1;
    }
    
    // Get total count (for pagination)
    const totalCount = await FormInvite.countDocuments(query);
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    
    // Get invites with pagination
    const invites = await FormInvite.find(query)
      .select('email phone inviteId status sentAt respondedAt createdAt')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    console.log('🔍 Query results:', {
      totalCount,
      totalPages,
      currentPage: page,
      itemsPerPage: limit,
      returnedCount: invites.length
    });
    
    if (invites.length > 0) {
      console.log('📋 First invite sample:', {
        email: invites[0].email,
        status: invites[0].status,
        sentAt: invites[0].sentAt
      });
    }
    
    res.json({
      success: true,
      data: {
        invites,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          itemsPerPage: parseInt(limit),
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        },
        filters: {
          search: search || '',
          status: status || 'all',
          dateFilter: dateFilter || 'all',
          startDate: startDate || '',
          endDate: endDate || '',
          sortBy,
          sortOrder
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Get invite list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invite list'
    });
  }
};

// Helper: Send email via SendGrid (placeholder - implement your email service)

const sendInviteEmail = async ({ email, inviteId, formId, formTitle, tenantSlug }) => {
  try {
    // Import MailerSend inside the function to avoid issues
    const { MailerSend, EmailParams, Sender, Recipient } = await import('mailersend');
    
    // Initialize MailerSend with API key from environment
    const mailerSend = new MailerSend({
      apiKey: process.env.MAILERSEND_API_KEY,
    });

    // CRITICAL: Sender must be from your verified MailerSend domain
    const sentFrom = new Sender(
      `noreply@test-yxj6lj961504do2r.mlsender.net`,
      'Focus Forms'
    );

    // Create recipient
    const recipients = [
      new Recipient(email, email.split('@')[0])
    ];

    // ✅ Generate BOTH production and localhost links
    const productionLink = `https://forms.focusengineeringapp.com/${tenantSlug}/forms/${formId}?inviteId=${inviteId}`;
    const localhostLink = `http://localhost:3000/${tenantSlug}/forms/${formId}?inviteId=${inviteId}`;
    
    console.log(`📧 Email links for ${email}:`);
    console.log(`   Production: ${productionLink}`);
    console.log(`   Localhost: ${localhostLink}`);

    // ✅ Updated HTML with both links
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">You're Invited to Complete a Form</h2>
        <p>Hello,</p>
        <p>You have been invited to complete the form: <strong>${formTitle}</strong></p>
        
        <div style="background-color: #f8f9fa; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2c3e50;">Form Links:</h3>
          
          <div style="margin-bottom: 15px;">
            <p style="margin: 5px 0; font-weight: bold;">🌐 Production Link (Live):</p>
            <a href="${productionLink}" 
               style="color: #4CAF50; text-decoration: none; background-color: #e8f5e9; padding: 8px 12px; border-radius: 4px; display: inline-block;">
              ${productionLink}
            </a>
          </div>
          
          <div style="margin-bottom: 15px;">
            <p style="margin: 5px 0; font-weight: bold;">💻 Localhost Link (For Testing):</p>
            <a href="${localhostLink}" 
               style="color: #2196F3; text-decoration: none; background-color: #e3f2fd; padding: 8px 12px; border-radius: 4px; display: inline-block;">
              ${localhostLink}
            </a>
            <p style="font-size: 12px; color: #666; margin: 5px 0 0 0;">
              <em>Use this link if you're testing locally (requires local server running)</em>
            </p>
          </div>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${productionLink}" 
             style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
            🚀 Access the Form (Production)
          </a>
        </div>
        
        <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 12px; margin: 20px 0;">
          <p style="margin: 0; color: #856404;">
            <strong>⚠️ Important:</strong> This link is unique to you and can only be used once.
          </p>
        </div>
        
        <p>If you did not expect this invitation, please ignore this email.</p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        
        <div style="font-size: 12px; color: #666;">
          <p>This invitation was sent via Focus Forms System.</p>
          <p>Invite ID: <code>${inviteId}</code></p>
          <p>Form ID: <code>${formId}</code></p>
        </div>
      </div>
    `;

    // Plain text version
    const textContent = `
      You're Invited to Complete: ${formTitle}
      
      🔗 PRODUCTION LINK (Live Site):
      ${productionLink}
      
      💻 LOCALHOST LINK (For Testing):
      ${localhostLink}
      (Use this if you're testing locally - requires local server running)
      
      ⚠️ IMPORTANT: This link is unique to you and can only be used once.
      
      Form Details:
      - Invite ID: ${inviteId}
      - Form ID: ${formId}
      
      If you did not expect this invitation, please ignore this email.
      
      ---
      Sent via Focus Forms System
    `;

    // Create email parameters
    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setSubject(`Invitation: Please complete "${formTitle}"`)
      .setHtml(htmlContent)
      .setText(textContent)
      .setReplyTo(sentFrom);

    // Send the email
    const response = await mailerSend.email.send(emailParams);
    
    console.log(`✅ Email sent to ${email}`);
    console.log(`   Production link: ${productionLink}`);
    console.log(`   Localhost link: ${localhostLink}`);
    
    return { 
      success: true, 
      links: {
        production: productionLink,
        localhost: localhostLink
      },
      messageId: response.headers?.['x-message-id']
    };
    
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error);
    
    let errorMessage = 'Email sending failed';
    const message = error.message || '';
    if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (message.includes('API key')) {
      errorMessage = 'Invalid MailerSend API key. Check your .env file.';
    } else if (message.includes('domain')) {
      errorMessage = 'Sender domain not verified in MailerSend. Use your trial domain.';
    }
    
    return { 
      success: false, 
      error: errorMessage,
      details: error.message 
    };
  }
};
 

/*const sendInviteEmail = async ({ email, inviteId, formId, formTitle, tenantSlug }) => {
  // Generate links
  const productionLink = `https://forms.focusengineeringapp.com/${tenantSlug}/forms/${formId}?inviteId=${inviteId}`;
  const localhostLink = `http://localhost:5174/${tenantSlug}/forms/${formId}?inviteId=${inviteId}`;
  
  console.log(`
🎯 INVITE CREATED (Email disabled due to trial limit)
Email: ${email}
Invite ID: ${inviteId}
Form: ${formTitle}

LINKS FOR MANUAL TESTING:
🔗 Production: ${productionLink}
🔗 Localhost: ${localhostLink}

To test:
1. Copy the localhost link
2. Open in browser
3. Fill and submit form
4. Check if inviteId is saved
  `);
  
  return { 
    success: true, 
    testMode: true,
    message: 'Invite created but email not sent (trial limit)',
    links: {
      production: productionLink,
      localhost: localhostLink
    }
  };
};*/