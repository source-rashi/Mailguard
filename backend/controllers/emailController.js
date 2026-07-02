// Email Controller
// Handles email classification and related operations

const Email = require('../models/Email');
const Classification = require('../models/Classification');
const mlService = require('../services/mlService');
const { deleteEmail: deleteGmailEmail } = require('../services/gmailService');
const User = require('../models/User');

/**
 * Classify all unclassified emails using ML service
 * POST /api/emails/classify
 * Optional body: { forceReclassify: boolean } - re-classify already classified emails
 */
exports.classifyEmails = async (req, res) => {
  try {
    const userId = req.mongoUserId; // From syncUserMiddleware
    console.log('📊 Starting email classification...');

    // Check if ML service is available
    const isHealthy = await mlService.checkHealth();
    if (!isHealthy) {
      return res.status(503).json({
        success: false,
        error: 'ML service is not available'
      });
    }

    // Get forceReclassify flag from request body
    const forceReclassify = req.body?.forceReclassify === true;

    // Find emails to classify (ONLY user's emails for security)
    let emailsToClassify;
    if (forceReclassify) {
      // Re-classify user's emails (useful after model retraining)
      console.log('🔄 Force re-classifying user emails...');
      emailsToClassify = await Email.find({ userId }).limit(100);
    } else {
      // Only classify user's emails that haven't been classified yet
      const classifiedEmailIds = await Classification.distinct('emailId');
      emailsToClassify = await Email.find({
        userId, // Security: only classify user's own emails
        _id: { $nin: classifiedEmailIds }
      }).limit(100); // Process in batches
    }

    if (emailsToClassify.length === 0) {
      return res.json({
        success: true,
        message: 'No emails to classify',
        stats: {
          processed: 0,
          phishing: 0,
          safe: 0,
          updated: 0
        }
      });
    }

    // Classify each email
    const results = {
      processed: 0,
      phishing: 0,
      safe: 0,
      updated: 0, // Count of re-classifications
      errors: 0,
      failedEmailIds: [],
      totalRequested: emailsToClassify.length
    };

    for (const email of emailsToClassify) {
      try {
        // Combine subject and body for better classification
        const emailText = `${email.subject || ''} ${email.body || ''}`.trim();

        if (!emailText) {
          console.log(`⏭️  Skipping email ${email._id} - no text content`);
          continue;
        }

        // Get prediction from ML service
        console.log(`🤖 Classifying email: ${email.subject?.substring(0, 50) || 'No subject'}...`);
        const prediction = await mlService.predictEmail(emailText);

        // Save or update classification in database
        // Use findOneAndUpdate with upsert to handle both new and existing classifications
        const result = await Classification.findOneAndUpdate(
          { emailId: email._id },
          {
            userId,
            prediction: prediction.prediction,
            confidence: prediction.confidence,
            probabilities: prediction.probabilities,
            explanation: prediction.explanation,
            createdAt: new Date() // Update timestamp
          },
          {
            upsert: true, // Create if doesn't exist
            new: true, // Return updated document
            setDefaultsOnInsert: true
          }
        );

        // Track if this was an update vs new classification
        if (!result.isNew && forceReclassify) {
          results.updated++;
        }

        // Update stats
        results.processed++;
        if (prediction.prediction === 'phishing') {
          results.phishing++;
        } else {
          results.safe++;
        }

      } catch (error) {
        console.error(`❌ Error classifying email ${email._id}:`, error.message);
        results.errors++;
        // Map errors to safe categories (don't expose internal details)
        let safeReason = 'Prediction service unavailable';
        if (error.message.includes('timeout')) {
          safeReason = 'Request timeout';
        } else if (error.message.includes('not available')) {
          safeReason = 'ML service unavailable';
        } else if (error.message.includes('ValidationError')) {
          safeReason = 'Data validation failed';
        }
        results.failedEmailIds.push({
          emailId: email._id.toString(),
          subject: email.subject || '(No Subject)',
          reason: safeReason
        });
      }
    }

    // Validate prediction count equals request count
    const totalProcessed = emailsToClassify.length - results.errors; // Processed = total - failed
    const isPartialFailure = results.errors > 0 && results.processed > 0; // Some failed, some succeeded
    const isCompleteFail = results.processed === 0 && results.errors > 0; // All failed
    const isSuccess = results.errors === 0; // None failed

    res.json({
      success: isSuccess || isPartialFailure,
      status: isSuccess ? 'success' : (isPartialFailure ? 'partial-failure' : 'complete-failure'),
      message: isSuccess
        ? `Classified all ${results.processed} emails`
        : isPartialFailure
        ? `Classified ${results.processed}/${results.totalRequested} emails (${results.errors} failed)`
        : `Failed to classify all ${results.totalRequested} emails`,
      stats: results,
      validation: {
        totalRequested: results.totalRequested,
        succeeded: results.processed,
        failed: results.errors,
        failedEmails: results.failedEmailIds
      }
    });

  } catch (error) {
    console.error('❌ Classification error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get classification statistics
 * GET /api/emails/stats
 */
exports.getClassificationStats = async (req, res) => {
  try {
    const userId = req.mongoUserId;

    // OPTIMIZATION: Use aggregation pipeline instead of fetching all documents
    // Old approach: Fetch all emails, then all classifications, then filter in memory
    // New approach: Single aggregation query with $lookup and $group
    const stats = await Email.aggregate([
      // Stage 1: Match user's emails only
      {
        $match: { userId }
      },
      
      // Stage 2: Lookup classifications (left join)
      {
        $lookup: {
          from: 'classifications',
          localField: '_id',
          foreignField: 'emailId',
          as: 'classification'
        }
      },
      
      // Stage 3: Unwind classification array
      {
        $unwind: {
          path: '$classification',
          preserveNullAndEmptyArrays: true // Keep emails without classification
        }
      },
      
      // Stage 4: Add computed prediction field
      {
        $addFields: {
          prediction: {
            $ifNull: ['$classification.prediction', 'unclassified']
          }
        }
      },
      
      // Stage 5: Group by prediction and count
      {
        $group: {
          _id: '$prediction',
          count: { $sum: 1 }
        }
      }
    ]);

    // Format results
    const phishing = stats.find(s => s._id === 'phishing')?.count || 0;
    const safe = stats.find(s => s._id === 'safe')?.count || 0;
    const unclassified = stats.find(s => s._id === 'unclassified')?.count || 0;
    const total = phishing + safe + unclassified;
    const classified = phishing + safe;

    res.json({
      success: true,
      total: total,
      phishing: phishing,
      safe: safe,
      legitimate: safe, // Alias for compatibility
      classified: classified,
      unclassified: unclassified
    });

  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get all classified emails with predictions
 * GET /api/emails/classified
 * Query params: page, limit, prediction, search, dateFrom, dateTo
 */
exports.getClassifiedEmails = async (req, res) => {
  try {
    const userId = req.mongoUserId;
    const { 
      prediction, 
      limit = 50, 
      page = 1,
      search = '',
      dateFrom,
      dateTo,
      sortBy = 'receivedAt',
      sortOrder = 'desc'
    } = req.query;

    // Calculate pagination
    const limitNum = Math.min(Math.max(parseInt(limit), 1), 100); // Between 1 and 100
    const pageNum = Math.max(parseInt(page), 1);
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline for optimized query
    // OPTIMIZATION: Use $lookup to join emails with classifications in single query
    // Eliminates N+1 query pattern for better performance
    const pipeline = [];

    // Stage 1: Match user's emails
    const matchStage = { userId };
    
    // Add date range filter if provided
    if (dateFrom || dateTo) {
      matchStage.receivedAt = {};
      if (dateFrom) {
        matchStage.receivedAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        matchStage.receivedAt.$lte = new Date(dateTo);
      }
    }
    
    // Add search filter using text index if provided
    if (search) {
      // Use text search index for better performance than regex
      // Falls back to regex if text index not available
      if (search.includes(' ')) {
        // Multi-word search: use text index
        matchStage.$text = { $search: search };
      } else {
        // Single word: use regex for partial matching
        matchStage.$or = [
          { subject: { $regex: search, $options: 'i' } },
          { sender: { $regex: search, $options: 'i' } },
          { body: { $regex: search, $options: 'i' } }
        ];
      }
    }

    pipeline.push({ $match: matchStage });

    // Stage 2: Lookup classifications (join operation)
    // CRITICAL: Single query instead of N+1 pattern
    pipeline.push({
      $lookup: {
        from: 'classifications',
        localField: '_id',
        foreignField: 'emailId',
        as: 'classification'
      }
    });

    // Stage 3: Unwind classification array (convert array to object)
    pipeline.push({
      $unwind: {
        path: '$classification',
        preserveNullAndEmptyArrays: true // Keep emails without classification
      }
    });

    // Stage 4: Filter by prediction if specified
    if (prediction) {
      if (prediction === 'pending') {
        pipeline.push({
          $match: { classification: null }
        });
      } else {
        pipeline.push({
          $match: { 'classification.prediction': prediction }
        });
      }
    }

    // Stage 5: Add computed fields
    pipeline.push({
      $addFields: {
        prediction: {
          $ifNull: ['$classification.prediction', 'pending']
        },
        confidence: {
          $ifNull: ['$classification.confidence', 0]
        },
        explanation: {
          $ifNull: ['$classification.explanation', { top_signals: [], method: 'unavailable' }]
        },
        classified: {
          $cond: [{ $ne: ['$classification', null] }, true, false]
        }
      }
    });

    // Get total count before pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Email.aggregate(countPipeline);
    const totalEmails = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalEmails / limitNum);

    // Stage 6: Sort
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: { [sortBy]: sortDirection } });

    // Stage 7: Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    // Stage 8: Project only needed fields (reduce data transfer)
    pipeline.push({
      $project: {
        _id: 1,
        subject: 1,
        sender: 1,
        body: {
          $cond: {
            if: { $gte: [{ $strLenCP: '$body' }, 200] },
            then: { $substrCP: ['$body', 0, 200] },
            else: '$body'
          }
        }, // Truncate body safely with UTF-8 support
        receivedAt: 1,
        gmailId: 1,
        prediction: 1,
        confidence: 1,
        explanation: 1,
        classified: 1
      }
    });

    // Execute aggregation pipeline
    const emails = await Email.aggregate(pipeline);

    res.json({
      success: true,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalEmails,
        totalPages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      },
      count: emails.length,
      emails: emails
    });

  } catch (error) {
    console.error('❌ Get classified emails error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Delete a single email from Gmail and Database
 * DELETE /api/emails/:id
 */
exports.deleteEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.mongoUserId; // From syncUserMiddleware

    console.log(`🗑️  Delete request for email ID: ${id} by user: ${userId}`);

    // Step 1: Find the email in database
    const email = await Email.findOne({ _id: id, userId: userId });

    if (!email) {
      return res.status(404).json({
        success: false,
        error: 'Email not found or you do not have permission to delete it'
      });
    }

    console.log(`📧 Found email: ${email.subject} (Gmail ID: ${email.gmailId})`);

    // Step 2: Get user's Gmail tokens
    const user = await User.findById(userId);

    if (!user || !user.gmailAccessToken) {
      return res.status(400).json({
        success: false,
        error: 'Gmail not connected. Cannot delete email from Gmail.'
      });
    }

    // Step 3: Delete from Gmail using Gmail API (MUST succeed before DB deletion)
    try {
      await deleteGmailEmail(
        email.gmailId,
        user.gmailAccessToken,
        user.gmailRefreshToken
      );
      console.log(`✅ Email deleted from Gmail: ${email.gmailId}`);
    } catch (gmailError) {
      console.error(`❌ Gmail deletion failed: ${gmailError.message}`);
      
      // If Gmail deletion fails, do NOT delete from database
      // Return error to user indicating the problem
      return res.status(500).json({
        success: false,
        error: 'Failed to delete email from Gmail. Database record preserved.',
        details: gmailError.message
      });
    }

    // Step 4: Delete associated classification
    await Classification.deleteOne({ emailId: email._id });
    console.log(`✅ Classification deleted for email: ${email._id}`);

    // Step 5: Delete email from database
    await Email.deleteOne({ _id: email._id });
    console.log(`✅ Email deleted from database: ${email._id}`);

    // Step 6: Return success response
    res.json({
      success: true,
      message: 'Email deleted successfully',
      deletedEmail: {
        id: email._id,
        subject: email.subject,
        sender: email.sender,
        gmailId: email.gmailId
      }
    });

  } catch (error) {
    console.error('❌ Delete email error:', error);
    
    // Handle specific error types
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete email',
      details: error.message
    });
  }
};

