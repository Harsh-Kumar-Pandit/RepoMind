import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import {
  startIndexing,
  getIndexStatus,
  computeConfigHash,
  acquireLock,
  _internals,
} from '../src/services/indexing.service.js';
import { chatAboutRepository } from '../src/services/chat.service.js';

const { runIndexingJob } = _internals;

function createMockGitHubFetch(files = [{ path: 'src/app.js', content: 'console.log("hello world");' }]) {
  return async (url) => {
    if (url.includes('/git/trees/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          tree: files.map((f, i) => ({
            type: 'blob',
            path: f.path,
            sha: `sha_${i}_${'a'.repeat(34)}`,
            size: f.content.length,
          })),
          truncated: false,
        }),
      };
    }
    if (url.includes('/git/blobs/')) {
      const match = url.match(/blobs\/sha_(\d+)_/);
      const idx = match ? Number(match[1]) : 0;
      const file = files[idx] || files[0];
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: Buffer.from(file.content).toString('base64'),
          encoding: 'base64',
          size: file.content.length,
        }),
      };
    }
    if (url.includes('/commits/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ sha: '1111222233334444555566667777888899990000' }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
    };
  };
}

function createMockGeminiEmbedFetch(dims = 768) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      embeddings: [
        { values: Array.from({ length: dims }, (_, i) => 0.001 * (i + 1)) },
      ],
    }),
  });
}

function createMockOpenRouterEmbedFetch(dims = 1024) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      data: [
        { index: 0, embedding: Array.from({ length: dims }, (_, i) => 0.002 * (i + 1)) },
      ],
    }),
  });
}

