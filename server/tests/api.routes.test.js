import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { getPrismaClient } from '../src/config/database.js';
import { createSession } from '../src/services/session.service.js';

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
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('API Routes - Validation and Missing Index Errors', async (t) => {
  const server = http.createServer(app);
  const port = await listen(server);
  const prisma = getPrismaClient();

  // Create a test user and session for authenticated API testing
  const testUser = await prisma.user.upsert({
    where: { githubId: 'test-api-routes-user-id' },
    create: {
      githubId: 'test-api-routes-user-id',
      login: 'test-api-routes-user',
    },
    update: {},
  });
  const sessionRecord = await createSession(testUser.id);
  const authToken = sessionRecord.rawToken;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('POST /api/repositories/analyze rejects missing url', async () => {
    const res = await request(port, 'POST', '/api/repositories/analyze', {}, authToken);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.match(res.json.error.message, /url is required/i);
  });

  await t.test('POST /api/repositories/analyze rejects unsafe hosts', async () => {
    const res = await request(port, 'POST', '/api/repositories/analyze', {
      url: 'https://evil.example/owner/repo',
    }, authToken);
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /Invalid host/i);
  });

  await t.test('POST /api/repositories/:id/index returns 404 for unknown repo', async () => {
    const res = await request(port, 'POST', '/api/repositories/00000000-0000-0000-0000-000000000000/index', {}, authToken);
    assert.equal(res.status, 404);
    assert.match(res.json.error.message, /not found/i);
  });

  await t.test('GET /api/repositories/:id/index-status returns 404 for unknown repo', async () => {
    const res = await request(port, 'GET', '/api/repositories/00000000-0000-0000-0000-000000000000/index-status', null, authToken);
    assert.equal(res.status, 404);
  });

  await t.test('POST /api/chat rejects missing fields', async () => {
    const res = await request(port, 'POST', '/api/chat', { question: 'hi' }, authToken);
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /repositoryId/i);
  });

  await t.test('POST /api/chat returns missing-index error for unknown repo', async () => {
    const res = await request(port, 'POST', '/api/chat', {
      repositoryId: '00000000-0000-0000-0000-000000000000',
      question: 'What does this do?',
    }, authToken);
    assert.equal(res.status, 404);
  });
});
