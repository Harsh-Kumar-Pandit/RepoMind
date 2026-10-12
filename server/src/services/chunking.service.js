import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Token estimation — conservative approximation (~4 chars = 1 token)
// Avoids any tokenizer dependency. Used only for splitting decisions.
// ---------------------------------------------------------------------------
const CHARS_PER_TOKEN = 4;

/** Estimate token count from raw text. */
function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Convert a token count to an approximate character count. */
function tokensToChars(tokens) {
  return tokens * CHARS_PER_TOKEN;
}

// ---------------------------------------------------------------------------
// SHA-256 helpers
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 hex hash for any string.
 * Used for:
 *   - FileRecord.contentHash  → hash of the raw file content (for incremental indexing)
 *   - CodeChunk.contentHash   → hash of the chunk text (for embedding deduplication)
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Shared chunk builder
// ---------------------------------------------------------------------------

/**
 * Build a chunk metadata object matching SnapshotChunk + CodeChunk fields.
 *
 * @param {object} opts
 * @param {string} opts.filePath   - relative file path (matches FileRecord.path)
 * @param {string} opts.language   - language identifier (matches FileRecord.language)
 * @param {number} opts.chunkIndex - 0-based index within this file
 * @param {string} opts.text       - the chunk text
 * @param {number} opts.startLine  - 1-based start line in the original file
 * @param {number} opts.endLine    - 1-based end line in the original file
 */
function makeChunk(opts) {
  const text = opts.text;
  return {
    filePath:   opts.filePath,
    language:   opts.language,
    chunkIndex: opts.chunkIndex,
    content:    text,
    contentHash: sha256(text),       // CodeChunk.contentHash
    startLine:  opts.startLine,
    endLine:    opts.endLine,
    tokenEstimate: estimateTokens(text),
  };
}

// ---------------------------------------------------------------------------
// Sliding-window fallback splitter
// Used for: json, yaml, sql, html, css, shell, and any unknown language.
// ---------------------------------------------------------------------------

/**
 * Split lines array into overlapping windows based on token budget.
 * Returns an array of { lines, startLine, endLine } (1-based line numbers).
 */