/**
 * Bulk delete multiple emails from Gmail and Database
 * POST /api/emails/bulk-delete
 * Body: { emailIds: [id1, id2, id3] }
 */
exports.bulkDeleteEmails = async (req, res) => {
  try {
    const { emailIds } = req.body;
    const userId = req.mongoUserId; // From syncUserMiddleware

    console.log(`🗑️  Bulk delete request for ${emailIds?.length || 0} emails by user: ${userId}`);

    // Step 1: Validate input
    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'emailIds array is required and must not be empty'
      });
    }

    // Limit bulk delete to prevent abuse
    if (emailIds.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete more than 100 emails at once'
      });
    }

    // Step 2: Find all emails belonging to the user
    const emails = await Email.find({
      _id: { $in: emailIds },
      userId: userId // Security: only delete user's own emails
    });

    if (emails.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No emails found or you do not have permission to delete them'
      });
    }

    console.log(`📧 Found ${emails.length} emails to delete`);

    // Step 3: Get user's Gmail tokens
    const user = await User.findById(userId);

    if (!user || !user.gmailAccessToken) {
      return res.status(400).json({
        success: false,
        error: 'Gmail not connected. Cannot delete emails from Gmail.'
      });
    }

    // Step 4: Delete each email from Gmail and database
    const results = {
      total: emails.length,
      successful: 0,
      failed: 0,
      gmailErrors: 0,
      deletedEmails: []
    };

    for (const email of emails) {
      try {
        // Delete from Gmail (MUST succeed before DB deletion)
        try {
          await deleteGmailEmail(
            email.gmailId,
            user.gmailAccessToken,
            user.gmailRefreshToken
          );
          console.log(`✅ Gmail deleted: ${email.gmailId}`);
        } catch (gmailError) {
          console.error(`❌ Gmail deletion failed for ${email.gmailId}: ${gmailError.message}`);
          results.gmailErrors++;
          results.failed++;
          // Skip DB deletion if Gmail deletion fails
          continue;
        }

        // Only proceed if Gmail deletion succeeded
        // Delete classification
        await Classification.deleteOne({ emailId: email._id });

        // Delete from database
        await Email.deleteOne({ _id: email._id });

        results.successful++;
        results.deletedEmails.push({
          id: email._id,
          subject: email.subject,
          sender: email.sender
        });

        console.log(`✅ Deleted: ${email.subject}`);

      } catch (error) {
        console.error(`❌ Failed to delete email ${email._id}:`, error.message);
        results.failed++;
      }
    }

    console.log(`✅ Bulk delete complete: ${results.successful} successful, ${results.failed} failed`);

    // Step 5: Return results
    res.json({
      success: true,
      message: `Successfully deleted ${results.successful} out of ${results.total} emails`,
      results: results
    });

  } catch (error) {
    console.error('❌ Bulk delete emails error:', error);
    
    // Handle specific error types
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email ID format in emailIds array'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to bulk delete emails',
      details: error.message
    });
  }
};
/**
 * Clear ALL emails from database (for user only)
 * POST /api/emails/clear-all
 * Removes all emails and classifications for security/privacy or to start fresh
 */
