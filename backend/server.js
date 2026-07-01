// Load environment variables FIRST - before anything else
const dotenv = require('dotenv');
dotenv.config();

// Then all other imports
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');const timeout = require('connect-timeout');
const connectDB = require('./config/db');
const validateEnv = require('./config/validateEnv');
const { startScheduler } = require('./jobs/retrainJob');
const { startScanJob } = require('./jobs/scanJob');

// ... rest of the file remains the same
// Load environment variables from .env file
dotenv.config();

// ================================================
// GLOBAL ERROR HANDLERS (Critical for Production)
// ================================================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION! Shutting down gracefully...');
  console.error('Error:', error.name);
  console.error('Message:', error.message);
  console.error('Stack:', error.stack);
  
  // Give server time to finish pending requests
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION! Shutting down gracefully...');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  
  // Give server time to finish pending requests
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Skip database connection and environment validation during tests
if (process.env.NODE_ENV !== 'test') {
  // Validate environment variables before proceeding
  validateEnv();

  // Connect to MongoDB database
  connectDB();
}

// Initialize Express app
const app = express();

// Import middleware
const requestLogger = require('./middleware/requestLogger');
const { apiLimiter } = require('./middleware/rateLimiter');

// ================================================
// MIDDLEWARE CONFIGURATION
// ================================================

// Security headers (XSS, clickjacking protection, etc.)
app.use(helmet());

// Gzip compression for API responses (reduces bandwidth by ~70-90%)
app.use(compression({ 
  threshold: 1024, // Only compress responses > 1KB
  level: 6 // Compression level (0-9, 6 is balanced)
}));

// Request logging (minimal, production-safe)
app.use(requestLogger);

// Rate limiting for API protection
app.use('/api/', apiLimiter);

// Enable JSON parsing for incoming requests
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true, limit: '10kb' }))
// Enable CORS (Cross-Origin Resource Sharing)
// Restrict to specific frontend origin for security
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173', // Vite dev server
  'http://127.0.0.1:5173', // Vite dev server via loopback IP
  'http://localhost:3000',  // Legacy dev port
  'http://127.0.0.1:3000'  // Legacy dev port via loopback IP
].filter(Boolean); // Remove undefined values

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️  Blocked CORS request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies and authorization headers
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// ================================================
// ROUTES
// ================================================

// Import route modules
// Note: Auth is now handled by Clerk, no local auth routes needed
const healthRoutes = require('./routes/healthRoutes');
const gmailRoutes = require('./routes/gmailRoutes');
const emailRoutes = require('./routes/emailRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const adminRoutes = require('./routes/adminRoutes');
const migrationRoutes = require('./routes/migrationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const deletionRoutes = require('./routes/deletionRoutes');

// Test route - verifies server is running
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Mailguard Backend API is running successfully!'
  });
});

// Mount health check routes (no auth required for monitoring)
app.use('/health', timeout('10s'), healthRoutes);

// Mount Gmail OAuth routes (custom timeouts defined per-route)
app.use('/api/gmail', gmailRoutes);

// Mount email classification routes
app.use('/api/emails', timeout('60s'), emailRoutes); // 60s for classify operations

// Mount feedback routes
app.use('/api/feedback', timeout('30s'), feedbackRoutes);

// Mount admin routes
app.use('/api/admin', timeout('30s'), adminRoutes);

// Mount migration routes
app.use('/api/migration', timeout('90s'), migrationRoutes); // 90s for migration operations

// Mount analytics routes
app.use('/api/analytics', timeout('45s'), analyticsRoutes); // 45s for analytics operations

// Mount deletion audit routes
app.use('/api/deletion', timeout('30s'), deletionRoutes);

// ================================================
// ERROR HANDLING
// ================================================

// Import error handlers
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Timeout error handler (must be before other error handlers)
app.use((req, res, next) => {
  if (req.timedout) {
    console.warn(`⏱️  Request timeout: ${req.method} ${req.originalUrl}`);
    return res.status(408).json({
      success: false,
      message: 'Request timeout - operation took too long',
    });
  }
  next();
});

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Global error handler - must be last
app.use(errorHandler);

// ================================================
// SERVER STARTUP
// ================================================

// Get port from environment variables or use default 5000
const PORT = process.env.PORT || 5000;

// Start the server only if this file is run directly (not required as a module)
if (require.main === module) {
  // Start the server and listen on specified port
  app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
    
    // Initialize automatic retraining scheduler
    // startScheduler();
    
    // Initialize nightly email scan and cleanup job
    // startScanJob();
  });
}

// Export the app object for testing purposes
module.exports = app;
