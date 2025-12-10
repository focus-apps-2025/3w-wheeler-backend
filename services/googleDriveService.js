import axios from 'axios';
import { uploadToCloudinary } from './cloudinaryService.js';

const extractFileId = (url) => {
  if (!url || typeof url !== 'string') return null;
  
  const patterns = [
    /\/d\/([a-zA-Z0-9-_]+)/,
    /[?&]id=([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  
  return null;
};

const isGoogleDriveUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return url.includes('drive.google.com') || extractFileId(url) !== null;
};

const downloadFromGoogleDrive = async (fileId) => {
  try {
    const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    
    console.log(`[IMAGE PROCESS] Downloading from Google Drive: ${fileId}`);
    const response = await axios.get(confirmUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/*,*/*',
        'Referer': 'https://drive.google.com/'
      },
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: Failed to download from Google Drive`);
    }

    const contentType = response.headers['content-type'] || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.warn(`[IMAGE PROCESS] Unexpected content type: ${contentType}`);
      throw new Error(`Google Drive returned non-image content: ${contentType}`);
    }

    console.log(`[IMAGE PROCESS] Download successful: ${response.data.length} bytes`);
    return {
      buffer: Buffer.from(response.data),
      contentType: contentType,
      size: response.data.length
    };
  } catch (error) {
    console.error(`[IMAGE PROCESS] Download error for ${fileId}:`, error.message);
    throw new Error(`Failed to download image from Google Drive: ${error.message}`);
  }
};

export const processGoogleDriveImage = async (imageUrl, questionId, onProgress = null) => {
  try {
    console.log(`[IMAGE PROCESS] Starting: ${imageUrl.substring(0, 60)}...`);
    
    if (!isGoogleDriveUrl(imageUrl)) {
      console.log('[IMAGE PROCESS] Not a Google Drive URL, skipping');
      return imageUrl;
    }

    const fileId = extractFileId(imageUrl);
    if (!fileId) {
      console.log('[IMAGE PROCESS] Could not extract file ID, skipping');
      return imageUrl;
    }

    if (onProgress) {
      onProgress({
        status: 'converting',
        message: 'Downloading from Google Drive...',
        questionId
      });
    }

    console.log(`[IMAGE PROCESS] Downloading from Google Drive: ${fileId}`);
    const imageData = await downloadFromGoogleDrive(fileId);
    
    if (onProgress) {
      onProgress({
        status: 'uploading',
        message: 'Uploading to Cloudinary...',
        questionId
      });
    }

    const filename = `response-image-${questionId}-${Date.now()}.jpg`;
    const folder = 'focus_forms/response_images';
    
    console.log(`[IMAGE PROCESS] Uploading to Cloudinary: ${filename}`);
    const cloudinaryResult = await uploadToCloudinary(
      imageData.buffer,
      filename,
      folder
    );

    console.log(`[IMAGE PROCESS] ✓ Success: ${cloudinaryResult.secure_url.substring(0, 80)}...`);
    return cloudinaryResult.secure_url;
  } catch (error) {
    console.error('[IMAGE PROCESS] ✗ Error:', error.message);
    console.error('[IMAGE PROCESS] Original URL returned as fallback');
    return imageUrl;
  }
};

export const processResponseImages = async (answers, onProgress = null) => {
  if (!answers) {
    return answers;
  }

  let entries = [];
  
  if (answers instanceof Map) {
    entries = Array.from(answers.entries());
  } else if (typeof answers === 'object') {
    entries = Object.entries(answers);
  } else {
    return answers;
  }

  const processedAnswers = answers instanceof Map ? new Map() : { ...answers };
  let imageCount = 0;
  let processedCount = 0;

  for (const [questionId, answer] of entries) {
    if (!answer) {
      if (answers instanceof Map) {
        processedAnswers.set(questionId, answer);
      } else {
        processedAnswers[questionId] = answer;
      }
      continue;
    }

    if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
      imageCount++;
    }
  }

  for (const [questionId, answer] of entries) {
    if (!answer) {
      if (answers instanceof Map) {
        processedAnswers.set(questionId, answer);
      } else {
        processedAnswers[questionId] = answer;
      }
      continue;
    }

    if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
      try {
        processedCount++;
        const processed = await processGoogleDriveImage(answer, questionId, onProgress ? (status) => {
          onProgress({
            ...status,
            currentImage: processedCount,
            totalImages: imageCount
          });
        } : null);
        if (answers instanceof Map) {
          processedAnswers.set(questionId, processed);
        } else {
          processedAnswers[questionId] = processed;
        }
      } catch (error) {
        console.error(`Failed to process image for question ${questionId}:`, error);
        if (answers instanceof Map) {
          processedAnswers.set(questionId, answer);
        } else {
          processedAnswers[questionId] = answer;
        }
      }
    } else if (Array.isArray(answer)) {
      const processed = await Promise.all(
        answer.map(async (item) => {
          if (typeof item === 'string' && isGoogleDriveUrl(item)) {
            try {
              return await processGoogleDriveImage(item, questionId);
            } catch (error) {
              console.error(`Failed to process array image for question ${questionId}:`, error);
              return item;
            }
          }
          return item;
        })
      );
      if (answers instanceof Map) {
        processedAnswers.set(questionId, processed);
      } else {
        processedAnswers[questionId] = processed;
      }
    } else {
      if (answers instanceof Map) {
        processedAnswers.set(questionId, answer);
      } else {
        processedAnswers[questionId] = answer;
      }
    }
  }

  return processedAnswers;
};

export { isGoogleDriveUrl, extractFileId };
