import Response from '../models/Response.js';
import Form from '../models/Form.js';
import Tenant from '../models/Tenant.js';
import { v4 as uuidv4 } from 'uuid';
import { collectSubmissionMetadata } from '../services/locationService.js';
import { emitResponseCreated, emitResponseUpdated, emitResponseDeleted, emitImageProgress } from '../socket/socketHandler.js';
import { processResponseImages } from '../services/googleDriveService.js';
import { isGoogleDriveUrl } from '../services/googleDriveService.js';

export const createResponse = async (req, res) => {
  try {
    const { questionId, answers, parentResponseId, submittedBy, submitterContact, submissionMetadata: bodyMetadata } = req.body;
    const { tenantSlug } = req.params;

    let form;

    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });

      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or inactive'
        });
      }

      form = await Form.findOne({ id: questionId, tenantId: tenant._id, isVisible: true });

      if (!form) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }
    } else {
      form = await Form.findOne({ id: questionId, ...req.tenantFilter });

      if (!form) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }

      if (!form.isVisible && (!req.user || !req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Form is not publicly available'
        });
      }
    }

    const submissionMetadata = await collectSubmissionMetadata(req, {
      includeLocation: form.locationEnabled !== false,
    });

    if (bodyMetadata && bodyMetadata.source) {
      submissionMetadata.source = bodyMetadata.source;
    }

    if (form.locationEnabled !== false && req.body.location && typeof req.body.location === 'object') {
      const { latitude, longitude, accuracy, source, capturedAt, city, region, country } = req.body.location;
      submissionMetadata.capturedLocation = {
        latitude: typeof latitude === 'number' ? latitude : null,
        longitude: typeof longitude === 'number' ? longitude : null,
        accuracy: typeof accuracy === 'number' ? accuracy : null,
        source: typeof source === 'string' ? source : 'browser',
        city: typeof city === 'string' ? city : null,
        region: typeof region === 'string' ? region : null,
        country: typeof country === 'string' ? country : null,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date()
      };
      console.log('[DEBUG] Captured location stored:', submissionMetadata.capturedLocation);
    }

    // Calculate score for quiz forms
    const allQuestions = [];
    if (form.sections) {
      form.sections.forEach(section => {
        if (section.questions) {
          allQuestions.push(...section.questions);
        }
      });
    }
    if (form.followUpQuestions) {
      allQuestions.push(...form.followUpQuestions);
    }

    let correct = 0;
    let total = 0;
    const questionResults = {}; // Store individual question results
    
    allQuestions.forEach(question => {
      // Handle yesNoNA type questions (auto-scoring)
      if (question.type === 'yesNoNA') {
        total++;
        const answer = answers[question.id];
        let isCorrect = false;
        
        // Yes = 1 point, No and N/A = 0 points
        if (answer && String(answer).toLowerCase() === 'yes') {
          isCorrect = true;
          correct++;
        }
        
        questionResults[question.id] = {
          isCorrect,
          userAnswer: answer,
          questionType: 'yesNoNA',
          scoring: { yes: 1, no: 0, nOrNA: 0 }
        };
      } 
      // Check if question has correct answer(s)
      else {
        const hasCorrectAnswer = question.correctAnswer || (question.correctAnswers && question.correctAnswers.length > 0);
        
        if (hasCorrectAnswer) {
          total++;
          const answer = answers[question.id];
          let isCorrect = false;

          // Handle multiple correct answers
          if (question.correctAnswers && question.correctAnswers.length > 0) {
            if (Array.isArray(answer)) {
              // For checkbox questions - check if all selected answers are correct
              const normalizedAnswer = answer.map(a => String(a).toLowerCase());
              const normalizedCorrect = question.correctAnswers.map(a => String(a).toLowerCase());
              isCorrect = normalizedAnswer.length === normalizedCorrect.length &&
                         normalizedAnswer.every(a => normalizedCorrect.includes(a));
            } else {
              // Single answer - check if it's in the correct answers array
              const normalizedAnswer = String(answer).toLowerCase();
              const normalizedCorrect = question.correctAnswers.map(a => String(a).toLowerCase());
              isCorrect = normalizedCorrect.includes(normalizedAnswer);
            }
          } 
          // Handle single correct answer (backward compatibility)
          else if (question.correctAnswer) {
            if (Array.isArray(answer)) {
              // If answer is array but only one correct answer, check if array contains it
              isCorrect = answer.some(a => String(a).toLowerCase() === String(question.correctAnswer).toLowerCase());
            } else {
              isCorrect = String(answer).toLowerCase() === String(question.correctAnswer).toLowerCase();
            }
          }

          if (isCorrect) {
            correct++;
          }
          
          questionResults[question.id] = {
            isCorrect,
            userAnswer: answer,
            correctAnswer: question.correctAnswers || [question.correctAnswer]
          };
        }
      }
    });

    let processedAnswers = answers;
    try {
      processedAnswers = await processResponseImages(answers);
      console.log('[DEBUG] Processed answers with Google Drive images:', Object.keys(processedAnswers));
    } catch (error) {
      console.error('[ERROR] Failed to process Google Drive images:', error);
    }

    const responseData = {
      id: uuidv4(),
      questionId,
      answers: new Map(Object.entries(processedAnswers)),
      parentResponseId,
      submittedBy,
      submitterContact,
      submissionMetadata,
      status: 'pending',
      tenantId: form.tenantId,
      score: { correct, total }
    };

    const response = new Response(responseData);
    await response.save();

    const answersObj = response.answers instanceof Map ? Object.fromEntries(response.answers) : response.answers;

    // Emit real-time event for new response
    emitResponseCreated(questionId, {
      id: response.id,
      questionId: response.questionId,
      status: response.status,
      submittedBy: response.submittedBy,
      createdAt: response.createdAt,
      answers: answersObj
    });

    res.status(201).json({
      success: true,
      message: 'Response submitted successfully',
      data: { 
        response: {
          id: response.id,
          questionId: response.questionId,
          answers: answersObj,
          parentResponseId: response.parentResponseId,
          submittedBy: response.submittedBy,
          submitterContact: response.submitterContact,
          status: response.status,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt
        },
        score: {
          correct,
          total,
          percentage: total > 0 ? Math.round((correct / total) * 100) : 0
        }
      }
    });

  } catch (error) {
    console.error('Create response error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const batchImportResponses = async (req, res) => {
  // Declare batchId at the function scope
  let batchId;
  
  try {
    console.log('=== BATCH IMPORT ===');
    
    const { questionId, questionID, responses } = req.body;
    const actualQuestionId = questionId || questionID;
    
    // Set batchId at function scope
    batchId = req.body.batchId || `batch-${Date.now()}`;
    
    console.log('Batch ID:', batchId);
    console.log('Searching for form ID:', actualQuestionId);
    
    if (!actualQuestionId || !Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }
    
    // Find form (without isVisible check for now)
    const form = await Form.findOne({ id: actualQuestionId });
   
    // STEP 1: Collect ALL Google Drive URLs from ALL responses FIRST
    console.log(`[BATCH ${batchId}] Collecting all Google Drive URLs from ${responses.length} responses`);
    
    const allGoogleDriveUrls = [];
    const urlToResponseMap = new Map();
    
    responses.forEach((response, responseIndex) => {
      const { answers } = response;
      
      if (!answers || typeof answers !== 'object') return;
      
      Object.entries(answers).forEach(([questionId, answer]) => {
        if (!answer) return;
        
        if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
          const urlKey = `${responseIndex}_${questionId}`;
          allGoogleDriveUrls.push({
            url: answer,
            questionId,
            responseIndex,
            type: 'single'
          });
          urlToResponseMap.set(urlKey, answer);
        } else if (Array.isArray(answer)) {
          answer.forEach((item, itemIndex) => {
            if (typeof item === 'string' && isGoogleDriveUrl(item)) {
              const urlKey = `${responseIndex}_${questionId}_${itemIndex}`;
              allGoogleDriveUrls.push({
                url: item,
                questionId,
                responseIndex,
                arrayIndex: itemIndex,
                type: 'array'
              });
              urlToResponseMap.set(urlKey, item);
            }
          });
        }
      });
    });
    
    console.log(`[BATCH ${batchId}] Found ${allGoogleDriveUrls.length} Google Drive URLs to process`);
    
    // STEP 2: Process ALL images in BATCH using optimized service
    const createdResponses = [];
    const errors = [];
    
    if (allGoogleDriveUrls.length > 0) {
      try {
        // Emit initial progress
        emitImageProgress(batchId, {
          processed: 0,
          total: allGoogleDriveUrls.length,
          status: 'processing',
          message: `Starting batch processing of ${allGoogleDriveUrls.length} images...`
        });
        
        // Create a single answers object with ALL URLs for batch processing
        const batchAnswers = {};
        const urlMapping = {};
        
        allGoogleDriveUrls.forEach((item, index) => {
          const uniqueKey = `batch_${index}`;
          batchAnswers[uniqueKey] = item.url;
          urlMapping[uniqueKey] = item;
        });
        
        // Process ALL images at once with optimized function
        const onProgressCallback = (progress) => {
          emitImageProgress(batchId, {
            processed: progress.currentImage,
            total: progress.totalImages,
            status: progress.status,
            message: progress.message || `Processing images...`,
            percentage: progress.percentage
          });
        };
        
        const processedBatch = await processResponseImages(
          batchAnswers, 
          onProgressCallback, 
          batchId
        );
        
        // Create mapping of original URL -> Cloudinary URL
        const processedUrlMap = new Map();
        Object.entries(processedBatch).forEach(([uniqueKey, cloudinaryUrl]) => {
          const item = urlMapping[uniqueKey];
          if (item && cloudinaryUrl !== item.url) {
            processedUrlMap.set(item.url, cloudinaryUrl);
          }
        });
        
        console.log(`[BATCH ${batchId}] Successfully processed ${processedUrlMap.size}/${allGoogleDriveUrls.length} URLs`);
        
        // STEP 3: Process each response with already converted URLs
        for (let index = 0; index < responses.length; index++) {
          try {
            const { answers, submittedBy, submitterContact, parentResponseId } = responses[index];
            
            // Replace Google Drive URLs with Cloudinary URLs in this response
            const processedAnswers = {};
            Object.entries(answers).forEach(([questionId, answer]) => {
              if (!answer) {
                processedAnswers[questionId] = answer;
                return;
              }
              
              if (typeof answer === 'string' && isGoogleDriveUrl(answer)) {
                // Replace with processed URL if available
                processedAnswers[questionId] = processedUrlMap.get(answer) || answer;
              } else if (Array.isArray(answer)) {
                // Process array answers
                processedAnswers[questionId] = answer.map(item => 
                  (typeof item === 'string' && isGoogleDriveUrl(item)) 
                    ? (processedUrlMap.get(item) || item) 
                    : item
                );
              } else {
                processedAnswers[questionId] = answer;
              }
            });
            
            const submissionMetadata = await collectSubmissionMetadata(req, {
              includeLocation: form.locationEnabled !== false,
            });
            
            const allQuestions = [];
            if (form.sections) {
              form.sections.forEach(section => {
                if (section.questions) {
                  allQuestions.push(...section.questions);
                }
              });
            }
            if (form.followUpQuestions) {
              allQuestions.push(...form.followUpQuestions);
            }
            
            let correct = 0;
            let total = 0;
            
            allQuestions.forEach(question => {
              if (question.type === 'yesNoNA') {
                total++;
                const answer = processedAnswers[question.id];
                if (answer && String(answer).toLowerCase() === 'yes') {
                  correct++;
                }
              }
            });
            
            const responseData = {
              id: uuidv4(),
              questionId: actualQuestionId,
              answers: new Map(Object.entries(processedAnswers)),
              parentResponseId,
              submittedBy,
              submitterContact,
              submissionMetadata,
              status: 'pending',
              tenantId: form.tenantId,
              score: { correct, total }
            };
            
            const response = new Response(responseData);
            await response.save();
            
            const answersObj = response.answers instanceof Map ? 
              Object.fromEntries(response.answers) : response.answers;
            
            emitResponseCreated(actualQuestionId, {
              id: response.id,
              questionId: response.questionId,
              status: response.status,
              submittedBy: response.submittedBy,
              createdAt: response.createdAt,
              answers: answersObj
            });
            
            createdResponses.push({
              id: response.id,
              submittedBy: response.submittedBy,
              status: 'success'
            });
            
            console.log(`[BATCH ${batchId}] Response ${index + 1}/${responses.length} saved successfully`);
            
          } catch (error) {
            console.error(`[BATCH ${batchId}] Response ${index + 1} error:`, error.message);
            errors.push({
              index,
              submittedBy: responses[index].submittedBy,
              error: error.message
            });
          }
        }
        
        // Emit completion progress
        emitImageProgress(batchId, {
          processed: allGoogleDriveUrls.length,
          total: allGoogleDriveUrls.length,
          status: 'complete',
          message: `✓ Batch processing complete: ${createdResponses.length}/${responses.length} responses saved`
        });
        
      } catch (error) {
        console.error(`[BATCH ${batchId}] Batch processing error:`, error);
        errors.push({
          index: 'batch',
          submittedBy: 'batch',
          error: error.message
        });
      }
      
      // SEND RESPONSE FOR IMAGES PATH
      console.log(`[BATCH ${batchId}] Sending success response (with images)`);
      return res.status(201).json({
        success: true,
        message: `Batch import completed: ${createdResponses.length} responses imported successfully`,
        data: {
          imported: createdResponses.length,
          total: responses.length,
          failed: errors.length,
          createdResponses,
           imageConversion: {
            total: allGoogleDriveUrls.length,
            converted: allGoogleDriveUrls.length,
            status: allGoogleDriveUrls.length > 0 ? "completed" : "not_required",
            batchId
          },
          errors: errors.length > 0 ? errors : undefined
        }
      });
      
    } else {
      // No images to process, just save responses directly
      console.log(`[BATCH ${batchId}] No images to process, saving ${responses.length} responses directly`);
      
      // Initialize arrays here too (in case they weren't initialized above)
      const createdResponses = [];
      const errors = [];
      
      for (let index = 0; index < responses.length; index++) {
        try {
          const { answers, submittedBy, submitterContact, parentResponseId } = responses[index];
          
          // Process answers (convert to proper format)
          const processedAnswers = {};
          if (answers && typeof answers === 'object') {
            Object.entries(answers).forEach(([questionId, answer]) => {
              processedAnswers[questionId] = answer;
            });
          }
          
          const submissionMetadata = await collectSubmissionMetadata(req, {
            includeLocation: form.locationEnabled !== false,
          });
          
          // Get all questions from form for scoring
          const allQuestions = [];
          if (form.sections) {
            form.sections.forEach(section => {
              if (section.questions) {
                allQuestions.push(...section.questions);
              }
            });
          }
          if (form.followUpQuestions) {
            allQuestions.push(...form.followUpQuestions);
          }
          
          // Calculate score for yesNoNA questions
          let correct = 0;
          let total = 0;
          allQuestions.forEach(question => {
            if (question.type === 'yesNoNA') {
              total++;
              const answer = processedAnswers[question.id];
              if (answer && String(answer).toLowerCase() === 'yes') {
                correct++;
              }
            }
          });
          
          // Create response data
          const responseData = {
            id: uuidv4(),
            questionId: actualQuestionId,
            answers: new Map(Object.entries(processedAnswers)),
            parentResponseId,
            submittedBy: submittedBy || 'Excel Import',
            submitterContact,
            submissionMetadata,
            status: 'pending',
            tenantId: form.tenantId,
            score: { correct, total }
          };
          
          // Save to database
          const response = new Response(responseData);
          await response.save();
          
          // Convert Map to Object for emitting
          const answersObj = response.answers instanceof Map ? 
            Object.fromEntries(response.answers) : response.answers;
          
          // Emit event if function exists
          if (typeof emitResponseCreated === 'function') {
            emitResponseCreated(actualQuestionId, {
              id: response.id,
              questionId: response.questionId,
              status: response.status,
              submittedBy: response.submittedBy,
              createdAt: response.createdAt,
              answers: answersObj
            });
          }
          
          // Track created response
          createdResponses.push({
            id: response.id,
            submittedBy: response.submittedBy,
            status: 'success'
          });
          
          console.log(`[BATCH ${batchId}] Response ${index + 1}/${responses.length} saved successfully`);
          
        } catch (error) {
          console.error(`[BATCH ${batchId}] Response ${index + 1} error:`, error.message);
          errors.push({
            index,
            submittedBy: responses[index]?.submittedBy || 'Unknown',
            error: error.message
          });
        }
      }
      
      // Send success response
      console.log(`[BATCH ${batchId}] Sending success response (no images)`);
      return res.status(201).json({
        success: true,
        message: `Batch import completed: ${createdResponses.length} responses imported successfully`,
        data: {
          imported: createdResponses.length,
          total: responses.length,
          failed: errors.length,
          createdResponses,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    }
    
  } catch (error) {
    console.error('Batch import error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during batch import'
    });
  }
};
/*export const batchImportResponses = async (req, res) => {
  // Declare batchId at the function scope
  let batchId;
  
  try {
    console.log('=== BATCH IMPORT ===');
    
    const { questionId, questionID, responses } = req.body;
    const actualQuestionId = questionId || questionID;
    
    // Set batchId at function scope
    batchId = req.body.batchId || `batch-${Date.now()}`;
    
    console.log('Batch ID:', batchId);
    console.log('Searching for form ID:', actualQuestionId);
    
    if (!actualQuestionId || !Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }
    
    // Find form (without isVisible check for now)
    const form = await Form.findOne({ id: actualQuestionId });
    
    if (!form) {
      return res.status(404).json({
        success: false,
        message: `Form not found with ID: ${actualQuestionId}`
      });
    }
    
    console.log(`✅ Form found: "${form.title}"`);
    
    // Skip image checking for now - just save responses
    console.log('=== Saving responses ===');
    
    const createdResponses = [];
    const errors = [];
    
    // Save each response
    for (let index = 0; index < responses.length; index++) {
      try {
        const { answers, submittedBy, submitterContact } = responses[index];
        
        console.log(`Saving response ${index + 1}/${responses.length}`);
        
        // Create response data
        const responseData = {
          id: uuidv4(),
          questionId: actualQuestionId,
          answers: new Map(Object.entries(answers || {})),
          submittedBy: submittedBy || 'Excel Import',
          submitterContact: submitterContact || {},
          status: 'pending',
          tenantId: form.tenantId || null,
          createdAt: new Date()
        };
        
        // Save to database
        const response = new Response(responseData);
        await response.save();
        
        createdResponses.push({
          id: response.id,
          submittedBy: response.submittedBy,
          status: 'success'
        });
        
        console.log(`✅ Response ${index + 1} saved`);
        
      } catch (error) {
        console.error(`❌ Response ${index + 1} error:`, error.message);
        errors.push({
          index,
          error: error.message
        });
      }
    }
    
    // Send success response
    console.log('=== SENDING SUCCESS RESPONSE ===');
    return res.status(201).json({
      success: true,
      message: `Batch import completed: ${createdResponses.length} responses imported successfully`,
      data: {
        batchId,
        imported: createdResponses.length,
        total: responses.length,
        failed: errors.length,
        createdResponses: createdResponses.slice(0, 10), // Return first 10 only
        errors: errors.length > 0 ? errors : undefined
      }
    });
    
  } catch (error) {
    console.error('=== ERROR CATCH BLOCK ===');
    console.error('Error:', error.message);
    console.error('Batch ID during error:', batchId); // Now batchId is accessible
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error during batch import',
      batchId: batchId || 'unknown',
      error: error.message
    });
  }
}; */


export const processBulkImages = async (req, res) => {
  try {
    const { answers, batchId = `bulk-${Date.now()}` } = req.body;
    
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: answers object required'
      });
    }
    
    console.log(`[BULK PROCESS] Starting bulk image processing for batch ${batchId}`);
    
    // Initialize WebSocket progress
    emitImageProgress(batchId, {
      status: 'starting',
      message: 'Initializing bulk image processing...',
      currentImage: 0,
      totalImages: 0
    });
    
    // Process images with progress tracking
    const onProgress = (progress) => {
      emitImageProgress(batchId, {
        status: progress.status,
        message: progress.message,
        currentImage: progress.currentImage,
        totalImages: progress.totalImages,
        percentage: progress.percentage
      });
    };
    
    const processedAnswers = await processResponseImages(answers, onProgress, batchId);
    
    // Final success message
    emitImageProgress(batchId, {
      status: 'complete',
      message: '✓ Bulk image processing completed successfully',
      currentImage: 100,
      totalImages: 100,
      percentage: 100
    });
    
    res.json({
      success: true,
      message: 'Bulk image processing completed',
      batchId,
      processedAnswers
    });
    
  } catch (error) {
    console.error('Bulk image processing error:', error);
    
    emitImageProgress(batchId, {
      status: 'error',
      message: `Processing failed: ${error.message}`,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Bulk image processing failed',
      error: error.message
    });
  }
};

