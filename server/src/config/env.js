import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  databaseUrl: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL || '',
  
  // GitHub integration
  githubToken: process.env.GITHUB_TOKEN || '',
  githubConcurrency: parseInt(process.env.GITHUB_CONCURRENCY || '5', 10),

  // Resource limits
  indexingMaxFiles: parseInt(process.env.INDEXING_MAX_FILES || '70', 10),
  indexingMaxFileSizeBytes: parseInt(process.env.INDEXING_MAX_FILE_SIZE_BYTES || '512000', 10), // 500 KB
  indexingMaxTotalBytes: parseInt(process.env.INDEXING_MAX_TOTAL_BYTES || '5242880', 10), // 5 MB
  indexingMaxChunks: parseInt(process.env.INDEXING_MAX_CHUNKS || '500', 10),
  indexingMaxInputTokens: parseInt(process.env.INDEXING_MAX_INPUT_TOKENS || '200000', 10),
  indexingMaxDurationMs: parseInt(process.env.INDEXING_MAX_DURATION_MS || '300000', 10), // 5 mins

  // Chunking configuration
  chunkTargetTokens: parseInt(process.env.CHUNK_TARGET_TOKENS || '500', 10),   // ~500 tokens per chunk
  chunkMaxTokens: parseInt(process.env.CHUNK_MAX_TOKENS || '700', 10),          // hard cap per chunk
  chunkOverlapTokens: parseInt(process.env.CHUNK_OVERLAP_TOKENS || '60', 10),   // overlap between chunks
  chunkMinTokens: parseInt(process.env.CHUNK_MIN_TOKENS || '30', 10),           // minimum to avoid tiny chunks

  // Embedding provider configuration (gemini | openrouter)
  embeddingProvider: (process.env.EMBEDDING_PROVIDER || 'gemini').toLowerCase(),

  // Gemini AI configuration
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
  geminiEmbeddingDimensions: 768, // Fixed 768 for Gemini
  geminiEmbeddingRpm: parseInt(process.env.GEMINI_EMBEDDING_RPM || '30', 10),
  geminiEmbeddingBatchSize: parseInt(
    process.env.GEMINI_EMBEDDING_BATCH_SIZE || process.env.INDEXING_BATCH_SIZE || '16',
    10
  ),
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',

  // OpenRouter Fallback & Embeddings
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterChatModel: process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-3.5-flash-lite',
  openrouterEmbeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL || 'liquid/lfm-2.5-embedding-350m:free',
  openrouterEmbeddingDimensions: 1024, // 1024 for LiquidAI LFM 2.5
  openrouterEmbeddingRpm: parseInt(process.env.OPENROUTER_EMBEDDING_RPM || '60', 10),
  openrouterEmbeddingBatchSize: parseInt(process.env.OPENROUTER_EMBEDDING_BATCH_SIZE || '10', 10),

  // Retrieval
  retrievalTopK: parseInt(process.env.RETRIEVAL_TOP_K || '6', 10),

  // Indexing lock lease
  indexingLockTtlMs: parseInt(process.env.INDEXING_LOCK_TTL_MS || '120000', 10),
  indexingLockRenewMs: parseInt(process.env.INDEXING_LOCK_RENEW_MS || '45000', 10),

  // Phase 3 — Authentication & Sessions (OAuth + Cookies)
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
  githubOAuthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
  githubOAuthCallbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'repomind_session',
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || '604800000', 10), // 7 days
};

export const parseCorsOrigins = (raw) => {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export const validateEnv = (targetEnv = env) => {
  if (!targetEnv.databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  // Reject wildcard or empty CORS origin when credentialed requests are used
  const origins = parseCorsOrigins(targetEnv.corsOrigin);
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN environment variable is required and cannot be empty.');
  }
  if (origins.includes('*')) {
    throw new Error(
      'CORS_ORIGIN cannot be "*" because credentialed requests require an explicit origin allowlist.'
    );
  }
};
