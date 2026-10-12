import apiClient from "./api.js";

/**
 * Complete Workspace Service for RepoMind
 * Encapsulates Workspace CRUD, Files (with OCC), Diffs, and Checkpoints.
 */

// GET /api/workspaces?repositoryId=...
export async function listWorkspaces(repositoryId = null) {
  const { data } = await apiClient.get("/workspaces", {
    params: repositoryId ? { repositoryId } : {},
  });
  return data?.data || [];
}

// GET /api/workspaces/:workspaceId
export async function getWorkspace(workspaceId) {
  const { data } = await apiClient.get(`/workspaces/${workspaceId}`);
  return data?.data;
}

// POST /api/workspaces
export async function createWorkspace({ repositoryId, name, baseCommitSha = null, initializeFiles = false }) {
  const { data } = await apiClient.post("/workspaces", {
    repositoryId,
    name,
    baseCommitSha,
    initializeFiles: Boolean(initializeFiles),
  });
  return data?.data;
}

// POST /api/workspaces/:workspaceId/init-files
export async function initWorkspaceFiles(workspaceId) {
  const { data } = await apiClient.post(`/workspaces/${workspaceId}/init-files`);
  return data?.data;
}

// DELETE /api/workspaces/:workspaceId
export async function deleteWorkspace(workspaceId) {
  const { data } = await apiClient.delete(`/workspaces/${workspaceId}`);
  return data?.data;
}

// GET /api/workspaces/:workspaceId/files
export async function listWorkspaceFiles(workspaceId) {
  const { data } = await apiClient.get(`/workspaces/${workspaceId}/files`);
  return data?.data || [];
}

// GET /api/workspaces/:workspaceId/files/*path
export async function getWorkspaceFile(workspaceId, filePath) {
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  const { data } = await apiClient.get(`/workspaces/${workspaceId}/files/${cleanPath}`);
  return data?.data;
}

// PUT /api/workspaces/:workspaceId/files/*path
// OCC: Pass expectedContentHash in body or If-Match header to prevent silent overwrites.
export async function saveWorkspaceFile(workspaceId, filePath, content, expectedContentHash = null) {
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  const headers = {};
  if (expectedContentHash) {
    headers["If-Match"] = `"${expectedContentHash}"`;
  }

  const { data } = await apiClient.put(
    `/workspaces/${workspaceId}/files/${cleanPath}`,
    {
      content,
      expectedContentHash,
    },
    { headers }
  );
  return data?.data;
}

// DELETE /api/workspaces/:workspaceId/files/*path
export async function deleteWorkspaceFile(workspaceId, filePath) {
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  const { data } = await apiClient.delete(`/workspaces/${workspaceId}/files/${cleanPath}`);
  return data?.data;
}

// GET /api/workspaces/:workspaceId/diff
export async function getWorkspaceDiff(workspaceId) {
  const { data } = await apiClient.get(`/workspaces/${workspaceId}/diff`);
  return data?.data;
}

// POST /api/workspaces/:workspaceId/checkpoints
export async function createWorkspaceCheckpoint(workspaceId, { name, description = null }) {
  const { data } = await apiClient.post(`/workspaces/${workspaceId}/checkpoints`, {
    name,
    description,
  });
  return data?.data;
}

// GET /api/workspaces/:workspaceId/checkpoints
export async function listWorkspaceCheckpoints(workspaceId) {
  const { data } = await apiClient.get(`/workspaces/${workspaceId}/checkpoints`);
  return data?.data || [];
}

// GET /api/workspaces/:workspaceId/checkpoints/:checkpointId
export async function getWorkspaceCheckpoint(workspaceId, checkpointId) {
  const { data } = await apiClient.get(`/workspaces/${workspaceId}/checkpoints/${checkpointId}`);
  return data?.data;
}

// POST /api/workspaces/:workspaceId/checkpoints/:checkpointId/restore
export async function restoreWorkspaceCheckpoint(workspaceId, checkpointId) {
  const { data } = await apiClient.post(`/workspaces/${workspaceId}/checkpoints/${checkpointId}/restore`);
  return data?.data;
}

export default {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  initWorkspaceFiles,
  deleteWorkspace,
  listWorkspaceFiles,
  getWorkspaceFile,
  saveWorkspaceFile,
  deleteWorkspaceFile,
  getWorkspaceDiff,
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  getWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
};
