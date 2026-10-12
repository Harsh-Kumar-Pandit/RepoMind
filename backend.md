# RepoMind Backend Documentation

## 1. Product Requirements
RepoMind is a GitHub repository understanding and manual code-editing workspace. The backend supports single-repository exploration, RAG-based AI explanations, manual user-created and edited files, persistent workspaces, chat history, diff review, checkpoints, GitHub branches/commits/PRs, and user authentication.

**Strict AI Rule**: AI will explain repository code only. Users manually write and manage code. AI must never automatically modify files, apply generated patches, commit, or create pull requests.

---

## 2. Technology Stack & Versions
- **Runtime**: Node.js (v23+ ESM)
- **Module System**: JavaScript ES Modules (`"type": "module"`)
- **Framework**: Express.js (`^4.21.0`)
- **Database**: PostgreSQL (Hosted via Neon)
- **Vector Extension**: `pgvector` (enabled in database)
- **ORM**: Prisma (`^5.19.0`)
- **Primary AI Provider (Embedding)**: Configurable via `EMBEDDING_PROVIDER` (`gemini` default, or `openrouter`)
  - **Gemini**: `gemini-embedding-001`, 768 dimensions via `outputDimensionality`
  - **OpenRouter (LiquidAI)**: `liquid/lfm-2.5-embedding-350m:free`, 1024 dimensions, 512-token context window
- **Primary AI Provider (Chat)**: Google Gemini API (`gemini-3.5-flash-lite` via `models.generateContent`)
- **Chat Fallback**: OpenRouter (`openrouter.ai`) on eligible transient 429/5xx errors only
- **Package Manager**: npm

---

## 3. Backend Folder Structure
```text
server/
  src/
    config/
      env.js                  # Environment variable loading & validation
      database.js             # Shared Prisma client instantiation & lifecycle
    middleware/
      error.middleware.js     # Centralized error handler
      not-found.middleware.js # Centralized 404 handler
    routes/
      health.routes.js        # Health check endpoint
      repository.routes.js    # Analyze, index, index-status routes
      chat.routes.js          # RAG chat route with provider fallback
    services/
      github.service.js       # Safe repo fetching, tree traversal, file limits
      chunking.service.js     # Logical & markdown chunking with SHA-256
      embedding.service.js    # Quota-aware batch embedding & cache lookup
      indexing.service.js     # Snapshot indexing, locks, resume, prune
      retrieval.service.js    # Parameterized pgvector retrieval by snapshot
      ai.service.js           # Grounded AI chat with OpenRouter fallback
      chat.service.js         # End-to-end RAG chat orchestration
    utils/
      errors.js               # AppError + transient status helpers
    app.js                    # Express app setup and middleware wiring
    server.js                 # Application entry point
  prisma/
    schema.prisma             # Prisma schema definition
    migrations/
      0001_phase2_rag_schema/ # Applied Phase 2 RAG schema migration
  scripts/
    test-db.js                # Database & pgvector validation script
    check-tables.js           # Schema verification script
    run-migration.js          # Idempotent migration runner (_repomind_migrations)
    verify-step1.js           # Schema / vector / FK verification
  tests/
    *.test.js                 # Automated unit + DB integration tests
  .env.example                # Placeholder environment variables
  .gitignore
  package.json
```

---

## 4. Architecture & Responsibilities
- **Routes**: Define REST endpoints, validate request parameters, delegate to controllers/services, return consistent JSON envelopes.
- **GitHub Service**: Validates public GitHub URLs (rejecting non-GitHub hosts, SSRF, path traversal); fetches git metadata, commit trees, and file contents under strict limits (configurable max 70 files, 500 KB per file, 5 MB total).
- **Chunking Service**: Performs language-aware logical chunking for source code and heading-based chunking for Markdown. Calculates normalized content SHA-256 hashes and tracks exact file line ranges (`startLine`, `endLine`).
- **Embedding Service**: Manages quota-aware batch embeddings via Google Gemini (`gemini-embedding-001`). Reuses existing embeddings using content-hash caching `(contentHash, embeddingModel, dimensions)`. Tracks RPM/TPM and retries with exponential backoff and jitter.
- **Retrieval Service**: Performs parameterized pgvector cosine distance queries (`<=>`) strictly isolated to the specified repository and commit snapshot.
- **AI Service**: Constructs prompts strictly bounded by retrieved code context; executes Gemini chat (`gemini-3.5-flash-lite`) with automated OpenRouter fallback on eligible transient 429/5xx errors. Answers are strictly grounded in retrieved evidence with file and line citations. AI never modifies workspace or repository files.
- **Indexing Service**: Creates/resumes repository snapshots, renews worker locks, embeds with `gemini-embedding-001` (768-d), and prunes deleted paths from the active snapshot.
- **Configuration**: Exposes and validates all environment variables without leaking credentials.
- **Middleware**: Applies JSON payload limits, CORS, route 404 handling, and centralized error reporting.

---

## 5. Database Provider & Connection Setup (Neon PostgreSQL)
1. **Host**: Neon Serverless PostgreSQL with `vector` extension.
2. **Connection URLs**:
   - `DATABASE_URL`: Connection pooler URL for runtime Prisma queries.
   - `DIRECT_URL`: (Optional) Direct connection URL for running Prisma migrations when connection pooling restricts DDL commands.
3. **Secrets Handling**: Database credentials reside strictly in `server/.env` (gitignored). Never commit or expose connection strings.

---

## 6. Prisma & pgvector Configuration

### Model & Dimension Decisions
- **Embedding Model**: `gemini-embedding-001` (Active Google Gemini model). `text-embedding-004` is deprecated as of 2026.
- **Dimensions**: Configured to `768` using `outputDimensionality: 768`. Matryoshka Representation Learning (MRL) allows reducing dimensions from 3072 to 768 with negligible accuracy loss while cutting vector storage and indexing memory by 75%.
- **Vector Column**: Added via raw SQL migration:
  ```sql
  ALTER TABLE "CodeChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
  ```

### pgvector Indexing Strategy & Trade-offs
- **Exact Search (Flat / No Index - Recommended for initial deployment)**:
  - RepoMind queries are pre-filtered by `snapshotId` (typically 100–1,000 chunks per repository).
  - On filtered sets under 10,000 rows, a sequential scan with pgvector SIMD acceleration executes in $< 2\text{ ms}$ with 100% exact recall.
  - Requires 0 index build time, 0 memory overhead, and eliminates training requirements on empty tables.
