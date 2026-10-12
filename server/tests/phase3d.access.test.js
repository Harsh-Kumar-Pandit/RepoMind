import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { getPrismaClient } from '../src/config/database.js';
import { createSession } from '../src/services/session.service.js';
import {
  getRepositoryMembership,
  requireRepositoryAccess,
  findOrCreateRepositoryWithInitialOwner,
  claimLegacyRepository,
  addRepositoryMember,
  listRepositoryMembers,
  removeRepositoryMember,
  validateSnapshotRepositoryBinding,
} from '../src/services/access.service.js';

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
  return { status: res.status, json, headers: res.headers };
}

test('Phase 3D — Access Control & Ownership Service Units', async (t) => {
  const prisma = getPrismaClient();

  // Create isolated test users
  const userA = await prisma.user.upsert({
    where: { githubId: 'phase3d-user-a' },
    create: { githubId: 'phase3d-user-a', login: 'phase3d-user-a' },
    update: {},
  });
  const userB = await prisma.user.upsert({
    where: { githubId: 'phase3d-user-b' },
    create: { githubId: 'phase3d-user-b', login: 'phase3d-user-b' },
    update: {},
  });
  const userC = await prisma.user.upsert({
    where: { githubId: 'phase3d-user-c' },
    create: { githubId: 'phase3d-user-c', login: 'phase3d-user-c' },
    update: {},
  });

  const testRepoUrl = `https://github.com/repomind-test/access-unit-${Date.now()}`;
  let createdRepoId;

  await t.test('findOrCreateRepositoryWithInitialOwner creates repo and grants OWNER atomically', async () => {
    const result = await findOrCreateRepositoryWithInitialOwner(
      {
        url: testRepoUrl,
        owner: 'repomind-test',
        name: 'access-unit',
        defaultBranch: 'main',
      },
      userA.id,
      { prisma }
    );

    assert.equal(result.created, true);
    assert.equal(result.isOwner, true);
    assert.equal(result.isMember, true);
    assert.equal(result.isUnowned, false);
    createdRepoId = result.repository.id;

    // Verify membership in database
    const membership = await getRepositoryMembership(createdRepoId, userA.id, { prisma });
    assert.equal(membership.isMember, true);
    assert.equal(membership.role, 'OWNER');
  });

  await t.test('concurrent or second findOrCreate on existing repo does NOT grant ownership to another user', async () => {
    const result = await findOrCreateRepositoryWithInitialOwner(
      {
        url: testRepoUrl,
        owner: 'repomind-test',
        name: 'access-unit',
        defaultBranch: 'main',
      },
      userB.id,
      { prisma }
    );

    assert.equal(result.created, false);
    assert.equal(result.isOwner, false);
    assert.equal(result.isMember, false);
    assert.equal(result.repository.id, createdRepoId);

    // Verify userB is NOT a member
    const membershipB = await getRepositoryMembership(createdRepoId, userB.id, { prisma });
    assert.equal(membershipB.isMember, false);
    assert.equal(membershipB.role, null);
  });

  await t.test('findOrCreateRepositoryWithInitialOwner handles simultaneous concurrent requests without P2028 or P2002 error', async () => {
    const concurrentUrl = `https://github.com/repomind-test/concurrent-unit-${Date.now()}`;
    const [resA, resB] = await Promise.all([
      findOrCreateRepositoryWithInitialOwner(
        { url: concurrentUrl, owner: 'repomind-test', name: 'concurrent-unit', defaultBranch: 'main' },
        userA.id,
        { prisma }
      ),
      findOrCreateRepositoryWithInitialOwner(
        { url: concurrentUrl, owner: 'repomind-test', name: 'concurrent-unit', defaultBranch: 'main' },
        userB.id,
        { prisma }
      ),
    ]);

    // Exactly one user must be OWNER and created=true, the other created=false and isOwner=false
    const owners = [resA, resB].filter((r) => r.created && r.isOwner);
    const nonOwners = [resA, resB].filter((r) => !r.created && !r.isOwner);
    assert.equal(owners.length, 1);
    assert.equal(nonOwners.length, 1);
    assert.equal(resA.repository.id, resB.repository.id);

    // Clean up concurrent repo
    await prisma.repository.delete({ where: { id: resA.repository.id } });
  });

  await t.test('requireRepositoryAccess allows OWNER and denies non-member', async () => {
    const ownerAccess = await requireRepositoryAccess(createdRepoId, userA.id, ['OWNER', 'MEMBER'], { prisma });
    assert.equal(ownerAccess.role, 'OWNER');

    await assert.rejects(
      async () => {
        await requireRepositoryAccess(createdRepoId, userB.id, ['OWNER', 'MEMBER'], { prisma });
      },
      (err) => err.statusCode === 403 && /denied/i.test(err.message)
    );
  });

  await t.test('addRepositoryMember allows OWNER to add collaborator as MEMBER', async () => {
    const memberRecord = await addRepositoryMember(
      createdRepoId,
      userA.id,
      { targetUserId: userB.id, role: 'MEMBER' },
      { prisma }
    );

    assert.equal(memberRecord.role, 'MEMBER');
    assert.equal(memberRecord.user.id, userB.id);

    // Now userB has access as MEMBER
    const memberAccess = await requireRepositoryAccess(createdRepoId, userB.id, ['OWNER', 'MEMBER'], { prisma });
    assert.equal(memberAccess.role, 'MEMBER');

    // But userB cannot access OWNER-only functions
    await assert.rejects(
      async () => {
        await requireRepositoryAccess(createdRepoId, userB.id, ['OWNER'], { prisma });
      },
      (err) => err.statusCode === 403
    );
  });

  await t.test('addRepositoryMember rejects adding duplicate member or assigning OWNER role', async () => {
    // Duplicate
    await assert.rejects(
      async () => {
        await addRepositoryMember(
          createdRepoId,
          userA.id,
          { targetUserId: userB.id, role: 'MEMBER' },
          { prisma }
        );
      },
      (err) => err.statusCode === 409
    );

    // Cannot add as OWNER
    await assert.rejects(
      async () => {
        await addRepositoryMember(
          createdRepoId,
          userA.id,
          { targetUserId: userC.id, role: 'OWNER' },
          { prisma }
        );
      },
      (err) => err.statusCode === 400 && /collaborators may only be added with member role/i.test(err.message)
    );
  });

  await t.test('listRepositoryMembers returns members and roles', async () => {
    const members = await listRepositoryMembers(createdRepoId, userB.id, { prisma });
    assert.equal(members.length, 2);
    const roles = members.map((m) => m.role);
    assert.ok(roles.includes('OWNER'));
    assert.ok(roles.includes('MEMBER'));
  });

  await t.test('removeRepositoryMember allows OWNER to remove MEMBER, but not self', async () => {
    // Owner cannot remove self
    await assert.rejects(
      async () => {
        await removeRepositoryMember(createdRepoId, userA.id, userA.id, { prisma });
      },
      (err) => err.statusCode === 400 && /owners cannot remove themselves/i.test(err.message)
    );

    // Owner removes userB
    const removeResult = await removeRepositoryMember(createdRepoId, userA.id, userB.id, { prisma });
    assert.equal(removeResult.success, true);

    // userB no longer has access
    await assert.rejects(
      async () => {
        await requireRepositoryAccess(createdRepoId, userB.id, ['OWNER', 'MEMBER'], { prisma });
      },
      (err) => err.statusCode === 403
    );
  });

  await t.test('Legacy unowned repository claiming', async () => {
    // Create an unowned repository simulating legacy Phase 2
    const legacyUrl = `https://github.com/repomind-test/legacy-unowned-${Date.now()}`;
    const legacyRepo = await prisma.repository.create({
      data: {
        url: legacyUrl,
        owner: 'repomind-test',
        name: 'legacy-unowned',
        defaultBranch: 'main',
      },
    });

    // Unowned repo denies access by default
    await assert.rejects(
      async () => {
        await requireRepositoryAccess(legacyRepo.id, userA.id, ['OWNER', 'MEMBER'], { prisma });
      },
      (err) => err.statusCode === 403 && /unowned/i.test(err.message)
    );

    // userA claims the legacy repo
    const claimResult = await claimLegacyRepository(legacyRepo.id, userA.id, { prisma });
    assert.equal(claimResult.userId, userA.id);
    assert.equal(claimResult.role, 'OWNER');

    // Second claim by userB is rejected (409)
    await assert.rejects(
      async () => {
        await claimLegacyRepository(legacyRepo.id, userB.id, { prisma });
      },
      (err) => err.statusCode === 409 && /already has an established owner/i.test(err.message)
    );

    // Clean up
    await prisma.repository.delete({ where: { id: legacyRepo.id } });
  });

  await t.test('validateSnapshotRepositoryBinding prevents snapshot IDOR', async () => {
    // Create another repo and snapshot
    const otherRepo = await prisma.repository.create({
      data: {
        url: `https://github.com/repomind-test/other-repo-${Date.now()}`,
        owner: 'repomind-test',
        name: 'other-repo',
        defaultBranch: 'main',
      },
    });
    const snapshotOther = await prisma.repoSnapshot.create({
      data: {
        repositoryId: otherRepo.id,
        branch: 'main',
        commitSha: 'sha-other-123',
        configHash: 'conf-other-123',
      },
    });

    // Binding passes when snapshot matches repo
    const ok = await validateSnapshotRepositoryBinding(snapshotOther.id, otherRepo.id, { prisma });
    assert.equal(ok, true);

    // Binding throws 403 when snapshot belongs to a different repo
    await assert.rejects(
      async () => {
        await validateSnapshotRepositoryBinding(snapshotOther.id, createdRepoId, { prisma });
      },
      (err) => err.statusCode === 403 && /does not belong to the requested repository/i.test(err.message)
    );

    // Clean up
    await prisma.repository.delete({ where: { id: otherRepo.id } });
  });

  // Clean up
  await prisma.repository.delete({ where: { id: createdRepoId } });
});

