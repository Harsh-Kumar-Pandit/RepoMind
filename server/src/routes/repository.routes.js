import { Router } from 'express';
import { AppError } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRepoAccess } from '../middleware/access.middleware.js';
import {
  analyzeRepository,
  startIndexing,
  getIndexStatus,
} from '../services/indexing.service.js';
import {
  claimLegacyRepository,
  addRepositoryMember,
  listRepositoryMembers,
  removeRepositoryMember,
} from '../services/access.service.js';

const router = Router();

/**
 * POST /api/repositories/analyze
 * Body: { url: string, branch?: string }
 * Protected: requires valid session.
 * Atomically assigns initial OWNER if creating a new repository.
 */
router.post('/analyze', requireAuth, async (req, res, next) => {
  try {
    const { url, branch } = req.body || {};
    if (!url || typeof url !== 'string') {
      throw new AppError('url is required and must be a GitHub HTTPS URL.', 400, 'INVALID_INPUT');
    }

    const result = await analyzeRepository(url, {
      branch,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    if (err.message && !err.statusCode) {
      // GitHub / URL validation errors
      if (/Invalid host|Malformed URL|valid GitHub|Only HTTPS|Invalid characters|Invalid repository/i.test(err.message)) {
        err.statusCode = 400;
      } else if (/not found|private or deleted/i.test(err.message)) {
        err.statusCode = 404;
      } else if (/rate limit/i.test(err.message)) {
        err.statusCode = 429;
      }
    }
    next(err);
  }
});

/**
 * GET /api/repositories
 * Protected: requires valid session.
 * Lists repositories where the authenticated user is OWNER or MEMBER.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { getPrismaClient } = await import('../config/database.js');
    const prisma = getPrismaClient();

    const memberships = await prisma.repositoryMember.findMany({
      where: { userId: req.user.id },
      include: {
        repository: {
          include: {
            snapshots: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                totalFiles: true,
                indexedFiles: true,
                totalChunks: true,
                branch: true,
                commitSha: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const repositories = memberships.map((m) => {
      const repo = m.repository;
      const latestSnapshot = repo.snapshots?.[0] || null;
      return {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        url: repo.url,
        defaultBranch: repo.defaultBranch,
        role: m.role,
        createdAt: repo.createdAt,
        latestSnapshot,
      };
    });

    res.status(200).json({
      success: true,
      data: repositories,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:repositoryId/tree
 * Protected: requires valid session + OWNER or MEMBER role.
 * Returns repository file listing for Explorer view:
 * 1. From completed database snapshot (instant, zero GitHub API calls).
 * 2. Or from GitHub tree if no completed snapshot is available yet.
 */
router.get(
  '/:repositoryId/tree',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const { getPrismaClient } = await import('../config/database.js');
      const prisma = getPrismaClient();

      const repository = await prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          snapshots: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              files: {
                select: {
                  path: true,
                  size: true,
                  language: true,
                },
                orderBy: { path: 'asc' },
              },
            },
          },
        },
      });

      if (!repository) {
        throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
      }

      const completedSnapshot = repository.snapshots?.[0];
      if (completedSnapshot && completedSnapshot.files?.length > 0) {
        return res.status(200).json({
          success: true,
          data: {
            repositoryId: repository.id,
            commitSha: completedSnapshot.commitSha,
            branch: completedSnapshot.branch,
            files: completedSnapshot.files,
            fromSnapshot: true,
          },
        });
      }

      // Fallback: analyze git tree via GitHub API
      const { analyzeRepository } = await import('../services/indexing.service.js');
      const analysis = await analyzeRepository(repository.url, {
        branch: repository.defaultBranch,
        userId: req.user.id,
      });

      res.status(200).json({
        success: true,
        data: {
          repositoryId: repository.id,
          commitSha: analysis.commitSha,
          branch: analysis.branch,
          files: analysis.files?.cappedFiles || analysis.files?.preview || [],
          fromSnapshot: false,
        },
      });
    } catch (err) {
      if (err.message && !err.statusCode) {
        if (/rate limit/i.test(err.message)) err.statusCode = 429;
        else if (/not found/i.test(err.message)) err.statusCode = 404;
      }
      next(err);
    }
  }
);

/**
 * GET /api/repositories/:repositoryId/file?path=&commitSha=
 * Protected: requires valid session + OWNER or MEMBER role.
 * Reads exact file content from repository for read-only Explorer preview.
 */
