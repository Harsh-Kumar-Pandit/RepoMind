import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { getPrismaClient } from '../config/database.js';
import { resolveChatSnapshot, retrieveForQuestion } from './retrieval.service.js';
import { generateGroundedAnswer } from './ai.service.js';

/**
 * End-to-end RAG chat for a repository question.
 */
export async function chatAboutRepository({
  repositoryId,
  question,
  commitSha = null,
  snapshotId = null,
  topK = env.retrievalTopK,
  options = {},
}) {
  if (!repositoryId) {
    throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
  }
  if (typeof question !== 'string' || !question.trim()) {
    throw new AppError('question is required.', 400, 'INVALID_INPUT');
  }

  const prisma = options.prisma || getPrismaClient();
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
  }

  const snapshot = await resolveChatSnapshot(repositoryId, {
    prisma,
    commitSha,
    snapshotId,
  });

  const chunks = await retrieveForQuestion(snapshot.id, question, {
    prisma,
    topK,
    embeddingModel: snapshot.embeddingModel,
    dimensions: snapshot.dimensions,
    embedOptions: options.embedOptions,
  });

  const generation = await generateGroundedAnswer(question, chunks, {
    fetchFn: options.fetchFn,
    geminiApiKey: options.geminiApiKey,
    openrouterApiKey: options.openrouterApiKey,
    geminiModel: options.geminiModel,
    openrouterModel: options.openrouterModel,
  });

  return {
    repositoryId,
    snapshotId: snapshot.id,
    commitSha: snapshot.commitSha,
    branch: snapshot.branch,
    question: question.trim(),
    answer: generation.answer,
    citations: generation.citations,
    provider: generation.provider,
    model: generation.model,
    fallbackUsed: Boolean(generation.fallbackUsed),
    insufficientEvidence: Boolean(generation.insufficientEvidence),
    retrievedCount: chunks.length,
  };
}
