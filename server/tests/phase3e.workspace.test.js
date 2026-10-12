import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { getPrismaClient } from '../src/config/database.js';
import { createSession } from '../src/services/session.service.js';
import {
  validateWorkspaceName,
  validateBaseCommitSha,
  validateWorkspaceFilePath,
  validateFileContent,
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  listWorkspaceFiles,
  getWorkspaceFile,
  saveWorkspaceFile,
  deleteWorkspaceFile,
} from '../src/services/workspace.service.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

async function request(port, method, path, body, token) {
  const headers = {};
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

test('Phase 3E — Workspace Validation and Helpers Unit Tests', async (t) => {
  await t.test('validateWorkspaceName accepts valid names and rejects invalid/empty', () => {
    assert.equal(validateWorkspaceName('my-feature'), 'my-feature');
    assert.equal(validateWorkspaceName('Workspace_1 2'), 'Workspace_1 2');
    assert.throws(() => validateWorkspaceName(''), /Workspace name is required/i);
    assert.throws(() => validateWorkspaceName('   '), /Workspace name is required/i);
    assert.throws(() => validateWorkspaceName('a'.repeat(65)), /must be between 1 and 64/i);
    assert.throws(() => validateWorkspaceName('invalid/name'), /may only contain alphanumeric/i);
    assert.throws(() => validateWorkspaceName('evil;drop table'), /may only contain alphanumeric/i);
  });

  await t.test('validateBaseCommitSha validates 40-char hex commit SHAs', () => {
    assert.equal(validateBaseCommitSha(null), null);
    assert.equal(validateBaseCommitSha(undefined), null);
    assert.equal(validateBaseCommitSha('e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9'), 'e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9');
    assert.throws(() => validateBaseCommitSha('not-a-sha'), /40-character hexadecimal/i);
    assert.throws(() => validateBaseCommitSha('12345'), /40-character hexadecimal/i);
  });

  await t.test('validateWorkspaceFilePath validates safe paths and detects language', () => {
    const js = validateWorkspaceFilePath('src/index.js');
    assert.equal(js.normalizedPath, 'src/index.js');
    assert.equal(js.language, 'javascript');

    const py = validateWorkspaceFilePath('/app/main.py');
    assert.equal(py.normalizedPath, 'app/main.py');
    assert.equal(py.language, 'python');

    const md = validateWorkspaceFilePath('README.md');
    assert.equal(md.normalizedPath, 'README.md');
    assert.equal(md.language, 'markdown');

    const cfg = validateWorkspaceFilePath('package.json');
    assert.equal(cfg.normalizedPath, 'package.json');
    assert.equal(cfg.language, 'json');
  });

  await t.test('validateWorkspaceFilePath rejects path traversal, backslashes, control characters, and reserved directories', () => {
    // Path traversal
    assert.throws(() => validateWorkspaceFilePath('../secret.js'), /Path traversal/i);
    assert.throws(() => validateWorkspaceFilePath('src/../../secret.js'), /Path traversal/i);
    assert.throws(() => validateWorkspaceFilePath('./src/index.js'), /Path traversal/i);

    // Backslashes
    assert.throws(() => validateWorkspaceFilePath('src\\index.js'), /Backslashes are not permitted/i);

    // Double encoded or encoded traversal
    assert.throws(() => validateWorkspaceFilePath('src%2findex.js'), /Encoded path separators/i);
    assert.throws(() => validateWorkspaceFilePath('src%5cindex.js'), /Encoded path separators/i);
    assert.throws(() => validateWorkspaceFilePath('src%252findex.js'), /Encoded path separators/i);

    // Control characters / null bytes
    assert.throws(() => validateWorkspaceFilePath('src/index\0.js'), /illegal control characters/i);
    assert.throws(() => validateWorkspaceFilePath('src/index\r.js'), /illegal control characters/i);

    // Restricted directories
    assert.throws(() => validateWorkspaceFilePath('.git/config'), /restricted directory/i);
    assert.throws(() => validateWorkspaceFilePath('node_modules/express/index.js'), /restricted directory/i);

    // Unsupported extension
    assert.throws(() => validateWorkspaceFilePath('binary.exe'), /not supported/i);
    assert.throws(() => validateWorkspaceFilePath('image.png'), /not supported/i);
  });

  await t.test('validateFileContent verifies UTF-8 byte length and generates deterministic SHA-256', () => {
    const content = 'console.log("hello world");';
    const { byteLength, contentHash } = validateFileContent(content);
    assert.equal(byteLength, Buffer.byteLength(content, 'utf8'));
    assert.equal(contentHash.length, 64);

    // Multi-byte UTF-8 test (rocket is 4 bytes, sparkle is 3 bytes -> total 7 bytes)
    const multiByte = '🚀✨';
    const multiByteResult = validateFileContent(multiByte);
    assert.equal(multiByteResult.byteLength, Buffer.byteLength(multiByte, 'utf8'));
    assert.equal(multiByteResult.byteLength, 7);

    // Oversized content
    assert.throws(() => validateFileContent('a'.repeat(100), 50), /exceeds maximum permitted size/i);
  });
});

test('Phase 3E — Persistent Workspace and File Service Integration', async (t) => {
  const prisma = getPrismaClient();

  // Create isolated users
  const user1 = await prisma.user.upsert({
    where: { githubId: 'ws-service-user-1' },
    create: { githubId: 'ws-service-user-1', login: 'ws-service-user-1' },
    update: {},
  });
  const user2 = await prisma.user.upsert({
    where: { githubId: 'ws-service-user-2' },
    create: { githubId: 'ws-service-user-2', login: 'ws-service-user-2' },
    update: {},
  });

  // Create repository owned by user1
  const repo1 = await prisma.repository.create({
    data: {
      url: `https://github.com/repomind-test/ws-repo-1-${Date.now()}`,
      owner: 'repomind-test',
      name: 'ws-repo-1',
      defaultBranch: 'main',
      members: {
        create: {
          userId: user1.id,
          role: 'OWNER',
        },
      },
    },
  });

  let createdWsId;

  await t.test('createWorkspace creates workspace for repository owner', async () => {
    const ws = await createWorkspace(user1.id, {
      repositoryId: repo1.id,
      name: 'feature-auth',
    }, { prisma });

    assert.equal(ws.name, 'feature-auth');
    assert.equal(ws.repositoryId, repo1.id);
    assert.equal(ws.userId, user1.id);
    createdWsId = ws.id;
  });

  await t.test('createWorkspace rejects non-member with 403', async () => {
    await assert.rejects(
      async () => {
        await createWorkspace(user2.id, {
          repositoryId: repo1.id,
          name: 'unauthorized-ws',
        }, { prisma });
      },
      (err) => err.statusCode === 403
    );
  });

  await t.test('listWorkspaces returns workspaces for user and repository', async () => {
    const list = await listWorkspaces(user1.id, repo1.id, { prisma });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, createdWsId);
    assert.equal(list[0].fileCount, 0);
  });

  await t.test('saveWorkspaceFile creates new file and computes SHA-256 hash', async () => {
    const saved = await saveWorkspaceFile(
      user1.id,
      createdWsId,
      'src/server.js',
      'const express = require("express");',
      { prisma }
    );

    assert.equal(saved.path, 'src/server.js');
    assert.equal(saved.language, 'javascript');
    assert.equal(saved.contentHash.length, 64);
    assert.ok(saved.sizeBytes > 0);
  });

  await t.test('getWorkspaceFile retrieves file content and metadata', async () => {
    const file = await getWorkspaceFile(user1.id, createdWsId, 'src/server.js', { prisma });
    assert.equal(file.path, 'src/server.js');
    assert.equal(file.content, 'const express = require("express");');
    assert.equal(file.language, 'javascript');
  });

  await t.test('saveWorkspaceFile updates existing file content', async () => {
    const updated = await saveWorkspaceFile(
      user1.id,
      createdWsId,
      'src/server.js',
      'const express = require("express");\napp.listen(3000);',
      { prisma }
    );

    assert.equal(updated.path, 'src/server.js');
    assert.ok(updated.sizeBytes > 35);

    const recheck = await getWorkspaceFile(user1.id, createdWsId, 'src/server.js', { prisma });
    assert.equal(recheck.content, 'const express = require("express");\napp.listen(3000);');
  });

  await t.test('listWorkspaceFiles lists files in workspace', async () => {
    const files = await listWorkspaceFiles(user1.id, createdWsId, { prisma });
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'src/server.js');
  });

  await t.test('user2 is denied access to user1 workspace and files (IDOR protection)', async () => {
    await assert.rejects(
      async () => {
        await getWorkspace(user2.id, createdWsId, { prisma });
      },
      (err) => err.statusCode === 403
    );

    await assert.rejects(
      async () => {
        await getWorkspaceFile(user2.id, createdWsId, 'src/server.js', { prisma });
      },
      (err) => err.statusCode === 403
    );

    await assert.rejects(
      async () => {
        await saveWorkspaceFile(user2.id, createdWsId, 'src/server.js', 'malicious code', { prisma });
      },
      (err) => err.statusCode === 403
    );
  });

  await t.test('deleteWorkspaceFile deletes file', async () => {
    const delResult = await deleteWorkspaceFile(user1.id, createdWsId, 'src/server.js', { prisma });
    assert.equal(delResult.success, true);
    assert.equal(delResult.deletedPath, 'src/server.js');

    const filesAfter = await listWorkspaceFiles(user1.id, createdWsId, { prisma });
    assert.equal(filesAfter.length, 0);
  });

  await t.test('deleteWorkspace deletes workspace', async () => {
    const delWs = await deleteWorkspace(user1.id, createdWsId, { prisma });
    assert.equal(delWs.success, true);

    await assert.rejects(
      async () => {
        await getWorkspace(user1.id, createdWsId, { prisma });
      },
      (err) => err.statusCode === 404
    );
  });

  // Clean up
  await prisma.repository.delete({ where: { id: repo1.id } });
});

