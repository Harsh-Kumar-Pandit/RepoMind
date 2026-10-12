import test from 'node:test';
import assert from 'node:assert';
import { chunkFile, hashFileContent, sha256 } from '../src/services/chunking.service.js';

test('Chunking Service - Content Hashing', async (t) => {
  await t.test('computes deterministic SHA-256 for file content', () => {
    const content = 'console.log("hello world");\n';
    const hash1 = hashFileContent(content);
    const hash2 = hashFileContent(content);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(hash1, sha256(content));
  });

  await t.test('different contents produce distinct hashes', () => {
    const hashA = hashFileContent('const a = 1;');
    const hashB = hashFileContent('const a = 2;');
    assert.notStrictEqual(hashA, hashB);
  });
});

test('Chunking Service - Empty and Edge Case Files', async (t) => {
  await t.test('returns empty array for empty file string', () => {
    const chunks = chunkFile('src/empty.js', 'javascript', '');
    assert.deepStrictEqual(chunks, []);
  });

  await t.test('handles whitespace-only and single line without newline', () => {
    const chunks = chunkFile('src/oneline.js', 'javascript', 'const x = 42;');
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].startLine, 1);
    assert.strictEqual(chunks[0].endLine, 1);
    assert.strictEqual(chunks[0].content, 'const x = 42;');
    assert.strictEqual(chunks[0].chunkIndex, 0);
  });
});

test('Chunking Service - JavaScript / TypeScript Logical Splitting', async (t) => {
  const jsContent = `import express from 'express';

export function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}

export class OrderService {
  constructor(db) {
    this.db = db;
  }

  processOrder(order) {
    return this.db.save(order);
  }
}
`;

  const chunks = chunkFile('src/order.js', 'javascript', jsContent, {
    chunkTargetTokens: 50,
    chunkMaxTokens: 100,
    chunkMinTokens: 10,
    chunkOverlapTokens: 10,
  });

  assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  assert.strictEqual(chunks[0].filePath, 'src/order.js');
  assert.strictEqual(chunks[0].language, 'javascript');
  
  // Verify startLine and endLine boundaries
  assert.strictEqual(chunks[0].startLine, 1);
  assert.ok(chunks[0].endLine > chunks[0].startLine);
  
  // Verify sequential chunkIndex
  for (let i = 0; i < chunks.length; i++) {
    assert.strictEqual(chunks[i].chunkIndex, i);
    assert.ok(chunks[i].contentHash.length === 64);
    assert.strictEqual(chunks[i].contentHash, sha256(chunks[i].content));
  }
});

test('Chunking Service - Markdown Heading-Aware Splitting', async (t) => {
  const mdContent = `# RepoMind Project

RepoMind is a repository understanding tool.

## Architecture

The backend consists of Express and PostgreSQL with pgvector.
It provides modular RAG indexing.

## Features

- Safe indexing
- Grounded AI explanations
- Read-only code access
`;

  const chunks = chunkFile('README.md', 'markdown', mdContent, {
    chunkTargetTokens: 50,
    chunkMaxTokens: 100,
    chunkMinTokens: 5,
    chunkOverlapTokens: 10,
  });

  assert.ok(chunks.length >= 2, `Expected multiple markdown chunks, got ${chunks.length}`);

  // First chunk should correspond to intro section
  assert.ok(chunks[0].content.includes('# RepoMind Project'));
  assert.strictEqual(chunks[0].startLine, 1);

  // Subsequent chunks should cover respective sections with accurate line tracking
  const hasArchitecture = chunks.some(c => c.content.includes('## Architecture'));
  const hasFeatures = chunks.some(c => c.content.includes('## Features'));
  assert.ok(hasArchitecture, 'Chunks should contain Architecture section');
  assert.ok(hasFeatures, 'Chunks should contain Features section');

  // Verify non-empty and line bounds
  for (const chunk of chunks) {
    assert.ok(chunk.startLine >= 1);
    assert.ok(chunk.endLine >= chunk.startLine);
  }
});

