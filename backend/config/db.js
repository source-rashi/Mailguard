// Import mongoose for MongoDB connection
const mongoose = require('mongoose');

/**
 * Connect to MongoDB database with retry logic
 * Uses MONGO_URI from environment variables
 * @param {number} retries - Number of retry attempts (default: 5)
 * @param {number} retryDelay - Delay between retries in ms (default: 5000)
 * @returns {Promise} - Resolves when connection is successful
 */
const connectDB = async (retries = 5, retryDelay = 5000) => {
  // Validate MONGO_URI exists
  if (!process.env.MONGO_URI) {
    console.error('❌ FATAL ERROR: MONGO_URI environment variable is not defined');
    console.error('   Please set MONGO_URI in your .env file');
    console.error('   Example: MONGO_URI=mongodb://localhost:27017/mailguard');
    process.exit(1);
  }

  // Connection options
  const options = {
    serverSelectionTimeoutMS: 10000, // 10 second timeout
    socketTimeoutMS: 45000, // 45 second socket timeout
    family: 4, // Use IPv4, skip IPv6
  };

  let attempt = 0;

  while (attempt < retries) {
    try {
      attempt++;
      
      if (attempt > 1) {
        console.log(`🔄 Retry attempt ${attempt}/${retries} in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.log('📡 Connecting to MongoDB...');
      }

      // Attempt to connect to MongoDB
      const conn = await mongoose.connect(process.env.MONGO_URI, options);

      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      
      // Setup connection event handlers
      setupConnectionHandlers();
      
      return conn;

    } catch (error) {
      console.error(`❌ MongoDB Connection Failed (attempt ${attempt}/${retries})`);
      console.error(`   Error: ${error.message}`);

      // If this was the last retry, provide detailed troubleshooting
      if (attempt >= retries) {
        console.error('\n❌ FATAL: Could not connect to MongoDB after multiple attempts\n');
        console.error('Troubleshooting steps:');
        console.error('  1. Verify MongoDB is running: mongod --version');
        console.error('  2. Check MONGO_URI in .env file');
        console.error('  3. Ensure MongoDB is accessible on the specified host/port');
        console.error('  4. Check firewall/network settings');
        console.error(`  5. Current URI: ${process.env.MONGO_URI.replace(/\/\/.*:.*@/, '//***:***@')}`);
        if (process.env.NODE_ENV === 'production') {
          console.error('\nExiting application...\n');
          process.exit(1);
        }

        console.warn('\n⚠️ Continuing without a database connection in non-production mode.');
        console.warn('   The API will stay online, but database-backed routes will fail until MongoDB is reachable.\n');
        return null;
      }
    }
  }
};

/**
 * Setup MongoDB connection event handlers
 * Monitors connection status and handles disconnections
 */
const setupConnectionHandlers = () => {
  // Connection events
  mongoose.connection.on('connected', () => {
    console.log('📊 Mongoose connected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  Mongoose disconnected from MongoDB');
  });

  // Graceful shutdown handlers
  process.on('SIGINT', async () => {
    await gracefulShutdown('SIGINT');
  });

  process.on('SIGTERM', async () => {
    await gracefulShutdown('SIGTERM');
  });
};

/**
 * Gracefully shutdown MongoDB connection
 * @param {string} signal - The signal that triggered shutdown
 */
const gracefulShutdown = async (signal) => {
  console.log(`\n⚠️  ${signal} received: Closing MongoDB connection...`);
  
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error.message);
    process.exit(1);
  }
};

// Export the connectDB function
module.exports = connectDB;
