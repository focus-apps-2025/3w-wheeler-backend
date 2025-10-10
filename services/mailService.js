import nodemailer from 'nodemailer';

class MailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || 'your-email@gmail.com',
        pass: process.env.SMTP_PASS || 'your-app-password'
      }
    });
  }

  // Send email to shop manager when new service request is submitted
  async sendServiceRequestNotification(serviceRequest, customerInfo) {
    try {
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: process.env.SHOP_EMAIL || 'admin@focus.com',
        subject: `🚗 New Service Request - ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
              New Service Request Received
            </h2>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #374151; margin-top: 0;">Customer Information:</h3>
              <p><strong>Name:</strong> ${customerInfo.name}</p>
              <p><strong>Email:</strong> ${customerInfo.email}</p>
              <p><strong>Phone:</strong> ${customerInfo.phone || 'Not provided'}</p>
            </div>

            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #92400e; margin-top: 0;">Vehicle Information:</h3>
              <p><strong>Make:</strong> ${serviceRequest.vehicleMake}</p>
              <p><strong>Model:</strong> ${serviceRequest.vehicleModel}</p>
              <p><strong>Year:</strong> ${serviceRequest.vehicleYear || 'Not specified'}</p>
              <p><strong>License Plate:</strong> ${serviceRequest.licensePlate || 'Not provided'}</p>
            </div>

            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #dc2626; margin-top: 0;">Service Details:</h3>
              <p><strong>Service Type:</strong> ${serviceRequest.serviceType}</p>
              <p><strong>Issue Description:</strong></p>
              <p style="background: white; padding: 15px; border-radius: 4px;">${serviceRequest.issueDescription}</p>
              
              ${serviceRequest.urgency ? `
                <p style="color: #dc2626;"><strong>Urgency:</strong> ${serviceRequest.urgency}</p>
              ` : ''}
              
              ${serviceRequest.preferredDate ? `
                <p><strong>Preferred Date:</strong> ${serviceRequest.preferredDate}</p>
              ` : ''}
            </div>

            <div style="background: #e0f2fe; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #0369a1;">
                <strong>📅 Request ID:</strong> ${serviceRequest.id || 'N/A'}<br>
                <strong>🕒 Submitted:</strong> ${new Date().toLocaleString()}
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; margin: 0;">
                This is an automated notification from Focus Auto Shop Service System
              </p>
            </div>
          </div>
        `
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
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: customerInfo.email,
        subject: `✅ Service Request Received - Focus Auto Shop`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a; border-bottom: 2px solid #16a34a; padding-bottom: 10px;">
              Service Request Confirmed
            </h2>
            
            <p>Dear ${customerInfo.name},</p>
            
            <p>Thank you for choosing Focus Auto Shop! We have received your service request and will contact you soon.</p>

            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
              <h3 style="color: #166534; margin-top: 0;">Your Request Summary:</h3>
              <p><strong>Vehicle:</strong> ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel} ${serviceRequest.vehicleYear || ''}</p>
              <p><strong>Service Type:</strong> ${serviceRequest.serviceType}</p>
              <p><strong>Issue:</strong> ${serviceRequest.issueDescription}</p>
              ${serviceRequest.preferredDate ? `<p><strong>Preferred Date:</strong> ${serviceRequest.preferredDate}</p>` : ''}
            </div>

            <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1d4ed8; margin-top: 0;">What Happens Next?</h3>
              <ul style="color: #374151;">
                <li>Our team will review your request within 24 hours</li>
                <li>We'll contact you to schedule an appointment</li>
                <li>Our certified mechanics will diagnose and fix your vehicle</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #374151; margin: 0;">
                <strong>📞 Need immediate assistance?</strong><br>
                Call us at: <strong>(555) 123-4567</strong><br>
                Email: <strong>support@focus-auto.com</strong>
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; margin: 0;">
                Focus Auto Shop - Your Trusted Car Care Partner<br>
                <small>This is an automated confirmation email</small>
              </p>
            </div>
          </div>
        `
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
      const statusColors = {
        'received': '#3b82f6',
        'in-progress': '#f59e0b',
        'waiting-parts': '#ef4444',
        'completed': '#10b981',
        'ready-pickup': '#16a34a'
      };

      const statusColor = statusColors[status] || '#6b7280';

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: customerInfo.email,
        subject: `🔧 Service Update: ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel} - ${status.replace('-', ' ').toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: ${statusColor}; border-bottom: 2px solid ${statusColor}; padding-bottom: 10px;">
              Service Status Update
            </h2>
            
            <p>Dear ${customerInfo.name},</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #374151; margin-top: 0;">Vehicle: ${serviceRequest.vehicleMake} ${serviceRequest.vehicleModel}</h3>
              <p style="font-size: 18px; color: ${statusColor}; font-weight: bold;">
                Status: ${status.replace('-', ' ').toUpperCase()}
              </p>
            </div>

            <div style="background: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <h3 style="color: #374151; margin-top: 0;">Update Details:</h3>
              <p>${message}</p>
              
              ${estimatedCompletion ? `
                <p style="color: #059669;"><strong>Estimated Completion:</strong> ${estimatedCompletion}</p>
              ` : ''}
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #374151; margin: 0;">
                <strong>Questions about your service?</strong><br>
                Call us at: <strong>(555) 123-4567</strong><br>
                Reference your request ID when calling
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; margin: 0;">
                Focus Auto Shop - Keeping You Updated Every Step<br>
                <small>This is an automated status update</small>
              </p>
            </div>
          </div>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Status update sent:', result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Error sending status update:', error);
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
}

export default new MailService();