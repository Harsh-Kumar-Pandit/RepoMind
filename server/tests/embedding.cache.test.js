import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import {
  lookupEmbeddingCache,
  upsertChunkWithEmbedding,
  embedChunksWithCache,
  EmbeddingRateLimiter,
} from '../src/services/embedding.service.js';
import { sha256 } from '../src/services/chunking.service.js';
import { _internals as indexingInternals } from '../src/services/indexing.service.js';

test('Embedding Cache - Hits and Model/Dimension Mismatch', async (t) => {
  const prisma = getPrismaClient();
  await prisma.$connect();

  const content = `cache-test-${randomUUID()}`;
  const contentHash = sha256(content);
  const embedding = Array(768).fill(0.05);
  embedding[0] = 1;

  const row = await upsertChunkWithEmbedding({
    contentHash,
    content,
    embedding,
    embeddingModel: 'gemini-embedding-001',
    dimensions: 768,
    prisma,
  });

  t.after(async () => {
    await prisma.codeChunk.delete({ where: { id: row.id } }).catch(() => {});
    await disconnectDatabase();
  });

  await t.test('cache hit for matching hash/model/dimensions', async () => {
    const map = await lookupEmbeddingCache([contentHash], {
      prisma,
      embeddingModel: 'gemini-embedding-001',
      dimensions: 768,
    });
    assert.equal(map.has(contentHash), true);
    assert.equal(map.get(contentHash).hasEmbedding, true);
  });

  await t.test('cache miss for model mismatch', async () => {
    const map = await lookupEmbeddingCache([contentHash], {
      prisma,
      embeddingModel: 'other-model',
      dimensions: 768,
    });
    assert.equal(map.has(contentHash), false);
  });

  await t.test('cache miss for dimension mismatch', async () => {
    const map = await lookupEmbeddingCache([contentHash], {
      prisma,
      embeddingModel: 'gemini-embedding-001',
      dimensions: 3072,
    });
    assert.equal(map.has(contentHash), false);
  });

  await t.test('embedChunksWithCache reuses cached embeddings (no provider call)', async () => {
    let providerCalls = 0;
    const fetchFn = async () => {
      providerCalls++;
      throw new Error('should not call provider on cache hit');
    };

    const result = await embedChunksWithCache(
      [
        {
          contentHash,
          content,
          filePath: 'src/cached.js',
          startLine: 1,
          endLine: 1,
          chunkIndex: 0,
        },
      ],
      {
        prisma,
        apiKey: 'unused',
        fetchFn,
        limiter: new EmbeddingRateLimiter(30),
      }
    );

    assert.equal(result.cacheHits, 1);
    assert.equal(result.newEmbeddings, 0);
    assert.equal(providerCalls, 0);
    assert.equal(result.cached[0].chunkId, row.id);
  });
});

test('Incremental Indexing - Deleted Files Pruned From Snapshot', async () => {
  const prisma = getPrismaClient();
  await prisma.$connect();

  const repo = await prisma.repository.create({
    data: {
      owner: 'inc',
      name: `del-${randomUUID().slice(0, 6)}`,
      url: `https://github.com/inc/del-${randomUUID()}`,
    },
  });

  const snapshot = await prisma.repoSnapshot.create({
    data: {
      repositoryId: repo.id,
      branch: 'main',
      commitSha: 'c'.repeat(40),
      configHash: 'cfg-' + randomUUID(),
      status: 'INDEXING',
      totalChunks: 2,
    },
  });

  const emb = Array(768).fill(0);
  emb[0] = 1;
  const keepHash = sha256('keep');
  const dropHash = sha256('drop');

  const keepId = (
    await upsertChunkWithEmbedding({
      contentHash: keepHash,
      content: 'keep',
      embedding: emb,
      prisma,
    })
  ).id;
  const dropId = (
    await upsertChunkWithEmbedding({
      contentHash: dropHash,
      content: 'drop',
      embedding: emb,
      prisma,
    })
  ).id;

  await prisma.fileRecord.createMany({
    data: [
      { snapshotId: snapshot.id, path: 'keep.js', language: 'javascript', size: 4, contentHash: keepHash },
      { snapshotId: snapshot.id, path: 'drop.js', language: 'javascript', size: 4, contentHash: dropHash },
    ],
  });

  await prisma.snapshotChunk.createMany({
    data: [
      { snapshotId: snapshot.id, chunkId: keepId, filePath: 'keep.js', startLine: 1, endLine: 1, chunkIndex: 0 },
      { snapshotId: snapshot.id, chunkId: dropId, filePath: 'drop.js', startLine: 1, endLine: 1, chunkIndex: 0 },
    ],
  });

  try {
    await indexingInternals.pruneStaleSnapshotFiles(prisma, snapshot.id, ['keep.js']);

    const files = await prisma.fileRecord.findMany({ where: { snapshotId: snapshot.id } });
    const chunks = await prisma.snapshotChunk.findMany({ where: { snapshotId: snapshot.id } });

    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'keep.js');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].filePath, 'keep.js');

    // Underlying CodeChunk rows remain (shared cache) — only snapshot links are removed
    const dropStillExists = await prisma.codeChunk.findUnique({ where: { id: dropId } });
    assert.ok(dropStillExists);
  } finally {
    await prisma.repository.delete({ where: { id: repo.id } }).catch(() => {});
    await prisma.codeChunk.deleteMany({ where: { id: { in: [keepId, dropId] } } }).catch(() => {});
    await disconnectDatabase();
  }
});
