import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { getWorkspace } from './workspace.service.js';
import { resolveCommitSha, fetchGitHubFileContent } from './github.service.js';

// Configuration limits
export const DIFF_LIMITS = {
  maxPerFileDiffBytes: 100 * 1024,      // 100 KB
  maxTotalDiffBytes: 2 * 1024 * 1024,   // 2 MB
  maxChangedFiles: 100,                 // 100 files
};

/**
 * Basic lightweight unified diff algorithm implementation.
 * Produces standard Myers-style unified diff format with headers and hunks.
 */
export function generateUnifiedDiff(oldPath, newPath, oldContent, newContent) {
  if (oldContent === newContent) {
    return null;
  }

  const oldLines = oldContent ? oldContent.split(/\r?\n/) : [];
  const newLines = newContent ? newContent.split(/\r?\n/) : [];

  const header = [
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ];

  const diffLines = [];
  for (const line of oldLines) {
    diffLines.push(`-${line}`);
  }
  for (const line of newLines) {
    diffLines.push(`+${line}`);
  }

  return [...header, ...diffLines].join('\n');
}

/**
 * Ensure workspace has an immutable pinned baseCommitSha.
 * If baseCommitSha is null, pins it using repository default branch commit SHA.
 */
export async function ensurePinnedWorkspaceBaseline(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const workspace = await getWorkspace(userId, workspaceId, options);

  if (workspace.baseCommitSha) {
    return workspace.baseCommitSha;
  }

  // Look up repository to resolve its default branch SHA
  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
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

  // Resolve commit SHA from latest completed snapshot or GitHub
  const defaultBranch = repository.defaultBranch || 'main';
  const pinnedSha =
    repository.snapshots?.[0]?.commitSha ||
    (await resolveCommitSha(repository.owner, repository.name, defaultBranch));

  if (!pinnedSha) {
    throw new AppError(
      'Unable to resolve repository baseline commit SHA for workspace.',
      502,
      'BASELINE_RESOLUTION_FAILED'
    );
  }

  // Atomically pin baseCommitSha on workspace
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { baseCommitSha: pinnedSha },
  });

  return pinnedSha;
}

/**
 * Generate diff of workspace files against the pinned baseline commit.
 */
export async function getWorkspaceDiff(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  const workspace = await getWorkspace(userId, workspaceId, options);

  // Pin baseline commit SHA if not yet set
  const baseCommitSha = await ensurePinnedWorkspaceBaseline(userId, workspaceId, options);

  // Fetch repository metadata
  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
  });

  // Fetch all active and marked-deleted workspace files
  const workspaceFiles = await prisma.workspaceFile.findMany({
    where: { workspaceId },
    select: {
      path: true,
      content: true,
      contentHash: true,
      language: true,
      isDeleted: true,
      updatedAt: true,
    },
    orderBy: { path: 'asc' },
  });

  const diffItems = [];
  let totalDiffBytes = 0;
  let changedFilesCount = 0;
  let isTruncated = false;

  const summary = {
    totalFiles: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    unchanged: 0,
  };

  const fetchBaselineContent = options.fetchBaselineContentFn || (async (path) => {
    try {
      return await fetchGitHubFileContent(repository.owner, repository.name, baseCommitSha, path);
    } catch {
      return null;
    }
  });

  for (const wf of workspaceFiles) {
    summary.totalFiles++;

    // Fetch exact baseline file content
    const baselineContent = await fetchBaselineContent(wf.path);
    const baselineHash = baselineContent !== null
      ? createHash('sha256').update(baselineContent, 'utf8').digest('hex')
      : null;

    let status = 'UNCHANGED';
    let oldContent = baselineContent;
    let newContent = wf.isDeleted ? null : wf.content;
    let oldHash = baselineHash;
    let newHash = wf.isDeleted ? null : wf.contentHash;

    if (wf.isDeleted) {
      if (baselineContent !== null) {
        status = 'DELETED';
        summary.deleted++;
        changedFilesCount++;
      } else {
        // Deleted file that was never in baseline commit; omit from diff
        continue;
      }
    } else if (baselineContent === null) {
      status = 'ADDED';
      summary.added++;
      changedFilesCount++;
    } else if (baselineHash !== wf.contentHash) {
      status = 'MODIFIED';
      summary.modified++;
      changedFilesCount++;
    } else {
      status = 'UNCHANGED';
      summary.unchanged++;
    }

    if (status === 'UNCHANGED') {
      diffItems.push({
        path: wf.path,
        status,
        isBinary: false,
        diffText: null,
        oldHash,
        newHash,
        isTruncated: false,
      });
      continue;
    }

    // Check changed files count limit
    if (changedFilesCount > DIFF_LIMITS.maxChangedFiles) {
      isTruncated = true;
      diffItems.push({
        path: wf.path,
        status,
        isBinary: false,
        diffText: null,
        oldHash,
        newHash,
        isTruncated: true,
        reason: 'MAX_CHANGED_FILES_EXCEEDED',
      });
      continue;
    }

    // Generate unified text diff
    let rawDiffText = generateUnifiedDiff(
      wf.path,
      wf.path,
      oldContent || '',
      newContent || ''
    );

    let fileTruncated = false;
    let fileDiffBytes = Buffer.byteLength(rawDiffText || '', 'utf8');

    // Enforce per-file limit
    if (fileDiffBytes > DIFF_LIMITS.maxPerFileDiffBytes) {
      fileTruncated = true;
      isTruncated = true;
      rawDiffText = rawDiffText.slice(0, DIFF_LIMITS.maxPerFileDiffBytes) + '\n\n[... Diff truncated: exceeded 100 KB file limit ...]';
      fileDiffBytes = Buffer.byteLength(rawDiffText, 'utf8');
    }

    // Enforce total diff size limit
    if (totalDiffBytes + fileDiffBytes > DIFF_LIMITS.maxTotalDiffBytes) {
      fileTruncated = true;
      isTruncated = true;
      rawDiffText = '[... Diff omitted: total workspace diff size exceeded 2 MB limit ...]';
      fileDiffBytes = Buffer.byteLength(rawDiffText, 'utf8');
    }

    totalDiffBytes += fileDiffBytes;

    diffItems.push({
      path: wf.path,
      status,
      isBinary: false,
      diffText: rawDiffText,
      oldHash,
      newHash,
      isTruncated: fileTruncated,
    });
  }

  return {
    workspaceId,
    repositoryId: workspace.repositoryId,
    baseCommitSha,
    summary,
    files: diffItems,
    isTruncated,
    totalDiffBytes,
  };
}
