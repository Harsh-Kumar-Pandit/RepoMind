# RepoMind

**Understand any GitHub repository with grounded AI explanations, then write the code yourself.**

RepoMind is a GitHub repository understanding and manual code-editing workspace. Point it at a public repository, let it index the code, and ask questions in natural language. Every answer is grounded in retrieved code and cites files and line ranges. When you're ready to make changes, you edit in a persistent in-browser workspace, review diffs, save checkpoints, and publish to a GitHub branch or pull request.

> **Strict AI rule:** the AI only *explains* repository code. It never edits files, applies patches, commits, or opens pull requests on its own. Every change is written and published by you.

---

## Features

- **RAG-based code Q&A**: ask questions about a repository and get answers grounded in retrieved code, with file and line citations.
- **Snapshot indexing**: repositories are indexed per commit snapshot, with resumable runs, renewable worker locks, and pruning of deleted paths.
- **Language-aware chunking**: logical chunking for source code, heading-based chunking for Markdown, SHA-256 content hashing, and exact `startLine` / `endLine` tracking.
- **Embedding cache**: embeddings are reused by `(contentHash, embeddingModel, dimensions)`, with quota-aware batching and exponential backoff with jitter.
- **pgvector retrieval**: parameterized cosine-distance search, strictly isolated to one repository snapshot.
- **Provider fallback**: Gemini for chat and embeddings, with automatic OpenRouter fallback on transient 429/5xx errors.
- **Manual workspaces**: persistent per-user workspaces with a Monaco-based editor, file tree, and tabs.
- **Diff review and checkpoints**: review your changes against the base snapshot, save checkpoints, and restore any of them.
- **GitHub publishing**: push your work to a branch and open a pull request.
- **GitHub OAuth**: cookie-based sessions with per-repository access control.
- **Safe repository fetching**: only valid public GitHub URLs are accepted; non-GitHub hosts, SSRF attempts, and path traversal are rejected, and file count and size limits are enforced.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, React Router v7, TanStack Query, Monaco Editor, Axios |
| Backend | Node.js (ESM), Express 4 |
| Database | PostgreSQL (Neon) with the `pgvector` extension |
| ORM | Prisma 5 |
| Embeddings | Gemini `gemini-embedding-001` (768-d) or OpenRouter (`liquid/lfm-2.5-embedding-350m:free`, 1024-d) |
| Chat | Gemini `gemini-3.5-flash-lite`, with OpenRouter fallback |
| Auth | GitHub OAuth + HTTP-only session cookies |
| Testing | Node's built-in test runner (`node --test`) |

---

## How It Works

```
GitHub repo ──► Fetch (limits + SSRF checks)
            ──► Chunk (code-aware / Markdown-aware, SHA-256 hashed)
            ──► Embed (cached, rate-limited, batched)
            ──► Store in Postgres + pgvector (per commit snapshot)

Question ──► Embed query ──► Top-K cosine search (snapshot-scoped)
         ──► Prompt bounded by retrieved code ──► Gemini (OpenRouter fallback)
         ──► Answer with file + line citations
```

Retrieval uses exact (flat) pgvector search. Queries are pre-filtered by snapshot, typically 100 to 1,000 chunks, so a sequential scan stays fast with perfect recall and no index to build. HNSW can be added later if global chunk counts grow large.

---

## Project Structure

```
RepoMind/
├── backend.md              # Detailed backend design documentation
├── client/                 # React + Vite frontend
│   └── src/
│       ├── components/     # ui/, shared/, workspace/ (editor, diff viewer, checkpoints, publishing)
│       ├── contexts/       # AuthContext
│       ├── layouts/        # PublicLayout, AuthenticatedLayout
│       ├── pages/          # Landing, Repositories, Explorer, Chat, Workspace, History, Pull Requests, Settings
│       └── services/       # API clients (auth, repository, chat, workspace, publish)
└── server/                 # Express + Prisma backend
    ├── prisma/             # schema.prisma + SQL migrations
    ├── scripts/            # migration runner and DB verification scripts
    ├── tests/              # unit + integration tests
    └── src/
        ├── config/         # env loading/validation, Prisma client
        ├── middleware/     # auth, access, cookies, errors, 404
        ├── routes/         # health, auth, repository, chat, workspace, publish
        ├── services/       # github, chunking, embedding, indexing, retrieval, ai, chat,
        │                   # auth, session, access, workspace, diff, checkpoint, publish
        └── utils/
```

---

## Getting Started

### Prerequisites

