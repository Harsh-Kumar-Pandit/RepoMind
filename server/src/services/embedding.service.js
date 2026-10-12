import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { getPrismaClient } from '../config/database.js';
import { AppError, isTransientHttpStatus } from '../utils/errors.js';

const EMBEDDING_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_EMBEDDING_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

/**
 * Resolve provider, model, dimensions, and batchSize based on options or environment.
 */
export function resolveEmbeddingConfig(options = {}) {
  const modelCandidate = options.model || options.embeddingModel;
  const isSlashModel = typeof modelCandidate === 'string' && (modelCandidate.includes('/') || modelCandidate.toLowerCase().includes('lfm'));
  const provider = (options.provider || (isSlashModel ? 'openrouter' : env.embeddingProvider) || 'gemini').toLowerCase();
  if (provider === 'openrouter') {
    const model = options.model || options.embeddingModel || env.openrouterEmbeddingModel;
    const dimensions = options.dimensions || env.openrouterEmbeddingDimensions || 1024;
    const batchSize = options.batchSize || env.openrouterEmbeddingBatchSize || 10;
    const apiKey = options.apiKey || options.openrouterApiKey || env.openrouterApiKey;
    return { provider: 'openrouter', model, dimensions, batchSize, apiKey };
  }
  const model = options.model || options.embeddingModel || env.geminiEmbeddingModel;
  const dimensions = options.dimensions || env.geminiEmbeddingDimensions || 768;
  const batchSize = options.batchSize || env.geminiEmbeddingBatchSize || 16;
  const apiKey = options.apiKey || options.geminiApiKey || env.geminiApiKey;
  return { provider: 'gemini', model, dimensions, batchSize, apiKey };
}

/**
 * Quota-exhausted / pause signal — indexing should mark PARTIAL and stop retrying.
 */
export class EmbeddingQuotaExhaustedError extends AppError {
  constructor(message = 'Embedding quota exhausted.') {
    super(message, 429, 'EMBEDDING_QUOTA_EXHAUSTED');
    this.name = 'EmbeddingQuotaExhaustedError';
  }
}

/**
 * Sliding-window RPM limiter. Each embedded chunk counts as one request unit
 * regardless of batch packing — batches are NOT treated as a single quota unit.
 */
export class EmbeddingRateLimiter {
  constructor(rpm = env.geminiEmbeddingRpm) {
    this.rpm = Math.max(1, rpm);
    this.timestamps = [];
  }

  /** How many units can still be sent in the current 60s window. */
  available() {
    this.#prune();
    return Math.max(0, this.rpm - this.timestamps.length);
  }

  /** Record N completed units. */
  record(count = 1) {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      this.timestamps.push(now);
    }
  }

  /**
   * Wait until `needed` units are available, then reserve them.
   * Returns immediately if available.
   */
  async acquire(needed = 1) {
    if (needed <= 0) return;
    if (needed > this.rpm) {
      throw new AppError(
        `Requested ${needed} embedding units exceeds configured RPM of ${this.rpm}.`,
        400,
        'EMBEDDING_BATCH_TOO_LARGE'
      );
    }

    while (this.available() < needed) {
      this.#prune();
      const oldest = this.timestamps[0] || Date.now();
      const waitMs = Math.max(50, oldest + 60_000 - Date.now() + 10);
      await sleep(waitMs);
    }

    this.record(needed);
  }

  #prune() {
    const cutoff = Date.now() - 60_000;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }
}

const defaultGeminiLimiter = new EmbeddingRateLimiter(env.geminiEmbeddingRpm);
const defaultOpenRouterLimiter = new EmbeddingRateLimiter(env.openrouterEmbeddingRpm || 60);

/**
 * Validate that a vector has exactly the expected dimensions and finite numbers.
 */
export function validateEmbeddingVector(vector, expectedDimensions = env.geminiEmbeddingDimensions) {
  if (!Array.isArray(vector)) {
    throw new AppError('Embedding vector must be an array.', 500, 'INVALID_EMBEDDING');
  }
  if (vector.length !== expectedDimensions) {
    throw new AppError(
      `Embedding dimension mismatch: expected ${expectedDimensions}, got ${vector.length}.`,
      500,
      'EMBEDDING_DIMENSION_MISMATCH'
    );
  }
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
      throw new AppError('Embedding vector contains non-finite values.', 500, 'INVALID_EMBEDDING');
    }
  }
  return true;
}

