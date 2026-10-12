import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import {
  parseGitHubUrl,
  getRepositoryMetadata,
  resolveCommitSha,
  getEligibleFilesFromTree,
  fetchFileContentsConcurrently,
} from './github.service.js';
import { chunkFile, hashFileContent } from './chunking.service.js';
import {
  embedChunksWithCache,
  EmbeddingQuotaExhaustedError,
  lookupEmbeddingCache,
  resolveEmbeddingConfig,
} from './embedding.service.js';

const activeWorkers = new Map(); // snapshotId -> { workerId, abortRequested }

/**
 * Stable SHA-256 of indexing configuration that affects chunk/embedding identity.
 */
export function computeConfigHash(overrides = {}) {
  const cfg = resolveEmbeddingConfig(overrides);
  const isLiquid = (overrides.embeddingModel || cfg.model || '').toLowerCase().includes('lfm');
  const payload = {
    embeddingModel: overrides.embeddingModel || cfg.model,
    dimensions: overrides.dimensions || cfg.dimensions,
    maxFiles: overrides.maxFiles || env.indexingMaxFiles,
    maxFileSize: overrides.maxFileSize || env.indexingMaxFileSizeBytes,
    maxTotalBytes: overrides.maxTotalBytes || env.indexingMaxTotalBytes,
    maxChunks: overrides.maxChunks || env.indexingMaxChunks,
    chunkTargetTokens: overrides.chunkTargetTokens || (isLiquid ? 300 : env.chunkTargetTokens),
    chunkMaxTokens: overrides.chunkMaxTokens || (isLiquid ? 400 : env.chunkMaxTokens),
    chunkOverlapTokens: overrides.chunkOverlapTokens || (isLiquid ? 40 : env.chunkOverlapTokens),
    chunkMinTokens: overrides.chunkMinTokens || env.chunkMinTokens,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Analyze a GitHub repository URL: validate, upsert Repository, preview eligible files.
 */
export async function analyzeRepository(url, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const parsed = parseGitHubUrl(url);

  // Check if repository already exists in database with a completed snapshot
  const existingRepo = await prisma.repository.findUnique({
    where: { url: parsed.normalizedUrl },
    include: {
      snapshots: {
        where: { status: 'COMPLETED' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        include: {
          files: {
            select: { path: true, size: true, language: true },
            orderBy: { path: 'asc' },
          },
        },
      },
    },
  });

  const latestCompletedSnapshot = existingRepo?.snapshots?.[0];

  let metadata;
  let branch = options.branch || existingRepo?.defaultBranch;
  let commitSha = null;
  let tree = null;

  try {
    metadata = await getRepositoryMetadata(parsed.owner, parsed.repo, options);
    branch = options.branch || metadata.defaultBranch;
    commitSha = await resolveCommitSha(parsed.owner, parsed.repo, branch, options);

    // If commitSha hasn't changed and we have a completed snapshot with files, reuse them!
    if (latestCompletedSnapshot && latestCompletedSnapshot.commitSha === commitSha && latestCompletedSnapshot.files?.length > 0) {
      const snapFiles = latestCompletedSnapshot.files;
      const totalBytes = snapFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      tree = {
        totalTreeFiles: snapFiles.length,
        eligibleCount: snapFiles.length,
        cappedFiles: snapFiles.map((f) => ({ ...f, sha: null, priority: 1 })),
        totalBytesSelected: totalBytes,
        isTruncated: false,
      };
    } else {
      tree = await getEligibleFilesFromTree(parsed.owner, parsed.repo, commitSha, env, options);
    }
  } catch (ghErr) {
    // If GitHub API rate limited or errored, but we already have an existing repository and snapshot,
    // gracefully fall back to existing data so the user can still explore and use RepoMind!
    if (existingRepo && latestCompletedSnapshot && latestCompletedSnapshot.files?.length > 0) {
      const snapFiles = latestCompletedSnapshot.files;
      const totalBytes = snapFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      metadata = {
        owner: existingRepo.owner,
        name: existingRepo.name,
        defaultBranch: existingRepo.defaultBranch,
        description: '',
        stars: 0,
      };
      branch = latestCompletedSnapshot.branch || existingRepo.defaultBranch;
      commitSha = latestCompletedSnapshot.commitSha;
      tree = {
        totalTreeFiles: snapFiles.length,
        eligibleCount: snapFiles.length,
        cappedFiles: snapFiles.map((f) => ({ ...f, sha: null, priority: 1 })),
        totalBytesSelected: totalBytes,
        isTruncated: false,
      };
    } else {
      throw ghErr;
    }
  }

  let repository;
  let ownershipInfo = null;

  if (options.userId) {
    const { findOrCreateRepositoryWithInitialOwner } = await import('./access.service.js');
    const result = await findOrCreateRepositoryWithInitialOwner(
      {
        url: parsed.normalizedUrl,
        owner: metadata.owner,
        name: metadata.name,
        defaultBranch: metadata.defaultBranch,
      },
      options.userId,
      { prisma }
    );
    repository = result.repository;
    ownershipInfo = {
      isOwner: result.isOwner,
      isMember: result.isMember,
      isUnowned: result.isUnowned,
      created: result.created,
    };
  } else {
    repository = await prisma.repository.upsert({
      where: { url: parsed.normalizedUrl },
      create: {
        owner: metadata.owner,
        name: metadata.name,
        url: parsed.normalizedUrl,
        defaultBranch: metadata.defaultBranch,
      },
      update: {
        owner: metadata.owner,
        name: metadata.name,
        defaultBranch: metadata.defaultBranch,
      },
    });
  }

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
    },
    branch,
    commitSha,
    description: metadata.description,
    stars: metadata.stars,
    ownership: ownershipInfo,
    files: {
      totalTreeFiles: tree.totalTreeFiles,
      eligibleCount: tree.eligibleCount,
      selectedCount: tree.cappedFiles.length,
      totalBytesSelected: tree.totalBytesSelected,
      isTruncated: tree.isTruncated,
      preview: tree.cappedFiles.slice(0, 20).map((f) => ({
        path: f.path,
        size: f.size,
        language: f.language,
      })),
    },
  };
}

/**
 * Start or resume indexing for a repository. Returns immediately; work runs in background.
 */
export async function startIndexing(repositoryId, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError('Repository not found. Analyze the repository first.', 404, 'REPOSITORY_NOT_FOUND');
  }

  const branch = options.branch || repository.defaultBranch;
  let commitSha = options.commitSha;
  if (!commitSha) {
    try {
      commitSha = await resolveCommitSha(repository.owner, repository.name, branch, options);
    } catch (ghErr) {
      // If GitHub is rate-limited or fails, reuse known commitSha from an existing snapshot
      const existingSnapshot = await prisma.repoSnapshot.findFirst({
        where: { repositoryId, branch },
        orderBy: { updatedAt: 'desc' },
      });
      if (existingSnapshot?.commitSha) {
        commitSha = existingSnapshot.commitSha;
      } else {
        throw ghErr;
      }
    }
  }
  const cfg = resolveEmbeddingConfig(options.configOverrides);
  const embeddingModel = options.configOverrides?.embeddingModel || cfg.model;
  const dimensions = options.configOverrides?.dimensions || cfg.dimensions;
  const configHash = computeConfigHash({ ...options.configOverrides, embeddingModel, dimensions });

  let snapshot = await prisma.repoSnapshot.findUnique({
    where: {
      repositoryId_commitSha_configHash: {
        repositoryId,
        commitSha,
        configHash,
      },
    },
  });

  if (!snapshot) {
    try {
      snapshot = await prisma.repoSnapshot.create({
        data: {
          repositoryId,
          branch,
          commitSha,
          configHash,
          embeddingModel,
          dimensions,
          status: 'PENDING',
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        snapshot = await prisma.repoSnapshot.findUnique({
          where: {
            repositoryId_commitSha_configHash: {
              repositoryId,
              commitSha,
              configHash,
            },
          },
        });
      } else {
        throw err;
      }
    }
  }

  if (snapshot.status === 'COMPLETED') {
    return {
      snapshotId: snapshot.id,
      repositoryId,
      status: snapshot.status,
      message: 'Snapshot already fully indexed.',
      alreadyComplete: true,
    };
  }

  // If Gemini primary snapshot previously paused due to quota exhaustion and OpenRouter is available,
  // automatically transition/fallback to an isolated OpenRouter snapshot (1024d) for indexing!
  if (
    snapshot.status === 'PARTIAL' &&
    snapshot.embeddingModel === 'gemini-embedding-001' &&
    /quota/i.test(snapshot.errorMessage || '') &&
    (options.useFallback !== false) &&
    (env.openrouterApiKey || options.embedOptions?.openrouterApiKey)
  ) {
    const fallbackOverrides = {
      ...options.configOverrides,
      provider: 'openrouter',
      embeddingModel: env.openrouterEmbeddingModel,
      dimensions: env.openrouterEmbeddingDimensions || 1024,
    };
    const fallbackCfg = resolveEmbeddingConfig(fallbackOverrides);
    const fbModel = fallbackCfg.model;
    const fbDims = fallbackCfg.dimensions;
    const fbConfigHash = computeConfigHash({ ...fallbackOverrides, embeddingModel: fbModel, dimensions: fbDims });

    let fbSnapshot = await prisma.repoSnapshot.findUnique({
      where: {
        repositoryId_commitSha_configHash: {
          repositoryId,
          commitSha,
          configHash: fbConfigHash,
        },
      },
    });

    if (!fbSnapshot) {
      try {
        fbSnapshot = await prisma.repoSnapshot.create({
          data: {
            repositoryId,
            branch,
            commitSha,
            configHash: fbConfigHash,
            embeddingModel: fbModel,
            dimensions: fbDims,
            status: 'PENDING',
          },
        });
      } catch (e) {
        if (e.code === 'P2002') {
          fbSnapshot = await prisma.repoSnapshot.findUnique({
            where: {
              repositoryId_commitSha_configHash: {
                repositoryId,
                commitSha,
                configHash: fbConfigHash,
              },
            },
          });
        } else {
          throw e;
        }
      }
    }

    if (fbSnapshot && fbSnapshot.status === 'COMPLETED') {
      return {
        snapshotId: fbSnapshot.id,
        repositoryId,
        status: fbSnapshot.status,
        message: 'OpenRouter fallback snapshot already fully indexed.',
        alreadyComplete: true,
      };
    }

    if (fbSnapshot) {
      snapshot = fbSnapshot;
    }
  }

  const workerId = options.workerId || randomUUID();
  const acquired = await acquireLock(snapshot.id, workerId, prisma);
  if (!acquired) {
    throw new AppError(
      'Indexing already in progress for this snapshot.',
      409,
      'INDEXING_IN_PROGRESS'
    );
  }

  // Always use the singleton Prisma client for background work, never an interactive transaction client
  const backgroundPrisma = getPrismaClient();
  const run = () =>
    runIndexingJob({
      snapshotId: snapshot.id,
      repository,
      branch,
      commitSha,
      workerId,
      prisma: backgroundPrisma,
      sync: options.sync,
      fetchFn: options.fetchFn,
      embedOptions: options.embedOptions,
      githubToken: options.githubToken || options.token,
      options,
    });

  if (options.sync) {
    await run();
  } else {
    setImmediate(() => {
      run().catch((err) => {
        console.error(`[indexing] background job failed for snapshot ${snapshot.id}:`, err.message);
      });
    });
  }

  return {
    snapshotId: snapshot.id,
    repositoryId,
    status: 'INDEXING',
    message: 'Indexing started.',
    workerId,
  };
}

/**
 * Return indexing status for the latest (or specified) snapshot of a repository.
 */
export async function getIndexStatus(repositoryId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
  }

  let snapshot;
  if (options.snapshotId) {
    snapshot = await prisma.repoSnapshot.findFirst({
      where: { id: options.snapshotId, repositoryId },
    });
  } else if (options.commitSha) {
    snapshot = await prisma.repoSnapshot.findFirst({
      where: { repositoryId, commitSha: options.commitSha },
      orderBy: { updatedAt: 'desc' },
    });
  } else {
    snapshot = await prisma.repoSnapshot.findFirst({
      where: { repositoryId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  if (!snapshot) {
    return {
      repositoryId,
      status: 'NOT_STARTED',
      readyForChat: false,
      message: 'No indexing snapshot found. Call POST /index first.',
    };
  }

  // Detect abandoned indexing jobs whose lock lease expired without renewal (worker crashed or server restarted)
  if (
    snapshot.status === 'INDEXING' &&
    snapshot.lockExpiresAt &&
    new Date(snapshot.lockExpiresAt) < new Date()
  ) {
    const isPartial = snapshot.indexedFiles > 0 && snapshot.totalChunks > 0;
    const terminalStatus = isPartial ? 'PARTIAL' : 'FAILED';
    const message = isPartial
      ? 'Indexing paused: worker lease expired unexpectedly. Progress preserved.'
      : 'Indexing worker lease expired before completion.';

    try {
      snapshot = await prisma.repoSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: terminalStatus,
          errorMessage: snapshot.errorMessage || message,
          completedAt: new Date(),
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
    } catch {
      // Best-effort update, proceed with existing snapshot state
    }
  }

  const isFullyIndexed = snapshot.status === 'COMPLETED' && snapshot.totalChunks > 0;
  const isPartiallyIndexed = snapshot.status === 'PARTIAL' && snapshot.totalChunks > 0;
  const chatReadiness = isFullyIndexed
    ? 'READY'
    : isPartiallyIndexed
    ? 'PARTIAL'
    : 'NOT_READY';

  return {
    repositoryId,
    snapshotId: snapshot.id,
    branch: snapshot.branch,
    commitSha: snapshot.commitSha,
    status: snapshot.status,
    embeddingModel: snapshot.embeddingModel,
    dimensions: snapshot.dimensions,
    totalFiles: snapshot.totalFiles,
    indexedFiles: snapshot.indexedFiles,
    totalChunks: snapshot.totalChunks,
    cachedChunks: snapshot.cachedChunks,
    newChunks: snapshot.newChunks,
    errorMessage: snapshot.errorMessage,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    lockedBy: snapshot.lockedBy,
    lockExpiresAt: snapshot.lockExpiresAt,
    readyForChat: isFullyIndexed,
    chatReadiness,
  };
}

// ---------------------------------------------------------------------------
// Lock helpers (exported for tests)
// ---------------------------------------------------------------------------

export async function acquireLock(snapshotId, workerId, prisma = getPrismaClient()) {
  const ttlMs = env.indexingLockTtlMs;
  const expiresAt = new Date(Date.now() + ttlMs);

  const rows = await prisma.$queryRaw`
    UPDATE "RepoSnapshot"
    SET
      "lockedBy" = ${workerId},
      "lockExpiresAt" = ${expiresAt},
      status = CASE
        WHEN status = 'COMPLETED'::"IndexingStatus" THEN status
        ELSE 'INDEXING'::"IndexingStatus"
      END,
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW(),
      "errorMessage" = NULL
    WHERE id = ${snapshotId}
      AND status != 'COMPLETED'::"IndexingStatus"
      AND (
        "lockedBy" IS NULL
        OR "lockExpiresAt" IS NULL
        OR "lockExpiresAt" < NOW()
        OR "lockedBy" = ${workerId}
      )
    RETURNING id, "lockedBy", status
  `;

  return rows.length > 0 && rows[0].lockedBy === workerId;
}

export async function renewLock(snapshotId, workerId, prisma = getPrismaClient()) {
  const expiresAt = new Date(Date.now() + env.indexingLockTtlMs);
  const rows = await prisma.$queryRaw`
    UPDATE "RepoSnapshot"
    SET "lockExpiresAt" = ${expiresAt}, "updatedAt" = NOW()
    WHERE id = ${snapshotId}
      AND "lockedBy" = ${workerId}
      AND ("lockExpiresAt" IS NULL OR "lockExpiresAt" >= NOW())
    RETURNING id
  `;
  return rows.length > 0;
}

export async function releaseLock(snapshotId, workerId, prisma = getPrismaClient()) {
  await prisma.$queryRaw`
    UPDATE "RepoSnapshot"
    SET "lockedBy" = NULL, "lockExpiresAt" = NULL, "updatedAt" = NOW()
    WHERE id = ${snapshotId} AND "lockedBy" = ${workerId}
  `;
}

export async function assertLockOwnership(snapshotId, workerId, prisma = getPrismaClient()) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "RepoSnapshot"
    WHERE id = ${snapshotId}
      AND "lockedBy" = ${workerId}
      AND ("lockExpiresAt" IS NULL OR "lockExpiresAt" >= NOW())
  `;
  if (rows.length === 0) {
    throw new AppError('Lost indexing lock ownership.', 409, 'LOCK_LOST');
  }
}

// ---------------------------------------------------------------------------
// Core indexing job
// ---------------------------------------------------------------------------

async function runIndexingJob(params = {}) {
  const {
    snapshotId,
    repository,
    branch,
    commitSha,
    workerId,
    prisma = getPrismaClient(),
    embedOptions,
    fetchFn,
    githubToken,
    options = {},
  } = params;

  activeWorkers.set(snapshotId, { workerId, abortRequested: false });
  const startedAt = Date.now();
  let renewTimer = null;
  let indexedFiles = 0;
  let totalChunks = 0;
  let cachedChunks = 0;
  let newChunks = 0;

  try {
    renewTimer = setInterval(() => {
      renewLock(snapshotId, workerId, prisma).catch((err) => {
        console.error(`[indexing] lock renew failed: ${err.message}`);
      });
    }, env.indexingLockRenewMs);
    if (typeof renewTimer.unref === 'function') renewTimer.unref();

    const effectiveFetchFn = fetchFn || options.fetchFn;
    const effectiveToken = githubToken || options.token || options.githubToken || env.githubToken;
    const gitOptions = {
      commitSha,
      ...(effectiveFetchFn ? { fetchFn: effectiveFetchFn } : {}),
      ...(effectiveToken ? { token: effectiveToken } : {}),
    };

    let tree;
    try {
      tree = await getEligibleFilesFromTree(
        repository.owner,
        repository.name,
        commitSha,
        env,
        gitOptions
      );
    } catch (treeErr) {
      // If GitHub tree request fails (e.g. rate limit), check if any snapshot for this repo and commitSha has FileRecord rows
      const existingRecords = await prisma.fileRecord.findMany({
        where: {
          snapshot: { repositoryId: repository.id, commitSha },
        },
        select: { path: true, language: true, size: true },
        distinct: ['path'],
        orderBy: { path: 'asc' },
      });

      if (existingRecords.length > 0) {
        const priorSnap = await prisma.repoSnapshot.findFirst({
          where: { repositoryId: repository.id, commitSha },
          orderBy: { totalFiles: 'desc' },
          select: { totalFiles: true },
        });
        const totalTreeFiles = Math.max(existingRecords.length, priorSnap?.totalFiles || 0);

        tree = {
          totalTreeFiles,
          eligibleCount: existingRecords.length,
          cappedFiles: existingRecords.map((f) => ({ ...f, sha: null, priority: 1 })),
          totalBytesSelected: existingRecords.reduce((s, f) => s + (f.size || 0), 0),
          isTruncated: false,
        };
      } else {
        throw treeErr;
      }
    }
    const files = tree.cappedFiles;

    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: {
        totalFiles: tree.totalTreeFiles || files.length,
        branch,
        status: 'INDEXING',
      },
    });

    // Snapshot metadata (model, dimensions)
    const snapshotRecord = await prisma.repoSnapshot.findUnique({
      where: { id: snapshotId },
      select: { embeddingModel: true, dimensions: true },
    });
    const snapshotModel = snapshotRecord?.embeddingModel || env.geminiEmbeddingModel;
    const snapshotDimensions = snapshotRecord?.dimensions || env.geminiEmbeddingDimensions;

    const resolvedEmbeddingConfig = resolveEmbeddingConfig({
      embeddingModel: snapshotModel,
      model: snapshotModel,
      dimensions: snapshotDimensions,
      ...(embedOptions || options.embedOptions || {}),
    });

    const isLiquid =
      resolvedEmbeddingConfig.model.toLowerCase().includes('lfm') ||
      resolvedEmbeddingConfig.dimensions === 1024;

    const chunkConfig = {
      chunkTargetTokens: isLiquid ? 300 : env.chunkTargetTokens,
      chunkMaxTokens: isLiquid ? 400 : env.chunkMaxTokens,
      chunkOverlapTokens: isLiquid ? 40 : env.chunkOverlapTokens,
      chunkMinTokens: env.chunkMinTokens,
    };

    // Already-indexed file paths for resume
    const existingFiles = await prisma.fileRecord.findMany({
      where: { snapshotId },
      select: { path: true, contentHash: true },
    });
    const indexedPaths = new Set(existingFiles.map((f) => f.path));

    indexedFiles = existingFiles.length;
    totalChunks = 0;
    cachedChunks = 0;
    newChunks = 0;
    let inputTokensUsed = 0;

    // Count existing snapshot chunks for resume metrics
    const priorChunkAgg = await prisma.snapshotChunk.aggregate({
      where: { snapshotId },
      _count: { id: true },
    });
    totalChunks = priorChunkAgg._count.id || 0;

    const priorSnapshot = await prisma.repoSnapshot.findUnique({ where: { id: snapshotId } });
    cachedChunks = priorSnapshot?.cachedChunks || 0;
    newChunks = priorSnapshot?.newChunks || 0;

    const pendingFiles = files.filter((f) => !indexedPaths.has(f.path));
    const fetched = await fetchFileContentsConcurrently(
      repository.owner,
      repository.name,
      pendingFiles,
      env.githubConcurrency,
      gitOptions
    );
    for (const file of fetched) {
      if (Date.now() - startedAt > env.indexingMaxDurationMs) {
        await finalizeSnapshot(prisma, snapshotId, workerId, {
          status: 'PARTIAL',
          indexedFiles,
          totalChunks,
          cachedChunks,
          newChunks,
          errorMessage: 'Indexing paused: maximum duration reached.',
        });
        return;
      }

      await assertLockOwnership(snapshotId, workerId, prisma);

      if (!file.success || !file.content) {
        continue;
      }

      const fileHash = hashFileContent(file.content);
      const chunks = chunkFile(file.path, file.language, file.content, chunkConfig);

      if (totalChunks + chunks.length > env.indexingMaxChunks) {
        await finalizeSnapshot(prisma, snapshotId, workerId, {
          status: 'PARTIAL',
          indexedFiles,
          totalChunks,
          cachedChunks,
          newChunks,
          errorMessage: 'Indexing paused: maximum chunk limit reached.',
        });
        return;
      }

      const chunkTokenSum = chunks.reduce((s, c) => s + (c.tokenEstimate || 0), 0);
      if (inputTokensUsed + chunkTokenSum > env.indexingMaxInputTokens) {
        await finalizeSnapshot(prisma, snapshotId, workerId, {
          status: 'PARTIAL',
          indexedFiles,
          totalChunks,
          cachedChunks,
          newChunks,
          errorMessage: 'Indexing paused: maximum input token budget reached.',
        });
        return;
      }

      try {
        const result = await embedChunksWithCache(chunks, {
          prisma,
          provider: resolvedEmbeddingConfig.provider,
          model: resolvedEmbeddingConfig.model,
          embeddingModel: resolvedEmbeddingConfig.model,
          dimensions: resolvedEmbeddingConfig.dimensions,
          apiKey: resolvedEmbeddingConfig.apiKey,
          batchSize: resolvedEmbeddingConfig.batchSize,
          ...(embedOptions || options.embedOptions || {}),
        });

        // Link snapshot chunks for both cached and newly embedded
        for (const item of result.all) {
          await prisma.snapshotChunk.upsert({
            where: {
              snapshotId_filePath_chunkIndex: {
                snapshotId,
                filePath: item.filePath,
                chunkIndex: item.chunkIndex,
              },
            },
            create: {
              snapshotId,
              chunkId: item.chunkId,
              filePath: item.filePath,
              startLine: item.startLine,
              endLine: item.endLine,
              chunkIndex: item.chunkIndex,
            },
            update: {
              chunkId: item.chunkId,
              startLine: item.startLine,
              endLine: item.endLine,
            },
          });
        }

        await prisma.fileRecord.upsert({
          where: {
            snapshotId_path: { snapshotId, path: file.path },
          },
          create: {
            snapshotId,
            path: file.path,
            language: file.language,
            size: file.size,
            contentHash: fileHash,
          },
          update: {
            language: file.language,
            size: file.size,
            contentHash: fileHash,
          },
        });

        indexedFiles += 1;
        totalChunks += result.all.length;
        cachedChunks += result.cacheHits;
        newChunks += result.newEmbeddings;
        inputTokensUsed += chunkTokenSum;

        await prisma.repoSnapshot.update({
          where: { id: snapshotId },
          data: {
            indexedFiles,
            totalChunks,
            cachedChunks,
            newChunks,
            updatedAt: new Date(),
          },
        });
      } catch (err) {
        if (err instanceof EmbeddingQuotaExhaustedError) {
          await finalizeSnapshot(prisma, snapshotId, workerId, {
            status: 'PARTIAL',
            indexedFiles,
            totalChunks,
            cachedChunks,
            newChunks,
            errorMessage: err.message,
          });
          return;
        }
        throw err;
      }
    }

    // Remove stale FileRecords / SnapshotChunks for paths no longer in this tree
    // (deleted or filtered-out files must not appear in the active snapshot)
    const activePaths = files.map((f) => f.path);
    await pruneStaleSnapshotFiles(prisma, snapshotId, activePaths);

    // Check if any files could not be fetched due to GitHub rate limits
    const rateLimitedFile = fetched.find((f) => f.rateLimited);
    if (rateLimitedFile) {
      const resetMsg = rateLimitedFile.resetIso
        ? ` Resets at ${rateLimitedFile.resetIso}.`
        : '';
      await finalizeSnapshot(prisma, snapshotId, workerId, {
        status: indexedFiles > 0 ? 'PARTIAL' : 'FAILED',
        indexedFiles,
        totalChunks,
        cachedChunks,
        newChunks,
        errorMessage: `GitHub API rate limit exceeded during file retrieval.${resetMsg}`,
      });
      return;
    }

    // Only mark COMPLETED if all capped files were genuinely indexed
    const isFinished = indexedFiles >= files.length && files.length > 0;
    const finalStatus = isFinished ? 'COMPLETED' : indexedFiles > 0 ? 'PARTIAL' : 'FAILED';
    const finalMsg = isFinished
      ? null
      : `Indexing paused: ${indexedFiles} of ${files.length} files indexed.`;

    await finalizeSnapshot(prisma, snapshotId, workerId, {
      status: finalStatus,
      indexedFiles,
      totalChunks,
      cachedChunks,
      newChunks,
      errorMessage: finalMsg,
    });
  } catch (err) {
    console.error(`[indexing] job error:`, err);
    try {
      const isRateLimit = err.code === 'GITHUB_RATE_LIMITED' || /rate limit/i.test(err.message);
      const isQuota = err instanceof EmbeddingQuotaExhaustedError || /quota/i.test(err.message);
      const targetStatus = (isQuota || (isRateLimit && indexedFiles > 0)) ? 'PARTIAL' : 'FAILED';
      await finalizeSnapshot(prisma, snapshotId, workerId, {
        status: targetStatus,
        indexedFiles,
        totalChunks,
        cachedChunks,
        newChunks,
        errorMessage: err.message || 'Indexing failed.',
      });
    } catch (finalizeErr) {
      console.error(`[indexing] finalize failed:`, finalizeErr.message);
      await releaseLock(snapshotId, workerId, prisma).catch(() => {});
    }
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    activeWorkers.delete(snapshotId);
  }
}

async function pruneStaleSnapshotFiles(prisma, snapshotId, activePaths) {
  if (activePaths.length === 0) {
    await prisma.snapshotChunk.deleteMany({ where: { snapshotId } });
    await prisma.fileRecord.deleteMany({ where: { snapshotId } });
    return;
  }

  await prisma.snapshotChunk.deleteMany({
    where: {
      snapshotId,
      filePath: { notIn: activePaths },
    },
  });

  await prisma.fileRecord.deleteMany({
    where: {
      snapshotId,
      path: { notIn: activePaths },
    },
  });
}

async function finalizeSnapshot(prisma, snapshotId, workerId, fields) {
  // Ownership fence — only the lock holder may finalize
  const owned = await renewLock(snapshotId, workerId, prisma);
  if (!owned) {
    // If worker lost lock lease during error cleanup, ensure lock is released if still assigned
    if (fields.status === 'FAILED') {
      await prisma.repoSnapshot.updateMany({
        where: { id: snapshotId, lockedBy: workerId },
        data: {
          status: 'FAILED',
          errorMessage: fields.errorMessage || 'Indexing failed.',
          completedAt: new Date(),
          lockedBy: null,
          lockExpiresAt: null,
        },
      }).catch(() => {});
    }
    return;
  }

  const updateData = {
    status: fields.status,
    errorMessage: fields.errorMessage ?? null,
    completedAt:
      fields.status === 'COMPLETED' || fields.status === 'PARTIAL' || fields.status === 'FAILED'
        ? new Date()
        : undefined,
    lockedBy: null,
    lockExpiresAt: null,
  };

  if (fields.indexedFiles !== undefined) updateData.indexedFiles = fields.indexedFiles;
  if (fields.totalChunks !== undefined) updateData.totalChunks = fields.totalChunks;
  if (fields.cachedChunks !== undefined) updateData.cachedChunks = fields.cachedChunks;
  if (fields.newChunks !== undefined) updateData.newChunks = fields.newChunks;

  await prisma.repoSnapshot.update({
    where: { id: snapshotId },
    data: updateData,
  });
}

/** Test helpers */
export const _internals = {
  runIndexingJob,
  pruneStaleSnapshotFiles,
  activeWorkers,
  lookupEmbeddingCache,
};
