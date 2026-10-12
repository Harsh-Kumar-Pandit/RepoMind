import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { embedTexts } from './embedding.service.js';

/**
 * Retrieve the top-K most relevant chunks for a query embedding,
 * strictly isolated to a single repository snapshot + compatible model/dimensions.
 */
export async function retrieveByEmbedding(snapshotId, queryEmbedding, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const topK = clampTopK(options.topK ?? env.retrievalTopK);
  const embeddingModel = options.embeddingModel || env.geminiEmbeddingModel;
  const dimensions = options.dimensions || env.geminiEmbeddingDimensions;

  if (!snapshotId) {
    throw new AppError('snapshotId is required for retrieval.', 400, 'MISSING_SNAPSHOT');
  }

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== dimensions) {
    throw new AppError(
      `Query embedding must have ${dimensions} dimensions.`,
      400,
      'EMBEDDING_DIMENSION_MISMATCH'
    );
  }

  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  // Parameterized cosine-distance query; filters enforce snapshot + model isolation.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       sc.id AS "snapshotChunkId",
       sc."filePath" AS "filePath",
       sc."startLine" AS "startLine",
       sc."endLine" AS "endLine",
       sc."chunkIndex" AS "chunkIndex",
       cc.id AS "chunkId",
       cc.content AS content,
       cc."contentHash" AS "contentHash",
       cc."embeddingModel" AS "embeddingModel",
       cc.dimensions AS dimensions,
       (cc.embedding <=> $1::vector) AS distance
     FROM "SnapshotChunk" sc
     INNER JOIN "CodeChunk" cc ON cc.id = sc."chunkId"
     INNER JOIN "RepoSnapshot" rs ON rs.id = sc."snapshotId"
     WHERE sc."snapshotId" = $2
       AND rs.id = $2
       AND cc."embeddingModel" = $3
       AND cc.dimensions = $4
       AND cc.embedding IS NOT NULL
     ORDER BY cc.embedding <=> $1::vector ASC
     LIMIT $5`,
    vectorLiteral,
    snapshotId,
    embeddingModel,
    dimensions,
    topK
  );

  return rows.map((row) => ({
    snapshotChunkId: row.snapshotChunkId,
    chunkId: row.chunkId,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    chunkIndex: row.chunkIndex,
    content: row.content,
    contentHash: row.contentHash,
    embeddingModel: row.embeddingModel,
    dimensions: row.dimensions,
    distance: typeof row.distance === 'number' ? row.distance : Number(row.distance),
    score: 1 / (1 + Number(row.distance || 0)),
  }));
}

/**
 * Embed a natural-language question and retrieve grounded context chunks.
 */
export async function retrieveForQuestion(snapshotId, question, options = {}) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new AppError('A non-empty question is required.', 400, 'INVALID_QUESTION');
  }

  const embedOpts = {
    embeddingModel: options.embeddingModel,
    dimensions: options.dimensions,
    model: options.embeddingModel,
    ...(options.embedOptions || options),
  };

  const vectors = await embedTexts([question.trim()], embedOpts);
  const queryEmbedding = vectors[0];
  return retrieveByEmbedding(snapshotId, queryEmbedding, options);
}

/**
 * Resolve the best chat-ready snapshot for a repository.
 */
export async function resolveChatSnapshot(repositoryId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  const baseWhere = {
    repositoryId,
    totalChunks: { gt: 0 },
  };

  if (options.dimensions) baseWhere.dimensions = options.dimensions;
  if (options.embeddingModel) baseWhere.embeddingModel = options.embeddingModel;
  if (options.commitSha) baseWhere.commitSha = options.commitSha;
  if (options.snapshotId) baseWhere.id = options.snapshotId;

  // Prefer a fully completed snapshot when available
  const completed = await prisma.repoSnapshot.findFirst({
    where: { ...baseWhere, status: 'COMPLETED' },
    orderBy: { updatedAt: 'desc' },
  });
  if (completed) return completed;

  const partial = await prisma.repoSnapshot.findFirst({
    where: { ...baseWhere, status: 'PARTIAL' },
    orderBy: { updatedAt: 'desc' },
  });
  if (partial) return partial;

  throw new AppError(
    'No indexed snapshot is ready for chat. Index the repository first.',
    409,
    'INDEX_NOT_READY'
  );
}

function clampTopK(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 6;
  // Configurable top-K within the Phase 2 range of 5–8.
  return Math.min(8, Math.max(5, Math.round(n)));
}

export const _internals = { clampTopK };
