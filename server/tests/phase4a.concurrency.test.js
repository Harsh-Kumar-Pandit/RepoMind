import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { getPrismaClient } from '../src/config/database.js';
import { createSession } from '../src/services/session.service.js';
import {
  createWorkspace,
  saveWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  deleteWorkspace,
} from '../src/services/workspace.service.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

async function request(port, method, path, body, token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

test('Phase 4A — Optimistic Concurrency Control (OCC) Service Units', async (t) => {
  const prisma = getPrismaClient();

  const user = await prisma.user.upsert({
    where: { githubId: 'occ-service-user' },
    create: { githubId: 'occ-service-user', login: 'occ-service-user' },
    update: {},
  });

  const repo = await prisma.repository.create({
    data: {
      url: `https://github.com/repomind-test/occ-service-repo-${Date.now()}`,
      owner: 'repomind-test',
      name: 'occ-service-repo',
      defaultBranch: 'main',
      members: {
        create: { userId: user.id, role: 'OWNER' },
      },
    },
  });

  const ws = await createWorkspace(user.id, {
    repositoryId: repo.id,
    name: 'occ-workspace',
  }, { prisma });

  let initialHash;

  await t.test('Initial creation succeeds without expectedContentHash and returns hash', async () => {
    const saved = await saveWorkspaceFile(
      user.id,
      ws.id,
      'src/math.js',
      'export function add(a, b) { return a + b; }',
      { prisma }
    );
    assert.equal(saved.path, 'src/math.js');
    assert.equal(saved.contentHash.length, 64);
    initialHash = saved.contentHash;
  });

  await t.test('Update with matching expectedContentHash succeeds and produces new hash', async () => {
    const updated = await saveWorkspaceFile(
      user.id,
      ws.id,
      'src/math.js',
      'export function add(a, b) { return a + b + 0; }',
      { expectedContentHash: initialHash, prisma }
    );
    assert.notEqual(updated.contentHash, initialHash);
    assert.equal(updated.contentHash.length, 64);

    const recheck = await getWorkspaceFile(user.id, ws.id, 'src/math.js', { prisma });
    assert.equal(recheck.contentHash, updated.contentHash);
  });

  await t.test('Update with stale expectedContentHash fails with 409 STALE_FILE_EDIT and preserves file', async () => {
    // Attempt to update with initialHash which is now stale
    await assert.rejects(
      async () => {
        await saveWorkspaceFile(
          user.id,
          ws.id,
          'src/math.js',
          'stale overwrite attempt',
          { expectedContentHash: initialHash, prisma }
        );
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'STALE_FILE_EDIT');
        assert.ok(err.details);
        assert.ok(err.details.currentContentHash);
        assert.notEqual(err.details.currentContentHash, initialHash);
        return true;
      }
    );

    // Verify content was preserved
    const recheck = await getWorkspaceFile(user.id, ws.id, 'src/math.js', { prisma });
    assert.match(recheck.content, /return a \+ b \+ 0;/);
  });

  await t.test('Two simultaneous saves with the same expectedContentHash yield exactly one winner', async () => {
    const currentFile = await getWorkspaceFile(user.id, ws.id, 'src/math.js', { prisma });
    const currentHash = currentFile.contentHash;

    const promise1 = saveWorkspaceFile(
      user.id,
      ws.id,
      'src/math.js',
      'winner 1 content',
      { expectedContentHash: currentHash, prisma }
    ).then(() => ({ success: true, winner: 1 })).catch((err) => ({ success: false, winner: 1, err }));

    const promise2 = saveWorkspaceFile(
      user.id,
      ws.id,
      'src/math.js',
      'winner 2 content',
      { expectedContentHash: currentHash, prisma }
    ).then(() => ({ success: true, winner: 2 })).catch((err) => ({ success: false, winner: 2, err }));

    const [res1, res2] = await Promise.all([promise1, promise2]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    assert.equal(successes.length, 1, 'Exactly one concurrent update must succeed');
    assert.equal(failures.length, 1, 'Exactly one concurrent update must fail with conflict');
    const failedErr = failures[0].err;
    assert.equal(failedErr.statusCode, 409);
    assert.equal(failedErr.code, 'STALE_FILE_EDIT');
  });

  // Clean up
  await prisma.repository.delete({ where: { id: repo.id } });
});

test('Phase 4A — HTTP API Optimistic Concurrency Control', async (t) => {
  const server = http.createServer(app);
  const port = await listen(server);
  const prisma = getPrismaClient();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Create two users: owner and attacker
  const owner = await prisma.user.upsert({
    where: { githubId: 'http-occ-owner' },
    create: { githubId: 'http-occ-owner', login: 'http-occ-owner' },
    update: {},
  });
  const ownerSession = await createSession(owner.id);
  const ownerToken = ownerSession.rawToken;

  const attacker = await prisma.user.upsert({
    where: { githubId: 'http-occ-attacker' },
    create: { githubId: 'http-occ-attacker', login: 'http-occ-attacker' },
    update: {},
  });
  const attackerSession = await createSession(attacker.id);
  const attackerToken = attackerSession.rawToken;

  const repo = await prisma.repository.create({
    data: {
      url: `https://github.com/repomind-test/http-occ-repo-${Date.now()}`,
      owner: 'repomind-test',
      name: 'http-occ-repo',
      defaultBranch: 'main',
      members: {
        create: { userId: owner.id, role: 'OWNER' },
      },
    },
  });

  const ws = await createWorkspace(owner.id, {
    repositoryId: repo.id,
    name: 'http-occ-ws',
  }, { prisma });

  let fileHash;

  await t.test('PUT /files/* creates initial file and returns contentHash in data envelope', async () => {
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      { content: '{"version": 1}\n' },
      ownerToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.data.contentHash);
    fileHash = res.json.data.contentHash;
  });

  await t.test('GET /files/* returns content and contentHash', async () => {
    const res = await request(
      port,
      'GET',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      undefined,
      ownerToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.json.data.contentHash, fileHash);
    assert.equal(res.json.data.content, '{"version": 1}\n');
  });

  await t.test('PUT with valid If-Match header succeeds and updates file', async () => {
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      { content: '{"version": 2}\n' },
      ownerToken,
      { 'If-Match': fileHash }
    );

    assert.equal(res.status, 200);
    assert.notEqual(res.json.data.contentHash, fileHash);
    fileHash = res.json.data.contentHash; // Update reference to revision 2
  });

  await t.test('PUT with stale If-Match header returns 409 STALE_FILE_EDIT with current hash details', async () => {
    const staleHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      { content: '{"version": "stale"}\n' },
      ownerToken,
      { 'If-Match': staleHash }
    );

    assert.equal(res.status, 409);
    assert.equal(res.json.success, false);
    assert.equal(res.json.error.code, 'STALE_FILE_EDIT');
    assert.ok(res.json.error.details);
    assert.equal(res.json.error.details.currentContentHash, fileHash);
  });

  await t.test('PUT with expectedContentHash in JSON body behaves identically to If-Match', async () => {
    const staleHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      {
        content: '{"version": "body-stale"}\n',
        expectedContentHash: staleHash,
      },
      ownerToken
    );

    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'STALE_FILE_EDIT');
    assert.equal(res.json.error.details.currentContentHash, fileHash);
  });

  await t.test('Unauthorized user cannot trigger conflict responses or obtain current contentHash (403 IDOR blocked)', async () => {
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${ws.id}/files/src/config.json`,
      {
        content: 'attacker overwrite',
        expectedContentHash: 'any',
      },
      attackerToken
    );

    assert.equal(res.status, 403);
    assert.equal(res.json.success, false);
    // Attacker does NOT receive STALE_FILE_EDIT or currentContentHash
    assert.notEqual(res.json.error.code, 'STALE_FILE_EDIT');
    assert.equal(res.json.error.details, undefined);
  });

  // Clean up
  await prisma.repository.delete({ where: { id: repo.id } });
});
