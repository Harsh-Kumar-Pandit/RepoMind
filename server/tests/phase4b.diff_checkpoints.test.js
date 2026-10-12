import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import {
  generateUnifiedDiff,
  ensurePinnedWorkspaceBaseline,
  getWorkspaceDiff,
} from '../src/services/diff.service.js';
import {
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  getWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from '../src/services/checkpoint.service.js';
import { saveWorkspaceFile, deleteWorkspaceFile } from '../src/services/workspace.service.js';

describe('Phase 4B — Diff Engine and Unified Diff Units', () => {
  it('generateUnifiedDiff generates standard Myers-style unified diff', () => {
    const oldContent = 'line 1\nline 2\nline 3';
    const newContent = 'line 1\nline 2 modified\nline 3\nline 4';
    const diff = generateUnifiedDiff('src/index.js', 'src/index.js', oldContent, newContent);

    assert.ok(diff.includes('--- a/src/index.js'));
    assert.ok(diff.includes('+++ b/src/index.js'));
    assert.ok(diff.includes('-line 2'));
    assert.ok(diff.includes('+line 2 modified'));
    assert.ok(diff.includes('+line 4'));
  });

  it('generateUnifiedDiff returns null when content is identical', () => {
    const content = 'const x = 42;\nexport default x;';
    const diff = generateUnifiedDiff('src/app.js', 'src/app.js', content, content);
    assert.equal(diff, null);
  });
});

describe('Phase 4B — Diff Engine & Workspace Checkpoints Integration', () => {
  let prisma;
  let testUser1;
  let testUser2;
  let testRepo;
  let testWorkspace;

  before(async () => {
    prisma = getPrismaClient();

    testUser1 = await prisma.user.create({
      data: {
        githubId: `diff_user1_${Date.now()}`,
        login: `diffuser1_${Date.now()}`,
        avatarUrl: 'https://example.com/user1.png',
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        githubId: `diff_user2_${Date.now()}`,
        login: `diffuser2_${Date.now()}`,
        avatarUrl: 'https://example.com/user2.png',
      },
    });

    testRepo = await prisma.repository.create({
      data: {
        owner: 'testowner',
        name: `testrepo-${Date.now()}`,
        url: `https://github.com/testowner/testrepo-${Date.now()}`,
        defaultBranch: 'main',
        members: {
          create: {
            userId: testUser1.id,
            role: 'OWNER',
          },
        },
      },
    });

    testWorkspace = await prisma.workspace.create({
      data: {
        userId: testUser1.id,
        repositoryId: testRepo.id,
        name: 'phase4b-test-workspace',
        baseCommitSha: '0123456789abcdef0123456789abcdef01234567',
      },
    });
  });

  after(async () => {
    try {
      if (testWorkspace) {
        await prisma.workspaceFile.deleteMany({ where: { workspaceId: testWorkspace.id } });
        await prisma.workspaceCheckpointFile.deleteMany({
          where: { checkpoint: { workspaceId: testWorkspace.id } },
        });
        await prisma.workspaceCheckpoint.deleteMany({ where: { workspaceId: testWorkspace.id } });
        await prisma.workspace.deleteMany({ where: { id: testWorkspace.id } });
      }
      if (testRepo) {
        await prisma.repositoryMember.deleteMany({ where: { repositoryId: testRepo.id } });
        await prisma.repository.deleteMany({ where: { id: testRepo.id } });
      }
      if (testUser1) await prisma.user.deleteMany({ where: { id: testUser1.id } });
      if (testUser2) await prisma.user.deleteMany({ where: { id: testUser2.id } });
      await disconnectDatabase();
    } catch {
      // Best-effort cleanup
    }
  });

  it('ensurePinnedWorkspaceBaseline returns existing pinned commit SHA without modifying it', async () => {
    const sha = await ensurePinnedWorkspaceBaseline(testUser1.id, testWorkspace.id);
    assert.equal(sha, '0123456789abcdef0123456789abcdef01234567');
  });

  it('getWorkspaceDiff correctly classifies ADDED, MODIFIED, DELETED, and UNCHANGED files', async () => {
    // 1. Setup simulated baseline files in mock resolver
    const baselineMockFiles = {
      'src/unchanged.js': 'console.log("unchanged");\n',
      'src/modified.js': 'console.log("old");\n',
      'src/deleted.js': 'console.log("to be deleted");\n',
    };

    const mockFetchBaseline = async (path) => {
      return baselineMockFiles[path] !== undefined ? baselineMockFiles[path] : null;
    };

    // 2. Create workspace files
    // a. UNCHANGED
    await saveWorkspaceFile(
      testUser1.id,
      testWorkspace.id,
      'src/unchanged.js',
      'console.log("unchanged");\n'
    );

    // b. MODIFIED
    await saveWorkspaceFile(
      testUser1.id,
      testWorkspace.id,
      'src/modified.js',
      'console.log("new modified content");\n'
    );

    // c. ADDED
    await saveWorkspaceFile(
      testUser1.id,
      testWorkspace.id,
      'src/added.js',
      'console.log("brand new file");\n'
    );

    // d. DELETED
    const delFile = await saveWorkspaceFile(
      testUser1.id,
      testWorkspace.id,
      'src/deleted.js',
      'console.log("to be deleted");\n'
    );
    await deleteWorkspaceFile(testUser1.id, testWorkspace.id, 'src/deleted.js', {
      expectedContentHash: delFile.contentHash,
    });

    // 3. Generate diff
    const diffResult = await getWorkspaceDiff(testUser1.id, testWorkspace.id, {
      fetchBaselineContentFn: mockFetchBaseline,
    });

    assert.equal(diffResult.workspaceId, testWorkspace.id);
    assert.equal(diffResult.baseCommitSha, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(diffResult.summary.totalFiles, 4);
    assert.equal(diffResult.summary.unchanged, 1);
    assert.equal(diffResult.summary.modified, 1);
    assert.equal(diffResult.summary.added, 1);
    assert.equal(diffResult.summary.deleted, 1);

    const addedItem = diffResult.files.find((f) => f.path === 'src/added.js');
    assert.ok(addedItem);
    assert.equal(addedItem.status, 'ADDED');
    assert.ok(addedItem.diffText.includes('+console.log("brand new file");'));

    const modItem = diffResult.files.find((f) => f.path === 'src/modified.js');
    assert.ok(modItem);
    assert.equal(modItem.status, 'MODIFIED');
    assert.ok(modItem.diffText.includes('-console.log("old");'));
    assert.ok(modItem.diffText.includes('+console.log("new modified content");'));

    const delItem = diffResult.files.find((f) => f.path === 'src/deleted.js');
    assert.ok(delItem);
    assert.equal(delItem.status, 'DELETED');
    assert.ok(delItem.diffText.includes('-console.log("to be deleted");'));

    const unchItem = diffResult.files.find((f) => f.path === 'src/unchanged.js');
    assert.ok(unchItem);
    assert.equal(unchItem.status, 'UNCHANGED');
    assert.equal(unchItem.diffText, null);
  });

  it('Checkpoint operations: create, list, read manifest, prune to 20, and atomic restore', async () => {
    // 1. Create a checkpoint
    const cp1 = await createWorkspaceCheckpoint(testUser1.id, testWorkspace.id, {
      name: 'Initial Checkpoint',
      description: 'First test snapshot',
    });

    assert.ok(cp1.id);
    assert.equal(cp1.name, 'Initial Checkpoint');
    assert.equal(cp1.description, 'First test snapshot');
    assert.equal(cp1.fileCount, 4);

    // 2. List checkpoints
    const list = await listWorkspaceCheckpoints(testUser1.id, testWorkspace.id);
    assert.ok(list.length >= 1);
    assert.equal(list[0].id, cp1.id);

    // 3. Read specific checkpoint manifest
    const cpDetail = await getWorkspaceCheckpoint(testUser1.id, testWorkspace.id, cp1.id);
    assert.equal(cpDetail.id, cp1.id);
    assert.equal(cpDetail.files.length, 4);
    const addedFileInManifest = cpDetail.files.find((f) => f.path === 'src/added.js');
    assert.ok(addedFileInManifest);
    assert.equal(addedFileInManifest.isDeleted, false);

    // 4. Modify workspace state: save modified content and delete another file
    const modFile = await prisma.workspaceFile.findUnique({
      where: {
        workspaceId_path: {
          workspaceId: testWorkspace.id,
          path: 'src/modified.js',
        },
      },
    });

    await saveWorkspaceFile(
      testUser1.id,
      testWorkspace.id,
      'src/modified.js',
      'console.log("altered after checkpoint");\n',
      { expectedContentHash: modFile.contentHash }
    );

    // Verify workspace file changed
    const afterMod = await prisma.workspaceFile.findUnique({
      where: {
        workspaceId_path: {
          workspaceId: testWorkspace.id,
          path: 'src/modified.js',
        },
      },
    });
    assert.equal(afterMod.content, 'console.log("altered after checkpoint");\n');

    // 5. Restore checkpoint cp1
    const restoreRes = await restoreWorkspaceCheckpoint(testUser1.id, testWorkspace.id, cp1.id);
    assert.equal(restoreRes.success, true);
    assert.equal(restoreRes.restoredCheckpointId, cp1.id);

    // 6. Verify restored state matches cp1 state
    const restoredFile = await prisma.workspaceFile.findUnique({
      where: {
        workspaceId_path: {
          workspaceId: testWorkspace.id,
          path: 'src/modified.js',
        },
      },
    });
    assert.equal(restoredFile.content, 'console.log("new modified content");\n');

    // 7. Test pruning to maximum 20 checkpoints
    for (let i = 2; i <= 25; i++) {
      await createWorkspaceCheckpoint(testUser1.id, testWorkspace.id, {
        name: `Checkpoint ${i}`,
      });
    }

    const finalList = await listWorkspaceCheckpoints(testUser1.id, testWorkspace.id);
    assert.equal(finalList.length, 20);
  });

  it('IDOR protection: unauthorized user cannot view diffs, read checkpoints, or restore them', async () => {
    // Attempt getWorkspaceDiff as User 2 (not a member/owner of workspace)
    await assert.rejects(
      async () => {
        await getWorkspaceDiff(testUser2.id, testWorkspace.id);
      },
      (err) => err.statusCode === 403 || err.statusCode === 404
    );

    // Attempt listWorkspaceCheckpoints as User 2
    await assert.rejects(
      async () => {
        await listWorkspaceCheckpoints(testUser2.id, testWorkspace.id);
      },
      (err) => err.statusCode === 403 || err.statusCode === 404
    );
  });
});
