import { AppError } from '../utils/errors.js';
import {
  requireRepositoryAccess,
  validateSnapshotRepositoryBinding,
} from '../services/access.service.js';

/**
 * Express middleware to enforce repository membership and roles.
 * Expects `req.user` to be populated by `requireAuth`.
 * Extracts `repositoryId` from `req.params.repositoryId`, `req.body.repositoryId`, or `req.query.repositoryId`.
 *
 * @param {Array<'OWNER' | 'MEMBER'>} allowedRoles - permitted roles (default: ['OWNER', 'MEMBER'])
 */
export function requireRepoAccess(allowedRoles = ['OWNER', 'MEMBER']) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
      }

      const repositoryId =
        req.params.repositoryId || req.body?.repositoryId || req.query?.repositoryId;

      if (!repositoryId || typeof repositoryId !== 'string') {
        return next(new AppError('repositoryId is required.', 400, 'INVALID_INPUT'));
      }

      const membership = await requireRepositoryAccess(repositoryId, req.user.id, allowedRoles);
      req.repoMembership = membership;

      // Check if a snapshotId was passed in params, body, or query
      const snapshotId =
        req.params.snapshotId || req.body?.snapshotId || req.query?.snapshotId;

      if (snapshotId && typeof snapshotId === 'string') {
        await validateSnapshotRepositoryBinding(snapshotId, repositoryId);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
