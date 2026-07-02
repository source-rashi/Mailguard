// Import Express router
const express = require('express');
const router = express.Router();
const timeout = require('connect-timeout');

// Import Gmail controller functions
const {
  initiateGmailAuth,
  handleGmailCallback,
  checkGmailStatus,
  disconnectGmail,
  fetchAndSaveEmails
} = require('../controllers/gmailController');

// Import JWT authentication middleware
const authMiddleware = require('../middleware/authMiddleware');
const syncUserMiddleware = require('../middleware/syncUserMiddleware');
const { gmailFetchLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validation');
const { invalidateCacheMiddleware } = require('../middleware/cacheMiddleware');

/**
 * GMAIL OAUTH ROUTES
 * All routes are prefixed with /api/gmail (defined in server.js)
 */

  /**
   * @route   POST /api/gmail/auth/initiate
   * @desc    Initiate Gmail OAuth flow (get authorization URL)
   * @access  Protected (requires JWT token)
   * @header  Authorization: Bearer <token>
   * @returns Authorization URL to redirect user to Google consent screen
   */
router.post('/auth/initiate', timeout('30s'), authMiddleware, syncUserMiddleware, initiateGmailAuth);

/**
 * @route   GET /api/gmail/callback
 * @desc    Handle OAuth callback from Google
 * @access  Public (validated via state parameter)
 * @query   code - Authorization code from Google
 * @query   state - State parameter containing userId
 * @returns Success message with user data
 */
router.get('/callback', timeout('30s'), handleGmailCallback);

/**
 * @route   GET /api/gmail/status
 * @desc    Check if user has connected Gmail
 * @access  Protected (requires JWT token)
 * @header  Authorization: Bearer <token>
 * @returns Gmail connection status
 */
router.get('/status', timeout('30s'), authMiddleware, syncUserMiddleware, checkGmailStatus);

/**
 * @route   DELETE /api/gmail/disconnect
 * @desc    Disconnect Gmail from user account
 * @access  Protected (requires JWT token)
 * @header  Authorization: Bearer <token>
 * @returns Success message
 */
router.delete('/disconnect', timeout('30s'), authMiddleware, syncUserMiddleware, disconnectGmail);

/**
 * @route   POST /api/gmail/fetch
 * @desc    Fetch emails from Gmail and save to database
 * @access  Protected (requires JWT token)
 * @header  Authorization: Bearer <token>
 * @query   maxResults - Number of emails to fetch (default: 20, max: 100)
 * @returns Statistics about fetched and saved emails
 * @ratelimit 10 requests per hour per IP
 * INVALIDATES: User cache after fetching new emails
 */
router.post('/fetch', 
  timeout('180s'), // 3 minute timeout for Gmail fetch (handles large email volumes)
  gmailFetchLimiter, 
  validate(schemas.gmailFetch, 'body'), 
  authMiddleware, 
  syncUserMiddleware, 
  invalidateCacheMiddleware(), // Invalidate user cache after fetch
  fetchAndSaveEmails
);

// Export the router
module.exports = router;
