import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import Form from '../models/Form.js';
import AnalyticsInvite from '../models/AnalyticsInvite.js';
import Tenant from '../models/Tenant.js';
import { v4 as uuidv4 } from 'uuid';
import mailService from '../services/mailService.js';
import WhatsAppService from '../services/whatsappService.js';
import smsService from '../services/smsService.js';
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
    const { invites, channels = ['email'], customMessage } = req.body;
    
    if (!Array.isArray(invites) || invites.length === 0) {
      return res.status(400).json({ success: false, message: 'Invites array is required' });
    }
    
    const form = await Form.findOne({ id: formId });
    if (!form) return res.status(404).json({ success: false, message: 'Form not found' });
    
    const tenant = await Tenant.findById(form.tenantId);
    
    const results = [];
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry
    
    const baseUrl = process.env.INVITE_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    // Handle comma-separated FRONTEND_URL
    const singleBaseUrl = baseUrl.split(',')[0].trim();
    const inviteLink = `${singleBaseUrl}forms/${formId}/analytics/login`;
    
    for (const inviteData of invites) {
      const { email, phone } = inviteData;
      const otp = generateOTP();
      
      // Update or create invite
      await AnalyticsInvite.findOneAndUpdate(
        { formId, email },
        { 
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
        const mailResult = await mailService.sendAnalyticsInvite(email, form.title, inviteLink, otp, tenant.name, customMessage, false);
        emailSent = mailResult.success;
        if (!emailSent) {
          console.error(`Failed to send email to ${email}:`, mailResult.error);
        }
      }
      
      if (channels.includes('whatsapp') && phone) {
        // Don't send OTP in the initial invite as per user request
        const waResult = await WhatsAppService.sendAnalyticsInvite(phone, form.title, inviteLink, null, tenant.name, email, customMessage, false);
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
    const { formId, email, phone, channel = 'email' } = req.body;

    if (!formId || !email || !phone) {
      return res.status(400).json({ success: false, message: 'Form ID, email, and phone number are required' });
    }

    const invite = await AnalyticsInvite.findOne({ 
      formId, 
      email: email.toLowerCase()
    });

    if (!invite) {
      return res.status(404).json({ 
        success: false, 
        message: 'This email is not invited to view analytics for this form. Please contact the administrator.' 
      });
    }

    // Clean phone numbers for comparison
    const cleanInputPhone = phone.replace(/\D/g, '');
    const cleanInvitePhone = invite.phone ? invite.phone.replace(/\D/g, '') : '';

    // Verify phone number matches (handling potential country code differences)
    if (!cleanInvitePhone || (cleanInputPhone.length >= 10 && !cleanInvitePhone.endsWith(cleanInputPhone))) {
      return res.status(401).json({
        success: false,
        message: 'The phone number provided does not match our records for this email.'
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    invite.otp = otp;
    invite.expiresAt = expiresAt;
    invite.status = 'sent';
    await invite.save();

    const form = await Form.findOne({ id: formId });
    const tenant = await Tenant.findById(invite.tenantId);

    const baseUrl = process.env.INVITE_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const singleBaseUrl = baseUrl.split(',')[0].trim();
    const inviteLink = `${singleBaseUrl}forms/${formId}/analytics/login`;

    let emailSent = false;
    let smsSent = false;

    if (channel === 'email') {
      const mailResult = await mailService.sendAnalyticsInvite(
        email, 
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
          : 'Failed to send verification code'
      });
    }
  } catch (error) {
    console.error('Request guest OTP error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyAnalyticsOTP = async (req, res) => {
  try {
    const { formId, email, otp } = req.body;
    
    const invite = await AnalyticsInvite.findOne({ formId, email });
    
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invite not found' });
    }
    
    if (invite.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid password (OTP)' });
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
    const token = generateGuestToken(invite.email, invite.formId);
    
    res.json({ 
      success: true, 
      data: { 
        token,
        email: invite.email, 
        formId: invite.formId,
        expiresAt: invite.expiresAt
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