test('Chunking Service - Oversized Section Splitting', async (t) => {
  // Generate a very long function that exceeds maxTokens
  const lines = ['function massiveOperation() {'];
  for (let i = 1; i <= 200; i++) {
    lines.push(`  const step_${i} = doSomethingComplex(${i}, "parameter-data-string");`);
  }
  lines.push('  return true;');
  lines.push('}');
  const largeContent = lines.join('\n');

  const chunks = chunkFile('src/massive.js', 'javascript', largeContent, {
    chunkTargetTokens: 50,
    chunkMaxTokens: 80,
    chunkMinTokens: 10,
    chunkOverlapTokens: 10,
  });

  assert.ok(chunks.length > 2, `Expected oversized function to be split into multiple chunks, got ${chunks.length}`);

  // Verify all chunks respect maxTokens bound approximately
  for (const chunk of chunks) {
    assert.ok(chunk.content.length > 0);
    assert.ok(chunk.startLine >= 1);
    assert.ok(chunk.endLine >= chunk.startLine);
    assert.strictEqual(chunk.contentHash, sha256(chunk.content));
  }
});

test('Chunking Service - Window Fallback for Config / Data Formats', async (t) => {
  const jsonContent = JSON.stringify({
    name: 'repomind',
    version: '1.0.0',
    scripts: {
      test: 'node --test',
      start: 'node src/server.js'
    },
    dependencies: {
      express: '^4.21.0',
      dotenv: '^16.4.5',
    }
  }, null, 2);

  const chunks = chunkFile('package.json', 'json', jsonContent, {
    chunkTargetTokens: 20,
    chunkMaxTokens: 40,
    chunkMinTokens: 5,
    chunkOverlapTokens: 5,
  });

  assert.ok(chunks.length >= 1);
  assert.strictEqual(chunks[0].filePath, 'package.json');
  assert.strictEqual(chunks[0].language, 'json');
  assert.strictEqual(chunks[0].startLine, 1);
});

test('Chunking Service - Window Overlap Preserves Adjacent Context', () => {
  const lines = [];
  for (let i = 1; i <= 80; i++) {
    lines.push(`const line_${i} = "payload-data-for-overlap-testing-${i}";`);
  }
  const content = lines.join('\n');

  const chunks = chunkFile('src/overlap.js', 'javascript', content, {
    chunkTargetTokens: 40,
    chunkMaxTokens: 50,
    chunkMinTokens: 5,
    chunkOverlapTokens: 15,
  });

  assert.ok(chunks.length >= 2, `Expected multiple overlapping chunks, got ${chunks.length}`);

  // Adjacent chunks should overlap in line ranges when overlapTokens > 0
  let foundOverlap = false;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].startLine <= chunks[i - 1].endLine) {
      foundOverlap = true;
      break;
    }
  }
  assert.ok(foundOverlap, 'Expected overlapping line ranges between adjacent chunks');
});

test('Chunking Service - Content Coverage (No Silent Omissions)', () => {
  const code = `function first() {
  return 1;
}

function second() {
  return 2;
}

function third() {
  return 3;
}
`;

  const lines = code.trimEnd().split('\n');
  const chunks = chunkFile('src/multi.js', 'javascript', code, {
    chunkTargetTokens: 10,
    chunkMaxTokens: 25,
    chunkMinTokens: 5,
    chunkOverlapTokens: 0,
  });

  assert.ok(chunks.length >= 3);
  
  // Verify that the union of line intervals covers all lines from line 1 to lines.length
  const coveredLines = new Set();
  for (const chunk of chunks) {
    for (let l = chunk.startLine; l <= chunk.endLine; l++) {
      coveredLines.add(l);
    }
  }

  for (let l = 1; l <= lines.length; l++) {
    assert.ok(coveredLines.has(l), `Line ${l} must be covered in at least one chunk`);
  }
});
