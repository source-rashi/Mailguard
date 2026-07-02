// Email Routes
// API endpoints for email classification
// Updated: Replaced deprecated csurf with helmet + custom CSRF middleware
const express = require('express');
const helmet = require('helmet');
// Custom CSRF protection using double-submit cookie pattern
const csrfProtection = require('../middleware/csrfProtection');
const router = express.Router();
const emailController = require('../controllers/emailController');
const authMiddleware = require('../middleware/authMiddleware');
const syncUserMiddleware = require('../middleware/syncUserMiddleware');
const { validate, schemas } = require('../middleware/validation');
const { cacheMiddleware, invalidateCacheMiddleware, cachePresets } = require('../middleware/cacheMiddleware');
const { classifyLimiter, bulkOperationLimiter } = require('../middleware/rateLimiter');
const { invalidateAnalyticsCache } = require('../middleware/analyticsCache');

// Apply security headers globally for email routes
router.use(helmet());

// All email routes require authentication and user sync
router.use(authMiddleware);
router.use(syncUserMiddleware);

/**
 * GET /api/emails/csrf-token
 * Issue a CSRF token for subsequent mutations on email routes
 * Required before making POST/PUT/DELETE requests
 */
router.get('/csrf-token', (req, res) => {
  try {
    const token = csrfProtection.generateToken(req, res);

    res.json({
      success: true,
      csrfToken: token,
      message: 'CSRF token issued successfully. Use this token in X-CSRF-Token header for mutations.'
    });
  } catch (error) {
    console.error('Error generating CSRF token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate CSRF token'
    });
  }
});

// Classify all unclassified emails
// INVALIDATES: User cache and analytics cache after classification completes
router.post('/classify', csrfProtection.middleware,
  classifyLimiter, 
  validate(schemas.classifyEmails), 
  invalidateCacheMiddleware(cachePresets.user),
  invalidateAnalyticsCache,
  emailController.classifyEmails
);

// Get classification statistics
// CACHED: 3 minutes (stats change infrequently)
router.get('/stats', csrfProtection.middleware,
  cacheMiddleware(cachePresets.stats), 
  emailController.getClassificationStats
);

// Get all emails (alias for /classified for backward compatibility)
// CACHED: 5 minutes with pagination awareness
router.get('/', csrfProtection.middleware, 
  validate(schemas.emailQuery, 'query'), 
  cacheMiddleware(cachePresets.emailList),
  emailController.getClassifiedEmails
);

// Get classified emails
// CACHED: 5 minutes with pagination awareness
router.get('/classified', csrfProtection.middleware, 
  validate(schemas.emailQuery, 'query'), 
  cacheMiddleware(cachePresets.emailList),
  emailController.getClassifiedEmails
);

// Delete a single email
// INVALIDATES: User cache after deletion
router.delete('/:id', csrfProtection.middleware, 
  validate(schemas.idParam, 'params'), 
  invalidateCacheMiddleware(), // Clear user cache after delete
  emailController.deleteEmail
);

// Bulk delete multiple emails
// INVALIDATES: User cache after bulk deletion
router.post('/bulk-delete', csrfProtection.middleware, 
  bulkOperationLimiter, 
  validate(schemas.bulkOperation), 
  invalidateCacheMiddleware(), // Clear user cache after bulk delete
  emailController.bulkDeleteEmails
);

// Auto clean all phishing emails
// INVALIDATES: User cache after cleaning phishing emails
router.post('/clean-phishing', csrfProtection.middleware, 
  bulkOperationLimiter, 
  invalidateCacheMiddleware(), // Clear user cache after clean
  emailController.cleanPhishingEmails
);

// Clear all emails from database
// INVALIDATES: User cache after clearing all emails
router.post('/clear-all', csrfProtection.middleware, 
  bulkOperationLimiter, 
  invalidateCacheMiddleware(), // Clear user cache after clear
  emailController.clearAllEmails
);

module.exports = router;
