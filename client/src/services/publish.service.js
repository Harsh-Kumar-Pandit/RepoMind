import apiClient from "./api.js";

/**
 * Publish & Pull Request Service for RepoMind
 * Strictly interfaces with:
 * - POST /api/workspaces/:workspaceId/publish
 * - POST /api/workspaces/:workspaceId/pull-request
 *
 * NOTE: Credentials are never sent from client. The backend utilizes its securely
 * authorized server-side token and enforces permissions, pinned baseline checks,
 * non-default branch restrictions, and file selection validation.
 */

/**
 * Publish selected workspace changes to a new feature branch.
 * @param {string} workspaceId
 * @param {Object} payload
 * @param {string} payload.branchName - Feature branch name (must not be default branch)
 * @param {string} payload.commitMessage - Commit message (1 to 2000 chars)
 * @param {string[]} payload.selectedPaths - Array of file paths to publish
 * @param {string} [payload.baseBranch] - Optional base branch (defaults to repo defaultBranch)
 * @returns {Promise<Object>} Published result envelope
 */
export async function publishWorkspaceChanges(workspaceId, { branchName, commitMessage, selectedPaths, baseBranch }) {
  const { data } = await apiClient.post(`/workspaces/${workspaceId}/publish`, {
    branchName,
    commitMessage,
    selectedPaths,
    baseBranch,
  });
  return data?.data;
}

/**
 * Create a GitHub Pull Request for a published feature branch.
 * @param {string} workspaceId
 * @param {Object} payload
 * @param {string} payload.headBranch - The feature branch that was published
 * @param {string} payload.title - Pull request title (1 to 256 chars)
 * @param {string} [payload.body] - Pull request description markdown
 * @param {string} [payload.baseBranch] - Target branch (default branch)
 * @returns {Promise<Object>} Pull request result envelope (includes prNumber, prUrl, etc.)
 */
export async function createPullRequest(workspaceId, { headBranch, title, body, baseBranch }) {
  const { data } = await apiClient.post(`/workspaces/${workspaceId}/pull-request`, {
    headBranch,
    title,
    body,
    baseBranch,
  });
  return data?.data;
}

export default {
  publishWorkspaceChanges,
  createPullRequest,
};
