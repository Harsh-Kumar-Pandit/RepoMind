import apiClient from "./api.js";

/**
 * Chat Service
 * Calls RepoMind grounded RAG chat endpoint.
 */

// POST /api/chat
export async function sendChatMessage({ repositoryId, question, commitSha = null, snapshotId = null }) {
  const payload = {
    repositoryId,
    question: question.trim(),
  };
  if (commitSha) payload.commitSha = commitSha;
  if (snapshotId) payload.snapshotId = snapshotId;

  const { data } = await apiClient.post("/chat", payload);
  return data?.data;
}

export default {
  sendChatMessage,
};
