import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

// Supported file extensions mapped to language identifier
const SUPPORTED_EXTENSIONS = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
};

// Excluded directories and file patterns
const EXCLUDED_DIR_PATTERNS = [
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)vendor(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)build(\/|$)/i,
  /(^|\/)out(\/|$)/i,
  /(^|\/)coverage(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.github(\/|$)/i,
  /(^|\/)\.vscode(\/|$)/i,
  /(^|\/)\.idea(\/|$)/i,
  /(^|\/)target(\/|$)/i,
  /(^|\/)bin(\/|$)/i,
  /(^|\/)obj(\/|$)/i,
  /(^|\/)__pycache__(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.nuxt(\/|$)/i,
  /(^|\/)\.cache(\/|$)/i,
];

const EXCLUDED_FILE_PATTERNS = [
  /\.min\.(js|css)$/i,
  /\.bundle\.(js|css)$/i,
  /\.map$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /Cargo\.lock$/i,
  /poetry\.lock$/i,
  /Gemfile\.lock$/i,
  /composer\.lock$/i,
];

/**
 * Validates and extracts owner and repository name from a GitHub URL.
 * Prevents SSRF, non-GitHub hosts, and path traversal.
 */
export function parseGitHubUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('A valid GitHub repository URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Malformed URL provided.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS GitHub repository URLs are supported.');
  }

  // Reject raw IP hosts and non-GitHub hostnames (SSRF prevention)
  const hostname = parsed.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Invalid host. Only repositories hosted on github.com are supported.');
  }
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    throw new Error('Invalid host. Only repositories hosted on github.com are supported.');
  }

  // Path format: /owner/repo or /owner/repo/
  const segments = parsed.pathname
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new Error('Invalid GitHub repository path. Expected https://github.com/owner/repository');
  }

  const owner = segments[0];
  let repo = segments[1];

  // Strip .git suffix if present
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Validate owner and repo names (standard GitHub format: alphanumeric, hyphens, underscores)
  const nameRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!nameRegex.test(owner) || !nameRegex.test(repo)) {
    throw new Error('Invalid characters in GitHub repository owner or name.');
  }

  // Prevent path traversal segments
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw new Error('Invalid repository path segments.');
  }

  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Helper to make rate-limited and timeout-bounded GitHub API requests.
 */
async function fetchGitHubApi(endpoint, options = {}) {
  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
  const authToken = options.token || env.githubToken;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'RepoMind-Backend/1.0',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };

  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchFn = options.fetchFn || fetch;
    const response = await fetchFn(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new AppError(
        'GitHub authentication failed: configured GitHub token is invalid or expired. Check server configuration.',
        401,
        'GITHUB_AUTH_FAILED'
      );
    }

    if (response.status === 404) {
      throw new AppError(
        'GitHub repository or resource not found (it may be private, deleted, or inaccessible).',
        404,
        'GITHUB_RESOURCE_NOT_FOUND'
      );
    }

    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetTime = response.headers.get('x-ratelimit-reset');
      const retryAfter = response.headers.get('retry-after');

      // Primary rate limit (remaining = 0)
      if (remaining === '0') {
        const resetIso = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toISOString() : null;
        const msg = resetIso
          ? `GitHub API rate limit exceeded. Resets at ${resetIso}.`
          : 'GitHub API rate limit exceeded. Please try again later.';
        const err = new AppError(msg, 429, 'GITHUB_RATE_LIMITED');
        err.resetIso = resetIso;
        err.resetTimestamp = resetTime ? parseInt(resetTime, 10) : null;
        throw err;
      }

      // Secondary rate limit / abuse detection or retry-after header
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // ignore
      }

      if (/secondary rate limit|abuse|rate limit/i.test(bodyText) || response.status === 429) {
        const resetIso = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toISOString() : null;
        const msg = resetIso
          ? `GitHub API secondary rate limit exceeded. Resets at ${resetIso}.`
          : `GitHub API request rate-limited (${retryAfter ? `retry after ${retryAfter}s` : 'please wait and try again later'}).`;
        const err = new AppError(msg, 429, 'GITHUB_RATE_LIMITED');
        err.resetIso = resetIso;
        err.retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
        throw err;
      }

      throw new AppError(
        'Access forbidden by GitHub API (insufficient permissions or repository access restricted).',
        403,
        'GITHUB_FORBIDDEN'
      );
    }

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // ignore
      }
      throw new AppError(
        `GitHub API error: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText.slice(0, 150)}` : ''}`,
        response.status >= 500 ? 502 : response.status,
        'GITHUB_API_ERROR'
      );
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError(`GitHub request timed out after ${timeoutMs}ms.`, 504, 'GITHUB_TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches repository metadata including default branch.
 */
export async function getRepositoryMetadata(owner, repo, options = {}) {
  const data = await fetchGitHubApi(`/repos/${owner}/${repo}`, options);
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description || '',
    defaultBranch: data.default_branch || 'main',
    isPrivate: data.private,
    sizeKb: data.size,
    stars: data.stargazers_count,
  };
}

/**
 * Resolves the commit SHA for a specific branch or commit reference.
 */
export async function resolveCommitSha(owner, repo, branchOrSha, options = {}) {
  // If user passed a full 40-char SHA
  if (/^[a-f0-9]{40}$/i.test(branchOrSha)) {
    return branchOrSha;
  }

  // Fetch commit for reference (branch or tag)
  const data = await fetchGitHubApi(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branchOrSha)}`, options);
  return data.sha;
}

