import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { getWorkspace } from './workspace.service.js';

const MAX_CHECKPOINTS_PER_WORKSPACE = 20;

/**
 * Validates checkpoint name.
 */
export function validateCheckpointName(name) {
  if (!name || typeof name !== 'string') {
    throw new AppError('Checkpoint name is required.', 400, 'INVALID_INPUT');
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new AppError('Checkpoint name must be between 1 and 80 characters.', 400, 'INVALID_INPUT');
  }
  return trimmed;
}

/**
 * Create a point-in-time checkpoint of all workspace files.
 */
export async function createWorkspaceCheckpoint(
  userId,
  workspaceId,
  { name, description = null },
  options = {}
) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);
  const validatedName = validateCheckpointName(name);

  return await prisma.$transaction(async (tx) => {
    // Fetch all current workspace files
    const workspaceFiles = await tx.workspaceFile.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' },
    });

    // Create the checkpoint record
    const checkpoint = await tx.workspaceCheckpoint.create({
      data: {
        workspaceId,
        userId,
        name: validatedName,
        description: description ? description.trim() : null,
      },
    });

    // Create checkpoint file records preserving complete manifest
    if (workspaceFiles.length > 0) {
      await tx.workspaceCheckpointFile.createMany({
        data: workspaceFiles.map((wf) => ({
          checkpointId: checkpoint.id,
          path: wf.path,
          content: wf.content,
          contentHash: wf.contentHash,
          language: wf.language,
          isDeleted: wf.isDeleted,
          sizeBytes: Buffer.byteLength(wf.content, 'utf8'),
        })),
      });
    }

    // Prune excess checkpoints if count exceeds 20
    const existingCheckpoints = await tx.workspaceCheckpoint.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (existingCheckpoints.length > MAX_CHECKPOINTS_PER_WORKSPACE) {
      const pruneCount = existingCheckpoints.length - MAX_CHECKPOINTS_PER_WORKSPACE;
      const idsToPrune = existingCheckpoints.slice(0, pruneCount).map((c) => c.id);

      await tx.workspaceCheckpoint.deleteMany({
        where: { id: { in: idsToPrune } },
      });
    }

    return {
      id: checkpoint.id,
      workspaceId: checkpoint.workspaceId,
      userId: checkpoint.userId,
      name: checkpoint.name,
      description: checkpoint.description,
      fileCount: workspaceFiles.length,
      createdAt: checkpoint.createdAt,
    };
  }, {
    maxWait: 15000,
    timeout: 30000,
  });
}

/**
 * List all checkpoints for a workspace.
 */
export async function listWorkspaceCheckpoints(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const checkpoints = await prisma.workspaceCheckpoint.findMany({
    where: { workspaceId },
    include: {
      _count: {
        select: { files: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return checkpoints.map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description,
    fileCount: c._count.files,
    createdAt: c.createdAt,
  }));
}

/**
 * Read details of a specific checkpoint including its complete file manifest.
 */
export async function getWorkspaceCheckpoint(userId, workspaceId, checkpointId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const checkpoint = await prisma.workspaceCheckpoint.findUnique({
    where: { id: checkpointId },
    include: {
      files: {
        orderBy: { path: 'asc' },
      },
    },
  });

  if (!checkpoint) {
    throw new AppError('Checkpoint not found.', 404, 'CHECKPOINT_NOT_FOUND');
  }

  // IDOR Protection: ensure checkpoint belongs to the requesting user and workspace
  if (checkpoint.workspaceId !== workspaceId || checkpoint.userId !== userId) {
    throw new AppError('Access denied. Checkpoint does not belong to this workspace.', 403, 'FORBIDDEN');
  }

  return {
    id: checkpoint.id,
    workspaceId: checkpoint.workspaceId,
    name: checkpoint.name,
    description: checkpoint.description,
    createdAt: checkpoint.createdAt,
    files: checkpoint.files.map((f) => ({
      path: f.path,
      language: f.language,
      contentHash: f.contentHash,
      isDeleted: f.isDeleted,
      sizeBytes: f.sizeBytes,
    })),
  };
}

/**
 * Atomically restore workspace files to the exact state saved in the checkpoint.
 * Invalidates old client hashes and touches workspace updatedAt to cooperate with Phase 4A OCC.
 */
export async function restoreWorkspaceCheckpoint(userId, workspaceId, checkpointId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  return await prisma.$transaction(async (tx) => {
    const checkpoint = await tx.workspaceCheckpoint.findUnique({
      where: { id: checkpointId },
      include: {
        files: true,
      },
    });

    if (!checkpoint) {
      throw new AppError('Checkpoint not found.', 404, 'CHECKPOINT_NOT_FOUND');
    }

    if (checkpoint.workspaceId !== workspaceId || checkpoint.userId !== userId) {
      throw new AppError('Access denied. Checkpoint does not belong to this workspace.', 403, 'FORBIDDEN');
    }

    // Step 1: Delete all current workspace files for this workspace
    await tx.workspaceFile.deleteMany({
      where: { workspaceId },
    });

    // Step 2: Recreate all files from checkpoint manifest
    if (checkpoint.files.length > 0) {
      await tx.workspaceFile.createMany({
        data: checkpoint.files.map((cf) => ({
          workspaceId,
          path: cf.path,
          content: cf.content,
          contentHash: cf.contentHash,
          language: cf.language,
          isDeleted: cf.isDeleted,
        })),
      });
    }

    // Step 3: Touch workspace updatedAt timestamp (invalidates any cached client OCC timestamps)
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { updatedAt: new Date() },
    });

    return {
      success: true,
      restoredCheckpointId: checkpoint.id,
      restoredName: checkpoint.name,
      fileCount: checkpoint.files.length,
      restoredAt: new Date(),
    };
  }, {
    maxWait: 15000,
    timeout: 30000,
  });
}
