import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';
import {
  validateBranchName,
  validateCommitMessage,
  validatePublishPayload,
  publishWorkspaceChanges,
  createPullRequest,
} from '../src/services/publish.service.js';
import { saveWorkspaceFile, deleteWorkspaceFile } from '../src/services/workspace.service.js';

describe('Phase 4C — Branch & Commit Validation Units', () => {
  it('validateBranchName accepts valid git branch names and rejects invalid/target branch names', () => {
    assert.equal(validateBranchName('feature/my-branch', 'main'), 'feature/my-branch');
    assert.equal(validateBranchName('fix-123_test', 'main'), 'fix-123_test');

    // Cannot target default/base branch directly
    assert.throws(() => validateBranchName('main', 'main'), /Cannot publish directly to base\/default branch/);
    assert.throws(() => validateBranchName('MAIN', 'main'), /Cannot publish directly to base\/default branch/);

    // Invalid ref names
    assert.throws(() => validateBranchName(''), /Branch name is required/);
    assert.throws(() => validateBranchName('bad branch with spaces'), /Invalid branch name/);
    assert.throws(() => validateBranchName('feature..branch'), /Invalid branch name/);
    assert.throws(() => validateBranchName('/leading-slash'), /Invalid branch name/);
    assert.throws(() => validateBranchName('trailing-slash/'), /Invalid branch name/);
    assert.throws(() => validateBranchName('branch.lock'), /Invalid branch name/);
  });

  it('validateCommitMessage validates commit message length and format', () => {
    assert.equal(validateCommitMessage('feat: add manual files'), 'feat: add manual files');
    assert.throws(() => validateCommitMessage(''), /Commit message is required/);
    assert.throws(() => validateCommitMessage('   '), /Commit message must be between 1 and 2000 characters/);
  });
});

