import { Router } from 'express';
import { AppError } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  listWorkspaceFiles,
  getWorkspaceFile,
  saveWorkspaceFile,
  deleteWorkspaceFile,
  initializeWorkspaceFiles,
} from '../services/workspace.service.js';

const router = Router();

// All workspace routes require a valid session
router.use(requireAuth);

/**
 * POST /api/workspaces
 * Body: { repositoryId: string, name: string, baseCommitSha?: string, initializeFiles?: boolean }
 */
router.post('/', async (req, res, next) => {
  try {
    const { repositoryId, name, baseCommitSha, initializeFiles } = req.body || {};
    const result = await createWorkspace(req.user.id, {
      repositoryId,
      name,
      baseCommitSha,
      initializeFiles: Boolean(initializeFiles),
    });
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workspaces/:workspaceId/init-files
 * Explicitly initialize/import files from pinned repository baseline commit into workspace.
 */
router.post('/:workspaceId/init-files', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const result = await initializeWorkspaceFiles(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      message: 'Workspace files initialized from baseline commit.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces?repositoryId=...
 * If repositoryId is provided, returns workspaces for that repository.
 * If omitted, returns all workspaces belonging to the authenticated user.
 */
router.get('/', async (req, res, next) => {
  try {
    const { repositoryId } = req.query;
    const workspaces = await listWorkspaces(req.user.id, repositoryId ? String(repositoryId) : null);
    res.status(200).json({
      success: true,
      data: workspaces,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId
 */
router.get('/:workspaceId', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const workspace = await getWorkspace(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      data: workspace,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/workspaces/:workspaceId
 */
router.delete('/:workspaceId', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const result = await deleteWorkspace(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      message: 'Workspace deleted successfully.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId/files
 * List all files in the workspace.
 */
router.get('/:workspaceId/files', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const files = await listWorkspaceFiles(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      data: files,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId/files/*
 * Open and read a specific file.
 */
router.get('/:workspaceId/files/*', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const rawPath = req.params[0];
    const file = await getWorkspaceFile(req.user.id, workspaceId, rawPath);
    res.status(200).json({
      success: true,
      data: file,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/workspaces/:workspaceId/files/*
 * Save / update manual file content.
 * Body: { content: string }
 */
router.put('/:workspaceId/files/*', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const rawPath = req.params[0];
    const { content } = req.body || {};

    if (content === undefined || content === null) {
      throw new AppError('content field is required.', 400, 'INVALID_INPUT');
    }

    // Extract expectedContentHash from If-Match header or request body
    const ifMatchHeader = req.headers['if-match'];
    let expectedContentHash = req.body?.expectedContentHash;

    if (ifMatchHeader) {
      // Strip optional quotes: e.g. "hash" or hash
      expectedContentHash = ifMatchHeader.replace(/^"|"$/g, '').trim();
    }

    const saved = await saveWorkspaceFile(req.user.id, workspaceId, rawPath, content, {
      expectedContentHash,
    });
    res.status(200).json({
      success: true,
      message: 'File saved successfully.',
      data: saved,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/files/*
 * Delete a specific file from the workspace.
 */
router.delete('/:workspaceId/files/*', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const rawPath = req.params[0];
    const result = await deleteWorkspaceFile(req.user.id, workspaceId, rawPath);
    res.status(200).json({
      success: true,
      message: 'File deleted successfully.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId/diff
 * Generate workspace unified diff against pinned baseline commit.
 */
router.get('/:workspaceId/diff', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { getWorkspaceDiff } = await import('../services/diff.service.js');
    const diff = await getWorkspaceDiff(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      data: diff,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workspaces/:workspaceId/checkpoints
 * Create a point-in-time checkpoint.
 * Body: { name: string, description?: string }
 */
router.post('/:workspaceId/checkpoints', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { name, description } = req.body || {};
    const { createWorkspaceCheckpoint } = await import('../services/checkpoint.service.js');
    const result = await createWorkspaceCheckpoint(req.user.id, workspaceId, { name, description });
    res.status(201).json({
      success: true,
      message: 'Checkpoint created successfully.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId/checkpoints
 * List checkpoints for a workspace.
 */
router.get('/:workspaceId/checkpoints', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { listWorkspaceCheckpoints } = await import('../services/checkpoint.service.js');
    const checkpoints = await listWorkspaceCheckpoints(req.user.id, workspaceId);
    res.status(200).json({
      success: true,
      data: checkpoints,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workspaces/:workspaceId/checkpoints/:checkpointId
 * Read checkpoint manifest and metadata.
 */
router.get('/:workspaceId/checkpoints/:checkpointId', async (req, res, next) => {
  try {
    const { workspaceId, checkpointId } = req.params;
    const { getWorkspaceCheckpoint } = await import('../services/checkpoint.service.js');
    const checkpoint = await getWorkspaceCheckpoint(req.user.id, workspaceId, checkpointId);
    res.status(200).json({
      success: true,
      data: checkpoint,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workspaces/:workspaceId/checkpoints/:checkpointId/restore
 * Atomically restore workspace to checkpoint state.
 */
router.post('/:workspaceId/checkpoints/:checkpointId/restore', async (req, res, next) => {
  try {
    const { workspaceId, checkpointId } = req.params;
    const { restoreWorkspaceCheckpoint } = await import('../services/checkpoint.service.js');
    const result = await restoreWorkspaceCheckpoint(req.user.id, workspaceId, checkpointId);
    res.status(200).json({
      success: true,
      message: 'Workspace restored to checkpoint state.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
