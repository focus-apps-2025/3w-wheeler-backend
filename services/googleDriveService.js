import axios from 'axios';
import https from 'https';
import { uploadToCloudinary } from './cloudinaryService.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import sharp from 'sharp';

// Create optimized HTTP client with connection pooling
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ 
    keepAlive: true,
    maxSockets: 80, // Increased connection pool
    maxFreeSockets: 100,
    timeout: 60000
  }),
  timeout: 120000 // Increased timeout for batch operations
});

// Cache for already processed URLs (24-hour TTL)
const processedCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Helper functions
export const extractFileId = (url) => {
  if (!url || typeof url !== 'string') return null;
  
  const patterns = [
    /\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
    /file\/d\/([a-zA-Z0-9-_]+)/,
    /view\?id=([a-zA-Z0-9-_]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  
  return null;
};

export const isGoogleDriveUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return url.includes('drive.google.com') || extractFileId(url) !== null;
};

// Bulk download with intelligent batching
// Enhanced bulk download with retry logic
const bulkDownload = async (urls, batchSize = 15) => { // Reduced batch size
  const results = [];
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchPromises = batch.map(async (url) => {
      // Retry logic
      const downloadWithRetry = async (url, retries = 3) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            // Check cache first
            const cacheKey = `download_${url}`;
            if (processedCache.has(cacheKey)) {
              const cached = processedCache.get(cacheKey);
              if (Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
              }
            }
            
            const fileId = extractFileId(url);
            if (!fileId) {
              throw new Error(`Could not extract file ID from URL: ${url}`);
            }
            
            // Increase timeout for retries
            const timeout = 30000 * attempt; // 30s, 60s, 90s
            
            console.log(`Attempt ${attempt} for ${fileId} (timeout: ${timeout}ms)`);
            
            const response = await axiosInstance.get(
              `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
              {
                responseType: 'arraybuffer',
                timeout: timeout,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'image/*',
                  'Referer': 'https://drive.google.com/'
                }
              }
            );
            
            if (response.status !== 200) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentType = response.headers['content-type'] || 'image/jpeg';
            if (!contentType.startsWith('image/')) {
              console.warn(`Expected image, got ${contentType} for ${url}`);
              // Continue anyway as it might still be an image
            }
            
            const result = {
              url,
              buffer: Buffer.from(response.data),
              contentType,
              size: response.data.length,
              success: true
            };
            
            // Cache successful download
            processedCache.set(cacheKey, {
              data: result,
              timestamp: Date.now()
            });
            
            console.log(`✓ Downloaded ${fileId} (${response.data.length} bytes)`);
            return result;
            
          } catch (error) {
            console.warn(`Attempt ${attempt} failed for ${url}: ${error.message}`);
            
            if (attempt === retries) {
              return {
                url,
                error: error.message,
                success: false
              };
            }
            
            // Wait before retry (exponential backoff)
            const delay = 1000 * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };
      
      return await downloadWithRetry(url);
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);
    
    // Log batch progress
    const successful = batchResults.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;
    
    console.log(`Batch ${Math.floor(i/batchSize) + 1}: ${successful}/${batch.length} successful`);
    
    // Adaptive delay based on success rate
    const successRate = successful / batch.length;
    const delay = successRate < 0.5 ? 500 : 200;
    
    if (i + batchSize < urls.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return results;
};


// Compress image if it's too large
const compressImageIfNeeded = async (buffer, maxSizeMB = 5) => {
  try {
    const sizeInMB = buffer.length / (1024 * 1024);
    
    if (sizeInMB <= maxSizeMB) {
      console.log(`Image size: ${sizeInMB.toFixed(2)}MB (no compression needed)`);
      return buffer;
    }
    
    console.log(`Compressing large image: ${sizeInMB.toFixed(2)}MB -> target ${maxSizeMB}MB`);
    
    // Use sharp to compress
    const compressedBuffer = await sharp(buffer)
      .resize(1920, 1080, { // Resize to max 1920x1080
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ 
        quality: 80,
        mozjpeg: true 
      })
      .toBuffer();
    
    const compressedSizeMB = compressedBuffer.length / (1024 * 1024);
    console.log(`Compressed to: ${compressedSizeMB.toFixed(2)}MB (${Math.round((compressedSizeMB / sizeInMB) * 100)}% of original)`);
    
    return compressedBuffer;
    
  } catch (error) {
    console.error('Image compression failed:', error);
    return buffer; // Return original if compression fails
  }
};
// Bulk upload to Cloudinary with timeout handling
// Bulk upload to Cloudinary with compression
const bulkUpload = async (images, folder = 'focus_forms/response_images') => {
  const uploadPromises = images.map(async (image, index) => {
    if (!image || !image.success) {
      return {
        originalUrl: image?.url,
        error: image?.error || 'Download failed',
        success: false
      };
    }
    
    try {
      // Check if already uploaded
      const cacheKey = `upload_${image.url}`;
      if (processedCache.has(cacheKey)) {
        const cached = processedCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`Cache hit for ${image.url.substring(0, 50)}...`);
          return cached.data;
        }
      }
      
      // COMPRESS LARGE IMAGES
      console.log(`Original size: ${(image.size / (1024 * 1024)).toFixed(2)}MB`);
      let finalBuffer = image.buffer;
      
      if (image.size > 5 * 1024 * 1024) { // >5MB
        finalBuffer = await compressImageIfNeeded(image.buffer, 5);
      }
      
      const filename = `batch-${Date.now()}-${index}.jpg`;
      console.log(`Uploading: ${filename}`);
      
      const result = await uploadToCloudinary(
        finalBuffer,
        filename,
        folder
      );
      
      const uploadResult = {
        originalUrl: image.url,
        cloudinaryUrl: result.secure_url,
        publicId: result.public_id,
        success: true
      };
      
      // Cache successful upload
      processedCache.set(cacheKey, {
        data: uploadResult,
        timestamp: Date.now()
      });
      
      console.log(`✓ Uploaded: ${filename} (${(finalBuffer.length / (1024 * 1024)).toFixed(2)}MB)`);
      return uploadResult;
      
    } catch (error) {
      console.error(`❌ Upload failed for ${image.url}:`, error.message);
      
      // If timeout, try with smaller image
      if (error.message.includes('Timeout') || error.http_code === 499) {
        console.log('Retrying with compressed version...');
        try {
          // Force compress to very small size
          const compressedBuffer = await compressImageIfNeeded(image.buffer, 2); // 2MB max
          
          const filename = `batch-compressed-${Date.now()}-${index}.jpg`;
          const result = await uploadToCloudinary(
            compressedBuffer,
            filename,
            folder
          );
          
          const uploadResult = {
            originalUrl: image.url,
            cloudinaryUrl: result.secure_url,
            publicId: result.public_id,
            success: true
          };
          
          console.log(`✓ Uploaded compressed version: ${filename}`);
          return uploadResult;
          
        } catch (retryError) {
          console.error('Retry also failed:', retryError.message);
        }
      }
      
      return {
        originalUrl: image.url,
        error: error.message,
        success: false
      };
    }
  });
  
  // Process uploads in VERY SMALL batches
  const batchSize = 5; // Only 5 at a time
  const results = [];
  
  for (let i = 0; i < uploadPromises.length; i += batchSize) {
    const batch = uploadPromises.slice(i, i + batchSize);
    console.log(`Upload batch ${Math.floor(i/batchSize) + 1}: ${i+1}-${Math.min(i+batchSize, uploadPromises.length)}`);
    
    const batchResults = await Promise.allSettled(batch);
    results.push(...batchResults);
    
    // Longer delay between batches
    if (i + batchSize < uploadPromises.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }
  
  return results;
};

// Worker thread for parallel processing
const createWorker = (imageUrls, questionIds) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { imageUrls, questionIds }
    });
    
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
};

// Worker thread logic
if (!isMainThread) {
  const { imageUrls, questionIds } = workerData;
  
  (async () => {
    try {
      // Add overall timeout for worker (5 minutes)
      const workerTimeout = setTimeout(() => {
        console.error('Worker timeout reached');
        parentPort.postMessage({ 
          success: false, 
          error: 'Worker timeout after 5 minutes',
          results: []
        });
      }, 5 * 60 * 1000);
      
      const downloads = await bulkDownload(imageUrls);
      const validDownloads = downloads
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map(r => r.value);
      
      console.log(`Worker: ${validDownloads.length}/${imageUrls.length} downloads successful`);
      
      const uploads = await bulkUpload(validDownloads);
      
      const results = uploads
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map((r, index) => ({
          questionId: questionIds[index],
          originalUrl: r.value.originalUrl,
          cloudinaryUrl: r.value.cloudinaryUrl,
          success: true
        }));
      
      clearTimeout(workerTimeout);
      
      console.log(`Worker: ${results.length}/${validDownloads.length} uploads successful`);
      parentPort.postMessage({ success: true, results });
      
    } catch (error) {
      console.error('Worker error:', error);
      parentPort.postMessage({ 
        success: false, 
        error: error.message,
        results: []
      });
    }
  })();
}

// Main processing function with worker threads
export const processResponseImages = async (answers, onProgress = null, batchId = null) => {
  try {
    console.log(`[BATCH ${batchId || 'PROCESS'}] Starting optimized image processing`);
    
    if (!answers || (typeof answers !== 'object' && !(answers instanceof Map))) {
      return answers;
    }
    
    // Convert to entries
    const entries = answers instanceof Map ? 
      Array.from(answers.entries()) : 
      Object.entries(answers);
    
    // Collect all Google Drive URLs
    const imageTasks = [];
    entries.forEach(([questionId, answer]) => {
      if (!answer) return;
      
      if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
        imageTasks.push({
          questionId,
          url: answer,
          type: 'single'
        });
      } else if (Array.isArray(answer)) {
        answer.forEach((item, index) => {
          if (typeof item === 'string' && isGoogleDriveUrl(item)) {
            imageTasks.push({
              questionId,
              url: item,
              type: 'array',
              arrayIndex: index
            });
          }
        });
      }
    });
    
    const totalImages = imageTasks.length;
    console.log(`[BATCH ${batchId || 'PROCESS'}] Found ${totalImages} Google Drive images to process`);
    
    if (totalImages === 0) {
      return answers;
    }
    
    // Progress callback setup
   let processedCount = 0;
const updateProgress = (increment = 1, message = null) => {
  processedCount += increment;
  if (onProgress) {
    onProgress({
      currentImage: processedCount,
      totalImages,
      status: 'processing',
      message: message || `Processing ${processedCount}/${totalImages} images...`,
      percentage: Math.round((processedCount / totalImages) * 100)
    });
  }
};

// Add initial progress
if (onProgress) {
  onProgress({
    currentImage: 0,
    totalImages,
    status: 'starting',
    message: `Starting processing of ${totalImages} images...`,
    percentage: 0
  });
}
    
    // Split into chunks for parallel processing
    const cpuCount = Math.max(1, cpus().length - 1); // Leave one CPU free
    const chunkSize = Math.ceil(totalImages / cpuCount);
    const chunks = [];
    
    for (let i = 0; i < totalImages; i += chunkSize) {
      const chunk = imageTasks.slice(i, i + chunkSize);
      chunks.push(chunk);
    }
    
    console.log(`[BATCH ${batchId || 'PROCESS'}] Using ${chunks.length} worker threads`);
    
    // Process chunks in parallel using worker threads
    const workerPromises = chunks.map((chunk, index) => {
      const imageUrls = chunk.map(t => t.url);
      const questionIds = chunk.map(t => t.questionId);
      
      return createWorker(imageUrls, questionIds)
        .then(result => {
          updateProgress(chunk.length);
          return result;
        })
        .catch(error => {
          console.error(`Worker ${index} failed:`, error);
          return { success: false, results: [] };
        });
    });
    
    const workerResults = await Promise.allSettled(workerPromises);
    
    // Combine results from all workers
    const processedResults = new Map();
    const successfulResults = [];
    
    workerResults.forEach((result, workerIndex) => {
      if (result.status === 'fulfilled' && result.value.success) {
        result.value.results.forEach(res => {
          successfulResults.push(res);
        });
      }
    });
    
    console.log(`[BATCH ${batchId || 'PROCESS'}] Successfully processed ${successfulResults.length}/${totalImages} images`);
    
    // Group results by question ID
    successfulResults.forEach(result => {
      if (!processedResults.has(result.questionId)) {
        processedResults.set(result.questionId, {});
      }
      const questionData = processedResults.get(result.questionId);
      questionData[result.originalUrl] = result.cloudinaryUrl;
    });
    
    // Update answers with processed URLs
    const processedAnswers = answers instanceof Map ? new Map(answers) : { ...answers };
    
    entries.forEach(([questionId, answer]) => {
      if (!answer) return;
      
      const replacements = processedResults.get(questionId);
      if (!replacements) return;
      
      if (typeof answer === 'string' && replacements[answer]) {
        if (answers instanceof Map) {
          processedAnswers.set(questionId, replacements[answer]);
        } else {
          processedAnswers[questionId] = replacements[answer];
        }
      } else if (Array.isArray(answer)) {
        const updatedArray = answer.map(item => 
          (typeof item === 'string' && replacements[item]) ? replacements[item] : item
        );
        
        if (answers instanceof Map) {
          processedAnswers.set(questionId, updatedArray);
        } else {
          processedAnswers[questionId] = updatedArray;
        }
      }
    });
    
    // Final progress update
    if (onProgress) {
      onProgress({
        currentImage: totalImages,
        totalImages,
        status: 'complete',
        message: `✓ Processed ${successfulResults.length}/${totalImages} images successfully`,
        percentage: 100
      });
    }
    
    console.log(`[BATCH ${batchId || 'PROCESS'}] Image processing complete`);
    return processedAnswers;
    
  } catch (error) {
    console.error('[IMAGE PROCESS] Major error:', error);
    
    if (onProgress) {
      onProgress({
        status: 'error',
        message: `Processing failed: ${error.message}`,
        error: error.message
      });
    }
    
    // Return original answers as fallback
    return answers;
  }
};

// Quick single image processing (for backward compatibility)
export const processGoogleDriveImage = async (imageUrl, questionId) => {
  try {
    if (!isGoogleDriveUrl(imageUrl)) {
      return imageUrl;
    }
    
    const results = await processResponseImages(
      { [questionId]: imageUrl },
      null,
      `single-${questionId}`
    );
    
    return results[questionId] || imageUrl;
  } catch (error) {
    console.error(`Single image processing failed for ${questionId}:`, error);
    return imageUrl;
  }
};

// Clear cache (useful for testing or memory management)
export const clearProcessedCache = () => {
  processedCache.clear();
  console.log('[IMAGE PROCESS] Cache cleared');
};

// Get cache statistics
export const getCacheStats = () => {
  return {
    size: processedCache.size,
    entries: Array.from(processedCache.entries()).map(([key, value]) => ({
      key: key.substring(0, 50) + '...',
      timestamp: value.timestamp,
      age: Date.now() - value.timestamp
    }))
  };
};