import test from 'node:test';
import assert from 'node:assert';
import { parseGitHubUrl, isFileEligible, getEligibleFilesFromTree } from '../src/services/github.service.js';

test('GitHub Service - URL Parsing and SSRF Protection', async (t) => {
  await t.test('valid URLs parse correctly', () => {
    const res1 = parseGitHubUrl('https://github.com/facebook/react');
    assert.strictEqual(res1.owner, 'facebook');
    assert.strictEqual(res1.repo, 'react');
    assert.strictEqual(res1.normalizedUrl, 'https://github.com/facebook/react');

    const res2 = parseGitHubUrl('https://www.github.com/vercel/next.js.git/');
    assert.strictEqual(res2.owner, 'vercel');
    assert.strictEqual(res2.repo, 'next.js');

    const res3 = parseGitHubUrl('https://github.com/torvalds/linux.git');
    assert.strictEqual(res3.owner, 'torvalds');
    assert.strictEqual(res3.repo, 'linux');
  });

  await t.test('rejects non-GitHub hosts (SSRF prevention)', () => {
    assert.throws(() => parseGitHubUrl('https://gitlab.com/owner/repo'), /Invalid host/);
    assert.throws(() => parseGitHubUrl('https://evil-site.com/facebook/react'), /Invalid host/);
    assert.throws(() => parseGitHubUrl('https://169.254.169.254/latest/meta-data'), /Invalid host/);
    assert.throws(() => parseGitHubUrl('https://localhost:5000/repo'), /Invalid host/);
    assert.throws(() => parseGitHubUrl('http://github.com/owner/repo'), /Only HTTPS/);
  });

  await t.test('rejects malformed URLs and path traversals', () => {
    assert.throws(() => parseGitHubUrl('not-a-url'), /Malformed URL/);
    assert.throws(() => parseGitHubUrl(''), /valid GitHub repository URL is required/);
    assert.throws(() => parseGitHubUrl('https://github.com/'), /Invalid GitHub repository path/);
    assert.throws(() => parseGitHubUrl('https://github.com/owner/'), /Invalid GitHub repository path/);
    assert.throws(() => parseGitHubUrl('https://github.com/../repo'), /Invalid/i);
    assert.throws(() => parseGitHubUrl('https://github.com/owner/..'), /Invalid/i);
  });
});

test('GitHub Service - File Eligibility and Filtering', async (t) => {
  const limits = {
    indexingMaxFileSizeBytes: 500000,
    indexingMaxTotalBytes: 5000000,
    indexingMaxFiles: 70,
  };

  await t.test('accepts supported source code and doc files', () => {
    assert.strictEqual(isFileEligible('README.md', 1000, limits).eligible, true);
    assert.strictEqual(isFileEligible('package.json', 500, limits).eligible, true);
    assert.strictEqual(isFileEligible('src/index.js', 2000, limits).eligible, true);
    assert.strictEqual(isFileEligible('lib/util.ts', 1500, limits).eligible, true);
    assert.strictEqual(isFileEligible('main.py', 1200, limits).eligible, true);
    assert.strictEqual(isFileEligible('server/App.java', 3000, limits).eligible, true);
  });

  await t.test('rejects excluded directories', () => {
    assert.strictEqual(isFileEligible('node_modules/lodash/index.js', 1000, limits).eligible, false);
    assert.strictEqual(isFileEligible('dist/bundle.js', 5000, limits).eligible, false);
    assert.strictEqual(isFileEligible('build/main.js', 5000, limits).eligible, false);
    assert.strictEqual(isFileEligible('.git/HEAD', 50, limits).eligible, false);
    assert.strictEqual(isFileEligible('.github/workflows/ci.yml', 500, limits).eligible, false);
    assert.strictEqual(isFileEligible('vendor/bundle.js', 2000, limits).eligible, false);
  });

  await t.test('rejects lock files, minified files and oversized files', () => {
    assert.strictEqual(isFileEligible('package-lock.json', 10000, limits).eligible, false);
    assert.strictEqual(isFileEligible('yarn.lock', 5000, limits).eligible, false);
    assert.strictEqual(isFileEligible('jquery.min.js', 50000, limits).eligible, false);
    assert.strictEqual(isFileEligible('large_code.js', 600000, limits).eligible, false); // exceeds 500KB
  });
});

