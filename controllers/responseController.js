import mongoose from 'mongoose';
import Response from '../models/Response.js';
import Form from '../models/Form.js';
import Tenant from '../models/Tenant.js';
import { v4 as uuidv4 } from 'uuid';
import { collectSubmissionMetadata } from '../services/locationService.js';
import { emitResponseCreated, emitResponseUpdated, emitResponseDeleted, emitImageProgress } from '../socket/socketHandler.js';
import { processResponseImages } from '../services/googleDriveService.js';
import { isGoogleDriveUrl } from '../services/googleDriveService.js';
import FormInvite from '../models/FormInvite.js';
import User from '../models/User.js';
import FormSession from '../models/FormSession.js';

export const createResponse = async (req, res) => {
  try {
    console.log('[CREATE RESPONSE] === START ===');
    console.log('[CREATE RESPONSE] req.user:', req.user);
    console.log('[CREATE RESPONSE] req.user?._id:', req.user?._id);
    console.log('[CREATE RESPONSE] req.user?.role:', req.user?.role);
    console.log('[CREATE RESPONSE] req.user?.email:', req.user?.email);
    console.log('[CREATE RESPONSE] req.user?.username:', req.user?.username);
    console.log('[CREATE RESPONSE] auth header exists:', !!req.header('Authorization'));
    console.log('[CREATE RESPONSE] auth header value:', req.header('Authorization')?.substring(0, 30) + '...');
    console.log('[CREATE RESPONSE] body.submittedBy:', req.body.submittedBy);
    console.log('[CREATE RESPONSE] body.submitterContact:', req.body.submitterContact);
    
    const {
      questionId: bodyFormId,
      answers,
      parentResponseId,
      submittedBy,
      submitterContact,
      submissionMetadata: bodyMetadata,
      inviteId,
      isSectionSubmit,
      sectionIndex,
      sessionId,
      startedAt,
      completedAt
    } = req.body;
    const { tenantSlug, formId: paramFormId } = req.params;

    let form;
    let submissionTimeSpent = 0;
    let formSession = null;
    let actualStartedAt = startedAt ? new Date(startedAt) : null;
    let actualCompletedAt = completedAt ? new Date(completedAt) : new Date();

    // ========== TIMING CALCULATION ==========
    // Calculate time if we have start time
    if (actualStartedAt) {
      submissionTimeSpent = Math.floor((actualCompletedAt - actualStartedAt) / 1000);
    }

    // Try to find FormSession if we have sessionId
    if (sessionId) {
      try {
        const FormSession = mongoose.model('FormSession');
        formSession = await FormSession.findOne({ sessionId });

        if (formSession) {
          // Use session data for more accurate timing
          if (formSession.startedAt) {
            actualStartedAt = formSession.startedAt;
            actualCompletedAt = new Date();
            submissionTimeSpent = Math.floor((actualCompletedAt - formSession.startedAt) / 1000);
          }

          // Update session as completed (only for final submission, not partial)
          if (!isSectionSubmit) {
            formSession.completedAt = actualCompletedAt;
            formSession.timeSpent = submissionTimeSpent;
            formSession.status = 'completed';
            formSession.answers = answers;
            await formSession.save();
            console.log(`[TIME TRACKING] Session ${sessionId} completed in ${submissionTimeSpent} seconds`);
          } else {
            // For partial submissions, just update last activity
            formSession.lastActivityAt = actualCompletedAt;
            await formSession.save();
            console.log(`[TIME TRACKING] Partial submission for session ${sessionId}`);
          }
        }
      } catch (err) {
        console.error('Error finding FormSession:', err);
      }
    } else if (req.formSessionId) {
      // Fallback to sessionId stored in request by trackFormStart middleware
      try {
        const FormSession = mongoose.model('FormSession');
        formSession = await FormSession.findOne({ sessionId: req.formSessionId });
        if (formSession && !isSectionSubmit) {
          actualStartedAt = formSession.startedAt;
          actualCompletedAt = new Date();
          submissionTimeSpent = Math.floor((actualCompletedAt - formSession.startedAt) / 1000);

          formSession.completedAt = actualCompletedAt;
          formSession.timeSpent = submissionTimeSpent;
          formSession.status = 'completed';
          formSession.answers = answers;
          await formSession.save();
        }
      } catch (err) {
        console.error('Error finding FormSession by formSessionId:', err);
      }
    }

    // If no session exists and this is a final submission, try to find one by matching time window
    if (!formSession && !isSectionSubmit) {
      try {
        const FormSession = mongoose.model('FormSession');
        // Look for recent session (last 2 hours) from this user/IP
        const recentSession = await FormSession.findOne({
          formId: questionId,
          userId: req.user?._id || null,
          status: 'in-progress',
          startedAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } // Last 2 hours
        }).sort({ startedAt: -1 });

        if (recentSession) {
          submissionTimeSpent = Math.floor((new Date() - recentSession.startedAt) / 1000);
          recentSession.completedAt = new Date();
          recentSession.timeSpent = submissionTimeSpent;
          recentSession.status = 'completed';
          recentSession.answers = answers;
          await recentSession.save();
          formSession = recentSession;
          console.log(`[TIME TRACKING] Found orphaned session, time spent: ${submissionTimeSpent} seconds`);
        }
      } catch (err) {
        console.error('Error finding recent session:', err);
      }
    }

    // Log timing information
    const formatTimeDisplay = (seconds) => {
      if (!seconds || seconds < 60) return `${seconds || 0}s`;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    console.log(`[TIME TRACKING] Form submission - Time spent: ${formatTimeDisplay(submissionTimeSpent)}`);

    // ========== FORM VALIDATION (Keep your existing code) ==========
    const questionId = paramFormId || bodyFormId;

    if (!questionId) {
      return res.status(400).json({
        success: false,
        message: 'Form ID is required'
      });
    }

    console.log(`[CREATE RESPONSE] FormID: ${questionId}, TenantSlug: ${tenantSlug || 'N/A'}`);
    console.log(`[CREATE RESPONSE DEBUG] Step 1: Starting form lookup`);


    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      console.log(`[CREATE RESPONSE DEBUG] Step 2: Tenant lookup done, found: ${!!tenant}`);

      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or inactive'
        });
      }

      form = await Form.findOne({ id: questionId, tenantId: tenant._id, isVisible: true });
      console.log(`[CREATE RESPONSE DEBUG] Step 3: Form lookup done, found: ${!!form}`);

      if (!form) {
        return res.status(404).json({
          success: false,
          message: 'Form not found'
        });
      }
    } else {
      form = await Form.findOne({ id: questionId, ...req.tenantFilter });
      console.log(`[CREATE RESPONSE DEBUG] Step 2: Form lookup done (no tenant), found: ${!!form}`);

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

    // ========== INVITE HANDLING (Keep your existing code) ==========
    let inviteStatus = null;
    let inviteObj = null;

    if (inviteId) {
      console.log(`[INVITE] Processing response with inviteId: ${inviteId}`);

      const invite = await FormInvite.findOne({
        formId: questionId,
        inviteId: inviteId
      });

      if (!inviteObj) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired invite link'
        });
      }

      if (inviteObj.status === 'responded' && !isSectionSubmit) {
        console.log(`[INVITE] Invite ${inviteId} was already responded.`);
      }

      if (!isSectionSubmit) {
        inviteObj.status = 'responded';
        inviteObj.respondedAt = new Date();
        await inviteObj.save();
        inviteStatus = 'responded';
        console.log(`[INVITE] Updated invite ${inviteId} to responded status`);
      } else {
        console.log(`[INVITE] Partial submission for invite ${inviteId}`);
      }
    }

    // ========== SUBMISSION METADATA (Keep your existing code) ==========
    console.log(`[CREATE RESPONSE DEBUG] Step 4: Starting submission metadata collection`);
    const submissionMetadata = await collectSubmissionMetadata(req, {
      includeLocation: form.locationEnabled !== false,
    });

    if (bodyMetadata && bodyMetadata.source) {
      submissionMetadata.source = bodyMetadata.source;
    } else if (inviteId && inviteObj) {
      // Use the already found invite object
      if (inviteObj.notificationChannels && inviteObj.notificationChannels.length > 0) {
        // Preference 1: Use the explicit notification channel (email, sms, whatsapp)
        submissionMetadata.source = inviteObj.notificationChannels[0];
      } else if (inviteObj.phone && !inviteObj.email) {
        // Preference 2: If only phone is present, it's likely SMS
        submissionMetadata.source = 'sms';
      } else if (inviteObj.email) {
        // Preference 3: If email is present, it's likely Email
        submissionMetadata.source = 'email';
      } else {
        // Fallback
        submissionMetadata.source = 'email';
      }
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

    // Helper function to recursively collect all questions
    const collectAllQuestions = (questions, result = []) => {
      if (!Array.isArray(questions)) return result;

      questions.forEach(q => {
        result.push(q);
        if (Array.isArray(q.followUpQuestions)) {
          collectAllQuestions(q.followUpQuestions, result);
        }
      });

      return result;
    };



    // ========== SCORE CALCULATION (Keep your existing code) ==========
    const allQuestions = [];
    if (form.sections) {
      form.sections.forEach(section => {
        if (section.questions) {
          collectAllQuestions(section.questions, allQuestions);

        }
      });
    }
    if (form.followUpQuestions) {
      collectAllQuestions(form.followUpQuestions, allQuestions);

    }

    let correct = 0;
    let total = 0;
    const questionResults = {};

    allQuestions.forEach(question => {
      if (question.type === 'yesNoNA') {
        total++;
        const answer = answers[question.id];
        let isCorrect = false;

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
      } else {
        const hasCorrectAnswer = question.correctAnswer || (question.correctAnswers && question.correctAnswers.length > 0);

        if (hasCorrectAnswer) {
          total++;
          const answer = answers[question.id];
          let isCorrect = false;

          if (question.correctAnswers && question.correctAnswers.length > 0) {
            if (Array.isArray(answer)) {
              const normalizedAnswer = answer.map(a => String(a).toLowerCase());
              const normalizedCorrect = question.correctAnswers.map(a => String(a).toLowerCase());
              isCorrect = normalizedAnswer.length === normalizedCorrect.length &&
                normalizedAnswer.every(a => normalizedCorrect.includes(a));
            } else {
              const normalizedAnswer = String(answer).toLowerCase();
              const normalizedCorrect = question.correctAnswers.map(a => String(a).toLowerCase());
              isCorrect = normalizedCorrect.includes(normalizedAnswer);
            }
          } else if (question.correctAnswer) {
            if (Array.isArray(answer)) {
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

    // Calculate ranks for specific questions
    const responseRanks = {};
    const formObj = form.toObject();
    const allQs = [];

    // Recursive helper to collect all questions
    const collectFromQuestions = (questions) => {
      if (!Array.isArray(questions)) return;
      questions.forEach(q => {
        allQs.push(q);
        if (Array.isArray(q.followUpQuestions)) {
          collectFromQuestions(q.followUpQuestions);
        }
      });
    };
    if (formObj.sections) {
      formObj.sections.forEach(section => {
        if (section.questions) {
          collectFromQuestions(section.questions);
        }
      });
    }
    if (formObj.followUpQuestions) {
      collectFromQuestions(formObj.followUpQuestions);
    } console.log(`[RANK DEBUG] Calculating ranks for ${allQs.length} total questions in form ${questionId}`);

    for (const question of allQs) {
      const qId = question.id;

      // Check for tracking (handle both boolean and string "true")
      const isTrackingEnabled =
        question.trackResponseRank === true ||
        question.trackResponseRank === "true" ||
        question.trackResponseQuestion === true ||
        question.trackResponseQuestion === "true";

      if (isTrackingEnabled) {
        // If trackResponseQuestion is enabled, we use the value from that field for ranking
        const trackingQId = question.trackResponseQuestion ? `${qId}_tracking` : qId;
        const answer = answers[trackingQId];
        console.log(
          `[RANK DEBUG] Question "${question.text}" (ID: ${qId}) HAS tracking enabled. TrackingField: ${trackingQId}, Answer: "${answer}"`,
        );

        if (answer !== undefined && answer !== null && answer !== "") {
          // Count existing responses with the SAME answer for this form
          // We filter by tenantId to avoid cross-business rank contamination
          const query = {
            questionId: questionId,
            [`answers.${trackingQId}`]: answer,
            isSectionSubmit: { $ne: true },
            tenantId: form.tenantId,
          };

          try {
            const count = await Response.countDocuments(query);
            console.log(
              `[RANK DEBUG] Found ${count} existing final responses for form ${questionId}, question ${qId}, trackingField ${trackingQId}, answer "${answer}". New rank: ${count + 1}`,
            );
            responseRanks[qId] = count + 1;
          } catch (countError) {
            console.error(
              `[RANK ERROR] Failed to count documents for question ${qId}:`,
              countError,
            );
          }
        }
      }
    }


    // ========== IMAGE PROCESSING (Keep your existing code) ==========
    console.log('[IMAGE PROCESS] Starting image processing...');

    // ======== UPDATED : Process images with Google Drive backup ==========
    // ========== UPDATED: Process ALL images with OAuth 2.0 Google Drive backup ==========
    console.log('[IMAGE PROCESS] Starting image processing for ALL images...');

    // Check OAuth configuration
    const driveConfigured = !!(process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
    console.log(`[IMAGE PROCESS] Google Drive OAuth configured: ${driveConfigured ? '✅' : '❌'}`);
    if (!driveConfigured) {
      console.log('[IMAGE PROCESS] Google Drive backup disabled. Configure OAuth 2.0 for backups.');
    }

    // Create metadata for Google Drive
    const metadata = {
      tenantId: form.tenantId,
      formId: questionId,
      submissionId: `resp-${Date.now()}`,
      submissionTimestamp: Date.now(),
      driveEnabled: driveConfigured
    };

    let processingResult = {
      processedAnswers: answers,
      driveBackupUrls: {},
      folderStructure: null,
      stats: {
        totalImages: 0,
        processedImages: 0,
        successfulDriveBackups: 0,
        startTime: Date.now()
      }
    };

    try {
      // Process images with progress tracking
      const onProgress = (progress) => {
        console.log(`Image processing progress: ${progress.message}`);
        if (typeof emitImageProgress === 'function') {
          emitImageProgress(`response-${Date.now()}`, {
            status: progress.status,
            message: progress.message,
            currentImage: progress.currentImage,
            totalImages: progress.totalImages,
            percentage: progress.percentage,
            driveEnabled: driveConfigured
          });
        }
      };

      // Process ALL images with OAuth 2.0 Google Drive backup
      processingResult = await processResponseImages(
        answers,      // All answers including any image URLs
        metadata,     // Metadata for folder creation
        onProgress,
        `response-${Date.now()}`
      );

      console.log('[IMAGE PROCESS] Processing complete:', {
        totalImages: processingResult.stats.totalImages,
        driveBackups: processingResult.stats.successfulDriveBackups,
        folderPath: processingResult.folderStructure?.fullPath,
        storageType: 'Google Drive (OAuth 2.0)'
      });

    } catch (error) {
      console.error('[IMAGE PROCESS] Failed to process images:', error);

      // Check if it's an OAuth error
      if (error.message.includes('invalid_grant') ||
        error.message.includes('invalid_credentials') ||
        error.message.includes('Refresh token expired')) {
        console.error('[IMAGE PROCESS] ❌ OAuth token invalid or expired.');
        console.error('[IMAGE PROCESS] 🔗 Visit /api/drive/setup to get new tokens');
        console.error('[IMAGE PROCESS] ℹ️ Continuing without Google Drive backup...');
      }
    }
    let displayName = 'Anonymous';

if (req.body.submittedBy && req.body.submittedBy !== 'Anonymous') {
  displayName = req.body.submittedBy;
} else if (req.user) {
  // Try to get full name from firstName + lastName
  if (req.user.firstName || req.user.lastName) {
    displayName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
  }
  // Fallback to username
  if (displayName === '' && req.user.username) {
    displayName = req.user.username;
  }
  // Fallback to email
  if (displayName === '' && req.user.email) {
    displayName = req.user.email;
  }
}

    // ========== CREATE RESPONSE WITH TIMING DATA ==========
    const responseData = {
      id: uuidv4(),
      questionId,
      answers: new Map(Object.entries(processingResult.processedAnswers)),
      responseRanks: new Map(Object.entries(responseRanks)),
      driveBackupUrls: processingResult.driveBackupUrls || {},
      imageProcessing: {
        totalImages: processingResult.stats.totalImages || 0,
        processedImages: processingResult.stats.processedImages || 0,
        driveBackups: processingResult.stats.successfulDriveBackups || 0,
        folderStructure: processingResult.folderStructure || null,
        processingTime: Date.now() - (processingResult.stats.startTime || Date.now()),
        status: processingResult.error ? 'partial' : 'completed'
      },
      parentResponseId,
      submittedBy: displayName,
      submitterContact: {
        email: req.body.submitterContact?.email || req.user?.email,
        phone: req.body.submitterContact?.phone
      },

      // ========== ADD TOP-LEVEL TIMING FIELDS (for easy querying) ==========
      timeSpent: submissionTimeSpent,
      sessionId: sessionId || formSession?.sessionId || null,
      startedAt: actualStartedAt,
      completedAt: actualCompletedAt,
      questionTimings: formSession?.questionTimings || [],

      submissionMetadata: {
        ...submissionMetadata,
        // Add timing to metadata
        timeSpent: submissionTimeSpent,
        sessionId: sessionId || formSession?.sessionId || null,
        startedAt: actualStartedAt,
        completedAt: actualCompletedAt,
        timeSpentFormatted: formatTimeDuration(submissionTimeSpent),
        questionTimings: formSession?.questionTimings,
        sectionTimings: formSession?.sectionTimings
      },

      status: 'pending',
      createdBy: req.user?._id || null,
      isSectionSubmit: !!isSectionSubmit,
      sectionIndex: sectionIndex || null,
      tenantId: form.tenantId,
      score: { correct, total },
      inviteId: inviteId || null
    };

    const response = new Response(responseData);
    await response.save();

    const answersObj = response.answers instanceof Map ? Object.fromEntries(response.answers) : response.answers;

    const ranksObj = response.responseRanks instanceof Map ? Object.fromEntries(response.responseRanks) : response.responseRanks;

    // Emit real-time event for new response
    emitResponseCreated(questionId, {
      id: response.id,
      questionId: response.questionId,
      status: response.status,
      submittedBy: response.submittedBy,
      createdAt: response.createdAt,
      answers: answersObj,
      inviteId: inviteId || null,
      timeSpent: submissionTimeSpent,
      responseRanks: ranksObj,
    });

    // ========== RETURN RESPONSE WITH TIMING DATA ==========
    res.status(201).json({
      success: true,
      message: 'Response submitted successfully',
      data: {
        response: {
          id: response.id,
          questionId: response.questionId,
          answers: answersObj,
          responseRanks: ranksObj,
          parentResponseId: response.parentResponseId,
          submittedBy: response.submittedBy,
          submitterContact: response.submitterContact,
          status: response.status,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          inviteId: inviteId || null,
          imageProcessing: {
            totalImages: response.imageProcessing?.totalImages || 0,
            driveBackups: response.imageProcessing?.driveBackups || 0,
            folderPath: response.imageProcessing?.folderStructure?.fullPath
          },
          // Timing data
          timeSpent: submissionTimeSpent,
          timeSpentFormatted: formatTimeDuration(submissionTimeSpent),
          startedAt: actualStartedAt,
          completedAt: actualCompletedAt,
          questionTimings: formSession?.questionTimings,
          sectionTimings: formSession?.sectionTimings
        },
        score: {
          correct,
          total,
          percentage: total > 0 ? Math.round((correct / total) * 100) : 0
        },
        imageProcessing: {
          status: response.imageProcessing?.status || 'completed',
          stats: response.imageProcessing
        },
        inviteStatus: inviteStatus,
        // Add timing summary
        timing: {
          timeSpent: submissionTimeSpent,
          timeSpentFormatted: formatTimeDuration(submissionTimeSpent),
          startedAt: actualStartedAt,
          completedAt: actualCompletedAt,
          hasSession: !!formSession,
          sessionId: sessionId || formSession?.sessionId
        }
      }
    });

  } catch (error) {
    console.error('Create response error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}


function formatTimeDuration(seconds) {
  if (!seconds || seconds < 0) return '0 seconds';
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    if (remainingSeconds === 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
}
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

        // Prepare metadata for Google Drive folder structure
        const metadata = {
          tenantId: form.tenantId,
          formId: actualQuestionId,
          submissionId: `batch-${batchId}`,
          submissionTimestamp: Date.now()
        };

        const processedBatch = await processResponseImages(
          batchAnswers,
          metadata,  // CORRECT: This should be metadata object
          onProgressCallback,
          batchId
        );

        // Create mapping of original URL -> Cloudinary URL
        const processedUrlMap = new Map();
        const driveBackupMap = new Map();
        Object.entries(processedBatch.processedAnswers).forEach(([uniqueKey, cloudinaryUrl]) => {
          const item = urlMapping[uniqueKey];
          if (item && cloudinaryUrl !== item.url) {
            processedUrlMap.set(item.url, cloudinaryUrl);

            // Store drive backup info
            if (processedBatch.driveBackupUrls && processedBatch.driveBackupUrls[uniqueKey]) {
              driveBackupMap.set(item.url, processedBatch.driveBackupUrls[uniqueKey]);
            }
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
            // Helper function to recursively collect all questions
            const collectAllQuestions = (questions, result = []) => {
              if (!Array.isArray(questions)) return result;

              questions.forEach(q => {
                result.push(q);
                if (Array.isArray(q.followUpQuestions)) {
                  collectAllQuestions(q.followUpQuestions, result);
                }
              });

              return result;
            };

            const allQuestions = [];
            if (form.sections) {
              form.sections.forEach(section => {
                if (section.questions) {
                  collectAllQuestions(section.questions, allQuestions);
                }
              });
            }
            if (form.followUpQuestions) {
              collectAllQuestions(form.followUpQuestions, allQuestions);
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
            // Calculate ranks for specific questions
            const responseRanks = {};
            console.log(`[BATCH-RANK] Calculating ranks for ${allQuestions.length} questions`);
            for (const question of allQuestions) {
              // Check for trackResponseRank at any level
              if (question.trackResponseRank) {
                const answer = processedAnswers[question.id];
                console.log(`[BATCH-RANK] Question "${question.text}" (ID: ${question.id}) has trackResponseRank=true. Answer:`, answer);

                if (answer !== undefined && answer !== null && answer !== '') {
                  // Count existing responses with the same answer for this form
                  const query = {
                    questionId: actualQuestionId,
                    [`answers.${question.id}`]: answer,
                    isSectionSubmit: false
                  };

                  console.log(`[BATCH-RANK] Querying existing responses with:`, JSON.stringify(query));
                  const count = await Response.countDocuments(query);
                  console.log(`[BATCH-RANK] Found ${count} existing responses. New rank: ${count + 1}`);
                  responseRanks[question.id] = count + 1;
                }
              }
            }

            const responseData = {
              id: uuidv4(),
              questionId: actualQuestionId,
              answers: new Map(Object.entries(processedAnswers)),
              responseRanks: new Map(Object.entries(responseRanks)),
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
            const ranksObj = response.responseRanks instanceof Map ?
              Object.fromEntries(response.responseRanks) : response.responseRanks;


            emitResponseCreated(actualQuestionId, {
              id: response.id,
              questionId: response.questionId,
              status: response.status,
              submittedBy: response.submittedBy,
              createdAt: response.createdAt,
              answers: answersObj,
              responseRanks: ranksObj
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
          // Helper function to recursively collect all questions
          const collectAllQuestions = (questions, result = []) => {
            if (!Array.isArray(questions)) return result;

            questions.forEach(q => {
              result.push(q);
              if (Array.isArray(q.followUpQuestions)) {
                collectAllQuestions(q.followUpQuestions, result);
              }
            });

            return result;
          };


          // Get all questions from form for scoring
          const allQuestions = [];
          if (form.sections) {
            form.sections.forEach(section => {
              if (section.questions) {
                collectAllQuestions(section.questions, allQuestions);

              }
            });
          }
          if (form.followUpQuestions) {
            collectAllQuestions(form.followUpQuestions, allQuestions);
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

          // Calculate ranks for specific questions
          const responseRanks = {};
          console.log(`[BATCH-RANK] Calculating ranks for ${allQuestions.length} questions`);
          for (const question of allQuestions) {
            // Check for trackResponseRank at any level
            if (question.trackResponseRank) {
              const answer = processedAnswers[question.id];
              console.log(`[BATCH-RANK] Question "${question.text}" (ID: ${question.id}) has trackResponseRank=true. Answer:`, answer);

              if (answer !== undefined && answer !== null && answer !== '') {
                // Count existing responses with the same answer for this form
                const query = {
                  questionId: actualQuestionId,
                  [`answers.${question.id}`]: answer,
                  isSectionSubmit: false
                };

                console.log(`[BATCH-RANK] Querying existing responses with:`, JSON.stringify(query));
                const count = await Response.countDocuments(query);
                console.log(`[BATCH-RANK] Found ${count} existing responses. New rank: ${count + 1}`);
                responseRanks[question.id] = count + 1;
              }
            }
          }

          // Create response data
          const responseData = {
            id: uuidv4(),
            questionId: actualQuestionId,
            answers: new Map(Object.entries(processedAnswers)),
            responseRanks: new Map(Object.entries(responseRanks)),

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
          const ranksObj = response.responseRanks instanceof Map ?
            Object.fromEntries(response.responseRanks) : response.responseRanks;

          // Emit event if function exists
          if (typeof emitResponseCreated === 'function') {
            emitResponseCreated(actualQuestionId, {
              id: response.id,
              questionId: response.questionId,
              status: response.status,
              submittedBy: response.submittedBy,
              createdAt: response.createdAt,
              answers: answersObj,
              responseRanks: ranksObj
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
/**
 * Get current rank for a specific question and answer
 * Used for real-time ranking display during form filling
 */

export const getRank = async (req, res) => {
  try {
    const { formId, questionId, answer } = req.query;
    const { tenantSlug } = req.params;

    if (!formId || !questionId || answer === undefined) {
      return res.status(400).json({
        success: false,
        message: 'formId, questionId, and answer are required'
      });
    }

    let tenantId;
    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      if (tenant) {
        tenantId = tenant._id;
      }
    }

    // Find the form to verify it exists and if tracking is enabled
    const formQuery = { id: formId };
    if (tenantId) formQuery.tenantId = tenantId;

    const form = await Form.findOne(formQuery);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found',
      });
    }

    // Find the specific question to check for tracking configuration
    let trackingQId = questionId;
    const findQuestion = (questions) => {
      if (!questions || !Array.isArray(questions)) return null;
      for (const q of questions) {
        if (q.id === questionId) return q;
        if (q.followUpQuestions && q.followUpQuestions.length > 0) {
          const found = findQuestion(q.followUpQuestions);
          if (found) return found;
        }
      }
      return null;
    };

    let question = findQuestion(form.followUpQuestions || []);
    if (!question && form.sections && Array.isArray(form.sections)) {
      for (const section of form.sections) {
        question = findQuestion(section.questions || []);
        if (question) break;
      }
    }

    if (
      question &&
      (question.trackResponseQuestion === true ||
        question.trackResponseQuestion === "true")
    ) {
      trackingQId = `${questionId}_tracking`;
    }

    // Count existing final responses with the SAME answer for this form
    const query = {
      questionId: formId,
      isSectionSubmit: { $ne: true },
    };

    // Try both exact match and numeric match if applicable
    const orConditions = [
      { [`answers.${trackingQId}`]: answer }
    ];

    const numAnswer = Number(answer);
    if (!isNaN(numAnswer)) {
      orConditions.push({ [`answers.${trackingQId}`]: numAnswer });
    }

    query.$or = orConditions;

    if (tenantId) query.tenantId = tenantId;

    const count = await Response.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: { rank: count + 1 }
    });

  } catch (error) {
    console.error('Get rank error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


/**
 * Get suggested answers based on a single question-answer pair.
 * This is used to auto-fill or suggest previous answers when a user starts filling a form.
 */
export const getSuggestedAnswers = async (req, res) => {
  const startTime = Date.now();
  try {
    const { formId: queryFormId, questionId, answer } = req.query;
    const { tenantSlug, formId: paramFormId } = req.params;

    const formId = paramFormId || queryFormId;

    console.log(`[SUGGESTIONS] Request - Form: ${formId}, Question: ${questionId}, Answer: "${answer}", Tenant: ${tenantSlug}`);

    if (!formId || !questionId || answer === undefined) {
      return res.status(400).json({
        success: false,
        message: 'formId, questionId, and answer are required'
      });
    }

    let tenantId;
    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      if (tenant) {
        tenantId = tenant._id;
        console.log(`[SUGGESTIONS] Resolved tenantId: ${tenantId}`);
      }
    }

    // Find the form to verify it exists
    const formQuery = { id: formId };
    if (tenantId) formQuery.tenantId = tenantId;

    const form = await Form.findOne(formQuery);
    if (!form) {
      console.warn(`[SUGGESTIONS] Form not found: ${formId}`);
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Find a previous response with a match in the answers map
    // For Mongoose Maps, we use dot notation: answers.questionId
    const query = {
      questionId: formId
    };

    const trackingQuestionId = `${questionId}_tracking`;

    if (typeof answer === 'string') {
      // Use case-insensitive prefix match for strings
      const regex = {
        $regex: `^${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        $options: 'i'
      };

      query.$or = [
        { [`answers.${questionId}`]: regex },
        { [`answers.${trackingQuestionId}`]: regex },
        { [`answers._${questionId}`]: regex },
        { [`answers._${trackingQuestionId}`]: regex }
      ];

      // If the answer is numeric, also try exact number match
      const numAnswer = Number(answer);
      if (!isNaN(numAnswer)) {
        query.$or.push({ [`answers.${questionId}`]: numAnswer });
        query.$or.push({ [`answers.${trackingQuestionId}`]: numAnswer });
        query.$or.push({ [`answers._${questionId}`]: numAnswer });
        query.$or.push({ [`answers._${trackingQuestionId}`]: numAnswer });
      }
    } else {
      query.$or = [
        { [`answers.${questionId}`]: answer },
        { [`answers.${trackingQuestionId}`]: answer },
        { [`answers._${questionId}`]: answer },
        { [`answers._${trackingQuestionId}`]: answer }
      ];
    }

    // Only filter by tenantId if the form is NOT global or if we have a specific tenantSlug
    if (tenantId) {
      const isValid = mongoose.Types.ObjectId.isValid(tenantId);
      const oid = isValid ? new mongoose.Types.ObjectId(String(tenantId)) : null;
      query.tenantId = oid ? { $in: [tenantId, oid] } : tenantId;
      console.log(`[SUGGESTIONS] Using specific tenantId filter: ${tenantId}`);
    } else if (form.tenantId && !form.isGlobal) {
      const isValid = mongoose.Types.ObjectId.isValid(form.tenantId);
      const oid = isValid ? new mongoose.Types.ObjectId(String(form.tenantId)) : null;
      query.tenantId = oid ? { $in: [form.tenantId, oid] } : form.tenantId;
      console.log(`[SUGGESTIONS] Falling back to form owner tenantId filter: ${form.tenantId}`);
    } else {
      console.log(`[SUGGESTIONS] No tenantId filter applied (Global form or no slug)`);
    }

    console.log(`[SUGGESTIONS] DB Query: ${JSON.stringify(query)}`);

    const queryStartTime = Date.now();
    // Fetch top 5 matching responses to find the one with the most data
    const matchingResponses = await Response.find(query)
      .sort({ isSectionSubmit: 1, createdAt: -1 })
      .limit(5)
      .lean();

    const queryDuration = Date.now() - queryStartTime;

    console.log(`[SUGGESTIONS] DB Query took ${queryDuration}ms. Found ${matchingResponses.length} matches.`);

    if (matchingResponses.length === 0) {
      // Log why it might have failed
      const anyRespCount = await Response.countDocuments({ questionId: formId });
      console.log(`[SUGGESTIONS] No match for "${answer}". Total responses for form ${formId}: ${anyRespCount}`);

      return res.status(200).json({
        success: true,
        data: { suggestedAnswers: null }
      });
    }

    // Sort matching responses: priority to non-partial, then by creation date (oldest first for ranking #1, #2, etc)
    const sortedResponses = matchingResponses.sort((a, b) => {
      if (a.isSectionSubmit !== b.isSectionSubmit) {
        return a.isSectionSubmit ? 1 : -1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    console.log(`[SUGGESTIONS] Found ${sortedResponses.length} matches.`);

    const suggestions = sortedResponses.map((resp, index) => {
      let answersObj = resp.answers || {};
      if (answersObj instanceof Map) {
        answersObj = Object.fromEntries(answersObj);
      }
      return {
        rank: index + 1,
        answers: answersObj,
        timestamp: resp.createdAt,
        id: resp.id || resp._id
      };
    });

    return res.status(200).json({
      success: true,
      data: { suggestedAnswers: suggestions }
    });

  } catch (error) {
    console.error('[SUGGESTIONS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggested answers'
    });
  }
};

/**
 * Get all previous unique answers for a specific question
 * Used to show suggestions to users as they fill the form
 */
export const getQuestionPreviousAnswers = async (req, res) => {
  try {
    const { formId: queryFormId, questionId } = req.query;
    const { tenantSlug, formId: paramFormId } = req.params;

    const formId = paramFormId || queryFormId;

    if (!formId || !questionId) {
      return res.status(400).json({
        success: false,
        message: 'formId and questionId are required'
      });
    }

    let tenantId;
    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
      if (tenant) {
        tenantId = tenant._id;
      }
    }

    // Find the form to verify it exists
    const formQuery = { id: formId };
    if (tenantId) formQuery.tenantId = tenantId;

    const form = await Form.findOne(formQuery);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Use aggregation to find unique answers for this question
    // Check both normal ID and tracking suffixed ID
    const trackingQuestionId = `${questionId}_tracking`;
    const query = {
      questionId: formId,
      $or: [
        { [`answers.${questionId}`]: { $exists: true, $ne: null, $ne: "" } },
        { [`answers.${trackingQuestionId}`]: { $exists: true, $ne: null, $ne: "" } },
        { [`answers._${questionId}`]: { $exists: true, $ne: null, $ne: "" } },
        { [`answers._${trackingQuestionId}`]: { $exists: true, $ne: null, $ne: "" } }
      ]
    };

    // If we have tenantId, filter by it for better accuracy/security
    if (tenantId) {
      query.tenantId = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : tenantId;
    } else if (form.isGlobal) {
      // For global forms without a specific tenant context, we don't filter by tenantId
      // This allows suggestions across different tenants for global forms
      console.log(`[SUGGESTIONS] Global form detected, skipping tenantId filter`);
    } else if (form.tenantId) {
      // Fallback to form's tenantId if slug wasn't provided but form belongs to a tenant
      query.tenantId = mongoose.Types.ObjectId.isValid(form.tenantId) ? new mongoose.Types.ObjectId(form.tenantId) : form.tenantId;
    }

    console.log(`[SUGGESTIONS] Querying previous answers for Form: ${formId}, Question: ${questionId}, Tenant: ${query.tenantId || 'N/A'}`);

    // Use aggregate for more reliable querying of Map fields and unique values
    // In MongoDB aggregation, fields within a Mongoose Map are accessed like normal nested fields: answers.key
    const pipeline = [
      { $match: query },
      {
        $project: {
          vals: [
            `$answers.${questionId}`,
            `$answers.${trackingQuestionId}`,
            `$answers._${questionId}`,
            `$answers._${trackingQuestionId}`
          ]
        }
      },
      { $unwind: "$vals" },
      { $match: { vals: { $ne: null, $ne: "" } } },
      {
        $group: {
          _id: "$vals"
        }
      },
      { $limit: 15 }
    ];

    console.log(`[SUGGESTIONS] Pipeline:`, JSON.stringify(pipeline, null, 2));

    const results = await Response.aggregate(pipeline);
    console.log(`[SUGGESTIONS] Found ${results.length} unique raw results`);

    const previousAnswers = results.map(r => r._id);
    console.log(`[SUGGESTIONS] Final answers list:`, previousAnswers);

    // Limit to top 10 unique answers to avoid overwhelming the UI
    const limitedAnswers = previousAnswers.slice(0, 10);

    return res.status(200).json({
      success: true,
      data: { answers: limitedAnswers }
    });

  } catch (error) {
    console.error('Get question previous answers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch previous answers'
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

    const metadata = {
      tenantId: req.body.tenantId || null,
      formId: req.body.formId || null,
      submissionId: batchId,
      submissionTimestamp: Date.now()
    };

    const processedResult = await processResponseImages(
      answers,
      metadata,  // ADD THIS
      onProgress,
      batchId
    );
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
      endDate,
      includePartial = 'false'
    } = req.query;

    const query = { ...req.tenantFilter };

    // Filter out partial submissions unless explicitly requested
    if (includePartial !== 'true') {
      query.isSectionSubmit = { $ne: true };
    }

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
        responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {},
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
      responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {},
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
      answers: Object.fromEntries(response.answers),
      responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {}
    };

    // Emit real-time event for updated response
    emitResponseUpdated(response.questionId, {
      id: response.id,
      questionId: response.questionId,
      status: response.status,
      submittedBy: response.submittedBy,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      answers: Object.fromEntries(response.answers),
      responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {}
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
    const { page = 1, limit = 10000, status, includePartial = 'false' } = req.query;

    // Verify form exists
    let formSearchQuery = { id: formId };

    // If not superadmin, check if form belongs to or is shared with this tenant
    // If not superadmin, check if form belongs to or is shared with this tenant
    if (req.user.role !== 'superadmin' && req.user.tenantId) {
      const tenantId = req.user.tenantId instanceof mongoose.Types.ObjectId
        ? req.user.tenantId
        : new mongoose.Types.ObjectId(req.user.tenantId);

      const tenantIdStr = tenantId.toString();

      formSearchQuery.$or = [
        { tenantId: tenantId },
        { sharedWithTenants: tenantId },
        { "chassisTenantAssignments.assignedTenants": tenantIdStr }
      ];
    }

    const form = await Form.findOne(formSearchQuery);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Determine access level
    const userIdStr = req.user._id.toString();
    const userTenantIdStr = req.user.tenantId?.toString();
    const isSuperAdmin = req.user.role === 'superadmin';
    const isOwner = form.tenantId && form.tenantId.toString() === userTenantIdStr;
    const isShared = form.sharedWithTenants && form.sharedWithTenants.some(t => t.toString() === userTenantIdStr);
    const hasChassisShare = Array.isArray(form.chassisTenantAssignments) && form.chassisTenantAssignments.some(
      a => a.assignedTenants && a.assignedTenants.includes(userTenantIdStr)
    );

    // Build response query
    const query = { questionId: formId };

    // Add status filter if provided
    if (status && status !== 'all') {
      query.status = status;
    }

    // Add partial submission filter
    if (includePartial !== 'true') {
      query.isSectionSubmit = { $ne: true };
    }

    // Apply tenant filtering
    // Inspector sees only their own responses - no tenant filter
    console.log('[GET RESPONSES] Inspector check - role:', req.user.role, 'userId:', req.user._id, 'tenantId:', req.user.tenantId, 'email:', req.user.email);
    if (req.user.role === 'inspector') {
  // Inspector sees ONLY their own responses
  const userEmail = req.user.email || '';
  const userUsername = req.user.username || '';
  const userId = req.user._id;
  
  // ✅ CORRECTED: Remove the "createdBy: null" condition
  query.$or = [
    { createdBy: userId },
    { submittedBy: userEmail },
    { submittedBy: userUsername },
    { "submitterContact.email": userEmail }
  ];
  
  console.log('[INSPECTOR] Filtering responses for user:', userId, userEmail);
  console.log('[INSPECTOR] Query $or:', JSON.stringify(query.$or));
} else if (isOwner || isSuperAdmin) {
      Object.assign(query, req.tenantFilter);
    } else if (!isShared && !hasChassisShare) {
      Object.assign(query, req.tenantFilter);
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    let responses = await Response.find(query)
      .populate('assignedTo', 'username firstName lastName email')
      .populate('verifiedBy', 'username firstName lastName email')
      .populate('createdBy', 'username firstName lastName email')
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    console.log('[GET RESPONSES] Query:', JSON.stringify(query));
    console.log('[GET RESPONSES] Responses found:', responses.length);
    if (responses.length > 0) {
      console.log('[GET RESPONSES] First response createdBy:', responses[0].createdBy);
      console.log('[GET RESPONSES] First response submittedBy:', responses[0].submittedBy);
    }

    // Apply granular chassis filtering for chassis-shared users
    if (!isSuperAdmin && !isOwner && hasChassisShare && !isShared) {
      const myAssignedChassis = (form.chassisTenantAssignments || [])
        .filter(a => a.assignedTenants && a.assignedTenants.includes(userTenantIdStr))
        .map(a => a.chassisNumber)
        .filter(Boolean);

      if (myAssignedChassis.length > 0) {
        // Find the question ID that has type 'chassisNumber'
        const chassisQuestion = form.sections?.flatMap(s => s.questions || []).find(q => q.type === 'chassisNumber')
          || form.followUpQuestions?.find(q => q.type === 'chassisNumber');
        const chassisFieldId = chassisQuestion?.id || 'chassis_number';

        responses = responses.filter(r => {
          const rAnswers = r.answers instanceof Map ? Object.fromEntries(r.answers) : (r.answers || {});
          return myAssignedChassis.includes(rAnswers[chassisFieldId] || rAnswers['chassis_number']);
        });
      } else {
        responses = [];
      }
    }

    const total = await Response.countDocuments(query);

    // Convert Map to Object for JSON serialization
  // Convert Map to Object for JSON serialization
const formattedResponses = responses.map(response => {
  const responseObj = response.toObject();
  
  // Determine the best display name for submittedBy
  let displaySubmittedBy = response.submittedBy;
  
  // If submittedBy is "Anonymous" or missing, try to get from createdBy
  if (!displaySubmittedBy || displaySubmittedBy === 'Anonymous') {
    if (response.createdBy) {
      if (typeof response.createdBy === 'object') {
        const firstName = response.createdBy.firstName || '';
        const lastName = response.createdBy.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        displaySubmittedBy = fullName || response.createdBy.email || response.createdBy.username;
      } else if (typeof response.createdBy === 'string') {
        displaySubmittedBy = response.createdBy;
      }
    }
  }
  
  // If still empty, use email from submitterContact
  if (!displaySubmittedBy || displaySubmittedBy === 'Anonymous') {
    displaySubmittedBy = response.submitterContact?.email || 'Anonymous';
  }
  
  return {
    ...responseObj,
    answers: response.answers ? Object.fromEntries(response.answers) : {},
    responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {},
    submissionMetadata: responseObj.submissionMetadata || null,
    submittedBy: displaySubmittedBy // Override with better display name
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
    const { format = 'json', status, includePartial = 'false' } = req.query;

    // Verify form exists
    let formSearchQuery = { id: formId };

    // If not superadmin, check if form belongs to or is shared with this tenant
    // If not superadmin, check if form belongs to or is shared with this tenant
    if (req.user.role !== 'superadmin' && req.user.tenantId) {
      const tenantId = req.user.tenantId instanceof mongoose.Types.ObjectId
        ? req.user.tenantId
        : new mongoose.Types.ObjectId(req.user.tenantId);

      const tenantIdStr = tenantId.toString();

      formSearchQuery.$or = [
        { tenantId: tenantId },
        { sharedWithTenants: tenantId },
        { "chassisTenantAssignments.assignedTenants": tenantIdStr }
      ];
    }

    const form = await Form.findOne(formSearchQuery);
    if (!form) {
      return res.status(404).json({
        success: false,
        message: 'Form not found'
      });
    }

    // Determine access level
    const userTenantIdStr = req.user.tenantId?.toString();
    const isSuperAdmin = req.user.role === 'superadmin';
    const isOwner = form.tenantId && form.tenantId.toString() === userTenantIdStr;
    const isShared = form.sharedWithTenants && form.sharedWithTenants.some(t => t.toString() === userTenantIdStr);
    const hasChassisShare = Array.isArray(form.chassisTenantAssignments) && form.chassisTenantAssignments.some(
      a => a.assignedTenants && a.assignedTenants.includes(userTenantIdStr)
    );

    const query = { questionId: formId };

    // Apply tenant filtering
    if (isOwner || isSuperAdmin) {
      Object.assign(query, req.tenantFilter);
    } else if (!isShared && !hasChassisShare) {
      Object.assign(query, req.tenantFilter);
    }

    // Filter out partial submissions unless explicitly requested
    if (includePartial !== 'true') {
      query.isSectionSubmit = { $ne: true };
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    let responses = await Response.find(query)
      .populate('assignedTo', 'username firstName lastName email')
      .populate('verifiedBy', 'username firstName lastName email')
      .sort({ createdAt: -1 });

    // Apply granular chassis filtering for chassis-shared users
    if (!isSuperAdmin && !isOwner && hasChassisShare && !isShared) {
      const myAssignedChassis = (form.chassisTenantAssignments || [])
        .filter(a => a.assignedTenants && a.assignedTenants.includes(userTenantIdStr))
        .map(a => a.chassisNumber)
        .filter(Boolean);

      if (myAssignedChassis.length > 0) {
        // Find the question ID that has type 'chassisNumber'
        const chassisQuestion = form.sections?.flatMap(s => s.questions || []).find(q => q.type === 'chassisNumber')
          || form.followUpQuestions?.find(q => q.type === 'chassisNumber');
        const chassisFieldId = chassisQuestion?.id || 'chassis_number';

        responses = responses.filter(r => {
          const rAnswers = r.answers instanceof Map ? Object.fromEntries(r.answers) : (r.answers || {});
          return myAssignedChassis.includes(rAnswers[chassisFieldId] || rAnswers['chassis_number']);
        });
      } else {
        responses = [];
      }
    }

    // Convert Map to Object for JSON serialization
    const formattedResponses = responses.map(response => ({
      ...response.toObject(),
      answers: response.answers ? Object.fromEntries(response.answers) : {},
      responseRanks: response.responseRanks ? Object.fromEntries(response.responseRanks) : {}
    }));

    if (format === 'json') {
      const filename = `${form.title}_responses.json`;
      const safeFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
      const encodedFilename = encodeURIComponent(filename);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
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
export const getUnassignedResponses = async (req, res) => {
  try {
    const { tenantId, startDate, endDate, limit = 100 } = req.query;

    const query = {
      tenantId,
      assignedTo: { $exists: false }, // Not assigned
      status: 'pending'
    };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const responses = await Response.find(query)
      .sort({ createdAt: 1 }) // Oldest first
      .limit(parseInt(limit))
      .lean();

    // Format answers
    const formattedResponses = responses.map(r => ({
      ...r,
      answers: r.answers instanceof Map ? Object.fromEntries(r.answers) : r.answers
    }));

    const total = await Response.countDocuments(query);

    res.json({
      success: true,
      data: {
        responses: formattedResponses,
        total,
        hasMore: total > parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get unassigned responses error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const assignResponses = async (req, res) => {
  try {
    const { responseIds, adminId } = req.body;

    if (!Array.isArray(responseIds) || responseIds.length === 0 || !adminId) {
      return res.status(400).json({
        success: false,
        message: 'Response IDs and admin ID are required'
      });
    }

    const result = await Response.updateMany(
      {
        id: { $in: responseIds },
        assignedTo: { $exists: false }
      },
      {
        $set: {
          assignedTo: adminId,
          assignedAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} responses assigned successfully`,
      data: { modifiedCount: result.modifiedCount }
    });
  } catch (error) {
    console.error('Assign responses error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
export const autoAssignResponse = async (req, res) => {
  try {
    const { responseId } = req.params;
    const { tenantId } = req.body;

    // Get all active admins/subadmins for this tenant
    const admins = await User.find({
      tenantId,
      role: { $in: ['admin', 'subadmin', 'inspector'] },
      isActive: true
    }).select('_id').lean();

    if (admins.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active admins available for assignment'
      });
    }

    // Get current assignment counts for round-robin
    const assignmentCounts = await Response.aggregate([
      {
        $match: {
          tenantId,
          assignedTo: { $ne: null },
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
        }
      },
      {
        $group: {
          _id: '$assignedTo',
          count: { $sum: 1 }
        }
      }
    ]);

    // Create map of adminId -> current load
    const loadMap = {};
    admins.forEach(admin => loadMap[admin._id.toString()] = 0);
    assignmentCounts.forEach(item => {
      loadMap[item._id.toString()] = item.count;
    });

    // Find admin with least load
    let selectedAdmin = admins[0];
    let minLoad = loadMap[selectedAdmin._id.toString()];

    admins.forEach(admin => {
      const load = loadMap[admin._id.toString()];
      if (load < minLoad) {
        minLoad = load;
        selectedAdmin = admin;
      }
    });

    // Assign the response
    const response = await Response.findOneAndUpdate(
      { id: responseId, assignedTo: { $exists: false } },
      {
        $set: {
          assignedTo: selectedAdmin._id,
          assignedAt: new Date()
        }
      },
      { new: true }
    );

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found or already assigned'
      });
    }

    res.json({
      success: true,
      message: 'Response assigned automatically',
      data: {
        responseId,
        assignedTo: selectedAdmin._id,
        adminLoad: loadMap
      }
    });
  } catch (error) {
    console.error('Auto-assign response error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};