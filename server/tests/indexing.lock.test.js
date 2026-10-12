import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import {
  acquireLock,
  renewLock,
  releaseLock,
  assertLockOwnership,
  computeConfigHash,
  getIndexStatus,
} from '../src/services/indexing.service.js';

async function createFixture(prisma) {
  const repo = await prisma.repository.create({
    data: {
      owner: 'test-owner',
      name: `lock-test-${randomUUID().slice(0, 8)}`,
      url: `https://github.com/test-owner/lock-test-${randomUUID()}`,
      defaultBranch: 'main',
    },
  });

  const snapshot = await prisma.repoSnapshot.create({
    data: {
      repositoryId: repo.id,
      branch: 'main',
      commitSha: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8),
      configHash: computeConfigHash(),
      status: 'PENDING',
    },
  });

  return { repo, snapshot };
}

async function cleanup(prisma, repoId) {
  await prisma.repository.delete({ where: { id: repoId } }).catch(() => {});
}

test('Indexing Locks - Acquire, Heartbeat, Expiry, Ownership Fence', async (t) => {
  const prisma = getPrismaClient();
  await prisma.$connect();

  const { repo, snapshot } = await createFixture(prisma);
  const workerA = `worker-a-${randomUUID()}`;
  const workerB = `worker-b-${randomUUID()}`;

  t.after(async () => {
    await cleanup(prisma, repo.id);
    await disconnectDatabase();
  });

  await t.test('acquires lock for first worker', async () => {
    const ok = await acquireLock(snapshot.id, workerA, prisma);
    assert.equal(ok, true);
    const row = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.equal(row.lockedBy, workerA);
    assert.equal(row.status, 'INDEXING');
    assert.ok(row.lockExpiresAt > new Date());
  });

  await t.test('rejects concurrent lock for second worker', async () => {
    const ok = await acquireLock(snapshot.id, workerB, prisma);
    assert.equal(ok, false);
  });

  await t.test('renews lock heartbeat for owner', async () => {
    const before = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    await new Promise((r) => setTimeout(r, 20));
    const ok = await renewLock(snapshot.id, workerA, prisma);
    assert.equal(ok, true);
    const after = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.ok(after.lockExpiresAt >= before.lockExpiresAt);
  });

  await t.test('ownership fence rejects non-owner', async () => {
    await assert.rejects(() => assertLockOwnership(snapshot.id, workerB, prisma), /Lost indexing lock/i);
    await assertLockOwnership(snapshot.id, workerA, prisma);
  });

  await t.test('expired lease can be acquired by another worker', async () => {
    // Force expiry
    await prisma.repoSnapshot.update({
      where: { id: snapshot.id },
      data: { lockExpiresAt: new Date(Date.now() - 1000) },
    });

    const ok = await acquireLock(snapshot.id, workerB, prisma);
    assert.equal(ok, true);
    const row = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.equal(row.lockedBy, workerB);
  });

  await t.test('release clears lock fields', async () => {
    await releaseLock(snapshot.id, workerB, prisma);
    const row = await prisma.repoSnapshot.findUnique({ where: { id: snapshot.id } });
    assert.equal(row.lockedBy, null);
    assert.equal(row.lockExpiresAt, null);
  });
});

test('Indexing - computeConfigHash is stable', () => {
  const a = computeConfigHash();
  const b = computeConfigHash();
  assert.equal(a, b);
  assert.equal(a.length, 64);
  const c = computeConfigHash({ maxFiles: 10 });
  assert.notEqual(a, c);
});

test('Indexing - getIndexStatus auto-recovers abandoned lease and marks terminal state', async () => {
  const prisma = getPrismaClient();
  const repo = await prisma.repository.create({
    data: {
      owner: 'test-recovery',
      name: `recovery-test-${randomUUID().slice(0, 8)}`,
      url: `https://github.com/test-recovery/recovery-test-${randomUUID()}`,
      defaultBranch: 'main',
    },
  });

  try {
    // 1. Snapshot with zero progress whose lock lease expired
    const zeroProgressSnapshot = await prisma.repoSnapshot.create({
      data: {
        repositoryId: repo.id,
        branch: 'main',
        commitSha: '1111111111111111111111111111111111111111',
        configHash: computeConfigHash(),
        status: 'INDEXING',
        lockedBy: 'abandoned-worker-1',
        lockExpiresAt: new Date(Date.now() - 5000), // expired
        indexedFiles: 0,
        totalChunks: 0,
      },
    });

    const statusZero = await getIndexStatus(repo.id, { snapshotId: zeroProgressSnapshot.id, prisma });
    assert.equal(statusZero.status, 'FAILED');
    assert.equal(statusZero.lockedBy, null);
    assert.equal(statusZero.lockExpiresAt, null);
    assert.ok(statusZero.errorMessage.includes('expired'));

    // 2. Snapshot with partial progress (e.g. 5/22 files) whose lock lease expired
    const partialSnapshot = await prisma.repoSnapshot.create({
      data: {
        repositoryId: repo.id,
        branch: 'main',
        commitSha: '2222222222222222222222222222222222222222',
        configHash: computeConfigHash({ maxFiles: 20 }),
        status: 'INDEXING',
        lockedBy: 'abandoned-worker-2',
        lockExpiresAt: new Date(Date.now() - 5000), // expired
        indexedFiles: 5,
        totalFiles: 22,
        totalChunks: 15,
      },
    });

    const statusPartial = await getIndexStatus(repo.id, { snapshotId: partialSnapshot.id, prisma });
    assert.equal(statusPartial.status, 'PARTIAL');
    assert.equal(statusPartial.readyForChat, false);
    assert.equal(statusPartial.chatReadiness, 'PARTIAL');
    assert.equal(statusPartial.lockedBy, null);
    assert.equal(statusPartial.lockExpiresAt, null);
    assert.ok(statusPartial.errorMessage.includes('Progress preserved'));
  } finally {
    await prisma.repoSnapshot.deleteMany({ where: { repositoryId: repo.id } });
    await prisma.repository.delete({ where: { id: repo.id } });
    await disconnectDatabase();
  }
});
