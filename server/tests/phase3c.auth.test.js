import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  generateOAuthState,
  verifyOAuthState,
  persistOAuthState,
  consumeOAuthStateAtomic,
  sanitizeRedirectPath,
  getGitHubAuthUrl,
  OAUTH_STATE_COOKIE_NAME,
} from '../src/services/auth.service.js';
import {
  hashToken,
  hashIp,
  generateRandomToken,
  createSession,
  validateSession,
  revokeSession,
} from '../src/services/session.service.js';
import { extractSessionToken } from '../src/middleware/auth.middleware.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

test('Phase 3C — Open Redirect Protection & sanitizeRedirectPath', async (t) => {
  await t.test('accepts safe relative application paths', () => {
    assert.equal(sanitizeRedirectPath('/'), '/');
    assert.equal(sanitizeRedirectPath('/workspace'), '/workspace');
    assert.equal(sanitizeRedirectPath('/workspace/repo-123'), '/workspace/repo-123');
    assert.equal(sanitizeRedirectPath('/settings?tab=profile'), '/settings?tab=profile');
  });

  await t.test('rejects external URLs, dangerous schemes, and protocol-relative paths', () => {
    // Protocol-relative URLs & multi-slash bypasses (//, ///, ////, etc.)
    assert.equal(sanitizeRedirectPath('//evil.com'), '/');
    assert.equal(sanitizeRedirectPath('//evil.com/phish'), '/');
    assert.equal(sanitizeRedirectPath('///evil.com'), '/');
    assert.equal(sanitizeRedirectPath('////evil.com'), '/');
    assert.equal(sanitizeRedirectPath('/////evil.com/path'), '/');

    // Backslashes
    assert.equal(sanitizeRedirectPath('\\evil.com'), '/');
    assert.equal(sanitizeRedirectPath('/\\evil.com'), '/');
    assert.equal(sanitizeRedirectPath('/path\\evil.com'), '/');

    // Dangerous schemes
    assert.equal(sanitizeRedirectPath('javascript:alert(1)'), '/');
    assert.equal(sanitizeRedirectPath('/javascript:alert(1)'), '/');
    assert.equal(sanitizeRedirectPath('data:text/html,evil'), '/');
    assert.equal(sanitizeRedirectPath('/data:text/html,evil'), '/');
    assert.equal(sanitizeRedirectPath('http://evil.com'), '/');
    assert.equal(sanitizeRedirectPath('https://evil.com/target'), '/');

    // Percent-encoded and double-encoded variants (%2f, %5c, %252f, %255c, mixed-case)
    assert.equal(sanitizeRedirectPath('/%2fevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%2Fevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%5cevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%5Cevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%252fevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%252Fevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%255cevil.com'), '/');
    assert.equal(sanitizeRedirectPath('/%255Cevil.com'), '/');

    // Control characters and CRLF injection
    assert.equal(sanitizeRedirectPath('/test\r\nSet-Cookie: evil=1'), '/');
    assert.equal(sanitizeRedirectPath('/test\x00evil'), '/');
    assert.equal(sanitizeRedirectPath('/test with spaces'), '/');

    // Null, empty, non-string
    assert.equal(sanitizeRedirectPath(''), '/');
    assert.equal(sanitizeRedirectPath(null), '/');
    assert.equal(sanitizeRedirectPath(undefined), '/');
    assert.equal(sanitizeRedirectPath(123), '/');
  });
});

