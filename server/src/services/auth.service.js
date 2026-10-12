import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';

export const OAUTH_STATE_COOKIE_NAME = 'repomind_oauth_state';

/**
 * Persists an OAuth state nonce to PostgreSQL with a 5-minute expiry.
 *
 * @param {string} nonce
 * @param {number} ttlMs - Default 5 minutes (300,000 ms)
 */
export async function persistOAuthState(nonce, ttlMs = 300000) {
  const prisma = getPrismaClient();
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.oAuthState.create({
    data: {
      nonce,
      expiresAt,
    },
  });
}

/**
 * Atomically consumes an OAuth state nonce using a single conditional UPDATE.
 * The nonce MUST:
 * 1. Exist in the OAuthState table.
 * 2. Have consumedAt IS NULL (not previously consumed).
 * 3. Have expiresAt > NOW() (unexpired).
 *
 * If concurrent callbacks arrive for the same state, exactly one can update
 * the row (rowCount === 1); all other attempts affect 0 rows and are rejected.
 *
 * @param {string} nonce
 * @returns {Promise<boolean>} True if successfully consumed, false if already consumed/expired/nonexistent
 */
export async function consumeOAuthStateAtomic(nonce) {
  if (!nonce || typeof nonce !== 'string') {
    return false;
  }

  const prisma = getPrismaClient();

  const count = await prisma.$executeRaw`
    UPDATE "OAuthState"
    SET "consumedAt" = CURRENT_TIMESTAMP
    WHERE "nonce" = ${nonce}
      AND "consumedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP;
  `;

  return count === 1;
}

/**
 * Sanitizes and validates a redirect path.
 *
 * Rules:
 * - Must be a non-empty string.
 * - Must start with exactly one '/' followed by an alphanumeric character, '.', '_', or end.
 * - Must NOT start with '//' or '/\' (protocol-relative URLs).
 * - Must NOT contain backslashes, CR, LF, or control characters.
 * - Must NOT contain external URL schemes (e.g. 'http:', 'https:', 'javascript:', 'data:').
 * - Defaults to '/' on any invalid or suspicious input.
 *
 * @param {any} rawPath
 * @returns {string} Safe relative application path
 */
/**
 * Sanitizes and validates an application redirect path with strict defense-in-depth.
 *
 * Rules:
 * - Must be a non-empty string.
 * - Rejects any control characters, whitespace, or newlines.
 * - Rejects any backslash or forward-slash/backslash ambiguities ('\', '%5c', '%2f', etc.).
 * - Rejects multiple leading slashes (e.g. '//evil.com', '///evil.com', '////evil.com').
 * - Repeatedly checks for multi-layer percent-encoded bypasses (%252f, %255c, etc.).
 * - Uses URL parsing with a fixed dummy base to guarantee that browser resolution
 *   can never escape to an external origin or alternative scheme.
 * - Defaults strictly to '/' on any invalid, suspicious, or external path.
 *
 * @param {any} rawPath
 * @returns {string} Safe relative application path
 */
export function sanitizeRedirectPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return '/';
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return '/';
  }

  // Reject control characters (0x00-0x1F, 0x7F) and whitespace
  if (/[\x00-\x1F\x7F\s]/.test(trimmed)) {
    return '/';
  }

  // Reject backslashes explicitly
  if (trimmed.includes('\\')) {
    return '/';
  }

  // Reject multiple leading slashes (e.g. //, ///, ////) which browsers treat as protocol-relative
  if (/^\/{2,}/.test(trimmed)) {
    return '/';
  }

  // Must begin with a single '/'
  if (!trimmed.startsWith('/')) {
    return '/';
  }

  // Check for suspicious URL-encoded or double-encoded slash/backslash variants
  // (%2f = '/', %5c = '\', %252f = '%2f', %255c = '%5c', case-insensitive)
  if (/%(?:2f|5c|252f|255c)/i.test(trimmed)) {
    return '/';
  }

  // Reject embedded scheme indicators (e.g. /javascript:, /data:, /http:, etc.)
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return '/';
  }

  // Defense-in-depth: Parse with WHATWG URL parser on a fixed dummy origin.
  // Verify that the resulting URL stays strictly on http://localhost
  // and the pathname begins with a single '/' without multi-slash collapsing.
  try {
    const dummyOrigin = 'http://localhost';
    const parsed = new URL(trimmed, dummyOrigin);

    // Origin must remain strictly identical
    if (parsed.origin !== dummyOrigin) {
      return '/';
    }

    // Scheme must be http (from dummy base)
    if (parsed.protocol !== 'http:') {
      return '/';
    }

    // Host must remain localhost (no host authority override)
    if (parsed.hostname !== 'localhost' || parsed.host !== 'localhost') {
      return '/';
    }

    // Pathname must start with '/' and not start with '//'
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
      return '/';
    }

    // Return the safe relative path (pathname + search + hash)
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

/**
 * Generates an OAuth state string and matching cookie binding value.
 *
 * Returns:
 * {
 *   state: string,        // To send to GitHub as `state` query parameter
 *   cookieValue: string,  // To store in HttpOnly cookie `repomind_oauth_state`
 *   nonce: string,
 * }
 */