- **IVFFlat Trade-off**:
  - Requires training data (typically $\ge 1,000 \times \text{lists}$). Building an IVFFlat index with 100 lists on an empty or small table severely degrades recall or fails. Therefore, IVFFlat is explicitly **not** used.
- **HNSW (Hierarchical Navigable Small World)**:
  - High recall and fast query execution without pre-training. Can be added as an optional optimization once global chunks exceed 20,000.

---

## 7. Environment Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| `PORT` | HTTP port the Express server listens on | `5000` | No |
| `CORS_ORIGIN` | Allowed origin for frontend CORS | `*` | No |
| `DATABASE_URL` | Neon PostgreSQL connection string | - | **Yes** |
| `DIRECT_URL` | Neon direct connection string for migrations | - | No |
| `GEMINI_API_KEY` | Google Gemini API Key for embeddings and chat | - | **Yes** |
| `GEMINI_EMBEDDING_MODEL` | Embedding model identifier | `gemini-embedding-001` | No |
| `GEMINI_EMBEDDING_DIMENSIONS` | Embedding output dimensions | `768` | No |
| `GEMINI_EMBEDDING_RPM` | Rate limit requests/inputs per minute for embeddings | `30` | No |
| `GEMINI_EMBEDDING_BATCH_SIZE` | Chunk batch size for embedding calls | `16` | No |
| `INDEXING_BATCH_SIZE` | Alias for embedding batch size (legacy) | `16` | No |
| `GEMINI_CHAT_MODEL` | Primary generative model identifier | `gemini-3.5-flash-lite` | No |
| `OPENROUTER_API_KEY` | OpenRouter API Key for chat fallback | - | No |
| `OPENROUTER_CHAT_MODEL` | Fallback model identifier | `google/gemini-flash-1.5` | No |
| `GITHUB_TOKEN` | Optional GitHub personal access token for higher rate limits | - | No |
| `GITHUB_CONCURRENCY` | Bounded concurrent GitHub blob fetches | `5` | No |
| `RETRIEVAL_TOP_K` | Default retrieval depth (clamped 5–8) | `6` | No |
| `INDEXING_MAX_FILES` | Max files indexed per run | `70` | No |
| `INDEXING_MAX_FILE_SIZE_BYTES` | Max individual file size (bytes) | `512000` (500 KB) | No |
| `INDEXING_MAX_TOTAL_BYTES` | Max total file bytes per indexing run | `5242880` (5 MB) | No |
| `INDEXING_MAX_CHUNKS` | Max chunks generated per indexing run | `500` | No |
| `INDEXING_MAX_INPUT_TOKENS` | Max input tokens for embedding per run | `200000` | No |
| `INDEXING_MAX_DURATION_MS` | Max duration timeout for indexing run | `300000` (5 min) | No |
| `INDEXING_LOCK_TTL_MS` | Renewable indexing lock lease TTL | `120000` | No |
| `INDEXING_LOCK_RENEW_MS` | Lock heartbeat renewal interval | `45000` | No |
| `CHUNK_TARGET_TOKENS` | Soft target tokens per chunk | `500` | No |
| `CHUNK_MAX_TOKENS` | Hard max tokens per chunk | `700` | No |
| `CHUNK_OVERLAP_TOKENS` | Overlap between windowed chunks | `60` | No |
| `CHUNK_MIN_TOKENS` | Minimum chunk size to avoid tiny fragments | `30` | No |

---

## 8. Database Schema & Migration Proposal

### Proposed Prisma Schema (`server/prisma/schema.prisma`):
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Preserved Phase 1 verification model
model TestItem {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
}

enum IndexingStatus {
  PENDING
  INDEXING
  COMPLETED
  FAILED
  PARTIAL
}

model Repository {
  id            String         @id @default(uuid())
  owner         String
  name          String
  url           String         @unique
  defaultBranch String         @default("main")
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  snapshots     RepoSnapshot[]

  @@index([owner, name])
}

model RepoSnapshot {
  id              String         @id @default(uuid())
  repositoryId    String
  repository      Repository     @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  branch          String
  commitSha       String
  configHash      String         // SHA-256 of indexing config (model, dims, chunk limits)
  embeddingModel  String         @default("gemini-embedding-001")
  dimensions      Int            @default(768)
  status          IndexingStatus @default(PENDING)
  totalFiles      Int            @default(0)
  indexedFiles    Int            @default(0)
  totalChunks     Int            @default(0)
  cachedChunks    Int            @default(0)
  newChunks       Int            @default(0)
  errorMessage    String?
  startedAt       DateTime?
  completedAt     DateTime?
  lockedBy        String?
  lockExpiresAt   DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  files           FileRecord[]
  snapshotChunks  SnapshotChunk[]

  @@unique([repositoryId, commitSha, configHash])
  @@index([repositoryId, branch])
}

model FileRecord {
  id          String       @id @default(uuid())
  snapshotId  String
  snapshot    RepoSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  path        String
  language    String
  size        Int
  contentHash String
  createdAt   DateTime     @default(now())

  @@unique([snapshotId, path])
  @@index([snapshotId])
}

model CodeChunk {
  id             String          @id @default(uuid())
  contentHash    String          // SHA-256 of normalized chunk content
  content        String
  embeddingModel String          // e.g. "gemini-embedding-001"
  dimensions     Int             @default(768)
  embedding      Unsupported("vector(768)")?
  createdAt      DateTime        @default(now())
  snapshotChunks SnapshotChunk[]

  @@unique([contentHash, embeddingModel, dimensions])
}

model SnapshotChunk {
  id         String       @id @default(uuid())
  snapshotId String
  snapshot   RepoSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  chunkId    String
  chunk      CodeChunk    @relation(fields: [chunkId], references: [id], onDelete: Cascade)
  filePath   String
  startLine  Int
  endLine    Int
  chunkIndex Int

  @@unique([snapshotId, filePath, chunkIndex])
  @@index([snapshotId, filePath])
  @@index([chunkId])
}
```

### Proposed SQL Migration (`0001_phase2_rag_schema`):
```sql
-- Ensure vector extension exists
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum IndexingStatus
DO $$ BEGIN
  CREATE TYPE "IndexingStatus" AS ENUM ('PENDING', 'INDEXING', 'COMPLETED', 'FAILED', 'PARTIAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable Repository
CREATE TABLE IF NOT EXISTS "Repository" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable RepoSnapshot
CREATE TABLE IF NOT EXISTS "RepoSnapshot" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL DEFAULT 'gemini-embedding-001',
    "dimensions" INTEGER NOT NULL DEFAULT 768,
    "status" "IndexingStatus" NOT NULL DEFAULT 'PENDING',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "indexedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "cachedChunks" INTEGER NOT NULL DEFAULT 0,
    "newChunks" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable FileRecord
CREATE TABLE IF NOT EXISTS "FileRecord" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable CodeChunk
CREATE TABLE IF NOT EXISTS "CodeChunk" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeChunk_pkey" PRIMARY KEY ("id")
);