test('Phase 3C — OAuth State Generation, Browser Binding, and Replay Protection', async (t) => {
  await t.test('generates state and matching browser binding cookie value', () => {
    const { state, cookieValue, nonce } = generateOAuthState({ redirectTo: '/dashboard' });

    assert.ok(typeof state === 'string');
    assert.ok(state.includes('.'));
    assert.ok(typeof cookieValue === 'string');
    assert.ok(cookieValue.includes('.'));
    assert.ok(nonce.length === 32);

    // Validation succeeds when matching cookie is present
    const verification = verifyOAuthState(state, cookieValue);
    assert.equal(verification.valid, true);
    assert.equal(verification.payload.redirectTo, '/dashboard');
    assert.equal(verification.payload.nonce, nonce);
  });

  await t.test('rejects state when browser binding cookie is missing or mismatched', () => {
    const { state, cookieValue } = generateOAuthState({ redirectTo: '/dashboard' });

    // Missing cookie
    const missingCookie = verifyOAuthState(state, null);
    assert.equal(missingCookie.valid, false);
    assert.match(missingCookie.error, /missing or invalid browser state binding cookie/i);

    // Mismatched cookie from a different request
    const other = generateOAuthState({ redirectTo: '/dashboard' });
    const mismatchedCookie = verifyOAuthState(state, other.cookieValue);
    assert.equal(mismatchedCookie.valid, false);
    assert.match(mismatchedCookie.error, /does not match initiating browser cookie/i);
  });

  await t.test('rejects tampered state or tampered cookie signatures', () => {
    const { state, cookieValue } = generateOAuthState({ redirectTo: '/dashboard' });
    const [payload, hmac] = state.split('.');

    // Tampered state payload
    const tamperedPayload = Buffer.from(JSON.stringify({ redirectTo: '/evil' })).toString('base64url');
    const tamperedState = `${tamperedPayload}.${hmac}`;
    assert.equal(verifyOAuthState(tamperedState, cookieValue).valid, false);

    // Tampered cookie HMAC
    const [cNonce] = cookieValue.split('.');
    const tamperedCookie = `${cNonce}.badhmac`;
    assert.equal(verifyOAuthState(state, tamperedCookie).valid, false);
  });

  await t.test('rejects expired state parameter', () => {
    const { state, cookieValue } = generateOAuthState({ redirectTo: '/dashboard' });
    const verification = verifyOAuthState(state, cookieValue, -1); // already expired
    assert.equal(verification.valid, false);
    assert.match(verification.error, /expired/i);
  });

  await t.test('enforces atomic single-use: state nonce can be consumed exactly once in database', async () => {
    const { nonce } = generateOAuthState({ redirectTo: '/dashboard' });

    // Persist to Neon PostgreSQL
    await persistOAuthState(nonce);

    // First consumption succeeds
    const firstConsume = await consumeOAuthStateAtomic(nonce);
    assert.equal(firstConsume, true);

    // Immediate replay attempt returns false (already consumed)
    const secondConsume = await consumeOAuthStateAtomic(nonce);
    assert.equal(secondConsume, false);
  });

  await t.test('concurrency: simultaneous consumption attempts allow exactly one winner', async () => {
    const { nonce } = generateOAuthState({ redirectTo: '/dashboard' });
    await persistOAuthState(nonce);

    // Fire 5 concurrent consumption attempts simultaneously
    const results = await Promise.all([
      consumeOAuthStateAtomic(nonce),
      consumeOAuthStateAtomic(nonce),
      consumeOAuthStateAtomic(nonce),
      consumeOAuthStateAtomic(nonce),
      consumeOAuthStateAtomic(nonce),
    ]);

    // Exactly one attempt must return true, all others false
    const successfulAttempts = results.filter((r) => r === true).length;
    assert.equal(successfulAttempts, 1);
    const rejectedAttempts = results.filter((r) => r === false).length;
    assert.equal(rejectedAttempts, 4);
  });

  await t.test('rejects nonexistent and expired nonces from consumption', async () => {
    // Nonexistent nonce
    const nonExistent = await consumeOAuthStateAtomic('nonexistent-nonce-99999');
    assert.equal(nonExistent, false);

    // Expired nonce: persisted with negative TTL (-1000ms)
    const { nonce: expiredNonce } = generateOAuthState();
    await persistOAuthState(expiredNonce, -1000);

    const expiredConsume = await consumeOAuthStateAtomic(expiredNonce);
    assert.equal(expiredConsume, false);
  });

  await t.test('getGitHubAuthUrl generates valid GitHub OAuth authorize URL', () => {
    env.githubOAuthClientId = 'test-client-id';
    env.githubOAuthCallbackUrl = 'http://localhost:5000/api/auth/github/callback';

    const { state } = generateOAuthState();
    const url = getGitHubAuthUrl(state);

    assert.ok(url.startsWith('https://github.com/login/oauth/authorize'));
    assert.ok(url.includes('client_id=test-client-id'));
    assert.ok(url.includes('redirect_uri='));
    assert.ok(url.includes(`state=${encodeURIComponent(state)}`));
  });
});

