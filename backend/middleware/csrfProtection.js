// backend/middleware/csrfProtection.js
// Double‑submit cookie CSRF protection
// Generates a token, stores it in an HttpOnly cookie, and expects the same token in the X‑CSRF‑Token header.

const crypto = require('crypto');

// Token length (bytes) – 32 gives 64‑char hex string
const TOKEN_LENGTH = 32;

/**
 * Generate a CSRF token and set it as a cookie on the response.
 * Call this in a route that the client can hit to obtain a token.
 */
function generateToken(req, res) {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  // Set cookie – not HttpOnly so that client‑side JS can read it if needed
  // Use SameSite=strict and Secure in production
  const cookieOptions = {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 1000 // 1 hour
  };
  res.cookie('csrfToken', token, cookieOptions);
  return token;
}

/**
 * Express middleware that validates the CSRF token.
 * It expects the token in the `X‑CSRF‑Token` header and compares it to the `csrfToken` cookie.
 */
function middleware(req, res, next) {
  const cookieToken = req.cookies && req.cookies.csrfToken;
  const headerToken = req.get('X‑CSRF‑Token') || req.get('X-CSRF-Token');

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing',
      error: { status: 403 }
    });
  }

  if (cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
      error: { status: 403 }
    });
  }

  // Token is valid – continue
  next();
}

module.exports = {
  generateToken,
  middleware
};
