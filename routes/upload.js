// routes/upload.js
import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { authenticate,  hasPermission } from '../middleware/auth.js';

const router = express.Router();

// File type validation
const ALLOWED_FILE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4'
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_CATEGORIES = [
  'form','forms', 'submissions', 'profile', 'documents', 
  'templates', 'general', 'attachments', 'logo'
];

// Add a mapping for common variations
const CATEGORY_MAPPING = {
  'form': 'forms',
  'submission': 'submissions',
  'document': 'documents',
  'template': 'templates',
  'attachment': 'attachments'
};

router.post('/presigned-url', authenticate, async (req, res) => {
  try {
    // Check if AWS credentials are configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('[Presigned URL] AWS credentials are not configured in .env');
      return res.status(500).json({
        success: false,
        error: 'Upload service misconfigured',
        details: 'AWS credentials missing on server'
      });
    }

    let { filename, fileType, category = 'general', associatedId } = req.body;
    const user = req.user;
    
    // Validation
    if (!filename || !fileType) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        details: 'filename and fileType are required' 
      });
    }

    // Normalize category
    if (CATEGORY_MAPPING[category]) {
      console.log(`Normalizing category from "${category}" to "${CATEGORY_MAPPING[category]}"`);
      category = CATEGORY_MAPPING[category];
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES[fileType]) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported file type',
        details: `File type ${fileType} is not allowed`
      });
    }

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category',
        details: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }


    // Create S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_S3_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    // Generate unique S3 key (path)
    const fileExtension = ALLOWED_FILE_TYPES[fileType] || 
                         filename.split('.').pop()?.toLowerCase() || 'bin';
    const timestamp = Date.now();
    const uniqueId = uuidv4().substring(0, 8);
    const safeFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    
    // Include user ID in path for organization
    const userId = user._id.toString();
    const s3Key = `focus_forms/${category}/${userId}/${safeFilename}_${timestamp}_${uniqueId}.${fileExtension}`;
    
    console.log(`[Presigned URL] Generating for user ${user.email}: ${s3Key}`);

    // Parameters for S3 upload
    const putObjectParams = {
      Bucket: process.env.AWS_S3_BUCKET || 'ib-project',
      Key: s3Key,
      ContentType: fileType,
      Metadata: {
        originalFilename: filename,
        uploadedBy: user._id.toString(),
        userEmail: user.email,
        userRole: user.role,
        uploadedAt: new Date().toISOString(),
        ...(user.tenantId && { tenantId: user.tenantId.toString() }),
        ...(associatedId && { associatedId: associatedId.toString() })
      }
    };

    // Generate presigned URL (valid for 15 minutes)
    const command = new PutObjectCommand(putObjectParams);
    const uploadUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: 900 // 15 minutes
    });

    // Public URL via CloudFront
    const cloudfrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN || 'd196xvstj956a9.cloudfront.net';
    const publicUrl = `https://${cloudfrontDomain}/${s3Key}`;

    console.log(`[Presigned URL] Generated for ${filename} by ${user.email}`);

    res.json({
      success: true,
      uploadUrl,     // For direct S3 upload
      key: s3Key,    // S3 path
      publicUrl,     // For accessing via CloudFront
      expiresAt: new Date(Date.now() + 900000).toISOString(), // 15 min from now
      metadata: {
        filename,
        fileType,
        category,
        uploadedBy: {
          id: user._id,
          email: user.email,
          role: user.role
        },
        ...(associatedId && { associatedId })
      }
    });

  } catch (error) {
    console.error('[Presigned URL] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate upload URL',
      details: error.message 
    });
  }
});

/**
 * Get upload history for current user
 * GET /api/upload/history
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0, category } = req.query;
    const user = req.user;
    
    // In a real implementation, you'd query a database
    // For now, return a placeholder response
    res.json({
      success: true,
      data: {
        uploads: [],
        total: 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      message: 'Upload history endpoint - implement database query'
    });
    
  } catch (error) {
    console.error('[Upload History] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch upload history'
    });
  }
});

/**
 * Delete file (mark as deleted in DB - actual S3 cleanup via lifecycle policy)
 * DELETE /api/upload/:fileId
 */
router.delete('/:fileId', authenticate, hasPermission('upload:delete'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const user = req.user;
    
    // In real implementation, you'd update DB record
    // S3 files can be deleted via lifecycle policies after DB marking
    
    res.json({
      success: true,
      message: 'File marked for deletion',
      fileId,
      deletedBy: user.email,
      deletedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Delete File] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete file'
    });
  }
});

/**
 * Test endpoint - no auth required
 */
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Upload service is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      presignedUrl: 'POST /api/upload/presigned-url',
      history: 'GET /api/upload/history',
      delete: 'DELETE /api/upload/:fileId'
    },
    limits: {
      maxFileSize: '10MB',
      allowedTypes: Object.keys(ALLOWED_FILE_TYPES)
    }
  });
});

export default router;