/**
 * Look up cached CodeChunk rows that already have embeddings for the given hashes.
 * Returns Map<contentHash, { id, contentHash, dimensions, embeddingModel, hasEmbedding }>.
 */
export async function lookupEmbeddingCache(contentHashes, options = {}) {
  const prisma = options.prisma || getPrismaClient();
  const cfg = resolveEmbeddingConfig(options);
  const embeddingModel = options.embeddingModel || options.model || cfg.model;
  const dimensions = options.dimensions || cfg.dimensions;

  if (!contentHashes || contentHashes.length === 0) {
    return new Map();
  }

  const uniqueHashes = [...new Set(contentHashes)];

  const rows = await prisma.$queryRaw`
    SELECT id, "contentHash", "embeddingModel", dimensions,
           CASE WHEN embedding IS NOT NULL THEN true ELSE false END AS "hasEmbedding"
    FROM "CodeChunk"
    WHERE "contentHash" IN (${Prisma.join(uniqueHashes)})
      AND "embeddingModel" = ${embeddingModel}
      AND dimensions = ${dimensions}
      AND embedding IS NOT NULL
  `;

  const map = new Map();
  for (const row of rows) {
    map.set(row.contentHash, {
      id: row.id,
      contentHash: row.contentHash,
      embeddingModel: row.embeddingModel,
      dimensions: row.dimensions,
      hasEmbedding: Boolean(row.hasEmbedding),
    });
  }
  return map;
}

/**
 * Persist a chunk + embedding via parameterized SQL.
 * Upserts on (contentHash, embeddingModel, dimensions).
 */