test('Indexing Service - Regression & Multi-Provider Failover Suite', async (t) => {
  const prisma = getPrismaClient();
  await prisma.$connect();

  const createdRepoIds = [];

  t.after(async () => {
    for (const id of createdRepoIds) {
      await prisma.repository.delete({ where: { id } }).catch(() => {});
    }
    await disconnectDatabase();
  });

  async function createRepoFixture() {
    const repo = await prisma.repository.create({
      data: {
        owner: 'test-org',
        name: `test-repo-${randomUUID().slice(0, 8)}`,
        url: `https://github.com/test-org/test-repo-${randomUUID()}`,
        defaultBranch: 'main',
      },
    });
    createdRepoIds.push(repo.id);
    return repo;
  }

  await t.test('1. Regression: runIndexingJob without options property does not throw ReferenceError', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const configHash = computeConfigHash();

    const snapshot = await prisma.repoSnapshot.create({
      data: {
        repositoryId: repo.id,
        branch: 'main',
        commitSha,
        configHash,
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
        status: 'PENDING',
      },
    });

    const mockGitFetch = createMockGitHubFetch([
      { path: 'src/main.js', content: 'export const main = 42;' },
    ]);
    const mockEmbedFetch = createMockGeminiEmbedFetch(768);

    const workerId = `worker-${randomUUID()}`;
    await acquireLock(snapshot.id, workerId, prisma);

    // Call runIndexingJob directly WITHOUT passing an options parameter
    await runIndexingJob({
      snapshotId: snapshot.id,
      repository: repo,
      branch: 'main',
      commitSha,
      workerId,
      prisma,
      fetchFn: mockGitFetch,
      embedOptions: {
        apiKey: 'fake-gemini-key',
        fetchFn: mockEmbedFetch,
        maxRetries: 0,
      },
    });

    const updated = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.errorMessage, null);
    assert.equal(updated.indexedFiles, 1);
    assert.ok(updated.totalChunks >= 1);
  });

  await t.test('2. Indexing with Gemini provider produces 768-d CodeChunks and COMPLETED snapshot', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mockGitFetch = createMockGitHubFetch([
      { path: 'src/gemini.js', content: 'function gemini() { return true; }' },
    ]);
    const mockEmbedFetch = createMockGeminiEmbedFetch(768);

    const result = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: mockGitFetch,
      embedOptions: {
        apiKey: 'fake-gemini-key',
        fetchFn: mockEmbedFetch,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    assert.ok(result.snapshotId);
    const snapshot = await prisma.repoSnapshot.findUnique({ where: { id: result.snapshotId } });
    assert.equal(snapshot.status, 'COMPLETED');
    assert.equal(snapshot.embeddingModel, 'gemini-embedding-001');
    assert.equal(snapshot.dimensions, 768);
    assert.equal(snapshot.indexedFiles, 1);
    assert.ok(snapshot.totalChunks >= 1);

    // Verify chunk in DB
    const chunkRow = await prisma.codeChunk.findFirst({
      where: { embeddingModel: 'gemini-embedding-001', dimensions: 768 },
    });
    assert.ok(chunkRow);
  });

  await t.test('3. Indexing with OpenRouter provider produces 1024-d CodeChunks and COMPLETED snapshot', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const mockGitFetch = createMockGitHubFetch([
      { path: 'src/openrouter.js', content: 'function liquidAi() { return 1024; }' },
    ]);
    const mockEmbedFetch = createMockOpenRouterEmbedFetch(1024);

    const result = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: mockGitFetch,
      embedOptions: {
        apiKey: 'fake-openrouter-key',
        fetchFn: mockEmbedFetch,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'openrouter',
        embeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
        dimensions: 1024,
      },
    });

    assert.ok(result.snapshotId);
    const snapshot = await prisma.repoSnapshot.findUnique({ where: { id: result.snapshotId } });
    assert.equal(snapshot.status, 'COMPLETED');
    assert.equal(snapshot.embeddingModel, 'liquid/lfm-2.5-embedding-350m:free');
    assert.equal(snapshot.dimensions, 1024);
    assert.equal(snapshot.indexedFiles, 1);
    assert.ok(snapshot.totalChunks >= 1);

    // Verify chunk isolation: 1024d chunk exists separately from 768d
    const chunkRow = await prisma.codeChunk.findFirst({
      where: { embeddingModel: 'liquid/lfm-2.5-embedding-350m:free', dimensions: 1024 },
    });
    assert.ok(chunkRow);
    assert.equal(chunkRow.dimensions, 1024);
  });

  await t.test('4. Gemini quota exhaustion triggers automated OpenRouter fallback on next run', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const runId4 = Math.random().toString(36).substring(2, 8);
    const mockGitFetch = createMockGitHubFetch([
      { path: 'src/ok.js', content: `export const ok_${runId4} = 1;` },
      { path: 'src/failover.js', content: `function failover_${runId4}() { return "quota"; }` },
    ]);

    // Step A: Gemini embeds file 1 successfully, then throws quota on file 2
    let geminiCalls = 0;
    const quotaExhaustedFetch = async () => {
      geminiCalls++;
      if (geminiCalls === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            embeddings: [{ values: Array.from({ length: 768 }, (_, i) => 0.001 * (i + 1)) }],
          }),
        };
      }
      return {
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'Resource has been exhausted (check quota or billing)',
      };
    };

    await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: mockGitFetch,
      embedOptions: {
        apiKey: 'fake-gemini-key',
        fetchFn: quotaExhaustedFetch,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    // Verify Gemini snapshot is marked PARTIAL with quota error and NOT readyForChat
    const geminiSnapshot = await prisma.repoSnapshot.findFirst({
      where: { repositoryId: repo.id, embeddingModel: 'gemini-embedding-001' },
    });
    assert.ok(geminiSnapshot);
    assert.equal(geminiSnapshot.status, 'PARTIAL');
    assert.match(geminiSnapshot.errorMessage, /quota/i);

    // Verify readiness status is PARTIAL and NOT falsely claiming full readyForChat
    const geminiStatus = await getIndexStatus(repo.id, { snapshotId: geminiSnapshot.id });
    assert.equal(geminiStatus.status, 'PARTIAL');
    assert.equal(geminiStatus.readyForChat, false);
    assert.equal(geminiStatus.chatReadiness, 'PARTIAL');

    // Step B: Next run with OpenRouter available triggers automated transition to OpenRouter snapshot
    const mockOrEmbedFetch = createMockOpenRouterEmbedFetch(1024);
    const fallbackResult = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: mockGitFetch,
      embedOptions: {
        openrouterApiKey: 'test-or-key',
        fetchFn: mockOrEmbedFetch,
        maxRetries: 0,
      },
    });

    assert.ok(fallbackResult.snapshotId);
    assert.notEqual(fallbackResult.snapshotId, geminiSnapshot.id);

    const orSnapshot = await prisma.repoSnapshot.findUnique({ where: { id: fallbackResult.snapshotId } });
    assert.equal(orSnapshot.status, 'COMPLETED');
    assert.equal(orSnapshot.embeddingModel, 'liquid/lfm-2.5-embedding-350m:free');
    assert.equal(orSnapshot.dimensions, 1024);
    assert.equal(orSnapshot.indexedFiles, 2);

    const orStatus = await getIndexStatus(repo.id, { snapshotId: orSnapshot.id });
    assert.equal(orStatus.status, 'COMPLETED');
    assert.equal(orStatus.readyForChat, true);
    assert.equal(orStatus.chatReadiness, 'READY');

    // Verify Gemini snapshot is STILL PARTIAL and preserved (never overwritten or corrupted)
    const preservedGemini = await prisma.repoSnapshot.findUnique({ where: { id: geminiSnapshot.id } });
    assert.equal(preservedGemini.status, 'PARTIAL');
    assert.equal(preservedGemini.dimensions, 768);

    // Step C: Verify RAG chat query against OpenRouter snapshot retrieves 1024-d chunks with citations
    const fakeLlmFetch = async (url) => {
      if (url.includes('generateContent') || url.includes('/chat/completions')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Failover is configured in `src/failover.js` [src/failover.js#L1-L1].' }],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };

    const chatRes = await chatAboutRepository({
      repositoryId: repo.id,
      question: 'Where is failover handled?',
      options: {
        embedOptions: {
          openrouterApiKey: 'test-or-key',
          fetchFn: mockOrEmbedFetch,
        },
        fetchFn: fakeLlmFetch,
      },
    });

    assert.ok(chatRes.answer);
    assert.equal(chatRes.snapshotId, orSnapshot.id);
    assert.ok(Array.isArray(chatRes.citations));
  });

  await t.test('5. GitHub API failures do NOT trigger embedding-provider failover', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    // Mock GitHub failing with 429 rate limit
    const failingGitFetch = async (url) => {
      if (url.includes('/git/trees/')) {
        return {
          ok: false,
          status: 403,
          headers: new Headers({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1893456000',
          }),
          text: async () => 'API rate limit exceeded',
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };

    await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: failingGitFetch,
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    // Verify snapshot is terminal FAILED with GitHub error
    const snapshot = await prisma.repoSnapshot.findFirst({
      where: { repositoryId: repo.id, embeddingModel: 'gemini-embedding-001' },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.status, 'FAILED');
    assert.match(snapshot.errorMessage, /rate limit/i);

    // Trigger startIndexing again - it must NOT failover to OpenRouter
    const mockGitFetch = createMockGitHubFetch([{ path: 'src/test.js', content: 'test' }]);
    const mockGeminiEmbed = createMockGeminiEmbedFetch(768);

    const retryResult = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: mockGitFetch,
      embedOptions: {
        apiKey: 'fake-key',
        fetchFn: mockGeminiEmbed,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    // The retried snapshot is STILL the Gemini snapshot
    const retriedSnapshot = await prisma.repoSnapshot.findUnique({ where: { id: retryResult.snapshotId } });
    assert.equal(retriedSnapshot.embeddingModel, 'gemini-embedding-001');
    assert.equal(retriedSnapshot.dimensions, 768);
    assert.equal(retriedSnapshot.status, 'COMPLETED');
  });

  await t.test('6. Verifies clean pause on file rate limit, safe resume without vector duplication, and metrics', async () => {
    const repo = await createRepoFixture();
    const commitSha = 'ffffffffffffffffffffffffffffffffffffffff';
    const runId6 = Math.random().toString(36).substring(2, 8);
    const files = [
      { path: 'src/part1.js', content: `export const part1_${runId6} = 1;` },
      { path: 'src/part2.js', content: `export const part2_${runId6} = 2;` },
    ];

    // Stage 1: GitHub allows part1.js, but rate-limits part2.js
    const partialGitFetch = async (url) => {
      if (url.includes('/git/trees/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            tree: files.map((f, i) => ({
              type: 'blob',
              path: f.path,
              sha: `sha_${i}_${'b'.repeat(34)}`,
              size: f.content.length,
            })),
            truncated: false,
          }),
        };
      }
      if (url.includes('sha_0_')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            content: Buffer.from(files[0].content).toString('base64'),
            encoding: 'base64',
            size: files[0].content.length,
          }),
        };
      }
      if (url.includes('sha_1_') || url.includes('part2.js')) {
        return {
          ok: false,
          status: 403,
          headers: new Headers({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1893456000',
          }),
          text: async () => 'Rate limit exceeded for blob',
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };

    const mockEmbedFetch = createMockGeminiEmbedFetch(768);

    const stage1Result = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: partialGitFetch,
      embedOptions: {
        apiKey: 'fake-key',
        fetchFn: mockEmbedFetch,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    const stage1Status = await getIndexStatus(repo.id, { snapshotId: stage1Result.snapshotId });
    assert.equal(stage1Status.status, 'PARTIAL');
    assert.equal(stage1Status.indexedFiles, 1);
    assert.equal(stage1Status.totalFiles, 2);
    assert.equal(stage1Status.readyForChat, false);
    assert.equal(stage1Status.chatReadiness, 'PARTIAL');
    assert.match(stage1Status.errorMessage, /rate limit/i);

    const chunkCountBefore = await prisma.codeChunk.count({
      where: { embeddingModel: 'gemini-embedding-001' },
    });

    // Stage 2: Rate limit resets, all files can be fetched. Resume indexing!
    const fullGitFetch = createMockGitHubFetch(files);

    const stage2Result = await startIndexing(repo.id, {
      branch: 'main',
      commitSha,
      sync: true,
      fetchFn: fullGitFetch,
      embedOptions: {
        apiKey: 'fake-key',
        fetchFn: mockEmbedFetch,
        maxRetries: 0,
      },
      configOverrides: {
        provider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        dimensions: 768,
      },
    });

    const stage2Status = await getIndexStatus(repo.id, { snapshotId: stage2Result.snapshotId });
    assert.equal(stage2Status.status, 'COMPLETED');
    assert.equal(stage2Status.indexedFiles, 2);
    assert.equal(stage2Status.totalFiles, 2);
    assert.equal(stage2Status.readyForChat, true);
    assert.equal(stage2Status.chatReadiness, 'READY');
    assert.equal(stage2Status.errorMessage, null);

    // Verify part1.js was cached and not duplicated
    const chunkCountAfter = await prisma.codeChunk.count({
      where: { embeddingModel: 'gemini-embedding-001' },
    });
    // Exactly 1 new chunk was created for part2.js; part1.js was reused without duplicate
    assert.equal(chunkCountAfter, chunkCountBefore + 1);
  });
});