test('Phase 3C — Session Token Hashing and Privacy Protections', async (t) => {
  await t.test('generateRandomToken returns 64-char hex string (32 bytes entropy)', () => {
    const token = generateRandomToken();
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  await t.test('hashToken computes deterministic SHA-256 and never matches raw token', () => {
    const raw = 'my_super_secret_session_token_123';
    const hash1 = hashToken(raw);
    const hash2 = hashToken(raw);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.notEqual(hash1, raw);
  });

  await t.test('hashIp creates pseudonymized hash with session secret salt', () => {
    const ip = '192.168.1.100';
    const ipHashed = hashIp(ip);

    assert.ok(typeof ipHashed === 'string');
    assert.equal(ipHashed.length, 64);
    assert.notEqual(ipHashed, ip);
    assert.equal(hashIp(null), null);
  });
});

test('Phase 3C — Token Extraction Helper', async (t) => {
  await t.test('extracts token from cookie header', () => {
    const req = {
      cookies: {
        [env.sessionCookieName]: 'cookie-token-abc',
      },
      headers: {},
    };
    assert.equal(extractSessionToken(req), 'cookie-token-abc');
  });

  await t.test('extracts token from Authorization: Bearer header when cookie is missing', () => {
    const req = {
      cookies: {},
      headers: {
        authorization: 'Bearer bearer-token-xyz',
      },
    };
    assert.equal(extractSessionToken(req), 'bearer-token-xyz');
  });

  await t.test('returns null when no credentials provided', () => {
    const req = {
      cookies: {},
      headers: {},
    };
    assert.equal(extractSessionToken(req), null);
  });
});

test('Phase 3C — HTTP Authentication Endpoints & Security Checks', async (t) => {
  const server = http.createServer(app);
  const port = await listen(server);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('GET /api/auth/github sets repomind_oauth_state cookie and redirects with sanitized path', async () => {
    env.githubOAuthClientId = 'test-client-id';
    env.githubOAuthCallbackUrl = 'http://localhost:5000/api/auth/github/callback';

    // Malicious open redirect attempt in query parameter
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/github?redirectTo=//attacker.com/evil`, {
      redirect: 'manual',
    });

    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location.startsWith('https://github.com/login/oauth/authorize'));
    assert.ok(location.includes('client_id=test-client-id'));
    assert.ok(location.includes('state='));

    // Verify state cookie is set with HttpOnly flag
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes(OAUTH_STATE_COOKIE_NAME));
    assert.ok(setCookie.includes('HttpOnly') || setCookie.includes('httponly'));
  });

  await t.test('GET /api/auth/github/callback rejects missing code and state', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/github/callback`);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error.message, /missing/i);
  });

  await t.test('GET /api/auth/github/callback rejects tampered or missing state cookie', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/github/callback?code=abc&state=bad.state`);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error.message, /invalid, expired, or mismatched oauth state/i);
  });

  await t.test('GET /api/auth/me returns 401 when unauthenticated', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error.message, /authentication required/i);
  });

  await t.test('POST /api/auth/logout succeeds and clears cookie', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.match(json.data.message, /logged out/i);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes(env.sessionCookieName));
    assert.ok(setCookie.includes('HttpOnly') || setCookie.includes('httponly'));
  });
});