function windowSplit(lines, targetTokens, overlapTokens, maxTokens) {
  if (lines.length === 0) return [];

  const windows = [];
  let i = 0;

  while (i < lines.length) {
    let tokens = 0;
    let j = i;

    // Extend window until we hit the target or max
    while (j < lines.length) {
      const lineTokens = estimateTokens(lines[j] + '\n');
      if (tokens + lineTokens > maxTokens && j > i) break;
      tokens += lineTokens;
      j++;
      if (tokens >= targetTokens) break;
    }

    // j is exclusive end
    windows.push({ startLine: i + 1, endLine: j, lines: lines.slice(i, j) });

    if (j >= lines.length) break;

    // Compute overlap: step back by overlapTokens worth of lines
    let overlapLines = 0;
    let overlapAccum = 0;
    for (let k = j - 1; k >= i && overlapAccum < overlapTokens; k--) {
      overlapAccum += estimateTokens(lines[k] + '\n');
      overlapLines++;
    }

    const step = Math.max(1, (j - i) - overlapLines);
    i += step;
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Markdown chunker — split at heading boundaries
// ---------------------------------------------------------------------------

const MD_HEADING_RE = /^(#{1,6})\s+/;

/**
 * Chunk a Markdown file by heading boundaries.
 * Each chunk includes its heading for context when it's a continuation.
 */
function chunkMarkdown(content, filePath, language, cfg) {
  const lines = content.split('\n');
  const chunks = [];
  let chunkIndex = 0;

  // Group lines into sections demarcated by headings
  const sections = []; // { headingLine: string|null, startLine: number, lines: string[] }
  let currentSection = { headingLine: null, startLine: 1, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (MD_HEADING_RE.test(line) && currentSection.lines.length > 0) {
      sections.push(currentSection);
      currentSection = { headingLine: line, startLine: i + 1, lines: [line] };
    } else {
      if (MD_HEADING_RE.test(line)) {
        currentSection.headingLine = line;
        currentSection.startLine = i + 1;
        currentSection.lines.push(line);
      } else {
        currentSection.lines.push(line);
      }
    }
  }
  sections.push(currentSection);

  for (const section of sections) {
    if (section.lines.length === 0) continue;

    const sectionText = section.lines.join('\n');
    if (estimateTokens(sectionText) <= cfg.maxTokens) {
      const text = sectionText.trimEnd();
      if (text.length > 0 && estimateTokens(text) >= cfg.minTokens) {
        chunks.push(makeChunk({
          filePath, language, chunkIndex: chunkIndex++,
          text,
          startLine: section.startLine,
          endLine:   section.startLine + section.lines.length - 1,
        }));
      } else if (text.length > 0) {
        // Too small — merge into previous or still emit
        chunks.push(makeChunk({
          filePath, language, chunkIndex: chunkIndex++,
          text,
          startLine: section.startLine,
          endLine:   section.startLine + section.lines.length - 1,
        }));
      }
    } else {
      // Section is too large — fall back to window splitting within it
      const headingContext = section.headingLine ? section.headingLine + '\n' : '';
      const subWindows = windowSplit(section.lines, cfg.targetTokens, cfg.overlapTokens, cfg.maxTokens);
      for (const win of subWindows) {
        // Prepend heading context to continuation sub-chunks so they make sense in isolation
        const prefix = win.startLine === section.startLine ? '' : headingContext;
        const text = (prefix + win.lines.join('\n')).trimEnd();
        if (text.length > 0) {
          chunks.push(makeChunk({
            filePath, language, chunkIndex: chunkIndex++,
            text,
            startLine: section.startLine + (win.startLine - 1),
            endLine:   section.startLine + (win.endLine - 1),
          }));
        }
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Code chunker — logical boundary detection then window fallback
// ---------------------------------------------------------------------------

/**
 * Patterns that signal a top-level logical boundary.
 * We look for function, class, method declarations and blank-line groups.
 *
 * Strategy: scan for lines matching a boundary marker. When we find one,
 * close the current block and start a new one from this line.
 */
const CODE_BOUNDARY_RE = {
  javascript: /^(export\s+)?(async\s+)?function\s+\w|^(export\s+)?(default\s+)?class\s+\w|^(module\.exports|exports)\s*=/,
  typescript: /^(export\s+)?(async\s+)?function\s+\w|^(export\s+)?(default\s+)?class\s+\w|^(export\s+)?(?:const|let|var)\s+\w+\s*=\s*(async\s*)?\(|^(export\s+)?(?:const|let|var)\s+\w+\s*=\s*async\s+function/,
  python:     /^(?:async\s+)?def\s+\w|^class\s+\w/,
  java:       /^(?:public|private|protected|static|abstract|final|synchronized|\s)*(?:class|interface|enum|void|int|long|double|float|boolean|String|Object|\w+)\s+\w+\s*[\({]/,
  go:         /^func\s+/,
  rust:       /^(?:pub\s+)?(?:async\s+)?fn\s+\w|^(?:pub\s+)?struct\s+\w|^(?:pub\s+)?impl\s+/,
  csharp:     /^(?:public|private|protected|internal|static|abstract|override|virtual|\s)*(?:class|interface|struct|enum|void|\w+)\s+\w+\s*[\({]/,
  ruby:       /^(?:def|class|module)\s+\w/,
  php:        /^(?:public|private|protected|static|abstract|\s)*function\s+\w|^class\s+\w/,
  kotlin:     /^(?:fun|class|object|interface|data class)\s+\w/,
  scala:      /^(?:def|class|object|trait)\s+\w/,
  swift:      /^(?:func|class|struct|enum|protocol)\s+\w/,
};

/**
 * Split source code using logical boundary detection.
 * Falls through to window splitting when no boundaries are found.
 */
function chunkCode(content, filePath, language, cfg) {
  const lines = content.split('\n');
  const chunks = [];
  let chunkIndex = 0;

  const boundaryRe = CODE_BOUNDARY_RE[language] || null;

  // Collect logical blocks
  const blocks = []; // { startIdx: number, lines: string[] }
  let currentBlock = { startIdx: 0, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBoundary = boundaryRe && boundaryRe.test(line.trimStart()) && i > 0;

    if (isBoundary && currentBlock.lines.length > 0) {
      const blockTokens = estimateTokens(currentBlock.lines.join('\n'));
      if (blockTokens >= cfg.minTokens) {
        blocks.push(currentBlock);
        currentBlock = { startIdx: i, lines: [line] };
      } else {
        // Too small — merge into current block rather than creating a tiny chunk
        currentBlock.lines.push(line);
      }
    } else {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock.lines.length > 0) {
    blocks.push(currentBlock);
  }

  // For each block, further split if it exceeds maxTokens
  for (const block of blocks) {
    const blockText = block.lines.join('\n');
    const blockTokens = estimateTokens(blockText);

    if (blockTokens <= cfg.maxTokens) {
      const text = blockText.trimEnd();
      if (text.length > 0) {
        chunks.push(makeChunk({
          filePath, language, chunkIndex: chunkIndex++,
          text,
          startLine: block.startIdx + 1,
          endLine:   block.startIdx + block.lines.length,
        }));
      }
    } else {
      // Oversized block — window-split within it
      const subWindows = windowSplit(block.lines, cfg.targetTokens, cfg.overlapTokens, cfg.maxTokens);
      for (const win of subWindows) {
        const text = win.lines.join('\n').trimEnd();
        if (text.length > 0) {
          chunks.push(makeChunk({
            filePath, language, chunkIndex: chunkIndex++,
            text,
            startLine: block.startIdx + win.startLine,
            endLine:   block.startIdx + win.endLine,
          }));
        }
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Languages that always use window splitting (no meaningful code boundaries)
// ---------------------------------------------------------------------------
const WINDOW_ONLY_LANGUAGES = new Set([
  'json', 'yaml', 'html', 'css', 'scss', 'sql', 'shell', 'text',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Chunk a single file's content into an array of chunk metadata objects.
 *
 * Returns: Array<{
 *   filePath: string,
 *   language: string,
 *   chunkIndex: number,
 *   content: string,           // chunk text — stored in CodeChunk.content
 *   contentHash: string,       // SHA-256 of chunk text — CodeChunk.contentHash
 *   startLine: number,         // 1-based — SnapshotChunk.startLine
 *   endLine: number,           // 1-based — SnapshotChunk.endLine
 *   tokenEstimate: number,
 * }>
 *
 * @param {string} filePath  - relative file path from the repo root
 * @param {string} language  - language identifier from the GitHub service
 * @param {string} content   - raw file content
 * @param {object} [config]  - override chunk config values
 */
export function chunkFile(filePath, language, content, config) {
  const cfg = {
    targetTokens: (config && config.chunkTargetTokens)  || env.chunkTargetTokens,
    maxTokens:    (config && config.chunkMaxTokens)     || env.chunkMaxTokens,
    overlapTokens:(config && config.chunkOverlapTokens) || env.chunkOverlapTokens,
    minTokens:    (config && config.chunkMinTokens)     || env.chunkMinTokens,
  };

  // Normalise: strip a single trailing newline if present (common in Git blobs)
  // but do NOT strip internal content — we need correct line numbers.
  const normalised = content.endsWith('\n')
    ? content.slice(0, -1)
    : content;

  if (normalised.length === 0) {
    return []; // empty file — no chunks
  }

  if (language === 'markdown') {
    return chunkMarkdown(normalised, filePath, language, cfg);
  }

  if (WINDOW_ONLY_LANGUAGES.has(language)) {
    const lines = normalised.split('\n');
    const windows = windowSplit(lines, cfg.targetTokens, cfg.overlapTokens, cfg.maxTokens);
    return windows
      .map((win, idx) => {
        const text = win.lines.join('\n').trimEnd();
        if (text.length === 0) return null;
        return makeChunk({ filePath, language, chunkIndex: idx, text, startLine: win.startLine, endLine: win.endLine });
      })
      .filter(Boolean);
  }

  return chunkCode(normalised, filePath, language, cfg);
}

/**
 * Compute the file-level SHA-256 hash of the raw file content.
 * This is stored as FileRecord.contentHash and used for incremental indexing:
 * an unchanged hash means no re-chunking or re-embedding is needed.
 *
 * @param {string} rawContent - the raw content exactly as fetched from GitHub
 * @returns {string} lowercase hex SHA-256
 */
export function hashFileContent(rawContent) {
  return sha256(rawContent);
}