export async function upsertChunkWithEmbedding({
  contentHash,
  content,
  embedding,
  embeddingModel,
  dimensions,
  prisma = getPrismaClient(),
  options = {},
}) {
  const cfg = resolveEmbeddingConfig({ model: embeddingModel, dimensions, ...options });
  const finalModel = embeddingModel || cfg.model;
  const finalDimensions = dimensions || cfg.dimensions;

  validateEmbeddingVector(embedding, finalDimensions);

  // Parameterized vector insert — cast is applied to the bound parameter, not interpolated SQL.
  const vectorLiteral = `[${embedding.join(',')}]`;
  const id = cryptoRandomId();

  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "CodeChunk" (id, "contentHash", content, "embeddingModel", dimensions, embedding, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6::vector, NOW())
     ON CONFLICT ("contentHash", "embeddingModel", dimensions)
     DO UPDATE SET
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding
     RETURNING id, "contentHash"`,
    id,
    contentHash,
    content,
    finalModel,
    finalDimensions,
    vectorLiteral
  );

  return rows[0];
}

/**
 * Embed a batch of texts with Gemini or OpenRouter. Accounts each text against RPM.
 * Supports injectable fetch and limiter for tests.
 *
 * @returns {Promise<number[][]>} validated vectors aligned with input texts
 */
export async function embedTexts(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const cfg = resolveEmbeddingConfig(options);
  const provider = cfg.provider;
  const apiKey = cfg.apiKey;
  const model = cfg.model;
  const dimensions = cfg.dimensions;
  const batchSize = options.batchSize || cfg.batchSize;
  const limiter = options.limiter || (provider === 'openrouter' ? defaultOpenRouterLimiter : defaultGeminiLimiter);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const maxRetries = options.maxRetries ?? 3;

  if (!apiKey) {
    const keyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
    throw new AppError(`${keyName} is required for embeddings.`, 500, 'MISSING_API_KEY');
  }

  const allVectors = new Array(texts.length);
  const batches = chunkArray(texts, batchSize);

  let offset = 0;
  for (const batch of batches) {
    await limiter.acquire(batch.length);

    const vectors = await embedBatchWithRetry(batch, {
      provider,
      apiKey,
      model,
      dimensions,
      fetchFn,
      maxRetries,
    });

    for (let i = 0; i < vectors.length; i++) {
      validateEmbeddingVector(vectors[i], dimensions);
      allVectors[offset + i] = vectors[i];
    }
    offset += batch.length;
  }

  return allVectors;
}

/**
 * Embed texts that are not already cached. Returns { cached, embedded, vectorsByHash }.
 */
export async function embedChunksWithCache(chunks, options = {}) {
  const cfg = resolveEmbeddingConfig(options);
  const embeddingModel = options.embeddingModel || options.model || cfg.model;
  const dimensions = options.dimensions || cfg.dimensions;
  const prisma = options.prisma || getPrismaClient();

  const hashes = chunks.map((c) => c.contentHash);
  const cache = await lookupEmbeddingCache(hashes, { prisma, embeddingModel, dimensions });

  const cached = [];
  const toEmbed = [];

  for (const chunk of chunks) {
    const hit = cache.get(chunk.contentHash);
    if (hit && hit.hasEmbedding) {
      cached.push({ ...chunk, chunkId: hit.id, fromCache: true });
    } else {
      toEmbed.push(chunk);
    }
  }

  const embedded = [];
  if (toEmbed.length > 0) {
    const vectors = await embedTexts(
      toEmbed.map((c) => c.content),
      { ...options, embeddingModel, dimensions, model: embeddingModel }
    );

    for (let i = 0; i < toEmbed.length; i++) {
      const chunk = toEmbed[i];
      const row = await upsertChunkWithEmbedding({
        contentHash: chunk.contentHash,
        content: chunk.content,
        embedding: vectors[i],
        embeddingModel,
        dimensions,
        prisma,
      });
      embedded.push({ ...chunk, chunkId: row.id, fromCache: false });
    }
  }

  return {
    cached,
    embedded,
    all: [...cached, ...embedded],
    cacheHits: cached.length,
    newEmbeddings: embedded.length,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function embedBatchWithRetry(texts, { provider, apiKey, model, dimensions, fetchFn, maxRetries }) {
  let attempt = 0;
  let lastError;

  while (attempt <= maxRetries) {
    try {
      if (provider === 'openrouter') {
        return await callOpenRouterBatchEmbed(texts, { apiKey, model, dimensions, fetchFn });
      }
      return await callGeminiBatchEmbed(texts, { apiKey, model, dimensions, fetchFn });
    } catch (err) {
      lastError = err;

      if (err instanceof EmbeddingQuotaExhaustedError) {
        throw err;
      }

      if (err.code === 'INVALID_API_KEY' || err.code === 'UNSUPPORTED_MODEL' || err.statusCode === 400) {
        throw err;
      }

      if (!err.retryable || attempt === maxRetries) {
        throw err;
      }

      const backoff = computeBackoffMs(attempt, err.retryAfterMs);
      await sleep(backoff);
      attempt++;
    }
  }

  throw lastError;
}

async function callOpenRouterBatchEmbed(texts, { apiKey, model, dimensions, fetchFn }) {
  const url = OPENROUTER_EMBEDDING_ENDPOINT;

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: texts.length === 1 ? texts[0] : texts,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    const err = new AppError('Invalid or unauthorized OpenRouter API key.', 401, 'INVALID_API_KEY');
    err.retryable = false;
    throw err;
  }

  if (response.status === 404) {
    const err = new AppError(`Unsupported OpenRouter embedding model: ${model}`, 400, 'UNSUPPORTED_MODEL');
    err.retryable = false;
    throw err;
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response);
    const bodyText = await safeReadText(response);
    if (isQuotaExhaustionMessage(bodyText)) {
      throw new EmbeddingQuotaExhaustedError(
        'OpenRouter embedding quota exhausted. Indexing paused with partial progress.'
      );
    }
    const err = new AppError('OpenRouter embedding rate limited.', 429, 'RATE_LIMITED');
    err.retryable = true;
    err.retryAfterMs = retryAfterMs;
    throw err;
  }

  if (isTransientHttpStatus(response.status)) {
    const err = new AppError(`OpenRouter embedding provider error: ${response.status}`, response.status, 'PROVIDER_ERROR');
    err.retryable = true;
    err.retryAfterMs = parseRetryAfterMs(response);
    throw err;
  }

  if (!response.ok) {
    const bodyText = await safeReadText(response);
    const err = new AppError(
      `OpenRouter embedding failed (${response.status}): ${bodyText.slice(0, 200)}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
      'EMBEDDING_FAILED'
    );
    err.retryable = false;
    throw err;
  }

  const data = await response.json();
  const items = data.data || [];

  if (!Array.isArray(items) || items.length !== texts.length) {
    throw new AppError(
      `OpenRouter returned ${items?.length ?? 0} embeddings for ${texts.length} inputs.`,
      502,
      'EMBEDDING_COUNT_MISMATCH'
    );
  }

  // Sort by index if provided by OpenAI-compatible format to guarantee ordering
  items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return items.map((item) => {
    const values = item.embedding;
    if (!Array.isArray(values)) {
      throw new AppError('OpenRouter embedding response missing embedding array.', 502, 'INVALID_EMBEDDING');
    }
    return values;
  });
}