/**
 * Checks if a file path is eligible for indexing based on extension, size, and exclusion rules.
 */
export function isFileEligible(filePath, size = 0, limits = env) {
  // Check exclusions
  for (const pattern of EXCLUDED_DIR_PATTERNS) {
    if (pattern.test(filePath)) return { eligible: false, reason: 'excluded_directory' };
  }

  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    if (pattern.test(filePath)) return { eligible: false, reason: 'excluded_file_pattern' };
  }

  // Size limit check
  if (size > limits.indexingMaxFileSizeBytes) {
    return { eligible: false, reason: 'file_too_large' };
  }

  // Extension check
  const lastDot = filePath.lastIndexOf('.');
  const ext = lastDot !== -1 ? filePath.slice(lastDot).toLowerCase() : '';
  const isReadme = /(^|\/)README(\.[a-z0-9]+)?$/i.test(filePath);
  const isConfigManifest = /(^|\/)(package\.json|tsconfig\.json|requirements\.txt|pom\.xml|go\.mod|Cargo\.toml)$/i.test(filePath);

  if (isReadme || isConfigManifest || SUPPORTED_EXTENSIONS[ext]) {
    const language = isReadme
      ? 'markdown'
      : (isConfigManifest && ext === '.json' ? 'json' : SUPPORTED_EXTENSIONS[ext] || 'text');
    return { eligible: true, language, ext };
  }

  return { eligible: false, reason: 'unsupported_extension' };
}

/**
 * Prioritizes files deterministically:
 * Priority 1: README and root documentation
 * Priority 2: Core manifests (package.json, requirements.txt, etc.)
 * Priority 3: Source files
 */
