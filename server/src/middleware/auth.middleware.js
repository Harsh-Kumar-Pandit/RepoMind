import { env } from '../config/env.js';
import { validateSession } from '../services/session.service.js';
import { AppError } from '../utils/errors.js';

/**
 * Extracts raw session token from cookies or fallback Authorization Bearer header.
 */
export function extractSessionToken(req) {
  if (req.cookies && req.cookies[env.sessionCookieName]) {
    return req.cookies[env.sessionCookieName];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Middleware that requires a valid, unexpired, non-revoked session.
 * Attaches `req.user` and `req.session` to the request object.
 * Returns 401 Unauthorized if invalid or missing.
 */
export async function requireAuth(req, res, next) {
  try {
    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      return next(new AppError('Authentication required. Missing session cookie or token.', 401));
    }

    const result = await validateSession(rawToken);
    if (!result.valid) {
      const msg = result.reason === 'expired'
        ? 'Session expired. Please log in again.'
        : result.reason === 'revoked'
          ? 'Session has been revoked.'
          : 'Invalid session token.';
      return next(new AppError(msg, 401));
    }

    req.user = result.user;
    req.session = result.session;
    req.rawSessionToken = rawToken;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication middleware:
 * If a session token is present and valid, attaches `req.user` and `req.session`.
 * Does NOT throw or block if no session is provided.
 */
export async function optionalAuth(req, res, next) {
  try {
    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      req.user = null;
      req.session = null;
      return next();
    }

    const result = await validateSession(rawToken);
    if (result.valid) {
      req.user = result.user;
      req.session = result.session;
      req.rawSessionToken = rawToken;
    } else {
      req.user = null;
      req.session = null;
    }

    next();
  } catch {
    req.user = null;
    req.session = null;
    next();
  }
}