- Node.js 23+
- A PostgreSQL database with the `pgvector` extension enabled (for example, a free [Neon](https://neon.tech) project)
- A [Gemini API key](https://aistudio.google.com/)
- A [GitHub OAuth app](https://github.com/settings/developers) (callback URL: `http://localhost:5000/api/auth/github/callback`)
- Optional: an OpenRouter API key (chat fallback) and a GitHub token (higher API rate limits)

### 1. Clone the repository

```bash
git clone https://github.com/Harsh-Kumar-Pandit/RepoMind.git
cd RepoMind
```

### 2. Set up the backend

```bash
cd server
npm install
cp .env.example .env     # then fill in your values
npm run prisma:generate
node scripts/run-migration.js
npm run dev              # http://localhost:5000
```

### 3. Set up the frontend

```bash
cd ../client
npm install
cp .env.example .env
npm run dev              # http://localhost:5173
```

---

## Configuration

### Server (`server/.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | API port | `5000` |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins | `http://localhost:5173` |
| `DATABASE_URL` | Postgres connection string (pooled) | required |
| `DIRECT_URL` | Direct Postgres URL for migrations | optional |
| `GEMINI_API_KEY` | Gemini key for chat and embeddings | required |
| `EMBEDDING_PROVIDER` | `gemini` or `openrouter` | `gemini` |
| `GEMINI_CHAT_MODEL` | Primary chat model | `gemini-3.5-flash-lite` |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `gemini-embedding-001` |
| `OPENROUTER_API_KEY` | Chat fallback / alternate embeddings | optional |
| `GITHUB_TOKEN` | Raises GitHub API rate limits | optional |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app credentials | required for auth |
| `GITHUB_OAUTH_CALLBACK_URL` | OAuth callback URL | `http://localhost:5000/api/auth/github/callback` |
| `SESSION_SECRET` | Session signing secret (32+ characters) | required |
| `SESSION_COOKIE_NAME` | Session cookie name | `repomind_session` |
| `SESSION_TTL_MS` | Session lifetime | `604800000` (7 days) |
| `RETRIEVAL_TOP_K` | Chunks retrieved per question | `6` |

**Indexing limits** (all overridable): `INDEXING_MAX_FILES` (70), `INDEXING_MAX_FILE_SIZE_BYTES` (500 KB), `INDEXING_MAX_TOTAL_BYTES` (5 MB), `INDEXING_MAX_CHUNKS` (500), `INDEXING_MAX_INPUT_TOKENS` (200,000), `INDEXING_MAX_DURATION_MS` (5 min), `GITHUB_CONCURRENCY` (5).

**Chunking**: `CHUNK_TARGET_TOKENS` (500), `CHUNK_MAX_TOKENS` (700), `CHUNK_OVERLAP_TOKENS` (60), `CHUNK_MIN_TOKENS` (30).

See `server/.env.example` for the full list. Never commit your `.env` file.

### Client (`client/.env`)

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:5000/api` |

---

## API Overview

All routes are prefixed with `/api`.

| Area | Routes |
|---|---|
| Health | `GET /health` |
| Auth | `GET /auth/github`, `GET /auth/github/callback`, `POST /auth/logout`, `GET /auth/me` |
| Repositories | `POST /repositories/analyze`, `GET /repositories`, `POST /repositories/:repositoryId/claim`, plus indexing and index-status endpoints |
| Chat | `POST /chat` (RAG question answering with citations) and chat thread history |
| Workspaces | `POST /workspaces`, `GET /workspaces`, `GET`/`DELETE /workspaces/:workspaceId`, `POST /workspaces/:workspaceId/init-files` |
| Workspace files | `GET /workspaces/:workspaceId/files`, `GET`/`PUT`/`DELETE /workspaces/:workspaceId/files/*` |
| Diff | `GET /workspaces/:workspaceId/diff` |
| Checkpoints | `POST`/`GET /workspaces/:workspaceId/checkpoints`, `GET /workspaces/:workspaceId/checkpoints/:checkpointId`, `POST .../restore` |
| Publishing | `POST /workspaces/:workspaceId/publish`, `POST /workspaces/:workspaceId/pull-request` |

For architecture, schema, and design decisions, see [`backend.md`](./backend.md).

---

## Testing

```bash
cd server
npm test
```

The suite covers chunking, embeddings and caching, retrieval, AI service behavior, GitHub fetching, indexing locks and regressions, auth, access control, workspaces, diff and checkpoints, and publishing.

---

## Roadmap

- Optional HNSW index once global chunk counts grow
- Support for larger repositories beyond the current indexing limits
- Deployment guide (frontend and backend)

---

## Author

**Harsh Kumar Pandit**
[GitHub](https://github.com/Harsh-Kumar-Pandit)

---

## License

Add a license of your choice (for example, MIT) and update this section.