exports.clearAllEmails = async (req, res) => {
  try {
    const userId = req.mongoUserId;
    
    console.log(`🗑️ Clearing all emails for user: ${userId}`);

    // Count before deletion
    const emailCount = await Email.countDocuments({ userId });
    
    if (emailCount === 0) {
      return res.json({
        success: true,
        message: 'No emails to clear',
        deleted: 0
      });
    }

    // Get all email IDs for this user
    const emails = await Email.find({ userId }).select('_id');
    const emailIds = emails.map(e => e._id);

    // Delete all classifications for these emails
    const classificationResult = await Classification.deleteMany({ 
      emailId: { $in: emailIds } 
    });

    // Delete all emails
    const emailResult = await Email.deleteMany({ userId });

    console.log(`✅ Cleared ${emailResult.deletedCount} emails and ${classificationResult.deletedCount} classifications`);

    res.json({
      success: true,
      message: `Successfully cleared ${emailResult.deletedCount} emails`,
      deleted: emailResult.deletedCount,
      classificationsDeleted: classificationResult.deletedCount
    });

  } catch (error) {
    console.error('❌ Error clearing all emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear emails',
      details: error.message
    });
  }
};
/**
 * Auto clean all phishing emails
 * POST /api/emails/clean-phishing
 * Finds all emails classified as phishing and deletes them
 */
