// Environment Variable Validation
// Validates required environment variables at startup

const validateEnv = () => {
  const required = [
    'MONGO_URI',
    'CLERK_SECRET_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'ML_SERVICE_URL'
  ];

  // ENCRYPTION_KEY is required outside local development for secure token storage
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!isDevelopment && !process.env.ENCRYPTION_KEY) {
    required.push('ENCRYPTION_KEY');
  }

  const missing = [];
  const warnings = [];

  // Check required variables
  for (const varName of required) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check format of critical variables
  if (process.env.MONGO_URI && !process.env.MONGO_URI.startsWith('mongodb')) {
    warnings.push('MONGO_URI should start with mongodb:// or mongodb+srv://');
  }

  if (process.env.CLERK_SECRET_KEY && !process.env.CLERK_SECRET_KEY.startsWith('sk_')) {
    warnings.push('CLERK_SECRET_KEY should start with sk_');
  }

  if (process.env.ML_SERVICE_URL && !process.env.ML_SERVICE_URL.startsWith('http')) {
    warnings.push('ML_SERVICE_URL should start with http:// or https://');
  }

  if (process.env.GOOGLE_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI.startsWith('http')) {
    warnings.push('GOOGLE_REDIRECT_URI should start with http:// or https://');
  }

  // Validate ENCRYPTION_KEY format (must be 64 hex characters for AES-256)
  if (process.env.ENCRYPTION_KEY) {
    if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
      warnings.push('ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes for AES-256). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
  } else if (isDevelopment) {
    warnings.push('ENCRYPTION_KEY not set. Using insecure default for development only.');
  }

  // Warn if FRONTEND_URL not set (will default to localhost:3000)
  if (!process.env.FRONTEND_URL) {
    warnings.push('FRONTEND_URL not set. CORS will allow http://localhost:3000 by default. Set this in production!');
  } else if (!process.env.FRONTEND_URL.startsWith('http')) {
    warnings.push('FRONTEND_URL should start with http:// or https://');
  }

  // Report issues
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️ Environment variable warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  // Success
  console.log('✅ Environment variables validated');
};

// ============================================
// ML SERVICE CONNECTIVITY CHECK
// ============================================

/**
 * Validates that the ML service is reachable at startup
 * Non-blocking - won't crash the backend if ML service is down
 * Implements exponential backoff retry logic
 */
async function validateMLServiceReachability(maxRetries = 3, initialDelay = 2000) {
    const mlServiceUrl = process.env.ML_SERVICE_URL;
    if (!mlServiceUrl) {
        console.warn('⚠️ ML_SERVICE_URL not set - skipping connectivity check');
        return false;
    }
    
    console.log(`🔍 Checking ML service connectivity: ${mlServiceUrl}/health`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout per request
            
            const response = await fetch(`${mlServiceUrl}/health`, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`✅ ML service reachable at ${mlServiceUrl}`);
                if (data.model_loaded) {
                    console.log(`   Model status: LOADED (v${data.model_version || '1.0.0'})`);
                } else {
                    console.warn(`   ⚠️ ML service is UP but model is NOT loaded`);
                }
                return true;
            } else {
                throw new Error(`Service responded with status ${response.status}`);
            }
        } catch (error) {
            const isLastAttempt = attempt === maxRetries;
            const errorMessage = error.name === 'AbortError' ? 'Timeout (5s)' : error.message;
            
            if (isLastAttempt) {
                console.error(`❌ ML service connectivity failed after ${maxRetries} attempts.`);
                console.error(`   URL: ${mlServiceUrl}/health`);
                console.error(`   Final error: ${errorMessage}`);
                console.warn(`\n💡 Troubleshooting:`);
                console.warn(`   1. Ensure ML service is running: cd ml-service && uvicorn app:app --port 8000`);
                console.warn(`   2. Verify ML_SERVICE_URL in .env is correct`);
                console.warn(`   3. Check for firewall or networking issues\n`);
            } else {
                const delay = initialDelay * Math.pow(2, attempt - 1);
                console.warn(`⚠️ ML service probe attempt ${attempt} failed: ${errorMessage}. Retrying in ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    return false;
}

// Run connectivity check asynchronously (non-blocking, won't crash backend)
if (process.env.NODE_ENV !== 'test') {
    validateMLServiceReachability().catch(err => {
        console.warn('⚠️ Background connectivity check failed:', err.message);
    });
}

module.exports = validateEnv;
module.exports.validateMLServiceReachability = validateMLServiceReachability;