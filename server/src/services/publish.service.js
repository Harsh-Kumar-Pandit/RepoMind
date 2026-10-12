import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { getWorkspace } from './workspace.service.js';
import { requireRepositoryAccess } from './access.service.js';
import { getWorkspaceDiff } from './diff.service.js';

// Limits for publishing payload
export const PUBLISH_LIMITS = {
  maxPerFileSizeBytes: 500 * 1024,      // 500 KB per file
  maxTotalPublishBytes: 5 * 1024 * 1024, // 5 MB total content
  maxSelectedFiles: 100,
};

/**
 * Validates a Git branch name according to git-check-ref-format rules.
 */
export function validateBranchName(branchName, defaultBranch = 'main') {
  if (!branchName || typeof branchName !== 'string') {
    throw new AppError('Branch name is required and must be a string.', 400, 'INVALID_BRANCH_NAME');
  }

  const trimmed = branchName.trim();
  if (trimmed.length < 1 || trimmed.length > 250) {
    throw new AppError('Branch name must be between 1 and 250 characters.', 400, 'INVALID_BRANCH_NAME');
  }

  // Cannot equal default branch or base branch (direct push prevention)
  if (trimmed.toLowerCase() === defaultBranch.toLowerCase()) {
    throw new AppError(
      `Cannot publish directly to base/default branch '${defaultBranch}'. A feature branch name is required.`,
      400,
      'CANNOT_TARGET_DEFAULT_BRANCH'
    );
  }

  // Ref format rules: no spaces, no '~', '^', ':', '?', '*', '[', '\', '..', '@{', leading '/', trailing '/', trailing '.lock'
  if (
    /\s/.test(trimmed) ||
    /[~^:?*\[\\@]/.test(trimmed) ||
    trimmed.includes('..') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.lock') ||
    trimmed.startsWith('-')
  ) {
    throw new AppError(`Invalid branch name '${trimmed}'.`, 400, 'INVALID_BRANCH_NAME');
  }

  return trimmed;
}

/**
 * Validates commit message.
 */
export function validateCommitMessage(message) {
  if (!message || typeof message !== 'string') {
    throw new AppError('Commit message is required and must be a string.', 400, 'INVALID_COMMIT_MESSAGE');
  }
  const trimmed = message.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    throw new AppError('Commit message must be between 1 and 2000 characters.', 400, 'INVALID_COMMIT_MESSAGE');
  }
  return trimmed;
}

/**
 * Internal helper to make authorized GitHub API requests using server token.
 * Never logs or exposes the token.
 */