router.get(
  '/:repositoryId/file',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const { path: filePath, commitSha: querySha } = req.query;

      if (!filePath || typeof filePath !== 'string') {
        throw new AppError('path query parameter is required.', 400, 'INVALID_INPUT');
      }

      const { getPrismaClient } = await import('../config/database.js');
      const { fetchGitHubFileContent, resolveCommitSha } = await import('../services/github.service.js');
      const prisma = getPrismaClient();

      const repository = await prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          snapshots: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!repository) {
        throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
      }

      const latestCompletedSnapshot = repository.snapshots?.[0];
      const commitSha =
        querySha ||
        latestCompletedSnapshot?.commitSha ||
        (await resolveCommitSha(repository.owner, repository.name, repository.defaultBranch));

      let content = null;
      try {
        content = await fetchGitHubFileContent(repository.owner, repository.name, commitSha, filePath);
      } catch (ghErr) {
        // If GitHub fetch fails (e.g. rate-limiting or network issues), check DB chunks for this snapshot
        if (latestCompletedSnapshot && latestCompletedSnapshot.commitSha === commitSha) {
          const snapshotChunks = await prisma.snapshotChunk.findMany({
            where: {
              snapshotId: latestCompletedSnapshot.id,
              filePath,
            },
            include: { chunk: true },
            orderBy: { chunkIndex: 'asc' },
          });

          if (snapshotChunks.length > 0) {
            content = snapshotChunks.map((sc) => sc.chunk.content).join('');
          }
        }

        if (content === null) {
          throw ghErr;
        }
      }

      if (content === null) {
        throw new AppError('File not found in repository at specified commit.', 404, 'FILE_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        data: {
          path: filePath,
          commitSha,
          content,
        },
      });
    } catch (err) {
      if (err.message && !err.statusCode) {
        if (/rate limit/i.test(err.message)) {
          err.statusCode = 429;
        } else if (/not found/i.test(err.message)) {
          err.statusCode = 404;
        } else if (/forbidden/i.test(err.message)) {
          err.statusCode = 403;
        }
      }
      next(err);
    }
  }
);

/**
 * POST /api/repositories/:repositoryId/index
 * Body: { branch?: string, commitSha?: string, sync?: boolean }
 * Protected: requires valid session + OWNER or MEMBER role.
 */
router.post(
  '/:repositoryId/index',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const { branch, commitSha, sync } = req.body || {};

      if (!repositoryId) {
        throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
      }

      const result = await startIndexing(repositoryId, {
        branch,
        commitSha,
        sync: Boolean(sync),
      });

      res.status(result.alreadyComplete ? 200 : 202).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/repositories/:repositoryId/index-status
 * Query: ?commitSha=&snapshotId=
 * Protected: requires valid session + OWNER or MEMBER role.
 */
router.get(
  '/:repositoryId/index-status',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const { commitSha, snapshotId } = req.query || {};

      const result = await getIndexStatus(repositoryId, {
        commitSha: typeof commitSha === 'string' ? commitSha : undefined,
        snapshotId: typeof snapshotId === 'string' ? snapshotId : undefined,
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

/**
 * POST /api/repositories/:repositoryId/claim
 * Protected: requires valid session.
 * Atomically claims an unowned legacy repository as OWNER.
 * Rejects if the repository already has any members (already owned or claimed).
 */
router.post('/:repositoryId/claim', requireAuth, async (req, res, next) => {
  try {
    const { repositoryId } = req.params;
    if (!repositoryId) {
      throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
    }

    const result = await claimLegacyRepository(repositoryId, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Repository successfully claimed as OWNER.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:repositoryId/members
 * Protected: requires valid session + OWNER or MEMBER role.
 * Lists members of the repository.
 */
router.get(
  '/:repositoryId/members',
  requireAuth,
  requireRepoAccess(['OWNER', 'MEMBER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const members = await listRepositoryMembers(repositoryId, req.user.id);

      res.status(200).json({
        success: true,
        data: members,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/repositories/:repositoryId/members
 * Body: { targetUserId: string, role?: 'MEMBER' }
 * Protected: requires valid session + OWNER role only.
 */
router.post(
  '/:repositoryId/members',
  requireAuth,
  requireRepoAccess(['OWNER']),
  async (req, res, next) => {
    try {
      const { repositoryId } = req.params;
      const { targetUserId, role } = req.body || {};

      const result = await addRepositoryMember(repositoryId, req.user.id, {
        targetUserId,
        role: role || 'MEMBER',
      });

      res.status(201).json({
        success: true,
        message: 'Collaborator added successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/repositories/:repositoryId/members/:userId
 * Protected: requires valid session + OWNER role only.
 */
router.delete(
  '/:repositoryId/members/:userId',
  requireAuth,
  requireRepoAccess(['OWNER']),
  async (req, res, next) => {
    try {
      const { repositoryId, userId: targetUserId } = req.params;

      const result = await removeRepositoryMember(repositoryId, req.user.id, targetUserId);

      res.status(200).json({
        success: true,
        message: 'Member removed successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
