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

const processWithConcurrency = async (tasks, concurrency = 15, onProgress = null) => {
  const results = new Array(tasks.length);
  let completed = 0;

  const processTask = async (index) => {
    const task = tasks[index];
    try {
      results[index] = await task();
      completed++;
      if (onProgress) {
        onProgress(completed, tasks.length);
      }
    } catch (error) {
      results[index] = error;
    }
  };

  const queue = Array.from({ length: Math.min(concurrency, tasks.length) }, (_, i) => 
    (async () => {
      let index = i;
      while (index < tasks.length) {
        await processTask(index);
        index += concurrency;
      }
    })()
  );

  await Promise.all(queue);
  return results;
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
  const imageTasks = [];
  const imageMap = new Map();
  
  for (const [questionId, answer] of entries) {
    if (!answer) continue;

    if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
      const taskIndex = imageTasks.length;
      imageMap.set(taskIndex, { questionId, answer, type: 'single' });
      imageTasks.push(async () => {
        return await processGoogleDriveImage(answer, questionId);
      });
    } else if (Array.isArray(answer)) {
      const arrayTasks = answer.map((item, itemIndex) => {
        if (typeof item === 'string' && isGoogleDriveUrl(item)) {
          const taskIndex = imageTasks.length;
          imageMap.set(taskIndex, { questionId, itemIndex, type: 'array' });
          imageTasks.push(async () => {
            return await processGoogleDriveImage(item, questionId);
          });
          return taskIndex;
        }
        return null;
      });
      
      if (!arrayTasks.every(t => t === null)) {
        imageMap.set(`array_${questionId}`, { questionId, answer, arrayTasks });
      }
    }
  }

  const totalImages = imageTasks.length;
  
  if (totalImages > 0) {
    console.log(`[BATCH PROCESS] Processing ${totalImages} images concurrently...`);
    const concurrencyLevel = Math.min(50, Math.max(15, Math.ceil(totalImages / 10)));
    console.log(`[BATCH PROCESS] Concurrency level: ${concurrencyLevel}`);
    const results = await processWithConcurrency(imageTasks, concurrencyLevel, (completed) => {
      if (onProgress) {
        onProgress({
          currentImage: completed,
          totalImages: totalImages,
          status: 'converting',
          message: `Converting image ${completed}/${totalImages}...`
        });
      }
    });

    let resultIndex = 0;
    for (const [questionId, answer] of entries) {
      if (!answer) continue;

      if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
        const taskInfo = imageMap.get(resultIndex);
        if (taskInfo && taskInfo.type === 'single') {
          const result = results[resultIndex];
          if (result instanceof Error) {
            if (answers instanceof Map) {
              processedAnswers.set(questionId, answer);
            } else {
              processedAnswers[questionId] = answer;
            }
          } else {
            if (answers instanceof Map) {
              processedAnswers.set(questionId, result);
            } else {
              processedAnswers[questionId] = result;
            }
          }
        }
        resultIndex++;
      } else if (Array.isArray(answer)) {
        const processed = answer.map((item, itemIndex) => {
          if (typeof item === 'string' && isGoogleDriveUrl(item)) {
            const taskInfo = imageMap.get(resultIndex);
            if (taskInfo && taskInfo.type === 'array') {
              const result = results[resultIndex];
              resultIndex++;
              return result instanceof Error ? item : result;
            }
            resultIndex++;
            return item;
          }
          return item;
        });
        
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
  } else {
    for (const [questionId, answer] of entries) {
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
