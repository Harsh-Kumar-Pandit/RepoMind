import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';

/**
 * Computes a SHA-256 hex digest of a token string.
 * Used to store only hashes of session tokens in PostgreSQL.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Computes an anonymized/pseudonymized IP hash for privacy-preserving auditing.
 */
export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + (env.sessionSecret || '')).digest('hex');
}

/**
 * Generates a cryptographically strong random hex token.
 * 32 bytes -> 64 hex characters.
 */
export function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates a new active session for a given user.
 *
 * @param {string} userId - User's UUID
 * @param {object} meta - Optional metadata: userAgent, ip
 * @returns {Promise<{ rawToken: string, session: object }>}
 */
export async function createSession(userId, meta = {}) {
  const prisma = getPrismaClient();
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + env.sessionTtlMs);
  const ipHash = meta.ip ? hashIp(meta.ip) : null;

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 500) : null,
      ipHash,
    },
  });

  return { rawToken, session };
}

/**
 * Validates a session by its raw token.
 * Verifies that:
 * 1. A session matching sha256(rawToken) exists.
 * 2. It has not been revoked (revokedAt is null).
 * 3. It has not expired (expiresAt > now).
 *
 * Updates lastSeenAt asynchronously if valid.
 *
 * @param {string} rawToken
 * @returns {Promise<{ valid: boolean, user?: object, session?: object }>}
 */
export async function validateSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false };
  }

  const prisma = getPrismaClient();
  const tokenHash = hashToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!session) {
    return { valid: false };
  }

  if (session.revokedAt) {
    return { valid: false, reason: 'revoked' };
  }

  if (new Date() > new Date(session.expiresAt)) {
    return { valid: false, reason: 'expired' };
  }

  // Touch lastSeenAt asynchronously (non-blocking)
  prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});

  return {
    valid: true,
    user: session.user,
    session,
  };
}

/**
 * Revokes an existing session by raw token.
 * Idempotent.
 *
 * @param {string} rawToken
 * @returns {Promise<boolean>} - true if found and revoked, false if not found
 */
export async function revokeSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return false;
  }

  const prisma = getPrismaClient();
  const tokenHash = hashToken(rawToken);

  try {
    await prisma.session.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}
