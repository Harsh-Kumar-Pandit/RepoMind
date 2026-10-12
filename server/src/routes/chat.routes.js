import { Router } from 'express';
import { AppError } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRepoAccess } from '../middleware/access.middleware.js';
import { chatAboutRepository } from '../services/chat.service.js';

const router = Router();

/**
 * POST /api/chat
 * Body: { repositoryId, question, commitSha?, snapshotId?, topK? }
 * Protected: requires valid session + OWNER or MEMBER role in repositoryId.
 * Validates snapshotId to prevent cross-repository IDOR.
 */
router.post(
  '/',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId, question, commitSha, snapshotId, topK } = req.body || {};

      if (!repositoryId || typeof repositoryId !== 'string') {
        throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
      }
      if (!question || typeof question !== 'string') {
        throw new AppError('question is required.', 400, 'INVALID_INPUT');
      }

      const result = await chatAboutRepository({
        repositoryId,
        question,
        commitSha: commitSha || null,
        snapshotId: snapshotId || null,
        topK: topK || undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