test('Phase 3E — HTTP API Workspace and Manual File Editing', async (t) => {
  const server = http.createServer(app);
  const port = await listen(server);
  const prisma = getPrismaClient();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Create users and sessions
  const userA = await prisma.user.upsert({
    where: { githubId: 'http-ws-user-a' },
    create: { githubId: 'http-ws-user-a', login: 'http-ws-user-a' },
    update: {},
  });
  const sessionA = await createSession(userA.id);
  const tokenA = sessionA.rawToken;

  const userB = await prisma.user.upsert({
    where: { githubId: 'http-ws-user-b' },
    create: { githubId: 'http-ws-user-b', login: 'http-ws-user-b' },
    update: {},
  });
  const sessionB = await createSession(userB.id);
  const tokenB = sessionB.rawToken;

  // Create repository owned by UserA
  const repo = await prisma.repository.create({
    data: {
      url: `https://github.com/repomind-test/http-ws-repo-${Date.now()}`,
      owner: 'repomind-test',
      name: 'http-ws-repo',
      defaultBranch: 'main',
      members: {
        create: {
          userId: userA.id,
          role: 'OWNER',
        },
      },
    },
  });

  let httpWsId;

  await t.test('Unauthenticated requests are rejected with 401', async () => {
    const res = await request(port, 'GET', '/api/workspaces?repositoryId=123', null, null);
    assert.equal(res.status, 401);

    const createRes = await request(port, 'POST', '/api/workspaces', { repositoryId: repo.id, name: 'ws' }, null);
    assert.equal(createRes.status, 401);
  });

  await t.test('POST /api/workspaces creates workspace for authenticated repo owner', async () => {
    const res = await request(
      port,
      'POST',
      '/api/workspaces',
      { repositoryId: repo.id, name: 'main-dev' },
      tokenA
    );
    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.name, 'main-dev');
    httpWsId = res.json.data.id;
  });

  await t.test('POST /api/workspaces rejects duplicate workspace name with 409', async () => {
    const res = await request(
      port,
      'POST',
      '/api/workspaces',
      { repositoryId: repo.id, name: 'main-dev' },
      tokenA
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.success, false);
  });

  await t.test('PUT /api/workspaces/:id/files/* creates a manual file', async () => {
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${httpWsId}/files/src/app.ts`,
      { content: 'export const app = "repomind";\n' },
      tokenA
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.path, 'src/app.ts');
    assert.equal(res.json.data.language, 'typescript');
    assert.equal(res.json.data.contentHash.length, 64);
  });

  await t.test('GET /api/workspaces/:id/files/* reads file content', async () => {
    const res = await request(
      port,
      'GET',
      `/api/workspaces/${httpWsId}/files/src/app.ts`,
      undefined,
      tokenA
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.content, 'export const app = "repomind";\n');
  });

  await t.test('GET /api/workspaces/:id/files lists files with size and hash', async () => {
    const res = await request(
      port,
      'GET',
      `/api/workspaces/${httpWsId}/files`,
      undefined,
      tokenA
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].path, 'src/app.ts');
  });

  await t.test('PUT /api/workspaces/:id/files/* rejects path traversal attempts with 400', async () => {
    const res = await request(
      port,
      'PUT',
      `/api/workspaces/${httpWsId}/files/..%2fsecret.js`,
      { content: 'bad' },
      tokenA
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  await t.test('User B (unrelated user) cannot access User A workspace or files (403 IDOR blocked)', async () => {
    const getRes = await request(
      port,
      'GET',
      `/api/workspaces/${httpWsId}`,
      undefined,
      tokenB
    );
    assert.equal(getRes.status, 403);

    const fileRes = await request(
      port,
      'GET',
      `/api/workspaces/${httpWsId}/files/src/app.ts`,
      undefined,
      tokenB
    );
    assert.equal(fileRes.status, 403);

    const putRes = await request(
      port,
      'PUT',
      `/api/workspaces/${httpWsId}/files/src/app.ts`,
      { content: 'attacker' },
      tokenB
    );
    assert.equal(putRes.status, 403);
  });

  await t.test('DELETE /api/workspaces/:id/files/* deletes the file', async () => {
    const res = await request(
      port,
      'DELETE',
      `/api/workspaces/${httpWsId}/files/src/app.ts`,
      undefined,
      tokenA
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  await t.test('DELETE /api/workspaces/:id deletes the workspace', async () => {
    const res = await request(
      port,
      'DELETE',
      `/api/workspaces/${httpWsId}`,
      undefined,
      tokenA
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  // Clean up
  await prisma.repository.delete({ where: { id: repo.id } });
});
