import MailService from '../services/mailService.js';

export const sendServiceRequestNotification = async (req, res) => {
  try {
    const { serviceRequest, customerInfo } = req.body;

    if (!serviceRequest || !customerInfo) {
      return res.status(400).json({
        success: false,
        message: 'Service request and customer information are required'
      });
    }

    // Send notification to shop
    const shopNotification = await MailService.sendServiceRequestNotification(serviceRequest, customerInfo);
    
    // Send confirmation to customer
    const customerConfirmation = await MailService.sendCustomerConfirmation(serviceRequest, customerInfo);

    res.json({
      success: true,
      message: 'Notifications sent successfully',
      data: {
        shopNotification,
        customerConfirmation
      }
    });

  } catch (error) {
    console.error('Error in sendServiceRequestNotification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message
    });
  }
};

export const sendStatusUpdate = async (req, res) => {
  try {
    const { serviceRequest, customerInfo, status, message, estimatedCompletion } = req.body;

    if (!serviceRequest || !customerInfo || !status || !message) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required (serviceRequest, customerInfo, status, message)'
      });
    }

    const result = await MailService.sendStatusUpdate(
      serviceRequest, 
      customerInfo, 
      status, 
      message, 
      estimatedCompletion
    );

    res.json({
      success: true,
      message: 'Status update sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Error in sendStatusUpdate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send status update',
      error: error.message
    });
  }
};

export const testMailConnection = async (req, res) => {
  try {
    const result = await MailService.testConnection();
    
    res.json({
      success: result.success,
      message: result.success ? 'Mail service is working correctly' : 'Mail service connection failed',
      data: result
    });

  } catch (error) {
    console.error('Error testing mail connection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test mail connection',
      error: error.message
    });
  }
};

// Send a test email
export const sendTestEmail = async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }

    const testServiceRequest = {
      vehicleMake: 'Toyota',
      vehicleModel: 'Camry',
      vehicleYear: '2020',
      serviceType: 'Oil Change',
      issueDescription: 'Regular maintenance - oil change and inspection',
      urgency: 'Normal',
      preferredDate: new Date().toLocaleDateString(),
      id: 'TEST-' + Date.now()
    };

    const testCustomerInfo = {
      name: 'Test Customer',
      email: to,
      phone: '(555) 123-4567'
    };

    const result = await MailService.sendServiceRequestNotification(testServiceRequest, testCustomerInfo);
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
    });
  }
};