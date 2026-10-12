import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { requireRepositoryAccess } from './access.service.js';

// Supported extensions mapped to language identifier
const SUPPORTED_EXTENSIONS = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.txt': 'text',
};

const EXCLUDED_DIR_PATTERNS = [
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)vendor(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)build(\/|$)/i,
  /(^|\/)out(\/|$)/i,
  /(^|\/)coverage(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.github(\/|$)/i,
  /(^|\/)\.vscode(\/|$)/i,
  /(^|\/)\.idea(\/|$)/i,
  /(^|\/)target(\/|$)/i,
  /(^|\/)bin(\/|$)/i,
  /(^|\/)obj(\/|$)/i,
  /(^|\/)__pycache__(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.nuxt(\/|$)/i,
  /(^|\/)\.cache(\/|$)/i,
];

/**
 * Validates and normalizes workspace name.
 */
export function validateWorkspaceName(name) {
  if (!name || typeof name !== 'string') {
    throw new AppError('Workspace name is required.', 400, 'INVALID_INPUT');
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError('Workspace name is required.', 400, 'INVALID_INPUT');
  }
  if (trimmed.length < 1 || trimmed.length > 64) {
    throw new AppError('Workspace name must be between 1 and 64 characters.', 400, 'INVALID_INPUT');
  }
  // Allow alphanumeric, underscores, hyphens, and spaces
  if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
    throw new AppError(
      'Workspace name may only contain alphanumeric characters, hyphens, underscores, and spaces.',
      400,
      'INVALID_INPUT'
    );
  }
  return trimmed;
}

/**
 * Validates optional base commit SHA (40-char hex).
 */
export function validateBaseCommitSha(commitSha) {
  if (!commitSha) return null;
  if (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(commitSha.trim())) {
    throw new AppError('Invalid baseCommitSha. Must be a 40-character hexadecimal string.', 400, 'INVALID_INPUT');
  }
  return commitSha.trim().toLowerCase();
}

/**
 * Validates and normalizes relative workspace file path.
 * Rejects path traversal, backslashes, double-encoded segments, null/control characters, and reserved directories.
 */
export function validateWorkspaceFilePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new AppError('File path is required.', 400, 'INVALID_PATH');
  }

  // Reject null bytes and control characters
  if (/[\0\x01-\x1f\x7f]/.test(rawPath)) {
    throw new AppError('File path contains illegal control characters.', 400, 'INVALID_PATH');
  }

  // Reject raw backslashes
  if (rawPath.includes('\\')) {
    throw new AppError('Backslashes are not permitted in file paths. Use forward slashes.', 400, 'INVALID_PATH');
  }

  // Reject percent-encoded slashes/backslashes or traversals to prevent double-decode attacks
  if (/%(?:2f|5c|25)/i.test(rawPath)) {
    throw new AppError('Encoded path separators or traversal characters are not permitted.', 400, 'INVALID_PATH');
  }

  // Strip leading and trailing forward slashes
  const cleanPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanPath) {
    throw new AppError('File path cannot be empty or root.', 400, 'INVALID_PATH');
  }

  const segments = cleanPath.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new AppError('Path traversal segments ("." or "..") are strictly prohibited.', 400, 'PATH_TRAVERSAL');
    }
  }

  // Check excluded directory patterns
  for (const pattern of EXCLUDED_DIR_PATTERNS) {
    if (pattern.test(cleanPath)) {
      throw new AppError(`Path contains restricted directory (${cleanPath}).`, 400, 'RESTRICTED_PATH');
    }
  }

  // Extension check
  const lastDot = cleanPath.lastIndexOf('.');
  const ext = lastDot !== -1 ? cleanPath.slice(lastDot).toLowerCase() : '';
  const isReadme = /(^|\/)README(\.[a-z0-9]+)?$/i.test(cleanPath);
  const isConfigManifest = /(^|\/)(package\.json|tsconfig\.json|requirements\.txt|pom\.xml|go\.mod|Cargo\.toml)$/i.test(cleanPath);

  if (!isReadme && !isConfigManifest && !SUPPORTED_EXTENSIONS[ext]) {
    throw new AppError(
      `File extension "${ext || 'none'}" is not supported for manual workspace editing.`,
      400,
      'UNSUPPORTED_EXTENSION'
    );
  }

  const language = isReadme
    ? 'markdown'
    : isConfigManifest && ext === '.json'
      ? 'json'
      : SUPPORTED_EXTENSIONS[ext] || 'text';

  return {
    normalizedPath: cleanPath,
    language,
    extension: ext,
  };
}