-- Add vector column to CodeChunk
ALTER TABLE "CodeChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- CreateTable SnapshotChunk
CREATE TABLE IF NOT EXISTS "SnapshotChunk" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    CONSTRAINT "SnapshotChunk_pkey" PRIMARY KEY ("id")
);

-- Constraints and Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "Repository_url_key" ON "Repository"("url");
CREATE INDEX IF NOT EXISTS "Repository_owner_name_idx" ON "Repository"("owner", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "RepoSnapshot_repositoryId_commitSha_configHash_key" ON "RepoSnapshot"("repositoryId", "commitSha", "configHash");
CREATE INDEX IF NOT EXISTS "RepoSnapshot_repositoryId_branch_idx" ON "RepoSnapshot"("repositoryId", "branch");

CREATE UNIQUE INDEX IF NOT EXISTS "FileRecord_snapshotId_path_key" ON "FileRecord"("snapshotId", "path");
CREATE INDEX IF NOT EXISTS "FileRecord_snapshotId_idx" ON "FileRecord"("snapshotId");

CREATE UNIQUE INDEX IF NOT EXISTS "CodeChunk_contentHash_embeddingModel_dimensions_key" ON "CodeChunk"("contentHash", "embeddingModel", "dimensions");

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotChunk_snapshotId_filePath_chunkIndex_key" ON "SnapshotChunk"("snapshotId", "filePath", "chunkIndex");
CREATE INDEX IF NOT EXISTS "SnapshotChunk_snapshotId_filePath_idx" ON "SnapshotChunk"("snapshotId", "filePath");
CREATE INDEX IF NOT EXISTS "SnapshotChunk_chunkId_idx" ON "SnapshotChunk"("chunkId");

-- Foreign Keys
ALTER TABLE "RepoSnapshot" DROP CONSTRAINT IF EXISTS "RepoSnapshot_repositoryId_fkey";
ALTER TABLE "RepoSnapshot" ADD CONSTRAINT "RepoSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileRecord" DROP CONSTRAINT IF EXISTS "FileRecord_snapshotId_fkey";
ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SnapshotChunk" DROP CONSTRAINT IF EXISTS "SnapshotChunk_snapshotId_fkey";
ALTER TABLE "SnapshotChunk" ADD CONSTRAINT "SnapshotChunk_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SnapshotChunk" DROP CONSTRAINT IF EXISTS "SnapshotChunk_chunkId_fkey";
ALTER TABLE "SnapshotChunk" ADD CONSTRAINT "SnapshotChunk_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "CodeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## 9. API Endpoint Inventory

- `GET /api/health`: Healthcheck endpoint with database status verification.
- `POST /api/repositories/analyze`: Validates GitHub URL, fetches repo metadata, branch info, commit SHA, and filters eligible files.
- `POST /api/repositories/:repositoryId/index`: Initiates or resumes snapshot indexing. Idempotent. Rejects concurrent runs for the same snapshot with `409 Conflict`. Returns `202` while indexing, `200` if already complete.
- `GET /api/repositories/:repositoryId/index-status`: Returns snapshot indexing metrics, cached vs new counts, error messages, and ready-for-chat boolean.
- `POST /api/chat`: Accepts `repositoryId`, `question`, and optional `commitSha` / `snapshotId` / `topK`. Retrieves top-K relevant chunks via parameterized pgvector query, prompts Gemini (or falls back to OpenRouter), and returns grounded answer with file and line citations.

### API Examples

**Analyze**
```http
POST /api/repositories/analyze
Content-Type: application/json

{ "url": "https://github.com/owner/repo" }
```
```json
{
  "success": true,
  "data": {
    "repository": { "id": "...", "owner": "owner", "name": "repo", "url": "https://github.com/owner/repo", "defaultBranch": "main" },
    "branch": "main",
    "commitSha": "abc123...",
    "files": { "eligibleCount": 42, "selectedCount": 42, "totalBytesSelected": 120000, "isTruncated": false, "preview": [] }
  }
}
```

**Index**
```http
POST /api/repositories/{repositoryId}/index
Content-Type: application/json

{ "branch": "main" }
```
```json
{ "success": true, "data": { "snapshotId": "...", "status": "INDEXING", "message": "Indexing started." } }
```

**Index status**
```http
GET /api/repositories/{repositoryId}/index-status
```
```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "totalFiles": 20,
    "indexedFiles": 20,
    "totalChunks": 85,
    "cachedChunks": 40,
    "newChunks": 45,
    "readyForChat": true
  }
}
```

**Chat**
```http
POST /api/chat
Content-Type: application/json

{ "repositoryId": "...", "question": "Where is authentication handled?" }
```
```json
{
  "success": true,
  "data": {
    "answer": "...",
    "citations": [{ "filePath": "src/auth.js", "startLine": 10, "endLine": 40 }],
    "provider": "gemini",
    "fallbackUsed": false,
    "retrievedCount": 6
  }
}
```

---

## 10. Quota Optimization & Incremental Indexing Strategy
1. **Content-Hash Caching**: Each chunk has an SHA-256 hash. When a chunk already exists with matching `(contentHash, embeddingModel, dimensions)`, its embedding vector is reused directly without any provider API call.
2. **Incremental Indexing**: When indexing a new commit, unchanged files (same git blob SHA / content hash) automatically reuse previous chunks. Changed files are re-chunked, reusing existing chunk hashes where possible. Stale or deleted files simply do not receive links in the new snapshot, while historical snapshots remain completely unaffected.
3. **Conservative Quota Accounting**: Each chunk inside a batch is accounted for individually against the configured RPM limit (`GEMINI_EMBEDDING_RPM`).
4. **Resumable Execution**: In-progress snapshots track processed files. If a rate limit or timeout occurs, the snapshot marks `PARTIAL` status and can be resumed without duplicating completed work.

---

## 11. Security Rules & Data Integrity
- Repository URLs are strictly parsed to allow only `github.com` protocols, mitigating SSRF.
- Path traversal protection ensures file paths cannot escape repository boundaries.
- Repository contents and documentation are treated as untrusted data in LLM prompts.
- Parameterized SQL is used for all pgvector operations (`$queryRaw` with template tags).

---

## 12. Implementation Roadmap
1. **Phase 1: Clean Backend Foundation + PostgreSQL + pgvector** (Completed)
2. **Phase 2: RAG Pipeline, Repository Indexing, and Embeddings** (Completed — verified)
3. **Phase 3: Auth, Ownership, Workspaces, Manual Edits, Chat History** (Planned — not implemented)
4. **Phase 4: GitHub Integration (Branches, Commits, PRs, Diff Review, Checkpoints)** (Pending)
5. **Phase 5: Hardening, Multi-user Scale, and Production Ops** (Pending)

---

## 13. Current Phase Status — Phase 2 Verified Results

- **Current Phase**: Phase 4A (**Completed and verified**)
- **Migration Status**:
  - `0001_phase2_rag_schema` (applied `2026-10-10T13:42:43.225Z`)
  - `0002_phase3_auth_workspace` (applied `2026-10-10T15:17:47.436Z`)
  - `0003_phase3_oauth_state` (applied `2026-10-10T15:34:24.242Z`)
  - All migrations tracked in `_repomind_migrations`.
- **Phase 3C Verification**:
  - GitHub OAuth initiation, state cookie binding (`repomind_oauth_state`), database-backed atomic replay defense (`OAuthState`), open redirect mitigation with WHATWG parser, SHA-256 session token hashing, HttpOnly cookies.
- **Phase 3D Verification**:
  - Centralized repository authorization via `requireAuth` + `requireRepoAccess` middleware.
  - Safe initial ownership assignment (`OWNER`) upon analysis in an atomic transaction.
  - Concurrent analysis protection preventing duplicate ownership or silent takeovers.
  - Strict default deny for legacy unowned repositories.
  - Explicit legacy claim endpoint (`POST /api/repositories/:repositoryId/claim`) with atomic first-claim semantics.
  - Owner-controlled member management (`GET/POST /api/repositories/:repositoryId/members`, `DELETE /api/repositories/:repositoryId/members/:userId`).
  - Cross-repository snapshot and resource IDOR protection (`validateSnapshotRepositoryBinding`).
- **Phase 3E Verification**:
  - Persistent Workspace CRUD (`POST /api/workspaces`, `GET /api/workspaces`, `GET /api/workspaces/:id`, `DELETE /api/workspaces/:id`).
  - Scoped to authenticated user and authorized repository (`userId` derived exclusively from session).
  - Manual Workspace File operations (`GET /api/workspaces/:id/files`, `GET /api/workspaces/:id/files/*path`, `PUT /api/workspaces/:id/files/*path`, `DELETE /api/workspaces/:id/files/*path`).
  - Strict file path validation: rejects traversal (`..`, `.` segments), backslashes, percent-encoded traversal/separators, null bytes/control chars, and restricted directories (`.git`, `node_modules`).
  - File size cap enforcement using UTF-8 byte length (Buffer.byteLength), not JS string length.
  - Deterministic server-calculated SHA-256 `contentHash`.
  - Strict product boundary: AI chat and indexing do not mutate workspace files; manual editing only; no auto-commits/pushes/PRs.
- **Phase 4A Verification**:
  - Optimistic Concurrency Control (OCC) implemented in `saveWorkspaceFile` using existing `contentHash` and `updatedAt`. No schema migration required.
  - Supports `If-Match` header or `expectedContentHash` in body.
  - Atomic verification and conditional update inside a PostgreSQL transaction with workspace touch.
  - Stale edits return `409 Conflict` with error code `STALE_FILE_EDIT` containing `currentContentHash` and `currentUpdatedAt` without overwriting newer content.
  - Two simultaneous saves with the same expected hash produce exactly one winner and one 409 conflict.
  - IDOR protection prevents unauthorized users from obtaining conflict hashes.
  - Automated tests: **173 passed, 0 failed** (`npm test`).
- **Configured models (verified)**:
  - **Chat**: `GEMINI_CHAT_MODEL=gemini-3.5-flash-lite` (Generative Language API `models.generateContent`)
  - **Embeddings / indexing**: `gemini-embedding-001` with **768-dimensional** vectors (`outputDimensionality: 768`)

### Verification evidence
| Check | Command / method | Result |
|---|---|---|
| Database / schema / pgvector | `node scripts/verify-step1.js` | **Passed** — tables, `vector(768)`, FKs, migration tracking present |
| Automated tests | `npm test` (in `server/`) | **77 passed, 0 failed** |
| Live Postman smoke test | Manual E2E against running API | Analysis succeeded → indexing **`COMPLETED`** → `POST /api/chat` **`200 OK`** with grounded answer + citation |

### Live smoke-test notes
- The live chat smoke test used the small public repository **`octocat/Hello-World`**.
- That verifies the full analyze → index → chat path with real GitHub + Gemini credentials.
- **Broader real-repository testing is still advisable** (larger trees, more languages, partial indexing / quota pause, OpenRouter fallback) before treating Phase 2 as production-hardened.

### Phase 2 capability summary (preserved — do not regress)
- Secure GitHub URL parsing and bounded repo fetch
- Logical / Markdown chunking with SHA-256 hashes and line ranges
- Quota-aware embedding cache and resumable snapshot indexing with renewable locks
- Snapshot-isolated pgvector retrieval
- Grounded Gemini chat with eligible OpenRouter fallback; AI remains strictly read-only
- Endpoints: `POST /api/repositories/analyze`, `POST /api/repositories/:repositoryId/index`, `GET /api/repositories/:repositoryId/index-status`, `POST /api/chat`

### Remaining Phase 2 limitations
- Automated tests mock external GitHub/Gemini calls; live coverage was a small-repo smoke test only.
- Exact IVFFlat/HNSW indexes are intentionally not created.
- OpenRouter fallback requires `OPENROUTER_API_KEY`.
- No authenticated multi-user ownership yet (Phase 3).
- Frontend was out of Phase 2 scope.

- **Blockers**: None.
- **Next**: Phase 3 plan below — **awaiting review; not implemented**.

---

## 14. Phase 3 Implementation Plan (Review Only — Not Implemented)

**Status**: Design / review only. Do **not** implement until approved. Phase 2 behavior, schema `0001_phase2_rag_schema`, and env contracts must remain intact unless a Phase 3 migration is explicitly approved.

### 14.1 Goals
1. GitHub OAuth and secure authentication  
2. Persistent user and session handling  
3. Repository ownership / access checks  
4. Persistent workspace file operations in PostgreSQL (manual edits only)  
5. Persistent chat history  
6. Automated tests and security checks  

**Non-goals for Phase 3**: AI-applied patches, auto-commit/push/PR, Phase 4 branch/PR workflows, frontend redesign (unless a minimal auth/callback page is required for OAuth).

### 14.2 Proposed architecture

```text
Browser
  → GET /api/auth/github          (start OAuth)
  → GET /api/auth/github/callback (exchange code, create session cookie)
  → Authenticated API requests with HttpOnly session cookie
       → auth.middleware (load user + session)
       → ownership / access checks per repository & workspace
       → workspace / chat-history services → PostgreSQL
```

- Preserve existing RAG routes; wrap mutating / user-scoped routes with auth + access middleware.
- Keep AI **read-only**: workspace file writes are performed only by explicit user API calls, never by the chat/AI path.

### 14.3 Proposed file changes (additive)

| Path | Purpose |
|---|---|
| `server/src/config/env.js` | Add OAuth/session env vars (no secrets committed) |
| `server/src/middleware/auth.middleware.js` | Require valid session; attach `req.user` |
| `server/src/middleware/access.middleware.js` | Repository/workspace ownership & membership checks |
| `server/src/routes/auth.routes.js` | OAuth start, callback, logout, `GET /api/auth/me` |
| `server/src/routes/workspace.routes.js` | Workspace CRUD + manual file ops |
| `server/src/routes/chat.routes.js` | Extend to persist threads/messages (auth-scoped) |
| `server/src/services/auth.service.js` | GitHub OAuth exchange, user upsert, session create/revoke |
| `server/src/services/session.service.js` | Session token hashing, expiry, rotation |
| `server/src/services/access.service.js` | Ownership / collaborator resolution |
| `server/src/services/workspace.service.js` | Workspace + file create/read/update/delete (manual only) |
| `server/src/services/chat-history.service.js` | Thread/message persistence linked to user + repository |
| `server/prisma/schema.prisma` | New auth/workspace/chat-history models (additive) |
| `server/prisma/migrations/0002_phase3_auth_workspace/` | Versioned SQL migration (apply only after approval) |
| `server/tests/auth.*.test.js` | OAuth/session/access unit + integration tests |
| `server/tests/workspace.*.test.js` | Manual file ops + path traversal tests |
| `server/tests/chat-history.*.test.js` | History isolation tests |
| `backend.md` | Update after implementation with actual results |

**Do not** rewrite Phase 2 services (`embedding`, `indexing`, `retrieval`, `github`, `chunking`) except for thin auth/access hooks at the route layer.

### 14.4 Proposed Prisma models (draft — migration required)

Additive models only; keep existing `Repository`, `RepoSnapshot`, `FileRecord`, `CodeChunk`, `SnapshotChunk`, `TestItem`.

```prisma
model User {
  id            String    @id @default(uuid())
  githubId      String    @unique
  login         String
  name          String?
  avatarUrl     String?
  email         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  memberships   RepositoryMember[]
  workspaces    Workspace[]
  chatThreads   ChatThread[]
}

model Session {
  id               String   @id @default(uuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash        String   @unique  // store hash only, never raw token
  expiresAt        DateTime
  revokedAt        DateTime?
  createdAt        DateTime @default(now())
  lastSeenAt       DateTime @default(now())
  userAgent        String?
  ipHash           String?  // optional privacy-preserving hash

  @@index([userId, expiresAt])
}

enum RepositoryRole {
  OWNER
  MEMBER
}

model RepositoryMember {
  id             String         @id @default(uuid())
  repositoryId   String
  repository     Repository     @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  userId         String
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           RepositoryRole @default(OWNER)
  createdAt      DateTime       @default(now())

  @@unique([repositoryId, userId])
  @@index([userId])
}

model Workspace {
  id             String   @id @default(uuid())
  repositoryId   String
  repository     Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  baseCommitSha  String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  files          WorkspaceFile[]

  @@unique([repositoryId, userId, name])
  @@index([userId])
}

model WorkspaceFile {
  id           String    @id @default(uuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  path         String
  content      String
  contentHash  String
  language     String?
  updatedAt    DateTime  @updatedAt
  createdAt    DateTime  @default(now())

  @@unique([workspaceId, path])
  @@index([workspaceId])
}

model ChatThread {
  id             String   @id @default(uuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  repositoryId   String
  repository     Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  snapshotId     String?
  title          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  messages       ChatMessage[]

  @@index([userId, repositoryId])
}

model ChatMessage {
  id         String   @id @default(uuid())
  threadId   String
  thread     ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role       String   // user | assistant | system
  content    String
  citations  Json?
  provider   String?
  model      String?
  createdAt  DateTime @default(now())

  @@index([threadId, createdAt])
}
```

**Schema touch-ups required on existing models** (additive relations only):
- `Repository`: `members RepositoryMember[]`, `workspaces Workspace[]`, `chatThreads ChatThread[]`
- Optional later: bind analyze/index to the authenticated user who imported the repo

### 14.5 Migration requirements

| Item | Detail |
|---|---|
| Migration name | `0002_phase3_auth_workspace` (proposed) |
| Tracking | Same `_repomind_migrations` runner as Phase 2 — **do not re-run `0001`** |
| Apply policy | Explain necessity and **request approval** before executing |
| Safety | Additive `CREATE TABLE` / indexes / FKs only; no drops of Phase 2 RAG tables; no vector column changes |
| Rollback plan | Document reverse SQL (drop new tables in dependency order) kept in migration notes; prefer forward-fix if data exists |
| Data backfill | Existing repositories have no owner — Phase 3 should either (a) leave them unowned until claimed, or (b) provide an admin claim endpoint; decide at implementation kickoff |

### 14.6 Proposed environment variables (document only — not added yet)

| Variable | Purpose |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client id |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App secret |
| `GITHUB_OAUTH_CALLBACK_URL` | e.g. `http://localhost:5000/api/auth/github/callback` |
| `SESSION_SECRET` | High-entropy secret for signing/hashing session tokens |
| `SESSION_COOKIE_NAME` | Default e.g. `repomind_session` |
| `SESSION_TTL_MS` | Session lifetime (e.g. 7 days) |
| `CORS_ORIGIN` | Must be an explicit frontend origin when using credentialed cookies (not `*` in auth mode) |

### 14.7 Proposed API surface (Phase 3)

**Auth**
- `GET /api/auth/github` — redirect to GitHub authorize  
- `GET /api/auth/github/callback` — exchange code, set HttpOnly `Secure`/`SameSite` cookie  
- `POST /api/auth/logout` — revoke session  
- `GET /api/auth/me` — current user  

**Access / repositories**
- On `POST /api/repositories/analyze` (authenticated): upsert `RepositoryMember` as `OWNER` for the importing user  
- All subsequent index/chat/workspace ops require membership  

**Workspaces (manual edits only)**
- `POST /api/workspaces` — create workspace for a repository  
- `GET /api/workspaces?repositoryId=` — list user workspaces  
- `GET /api/workspaces/:id/files` — list files  
- `GET /api/workspaces/:id/files/*path` — read file  
- `PUT /api/workspaces/:id/files/*path` — create/update file (user-authored content only)  
- `DELETE /api/workspaces/:id/files/*path` — delete file  

**Chat history**
- `POST /api/chat` — existing RAG answer **plus** persist user/assistant messages into a thread  
- `GET /api/chat/threads?repositoryId=` — list threads  
- `GET /api/chat/threads/:threadId` — thread + messages  
- `DELETE /api/chat/threads/:threadId` — delete own thread  

### 14.8 Security checklist (Phase 3)

- OAuth `state` parameter (CSRF) required and single-use  
- Store **hashed** session tokens only; raw token only in HttpOnly cookie  
- Cookie flags: `HttpOnly`, `Secure` (production), `SameSite=Lax` (or `Strict` if compatible)  
- Never log OAuth codes, tokens, or session secrets  
- Path traversal rejection for workspace file paths (reuse GitHub path safety patterns)  
- Enforce repository membership on every workspace and chat-history query (no IDOR)  
- Rate-limit auth callback and login endpoints  
- Preserve Phase 2 rules: SSRF-safe GitHub URLs; untrusted repo content in prompts; AI never writes workspace files  
- Separate GitHub OAuth token storage (encrypted at rest) if user-repo private access is added later — default Phase 3 can stay public-repo + ownership metadata only  

### 14.9 Test strategy (Phase 3)

| Area | Tests |
|---|---|
| OAuth | State mismatch rejected; callback upserts user; duplicate login reuses `githubId` |
| Sessions | Valid cookie authenticates; expired/revoked rejected; logout clears access |
| Access control | Non-member cannot index/chat/workspace; owner can; IDOR on workspace/thread IDs blocked |
| Workspace files | CRUD happy path; path traversal (`../`) rejected; oversized content rejected; AI routes cannot mutate files |
| Chat history | Messages persist with citations JSON; threads isolated per user; delete scoped to owner |
| Regression | Full Phase 2 `npm test` suite remains green; embedding dims still 768; chat still uses `gemini-3.5-flash-lite` |
| Security | Cookie flags asserted in tests; no secrets in responses; unauthorized → `401`, forbidden → `403` |

Mock GitHub OAuth token exchange in automated tests (do not consume real OAuth in CI). Optional manual smoke: real GitHub OAuth App against localhost callback.

### 14.10 Implementation sequence (after approval)

1. Approve schema + migration `0002_phase3_auth_workspace`  
2. Add env vars to `.env.example` and loader validation  
3. Implement auth + session services and middleware  
4. Attach ownership on analyze; gate existing Phase 2 routes  
5. Implement workspace file APIs (manual only)  
6. Persist chat threads/messages  
7. Add tests; run `npm test` + `verify-step1` (and new verify script for Phase 3 tables)  
8. Update `backend.md` with actual Phase 3 results  

### 14.11 Status
- Phase 3A-3E complete and verified.

---

## 15. Phase 4 — Diff Review, Checkpoints & Manual Code Workspace

### 15.1 Optimistic Concurrency Control (Phase 4A)
- Implemented in `server/src/services/workspace.service.js` and `server/src/routes/workspace.routes.js`.
- File reads (`GET /api/workspaces/:id/files/*`) return the current `contentHash`.
- File writes (`PUT /api/workspaces/:id/files/*`) require `expectedContentHash` (passed either via HTTP header `If-Match: "<hash>"` or JSON body `{ expectedContentHash: "<hash>", content: "..." }`).
- For existing files, updates execute conditionally matching `expectedContentHash`. If mismatched, returns HTTP 409 `STALE_FILE_EDIT` with current server hash and file size, preventing silent overwrites.
- New file creations omit `expectedContentHash` and fail with 409 if a file already exists at that path.

### 15.2 Migration `0004_phase4_checkpoints_and_deletions`
- Applied to Neon PostgreSQL via migration runner `scripts/run-migration.js`.
- Added `WorkspaceFile.isDeleted` (Boolean default false) for explicit file deletion tracking.
- Created `WorkspaceCheckpoint` and `WorkspaceCheckpointFile` tables:
  - `WorkspaceCheckpoint`: `id`, `workspaceId`, `userId`, `name`, `description`, `createdAt`.
  - `WorkspaceCheckpointFile`: `id`, `checkpointId`, `path`, `content`, `contentHash`, `language`, `isDeleted`, `sizeBytes`, `createdAt`.
  - Cascade deletion on checkpoint delete or workspace delete.
  - Foreign key and index optimization: `workspaceId_createdAt`, `checkpointId_path`.

### 15.3 Diff Engine (Phase 4B)
- Implemented in `server/src/services/diff.service.js`.
- Pinned Baseline SHA:
  - Workspaces pin immutable `baseCommitSha` from the repository's default branch upon creation or first diff request.
  - Never compares against a moving branch ref; baseline content is fetched from exact Git tree/blob APIs (`fetchGitHubFileContent`), never reconstructed from RAG chunks.
- Classification:
  - `ADDED`: File present in workspace, absent in baseline commit.
  - `MODIFIED`: File present in both, content hashes differ.
  - `DELETED`: Marked deleted (`isDeleted: true`) in workspace, present in baseline commit.
  - `UNCHANGED`: Content hashes match exactly.
- Unified Text Diff:
  - Myers-style standard unified diff with `--- a/<path>`, `+++ b/<path>`, and hunk line counts.
  - Defensive limits enforced: 100 KB max diff per file, 2 MB total workspace diff, 100 changed files max. Truncated outputs include explicit `isTruncated: true` flags.
- Endpoint:
  - `GET /api/workspaces/:workspaceId/diff` (requires workspace owner authentication).

### 15.4 Workspace Checkpoints (Phase 4B)
- Implemented in `server/src/services/checkpoint.service.js`.
- Point-in-time file manifest captures active and deleted file states with SHA-256 hashes.
- Retention: Automatically prunes oldest checkpoints per workspace, maintaining a 20-checkpoint cap.
- Restoration:
  - `POST /api/workspaces/:workspaceId/checkpoints/:checkpointId/restore` atomically wipes current workspace files and recreates all files exactly from the checkpoint manifest inside a Prisma transaction.
  - Touches `Workspace.updatedAt` to immediately invalidate stale client OCC caches and trigger 409 conflicts on in-flight edits.
- Endpoints:
  - `POST /api/workspaces/:workspaceId/checkpoints`
  - `GET /api/workspaces/:workspaceId/checkpoints`
  - `GET /api/workspaces/:workspaceId/checkpoints/:checkpointId`
  - `POST /api/workspaces/:workspaceId/checkpoints/:checkpointId/restore`

### 15.5 Security & Integrity Guardrails
- AI chat endpoints cannot mutate workspace files or restore checkpoints.
- IDOR strictly prevented: users can only view, diff, checkpoint, and restore workspaces they own.

### 15.6 GitHub Publishing Workflow (Phase 4C)
- **Services & Routes**:
  - `server/src/services/publish.service.js`
  - `server/src/routes/publish.routes.js` (`POST /api/workspaces/:workspaceId/publish` & `POST /api/workspaces/:workspaceId/pull-request`)
- **Credential Handling & Security**:
  - Does NOT accept client-supplied tokens in request bodies or headers.
  - Relies exclusively on server-configured credentials (`env.githubToken`) authorized for repository push access.
  - If credentials are absent or lack write permissions, returns structured error (`401 GITHUB_CREDENTIALS_REQUIRED` or `403 GITHUB_FORBIDDEN`).
  - Tokens are never logged, echoed in response payloads, or leaked.
- **Publish Validation**:
  - Requires session authentication, workspace ownership, and repository membership (`OWNER` or `MEMBER`).
  - Resolves repository owner and name from trusted PostgreSQL records.
  - Requires pinned `Workspace.baseCommitSha`.
  - Verifies remote base branch SHA on GitHub; rejects with HTTP 409 `STALE_BASE_BRANCH` if the remote branch has progressed.
  - Validates branch name and rejects publishing directly to the default branch.
  - Requires non-empty `selectedPaths`. Rejects duplicate paths, unchanged files (`UNCHANGED_FILE_SELECTED`), unselected files, and absent files.
  - Enforces payload bounds: 500 KB per file, 5 MB total publish payload, 100 changed files max.
- **Branch & Commit Execution**:
  1. Resolves base commit Git tree SHA from GitHub Git Data API.
  2. Uploads Git blobs for added and modified files.
  3. Builds Git tree with `base_tree`: added/modified items reference their blob SHAs; deleted files have `sha: null` for tree path deletion.
  4. Creates Git commit with parent set to `workspace.baseCommitSha`.
  5. Creates feature branch ref `refs/heads/<branchName>`.
  6. Verifies resulting commit, branch, and tree before returning success.
- **Pull Request Creation**:
  - Separate explicit endpoint `POST /api/workspaces/:workspaceId/pull-request`.
  - Verifies head branch existence on remote repository and creates PR into base branch.
  - Idempotent: detects existing PRs on head/base branch and returns HTTP 409 `PULL_REQUEST_ALREADY_EXISTS`.

---

## 16. Phase 5 — Final Backend Audit & Deployment Readiness

### 16.1 Comprehensive Verification Matrix

| Area | Automated Tests | Live / Architecture Checks | Status |
|---|---|---|---|
| **1. Authentication** | State nonce, HMAC signature, cookie binding, atomic consumption, session hashing, cookie flags, logout | Strict redirect-path sanitization rejects protocol-relative, encoded slashes, and control characters | **VERIFIED** |
| **2. Authorization** | Role hierarchy (`OWNER`/`MEMBER`), legacy claiming, cross-user IDOR protection on workspaces, files, diffs, checkpoints | Atomic membership assignments; snapshot-repository binding prevents snapshot IDOR | **VERIFIED** |
| **3. Workspace Safety** | Path traversal rejection, UTF-8 byte checking, OCC conditional updates (`STALE_FILE_EDIT`), tombstone deletions | Hard limits: 500 KB per file, 5 MB total workspace payload, 100 changed files max | **VERIFIED** |
| **4. RAG & AI Safety** | 768-dim embedding clamp, snapshot isolation, Gemini 3.5 flash-lite with OpenRouter fallback | AI strictly read-only; no endpoints allow LLM to mutate files, commit, or create PRs | **VERIFIED** |
| **5. GitHub Publishing** | Branch format, non-empty change validation, stale base branch 409 rejection, Git Tree `sha: null` deletions, PR deduplication | Credentials isolated to `env.githubToken`; tokens never exposed in client requests or responses | **VERIFIED** |
| **6. Database & Prisma** | 4 migrations tracked in `_repomind_migrations`; Neon connection pooler compatibility | Schema validated with `npx prisma validate`; Prisma Client v5.22.0 generated | **VERIFIED** |
| **7. Production Config** | CORS explicit allowlist (rejects `*` for credentials), health check `SELECT 1`, error response formatting | Safe error envelopes: no stack traces returned to client; 500s logged server-side only | **VERIFIED** |

### 16.2 Findings & Severity Classification

- **Critical**: None. (Zero critical defects identified; all access control, IDOR protections, and secret isolations pass).
- **High**: None. (No unhandled state transitions, no silent data overwrites, OCC and base branch validations active).
- **Medium**:
  - *Shared Server Token for Publishing*: Phase 4C intentionally relies on server-configured `env.githubToken` for write operations to prevent client-supplied token leaks. If users publish to personal repositories that the server token cannot access, GitHub returns HTTP 403 `GITHUB_FORBIDDEN`. (Documented operational constraint pending future per-user encrypted OAuth token storage).
- **Low**:
  - *Chat message limit per thread*: Long threads do not currently enforce an automated hard cap on conversation length.
  - *Rate-limiting layer*: While GitHub and Gemini rate limits are safely caught and surfaced as 429 errors, process-level express rate limiting (`express-rate-limit`) can be added at the edge/reverse-proxy in production.

### 16.3 Secret & Git Cleanliness Audit
- `.env` is listed in `.gitignore` and untracked.
- `.env.example` contains only template placeholders (`your_gemini_api_key_here`, etc.).
- No API keys, JWT secrets, database connection strings, or GitHub tokens are hardcoded or tracked in Git.

### 16.4 Test Results
- **Automated Test Run**: 192/192 tests passing (0 failures, 0 skipped).
- **Prisma Schema**: `prisma/schema.prisma` is valid and synchronized with Neon PostgreSQL.

---

## 17. Multi-Provider Embeddings & OpenRouter LiquidAI Integration

### 17.1 Supported Providers & Models

1. **Google Gemini (Default)**:
   - Model: `gemini-embedding-001`
   - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents`
   - Output Dimensions: 768
   - Rate limit accounting: 30 RPM default, sliding window

2. **OpenRouter LiquidAI (Optional / Free Provider)**:
   - Model: `liquid/lfm-2.5-embedding-350m:free` (official OpenRouter ID)
   - Endpoint: `https://openrouter.ai/api/v1/embeddings`
   - Output Dimensions: 1024
   - Context Window: 512 tokens (chunking parameters automatically adapt: `chunkTargetTokens: 300`, `chunkMaxTokens: 400`, `chunkOverlapTokens: 40`)
   - Rate limit accounting: 60 RPM default, sliding window

### 17.2 Configuration Environment Variables

```env
# Provider selection: "gemini" (default) or "openrouter"
EMBEDDING_PROVIDER=gemini

# Gemini API configuration
GEMINI_API_KEY=...
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# OpenRouter configuration
OPENROUTER_API_KEY=...
OPENROUTER_EMBEDDING_MODEL=liquid/lfm-2.5-embedding-350m:free
OPENROUTER_EMBEDDING_RPM=60
OPENROUTER_EMBEDDING_BATCH_SIZE=10
```

### 17.3 Database Schema & RAG Isolation Architecture

- **PostgreSQL pgvector**: `CodeChunk.embedding` uses typmod-less `vector`, allowing both 768-dimensional and 1024-dimensional vectors to coexist safely in the same table without truncation, padding, or schema resets.
- **Snapshot Isolation**: Every `RepoSnapshot` records its `embeddingModel` and `dimensions`. `computeConfigHash()` incorporates model and dimension parameters into the SHA-256 hash.
- **Strict Query Isolation**: Semantic retrieval strictly filters chunks by `snapshotId`, `embeddingModel`, and `dimensions`. Queries embedded with LiquidAI (1024d) only query 1024d chunks belonging to that snapshot. Mismatched query dimensions are rejected immediately with HTTP 400 `EMBEDDING_DIMENSION_MISMATCH`.
- **Deduplication & Cache Isolation**: The compound unique constraint `@@unique([contentHash, embeddingModel, dimensions])` prevents collision between different models or vector lengths on identical source chunks.

---

## 18. GitHub API Rate Limiting, Tree Reuse & Embedding Quota Failover

### 18.1 GitHub API Rate Limiting & Diagnostics
- **Authentication**: Requests to GitHub's REST and Git Data APIs automatically attach `Bearer <GITHUB_TOKEN>` when configured in server environment variables.
  - Unauthenticated requests are subject to GitHub's IP rate limit of 60 requests per hour.
  - Authenticated requests receive 5,000 requests per hour.
- **Header Inspection & Error Differentiation**:
  - `x-ratelimit-remaining`, `x-ratelimit-limit`, and `x-ratelimit-reset` are parsed on every response.
  - When `x-ratelimit-remaining == 0` or HTTP 403/429 occurs, GitHub rate limits are differentiated:
    - **Primary Rate Limit (403/429)**: Returns HTTP 429 with `resetIso` timestamp and clear message advising server token configuration.
    - **Secondary Abuse / Concurrency Rate Limit (403/429 with `retry-after`)**: Returns HTTP 429 specifying backoff seconds.
    - **Invalid / Expired Token (401)**: Returns HTTP 401 `INVALID_GITHUB_TOKEN` advising token refresh.
    - **Private / Inaccessible Repository (404)**: Returns HTTP 404 with guidance on token permissions.
- **Raw Content Fallback**:
  - In public repositories, blob fetches that hit rate limits gracefully attempt raw content retrieval from `https://raw.githubusercontent.com/{owner}/{repo}/{commitSha}/{path}` before failing.

### 18.2 Snapshot & File Tree Reuse in Analysis
- When analyzing a repository via `POST /api/repositories/analyze`:
  1. Resolves repository and checks for completed snapshots matching the latest commit SHA.
  2. If the commit SHA has not changed and a completed snapshot exists, the file tree and metadata are reused directly from PostgreSQL `FileRecord` rows, avoiding redundant recursive Git tree requests.
  3. If GitHub rate limits prevent fetching live Git trees but a completed snapshot exists, the analysis returns cached snapshot data gracefully instead of blocking the user.

### 18.3 Automated Quota Failover to OpenRouter Embeddings
- **Failover Trigger**:
  - When embedding with Google Gemini (`gemini-embedding-001`) exhausts quota (HTTP 429 or `EmbeddingQuotaExhaustedError`), the snapshot records `PARTIAL` status with error details.
  - On subsequent index initiation (`POST /api/repositories/:repositoryId/index`), if OpenRouter is configured (`OPENROUTER_API_KEY`) and Gemini quota remains exhausted, the system automatically creates or resumes an isolated OpenRouter snapshot using `liquid/lfm-2.5-embedding-350m:free` (1024d) with adjusted chunk parameters (`chunkTargetTokens: 300`, `chunkMaxTokens: 400`).
- **Vector & Snapshot Isolation**:
  - Gemini (768d) and LiquidAI (1024d) snapshots are never mixed within the same snapshot or retrieval context.
  - RAG retrieval resolves the target snapshot and strictly filters by snapshot ID, embedding model, and expected vector dimensions.
  - Dimension mismatches are rejected with HTTP 400 `EMBEDDING_DIMENSION_MISMATCH`.
  - Fallback is strictly confined to embedding quota exhaustion and is never triggered by GitHub API errors.

### 18.4 Actionable Frontend Error Messaging
- Client utility `formatActionableErrorMessage` parses ISO reset timestamps (e.g. `2026-10-11T05:29:28.000Z`) and converts them to human-readable local time.
- Actionable steps are displayed in the UI:
  - Explains the difference between unauthenticated (60 req/hr) and authenticated (5,000 req/hr) limits.
  - Directs administrators to configure `GITHUB_TOKEN` in `server/.env`.
  - Accurately conveys provider-specific embedding quota errors without confusing them with GitHub issues.