async function callGitHubApi(endpoint, options = {}, customToken = null) {
  const token = customToken || env.githubToken;
  if (!token) {
    throw new AppError(
      'GitHub write access is not configured. Server lacks authorized GITHUB_TOKEN for publishing.',
      401,
      'GITHUB_CREDENTIALS_REQUIRED'
    );
  }

  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'RepoMind-Backend/1.0',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const timeoutMs = options.timeoutMs || 20000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchFn || fetch)(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = { raw: responseText };
    }

    if (response.status === 401) {
      throw new AppError('GitHub authentication failed: invalid or expired token.', 401, 'GITHUB_AUTH_FAILED');
    }

    if (response.status === 403) {
      if (response.headers?.get && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new AppError('GitHub API rate limit exceeded.', 429, 'RATE_LIMIT_EXCEEDED');
      }
      throw new AppError(
        'GitHub API write permission denied. Token lacks push/write permissions for this repository.',
        403,
        'GITHUB_FORBIDDEN'
      );
    }

    if (response.status === 404) {
      throw new AppError('GitHub repository or resource not found.', 404, 'GITHUB_RESOURCE_NOT_FOUND');
    }

    if (response.status === 422) {
      throw new AppError(
        data.message || 'GitHub validation failed or reference already exists.',
        422,
        'GITHUB_UNPROCESSABLE_ENTITY',
        data
      );
    }

    if (!response.ok) {
      throw new AppError(
        data.message || `GitHub API request failed with status ${response.status}`,
        502,
        'GITHUB_API_ERROR'
      );
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError(`GitHub API request timed out after ${timeoutMs}ms.`, 504, 'GATEWAY_TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validates publish request and change set.
 * Returns validated metadata, repository record, workspace, and eligible change items.
 */
export async function validatePublishPayload(userId, workspaceId, payload, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // 1. Verify user owns the workspace
  const workspace = await getWorkspace(userId, workspaceId, options);
  if (!workspace.baseCommitSha) {
    throw new AppError(
      'Workspace baseline commit SHA is not pinned. Diff and review must be completed before publishing.',
      400,
      'BASELINE_NOT_PINNED'
    );
  }

  // 2. Verify user has repository membership
  await requireRepositoryAccess(workspace.repositoryId, userId, ['OWNER', 'MEMBER'], { prisma });

  // 3. Look up repository from trusted DB storage
  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
  });
  if (!repository) {
    throw new AppError('Repository not found in database.', 404, 'REPOSITORY_NOT_FOUND');
  }

  const {
    branchName: rawBranchName,
    commitMessage: rawCommitMessage,
    selectedPaths,
    baseBranch = repository.defaultBranch || 'main',
  } = payload || {};

  // 4. Validate branch name and commit message
  const branchName = validateBranchName(rawBranchName, baseBranch);
  const commitMessage = validateCommitMessage(rawCommitMessage);

  // 5. Validate selectedPaths array
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
    throw new AppError(
      'selectedPaths is required and must contain at least one file path.',
      400,
      'NO_CHANGES_SELECTED'
    );
  }

  // Check unique paths
  const uniqueSelectedPaths = Array.from(new Set(selectedPaths));
  if (uniqueSelectedPaths.length !== selectedPaths.length) {
    throw new AppError('Duplicate file paths in selectedPaths are not permitted.', 400, 'INVALID_INPUT');
  }

  if (uniqueSelectedPaths.length > PUBLISH_LIMITS.maxSelectedFiles) {
    throw new AppError(
      `Exceeded maximum selected files limit of ${PUBLISH_LIMITS.maxSelectedFiles}.`,
      400,
      'SELECTION_TOO_LARGE'
    );
  }

  // 6. Generate diff to verify actual changes
  const diffResult = await getWorkspaceDiff(userId, workspaceId, options);
  const diffMap = new Map();
  for (const f of diffResult.files) {
    diffMap.set(f.path, f);
  }

  // Fetch actual workspace files for content verification
  const workspaceFiles = await prisma.workspaceFile.findMany({
    where: {
      workspaceId,
      path: { in: uniqueSelectedPaths },
    },
  });

  const wsFileMap = new Map();
  for (const wf of workspaceFiles) {
    wsFileMap.set(wf.path, wf);
  }

  const filesToPublish = [];
  let totalPublishBytes = 0;

  for (const path of uniqueSelectedPaths) {
    const diffItem = diffMap.get(path);
    const wsFile = wsFileMap.get(path);

    if (!diffItem || !wsFile) {
      throw new AppError(
        `Selected file '${path}' was not found in workspace changes.`,
        400,
        'INVALID_SELECTED_PATH'
      );
    }

    if (diffItem.status === 'UNCHANGED') {
      throw new AppError(
        `File '${path}' is unchanged compared to baseline and cannot be published.`,
        400,
        'UNCHANGED_FILE_SELECTED'
      );
    }

    if (diffItem.status === 'DELETED') {
      filesToPublish.push({
        path,
        status: 'DELETED',
        content: null,
      });
      continue;
    }

    // Check size limit per file
    const contentBytes = Buffer.byteLength(wsFile.content, 'utf8');
    if (contentBytes > PUBLISH_LIMITS.maxPerFileSizeBytes) {
      throw new AppError(
        `File '${path}' (${contentBytes} bytes) exceeds the per-file size limit of ${PUBLISH_LIMITS.maxPerFileSizeBytes} bytes.`,
        400,
        'FILE_TOO_LARGE'
      );
    }

    totalPublishBytes += contentBytes;
    if (totalPublishBytes > PUBLISH_LIMITS.maxTotalPublishBytes) {
      throw new AppError(
        `Total publish payload exceeds ${PUBLISH_LIMITS.maxTotalPublishBytes} bytes.`,
        400,
        'PAYLOAD_TOO_LARGE'
      );
    }

    filesToPublish.push({
      path,
      status: diffItem.status, // ADDED or MODIFIED
      content: wsFile.content,
      language: wsFile.language,
    });
  }

  return {
    workspace,
    repository,
    branchName,
    commitMessage,
    baseBranch,
    filesToPublish,
    totalPublishBytes,
  };
}