export const getAllResponses = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      questionId, 
      status, 
      assignedTo, 
      search,
      startDate,
      endDate 
    } = req.query;
    
    const query = { ...req.tenantFilter };

    // Filter by form
    if (questionId) {
      query.questionId = questionId;
    }
    
    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // Filter by assigned user
    if (assignedTo) {
      query.assignedTo = assignedTo;
    }
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Search in answers or notes
    if (search) {
      query.$or = [
        { submittedBy: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
        { 'submitterContact.email': { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        {
          path: 'assignedTo',
          select: 'username firstName lastName email'
        },
        {
          path: 'verifiedBy',
          select: 'username firstName lastName email'
        }
      ]
    };

    const responses = await Response.find(query)
      .populate(options.populate[0].path, options.populate[0].select)
      .populate(options.populate[1].path, options.populate[1].select)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await Response.countDocuments(query);

    // Convert Map to Object for JSON serialization
    const formattedResponses = responses.map(response => {
      const responseObj = response.toObject();
      console.log('[DEBUG] Response metadata from DB in getAllResponses:', responseObj.submissionMetadata);
      return {
        ...responseObj,
        answers: Object.fromEntries(response.answers),
        submissionMetadata: responseObj.submissionMetadata || null
      };
    });

    res.json({
      success: true,
      data: {
        responses: formattedResponses,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalResponses: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get all responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getResponseById = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await Response.findOne({ id, ...req.tenantFilter })
      .populate('assignedTo', 'username firstName lastName email')
      .populate('verifiedBy', 'username firstName lastName email');

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    // Convert Map to Object for JSON serialization
    const responseObj = response.toObject();
    const formattedResponse = {
      ...responseObj,
      answers: Object.fromEntries(response.answers),
      submissionMetadata: responseObj.submissionMetadata || null
    };

    res.json({
      success: true,
      data: { response: formattedResponse }
    });

  } catch (error) {
    console.error('Get response by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { answers, notes, status } = req.body;

    const response = await Response.findOne({ id, ...req.tenantFilter });

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    // Update fields
    if (answers) {
      let processedAnswers = answers;
      try {
        processedAnswers = await processResponseImages(answers);
        console.log('[DEBUG] Updated answers with Google Drive image processing:', Object.keys(processedAnswers));
      } catch (error) {
        console.error('[ERROR] Failed to process Google Drive images on update:', error);
      }
      response.answers = new Map(Object.entries(processedAnswers));
    }
    if (notes !== undefined) {
      response.notes = notes;
    }
    if (status) {
      response.status = status;
      if (status === 'verified') {
        response.verifiedBy = req.user._id;
        response.verifiedAt = new Date();
      }
    }

    await response.save();

    // Convert Map to Object for JSON serialization
    const formattedResponse = {
      ...response.toObject(),
      answers: Object.fromEntries(response.answers)
    };

    // Emit real-time event for updated response
    emitResponseUpdated(response.questionId, {
      id: response.id,
      questionId: response.questionId,
      status: response.status,
      submittedBy: response.submittedBy,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      answers: Object.fromEntries(response.answers)
    });

    res.json({
      success: true,
      message: 'Response updated successfully',
      data: { response: formattedResponse }
    });

  } catch (error) {
    console.error('Update response error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const assignResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    const response = await Response.findOne({ id, ...req.tenantFilter });

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    response.assignedTo = assignedTo;
    response.assignedAt = new Date();
    await response.save();

    await response.populate('assignedTo', 'username firstName lastName email');

    // Convert Map to Object for JSON serialization
    const formattedResponse = {
      ...response.toObject(),
      answers: Object.fromEntries(response.answers)
    };

    res.json({
      success: true,
      message: 'Response assigned successfully',
      data: { response: formattedResponse }
    });

  } catch (error) {
    console.error('Assign response error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteResponse = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await Response.findOne({ id, ...req.tenantFilter });

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const questionId = response.questionId;
    await Response.findOneAndDelete({ id, ...req.tenantFilter });

    // Emit real-time event for deleted response
    emitResponseDeleted(questionId, id);

    res.json({
      success: true,
      message: 'Response deleted successfully'
    });

  } catch (error) {
    console.error('Delete response error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteMultipleResponses = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of response IDs'
      });
    }

    const result = await Response.deleteMany({ id: { $in: ids }, ...req.tenantFilter });

    res.json({
      success: true,
      message: `${result.deletedCount} responses deleted successfully`
    });

  } catch (error) {
    console.error('Delete multiple responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getResponsesByForm = async (req, res) => {
  try {
    const { formId } = req.params;
    const { page = 1, limit = 10000, status } = req.query;

    // Verify form exists
    const form = await Form.findOne({ id: formId, ...req.tenantFilter });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    const query = { questionId: formId, ...req.tenantFilter };
    if (status && status !== 'all') {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const responses = await Response.find(query)
      .populate('assignedTo', 'username firstName lastName email')
      .populate('verifiedBy', 'username firstName lastName email')
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await Response.countDocuments(query);

    // Convert Map to Object for JSON serialization
    const formattedResponses = responses.map(response => {
      const responseObj = response.toObject();
      return {
        ...responseObj,
        answers: Object.fromEntries(response.answers),
        submissionMetadata: responseObj.submissionMetadata || null
      };
    });

    res.json({
      success: true,
      data: {
        responses: formattedResponses,
        form: {
          id: form.id,
          title: form.title
        },
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalResponses: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get responses by form error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const exportResponses = async (req, res) => {
  try {
    const { formId } = req.params;
    const { format = 'json', status } = req.query;

    // Verify form exists
    const form = await Form.findOne({ id: formId, ...req.tenantFilter });
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    const query = { questionId: formId, ...req.tenantFilter };
    if (status && status !== 'all') {
      query.status = status;
    }

    const responses = await Response.find(query)
      .populate('assignedTo', 'username firstName lastName email')
      .populate('verifiedBy', 'username firstName lastName email')
      .sort({ createdAt: -1 });

    // Convert Map to Object for JSON serialization
    const formattedResponses = responses.map(response => ({
      ...response.toObject(),
      answers: Object.fromEntries(response.answers)
    }));

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${form.title}_responses.json"`);
      res.json({
        form: {
          id: form.id,
          title: form.title,
          description: form.description
        },
        responses: formattedResponses,
        exportedAt: new Date().toISOString(),
        totalCount: formattedResponses.length
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Unsupported export format. Currently only JSON is supported.'
      });
    }

  } catch (error) {
    console.error('Export responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};