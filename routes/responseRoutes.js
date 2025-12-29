import express from 'express';
import {
  createResponse,
  batchImportResponses,
  getAllResponses,
  getResponseById,
  updateResponse,
  assignResponse,
  deleteResponse,
  deleteMultipleResponses,
  getResponsesByForm,
  exportResponses,
  processBulkImages,
} from '../controllers/responseController.js';
import { authenticate, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';
import { processResponseImages, processGoogleDriveImage } from '../services/googleDriveService.js';

const router = express.Router();

// DEBUG: Log when this router is loaded
console.log('Response router loaded');

// ========== PUBLIC ROUTES (No Auth) ==========

// 1. Add a test route first
router.get('/test-route', (req, res) => {
  console.log('Test route hit!');
  res.json({ success: true, message: 'Test route works!' });
});

// 2. BATCH IMPORT route - define it clearly

// 3. BULK IMAGE PROCESSING
router.post('/process-bulk-images', processBulkImages);

// 4. SINGLE IMAGE PROCESSING
router.post('/process-images', async (req, res) => {
  try {
    const { answers, submissionId } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: answers object required'
      });
    }

    console.log('[PROCESS IMAGES] Converting Google Drive URLs to Cloudinary for preview');

    let processedAnswers = answers;
    try {
      const onProgress = submissionId ? (progressData) => {
        const io = req.app.get('io');
        if (io) {
          io.to(submissionId).emit('image-progress', {
            submissionId,
            status: progressData
          });
          console.log(`[PROGRESS] ${progressData.currentImage}/${progressData.totalImages}`);
        }
      } : null;

      processedAnswers = await processResponseImages(answers, onProgress);
      console.log('[PROCESS IMAGES] Successfully processed all images');
    } catch (error) {
      console.error('[PROCESS IMAGES] Failed to process images:', error.message);
      return res.status(400).json({
        success: false,
        message: 'Failed to process images: ' + error.message
      });
    }

    res.status(200).json({
      success: true,
      data: processedAnswers
    });

  } catch (error) {
    console.error('Process images error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during image processing'
    });
  }
});

// 5. SINGLE IMAGE CONVERSION
router.post('/convert-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: imageUrl (string) required'
      });
    }

    console.log('[CONVERT IMAGE] Converting single image URL to Cloudinary');

    const cloudinaryUrl = await processGoogleDriveImage(imageUrl, 'display');
    
    res.status(200).json({
      success: true,
      data: {
        cloudinaryUrl
      }
    });

  } catch (error) {
    console.error('Convert image error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during image conversion'
    });
  }
});

// 6. SINGLE RESPONSE CREATION
router.post('/:tenantSlug/forms/:formId/responses', createResponse);

// ========== PROTECTED ROUTES (Require Auth) ==========
router.use(authenticate);
router.use(addTenantFilter);

router.post('/batch/import', batchImportResponses);

// Form-specific responses
router.get('/form/:formId', getResponsesByForm);
router.get('/form/:formId/export', exportResponses);

// Response management
router.get('/', getAllResponses);
router.post('/', createResponse);
router.get('/:id', getResponseById);
router.put('/:id', updateResponse);
router.patch('/:id/assign', assignResponse);
router.delete('/:id', deleteResponse);
router.delete('/', deleteMultipleResponses);

// DEBUG: Log all registered routes
console.log('\n=== Registered Response Routes ===');
router.stack.forEach((layer) => {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
    console.log(`${methods} ${layer.route.path}`);
  } else if (layer.name === 'router') {
    // This is a nested router
    console.log(`Nested router at: ${layer.regexp}`);
  }
});
console.log('=== End Registered Routes ===\n');

export default router;