exports.cleanPhishingEmails = async (req, res) => {
  try {
    const userId = req.mongoUserId; // From syncUserMiddleware

    console.log(`🧹 Auto-clean phishing emails request by user: ${userId}`);

    // Step 1: Find all phishing classifications for user's emails
    const userEmails = await Email.find({ userId: userId }).select('_id');
    const userEmailIds = userEmails.map(e => e._id);

    // Find all phishing classifications
    const phishingClassifications = await Classification.find({
      emailId: { $in: userEmailIds },
      prediction: 'phishing'
    });

    if (phishingClassifications.length === 0) {
      return res.json({
        success: true,
        message: 'No phishing emails found to clean',
        results: {
          total: 0,
          deleted: 0,
          failed: 0
        }
      });
    }

    console.log(`🎯 Found ${phishingClassifications.length} phishing emails to delete`);

    // Step 2: Get user's Gmail tokens
    const user = await User.findById(userId);

    if (!user || !user.gmailAccessToken) {
      return res.status(400).json({
        success: false,
        error: 'Gmail not connected. Cannot delete emails from Gmail.'
      });
    }

    // Step 3: Extract email IDs from classifications
    const phishingEmailIds = phishingClassifications.map(c => c.emailId);

    // Step 4: Find all phishing emails
    const phishingEmails = await Email.find({
      _id: { $in: phishingEmailIds },
      userId: userId
    });

    // Step 5: Delete each phishing email
    const results = {
      total: phishingEmails.length,
      deleted: 0,
      failed: 0,
      gmailErrors: 0,
      storageSaved: 0, // Approximate storage in bytes
      deletedEmails: []
    };

    for (const email of phishingEmails) {
      try {
        // Delete from Gmail
        try {
          await deleteGmailEmail(
            email.gmailId,
            user.gmailAccessToken,
            user.gmailRefreshToken
          );
          console.log(`✅ Gmail deleted: ${email.gmailId}`);
        } catch (gmailError) {
          console.error(`⚠️  Gmail deletion failed for ${email.gmailId}: ${gmailError.message}`);
          results.gmailErrors++;
        }

        // Estimate storage saved (rough estimate: subject + body length)
        const emailSize = (email.subject?.length || 0) + (email.body?.length || 0);
        results.storageSaved += emailSize;

        // Delete classification
        await Classification.deleteOne({ emailId: email._id });

        // Delete from database
        await Email.deleteOne({ _id: email._id });

        results.deleted++;
        results.deletedEmails.push({
          id: email._id,
          subject: email.subject,
          sender: email.sender
        });

        console.log(`✅ Phishing email deleted: ${email.subject}`);

      } catch (error) {
        console.error(`❌ Failed to delete phishing email ${email._id}:`, error.message);
        results.failed++;
      }
    }

    // Convert bytes to KB/MB for display
    const storageSavedKB = (results.storageSaved / 1024).toFixed(2);
    const storageSavedMB = (results.storageSaved / (1024 * 1024)).toFixed(2);

    console.log(`✅ Clean phishing complete: ${results.deleted} deleted, ${results.failed} failed`);
    console.log(`💾 Approximate storage saved: ${storageSavedMB} MB`);

    // Step 6: Return results
    res.json({
      success: true,
      message: `Successfully cleaned ${results.deleted} phishing emails`,
      results: {
        total: results.total,
        deleted: results.deleted,
        failed: results.failed,
        gmailErrors: results.gmailErrors,
        storageSaved: {
          bytes: results.storageSaved,
          kb: storageSavedKB,
          mb: storageSavedMB
        },
        deletedEmails: results.deletedEmails
      }
    });

  } catch (error) {
    console.error('❌ Clean phishing emails error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
