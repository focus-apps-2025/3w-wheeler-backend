import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import Form from '../models/Form.js';
import AnalyticsInvite from '../models/AnalyticsInvite.js';
import Tenant from '../models/Tenant.js';
import { v4 as uuidv4 } from 'uuid';
import mailService from '../services/mailService.js';
import WhatsAppService from '../services/whatsappService.js';
import smsService from '../services/smsService.js';
import pdfService from '../services/pdfService.js';
import { generateGuestToken } from '../middleware/auth.js';

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email.trim().toLowerCase());
};

const isValidPhone = (phone) => {
  if (!phone) return true; // Optional
  const digits = phone.toString().replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
};

const parseExcelFile = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (data.length < 2) throw new Error('Excel must have at least one data row');
  
  const headers = data[0].map(h => h?.toString().toLowerCase().trim() || '');
  const emailIdx = headers.findIndex(h => h.includes('email'));
  const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('mobile'));
  
  if (emailIdx === -1) throw new Error('Excel must contain an "Email" column');
  
  const records = [];
  const seenEmails = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row?.[emailIdx]) continue;
    
    const email = row[emailIdx].toString().trim().toLowerCase();
    if (seenEmails.has(email)) continue;
    
    seenEmails.add(email);
    records.push({
      email,
      phone: phoneIdx !== -1 ? row[phoneIdx]?.toString().trim() : ''
    });
  }
  return records;
};

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const uploadAnalyticsInvites = async (req, res) => {
  try {
    const { formId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    
    const form = await Form.findOne({ id: formId });
    if (!form) return res.status(404).json({ success: false, message: 'Form not found' });
    
    const records = parseExcelFile(req.file.buffer);
    const valid = [], invalid = [];
    
    records.forEach(r => {
      if (isValidEmail(r.email) && isValidPhone(r.phone)) {
        valid.push(r);
      } else {
        invalid.push(r);
      }
    });
    
    res.json({
      success: true,
      data: {
        total: records.length,
        valid: valid.length,
        invalid: invalid.length,
        preview: valid.slice(0, 10)
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const sendAnalyticsInvites = async (req, res) => {
  try {
    const { formId } = req.params;
    const { invites, channels = ['email'], customMessage, pdfHtml, shareMode = 'both' } = req.body;
    
    if (!Array.isArray(invites) || invites.length === 0) {
      return res.status(400).json({ success: false, message: 'Invites array is required' });
    }
    
    const form = await Form.findOne({ id: formId });
    if (!form) return res.status(404).json({ success: false, message: 'Form not found' });
    
    const tenant = await Tenant.findById(form.tenantId);

    const includeLink = shareMode === 'link' || shareMode === 'both';
    const includePdf = shareMode === 'pdf' || shareMode === 'both';

    // Handle PDF generation if pdfHtml is provided
    let pdfAttachment = null;
    console.log('📩 SendAnalyticsInvites called with pdfHtml:', !!pdfHtml, pdfHtml?.length || 0, 'shareMode:', shareMode);
    
    if (pdfHtml && channels.includes('email') && includePdf) {
      try {
        console.log('📄 Generating PDF for email attachment...');
        const pdfBuffer = await pdfService.generatePDFWithA4Portrait(pdfHtml);
        if (pdfBuffer && pdfBuffer.length > 0) {
          pdfAttachment = {
            filename: `${form.title.replace(/\s+/g, '_')}_Analytics.pdf`,
            content: pdfBuffer
          };
          console.log(`✅ PDF generated successfully for attachment (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);
        } else {
          console.error('❌ PDF generation returned empty buffer');
        }
      } catch (pdfError) {
        console.error('❌ Failed to generate PDF for attachment:', pdfError);
        // Continue without attachment if generation fails
      }
    } else if (!pdfHtml && channels.includes('email')) {
      console.warn('⚠️ No pdfHtml provided but email channel is selected');
    }
    
    const results = [];
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry
    
    const baseUrl = process.env.INVITE_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    // Handle comma-separated FRONTEND_URL
    const singleBaseUrl = baseUrl.split(',')[0].trim();
    const formattedBaseUrl = singleBaseUrl.endsWith('/') ? singleBaseUrl : `${singleBaseUrl}/`;
    const inviteLink = `${formattedBaseUrl}forms/${formId}/analytics/login`;
    
    for (const inviteData of invites) {
      const email = inviteData.email ? inviteData.email.toLowerCase().trim() : null;
      const { phone } = inviteData;
      const otp = generateOTP();
      
      // Update or create invite - Use form.id (custom ID) consistently
      const query = { formId: form.id };
      if (email) query.email = email;
      else if (phone) query.phone = phone;
      else continue;

      await AnalyticsInvite.findOneAndUpdate(
        query,
        { 
          email,
          phone, 
          otp, 
          expiresAt, 
          status: 'sent', 
          tenantId: form.tenantId 
        },
        { upsert: true, new: true }
      );
      
      let emailSent = false;
      let whatsappSent = false;
      let smsSent = false;

      if (channels.includes('email')) {
        const mailResult = await mailService.sendAnalyticsInvite(email, form.title, inviteLink, otp, tenant.name, customMessage, false, pdfAttachment, includeLink);
        emailSent = mailResult.success;
        if (!emailSent) {
          console.error(`Failed to send email to ${email}:`, mailResult.error);
        }
      }
      
      if (channels.includes('whatsapp') && phone) {
        // Don't send OTP in the initial invite as per user request
        const waResult = await WhatsAppService.sendAnalyticsInvite(phone, form.title, inviteLink, null, tenant.name, email, customMessage, false, includeLink);
        whatsappSent = waResult.success;
        if (!whatsappSent) {
          console.error(`Failed to send WhatsApp to ${phone}:`, waResult.error);
        }
      }

      if (channels.includes('sms') && phone) {
        const smsResult = await smsService.sendFormInvite(phone, form.title, inviteLink, tenant.name);
        smsSent = smsResult.success;
        if (!smsSent) {
          console.error(`Failed to send SMS to ${phone}:`, smsResult.error);
        }
      }
      
      results.push({ 
        email, 
        phone,
        status: (emailSent || whatsappSent || smsSent) ? 'sent' : 'failed',
        emailSent,
        whatsappSent,
        smsSent,
        deliveryReport: {
          email: emailSent ? 'success' : (channels.includes('email') ? 'failed' : 'skipped'),
          whatsapp: whatsappSent ? 'success' : (channels.includes('whatsapp') && phone ? 'failed' : 'skipped'),
          sms: smsSent ? 'success' : (channels.includes('sms') && phone ? 'failed' : 'skipped')
        }
      });
    }
    
    const sentCount = results.filter(r => r.status === 'sent').length;
    const allSuccessful = results.every(r => 
      (!channels.includes('email') || r.emailSent) && 
      (!channels.includes('whatsapp') || !r.phone || r.whatsappSent) &&
      (!channels.includes('sms') || !r.phone || r.smsSent)
    );

    res.json({ 
      success: sentCount > 0, 
      data: { 
        sent: sentCount,
        failed: results.length - sentCount,
        allSuccessful,
        details: results
      },
      message: allSuccessful 
        ? `Successfully sent ${sentCount} invites` 
        : (sentCount > 0 ? "Some invites failed to deliver" : "Failed to send any invites")
    });
  } catch (error) {
    console.error('Send analytics invites error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const requestGuestOTP = async (req, res) => {
  try {
    let { formId, email, phone, channel = 'email' } = req.body;

    if (!formId || (!email && !phone)) {
      return res.status(400).json({ success: false, message: 'Form ID and either email or phone are required' });
    }

    // Normalize inputs
    const normalizedFormId = formId.toString().trim();
    const normalizedEmail = email ? email.toString().toLowerCase().trim() : null;
    const cleanPhone = phone ? phone.toString().replace(/\D/g, '') : null;

    // 1. Try to find the form
    const form = await Form.findOne({ 
      $or: [
        { id: normalizedFormId }, 
        { _id: mongoose.Types.ObjectId.isValid(normalizedFormId) ? normalizedFormId : new mongoose.Types.ObjectId() }
      ] 
    });

    // 2. Build search query for invite
    const inviteConditions = [];
    
    // Add conditions based on what's provided
    if (normalizedEmail) {
      inviteConditions.push({ email: normalizedEmail });
    }
    if (cleanPhone) {
      // Use regex to match ending of phone number (e.g. last 10 digits) or exact match
      const phoneRegex = cleanPhone.length >= 10 ? new RegExp(cleanPhone.slice(-10) + '$') : new RegExp(cleanPhone + '$');
      inviteConditions.push({ phone: phoneRegex });
      inviteConditions.push({ phone: cleanPhone });
    }

    const formIds = [normalizedFormId];
    if (form) {
      if (form.id) formIds.push(form.id);
      if (form._id) formIds.push(form._id.toString());
    }

    const invite = await AnalyticsInvite.findOne({ 
      formId: { $in: formIds },
      $or: inviteConditions
    });

    if (!invite) {
      const identity = normalizedEmail || phone;
      console.log(`[AUTH] Invite not found for ${identity} on form: ${normalizedFormId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'This identity is not invited to view analytics for this form. Please contact the administrator.' 
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    invite.otp = otp;
    invite.expiresAt = expiresAt;
    invite.status = 'sent';
    await invite.save();

    const tenant = await Tenant.findById(invite.tenantId);

    const baseUrl = process.env.INVITE_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const singleBaseUrl = baseUrl.split(',')[0].trim();
    const formattedBaseUrl = singleBaseUrl.endsWith('/') ? singleBaseUrl : `${singleBaseUrl}/`;
    const inviteLink = `${formattedBaseUrl}forms/${formId}/analytics/login`;

    let emailSent = false;
    let smsSent = false;

    if (channel === 'email' && invite.email) {
      const mailResult = await mailService.sendAnalyticsInvite(
        invite.email, 
        form ? form.title : 'Form Analytics', 
        inviteLink, 
        otp, 
        tenant ? tenant.name : 'System',
        'Your login verification code (OTP)',
        true
      );
      emailSent = mailResult.success;
    }

    if (channel === 'sms' && invite.phone) {
      const smsResult = await smsService.sendOTP(invite.phone, otp);
      smsSent = smsResult.success;
    }

    if (emailSent || smsSent) {
      const msg = channel === 'sms' 
        ? 'Verification code sent to your phone via SMS' 
        : 'Verification code sent to your email';
        
      res.json({
        success: true,
        message: msg,
        data: { message: msg }
      });
    } else {
      res.status(500).json({
        success: false,
        message: channel === 'sms' && !invite.phone 
          ? 'No phone number associated with this invite. Please use email.'
          : (channel === 'email' && !invite.email ? 'No email associated with this invite. Please use SMS.' : 'Failed to send verification code')
      });
    }
  } catch (error) {
    console.error('Request guest OTP error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyAnalyticsOTP = async (req, res) => {
  try {
    const { formId, email, phone, otp } = req.body;
    
    if (!formId || (!email && !phone) || !otp) {
      return res.status(400).json({ success: false, message: 'Form ID, OTP, and either email or phone are required' });
    }

    const normalizedFormId = formId.toString().trim();
    const normalizedEmail = email ? email.toString().toLowerCase().trim() : null;
    const cleanPhone = phone ? phone.toString().replace(/\D/g, '') : null;

    // 1. Try to find the form
    const form = await Form.findOne({ 
      $or: [
        { id: normalizedFormId }, 
        { _id: mongoose.Types.ObjectId.isValid(normalizedFormId) ? normalizedFormId : new mongoose.Types.ObjectId() }
      ] 
    });

    // 2. Build search query for invite
    const inviteConditions = [];
    if (normalizedEmail) {
      inviteConditions.push({ email: normalizedEmail });
    }
    if (cleanPhone) {
      const phoneRegex = cleanPhone.length >= 10 ? new RegExp(cleanPhone.slice(-10) + '$') : new RegExp(cleanPhone + '$');
      inviteConditions.push({ phone: phoneRegex });
      inviteConditions.push({ phone: cleanPhone });
    }

    const formIds = [normalizedFormId];
    if (form) {
      if (form.id) formIds.push(form.id);
      if (form._id) formIds.push(form._id.toString());
    }

    const invite = await AnalyticsInvite.findOne({ 
      formId: { $in: formIds },
      $or: inviteConditions
    });
    
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invite not found' });
    }
    
    if (invite.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid verification code (OTP)' });
    }
    
    if (new Date() > invite.expiresAt) {
      invite.status = 'expired';
      await invite.save();
      return res.status(401).json({ success: false, message: 'Invite has expired' });
    }
    
    invite.status = 'active';
    invite.lastLogin = new Date();
    await invite.save();
    
    // Generate guest token
    const token = generateGuestToken(invite.email || invite.phone, invite.formId);
    
    res.json({ 
      success: true, 
      data: { 
        token,
        email: invite.email, 
        phone: invite.phone,
        formId: invite.formId,
        expiresAt: invite.expiresAt
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
