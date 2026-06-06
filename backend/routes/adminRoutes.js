// Admin Routes
// API endpoints for administrative operations

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const syncUserMiddleware = require('../middleware/syncUserMiddleware');
const adminAuth = require('../middleware/adminAuth');
const { validate, schemas } = require('../middleware/validation');
const { adminOperationLimiter } = require('../middleware/rateLimiter');
const { getCacheStats, flushCache, invalidateCacheMiddleware } = require('../middleware/cacheMiddleware');

// Basic auth for all admin routes
router.use(authMiddleware);
router.use(syncUserMiddleware);
router.use(adminAuth);

/**
 * GET /api/admin/cache/stats
 * Get cache performance statistics
 * 🔐 Admin protected
 */
router.get('/cache/stats', getCacheStats);

/**
 * POST /api/admin/cache/flush
 * Flush all cached data
 * 🔐 Admin protected
 */
router.post('/cache/flush', adminOperationLimiter, flushCache);

/**
 * POST /api/admin/retrain
 * Trigger model retraining
 */
router.post('/retrain', 
  adminOperationLimiter, 
  validate(schemas.retrain), 
  invalidateCacheMiddleware({ resource: 'classification' }), 
  adminController.triggerRetraining
);

/**
 * GET /api/admin/retrain/status
 * Get current retraining/model status
 */
router.get('/retrain/status', adminController.getRetrainingStatus);

/**
 * POST /api/admin/dataset/build
 * Build training dataset from emails and feedback
 */
router.post('/dataset/build', 
  adminOperationLimiter, 
  validate(schemas.datasetBuild), 
  adminController.buildDataset
);

/**
 * GET /api/admin/ml/status
 * Get ML operation status
 */
router.get('/ml/status', adminController.getMLOperationStatus);

/**
 * POST /api/admin/ml/reload
 * Reload ML models without retraining
 */
router.post('/ml/reload', 
  adminOperationLimiter, 
  adminController.reloadMLModels
);

module.exports = router;