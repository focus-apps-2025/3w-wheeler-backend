import nodemailer from 'nodemailer';

class MailService {
  constructor() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const isGmail = host.includes('gmail.com');
    const port = isGmail ? 465 : (process.env.SMTP_PORT || 587);

    this.transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port == 465 || port === '465',
      auth: {
        user: process.env.SMTP_USER || 'your-email@gmail.com',
        pass: process.env.SMTP_PASS || 'your-app-password'
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      dnsTimeout: 10000,
      debug: true,
      logger: true
    });
  }

  // Shared base styles
  _baseWrapper(headerTitle, headerColor = '#2563eb', accentColor = '#f5c518', bodyContent) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background-color: ${headerColor}; padding: 24px 32px;">
          <h1 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;">
            ${headerTitle}
          </h1>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
          <!-- Yellow accent line -->
          <div style="height: 4px; background-color: ${accentColor}; margin-bottom: 28px; border-radius: 2px;"></div>

          ${bodyContent}

          <!-- Footer -->
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Focus Auto Shop — Automated Notification<br>
              <span style="font-size: 11px;">Generated: ${new Date().toLocaleString()}</span>
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // Send email to shop manager when new service request is submitted
  async sendServiceRequestNotification(serviceRequest, customerInfo) {
    try {
      const body = `
        <p style="font-size: 16px; color: #111827; margin: 0 0 6px;">Hello, <strong>FOCUS AUTO SHOP TEAM,</strong></p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
          A new service request has been submitted on <strong>${new Date().toLocaleDateString()}</strong>.
        </p>

        <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #6b7280; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">Customer Information</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Name:</strong> ${customerInfo.name}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Email:</strong> ${customerInfo.email}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Phone:</strong> ${customerInfo.phone || 'Not provided'}</p>
        </div>

        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #92400e; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">Vehicle Information</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Make:</strong> ${serviceRequest.vehicleMake}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Model:</strong> ${serviceRequest.vehicleModel}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Year:</strong> ${serviceRequest.vehicleYear || 'Not specified'}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>License Plate:</strong> ${serviceRequest.licensePlate || 'Not provided'}</p>
        </div>

        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #991b1b; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">Service Details</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Service Type:</strong> ${serviceRequest.serviceType}</p>
          ${serviceRequest.urgency ? `<p style="margin: 4px 0; color: #dc2626;"><strong>Urgency:</strong> ${serviceRequest.urgency}</p>` : ''}
          ${serviceRequest.preferredDate ? `<p style="margin: 4px 0; color: #111827;"><strong>Preferred Date:</strong> ${serviceRequest.preferredDate}</p>` : ''}
          <p style="margin: 12px 0 4px; color: #111827;"><strong>Issue Description:</strong></p>
          <p style="background: #fff; border: 1px solid #fecaca; padding: 12px; border-radius: 6px; color: #374151; margin: 0;">${serviceRequest.issueDescription}</p>
        </div>

        <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px 20px; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            📋 <strong>Request ID:</strong> ${serviceRequest.id || 'N/A'} &nbsp;|&nbsp;
            🕒 <strong>Submitted:</strong> ${new Date().toLocaleString()}
          </p>
        </div>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: process.env.SHOP_EMAIL || 'admin@focus.com',
        subject: `🚗 New Service Request - ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel}`,
        html: this._baseWrapper('New Service Request Received', '#2563eb', '#f5c518', body)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Service request notification sent:', result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Error sending service request notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Send confirmation email to customer
  async sendCustomerConfirmation(serviceRequest, customerInfo) {
    try {
      const body = `
        <p style="font-size: 16px; color: #111827; margin: 0 0 6px;">Hello, <strong>${customerInfo.name.toUpperCase()},</strong></p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
          Thank you for choosing <strong>Focus Auto Shop</strong>. We have received your service request and will contact you shortly.
        </p>

        <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
          <p style="font-size: 13px; font-weight: bold; color: #166534; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">Your Request Summary</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Vehicle:</strong> ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel} ${serviceRequest.vehicleYear || ''}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Service Type:</strong> ${serviceRequest.serviceType}</p>
          <p style="margin: 4px 0; color: #111827;"><strong>Issue:</strong> ${serviceRequest.issueDescription}</p>
          ${serviceRequest.preferredDate ? `<p style="margin: 4px 0; color: #111827;"><strong>Preferred Date:</strong> ${serviceRequest.preferredDate}</p>` : ''}
        </div>

        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
          <p style="font-size: 13px; font-weight: bold; color: #1e40af; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">What Happens Next?</p>
          <p style="margin: 6px 0; color: #374151;">✅ Our team will review your request within 24 hours</p>
          <p style="margin: 6px 0; color: #374151;">📅 We'll contact you to schedule an appointment</p>
          <p style="margin: 6px 0; color: #374151;">🔧 Our certified mechanics will diagnose and fix your vehicle</p>
        </div>

        <div style="text-align: center; background: #f9fafb; border-radius: 8px; padding: 20px;">
          <p style="font-weight: bold; color: #111827; margin: 0 0 6px;">Need immediate assistance?</p>
          <p style="color: #2563eb; font-size: 18px; font-weight: bold; margin: 0 0 4px;">📞 (555) 123-4567</p>
          <p style="color: #6b7280; font-size: 13px; margin: 0;">support@focus-auto.com</p>
        </div>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: customerInfo.email,
        subject: `✅ Service Request Received - Focus Auto Shop`,
        html: this._baseWrapper('Service Request Confirmed', '#16a34a', '#f5c518', body)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Customer confirmation sent:', result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Error sending customer confirmation:', error);
      return { success: false, error: error.message };
    }
  }

  // Send status update to customer
  async sendStatusUpdate(serviceRequest, customerInfo, status, message, estimatedCompletion = null) {
    try {
      const statusMap = {
        'received':      { color: '#3b82f6', label: 'Received',        accent: '#bfdbfe' },
        'in-progress':   { color: '#f59e0b', label: 'In Progress',     accent: '#fde68a' },
        'waiting-parts': { color: '#ef4444', label: 'Waiting for Parts', accent: '#fecaca' },
        'completed':     { color: '#10b981', label: 'Completed',       accent: '#a7f3d0' },
        'ready-pickup':  { color: '#16a34a', label: 'Ready for Pickup', accent: '#bbf7d0' }
      };
      const s = statusMap[status] || { color: '#6b7280', label: status, accent: '#e5e7eb' };

      const body = `
        <p style="font-size: 16px; color: #111827; margin: 0 0 6px;">Hello, <strong>${customerInfo.name.toUpperCase()},</strong></p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
          Here is the latest update on your vehicle service at <strong>Focus Auto Shop</strong>.
        </p>

        <div style="background: #f8fafc; border-left: 4px solid ${s.color}; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #6b7280; text-transform: uppercase; margin: 0 0 8px; letter-spacing: 1px;">Vehicle</p>
          <p style="font-size: 17px; color: #111827; font-weight: bold; margin: 0 0 12px;">${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel}</p>
          <p style="font-size: 13px; font-weight: bold; color: #6b7280; text-transform: uppercase; margin: 0 0 6px; letter-spacing: 1px;">Current Status</p>
          <span style="display: inline-block; background: ${s.accent}; color: ${s.color}; font-weight: bold; font-size: 14px; padding: 6px 16px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${s.label}
          </span>
        </div>

        <div style="background: #ffffff; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #6b7280; text-transform: uppercase; margin: 0 0 10px; letter-spacing: 1px;">Update Details</p>
          <p style="color: #374151; margin: 0;">${message}</p>
          ${estimatedCompletion ? `
            <p style="margin: 14px 0 0; color: #059669; font-weight: bold;">
              🕒 Estimated Completion: ${estimatedCompletion}
            </p>` : ''}
        </div>

        <div style="text-align: center; background: #f9fafb; border-radius: 8px; padding: 20px;">
          <p style="font-weight: bold; color: #111827; margin: 0 0 6px;">Questions about your service?</p>
          <p style="color: #2563eb; font-size: 18px; font-weight: bold; margin: 0 0 4px;">📞 (555) 123-4567</p>
          <p style="color: #6b7280; font-size: 13px; margin: 0;">Please have your Request ID ready when calling</p>
        </div>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: customerInfo.email,
        subject: `🔧 Service Update: ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel} — ${s.label.toUpperCase()}`,
        html: this._baseWrapper('Service Status Update', s.color, '#f5c518', body)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Status update sent:', result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Error sending status update:', error);
      return { success: false, error: error.message };
    }
  }

  // Send response report with Excel attachment
  async sendResponseReportWithAttachment(recipientEmail, subject, fileData, fileName) {
    try {
      console.log('📧 Attempting to send report email...');

      const body = `
        <p style="font-size: 16px; color: #111827; margin: 0 0 6px;">Hello,</p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
          Please find the attached Excel report with the latest dashboard data and response details.
        </p>

        <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: bold; color: #166534; text-transform: uppercase; margin: 0 0 12px; letter-spacing: 1px;">Report Contents</p>
          <p style="margin: 6px 0; color: #374151;">📊 <strong>Sheet 1 — Dashboard:</strong> Summary statistics, percentages, and weighted data</p>
          <p style="margin: 6px 0; color: #374151;">📋 <strong>Sheet 2 — Responses:</strong> Detailed responses organized by sections</p>
        </div>

        <div style="text-align: center; background: #f9fafb; border-radius: 8px; padding: 16px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            📎 Attachment: <strong>${fileName || 'report.xlsx'}</strong>
          </p>
        </div>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: recipientEmail,
        subject: subject || 'Response Report',
        html: this._baseWrapper('Response Report', '#2563eb', '#f5c518', body),
        attachments: [{ filename: fileName || 'report.xlsx', content: fileData }]
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Response report sent successfully!');
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Error sending response report:', error);
      return { success: false, error: error.message };
    }
  }

  // Test email configuration
  async testConnection() {
    try {
      await this.transporter.verify();
      console.log('✅ Mail server connection successful');
      return { success: true, message: 'Mail server connection successful' };
    } catch (error) {
      console.error('❌ Mail server connection failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Send form invitation
  async sendFormInvite(recipientEmail, formTitle, inviteLink, tenantName) {
    try {
      console.log('📧 Sending form invite to:', recipientEmail);

      const body = `
        <p style="font-size: 16px; color: #111827; margin: 0 0 6px;">Hello,</p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
          You have been invited by <strong>${tenantName}</strong> to fill out the following form:
        </p>

        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 28px;">
          <p style="font-size: 13px; font-weight: bold; color: #1e40af; text-transform: uppercase; margin: 0 0 8px; letter-spacing: 1px;">Form Name</p>
          <p style="font-size: 18px; font-weight: bold; color: #1e40af; margin: 0;">${formTitle}</p>
        </div>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteLink}"
             style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: bold; letter-spacing: 0.3px;">
            Fill Out Form →
          </a>
        </div>

        <p style="font-size: 13px; color: #9ca3af; text-align: center; margin: 20px 0 0;">
          If the button doesn't work, copy and paste this link:<br>
          <a href="${inviteLink}" style="color: #2563eb; word-break: break-all; font-size: 12px;">${inviteLink}</a>
        </p>
      `;

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: recipientEmail,
        subject: `Invitation: Please complete "${formTitle}"`,
        html: this._baseWrapper('Your Feedback Is Very Important', '#2563eb', '#f5c518', body)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email invite sent successfully to', recipientEmail);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Error sending email invite:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new MailService();