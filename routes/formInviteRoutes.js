import express from 'express';
import multer from 'multer';
import {
  uploadInvites,
  sendInvites,
  getInviteStats,
  getInviteList
} from '../controllers/formInviteController.js';
import { authenticate, teacherOrAdmin } from '../middleware/auth.js';

const router = express.Router();

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.mimetype === 'text/csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel/CSV files are allowed'), false);
    }
  }
});

// Admin middleware (you need to create this)
const adminOnly = (req, res, next) => {
  if (req.user.role === 'admin' || req.user.role === 'superadmin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
};

// Routes
router.post('/:formId/invites/upload', 
  
  adminOnly, 
  upload.single('file'), 
  uploadInvites
);

router.post('/:formId/invites/send', 
  
  adminOnly, 
  sendInvites
);

router.get('/:formId/invites/stats', 
   
  adminOnly, 
  getInviteStats
);
// Add to your formInviteRoutes.js
  router.get('/:formId/invites', 
    authenticate,
    adminOnly,
    getInviteList
  );

export default router;