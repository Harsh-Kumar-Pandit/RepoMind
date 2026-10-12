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
    "dimensions" INTEGER NOT NULL DEFAULT 768,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeChunk_pkey" PRIMARY KEY ("id")
);

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