/**
 * Publishes reviewed and selected workspace changes to a new GitHub branch.
 */
export async function publishWorkspaceChanges(userId, workspaceId, payload, options = {}) {
  const validation = await validatePublishPayload(userId, workspaceId, payload, options);
  const { workspace, repository, branchName, commitMessage, baseBranch, filesToPublish } = validation;

  const apiCall = options.apiCallFn || callGitHubApi;

  // Step 1: Verify remote base branch SHA matches pinned workspace baseline
  // Never rebase or silently publish on top of an altered base branch
  let remoteRefData;
  try {
    remoteRefData = await apiCall(`/repos/${repository.owner}/${repository.name}/git/ref/heads/${baseBranch}`, options);
  } catch (err) {
    throw new AppError(
      `Failed to resolve base branch '${baseBranch}' on GitHub: ${err.message}`,
      400,
      'BASE_BRANCH_NOT_FOUND'
    );
  }

  const currentBaseSha = remoteRefData?.object?.sha;
  if (!currentBaseSha) {
    throw new AppError(`Could not determine commit SHA for base branch '${baseBranch}'.`, 400, 'BASE_BRANCH_NOT_FOUND');
  }

  if (currentBaseSha !== workspace.baseCommitSha) {
    throw new AppError(
      `Remote base branch '${baseBranch}' has progressed (remote: ${currentBaseSha.slice(0, 7)}, pinned: ${workspace.baseCommitSha.slice(0, 7)}). Publishing rejected to prevent stale overwrites.`,
      409,
      'STALE_BASE_BRANCH'
    );
  }

  // Step 2: Check if target feature branch already exists
  try {
    const existingRef = await apiCall(
      `/repos/${repository.owner}/${repository.name}/git/ref/heads/${encodeURIComponent(branchName)}`,
      options
    );
    if (existingRef && existingRef.ref) {
      throw new AppError(
        `Branch '${branchName}' already exists on remote repository. Choose a unique branch name.`,
        409,
        'BRANCH_ALREADY_EXISTS'
      );
    }
  } catch (err) {
    // 404 is the expected response when branch does not exist
    if (err.statusCode !== 404 && err.code !== 'GITHUB_RESOURCE_NOT_FOUND') {
      throw err;
    }
  }

  // Step 3: Fetch the base commit to get its root tree SHA
  const baseCommitData = await apiCall(
    `/repos/${repository.owner}/${repository.name}/git/commits/${workspace.baseCommitSha}`,
    options
  );
  const baseTreeSha = baseCommitData?.tree?.sha;
  if (!baseTreeSha) {
    throw new AppError('Unable to retrieve base Git tree SHA from GitHub.', 502, 'GIT_TREE_ERROR');
  }

  // Step 4: Create blobs for added/modified files and prepare tree items
  const treeEntries = [];

  for (const file of filesToPublish) {
    if (file.status === 'DELETED') {
      // In Git Data Trees API with base_tree, passing sha: null deletes the file from the tree
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
    } else {
      // Create blob on GitHub
      const blobRes = await apiCall(
        `/repos/${repository.owner}/${repository.name}/git/blobs`,
        {
          ...options,
          method: 'POST',
          body: JSON.stringify({
            content: file.content,
            encoding: 'utf-8',
          }),
        }
      );

      if (!blobRes?.sha) {
        throw new AppError(`Failed to create Git blob for file '${file.path}'.`, 502, 'GIT_BLOB_ERROR');
      }

      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobRes.sha,
      });
    }
  }

  // Step 5: Create new Git Tree using base_tree
  const newTreeRes = await apiCall(
    `/repos/${repository.owner}/${repository.name}/git/trees`,
    {
      ...options,
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    }
  );

  const newTreeSha = newTreeRes?.sha;
  if (!newTreeSha) {
    throw new AppError('Failed to create new Git tree on GitHub.', 502, 'GIT_TREE_ERROR');
  }

  // Step 6: Create new commit with parent set to pinned baseCommitSha
  const newCommitRes = await apiCall(
    `/repos/${repository.owner}/${repository.name}/git/commits`,
    {
      ...options,
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: newTreeSha,
        parents: [workspace.baseCommitSha],
      }),
    }
  );

  const newCommitSha = newCommitRes?.sha;
  if (!newCommitSha) {
    throw new AppError('Failed to create Git commit on GitHub.', 502, 'GIT_COMMIT_ERROR');
  }

  // Step 7: Create the new feature branch ref pointing to the new commit
  let branchRefRes;
  try {
    branchRefRes = await apiCall(
      `/repos/${repository.owner}/${repository.name}/git/refs`,
      {
        ...options,
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: newCommitSha,
        }),
      }
    );
  } catch (err) {
    // If commit succeeded but branch creation failed, report partial failure explicitly
    throw new AppError(
      `Commit ${newCommitSha} was created, but failed to create branch 'refs/heads/${branchName}': ${err.message}`,
      502,
      'BRANCH_CREATION_FAILED',
      { partialCommitSha: newCommitSha }
    );
  }

  // Step 8: Verify the created reference
  if (!branchRefRes?.ref || branchRefRes?.object?.sha !== newCommitSha) {
    throw new AppError(
      'Branch creation completed with unexpected ref or SHA.',
      502,
      'VERIFICATION_FAILED'
    );
  }

  return {
    success: true,
    repository: `${repository.owner}/${repository.name}`,
    branchName,
    commitSha: newCommitSha,
    baseCommitSha: workspace.baseCommitSha,
    baseBranch,
    filesPublishedCount: filesToPublish.length,
    publishedPaths: filesToPublish.map((f) => ({
      path: f.path,
      status: f.status,
    })),
  };
}