/**
 * Validates file content and checks byte-length cap.
 */
export function validateFileContent(content, maxBytes = env.indexingMaxFileSizeBytes) {
  if (typeof content !== 'string') {
    throw new AppError('File content must be a string.', 400, 'INVALID_CONTENT');
  }

  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > maxBytes) {
    throw new AppError(
      `File content exceeds maximum permitted size of ${maxBytes} bytes (size was ${byteLength} bytes).`,
      413,
      'FILE_TOO_LARGE'
    );
  }

  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

  return {
    byteLength,
    contentHash,
  };
}

/**
 * Creates a workspace for a repository. Requires repository membership.
 */
export async function createWorkspace(userId, { repositoryId, name, baseCommitSha, initializeFiles = false }, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  if (!repositoryId || typeof repositoryId !== 'string') {
    throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
  }

  const validatedName = validateWorkspaceName(name);
  const validatedCommitSha = validateBaseCommitSha(baseCommitSha);

  // Require OWNER or MEMBER role in repository
  await requireRepositoryAccess(repositoryId, userId, ['OWNER', 'MEMBER'], { prisma });

  // Check if workspace name already exists for this (repository, user)
  const existing = await prisma.workspace.findUnique({
    where: {
      repositoryId_userId_name: {
        repositoryId,
        userId,
        name: validatedName,
      },
    },
  });

  if (existing) {
    throw new AppError(
      `A workspace named "${validatedName}" already exists for this repository.`,
      409,
      'WORKSPACE_ALREADY_EXISTS'
    );
  }

  let initialCommitSha = validatedCommitSha;
  if (!initialCommitSha) {
    const latestSnapshot = await prisma.repoSnapshot.findFirst({
      where: { repositoryId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { commitSha: true },
    });
    if (latestSnapshot?.commitSha) {
      initialCommitSha = latestSnapshot.commitSha;
    }
  }

  const workspace = await prisma.workspace.create({
    data: {
      repositoryId,
      userId,
      name: validatedName,
      baseCommitSha: initialCommitSha,
    },
    include: {
      repository: {
        select: { id: true, owner: true, name: true, defaultBranch: true },
      },
    },
  });

  // If initializeFiles is requested, populate workspace with repository baseline files
  if (initializeFiles) {
    await initializeWorkspaceFiles(userId, workspace.id, options);
  }

  return {
    id: workspace.id,
    repositoryId: workspace.repositoryId,
    repository: workspace.repository,
    userId: workspace.userId,
    name: workspace.name,
    baseCommitSha: workspace.baseCommitSha,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

/**
 * List workspaces belonging to the authenticated user (for a repository or all repositories).
 */
export async function listWorkspaces(userId, repositoryId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  if (repositoryId) {
    if (typeof repositoryId !== 'string') {
      throw new AppError('repositoryId must be a string.', 400, 'INVALID_INPUT');
    }
    // Require OWNER or MEMBER in repository
    await requireRepositoryAccess(repositoryId, userId, ['OWNER', 'MEMBER'], { prisma });
  }

  const workspaces = await prisma.workspace.findMany({
    where: {
      userId,
      ...(repositoryId ? { repositoryId } : {}),
    },
    include: {
      repository: {
        select: { id: true, owner: true, name: true, defaultBranch: true },
      },
      _count: {
        select: { files: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return workspaces.map((w) => ({
    id: w.id,
    repositoryId: w.repositoryId,
    repository: w.repository,
    name: w.name,
    baseCommitSha: w.baseCommitSha,
    fileCount: w._count.files,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
}

/**
 * Get a single workspace by ID. Must be owned by the requesting user.
 */
export async function getWorkspace(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new AppError('workspaceId is required.', 400, 'INVALID_INPUT');
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      repository: {
        select: { id: true, owner: true, name: true, defaultBranch: true },
      },
      _count: {
        select: { files: true },
      },
    },
  });

  if (!workspace) {
    throw new AppError('Workspace not found.', 404, 'WORKSPACE_NOT_FOUND');
  }

  // Ensure requesting user is workspace owner
  if (workspace.userId !== userId) {
    throw new AppError('Access denied. You do not own this workspace.', 403, 'FORBIDDEN');
  }

  return {
    id: workspace.id,
    repositoryId: workspace.repositoryId,
    repository: workspace.repository,
    userId: workspace.userId,
    name: workspace.name,
    baseCommitSha: workspace.baseCommitSha,
    fileCount: workspace._count.files,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

/**
 * Delete a workspace and cascade delete all its files.
 */
export async function deleteWorkspace(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  await prisma.workspace.delete({
    where: { id: workspaceId },
  });

  return {
    success: true,
    deletedWorkspaceId: workspaceId,
  };
}

/**
 * List files in a workspace with file metadata.
 */
export async function listWorkspaceFiles(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const files = await prisma.workspaceFile.findMany({
    where: { workspaceId, isDeleted: false },
    select: {
      id: true,
      path: true,
      language: true,
      contentHash: true,
      createdAt: true,
      updatedAt: true,
      content: true,
    },
    orderBy: { path: 'asc' },
  });

  return files.map((f) => ({
    id: f.id,
    path: f.path,
    language: f.language,
    contentHash: f.contentHash,
    sizeBytes: Buffer.byteLength(f.content, 'utf8'),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
}

/**
 * Get a specific workspace file content.
 */
export async function getWorkspaceFile(userId, workspaceId, rawPath, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const { normalizedPath } = validateWorkspaceFilePath(rawPath);

  let file = await prisma.workspaceFile.findUnique({
    where: {
      workspaceId_path: {
        workspaceId,
        path: normalizedPath,
      },
    },
  });

  if (!file || file.isDeleted) {
    try {
      file = await importWorkspaceFile(userId, workspaceId, normalizedPath, options);
    } catch {
      throw new AppError(`File "${normalizedPath}" not found in workspace.`, 404, 'FILE_NOT_FOUND');
    }
  }

  return {
    id: file.id,
    workspaceId: file.workspaceId,
    path: file.path,
    content: file.content,
    language: file.language,
    contentHash: file.contentHash,
    sizeBytes: Buffer.byteLength(file.content, 'utf8'),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export async function saveWorkspaceFile(
  userId,
  workspaceId,
  rawPath,
  content,
  { expectedContentHash = undefined, ...options } = {}
) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const { normalizedPath, language } = validateWorkspaceFilePath(rawPath);
  const { contentHash, byteLength } = validateFileContent(content);

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Look up existing file within transaction
        const existing = await tx.workspaceFile.findUnique({
          where: {
            workspaceId_path: {
              workspaceId,
              path: normalizedPath,
            },
          },
        });

        let saved;

      if (existing) {
        // If client provided expectedContentHash, it MUST match the existing file's current hash
        if (expectedContentHash !== undefined && expectedContentHash !== null) {
          if (existing.contentHash !== expectedContentHash) {
            throw new AppError(
              `File has been modified concurrently. Expected hash ${expectedContentHash}, but found ${existing.contentHash}.`,
              409,
              'STALE_FILE_EDIT',
              {
                currentContentHash: existing.contentHash,
                currentUpdatedAt: existing.updatedAt,
                path: existing.path,
              }
            );
          }
        }

        // Atomically update file checking contentHash if expectedContentHash was provided
        if (expectedContentHash !== undefined && expectedContentHash !== null) {
          const updateResult = await tx.workspaceFile.updateMany({
            where: {
              workspaceId,
              path: normalizedPath,
              contentHash: expectedContentHash,
            },
            data: {
              content,
              contentHash,
              language,
              isDeleted: false,
            },
          });

          if (updateResult.count === 0) {
            // Concurrently updated by another transaction
            const current = await tx.workspaceFile.findUnique({
              where: { workspaceId_path: { workspaceId, path: normalizedPath } },
            });
            throw new AppError(
              'File has been modified concurrently.',
              409,
              'STALE_FILE_EDIT',
              {
                currentContentHash: current?.contentHash,
                currentUpdatedAt: current?.updatedAt,
                path: normalizedPath,
              }
            );
          }

          saved = await tx.workspaceFile.findUnique({
            where: { workspaceId_path: { workspaceId, path: normalizedPath } },
          });
        } else {
          // Fallback update without OCC requirement
          saved = await tx.workspaceFile.update({
            where: { workspaceId_path: { workspaceId, path: normalizedPath } },
            data: {
              content,
              contentHash,
              language,
              isDeleted: false,
            },
          });
        }
      } else {
        // New file creation
        if (expectedContentHash !== undefined && expectedContentHash !== null && expectedContentHash !== '') {
          throw new AppError(
            'File does not exist, but expectedContentHash was provided.',
            409,
            'STALE_FILE_EDIT',
            {
              currentContentHash: null,
              path: normalizedPath,
            }
          );
        }

        // Create new file
        saved = await tx.workspaceFile.create({
          data: {
            workspaceId,
            path: normalizedPath,
            content,
            contentHash,
            language,
          },
        });
      }

      // Touch workspace updatedAt inside same transaction
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { updatedAt: new Date() },
      });

        return {
          id: saved.id,
          workspaceId: saved.workspaceId,
          path: saved.path,
          language: saved.language,
          contentHash: saved.contentHash,
          sizeBytes: byteLength,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        };
      },
      {
        maxWait: 10000,
        timeout: 15000,
      }
    );
  } catch (err) {
    if (
      err.code === 'P2034' ||
      err.code === 'P2002' ||
      err.code === 'P2028' ||
      /serialization failure|could not serialize|transaction api error|unable to start a transaction/i.test(err.message)
    ) {
      const current = await prisma.workspaceFile.findUnique({
        where: { workspaceId_path: { workspaceId, path: normalizedPath } },
      }).catch(() => null);
      throw new AppError(
        'File has been modified concurrently.',
        409,
        'STALE_FILE_EDIT',
        {
          currentContentHash: current?.contentHash || null,
          currentUpdatedAt: current?.updatedAt || null,
          path: normalizedPath,
        }
      );
    }
    throw err;
  }
}

/**
 * Delete a file from a workspace.
 */
export async function deleteWorkspaceFile(
  userId,
  workspaceId,
  rawPath,
  { expectedContentHash = undefined, ...options } = {}
) {
  const prisma = options.prisma || getPrismaClient();

  // Validate ownership
  await getWorkspace(userId, workspaceId, options);

  const { normalizedPath } = validateWorkspaceFilePath(rawPath);

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.workspaceFile.findUnique({
      where: {
        workspaceId_path: {
          workspaceId,
          path: normalizedPath,
        },
      },
    });

    if (!existing || existing.isDeleted) {
      throw new AppError(`File "${normalizedPath}" not found in workspace.`, 404, 'FILE_NOT_FOUND');
    }

    if (expectedContentHash !== undefined && expectedContentHash !== null) {
      if (existing.contentHash !== expectedContentHash) {
        throw new AppError(
          `File has been modified concurrently. Expected hash ${expectedContentHash}, but found ${existing.contentHash}.`,
          409,
          'STALE_FILE_EDIT',
          {
            currentContentHash: existing.contentHash,
            currentUpdatedAt: existing.updatedAt,
            path: existing.path,
          }
        );
      }
    }

    // Mark as deleted with empty content & hash
    await tx.workspaceFile.update({
      where: {
        workspaceId_path: {
          workspaceId,
          path: normalizedPath,
        },
      },
      data: {
        isDeleted: true,
        content: '',
        contentHash: 'deleted',
      },
    });

    // Touch the workspace updatedAt timestamp
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { updatedAt: new Date() },
    });

    return {
      success: true,
      deletedPath: normalizedPath,
    };
  }, {
    maxWait: 10000,
    timeout: 20000,
  });
}

/**
 * Import a single repository file from the baseline commit into the workspace.
 * Resolves content from snapshot chunks or GitHub raw CDN, and creates the WorkspaceFile.
 */
export async function importWorkspaceFile(userId, workspaceId, rawPath, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const workspace = await getWorkspace(userId, workspaceId, options);
  const { normalizedPath, language } = validateWorkspaceFilePath(rawPath);

  const existing = await prisma.workspaceFile.findUnique({
    where: {
      workspaceId_path: {
        workspaceId,
        path: normalizedPath,
      },
    },
  });
  if (existing && !existing.isDeleted) {
    return existing;
  }

  const { ensurePinnedWorkspaceBaseline } = await import('./diff.service.js');
  const baseCommitSha = await ensurePinnedWorkspaceBaseline(userId, workspaceId, options);

  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
    include: {
      snapshots: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          files: {
            where: { path: normalizedPath },
          },
          snapshotChunks: {
            where: { filePath: normalizedPath },
            include: { chunk: true },
            orderBy: { chunkIndex: 'asc' },
          },
        },
      },
    },
  });

  if (!repository) {
    throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
  }

  let content = null;
  const snapshot = repository.snapshots?.[0];
  const fileRecord = snapshot?.files?.[0];
  const snapshotChunks = snapshot?.snapshotChunks;

  if (
    snapshotChunks &&
    snapshotChunks.length === 1 &&
    fileRecord &&
    snapshotChunks[0].chunk.contentHash === fileRecord.contentHash
  ) {
    content = snapshotChunks[0].chunk.content;
  }

  if (content === null) {
    const { fetchGitHubFileContent } = await import('./github.service.js');
    try {
      content = await fetchGitHubFileContent(repository.owner, repository.name, baseCommitSha, normalizedPath);
    } catch {
      if (snapshotChunks && snapshotChunks.length > 0) {
        content = snapshotChunks.map((sc) => sc.chunk.content).join('');
      }
    }
  }

  if (content === null) {
    throw new AppError(`File "${normalizedPath}" not found in repository baseline commit.`, 404, 'FILE_NOT_FOUND');
  }

  const { contentHash } = validateFileContent(content);

  const file = await prisma.workspaceFile.upsert({
    where: {
      workspaceId_path: {
        workspaceId,
        path: normalizedPath,
      },
    },
    create: {
      workspaceId,
      path: normalizedPath,
      content,
      contentHash,
      language: language || 'text',
      isDeleted: false,
    },
    update: {
      content,
      contentHash,
      isDeleted: false,
    },
  });

  return file;
}

/**
 * Safely initializes an empty workspace (or fills missing files) with the repository's files
 * from the pinned baseline commit.
 * NEVER overwrites existing user modifications (skipDuplicates: true).
 */
export async function initializeWorkspaceFiles(userId, workspaceId, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const workspace = await getWorkspace(userId, workspaceId, options);

  const { ensurePinnedWorkspaceBaseline } = await import('./diff.service.js');
  const baseCommitSha = await ensurePinnedWorkspaceBaseline(userId, workspaceId, options);

  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
    include: {
      snapshots: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          files: {
            orderBy: { path: 'asc' },
          },
          snapshotChunks: {
            include: { chunk: true },
            orderBy: { chunkIndex: 'asc' },
          },
        },
      },
    },
  });

  if (!repository) {
    throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
  }

  const existingFiles = await prisma.workspaceFile.findMany({
    where: { workspaceId },
    select: { path: true },
  });
  const existingSet = new Set(existingFiles.map((f) => f.path));

  const completedSnapshot = repository.snapshots?.[0];
  const filesToInsert = [];

  if (completedSnapshot && completedSnapshot.files?.length > 0) {
    const chunksByPath = new Map();
    for (const sc of completedSnapshot.snapshotChunks) {
      if (!chunksByPath.has(sc.filePath)) chunksByPath.set(sc.filePath, []);
      chunksByPath.get(sc.filePath).push(sc);
    }

    for (const fr of completedSnapshot.files) {
      if (existingSet.has(fr.path)) continue;

      let content = null;
      const chunks = chunksByPath.get(fr.path);
      if (chunks && chunks.length === 1 && chunks[0].chunk.contentHash === fr.contentHash) {
        content = chunks[0].chunk.content;
      }

      if (content === null) {
        const { fetchGitHubFileContent } = await import('./github.service.js');
        try {
          content = await fetchGitHubFileContent(repository.owner, repository.name, baseCommitSha, fr.path);
        } catch {
          if (chunks && chunks.length > 0) {
            content = chunks.map((sc) => sc.chunk.content).join('');
          }
        }
      }

      if (content === null) continue;

      const { contentHash } = validateFileContent(content);
      const { normalizedPath, language } = validateWorkspaceFilePath(fr.path);

      filesToInsert.push({
        workspaceId,
        path: normalizedPath,
        content,
        contentHash,
        language: fr.language || language || 'text',
        isDeleted: false,
      });
    }
  }

  if (filesToInsert.length > 0) {
    await prisma.workspaceFile.createMany({
      data: filesToInsert,
      skipDuplicates: true,
    });
  }

  return await listWorkspaceFiles(userId, workspaceId, options);
}
