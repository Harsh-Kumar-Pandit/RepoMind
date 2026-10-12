import apiClient from "./api.js";

/**
 * Repository Service
 * Connects to RepoMind repository endpoints.
 */

// POST /api/repositories/analyze
export async function analyzeRepository(url, branch = null) {
  const payload = { url: url.trim() };
  if (branch) payload.branch = branch.trim();

  const { data } = await apiClient.post("/repositories/analyze", payload);
  return data?.data;
}

// GET /api/repositories (user repositories)
export async function listUserRepositories() {
  const { data } = await apiClient.get("/repositories");
  return data?.data || [];
}

// POST /api/repositories/:repositoryId/index
export async function triggerRepositoryIndexing(repositoryId, options = {}) {
  const { data } = await apiClient.post(`/repositories/${repositoryId}/index`, options);
  return data?.data;
}

// GET /api/repositories/:repositoryId/index-status
export async function getRepositoryIndexStatus(repositoryId, options = {}) {
  const params = {};
  if (options.commitSha) params.commitSha = options.commitSha;
  if (options.snapshotId) params.snapshotId = options.snapshotId;

  const { data } = await apiClient.get(`/repositories/${repositoryId}/index-status`, { params });
  return data?.data;
}

// GET /api/repositories/:repositoryId/file?path=&commitSha=
export async function getRepositoryFileContent(repositoryId, filePath, commitSha = null) {
  const params = { path: filePath };
  if (commitSha) params.commitSha = commitSha;

  const { data } = await apiClient.get(`/repositories/${repositoryId}/file`, { params });
  return data?.data;
}

// GET /api/repositories/:repositoryId/tree
export async function getRepositoryTree(repositoryId) {
  const { data } = await apiClient.get(`/repositories/${repositoryId}/tree`);
  return data?.data;
}

export default {
  analyzeRepository,
  listUserRepositories,
  triggerRepositoryIndexing,
  getRepositoryIndexStatus,
  getRepositoryFileContent,
  getRepositoryTree,
};
