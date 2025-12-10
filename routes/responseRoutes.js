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
  exportResponses
} from '../controllers/responseController.js';
import { authenticate, adminOnly, teacherOrAdmin } from '../middleware/auth.js';
import { addTenantFilter } from '../middleware/tenantIsolation.js';
import { processResponseImages, processGoogleDriveImage } from '../services/googleDriveService.js';

const router = express.Router();

// Public routes for form submissions (no auth required)
router.post('/', createResponse);
router.post('/batch/import', batchImportResponses);

router.post('/process-images', async (req, res) => {
  try {
    const { answers } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: answers object required'
      });
    }

    console.log('[PROCESS IMAGES] Converting Google Drive URLs to Cloudinary for preview');

    let processedAnswers = answers;
    try {
      processedAnswers = await processResponseImages(answers);
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

// Protected routes
router.use(authenticate);
router.use(addTenantFilter);

// Form-specific responses (must come before generic /:id routes)
router.get('/form/:formId', getResponsesByForm);
router.get('/form/:formId/export', exportResponses);

// Response management
router.get('/', getAllResponses);
router.get('/:id', getResponseById);
router.put('/:id', updateResponse);
router.patch('/:id/assign', assignResponse);
router.delete('/:id', deleteResponse);
router.delete('/', deleteMultipleResponses);

export default router;
