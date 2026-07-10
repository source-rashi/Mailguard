const crypto = require('crypto');

// Encryption algorithm and key setup
const ALGORITHM = 'aes-256-gcm';
const CURRENT_VERSION = 'v1';

// Validation and key generation
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  const allowDevelopmentFallback = process.env.NODE_ENV === 'development';

  if (!envKey) {
    if (!allowDevelopmentFallback) {
      throw new Error('ENCRYPTION_KEY is required unless NODE_ENV is development');
    }

    // Development-only fallback keeps local runs working without weakening production startup.
    console.warn('⚠️  WARNING: ENCRYPTION_KEY not set. Using deterministic development-only fallback - DO NOT USE OUTSIDE DEVELOPMENT!');
    // Use a hashed value as fallback so it works consistently across reboots,
    // but is explicitly warned against for production use.
    return crypto.createHash('sha256').update('dev-only-mailguard-key').digest();
  }

  // Key Validation (MANDATORY)
  // Ensure it's exactly 64 characters (32 bytes hex encoded)
  if (typeof envKey !== 'string' || envKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(envKey)) {
    throw new Error('Invalid ENCRYPTION_KEY format: Must be exactly 64 hex characters (32 bytes)');
  }

  return Buffer.from(envKey, 'hex');
}

// Fail Fast: Validation runs at module load time
const KEY = getEncryptionKey();

function isHex(value, expectedLength) {
  if (typeof value !== 'string') return false;
  if (expectedLength !== undefined && value.length !== expectedLength) return false;
  return value.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(value);
}

function isEncrypted(value) {
  if (typeof value !== 'string') return false;

  const parts = value.split(':');

  if (parts.length === 4 && parts[0] === CURRENT_VERSION) {
    const [, ivHex, authTagHex, encrypted] = parts;
    return isHex(ivHex, 32) && isHex(authTagHex, 32) && isHex(encrypted);
  }

  if (parts.length === 3) {
    const [ivHex, authTagHex, encrypted] = parts;
    return isHex(ivHex, 32) && isHex(authTagHex, 32) && isHex(encrypted);
  }

  return false;
}

function encryptIfNeeded(text) {
  if (text === null || text === undefined || text === '') return text;
  if (typeof text !== 'string') {
    throw new Error('Invalid input: text must be a string');
  }

  return isEncrypted(text) ? text : encrypt(text);
}

function decryptIfNeeded(encryptedData) {
  if (encryptedData === null || encryptedData === undefined || encryptedData === '') {
    return encryptedData;
  }

  if (typeof encryptedData !== 'string') {
    throw new Error('Invalid input: encryptedData must be a string');
  }

  return isEncrypted(encryptedData) ? decrypt(encryptedData) : encryptedData;
}

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text in format: v1:iv:authTag:encrypted
 */
function encrypt(text) {
  if (text === null || text === undefined || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a string');
  }

  try {
    // Generate random initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Return format: v1:iv:authTag:encrypted (versioned for future rotation)
    return `${CURRENT_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('❌ Encryption error:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt text encrypted with encrypt()
 * @param {string} encryptedData - Encrypted text in format: iv:authTag:encrypted OR v1:iv:authTag:encrypted
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedData) {
  if (typeof encryptedData !== 'string') {
    throw new Error('Invalid input: encryptedData must be a string');
  }

  const parts = encryptedData.split(':');
  let ivHex, authTagHex, encrypted;

  // Check version prefix
  if (parts.length === 4 && parts[0] === 'v1') {
    [, ivHex, authTagHex, encrypted] = parts;
  } else if (parts.length === 3) {
    // Legacy unversioned format
    [ivHex, authTagHex, encrypted] = parts;
  } else {
    throw new Error('Invalid encrypted data format');
  }

  // Validate hex lengths
  if (!isHex(ivHex, 32) || !isHex(authTagHex, 32) || !isHex(encrypted)) {
    throw new Error('Malformed encryption components');
  }

  try {
    // Convert from hex
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt the text
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

module.exports = {
  encrypt,
  decrypt,
  encryptIfNeeded,
  decryptIfNeeded,
  isEncrypted,
};