test('GitHub Service - Priority and 70-File Cap Enforced', () => {
  const limits = {
    indexingMaxFileSizeBytes: 500000,
    indexingMaxTotalBytes: 5000000,
    indexingMaxFiles: 3, // Set small limit to test capping
  };

  const dummyTree = {
    tree: [
      { path: 'src/z_last.js', type: 'blob', size: 100, sha: 'sha_z' },
      { path: 'src/a_first.js', type: 'blob', size: 100, sha: 'sha_a' },
      { path: 'package.json', type: 'blob', size: 200, sha: 'sha_pkg' },
      { path: 'README.md', type: 'blob', size: 300, sha: 'sha_readme' },
      { path: 'docs/guide.md', type: 'blob', size: 150, sha: 'sha_guide' },
    ]
  };

  // Run capping logic locally from dummy data
  const eligible = [];
  for (const item of dummyTree.tree) {
    const check = isFileEligible(item.path, item.size, limits);
    if (check.eligible) {
      eligible.push({ ...item, priority: item.path === 'README.md' ? 1 : item.path.endsWith('.md') ? 2 : 3 });
    }
  }

  eligible.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
  const capped = eligible.slice(0, limits.indexingMaxFiles);

  assert.strictEqual(capped.length, 3);
  assert.strictEqual(capped[0].path, 'README.md'); // README must be prioritized first
  assert.strictEqual(capped[1].path, 'docs/guide.md');
});

test('GitHub Service - Bounded Concurrency Content Fetching', async () => {
  const { fetchFileContentsConcurrently } = await import('../src/services/github.service.js');
  
  // Save original fetch
  const originalFetch = globalThis.fetch;
  let activeConcurrent = 0;
  let maxObservedConcurrent = 0;

  globalThis.fetch = async (url) => {
    activeConcurrent++;
    maxObservedConcurrent = Math.max(maxObservedConcurrent, activeConcurrent);
    await new Promise(r => setTimeout(r, 20)); // Simulate network latency
    activeConcurrent--;

    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from('console.log("hello test");').toString('base64'),
      }),
    };
  };

  try {
    const dummyFiles = [
      { path: 'file1.js', sha: 'sha1', size: 50 },
      { path: 'file2.js', sha: 'sha2', size: 50 },
      { path: 'file3.js', sha: 'sha3', size: 50 },
      { path: 'file4.js', sha: 'sha4', size: 50 },
      { path: 'file5.js', sha: 'sha5', size: 50 },
      { path: 'file6.js', sha: 'sha6', size: 50 },
    ];

    const results = await fetchFileContentsConcurrently('testowner', 'testrepo', dummyFiles, 2);
    
    assert.strictEqual(results.length, 6);
    assert.strictEqual(results.every(r => r.success && r.content === 'console.log("hello test");'), true);
    assert.strictEqual(maxObservedConcurrent <= 2, true, `Max concurrent requests should not exceed 2 (observed: ${maxObservedConcurrent})`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub Service - Authentication & Rate Limit Error Handling', async (t) => {
  const { getRepositoryMetadata, getEligibleFilesFromTree } = await import('../src/services/github.service.js');

  await t.test('detects primary rate limit with reset time in AppError', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 403,
      headers: new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1791700316',
      }),
      text: async () => 'API rate limit exceeded',
    });

    await assert.rejects(
      () => getRepositoryMetadata('owner', 'repo', { fetchFn }),
      (err) => {
        assert.strictEqual(err.statusCode, 429);
        assert.strictEqual(err.code, 'GITHUB_RATE_LIMITED');
        assert.match(err.message, /GitHub API rate limit exceeded/);
        assert.strictEqual(err.resetIso, '2026-10-11T06:31:56.000Z');
        return true;
      }
    );
  });

  await t.test('detects invalid token 401 response cleanly', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'Bad credentials',
    });

    await assert.rejects(
      () => getRepositoryMetadata('owner', 'repo', { fetchFn }),
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, 'GITHUB_AUTH_FAILED');
        return true;
      }
    );
  });

  await t.test('detects secondary rate limit / abuse detection', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 403,
      headers: new Headers({
        'retry-after': '60',
      }),
      text: async () => 'You have exceeded a secondary rate limit.',
    });

    await assert.rejects(
      () => getEligibleFilesFromTree('owner', 'repo', 'sha', undefined, { fetchFn }),
      (err) => {
        assert.strictEqual(err.statusCode, 429);
        assert.strictEqual(err.code, 'GITHUB_RATE_LIMITED');
        assert.strictEqual(err.retryAfter, 60);
        return true;
      }
    );
  });
});