export function generateOAuthState(options = {}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const safeRedirect = sanitizeRedirectPath(options.redirectTo);

  const payload = JSON.stringify({
    nonce,
    timestamp,
    redirectTo: safeRedirect,
  });

  const encodedPayload = Buffer.from(payload).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', env.sessionSecret || 'default_session_secret')
    .update(encodedPayload)
    .digest('base64url');

  const state = `${encodedPayload}.${hmac}`;

  // Cookie value contains the raw nonce signed by HMAC
  const cookieHmac = crypto
    .createHmac('sha256', env.sessionSecret || 'default_session_secret')
    .update(nonce)
    .digest('base64url');
  const cookieValue = `${nonce}.${cookieHmac}`;

  return { state, cookieValue, nonce };
}

/**
 * Validates an incoming OAuth state string against HMAC signature, expiry,
 * browser-bound cookie value, and single-use consumption.
 *
 * @param {string} stateStr - State parameter from GitHub callback
 * @param {string} cookieValue - Cookie value from `repomind_oauth_state`
 * @param {number} maxAgeMs - Maximum state age in ms (default 5 minutes / 300,000 ms)
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifyOAuthState(stateStr, cookieValue, maxAgeMs = 300000) {
  if (!stateStr || typeof stateStr !== 'string' || !stateStr.includes('.')) {
    return { valid: false, error: 'Invalid state format' };
  }

  if (!cookieValue || typeof cookieValue !== 'string' || !cookieValue.includes('.')) {
    return { valid: false, error: 'Missing or invalid browser state binding cookie' };
  }

  const [encodedPayload, receivedHmac] = stateStr.split('.');
  if (!encodedPayload || !receivedHmac) {
    return { valid: false, error: 'Malformed state structure' };
  }

  // 1. Verify state HMAC signature
  const expectedHmac = crypto
    .createHmac('sha256', env.sessionSecret || 'default_session_secret')
    .update(encodedPayload)
    .digest('base64url');

  const receivedBuf = Buffer.from(receivedHmac);
  const expectedBuf = Buffer.from(expectedHmac);

  if (receivedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
    return { valid: false, error: 'State signature verification failed' };
  }

  // 2. Decode payload
  let payload;
  try {
    const jsonStr = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, error: 'Failed to decode state payload' };
  }

  // 3. Verify expiry
  if (!payload.timestamp || Date.now() - payload.timestamp > maxAgeMs) {
    return { valid: false, error: 'State parameter expired' };
  }

  // 4. Verify browser binding cookie
  const [cookieNonce, cookieHmac] = cookieValue.split('.');
  const expectedCookieHmac = crypto
    .createHmac('sha256', env.sessionSecret || 'default_session_secret')
    .update(cookieNonce)
    .digest('base64url');

  const receivedCookieBuf = Buffer.from(cookieHmac);
  const expectedCookieBuf = Buffer.from(expectedCookieHmac);

  if (
    receivedCookieBuf.length !== expectedCookieBuf.length ||
    !crypto.timingSafeEqual(receivedCookieBuf, expectedCookieBuf)
  ) {
    return { valid: false, error: 'Browser state cookie signature failed' };
  }

  // Compare state nonce with cookie nonce in constant time
  const stateNonceBuf = Buffer.from(payload.nonce || '');
  const cookieNonceBuf = Buffer.from(cookieNonce || '');

  if (
    stateNonceBuf.length !== cookieNonceBuf.length ||
    !crypto.timingSafeEqual(stateNonceBuf, cookieNonceBuf)
  ) {
    return { valid: false, error: 'State does not match initiating browser cookie' };
  }

  return { valid: true, payload };
}

/**
 * Generates the GitHub OAuth authorization redirect URL.
 */
export function getGitHubAuthUrl(state) {
  if (!env.githubOAuthClientId) {
    throw new AppError('GitHub OAuth is not configured on this server (missing client ID)', 500);
  }

  const params = new URLSearchParams({
    client_id: env.githubOAuthClientId,
    redirect_uri: env.githubOAuthCallbackUrl,
    scope: 'read:user user:email',
    state,
    allow_signup: 'true',
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchanges a GitHub OAuth authorization code for a temporary GitHub access token.
 * Never logs or persists the access token.
 */
export async function exchangeOAuthCode(code) {
  if (!env.githubOAuthClientId || !env.githubOAuthClientSecret) {
    throw new AppError('GitHub OAuth credentials are not configured', 500);
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.githubOAuthClientId,
      client_secret: env.githubOAuthClientSecret,
      code,
      redirect_uri: env.githubOAuthCallbackUrl,
    }),
  });

  if (!response.ok) {
    throw new AppError(`GitHub token exchange failed with status ${response.status}`, 502);
  }

  const data = await response.json();
  if (data.error || !data.access_token) {
    throw new AppError(data.error_description || data.error || 'Failed to exchange authorization code', 400);
  }

  return data.access_token;
}

/**
 * Fetches authenticated user profile from GitHub API using the transient access token.
 */
export async function fetchGitHubUserProfile(accessToken) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RepoMind-Backend',
    },
  });

  if (!response.ok) {
    throw new AppError(`Failed to fetch GitHub profile (status ${response.status})`, 502);
  }

  const profile = await response.json();
  return {
    githubId: String(profile.id),
    login: profile.login,
    name: profile.name || null,
    avatarUrl: profile.avatar_url || null,
    email: profile.email || null,
  };
}

/**
 * Upserts a local User record based on immutable githubId.
 * Never stores GitHub OAuth access tokens.
 */
export async function upsertGitHubUser(profile) {
  const prisma = getPrismaClient();

  const user = await prisma.user.upsert({
    where: { githubId: profile.githubId },
    create: {
      githubId: profile.githubId,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
    },
    update: {
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
    },
  });

  return user;
}