function getFilePriority(filePath) {
  const lower = filePath.toLowerCase();
  if (lower === 'readme.md' || lower === 'readme') return 1;
  if (/^docs?\//.test(lower) && lower.endsWith('.md')) return 2;
  if (lower.endsWith('.md')) return 3;
  if (['package.json', 'requirements.txt', 'go.mod', 'cargo.toml', 'pom.xml', 'tsconfig.json'].includes(lower)) return 4;
  if (/^(src|lib|app|pkg|internal)\//.test(lower)) return 5;
  return 6;
}

/**
 * Fetches the recursive git tree for a given commit SHA and filters eligible files.
 */
export async function getEligibleFilesFromTree(owner, repo, commitSha, limits = env, options = {}) {
  const data = await fetchGitHubApi(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`, options);

  if (!data.tree || !Array.isArray(data.tree)) {
    throw new AppError('Invalid tree response received from GitHub API.', 502, 'INVALID_TREE_RESPONSE');
  }

  const eligibleFiles = [];
  let totalBytes = 0;

  for (const item of data.tree) {
    if (item.type !== 'blob') continue; // only files

    const check = isFileEligible(item.path, item.size || 0, limits);
    if (check.eligible) {
      eligibleFiles.push({
        path: item.path,
        sha: item.sha,
        size: item.size || 0,
        language: check.language,
        priority: getFilePriority(item.path),
      });
    }
  }

  // Sort deterministically by priority, then by path
  eligibleFiles.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.path.localeCompare(b.path);
  });

  // Apply maximum file cap
  const maxFiles = limits.indexingMaxFiles;
  const cappedFiles = [];

  for (const file of eligibleFiles) {
    if (cappedFiles.length >= maxFiles) break;
    if (totalBytes + file.size > limits.indexingMaxTotalBytes) break;

    cappedFiles.push(file);
    totalBytes += file.size;
  }

  return {
    totalTreeFiles: data.tree.filter(i => i.type === 'blob').length,
    eligibleCount: eligibleFiles.length,
    cappedFiles,
    totalBytesSelected: totalBytes,
    isTruncated: Boolean(data.truncated) || cappedFiles.length < eligibleFiles.length,
  };
}

/**
 * Fetches the contents of a list of files with bounded concurrency.
 */
export async function fetchFileContentsConcurrently(
  owner,
  repo,
  files,
  concurrency = env.githubConcurrency,
  options = {}
) {
  const results = [];
  const queue = [...files];
  const activeWorkers = [];

  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      try {
        let content = '';

        if (file.sha) {
          // Fetch blob directly via git blob API
          const blobData = await fetchGitHubApi(`/repos/${owner}/${repo}/git/blobs/${file.sha}`, options);
          if (blobData.encoding === 'base64') {
            content = Buffer.from(blobData.content, 'base64').toString('utf8');
          } else {
            content = blobData.content || '';
          }
        } else {
          // If no git blob sha is available (e.g. cached file records), trigger raw content access directly
          throw new AppError('No git blob SHA available; attempting raw content access.', 429, 'RAW_FALLBACK_REQUIRED');
        }

        results.push({
          ...file,
          content,
          success: true,
        });
      } catch (err) {
        // If git blob API fails due to rate-limit/forbidden on public repos, attempt raw.githubusercontent.com fallback
        let rawContent = null;
        if (options.commitSha && file.path && /rate limit|forbidden|403|429|RAW_FALLBACK/i.test(err.message)) {
          try {
            const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(options.commitSha)}/${encodeURIComponent(file.path).replace(/%2F/g, '/')}`;
            const rawRes = await (options.fetchFn || fetch)(rawUrl, {
              headers: { 'User-Agent': 'RepoMind-Backend/1.0' },
            });
            if (rawRes.status === 200) {
              rawContent = await rawRes.text();
            }
          } catch {
            // ignore raw fallback errors
          }
        }

        if (rawContent !== null) {
          results.push({
            ...file,
            content: rawContent,
            success: true,
          });
        } else {
          const isRateLimit = err.code === 'GITHUB_RATE_LIMITED' || /rate limit|429/i.test(err.message);
          results.push({
            ...file,
            content: '',
            success: false,
            error: err.message,
            rateLimited: isRateLimit,
            resetIso: err.resetIso,
          });
        }
      }
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, files.length));
  for (let i = 0; i < poolSize; i++) {
    activeWorkers.push(worker());
  }

  await Promise.all(activeWorkers);
  return results;
}

/**
 * Fetches exact file content from GitHub by owner, repo, commitSha, and path.
 * Returns UTF-8 string content or null if not found.
 */
export async function fetchGitHubFileContent(owner, repo, commitSha, filePath) {
  try {
    const data = await fetchGitHubApi(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(commitSha)}`
    );

    if (!data || data.type !== 'file') {
      return null;
    }

    if (data.encoding === 'base64' && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }

    return data.content || '';
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return null;
    }
    // If rate-limited or forbidden on GitHub REST API, attempt fetching from raw.githubusercontent.com for public repositories
    if (err.message && /rate limit|forbidden|403|429/i.test(err.message)) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
        const rawRes = await fetch(rawUrl, {
          headers: { 'User-Agent': 'RepoMind-Backend/1.0' },
        });
        if (rawRes.status === 200) {
          return await rawRes.text();
        }
        if (rawRes.status === 404) {
          return null;
        }
      } catch {
        // Fall through to throw original error
      }
    }
    throw err;
  }
}
