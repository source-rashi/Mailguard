/**
 * Cache Middleware
 * Provides response caching for API endpoints
 * Reduces database load and improves response times
 */

const cache = require('../utils/cache');

/**
 * Cache Middleware Factory
 * Creates middleware that caches GET request responses
 * 
 * @param {object} options - Cache options
 * @param {number} [options.ttl=300] - Time-to-live in seconds (default: 5 minutes)
 * @param {function} [options.keyGenerator] - Custom cache key generator
 * @param {function} [options.shouldCache] - Function to determine if response should be cached
 * @returns {function} Express middleware function
 * 
 * @example
 * // Simple caching with default 5-minute TTL
 * router.get('/stats', cacheMiddleware(), getStats);
 * 
 * @example
 * // Custom TTL (10 minutes)
 * router.get('/stats', cacheMiddleware({ ttl: 600 }), getStats);
 * 
 * @example
 * // Custom key generator including query params
 * router.get('/emails', cacheMiddleware({
 *   keyGenerator: (req) => `emails:${req.mongoUserId}:${req.query.page}:${req.query.limit}`
 * }), getEmails);
 */
function cacheMiddleware(options = {}) {
  const {
    ttl = 300, // Default: 5 minutes
    keyGenerator = null,
    shouldCache = null
  } = options;

  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    let cacheKey;
    if (keyGenerator) {
      // Use custom key generator
      cacheKey = keyGenerator(req);
    } else {
      // Default: use userId + route path + query params
      const userId = req.mongoUserId || req.userId || 'anonymous';
   const queryString = Object.keys(req.query).length > 0 
  ? JSON.stringify(Object.keys(req.query).sort().reduce((acc, key) => {
      acc[key] = req.query[key];
      return acc;
    }, {}))
  : '';
      cacheKey = `route:${userId}:${req.path}${queryString}`;
    }

    // Check if response is cached
    const cachedResponse = cache.get(cacheKey);
    
    if (cachedResponse) {
      // Cache HIT - Return cached response
      console.log(`⚡ Cache HIT - Serving cached response for: ${req.path}`);

      // Add cache header (but not the internal cache key for security)
      res.set('X-Cache', 'HIT');

      return res.json(cachedResponse);
    }

    // Cache MISS - Proceed to route handler
    console.log(`📥 Cache MISS - Fetching fresh data for: ${req.path}`);
    
    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    
    res.json = function(body) {
      // Determine if response should be cached
      let shouldCacheResponse = true;
      
      if (shouldCache) {
        shouldCacheResponse = shouldCache(req, res, body);
      } else {
        // Default: only cache successful responses
        shouldCacheResponse = res.statusCode >= 200 && res.statusCode < 300;
      }
      
      // Cache the response if criteria met
      if (shouldCacheResponse) {
        cache.set(cacheKey, body, ttl);
        console.log(`💾 Response cached for ${ttl}s: ${req.path}`);

        // Add cache header (but not the internal cache key for security)
        res.set('X-Cache', 'MISS');
      } else {
        console.log(`⏭️  Response NOT cached (status: ${res.statusCode}): ${req.path}`);
        res.set('X-Cache', 'SKIP');
      }
      
      // Send original response
      return originalJson(body);
    };

    next();
  };
}

/**
 * Cache Invalidation Middleware
 * Invalidates relevant cache entries after data mutations
 * Use this on POST, PUT, PATCH, DELETE routes that modify data
 * 
 * @param {object} options - Invalidation options
 * @param {string|string[]} [options.invalidate] - Cache keys or patterns to invalidate
 * @param {function} [options.invalidateUser] - Invalidate all cache for user (default: true)
 * @param {string} [options.resource] - Resource type to invalidate
 * @returns {function} Express middleware function
 * 
 * @example
 * // Invalidate user's cache after classification
 * router.post('/classify', invalidateCacheMiddleware(), classifyEmails);
 * 
 * @example
 * // Invalidate specific resource
 * router.post('/emails', invalidateCacheMiddleware({ resource: 'stats' }), createEmail);
 */
function invalidateCacheMiddleware(options = {}) {
  const {
    invalidate = null,
    invalidateUser: shouldInvalidateUser = true,
    resource = null
  } = options;

  return async (req, res, next) => {
    // Store original res.json
    const originalJson = res.json.bind(res);
    
    // Intercept res.json to invalidate cache after successful response
    res.json = function(body) {
      // Only invalidate on successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.mongoUserId || req.userId;
        
        // Invalidate specific keys/patterns
        if (invalidate) {
          const keys = Array.isArray(invalidate) ? invalidate : [invalidate];
          keys.forEach(key => {
            cache.del(key);
            console.log(`🗑️  Cache invalidated: ${key}`);
          });
        }
        
        // Invalidate all user cache
        if (shouldInvalidateUser && userId) {
          const deletedCount = cache.invalidateUser(userId);
          console.log(`🗑️  User cache invalidated: ${userId} (${deletedCount} entries)`);
        }
        
        // Invalidate resource-specific cache
        if (resource) {
          const deletedCount = cache.invalidateResource(resource);
          console.log(`🗑️  Resource cache invalidated: ${resource} (${deletedCount} entries)`);
        }
      }
      
      return originalJson(body);
    };

    next();
  };
}

/**
 * Cache Statistics Endpoint Handler
 * Returns cache performance metrics
 * Mount this at an admin-only route
 * 
 * @example
 * router.get('/admin/cache/stats', requireAdmin, getCacheStats);
 */
function getCacheStats(req, res) {
  const stats = cache.getStats();
  const size = cache.getSize();
  
  res.json({
    success: true,
    cache: {
      ...stats,
      ...size
    }
  });
}

/**
 * Cache Flush Endpoint Handler
 * Clears all cached data
 * Mount this at an admin-only route
 * USE WITH CAUTION: Impacts all users
 * 
 * @example
 * router.post('/admin/cache/flush', requireAdmin, flushCache);
 */
function flushCache(req, res) {
  cache.flush();
  
  res.json({
    success: true,
    message: 'Cache flushed successfully'
  });
}

/**
 * Preset cache configurations for common use cases
 */
const cachePresets = {
  // Short-lived cache for real-time data (1 minute)
  realtime: { ttl: 60 },
  
  // Standard cache for frequently accessed data (5 minutes)
  standard: { ttl: 300 },
  
  // Long-lived cache for stable data (30 minutes)
  long: { ttl: 1800 },
  
  // Very long cache for rarely changing data (1 hour)
  veryLong: { ttl: 3600 },
  
  // Stats endpoint cache (3 minutes)
  stats: { 
    ttl: 180,
    keyGenerator: (req) => {
      const userId = req.mongoUserId || req.userId || 'anonymous';
      return cache.generateKey(userId, 'stats');
    }
  },
  
  // Email list cache with pagination (5 minutes)
  emailList: {
    ttl: 300,
    keyGenerator: (req) => {
      const userId = req.mongoUserId || req.userId || 'anonymous';
      const { page = 1, limit = 50, prediction, search, dateFrom, dateTo } = req.query;
      return cache.generateKey(userId, 'emails', { page, limit, prediction, search, dateFrom, dateTo });
    }
  },
  
  // Classification results (10 minutes - stable after classification)
  classification: {
    ttl: 600,
    keyGenerator: (req) => {
      const userId = req.mongoUserId || req.userId || 'anonymous';
      return cache.generateKey(userId, 'classified');
    }
  }
};

module.exports = {
  cacheMiddleware,
  invalidateCacheMiddleware,
  getCacheStats,
  flushCache,
  cachePresets
};