describe('Phase 4C — Publishing & PR Workflows Integration', () => {
  let prisma;
  let testUser1;
  let testUser2;
  let testRepo;
  let testWorkspace;

  const mockBaseSha = '1111111111111111111111111111111111111111';
  const mockBaseTreeSha = '2222222222222222222222222222222222222222';

  before(async () => {
    prisma = getPrismaClient();

    testUser1 = await prisma.user.create({
      data: {
        githubId: `pub_user1_${Date.now()}`,
        login: `pubuser1_${Date.now()}`,
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        githubId: `pub_user2_${Date.now()}`,
        login: `pubuser2_${Date.now()}`,
      },
    });

    testRepo = await prisma.repository.create({
      data: {
        owner: 'testorg',
        name: `testrepo-${Date.now()}`,
        url: `https://github.com/testorg/testrepo-${Date.now()}`,
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
        name: 'publish-test-ws',
        baseCommitSha: mockBaseSha,
      },
    });

    // Populate baseline files and modifications in workspace
    // 1. ADDED file
    await saveWorkspaceFile(testUser1.id, testWorkspace.id, 'src/new-feature.js', 'export const x = 10;\n');
    // 2. MODIFIED file
    await saveWorkspaceFile(testUser1.id, testWorkspace.id, 'src/existing.js', 'console.log("updated");\n');
    // 3. DELETED file
    const toDelete = await saveWorkspaceFile(testUser1.id, testWorkspace.id, 'src/obsolete.js', 'console.log("old");\n');
    await deleteWorkspaceFile(testUser1.id, testWorkspace.id, 'src/obsolete.js', {
      expectedContentHash: toDelete.contentHash,
    });
    // 4. UNCHANGED file
    await saveWorkspaceFile(testUser1.id, testWorkspace.id, 'src/untouched.js', 'console.log("untouched");\n');
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

  it('validatePublishPayload rejects unselected, empty, duplicate, or unchanged files', async () => {
    const mockBaselineFiles = {
      'src/existing.js': 'console.log("initial");\n',
      'src/obsolete.js': 'console.log("old");\n',
      'src/untouched.js': 'console.log("untouched");\n',
    };
    const mockFetchBaseline = async (p) => mockBaselineFiles[p] !== undefined ? mockBaselineFiles[p] : null;

    // Empty selections rejected
    await assert.rejects(
      async () => {
        await validatePublishPayload(testUser1.id, testWorkspace.id, {
          branchName: 'feature/test',
          commitMessage: 'commit msg',
          selectedPaths: [],
        }, { fetchBaselineContentFn: mockFetchBaseline });
      },
      (err) => err.code === 'NO_CHANGES_SELECTED'
    );

    // Duplicate selected paths rejected
    await assert.rejects(
      async () => {
        await validatePublishPayload(testUser1.id, testWorkspace.id, {
          branchName: 'feature/test',
          commitMessage: 'commit msg',
          selectedPaths: ['src/new-feature.js', 'src/new-feature.js'],
        }, { fetchBaselineContentFn: mockFetchBaseline });
      },
      (err) => err.statusCode === 400
    );

    // Unchanged files rejected
    await assert.rejects(
      async () => {
        await validatePublishPayload(testUser1.id, testWorkspace.id, {
          branchName: 'feature/test',
          commitMessage: 'commit msg',
          selectedPaths: ['src/untouched.js'],
        }, { fetchBaselineContentFn: mockFetchBaseline });
      },
      (err) => err.code === 'UNCHANGED_FILE_SELECTED'
    );

    // Valid selected changes accepted
    const validated = await validatePublishPayload(testUser1.id, testWorkspace.id, {
      branchName: 'feature/valid-selection',
      commitMessage: 'feat: add changes',
      selectedPaths: ['src/new-feature.js', 'src/existing.js', 'src/obsolete.js'],
    }, { fetchBaselineContentFn: mockFetchBaseline });

    assert.equal(validated.filesToPublish.length, 3);
    const added = validated.filesToPublish.find((f) => f.path === 'src/new-feature.js');
    assert.equal(added.status, 'ADDED');
    const mod = validated.filesToPublish.find((f) => f.path === 'src/existing.js');
    assert.equal(mod.status, 'MODIFIED');
    const del = validated.filesToPublish.find((f) => f.path === 'src/obsolete.js');
    assert.equal(del.status, 'DELETED');
    assert.equal(del.content, null);
  });

  it('publishWorkspaceChanges rejects stale remote base branch (HTTP 409)', async () => {
    const mockBaselineFiles = {
      'src/existing.js': 'console.log("initial");\n',
    };
    const mockFetchBaseline = async (p) => mockBaselineFiles[p] !== undefined ? mockBaselineFiles[p] : null;

    // Simulated remote base branch returned a newer commit SHA than pinned
    const divergedRemoteSha = '9999999999999999999999999999999999999999';
    const mockApiCall = async (endpoint) => {
      if (endpoint.includes('/git/ref/heads/main')) {
        return { object: { sha: divergedRemoteSha } };
      }
      return {};
    };

    await assert.rejects(
      async () => {
        await publishWorkspaceChanges(testUser1.id, testWorkspace.id, {
          branchName: 'feature/stale-base-test',
          commitMessage: 'feat: updates',
          selectedPaths: ['src/existing.js'],
        }, {
          fetchBaselineContentFn: mockFetchBaseline,
          apiCallFn: mockApiCall,
        });
      },
      (err) => err.statusCode === 409 && err.code === 'STALE_BASE_BRANCH'
    );
  });

  it('publishWorkspaceChanges succeeds: creates blobs, tree with deletion sha=null, commit and branch ref', async () => {
    const mockBaselineFiles = {
      'src/existing.js': 'console.log("initial");\n',
      'src/obsolete.js': 'console.log("old");\n',
    };
    const mockFetchBaseline = async (p) => mockBaselineFiles[p] !== undefined ? mockBaselineFiles[p] : null;

    const createdBlobs = [];
    let createdTree = null;
    let createdCommit = null;
    let createdRef = null;

    const mockApiCall = async (endpoint, options = {}) => {
      // 1. Base branch check
      if (endpoint.includes('/git/ref/heads/main')) {
        return { object: { sha: mockBaseSha } }; // Matches pinned base
      }
      // 2. Target branch exists check
      if (endpoint.includes('/git/ref/heads/feature%2Fgood-feature') || endpoint.includes('/git/ref/heads/feature/good-feature')) {
        const error = new Error('Not found');
        error.statusCode = 404;
        error.code = 'GITHUB_RESOURCE_NOT_FOUND';
        throw error;
      }
      // 3. Base commit tree fetch
      if (endpoint.includes(`/git/commits/${mockBaseSha}`)) {
        return { sha: mockBaseSha, tree: { sha: mockBaseTreeSha } };
      }
      // 4. Create blob
      if (endpoint.includes('/git/blobs') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        const blobSha = `blob_${createdBlobs.length + 1}`;
        createdBlobs.push({ body, sha: blobSha });
        return { sha: blobSha };
      }
      // 5. Create tree
      if (endpoint.includes('/git/trees') && options.method === 'POST') {
        createdTree = JSON.parse(options.body);
        return { sha: 'new_tree_sha_333' };
      }
      // 6. Create commit
      if (endpoint.includes('/git/commits') && options.method === 'POST') {
        createdCommit = JSON.parse(options.body);
        return { sha: 'new_commit_sha_444' };
      }
      // 7. Create ref
      if (endpoint.includes('/git/refs') && options.method === 'POST') {
        createdRef = JSON.parse(options.body);
        return { ref: createdRef.ref, object: { sha: createdRef.sha } };
      }

      return {};
    };

    const result = await publishWorkspaceChanges(testUser1.id, testWorkspace.id, {
      branchName: 'feature/good-feature',
      commitMessage: 'feat: add good feature and delete obsolete',
      selectedPaths: ['src/new-feature.js', 'src/existing.js', 'src/obsolete.js'],
    }, {
      fetchBaselineContentFn: mockFetchBaseline,
      apiCallFn: mockApiCall,
    });

    assert.equal(result.success, true);
    assert.equal(result.branchName, 'feature/good-feature');
    assert.equal(result.commitSha, 'new_commit_sha_444');
    assert.equal(result.baseCommitSha, mockBaseSha);
    assert.equal(result.filesPublishedCount, 3);

    // Verify Git tree details
    assert.equal(createdTree.base_tree, mockBaseTreeSha);
    assert.equal(createdTree.tree.length, 3);

    // Verify deletion semantics: sha === null
    const deletionEntry = createdTree.tree.find((item) => item.path === 'src/obsolete.js');
    assert.ok(deletionEntry);
    assert.equal(deletionEntry.sha, null);

    // Verify commit parent points to pinned baseCommitSha
    assert.deepEqual(createdCommit.parents, [mockBaseSha]);

    // Verify branch ref
    assert.equal(createdRef.ref, 'refs/heads/feature/good-feature');
    assert.equal(createdRef.sha, 'new_commit_sha_444');
  });

  it('createPullRequest validates head branch and creates PR without duplicating', async () => {
    let prPayloadCaptured = null;

    const mockApiCall = async (endpoint, options = {}) => {
      // 1. Verify head branch exists
      if (endpoint.includes('/git/ref/heads/feature%2Fgood-feature')) {
        return { ref: 'refs/heads/feature/good-feature', object: { sha: 'new_commit_sha_444' } };
      }
      // 2. Create pull request
      if (endpoint.includes('/pulls') && options.method === 'POST') {
        prPayloadCaptured = JSON.parse(options.body);
        return {
          id: 998877,
          number: 42,
          html_url: 'https://github.com/testorg/testrepo/pull/42',
          title: prPayloadCaptured.title,
          state: 'open',
          created_at: new Date().toISOString(),
        };
      }
      return {};
    };

    const prResult = await createPullRequest(testUser1.id, testWorkspace.id, {
      headBranch: 'feature/good-feature',
      baseBranch: 'main',
      title: 'feat: integrate manual workspace edits',
      body: 'Verified via diff inspection.',
    }, { apiCallFn: mockApiCall });

    assert.equal(prResult.success, true);
    assert.equal(prResult.prNumber, 42);
    assert.equal(prResult.prUrl, 'https://github.com/testorg/testrepo/pull/42');
    assert.equal(prPayloadCaptured.head, 'feature/good-feature');
    assert.equal(prPayloadCaptured.base, 'main');
    assert.equal(prPayloadCaptured.title, 'feat: integrate manual workspace edits');
  });

  it('IDOR: user2 cannot publish changes or create PR for user1 workspace', async () => {
    await assert.rejects(
      async () => {
        await publishWorkspaceChanges(testUser2.id, testWorkspace.id, {
          branchName: 'feature/idor-attempt',
          commitMessage: 'bad',
          selectedPaths: ['src/new-feature.js'],
        });
      },
      (err) => err.statusCode === 403 || err.statusCode === 404
    );

    await assert.rejects(
      async () => {
        await createPullRequest(testUser2.id, testWorkspace.id, {
          headBranch: 'feature/good-feature',
          title: 'idor pr',
        });
      },
      (err) => err.statusCode === 403 || err.statusCode === 404
    );
  });
});
