import express from 'express';
import { 
  sendServiceRequestNotification, 
  sendStatusUpdate, 
  testMailConnection, 
  sendTestEmail 
} from '../controllers/mailController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Test mail connection (admin only)
router.get('/test-connection', authenticate, authorize('admin'), testMailConnection);

// Send test email (admin only)
router.post('/test-email', authenticate, authorize('admin'), sendTestEmail);

// Send service request notification (public route - called when form is submitted)
router.post('/service-request-notification', sendServiceRequestNotification);

// Send status update to customer (admin only)
router.post('/status-update', authenticate, authorize('admin'), sendStatusUpdate);

export default router;