/**
 * Creates a GitHub Pull Request from an already published feature branch.
 */
export async function createPullRequest(userId, workspaceId, payload, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // 1. Verify workspace ownership
  const workspace = await getWorkspace(userId, workspaceId, options);

  // 2. Verify repository access
  await requireRepositoryAccess(workspace.repositoryId, userId, ['OWNER', 'MEMBER'], { prisma });

  // 3. Fetch repository record
  const repository = await prisma.repository.findUnique({
    where: { id: workspace.repositoryId },
  });
  if (!repository) {
    throw new AppError('Repository not found in database.', 404, 'REPOSITORY_NOT_FOUND');
  }

  const { headBranch, baseBranch = repository.defaultBranch || 'main', title, body = '' } = payload || {};

  if (!headBranch || typeof headBranch !== 'string') {
    throw new AppError('headBranch is required.', 400, 'INVALID_INPUT');
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new AppError('Pull request title is required and cannot be empty.', 400, 'INVALID_INPUT');
  }

  const sanitizedTitle = title.trim();
  if (sanitizedTitle.length > 256) {
    throw new AppError('Pull request title cannot exceed 256 characters.', 400, 'INVALID_INPUT');
  }

  const apiCall = options.apiCallFn || callGitHubApi;

  // 4. Verify head branch exists on remote
  try {
    await apiCall(
      `/repos/${repository.owner}/${repository.name}/git/ref/heads/${encodeURIComponent(headBranch)}`,
      options
    );
  } catch (err) {
    throw new AppError(
      `Head branch '${headBranch}' does not exist on remote repository. You must publish first.`,
      400,
      'HEAD_BRANCH_NOT_FOUND'
    );
  }

  // 5. Create pull request
  let prRes;
  try {
    prRes = await apiCall(
      `/repos/${repository.owner}/${repository.name}/pulls`,
      {
        ...options,
        method: 'POST',
        body: JSON.stringify({
          title: sanitizedTitle,
          body: body ? body.trim() : '',
          head: headBranch,
          base: baseBranch,
        }),
      }
    );
  } catch (err) {
    // Check if PR already exists
    if (err.statusCode === 422 && err.details?.errors) {
      const alreadyExistsError = err.details.errors.find(
        (e) => typeof e.message === 'string' && e.message.includes('A pull request already exists')
      );
      if (alreadyExistsError) {
        throw new AppError(
          `A pull request for ${headBranch} into ${baseBranch} already exists.`,
          409,
          'PULL_REQUEST_ALREADY_EXISTS'
        );
      }
    }
    throw err;
  }

  if (!prRes?.id || !prRes?.html_url) {
    throw new AppError('Pull request was not confirmed by GitHub.', 502, 'PULL_REQUEST_FAILED');
  }

  return {
    success: true,
    prNumber: prRes.number,
    prUrl: prRes.html_url,
    title: prRes.title,
    state: prRes.state,
    headBranch,
    baseBranch,
    createdAt: prRes.created_at,
  };
}
