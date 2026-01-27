import twilio from 'twilio';

class WhatsAppService {
  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    this.isConfigured = !!(accountSid && authToken);
    
    if (!this.isConfigured) {
      const missing = [];
      if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
      if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
      console.warn(`⚠️ WhatsApp service not fully configured. Missing: ${missing.join(', ')}`);
      this.client = null;
    } else {
      this.client = twilio(accountSid, authToken);
    }
    
    this.twilioPhoneNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';
    this.inviteTemplateSid = process.env.TWILIO_INVITE_TEMPLATE_SID || '';
  }

  formatPhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // If it starts with 91 and has 12 digits, it's an Indian number with country code
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return `+${cleaned}`;
    }
    
    // If it's 10 digits, we need to be careful. 
    // In this specific environment (India), we should probably default to +91 if not specified
    if (cleaned.length === 10) {
      // If we're sure this is for India, use +91. Otherwise, keep +1 for US as before
      // but let's make it smarter: if the user provided +91 in the original string, 
      // the first branch or the startsWith branch will handle it.
      return `+91${cleaned}`; 
    }
    
    return `+${cleaned}`;
  }

  async sendServiceRequestNotification(serviceRequest, customerInfo) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const customerPhone = this.formatPhoneNumber(customerInfo.phone);
      if (!customerPhone) {
        return { success: false, error: 'Invalid customer phone number' };
      }

      const shopPhone = process.env.TWILIO_SHOP_WHATSAPP || '';
      if (!shopPhone) {
        return { success: false, error: 'Shop WhatsApp number not configured' };
      }

      const message = `
🚗 *NEW SERVICE REQUEST*

*Customer Information:*
Name: ${customerInfo.name}
Email: ${customerInfo.email}
Phone: ${customerInfo.phone}

*Vehicle Information:*
Make: ${serviceRequest.vehicleMake}
Model: ${serviceRequest.vehicleModel}
Year: ${serviceRequest.vehicleYear || 'Not specified'}
License Plate: ${serviceRequest.licensePlate || 'Not provided'}

*Service Details:*
Service Type: ${serviceRequest.serviceType}
Issue: ${serviceRequest.issueDescription}
${serviceRequest.urgency ? `Urgency: ${serviceRequest.urgency}` : ''}
${serviceRequest.preferredDate ? `Preferred Date: ${serviceRequest.preferredDate}` : ''}

Request ID: ${serviceRequest.id || 'N/A'}
Submitted: ${new Date().toLocaleString()}
      `.trim();

      const messageData = await this.client.messages.create({
        from: `whatsapp:${this.twilioPhoneNumber}`,
        to: `whatsapp:${shopPhone}`,
        body: message,
      });

      console.log('Service request notification sent to shop:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('Error sending service request notification:', error);
      return { success: false, error: error.message };
    }
  }

  async sendCustomerConfirmation(serviceRequest, customerInfo) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const customerPhone = this.formatPhoneNumber(customerInfo.phone);
      if (!customerPhone) {
        return { success: false, error: 'Invalid customer phone number' };
      }

      const message = `
✅ *SERVICE REQUEST RECEIVED*

Dear ${customerInfo.name},

Thank you for choosing Focus Auto Shop! We have received your service request.

*Your Request Summary:*
Vehicle: ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel} ${serviceRequest.vehicleYear || ''}
Service Type: ${serviceRequest.serviceType}
Issue: ${serviceRequest.issueDescription}

*What Happens Next?*
📋 Our team will review within 24 hours
📞 We'll contact you to schedule
🔧 Our mechanics will diagnose & fix

*Need Help?*
Call: (555) 123-4567
Email: support@focus-auto.com

Request ID: ${serviceRequest.id || 'N/A'}
      `.trim();

      const messageData = await this.client.messages.create({
        from: `whatsapp:${this.twilioPhoneNumber}`,
        to: `whatsapp:${customerPhone}`,
        body: message,
      });

      console.log('Customer confirmation sent:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('Error sending customer confirmation:', error);
      return { success: false, error: error.message };
    }
  }

  async sendFormInvite(phone, formTitle, inviteLink, tenantName) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const customerPhone = this.formatPhoneNumber(phone);
      if (!customerPhone) {
        return { success: false, error: 'Invalid phone number' };
      }

      console.log('Form invite sending via WhatsApp...');
      
      let messageData;
      
      if (this.inviteTemplateSid) {
        // Use Twilio Content API (Templates)
        messageData = await this.client.messages.create({
          from: `whatsapp:${this.twilioPhoneNumber}`,
          to: `whatsapp:${customerPhone}`,
          contentSid: this.inviteTemplateSid,
          contentVariables: JSON.stringify({
            "1": tenantName,
            "2": formTitle,
            "3": inviteLink
          })
        });
      } else {
        // Fallback to legacy body (only works in open sessions or sandbox)
        const message = `
📋 *FORM INVITATION*

Hello! You have been invited by *${tenantName}* to fill out the following form:

*${formTitle}*

Please click the link below to complete the form:
${inviteLink}

Thank you!
      `.trim();

        messageData = await this.client.messages.create({
          from: `whatsapp:${this.twilioPhoneNumber}`,
          to: `whatsapp:${customerPhone}`,
          body: message,
        });
      }

      console.log('Form invite sent via WhatsApp:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('Error sending form invite via WhatsApp:', error);
      return { success: false, error: error.message };
    }
  }

  async sendStatusUpdate(serviceRequest, customerInfo, status, message, estimatedCompletion = null) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const customerPhone = this.formatPhoneNumber(customerInfo.phone);
      if (!customerPhone) {
        return { success: false, error: 'Invalid customer phone number' };
      }

      const statusEmojis = {
        'received': '📥',
        'in-progress': '⚙️',
        'waiting-parts': '⏳',
        'completed': '✅',
        'ready-pickup': '🚗'
      };

      const emoji = statusEmojis[status] || '📌';
      const statusText = status.replace('-', ' ').toUpperCase();

      const whatsappMessage = `
${emoji} *SERVICE STATUS UPDATE*

Dear ${customerInfo.name},

*Vehicle:* ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel}
*Status:* ${statusText}

*Update:*
${message}

${estimatedCompletion ? `⏰ *Estimated Completion:* ${estimatedCompletion}` : ''}

*Questions?*
Call: (555) 123-4567
Reference your request ID
      `.trim();

      const messageData = await this.client.messages.create({
        from: `whatsapp:${this.twilioPhoneNumber}`,
        to: `whatsapp:${customerPhone}`,
        body: whatsappMessage,
      });

      console.log('Status update sent:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('Error sending status update:', error);
      return { success: false, error: error.message };
    }
  }

  async sendResponseReport(recipientPhone, subject, fileData, fileName) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const phone = this.formatPhoneNumber(recipientPhone);
      if (!phone) {
        return { success: false, error: 'Invalid phone number' };
      }

      console.log('📱 Attempting to send report via WhatsApp...');
      console.log('To:', phone);
      console.log('Subject:', subject);

      const message = `
📊 *RESPONSE REPORT*

${subject}

Report Contents:
📈 Dashboard Summary & Statistics
📋 Detailed Responses by Sections

Report Generated: ${new Date().toLocaleString()}

Please check your email for the attached Excel file with complete details.
      `.trim();

      const messageData = await this.client.messages.create({
        from: `whatsapp:${this.twilioPhoneNumber}`,
        to: `whatsapp:${phone}`,
        body: message,
      });

      console.log('✅ Response report notification sent via WhatsApp!');
      console.log('Message ID:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('❌ Error sending response report:');
      console.error('Error message:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    try {
      if (!this.isConfigured) {
        return { 
          success: false, 
          error: 'Twilio WhatsApp service not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN' 
        };
      }

      if (!this.twilioPhoneNumber) {
        return { 
          success: false, 
          error: 'TWILIO_WHATSAPP_NUMBER environment variable not set' 
        };
      }

      await this.client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      console.log('✅ Twilio WhatsApp connection successful');
      return { success: true, message: 'Twilio WhatsApp connection successful' };
    } catch (error) {
      console.error('❌ Twilio WhatsApp connection failed:', error);
      return { success: false, error: error.message };
    }
  }

  async sendTestMessage(recipientPhone) {
    try {
      if (!this.isConfigured) {
        return { success: false, error: 'Twilio WhatsApp service not configured' };
      }

      const phone = this.formatPhoneNumber(recipientPhone);
      if (!phone) {
        return { success: false, error: 'Invalid phone number format' };
      }

      const message = `
✅ *TEST MESSAGE*

This is a test message from Focus Auto Shop WhatsApp integration.

If you received this, WhatsApp service is working correctly! 🎉

Configuration Status:
✓ Twilio Account Connected
✓ WhatsApp Service Active
✓ Message Delivery Working

Timestamp: ${new Date().toLocaleString()}
      `.trim();

      const messageData = await this.client.messages.create({
        from: `whatsapp:${this.twilioPhoneNumber}`,
        to: `whatsapp:${phone}`,
        body: message,
      });

      console.log('Test message sent:', messageData.sid);
      return { success: true, messageId: messageData.sid };
    } catch (error) {
      console.error('Error sending test message:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new WhatsAppService();