async function callGeminiBatchEmbed(texts, { apiKey, model, dimensions, fetchFn }) {
  const url = `${EMBEDDING_ENDPOINT}/models/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;

  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: dimensions,
    })),
  };

  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 401 || response.status === 403) {
    const err = new AppError('Invalid or unauthorized Gemini API key.', 401, 'INVALID_API_KEY');
    err.retryable = false;
    throw err;
  }

  if (response.status === 404) {
    const err = new AppError(`Unsupported Gemini embedding model: ${model}`, 400, 'UNSUPPORTED_MODEL');
    err.retryable = false;
    throw err;
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response);
    const bodyText = await safeReadText(response);
    if (isQuotaExhaustionMessage(bodyText)) {
      throw new EmbeddingQuotaExhaustedError(
        'Gemini embedding quota exhausted. Indexing paused with partial progress.'
      );
    }
    const err = new AppError('Gemini embedding rate limited.', 429, 'RATE_LIMITED');
    err.retryable = true;
    err.retryAfterMs = retryAfterMs;
    throw err;
  }

  if (isTransientHttpStatus(response.status)) {
    const err = new AppError(`Gemini embedding provider error: ${response.status}`, response.status, 'PROVIDER_ERROR');
    err.retryable = true;
    err.retryAfterMs = parseRetryAfterMs(response);
    throw err;
  }

  if (!response.ok) {
    const bodyText = await safeReadText(response);
    const err = new AppError(
      `Gemini embedding failed (${response.status}): ${bodyText.slice(0, 200)}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
      'EMBEDDING_FAILED'
    );
    err.retryable = false;
    throw err;
  }

  const data = await response.json();
  const embeddings = data.embeddings || data.responses || [];

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new AppError(
      `Gemini returned ${embeddings?.length ?? 0} embeddings for ${texts.length} inputs.`,
      502,
      'EMBEDDING_COUNT_MISMATCH'
    );
  }

  return embeddings.map((item) => {
    const values = item.values || item.embedding?.values || item.embedding;
    if (!Array.isArray(values)) {
      throw new AppError('Gemini embedding response missing values array.', 502, 'INVALID_EMBEDDING');
    }
    return values;
  });
}

function isQuotaExhaustionMessage(text) {
  const lower = (text || '').toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('billing') ||
    lower.includes('exceeded your current quota')
  );
}

function parseRetryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function computeBackoffMs(attempt, retryAfterMs) {
  if (retryAfterMs != null && Number.isFinite(retryAfterMs)) {
    return Math.min(60_000, Math.max(100, retryAfterMs));
  }
  const base = Math.min(30_000, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Exposed for tests */
export const _internals = {
  callGeminiBatchEmbed,
  callOpenRouterBatchEmbed,
  computeBackoffMs,
  isQuotaExhaustionMessage,
  parseRetryAfterMs,
  defaultGeminiLimiter,
  defaultOpenRouterLimiter,
  defaultLimiter: defaultGeminiLimiter,
};
