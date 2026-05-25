/**
 * GLOBAL ERROR HANDLER MIDDLEWARE
 * Catches all unhandled errors in the application
 * Returns consistent JSON error responses
 * Prevents server crashes from unhandled errors
 * 
 * Must be registered AFTER all routes in server.js
 * Usage: app.use(errorHandler);
 */

/**
 * Global error handling middleware
 * @param {Error} err - The error object
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  // Sanitize request data before logging (remove sensitive headers)
  const sanitizedPath = req.path;
  const sanitizedMethod = req.method;
  
  // Log the error for debugging (sanitized)
  console.error('❌ Unhandled Error:');
  console.error(`   Path: ${sanitizedMethod} ${sanitizedPath}`);
  console.error(`   Message: ${err.message}`);
  
  // Log stack trace in development (but not request headers with tokens)
  if (process.env.NODE_ENV !== 'production') {
    console.error(`   Stack: ${err.stack}`);
    // Don't log req object as it may contain Authorization headers
  }

  // Determine status code
  // Use error's statusCode if available, otherwise default to 500
  const statusCode = err.statusCode || (res.statusCode !== 200? res.statusCode : 500);

  // Prepare error response (never include sensitive data)
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error',
    error: {
      status: statusCode,
      timestamp: new Date().toISOString()
    }
  };

  // Add stack trace in development mode (but sanitize it)
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.error.stack = err.stack;
    // Warning: Stack traces should NOT be exposed in production
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    errorResponse.message = 'Validation failed';
    errorResponse.error.details = Object.values(err.errors).map(e => e.message);
    return res.status(400).json(errorResponse);
  }

  if (err.name === 'CastError') {
    errorResponse.message = 'Invalid ID format';
    return res.status(400).json(errorResponse);
  }

  if (err.code === 11000) {
    errorResponse.message = 'Duplicate entry. This record already exists.';
    return res.status(409).json(errorResponse);
  }

  if (err.name === 'JsonWebTokenError') {
    errorResponse.message = 'Invalid token';
    return res.status(401).json(errorResponse);
  }

  if (err.name === 'TokenExpiredError') {
    errorResponse.message = 'Token expired';
    return res.status(401).json(errorResponse);
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * Handle 404 - Not Found errors
 * Use this before the global error handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  
  console.warn(`⚠️  404 Not Found: ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: {
      status: 404,
      timestamp: new Date().toISOString()
    }
  });
};

/**
 * REMOVED: Global error handlers (uncaughtException, unhandledRejection)
 * These are now registered in server.js BEFORE any async operations
 * to ensure they're the first handlers in the chain.
 * 
 * Having them here caused duplicate registration, leading to:
 * - Double logging of the same errors
 * - Race conditions on process.exit()
 * - Confusion in production error tracking
 * 
 * See server.js lines 20-43 for the authoritative global error handlers.
 */

// Export middleware
module.exports = {
  errorHandler,
  notFoundHandler
};
