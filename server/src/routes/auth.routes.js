import { Router } from 'express';
import { env } from '../config/env.js';
import {
  generateOAuthState,
  verifyOAuthState,
  persistOAuthState,
  consumeOAuthStateAtomic,
  sanitizeRedirectPath,
  getGitHubAuthUrl,
  exchangeOAuthCode,
  fetchGitHubUserProfile,
  upsertGitHubUser,
  OAUTH_STATE_COOKIE_NAME,
} from '../services/auth.service.js';
import { createSession, revokeSession } from '../services/session.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { AppError } from '../utils/errors.js';

const router = Router();

/**
 * Helper to build secure session cookie options.
 */
function getSessionCookieOptions(expiresAt) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Helper to build short-lived OAuth state cookie options (5 min TTL).
 */
function getOAuthStateCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 5 * 60 * 1000, // 5 minutes
  };
}

/**
 * GET /api/auth/github
 * Initiates GitHub OAuth flow with short-lived signed state parameter,
 * persists the nonce in PostgreSQL with 5-minute expiry, and
 * binds state to the browser via the `repomind_oauth_state` HttpOnly cookie.
 */
router.get('/github', async (req, res, next) => {
  try {
    const rawRedirect = req.query.redirectTo;
    const safeRedirect = sanitizeRedirectPath(rawRedirect);

    const { state, cookieValue, nonce } = generateOAuthState({ redirectTo: safeRedirect });

    // Persist nonce with expiry in PostgreSQL
    await persistOAuthState(nonce);

    // Set short-lived HttpOnly binding cookie
    res.cookie(OAUTH_STATE_COOKIE_NAME, cookieValue, getOAuthStateCookieOptions());

    const authUrl = getGitHubAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/github/callback
 * Handles OAuth callback, verifies state signature, expiry, and browser binding cookie,
 * atomically consumes state in PostgreSQL (single-use replay prevention),
 * exchanges code for user profile, creates local user record and session, and sets secure HttpOnly cookie.
 */
router.get('/github/callback', async (req, res, next) => {
  const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

  // Helper to ensure the state cookie is always cleared on completion or failure
  const clearStateCookie = () => {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  };

  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      clearStateCookie();
      throw new AppError(`GitHub authorization error: ${error_description || error}`, 400);
    }

    if (!code || typeof code !== 'string') {
      clearStateCookie();
      throw new AppError('Missing authorization code', 400);
    }

    if (!state || typeof state !== 'string') {
      clearStateCookie();
      throw new AppError('Missing OAuth state parameter', 400);
    }

    // 1. Verify tamper-proof state signature, expiry, and browser binding cookie
    const stateVerification = verifyOAuthState(state, stateCookie);
    if (!stateVerification.valid) {
      clearStateCookie();
      throw new AppError(`Invalid, expired, or mismatched OAuth state: ${stateVerification.error}`, 400);
    }

    // 2. Atomically consume the nonce in PostgreSQL (guarantees single-use across multiple processes)
    const consumed = await consumeOAuthStateAtomic(stateVerification.payload.nonce);
    clearStateCookie();

    if (!consumed) {
      throw new AppError(
        'OAuth state has already been consumed, expired, or is invalid (replay rejected)',
        400
      );
    }

    // 3. Exchange code for transient access token (only after atomic nonce consumption succeeds)
    const accessToken = await exchangeOAuthCode(code);

    // 4. Fetch GitHub profile using token
    const gitHubProfile = await fetchGitHubUserProfile(accessToken);

    // 5. Upsert local user
    const user = await upsertGitHubUser(gitHubProfile);

    // Create persistent session
    const meta = {
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.socket.remoteAddress,
    };
    const { rawToken, session } = await createSession(user.id, meta);

    // Set secure session cookie
    res.cookie(env.sessionCookieName, rawToken, getSessionCookieOptions(session.expiresAt));

    // Re-sanitize destination before redirecting
    const redirectTo = sanitizeRedirectPath(stateVerification.payload?.redirectTo);

    // If request wants JSON (e.g. API client), return JSON envelope
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            githubId: user.githubId,
            login: user.login,
            name: user.name,
            avatarUrl: user.avatarUrl,
            email: user.email,
          },
          redirectTo,
        },
      });
    }

    res.redirect(redirectTo);
  } catch (err) {
    clearStateCookie();
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Revokes the current session and clears the session cookie.
 */
router.post('/logout', async (req, res, next) => {
  try {
    const token =
      req.cookies?.[env.sessionCookieName] ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

    if (token) {
      await revokeSession(token);
    }

    res.clearCookie(env.sessionCookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Returns authenticated user's safe public profile.
 */
router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: {
        id: req.user.id,
        githubId: req.user.githubId,
        login: req.user.login,
        name: req.user.name,
        avatarUrl: req.user.avatarUrl,
        email: req.user.email,
        createdAt: req.user.createdAt,
      },
    },
  });
});

export default router;
