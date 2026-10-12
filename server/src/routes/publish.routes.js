import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  publishWorkspaceChanges,
  createPullRequest,
} from '../services/publish.service.js';

const router = Router();

// All publishing endpoints require authenticated sessions
router.use(requireAuth);

/**
 * POST /api/workspaces/:workspaceId/publish
 * Body: {
 *   branchName: string,
 *   commitMessage: string,
 *   selectedPaths: string[],
 *   baseBranch?: string
 * }
 */
router.post('/:workspaceId/publish', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const result = await publishWorkspaceChanges(req.user.id, workspaceId, req.body);

    res.status(200).json({
      success: true,
      message: 'Workspace changes successfully published to new GitHub branch.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workspaces/:workspaceId/pull-request
 * Body: {
 *   headBranch: string,
 *   baseBranch?: string,
 *   title: string,
 *   body?: string
 * }
 */
router.post('/:workspaceId/pull-request', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const result = await createPullRequest(req.user.id, workspaceId, req.body);

    res.status(201).json({
      success: true,
      message: 'Pull request successfully created on GitHub.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