test('Phase 3D — HTTP API Access Control & IDOR Protection', async (t) => {
  const server = http.createServer(app);
  const port = await listen(server);
  const prisma = getPrismaClient();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Create two users with valid sessions
  const alice = await prisma.user.upsert({
    where: { githubId: 'http-alice' },
    create: { githubId: 'http-alice', login: 'http-alice' },
    update: {},
  });
  const aliceSession = await createSession(alice.id);
  const aliceToken = aliceSession.rawToken;

  const bob = await prisma.user.upsert({
    where: { githubId: 'http-bob' },
    create: { githubId: 'http-bob', login: 'http-bob' },
    update: {},
  });
  const bobSession = await createSession(bob.id);
  const bobToken = bobSession.rawToken;

  // Create a repository owned by Alice
  const aliceRepo = await prisma.repository.create({
    data: {
      url: `https://github.com/repomind-test/alice-repo-${Date.now()}`,
      owner: 'repomind-test',
      name: 'alice-repo',
      defaultBranch: 'main',
      members: {
        create: {
          userId: alice.id,
          role: 'OWNER',
        },
      },
    },
  });

  await t.test('Unauthenticated requests are rejected with 401 on protected endpoints', async () => {
    const endpoints = [
      { method: 'POST', path: '/api/repositories/analyze', body: { url: 'https://github.com/test/repo' } },
      { method: 'POST', path: `/api/repositories/${aliceRepo.id}/index`, body: {} },
      { method: 'GET', path: `/api/repositories/${aliceRepo.id}/index-status` },
      { method: 'POST', path: `/api/repositories/${aliceRepo.id}/claim` },
      { method: 'GET', path: `/api/repositories/${aliceRepo.id}/members` },
      { method: 'POST', path: `/api/repositories/${aliceRepo.id}/members`, body: { targetUserId: bob.id } },
      { method: 'POST', path: '/api/chat', body: { repositoryId: aliceRepo.id, question: 'test' } },
    ];

    for (const ep of endpoints) {
      const res = await request(port, ep.method, ep.path, ep.body, null);
      assert.equal(res.status, 401, `Expected 401 for unauthenticated ${ep.method} ${ep.path}`);
      assert.equal(res.json.success, false);
    }
  });

  await t.test('Alice (OWNER) can access index-status and members', async () => {
    const statusRes = await request(port, 'GET', `/api/repositories/${aliceRepo.id}/index-status`, null, aliceToken);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.success, true);

    const membersRes = await request(port, 'GET', `/api/repositories/${aliceRepo.id}/members`, null, aliceToken);
    assert.equal(membersRes.status, 200);
    assert.equal(membersRes.json.data.length, 1);
    assert.equal(membersRes.json.data[0].role, 'OWNER');
  });

  await t.test('Bob (unrelated user) is denied 403 on Alice repo', async () => {
    const statusRes = await request(port, 'GET', `/api/repositories/${aliceRepo.id}/index-status`, null, bobToken);
    assert.equal(statusRes.status, 403);
    assert.equal(statusRes.json.success, false);

    const indexRes = await request(port, 'POST', `/api/repositories/${aliceRepo.id}/index`, {}, bobToken);
    assert.equal(indexRes.status, 403);

    const chatRes = await request(port, 'POST', '/api/chat', { repositoryId: aliceRepo.id, question: 'Hi' }, bobToken);
    assert.equal(chatRes.status, 403);

    const claimRes = await request(port, 'POST', `/api/repositories/${aliceRepo.id}/claim`, {}, bobToken);
    assert.equal(claimRes.status, 409); // already claimed
  });

  await t.test('Alice adds Bob as collaborator, granting access to index and status but not member admin', async () => {
    // Alice adds Bob
    const addRes = await request(
      port,
      'POST',
      `/api/repositories/${aliceRepo.id}/members`,
      { targetUserId: bob.id, role: 'MEMBER' },
      aliceToken
    );
    assert.equal(addRes.status, 201);
    assert.equal(addRes.json.data.role, 'MEMBER');

    // Bob can now access index-status
    const statusRes = await request(port, 'GET', `/api/repositories/${aliceRepo.id}/index-status`, null, bobToken);
    assert.equal(statusRes.status, 200);

    // But Bob (MEMBER) cannot add new members
    const addByBobRes = await request(
      port,
      'POST',
      `/api/repositories/${aliceRepo.id}/members`,
      { targetUserId: alice.id, role: 'MEMBER' },
      bobToken
    );
    assert.equal(addByBobRes.status, 403);

    // Alice removes Bob
    const removeRes = await request(
      port,
      'DELETE',
      `/api/repositories/${aliceRepo.id}/members/${bob.id}`,
      null,
      aliceToken
    );
    assert.equal(removeRes.status, 200);

    // Bob is once again denied
    const statusAfterRemove = await request(port, 'GET', `/api/repositories/${aliceRepo.id}/index-status`, null, bobToken);
    assert.equal(statusAfterRemove.status, 403);
  });

  // Clean up
  await prisma.repository.delete({ where: { id: aliceRepo.id } });
});
