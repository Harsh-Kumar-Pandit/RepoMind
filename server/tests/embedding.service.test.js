import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEmbeddingVector,
  EmbeddingRateLimiter,
  EmbeddingQuotaExhaustedError,
  embedTexts,
  _internals,
} from '../src/services/embedding.service.js';

test('Embedding Service - Dimension Validation', async (t) => {
  await t.test('accepts exact 768-dimensional finite vectors', () => {
    const vector = Array.from({ length: 768 }, (_, i) => i * 0.001);
    assert.equal(validateEmbeddingVector(vector, 768), true);
  });

  await t.test('rejects dimension mismatches', () => {
    assert.throws(() => validateEmbeddingVector([1, 2, 3], 768), /dimension mismatch/i);
    assert.throws(() => validateEmbeddingVector(Array(3072).fill(0.1), 768), /dimension mismatch/i);
  });

  await t.test('rejects non-finite values and non-arrays', () => {
    const bad = Array(768).fill(0);
    bad[10] = Number.NaN;
    assert.throws(() => validateEmbeddingVector(bad, 768), /non-finite/i);
    assert.throws(() => validateEmbeddingVector(null, 768), /must be an array/i);
  });
});

test('Embedding Service - RPM Quota Accounting (batch != 1 unit)', async (t) => {
  await t.test('counts each item in a batch against RPM', async () => {
    const limiter = new EmbeddingRateLimiter(5);
    await limiter.acquire(3);
    assert.equal(limiter.available(), 2);
    await limiter.acquire(2);
    assert.equal(limiter.available(), 0);
  });

  await t.test('rejects acquire larger than RPM window', async () => {
    const limiter = new EmbeddingRateLimiter(4);
    await assert.rejects(() => limiter.acquire(5), /exceeds configured RPM/i);
  });
});

test('Embedding Service - Batch Embed + Retries + Quota Pause', async (t) => {
  await t.test('embeds a batch and validates returned dimensions', async () => {
    const fakeVector = Array(768).fill(0.01);
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        embeddings: [{ values: fakeVector }, { values: fakeVector }],
      }),
    });

    const limiter = new EmbeddingRateLimiter(30);
    const vectors = await embedTexts(['hello', 'world'], {
      apiKey: 'test-key',
      model: 'gemini-embedding-001',
      dimensions: 768,
      batchSize: 16,
      limiter,
      fetchFn,
      maxRetries: 0,
    });

    assert.equal(vectors.length, 2);
    assert.equal(vectors[0].length, 768);
    assert.equal(limiter.available(), 28); // 2 units consumed
  });

  await t.test('retries transient 429 then succeeds', async () => {
    let calls = 0;
    const fakeVector = Array(768).fill(0.02);
    const fetchFn = async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '0' }),
          text: async () => 'rate limit, try again',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ embeddings: [{ values: fakeVector }] }),
      };
    };

    const vectors = await embedTexts(['retry-me'], {
      apiKey: 'test-key',
      dimensions: 768,
      limiter: new EmbeddingRateLimiter(30),
      fetchFn,
      maxRetries: 2,
    });

    assert.equal(vectors.length, 1);
    assert.equal(calls, 2);
  });

  await t.test('throws EmbeddingQuotaExhaustedError without endless retries', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => 'You exceeded your current quota / resource_exhausted',
    });

    await assert.rejects(
      () =>
        embedTexts(['quota'], {
          apiKey: 'test-key',
          dimensions: 768,
          limiter: new EmbeddingRateLimiter(30),
          fetchFn,
          maxRetries: 5,
        }),
      (err) => err instanceof EmbeddingQuotaExhaustedError
    );
  });

  await t.test('does not retry invalid API key or unsupported model', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return {
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'invalid key',
      };
    };

    await assert.rejects(
      () =>
        embedTexts(['x'], {
          apiKey: 'bad',
          dimensions: 768,
          limiter: new EmbeddingRateLimiter(30),
          fetchFn,
          maxRetries: 3,
        }),
      /unauthorized|Invalid/i
    );
    assert.equal(calls, 1);
  });
});

test('Embedding Service - Quota message detection helper', () => {
  assert.equal(_internals.isQuotaExhaustionMessage('RESOURCE_EXHAUSTED quota'), true);
  assert.equal(_internals.isQuotaExhaustionMessage('rate limit try later'), false);
});

test('Embedding Service - OpenRouter LiquidAI Provider Support', async (t) => {
  await t.test('embeds texts using OpenRouter endpoint and validates 1024 dimensions', async () => {
    const fakeVector = Array(1024).fill(0.005);
    const fetchFn = async (url, opts) => {
      assert.ok(url.includes('openrouter.ai'));
      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'liquid/lfm-2.5-embedding-350m:free');
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: [{ embedding: fakeVector, index: 0 }],
        }),
      };
    };

    const limiter = new EmbeddingRateLimiter(60);
    const vectors = await embedTexts(['hello liquid'], {
      provider: 'openrouter',
      apiKey: 'test-or-key',
      model: 'liquid/lfm-2.5-embedding-350m:free',
      dimensions: 1024,
      limiter,
      fetchFn,
      maxRetries: 0,
    });

    assert.equal(vectors.length, 1);
    assert.equal(vectors[0].length, 1024);
  });

  await t.test('auto-selects OpenRouter when model contains slash', async () => {
    const fakeVector = Array(1024).fill(0.005);
    let calledUrl = '';
    const fetchFn = async (url) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: [{ embedding: fakeVector, index: 0 }],
        }),
      };
    };

    const vectors = await embedTexts(['auto-detect'], {
      apiKey: 'test-or-key',
      model: 'liquid/lfm-2.5-embedding-350m:free',
      dimensions: 1024,
      limiter: new EmbeddingRateLimiter(60),
      fetchFn,
      maxRetries: 0,
    });

    assert.ok(calledUrl.includes('openrouter.ai'));
    assert.equal(vectors[0].length, 1024);
  });
});

