import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import { retrieveByEmbedding, resolveChatSnapshot, _internals } from '../src/services/retrieval.service.js';
import { AppError } from '../src/utils/errors.js';
import { computeConfigHash } from '../src/services/indexing.service.js';

function unitVector(seed = 1) {
  const v = Array(768).fill(0);
  v[0] = seed;
  v[1] = 0.1;
  return v;
}

async function insertChunk(prisma, { contentHash, content, embedding, model = 'gemini-embedding-001' }) {
  const id = randomUUID();
  const literal = `[${embedding.join(',')}]`;
  await prisma.$queryRawUnsafe(
    `INSERT INTO "CodeChunk" (id, "contentHash", content, "embeddingModel", dimensions, embedding, "createdAt")
     VALUES ($1, $2, $3, $4, 768, $5::vector, NOW())`,
    id,
    contentHash,
    content,
    model,
    literal
  );
  return id;
}

test('Retrieval Service - Snapshot Isolation', async (t) => {
  const prisma = getPrismaClient();
  await prisma.$connect();

  const repoA = await prisma.repository.create({
    data: {
      owner: 'iso',
      name: `a-${randomUUID().slice(0, 6)}`,
      url: `https://github.com/iso/a-${randomUUID()}`,
    },
  });
  const repoB = await prisma.repository.create({
    data: {
      owner: 'iso',
      name: `b-${randomUUID().slice(0, 6)}`,
      url: `https://github.com/iso/b-${randomUUID()}`,
    },
  });

  const configHash = computeConfigHash();
  const snapA = await prisma.repoSnapshot.create({
    data: {
      repositoryId: repoA.id,
      branch: 'main',
      commitSha: 'a'.repeat(40),
      configHash,
      status: 'COMPLETED',
      totalChunks: 1,
      embeddingModel: 'gemini-embedding-001',
      dimensions: 768,
    },
  });
  const snapB = await prisma.repoSnapshot.create({
    data: {
      repositoryId: repoB.id,
      branch: 'main',
      commitSha: 'b'.repeat(40),
      configHash,
      status: 'COMPLETED',
      totalChunks: 1,
      embeddingModel: 'gemini-embedding-001',
      dimensions: 768,
    },
  });

  const embA = unitVector(1);
  const embB = unitVector(5);
  const chunkA = await insertChunk(prisma, {
    contentHash: `hash-a-${randomUUID()}`,
    content: 'function fromRepoA() { return 1; }',
    embedding: embA,
  });
  const chunkB = await insertChunk(prisma, {
    contentHash: `hash-b-${randomUUID()}`,
    content: 'function fromRepoB() { return 2; }',
    embedding: embB,
  });

  await prisma.snapshotChunk.create({
    data: {
      snapshotId: snapA.id,
      chunkId: chunkA,
      filePath: 'src/a.js',
      startLine: 1,
      endLine: 3,
      chunkIndex: 0,
    },
  });
  await prisma.snapshotChunk.create({
    data: {
      snapshotId: snapB.id,
      chunkId: chunkB,
      filePath: 'src/b.js',
      startLine: 1,
      endLine: 3,
      chunkIndex: 0,
    },
  });

  t.after(async () => {
    await prisma.repository.delete({ where: { id: repoA.id } }).catch(() => {});
    await prisma.repository.delete({ where: { id: repoB.id } }).catch(() => {});
    await prisma.codeChunk.deleteMany({ where: { id: { in: [chunkA, chunkB] } } }).catch(() => {});
    await disconnectDatabase();
  });

  await t.test('retrieves only chunks from the requested snapshot', async () => {
    const results = await retrieveByEmbedding(snapA.id, embA, {
      prisma,
      topK: 5,
    });
    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.filePath === 'src/a.js'));
    assert.ok(!results.some((r) => r.content.includes('fromRepoB')));
  });

  await t.test('rejects dimension-mismatched query vectors', async () => {
    await assert.rejects(
      () => retrieveByEmbedding(snapA.id, [1, 2, 3], { prisma }),
      /768 dimensions/
    );
  });

  await t.test('supports 1024-dimensional snapshots and isolates from 768d', async () => {
    const snap1024 = await prisma.repoSnapshot.create({
      data: {
        repositoryId: repoA.id,
        branch: 'feat/liquid',
        commitSha: 'c'.repeat(40),
        configHash: 'hash1024-' + randomUUID(),
        status: 'COMPLETED',
        totalChunks: 1,
        embeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
        dimensions: 1024,
      },
    });

    const vec1024 = Array(1024).fill(0.01);
    const literal1024 = `[${vec1024.join(',')}]`;
    const chunk1024Id = randomUUID();
    await prisma.$queryRawUnsafe(
      `INSERT INTO "CodeChunk" (id, "contentHash", content, "embeddingModel", dimensions, embedding, "createdAt")
       VALUES ($1, $2, $3, $4, 1024, $5::vector, NOW())`,
      chunk1024Id,
      'hash-1024-' + randomUUID(),
      'function liquidRepo() { return "1024d"; }',
      'liquid/lfm-2.5-embedding-350m:free',
      literal1024
    );

    await prisma.snapshotChunk.create({
      data: {
        snapshotId: snap1024.id,
        chunkId: chunk1024Id,
        filePath: 'src/liquid.js',
        startLine: 1,
        endLine: 3,
        chunkIndex: 0,
      },
    });

    try {
      // 768d vector sent to 1024d snapshot must be rejected
      await assert.rejects(
        () => retrieveByEmbedding(snap1024.id, embA, { prisma, dimensions: 1024 }),
        /1024 dimensions/
      );

      // 1024d query to 1024d snapshot retrieves liquid chunk
      const res = await retrieveByEmbedding(snap1024.id, vec1024, {
        prisma,
        embeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
        dimensions: 1024,
        topK: 5,
      });
      assert.equal(res.length, 1);
      assert.equal(res[0].filePath, 'src/liquid.js');
      assert.equal(res[0].dimensions, 1024);
    } finally {
      await prisma.repoSnapshot.delete({ where: { id: snap1024.id } }).catch(() => {});
      await prisma.codeChunk.delete({ where: { id: chunk1024Id } }).catch(() => {});
    }
  });

  await t.test('resolveChatSnapshot prefers COMPLETED snapshots', async () => {
    const resolved = await resolveChatSnapshot(repoA.id, { prisma });
    assert.equal(resolved.id, snapA.id);
  });

  await t.test('resolveChatSnapshot errors when no index is ready', async () => {
    const emptyRepo = await prisma.repository.create({
      data: {
        owner: 'iso',
        name: `empty-${randomUUID().slice(0, 6)}`,
        url: `https://github.com/iso/empty-${randomUUID()}`,
      },
    });
    try {
      await assert.rejects(
        () => resolveChatSnapshot(emptyRepo.id, { prisma }),
        (err) => err instanceof AppError && err.code === 'INDEX_NOT_READY'
      );
    } finally {
      await prisma.repository.delete({ where: { id: emptyRepo.id } });
    }
  });
});

test('Retrieval Service - topK clamp', () => {
  assert.equal(_internals.clampTopK(6), 6);
  assert.equal(_internals.clampTopK(1), 5);
  assert.equal(_internals.clampTopK(99), 8);
});
